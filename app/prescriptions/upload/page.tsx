import { requireRole } from "@/lib/auth";
import { PrescriptionUploadForm } from "./prescription-upload-form";

export default async function PrescriptionUploadPage() {
  await requireRole(["CUSTOMER", "STAFF", "ADMIN", "SUPER_ADMIN"]);
  return <PrescriptionUploadForm />;
}
