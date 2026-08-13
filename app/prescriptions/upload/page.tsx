import { cookies } from "next/headers";
import { FileText, LogIn, ShieldCheck, UserPlus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { backendJson } from "@/lib/backend-api";
import { getSession } from "@/lib/auth";
import {
  parsePrescriptionSelections,
  prescriptionUploadHref,
} from "@/lib/prescription-selection";
import { CART_COOKIE, parseCart } from "@/lib/shopping-state";
import { PrescriptionUploadForm } from "./prescription-upload-form";

export const dynamic = "force-dynamic";

type Product = {
  id: number;
  name: string;
  packSize: string | null;
  prescriptionRequired: boolean;
};

export default async function PrescriptionUploadPage({
  searchParams,
}: {
  searchParams: Promise<{ items?: string | string[] }>;
}) {
  const selected = parsePrescriptionSelections((await searchParams).items);
  const uploadPath = prescriptionUploadHref(selected);
  const session = await getSession();
  if (!session)
    return (
      <main className="prescription-upload-page">
        <section className="prescription-account-gate">
          <Link className="prescription-gate-back" href="/">
            ← Continue shopping
          </Link>
          <span className="prescription-gate-icon">
            <FileText />
          </span>
          <span className="auth-kicker">Prescription upload</span>
          <h1>Create an account to continue</h1>
          <p>
            To upload a prescription, you need a Healthfield customer account.
            Your account keeps the document private and lets you follow the
            pharmacist review, medicine proposal and payment in one place.
          </p>
          <div className="prescription-gate-assurance">
            <ShieldCheck />
            <span>
              <strong>Your prescription stays private</strong>
              <small>
                Only authorised pharmacy team members can review it.
              </small>
            </span>
          </div>
          <div className="prescription-gate-actions">
            <Link href={`/login?next=${encodeURIComponent(uploadPath)}`}>
              <LogIn /> Log in
            </Link>
            <Link href={`/register?next=${encodeURIComponent(uploadPath)}`}>
              <UserPlus /> Sign up
            </Link>
          </div>
        </section>
      </main>
    );
  if (session.role !== "CUSTOMER") redirect("/unauthorized");
  const jar = await cookies();
  const cart = parseCart(jar.get(CART_COOKIE)?.value);
  const selectedQuantities = new Map(
    selected.map((item) => [item.id, item.quantity]),
  );
  const ids = [
    ...new Set([
      ...Object.keys(cart).map(Number),
      ...selected.map((item) => item.id),
    ]),
  ];
  const data = ids.length
    ? await backendJson<{ products: Product[] }>(
        `/v1/views/catalogue?ids=${encodeURIComponent(ids.join(","))}`,
      )
    : { products: [] };
  const linkedItems = data.products
    .filter(
      (product) =>
        product.prescriptionRequired &&
        (cart[product.id] || selectedQuantities.has(product.id)),
    )
    .map((product) => ({
      id: product.id,
      name: product.name,
      packSize: product.packSize,
      quantity: Math.max(
        cart[product.id] || 0,
        selectedQuantities.get(product.id) || 0,
      ),
    }));
  return <PrescriptionUploadForm linkedItems={linkedItems} />;
}
