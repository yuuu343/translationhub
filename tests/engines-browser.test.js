import test from "node:test";
import assert from "node:assert/strict";

test("canceling the job which created a browser Translator cannot poison later jobs", async () => {
  const created = [];
  globalThis.Translator = {
    availability: async () => "available",
    create: async ({ signal }) => {
      const translator = {
        async translate(text, options) {
          signal?.throwIfAborted();
          options.signal?.throwIfAborted();
          return "訳: " + text;
        },
        destroy() {},
      };
      created.push(translator);
      return translator;
    },
  };
  const engine = await import("../dist/engines.js?browser-abort-reuse");
  const first = new AbortController();
  assert.equal(
    await engine.translate("First", {
      source: "en",
      target: "ja",
      signal: first.signal,
    }),
    "訳: First",
  );
  first.abort();
  assert.equal(
    await engine.translate("Next", { source: "en", target: "ja" }),
    "訳: Next",
  );
  assert.equal(created.length, 2);
  assert.equal(
    await engine.translate("Again", { source: "en", target: "ja" }),
    "訳: Again",
  );
  assert.equal(created.length, 2);
});
