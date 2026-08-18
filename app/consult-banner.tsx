import Link from "next/link";

export const CONSULT_PATH = "/prescriptions/consult";

// The messages cycle through CSS rather than a timer, so the banner costs nothing
// at runtime and cannot desynchronise during hydration. The first line is repeated
// at the end so the loop closes by continuing forward instead of rewinding.
const messages = ["Get a Prescription", "Consult a Doctor", "Need a Prescription?"];

// A doctor wearing a stethoscope, drawn inline so it stays crisp at any size and
// carries no network request. Kept bold and simple: fine detail disappears at 26px.
function DoctorMark() {
  return (
    <svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <circle cx="14" cy="6.6" r="4.1" fill="currentColor" />
      <path
        d="M4.6 25.4v-2.6c0-4.3 4.2-7 9.4-7s9.4 2.7 9.4 7v2.6Z"
        fill="currentColor"
        opacity="0.42"
      />
      <path
        d="M10.1 16.6v2.9a4 4 0 0 0 8 0v-2.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="18.1" cy="21.6" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function ConsultBanner({ className }: { className?: string }) {
  return (
    <Link
      className={className ? `rx-consult-banner ${className}` : "rx-consult-banner"}
      href={CONSULT_PATH}
      aria-label="Get a prescription: consult a healthcare professional"
    >
      <span className="rx-consult-mark">
        <DoctorMark />
      </span>
      <b aria-hidden="true">
        <span>
          {[...messages, messages[0]].map((message, index) => (
            <i key={`${message}-${index}`}>{message}</i>
          ))}
        </span>
      </b>
    </Link>
  );
}
