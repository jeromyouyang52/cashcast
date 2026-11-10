/**
 * Text copied from an online-banking page, pasted in. Two shapes are common:
 *   • a table copied from a desktop browser → tab-separated rows (handled by the CSV parser)
 *   • a list copied from a phone or a styled page → loose lines, often one field per line:
 *       Nov 3, 2026
 *       NETFLIX.COM
 *       -$16.49
 * The loose reader walks the lines: a date starts a transaction, text lines become the
 * description, and the first money amount closes it. A trailing balance column is ignored.
 * Signs: an explicit minus, "DR", or parentheses mean money out; a "+", "CR" or an
 * income word mean money in; otherwise a bare amount is treated as money out.
 */
import { money, parseCSV, parseDate, scrub, sorted } from "./csv";
import type { Txn } from "./types";

const IN = /\b(deposit|payroll|pay ?roll|salary|refund|e-?transfer (from|received)|credit|interest|dépôt|工资|收入|存入|退款|转入)\b/i;
const MONEY = /^[-+(]?\s*(C?\$|CAD|¥|￥)?\s*[-+]?\d{1,3}([,\s]\d{3})*(\.\d{1,2})?\s*\)?\s*(CR|DR)?$|^[-+(]?\s*(C?\$|CAD)?\s*[-+]?\d+(\.\d{1,2})?\s*\)?\s*(CR|DR)?$/i;

/** Find a date at the start of a line (tolerates "Nov 3, 2026 · Posted" and "2026-11-03 10:42"). */
function leadingDate(line: string): { date: string; rest: string } | null {
  const words = line.split(/\s+/);
  for (let n = Math.min(4, words.length); n >= 1; n--) {
    const head = words.slice(0, n).join(" ").replace(/[,·|]+$/, "");
    const d = parseDate(head, "mdy");
    if (d) return { date: d, rest: words.slice(n).join(" ").replace(/^[,·|\s]+/, "") };
  }
  return null;
}

/** Money tokens at the end of a line, e.g. "NETFLIX.COM -16.49 1,234.56" → [-16.49, 1234.56]. */
function trailingMoney(line: string): { amounts: { raw: string; value: number }[]; rest: string } {
  const parts = line.split(/\s{2,}|\t|\s(?=[-+(]?(?:C?\$|CAD)?\s?[-+]?\d[\d,]*\.\d{2}\b)/);
  const amounts: { raw: string; value: number }[] = [];
  while (parts.length) {
    const last = parts[parts.length - 1].trim();
    if (!MONEY.test(last) || !/\d/.test(last) || !/[.$]|^\d{1,3}(,\d{3})+$/.test(last)) break;
    amounts.unshift({ raw: last, value: money(last) });
    parts.pop();
  }
  return { amounts, rest: parts.join(" ").trim() };
}

function signed(raw: string, value: number, desc: string): number {
  if (/^\s*-|\(|DR$|-\s*$/i.test(raw)) return -Math.abs(value);
  if (/^\s*\+|CR$/i.test(raw)) return Math.abs(value);
  return IN.test(desc) ? Math.abs(value) : -Math.abs(value);
}

export function parseLoose(text: string): Txn[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/ /g, " ").trim()).filter(Boolean);
  const out: Txn[] = [];
  let cur: { date: string; desc: string[] } | null = null;
  for (const line of lines) {
    const d = leadingDate(line);
    if (d) cur = { date: d.date, desc: [] };
    if (!cur) continue;
    const body = d ? d.rest : line;
    if (!body) continue;
    const { amounts, rest } = trailingMoney(body);
    if (rest) cur.desc.push(rest);
    if (amounts.length) {
      const desc = scrub(cur.desc.join(" · ").replace(/\s+/g, " ").trim()) || "—";
      // When two amounts end a line, the first is the transaction and the second the running balance.
      const a = amounts[0];
      const amount = Math.round(signed(a.raw, a.value, desc) * 100) / 100;
      if (Number.isFinite(amount) && amount !== 0) {
        out.push({ date: cur.date, desc, amount, ...(amounts[1] && Number.isFinite(amounts[1].value) ? { balance: amounts[1].value } : {}) });
      }
      cur = { date: cur.date, desc: [] }; // pages often group several rows under one date heading
    }
  }
  return sorted(out);
}

/** Pasted text → transactions: try it as a table first, then as loose lines. Whichever finds more wins. */
export function parsePasted(text: string): Txn[] {
  const table = parseCSV(text);
  const loose = parseLoose(text);
  return table.txns.length >= loose.length ? table.txns : loose;
}
