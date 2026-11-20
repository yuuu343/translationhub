import { modelText, segmentText } from "./documents.js";

function usesSentences(engine) {
  return engine === "wasm" || engine === "browser";
}

export function prepareTextJob(text, source, engine, previous = []) {
  const planned = segmentText(text, source, {
    granularity: usesSentences(engine) ? "sentence" : "paragraph",
    maxChars: 3000,
  });
  // Old v1 files can contain half-sentences. Reuse partial results only if
  // the corresponding source ranges still agree with the new request plan.
  const resume =
    planned.length === previous.length &&
    previous.some((s) => s.target) &&
    previous.some((s) => !s.target) &&
    planned.every(
      (s, i) => s.source === previous[i].source && s.gap === previous[i].gap,
    );
  if (resume) {
    for (let i = 0; i < planned.length; i++) {
      const restored = previous[i];
      Object.assign(planned[i], {
        target: restored.target,
        links: restored.links,
        edited: restored.edited,
        targetGap: restored.targetGap,
      });
    }
  }
  return { next: planned, resume };
}

export async function translateTextUnit(segment, options, engine, translate) {
  if (
    segment.kind === "code" ||
    segment.kind === "separator" ||
    (usesSentences(engine) && segment.kind === "attribution")
  )
    return segment.source;
  return translate(modelText(segment, options.source), options);
}
