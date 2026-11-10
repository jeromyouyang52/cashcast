export const dynamic = "force-static";

/** A plain map of Cashcast for agents. Same facts as the code; no user data exists server-side. */
const BODY = `# Cashcast

A small money assistant. Each day: one sentence, how much you can spend today, a 3-second check-in,
and at most two reminders. Behind it, a 30-day cash weather forecast. A cash-flow calculator, not financial advice.
Bank data never leaves the browser: no accounts, no analytics. Data lives in localStorage ("cashcast.v1").
The only server code is a PayPal SANDBOX relay under /api/paypal/* and Copilot wording at /api/copilot (see below).

## Pages
- /         The app. Three ways in: "Start in 30 seconds" (4 questions: balance + a normal week of spending,
            pay amount/date/cadence, rent amount/day, which monthly bills), "Import bank history" (paste text copied
            from a bank page, or a CSV file), or "Try a sample". Then:
            Today (brief) · Forecast (7/30 days, "Can I spend?") · Goals (savings) · Subs (graveyard) · PayPal (sandbox) · Settings
- /privacy  Three-sentence privacy statement (en + zh)

## Flow
1. CSV is decoded (UTF-8, GB18030, Windows-1252) and parsed locally. Account and card numbers are dropped.
2. Recurring pay, bills and subscriptions are detected by merchant key + amount (±15%) + cadence
   (weekly 7±1, biweekly 14±2, monthly ~30±4, yearly ~365±10 days). Confidence < 0.6 → "Maybe", off by default.
3. Everyday spending = non-recurring outflows over the last 90 days of the file ÷ days (single items > max(400, 4× median) excluded).
4. Forecast, day by day: start + recurring due + tried-out purchases − everyday spending = end.

## Weather (S = user's safety line, D = everyday spending per day)
- sunny   end ≥ max(2S, S + 7D)
- cloudy  S ≤ end < sunny line
- rain    0 ≤ end < S
- storm   end < 0
Warning: first rain or storm in the next 7 days, with the biggest outflow before it.

## Assistant rules
- Today you can spend = min over each day k until the day before next pay (or 30 days) of
  (balance at end of day k with no everyday spending − safety line) ÷ (days 0..k), floored, never below 0.
  Minus anything logged today. If even zero spending dips under the line: say by how much and suggest moving the biggest bill/subscription before payday.
- Check-in: "today I spent about X" (one number, no categories). It replaces the average on that day and moves the balance forward.
  Everyday spending = (file average × 14 + logged days in the last 28) ÷ (14 + logged days).
- Payday (pay date within the last 2 days, nothing set aside yet this cycle): surplus = lowest balance before next pay − safety line;
  suggestion = surplus × save % (default 50%), rounded down to C$10.
- Goals: up to 3, local only. "I set this aside" lowers the forecast from that day. No money moves.
- Reminders (max 2 shown, swipe away for good): payday saving > bills in the next 3 days > price rise on a bill/subscription >
  new merchant in the last 14 days at > 3× a typical purchase (≥ C$50) > a category's last 30 days ≥ 130% and ≥ C$40 above its usual.
- All wording lives in src/lib/voice.ts; all rules in src/lib/model.ts and src/lib/insights.ts.

## PayPal (sandbox only)
Server routes (credentials from server env PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET, never sent to the browser).
Host fixed to api-m.sandbox.paypal.com; PAYPAL_ENV other than "sandbox", or any non-localhost PAYPAL_API_BASE, is refused (LIVE_REFUSED).
- GET  /api/paypal/status                 {connected, env:"sandbox", currency} | {connected:false, reason}
- POST /api/paypal/orders                 {amount 0.01–500, description} → {id, approve}  (user approves on sandbox.paypal.com)
- POST /api/paypal/orders/{id}/capture    after return to /?paypal=return&token=… → normalised payment
- GET  /api/paypal/captures/{id}          one payment
- GET  /api/paypal/transactions?days=30   Transaction Search (≤31 days; needs the feature on the sandbox app)
- POST /api/paypal/refunds                {captureId, amount, currency, note, confirmed:true} — only after the user confirms twice in the UI
POSTs must be same-origin. Errors return PayPal's error name only. Payer emails are dropped.
Copilot (src/lib/copilot.ts): explains a payment (gross, fee, net, status, days of everyday spending) and drafts a refund
(reason → amount + note to payer ≤255 chars). Drafts are editable; nothing is sent without confirmation.
- POST /api/copilot  {task:"explain"|"refund", txn, refunds, lang, daily?, reason?, amount?} → {source:"gemini", lines|note} | {source:"template"}
  Gemini (server env GEMINI_API_KEY, free Flash-Lite) writes wording only. The app supplies every number and rejects any answer
  that invents an amount or omits the exact refund amount; then the template wording stays. Never moves money.
Local record of sandbox payments/refunds: localStorage "cashcast.paypal".

## Pasted text
Tab-separated tables (copied from a desktop page) go through the CSV reader. Otherwise lines are read loosely:
a date starts a transaction, text lines are the description, the first amount closes it (a second amount is the balance).
"-", "(…)" or "DR" = money out; "+", "CR" or an income word = money in; a bare amount = money out. See src/lib/paste.ts.

## CSV formats recognised
RBC, TD, BMO, CIBC, Scotiabank, Tangerine, Simplii, EQ Bank, Wealthsimple, plus generic files with a header
(date / description / amount or debit+credit / balance, English or Chinese headers). Unknown layouts ask the user to map columns.

## Code (for contributors)
- src/lib/csv.ts       decode, tokenize, detect columns, BANKS list. New bank = fixture in tests/fixtures + BANKS entry.
- src/lib/detect.ts    recurrence detection
- src/lib/forecast.ts  pure engine: forecast(input) → { days, warning }
- src/lib/types.ts     all shared types
`;

export function GET() {
  return new Response(BODY, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
