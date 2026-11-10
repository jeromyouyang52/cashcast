/**
 * Shared plumbing for /api/paypal/*: config check, same-origin guard, error mapping.
 * Logs carry the route and PayPal's error name only, never bodies, amounts, ids or tokens.
 */
import { config, PayPalError, type Config } from "./paypal";

const NO_STORE = { "Cache-Control": "no-store" };
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

/** State-changing calls must come from this site's own pages. */
export function sameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = req.headers.get("origin");
  return !origin || origin === new URL(req.url).origin;
}

export async function handle(route: string, req: Request, fn: (c: Config) => Promise<unknown>, opts: { write?: boolean } = {}): Promise<Response> {
  if (opts.write && !sameOrigin(req)) return json({ error: "CROSS_ORIGIN" }, 403);
  let c: Config | null;
  try {
    c = config();
  } catch {
    return json({ error: "LIVE_REFUSED" }, 400);
  }
  if (!c) return json({ error: "NOT_CONFIGURED" }, 503);
  try {
    return json(await fn(c));
  } catch (e) {
    if (e instanceof PayPalError) {
      console.error(`[paypal] ${route} ${e.status} ${e.code}`);
      return json({ error: e.code }, e.status >= 500 || e.status < 400 ? 502 : e.status);
    }
    console.error(`[paypal] ${route} unexpected`);
    return json({ error: "UNEXPECTED" }, 500);
  }
}

export async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const j = await req.json();
    return j && typeof j === "object" ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const reqId = (v: unknown) => (typeof v === "string" && /^[a-zA-Z0-9-]{8,64}$/.test(v) ? v : crypto.randomUUID());
