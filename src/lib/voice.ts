/**
 * Everything the assistant says, in one place. Short, specific, friendly; numbers and dates,
 * never alarm words. Each function returns [english, chinese] picked by the caller's `t`.
 * To change the tone, edit here; nothing else in the app composes sentences.
 */
import type { Category } from "./insights";
import type { Allowance, Reminder, SavingsPlan } from "./model";
import { diffDays } from "./dates";
import { cad, dateLong, type Lang } from "./ui";

type T = (en: string, zh: string) => string;

const utc = (d: string) => new Date(`${d}T12:00:00Z`);

/** today / tomorrow / Thu / Nov 17, relative to today. */
export function when(date: string, today: string, lang: Lang): string {
  const k = diffDays(today, date);
  if (k === 0) return lang === "zh" ? "今天" : "today";
  if (k === 1) return lang === "zh" ? "明天" : "tomorrow";
  if (k === -1) return lang === "zh" ? "昨天" : "yesterday";
  if (k > 1 && k < 7) return utc(date).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-CA", { weekday: lang === "zh" ? "short" : "long", timeZone: "UTC" });
  return dateLong(date, lang);
}

/** English needs "on" before a weekday or date, not before today/tomorrow. */
function onWhen(date: string, today: string, lang: Lang): string {
  const w = when(date, today, lang);
  return lang === "en" && Math.abs(diffDays(today, date)) > 1 ? `on ${w}` : w;
}

export const CATEGORY: Record<Category, [string, string]> = {
  takeout: ["takeout", "外卖"],
  dining: ["eating out", "餐饮"],
  groceries: ["groceries", "买菜"],
  transport: ["getting around", "交通"],
  shopping: ["shopping", "购物"],
  fun: ["fun", "娱乐"],
  other: ["other spending", "其他"],
};

/** The one or two sentences at the top of the home screen. */
export function brief(a: Allowance, plan: SavingsPlan | null, daily: number, today: string, lang: Lang, t: T): string {
  const payWhen = when(a.until, today, lang);
  if (plan) {
    return t(
      `Payday! Everything until next pay is covered, with ${cad(plan.surplus)} to spare.`,
      `发薪了！到下次发薪的开销都留够了，还多出 ${cad(plan.surplus)}。`,
    );
  }
  if (a.shortfall > 0) {
    if (a.postpone) {
      return t(
        `A tight few days. Moving ${a.postpone.label} (${when(a.postpone.date, today, lang)}) to after payday keeps you above your line.`,
        `这几天有点紧：把 ${a.postpone.label}（${when(a.postpone.date, today, lang)}）挪到发薪后，就能守住安全线。`,
      );
    }
    return a.hasPay
      ? t(`A tight few days. Spend as little as you can until payday ${onWhen(a.until, today, lang)}; it eases right after.`, `这几天有点紧，${payWhen}发薪前尽量少花，发薪后就好了。`)
      : t(`A tight few days. Spend as little as you can for now.`, `这几天有点紧，先尽量少花。`);
  }
  if (a.perDay < daily) {
    const cause = a.bind.flows.filter((f) => f.amount < 0 && f.kind !== "actual").sort((x, y) => x.amount - y.amount)[0];
    if (cause) {
      return t(
        `Things get tight after ${cause.label} ${onWhen(cause.date, today, lang)}. Keep it under ${cad(a.perDay)} a day and it stays dry.`,
        `${when(cause.date, today, lang)}交 ${cause.label} 后会偏紧，这几天每天控制在 ${cad(a.perDay)} 以内就不会下雨。`,
      );
    }
    return t(`Keep it under ${cad(a.perDay)} a day for now and it stays dry.`, `这几天每天控制在 ${cad(a.perDay)} 以内就不会下雨。`);
  }
  return a.hasPay
    ? t(`You're good. Up to ${cad(a.perDay)} a day is fine until payday ${onWhen(a.until, today, lang)}.`, `今天放心花，到${payWhen}发薪前每天 ${cad(a.perDay)} 都没问题。`)
    : t(`You're good. Up to ${cad(a.perDay)} a day keeps you above your line.`, `今天放心花，每天 ${cad(a.perDay)} 以内都在安全线以上。`);
}

/** The small line under the big number once today is logged. */
export function logged(a: Allowance, t: T): string | null {
  if (a.spentToday === null) return null;
  return a.spentToday > a.perDay
    ? t(`Logged ${cad(a.spentToday)} today. Tomorrow's number adjusts.`, `今天记了 ${cad(a.spentToday)}，明天的额度会自动调整。`)
    : t(`Logged ${cad(a.spentToday)} today.`, `今天记了 ${cad(a.spentToday)}。`);
}

/** Card text for a reminder: [title, detail]. */
export function card(r: Reminder, today: string, lang: Lang, t: T): [string, string] {
  if (r.kind === "save") {
    return [
      t(`Set aside ${cad(r.plan.suggest)}?`, `存下 ${cad(r.plan.suggest)}？`),
      t(`After everything until next pay, ${cad(r.plan.surplus)} is left over.`, `到下次发薪的开销留够后，还多 ${cad(r.plan.surplus)}。`),
    ];
  }
  if (r.kind === "bill") {
    return [t(`${r.name}, ${when(r.date, today, lang)}`, `${r.name}，${when(r.date, today, lang)}`), t(`${cad(r.amount, true)} comes out.`, `会扣 ${cad(r.amount, true)}。`)];
  }
  const n = r.note;
  if (n.kind === "hike") {
    return [
      t(`${n.name} went up`, `${n.name} 涨价了`),
      t(`${cad(n.before ?? 0, true)} → ${cad(n.amount, true)}, about ${cad(n.perYear ?? 0)} more a year.`, `${cad(n.before ?? 0, true)} → ${cad(n.amount, true)}，一年多花约 ${cad(n.perYear ?? 0)}。`),
    ];
  }
  if (n.kind === "new") {
    return [
      t(`New charge: ${n.name}`, `新的扣款：${n.name}`),
      t(`${cad(n.amount, true)} ${when(n.date, today, lang)}. Worth a quick look that it's yours.`, `${when(n.date, today, lang)} ${cad(n.amount, true)}，确认一下是不是你买的。`),
    ];
  }
  const cat = CATEGORY[n.name as Category] ?? CATEGORY.other;
  return [
    t(`More ${cat[0]} than usual`, `${cat[1]}比平时多`),
    t(`${cad(n.amount)} in the last 30 days; usually about ${cad(n.before ?? 0)}.`, `最近 30 天 ${cad(n.amount)}，平时大约 ${cad(n.before ?? 0)}。`),
  ];
}
