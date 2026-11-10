/**
 * Shared types for Cashcast. Everything is plain data so it can be stored, exported
 * and tested without a browser. Dates are local calendar dates as "YYYY-MM-DD".
 * Money is in dollars as a number; positive = money in, negative = money out.
 */

export type ISODate = string;

/** One bank row after parsing. Account numbers and card numbers never reach this shape. */
export interface Txn {
  date: ISODate;
  /** Merchant or payee, the most specific text column available. */
  desc: string;
  /** Signed: + money in, - money out. */
  amount: number;
  /** Running balance after this row, when the bank provides one. */
  balance?: number;
}

export type Cadence = "weekly" | "biweekly" | "monthly" | "yearly";
export type Kind = "income" | "bill" | "sub";

/** A repeating money movement: pay, rent, a phone plan, a subscription. */
export interface Recurring {
  id: string;
  name: string;
  /** Signed like Txn.amount. */
  amount: number;
  kind: Kind;
  cadence: Cadence;
  /** Next date on or after today. */
  next: ISODate;
  /** 0..1. Below CONFIRM_THRESHOLD the item starts switched off and asks to be confirmed. */
  confidence: number;
  /** Included in the forecast. */
  on: boolean;
  /** Marked cancelled in the subscription graveyard. Not in the forecast. */
  cancelled?: boolean;
  /** The amount before the latest charge, when the latest charge differs (a price change). */
  prev?: number;
  /** How many matching rows were found in the CSV (0 for items added by hand). */
  seen: number;
}

/** A purchase the user tried out with "Can I spend?". */
export interface Extra {
  id: string;
  date: ISODate;
  amount: number;
  label: string;
}

export type Weather = "sunny" | "cloudy" | "rain" | "storm";

export interface ForecastInput {
  today: ISODate;
  /** Balance at the start of today. */
  balance: number;
  /** The user's own floor. Weather is measured against it. */
  safety: number;
  /** Average everyday spending per day (positive number). */
  daily: number;
  items: Recurring[];
  extras?: Extra[];
  /** Real spending the user logged, by date. Replaces `daily` on those days. */
  actuals?: Record<ISODate, number>;
  /** Money the user moved to savings, by date. */
  saves?: Save[];
  days?: number;
}

/** One line of "why is this number what it is". */
export interface Flow {
  label: string;
  amount: number;
  kind: Kind | "daily" | "actual" | "extra" | "save";
  ref?: string;
}

export interface Day {
  date: ISODate;
  start: number;
  flows: Flow[];
  end: number;
  weather: Weather;
}

export interface Warning {
  date: ISODate;
  weather: Exclude<Weather, "sunny" | "cloudy">;
  /** The biggest single outflow from today up to that day, the usual culprit. */
  cause?: Flow & { date: ISODate };
  /** How far below the safety line (or below zero for a storm) the day ends. Positive number. */
  short: number;
}

export interface Forecast {
  days: Day[];
  /** First rainy or stormy day within the next 7 days. */
  warning: Warning | null;
}

/** "Today I spent about X." One per date; the latest entry for a date wins. */
export interface CheckIn {
  date: ISODate;
  spent: number;
}

/** A savings goal. Progress is a local record only; no money moves. */
export interface Goal {
  id: string;
  name: string;
  target: number;
  by?: ISODate;
}

/** "I put X aside." Lowers the forecast balance from that date and fills a goal. */
export interface Save {
  id: string;
  date: ISODate;
  amount: number;
  goalId: string;
}

export type NoteKind = "hike" | "new" | "category";

/** Something found in the bank file worth mentioning once. Computed at import. */
export interface Note {
  id: string;
  kind: NoteKind;
  /** Merchant, subscription or category name. */
  name: string;
  date: ISODate;
  amount: number;
  /** hike: old price. category: usual 30-day amount. */
  before?: number;
  /** hike: per-year difference. */
  perYear?: number;
}

/** Everything the app keeps. One object, one localStorage key, one export file. */
export interface State {
  v: 2;
  balance: number;
  safety: number;
  /** Everyday spending per day from the bank file (or as edited). Check-ins blend into it. */
  daily: number;
  items: Recurring[];
  extras: Extra[];
  /** First day of the current run of dry (not rain, not storm) days, from history. */
  dryFrom: ISODate | null;
  source: "demo" | "csv" | "manual";
  /** The date `balance` is true for. The forecast runs from here, so it stays honest days later. */
  asOf: ISODate;
  checkins: CheckIn[];
  goals: Goal[];
  saves: Save[];
  /** Share of a payday surplus suggested for savings, 0..1. */
  savePct: number;
  notes: Note[];
  /** Ids of reminders the user swiped away. */
  dismissed: string[];
}
