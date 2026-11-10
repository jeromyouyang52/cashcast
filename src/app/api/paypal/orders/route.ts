import { validAmount } from "@/lib/paypal";
import { createOrder, PayPalError } from "@/server/paypal";
import { body, handle, reqId } from "@/server/route";

export const dynamic = "force-dynamic";

/** Create a sandbox test order. The user approves it on PayPal's sandbox page, then comes back to capture. */
export async function POST(req: Request) {
  return handle(
    "orders",
    req,
    async (c) => {
      const b = await body(req);
      const amount = validAmount(b.amount);
      if (amount === null) throw new PayPalError(400, "BAD_AMOUNT");
      const description = typeof b.description === "string" && b.description.trim() ? b.description.trim().replace(/[\u0000-\u001f]/g, "") : "Cashcast sandbox test";
      const origin = new URL(req.url).origin;
      return createOrder(c, { amount, description, returnUrl: `${origin}/?paypal=return`, cancelUrl: `${origin}/?paypal=cancel`, requestId: reqId(b.requestId) });
    },
    { write: true },
  );
}
