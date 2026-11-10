"use client";

/**
 * The whole app on one screen. Four states:
 *   no data  → Drop        (drag a CSV or try the sample)
 *   mapping  → MapColumns  (only when a file's layout isn't recognised)
 *   draft    → Confirm     (check what was found, then forecast)
 *   saved    → Forecast / Graveyard / Settings
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { parseCSV, sorted, toTxns, type Mapping } from "@/lib/csv";
import { today as todayISO } from "@/lib/dates";
import { effectiveDaily, fromTxns } from "@/lib/model";
import { PayPal } from "./PayPal";
import { sampleCSV } from "@/lib/sample";
import { load, save, wipe } from "@/lib/store";
import type { State } from "@/lib/types";
import { initialLang, saveLang, tr, type Lang } from "@/lib/ui";
import { Confirm } from "./Confirm";
import { ForecastView } from "./Forecast";
import { Goals } from "./Goals";
import { Graveyard } from "./Graveyard";
import { Gear, Lock, Logo } from "./Icons";
import { MapColumns } from "./MapColumns";
import { Settings } from "./Settings";
import { Sky } from "./Sky";
import { Today } from "./Today";
import { ImportSheet } from "./ImportSheet";
import { QuickSetup } from "./QuickSetup";
import { parsePasted } from "@/lib/paste";
import type { Weather } from "@/lib/types";

type View = "today" | "forecast" | "goals" | "subs" | "paypal" | "settings";
const MAX_BYTES = 5 * 1024 * 1024;

export default function App() {
  const [ready, setReady] = useState(false);
  const [lang, setLangState] = useState<Lang>("en");
  const [state, setState] = useState<State | null>(null);
  const [draft, setDraft] = useState<State | null>(null);
  const [table, setTable] = useState<string[][] | null>(null);
  const [view, setView] = useState<View>("today");
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [today, setToday] = useState("");
  const [setup, setSetup] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Coming back from PayPal's sandbox approval page (?paypal=return&token=… or ?paypal=cancel).
  const [ppReturn, setPpReturn] = useState<{ token?: string; cancelled?: boolean } | null>(null);
  // The front door shows the idea before any data: the sky cycles through the four kinds of weather.
  const [preview, setPreview] = useState<Weather>("sunny");
  useEffect(() => {
    if (state || draft || table || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const seq: Weather[] = ["sunny", "cloudy", "rain", "sunny", "storm", "cloudy"];
    let i = 0;
    const id = setInterval(() => setPreview(seq[++i % seq.length]), 3200);
    return () => clearInterval(id);
  }, [state, draft, table]);
  const t = tr(lang);

  useEffect(() => {
    setLangState(initialLang());
    setState(load());
    setToday(todayISO());
    const q = new URLSearchParams(window.location.search);
    const pp = q.get("paypal");
    if (pp === "return" || pp === "cancel") {
      setPpReturn(pp === "cancel" ? { cancelled: true } : { token: q.get("token") ?? undefined });
      setView("paypal");
      // Drop the order token and payer id from the address bar and history.
      window.history.replaceState(null, "", window.location.pathname);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  const setLang = (l: Lang) => {
    setLangState(l);
    saveLang(l);
  };

  const commit = useCallback((s: State) => {
    setState(s);
    save(s);
  }, []);

  const takeTxns = useCallback(
    (txns: ReturnType<typeof parseCSV>["txns"]) => {
      if (txns.length < 5) {
        setError("few");
        return;
      }
      setError(null);
      setTable(null);
      setImportOpen(false);
      setDraft(fromTxns(txns, todayISO(), "csv"));
    },
    [],
  );

  const readFile = useCallback(
    async (file: File) => {
      setError(null);
      if (file.size > MAX_BYTES) return setError("big");
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const r = parseCSV(bytes);
        if (!r.mapping) {
          setTable(r.table);
          return;
        }
        takeTxns(r.txns);
      } catch {
        // Never log the file or its contents.
        setError("read");
      }
    },
    [takeTxns],
  );

  const readText = (text: string) => {
    try {
      takeTxns(parsePasted(text));
    } catch {
      setError("read");
    }
  };

  const sample = () => {
    const d = todayISO();
    const s = fromTxns(parseCSV(sampleCSV(d)).txns, d, "demo");
    setDraft(null);
    setTable(null);
    setView("today");
    commit(s);
  };

  // A CSV can be dropped anywhere, any time.
  const depth = useRef(0);
  useEffect(() => {
    const hasFile = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFile(e)) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFile(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setOver(false);
    };
    const overFn = (e: DragEvent) => hasFile(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!hasFile(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) readFile(f);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overFn);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overFn);
      window.removeEventListener("drop", drop);
    };
  }, [readFile]);

  const fileInput = useRef<HTMLInputElement>(null);
  const pick = () => fileInput.current?.click();
  const input = (
    <input
      ref={fileInput}
      type="file"
      accept=".csv,text/csv,.txt"
      hidden
      data-testid="file"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) readFile(f);
        e.target.value = "";
      }}
    />
  );

  const errorText =
    error === "big"
      ? t("That file is over 5 MB. Export a shorter date range.", "文件超过 5 MB，请导出短一点的时间段。")
      : error === "few"
        ? t("Fewer than 5 transactions found. Export at least 2–3 months.", "交易少于 5 笔，请至少导出 2–3 个月。")
        : error === "read"
          ? t("Couldn't read that. Try copying a few more rows, or a CSV file.", "没能识别，试试多复制几行，或者用 CSV 文件。")
          : null;

  const importSheet = importOpen && (
    <ImportSheet
      lang={lang}
      error={errorText}
      onClose={() => {
        setImportOpen(false);
        setError(null);
      }}
      onFile={pick}
      onText={readText}
    />
  );

  if (!ready) return <main className="shell" />;

  const foot = (
    <footer className="foot">
      <span>{t("A cash-flow calculator, not financial advice.", "现金流计算工具，不构成财务建议。")}</span>
      <nav>
        <a href="/privacy">{t("Privacy", "隐私")}</a>
        <button className="link" onClick={() => setLang(lang === "zh" ? "en" : "zh")} lang={lang === "zh" ? "en" : "zh"}>
          {lang === "zh" ? "English" : "中文"}
        </button>
      </nav>
    </footer>
  );

  const dropShade = over && (
    <div className="drop-shade" aria-hidden="true">
      <span>{t("Drop to forecast", "松手生成预报")}</span>
    </div>
  );

  if (table) {
    return (
      <main className="shell">
        {input}
        {dropShade}
        <MapColumns table={table} lang={lang} onCancel={() => setTable(null)} onDone={(m: Mapping) => takeTxns(sorted(toTxns(table, m)))} />
        {errorText && <p className="error" role="alert">{errorText}</p>}
        {foot}
      </main>
    );
  }

  if (draft) {
    return (
      <main className="shell">
        {input}
        {dropShade}
        <Confirm
          draft={draft}
          lang={lang}
          onCancel={() => setDraft(null)}
          onDone={(s) => {
            setDraft(null);
            setView("today");
            // A new bank file replaces the numbers, not the user's own goals, savings and check-ins.
            commit(state && state.source !== "demo" && s !== state ? { ...s, goals: state.goals, saves: state.saves, checkins: state.checkins, savePct: state.savePct, dismissed: state.dismissed } : s);
          }}
        />
        {foot}
      </main>
    );
  }

  if (!state && view === "paypal") {
    return (
      <main className="shell">
        <header className="top">
          <button className="brand" onClick={() => setView("today")} aria-label="Cashcast">
            <Logo /> <span className="brand-word">Cashcast</span>
          </button>
        </header>
        <PayPal lang={lang} returned={ppReturn} onReturned={() => setPpReturn(null)} />
        {foot}
      </main>
    );
  }

  if (!state && setup) {
    return (
      <main className="shell">
        <QuickSetup
          lang={lang}
          today={today}
          onCancel={() => setSetup(false)}
          onDone={(s) => {
            setSetup(false);
            setView("today");
            commit(s);
          }}
        />
        {foot}
      </main>
    );
  }

  if (!state) {
    return (
      <main className="shell">
        {input}
        {dropShade}
        {importSheet}
        <section className={`drop ${over ? "over" : ""}`} aria-labelledby="drop-h">
          <Sky w={over ? "rain" : preview} full />
          <Logo />
          <h1 id="drop-h">{t("How much can I spend today?", "今天能花多少？")}</h1>
          <div className="drop-actions">
            <button className="btn primary shine" onClick={() => setSetup(true)} data-testid="start">
              {t("Start in 30 seconds", "30 秒开始")}
            </button>
          </div>
          <div className="drop-links">
            <button className="link" onClick={() => setImportOpen(true)} data-testid="import">
              {t("Import bank history", "导入账单")}
            </button>
            <button className="link" onClick={sample} data-testid="sample">
              {t("Try a sample", "先看看示例")}
            </button>
          </div>
          <p className="quiet">
            <Lock /> {t("Stays on this device. No bank login.", "只存在你的手机上，不用登录银行。")}
          </p>
          {errorText && !importOpen && (
            <p className="error" role="alert">
              {errorText}
            </p>
          )}
        </section>
        {foot}
      </main>
    );
  }

  return (
    <main className="shell">
      {input}
      {dropShade}
      {importSheet}
      <header className="top">
        <button className="brand" onClick={() => setView("today")} aria-label="Cashcast">
          <Logo /> <span className="brand-word">Cashcast</span>
        </button>
        <nav className="tabs" aria-label={t("Views", "视图")}>
          <button aria-current={view === "today" ? "page" : undefined} onClick={() => setView("today")}>
            {t("Today", "今天")}
          </button>
          <button aria-current={view === "forecast" ? "page" : undefined} onClick={() => setView("forecast")}>
            {t("Forecast", "预报")}
          </button>
          <button aria-current={view === "goals" ? "page" : undefined} onClick={() => setView("goals")}>
            {t("Goals", "存钱")}
          </button>
          <button aria-current={view === "subs" ? "page" : undefined} onClick={() => setView("subs")}>
            {t("Subs", "订阅")}
          </button>
          <button aria-current={view === "paypal" ? "page" : undefined} onClick={() => setView("paypal")} data-testid="tab-paypal">
            PayPal
          </button>
          <button className="icon" aria-label={t("Settings", "设置")} aria-current={view === "settings" ? "page" : undefined} onClick={() => setView("settings")}>
            <Gear />
          </button>
        </nav>
      </header>
      {state.source === "demo" && (
        <div className="demo-bar">
          <span>{t("Sample data", "示例数据")}</span>
          <button
            className="link"
            onClick={() => {
              wipe();
              setState(null);
              setSetup(true);
            }}
          >
            {t("Use my own numbers", "换成我自己的")}
          </button>
        </div>
      )}
      {errorText && (
        <p className="error" role="alert">
          {errorText}
        </p>
      )}
      {view === "today" && <Today state={state} today={today} lang={lang} onChange={commit} go={setView} />}
      {view === "goals" && <Goals state={state} today={today} lang={lang} onChange={commit} />}
      {view === "forecast" && <ForecastView state={state} today={today} lang={lang} onChange={commit} />}
      {view === "paypal" && <PayPal lang={lang} daily={effectiveDaily(state, today)} returned={ppReturn} onReturned={() => setPpReturn(null)} />}
      {view === "subs" && <Graveyard state={state} lang={lang} onChange={commit} />}
      {view === "settings" && (
        <Settings
          state={state}
          lang={lang}
          today={today}
          onChange={commit}
          onEdit={() => setDraft(state)}
          onImportCSV={() => setImportOpen(true)}
          onWipe={() => {
            wipe();
            setState(null);
            setView("today");
          }}
        />
      )}
      {foot}
    </main>
  );
}
