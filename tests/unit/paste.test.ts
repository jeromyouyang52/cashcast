import { describe, expect, test } from "vitest";
import { parseLoose, parsePasted } from "@/lib/paste";

describe("pasted bank text", () => {
  test("phone-style list: one field per line", () => {
    const t = parseLoose(`Nov 3, 2026
NETFLIX.COM
-$16.49
Nov 1, 2026
PAYROLL DEPOSIT MAPLE STUDIO
$1,380.00
Nov 1, 2026
RENT ELM ST
-$1,250.00`);
    expect(t).toEqual([
      { date: "2026-11-01", desc: "PAYROLL DEPOSIT MAPLE STUDIO", amount: 1380 },
      { date: "2026-11-01", desc: "RENT ELM ST", amount: -1250 },
      { date: "2026-11-03", desc: "NETFLIX.COM", amount: -16.49 },
    ]);
  });
  test("one line per row with a running balance", () => {
    const t = parseLoose(`2026-11-03  SPOTIFY P2C4  12.99  1,234.56
2026-11-04  CORNER GROCER #212  (45.10)  1,189.46
2026-11-05  E-TRANSFER FROM ALEX  +50.00  1,239.46`);
    expect(t.map((x) => [x.amount, x.balance])).toEqual([[-12.99, 1234.56], [-45.1, 1189.46], [50, 1239.46]]);
  });
  test("date heading with several rows under it", () => {
    const t = parseLoose(`Today, November 3, 2026
Nov 3, 2026
Bean There Cafe    $5.25
City Transit Fare    $3.35`);
    expect(t.map((x) => x.desc)).toEqual(["Bean There Cafe", "City Transit Fare"]);
    expect(t.every((x) => x.amount < 0 && x.date === "2026-11-03")).toBe(true);
  });
  test("a table copied from a desktop browser is tab-separated", () => {
    const t = parsePasted("Date\tDescription\tAmount\n2026-11-01\tRENT\t-1250.00\n2026-11-02\tNETFLIX\t-16.49\n");
    expect(t).toHaveLength(2);
    expect(t[0].amount).toBe(-1250);
  });
  test("card numbers in pasted text are masked", () => {
    const t = parseLoose("Nov 3, 2026\nTFR TO 4500 1234 5678 9012\n-$100.00");
    expect(t[0].desc).not.toMatch(/5678/);
  });
  test("junk gives nothing rather than guesses", () => {
    expect(parseLoose("hello\nworld\n$5")).toEqual([]);
  });
});
