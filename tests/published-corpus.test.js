import test from "node:test";
import assert from "node:assert/strict";
import corpus from "../qa/published-corpus.cjs";
const { publishedCases, captureResult } = corpus;

const row = { id: "case-a", cohort: "development", sourceLanguage: "en", targetLanguage: "ja", source: "Keep this line.\r\n\r\nAnd this one.", translations: [{ output: "old result", scores: { total: 12 } }] };

test("published corpus keeps every input and cohort, never copies prior translations or scores", () => {
  const rows = Array.from({ length: 18 }, (_, i) => ({ ...row, id: `case-${i}`, cohort: i < 12 ? "development" : "confirmatory", ...(i % 2 ? { sourceLanguage: "ja", targetLanguage: "en", source: "これは新しい入力。" } : {}) }));
  const actual = publishedCases({ cases: rows });
  assert.equal(actual.length, 18);
  assert.equal(actual.filter((x) => x.cohort === "confirmatory").length, 6);
  assert.equal(actual[0].text, row.source);
  assert.equal(actual[1].to, "en");
  assert(!JSON.stringify(actual).includes("old result"));
  assert(!JSON.stringify(actual).includes("scores"));
});

test("malformed or duplicated published input fails before a browser/model starts", () => {
  for (const cases of [[], [row, row], [{ ...row, source: " " }], [{ ...row, targetLanguage: "en" }], [{ ...row, cohort: "unknown" }]])
    assert.throws(() => publishedCases({ cases }));
  assert.throws(() => publishedCases({ fixtureCount: 18, cases: [row] }));
});

test("successful capture does not claim semantic quality, even with fluent unrelated output", () => {
  const fixture = publishedCases({ cases: [row] })[0];
  const observed = { input: row.source, reading: true, original: row.source, translation: "無関係な文。", sources: [row.source], targets: ["無関係な文。"] };
  const result = captureResult(fixture, observed, undefined, 12);
  assert.equal(result.capture.status, "complete");
  assert.deepEqual(result.quality, { status: "not_evaluated" });
  assert.equal(result.source, row.source);
});

test("partial and failed captures retain available outputs and report empty rendered segments", () => {
  const fixture = publishedCases({ cases: [row] })[0];
  const observed = { input: row.source, reading: true, original: row.source, translation: "最初の訳。", sources: ["First.", "Second."], targets: ["最初の訳。", ""] };
  const partial = captureResult(fixture, observed, undefined, 20);
  assert.equal(partial.capture.status, "incomplete");
  assert.deepEqual(partial.capture.missingSegmentIndices, [1]);
  assert.equal(partial.translation, "最初の訳。");
  assert.deepEqual(captureResult(fixture, { ...observed, targets: ["最初の訳。"] }, undefined, 20).capture.missingSegmentIndices, [1]);
  const failed = captureResult(fixture, observed, new Error("Model unavailable"), 21);
  assert.equal(failed.capture.status, "failed");
  assert.equal(failed.capture.error, "Model unavailable");
  assert.equal(captureResult(fixture, { ...observed, input: "changed" }, undefined, 1).capture.sourcePreserved, false);
});
