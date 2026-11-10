"use client";

/**
 * Up to three savings goals. "I set aside X" records it locally, fills the bar, and lowers the
 * forecast from today, because that money left the everyday account. No money moves here.
 */
import { useState } from "react";
import { diffDays } from "@/lib/dates";
import { savedFor, uid } from "@/lib/model";
import type { State } from "@/lib/types";
import { cad, dateLong, tr, type Lang } from "@/lib/ui";

const MAX = 3;
const num = (v: string) => Number(v.replace(/[,$\s]/g, ""));

export function Goals({ state, today, lang, onChange }: { state: State; today: string; lang: Lang; onChange: (s: State) => void }) {
  const t = tr(lang);
  const [adding, setAdding] = useState(state.goals.length === 0);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [by, setBy] = useState("");
  const [amount, setAmount] = useState<Record<string, string>>({});
  const [sure, setSure] = useState<string | null>(null);

  const create = () => {
    const tg = num(target);
    if (!name.trim() || !Number.isFinite(tg) || tg <= 0) return;
    onChange({ ...state, goals: [...state.goals, { id: uid(), name: name.trim(), target: tg, ...(by ? { by } : {}) }] });
    setName("");
    setTarget("");
    setBy("");
    setAdding(false);
  };

  const put = (goalId: string) => {
    const a = num(amount[goalId] ?? "");
    if (!Number.isFinite(a) || a <= 0) return;
    onChange({ ...state, saves: [...state.saves, { id: uid(), date: today, amount: a, goalId }] });
    setAmount({ ...amount, [goalId]: "" });
  };

  return (
    <section className="goals" aria-labelledby="g-h">
      <h1 id="g-h">{t("Goals", "存钱目标")}</h1>
      <ul className="goal-list">
        {state.goals.map((g) => {
          const saved = savedFor(state, g.id);
          const pct = Math.min(100, (saved / g.target) * 100);
          const done = saved >= g.target;
          const monthsLeft = g.by ? Math.max(1, Math.ceil(diffDays(today, g.by) / 30.44)) : null;
          const perMonth = monthsLeft && !done ? Math.ceil((g.target - saved) / monthsLeft) : null;
          const recent = state.saves.filter((x) => x.goalId === g.id).slice(-3).reverse();
          return (
            <li key={g.id} className={`goal ${done ? "done" : ""}`} data-testid="goal">
              <div className="goal-head">
                <strong>{g.name}</strong>
                <span className="num">
                  {cad(saved)} <span className="quiet">/ {cad(g.target)}</span>
                </span>
              </div>
              <div className="goal-bar" role="progressbar" aria-valuenow={Math.floor(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={g.name}>
                <span style={{ width: `${pct}%` }} />
              </div>
              {(perMonth || done) && (
                <p className="quiet">
                  {done
                    ? t("Done. Nice.", "完成了！")
                    : t(`${cad(perMonth!)} a month gets you there by ${dateLong(g.by!, lang)}.`, `每月存 ${cad(perMonth!)}，${dateLong(g.by!, lang)}就能到。`)}
                </p>
              )}
              <form
                className="goal-put"
                onSubmit={(e) => {
                  e.preventDefault();
                  put(g.id);
                }}
              >
                <span aria-hidden="true">C$</span>
                <input inputMode="decimal" value={amount[g.id] ?? ""} onChange={(e) => setAmount({ ...amount, [g.id]: e.target.value })} aria-label={t(`Amount for ${g.name}`, `存入${g.name}的金额`)} placeholder="0" />
                <button className="btn small">{t("I set this aside", "存了")}</button>
              </form>
              {recent.length > 0 && (
                <ul className="tried">
                  {recent.map((x) => (
                    <li key={x.id}>
                      <span>
                        {dateLong(x.date, lang)} · <span className="num">{cad(x.amount, true)}</span>
                      </span>
                      <button className="x" onClick={() => onChange({ ...state, saves: state.saves.filter((y) => y.id !== x.id) })} aria-label={t("Remove", "删除")}>
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {sure === g.id ? (
                <span className="row-actions">
                  <button className="link" onClick={() => setSure(null)}>
                    {t("Keep", "保留")}
                  </button>
                  <button className="link danger" onClick={() => onChange({ ...state, goals: state.goals.filter((x) => x.id !== g.id), saves: state.saves.filter((x) => x.goalId !== g.id) })}>
                    {t("Delete goal", "删除目标")}
                  </button>
                </span>
              ) : (
                <button className="link quiet-link" onClick={() => setSure(g.id)}>
                  {t("Delete", "删除")}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {adding ? (
        <form
          className="fields new-goal"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <div>
            <label htmlFor="g-name">{t("Name", "名称")}</label>
            <input id="g-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Trip home", "回国机票")} data-testid="goal-name" />
          </div>
          <div>
            <label htmlFor="g-target">{t("Amount", "金额")}</label>
            <span className="row-in">
              <span className="prefix">C$</span>
              <input id="g-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="1000" data-testid="goal-target" />
            </span>
          </div>
          <div>
            <label htmlFor="g-by">{t("By (optional)", "截止（可选）")}</label>
            <input id="g-by" type="date" value={by} min={today} onChange={(e) => setBy(e.target.value)} />
          </div>
          <div className="form-actions">
            {state.goals.length > 0 && (
              <button type="button" className="btn" onClick={() => setAdding(false)}>
                {t("Cancel", "取消")}
              </button>
            )}
            <button className="btn primary" data-testid="goal-create">
              {t("Create goal", "建好了")}
            </button>
          </div>
        </form>
      ) : (
        state.goals.length < MAX && (
          <button className="link add" onClick={() => setAdding(true)}>
            + {t("New goal", "新目标")}
          </button>
        )
      )}
      <p className="quiet">{t("Progress is a note on this device. Nothing is moved for you.", "进度只是本机记录，不会替你转任何钱。")}</p>
    </section>
  );
}
