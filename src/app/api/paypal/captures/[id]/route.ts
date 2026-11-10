import { isId } from "@/lib/paypal";
import { getCapture, PayPalError } from "@/server/paypal";
import { handle } from "@/server/route";

export const dynamic = "force-dynamic";

/** Look up one sandbox payment by capture id. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle("capture-get", req, async (c) => {
    if (!isId(id)) throw new PayPalError(400, "BAD_ID");
    return getCapture(c, id);
  });
}
