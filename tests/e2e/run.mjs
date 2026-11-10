/**
 * End-to-end checks against a running build (default http://localhost:3300).
 * Usage: npm run build && npx next start -p 3300 & node tests/e2e/run.mjs
 * Screenshots go to docs/screenshots.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

const b = await pw.chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: "en-CA" });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const requests = [];
p.on("request", (r) => requests.push(r.url()));
const noScroll = async (label) => ok(`${label}: no horizontal scroll at 390px`, (await p.evaluate(() => document.documentElement.scrollWidth)) <= 390);

// 1. Sample: forecast within seconds of first open.
const t0 = Date.now();
await p.goto(BASE);
await p.click("[data-testid=sample]");
await p.waitForSelector("[data-testid=allowance]");
const ms = Date.now() - t0;
ok("brief + today's number within 3 s", ms < 3000, `${ms} ms`);
ok("one-sentence brief", /a day/.test(await p.locator("[data-testid=brief]").innerText()));
ok("at most two reminder cards", (await p.locator("[data-testid=card]").count()) <= 2 && (await p.locator("[data-testid=card]").count()) >= 1);
await noScroll("today");
await p.screenshot({ path: `${SHOTS}/today-390.png` });

// 0a. Check-in: today's number and the forecast move.
const allow0 = await p.locator("[data-testid=allowance] .sr").innerText();
await p.click("[data-testid=log]");
await p.fill("[data-testid=log-input]", "12");
await p.click("[data-testid=log-save]");
await p.waitForTimeout(900);
const allow1 = await p.locator("[data-testid=allowance] .sr").innerText();
ok("logging spending lowers what's left today", allow0 !== allow1, `${allow0} → ${allow1}`);
ok("logged line shown", /Logged C\$12/.test(await p.locator(".today-hero").innerText()));
await p.click(".today-hero .hero-btn");
ok("today's number explains itself", /Safety line/.test(await p.locator("[data-testid=why]").innerText()));
await p.keyboard.press("Escape");

// 0b. Dismissed reminders stay gone.
const firstCard = await p.locator("[data-testid=card] strong").first().innerText();
await p.locator("[data-testid=dismiss]").first().click();
await p.reload();
await p.waitForSelector("[data-testid=allowance]");
ok("dismissed reminder stays gone after reload", !(await p.locator("[data-testid=card] strong", { hasText: firstCard }).count()));

// 0c. Goals: create, set aside, progress.
await p.click("nav.tabs >> text=Goals");
await p.fill("[data-testid=goal-name]", "Trip home");
await p.fill("[data-testid=goal-target]", "1200");
await p.click("[data-testid=goal-create]");
await p.fill(".goal-put input", "150");
await p.click(".goal-put button");
ok("goal progress updates", (await p.locator("[data-testid=goal] [role=progressbar]").getAttribute("aria-valuenow")) === "12");
await noScroll("goals");
await p.screenshot({ path: `${SHOTS}/goals-390.png` });
await p.click("nav.tabs >> text=Forecast");
await p.waitForSelector("[data-testid=today-balance]");
ok("7-day strip", (await p.locator(".week .day").count()) === 7);
ok("storm/rain warning shown", await p.locator("[data-testid=warning]").isVisible());
ok("warning names the cause", /Rent/.test(await p.locator("[data-testid=warning]").innerText()));
ok("dry streak shown", await p.locator("[data-testid=streak]").isVisible());
await noScroll("forecast");
await p.screenshot({ path: `${SHOTS}/forecast-390.png` });

// 2. 30 days + day detail adds up.
await p.click("text=30 days");
ok("30-day grid", (await p.locator("[data-testid=month] .day").count()) === 30);
await p.locator(".week .day").nth(4).click();
const sheet = p.locator("[data-testid=day-sheet]");
ok("day detail opens", await sheet.isVisible());
ok("day detail lists Rent", /Rent/.test(await sheet.innerText()));
await p.keyboard.press("Escape");
ok("day detail closes on Escape", !(await sheet.isVisible()));

// 3. Can I spend: tap chip, tap day → weather changes → undo.
const before = await p.locator(".week .day").evaluateAll((els) => els.map((e) => e.dataset.weather).join());
await p.click("text=Concert");
await p.locator(".week .day").nth(2).click();
const after = await p.locator(".week .day").evaluateAll((els) => els.map((e) => e.dataset.weather).join());
ok("a purchase changes the weather", before !== after, `${before} → ${after}`);
ok("says which day changes", /turns (stormy|rainy|cloudy)/.test(await p.locator("[data-testid=spend-msg]").innerText()));
await p.screenshot({ path: `${SHOTS}/spend-390.png`, fullPage: true });
await p.click("[data-testid=spend-msg] >> text=Undo");
const undone = await p.locator(".week .day").evaluateAll((els) => els.map((e) => e.dataset.weather).join());
ok("undo restores the forecast", undone === before);

// 3b. Drag a chip onto a day (pointer events, works for touch too).
const chip = await p.locator("text=New shoes").boundingBox();
const target = await p.locator(".week .day").nth(1).boundingBox();
await p.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2);
await p.mouse.down();
await p.mouse.move(chip.x + 40, chip.y - 40, { steps: 4 });
await p.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
await p.mouse.up();
ok("drag-and-drop places a purchase", (await p.locator(".tried li").count()) === 1);
await p.click(".tried .x");

// 4. Graveyard: cancel → bloom → forecast drops it.
await p.click("nav.tabs >> text=Subs");
ok("tombstones", (await p.locator("[data-testid=stone]").count()) === 4);
await p.locator(".stone-btn", { hasText: "Netflix" }).click();
ok("help link is the service's own site", (await p.locator("a", { hasText: "Help page" }).getAttribute("href")) === "https://help.netflix.com/");
await p.click("text=I cancelled it");
ok("cancelled stone blooms", (await p.locator(".stone.bloom").count()) === 1);
ok("yearly saving shown", /C\$198/.test(await p.locator("[data-testid=saved]").innerText()));
await p.waitForTimeout(700);
await p.screenshot({ path: `${SHOTS}/subscriptions-390.png` });
await noScroll("subscriptions");

// 5. Language switch.
await p.click("text=中文");
ok("Chinese UI", await p.locator("text=订阅").first().isVisible());
await p.click("nav.tabs >> text=预报");
ok("Chinese forecast", await p.locator("text=我能花吗？").isVisible());
await p.screenshot({ path: `${SHOTS}/forecast-zh-390.png` });
await p.click("text=English");

// 6. Settings: export backup, wipe, restore.
await p.click("[aria-label=Settings]");
const [dl] = await Promise.all([p.waitForEvent("download"), p.click("[data-testid=export]")]);
const backupPath = `${SHOTS}/../backup-sample.json`;
await dl.saveAs(backupPath);
const bk = JSON.parse(readFileSync(backupPath, "utf8"));
ok("backup includes check-ins, goals, savings, dismissed", bk.v === 2 && bk.checkins.length === 1 && bk.goals.length === 1 && bk.saves.length === 1 && bk.dismissed.length === 1);
await p.click("[data-testid=wipe]");
await p.click("[data-testid=wipe-confirm]");
ok("delete returns to the drop screen", await p.locator("[data-testid=start]").isVisible());
ok("storage is empty", (await p.evaluate(() => localStorage.getItem("cashcast.v1"))) === null);

// 7. Real CSV (TD fixture, headerless) → confirm → edit → forecast.
await p.setInputFiles("[data-testid=file]", "tests/fixtures/td.csv");
await p.waitForSelector("text=Is this right?");
ok("confirm lists found items", (await p.locator("[data-testid=item]").count()) >= 4);
ok("balance prefilled from the file", (await p.inputValue("#bal")) === "7628.09");
await noScroll("confirm");
await p.screenshot({ path: `${SHOTS}/confirm-390.png`, fullPage: true });
const nameInput = p.locator("[data-testid=item] .name").first();
await nameInput.fill("Salary");
await p.click("text=Show forecast");
await p.waitForSelector("[data-testid=allowance]");
ok("my CSV lands on today's brief", !(await p.locator(".demo-bar").count()));

// 8. Restore the earlier backup.
await p.click("[aria-label=Settings]");
await p.setInputFiles("[data-testid=restore]", backupPath);
await p.click("nav.tabs >> text=Goals");
ok("backup restores goals", (await p.locator("[data-testid=goal]").count()) === 1);

// 9. A file with no balance column asks for one; an unknown layout asks for columns.
await p.click("[aria-label=Settings]");
await p.click("text=Import");
await p.setInputFiles("[data-testid=file]", "tests/fixtures/tangerine.csv");
await p.waitForSelector("text=Is this right?");
ok("no balance column → balance left empty", (await p.inputValue("#bal")) === "");
ok("can't continue without a balance", await p.locator("text=Show forecast").isDisabled());
await p.click("text=Back");
writeFileSync(`${SHOTS}/../odd.csv`, "when;what;how much\nOct 01;Coffee;-4.50\nOct 02;Pay;1200\n");
await p.setInputFiles("[data-testid=file]", `${SHOTS}/../odd.csv`);
ok("unknown layout → column mapping", !!(await p.waitForSelector("text=Which column is which?", { timeout: 5000 }).catch(() => null)));
await p.screenshot({ path: `${SHOTS}/map-390.png` });
await noScroll("column mapping");

// 10. Privacy and llms.txt; nothing left the browser.
const priv = await (await fetch(`${BASE}/privacy`)).text();
ok("privacy page", /never uploaded/.test(priv));
const llms = await (await fetch(`${BASE}/llms.txt`)).text();
ok("llms.txt", /# Cashcast/.test(llms) && /storm/.test(llms));
const foreign = requests.filter((u) => !u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("blob:"));
ok("no third-party requests", foreign.length === 0, foreign.slice(0, 3).join(" "));
ok("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));

// 11. No file at all: four questions → today's number.
{
  const q = await b.newPage({ viewport: { width: 390, height: 844 }, locale: "zh-CN" });
  q.on("pageerror", (e) => errors.push(String(e)));
  const t1 = Date.now();
  await q.goto(BASE);
  await q.screenshot({ path: `${SHOTS}/front-zh-390.png` });
  await q.click("[data-testid=start]");
  await q.fill("[data-testid=q-balance]", "1200");
  await q.click("[data-testid=q-next]");
  await q.fill("[data-testid=q-pay]", "1500");
  await q.click("[data-testid=q-next]");
  await q.fill("[data-testid=q-rent]", "900");
  await q.click("[data-testid=q-next]");
  await q.click("[data-testid=q-phone]");
  await q.click("[data-testid=q-netflix]");
  await q.screenshot({ path: `${SHOTS}/setup-zh-390.png` });
  const qs = await q.evaluate(() => document.documentElement.scrollWidth);
  await q.click("[data-testid=q-next]");
  await q.waitForSelector("[data-testid=allowance]");
  ok("4 questions → today's number, no file", true, `${Date.now() - t1} ms incl. typing`);
  ok("setup: no horizontal scroll", qs <= 390);
  ok("setup uses Chinese names", /工资|房租|手机费/.test(await q.evaluate(() => localStorage.getItem("cashcast.v1"))));
  ok("brief appears for manual setup", (await q.locator("[data-testid=brief]").innerText()).length > 5);
  await q.screenshot({ path: `${SHOTS}/today-manual-zh-390.png` });
  await q.close();
}

// 12. Paste text copied from a bank page.
{
  const q = await b.newPage({ viewport: { width: 390, height: 844 }, locale: "en-CA" });
  q.on("pageerror", (e) => errors.push(String(e)));
  await q.goto(BASE);
  await q.click("[data-testid=import]");
  const lines = [];
  for (let m = 8; m <= 10; m++) {
    const mm = String(m).padStart(2, "0");
    lines.push(`2026-${mm}-01  RENT ELM ST  -1,250.00`, `2026-${mm}-05  NETFLIX.COM  -16.49`, `2026-${mm}-15  PAYROLL MAPLE STUDIO  +2,760.00`, `2026-${mm}-20  CORNER GROCER  -64.20`);
  }
  await q.fill("[data-testid=paste]", lines.join("\n"));
  await q.click("[data-testid=paste-go]");
  ok("pasted text → confirm screen", !!(await q.waitForSelector("text=Is this right?", { timeout: 5000 }).catch(() => null)));
  ok("pasted text finds Netflix", (await q.locator("[data-testid=item] .name").evaluateAll((els) => els.map((e) => e.value))).some((v) => /netflix/i.test(v)));
  await q.close();
}

// Dark mode screenshot
const dark = await b.newPage({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
await dark.goto(BASE);
await dark.click("[data-testid=sample]");
await dark.waitForSelector("[data-testid=allowance]");
await dark.screenshot({ path: `${SHOTS}/today-dark-390.png` });
const desk = await b.newPage({ viewport: { width: 1280, height: 860 } });
await desk.goto(BASE);
await desk.screenshot({ path: `${SHOTS}/drop-1280.png` });

await b.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
