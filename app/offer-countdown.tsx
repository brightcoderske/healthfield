"use client";

import { useEffect, useState } from "react";

function remaining(endsAt: string, now: number) {
  const left = new Date(endsAt).getTime() - now;
  if (!Number.isFinite(left) || left <= 0) return null;
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);
  return { days, hours, minutes, seconds, urgent: left < 86_400_000 };
}

/**
 * Live "time left" for an offer.
 *
 * Renders nothing on the server and on the first client paint: the countdown is
 * derived from the current clock, and server and browser clocks never match to the
 * second, so drawing it during hydration would guarantee a mismatch. It appears
 * immediately after mount instead.
 */
export function OfferCountdown({ endsAt }: { endsAt: string | null }) {
  const [left, setLeft] = useState<ReturnType<typeof remaining>>(null);

  useEffect(() => {
    if (!endsAt) return;
    const tick = () => setLeft(remaining(endsAt, Date.now()));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [endsAt]);

  if (!endsAt || !left) return null;
  const pad = (value: number) => String(value).padStart(2, "0");
  // Seconds are always shown. Without them a multi-day offer only changed once a
  // minute, so the clock looked frozen — the visible tick is the whole point.
  const counter = [pad(left.days), pad(left.hours), pad(left.minutes), pad(left.seconds)].join(":");

  return <time className={`offer-countdown${left.urgent ? " is-urgent" : ""}`}
    dateTime={endsAt}
    title="Days : hours : minutes : seconds"
    aria-label={`Offer ends in ${left.days} days ${left.hours} hours ${left.minutes} minutes ${left.seconds} seconds`}>
    {counter}
  </time>;
}
