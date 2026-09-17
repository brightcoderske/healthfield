"use client";

import { FileText, Package, Stethoscope } from "lucide-react";
import { useEffect, useState } from "react";

const ICONS = { orders: Package, prescriptions: FileText, consultations: Stethoscope } as const;

export type AccountTab = { id: keyof typeof ICONS; label: string; detail: string };

/**
 * The three services on a customer's account page — orders, prescriptions and
 * consultations — as tabs pinned to the top of the page.
 *
 * All three are visible the moment the page opens, rather than orders alone with the other
 * two found only by scrolling. Each tab jumps to its section, and as the page scrolls the
 * tab for the section being read is marked, so the tabs double as a sense of where you are.
 */
export function AccountTabs({ tabs }: { tabs: AccountTab[] }) {
  const [active, setActive] = useState<AccountTab["id"]>(tabs[0]?.id ?? "orders");

  useEffect(() => {
    // Which section is being read: the last one scrolled up to where a tap on its tab
    // lands it — its own scroll margin, just under the tabs. Using any other line left the
    // highlight one section behind the section a tap had just jumped to. Worked out from
    // positions on scroll rather than an observer, so it cannot be left stale by a missed
    // callback.
    const update = () => {
      let current = tabs[0]?.id;
      for (const tab of tabs) {
        const section = document.getElementById(tab.id);
        if (!section) continue;
        const landsAt = parseFloat(getComputedStyle(section).scrollMarginTop) || 0;
        if (section.getBoundingClientRect().top <= landsAt + 12) current = tab.id;
      }
      // At the very bottom of the page the last section counts as the one being read, even
      // when it is too short to reach the top.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        const last = [...tabs].reverse().find((tab) => document.getElementById(tab.id));
        if (last) current = last.id;
      }
      if (current) setActive((previous) => (previous === current ? previous : current));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [tabs]);

  return (
    <nav className="account-tabs" aria-label="My Healthfield">
      {tabs.map((tab) => {
        const Icon = ICONS[tab.id];
        const isActive = tab.id === active;
        return (
          <a
            key={tab.id}
            href={`#${tab.id}`}
            className={isActive ? "is-active" : undefined}
            aria-current={isActive ? "location" : undefined}
            onClick={() => setActive(tab.id)}
          >
            <Icon aria-hidden="true" />
            <span>
              <strong>{tab.label}</strong>
              <small>{tab.detail}</small>
            </span>
          </a>
        );
      })}
    </nav>
  );
}
