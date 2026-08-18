import { LogIn, ShieldCheck, Stethoscope, UserPlus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ConsultationRequestForm } from "./consultation-request-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Get a prescription",
  description:
    "Describe your symptoms and consult a healthcare professional. Healthfield does not issue prescriptions automatically; a professional reviews every request.",
};

const CONSULT_PATH = "/prescriptions/consult";

export default async function ConsultationRequestPage() {
  const session = await getSession();
  if (!session)
    return (
      <main className="prescription-upload-page">
        <section className="prescription-account-gate">
          <Link className="prescription-gate-back" href="/">
            ← Continue shopping
          </Link>
          <span className="prescription-gate-icon">
            <Stethoscope />
          </span>
          <span className="auth-kicker">Prescription consultation</span>
          <h1>Thank you — we are ready to help</h1>
          <p>
            A healthcare professional will look at what you describe and get back
            to you as quickly as we can. Because you will be sharing health
            details, we just need to know who we are talking to first — it takes
            less than a minute.
          </p>
          <div className="prescription-gate-assurance">
            <ShieldCheck />
            <span>
              <strong>This keeps your information private</strong>
              <small>
                Only the professional handling your case can see what you share.
              </small>
            </span>
          </div>
          <div className="prescription-gate-actions">
            <Link href={`/login?next=${encodeURIComponent(CONSULT_PATH)}`}>
              <LogIn /> I already have an account
            </Link>
            <Link href={`/register?next=${encodeURIComponent(CONSULT_PATH)}`}>
              <UserPlus /> Create my account
            </Link>
          </div>
        </section>
      </main>
    );
  if (session.role !== "CUSTOMER") redirect("/unauthorized");
  return <ConsultationRequestForm />;
}
