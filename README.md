# Cashcast

A small money assistant. Every day: one sentence, how much you can spend today, a 3-second check-in, and at most two reminders. Behind it, a 30-day cash "weather forecast" (sunny, cloudy, rain, storm) measured against your own safety line.

For people paid through PayPal, Cashcast adds a **PayPal tab (sandbox only)**: see recent payments, and have Copilot explain any one of them (gross, PayPal fee, what actually lands, how many days of spending that covers) or draft a refund with a note to the payer. **Nothing is sent on its own:** you edit the draft, press *Review refund*, then *Confirm*.

Live demo: https://cashcast-beta.vercel.app · A cash-flow calculator, not financial advice.

## Try it (judges)
1. Open the live demo → **Try a sample** → **PayPal** tab.
2. **Test payment** → enter an amount → **Continue to PayPal sandbox** → log in with a PayPal *sandbox* personal (buyer) account → Pay. You come back to Cashcast and the payment is captured.
3. Tap the payment: Copilot explains it. **Draft a refund** → pick a reason (amount and note are filled in, both editable) → **Review refund** → **Confirm**. The refund runs in the sandbox only.

Sandbox buyer credentials for judging are provided in the Devpost submission's testing notes (not in this repo).

## How Cashcast uses PayPal and AI
**PayPal (sandbox, REST APIs, called only from server routes in `src/app/api/paypal/*` via `src/server/paypal.ts`):**
- **OAuth 2.0 client credentials**: access token for the sandbox app; `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` live in server env only.
- **Orders v2**: create a test order (`intent: CAPTURE`, return/cancel URLs) → the buyer approves on PayPal's sandbox checkout → capture. `PayPal-Request-Id` makes create/capture/refund idempotent.
- **Payments v2**: read a capture (gross, PayPal fee, net) and refund it with a `note_to_payer`, only after the user confirms twice.
- **Transaction Search** (`/v1/reporting/transactions`): recent account activity (≤ 31 days), merged with payments made in the app.

**AI (Google Gemini, free Flash-Lite model, `src/server/gemini.ts`, `src/server/copilot.ts`, route `src/app/api/copilot`):**
- Explains one payment in plain words (who paid, the fee, what lands, how many days of everyday spending it covers), in English or Chinese.
- Drafts the refund note to the payer for the reason the user picks.
- Guardrails (`acceptLines` / `acceptNote` in `src/lib/copilot.ts`): the app passes the model every fact, payer-typed text is treated as data, and any answer that mentions an amount the app didn't supply, or leaves out the exact refund amount, is discarded in favour of a built-in template. The model never decides amounts and never triggers a refund.
- Optional: without `GEMINI_API_KEY` Copilot uses the templates, so the app still works.

## Run it yourself
    npm install
    cp .env.example .env.local     # add a PayPal SANDBOX app's client id + secret (and optionally GEMINI_API_KEY)
    npm run dev                    # http://localhost:3000

Get sandbox credentials at developer.paypal.com → Apps & Credentials → **Sandbox** → Create App. Turn on *Transaction Search* in the app's features to list account activity (it can lag a few hours; payments made in Cashcast show immediately either way).

## Safety rails
- **Sandbox only.** The API host is hard-coded to `api-m.sandbox.paypal.com`. `PAYPAL_ENV` other than `sandbox`, or any `PAYPAL_API_BASE` that isn't `http://localhost`/`127.0.0.1` (a test mock), is refused with `LIVE_REFUSED`. Approval links that aren't on `sandbox.paypal.com` are rejected.
- **Human in the loop.** Refunds need two presses in the UI and `confirmed: true` on the request; POSTs must be same-origin; refunds use idempotency keys.
- **Secrets stay on the server.** Credentials are read from server env only (never `NEXT_PUBLIC_`), never returned by any route, never logged. Logs contain the route and PayPal's error name, nothing else.
- **AI writes words, not numbers.** Gemini (free tier, optional `GEMINI_API_KEY`) rewords Copilot's explanation and refund note. The app passes it the facts, treats payer-typed text as data, and throws away any answer that mentions an amount it didn't supply or leaves out the exact refund amount; the built-in template is used instead. The AI never triggers a refund.
- **Bank data stays in the browser.** Bank files and pasted text are parsed locally and saved in localStorage; they never reach the server or PayPal. Payer emails are dropped server-side.

## Tests
    npm test                                   # unit: CSV formats, detection, engine, assistant, paste, PayPal client, Copilot, Gemini guardrails
    npm run build
    PAYPAL_CLIENT_ID=mock PAYPAL_CLIENT_SECRET=mock PAYPAL_API_BASE=http://127.0.0.1:4010 npx next start -p 3300 &
    npm run e2e                                # Playwright: app flows
    node tests/e2e/paypal.mjs                  # Playwright: PayPal flow against a local mock of the sandbox API
    # Copilot + Gemini against the same mock (no real AI calls):
    PAYPAL_CLIENT_ID=mock PAYPAL_CLIENT_SECRET=mock PAYPAL_API_BASE=http://127.0.0.1:4011 GEMINI_API_KEY=mock-gemini GEMINI_API_BASE=http://127.0.0.1:4011 npx next start -p 3301 &
    BASE=http://localhost:3301 node tests/e2e/copilot-ai.mjs

## Code map
- `src/server/paypal.ts` — sandbox-only PayPal REST client (OAuth, Orders v2, Payments v2 captures/refunds, Transaction Search).
- `src/app/api/paypal/*` — route handlers; `src/server/route.ts` — same-origin guard, error mapping.
- `src/lib/paypal.ts` — normalising PayPal JSON, ids, amounts, refundable balance.
- `src/lib/copilot.ts` — template explanations and refund drafts (bilingual) plus the guardrails for AI wording.
- `src/server/gemini.ts`, `src/server/copilot.ts`, `src/app/api/copilot` — Gemini writes Copilot's wording; the app owns every number and rejects answers that invent one.
- `src/components/PayPal.tsx` — the PayPal tab.
- `src/lib/model.ts`, `forecast.ts`, `detect.ts`, `csv.ts`, `paste.ts`, `voice.ts` — the assistant and forecast.
- `/llms.txt` — the same rules in plain text for agents.

MIT licensed.
