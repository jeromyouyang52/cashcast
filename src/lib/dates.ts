import type { Cadence, ISODate } from "./types";

/** Calendar-date helpers in UTC so results never drift with the user's time zone. */

const pad = (n: number) => String(n).padStart(2, "0");

export function iso(y: number, m: number, d: number): ISODate {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parts(d: ISODate): [number, number, number] {
  const [y, m, dd] = d.split("-").map(Number);
  return [y, m, dd];
}

function toUTC(d: ISODate): number {
  const [y, m, dd] = parts(d);
  return Date.UTC(y, m - 1, dd);
}

function fromUTC(t: number): ISODate {
  const x = new Date(t);
  return iso(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromUTC(toUTC(d) + n * 86400000);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Same day of month n months later, clamped (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(d: ISODate, n: number, anchorDay?: number): ISODate {
  const [y, m, dd] = parts(d);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return iso(ny, nm, Math.min(anchorDay ?? dd, daysInMonth(ny, nm)));
}

export function step(d: ISODate, c: Cadence, anchorDay?: number): ISODate {
  switch (c) {
    case "weekly":
      return addDays(d, 7);
    case "biweekly":
      return addDays(d, 14);
    case "monthly":
      return addMonths(d, 1, anchorDay);
    case "yearly":
      return addMonths(d, 12, anchorDay);
  }
}

/** First occurrence on or after `from`, walking forward from a known date. */
export function rollForward(last: ISODate, c: Cadence, from: ISODate): ISODate {
  const anchor = parts(last)[2];
  let d = last;
  let guard = 0;
  while (d < from && guard++ < 2000) d = step(d, c, anchor);
  return d;
}

/** Today in the user's own time zone. */
export function today(): ISODate {
  const x = new Date();
  return iso(x.getFullYear(), x.getMonth() + 1, x.getDate());
}

export function weekday(d: ISODate): number {
  return new Date(toUTC(d)).getUTCDay();
}
