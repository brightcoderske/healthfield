import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { CONSULT_PATH } from "./consult-banner";

/**
 * The consultation banner: a hero-scale route into the flow the small ConsultBanner
 * pill already points at.
 *
 * One component serves both placements. On a phone it is a block in the page; on a
 * laptop the same markup is a slide inside the rotating hero. Keeping it single means
 * the copy and the claims cannot drift apart between the two.
 *
 * The panel is deliberately near-white: a solid purple card competed with the purple
 * navigation directly above it and flattened the doctor into the background. Purple
 * identifies the pharmacy; pink is reserved for the action.
 *
 * `priority` is a prop rather than an assumption: only the placement visible on first
 * paint should preload, or the page ships two large images and loses the LCP it was
 * meant to win.
 */
export function PrescriptionHero({
  className,
  priority = false,
  availability = "7am – 10pm",
}: {
  className?: string;
  priority?: boolean;
  availability?: string;
}) {
  return (
    <section className={className ? `prescription-hero ${className}` : "prescription-hero"}>
      <div className="prescription-hero-copy">
        <h2>
          <span>Need a</span>
          <em>Prescription?</em>
        </h2>
        <p>Consult a licensed doctor online from the comfort of your home.</p>
        <Link className="prescription-hero-cta" href={CONSULT_PATH}>
          Consult a Doctor <ArrowRight />
        </Link>
      </div>
      <div className="prescription-hero-figure">
        <Image
          src="/healthfield-doctor.png"
          alt="Healthfield doctor available for an online consultation"
          width={1240}
          height={1269}
          priority={priority}
          sizes="(max-width: 980px) 50vw, 420px"
        />
        {/* Deliberately "Available" rather than "Online": it states the hours the
            service is staffed without implying a doctor is at the screen this second. */}
        <div className="prescription-hero-availability">
          <span>
            <i aria-hidden="true" /> Available
          </span>
          <b>{availability}</b>
        </div>
      </div>
    </section>
  );
}
