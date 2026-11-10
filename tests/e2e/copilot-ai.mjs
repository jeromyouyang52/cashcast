/**
 * Copilot + Gemini against the mock (no real AI calls).
 * Start the app with: PAYPAL_CLIENT_ID=mock PAYPAL_CLIENT_SECRET=mock PAYPAL_API_BASE=http://127.0.0.1:4011 \
 *   GEMINI_API_KEY=mock-gemini GEMINI_API_BASE=http://127.0.0.1:4011 npx next start -p 3301
 * Then: BASE=http://localhost:3301 node tests/e2e/copilot-ai.mjs
 */
import { createRequire } from "node:module";
import { startMock } from "./paypal-mock.mjs";
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require("playwright");
} catch {
  pw = createRequire((process.env.NODE_PATH ?? "").split(":")[0] + "/x")("playwright");
}
const BASE = process.env.BASE ?? "http://localhost:3301";
let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failed++;
};
const { server, stats } = await startMock(4011);
const txn = { id: "CAP0000000001", at: "2026-11-09T15:00:00Z", name: "Jamie Rivera", amount: 40, currency: "CAD", fee: 1.46, net: 38.54, status: "completed", kind: "payment", captureId: "CAP0000000001", description: "Logo" };
const post = (b, origin = BASE) => fetch(`${BASE}/api/copilot`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(b) }).then(async (r) => [r.status, await r.json()]);

let [s, j] = await post({ task: "explain", txn, refunds: [], lang: "en", daily: 10 });
ok("explain comes from Gemini", s === 200 && j.source === "gemini" && j.lines[0].includes("(AI) Jamie Rivera paid $40.00"), JSON.stringify(j));
[s, j] = await post({ task: "refund", txn, refunds: [], lang: "en", reason: "duplicate", amount: 40 });
ok("refund note comes from Gemini with the exact amount", j.source === "gemini" && j.note.includes("$40.00"), JSON.stringify(j));
[s, j] = await post({ task: "refund", txn, refunds: [{ amount: 30 }], lang: "en", reason: "duplicate", amount: 20 });
ok("refund above what's left is rejected", s === 400 && j.error === "BAD_AMOUNT");
[s, j] = await post({ task: "explain", txn, lang: "en" }, "https://evil.example");
ok("cross-origin is refused", s === 403);
ok("Gemini mock was called twice", stats.gemini === 2, String(stats.gemini));

// UI: template first, then Gemini's wording; the note label says who drafted it.
const b = await pw.chromium.launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: "en-CA" })).newPage();
await p.goto(BASE);
await p.evaluate((t) => localStorage.setItem("cashcast.paypal", JSON.stringify({ txns: [t], refunds: [] })), txn);
await p.goto(BASE);
await p.click("[data-testid=sample]");
await p.click("[data-testid=tab-paypal]");
await p.click("[data-testid=pp-row] >> nth=0");
await p.waitForFunction(() => document.querySelector("[data-testid=copilot]")?.textContent?.includes("Copilot · Gemini"), null, { timeout: 15000 });
ok("UI shows Gemini's explanation", (await p.textContent("[data-testid=copilot]")).includes("(AI) Jamie Rivera"));
await p.click("[data-testid=pp-draft]");
await p.waitForFunction(() => document.querySelector("[data-testid=pp-note]")?.value.includes("(AI)"), null, { timeout: 15000 });
ok("UI note drafted by Gemini", (await p.textContent(".pp-note")).includes("Gemini"));
await p.fill("[data-testid=pp-note]", "my own words, refund $40.00");
ok("user edit wins", (await p.inputValue("[data-testid=pp-note]")) === "my own words, refund $40.00");
await b.close();
server.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
