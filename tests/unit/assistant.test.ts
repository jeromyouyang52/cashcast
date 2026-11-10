import { describe, expect, test } from "vitest";
import { parseCSV } from "@/lib/csv";
import { addDays } from "@/lib/dates";
import { allowance, balanceAt, effectiveDaily, fromTxns, nextPayday, project, reminders, savingsPlan, emptyExtras } from "@/lib/model";
import { sampleCSV } from "@/lib/sample";
import { validate } from "@/lib/store";
import type { Recurring, State } from "@/lib/types";
import { brief, card } from "@/lib/voice";
import { tr } from "@/lib/ui";

const T = "2026-11-09";
const item = (p: Partial<Recurring>): Recurring => ({ id: "x", name: "X", amount: -10, kind: "bill", cadence: "monthly", next: "2026-11-12", confidence: 1, on: true, seen: 3, ...p });
const base = (p: Partial<State> = {}): State => ({
  v: 2, balance: 1000, safety: 200, daily: 20, extras: [], dryFrom: null, source: "manual", asOf: T, ...emptyExtras(),
  items: [item({ id: "pay", name: "Pay", amount: 1500, kind: "income", cadence: "biweekly", next: "2026-11-14" }), item({ id: "rent", name: "Rent", amount: -500, next: "2026-11-11" })],
  ...p,
});

describe("today's allowance", () => {
  test("spreads what's free until payday over the days left", () => {
    // Start 1000, rent 500 on day 2, safety 200 → 300 free over 5 days (9th..13th) = 60/day.
    const a = allowance(base(), T);
    expect(nextPayday(base(), T)).toBe("2026-11-14");
    expect(a).toMatchObject({ perDay: 60, left: 60, until: "2026-11-14", hasPay: true, shortfall: 0 });
    expect(a.bind.flows.map((f) => f.label)).toContain("Rent");
  });
  test("an early big bill can be the limit", () => {
    // Rent tomorrow: (1000 - 500 - 200) / 2 days = 150, but later days give 300/5 = 60 → 60.
    const a = allowance(base({ items: [...base().items.slice(0, 1), item({ id: "rent", name: "Rent", amount: -900, next: "2026-11-10" })] }), T);
    expect(a.perDay).toBe(0);
    expect(a.shortfall).toBe(100);
    expect(a.postpone).toMatchObject({ label: "Rent", date: "2026-11-10", amount: 900 });
  });
  test("checking in today lowers what's left today, not the per-day number", () => {
    const s = base({ checkins: [{ date: T, spent: 25 }] });
    expect(allowance(s, T)).toMatchObject({ perDay: 60, left: 35, spentToday: 25 });
  });
  test("payday day itself: window runs to the next pay", () => {
    const a = allowance(base(), "2026-11-14");
    expect(a.until).toBe("2026-11-28");
  });
  test("no income: 30-day window", () => {
    const s = base({ items: [item({ id: "rent", amount: -500, next: "2026-11-11" })] });
    expect(allowance(s, T)).toMatchObject({ hasPay: false, until: addDays(T, 30) });
  });
});

describe("check-ins", () => {
  test("blend into everyday spending without jumping", () => {
    const s = base({ checkins: [{ date: T, spent: 90 }] });
    expect(effectiveDaily(s, T)).toBeCloseTo((20 * 14 + 90) / 15, 2);
  });
  test("re-logging a day replaces it", () => {
    const s = base({ checkins: [{ date: T, spent: 90 }, { date: T, spent: 30 }] });
    expect(effectiveDaily(s, T)).toBeCloseTo((20 * 14 + 30) / 15, 2);
  });
  test("move the balance forward: logged days use the real amount", () => {
    const s = base({ checkins: [{ date: T, spent: 5 }] });
    expect(balanceAt(s, "2026-11-10")).toBe(995);
    expect(project(s, "2026-11-10").days[0].start).toBe(995);
  });
});

describe("payday savings", () => {
  test("suggests half of what's free after everything until next pay", () => {
    const p = savingsPlan(base(), "2026-11-14")!;
    // 1000 −500 −5×20 (pre-pay) +1500 −14×20 = 1620 low point… minus safety 200, half, round down to 10
    expect(p.payday).toBe("2026-11-14");
    expect(p.suggest).toBe(Math.floor((p.surplus * 0.5) / 10) * 10);
    expect(p.surplus).toBeGreaterThan(1000);
  });
  test("not again once something was saved this cycle", () => {
    const s = base({ goals: [{ id: "g", name: "Trip", target: 1000 }], saves: [{ id: "s", date: "2026-11-14", amount: 300, goalId: "g" }] });
    expect(savingsPlan(s, "2026-11-14")).toBeNull();
    // and the saving lowers the forecast
    expect(project(s, "2026-11-14").days[0].flows.some((f) => f.kind === "save" && f.amount === -300)).toBe(true);
  });
  test("no suggestion on ordinary days", () => {
    expect(savingsPlan(base(), T)).toBeNull();
  });
});

describe("reminders", () => {
  test("bills within 3 days, swipe-away sticks", () => {
    const r = reminders(base(), T);
    expect(r[0]).toMatchObject({ kind: "bill", name: "Rent", date: "2026-11-11" });
    expect(reminders(base({ dismissed: [r[0].id] }), T).some((x) => x.id === r[0].id)).toBe(false);
  });
  test("payday card comes first", () => {
    expect(reminders(base(), "2026-11-14")[0].kind).toBe("save");
  });
  test("demo file: price hike, unfamiliar charge, takeout running hot", () => {
    const s = fromTxns(parseCSV(sampleCSV(T)).txns, T, "demo");
    const kinds = s.notes.map((n) => `${n.kind}:${n.name}`);
    expect(kinds).toContain("hike:Spotify");
    expect(kinds).toContain("new:Techhub Electronics");
    expect(kinds).toContain("category:takeout");
    const hike = s.notes.find((n) => n.kind === "hike")!;
    expect(hike).toMatchObject({ amount: 12.99, before: 11.99, perYear: 12 });
    expect(s.items.find((i) => i.name === "Spotify")!.amount).toBe(-12.99);
  });
});

describe("voice", () => {
  const t = tr("en");
  test("tight days name the cause and the number", () => {
    const s = fromTxns(parseCSV(sampleCSV(T)).txns, T, "demo");
    const a = allowance(s, T);
    expect(brief(a, null, effectiveDaily(s, T), T, "en", t)).toMatch(/Rent .* under C\$\d+ a day/);
    expect(brief(a, null, effectiveDaily(s, T), T, "zh", tr("zh"))).toMatch(/每天控制在 C\$\d+ 以内/);
  });
  test("no alarm words anywhere", () => {
    const s = fromTxns(parseCSV(sampleCSV(T)).txns, T, "demo");
    const text = reminders(s, T).flatMap((r) => [...card(r, T, "en", t), ...card(r, T, "zh", tr("zh"))]).join(" ");
    expect(text).not.toMatch(/warning|danger|alert|警告|危险/i);
  });
});

describe("migration", () => {
  test("a version-1 file upgrades with empty assistant data", () => {
    const v1 = { v: 1, balance: 500, safety: 100, daily: 10, items: [], extras: [], dryFrom: null, source: "csv", asOf: T };
    expect(validate(v1)).toMatchObject({ v: 2, balance: 500, checkins: [], goals: [], saves: [], savePct: 0.5, notes: [], dismissed: [] });
  });
  test("bad entries are dropped, not trusted", () => {
    const s = validate({ ...base(), checkins: [{ date: "x", spent: 1 }, { date: T, spent: -5 }, { date: T, spent: 12 }] })!;
    expect(s.checkins).toEqual([{ date: T, spent: 12 }]);
  });
});

import { fromAnswers, nextOnDay } from "@/lib/model";
describe("quick setup", () => {
  test("next date on a day of month", () => {
    expect(nextOnDay("2026-11-09", 15)).toBe("2026-11-15");
    expect(nextOnDay("2026-11-09", 1)).toBe("2026-12-01");
    expect(nextOnDay("2026-11-09", 9)).toBe("2026-11-09");
    expect(nextOnDay("2027-01-31", 31)).toBe("2027-01-31");
    expect(nextOnDay("2027-02-01", 31)).toBe("2027-02-28");
  });
  test("four answers are enough for today's number", () => {
    const s = fromAnswers(
      { balance: 1200, weekly: 210, pay: { amount: 1500, next: "2026-11-20", cadence: "biweekly" }, rent: { amount: 900, day: 1 }, bills: [{ key: "phone", name: "Phone", amount: 45, day: 12, kind: "bill" }] },
      "2026-11-09",
    );
    expect(s).toMatchObject({ daily: 30, source: "manual", safety: 250 });
    expect(s.items.map((i) => `${i.name}:${i.amount}:${i.next}`)).toEqual(["Pay:1500:2026-11-20", "Rent:-900:2026-12-01", "Phone:-45:2026-11-12"]);
    // 1200 − 45 (phone) − 250 safety = 905 over 11 days → 82
    expect(allowance(s, "2026-11-09")).toMatchObject({ perDay: 82, until: "2026-11-20" });
  });
});
