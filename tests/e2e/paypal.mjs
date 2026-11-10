/**
 * PayPal sandbox flow against a mock PayPal API.
 * Start the app with: PAYPAL_CLIENT_ID=mock PAYPAL_CLIENT_SECRET=mock PAYPAL_API_BASE=http://127.0.0.1:4010 npx next start -p 3300
 * Then: node tests/e2e/paypal.mjs   (starts the mock itself)
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { startMock } from "./paypal-mock.mjs";
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require("playwright");
} catch {
  pw = createRequire((process.env.NODE_PATH ?? "").split(":")[0] + "/x")("playwright");
}
const BASE = process.env.BASE ?? "http://localhost:3300";
const SHOTS = "docs/screenshots";
mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failed++;
};

const { server, stats } = await startMock(4010);
const b = await pw.chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: "en-CA" });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));

// Server-side guards
const st = await (await fetch(`${BASE}/api/paypal/status`)).json();
ok("status: connected to sandbox (mock)", st.connected === true && st.env === "sandbox", JSON.stringify(st));
ok("status never returns credentials", !JSON.stringify(st).includes("mock") || st.currency === "CAD");
const cross = await fetch(`${BASE}/api/paypal/refunds`, { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: JSON.stringify({ captureId: "CAP0001MOCKSANDBO", amount: 1, confirmed: true }) });
ok("refund from another origin is refused", cross.status === 403);
const unconf = await fetch(`${BASE}/api/paypal/refunds`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ captureId: "CAP0001MOCKSANDBO", amount: 1 }) });
ok("refund without confirmed:true is refused", unconf.status === 400 && (await unconf.json()).error === "NOT_CONFIRMED");
const badId = await fetch(`${BASE}/api/paypal/captures/..%2F..%2Fv1%2Foauth2`);
ok("path-like ids never reach PayPal", badId.status === 400 || badId.status === 404);
const bigOrder = await fetch(`${BASE}/api/paypal/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: 5000 }) });
ok("orders over the cap are refused", bigOrder.status === 400);

// UI: sample → PayPal tab
await p.goto(BASE);
await p.click("[data-testid=sample]");
await p.click("[data-testid=tab-paypal]");
await p.waitForSelector("[data-testid=pp-pay]");
ok("PayPal tab shows Sandbox tag", (await p.textContent(".pp-head")).includes("Sandbox"));
await p.waitForSelector("[data-testid=pp-search-err]");
ok("search permission missing → honest fallback line", (await p.textContent("[data-testid=pp-search-err]")).includes("Transaction Search is off"));

await p.click("[data-testid=pp-pay]");
await p.fill("[data-testid=pp-amount]", "40.00");
await p.screenshot({ path: `${SHOTS}/pp-pay.png` });
await Promise.all([p.waitForURL((u) => u.pathname === "/" && !u.search, { timeout: 15000 }), p.click("[data-testid=pp-go]")]);
await p.waitForSelector("[data-testid=copilot]", { timeout: 15000 });
ok("returned from approval, captured, address bar cleaned", new URL(p.url()).search === "");
const msg = await p.textContent("[data-testid=pp-msg]");
ok("capture message", msg.includes("$40.00"), msg);
const cop = await p.textContent("[data-testid=copilot]");
ok("copilot explains payer, fee and net", cop.includes("Jamie Rivera paid you $40.00") && cop.includes("$1.46") && cop.includes("$38.54"), cop);
ok("payer email never reaches the page", !(await p.content()).includes("buyer@example.com"));

await p.click("[data-testid=pp-draft]");
const note = await p.inputValue("[data-testid=pp-note]");
ok("refund draft note addressed to payer", note.startsWith("Hi Jamie, I've refunded $40.00"), note);
await p.click("text=Goodwill");
ok("goodwill draft = half", (await p.inputValue("[data-testid=pp-refund-amount]")) === "20.00");
await p.fill("[data-testid=pp-note]", "Hi Jamie, partial refund for the delay. Thanks for your patience.");
await p.click("[data-testid=pp-refund]");
ok("first press only arms; nothing sent", stats.refunds === 0 && (await p.textContent("[data-testid=pp-refund]")).includes("Confirm"));
await p.screenshot({ path: `${SHOTS}/pp-confirm.png` });
await p.click("text=Not yet");
ok("Not yet disarms", !(await p.textContent("[data-testid=pp-refund]")).includes("Confirm") && stats.refunds === 0);
await p.click("[data-testid=pp-refund]");
await p.click("[data-testid=pp-refund]");
await p.waitForSelector("[data-testid=pp-refunded]");
ok("second press refunds once in sandbox", stats.refunds === 1, String(stats.refunds));
ok("edited note is what was sent", stats.notes[0] === "Hi Jamie, partial refund for the delay. Thanks for your patience.");
await p.keyboard.press("Escape");
await p.waitForTimeout(500);
const rows = await p.$$eval("[data-testid=pp-row]", (els) => els.map((e) => e.textContent));
ok("list shows the payment as part refunded", rows.length === 1 && rows[0].includes("Part refunded"), rows.join(" | "));
await p.screenshot({ path: `${SHOTS}/pp-list.png` });
await p.click("[data-testid=pp-row]");
ok("copilot remembers the refund", (await p.textContent("[data-testid=copilot]")).includes("$20.00 refunded from here"));
await p.keyboard.press("Escape");

// Cancel path
await p.goto(`${BASE}/?paypal=cancel`);
await p.waitForSelector("[data-testid=pp-msg]");
ok("cancel path says nothing was charged", (await p.textContent("[data-testid=pp-msg]")).includes("Nothing was charged"));

// zh
await p.click("text=中文");
await p.click("[data-testid=pp-row]");
ok("zh copilot", (await p.textContent("[data-testid=copilot]")).includes("手续费"));

ok("no page errors", errors.length === 0, errors.join(" | "));
await b.close();
server.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
