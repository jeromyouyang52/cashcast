/**
 * Copilot drafts for one PayPal payment: what it is in plain words, and a refund the user can
 * edit. Drafts only. Nothing is sent or refunded until the user confirms in the app.
 *
 * These templates show instantly and are the fallback. Gemini rewrites the wording when
 * GEMINI_API_KEY is set (src/server/copilot.ts), but only answers that pass `acceptLines` /
 * `acceptNote` are used. The confirm step is the same either way.
 */
import type { PPRefund, PPTxn } from "./paypal";
import { refundable } from "./paypal";
import type { Lang } from "./ui";

export function money(v: number, currency: string, lang: Lang): string {
  return new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-CA", { style: "currency", currency }).format(v);
}

function day(at: string, lang: Lang): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(lang === "zh" ? "zh-CN" : "en-CA", { month: "short", day: "numeric" });
}

const STATUS: Record<PPTxn["status"], [string, string]> = {
  completed: ["It's complete.", "已到账。"],
  pending: ["It's still pending, so it isn't in your balance yet.", "还在处理中，暂时没进余额。"],
  refunded: ["It was refunded in full.", "已全额退款。"],
  partially_refunded: ["Part of it was refunded.", "已部分退款。"],
  denied: ["It didn't go through.", "这笔没有成功。"],
  other: ["", ""],
};

/** Plain-language lines about a payment. `daily` (everyday spending per day) adds a sense of scale. */
export function explain(t: PPTxn, refunds: PPRefund[], lang: Lang, daily?: number): string[] {
  const zh = lang === "zh";
  const m = (v: number) => money(v, t.currency, lang);
  const when = day(t.at, lang);
  const lines: string[] = [];
  if (t.kind === "other") {
    lines.push(zh ? `${when}：${t.description || t.name}，${m(t.amount)}。` : `${t.description || t.name}: ${m(t.amount)} on ${when}.`);
  } else if (t.kind === "refund") {
    lines.push(zh ? `${when}退给 ${t.name} ${m(Math.abs(t.amount))}。` : `A refund of ${m(Math.abs(t.amount))} to ${t.name} on ${when}.`);
  } else if (t.amount >= 0) {
    lines.push(zh ? `${when}收到 ${t.name} 的 ${m(t.amount)}${t.description ? `（${t.description}）` : ""}。` : `${t.name} paid you ${m(t.amount)} on ${when}${t.description ? ` for “${t.description}”` : ""}.`);
    if (t.fee !== undefined && t.net !== undefined) {
      lines.push(zh ? `PayPal 收了 ${m(t.fee)} 手续费，实际到手 ${m(t.net)}。` : `PayPal kept ${m(t.fee)} in fees, so ${m(t.net)} reaches your balance.`);
    }
  } else {
    lines.push(zh ? `${when}付给 ${t.name} ${m(-t.amount)}。` : `You paid ${t.name} ${m(-t.amount)} on ${when}.`);
  }
  const s = STATUS[t.status][zh ? 1 : 0];
  if (s) lines.push(s);
  const done = refunds.filter((r) => r.captureId === t.captureId);
  if (done.length) {
    const sum = done.reduce((x, r) => x + r.amount, 0);
    lines.push(zh ? `已从这里退款 ${m(sum)}。` : `${m(sum)} refunded from here so far.`);
  }
  if (daily && daily > 0 && t.kind === "payment" && t.status === "completed") {
    const days = Math.floor((t.net ?? Math.abs(t.amount)) / daily);
    if (days >= 1) lines.push(zh ? `大约相当于 ${days} 天的日常花销。` : `That's about ${days} day${days === 1 ? "" : "s"} of everyday spending.`);
  }
  return lines;
}

export type Reason = "duplicate" | "not_received" | "cancelled" | "goodwill";
export const REASONS: { key: Reason; en: string; zh: string }[] = [
  { key: "duplicate", en: "Charged twice", zh: "重复扣款" },
  { key: "not_received", en: "Not delivered", zh: "没收到" },
  { key: "cancelled", en: "Order cancelled", zh: "订单取消" },
  { key: "goodwill", en: "Goodwill", zh: "补偿" },
];

const first = (name: string) => (name && name !== "PayPal payment" && name !== "PayPal" ? name.split(" ")[0] : "");

export interface RefundDraft {
  amount: number;
  max: number;
  note: string;
}

/**
 * Guardrails for AI wording. The model may phrase things, but every money-like number it writes
 * must be one the app already knows (gross, fee, net, refunded, the refund amount, days of spending).
 * Decimals always count; whole numbers count from 32 up (so dates like "Nov 10" pass), except years.
 */
export function numbersOk(text: string, allowed: number[]): boolean {
  const ok = (n: number) => allowed.some((a) => Math.abs(Math.abs(a) - n) < 0.005);
  for (const m of text.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)) {
    const raw = m[0].replace(/,/g, "");
    const n = Number(raw);
    if (!Number.isFinite(n)) return false;
    const decimal = raw.includes(".");
    if (!decimal && (n < 32 || (n >= 2000 && n <= 2100))) continue;
    if (!ok(n)) return false;
  }
  return true;
}

const clean = (s: string, max: number) =>
  s
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** The numbers Copilot is allowed to mention for this payment. */
export function knownNumbers(t: PPTxn, refunds: PPRefund[], daily?: number, extra: number[] = []): number[] {
  const done = refunds.filter((r) => r.captureId === t.captureId).reduce((x, r) => x + r.amount, 0);
  const days = daily && daily > 0 ? Math.floor((t.net ?? Math.abs(t.amount)) / daily) : undefined;
  return [t.amount, t.fee, t.net, done, refundable(t, refunds), days, ...extra].filter((x): x is number => typeof x === "number" && Number.isFinite(x));
}

/** Accept the model's explanation only if it's 1–4 short lines with no invented numbers. */
export function acceptLines(v: unknown, allowed: number[]): string[] | null {
  const raw = (v as { lines?: unknown })?.lines;
  if (!Array.isArray(raw)) return null;
  const lines = raw.filter((x): x is string => typeof x === "string").map((x) => clean(x, 220)).filter(Boolean).slice(0, 4);
  if (!lines.length || !lines.every((l) => numbersOk(l, allowed))) return null;
  return lines;
}

/** Accept the model's refund note only if it names the exact refund amount and invents no other numbers. */
export function acceptNote(v: unknown, amount: number, allowed: number[]): string | null {
  const raw = (v as { note?: unknown })?.note;
  if (typeof raw !== "string") return null;
  const note = clean(raw, 255);
  if (note.length < 20 || !note.includes(amount.toFixed(2)) || !numbersOk(note, allowed)) return null;
  return note;
}

/** A refund draft: full amount by default (half for goodwill), with a short note to the payer (≤ 255 chars, PayPal's limit). */
export function draftRefund(t: PPTxn, refunds: PPRefund[], reason: Reason, lang: Lang): RefundDraft {
  const zh = lang === "zh";
  const max = refundable(t, refunds);
  const amount = reason === "goodwill" ? Math.max(0.01, Math.floor(max * 50) / 100) : max;
  const m = money(amount, t.currency, lang);
  const hi = first(t.name);
  const when = day(t.at, lang);
  const why = {
    duplicate: zh ? "你被重复扣了一次款" : "you were charged twice",
    not_received: zh ? "订单没有送达" : "your order didn't arrive",
    cancelled: zh ? "订单已取消" : "the order was cancelled",
    goodwill: zh ? "这次给你带来了不便" : "of the trouble with your order",
  }[reason];
  const note = zh
    ? `${hi ? `${hi}你好，` : "你好，"}因为${why}，我已为你${when}的付款退款 ${m}。几天内会退回你的 PayPal 账户。给你添麻烦了。`
    : `${hi ? `Hi ${hi}, ` : "Hi, "}I've refunded ${m} for your ${when} payment because ${why}. It should show in your PayPal account within a few days. Sorry for the trouble.`;
  return { amount, max, note: note.slice(0, 255) };
}
