// Read inputs only: published translations and scores are not new test results.
const fs = require("node:fs");

function publishedCases(data) {
  if (!data || !Array.isArray(data.cases) || !data.cases.length)
    throw Error("The published corpus must contain a nonempty cases array.");
  if (data.fixtureCount !== undefined && data.fixtureCount !== data.cases.length)
    throw Error("The published fixture count does not match its cases array.");
  const ids = new Set();
  return data.cases.map((row) => {
    if (!row || typeof row.id !== "string" || !row.id.trim() || ids.has(row.id))
      throw Error("Published case ids must be nonempty and unique.");
    ids.add(row.id);
    if (![["en", "ja"], ["ja", "en"]].some(([from, to]) =>
      row.sourceLanguage === from && row.targetLanguage === to))
      throw Error(`Unsupported language direction in published case ${row.id}.`);
    if (typeof row.source !== "string" || !row.source.trim())
      throw Error(`Missing source text in published case ${row.id}.`);
    if (row.cohort !== undefined && !["development", "confirmatory"].includes(row.cohort))
      throw Error(`Unknown cohort in published case ${row.id}.`);
    return {
      id: row.id,
      ...(row.cohort === undefined ? {} : { cohort: row.cohort }),
      from: row.sourceLanguage,
      to: row.targetLanguage,
      text: row.source,
    };
  });
}

function readPublishedCases(filename) {
  return publishedCases(JSON.parse(fs.readFileSync(filename, "utf8")));
}

function captureResult(fixture, observed, error, elapsedMilliseconds) {
  const sourcePreserved = observed.input === fixture.text &&
    (!observed.reading || observed.original === fixture.text);
  const missingSegmentIndices = observed.sources.flatMap((_, index) => observed.targets[index]?.trim() ? [] : [index]);
  const complete = !error && sourcePreserved && observed.sources.length > 0 &&
    observed.sources.length === observed.targets.length && !missingSegmentIndices.length;
  return {
    ...(fixture.cohort === undefined ? {} : { cohort: fixture.cohort }),
    sourceLanguage: fixture.from,
    targetLanguage: fixture.to,
    source: fixture.text,
    translation: observed.targets.length ? observed.translation : "",
    capture: {
      status: complete ? "complete" : error ? "failed" : "incomplete",
      sourcePreserved,
      renderedSourceSegments: observed.sources.length,
      renderedTranslationSegments: observed.targets.length,
      missingSegmentIndices,
      elapsedMilliseconds,
      ...(error ? { error: error.message || String(error) } : {}),
    },
    quality: { status: "not_evaluated" },
  };
}

module.exports = { publishedCases, readPublishedCases, captureResult };
