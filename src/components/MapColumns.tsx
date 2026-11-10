"use client";

/** Shown only when a file's layout isn't recognised: say which column is which, once. */
import { useState } from "react";
import { dateOrder, type Mapping } from "@/lib/csv";
import { tr, type Lang } from "@/lib/ui";

export function MapColumns({ table, lang, onDone, onCancel }: { table: string[][]; lang: Lang; onDone: (m: Mapping) => void; onCancel: () => void }) {
  const t = tr(lang);
  const width = Math.max(...table.slice(0, 20).map((r) => r.length));
  const [head, setHead] = useState(true);
  const [date, setDate] = useState(0);
  const [desc, setDesc] = useState(Math.min(1, width - 1));
  const [mode, setMode] = useState<"one" | "two">("one");
  const [amount, setAmount] = useState(Math.min(2, width - 1));
  const [out, setOut] = useState(Math.min(2, width - 1));
  const [inn, setIn] = useState(Math.min(3, width - 1));
  const cols = Array.from({ length: width }, (_, j) => j);
  const name = (j: number) => (head ? table[0][j] || `#${j + 1}` : `#${j + 1}`);
  const sel = (v: number, set: (n: number) => void, label: string) => (
    <label className="map-field">
      <span>{label}</span>
      <select value={v} onChange={(e) => set(Number(e.target.value))}>
        {cols.map((j) => (
          <option key={j} value={j}>
            {name(j)}
          </option>
        ))}
      </select>
    </label>
  );
  const start = head ? 1 : 0;
  return (
    <section className="map" aria-labelledby="m-h">
      <h1 id="m-h">{t("Which column is which?", "哪一列是什么？")}</h1>
      <div className="preview" tabIndex={0}>
        <table>
          <tbody>
            {table.slice(0, 6).map((r, i) => (
              <tr key={i}>
                {cols.map((j) => (
                  <td key={j}>{r[j]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="check">
        <input type="checkbox" checked={head} onChange={(e) => setHead(e.target.checked)} /> {t("First row is a header", "第一行是表头")}
      </label>
      {sel(date, setDate, t("Date", "日期"))}
      {sel(desc, setDesc, t("Description", "描述"))}
      <div className="seg" role="radiogroup" aria-label={t("Amounts", "金额")}>
        <button role="radio" aria-checked={mode === "one"} onClick={() => setMode("one")}>
          {t("One amount column", "一列金额")}
        </button>
        <button role="radio" aria-checked={mode === "two"} onClick={() => setMode("two")}>
          {t("Money out + in", "支出 + 收入两列")}
        </button>
      </div>
      {mode === "one" ? sel(amount, setAmount, t("Amount", "金额")) : (
        <>
          {sel(out, setOut, t("Money out", "支出"))}
          {sel(inn, setIn, t("Money in", "收入"))}
        </>
      )}
      <div className="bar">
        <button className="btn" onClick={onCancel}>
          {t("Back", "返回")}
        </button>
        <button
          className="btn primary"
          onClick={() =>
            onDone({
              date,
              desc: [desc],
              amount: mode === "one" ? amount : -1,
              out: mode === "two" ? out : -1,
              in: mode === "two" ? inn : -1,
              balance: -1,
              sign: -1,
              flip: false,
              start,
              order: dateOrder(table.slice(start).map((r) => r[date] ?? "")),
            })
          }
        >
          {t("Continue", "继续")}
        </button>
      </div>
    </section>
  );
}
