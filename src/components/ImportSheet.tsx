"use client";

/** The two ways to bring in a bank history: a CSV file, or text copied straight from the bank's page. */
import { useState } from "react";
import { tr, type Lang } from "@/lib/ui";
import { Sheet } from "./Today";

export function ImportSheet({ lang, onFile, onText, onClose, error }: { lang: Lang; onFile: () => void; onText: (text: string) => void; onClose: () => void; error: string | null }) {
  const t = tr(lang);
  const [text, setText] = useState("");
  return (
    <Sheet title={t("Bring in your bank history", "导入账单")} lang={lang} onClose={onClose}>
      <div className="import">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder={t("Paste transactions copied from your bank's website or app", "把网银或银行 App 里的交易记录复制后粘贴到这里")}
          aria-label={t("Pasted transactions", "粘贴的交易记录")}
          data-testid="paste"
        />
        <div className="bar">
          <button type="button" className="link" onClick={onFile} data-testid="choose-file">
            {t("Or choose a CSV file", "或者选择 CSV 文件")}
          </button>
          <button className="btn primary" disabled={!text.trim()} onClick={() => onText(text)} data-testid="paste-go">
            {t("Read it", "识别")}
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
