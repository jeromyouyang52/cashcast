"use client";

/**
 * The daily brief. Four things, top to bottom: one sentence, today's number, a 3-second
 * check-in, and at most two reminders. Everything else lives one tab away.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { allowance, effectiveDaily, project, reminders, savingsPlan, uid, type Reminder } from "@/lib/model";
import type { State } from "@/lib/types";
import { cad, tr, type Lang } from "@/lib/ui";
import { brief, card, logged, when } from "@/lib/voice";
import { CountUp } from "./CountUp";
import { Sky } from "./Sky";

type Go = (view: "forecast" | "goals" | "subs") => void;

export function Today({ state, today, lang, onChange, go }: { state: State; today: string; lang: Lang; onChange: (s: State) => void; go: Go }) {
  const t = tr(lang);
  const a = useMemo(() => allowance(state, today), [state, today]);
  const plan = useMemo(() => savingsPlan(state, today), [state, today]);
  const f = useMemo(() => project(state, today), [state, today]);
  const daily = effectiveDaily(state, today);
  const cards = useMemo(() => reminders(state, today).slice(0, 2), [state, today]);
  const [sheet, setSheet] = useState<"log" | "why" | null>(null);

  const dismiss = (id: string) => onChange({ ...state, dismissed: [...state.dismissed, id] });
  const saveNow = (r: Extract<Reminder, { kind: "save" }>) => {
    const goal = state.goals[0];
    if (!goal) return go("goals");
    onChange({ ...state, saves: [...state.saves, { id: uid(), date: today, amount: r.plan.suggest, goalId: goal.id }] });
  };

  return (
    <div className="today">
      <p className="brief" data-testid="brief">
        {brief(a, plan, daily, today, lang, t)}
      </p>

      <section className="hero today-hero" aria-label={t("Today you can spend", "今天还能花")}>
        <Sky w={f.days[0]?.weather ?? "sunny"} />
        <button className="hero-btn" onClick={() => setSheet("why")}>
          <span className="hero-label">{t("Today you can spend", "今天还能花")}</span>
          <span className="hero-bal num" data-testid="allowance">
            <CountUp value={a.left} />
          </span>
          {logged(a, t) && <span className="hero-w">{logged(a, t)}</span>}
        </button>
        <button className="btn primary log-btn" onClick={() => setSheet("log")} data-testid="log">
          {a.spentToday === null ? t("Log today's spending", "记一下今天花了多少") : t("Change today's amount", "改一下今天的金额")}
        </button>
      </section>

      {cards.length > 0 && (
        <ul className="cards" aria-label={t("Reminders", "提醒")}>
          {cards.map((r) => {
            const [title, detail] = card(r, today, lang, t);
            return (
              <li key={r.id} className={`note n-${r.kind === "note" ? r.note.kind : r.kind}`} data-testid="card">
                <div>
                  <strong>{title}</strong>
                  <span>{detail}</span>
                  {r.kind === "save" && (
                    <span className="note-actions">
                      <button className="btn small primary" onClick={() => saveNow(r)} data-testid="save-now">
                        {state.goals[0] ? t(`Saved ${cad(r.plan.suggest)}`, `存了 ${cad(r.plan.suggest)}`) : t("Make a goal", "建一个目标")}
                      </button>
                    </span>
                  )}
                  {r.kind === "note" && r.note.kind === "hike" && (
                    <button className="link" onClick={() => go("subs")}>
                      {t("Subscriptions", "看订阅")}
                    </button>
                  )}
                  {r.kind === "bill" && (
                    <button className="link" onClick={() => go("forecast")}>
                      {t("Forecast", "看预报")}
                    </button>
                  )}
                </div>
                <button className="x" onClick={() => dismiss(r.id)} aria-label={t("Dismiss", "划掉")} data-testid="dismiss">
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {sheet === "log" && <LogSheet state={state} today={today} lang={lang} daily={daily} onClose={() => setSheet(null)} onChange={onChange} />}
      {sheet === "why" && (
        <Sheet title={t("How today's number works", "这个数怎么算的")} lang={lang} onClose={() => setSheet(null)}>
          <dl className="ledger" data-testid="why">
            <div>
              <dt>{t("Balance now", "现在余额")}</dt>
              <dd className="num">{cad(a.start, true)}</dd>
            </div>
            {a.bind.flows.map((fl, i) => (
              <div key={i} className={fl.kind}>
                <dt>
                  {fl.kind === "actual" ? t("Logged spending", "记下的花销") : fl.kind === "save" ? t("Set aside", "存下") : fl.label} · {when(fl.date, today, lang)}
                </dt>
                <dd className={`num ${fl.amount > 0 ? "in" : ""}`}>{(fl.amount > 0 ? "+" : "") + cad(fl.amount, true)}</dd>
              </div>
            ))}
            <div>
              <dt>{t("Safety line", "安全线")}</dt>
              <dd className="num">−{cad(state.safety, true)}</dd>
            </div>
            <div>
              <dt>{t(`Spread over ${a.bind.days} ${a.bind.days === 1 ? "day" : "days"}`, `分到 ${a.bind.days} 天`)}</dt>
              <dd className="num">÷ {a.bind.days}</dd>
            </div>
            <div className="total">
              <dt>{t("Per day", "每天")}</dt>
              <dd className="num">{cad(a.perDay)}</dd>
            </div>
            {a.spentToday !== null && (
              <div>
                <dt>{t("Logged today", "今天已记")}</dt>
                <dd className="num">−{cad(a.spentToday)}</dd>
              </div>
            )}
          </dl>
          <p className="rule">
            {a.hasPay
              ? t(`Counted until payday ${when(a.until, today, lang)}. Every day stays above your safety line.`, `算到${when(a.until, today, lang)}发薪为止，每一天都不会低于安全线。`)
              : t("Counted for the next 30 days. Every day stays above your safety line.", "按未来 30 天计算，每一天都不会低于安全线。")}
          </p>
        </Sheet>
      )}
    </div>
  );
}

export function Sheet({ title, lang, onClose, children }: { title: string; lang: Lang; onClose: () => void; children: React.ReactNode }) {
  const t = tr(lang);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button className="x" onClick={onClose} aria-label={t("Close", "关闭")}>
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

const num = (v: string) => Number(v.replace(/[,$\s]/g, ""));

function LogSheet({ state, today, lang, daily, onClose, onChange }: { state: State; today: string; lang: Lang; daily: number; onClose: () => void; onChange: (s: State) => void }) {
  const t = tr(lang);
  const existing = state.checkins.filter((c) => c.date === today).pop();
  const [mode, setMode] = useState<"spent" | "balance">("spent");
  const [v, setV] = useState(existing ? String(existing.spent) : "");
  const n = num(v);
  const ok = v.trim() !== "" && Number.isFinite(n) && (mode === "balance" || n >= 0);
  const quick = [0, Math.round(daily / 5) * 5, Math.round((daily * 2) / 5) * 5].filter((x, i, all) => all.indexOf(x) === i);

  const submit = (val = n) => {
    if (mode === "spent") {
      onChange({ ...state, checkins: [...state.checkins.filter((c) => c.date !== today), { date: today, spent: Math.abs(val) }].slice(-120) });
    } else {
      // "Right now my account has X": today's logged spending is already out of it.
      const spent = state.checkins.find((c) => c.date === today)?.spent ?? 0;
      onChange({ ...state, balance: val + spent, asOf: today });
    }
    onClose();
  };

  return (
    <Sheet title={mode === "spent" ? t("About how much today?", "今天大概花了多少？") : t("What's in your account now?", "账户里现在有多少？")} lang={lang} onClose={onClose}>
      <form
        className="log"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) submit();
        }}
      >
        <label className="log-field">
          <span aria-hidden="true">C$</span>
          <input
            autoFocus
            inputMode="decimal"
            value={v}
            onChange={(e) => setV(e.target.value)}
            aria-label={mode === "spent" ? t("Spent today", "今天花了") : t("Balance now", "现在余额")}
            data-testid="log-input"
          />
        </label>
        {mode === "spent" && (
          <div className="chips">
            {quick.map((q) => (
              <button type="button" key={q} className="chip" onClick={() => submit(q)}>
                {cad(q)}
              </button>
            ))}
          </div>
        )}
        <div className="bar">
          <button type="button" className="link" onClick={() => { setMode(mode === "spent" ? "balance" : "spent"); setV(""); }}>
            {mode === "spent" ? t("Correct my balance instead", "改成更正余额") : t("Log spending instead", "改成记花销")}
          </button>
          <button className="btn primary" disabled={!ok} data-testid="log-save">
            {t("Save", "保存")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
