/**
 * The arithmetic behind the prescription document viewer's zoom, kept pure so it can be tested.
 *
 * The document is drawn to fit its frame at scale 1 and then moved with
 * `translate(x, y) scale(scale)` from the top-left corner. Zooming keeps the point under the
 * fingers (or the pointer) where it is, and the picture is never dragged so far that empty frame
 * shows beside it. At scale 1 it always sits exactly where it started, which is what makes
 * "zoom all the way out" a dependable way back.
 */
export type ZoomState = { scale: number; x: number; y: number };
export type FrameSize = { width: number; height: number };
export type Point = { x: number; y: number };

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;
export const ZOOM_STEP = 1.5;
export const DOUBLE_TAP_ZOOM = 2.5;
export const FIT: ZoomState = { scale: 1, x: 0, y: 0 };

function clampScale(scale: number) {
  if (!Number.isFinite(scale)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/** Keeps the enlarged picture covering the frame: no gap may open on any side. */
export function clampPan(state: ZoomState, frame: FrameSize): ZoomState {
  const scale = clampScale(state.scale);
  const minX = frame.width - frame.width * scale;
  const minY = frame.height - frame.height * scale;
  return {
    scale,
    x: Math.min(0, Math.max(minX, Number.isFinite(state.x) ? state.x : 0)),
    y: Math.min(0, Math.max(minY, Number.isFinite(state.y) ? state.y : 0)),
  };
}

/** Zooms to `nextScale` keeping `point` (in frame coordinates) still. */
export function zoomAt(state: ZoomState, nextScale: number, point: Point, frame: FrameSize): ZoomState {
  const scale = clampScale(nextScale);
  if (scale === MIN_ZOOM) return FIT;
  const ratio = scale / state.scale;
  return clampPan({ scale, x: point.x - (point.x - state.x) * ratio, y: point.y - (point.y - state.y) * ratio }, frame);
}

/** Moves the enlarged picture by a drag of (dx, dy). Does nothing at scale 1. */
export function panBy(state: ZoomState, dx: number, dy: number, frame: FrameSize): ZoomState {
  if (state.scale <= MIN_ZOOM) return FIT;
  return clampPan({ scale: state.scale, x: state.x + dx, y: state.y + dy }, frame);
}

/** One press of the + or − button, about the middle of the frame. */
export function stepZoom(state: ZoomState, direction: 1 | -1, frame: FrameSize): ZoomState {
  const next = direction === 1 ? state.scale * ZOOM_STEP : state.scale / ZOOM_STEP;
  return zoomAt(state, next, { x: frame.width / 2, y: frame.height / 2 }, frame);
}

/** A double tap: in to a reading size at that spot, or back out to fit when already zoomed. */
export function toggleZoom(state: ZoomState, point: Point, frame: FrameSize): ZoomState {
  return state.scale > MIN_ZOOM ? FIT : zoomAt(state, DOUBLE_TAP_ZOOM, point, frame);
}
