import { SmsReports, type SmsReportData } from "@/app/admin/sms/sms-reports";
import { backendJson } from "@/lib/backend-api";
import { requireStaffPermission } from "@/lib/auth";
import { hasStaffPermission } from "@/lib/staff-permissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bulk SMS reports" };

export default async function StaffSmsReportsPage() {
  const session = await requireStaffPermission("SMS_VIEW");
  const data = await backendJson<SmsReportData>("/v1/views/staff/sms");
  // "New campaign" is offered only to someone who may also send one.
  const campaignsHref = hasStaffPermission(session.role, session.permissions, "CAMPAIGNS_MANAGE") ? "/staff/campaigns" : null;
  return <SmsReports data={data} backHref="/staff" campaignsHref={campaignsHref} />;
}
