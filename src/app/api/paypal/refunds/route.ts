import { isId, validAmount } from "@/lib/paypal";
import { PayPalError, refund } from "@/server/paypal";
import { body, handle, reqId } from "@/server/route";

export const dynamic = "force-dynamic";

/**
 * Refund a sandbox payment. Only called after the user reviews the draft and presses
 * confirm twice in the app; nothing here runs on its own. `confirmed: true` is required.
 */
export async function POST(req: Request) {
  return handle(
    "refund",
    req,
    async (c) => {
      const b = await body(req);
      if (b.confirmed !== true) throw new PayPalError(400, "NOT_CONFIRMED");
      if (!isId(b.captureId)) throw new PayPalError(400, "BAD_ID");
      const amount = validAmount(b.amount);
      if (amount === null) throw new PayPalError(400, "BAD_AMOUNT");
      const currency = typeof b.currency === "string" && /^[A-Z]{3}$/.test(b.currency) ? b.currency : c.currency;
      const note = typeof b.note === "string" ? b.note.replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim() : "";
      return refund(c, { captureId: b.captureId, amount, currency, note, requestId: reqId(b.requestId) });
    },
    { write: true },
  );
}
