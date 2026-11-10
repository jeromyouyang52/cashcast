/**
 * The forecast engine. Pure and deterministic: same input, same 30 days.
 *
 * Each day: start balance → recurring items due that day → tried-out purchases →
 * everyday spending (the daily average) → end balance → weather.
 *
 * Weather is measured against the user's safety line S:
 *   sunny  end ≥ 2·S  (or ≥ S + 7 days of everyday spending, whichever is higher)
 *   cloudy S ≤ end < sunny line
 *   rain   0 ≤ end < S
 *   storm  end < 0  (an overdraft or a declined payment is likely)
 */
import { addDays, diffDays, step, parts } from "./dates";
import type { Day, Flow, Forecast, ForecastInput, Recurring, Weather } from "./types";

export const HORIZON = 30;
export const WARN_DAYS = 7;

export function sunnyLine(safety: number, daily: number): number {
  return Math.max(2 * safety, safety + 7 * daily);
}

export function weatherOf(end: number, safety: number, daily: number): Weather {
  if (end < 0) return "storm";
  if (end < safety) return "rain";
  if (end < sunnyLine(safety, daily)) return "cloudy";
  return "sunny";
}

/** Dates an item lands on within [from, from + days). */
export function occurrences(item: Recurring, from: string, days: number): string[] {
  const end = addDays(from, days);
  const anchor = parts(item.next)[2];
  const out: string[] = [];
  let d = item.next;
  let guard = 0;
  while (d < end && guard++ < 400) {
    if (d >= from) out.push(d);
    d = step(d, item.cadence, anchor);
  }
  return out;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function forecast(input: ForecastInput): Forecast {
  const n = input.days ?? HORIZON;
  const flowsByDate = new Map<string, Flow[]>();
  const add = (d: string, f: Flow) => flowsByDate.set(d, [...(flowsByDate.get(d) ?? []), f]);

  for (const it of input.items) {
    if (!it.on || it.cancelled) continue;
    for (const d of occurrences(it, input.today, n)) add(d, { label: it.name, amount: it.amount, kind: it.kind, ref: it.id });
  }
  for (const x of input.extras ?? []) {
    const k = diffDays(input.today, x.date);
    if (k >= 0 && k < n) add(x.date, { label: x.label, amount: -Math.abs(x.amount), kind: "extra", ref: x.id });
  }
  for (const x of input.saves ?? []) {
    const k = diffDays(input.today, x.date);
    if (k >= 0 && k < n) add(x.date, { label: "save", amount: -Math.abs(x.amount), kind: "save", ref: x.id });
  }

  const days: Day[] = [];
  let bal = input.balance;
  for (let i = 0; i < n; i++) {
    const date = addDays(input.today, i);
    const flows = [...(flowsByDate.get(date) ?? [])].sort((a, b) => b.amount - a.amount);
    const actual = input.actuals?.[date];
    if (actual !== undefined) flows.push({ label: "actual", amount: -Math.abs(actual), kind: "actual" });
    else if (input.daily > 0) flows.push({ label: "daily", amount: -input.daily, kind: "daily" });
    const start = r2(bal);
    bal = r2(bal + flows.reduce((s, f) => s + f.amount, 0));
    days.push({ date, start, flows, end: bal, weather: weatherOf(bal, input.safety, input.daily) });
  }

  let warning: Forecast["warning"] = null;
  const badAt = days.slice(0, WARN_DAYS).findIndex((d) => d.weather === "rain" || d.weather === "storm");
  if (badAt >= 0) {
    const bad = days[badAt];
    // The culprit is the biggest single outflow from today up to that day.
    const cause = days
      .slice(0, badAt + 1)
      .flatMap((d) => d.flows.filter((f) => f.kind !== "daily" && f.kind !== "actual" && f.kind !== "save" && f.amount < 0).map((f) => ({ ...f, date: d.date })))
      .sort((a, b) => a.amount - b.amount)[0];
    warning = {
      date: bad.date,
      weather: bad.weather as "rain" | "storm",
      cause,
      short: r2(bad.weather === "storm" ? -bad.end : input.safety - bad.end),
    };
  }
  return { days, warning };
}

/** Days whose weather differs between two forecasts, for "this purchase turns Thursday rainy". */
export function changed(a: Forecast, b: Forecast): { date: string; from: Weather; to: Weather }[] {
  return b.days
    .map((d, i) => ({ date: d.date, from: a.days[i]?.weather, to: d.weather }))
    .filter((x) => x.from && x.from !== x.to) as { date: string; from: Weather; to: Weather }[];
}

/** Lowest point in the window, used for the "lowest" figure in a day's detail. */
export function lowest(f: Forecast): { date: string; end: number } {
  return f.days.reduce((m, d) => (d.end < m.end ? { date: d.date, end: d.end } : m), { date: f.days[0]?.date ?? "", end: Infinity });
}

/** A sensible starting safety line: one week of everyday spending, rounded up to C$50, at least C$100. */
export function defaultSafety(daily: number): number {
  return Math.max(100, Math.ceil((daily * 7) / 50) * 50);
}

/**
 * Run of dry days (no rain, no storm) ending on the last day of history, reconstructed
 * from the balance today and the transactions. Returns the first dry day, or null.
 */
export function dryFrom(txns: { date: string; amount: number }[], balanceNow: number, safety: number, lastDate: string): string | null {
  if (!txns.length) return null;
  const byDate = new Map<string, number>();
  for (const t of txns) byDate.set(t.date, (byDate.get(t.date) ?? 0) + t.amount);
  let bal = balanceNow; // end of lastDate
  let d = lastDate;
  let first: string | null = null;
  const start = txns[0].date;
  while (d >= start) {
    if (bal < safety) break;
    first = d;
    bal -= byDate.get(d) ?? 0; // end of previous day
    d = addDays(d, -1);
  }
  return first;
}
