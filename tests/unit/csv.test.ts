import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { lastBalance, money, parseCSV, parseDate, rows, scrub } from "@/lib/csv";
import { detect } from "@/lib/detect";

const fx = (f: string) => new Uint8Array(readFileSync(`tests/fixtures/${f}`));

// Every fixture is the same fictional ledger: 47 rows, net card-account excluded.
const BANKS: [file: string, bank: string | null, count: number, balance: number | null][] = [
  ["rbc.csv", "RBC", 47, null],
  ["td.csv", "TD", 47, 7628.09],
  ["bmo.csv", "BMO", 47, null],
  ["tangerine.csv", "Tangerine", 47, null],
  ["scotiabank.csv", "Scotiabank", 47, 7628.09],
  ["simplii.csv", "Simplii", 47, null],
  ["eq.csv", "EQ Bank", 47, 7628.09],
  ["wealthsimple.csv", "Wealthsimple", 47, 7628.09],
  ["zh-gb18030.csv", null, 47, 7628.09],
];

describe("bank exports", () => {
  for (const [file, bank, count, balance] of BANKS) {
    test(file, () => {
      const r = parseCSV(fx(file));
      expect(r.bank).toBe(bank);
      expect(r.txns).toHaveLength(count);
      // Signs: rent is money out, pay is money in.
      const rent = r.txns.find((t) => /RENT|房租/.test(t.desc))!;
      const pay = r.txns.find((t) => /PAYROLL|工资/.test(t.desc))!;
      expect(rent.amount).toBe(-1250);
      expect(pay.amount).toBe(1380);
      expect(r.txns[0].date).toBe("2026-08-01");
      expect(lastBalance(r.txns)).toBe(balance);
      // No account or card numbers survive parsing.
      expect(JSON.stringify(r.txns)).not.toMatch(/5678901|5191230000001234|6222020000001234567/);
      // Netflix is found as a monthly subscription.
      const d = detect(r.txns, "2026-11-08");
      const nf = d.items.find((i) => /netflix/i.test(i.name))!;
      expect(nf).toMatchObject({ kind: "sub", cadence: "monthly", amount: -16.49, next: "2026-12-05", on: true });
      expect(d.items.find((i) => i.kind === "income")).toMatchObject({ cadence: "biweekly", amount: 1380 });
    });
  }

  test("CIBC credit card: purchases become money out, card number dropped", () => {
    const r = parseCSV(fx("cibc.csv"));
    expect(r.bank).toBe("CIBC");
    expect(r.txns.find((t) => /NETFLIX/.test(t.desc))!.amount).toBe(-16.49);
    expect(r.txns.find((t) => /PAYMENT/.test(t.desc))!.amount).toBe(200);
    expect(JSON.stringify(r.txns)).not.toMatch(/4500|1234/);
  });
});

describe("values", () => {
  test("money", () => {
    expect(money("$1,234.50")).toBe(1234.5);
    expect(money("(12.00)")).toBe(-12);
    expect(money("12.00-")).toBe(-12);
    expect(money("1.234,56")).toBe(1234.56);
    expect(money("-$50.37")).toBe(-50.37);
    expect(money("abc")).toBeNaN();
  });
  test("dates", () => {
    expect(parseDate("2026-11-08")).toBe("2026-11-08");
    expect(parseDate("20261108")).toBe("2026-11-08");
    expect(parseDate("11/8/2026")).toBe("2026-11-08");
    expect(parseDate("8/11/2026", "dmy")).toBe("2026-11-08");
    expect(parseDate("Nov 8, 2026")).toBe("2026-11-08");
    expect(parseDate("08 Nov 2026")).toBe("2026-11-08");
    expect(parseDate("2026年11月8日")).toBe("2026-11-08");
    expect(parseDate("2026-02-30")).toBeNull();
  });
  test("quoted cells with commas and newlines", () => {
    expect(rows('a,"b, c","d ""e"""\n1,2,3')).toEqual([["a", "b, c", 'd "e"'], ["1", "2", "3"]]);
  });
  test("scrub", () => {
    expect(scrub("TFR TO 4500 1234 5678 9012")).not.toMatch(/5678/);
  });
  test("unknown layout returns no mapping instead of guessing", () => {
    expect(parseCSV("hello,world\nfoo,bar").mapping).toBeNull();
  });
});
