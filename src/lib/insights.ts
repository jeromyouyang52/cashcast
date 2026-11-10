/**
 * Things in a bank file worth mentioning once, computed at import (the raw rows are not kept):
 *   hike      a bill or subscription whose latest charge is higher than the one before
 *   new       a merchant never seen before, recently, at > 3× a typical purchase
 *   category  the last 30 days of a spending category ran 30%+ (and C$40+) above its usual 30 days
 */
import { addDays, diffDays } from "./dates";
import { merchantKey, prettyName } from "./detect";
import { PER_YEAR } from "./ui";
import type { Note, Recurring, Txn } from "./types";

export type Category = "takeout" | "dining" | "transport" | "shopping" | "fun" | "groceries" | "other";

const CATS: [Category, RegExp][] = [
  ["takeout", /DELIVERY|UBER ?EATS|DOORDASH|SKIP ?THE ?DISHES|FANTUAN|饭团|外卖|美团|饿了么/i],
  ["groceries", /GROCER|FRESHMART|LOBLAW|NO ?FRILLS|METRO|SOBEYS|FOOD ?BASICS|T&T|WALMART|COSTCO|超市/i],
  ["dining", /CAFE|COFFEE|TIM HORTONS|STARBUCKS|RESTAURANT|NOODLE|SUSHI|PIZZA|BAR |GRILL|KITCHEN|餐/i],
  ["transport", /TRANSIT|PRESTO|UBER(?! ?EATS)|LYFT|GAS|SHELL|ESSO|PETRO|PARKING|TTC|STM|COMPASS|交通|地铁/i],
  ["fun", /CINEMA|CINEPLEX|TICKET|STEAM|GAME|CONCERT|BOOK|游戏|电影/i],
  ["shopping", /AMAZON|BEST ?BUY|ELECTRONIC|TECHHUB|SHOP|STORE|MALL|ZARA|UNIQLO|H&M|SHEIN|TEMU|购物|淘宝/i],
];

export function categoryOf(desc: string): Category {
  return CATS.find(([, re]) => re.test(desc))?.[0] ?? "other";
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};

const r2 = (x: number) => Math.round(x * 100) / 100;

export function insights(txns: Txn[], items: Recurring[]): Note[] {
  if (!txns.length) return [];
  const notes: Note[] = [];
  const to = txns[txns.length - 1].date;
  const from = txns[0].date;

  // Price changes on recurring items.
  for (const it of items) {
    if (it.kind === "income" || it.prev === undefined || Math.abs(it.amount) <= Math.abs(it.prev)) continue;
    const diff = Math.abs(it.amount) - Math.abs(it.prev);
    notes.push({
      id: `hike:${it.id}:${Math.abs(it.amount)}`,
      kind: "hike",
      name: it.name,
      date: to,
      amount: Math.abs(it.amount),
      before: Math.abs(it.prev),
      perYear: r2(diff * PER_YEAR[it.cadence]),
    });
  }

  // A merchant seen for the first time in the last 14 days, at a size worth a second look.
  const outs = txns.filter((t) => t.amount < 0);
  const typical = median(outs.map((t) => -t.amount));
  const firstSeen = new Map<string, Txn>();
  const count = new Map<string, number>();
  for (const t of outs) {
    const k = merchantKey(t.desc);
    if (!firstSeen.has(k)) firstSeen.set(k, t);
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  const recurringKeys = new Set(items.map((i) => merchantKey(i.name)));
  for (const [k, t] of firstSeen) {
    if (count.get(k) !== 1 || recurringKeys.has(k)) continue;
    if (diffDays(t.date, to) > 14 || diffDays(from, t.date) < 30) continue;
    if (-t.amount < Math.max(3 * typical, 50)) continue;
    notes.push({ id: `new:${k}:${t.date}:${-t.amount}`, kind: "new", name: prettyName(k), date: t.date, amount: -t.amount });
  }

  // Categories running hot: last 30 days vs. the average of earlier 30-day windows.
  if (diffDays(from, to) >= 59) {
    const recurringTxn = (t: Txn) => recurringKeys.has(merchantKey(t.desc));
    const windows = Math.min(3, Math.floor((diffDays(from, to) + 1) / 30) - 1);
    const sum = (cat: Category, endIncl: string) => {
      const start = addDays(endIncl, -29);
      return outs.filter((t) => !recurringTxn(t) && t.date >= start && t.date <= endIncl && categoryOf(t.desc) === cat).reduce((s, t) => s - t.amount, 0);
    };
    for (const [cat] of CATS) {
      const now = sum(cat, to);
      let past = 0;
      for (let w = 1; w <= windows; w++) past += sum(cat, addDays(to, -30 * w));
      const usual = past / windows;
      if (usual > 0 && now >= usual * 1.3 && now - usual >= 40) {
        notes.push({ id: `category:${cat}:${to}`, kind: "category", name: cat, date: to, amount: r2(now), before: r2(usual) });
      }
    }
  }
  return notes;
}
