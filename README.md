# Cashcast

A small money assistant. Every day: one sentence, how much you can spend today, a 3-second check-in, and at most two reminders. Behind it, a 30-day cash "weather forecast" (sunny, cloudy, rain, storm) measured against your own safety line.

For people paid through PayPal, Cashcast adds a **PayPal tab (sandbox only)**: see recent payments, and have Copilot explain any one of them (gross, PayPal fee, what actually lands, how many days of spending that covers) or draft a refund with a note to the payer. **Nothing is sent on its own:** you edit the draft, press *Review refund*, then *Confirm*.

Live demo: https://cashcast-beta.vercel.app · A cash-flow calculator, not financial advice.

## Try it (judges)
1. Open the live demo → **Try a sample** → **PayPal** tab.
2. **Test payment** → enter an amount → **Continue to PayPal sandbox** → log in with a PayPal *sandbox* personal (buyer) account → Pay. You come back to Cashcast and the payment is captured.
3. Tap the payment: Copilot explains it. **Draft a refund** → pick a reason (amount and note are filled in, both editable) → **Review refund** → **Confirm**. The refund runs in the sandbox only.

Sandbox buyer credentials for judging are provided in the Devpost submission's testing notes (not in this repo).

## Run it yourself
    npm install
    cp .env.example .env.local     # add a PayPal SANDBOX app's client id + secret
    npm run dev                    # http://localhost:3000

Get sandbox credentials at developer.paypal.com → Apps & Credentials → **Sandbox** → Create App. Turn on *Transaction Search* in the app's features to list account activity (it can lag a few hours; payments made in Cashcast show immediately either way).

## Safety rails
- **Sandbox only.** The API host is hard-coded to `api-m.sandbox.paypal.com`. `PAYPAL_ENV` other than `sandbox`, or any `PAYPAL_API_BASE` that isn't `http://localhost`/`127.0.0.1` (a test mock), is refused with `LIVE_REFUSED`. Approval links that aren't on `sandbox.paypal.com` are rejected.
- **Human in the loop.** Refunds need two presses in the UI and `confirmed: true` on the request; POSTs must be same-origin; refunds use idempotency keys.
- **Secrets stay on the server.** Credentials are read from server env only (never `NEXT_PUBLIC_`), never returned by any route, never logged. Logs contain the route and PayPal's error name, nothing else.
- **Bank data stays in the browser.** Bank files and pasted text are parsed locally and saved in localStorage; they never reach the server or PayPal. Payer emails are dropped server-side.

## Tests
    npm test                                   # unit: CSV formats, detection, engine, assistant, paste, PayPal client + Copilot
    npm run build
    PAYPAL_CLIENT_ID=mock PAYPAL_CLIENT_SECRET=mock PAYPAL_API_BASE=http://127.0.0.1:4010 npx next start -p 3300 &
    npm run e2e                                # Playwright: app flows
    node tests/e2e/paypal.mjs                  # Playwright: PayPal flow against a local mock of the sandbox API

## Code map
- `src/server/paypal.ts` — sandbox-only PayPal REST client (OAuth, Orders v2, Payments v2 captures/refunds, Transaction Search).
- `src/app/api/paypal/*` — route handlers; `src/server/route.ts` — same-origin guard, error mapping.
- `src/lib/paypal.ts` — normalising PayPal JSON, ids, amounts, refundable balance.
- `src/lib/copilot.ts` — explanations and refund drafts (bilingual).
- `src/components/PayPal.tsx` — the PayPal tab.
- `src/lib/model.ts`, `forecast.ts`, `detect.ts`, `csv.ts`, `paste.ts`, `voice.ts` — the assistant and forecast.
- `/llms.txt` — the same rules in plain text for agents.

MIT licensed.
