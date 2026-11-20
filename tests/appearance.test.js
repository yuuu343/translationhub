import test from "node:test";
import assert from "node:assert/strict";

let serial = 0;
async function setup(stored, reduced = false, { indexedDB, waitForPhoto = true } = {}) {
  const properties = new Map(), writes = [], events = [], listeners = new Set();
  const root = { dataset: {}, style: { setProperty: (name, value) => properties.set(name, value) } };
  const media = { matches: reduced, addEventListener: (_, callback) => listeners.add(callback) };
  globalThis.document = { documentElement: root };
  globalThis.matchMedia = () => media;
  globalThis.indexedDB = indexedDB;
  globalThis.localStorage = {
    getItem: () => stored === undefined ? null : stored,
    setItem: (key, value) => writes.push({ key, value: JSON.parse(value) }),
  };
  globalThis.dispatchEvent = event => { events.push(event); return true; };
  const appearance = await import(`../dist/appearance.js?preferences=${++serial}`);
  const initialized = appearance.initAppearance();
  if (waitForPhoto) await initialized;
  return { appearance, root, properties, writes, events, initialized,
    reduce(value) { media.matches = value; listeners.forEach(callback => callback({ matches: value })); } };
}

test("new devices start with sakura and follow reduced motion without writing defaults", async () => {
  const { appearance, root, properties, writes } = await setup(undefined, true);
  assert.equal(appearance.getAppearance().scene, "sakura");
  assert.equal(appearance.getAppearance().motion, "auto");
  assert.equal(appearance.getAppearance().motionEnabled, false);
  assert.equal(root.dataset.motion, "off");
  assert.equal(properties.get("--scene-play-state"), "paused");
  assert.equal(properties.get("--reading-opacity"), "0.88");
  assert.deepEqual(writes, []);
});

test("initial appearance is emitted before local photo storage responds", async () => {
  const request = {};
  const stored = JSON.stringify({ scene: "flight", opacity: 64, motion: "off" });
  const { appearance, root, properties, events, initialized, writes } = await setup(stored, false, {
    indexedDB: { open: () => request }, waitForPhoto: false,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "translationhub:appearance");
  assert.equal(events[0].detail.scene, "flight");
  assert.equal(root.dataset.scene, "flight");
  assert.equal(root.dataset.motion, "off");
  assert.equal(properties.get("--scene-opacity"), "0.64");
  assert.equal(appearance.initAppearance(), initialized);
  assert.deepEqual(writes, []);
  request.error = Error("storage unavailable");
  request.onerror();
  await initialized;
  assert.equal(appearance.getAppearance().scene, "flight");
});

test("existing theme IDs and existing zero-opacity preferences remain selected", async () => {
  for (const scene of ["alpenglow", "blue-hour", "mountain-morning", "forest-stillness", "none"]) {
    const old = { scene, opacity: 0, font: "serif", fontSize: 24, lineHeight: 2.3 };
    const { appearance, writes, properties } = await setup(JSON.stringify(old));
    for (const [key, value] of Object.entries(old)) assert.equal(appearance.getAppearance()[key], value);
    assert.equal(appearance.getAppearance().readingTransparency, 12);
    assert.equal(appearance.getAppearance().motion, "auto");
    assert.equal(properties.get("--scene-opacity"), "0");
    if (scene === "none") assert.equal(properties.get("--scene-image"), "none");
    assert.deepEqual(writes, []);
  }
});

test("background strength and reading transparency are independent and persist", async () => {
  const { appearance, properties, writes } = await setup();
  appearance.setAppearance({ opacity: 35 });
  assert.equal(properties.get("--scene-opacity"), "0.35");
  assert.equal(properties.get("--reading-opacity"), "0.88");
  appearance.setAppearance({ readingTransparency: 100 });
  assert.equal(properties.get("--scene-opacity"), "0.35");
  assert.equal(properties.get("--reading-opacity"), "0");
  appearance.setAppearance({ readingTransparency: 0 });
  assert.equal(properties.get("--reading-opacity"), "1");
  assert.equal(writes.at(-1).key, "translationhub.appearance.v1");
  assert.equal(writes.at(-1).value.opacity, 35);
  assert.equal(writes.at(-1).value.readingTransparency, 0);
  assert.equal(Object.hasOwn(writes.at(-1).value, "motionEnabled"), false);
  assert.equal(Object.hasOwn(writes.at(-1).value, "hasCustomPhoto"), false);
});

test("automatic motion reacts live while explicit choices take precedence", async () => {
  const { appearance, root, properties, reduce } = await setup();
  assert.equal(root.dataset.motion, "on");
  reduce(true);
  assert.equal(root.dataset.motion, "off");
  appearance.setAppearance({ motion: "on" });
  assert.equal(root.dataset.motion, "on");
  assert.equal(root.dataset.motionPreference, "on");
  reduce(false); reduce(true);
  assert.equal(properties.get("--scene-play-state"), "running");
  appearance.setAppearance({ motion: "off" });
  reduce(false);
  assert.equal(root.dataset.motion, "off");
  appearance.setAppearance({ motion: "auto" });
  assert.equal(root.dataset.motion, "on");
  assert.equal(appearance.getAppearance().motionEnabled, true);
});

test("new themes and reading settings restore without migration writes", async () => {
  const value = { scene: "sunlit", opacity: 82, readingTransparency: 45, motion: "off", font: "book", fontSize: 21, lineHeight: 2.15 };
  const { appearance, root, properties, writes } = await setup(JSON.stringify(value));
  for (const [key, expected] of Object.entries(value)) assert.equal(appearance.getAppearance()[key], expected);
  assert.equal(root.dataset.scene, "sunlit");
  assert.match(properties.get("--scene-image"), /atmosphere\/sunlit-preview\.webp/);
  assert.equal(properties.get("--reading-opacity"), "0.55");
  assert.deepEqual(writes, []);
});

test("corrupt preferences recover and missing custom photo falls back safely", async () => {
  for (const stored of ["{broken", "null", JSON.stringify({ scene: "unknown", motion: "yes" }), JSON.stringify({ scene: "custom" })]) {
    const { appearance } = await setup(stored);
    assert.equal(appearance.getAppearance().scene, "sakura");
    assert.equal(appearance.getAppearance().motion, "auto");
  }
});

test("storage failure preserves live appearance without claiming persistence", async () => {
  const { appearance, root } = await setup();
  globalThis.localStorage.setItem = () => { throw Error("storage disabled"); };
  const result = appearance.setAppearance({ scene: "flight", readingTransparency: 150 });
  assert.equal(result.saved, false);
  assert.equal(root.dataset.scene, "flight");
  assert.equal(result.readingTransparency, 100);
});
