import { describe, expect, test } from "vitest";
import { addMonths, rollForward } from "@/lib/dates";
import { detect, merchantKey } from "@/lib/detect";
import { changed, defaultSafety, dryFrom, forecast, occurrences, weatherOf } from "@/lib/forecast";
import { parseCSV, lastBalance } from "@/lib/csv";
import { sampleCSV } from "@/lib/sample";
import type { Recurring } from "@/lib/types";

const item = (p: Partial<Recurring>): Recurring => ({
  id: "x", name: "X", amount: -10, kind: "bill", cadence: "monthly", next: "2026-11-10", confidence: 1, on: true, seen: 3, ...p,
});

describe("weather thresholds are relative to the safety line", () => {
  test("levels", () => {
    expect(weatherOf(-1, 300, 30)).toBe("storm");
    expect(weatherOf(0, 300, 30)).toBe("rain");
    expect(weatherOf(299, 300, 30)).toBe("rain");
    expect(weatherOf(300, 300, 30)).toBe("cloudy");
    expect(weatherOf(599, 300, 30)).toBe("cloudy");
    expect(weatherOf(600, 300, 30)).toBe("sunny");
    // Same shape at ten times the scale.
    expect(weatherOf(5999, 3000, 300)).toBe("cloudy");
    expect(weatherOf(6000, 3000, 300)).toBe("sunny");
  });
  test("a high daily spend raises the sunny line", () => {
    expect(weatherOf(600, 300, 60)).toBe("cloudy"); // 300 + 7*60 = 720
  });
  test("default safety line is a week of spending, at least 100", () => {
    expect(defaultSafety(0)).toBe(100);
    expect(defaultSafety(33)).toBe(250);
  });
});

describe("dates", () => {
  test("month-end clamps and recovers", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(occurrences(item({ next: "2026-01-31" }), "2026-01-01", 90)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(rollForward("2026-08-05", "monthly", "2026-11-08")).toBe("2026-12-05");
  });
});

describe("engine", () => {
  const base = { today: "2026-11-08", balance: 1000, safety: 200, daily: 10, items: [item({ amount: -900, next: "2026-11-10", name: "Rent" })] };
  test("deterministic and explained", () => {
    const f = forecast(base);
    expect(f.days).toHaveLength(30);
    expect(forecast(base)).toEqual(f);
    const d = f.days[2];
    expect(d.start + d.flows.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(d.end, 2);
    expect(d.flows.map((x) => x.label)).toEqual(["Rent", "daily"]);
    expect(d.end).toBe(70);
    expect(d.weather).toBe("rain");
  });
  test("warning names the culprit and the shortfall", () => {
    const w = forecast(base).warning!;
    expect(w).toMatchObject({ date: "2026-11-10", weather: "rain", short: 130 });
    expect(w.cause).toMatchObject({ label: "Rent", date: "2026-11-10" });
  });
  test("cancelled and switched-off items are left out", () => {
    expect(forecast({ ...base, items: [item({ amount: -900, cancelled: true })] }).warning).toBeNull();
    expect(forecast({ ...base, items: [item({ amount: -900, on: false })] }).warning).toBeNull();
  });
  test("a tried-out purchase shows which days change", () => {
    const a = forecast(base);
    const b = forecast({ ...base, extras: [{ id: "e", date: "2026-11-09", amount: 150, label: "Concert" }] });
    const c = changed(a, b);
    expect(c[0]).toEqual({ date: "2026-11-10", from: "rain", to: "storm" });
    expect(c.some((x) => x.to === "storm")).toBe(true);
  });
  test("dry streak reconstructed from history", () => {
    const tx = [
      { date: "2026-11-01", amount: -500 },
      { date: "2026-11-03", amount: 800 },
      { date: "2026-11-05", amount: -50 },
    ];
    // End of 11-05: 1000. End of 11-04/11-03: 1050. End of 11-02: 250 < 300 → rain.
    expect(dryFrom(tx, 1000, 300, "2026-11-05")).toBe("2026-11-03");
  });
});

describe("recurrence detection", () => {
  test("merchant keys are stable across noisy descriptions", () => {
    expect(merchantKey("SPOTIFY P2C4A8E1")).toBe(merchantKey("SPOTIFY P9Z1Q0X2"));
    expect(merchantKey("NETFLIX.COM 866-579-7172")).toBe("NETFLIX");
    expect(merchantKey("[DN]NETFLIX.COM")).toBe("NETFLIX");
  });
  test("demo account: pay, bills and subscriptions, none of the random shopping", () => {
    const today = "2026-11-08";
    const p = parseCSV(sampleCSV(today));
    const d = detect(p.txns, today);
    expect(d.items.map((i) => `${i.kind}:${i.name}`).sort()).toEqual(
      ["bill:Freedom Mobile", "bill:Northwind", "bill:Rent", "income:Payroll Deposit", "sub:Apple Bill", "sub:Goodlife Fitness", "sub:Netflix", "sub:Spotify"].sort(),
    );
    expect(d.items.every((i) => i.next >= today)).toBe(true);
    expect(d.daily).toBeGreaterThan(25);
    expect(d.daily).toBeLessThan(45);
    // A subscription that stopped two months ago is not forecast.
    expect(d.items.some((i) => /streambox/i.test(i.name))).toBe(false);
    // Demo story: rain after rent within the week, never a storm.
    const f = forecast({ today, balance: lastBalance(p.txns)!, safety: defaultSafety(d.daily), daily: d.daily, items: d.items });
    expect(f.warning?.weather).toBe("rain");
    expect(f.warning?.cause?.label).toBe("Rent");
    expect(f.days.some((x) => x.weather === "storm")).toBe(false);
  });
  test("demo story holds on any day of the year", () => {
    for (let m = 1; m <= 12; m++) {
      for (const dd of [1, 15, 28, 31]) {
        const today = `2026-${String(m).padStart(2, "0")}-${String(Math.min(dd, new Date(2026, m, 0).getDate())).padStart(2, "0")}`;
        const p = parseCSV(sampleCSV(today));
        const d = detect(p.txns, today);
        const f = forecast({ today, balance: lastBalance(p.txns)!, safety: defaultSafety(d.daily), daily: d.daily, items: d.items });
        expect(f.warning, today).not.toBeNull();
      }
    }
  });
});
