import { beforeEach, describe, expect, it, vi } from "vitest";
import { acceptLines, acceptNote, knownNumbers, numbersOk } from "@/lib/copilot";
import { fromCapture } from "@/lib/paypal";
import { aiExplain, aiRefundNote } from "@/server/copilot";
import { _resetModel, GEMINI, generateJSON, geminiConfig } from "@/server/gemini";

const t = fromCapture(
  { id: "3C679366HH908993F", status: "COMPLETED", amount: { value: "25.00", currency_code: "CAD" }, seller_receivable_breakdown: { paypal_fee: { value: "1.03" }, net_amount: { value: "23.97" } }, create_time: "2026-11-09T15:00:00Z" },
  "Jane Doe",
  "Logo",
)!;

function gem(answers: Record<string, [number, unknown]>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    const k = Object.keys(answers).find((m) => u.includes(`/models/${m}:`));
    const [status, body] = k ? answers[k] : [404, { error: { status: "NOT_FOUND" } }];
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  return { f: f as unknown as typeof fetch, calls };
}
const reply = (v: unknown) => [200, { candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: JSON.stringify(v) }] } }] }] as [number, unknown];

describe("gemini config", () => {
  it("is null without a key", () => expect(geminiConfig({})).toBeNull());
  it("uses Google's host and a free Flash-Lite model first", () => {
    const c = geminiConfig({ GEMINI_API_KEY: "k" })!;
    expect(c.base).toBe(GEMINI);
    expect(c.models[0]).toMatch(/flash-lite/);
  });
  it("ignores a non-local base override and puts GEMINI_MODEL first", () => {
    const c = geminiConfig({ GEMINI_API_KEY: "k", GEMINI_API_BASE: "https://evil.example", GEMINI_MODEL: "gemini-3.6-flash" })!;
    expect(c.base).toBe(GEMINI);
    expect(c.models[0]).toBe("gemini-3.6-flash");
  });
});

describe("generateJSON", () => {
  beforeEach(() => _resetModel());
  const c = geminiConfig({ GEMINI_API_KEY: "secret-key" })!;

  it("sends the key as a header (never in the URL), skips thought parts, and parses JSON", async () => {
    const { f, calls } = gem({ [c.models[0]]: reply({ lines: ["hi"] }) });
    expect(await generateJSON(c, "sys", { a: 1 }, f)).toEqual({ lines: ["hi"] });
    expect(calls[0].url).not.toContain("secret-key");
    expect((calls[0].init.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret-key");
  });

  it("falls through to the next model on 404 and remembers it", async () => {
    const { f, calls } = gem({ [c.models[1]]: reply({ ok: 1 }) });
    expect(await generateJSON(c, "s", {}, f)).toEqual({ ok: 1 });
    await generateJSON(c, "s", {}, f);
    expect(calls.map((x) => x.url.split("/models/")[1].split(":")[0])).toEqual([c.models[0], c.models[1], c.models[1]]);
  });

  it("returns null on quota errors and bad JSON", async () => {
    expect(await generateJSON(c, "s", {}, gem({ [c.models[0]]: [429, {}] }).f)).toBeNull();
    _resetModel();
    expect(await generateJSON(c, "s", {}, gem({ [c.models[0]]: [200, { candidates: [{ content: { parts: [{ text: "not json" }] } }] }] }).f)).toBeNull();
  });
});

describe("guardrails on AI wording", () => {
  const allowed = knownNumbers(t, [], 10);
  it("allows known amounts and dates, rejects invented money", () => {
    expect(numbersOk("Jane paid $25.00 on Nov 9, 2026; fee $1.03, you keep $23.97.", allowed)).toBe(true);
    expect(numbersOk("That's about 2 days of spending.", allowed)).toBe(true);
    expect(numbersOk("You'll get $30.00 back.", allowed)).toBe(false);
    expect(numbersOk("Refund of 250 dollars", allowed)).toBe(false);
  });
  it("acceptLines keeps at most 4 clean lines", () => {
    expect(acceptLines({ lines: ["a\u0007b", "", "c", "d", "e", "f"] }, allowed)).toEqual(["ab", "c", "d", "e"]);
    expect(acceptLines({ lines: "nope" }, allowed)).toBeNull();
    expect(acceptLines({ lines: ["Paid $99.99"] }, allowed)).toBeNull();
  });
  it("acceptNote requires the exact refund amount", () => {
    expect(acceptNote({ note: "Hi Jane, I've refunded CA$12.50 because of the delay. Thanks!" }, 12.5, [...allowed, 12.5])).toMatch(/12\.50/);
    expect(acceptNote({ note: "Hi Jane, I've refunded your payment because of the delay. Thanks!" }, 12.5, [...allowed, 12.5])).toBeNull();
    expect(acceptNote({ note: "Hi Jane, refunded $12.50 and here is a $5.00 coupon." }, 12.5, [...allowed, 12.5])).toBeNull();
  });
});

describe("Copilot with Gemini", () => {
  beforeEach(() => _resetModel());
  const c = geminiConfig({ GEMINI_API_KEY: "k" })!;

  it("uses Gemini's lines when they pass the checks", async () => {
    const { f, calls } = gem({ [c.models[0]]: reply({ lines: ["Jane Doe paid you $25.00 for the logo.", "After the $1.03 fee, $23.97 lands."] }) });
    expect(await aiExplain(c, t, [], "en", 10, f)).toHaveLength(2);
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.contents[0].parts[0].text).toContain("not instructions");
    expect(sent.contents[0].parts[0].text).toContain("$23.97");
  });

  it("rejects a refund note that changes the amount, so the template stays", async () => {
    const { f } = gem({ [c.models[0]]: reply({ note: "Hi Jane, I've refunded $25.00 plus $10.00 extra for the trouble." }) });
    expect(await aiRefundNote(c, t, [], "duplicate", 25, "en", f)).toBeNull();
  });

  it("accepts a good refund note", async () => {
    const { f } = gem({ [c.models[0]]: reply({ note: "Hi Jane, sorry about the double charge! I've refunded $25.00; it should reach your PayPal in a few days." }) });
    expect(await aiRefundNote(c, t, [], "duplicate", 25, "en", f)).toMatch(/\$25\.00/);
  });
});
