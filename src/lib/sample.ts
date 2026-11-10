/**
 * Fictional demo account. Generated relative to today so the forecast always has
 * something to show: rent lands in four days and dips below the safety line, pay
 * arrives four days later. Every name and number here is made up.
 */
import { addDays, parts, daysInMonth, iso } from "./dates";

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EVERYDAY: [string, number, number][] = [
  ["CORNER GROCER #212", 18, 64],
  ["BEAN THERE CAFE", 4.25, 7.5],
  ["CITY TRANSIT FARE", 3.35, 3.35],
  ["NOODLE HOUSE", 14, 26],
  ["FRESHMART 0441", 22, 85],
  ["PHARMA PLUS 19", 8, 32],
  ["DELIVERY APP*ORDER", 21, 39],
  ["BOOK NOOK", 12, 30],
];

function dayOfMonthOn(d: string, dom: number) {
  const [y, m] = parts(d);
  return iso(y, m, Math.min(dom, daysInMonth(y, m)));
}

export function sampleCSV(today: string): string {
  const r = rng(20261108);
  const rentDay = Math.min(28, parts(addDays(today, 4))[2]);
  const rows: [string, string, number][] = [];
  const start = addDays(today, -120);
  for (let i = 0; i < 120; i++) {
    const d = addDays(start, i);
    const dom = parts(d)[2];
    const k = 120 - i; // days before today
    if (k % 14 === 6) rows.push([d, "PAYROLL DEPOSIT MAPLE STUDIO", 1380]);
    if (d === dayOfMonthOn(d, rentDay)) rows.push([d, "RENT · ELM ST PROPERTIES", -1250]);
    if (dom === Math.min(18, daysInMonth(...(parts(d).slice(0, 2) as [number, number])))) rows.push([d, "FREEDOM MOBILE PAP", -45]);
    if (dom === 9) rows.push([d, "NORTHWIND INTERNET", -55]);
    if (dom === 5) rows.push([d, "NETFLIX.COM", -16.49]);
    if (dom === 22) rows.push([d, "SPOTIFY P2C4A8E1", k <= 31 ? -12.99 : -11.99]); // price went up last month
    if (k === 5) rows.push([d, "TECHHUB ELECTRONICS", -189]); // a one-off worth a second look
    if (k <= 30 && k % 3 === 0) rows.push([d, "DELIVERY APP*ORDER", -Math.round((24 + r() * 14) * 100) / 100]); // takeout running hot
    if (dom === 14) rows.push([d, "GOODLIFE FITNESS CLUBS", -29.99]);
    if (dom === 27) rows.push([d, "APPLE.COM/BILL", -3.99]);
    if (dom === 11 && i < 60) rows.push([d, "STREAMBOX PLUS", -12.99]); // stopped two months ago
    const n = r() < 0.15 ? 0 : 1 + Math.floor(r() * 2.2);
    for (let j = 0; j < n; j++) {
      const [name, lo, hi] = EVERYDAY[Math.floor(r() * EVERYDAY.length)];
      rows.push([d, name, -Math.round((lo + r() * (hi - lo)) * 100) / 100]);
    }
  }
  // Pick today's balance so the dip after rent ends a little below the safety line.
  const target = 1790;
  const total = rows.reduce((s, x) => s + x[2], 0);
  let bal = Math.round((target - total) * 100) / 100;
  const lines = ["Date,Description,Amount,Balance"];
  for (const [d, desc, amt] of rows) {
    bal = Math.round((bal + amt) * 100) / 100;
    lines.push(`${d},"${desc}",${amt.toFixed(2)},${bal.toFixed(2)}`);
  }
  return lines.join("\n");
}
