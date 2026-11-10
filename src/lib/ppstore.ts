/**
 * Sandbox payments made from this device, and refunds issued from here. Kept apart from the
 * forecast state ("cashcast.v1") so the two can be cleared independently. Browser-only.
 */
import type { PPRefund, PPTxn } from "./paypal";
import { isId } from "./paypal";

const KEY = "cashcast.paypal";
export interface PPLocal {
  txns: PPTxn[];
  refunds: PPRefund[];
}

const empty = (): PPLocal => ({ txns: [], refunds: [] });

export function loadPP(): PPLocal {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!j || !Array.isArray(j.txns) || !Array.isArray(j.refunds)) return empty();
    return {
      txns: j.txns.filter((t: PPTxn) => isId(t?.id) && typeof t.amount === "number" && typeof t.currency === "string").slice(0, 200),
      refunds: j.refunds.filter((r: PPRefund) => isId(r?.id) && isId(r.captureId) && typeof r.amount === "number").slice(0, 200),
    };
  } catch {
    return empty();
  }
}

export function savePP(s: PPLocal): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: the session still works */
  }
}

export function wipePP(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
}

export const upsert = <T extends { id: string }>(xs: T[], x: T): T[] => [x, ...xs.filter((y) => y.id !== x.id)];
