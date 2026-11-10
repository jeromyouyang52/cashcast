/**
 * Find pay, bills and subscriptions in a list of transactions.
 *
 * 1. Normalize each description to a merchant key ("NETFLIX.COM 866-579" → "NETFLIX").
 * 2. Group by key and direction, then split each group into amount clusters (±15%).
 * 3. For each cluster with enough rows, look at the gaps between dates. A steady gap of
 *    ~7, ~14, ~30 or ~365 days is a cadence.
 * 4. Confidence = how regular the gaps are, how stable the amount is, and how many times
 *    it was seen. Low-confidence items are returned switched off for the user to confirm.
 * 5. Everything else that leaves the account is everyday spending, averaged per day.
 */
import { addDays, diffDays, rollForward } from "./dates";
import type { Cadence, Kind, Recurring, Txn } from "./types";

export const CONFIRM_THRESHOLD = 0.6;

const NOISE =
  /\b(POS|PURCHASE|PURCH|ACHAT|PREAUTHORIZED|PRE-AUTHORIZED|PRE AUTH|PAP|DEBIT|CREDIT|MEMO|PAYMENT|PMT|BILL PAYMENT|ONLINE|INTERNET|BANKING|TRANSFER|TFR|VISA|MASTERCARD|MC|IDP|INTERAC|E-TRANSFER|RECURRING|INC|LTD|LLC|CORP|CO|CA|CAN|ON|BC|QC|AB|WWW|COM|HTTPS?)\b/g;

/** "SPOTIFY P1A2B3C4 STOCKHOLM" → "SPOTIFY". Stable across months for the same merchant. */
export function merchantKey(desc: string): string {
  const s = desc
    .split(" · ")[0]
    .replace(/^\[[A-Z]{2}\]/, "")
    .toUpperCase()
    .replace(/\.(COM|CA|NET|IO)\b/g, " ")
    .replace(/[^A-Z一-鿿& ]+/g, " ")
    .replace(NOISE, " ")
    .replace(/\b[A-Z]\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = s.split(" ").filter((w) => w.length > 1 || /[一-鿿]/.test(w));
  return words.slice(0, 2).join(" ") || desc.toUpperCase().slice(0, 12);
}

/** Readable name for the confirm list: title case of the key. */
export function prettyName(key: string): string {
  return key.replace(/\w\S*/g, (w) => w[0] + w.slice(1).toLowerCase());
}

const CADENCES: { c: Cadence; days: number; tol: number; min: number }[] = [
  { c: "weekly", days: 7, tol: 1, min: 4 },
  { c: "biweekly", days: 14, tol: 2, min: 3 },
  { c: "monthly", days: 30.44, tol: 4, min: 2 },
  { c: "yearly", days: 365.25, tol: 10, min: 2 },
];

const BILL = /RENT|INTERNET|WIFI|MOBILE|WIRELESS|PHONE|LOYER|MORTGAGE|HYPOTH|HYDRO|ENBRIDGE|FORTIS|UTILIT|INSUR|ASSUR|ROGERS|BELL|TELUS|FIDO|KOODO|VIRGIN|FREEDOM|PUBLIC MOBILE|CHATR|LUCKY|VIDEOTRON|SHAW|COGECO|EASTLINK|SASKTEL|LOAN|PRET|STUDENT|OSAP|NSLSC|CONDO|PROPERTY|TAX|房租|贷款|保险|电费|水费|话费/;
const SUB = /NETFLIX|SPOTIFY|APPLE|ITUNES|DISNEY|PRIME|AMAZON|YOUTUBE|GOOGLE|CRAVE|PARAMOUNT|ADOBE|MICROSOFT|XBOX|PLAYSTATION|NINTENDO|DROPBOX|ICLOUD|OPENAI|CHATGPT|CLAUDE|ANTHROPIC|NOTION|DUOLINGO|AUDIBLE|PATREON|TWITCH|GYM|GOODLIFE|FITNESS|PELOTON|STRAVA|UBER ONE|DASHPASS|PC OPTIMUM|COSTCO|MEMBERSHIP|BILIBILI|IQIYI|爱奇艺|腾讯视频|网易云/;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function clusters(txns: Txn[]): Txn[][] {
  const out: Txn[][] = [];
  for (const t of [...txns].sort((a, b) => Math.abs(a.amount) - Math.abs(b.amount))) {
    const c = out.find((g) => {
      const m = Math.abs(median(g.map((x) => x.amount)));
      return Math.abs(Math.abs(t.amount) - m) <= Math.max(1, m * 0.15);
    });
    if (c) c.push(t);
    else out.push([t]);
  }
  return out.map((g) => g.sort((a, b) => (a.date < b.date ? -1 : 1)));
}

export function kindOf(desc: string, amount: number, cadence: Cadence): Kind {
  if (amount > 0) return "income";
  const d = desc.toUpperCase();
  if (BILL.test(d)) return "bill";
  if (SUB.test(d)) return "sub";
  return Math.abs(amount) < 100 && (cadence === "monthly" || cadence === "yearly") ? "sub" : "bill";
}

export interface Detection {
  items: Recurring[];
  /** Average everyday spending per day, positive. */
  daily: number;
  /** First and last date seen. */
  from: string;
  to: string;
}

export function detect(txns: Txn[], today: string): Detection {
  if (!txns.length) return { items: [], daily: 0, from: today, to: today };
  const from = txns[0].date;
  const to = txns[txns.length - 1].date;
  const span = Math.max(1, diffDays(from, to) + 1);

  const groups = new Map<string, Txn[]>();
  for (const t of txns) {
    const k = `${t.amount > 0 ? "+" : "-"}${merchantKey(t.desc)}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }

  const items: Recurring[] = [];
  const claimed = new Set<Txn>();
  for (const [gk, g] of groups) {
    const key = gk.slice(1);
    for (const c of clusters(g)) {
      const desc = c[0].desc.toUpperCase();
      const hit = cadenceOf(c, span, c[0].amount > 0 ? 0.15 : BILL.test(desc) ? 0.3 : 0.05);
      if (!hit || hit.conf < 0.45) continue;
      // Pay varies, so use the median. Bills and subscriptions: the latest charge is the price going forward.
      const lastAmt = c[c.length - 1].amount;
      const prevAmt = c.length > 1 ? c[c.length - 2].amount : lastAmt;
      const amount = Math.round((lastAmt > 0 ? median(c.map((x) => x.amount)) : lastAmt) * 100) / 100;
      const prev = lastAmt < 0 && Math.abs(lastAmt - prevAmt) >= 0.01 ? prevAmt : undefined;
      const last = c[c.length - 1].date;
      // Skip things that clearly stopped: last seen more than 1.6 cadences before the file ended.
      if (diffDays(last, to) > hit.days * 1.6 + 3) continue;
      c.forEach((x) => claimed.add(x));
      items.push({
        id: `${gk}:${amount}`.replace(/\s+/g, "_"),
        name: prettyName(key),
        amount,
        kind: kindOf(desc, amount, hit.c),
        cadence: hit.c,
        next: rollForward(last, hit.c, addDays(today, 0)),
        confidence: Math.round(hit.conf * 100) / 100,
        on: hit.conf >= CONFIRM_THRESHOLD,
        seen: c.length,
        ...(prev !== undefined ? { prev } : {}),
      });
    }
  }

  // Everyday spending: what's left, over the most recent 90 days, ignoring one-off big tickets.
  const windowFrom = addDays(to, -89) > from ? addDays(to, -89) : from;
  const days = diffDays(windowFrom, to) + 1;
  const rest = txns.filter((t) => t.amount < 0 && !claimed.has(t) && t.date >= windowFrom);
  const cutoff = Math.max(400, 4 * median(rest.map((t) => -t.amount).concat([0])));
  const spent = rest.filter((t) => -t.amount <= cutoff).reduce((s, t) => s - t.amount, 0);
  const daily = Math.round((spent / Math.max(days, 1)) * 100) / 100;

  const order: Record<Kind, number> = { income: 0, bill: 1, sub: 2 };
  items.sort((a, b) => order[a.kind] - order[b.kind] || a.amount - b.amount);
  return { items, daily, from, to };
}

/** `cv` = how much the amount may wobble (coefficient of variation) before confidence drops to zero. */
function cadenceOf(c: Txn[], span: number, cv: number): { c: Cadence; days: number; conf: number } | null {
  if (c.length < 2) return null;
  const gaps = c.slice(1).map((x, i) => diffDays(c[i].date, x.date)).filter((g) => g > 0);
  if (!gaps.length) return null;
  const g = median(gaps);
  const fit = CADENCES.find((k) => Math.abs(g - k.days) <= k.tol);
  if (!fit || c.length < fit.min) return null;
  // Semi-monthly pay (15th and last day) has gaps of 13–17 days; treat as biweekly.
  const regular = gaps.filter((x) => Math.abs(x - fit.days) <= fit.tol + 1).length / gaps.length;
  const amts = c.map((x) => Math.abs(x.amount));
  const mean = amts.reduce((s, x) => s + x, 0) / amts.length;
  const sd = Math.sqrt(amts.reduce((s, x) => s + (x - mean) ** 2, 0) / amts.length);
  const stable = Math.max(0, 1 - sd / mean / cv);
  if (regular < 0.75 || stable < 0.2) return null;
  const expected = Math.max(fit.min, Math.floor(span / fit.days));
  const coverage = Math.min(1, c.length / Math.min(expected, 4));
  const conf = 0.5 * regular + 0.3 * stable + 0.2 * coverage;
  return { c: fit.c, days: fit.days, conf };
}
