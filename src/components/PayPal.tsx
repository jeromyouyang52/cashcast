"use client";

/**
 * PayPal, sandbox only. Three things: make a test payment, see recent payments, and open one
 * to have Copilot explain it or draft a refund. A refund runs only after the user edits or
 * accepts the draft and confirms twice. Nothing is sent on its own.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { draftRefund, explain, money, REASONS, type Reason } from "@/lib/copilot";
import { merge, refundable, validAmount, type PPRefund, type PPTxn } from "@/lib/paypal";
import { loadPP, savePP, upsert, type PPLocal } from "@/lib/ppstore";
import { tr, type Lang } from "@/lib/ui";
import { Sheet } from "./Today";

type Status = { connected: true; currency: string } | { connected: false; reason: string } | null;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : `HTTP_${r.status}`);
  return j as T;
}

// Gemini's wording, per payment state, so reopening a payment doesn't ask again.
const aiCache = new Map<string, string[]>();
type AI = { source: "gemini"; lines?: string[]; note?: string } | { source: "template" };
const copilot = (body: Record<string, unknown>) => api<AI>("/api/copilot", body).catch((): AI => ({ source: "template" }));

const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

export function PayPal({ lang, daily, returned, onReturned }: { lang: Lang; daily?: number; returned?: { token?: string; cancelled?: boolean } | null; onReturned?: () => void }) {
  const t = tr(lang);
  const [status, setStatus] = useState<Status>(null);
  const [local, setLocal] = useState<PPLocal>({ txns: [], refunds: [] });
  const [remote, setRemote] = useState<PPTxn[]>([]);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sheet, setSheet] = useState<{ kind: "pay" } | { kind: "txn"; id: string } | null>(null);

  const keep = useCallback((f: (s: PPLocal) => PPLocal) => {
    setLocal((s) => {
      const n = f(s);
      savePP(n);
      return n;
    });
  }, []);

  const errText = useCallback(
    (code: string) =>
      code === "NOT_CONFIGURED"
        ? t("PayPal isn't connected.", "PayPal 未连接。")
        : code === "AUTH_FAILED"
          ? t("PayPal rejected the sandbox credentials.", "PayPal 拒绝了沙箱密钥。")
          : code === "LIVE_REFUSED"
            ? t("Only the PayPal sandbox is allowed.", "只允许 PayPal 沙箱。")
            : t(`PayPal said: ${code}`, `PayPal 返回：${code}`),
    [t],
  );

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ txns: PPTxn[] }>("/api/paypal/transactions?days=30");
      setRemote(r.txns);
      setSearchErr(null);
    } catch (e) {
      setSearchErr(String((e as Error).message));
    }
  }, []);

  useEffect(() => {
    setLocal(loadPP());
    api<Status>("/api/paypal/status")
      .then((s) => {
        setStatus(s);
        if (s?.connected) refresh();
      })
      .catch(() => setStatus({ connected: false, reason: "unreachable" }));
  }, [refresh]);

  // Back from PayPal's sandbox approval page: capture once, then forget the token.
  useEffect(() => {
    if (!returned) return;
    onReturned?.();
    if (returned.cancelled) {
      setMsg({ ok: false, text: t("Payment cancelled. Nothing was charged.", "已取消，没有扣款。") });
      return;
    }
    if (!returned.token) return;
    api<PPTxn>(`/api/paypal/orders/${encodeURIComponent(returned.token)}/capture`, {})
      .then((x) => {
        keep((s) => ({ ...s, txns: upsert(s.txns, x) }));
        setMsg({ ok: true, text: t(`Sandbox payment received: ${money(x.amount, x.currency, lang)}.`, `沙箱付款已到账：${money(x.amount, x.currency, lang)}。`) });
        setSheet({ kind: "txn", id: x.id });
      })
      .catch((e) => setMsg({ ok: false, text: errText(String((e as Error).message)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returned]);

  const txns = useMemo(() => merge(local.txns, remote), [local.txns, remote]);
  const open = sheet?.kind === "txn" ? txns.find((x) => x.id === sheet.id) : undefined;
  const loc = lang === "zh" ? "zh-CN" : "en-CA";

  return (
    <section className="pp" aria-labelledby="pp-h">
      <header className="pp-head">
        <h1 id="pp-h">PayPal</h1>
        <span className="tag">{t("Sandbox", "沙箱")}</span>
      </header>

      {msg && (
        <p className={msg.ok ? "pp-msg" : "error"} role="status" data-testid="pp-msg">
          {msg.text}
        </p>
      )}

      {status === null && <p className="quiet">…</p>}

      {status && !status.connected && (
        <div className="pp-off" data-testid="pp-off">
          <p>{status.reason === "live_refused" ? t("Only the PayPal sandbox is allowed.", "只允许 PayPal 沙箱。") : status.reason === "auth_failed" ? t("PayPal rejected the sandbox credentials.", "PayPal 拒绝了沙箱密钥。") : t("Not connected.", "未连接。")}</p>
          <p className="quiet">{t("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET from a sandbox app in the server environment.", "在服务器环境变量里设置沙箱应用的 PAYPAL_CLIENT_ID 和 PAYPAL_CLIENT_SECRET。")}</p>
        </div>
      )}

      {status?.connected && (
        <>
          <button className="btn primary" onClick={() => setSheet({ kind: "pay" })} data-testid="pp-pay">
            {t("Test payment", "测试付款")}
          </button>

          {txns.length ? (
            <ul className="pp-list" data-testid="pp-list">
              {txns.map((x) => (
                <li key={x.id}>
                  <button onClick={() => setSheet({ kind: "txn", id: x.id })} data-testid="pp-row">
                    <span className="pp-name">{x.name}</span>
                    <span className={`num ${x.amount >= 0 ? "in" : ""}`}>{money(x.amount, x.currency, lang)}</span>
                    <span className="quiet">{x.at ? new Date(x.at).toLocaleDateString(loc, { month: "short", day: "numeric" }) : ""}</span>
                    <span className={`quiet pp-st st-${x.status}`}>{t(...STATUS_LABEL[x.status])}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="quiet">{t("No sandbox payments yet.", "还没有沙箱交易。")}</p>
          )}
          {searchErr && (
            <p className="quiet" data-testid="pp-search-err">
              {/NOT_AUTHORIZED|PERMISSION/.test(searchErr)
                ? t("Transaction Search is off for this sandbox app, so only payments made here are listed.", "这个沙箱应用没开 Transaction Search，只显示在这里发起的付款。")
                : t("Couldn't load account activity. Payments made here are still listed.", "暂时读不到账户记录，这里发起的付款仍会显示。")}
            </p>
          )}
        </>
      )}

      {sheet?.kind === "pay" && status?.connected && <PaySheet lang={lang} currency={status.currency} onClose={() => setSheet(null)} errText={errText} />}

      {open && (
        <TxnSheet
          key={open.id}
          txn={open}
          refunds={local.refunds}
          lang={lang}
          daily={daily}
          errText={errText}
          onClose={() => setSheet(null)}
          onRefund={(r) => {
            keep((s) => ({ ...s, refunds: upsert(s.refunds, r) }));
            // Re-read the payment so its status reflects the refund.
            api<PPTxn>(`/api/paypal/captures/${r.captureId}`)
              .then((x) => keep((s) => ({ ...s, txns: upsert(s.txns, { ...x, name: open.name, description: open.description }) })))
              .catch(() => undefined);
          }}
        />
      )}
    </section>
  );
}

const STATUS_LABEL: Record<PPTxn["status"], [string, string]> = {
  completed: ["Completed", "已完成"],
  pending: ["Pending", "处理中"],
  refunded: ["Refunded", "已退款"],
  partially_refunded: ["Part refunded", "部分退款"],
  denied: ["Failed", "失败"],
  other: ["", ""],
};

function PaySheet({ lang, currency, onClose, errText }: { lang: Lang; currency: string; onClose: () => void; errText: (c: string) => string }) {
  const t = tr(lang);
  const [amount, setAmount] = useState("25.00");
  const [desc, setDesc] = useState(t("Logo design, first half", "Logo 设计首付"));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = validAmount(amount.replace(/[,$\s]/g, "")) !== null;
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ approve: string }>("/api/paypal/orders", { amount: Number(amount.replace(/[,$\s]/g, "")), description: desc, requestId: rid() });
      window.location.assign(r.approve);
    } catch (e) {
      setErr(errText(String((e as Error).message)));
      setBusy(false);
    }
  };
  return (
    <Sheet title={t("Test payment", "测试付款")} lang={lang} onClose={onClose}>
      <form
        className="pp-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok && !busy) go();
        }}
      >
        <label className="log-field">
          <span aria-hidden="true">{currency === "USD" ? "US$" : "C$"}</span>
          <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={t("Amount", "金额")} data-testid="pp-amount" />
        </label>
        <input className="pp-desc" value={desc} maxLength={127} onChange={(e) => setDesc(e.target.value)} aria-label={t("What it's for", "用途")} />
        <p className="quiet">{t("You'll approve it with a PayPal sandbox buyer account. No real money.", "用 PayPal 沙箱买家账号确认，不涉及真钱。")}</p>
        {err && <p className="error">{err}</p>}
        <button className="btn primary" disabled={!ok || busy} data-testid="pp-go">
          {busy ? "…" : t("Continue to PayPal sandbox", "去 PayPal 沙箱确认")}
        </button>
      </form>
    </Sheet>
  );
}

function TxnSheet({
  txn,
  refunds,
  lang,
  daily,
  errText,
  onClose,
  onRefund,
}: {
  txn: PPTxn;
  refunds: PPRefund[];
  lang: Lang;
  daily?: number;
  errText: (c: string) => string;
  onClose: () => void;
  onRefund: (r: PPRefund) => void;
}) {
  const t = tr(lang);
  const mine = refunds.filter((r) => r.captureId === txn.captureId);
  const key = `${txn.id}|${txn.status}|${mine.reduce((x, r) => x + r.amount, 0)}|${lang}`;
  const [aiLines, setAiLines] = useState<string[] | null>(() => aiCache.get(key) ?? null);
  const [thinking, setThinking] = useState(false);
  const lines = aiLines ?? explain(txn, refunds, lang, daily);
  const max = refundable(txn, refunds);

  // Ask Gemini for friendlier wording; the template shows until (and unless) it answers.
  useEffect(() => {
    const hit = aiCache.get(key);
    if (hit) return setAiLines(hit);
    let live = true;
    setAiLines(null);
    setThinking(true);
    copilot({ task: "explain", txn, refunds: mine, lang, daily }).then((r) => {
      if (!live) return;
      setThinking(false);
      if (r.source === "gemini" && r.lines?.length) {
        aiCache.set(key, r.lines);
        setAiLines(r.lines);
      }
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const [mode, setMode] = useState<"explain" | "refund" | "done">("explain");
  const [reason, setReason] = useState<Reason>("duplicate");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<PPRefund | null>(null);
  const [requestId] = useState(rid);
  const [noteBy, setNoteBy] = useState<"template" | "gemini" | "you" | "writing">("template");
  const seq = useRef(0);

  // Template note at once, then Gemini's version if it arrives before the user starts editing.
  const draft = (r: Reason) => {
    const d = draftRefund(txn, refunds, r, lang);
    setReason(r);
    setAmount(d.amount.toFixed(2));
    setNote(d.note);
    setArmed(false);
    const n = ++seq.current;
    setNoteBy("writing");
    copilot({ task: "refund", txn, refunds: mine, lang, reason: r, amount: d.amount }).then((x) => {
      if (n !== seq.current) return;
      if (x.source === "gemini" && x.note) {
        setNote(x.note);
        setNoteBy("gemini");
      } else setNoteBy("template");
    });
  };

  const value = validAmount(amount.replace(/[,$\s]/g, ""));
  const ok = value !== null && value <= max;

  const send = async () => {
    if (!ok || !txn.captureId) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<PPRefund>("/api/paypal/refunds", { captureId: txn.captureId, amount: value, currency: txn.currency, note, requestId, confirmed: true });
      setDone(r);
      setMode("done");
      onRefund(r);
    } catch (e) {
      setErr(errText(String((e as Error).message)));
      setArmed(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={txn.name} lang={lang} onClose={onClose}>
      <div className="copilot" data-testid="copilot">
        <span className="tag" aria-live="polite">{aiLines ? "Copilot · Gemini" : thinking ? "Copilot …" : "Copilot"}</span>
        {lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>

      {mode === "explain" && max > 0 && (
        <button
          className="btn"
          onClick={() => {
            draft(reason);
            setMode("refund");
          }}
          data-testid="pp-draft"
        >
          {t("Draft a refund", "起草退款")}
        </button>
      )}

      {mode === "refund" && (
        <form
          className="pp-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ok || busy) return;
            if (!armed) setArmed(true);
            else send();
          }}
        >
          <div className="chips" role="radiogroup" aria-label={t("Reason", "原因")}>
            {REASONS.map((r) => (
              <button type="button" key={r.key} role="radio" aria-checked={reason === r.key} className={`chip ${reason === r.key ? "on" : ""}`} onClick={() => draft(r.key)}>
                {t(r.en, r.zh)}
              </button>
            ))}
          </div>
          <label className="log-field">
            <span aria-hidden="true">{txn.currency === "USD" ? "US$" : "C$"}</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                seq.current++;
                if (noteBy === "writing") setNoteBy("template");
                setAmount(e.target.value);
                setArmed(false);
              }}
              aria-label={t("Refund amount", "退款金额")}
              data-testid="pp-refund-amount"
            />
          </label>
          {value !== null && value > max && <p className="error">{t(`At most ${money(max, txn.currency, lang)}.`, `最多 ${money(max, txn.currency, lang)}。`)}</p>}
          <label className="pp-note">
            <span className="quiet">
              {t("Note to the payer (editable)", "给付款人的话（可修改）")}
              {noteBy === "writing" ? " · …" : noteBy === "gemini" ? t(" · drafted by Gemini", " · Gemini 起草") : ""}
            </span>
            <textarea
              value={note}
              maxLength={255}
              rows={4}
              onChange={(e) => {
                seq.current++; // the user's words win over a late draft
                setNote(e.target.value);
                setNoteBy("you");
                setArmed(false);
              }}
              data-testid="pp-note"
            />
          </label>
          {err && <p className="error">{err}</p>}
          <div className="bar">
            <button type="button" className="btn" onClick={() => (armed ? setArmed(false) : setMode("explain"))}>
              {armed ? t("Not yet", "先不") : t("Back", "返回")}
            </button>
            <button className={`btn primary ${armed ? "confirm" : ""}`} disabled={!ok || busy} data-testid="pp-refund">
              {busy ? "…" : armed ? t(`Confirm: refund ${money(value ?? 0, txn.currency, lang)}`, `确认退款 ${money(value ?? 0, txn.currency, lang)}`) : t("Review refund", "检查退款")}
            </button>
          </div>
          {armed && <p className="quiet">{t("Sandbox only. The note goes to the payer with the refund.", "仅限沙箱。这段话会随退款发给付款人。")}</p>}
        </form>
      )}

      {mode === "done" && done && (
        <p className="pp-msg" role="status" data-testid="pp-refunded">
          {t(`Refunded ${money(done.amount, done.currency, lang)} in the sandbox · ${done.status.toLowerCase()}`, `已在沙箱退款 ${money(done.amount, done.currency, lang)} · ${done.status.toLowerCase()}`)}
        </p>
      )}
    </Sheet>
  );
}
