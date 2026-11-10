"use client";

/**
 * Today, the next 7 days, and (on demand) all 30. Below it, "Can I spend?": pick an
 * amount, drop it on a day (drag, or tap the amount then tap the day), and the whole
 * forecast updates. Tap any day to see exactly how its number was worked out.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { changed, sunnyLine } from "@/lib/forecast";
import { dryDays, effectiveDaily, project, uid } from "@/lib/model";
import type { Day, Extra, Flow, State, Weather } from "@/lib/types";
import { cad, dateLong, dayName, dom, tr, WEATHER, type Lang } from "@/lib/ui";
import { CountUp } from "./CountUp";
import { WeatherIcon } from "./Icons";
import { Sky } from "./Sky";

const PRESETS: { en: string; zh: string; amount: number }[] = [
  { en: "Dinner out", zh: "出去吃饭", amount: 60 },
  { en: "Groceries", zh: "买菜", amount: 120 },
  { en: "Concert", zh: "演唱会", amount: 150 },
  { en: "New shoes", zh: "新鞋", amount: 200 },
];

const compact = (x: number) => {
  const a = Math.abs(x);
  const s = a >= 10000 ? `${Math.round(a / 1000)}k` : a >= 1000 ? `${(a / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${Math.round(a)}`;
  return (x < 0 ? "−" : "") + s;
};

const ADJ: Record<Weather, string> = { sunny: "sunny", cloudy: "cloudy", rain: "rainy", storm: "stormy" };

type Armed = { label: string; amount: number };

export function ForecastView({ state, today, lang, onChange }: { state: State; today: string; lang: Lang; onChange: (s: State) => void }) {
  const t = tr(lang);
  const w = (x: Weather) => t(...WEATHER[x]);
  const extras = useMemo(() => state.extras.filter((x) => x.date >= today), [state.extras, today]);
  const f = useMemo(() => project(state, today, extras), [state, today, extras]);
  const [open, setOpen] = useState<string | null>(null);
  const [month, setMonth] = useState(false);
  const [armed, setArmed] = useState<Armed | null>(null);
  const [custom, setCustom] = useState("");
  const [news, setNews] = useState<{ text: string; id: string } | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; a: Armed } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [flash, setFlash] = useState<string[]>([]);
  useEffect(() => {
    if (!flash.length) return;
    const id = setTimeout(() => setFlash([]), 1400);
    return () => clearTimeout(id);
  }, [flash]);
  const press = useRef<{ x: number; y: number; a: Armed; moved: boolean } | null>(null);

  const day0 = f.days[0];
  const streak = dryDays(state, f, today);

  const place = (a: Armed, date: string) => {
    const x: Extra = { id: uid(), date, amount: a.amount, label: a.label };
    const before = f;
    const next = { ...state, extras: [...extras, x] };
    const after = project(next, today);
    const diffs = changed(before, after);
    let text: string;
    if (!diffs.length) text = t(`${a.label} on ${dateLong(date, lang)}: the weather holds.`, `${dateLong(date, lang)} ${a.label}：天气不变。`);
    else {
      const first = diffs[0];
      const more = diffs.length > 1 ? t(` (+${diffs.length - 1} more days)`, `（另有 ${diffs.length - 1} 天变天）`) : "";
      text = t(
        `${a.label} on ${dateLong(date, lang)}: ${dateLong(first.date, lang)} turns ${ADJ[first.to]}${more}.`,
        `${dateLong(date, lang)} ${a.label}：${dateLong(first.date, lang)} 变成${w(first.to)}${more}。`,
      );
    }
    onChange(next);
    setNews({ text, id: x.id });
    setFlash(diffs.map((d) => d.date));
    setArmed(null);
  };

  const undo = () => {
    if (!news) return;
    onChange({ ...state, extras: state.extras.filter((x) => x.id !== news.id) });
    setNews(null);
  };

  const removeExtra = (id: string) => onChange({ ...state, extras: state.extras.filter((x) => x.id !== id) });

  // Pointer drag for chips: works with mouse, pen and touch. A press without movement is a tap.
  const down = (e: React.PointerEvent, a: Armed) => {
    if (e.button !== 0) return;
    press.current = { x: e.clientX, y: e.clientY, a, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p) return;
    if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
    p.moved = true;
    setDrag({ x: e.clientX, y: e.clientY, a: p.a });
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-date]");
    setHover(el?.dataset.date ?? null);
  };
  const up = (e: React.PointerEvent) => {
    const p = press.current;
    press.current = null;
    setDrag(null);
    setHover(null);
    if (!p) return;
    if (!p.moved) {
      setArmed((cur) => (cur && cur.label === p.a.label && cur.amount === p.a.amount ? null : p.a));
      return;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-date]");
    if (el?.dataset.date) place(p.a, el.dataset.date);
  };
  const cancel = () => {
    press.current = null;
    setDrag(null);
    setHover(null);
  };

  const tapDay = (date: string) => (armed ? place(armed, date) : setOpen(date));

  useEffect(() => {
    if (!armed) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setArmed(null);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [armed]);

  const customAmount = Number(custom.replace(/[,$\s]/g, ""));
  const customOk = Number.isFinite(customAmount) && customAmount > 0;

  const cell = (d: Day, i: number, big = false) => {
    const tried = extras.filter((x) => x.date === d.date);
    return (
      <button
        key={d.date}
        className={`day w-${d.weather} ${hover === d.date ? "hover" : ""} ${armed ? "target" : ""} ${tried.length ? "tried" : ""} ${flash.includes(d.date) ? "flash" : ""}`}
        style={{ "--i": i } as React.CSSProperties}
        data-date={d.date}
        data-weather={d.weather}
        onClick={() => tapDay(d.date)}
        aria-label={`${dateLong(d.date, lang)}, ${w(d.weather)}, ${cad(d.end)}`}
      >
        <span className="d-name">{big ? dom(d.date) : dayName(d.date, lang, i === 0 ? today : undefined)}</span>
        <WeatherIcon key={d.weather} w={d.weather} size={big ? 22 : 28} />
        <span className="d-bal num">{compact(d.end)}</span>
      </button>
    );
  };

  const lead = f.days.length ? new Date(`${f.days[0].date}T12:00:00Z`).getUTCDay() : 0;
  const detail = open ? f.days.find((d) => d.date === open) : null;

  return (
    <div className="forecast">
      {f.warning && (
        <p className={`warn w-${f.warning.weather}`} role="status" data-testid="warning">
          <WeatherIcon w={f.warning.weather} size={20} />
          <span>
            {f.warning.weather === "storm"
              ? t(
                  `${dateLong(f.warning.date, lang)}: ${cad(f.warning.short)} short${f.warning.cause ? ` after ${f.warning.cause.label}` : ""}.`,
                  `${dateLong(f.warning.date, lang)}${f.warning.cause ? `，${f.warning.cause.label} 之后` : ""}预计透支 ${cad(f.warning.short)}。`,
                )
              : t(
                  `${dateLong(f.warning.date, lang)}: ${cad(f.warning.short)} under your safety line${f.warning.cause ? ` after ${f.warning.cause.label}` : ""}.`,
                  `${dateLong(f.warning.date, lang)}${f.warning.cause ? `，${f.warning.cause.label} 之后` : ""}低于安全线 ${cad(f.warning.short)}。`,
                )}
          </span>
        </p>
      )}

      {day0 && (
        <section className="hero" aria-label={t("Today", "今天")}>
          <Sky w={day0.weather} />
          <button className="hero-btn" onClick={() => tapDay(day0.date)} data-date={day0.date}>
            <WeatherIcon key={day0.weather} w={day0.weather} size={88} title={w(day0.weather)} />
            <span className="hero-bal num" data-testid="today-balance">
              <CountUp value={day0.end} />
            </span>
            <span className="hero-w">{w(day0.weather)}</span>
          </button>
          {streak >= 2 && (
            <p className="streak" data-testid="streak">
              {t(`${streak} days without rain`, `连续 ${streak} 天没下雨`)}
            </p>
          )}
        </section>
      )}

      <section aria-label={t("Next 7 days", "未来 7 天")}>
        <div className="week">{f.days.slice(0, 7).map((d, i) => cell(d, i))}</div>
        <button className="link more" onClick={() => setMonth((m) => !m)} aria-expanded={month}>
          {month ? t("Hide 30 days", "收起 30 天") : t("30 days", "30 天")}
        </button>
        {month && (
          <div className="month" data-testid="month">
            {["S", "M", "T", "W", "T", "F", "S"].map((x, i) => (
              <span key={i} className="dow" aria-hidden="true">
                {lang === "zh" ? "日一二三四五六"[i] : x}
              </span>
            ))}
            {Array.from({ length: lead }, (_, i) => (
              <span key={`b${i}`} aria-hidden="true" />
            ))}
            {f.days.map((d, i) => cell(d, i, true))}
          </div>
        )}
      </section>

      <section className="spend" aria-labelledby="spend-h">
        <h2 id="spend-h">{t("Can I spend?", "我能花吗？")}</h2>
        <div className="chips">
          {PRESETS.map((p) => {
            const a = { label: t(p.en, p.zh), amount: p.amount };
            const on = armed?.label === a.label && armed.amount === a.amount;
            return (
              <button
                key={p.en}
                className={`chip ${on ? "on" : ""}`}
                aria-pressed={on}
                onPointerDown={(e) => down(e, a)}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={cancel}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setArmed(on ? null : a);
                  }
                }}
              >
                {a.label} <span className="num">{cad(p.amount)}</span>
              </button>
            );
          })}
          <form
            className="chip custom"
            onSubmit={(e) => {
              e.preventDefault();
              if (customOk) setArmed({ label: cad(customAmount), amount: customAmount });
            }}
          >
            <span aria-hidden="true">C$</span>
            <input inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label={t("Other amount", "其他金额")} placeholder="0" />
            <button disabled={!customOk} aria-label={t("Use this amount", "用这个金额")}>
              →
            </button>
          </form>
        </div>
        <p className="spend-msg" aria-live="polite" data-testid="spend-msg">
          {armed ? (
            <>
              {t(`Tap a day for ${armed.label}.`, `点一天放下「${armed.label}」。`)}{" "}
              <button className="link" onClick={() => setArmed(null)}>
                {t("Cancel", "取消")}
              </button>
            </>
          ) : news ? (
            <>
              {news.text}{" "}
              <button className="link" onClick={undo}>
                {t("Undo", "撤销")}
              </button>
            </>
          ) : null}
        </p>
        {extras.length > 0 && (
          <ul className="tried">
            {extras.map((x) => (
              <li key={x.id}>
                <span>
                  {dateLong(x.date, lang)} · {x.label} <span className="num">{cad(-x.amount)}</span>
                </span>
                <button className="x" onClick={() => removeExtra(x.id)} aria-label={t("Remove", "删除")}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {drag && (
        <div className="ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          {drag.a.label} {cad(drag.a.amount)}
        </div>
      )}

      {detail && <DaySheet d={detail} state={state} lang={lang} onClose={() => setOpen(null)} onRemove={removeExtra} />}
    </div>
  );
}

function DaySheet({ d, state, lang, onClose, onRemove }: { d: Day; state: State; lang: Lang; onClose: () => void; onRemove: (id: string) => void }) {
  const t = tr(lang);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const label = (fl: Flow) =>
    fl.kind === "daily" ? t("Everyday spending", "日常花销") : fl.kind === "actual" ? t("Logged spending", "记下的花销") : fl.kind === "save" ? t("Set aside", "存下") : fl.label;
  const sunny = sunnyLine(state.safety, effectiveDaily(state, d.date));
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-h" tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()} data-testid="day-sheet">
        <header>
          <WeatherIcon w={d.weather} size={32} />
          <h2 id="sheet-h">{dateLong(d.date, lang)}</h2>
          <button className="x" onClick={onClose} aria-label={t("Close", "关闭")}>
            ×
          </button>
        </header>
        <dl className="ledger">
          <div>
            <dt>{t("Start", "开始")}</dt>
            <dd className="num">{cad(d.start, true)}</dd>
          </div>
          {d.flows.map((fl, i) => (
            <div key={i} className={fl.kind}>
              <dt>
                {label(fl)}
                {fl.kind === "extra" && fl.ref && (
                  <button className="x" onClick={() => onRemove(fl.ref!)} aria-label={t("Remove", "删除")}>
                    ×
                  </button>
                )}
              </dt>
              <dd className={`num ${fl.amount > 0 ? "in" : ""}`}>{(fl.amount > 0 ? "+" : "") + cad(fl.amount, true)}</dd>
            </div>
          ))}
          <div className="total">
            <dt>{t("End", "结束")}</dt>
            <dd className="num">{cad(d.end, true)}</dd>
          </div>
        </dl>
        <p className="rule">
          {t(
            `Sunny ≥ ${cad(sunny)} · Cloudy ≥ ${cad(state.safety)} · Rain ≥ C$0 · Storm < C$0`,
            `晴 ≥ ${cad(sunny)} · 多云 ≥ ${cad(state.safety)} · 雨 ≥ C$0 · 暴雨 < C$0`,
          )}
        </p>
      </div>
    </div>
  );
}
