import { requireSession } from "./auth";
import { json } from "./http";
import { refreshSmsDeliveryReports } from "./sms";

/**
 * Pulls fresh delivery reports on demand.
 *
 * Deliberately a POST an administrator triggers rather than something the report page
 * does on load: each pending message costs a separate call to Celcom, so refreshing is
 * a decision, not a side effect of looking.
 */
export async function handleSmsReportRefresh(request: Request) {
  const auth = await requireSession(request, ["ADMIN", "SUPER_ADMIN"]);
  if ("response" in auth) return auth.response;
  if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
  return json(await refreshSmsDeliveryReports());
}
