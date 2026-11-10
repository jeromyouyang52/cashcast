/**
 * A tiny stand-in for the PayPal sandbox API, for end-to-end tests only. The app accepts it
 * only via PAYPAL_API_BASE=http://127.0.0.1:<port>. Fictional data.
 */
import { createServer } from "node:http";

export function startMock(port = 4010) {
  const orders = new Map();
  const captures = new Map();
  const stats = { refunds: 0, notes: [], orders: 0 };
  let n = 0;
  const id = (p) => (p + String(++n).padStart(4, "0") + "MOCKSANDBOX").slice(0, 17);
  const send = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const p = url.pathname;
    if (p === "/checkoutnow") {
      // The buyer's approval page: approve instantly and bounce back like PayPal does.
      const o = orders.get(url.searchParams.get("token"));
      const back = o?.payment_source?.paypal?.experience_context?.return_url;
      res.writeHead(302, { Location: `${back}&token=${url.searchParams.get("token")}&PayerID=MOCKPAYER1` });
      return res.end();
    }
    if (req.method === "POST" && /^\/v1beta\/models\/[a-z0-9.-]+:generateContent$/.test(p)) {
      // Gemini stand-in: echoes the facts it was given, like a well-behaved model.
      if (req.headers["x-goog-api-key"] !== "mock-gemini") return send(res, 403, { error: { status: "PERMISSION_DENIED" } });
      const b = JSON.parse(raw);
      const sys = b.system_instruction.parts[0].text;
      const d = JSON.parse(b.contents[0].parts[0].text.split("\n").slice(1).join("\n"));
      const out = sys.includes('"note"')
        ? { note: `Hi ${d.payer.split(" ")[0]}, I've refunded ${d.refund_text} (AI). It should show in your PayPal account within a few days.` }
        : { lines: [`(AI) ${d.payer} paid ${d.gross_text}.`, `After ${d.fee_text} in fees, ${d.net_text} lands.`] };
      stats.gemini = (stats.gemini ?? 0) + 1;
      return send(res, 200, { candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] });
    }
    if (req.method === "POST" && p === "/v1/oauth2/token") {
      return req.headers.authorization?.startsWith("Basic ") ? send(res, 200, { access_token: "mock-token", expires_in: 3600 }) : send(res, 401, { error: "invalid_client" });
    }
    if (req.headers.authorization !== "Bearer mock-token") return send(res, 401, { name: "AUTHENTICATION_FAILURE" });
    if (req.method === "POST" && p === "/v2/checkout/orders") {
      const b = JSON.parse(raw);
      const oid = id("ORD");
      orders.set(oid, b);
      stats.orders++;
      return send(res, 200, { id: oid, status: "PAYER_ACTION_REQUIRED", links: [{ rel: "payer-action", href: `http://127.0.0.1:${port}/checkoutnow?token=${oid}` }] });
    }
    let m;
    if (req.method === "POST" && (m = p.match(/^\/v2\/checkout\/orders\/([A-Z0-9]+)\/capture$/))) {
      const o = orders.get(m[1]);
      if (!o) return send(res, 404, { name: "RESOURCE_NOT_FOUND" });
      const amt = o.purchase_units[0].amount;
      const fee = (Math.round((Number(amt.value) * 0.029 + 0.3) * 100) / 100).toFixed(2);
      const cap = { id: id("CAP"), status: "COMPLETED", amount: amt, create_time: new Date().toISOString(), seller_receivable_breakdown: { gross_amount: amt, paypal_fee: { currency_code: amt.currency_code, value: fee }, net_amount: { currency_code: amt.currency_code, value: (Number(amt.value) - Number(fee)).toFixed(2) } } };
      captures.set(cap.id, cap);
      return send(res, 201, { id: m[1], status: "COMPLETED", payer: { name: { given_name: "Jamie", surname: "Rivera" }, email_address: "buyer@example.com" }, purchase_units: [{ description: o.purchase_units[0].description, payments: { captures: [cap] } }] });
    }
    if (req.method === "GET" && (m = p.match(/^\/v2\/payments\/captures\/([A-Z0-9]+)$/))) {
      const c = captures.get(m[1]);
      return c ? send(res, 200, c) : send(res, 404, { name: "RESOURCE_NOT_FOUND" });
    }
    if (req.method === "POST" && (m = p.match(/^\/v2\/payments\/captures\/([A-Z0-9]+)\/refund$/))) {
      const c = captures.get(m[1]);
      if (!c) return send(res, 404, { name: "RESOURCE_NOT_FOUND" });
      const b = JSON.parse(raw || "{}");
      stats.refunds++;
      stats.notes.push(b.note_to_payer ?? "");
      c.status = Number(b.amount.value) >= Number(c.amount.value) ? "REFUNDED" : "PARTIALLY_REFUNDED";
      return send(res, 201, { id: id("REF"), status: "COMPLETED", amount: b.amount, create_time: new Date().toISOString() });
    }
    if (req.method === "GET" && p === "/v1/reporting/transactions") return send(res, 403, { name: "NOT_AUTHORIZED", message: "Authorization failed due to insufficient permissions." });
    return send(res, 404, { name: "RESOURCE_NOT_FOUND" });
  });
  return new Promise((r) => server.listen(port, "127.0.0.1", () => r({ server, stats })));
}
