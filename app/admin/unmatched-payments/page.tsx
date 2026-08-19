import { backendJson } from "@/lib/backend-api";
import { UnmatchedPaymentsManager, type PaymentException, type TillDelivery, type UnmatchedPayment } from "./unmatched-payments-manager";

export const dynamic = "force-dynamic";

export default async function UnmatchedPaymentsPage() {
  const data = await backendJson<{ payments: UnmatchedPayment[]; exceptions: PaymentException[]; till?: TillDelivery }>("/v1/views/admin/unmatched-payments");
  return <UnmatchedPaymentsManager initialPayments={data.payments} exceptions={data.exceptions} till={data.till}/>;
}
