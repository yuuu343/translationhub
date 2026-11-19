import test from "node:test";
import assert from "node:assert/strict";
import { segmentText, sampleDoc, validateDocument } from "../dist/documents.js";
import { parsePageRange, validateProject } from "../dist/pdf.js";

test("document offsets survive punctuation, Japanese, CRLF and an emoji", () => {
  const text =
    "  ありがとう。さようなら。\r\n\r\n👋 Hello! Watch the 3.5% margin.\n";
  const segments = segmentText(text, "ja");
  assert.equal(segments.map((s) => s.gap + s.source).join(""), text.trimEnd());
  assert(segments.some((s) => s.source === "さようなら。"));
  const restored = validateDocument({
    format: "translationhub.text",
    version: 1,
    text,
    from: "ja",
    to: "en",
    segments,
  });
  assert.equal(restored.text, text);
});
test("persisted phrase links retain exact positions and invalid offsets are discarded", () => {
  const sample = sampleDoc("letter"),
    part = sample.segments[1];
  part.links.unshift([0, 2, 0, 100000]);
  const saved = validateDocument(JSON.parse(JSON.stringify(sample)));
  assert(
    saved.segments[1].links.every(
      ([a, b, c, d]) =>
        b <= part.source.length && d <= part.target.length && b > a && d > c,
    ),
  );
  assert(
    saved.segments[1].links.some(
      ([a, b, c, d]) =>
        part.source.slice(a, b) === "operating income" &&
        part.target.slice(c, d) === "営業利益",
    ),
  );
  saved.segments[0].source += "x";
  assert.throws(() => validateDocument(saved));
});
test("PDF translation does not accept out-of-range or reversed pages", () => {
  assert.deepEqual(parsePageRange("3-5, 2, 4", 6), [2, 3, 4, 5]);
  for (const bad of ["0", "7", "3-1", "1,,3"])
    assert.throws(() => parsePageRange(bad, 6));
  assert.throws(() =>
    validateProject({
      format: "translationhub-pdf",
      version: 1,
      pdf: "invalid file",
      translations: {},
    }),
  );
});
