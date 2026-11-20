import test from "node:test";
import assert from "node:assert/strict";
import {
  LOCAL_TRANSLATION_INCOMPLETE,
  clauseBoundaries,
  hasDecodingLoop,
  translateLocalText,
} from "../dist/local-nmt.js";

function fakeModel({ limit = 64, generate } = {}) {
  const calls = [],
    tokenizations = [];
  const tokenizer = (text, options) => {
    tokenizations.push({ text, options });
    return {
      input_ids: {
        dims: [1, text.length + 1],
        data: [...text].map((c) => c.charCodeAt(0) + 1).concat(0),
      },
      text,
    };
  };
  tokenizer.batch_decode = (output) => [output.text];
  const model = {
    config: { max_position_embeddings: limit, eos_token_id: 0 },
    generation_config: { eos_token_id: 0 },
    async generate(options) {
      calls.push(options);
      return generate?.(options) ?? { data: [1, 2, 0], text: options.text };
    },
  };
  return { model, tokenizer, calls, tokenizations };
}

test("clause cuts preserve measurements, parentheses, quotes, and numeric punctuation", () => {
  const text = 'A (25 °C, ±0.1 °C), B "red, blue"; C 1,200.50 mL, D 12:30';
  const { strong, weak } = clauseBoundaries(text);
  assert.deepEqual(
    strong.map((i) => text.slice(0, i)),
    ['A (25 °C, ±0.1 °C), B "red, blue";'],
  );
  assert.deepEqual(
    weak.map((i) => text.slice(0, i)),
    [
      "A (25 °C, ±0.1 °C),",
      'A (25 °C, ±0.1 °C), B "red, blue"; C 1,200.50 mL,',
    ],
  );
});

test("long recovery does not split explicit code or math literals", () => {
  const text = "Use `a,b;c` and $x_i, y_j$; then compare.";
  const cuts = clauseBoundaries(text);
  assert.deepEqual(cuts.weak, []);
  assert.deepEqual(cuts.strong, [text.indexOf("; then") + 1]);
});

test("long input is fully translated at clause boundaries without token truncation", async () => {
  const pipe = fakeModel();
  const text =
    "The inlet is closed (25 °C, 4 mL); the outlet remains open (30 °C, 8 mL); shipment is not approved.";
  assert.equal(await translateLocalText(pipe, text, "en", "en"), text);
  assert.equal(pipe.calls.length, 3);
  assert.ok(pipe.calls.every((c) => c.input_ids.dims.at(-1) <= 64));
  assert.ok(pipe.tokenizations.every((c) => c.options.truncation === false));
  assert.ok(pipe.calls.every((c) => c.forced_eos_token_id === null));
  assert.ok(pipe.calls.every((c) => c.max_new_tokens === 63));
});

test("unbreakable oversized input is rejected before any partial translation", async () => {
  const pipe = fakeModel();
  await assert.rejects(
    translateLocalText(pipe, "x".repeat(100), "en", "ja"),
    /長い文/,
  );
  assert.equal(pipe.calls.length, 0);
});

test("generation limit retries clauses and never accepts the truncated prefix", async () => {
  const pipe = fakeModel({
    generate: (o) =>
      o.text.includes("; ")
        ? { data: [1, 2, 3], text: "truncated" }
        : { data: [1, 2, 0], text: o.text },
  });
  const text = "Revenue rose; profit did not rise.";
  assert.equal(await translateLocalText(pipe, text, "en", "en"), text);
  assert.equal(pipe.calls.length, 3);
});

test("failure in the last clause rejects the whole request", async () => {
  const pipe = fakeModel({
    generate: (o) =>
      o.text.includes("failed")
        ? { data: [1, 2, 3], text: "incomplete" }
        : { data: [1, 2, 0], text: o.text },
  });
  await assert.rejects(
    translateLocalText(pipe, "First passed. Last failed.", "en", "ja"),
    /最後まで/,
  );
});

test("extreme decoding loops are detected, while repetition present in source is retained", () => {
  const loop = Array.from({ length: 180 }, (_, i) => (i % 3) + 1);
  assert.equal(hasDecodingLoop(loop, [8, 9, 10]), true);
  assert.equal(hasDecodingLoop(loop, loop), false);
  assert.equal(hasDecodingLoop([1, 1, 1, 1], [2]), false);
});

test("app's repaired abbreviation remains one inference input", async () => {
  const pipe = fakeModel({ limit: 512 });
  const text = "Dr. Mira Chen measured 3.2 V. Prof. Lewis agreed.";
  assert.equal(await translateLocalText(pipe, text, "en", "en"), text);
  assert.deepEqual(
    pipe.calls.map((c) => c.text),
    ["Dr. Mira Chen measured 3.2 V.", "Prof. Lewis agreed."],
  );
});

test("long recovery never accepts a complete-looking prefix which drops measurements", async () => {
  const pipe = fakeModel({
    generate: (o) => ({ data: [1, 2, 0], text: "Some unrelated text." }),
  });
  const text =
    "The primary sensor reports 25 °C; the backup sensor reports 30 °C; neither sensor should be disconnected.";
  await assert.rejects(translateLocalText(pipe, text, "en", "ja"), /測定値/);
});

test("ordinary direct PDF-size inputs retain the existing full-sentence path", async () => {
  const pipe = fakeModel({ limit: 512 });
  const text = "The sensor measured 25 °C (±0.1 °C). Do not disconnect it.";
  assert.equal(await translateLocalText(pipe, text, "en", "en"), text);
  assert.equal(pipe.calls.length, 2);
  assert.deepEqual(
    pipe.calls.map((x) => x.text),
    ["The sensor measured 25 °C (±0.1 °C).", "Do not disconnect it."],
  );
});

test("thousands of clause candidates never tokenize all candidate prefixes", async () => {
  const pipe = fakeModel({ limit: 512 });
  const text = Array.from({ length: 2048 }, () => "alpha").join(", ") + ".";
  assert.equal(await translateLocalText(pipe, text, "en", "en"), text);
  assert.ok(pipe.tokenizations.length < pipe.calls.length * 2 + 8);
  assert.ok(Math.max(...pipe.tokenizations.map((x) => x.text.length)) <= 4096);
  assert.ok(
    pipe.tokenizations.reduce((sum, x) => sum + x.text.length, 0) <
      text.length * 8,
  );
  assert.ok(pipe.calls.every((x) => x.input_ids.dims.at(-1) <= 512));
});

test("unbreakable huge input is rejected before the tokenizer allocates tensors", async () => {
  const pipe = fakeModel({ limit: 512 });
  await assert.rejects(
    translateLocalText(pipe, "x".repeat(20000), "en", "ja"),
    { code: LOCAL_TRANSLATION_INCOMPLETE },
  );
  assert.equal(pipe.tokenizations.length, 0);
  assert.equal(pipe.calls.length, 0);
});

test("only translation-completeness failures carry the retryable local code", async () => {
  const empty = fakeModel({ generate: () => ({ data: [1, 2, 0], text: "" }) });
  await assert.rejects(
    translateLocalText(empty, "A complete sentence.", "en", "ja"),
    { code: LOCAL_TRANSLATION_INCOMPLETE },
  );
  const originalError = new Error("Runtime allocation failed");
  const broken = fakeModel({
    generate: () => {
      throw originalError;
    },
  });
  await assert.rejects(
    translateLocalText(broken, "A complete sentence.", "en", "ja"),
    (error) => error === originalError && error.code === undefined,
  );
});
