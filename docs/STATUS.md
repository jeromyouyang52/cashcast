# Cashcast — status (2026-11-09)

Live: https://cashcast-beta.vercel.app (Vercel project `cashcast`, prj_zXu1BgkBMkXn5cpD5EJ3rttWi8Mn). Separate from Rollvest.

## 2026-11-09 (c): PayPal sandbox + Copilot (PayPal AI Hackathon, due Thu Nov 12 12:00 PT)
- New PayPal tab: status, test payment (Orders v2 → approve on sandbox.paypal.com → capture), recent payments (Transaction Search + payments made here), Copilot explain + refund draft with two-step confirm.
- Server routes /api/paypal/* — sandbox host hard-coded; live refused; same-origin POSTs; no secrets/bodies in logs.
- Needs Vercel env PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET (sandbox, set by the owner). Without them the tab says "Not connected".
- AI model not chosen yet; Copilot uses templates (src/lib/copilot.ts) until then.
- Tests: 71 unit, 52 + 23 end-to-end (PayPal against a local mock).
- Owner to do: Devpost registration, PayPal sandbox app, Vercel env vars, public GitHub repo, YouTube upload, final submit.

## 2026-11-09 (b): no file needed
- Front door: "Start in 30 seconds" asks 4 questions (balance + weekly spending, pay, rent, monthly bills) and lands on Today.
- "Import bank history": paste text copied from any bank page (loose line reader + table reader) or pick a CSV.
- Demo users: "Use my own numbers" goes straight to the 4 questions.
- Tests: 53 unit, 52 end-to-end.

## 2026-11-09: assistant redesign
- Home is now Today: one sentence, "today you can spend C$X" (tap for the full working), a 3-second check-in, up to 2 reminders.
- Check-ins (one number a day) move the balance forward and blend into everyday spending; balance can be corrected from the same sheet.
- Goals tab: up to 3 savings goals, "I set this aside" records progress locally and lowers the forecast. Payday card suggests a share (default 50%) of the surplus.
- Reminders: payday saving, bills in 3 days, price rises, unfamiliar charges, category running hot. Swiped-away ones stay gone.
- Bills/subscriptions now use the latest price (so a hike flows into the forecast). All wording in src/lib/voice.ts.
- Data v1 → v2 migrates automatically; backups include check-ins, goals, savings, reminders state.
- Tests: 45 unit, 46 end-to-end.

## Built (2026-11-08)
- Drop a bank CSV or "Try a sample"; parsed in the browser, never uploaded. UTF-8 / GB18030 / Windows-1252.
- Recognised: RBC, TD, BMO, CIBC (card), Scotiabank, Tangerine, Simplii, EQ Bank, Wealthsimple, Chinese-header files; anything else → column mapping.
- Detects pay, bills, subscriptions (with confidence; low ones under "Maybe", off by default) and everyday spending.
- Confirm screen: every item editable; balance, safety line, everyday spending.
- Forecast: today + 7-day strip + 30-day grid; sunny / cloudy / rain / storm against the user's safety line; 7-day warning naming the cause; tap a day for the full ledger.
- Can I spend?: presets or own amount; drag onto a day or tap-then-tap; says which day changes; undo.
- Subscription graveyard: yearly cost, official help link, "I cancelled it" → bloom + yearly savings, removed from forecast.
- Dry-day streak from history (positive only).
- Settings: balance / safety / spending, edit items, new CSV, export / restore backup, delete everything.
- en / 中文, light / dark, 390px, keyboard, reduced motion. /privacy, /llms.txt. No backend, no analytics, strict CSP.

## Tests
- `npm test`: unit tests (all 10 fixtures, values, dates, engine, detection, demo story on 48 dates).
- `npm run e2e`: 37 Playwright checks incl. drag-and-drop, backup/wipe/restore, no third-party requests.

## Open
- Bank layouts come from fictional fixtures; verify against real exports from friends.
- Phase-0 competitor research was skipped at the owner's request.
- Vercel Deployment Protection is on by default; turn it off if the link asks for a Vercel login.
