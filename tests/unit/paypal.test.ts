import { beforeEach, describe, expect, it, vi } from "vitest";
import { draftRefund, explain } from "@/lib/copilot";
import { fromCapture, fromOrder, fromSearch, isId, merge, refundable, validAmount, type PPTxn } from "@/lib/paypal";
import { _resetToken, captureOrder, config, createOrder, PayPalError, refund, SANDBOX, search } from "@/server/paypal";

const ENV = { PAYPAL_CLIENT_ID: "sb-id", PAYPAL_CLIENT_SECRET: "sb-secret" };

describe("config: sandbox only", () => {
  it("is null without credentials", () => expect(config({})).toBeNull());
  it("defaults to the sandbox host and CAD", () => expect(config(ENV)).toMatchObject({ base: SANDBOX, currency: "CAD" }));
  it("refuses live mode", () => expect(() => config({ ...ENV, PAYPAL_ENV: "live" })).toThrow("LIVE_REFUSED"));
  it("refuses a live API host override", () => {
    expect(() => config({ ...ENV, PAYPAL_API_BASE: "https://api-m.paypal.com" })).toThrow("LIVE_REFUSED");
    expect(() => config({ ...ENV, PAYPAL_API_BASE: "https://evil.example" })).toThrow("LIVE_REFUSED");
  });
  it("allows only a local mock override", () => expect(config({ ...ENV, PAYPAL_API_BASE: "http://127.0.0.1:4010" })?.base).toBe("http://127.0.0.1:4010"));
});

function fakeFetch(routes: Record<string, (init: RequestInit) => [number, unknown]>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    const key = Object.keys(routes).find((k) => u.includes(k));
    const [status, body] = key ? routes[key](init) : [404, { name: "RESOURCE_NOT_FOUND" }];
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  return { f: f as unknown as typeof fetch, calls };
}
const TOKEN = { "/v1/oauth2/token": () => [200, { access_token: "tk", expires_in: 3600 }] as [number, unknown] };

describe("server client", () => {
  beforeEach(() => _resetToken());
  const c = config(ENV)!;

  it("creates an order on the sandbox host and returns the sandbox approval link", async () => {
    const { f, calls } = fakeFetch({
      ...TOKEN,
      "/v2/checkout/orders": () => [200, { id: "5O190127TN364715T", links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T" }] }],
    });
    const r = await createOrder(c, { amount: 25, description: "x", returnUrl: "https://a/?paypal=return", cancelUrl: "https://a/?paypal=cancel", requestId: "req-12345678" }, f);
    expect(r.id).toBe("5O190127TN364715T");
    expect(calls.every((x) => x.url.startsWith(SANDBOX))).toBe(true);
    const body = JSON.parse(String(calls[1].init.body));
    expect(body.purchase_units[0].amount).toEqual({ currency_code: "CAD", value: "25.00" });
    expect((calls[1].init.headers as Record<string, string>)["PayPal-Request-Id"]).toBe("req-12345678");
  });

  it("rejects an approval link that isn't the sandbox", async () => {
    const { f } = fakeFetch({ ...TOKEN, "/v2/checkout/orders": () => [200, { id: "ABCDEFGH12", links: [{ rel: "payer-action", href: "https://www.paypal.com/checkoutnow?token=x" }] }] });
    await expect(createOrder(c, { amount: 1, description: "x", returnUrl: "r", cancelUrl: "c", requestId: "req-12345678" }, f)).rejects.toThrow("NOT_SANDBOX");
  });

  it("captures and normalises fee and payer name", async () => {
    const { f } = fakeFetch({
      ...TOKEN,
      "/capture": () => [
        201,
        {
          id: "5O190127TN364715T",
          payer: { name: { given_name: "Jane", surname: "Doe" }, email_address: "jane@example.com" },
          purchase_units: [
            {
              description: "Logo",
              payments: {
                captures: [
                  {
                    id: "3C679366HH908993F",
                    status: "COMPLETED",
                    amount: { currency_code: "CAD", value: "25.00" },
                    seller_receivable_breakdown: { paypal_fee: { value: "1.03" }, net_amount: { value: "23.97" } },
                    create_time: "2026-11-09T15:00:00Z",
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const t = await captureOrder(c, "5O190127TN364715T", "capture-x", f);
    expect(t).toMatchObject({ id: "3C679366HH908993F", name: "Jane Doe", amount: 25, fee: 1.03, net: 23.97, status: "completed", captureId: "3C679366HH908993F" });
    expect(JSON.stringify(t)).not.toContain("jane@example.com");
  });

  it("maps PayPal errors to their name only", async () => {
    const { f } = fakeFetch({ ...TOKEN, "/refund": () => [422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "CAPTURE_FULLY_REFUNDED", description: "secret detail" }] }] });
    const e = await refund(c, { captureId: "3C679366HH908993F", amount: 5, currency: "CAD", note: "", requestId: "r-12345678" }, f).catch((x) => x);
    expect(e).toBeInstanceOf(PayPalError);
    expect(e.code).toBe("UNPROCESSABLE_ENTITY:CAPTURE_FULLY_REFUNDED");
    expect(e.status).toBe(422);
  });

  it("reuses the token and searches at most 31 days", async () => {
    const { f, calls } = fakeFetch({ ...TOKEN, "/v1/reporting/transactions": () => [200, { transaction_details: [] }] });
    const now = new Date("2026-11-09T12:00:00Z");
    await search(c, 90, f, now);
    await search(c, 7, f, now);
    expect(calls.filter((x) => x.url.includes("oauth2")).length).toBe(1);
    const q = new URL(calls[1].url).searchParams;
    expect(q.get("start_date")).toBe("2026-10-09T12:00:00Z");
    expect(q.get("end_date")).toBe("2026-11-09T12:00:00Z");
  });

  it("reports bad credentials as AUTH_FAILED", async () => {
    const { f } = fakeFetch({ "/v1/oauth2/token": () => [401, { error: "invalid_client" }] });
    await expect(search(c, 7, f)).rejects.toThrow("AUTH_FAILED");
  });
});

describe("normalising", () => {
  it("reads Transaction Search rows; refunds are T11xx", () => {
    const rows = fromSearch({
      transaction_details: [
        { transaction_info: { transaction_id: "AAAABBBBCCCC1111", transaction_event_code: "T0006", transaction_initiation_date: "2026-11-02T10:00:00+0000", transaction_amount: { currency_code: "CAD", value: "40.00" }, fee_amount: { value: "-1.46" }, transaction_status: "S" }, payer_info: { payer_name: { alternate_full_name: "Sam Lee" } } },
        { transaction_info: { transaction_id: "DDDDEEEEFFFF2222", transaction_event_code: "T1107", transaction_initiation_date: "2026-11-03T10:00:00+0000", transaction_amount: { currency_code: "CAD", value: "-40.00" }, transaction_status: "S" } },
      ],
    });
    expect(rows[0]).toMatchObject({ name: "Sam Lee", amount: 40, fee: 1.46, net: 38.54, kind: "payment", captureId: "AAAABBBBCCCC1111" });
    expect(rows[1]).toMatchObject({ kind: "refund", amount: -40 });
    expect(rows[1].captureId).toBeUndefined();
  });

  it("merges local and search rows, newest first, keeping the payer name", () => {
    const a = fromCapture({ id: "AAAABBBBCCCC1111", status: "COMPLETED", amount: { value: "40.00", currency_code: "CAD" }, create_time: "2026-11-02T10:00:00Z" }, "Sam Lee")!;
    const b: PPTxn = { ...a, name: "PayPal", status: "refunded" };
    const c: PPTxn = { ...a, id: "ZZZZBBBBCCCC1111", at: "2026-11-05T00:00:00Z", captureId: "ZZZZBBBBCCCC1111" };
    const m = merge([a], [b, c]);
    expect(m.map((x) => x.id)).toEqual(["ZZZZBBBBCCCC1111", "AAAABBBBCCCC1111"]);
    expect(m[1]).toMatchObject({ name: "Sam Lee", status: "refunded" });
  });

  it("fromOrder without a capture is null", () => expect(fromOrder({ id: "X" })).toBeNull());

  it("validates ids and amounts", () => {
    expect(isId("3C679366HH908993F")).toBe(true);
    expect(isId("../../v1/oauth2")).toBe(false);
    expect(isId("abc")).toBe(false);
    expect(validAmount("25.00")).toBe(25);
    expect(validAmount(0)).toBeNull();
    expect(validAmount(500.01)).toBeNull();
    expect(validAmount("1.005")).toBeNull();
    expect(validAmount("abc")).toBeNull();
  });
});

describe("copilot drafts", () => {
  const t = fromCapture(
    { id: "3C679366HH908993F", status: "COMPLETED", amount: { value: "25.00", currency_code: "CAD" }, seller_receivable_breakdown: { paypal_fee: { value: "1.03" }, net_amount: { value: "23.97" } }, create_time: "2026-11-09T15:00:00Z" },
    "Jane Doe",
    "Logo",
  )!;

  it("explains gross, fee and net in plain words", () => {
    const en = explain(t, [], "en", 10).join(" ");
    expect(en).toContain("Jane Doe paid you $25.00");
    expect(en).toContain("$1.03");
    expect(en).toContain("$23.97");
    expect(en).toContain("2 days of everyday spending");
    expect(explain(t, [], "zh").join("")).toContain("手续费");
  });

  it("drafts a full refund with a short note; goodwill is half", () => {
    const d = draftRefund(t, [], "duplicate", "en");
    expect(d.amount).toBe(25);
    expect(d.note).toMatch(/^Hi Jane, I've refunded \$25\.00/);
    expect(d.note.length).toBeLessThanOrEqual(255);
    expect(draftRefund(t, [], "goodwill", "en").amount).toBe(12.5);
  });

  it("subtracts earlier refunds and stops at zero", () => {
    const r = [{ id: "RRRRRRRR11", captureId: t.captureId!, amount: 10, currency: "CAD", status: "COMPLETED", at: "" }];
    expect(refundable(t, r)).toBe(15);
    expect(draftRefund(t, r, "duplicate", "en").amount).toBe(15);
    expect(refundable({ ...t, status: "refunded" }, [])).toBe(0);
    expect(refundable({ ...t, kind: "refund" }, [])).toBe(0);
  });
});
