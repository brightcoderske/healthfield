import { ArrowRight, Stethoscope, Upload } from "lucide-react";
import Link from "next/link";
import { CONSULT_PATH } from "./consult-banner";

/**
 * The two ways into the prescription service, as one either/or choice.
 *
 * The banner above answers "I need a prescription". Someone who already holds one had
 * no obvious route except the menu, so the decision is made explicit here: have one and
 * upload it, or need one and consult. Phone only — the desktop header carries both.
 */
export function PrescriptionQuickActions({ className }: { className?: string }) {
  return (
    <div className={className ? `rx-quick-actions ${className}` : "rx-quick-actions"}>
      <Link href="/prescriptions/upload">
        <span className="rx-quick-icon">
          <Upload />
        </span>
        <span className="rx-quick-copy">
          <strong>Upload Prescription</strong>
          <small>Already have one?</small>
        </span>
        <ArrowRight />
      </Link>
      <Link href={CONSULT_PATH}>
        <span className="rx-quick-icon">
          <Stethoscope />
        </span>
        <span className="rx-quick-copy">
          <strong>Consult a Doctor</strong>
          <small>Need a prescription?</small>
        </span>
        <ArrowRight />
      </Link>
    </div>
  );
}
