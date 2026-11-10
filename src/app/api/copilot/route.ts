import { REASONS, type Reason } from "@/lib/copilot";
import { refundable, validAmount, type PPRefund, type PPTxn } from "@/lib/paypal";
import { aiExplain, aiRefundNote } from "@/server/copilot";
import { geminiConfig } from "@/server/gemini";
import { body, json, sameOrigin } from "@/server/route";

export const dynamic = "force-dynamic";

/**
 * Copilot wording from Gemini. Input is one sandbox payment the browser already shows; output is
 * text only. `{source:"template"}` means "keep the built-in wording" (no key, quota, or the model's
 * answer failed the number checks). This route never touches PayPal and never moves money.
 */
const STATUSES = ["completed", "pending", "refunded", "partially_refunded", "denied", "other"] as const;
const KINDS = ["payment", "refund", "other"] as const;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e7 ? v : undefined);

function readTxn(v: unknown): PPTxn | null {
  const o = (v ?? {}) as Record<string, unknown>;
  const amount = num(o.amount);
  const currency = typeof o.currency === "string" && /^[A-Z]{3}$/.test(o.currency) ? o.currency : null;
  if (amount === undefined || !currency) return null;
  return {
    id: str(o.id, 40) || "X",
    at: str(o.at, 40),
    name: str(o.name, 80) || "PayPal",
    amount,
    currency,
    fee: num(o.fee),
    net: num(o.net),
    status: (STATUSES as readonly string[]).includes(o.status as string) ? (o.status as PPTxn["status"]) : "other",
    kind: (KINDS as readonly string[]).includes(o.kind as string) ? (o.kind as PPTxn["kind"]) : "other",
    description: str(o.description, 127) || undefined,
    captureId: str(o.captureId, 40) || undefined,
  };
}

function readRefunds(v: unknown, captureId?: string): PPRefund[] {
  if (!Array.isArray(v) || !captureId) return [];
  return v.slice(0, 20).flatMap((r) => {
    const a = num((r as Record<string, unknown>)?.amount);
    return a !== undefined && a > 0 ? [{ id: "R", captureId, amount: a, currency: "", status: "", at: "" }] : [];
  });
}

// Small per-instance limiter so a public URL can't drain the free quota.
const hits = new Map<string, { n: number; since: number }>();
function limited(req: Request): boolean {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.since > 10 * 60_000) {
    hits.set(ip, { n: 1, since: now });
    if (hits.size > 5000) hits.clear();
    return false;
  }
  return ++h.n > 40;
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "CROSS_ORIGIN" }, 403);
  const g = geminiConfig();
  if (!g) return json({ source: "template", why: "not_configured" });
  if (limited(req)) return json({ source: "template", why: "busy" });

  const b = await body(req);
  const t = readTxn(b.txn);
  if (!t) return json({ error: "BAD_TXN" }, 400);
  const lang = b.lang === "zh" ? "zh" : "en";
  const refunds = readRefunds(b.refunds, t.captureId);

  if (b.task === "explain") {
    const daily = num(b.daily);
    const lines = await aiExplain(g, t, refunds, lang, daily && daily > 0 ? daily : undefined);
    return json(lines ? { source: "gemini", lines } : { source: "template", why: "fallback" });
  }
  if (b.task === "refund") {
    const reason = REASONS.some((r) => r.key === b.reason) ? (b.reason as Reason) : "duplicate";
    const amount = validAmount(b.amount);
    if (amount === null || amount > refundable(t, refunds) + 0.001) return json({ error: "BAD_AMOUNT" }, 400);
    const note = await aiRefundNote(g, t, refunds, reason, amount, lang);
    return json(note ? { source: "gemini", note } : { source: "template", why: "fallback" });
  }
  return json({ error: "BAD_TASK" }, 400);
}
