import { modelText, segmentText, translatedGap } from "./documents.js";
import { explicitLiteralRanges, protectLiterals } from "./text-literals.js";

function usesSentences(engine) {
  return engine === "wasm" || engine === "browser";
}

export function prepareTextJob(text, source, engine, previous = []) {
  const planned = segmentText(text, source, {
    granularity: usesSentences(engine) ? "sentence" : "paragraph",
    maxChars: engine === "wasm" ? Infinity : 3000,
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

function numericAside(sentence) {
  const match = /,\s+not\s+([^,;!?\n]+?)\.?$/i.exec(sentence);
  if (!match) return null;
  const text = match[1].trim();
  if (explicitLiteralRanges(text).length) return null;
  const literal = protectLiterals(text, true, "ja");
  if (!literal || !/^\[X\d+\]$/.test(literal.masked)) return null;
  return {
    main: sentence.slice(0, match.index) + ".",
    excluded: literal.restore(literal.masked),
  };
}

async function recoverSentences(sentences, options, engine, translate) {
  let recovered = "";
  for (const [i, s] of sentences.entries()) {
    options.signal?.throwIfAborted();
    const fragment = await translateProse(
      modelText(s, options.source),
      options,
      engine,
      translate,
      false,
    );
    if (!fragment?.trim())
      throw Error("翻訳エンジンから空の応答が届きました。");
    recovered += translatedGap(s, i, options.target) + fragment.trim();
  }
  return recovered;
}

async function translateProse(
  text,
  options,
  engine,
  translate,
  allowSentenceRecovery = true,
) {
  const local = engine !== "google" && engine !== "gas";
  const includeMeasures =
    local && [options.source, options.target].sort().join(":") === "en:ja";
  const protectedText = protectLiterals(
    text,
    includeMeasures,
    includeMeasures ? options.target : undefined,
  );
  if (!protectedText) return translate(text, options);
  if (/^\[X\d+\]$/.test(protectedText.masked)) return text;
  // An explicit trailing correction ("..., not <quantity>.") negates the
  // quantity itself. Preserve its scope even when the model omits the aside.
  if (
    local &&
    options.source === "en" &&
    options.target === "ja" &&
    /,\s+not\s/i.test(text)
  ) {
    const sentences = segmentText(text, options.source, {
      granularity: "sentence",
    });
    if (sentences.length > 1 && sentences.some((s) => numericAside(s.source)))
      return recoverSentences(sentences, options, engine, translate);
    const aside = sentences.length === 1 && numericAside(text);
    if (aside) {
      const lead = await translateProse(
        aside.main,
        options,
        engine,
        translate,
        false,
      );
      if (!lead?.trim()) throw Error("翻訳エンジンから空の応答が届きました。");
      return (
        lead.trim().replace(/[。.]$/, "") +
        "（" +
        aside.excluded +
        "ではない）。"
      );
    }
  }
  const naturalFirst = local && text.length <= 3000;
  if (naturalFirst) {
    try {
      const result = await translate(text, options);
      if (protectedText.intact(result)) return result;
    } catch (error) {
      if (engine !== "wasm" || error.code !== "LOCAL_TRANSLATION_INCOMPLETE")
        throw error;
    }
    if (allowSentenceRecovery && !usesSentences(engine)) {
      const sentences = segmentText(text, options.source, {
        granularity: "sentence",
        maxChars: 3000,
      });
      if (sentences.length > 1)
        return recoverSentences(sentences, options, engine, translate);
    }
  }
  options.signal?.throwIfAborted();
  const result = await translate(protectedText.masked, options);
  const restored = protectedText.restore(result);
  if (restored !== null && protectedText.intact(restored)) return restored;
  throw Error(
    "翻訳中に式・コード・測定値の一部が変わり、原文との対応を確認できませんでした。この箇所の訳文は確定していません。",
  );
}

function tableDividers(row) {
  const ranges = explicitLiteralRanges(row);
  const tabs = [],
    pipes = [],
    spaces = [];
  let i = 0;
  for (const m of row.matchAll(/\\.|\||\t| {2,}/g)) {
    while (i < ranges.length && ranges[i][1] <= m.index) i++;
    if (m[0][0] === "\\" || (i < ranges.length && ranges[i][0] <= m.index))
      continue;
    if (m[0] === "\t") tabs.push(m);
    else if (m[0] === "|") pipes.push(m);
    else spaces.push(m);
  }
  if (tabs.length) return tabs;
  return pipes.length ? pipes : spaces;
}

async function translateCell(
  cell,
  options,
  engine,
  translate,
  percentageLabel,
) {
  const value = cell.trim();
  if (
    !/\p{L}/u.test(value) ||
    /^(?:0x[\da-f]+|0b[01]+|[+−-]?(?:\d[\d,]*(?:\.\d+)?|\.\d+)e[+−-]?\d+|n\/a|nan|[+−-]?inf(?:inity)?)$/iu.test(
      value,
    ) ||
    /^(?:(?:FY|Q|H)\s*\d+(?:\s*[-/]?\s*)?)+(?:\d{2,4})?$/i.test(value) ||
    /^(?:[$¥€£+−±(<>≤≥-]*\d[\d,.]*(?:[eE][+−-]?\d+)?\s*(?:ms|ns|μs|µs|mA|Hz|mV|V|°C|℃|%|bps|USD|EUR|JPY|GB|MB|kHz|mL\/min|mmol\/L)\)?)$/u.test(
      value,
    )
  )
    return cell;
  const start = cell.indexOf(value);
  const withPadding = (translated) =>
    cell.slice(0, start) + translated + cell.slice(start + value.length);
  if (percentageLabel) {
    // "Gross margin" can mean an amount or a rate. The adjacent percentage
    // cells supply that context; the header itself should not gain a suffix.
    const contextual = await translateProse(
      value + " (%)",
      options,
      engine,
      translate,
    );
    const suffix = /\s*[(（]\s*[%％]\s*[)）]\s*$/u;
    if (suffix.test(contextual)) {
      const label = contextual.replace(suffix, "").trim();
      if (label) return withPadding(label);
    }
    options.signal?.throwIfAborted();
  }
  let translated = "";
  const parts = segmentText(value, options.source, {
    granularity: usesSentences(engine) ? "sentence" : "paragraph",
    maxChars: engine === "wasm" ? Infinity : 3000,
  });
  for (const [i, part] of parts.entries()) {
    options.signal?.throwIfAborted();
    const result = await translateProse(
      modelText(part, options.source),
      options,
      engine,
      translate,
    );
    if (!result?.trim()) throw Error("表のセルに対する訳文が空でした。");
    translated += translatedGap(part, i, options.target) + result.trim();
  }
  return withPadding(translated);
}

async function translateTableRow(row, options, engine, translate) {
  let start = 0,
    result = "";
  const cells = [],
    dividers = tableDividers(row);
  for (const divider of dividers) {
    cells.push(row.slice(start, divider.index));
    start = divider.index + divider[0].length;
  }
  cells.push(row.slice(start));
  const first = cells.findIndex((c) => c.trim());
  const data = cells
    .slice(first + 1)
    .map((c) => c.trim())
    .filter(Boolean);
  const percentageLabel =
    engine !== "google" &&
    engine !== "gas" &&
    first >= 0 &&
    cells[first].length < 100 &&
    !/[%％]/.test(cells[first]) &&
    data.length >= 2 &&
    data.every((c) => /^[<(≤≥>+−-]*\d[\d.,]*\s*[%％]\)?$/.test(c));
  for (const [i, cell] of cells.entries()) {
    options.signal?.throwIfAborted();
    result += await translateCell(
      cell,
      options,
      engine,
      translate,
      percentageLabel && i === first,
    );
    if (i < dividers.length) result += dividers[i][0];
  }
  return result;
}

export async function translateTextUnit(segment, options, engine, translate) {
  if (
    segment.kind === "code" ||
    segment.kind === "separator" ||
    (usesSentences(engine) && segment.kind === "attribution")
  )
    return segment.source;
  if (segment.kind === "table")
    return translateTableRow(segment.source, options, engine, translate);
  return translateProse(
    modelText(segment, options.source),
    options,
    engine,
    translate,
  );
}
