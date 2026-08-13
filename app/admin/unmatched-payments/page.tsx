import { backendJson } from "@/lib/backend-api";
import { UnmatchedPaymentsManager, type PaymentException, type UnmatchedPayment } from "./unmatched-payments-manager";

export const dynamic = "force-dynamic";

export default async function UnmatchedPaymentsPage() {
  const data = await backendJson<{ payments: UnmatchedPayment[]; exceptions: PaymentException[] }>("/v1/views/admin/unmatched-payments");
  return <UnmatchedPaymentsManager initialPayments={data.payments} exceptions={data.exceptions}/>;
}
