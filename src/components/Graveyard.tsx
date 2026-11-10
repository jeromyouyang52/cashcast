"use client";

/**
 * Subscriptions as tombstones. Each shows what it costs a year. Marking one cancelled
 * makes it bloom and takes it out of the forecast. We link to the service's own help
 * centre; we never cancel anything for the user.
 */
import { useState } from "react";
import type { State } from "@/lib/types";
import { cad, CADENCE, helpLink, PER_YEAR, tr, type Lang } from "@/lib/ui";
import { Tombstone } from "./Icons";

export function Graveyard({ state, lang, onChange }: { state: State; lang: Lang; onChange: (s: State) => void }) {
  const t = tr(lang);
  const [open, setOpen] = useState<string | null>(null);
  const subs = state.items.filter((i) => i.kind === "sub");
  const yearly = (a: number, c: keyof typeof PER_YEAR) => Math.abs(a) * PER_YEAR[c];
  const saved = subs.filter((s) => s.cancelled).reduce((s, i) => s + yearly(i.amount, i.cadence), 0);
  const paying = subs.filter((s) => !s.cancelled && s.on).reduce((s, i) => s + yearly(i.amount, i.cadence), 0);
  const set = (id: string, cancelled: boolean) => onChange({ ...state, items: state.items.map((i) => (i.id === id ? { ...i, cancelled } : i)) });

  if (!subs.length) {
    return (
      <section className="yard empty">
        <h1>{t("Subscriptions", "订阅")}</h1>
        <p className="quiet">{t("None found.", "没有找到订阅。")}</p>
      </section>
    );
  }

  return (
    <section className="yard" aria-labelledby="y-h">
      <h1 id="y-h">{t("Subscriptions", "订阅")}</h1>
      <dl className="yard-sum">
        <div>
          <dt>{t("A year", "一年")}</dt>
          <dd className="num">{cad(paying)}</dd>
        </div>
        {saved > 0 && (
          <div className="saved" data-testid="saved">
            <dt>{t("Saved a year", "一年省下")}</dt>
            <dd className="num">{cad(saved)}</dd>
          </div>
        )}
      </dl>
      <ul className="stones">
        {subs.map((s) => {
          const link = helpLink(s.name);
          const isOpen = open === s.id;
          return (
            <li key={s.id} className={s.cancelled ? "gone" : ""} data-testid="stone">
              <button className="stone-btn" onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}>
                <Tombstone bloom={!!s.cancelled} />
                <span className="stone-name">{s.name}</span>
                <span className="num stone-year">{t(`${cad(yearly(s.amount, s.cadence))}/yr`, `${cad(yearly(s.amount, s.cadence))}/年`)}</span>
              </button>
              {isOpen && (
                <div className="stone-more">
                  <span className="quiet num">
                    {cad(Math.abs(s.amount), true)} · {t(...CADENCE[s.cadence])}
                  </span>
                  {s.cancelled ? (
                    <button className="btn" onClick={() => set(s.id, false)}>
                      {t("Still paying", "还在付")}
                    </button>
                  ) : (
                    <>
                      {link && (
                        <a className="btn" href={link} target="_blank" rel="noopener noreferrer">
                          {t("Help page", "官方帮助")} ↗
                        </a>
                      )}
                      <button className="btn primary" onClick={() => set(s.id, true)}>
                        {t("I cancelled it", "我已取消")}
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
