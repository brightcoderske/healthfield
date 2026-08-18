"use client";

import { FileUp, Stethoscope, X } from "lucide-react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CONSULT_PATH } from "./consult-banner";
import { prescriptionUploadHref, type PrescriptionSelection } from "@/lib/prescription-selection";
import styles from "./prescription-add-button.module.css";

export function PrescriptionAddButton({ items, className, children, ariaLabel }: { items:PrescriptionSelection[]; className?:string; children:ReactNode; ariaLabel?:string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const titleId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const uploadHref = prescriptionUploadHref(items);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(340, window.innerWidth - 20);
      const left = Math.max(10, Math.min(window.innerWidth - width - 10, rect.left + rect.width / 2 - width / 2));
      setPosition(rect.top >= 340
        ? { width, left, bottom:window.innerHeight - rect.top + 10 }
        : { width, left, top:rect.bottom + 10 });
    };
    place();
    closeButton.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const popover = open && typeof document !== "undefined" ? createPortal(<div className={styles.backdrop} role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className={styles.dialog} style={position} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button ref={closeButton} className={styles.close} type="button" onClick={() => setOpen(false)} aria-label="Close prescription notice"><X/></button>
        <p className={styles.message} id={titleId}>
          <strong>{items.length === 1 ? items[0]?.name || "This medicine" : "These medicines"}</strong> need a prescription before we can dispense {items.length === 1 ? "it" : "them"}. Choose the option that fits you — either way we take it from here.
        </p>
        <div className="rx-route-choice">
          <Link href={uploadHref}><FileUp/><span><strong>Upload prescription</strong><small>You already have one from a doctor.</small></span></Link>
          <Link className="rx-route-primary" href={CONSULT_PATH}><Stethoscope/><span><strong>Get a prescription</strong><small>Consult a healthcare professional first.</small></span></Link>
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={() => setOpen(false)}>Back to shopping</button>
        </div>
      </section>
    </div>, document.body) : null;

  return <>
    <button ref={trigger} type="button" className={className} aria-label={ariaLabel} aria-expanded={open} onClick={() => setOpen(true)}>{children}</button>
    {popover}
  </>;
}
