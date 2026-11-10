/** Language and formatting. Two languages, one helper: t("English", "中文"). */
import type { Cadence, ISODate, Kind, Weather } from "./types";

export type Lang = "en" | "zh";
export const tr = (lang: Lang) => (en: string, zh: string) => (lang === "zh" ? zh : en);

const LANG_KEY = "cashcast.lang";

export function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "en" || saved === "zh") return saved;
  } catch {
    /* fall through */
  }
  return typeof navigator !== "undefined" && /^zh/i.test(navigator.language) ? "zh" : "en";
}

export function saveLang(l: Lang) {
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    /* not saved; still switches for this visit */
  }
}

/** C$1,234 or C$1,234.56. Negative shows as −C$12. */
export function cad(x: number, cents = false): string {
  const s = Math.abs(x).toLocaleString("en-CA", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return `${x < 0 ? "−" : ""}C$${s}`;
}

const utc = (d: ISODate) => new Date(`${d}T12:00:00Z`);

export function dayName(d: ISODate, lang: Lang, today?: ISODate): string {
  if (today && d === today) return lang === "zh" ? "今天" : "Today";
  return utc(d).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-CA", { weekday: "short", timeZone: "UTC" });
}

export function dateLong(d: ISODate, lang: Lang): string {
  return utc(d).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export function dom(d: ISODate): number {
  return Number(d.slice(8, 10));
}

export const WEATHER: Record<Weather, [string, string]> = {
  sunny: ["Sunny", "晴"],
  cloudy: ["Cloudy", "多云"],
  rain: ["Rain", "雨"],
  storm: ["Storm", "暴雨"],
};

export const KIND: Record<Kind, [string, string]> = {
  income: ["Pay", "收入"],
  bill: ["Bills", "固定支出"],
  sub: ["Subscriptions", "订阅"],
};

export const CADENCE: Record<Cadence, [string, string]> = {
  weekly: ["Weekly", "每周"],
  biweekly: ["Every 2 weeks", "每两周"],
  monthly: ["Monthly", "每月"],
  yearly: ["Yearly", "每年"],
};

export const PER_YEAR: Record<Cadence, number> = { weekly: 52, biweekly: 26, monthly: 12, yearly: 1 };

/** Official help-centre roots for common subscriptions. We only link; we never act. */
const HELP: [RegExp, string][] = [
  [/netflix/i, "https://help.netflix.com/"],
  [/spotify/i, "https://support.spotify.com/"],
  [/apple|itunes|icloud/i, "https://support.apple.com/billing"],
  [/disney/i, "https://help.disneyplus.com/"],
  [/youtube/i, "https://support.google.com/youtube/"],
  [/google/i, "https://support.google.com/googleplay/"],
  [/amazon|prime/i, "https://www.amazon.ca/gp/help/customer/display.html"],
  [/crave/i, "https://www.crave.ca/en/faq"],
  [/adobe/i, "https://helpx.adobe.com/"],
  [/microsoft|xbox/i, "https://support.microsoft.com/"],
  [/playstation/i, "https://www.playstation.com/support/"],
  [/goodlife/i, "https://www.goodlifefitness.com/"],
  [/openai|chatgpt/i, "https://help.openai.com/"],
  [/duolingo/i, "https://support.duolingo.com/"],
  [/audible/i, "https://www.audible.ca/help"],
  [/dropbox/i, "https://help.dropbox.com/"],
];

export function helpLink(name: string): string | null {
  return HELP.find(([re]) => re.test(name))?.[1] ?? null;
}
