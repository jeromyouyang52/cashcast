/**
 * Bank CSV → Txn[]. Runs entirely in the browser; nothing is uploaded.
 *
 * Strategy: decode bytes (UTF-8, then GB18030, then Windows-1252), split into rows,
 * find a header row if there is one, then map columns by name (header) or by shape
 * (headerless files such as TD and CIBC). Columns that look like account or card
 * numbers are dropped before anything else sees them.
 *
 * To support a new bank: add a fixture in tests/fixtures/<bank>.csv and an entry in
 * BANKS below. Most banks need no code: the generic detector already maps them; the
 * BANKS entry only names the format and pins any unusual sign convention.
 */
import { iso } from "./dates";
import type { Txn } from "./types";

// ---------- decoding ----------

export function decode(bytes: Uint8Array): string {
  const tries = ["utf-8", "gb18030", "windows-1252"];
  for (const enc of tries) {
    try {
      return new TextDecoder(enc, { fatal: enc !== "windows-1252" }).decode(bytes).replace(/^﻿/, "");
    } catch {
      /* try the next encoding */
    }
  }
  return new TextDecoder().decode(bytes);
}

// ---------- tokenizing (RFC 4180, plus ; and tab) ----------

export function sniffDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 10).join("\n");
  const count = (c: string) => sample.split(c).length;
  return [",", ";", "\t"].sort((a, b) => count(b) - count(a))[0];
}

export function rows(text: string, delim = sniffDelimiter(text)): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out.map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x !== ""));
}

// ---------- values ----------

/** "$1,234.50", "(12.00)", "-12", "1 234,50", "12.00 CR" → number. NaN when not money. */
export function money(raw: string): number {
  let s = raw.replace(/[\s ]/g, "").replace(/(CAD|USD|C\$|\$|¥|￥|元)/gi, "");
  if (!s) return NaN;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (/CR$/i.test(s)) s = s.slice(0, -2);
  else if (/DR$/i.test(s)) {
    sign = -sign;
    s = s.slice(0, -2);
  }
  if (s.endsWith("-")) {
    sign = -sign;
    s = s.slice(0, -1);
  }
  // European decimal comma: "1.234,56" or "12,50"
  if (/^-?\d{1,3}(\.\d{3})*,\d{1,2}$/.test(s) || /^-?\d+,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^[-+]?\d*\.?\d+$/.test(s)) return NaN;
  return sign * Number(s);
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  janv: 1, févr: 2, fevr: 2, mars: 3, avr: 4, mai: 5, juin: 6, juil: 7, août: 8, aout: 8, déc: 12,
};

export type DateOrder = "ymd" | "mdy" | "dmy";

/** Parse one date given the column's order. Returns null when it is not a date. */
export function parseDate(raw: string, order: DateOrder = "mdy"): string | null {
  const s = raw.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s?[AP]M)?$/i, "");
  let m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return order === "dmy" ? valid(y, +m[2], +m[1]) : valid(y, +m[1], +m[2]);
  }
  m = s.match(/^([A-Za-zéû]{3,5})\.?\s+(\d{1,2}),?\s+(\d{4})$/); // Nov 3, 2026
  if (m && MONTHS[m[1].toLowerCase()]) return valid(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  m = s.match(/^(\d{1,2})[\s-]([A-Za-zéû]{3,5})\.?[\s-](\d{4})$/); // 03 Nov 2026, 03-Nov-2026
  if (m && MONTHS[m[2].toLowerCase()]) return valid(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
}

function valid(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return iso(y, m, d);
}

/** Decide day/month order for a whole column: any first part > 12 means D/M/Y. */
export function dateOrder(values: string[]): DateOrder {
  let dmy = false;
  let mdy = false;
  for (const v of values) {
    const m = v.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (!m) continue;
    if (+m[1] > 12) dmy = true;
    if (+m[2] > 12) mdy = true;
  }
  return dmy && !mdy ? "dmy" : "mdy";
}

// ---------- column mapping ----------

/** Which column holds what. Indexes into the row; -1 = absent. */
export interface Mapping {
  date: number;
  desc: number[];
  /** One signed amount column … */
  amount: number;
  /** … or separate money-out / money-in columns. */
  out: number;
  in: number;
  balance: number;
  /** A Debit/Credit column that carries the sign when every amount is positive (some Scotiabank exports). */
  sign: number;
  /** Flip the sign of `amount` (credit-card exports where purchases are positive). */
  flip: boolean;
  /** Index of the first data row. */
  start: number;
  order: DateOrder;
}

const H = {
  skip: /account|acct|card|number|no\.|#|账号|卡号|帐号|filter|status|cheque|check|type of transaction|^type$|currency|币种/i,
  date: /date|posted|日期|时间|交易日/i,
  desc: /desc|detail|name|payee|merchant|memo|narrative|particular|说明|摘要|对方|商户|备注|交易描述|^transaction$/i,
  out: /debit|withdraw|funds out|money out|paid out|spent|支出|借方|charges?$/i,
  in: /credit|deposit|funds in|money in|paid in|received|收入|贷方|payments?$/i,
  amount: /amount|cad\$?|^cad|金额|value/i,
  balance: /balance|余额/i,
};

const DESC_RANK = (h: string) =>
  /name|payee|merchant|对方|商户/i.test(h) ? 0 : /desc|detail|narrative|说明|摘要|交易描述/i.test(h) ? 1 : /memo|备注/i.test(h) ? 2 : 3;

function headerRow(table: string[][]): number {
  for (let i = 0; i < Math.min(table.length - 1, 15); i++) {
    const r = table[i];
    const texty = r.filter((c) => c && isNaN(money(c)) && !parseDate(c)).length;
    const next = table[i + 1];
    const nextHasDate = next.some((c) => parseDate(c, "mdy") || parseDate(c, "dmy"));
    if (texty >= 2 && texty >= r.filter(Boolean).length * 0.6 && nextHasDate && r.some((c) => H.date.test(c))) return i;
  }
  return -1;
}

export function detect(table: string[][]): Mapping | null {
  const hi = headerRow(table);
  return hi >= 0 ? byHeader(table, hi) : byShape(table);
}

function byHeader(table: string[][], hi: number): Mapping | null {
  const head = table[hi].map((h) => h.replace(/^"|"$/g, "").trim());
  const used = new Set<number>();
  const pick = (re: RegExp, avoid?: RegExp) => {
    const i = head.findIndex((h, j) => !used.has(j) && re.test(h) && !(avoid && avoid.test(h)));
    if (i >= 0) used.add(i);
    return i;
  };
  // Prefer the transaction date over the posting date when both exist.
  let date = head.findIndex((h) => /transaction date|trans\.? date|交易日/i.test(h));
  if (date < 0) date = pick(H.date);
  else used.add(date);
  // Drop identifier columns before anything else can claim them.
  head.forEach((h, j) => {
    if (j !== date && H.skip.test(h) && !H.amount.test(h) && !H.desc.test(h.replace(/number/i, ""))) used.add(j);
    if (/account|acct|card|卡号|账号|帐号/i.test(h) && !/desc/i.test(h)) used.add(j);
  });
  const balance = pick(H.balance);
  const out = pick(H.out, /card/i);
  const inn = pick(H.in, /card/i);
  let amount = -1;
  if (out < 0 || inn < 0) {
    if (out >= 0) used.delete(out);
    if (inn >= 0) used.delete(inn);
    amount = pick(H.amount);
  }
  const desc = head
    .map((h, j) => ({ h, j }))
    .filter(({ h, j }) => !used.has(j) && H.desc.test(h))
    .sort((a, b) => DESC_RANK(a.h) - DESC_RANK(b.h))
    .filter((x, k, all) => DESC_RANK(x.h) < 3 || DESC_RANK(all[0].h) === 3)
    .slice(0, 2)
    .map(({ j }) => j);
  if (date < 0 || (amount < 0 && (out < 0 || inn < 0))) return null;
  const data = table.slice(hi + 1);
  const m: Mapping = {
    date,
    desc,
    amount,
    out: amount >= 0 ? -1 : out,
    in: amount >= 0 ? -1 : inn,
    balance,
    sign: -1,
    flip: false,
    start: hi + 1,
    order: dateOrder(data.map((r) => r[date] ?? "")),
  };
  if (amount >= 0 && data.every((r) => !(money(r[amount] ?? "") < 0))) m.sign = signColumn(data, head.length);
  // A single amount column where purchases are positive and payments negative is a credit-card export.
  if (amount >= 0) m.flip = looksLikeCardSign(data, m);
  return m;
}

/** Headerless files: decide by what the values look like. */
function byShape(table: string[][]): Mapping | null {
  const data = table.filter((r) => r.some((c) => parseDate(c, "mdy") || parseDate(c, "dmy")));
  if (data.length < 2) return null;
  const width = Math.max(...data.map((r) => r.length));
  const share = (j: number, f: (c: string) => boolean) => data.filter((r) => f(r[j] ?? "")).length / data.length;
  const isDate = (c: string) => !!(parseDate(c, "mdy") || parseDate(c, "dmy"));
  const isNum = (c: string) => c !== "" && !isNaN(money(c));
  const isBlank = (c: string) => c === "";
  let date = -1;
  for (let j = 0; j < width; j++) if (share(j, isDate) > 0.9) {
    date = j;
    break;
  }
  if (date < 0) return null;
  const numeric: number[] = [];
  const text: number[] = [];
  for (let j = 0; j < width; j++) {
    if (j === date) continue;
    const num = share(j, isNum);
    const blank = share(j, isBlank);
    if (num > 0 && num + blank > 0.95) numeric.push(j);
    else if (share(j, (c) => /[A-Za-z一-鿿]/.test(c)) > 0.5) text.push(j);
  }
  // A text column that is mostly long digit runs or masked card numbers is an identifier: drop it.
  const ids = text.filter((j) => share(j, (c) => /^[\d*Xx\s-]{8,}$/.test(c)) > 0.5);
  const desc = text.filter((j) => !ids.includes(j)).sort((a, b) => avgLen(data, b) - avgLen(data, a)).slice(0, 2);
  const numCols = numeric.filter((j) => share(j, (c) => /^\d{12,}$/.test(c.replace(/\s/g, ""))) < 0.5);
  let m: Mapping;
  // Debit and credit columns take turns: exactly one of the two is filled on each row.
  const turns = (a: number, b: number) => data.filter((r) => isBlank(r[a] ?? "") !== isBlank(r[b] ?? "")).length / data.length > 0.9;
  if (numCols.length >= 2 && turns(numCols[0], numCols[1])) {
    // TD / CIBC style: date, description, debit, credit[, balance]
    m = { date, desc, amount: -1, out: numCols[0], in: numCols[1], balance: numCols[2] ?? -1, sign: -1, flip: false, start: 0, order: "mdy" };
  } else if (numCols.length >= 1) {
    m = { date, desc, amount: numCols[0], out: -1, in: -1, balance: numCols[1] ?? -1, sign: -1, flip: false, start: 0, order: "mdy" };
    m.flip = looksLikeCardSign(data, m);
  } else return null;
  m.order = dateOrder(data.map((r) => r[date] ?? ""));
  return m;
}

const DR = /^(debit|dr|withdrawal|retrait|débit|支出)$/i;
const CR = /^(credit|cr|deposit|dépôt|crédit|收入)$/i;

function signColumn(data: string[][], width: number): number {
  for (let j = 0; j < width; j++) {
    const v = data.map((r) => r[j] ?? "");
    if (v.filter((c) => DR.test(c) || CR.test(c)).length / v.length > 0.9) return j;
  }
  return -1;
}

function avgLen(data: string[][], j: number) {
  return data.reduce((s, r) => s + (r[j]?.length ?? 0), 0) / data.length;
}

function looksLikeCardSign(data: string[][], m: Mapping): boolean {
  const vals = data.map((r) => money(r[m.amount] ?? "")).filter((x) => !isNaN(x) && x !== 0);
  if (vals.length < 4) return false;
  const pos = vals.filter((x) => x > 0).length / vals.length;
  const negDescs = data.filter((r) => money(r[m.amount] ?? "") < 0).map((r) => m.desc.map((j) => r[j]).join(" "));
  const negArePayments = negDescs.length > 0 && negDescs.filter((d) => /payment|paiement|thank you|merci|还款/i.test(d)).length / negDescs.length > 0.5;
  return pos > 0.8 && negArePayments;
}

// ---------- rows → transactions ----------

export function toTxns(table: string[][], m: Mapping): Txn[] {
  const out: Txn[] = [];
  for (const r of table.slice(m.start)) {
    const date = parseDate(r[m.date] ?? "", m.order);
    if (!date) continue;
    let amount: number;
    if (m.amount >= 0) {
      amount = money(r[m.amount] ?? "");
      if (m.flip) amount = -amount;
      if (m.sign >= 0 && DR.test(r[m.sign] ?? "")) amount = -Math.abs(amount);
    } else {
      const o = money(r[m.out] ?? "");
      const i = money(r[m.in] ?? "");
      amount = (isNaN(i) ? 0 : Math.abs(i)) - (isNaN(o) ? 0 : Math.abs(o));
      if (isNaN(o) && isNaN(i)) amount = NaN;
    }
    if (isNaN(amount) || amount === 0) continue;
    const desc = m.desc.map((j) => r[j] ?? "").filter(Boolean).join(" · ").replace(/\s+/g, " ").trim() || "—";
    const bal = m.balance >= 0 ? money(r[m.balance] ?? "") : NaN;
    out.push({ date, desc: scrub(desc), amount: Math.round(amount * 100) / 100, ...(isNaN(bal) ? {} : { balance: bal }) });
  }
  return out;
}

/** Remove anything shaped like an account or card number that slipped into a description. */
export function scrub(s: string): string {
  return s.replace(/\b(?:\d[ -]?){9,19}\b/g, "•••").replace(/[*Xx]{4,}\d{2,4}/g, "•••");
}

// ---------- bank formats ----------

export interface Bank {
  id: string;
  name: string;
  /** Matches the header row (or, for headerless files, the first data row). */
  test: (firstRows: string[][]) => boolean;
}

const headerHas = (rs: string[][], ...words: RegExp[]) => rs.slice(0, 15).some((r) => words.every((w) => r.some((c) => w.test(c))));

/**
 * Known layouts, checked in order. The generic detector does the mapping; these
 * only put a name on it. Layouts come from each bank's own export and are
 * re-checked against real files when users report a mismatch.
 */
export const BANKS: Bank[] = [
  { id: "rbc", name: "RBC", test: (r) => headerHas(r, /^account type$/i, /^description 1$/i, /^cad\$$/i) },
  { id: "bmo", name: "BMO", test: (r) => headerHas(r, /first bank card|^item #$/i, /transaction type/i, /date posted/i) },
  { id: "tangerine", name: "Tangerine", test: (r) => headerHas(r, /^transaction date$/i, /^transaction$/i, /^name$/i, /^memo$/i) },
  { id: "scotiabank", name: "Scotiabank", test: (r) => headerHas(r, /^filter$/i, /^sub-description$/i) },
  { id: "simplii", name: "Simplii", test: (r) => headerHas(r, /^transaction details$/i, /^funds out$/i, /^funds in$/i) },
  { id: "eq", name: "EQ Bank", test: (r) => headerHas(r, /^transfer date$/i, /^description$/i, /^amount$/i, /^balance$/i) },
  { id: "wealthsimple", name: "Wealthsimple", test: (r) => headerHas(r, /^date$/i, /^transaction$/i, /^description$/i, /^amount$/i, /^balance$/i) },
  { id: "cibc", name: "CIBC", test: (r) => !!r[0] && /^\d{4}-\d{2}-\d{2}$/.test(r[0][0] ?? "") && r[0].length >= 4 && r[0].length <= 5 },
  { id: "td", name: "TD", test: (r) => !!r[0] && /^\d{2}\/\d{2}\/\d{4}$/.test(r[0][0] ?? "") && r[0].length >= 4 && r[0].length <= 5 },
];

export interface ParseResult {
  txns: Txn[];
  bank: string | null;
  mapping: Mapping | null;
  table: string[][];
}

/** Oldest first; same-day rows keep the file's order. */
export function sorted(txns: Txn[]): Txn[] {
  return [...txns].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** The one entry point the UI needs. */
export function parseCSV(input: string | Uint8Array, mapping?: Mapping): ParseResult {
  const text = typeof input === "string" ? input.replace(/^﻿/, "") : decode(input);
  const table = rows(text);
  const m = mapping ?? detect(table);
  const bank = BANKS.find((b) => b.test(table))?.name ?? null;
  const txns = m ? sorted(toTxns(table, m)) : [];
  return { txns, bank, mapping: m, table };
}

/** Latest balance in the file, if the bank provides a balance column. */
export function lastBalance(txns: Txn[]): number | null {
  const withBal = txns.filter((t) => t.balance !== undefined);
  if (!withBal.length) return null;
  const lastDate = withBal[withBal.length - 1].date;
  const sameDay = withBal.filter((t) => t.date === lastDate);
  // Banks list same-day rows in either order; the end-of-day balance is the one that
  // equals another row's balance plus this row's amount, or simply the last listed.
  const last = sameDay.filter((t) => !sameDay.some((n) => n !== t && Math.abs(t.balance! + n.amount - n.balance!) < 0.01));
  return (last[0] ?? sameDay[sameDay.length - 1]).balance!;
}
