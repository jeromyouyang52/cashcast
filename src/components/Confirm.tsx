"use client";

/** One screen to check what was found. Every value is editable in place; nothing is hidden. */
import { useState } from "react";
import { addDays, today } from "@/lib/dates";
import { uid } from "@/lib/model";
import type { Cadence, Kind, Recurring, State } from "@/lib/types";
import { CADENCE, KIND, tr, type Lang } from "@/lib/ui";

const KINDS: Kind[] = ["income", "bill", "sub"];
const CADENCES: Cadence[] = ["weekly", "biweekly", "monthly", "yearly"];

const num = (v: string) => (v.trim() === "" ? NaN : Number(v.replace(/[,$\s]/g, "")));
const show = (x: number, signed = false) => (Number.isFinite(x) ? String(Math.round((signed ? x : Math.abs(x)) * 100) / 100) : "");

/** Uncontrolled so typing "12." isn't rewritten mid-keystroke. */
function Num({ value, onValue, signed, ...rest }: { value: number; onValue: (n: number) => void; signed?: boolean } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return <input {...rest} inputMode={signed ? "text" : "decimal"} defaultValue={show(value, signed)} onChange={(e) => onValue(num(e.target.value))} />;
}

export function Confirm({ draft, lang, onDone, onCancel }: { draft: State; lang: Lang; onDone: (s: State) => void; onCancel: () => void }) {
  const t = tr(lang);
  const [s, setS] = useState<State>(draft);
  const set = (p: Partial<State>) => setS((x) => ({ ...x, ...p }));
  const setItem = (id: string, p: Partial<Recurring>) => setS((x) => ({ ...x, items: x.items.map((i) => (i.id === id ? { ...i, ...p } : i)) }));
  const remove = (id: string) => setS((x) => ({ ...x, items: x.items.filter((i) => i.id !== id) }));
  const add = (kind: Kind) =>
    setS((x) => ({
      ...x,
      items: [...x.items, { id: uid(), name: "", amount: 0, kind, cadence: "monthly", next: addDays(today(), 1), confidence: 1, on: true, seen: 0 }],
    }));

  const sure = s.items.filter((i) => i.confidence >= 0.6 || i.seen === 0);
  const maybe = s.items.filter((i) => !(i.confidence >= 0.6 || i.seen === 0));
  const ok = Number.isFinite(s.balance) && Number.isFinite(s.safety) && Number.isFinite(s.daily);

  const row = (i: Recurring) => (
    <li key={i.id} className={`item ${i.on ? "" : "off"}`} data-testid="item">
      <input type="checkbox" checked={i.on} onChange={(e) => setItem(i.id, { on: e.target.checked })} aria-label={t("Include", "计入")} />
      <input className="name" value={i.name} placeholder={t("Name", "名称")} onChange={(e) => setItem(i.id, { name: e.target.value })} aria-label={t("Name", "名称")} />
      <span className="money-in">
        <span aria-hidden="true">{i.kind === "income" ? "+" : "−"}</span>
        <Num value={i.amount} onValue={(v) => setItem(i.id, { amount: Number.isFinite(v) ? (i.kind === "income" ? 1 : -1) * Math.abs(v) : 0 })} aria-label={t("Amount", "金额")} />
      </span>
      <button className="x" onClick={() => remove(i.id)} aria-label={t("Remove", "删除")}>
        ×
      </button>
      <span className="sub-line">
        <select value={i.cadence} onChange={(e) => setItem(i.id, { cadence: e.target.value as Cadence })} aria-label={t("How often", "频率")}>
          {CADENCES.map((c) => (
            <option key={c} value={c}>
              {t(...CADENCE[c])}
            </option>
          ))}
        </select>
        <input type="date" value={i.next} onChange={(e) => e.target.value && setItem(i.id, { next: e.target.value })} aria-label={t("Next date", "下一次")} />
      </span>
    </li>
  );

  return (
    <section className="confirm" aria-labelledby="c-h">
      <h1 id="c-h">{t("Is this right?", "核对一下")}</h1>

      <dl className="fields">
        <div>
          <dt>
            <label htmlFor="bal">{t("Balance today", "今天的余额")}</label>
          </dt>
          <dd>
            <span className="prefix">C$</span>
            <Num id="bal" signed value={s.balance} autoFocus={!Number.isFinite(s.balance)} onValue={(v) => set({ balance: v, asOf: today() })} />
          </dd>
        </div>
        <div>
          <dt>
            <label htmlFor="safe">{t("Safety line", "安全线")}</label>
          </dt>
          <dd>
            <span className="prefix">C$</span>
            <Num id="safe" value={s.safety} onValue={(v) => set({ safety: Math.max(0, v) })} />
          </dd>
        </div>
        <div>
          <dt>
            <label htmlFor="daily">{t("Everyday spending", "日常花销")}</label>
          </dt>
          <dd>
            <span className="prefix">C$</span>
            <Num id="daily" value={s.daily} onValue={(v) => set({ daily: Math.max(0, v) })} />
            <span className="suffix">{t("/day", "/天")}</span>
          </dd>
        </div>
      </dl>

      {KINDS.map((k) => (
        <div key={k} className="group">
          <h2>{t(...KIND[k])}</h2>
          <ul className="items">{sure.filter((i) => i.kind === k).map(row)}</ul>
          <button className="link add" onClick={() => add(k)}>
            + {t("Add", "添加")}
          </button>
        </div>
      ))}

      {maybe.length > 0 && (
        <div className="group">
          <h2>{t("Maybe", "待确认")}</h2>
          <ul className="items">{maybe.map(row)}</ul>
        </div>
      )}

      <div className="bar">
        <button className="btn" onClick={onCancel}>
          {t("Back", "返回")}
        </button>
        <button
          className="btn primary"
          disabled={!ok}
          onClick={() => onDone({ ...s, items: s.items.filter((i) => i.name.trim() && i.amount !== 0).map((i) => ({ ...i, name: i.name.trim() })) })}
        >
          {t("Show forecast", "生成预报")}
        </button>
      </div>
    </section>
  );
}
