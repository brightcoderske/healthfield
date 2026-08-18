import { backendJson } from "@/lib/backend-api";
import { DeliveryManager, type DeliveryBandRow, type DeliveryRules, type PinnedBranch } from "./delivery-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Delivery pricing" };

type Data = {
  settings: DeliveryRules;
  bands: DeliveryBandRow[];
  branches: PinnedBranch[];
  routing: { googleConfigured: boolean };
};

export default async function DeliveryPage() {
  const data = await backendJson<Data>("/v1/views/admin/delivery");
  return (
    <DeliveryManager
      initialRules={data.settings}
      initialBands={data.bands}
      branches={data.branches}
      googleConfigured={data.routing.googleConfigured}
    />
  );
}
