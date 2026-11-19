"use client";

/* eslint-disable @next/next/no-img-element */

import { Maximize2, Minimize2, Minus, Plus, Scan } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { FIT, MAX_ZOOM, panBy, stepZoom, toggleZoom, zoomAt, type Point, type ZoomState } from "@/lib/document-zoom";

const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DISTANCE_PX = 30;

/**
 * The prescription document, with its own zoom.
 *
 * On a phone the only way to read a prescription used to be pinching the whole page. Inside the
 * full-screen review sheet, with its own scrolling panel, a pinch back out was often taken as a
 * scroll instead, so the reviewer stayed zoomed in and had to close the prescription to get out.
 * Here the picture zooms inside its frame (pinch, double tap, the − / + buttons, or Ctrl + wheel on
 * a computer) and the page itself never does, so "Fit" or the minus button always gets back.
 * "Full screen" gives the document the whole screen, since the frame on a phone is a narrow strip.
 *
 * A PDF is drawn by the browser's own viewer, which has its own zoom, so it gets only Full screen.
 * Give it a `key` of the document address so a different prescription opens at fit.
 */
export function ZoomableDocument({ src, mimeType, title, alt }: { src: string; mimeType: string; title: string; alt: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<ZoomState>(FIT);
  const [expanded, setExpanded] = useState(false);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const lastTap = useRef<{ time: number; point: Point } | null>(null);
  const isImage = mimeType.startsWith("image/");
  // The wheel handler below must decide at once whether to stop the page scrolling, so it reads the
  // current zoom from here rather than from inside a state update that may run later.
  const scale = useRef(zoom.scale);
  useEffect(() => {
    scale.current = zoom.scale;
  }, [zoom.scale]);

  function frameSize() {
    const box = frame.current?.getBoundingClientRect();
    return { width: Math.max(1, box?.width ?? 1), height: Math.max(1, box?.height ?? 1) };
  }

  function localPoint(clientX: number, clientY: number): Point {
    const box = frame.current?.getBoundingClientRect();
    return { x: clientX - (box?.left ?? 0), y: clientY - (box?.top ?? 0) };
  }

  function pinchShape() {
    const [first, second] = [...pointers.current.values()];
    return {
      distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      middle: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    };
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isImage) return;
    // Keeps a drag that leaves the frame still moving the picture. Some browsers refuse it, which costs
    // nothing more than that, so a refusal must not stop the gesture.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* not capturable */
    }
    const point = localPoint(event.clientX, event.clientY);
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size === 2) {
      pinch.current = { distance: pinchShape().distance, scale: zoom.scale };
      lastTap.current = null;
      return;
    }
    const previous = lastTap.current;
    const now = event.timeStamp;
    if (previous && now - previous.time < DOUBLE_TAP_MS && Math.hypot(point.x - previous.point.x, point.y - previous.point.y) < DOUBLE_TAP_DISTANCE_PX) {
      lastTap.current = null;
      setZoom((state) => toggleZoom(state, point, frameSize()));
      return;
    }
    lastTap.current = { time: now, point };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const before = pointers.current.get(event.pointerId);
    if (!before) return;
    const point = localPoint(event.clientX, event.clientY);
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size >= 2 && pinch.current) {
      const { distance, middle } = pinchShape();
      const target = pinch.current.scale * (distance / pinch.current.distance);
      setZoom((state) => zoomAt(state, target, middle, frameSize()));
      return;
    }
    if (pointers.current.size === 1) setZoom((state) => panBy(state, point.x - before.x, point.y - before.y, frameSize()));
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  // Ctrl + wheel (and a trackpad pinch, which browsers report the same way) zooms; a plain wheel
  // moves an enlarged picture and otherwise scrolls the page as usual. Registered by hand because a
  // React wheel handler is passive and cannot stop the browser zooming the whole page.
  useEffect(() => {
    const element = frame.current;
    if (!element || !isImage) return;
    function onWheel(event: WheelEvent) {
      const target = frame.current;
      if (!target) return;
      const box = target.getBoundingClientRect();
      const size = { width: Math.max(1, box.width), height: Math.max(1, box.height) };
      const point = { x: event.clientX - box.left, y: event.clientY - box.top };
      if (event.ctrlKey) {
        event.preventDefault();
        setZoom((state) => zoomAt(state, state.scale * Math.exp(-event.deltaY / 200), point, size));
        return;
      }
      if (scale.current <= 1) return;
      event.preventDefault();
      setZoom((state) => panBy(state, -event.deltaX, -event.deltaY, size));
    }
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [isImage]);

  // Escape leaves full screen, as it would anywhere else.
  useEffect(() => {
    if (!expanded) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setExpanded(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const percent = Math.round(zoom.scale * 100);
  return (
    <div className={`zoom-document${expanded ? " is-expanded" : ""}`}>
      <div
        ref={frame}
        className={`zoom-document-frame${isImage ? " is-image" : ""}${zoom.scale > 1 ? " is-zoomed" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        {isImage ? (
          <img
            src={src}
            alt={alt}
            draggable={false}
            style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` }}
          />
        ) : (
          <iframe src={src} title={title} />
        )}
      </div>
      <div className="zoom-document-tools" role="toolbar" aria-label="Document view">
        {isImage ? (
          <>
            <button type="button" onClick={() => setZoom((state) => stepZoom(state, -1, frameSize()))} disabled={zoom.scale <= 1} aria-label="Zoom out"><Minus /></button>
            <output aria-live="polite" aria-label="Zoom level">{percent}%</output>
            <button type="button" onClick={() => setZoom((state) => stepZoom(state, 1, frameSize()))} disabled={zoom.scale >= MAX_ZOOM} aria-label="Zoom in"><Plus /></button>
            <button type="button" onClick={() => setZoom(FIT)} disabled={zoom.scale <= 1} aria-label="Fit the whole document"><Scan /> Fit</button>
          </>
        ) : null}
        <button type="button" onClick={() => setExpanded((value) => !value)} aria-pressed={expanded} aria-label={expanded ? "Leave full screen" : "Show the document full screen"}>
          {expanded ? <Minimize2 /> : <Maximize2 />} {expanded ? "Close" : "Full screen"}
        </button>
      </div>
    </div>
  );
}
