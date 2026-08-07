"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";

export function AdminBackToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const update = () => setVisible(window.scrollY > window.innerHeight / 2);
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return <button className={`admin-back-to-top${visible ? " visible" : ""}`} type="button" aria-label="Back to top" tabIndex={visible ? 0 : -1} onClick={() => window.scrollTo({ top:0, behavior:"smooth" })}><ArrowUp/><span>Top</span></button>;
}
