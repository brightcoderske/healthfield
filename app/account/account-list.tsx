"use client";

import { Children, useState, type ReactNode } from "react";

/** How many entries a section shows before the rest are folded away. */
const SHOWN = 5;

/**
 * The entries in one account section, folded after the most recent few.
 *
 * A customer with thirty orders would otherwise scroll past all thirty to reach their
 * prescriptions. The newest are shown, and the rest open in place with one tap — no page
 * change, and the section keeps its position under the tabs.
 */
export function AccountList({ children, noun }: { children: ReactNode; noun: string }) {
  const entries = Children.toArray(children);
  const [open, setOpen] = useState(false);
  const hidden = entries.length - SHOWN;

  return (
    <>
      {open || hidden <= 0 ? entries : entries.slice(0, SHOWN)}
      {hidden > 0 ? (
        <button
          type="button"
          className="account-see-all"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? `Show fewer ${noun}s` : `Show ${hidden} more ${noun}${hidden === 1 ? "" : "s"}`}
        </button>
      ) : null}
    </>
  );
}
