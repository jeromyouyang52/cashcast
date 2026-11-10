import { isId } from "@/lib/paypal";
import { captureOrder, PayPalError } from "@/server/paypal";
import { handle } from "@/server/route";

export const dynamic = "force-dynamic";

/** Capture an order the user just approved in the sandbox. Idempotent per order id. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(
    "capture",
    req,
    async (c) => {
      if (!isId(id)) throw new PayPalError(400, "BAD_ID");
      return captureOrder(c, id, `capture-${id}`);
    },
    { write: true },
  );
}
