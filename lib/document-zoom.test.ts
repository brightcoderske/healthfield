import assert from "node:assert/strict";
import test from "node:test";
import { clampPan, FIT, MAX_ZOOM, panBy, stepZoom, toggleZoom, zoomAt } from "./document-zoom.ts";

const frame = { width: 400, height: 300 };

test("zooming keeps the point under the fingers where it was", () => {
  const point = { x: 100, y: 75 };
  const zoomed = zoomAt(FIT, 2, point, frame);
  assert.equal(zoomed.scale, 2);
  // The spot that was under the fingers is still under them: (point - offset) / scale is unchanged.
  assert.equal((point.x - zoomed.x) / zoomed.scale, point.x);
  assert.equal((point.y - zoomed.y) / zoomed.scale, point.y);
});

test("zooming all the way out always puts the document back exactly as it started", () => {
  let state = zoomAt(FIT, 4, { x: 380, y: 290 }, frame);
  state = panBy(state, -120, -80, frame);
  assert.notDeepEqual(state, FIT);
  assert.deepEqual(zoomAt(state, 1, { x: 10, y: 10 }, frame), FIT);
  assert.deepEqual(zoomAt(state, 0.2, { x: 10, y: 10 }, frame), FIT, "pinching past fit stops at fit");
  let stepped = state;
  for (let press = 0; press < 10; press += 1) stepped = stepZoom(stepped, -1, frame);
  assert.deepEqual(stepped, FIT, "the minus button always gets back to fit");
});

test("zoom never goes past the limit", () => {
  assert.equal(zoomAt(FIT, 50, { x: 0, y: 0 }, frame).scale, MAX_ZOOM);
  let state = FIT;
  for (let press = 0; press < 20; press += 1) state = stepZoom(state, 1, frame);
  assert.equal(state.scale, MAX_ZOOM);
});

test("dragging never pulls empty frame into view", () => {
  const zoomed = zoomAt(FIT, 2, { x: 200, y: 150 }, frame);
  const farRight = panBy(zoomed, 10_000, 10_000, frame);
  assert.deepEqual({ x: farRight.x, y: farRight.y }, { x: 0, y: 0 });
  const farLeft = panBy(zoomed, -10_000, -10_000, frame);
  assert.deepEqual({ x: farLeft.x, y: farLeft.y }, { x: -400, y: -300 }, "the far edge stops at the frame's edge");
  assert.deepEqual(panBy(FIT, 50, 50, frame), FIT, "nothing moves at fit");
});

test("a double tap zooms in to read, and a second one goes back to fit", () => {
  const zoomed = toggleZoom(FIT, { x: 200, y: 150 }, frame);
  assert.equal(zoomed.scale, 2.5);
  assert.deepEqual(toggleZoom(zoomed, { x: 50, y: 50 }, frame), FIT);
});

test("bad numbers from a gesture are made safe instead of breaking the view", () => {
  assert.deepEqual(clampPan({ scale: Number.NaN, x: Number.NaN, y: 5 }, frame), FIT);
  assert.deepEqual(zoomAt(FIT, Number.POSITIVE_INFINITY, { x: 0, y: 0 }, frame), FIT);
});
