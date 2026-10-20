import assert from "node:assert/strict";
import test from "node:test";
import { initZoom, normalizeZoom, nextZoom } from "./zoom.js";

test("zoom is bounded and stored levels normalize safely", () => {
  for (const value of [null, undefined, "", "bad", NaN, Infinity]) assert.equal(normalizeZoom(value), 1);
  assert.equal(normalizeZoom("1.24"), 1.25);
  assert.equal(normalizeZoom(-10), 0.5);
  assert.equal(normalizeZoom(20), 2);
  assert.equal(nextZoom(2, 1), 2);
  assert.equal(nextZoom(0.5, -1), 0.5);
});
test("buttons, keyboard and wheel share application zoom and ordered persistence", async () => {
  const makeTarget = () => ({ textContent: "", attrs: {}, events: {}, addEventListener(type, callback) { this.events[type] = callback; }, setAttribute(name, value) { this.attrs[name] = value; } });
  const targets = Object.fromEntries(["zoom-in", "zoom-out", "zoom-level"].map(id => [id, makeTarget()]));
  const windowRef = makeTarget(), documentRef = { getElementById: id => targets[id], documentElement: { style: {} } };
  const saved = [];
  initZoom({ documentRef, windowRef, initial: 1.25, save: async value => saved.push(value) });
  assert.equal(documentRef.documentElement.style.zoom, "1.25");
  targets["zoom-in"].events.click();
  let prevented = 0;
  const event = { ctrlKey: true, preventDefault() { prevented++; } };
  windowRef.events.keydown({ ...event, key: "-" });
  windowRef.events.keydown({ ...event, ctrlKey: false, metaKey: true, key: "0" });
  windowRef.events.wheel({ ...event, deltaY: -1 });
  windowRef.events.wheel({ ...event, ctrlKey: false, deltaY: 1 });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(saved, [1.5, 1.25, 1, 1.1]);
  assert.equal(prevented, 3);
  assert.equal(targets["zoom-level"].textContent, "110%");
  targets["zoom-level"].events.click();
  assert.equal(documentRef.documentElement.style.zoom, "1");
});
