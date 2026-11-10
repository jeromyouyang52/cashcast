/**
 * PayPal shapes shared by the server routes and the browser. Pure: no fetch, no secrets.
 * Everything here is sandbox data. Payer emails and addresses are dropped on the server.
 */

export type PPStatus = "completed" | "pending" | "refunded" | "partially_refunded" | "denied" | "other";
export type PPKind = "payment" | "refund" | "other";

export interface PPTxn {
  id: string;
  /** ISO date-time. */
  at: string;
  /** Payer's name, or the payment's description. */
  name: string;
  /** Signed: + money in, - money out. */
  amount: number;
  currency: string;
  /** PayPal's fee (positive), when known. */
  fee?: number;
  /** What lands in the balance after the fee. */
  net?: number;
  status: PPStatus;
  kind: PPKind;
  description?: string;
  /** Capture id that can be refunded (payments only). */
  captureId?: string;
}

export interface PPRefund {
  id: string;
  captureId: string;
  amount: number;
  currency: string;
  status: string;
  at: string;
}

const n = (v: unknown): number => {
  const x = Number((v as { value?: string } | undefined)?.value ?? v);
  return Number.isFinite(x) ? x : 0;
};
const r2 = (x: number) => Math.round(x * 100) / 100;

const CAPTURE_STATUS: Record<string, PPStatus> = {
  COMPLETED: "completed",
  PENDING: "pending",
  REFUNDED: "refunded",
  PARTIALLY_REFUNDED: "partially_refunded",
  DECLINED: "denied",
  FAILED: "denied",
};

type Money = { currency_code?: string; value?: string };
interface CaptureJSON {
  id?: string;
  status?: string;
  amount?: Money;
  create_time?: string;
  update_time?: string;
  seller_receivable_breakdown?: { gross_amount?: Money; paypal_fee?: Money; net_amount?: Money };
}

/** A capture from /v2/payments/captures or an order's capture response. */
export function fromCapture(c: CaptureJSON, name = "PayPal payment", description?: string): PPTxn | null {
  if (!c?.id || !c.amount) return null;
  const b = c.seller_receivable_breakdown;
  const gross = n(c.amount);
  return {
    id: c.id,
    at: c.create_time ?? c.update_time ?? new Date().toISOString(),
    name,
    amount: r2(gross),
    currency: c.amount.currency_code ?? "CAD",
    ...(b?.paypal_fee ? { fee: r2(n(b.paypal_fee)) } : {}),
    ...(b?.net_amount ? { net: r2(n(b.net_amount)) } : {}),
    status: CAPTURE_STATUS[c.status ?? ""] ?? "other",
    kind: "payment",
    ...(description ? { description } : {}),
    captureId: c.id,
  };
}

interface OrderJSON {
  id?: string;
  payer?: { name?: { given_name?: string; surname?: string } };
  payment_source?: { paypal?: { name?: { given_name?: string; surname?: string } } };
  purchase_units?: { description?: string; payments?: { captures?: CaptureJSON[] } }[];
}

export function fromOrder(o: OrderJSON): PPTxn | null {
  const nm = o.payer?.name ?? o.payment_source?.paypal?.name;
  const name = [nm?.given_name, nm?.surname].filter(Boolean).join(" ") || "PayPal payment";
  const pu = o.purchase_units?.[0];
  const cap = pu?.payments?.captures?.[0];
  return cap ? fromCapture(cap, name, pu?.description) : null;
}

interface SearchJSON {
  transaction_details?: {
    transaction_info?: {
      transaction_id?: string;
      transaction_event_code?: string;
      transaction_initiation_date?: string;
      transaction_amount?: Money;
      fee_amount?: Money;
      transaction_status?: string;
      transaction_subject?: string;
      transaction_note?: string;
    };
    payer_info?: { payer_name?: { alternate_full_name?: string; given_name?: string; surname?: string } };
  }[];
}

const SEARCH_STATUS: Record<string, PPStatus> = { S: "completed", P: "pending", D: "denied", V: "refunded" };

/** /v1/reporting/transactions → rows. Event codes T11xx are refunds/reversals; T00xx are payments. */
export function fromSearch(j: SearchJSON): PPTxn[] {
  const out: PPTxn[] = [];
  for (const d of j.transaction_details ?? []) {
    const t = d.transaction_info;
    if (!t?.transaction_id || !t.transaction_amount) continue;
    const amount = r2(n(t.transaction_amount));
    const fee = t.fee_amount ? r2(Math.abs(n(t.fee_amount))) : undefined;
    const code = t.transaction_event_code ?? "";
    const kind: PPKind = /^T11/.test(code) ? "refund" : /^T00/.test(code) ? "payment" : "other";
    const pn = d.payer_info?.payer_name;
    const name = pn?.alternate_full_name || [pn?.given_name, pn?.surname].filter(Boolean).join(" ") || t.transaction_subject || "PayPal";
    out.push({
      id: t.transaction_id,
      at: t.transaction_initiation_date ?? "",
      name,
      amount,
      currency: t.transaction_amount.currency_code ?? "CAD",
      ...(fee !== undefined ? { fee, net: r2(amount - (amount >= 0 ? fee : -fee)) } : {}),
      status: SEARCH_STATUS[t.transaction_status ?? ""] ?? "other",
      kind,
      ...(t.transaction_subject ? { description: t.transaction_subject } : {}),
      ...(kind === "payment" && amount > 0 ? { captureId: t.transaction_id } : {}),
    });
  }
  return out;
}

/** Newest first; a row seen both locally and in search keeps the richer copy (search wins on status). */
export function merge(local: PPTxn[], search: PPTxn[]): PPTxn[] {
  const m = new Map<string, PPTxn>();
  for (const t of local) m.set(t.id, t);
  for (const t of search) {
    const prev = m.get(t.id);
    m.set(t.id, prev ? { ...prev, ...t, name: prev.name !== "PayPal payment" ? prev.name : t.name } : t);
  }
  return [...m.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** How much of a payment can still be refunded, given refunds made from this device. */
export function refundable(t: PPTxn, refunds: PPRefund[]): number {
  if (t.kind !== "payment" || t.amount <= 0 || !t.captureId) return 0;
  if (t.status !== "completed" && t.status !== "partially_refunded") return 0;
  const done = refunds.filter((r) => r.captureId === t.captureId && r.status !== "FAILED" && r.status !== "CANCELLED").reduce((s, r) => s + r.amount, 0);
  return Math.max(0, r2(t.amount - done));
}

/** PayPal ids: upper-case letters and digits. Anything else never reaches the API. */
export const isId = (s: unknown): s is string => typeof s === "string" && /^[A-Z0-9]{8,40}$/.test(s);

/** Two decimals, 0.01 to 500. Sandbox only, but kept small on purpose. */
export const MAX_AMOUNT = 500;
export function validAmount(v: unknown): number | null {
  const x = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(x) || x < 0.01 || x > MAX_AMOUNT) return null;
  if (Math.abs(Math.round(x * 100) - x * 100) > 1e-6) return null;
  return r2(x);
}

export const CURRENCIES = ["CAD", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];
