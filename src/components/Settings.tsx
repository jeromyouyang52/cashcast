"use client";

import { useRef, useState } from "react";
import { exportFile, validate } from "@/lib/store";
import type { State } from "@/lib/types";
import { sunnyLine } from "@/lib/forecast";
import { effectiveDaily } from "@/lib/model";
import { cad, dateLong, tr, type Lang } from "@/lib/ui";

const num = (v: string) => Number(v.replace(/[,$\s]/g, ""));

function Field({ id, label, value, signed, onSave }: { id: string; label: string; value: number; signed?: boolean; onSave: (n: number) => void }) {
  const [v, setV] = useState(String(value));
  const n = num(v);
  const ok = v.trim() !== "" && Number.isFinite(n) && (signed || n >= 0);
  return (
    <div>
      <dt>
        <label htmlFor={id}>{label}</label>
      </dt>
      <dd>
        <span className="prefix">C$</span>
        <input id={id} inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => ok && n !== value && onSave(n)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      </dd>
    </div>
  );
}

export function Settings({
  state,
  lang,
  today,
  onChange,
  onEdit,
  onImportCSV,
  onWipe,
}: {
  state: State;
  lang: Lang;
  today: string;
  onChange: (s: State) => void;
  onEdit: () => void;
  onImportCSV: () => void;
  onWipe: () => void;
}) {
  const t = tr(lang);
  const [sure, setSure] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const backup = useRef<HTMLInputElement>(null);

  const download = () => {
    const url = URL.createObjectURL(exportFile(state));
    const a = document.createElement("a");
    a.href = url;
    a.download = `cashcast-backup-${today}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const restore = async (f: File) => {
    try {
      const s = validate(JSON.parse(await f.text()));
      if (!s) throw new Error("shape");
      onChange(s);
      setMsg(t("Backup restored.", "备份已恢复。"));
    } catch {
      setMsg(t("That isn't a Cashcast backup.", "这不是 Cashcast 的备份文件。"));
    }
  };

  return (
    <section className="settings" aria-labelledby="s-h">
      <h1 id="s-h">{t("Settings", "设置")}</h1>

      <dl className="fields">
        <Field id="s-bal" signed label={t(`Balance on ${dateLong(state.asOf, lang)}`, `${dateLong(state.asOf, lang)} 的余额`)} value={state.balance} onSave={(n) => onChange({ ...state, balance: n, asOf: today })} />
        <Field id="s-safe" label={t("Safety line", "安全线")} value={state.safety} onSave={(n) => onChange({ ...state, safety: n })} />
        <Field id="s-daily" label={t("Everyday spending per day", "每天日常花销")} value={state.daily} onSave={(n) => onChange({ ...state, daily: n })} />
        <div>
          <dt>
            <label htmlFor="s-pct">{t("Payday: suggest saving", "发薪日建议存下多余的")}</label>
          </dt>
          <dd>
            <select id="s-pct" value={Math.round(state.savePct * 100)} onChange={(e) => onChange({ ...state, savePct: Number(e.target.value) / 100 })}>
              {[0, 25, 50, 75, 100].map((p) => (
                <option key={p} value={p}>
                  {p}%
                </option>
              ))}
            </select>
          </dd>
        </div>
      </dl>

      <ul className="rows">
        <li>
          <span>{t("Pay, bills and subscriptions", "收入、固定支出和订阅")}</span>
          <button className="link" onClick={onEdit}>
            {t("Edit", "编辑")}
          </button>
        </li>
        <li>
          <span>{t("Bank history", "账单记录")}</span>
          <button className="link" onClick={onImportCSV}>
            {t("Import", "导入")}
          </button>
        </li>
        <li>
          <span>{t("Backup file", "备份文件")}</span>
          <span className="row-actions">
            <button className="link" onClick={download} data-testid="export">
              {t("Export", "导出")}
            </button>
            <button className="link" onClick={() => backup.current?.click()}>
              {t("Restore", "恢复")}
            </button>
          </span>
        </li>
        <li>
          <span>{t("Everything on this device", "本机上的所有数据")}</span>
          {sure ? (
            <span className="row-actions">
              <button className="link" onClick={() => setSure(false)}>
                {t("Keep", "保留")}
              </button>
              <button className="link danger" onClick={onWipe} data-testid="wipe-confirm">
                {t("Delete now", "立即删除")}
              </button>
            </span>
          ) : (
            <button className="link danger" onClick={() => setSure(true)} data-testid="wipe">
              {t("Delete", "删除")}
            </button>
          )}
        </li>
      </ul>
      {msg && (
        <p className="quiet" role="status">
          {msg}
        </p>
      )}
      <input
        ref={backup}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="restore"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) restore(f);
          e.target.value = "";
        }}
      />
      <p className="quiet">{t(`Sunny days above ${cad(sunnyLine(state.safety, effectiveDaily(state, today)))}.`, `余额高于 ${cad(sunnyLine(state.safety, effectiveDaily(state, today)))} 为晴。`)}</p>
    </section>
  );
}
