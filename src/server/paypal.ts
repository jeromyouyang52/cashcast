/**
 * PayPal REST client. SANDBOX ONLY.
 *
 *   • The API host is fixed to api-m.sandbox.paypal.com. The only override is a mock server on
 *     localhost/127.0.0.1 (for tests). A live host can't be configured; PAYPAL_ENV other than
 *     "sandbox" is refused outright.
 *   • Credentials come from server env (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET). They never
 *     leave this module and never reach the browser.
 *   • Errors carry PayPal's error name only. Bodies, tokens and amounts are never logged.
 *
 * Imported by route handlers only.
 */
import { fromCapture, fromOrder, fromSearch, type Currency, type PPRefund, type PPTxn, CURRENCIES } from "@/lib/paypal";

export const SANDBOX = "https://api-m.sandbox.paypal.com";
const LOCAL_MOCK = /^http:\/\/(127\.0\.0\.1|localhost)(:\d{2,5})?$/;

export class PayPalError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

type Env = Record<string, string | undefined>;
export interface Config {
  id: string;
  secret: string;
  base: string;
  currency: Currency;
}

/** null when not configured. Throws LIVE_REFUSED for anything that isn't the sandbox. */
export function config(env: Env = process.env): Config | null {
  const mode = (env.PAYPAL_ENV ?? "sandbox").trim().toLowerCase();
  if (mode !== "sandbox") throw new PayPalError(400, "LIVE_REFUSED");
  const id = env.PAYPAL_CLIENT_ID?.trim();
  const secret = env.PAYPAL_CLIENT_SECRET?.trim();
  if (!id || !secret) return null;
  const override = env.PAYPAL_API_BASE?.trim();
  if (override && !LOCAL_MOCK.test(override)) throw new PayPalError(400, "LIVE_REFUSED");
  const cur = (env.PAYPAL_CURRENCY ?? "CAD").trim().toUpperCase();
  return { id, secret, base: override || SANDBOX, currency: (CURRENCIES as readonly string[]).includes(cur) ? (cur as Currency) : "CAD" };
}

type Fetch = typeof fetch;
let cached: { key: string; token: string; until: number } | null = null;
export const _resetToken = () => (cached = null);

async function token(c: Config, f: Fetch): Promise<string> {
  const key = `${c.base}|${c.id}`;
  if (cached && cached.key === key && cached.until > Date.now()) return cached.token;
  const res = await f(`${c.base}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${c.id}:${c.secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) throw new PayPalError(res.status === 401 ? 401 : 502, res.status === 401 ? "AUTH_FAILED" : `TOKEN_${res.status}`);
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new PayPalError(502, "TOKEN_MISSING");
  cached = { key, token: j.access_token, until: Date.now() + Math.max(60, (j.expires_in ?? 300) - 60) * 1000 };
  return j.access_token;
}

async function call<T>(c: Config, path: string, init: { method?: string; body?: unknown; requestId?: string } = {}, f: Fetch = fetch): Promise<T> {
  if (!path.startsWith("/v")) throw new PayPalError(400, "BAD_PATH");
  const tk = await token(c, f);
  const res = await f(c.base + path, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${tk}`,
      Accept: "application/json",
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(init.requestId ? { "PayPal-Request-Id": init.requestId } : {}),
      Prefer: "return=representation",
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 401) cached = null;
    let code = `HTTP_${res.status}`;
    try {
      const j = (await res.json()) as { name?: string; details?: { issue?: string }[] };
      const issue = j.details?.[0]?.issue;
      code = [j.name, issue].filter((x) => typeof x === "string" && /^[A-Z_]{2,60}$/.test(x)).join(":") || code;
    } catch {
      /* no body */
    }
    throw new PayPalError(res.status, code);
  }
  return (res.status === 204 ? {} : await res.json()) as T;
}

export async function ping(c: Config, f: Fetch = fetch): Promise<void> {
  await token(c, f);
}

/** A test order the user approves on PayPal's sandbox page. Returns where to send them. */
export async function createOrder(
  c: Config,
  o: { amount: number; description: string; returnUrl: string; cancelUrl: string; requestId: string },
  f: Fetch = fetch,
): Promise<{ id: string; approve: string }> {
  const j = await call<{ id?: string; links?: { rel: string; href: string }[] }>(
    c,
    "/v2/checkout/orders",
    {
      method: "POST",
      requestId: o.requestId,
      body: {
        intent: "CAPTURE",
        purchase_units: [{ amount: { currency_code: c.currency, value: o.amount.toFixed(2) }, description: o.description.slice(0, 127) }],
        payment_source: {
          paypal: {
            experience_context: { brand_name: "Cashcast sandbox", user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING", return_url: o.returnUrl, cancel_url: o.cancelUrl },
          },
        },
      },
    },
    f,
  );
  const link = j.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  if (!j.id || !link) throw new PayPalError(502, "NO_APPROVE_LINK");
  const u = new URL(link);
  // The buyer is only ever sent to PayPal's sandbox (or the local test mock).
  if (!(u.hostname === "www.sandbox.paypal.com" || u.hostname === "sandbox.paypal.com" || LOCAL_MOCK.test(u.origin))) throw new PayPalError(502, "NOT_SANDBOX");
  return { id: j.id, approve: link };
}

export async function captureOrder(c: Config, id: string, requestId: string, f: Fetch = fetch): Promise<PPTxn> {
  const j = await call<Parameters<typeof fromOrder>[0]>(c, `/v2/checkout/orders/${id}/capture`, { method: "POST", body: {}, requestId }, f);
  const t = fromOrder(j);
  if (!t) throw new PayPalError(502, "NO_CAPTURE");
  return t;
}

export async function getCapture(c: Config, id: string, f: Fetch = fetch): Promise<PPTxn> {
  const j = await call<Parameters<typeof fromCapture>[0]>(c, `/v2/payments/captures/${id}`, {}, f);
  const t = fromCapture(j);
  if (!t) throw new PayPalError(502, "BAD_CAPTURE");
  return t;
}

export async function refund(
  c: Config,
  r: { captureId: string; amount: number; currency: string; note: string; requestId: string },
  f: Fetch = fetch,
): Promise<PPRefund> {
  const j = await call<{ id?: string; status?: string; amount?: { value?: string; currency_code?: string }; create_time?: string }>(
    c,
    `/v2/payments/captures/${r.captureId}/refund`,
    {
      method: "POST",
      requestId: r.requestId,
      body: { amount: { value: r.amount.toFixed(2), currency_code: r.currency }, ...(r.note ? { note_to_payer: r.note.slice(0, 255) } : {}) },
    },
    f,
  );
  if (!j.id) throw new PayPalError(502, "NO_REFUND");
  return { id: j.id, captureId: r.captureId, amount: Number(j.amount?.value ?? r.amount), currency: j.amount?.currency_code ?? r.currency, status: j.status ?? "PENDING", at: j.create_time ?? new Date().toISOString() };
}

const stamp = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

/** Last `days` days (max 31, PayPal's limit). Needs "Transaction Search" enabled on the sandbox app; data can lag up to a few hours. */
export async function search(c: Config, days: number, f: Fetch = fetch, now = new Date()): Promise<PPTxn[]> {
  const d = Math.max(1, Math.min(31, Math.floor(days)));
  const from = new Date(now.getTime() - d * 86400_000);
  const q = new URLSearchParams({ start_date: stamp(from), end_date: stamp(now), fields: "transaction_info,payer_info", page_size: "100" });
  const j = await call<Parameters<typeof fromSearch>[0]>(c, `/v1/reporting/transactions?${q}`, {}, f);
  return fromSearch(j);
}
