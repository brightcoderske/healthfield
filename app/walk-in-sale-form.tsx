import { PosWorkspace } from "./pos/pos-workspace";
import type { PosWorkspaceData } from "./pos/types";

export function WalkInSaleForm(props: PosWorkspaceData & { backHref?: string }) {
  const { backHref = "/staff", ...data } = props;
  return <PosWorkspace data={data} backHref={backHref}/>;
}
