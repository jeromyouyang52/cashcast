/**
 * The assistant's brain. Pure functions over saved State; no React, no browser APIs.
 *
 *   fromTxns      first guess from a bank file
 *   project       the 30-day forecast from today (logged spending and savings included)
 *   allowance     "today you can spend C$X": the most per day until next pay without dipping under the safety line
 *   savingsPlan   on payday: what's left after everything until next pay is covered, and how much to set aside
 *   reminders     bills due soon, price hikes, unfamiliar charges, categories running hot, payday savings
 */
import { lastBalance } from "./csv";
import { addDays, diffDays } from "./dates";
import { detect } from "./detect";
import { defaultSafety, dryFrom, forecast, occurrences } from "./forecast";
import { insights } from "./insights";
import type { CheckIn, Flow, Forecast, ForecastInput, Note, State, Txn } from "./types";

export const DEFAULT_SAVE_PCT = 0.5;
/** How many days of the file's average a check-in history is weighed against. */
const BASE_WEIGHT = 14;
const CHECKIN_WINDOW = 28;
const r2 = (x: number) => Math.round(x * 100) / 100;

export function emptyExtras(): Pick<State, "checkins" | "goals" | "saves" | "savePct" | "notes" | "dismissed"> {
  return { checkins: [], goals: [], saves: [], savePct: DEFAULT_SAVE_PCT, notes: [], dismissed: [] };
}

/** First guess from a file. `balance` is NaN when the bank gave no balance column; the confirm step asks. */
export function fromTxns(txns: Txn[], today: string, source: State["source"]): State {
  const d = detect(txns, today);
  const bal = lastBalance(txns);
  const safety = defaultSafety(d.daily);
  return {
    v: 2,
    balance: bal ?? NaN,
    safety,
    daily: d.daily,
    items: d.items,
    extras: [],
    dryFrom: bal === null ? null : dryFrom(txns, bal, safety, d.to),
    source,
    asOf: today,
    ...emptyExtras(),
    notes: insights(txns, d.items),
  };
}

/** Logged spending by date (latest entry per date wins). */
export function actuals(checkins: CheckIn[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const c of checkins) m[c.date] = c.spent;
  return m;
}

/**
 * Everyday spending per day: the file's average, nudged by the last 4 weeks of check-ins.
 * Weighted like 14 days of the average plus each logged day, so one big day moves it a little.
 */
export function effectiveDaily(s: State, today: string): number {
  const from = addDays(today, -CHECKIN_WINDOW + 1);
  const recent = Object.entries(actuals(s.checkins)).filter(([d]) => d >= from && d <= today);
  if (!recent.length) return s.daily;
  const sum = recent.reduce((t, [, v]) => t + v, 0);
  return r2((s.daily * BASE_WEIGHT + sum) / (BASE_WEIGHT + recent.length));
}

function inputs(s: State, today: string, extras = s.extras): Omit<ForecastInput, "today" | "balance"> {
  return { safety: s.safety, daily: effectiveDaily(s, today), items: s.items, extras, actuals: actuals(s.checkins), saves: s.saves };
}

/** Balance at the start of `today`, walking forward from the last known balance. */
export function balanceAt(s: State, today: string): number {
  const lag = Math.max(0, Math.min(365, diffDays(s.asOf, today)));
  if (!lag) return s.balance;
  return forecast({ ...inputs(s, today), today: s.asOf, balance: s.balance, days: lag }).days[lag - 1].end;
}

/**
 * The 30 days from today. If the balance was entered days ago, the days in between are
 * projected too (with any logged spending), so the forecast stays honest until the user updates it.
 */
export function project(s: State, today: string, extras = s.extras): Forecast {
  return forecast({ ...inputs(s, today, extras), today, balance: balanceAt(s, today) });
}

/** Days in the current dry run, counting today, or 0. */
export function dryDays(s: State, f: Forecast, today: string): number {
  if (!s.dryFrom || !f.days.length) return 0;
  if (f.days[0].weather === "rain" || f.days[0].weather === "storm") return 0;
  return diffDays(s.dryFrom, today) + 1;
}

const incomes = (s: State) => s.items.filter((i) => i.kind === "income" && i.on && !i.cancelled);

/** First pay date strictly after today, within 60 days. */
export function nextPayday(s: State, today: string): string | null {
  const ds = incomes(s).flatMap((i) => occurrences(i, addDays(today, 1), 60));
  return ds.sort()[0] ?? null;
}

/** Most recent pay date in [today-2, today], for the payday card. */
export function recentPayday(s: State, today: string): string | null {
  const ds = incomes(s).flatMap((i) => occurrences(i, addDays(today, -2), 3));
  return ds.sort().pop() ?? null;
}

export interface Allowance {
  /** Whole dollars per day, ≥ 0. */
  perDay: number;
  /** What's left of today's allowance after today's check-in. */
  left: number;
  spentToday: number | null;
  /** Window end: next pay date (exclusive), or 30 days out. */
  until: string;
  hasPay: boolean;
  /** Balance at the start of today. */
  start: number;
  /** The day that limits the allowance, and every fixed flow up to it. */
  bind: { date: string; days: number; flows: (Flow & { date: string })[]; endBeforeSpending: number };
  /** When even spending nothing dips under the line: how far, and the best bill to move. */
  shortfall: number;
  postpone?: { label: string; date: string; amount: number };
}

export function allowance(s: State, today: string): Allowance {
  const pay = nextPayday(s, today);
  const until = pay ?? addDays(today, 30);
  const days = Math.max(1, diffDays(today, until));
  const act = actuals(s.checkins);
  const spentToday = act[today] ?? null;
  delete act[today]; // today is the day we're budgeting
  const extras = s.extras.filter((x) => x.date >= today);
  const start = balanceAt(s, today);
  const f = forecast({ today, balance: start, safety: s.safety, daily: 0, items: s.items, extras, actuals: act, saves: s.saves, days });

  let best = Infinity;
  let at = 0;
  let free = 0;
  let freeAt = 1;
  for (let k = 0; k < days; k++) {
    if (act[f.days[k].date] === undefined) free++;
    if (!free) continue;
    const a = (f.days[k].end - s.safety) / free;
    if (a < best) {
      best = a;
      at = k;
      freeAt = free;
    }
  }
  if (!Number.isFinite(best)) best = 0;
  const flows = f.days
    .slice(0, at + 1)
    .flatMap((d) => d.flows.filter((x) => x.kind !== "daily").map((x) => ({ ...x, date: d.date })));
  const perDay = Math.max(0, Math.floor(best));
  const shortfall = best < 0 ? r2(-best * freeAt) : 0;
  let postpone: Allowance["postpone"];
  if (shortfall > 0) {
    const c = flows.filter((x) => (x.kind === "bill" || x.kind === "sub") && x.amount < 0).sort((a, b) => a.amount - b.amount)[0];
    if (c) postpone = { label: c.label, date: c.date, amount: -c.amount };
  }
  return {
    perDay,
    left: Math.max(0, perDay - (spentToday ?? 0)),
    spentToday,
    until,
    hasPay: !!pay,
    start,
    bind: { date: f.days[at].date, days: freeAt, flows, endBeforeSpending: f.days[at].end },
    shortfall,
    postpone,
  };
}

export interface SavingsPlan {
  id: string;
  payday: string;
  /** Lowest the balance gets before next pay, minus the safety line. */
  surplus: number;
  suggest: number;
}

/** On (or just after) payday, if nothing was set aside yet this cycle. */
export function savingsPlan(s: State, today: string): SavingsPlan | null {
  const payday = recentPayday(s, today);
  if (!payday) return null;
  if (s.saves.some((x) => x.date >= payday)) return null;
  const until = nextPayday(s, today) ?? addDays(today, 30);
  const days = Math.max(1, diffDays(today, until));
  const f = project(s, today);
  const low = Math.min(...f.days.slice(0, days).map((d) => d.end));
  const surplus = Math.floor(low - s.safety);
  const suggest = Math.floor((surplus * s.savePct) / 10) * 10;
  if (suggest < 10) return null;
  return { id: `save:${payday}`, payday, surplus, suggest };
}

export function savedFor(s: State, goalId: string): number {
  return r2(s.saves.filter((x) => x.goalId === goalId).reduce((t, x) => t + x.amount, 0));
}

export type Reminder =
  | { id: string; kind: "save"; plan: SavingsPlan }
  | { id: string; kind: "bill"; name: string; date: string; amount: number }
  | { id: string; kind: "note"; note: Note };

/** Everything worth a card, most useful first, minus anything swiped away. */
export function reminders(s: State, today: string): Reminder[] {
  const out: Reminder[] = [];
  const plan = savingsPlan(s, today);
  if (plan) out.push({ id: plan.id, kind: "save", plan });
  const bills = s.items
    .filter((i) => i.kind !== "income" && i.on && !i.cancelled)
    .flatMap((i) => occurrences(i, today, 4).map((date) => ({ id: `bill:${i.id}:${date}`, kind: "bill" as const, name: i.name, date, amount: Math.abs(i.amount) })))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount));
  out.push(...bills);
  const order = { hike: 0, new: 1, category: 2 };
  out.push(...[...s.notes].sort((a, b) => order[a.kind] - order[b.kind]).map((note) => ({ id: note.id, kind: "note" as const, note })));
  const gone = new Set(s.dismissed);
  return out.filter((r) => !gone.has(r.id));
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** The four quick-setup answers. Everything else is learned from daily check-ins. */
export interface Answers {
  balance: number;
  /** Everyday spending per week (food, shopping, getting around). */
  weekly: number;
  pay?: { amount: number; next: string; cadence: "weekly" | "biweekly" | "monthly"; name?: string };
  rent?: { amount: number; day: number; name?: string };
  bills: { key: string; name: string; amount: number; day: number; kind: "bill" | "sub" }[];
}

/** Next date on or after `today` that falls on day-of-month `day` (clamped to short months). */
export function nextOnDay(today: string, day: number): string {
  const [y, m, d] = today.split("-").map(Number);
  const dim = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  if (Math.min(day, dim(y, m)) >= d) return `${y}-${pad(m)}-${pad(Math.min(day, dim(y, m)))}`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(day, dim(ny, nm)))}`;
}

export function fromAnswers(a: Answers, today: string): State {
  const daily = Math.round((a.weekly / 7) * 100) / 100;
  const items: State["items"] = [];
  const base = { confidence: 1, on: true, seen: 0 };
  if (a.pay) items.push({ id: "pay", name: a.pay.name ?? "Pay", amount: Math.abs(a.pay.amount), kind: "income", cadence: a.pay.cadence, next: a.pay.next, ...base });
  if (a.rent) items.push({ id: "rent", name: a.rent.name ?? "Rent", amount: -Math.abs(a.rent.amount), kind: "bill", cadence: "monthly", next: nextOnDay(today, a.rent.day), ...base });
  for (const b of a.bills) items.push({ id: b.key, name: b.name, amount: -Math.abs(b.amount), kind: b.kind, cadence: "monthly", next: nextOnDay(today, b.day), ...base });
  return {
    v: 2,
    balance: a.balance,
    safety: defaultSafety(daily),
    daily,
    items,
    extras: [],
    dryFrom: null,
    source: "manual",
    asOf: today,
    ...emptyExtras(),
  };
}
