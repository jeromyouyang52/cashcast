import { search } from "@/server/paypal";
import { handle } from "@/server/route";

export const dynamic = "force-dynamic";

/** Sandbox account activity for the last N days (default 30, max 31). */
export async function GET(req: Request) {
  const days = Number(new URL(req.url).searchParams.get("days") ?? 30);
  return handle("transactions", req, async (c) => ({ txns: await search(c, Number.isFinite(days) ? days : 30) }));
}
