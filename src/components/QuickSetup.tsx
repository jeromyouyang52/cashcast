"use client";

/**
 * Four questions instead of a bank file: balance (+ a rough week of spending), pay, rent,
 * and which regular bills you have. Enough for today's number; daily check-ins refine it.
 */
import { useState } from "react";
import { addDays } from "@/lib/dates";
import { fromAnswers, type Answers } from "@/lib/model";
import type { State } from "@/lib/types";
import { cad, tr, type Lang } from "@/lib/ui";

type Cad = "weekly" | "biweekly" | "monthly";
type Bill = Answers["bills"][number];

/** Common regular costs. Amounts are starting points; every one is editable. */
const PRESETS: { key: string; en: string; zh: string; amount: number; kind: "bill" | "sub" }[] = [
  { key: "phone", en: "Phone", zh: "手机费", amount: 45, kind: "bill" },
  { key: "internet", en: "Internet", zh: "网费", amount: 60, kind: "bill" },
  { key: "insurance", en: "Insurance", zh: "保险", amount: 120, kind: "bill" },
  { key: "transit", en: "Transit pass", zh: "交通月票", amount: 130, kind: "bill" },
  { key: "gym", en: "Gym", zh: "健身房", amount: 30, kind: "sub" },
  { key: "netflix", en: "Netflix", zh: "Netflix", amount: 19, kind: "sub" },
  { key: "spotify", en: "Spotify", zh: "Spotify", amount: 13, kind: "sub" },
  { key: "cloud", en: "Cloud storage", zh: "云存储", amount: 4, kind: "sub" },
  { key: "video", en: "Other streaming", zh: "其他视频会员", amount: 12, kind: "sub" },
  { key: "ai", en: "AI tools", zh: "AI 工具", amount: 28, kind: "sub" },
];

const num = (v: string) => Number(v.replace(/[,$\s]/g, ""));
const okNum = (v: string) => v.trim() !== "" && Number.isFinite(num(v)) && num(v) >= 0;

export function QuickSetup({ lang, today, onDone, onCancel }: { lang: Lang; today: string; onDone: (s: State) => void; onCancel: () => void }) {
  const t = tr(lang);
  const [step, setStep] = useState(0);
  const [balance, setBalance] = useState("");
  const [weekly, setWeekly] = useState("250");
  const [pay, setPay] = useState<{ amount: string; next: string; cadence: Cad } | null>({ amount: "", next: addDays(today, 7), cadence: "biweekly" });
  const [rent, setRent] = useState<{ amount: string; day: number } | null>({ amount: "", day: 1 });
  const [bills, setBills] = useState<Record<string, Bill>>({});

  const steps = 4;
  const canNext =
    step === 0 ? okNum(balance) && okNum(weekly) : step === 1 ? !pay || (okNum(pay.amount) && num(pay.amount) > 0 && pay.next >= today) : step === 2 ? !rent || (okNum(rent.amount) && num(rent.amount) > 0) : true;

  const finish = () => {
    const a: Answers = {
      balance: num(balance),
      weekly: num(weekly),
      ...(pay && okNum(pay.amount) && num(pay.amount) > 0 ? { pay: { amount: num(pay.amount), next: pay.next, cadence: pay.cadence, name: t("Pay", "工资") } } : {}),
      ...(rent && okNum(rent.amount) && num(rent.amount) > 0 ? { rent: { amount: num(rent.amount), day: rent.day, name: t("Rent", "房租") } } : {}),
      bills: Object.values(bills).filter((b) => b.amount > 0),
    };
    onDone(fromAnswers(a, today));
  };

  const next = () => (step < steps - 1 ? setStep(step + 1) : finish());
  const toggle = (p: (typeof PRESETS)[number]) =>
    setBills((b) => {
      const c = { ...b };
      if (c[p.key]) delete c[p.key];
      else c[p.key] = { key: p.key, name: t(p.en, p.zh), amount: p.amount, day: 15, kind: p.kind };
      return c;
    });
  const setBill = (key: string, patch: Partial<Bill>) => setBills((b) => ({ ...b, [key]: { ...b[key], ...patch } }));

  const days = Array.from({ length: 31 }, (_, i) => i + 1);

  return (
    <section className="setup" aria-labelledby="q-h">
      <div className="dots" aria-hidden="true">
        {Array.from({ length: steps }, (_, i) => (
          <span key={i} className={i <= step ? "on" : ""} />
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canNext) next();
        }}
      >
        {step === 0 && (
          <>
            <h1 id="q-h">{t("How much is in your account now?", "账户里现在有多少？")}</h1>
            <label className="log-field">
              <span aria-hidden="true">C$</span>
              <input autoFocus inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} aria-label={t("Balance now", "现在余额")} data-testid="q-balance" />
            </label>
            <h2>{t("A normal week of everyday spending", "平时一周的日常花销")}</h2>
            <div className="chips">
              {["150", "250", "400"].map((w) => (
                <button type="button" key={w} className={`chip ${weekly === w ? "on" : ""}`} aria-pressed={weekly === w} onClick={() => setWeekly(w)}>
                  {cad(Number(w))}
                </button>
              ))}
              <span className="chip custom">
                <span aria-hidden="true">C$</span>
                <input inputMode="decimal" value={["150", "250", "400"].includes(weekly) ? "" : weekly} placeholder="…" onChange={(e) => setWeekly(e.target.value)} aria-label={t("Other amount per week", "其他金额（每周）")} />
              </span>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1 id="q-h">{t("When do you get paid?", "哪天发工资？")}</h1>
            {pay ? (
              <dl className="fields">
                <div>
                  <dt>
                    <label htmlFor="q-pay">{t("Amount", "金额")}</label>
                  </dt>
                  <dd>
                    <span className="prefix">C$</span>
                    <input id="q-pay" autoFocus inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} data-testid="q-pay" />
                  </dd>
                </div>
                <div>
                  <dt>
                    <label htmlFor="q-next">{t("Next payday", "下次发薪")}</label>
                  </dt>
                  <dd>
                    <input id="q-next" type="date" min={today} value={pay.next} onChange={(e) => e.target.value && setPay({ ...pay, next: e.target.value })} />
                  </dd>
                </div>
                <div>
                  <dt>{t("How often", "多久一次")}</dt>
                  <dd>
                    <span className="seg" role="radiogroup">
                      {(["weekly", "biweekly", "monthly"] as Cad[]).map((c) => (
                        <button type="button" key={c} role="radio" aria-checked={pay.cadence === c} onClick={() => setPay({ ...pay, cadence: c })}>
                          {c === "weekly" ? t("Weekly", "每周") : c === "biweekly" ? t("2 weeks", "两周") : t("Monthly", "每月")}
                        </button>
                      ))}
                    </span>
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="quiet">{t("No regular pay. The forecast looks 30 days ahead.", "没有固定收入，按未来 30 天计算。")}</p>
            )}
            <button type="button" className="link" onClick={() => setPay(pay ? null : { amount: "", next: addDays(today, 7), cadence: "biweekly" })}>
              {pay ? t("No regular pay", "没有固定工资") : t("I do get paid regularly", "我有固定工资")}
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h1 id="q-h">{t("Rent or mortgage?", "房租或房贷？")}</h1>
            {rent ? (
              <dl className="fields">
                <div>
                  <dt>
                    <label htmlFor="q-rent">{t("Per month", "每月")}</label>
                  </dt>
                  <dd>
                    <span className="prefix">C$</span>
                    <input id="q-rent" autoFocus inputMode="decimal" value={rent.amount} onChange={(e) => setRent({ ...rent, amount: e.target.value })} data-testid="q-rent" />
                  </dd>
                </div>
                <div>
                  <dt>
                    <label htmlFor="q-day">{t("Day of the month", "每月几号")}</label>
                  </dt>
                  <dd>
                    <select id="q-day" value={rent.day} onChange={(e) => setRent({ ...rent, day: Number(e.target.value) })}>
                      {days.map((d) => (
                        <option key={d} value={d}>
                          {t(`${d}`, `${d} 号`)}
                        </option>
                      ))}
                    </select>
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="quiet">{t("No rent or mortgage.", "没有房租或房贷。")}</p>
            )}
            <button type="button" className="link" onClick={() => setRent(rent ? null : { amount: "", day: 1 })} data-testid="q-norent">
              {rent ? t("I don't pay rent", "我不用交房租") : t("I do pay rent", "我要交房租")}
            </button>
          </>
        )}

        {step === 3 && (
          <>
            <h1 id="q-h">{t("Anything else every month?", "每月还有哪些固定支出？")}</h1>
            <div className="chips">
              {PRESETS.map((p) => (
                <button type="button" key={p.key} className={`chip ${bills[p.key] ? "on" : ""}`} aria-pressed={!!bills[p.key]} onClick={() => toggle(p)} data-testid={`q-${p.key}`}>
                  {t(p.en, p.zh)}
                </button>
              ))}
            </div>
            {Object.values(bills).length > 0 && (
              <ul className="items bill-list">
                {Object.values(bills).map((b) => (
                  <li key={b.key} className="item q-item">
                    <span className="name">{b.name}</span>
                    <span className="money-in">
                      <span aria-hidden="true">C$</span>
                      <input inputMode="decimal" defaultValue={String(b.amount)} onChange={(e) => okNum(e.target.value) && setBill(b.key, { amount: num(e.target.value) })} aria-label={t(`${b.name} amount`, `${b.name}金额`)} />
                    </span>
                    <select value={b.day} onChange={(e) => setBill(b.key, { day: Number(e.target.value) })} aria-label={t(`${b.name} day`, `${b.name}扣款日`)}>
                      {days.map((d) => (
                        <option key={d} value={d}>
                          {t(`on the ${d}`, `${d} 号`)}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <div className="bar">
          <button type="button" className="btn" onClick={() => (step ? setStep(step - 1) : onCancel())}>
            {t("Back", "返回")}
          </button>
          <button className="btn primary" disabled={!canNext} data-testid="q-next">
            {step < steps - 1 ? t("Next", "下一步") : t("Show my day", "看看今天")}
          </button>
        </div>
      </form>
    </section>
  );
}
