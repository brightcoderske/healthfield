"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * How many columns a CSS grid is showing right now, read from the browser rather than
 * assumed from a breakpoint list. The catalogue grid changes its column count with the
 * screen (phone, tablet, laptop, wide), and the interruption cards are placed in whole
 * rows, so they need the real number.
 *
 * `initial` is what the server render and the first client render use, so hydration
 * agrees. The layout effect then replaces it with the measured count before the browser
 * paints, and a ResizeObserver keeps it right when the window is resized or rotated.
 */
export function useGridColumns<T extends HTMLElement>(initial: number) {
  const ref = useRef<T>(null);
  const [columns, setColumns] = useState(initial);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const style = getComputedStyle(element);
      // Only a grid reports its tracks as a resolved list ("158px 158px ..."); anything
      // else would be counted wrongly, so it leaves the current value alone.
      if (!style.display.includes("grid")) return;
      const tracks = style.gridTemplateColumns.split(" ").filter((track) => track && track !== "none").length;
      if (tracks > 0) setColumns(tracks);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, columns };
}
