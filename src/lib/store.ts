/**
 * Local-only persistence. One key, one JSON object. Every access is wrapped: private
 * windows, blocked storage and full quotas all fall back to "nothing saved" rather
 * than an error. Error messages never include the data itself.
 */
import { DEFAULT_SAVE_PCT } from "./model";
import type { State } from "./types";

const KEY = "cashcast.v1";

export function load(): State | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? validate(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function save(s: State): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export function wipe(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem("cashcast.paypal");
  } catch {
    /* nothing stored */
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const arr = <T,>(v: unknown, ok: (x: Record<string, unknown>) => boolean): T[] =>
  Array.isArray(v) ? (v.filter((x) => x && typeof x === "object" && ok(x as Record<string, unknown>)) as T[]) : [];

/**
 * Accept only the shapes we wrote. Version 1 files (before the assistant) upgrade in place:
 * every new field starts empty. Returns null for anything else (no partial imports).
 */
export function validate(x: unknown): State | null {
  if (!x || typeof x !== "object") return null;
  const s = x as Partial<State>;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const v = (s as { v?: number }).v;
  if ((v !== 1 && v !== 2) || !num(s.balance) || !num(s.safety) || !num(s.daily) || !Array.isArray(s.items) || !Array.isArray(s.extras)) return null;
  const okItem = (i: unknown) => {
    const r = i as Record<string, unknown>;
    return r && typeof r.id === "string" && typeof r.name === "string" && num(r.amount) && typeof r.next === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.next as string);
  };
  if (!s.items.every(okItem)) return null;
  const isNum = (x: unknown) => typeof x === "number" && Number.isFinite(x);
  return {
    v: 2,
    balance: s.balance!,
    safety: s.safety!,
    daily: s.daily!,
    items: s.items,
    extras: s.extras,
    dryFrom: typeof s.dryFrom === "string" ? s.dryFrom : null,
    source: s.source === "csv" || s.source === "manual" ? s.source : "demo",
    asOf: typeof s.asOf === "string" && ISO.test(s.asOf) ? s.asOf : "1970-01-01",
    checkins: arr(s.checkins, (c) => typeof c.date === "string" && ISO.test(c.date) && isNum(c.spent) && (c.spent as number) >= 0),
    goals: arr(s.goals, (g) => typeof g.id === "string" && typeof g.name === "string" && isNum(g.target) && (g.target as number) > 0),
    saves: arr(s.saves, (x) => typeof x.id === "string" && typeof x.goalId === "string" && typeof x.date === "string" && ISO.test(x.date) && isNum(x.amount)),
    savePct: isNum(s.savePct) && s.savePct! >= 0 && s.savePct! <= 1 ? s.savePct! : DEFAULT_SAVE_PCT,
    notes: arr(s.notes, (n) => typeof n.id === "string" && typeof n.kind === "string" && typeof n.name === "string" && isNum(n.amount)),
    dismissed: Array.isArray(s.dismissed) ? s.dismissed.filter((d): d is string => typeof d === "string").slice(-500) : [],
  };
}

export function exportFile(s: State): Blob {
  return new Blob([JSON.stringify(s, null, 2)], { type: "application/json" });
}
