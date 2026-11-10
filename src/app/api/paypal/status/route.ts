import { config, ping } from "@/server/paypal";
import { json } from "@/server/route";

export const dynamic = "force-dynamic";

/** Is a sandbox app configured, and do its credentials work? Never returns the credentials. */
export async function GET() {
  let c;
  try {
    c = config();
  } catch {
    return json({ connected: false, reason: "live_refused" });
  }
  if (!c) return json({ connected: false, reason: "not_configured" });
  try {
    await ping(c);
    return json({ connected: true, env: "sandbox", currency: c.currency });
  } catch {
    console.error("[paypal] status auth failed");
    return json({ connected: false, reason: "auth_failed" });
  }
}
