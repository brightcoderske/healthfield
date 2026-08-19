import { backendJson } from "@/lib/backend-api";
import { SmsReports, type SmsReportData } from "./sms-reports";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bulk SMS reports" };

export default async function SmsReportsPage() {
  const data = await backendJson<SmsReportData>("/v1/views/admin/sms");
  return <SmsReports data={data} />;
}
