import { Stethoscope } from "lucide-react";
import Link from "next/link";
import { backendJson } from "@/lib/backend-api";
import { requireRole } from "@/lib/auth";
import { consultationStatusLabels, type ConsultationStatus } from "@/lib/consultation-workflow";
import type { ConsultationSummary } from "./types";

export const dynamic = "force-dynamic";

export default async function CustomerConsultationsPage() {
  await requireRole(["CUSTOMER"]);
  const data = await backendJson<{ consultations: ConsultationSummary[] }>("/v1/views/consultations");

  return (
    <main className="rx-consult-page">
      <Link href="/account">← My account</Link>
      <div className="rx-thread-head">
        <h1 style={{ fontSize: 22, margin: 0 }}>My consultations</h1>
        <Link href="/prescriptions/consult">Start a new consultation</Link>
      </div>

      {data.consultations.length ? (
        <div className="rx-consult-list">
          {data.consultations.map((item) => (
            <article key={item.id}>
              <div>
                <span className={`rx-status ${item.status.toLowerCase().replaceAll("_", "-")}`}>
                  {consultationStatusLabels[item.status as ConsultationStatus] || item.status.replaceAll("_", " ")}
                </span>
                <h2>{item.reference}</h2>
                <p>{item.concern}</p>
              </div>
              <Link href={`/account/consultations/${item.id}`}>Open</Link>
            </article>
          ))}
        </div>
      ) : (
        <div className="rx-consult-empty">
          <Stethoscope />
          <strong>No consultations yet</strong>
          <p>
            Need medicine but do not have a prescription? Describe your symptoms and a healthcare professional will
            review your case.
          </p>
          <Link href="/prescriptions/consult">Get a prescription</Link>
        </div>
      )}
    </main>
  );
}
