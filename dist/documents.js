import { explicitLiteralRanges } from "./text-literals.js";
import { normalizeEngineIdentity } from "./engine-identity.js";

export const languages = {
  en: "英語",
  ja: "日本語",
  zh: "中国語",
  ko: "韓国語",
  fr: "フランス語",
  de: "ドイツ語",
  es: "スペイン語",
  it: "イタリア語",
  pt: "ポルトガル語",
  ru: "ロシア語",
  ar: "アラビア語",
  hi: "ヒンディー語",
};
export function translatedGap(s, i, lang) {
  if (typeof s.targetGap === "string") return s.targetGap;
  if (i && s.softGap === true) return ["ja", "zh"].includes(lang) ? "" : " ";
  if (!i || /[\r\n\u0085\u2028\u2029\f]/.test(s.gap)) return s.gap;
  return ["ja", "zh"].includes(lang) ? "" : s.gap || " ";
}
// Segment boundaries refer to the untouched source. Only modelText normalizes
// OCR line wraps; links and saved documents always use the original offsets.
const unitKinds = new Set([
  "paragraph",
  "heading",
  "list",
  "table",
  "quote",
  "code",
  "attribution",
  "separator",
]);
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const cjkPunctuation = /[、。！？：；「」『』（）【】《》〈〉]/u;
const horizontal = /[^\S\r\n]/u;
const nameWord =
  /^(?:[\p{Lu}][\p{L}’'.-]*|[\p{Lu}]\.|von|van|de|del|der|la|le|da|di|du|dos|bin|al)$/u;

function sourceLines(text) {
  const result = [];
  let offset = 0;
  for (const m of text.matchAll(
    /[^\r\n\u0085\u2028\u2029\f]*(?:\r\n|[\r\n\u0085\u2028\u2029\f]|$)/g,
  )) {
    if (!m[0]) continue;
    const body = m[0].replace(/(?:\r\n|[\r\n\u0085\u2028\u2029\f])$/, "");
    result.push({
      start: offset,
      end: offset + body.length,
      body,
      break: m[0].slice(body.length),
    });
    offset += m[0].length;
  }
  return result;
}

function authorLine(line) {
  const m = line
    .trim()
    .match(/^(?:[-–—]\s+|(?:By|Author|Source|Written by)\s*:?\s+)(.+)$/u);
  if (!m) return false;
  const words = m[1].replace(/[,.]$/, "").split(/\s+/);
  return (
    words.length >= 2 &&
    words.length <= 8 &&
    words.every((w) => nameWord.test(w))
  );
}

function lineKind(line) {
  const s = line.trim();
  if (/^#{1,6}\s+/.test(s)) return "heading";
  if (/^(?:[-*_]\s*){3,}$/.test(s)) return "separator";
  if (
    s.length <= 80 &&
    !/[.!?。！？]$/.test(s) &&
    (/^\d+(?:\.\d+)+(?:[.)])?\s+(?:[\p{Lu}][\p{L}]{1,}|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/u.test(
      s,
    ) ||
      /^第[0-9０-９一二三四五六七八九十百]+[章節部項](?:[ \t　:：]|$)/u.test(
        s,
      ) ||
      /^【[^【】\r\n]{1,40}】$/.test(s))
  )
    return "heading";
  if (
    /^(?:[-*+•‣▪]\s+|(?:\d+[.)]|[a-z][.)]|[A-Z]\))\s+|[（(]\d+[）)]\s+)/u.test(
      s,
    )
  )
    return "list";
  if (/^>/.test(s)) return "quote";
  if (
    /^(?: {4,}|\t)/.test(line) &&
    /^(?:const |let |var |function |class |def |import |from |return |if\s*\(|[{}])/.test(
      s,
    )
  )
    return "code";
  if (/^\|.*\|$/.test(s) && s.split("|").filter((c) => c.trim()).length >= 2)
    return "table";
  if (/^\|?\s*:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)+\s*\|?$/.test(s)) return "table";
  return "paragraph";
}

function looksLikeHeading(line, next) {
  const s = line.trim();
  if (!next?.trim() || s.length > 80 || /[.,!?。！？:：;；,，)）\]"”]$/.test(s))
    return false;
  if (/^[\p{Lu}\d][\p{Lu}\d\s&/—–-]+$/u.test(s)) return true;
  const words = s.split(/\s+/);
  return (
    words.length <= 7 &&
    /^[\p{Lu}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
      next.trim(),
    ) &&
    words.every(
      (w, i) =>
        /^(?:[\p{Lu}][\p{L}’'-]*|[IVX]+)$/u.test(w) ||
        (i > 0 && /^(?:and|or|of|the|in|for|to|a|an)$/.test(w)),
    ) &&
    !/\b(?:and|or|of|the|in|for|to|a|an)$/i.test(s)
  );
}

function spaceTablePair(a, b) {
  if (!a?.trim() || !b?.trim()) return false;
  const cells = (line) => {
    const start = line.search(/\S/);
    return [
      ...line.trim().matchAll(/(?:^| {2,})(\S(?:.*?\S)?)(?= {2,}|$)/g),
    ].map((m) => ({
      text: m[1],
      column: start + m.index + m[0].indexOf(m[1]),
    }));
  };
  const left = cells(a),
    right = cells(b);
  if (
    left.length < 2 ||
    left.length !== right.length ||
    !left.every((c, i) => Math.abs(c.column - right[i].column) <= 2)
  )
    return false;
  const numeric = (c) =>
    /^(?:[$€¥£]\s*)?[+−-]?(?:\d[\d,.]*|\(\d[\d,.]*\))(?:\s*(?:%|million|billion|USD|JPY|EUR|円|ドル))?$/i.test(
      c.text,
    );
  return left.slice(1).some(numeric) || right.slice(1).some(numeric);
}

function delimitedTablePair(a, b) {
  if (!a?.trim() || !b?.trim()) return false;
  const tabs = (line) => line.trim().split(/\t+/);
  if (a.includes("\t") && b.includes("\t")) {
    const left = tabs(a),
      right = tabs(b);
    if (left.length >= 2 && left.length === right.length) return true;
  }
  const pipes = (line) => line.trim().split(/\s+\|\s+/);
  const left = pipes(a),
    right = pipes(b);
  return left.length >= 2 && left.length === right.length;
}

function alphabeticalListPair(a, b) {
  const left = a?.trim().match(/^([A-Za-z])\.\s+\S/),
    right = b?.trim().match(/^([A-Za-z])\.\s+\S/);
  return (
    !!left && !!right && right[1].charCodeAt(0) - left[1].charCodeAt(0) === 1
  );
}

function containingLiteral(ranges, offset) {
  let low = 0,
    high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1,
      range = ranges[middle];
    if (offset < range[0]) high = middle - 1;
    else if (offset >= range[1]) low = middle + 1;
    else return range;
  }
  return null;
}

function rawUnits(text) {
  const lines = sourceLines(text),
    units = [];
  const previousContent = [],
    literals = explicitLiteralRanges(text);
  let lastContent = -1,
    previousText = "";
  lines.forEach((line, i) => {
    previousContent.push(previousText);
    if (line.body.trim()) {
      lastContent = i;
      previousText = line.body.trim();
    }
  });
  let current = null,
    fence = null;
  const flush = () => {
    if (current) units.push(current);
    current = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i],
      trimmed = line.body.trim();
    if (fence) {
      current.end = line.end;
      if (trimmed.startsWith(fence)) {
        fence = null;
        flush();
      }
      continue;
    }
    const continuedLiteral = containingLiteral(literals, line.start);
    if (current && continuedLiteral && continuedLiteral[0] < line.start) {
      current.end = line.end;
      continue;
    }
    const opening = trimmed.match(/^(`{3,}|~{3,})/);
    if (opening) {
      flush();
      fence = opening[1];
      current = { start: line.start, end: line.end, kind: "code" };
      continue;
    }
    if (!trimmed) {
      flush();
      continue;
    }
    if (i && /[\u2029\f]/.test(lines[i - 1].break)) flush();
    let kind = lineKind(line.body);
    if (
      kind === "paragraph" &&
      (alphabeticalListPair(lines[i - 1]?.body, line.body) ||
        alphabeticalListPair(line.body, lines[i + 1]?.body))
    )
      kind = "list";
    const previousNonempty = previousContent[i];
    const isolatedTail = !lines[i - 1]?.body.trim() && i === lastContent;
    const followsQuotation =
      /["”»’]$/.test(previousNonempty) ||
      /^(?:Sincerely|Best(?: regards)?|Regards|敬具)[,，]?$/i.test(
        previousNonempty,
      );
    if (
      authorLine(line.body) &&
      (/^(?:By|Author|Source|Written by)\s/.test(trimmed) ||
        (isolatedTail && followsQuotation))
    )
      kind = "attribution";
    if (
      kind === "paragraph" &&
      (spaceTablePair(line.body, lines[i - 1]?.body) ||
        spaceTablePair(line.body, lines[i + 1]?.body) ||
        delimitedTablePair(line.body, lines[i - 1]?.body) ||
        delimitedTablePair(line.body, lines[i + 1]?.body))
    )
      kind = "table";
    if (
      kind === "paragraph" &&
      !current &&
      looksLikeHeading(line.body, lines[i + 1]?.body)
    )
      kind = "heading";
    const sameStructure =
      current &&
      kind === current.kind &&
      ["paragraph", "quote", "code"].includes(kind);
    const listContinuation =
      current?.kind === "list" &&
      kind === "paragraph" &&
      (/^\s+/.test(line.body) ||
        !/[.!?。！？]["”’')）]*$/.test(lines[i - 1].body.trim()));
    if (sameStructure || listContinuation) current.end = line.end;
    else {
      flush();
      current = { start: line.start, end: line.end, kind };
    }
  }
  flush();
  return units.map((u) => {
    if (u.kind === "table") return u;
    const value = text.slice(u.start, u.end);
    const leading = value.length - value.trimStart().length;
    return {
      ...u,
      start: u.start + leading,
      end: u.end - (value.length - value.trimEnd().length),
    };
  });
}

// Every normalized UTF-16 code unit carries its original range, so sentence
// splitting after cleanup can be mapped back without changing saved offsets.
function normalizedSource(source, language, kind = "paragraph", options = {}) {
  const starts = [],
    ends = [],
    chunks = [];
  const append = (value, start, end) => {
    chunks.push(value);
    for (let i = 0; i < value.length; i++) {
      starts.push(start + (end - start === value.length ? i : 0));
      ends.push(
        end - (end - start === value.length ? value.length - i - 1 : 0),
      );
    }
  };
  if (kind === "table") {
    append(source, 0, source.length);
    return { text: chunks.join(""), starts, ends };
  }
  if (["code", "heading", "separator"].includes(kind)) {
    const begin = source.length - source.trimStart().length,
      end = source.trimEnd().length;
    append(source.slice(begin, end), begin, end);
    return { text: chunks.join(""), starts, ends };
  }
  const literals = explicitLiteralRanges(source);
  let quotedStart = true;
  const lines = sourceLines(source)
    .map((line) => {
      if (kind !== "quote") return line;
      const marker = line.body.match(/^\s*>+\s?/);
      if (!marker) {
        quotedStart = !line.body.trim();
        return line;
      }
      const content = line.body.slice(marker[0].length);
      if (!content.trim()) {
        quotedStart = true;
        return { ...line, body: "" };
      }
      if (quotedStart) {
        quotedStart = false;
        return line;
      }
      return { ...line, start: line.start + marker[0].length, body: content };
    })
    .filter((l) => l.body.trim());
  let previous = null;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const lead = line.body.length - line.body.trimStart().length;
    let body = line.body.trim(),
      end = line.end - (line.body.length - line.body.trimEnd().length);
    const following = lines[lineIndex + 1]?.body.trim();
    // A single backslash is removed only at an unmistakable prose wrap. Paths,
    // TeX commands, code and explicit doubled backslashes remain literal.
    const unwrap =
      options.unwrapBackslashes !== false &&
      !containingLiteral(literals, end - 1) &&
      following &&
      /[^\\]\\$/.test(body) &&
      !body.slice(0, -1).includes("\\") &&
      !/[:={}<>]|https?:\/\//.test(body) &&
      (body.match(/\s+/g) || []).length >= 2 &&
      /^[\p{Ll}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
        following,
      );
    if (unwrap) {
      body = body.slice(0, -1).trimEnd();
      end = line.start + lead + body.length;
    }
    const discretionaryHyphen = /\u00ad$/.test(body);
    if (previous) {
      const left = previous.body.at(-1) || "",
        right = body[0] || "";
      const joinedHyphen =
        previous.discretionaryHyphen ||
        (/[\p{L}][\-‐‑]$/u.test(previous.body) && /\p{L}/u.test(right));
      const joinedCJK =
        ((cjk.test(left) || cjkPunctuation.test(left)) &&
          (cjk.test(right) || cjkPunctuation.test(right))) ||
        (["ja", "zh"].includes(language?.split("-")[0]) &&
          (cjk.test(left) || cjk.test(right)));
      if (containingLiteral(literals, previous.end)) {
        append(
          source.slice(previous.end, line.start + lead),
          previous.end,
          line.start + lead,
        );
      } else if (
        (
          source
            .slice(previous.end, line.start + lead)
            .match(/\r\n|[\r\n\u0085\u2028\u2029\f]/g) || []
        ).length > 1 ||
        /[\u2029\f]/.test(source.slice(previous.end, line.start + lead))
      )
        append("\n\n", previous.end, line.start + lead);
      else if (!joinedHyphen && !joinedCJK)
        append(" ", previous.end, line.start + lead);
    }
    for (let i = 0; i < body.length;) {
      const pos = line.start + lead + i;
      if (containingLiteral(literals, pos)) {
        append(body[i], pos, pos + 1);
        i++;
        continue;
      }
      if (body[i] === "\u00ad") {
        i++;
        continue;
      }
      if (horizontal.test(body[i])) {
        let j = i + 1;
        while (j < body.length && horizontal.test(body[j])) j++;
        const before = body[i - 1] || "",
          after = body[j] || "";
        if (
          !(
            cjk.test(before) &&
            (cjk.test(after) || cjkPunctuation.test(after))
          ) &&
          !(cjkPunctuation.test(before) && cjk.test(after))
        )
          append(" ", pos, line.start + lead + j);
        i = j;
      } else {
        append(body[i], pos, pos + 1);
        i++;
      }
    }
    previous = { body, end, discretionaryHyphen };
  }
  return { text: chunks.join(""), starts, ends };
}

export function modelText(segment, language, options = {}) {
  const source = typeof segment === "string" ? segment : segment.source;
  const kind =
    typeof segment === "object" && unitKinds.has(segment.kind)
      ? segment.kind
      : lineKind(source.split(/\r\n|[\r\n\u0085\u2028\u2029\f]/)[0]);
  return normalizedSource(source, language, kind, options).text;
}

// Shared with the inference worker: do not split repaired sentence units again
// at a title, a numbered reference, or an enumeration marker.
export function sentenceRanges(text, language) {
  let spans;
  if (typeof Intl.Segmenter === "function") {
    let segmenter;
    try {
      segmenter = new Intl.Segmenter(language, { granularity: "sentence" });
    } catch {
      segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
    }
    spans = Array.from(segmenter.segment(text), (s) => [
      s.index,
      s.index + s.segment.length,
    ]);
  } else {
    spans = [];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      if (!/[。！？.!?؟]/.test(text[i])) continue;
      if (text[i] === "." && /[\p{L}\p{N}]/u.test(text[i + 1] || "")) continue;
      let end = i + 1;
      while (end < text.length && /[。！？.!?؟"”’')）\]]/.test(text[end]))
        end++;
      spans.push([start, end]);
      start = end;
      i = end - 1;
    }
    if (start < text.length) spans.push([start, text.length]);
  }
  const trimmed = spans
    .map(([start, end]) => {
      while (start < end && /\s/.test(text[start])) start++;
      while (end > start && /\s/.test(text[end - 1])) end--;
      return [start, end];
    })
    .filter(([start, end]) => end > start);
  const locale = language?.split("-")[0] || "en";
  const titles = {
    en: /\b(?:Dr|Prof|Mr|Mrs|Ms|Rev)\.$/,
    de: /\b(?:Dr|Prof|Hr|Fr)\.$/,
    fr: /\b(?:M|Mme|Mlle|Dr|Pr)\.$/,
    es: /\b(?:Sr|Sra|Srta|Dr|Dra|Prof)\.$/,
    it: /\b(?:Dott|Dottssa|Prof)\.$/,
    pt: /\b(?:Sr|Sra|Dr|Dra|Prof)\.$/,
  };
  const merged = [],
    literals = explicitLiteralRanges(text);
  for (const range of trimmed) {
    const previous = merged.at(-1);
    if (!previous) {
      merged.push([...range]);
      continue;
    }
    const before = text.slice(previous[0], previous[1]),
      after = text.slice(range[0], range[1]);
    const gap = text.slice(previous[1], range[0]);
    const hardBreak =
      /[\u2029\f]/.test(gap) ||
      (gap.match(/\r\n|[\r\n\u0085\u2028]/g) || []).length > 1;
    const title =
      titles[locale]?.test(before) &&
      /^(?:\p{Lu}|(?:van|von|de|del)\s+\p{Lu})/u.test(after);
    const reference =
      /\b(?:Fig|Figs|Eq|Eqs|Sec|Secs|No|Nos|Ch|Vol|pp?)\.$/i.test(before) &&
      /^(?:[(（]?\d|[IVX]+\b)/.test(after);
    const initial =
      /^(?:(?:Dr|Prof|Mr|Mrs|Ms)\.\s+)?(?:\p{Lu}\.\s*){1,3}$/u.test(before) &&
      /^\p{Lu}\p{Ll}/u.test(after);
    const enumeration = /^(?:\d+|[a-z])\.$/.test(before);
    const explanatory = /\b(?:e\.g|i\.e|vs)\.$/i.test(before);
    if (
      containingLiteral(literals, previous[1]) ||
      (!hardBreak &&
        (title || reference || initial || enumeration || explanatory))
    )
      previous[1] = range[1];
    else merged.push([...range]);
  }
  return merged;
}

function boundedRanges(text, ranges, maxChars, pack) {
  if (!Number.isFinite(maxChars)) return ranges;
  const chunks = [],
    literals = explicitLiteralRanges(text);
  const graphemes =
    typeof Intl.Segmenter === "function"
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : null;
  for (let [start, end] of ranges) {
    while (end - start > maxChars) {
      let cut = start + maxChars;
      // Keep surrogate pairs intact, including when a budget ends on an emoji.
      if (/[\uDC00-\uDFFF]/.test(text[cut])) cut--;
      const window = text.slice(start, cut),
        candidates = [...window.matchAll(/\s+|[、，；;:：]/g)];
      const boundary = candidates.at(-1);
      if (boundary && boundary.index >= maxChars / 3)
        cut =
          start +
          boundary.index +
          (boundary[0].trim() ? boundary[0].length : 0);
      if (graphemes) {
        let safe = start;
        for (const part of graphemes.segment(
          text.slice(start, Math.min(end, cut + 16)),
        )) {
          if (start + part.index > cut) break;
          safe = start + part.index;
        }
        if (safe > start) cut = safe;
      }
      const literal = containingLiteral(literals, cut);
      if (literal && cut > literal[0]) {
        // An indivisible literal may exceed the budget. The model adapter will
        // replace it with a short placeholder; cutting it would change meaning.
        cut = literal[0] > start ? literal[0] : literal[1];
      }
      chunks.push([start, cut]);
      start = cut;
      while (start < end && /\s/.test(text[start])) start++;
    }
    if (end > start) chunks.push([start, end]);
  }
  if (!pack) return chunks;
  const packed = [];
  for (const chunk of chunks) {
    const previous = packed.at(-1);
    if (previous && chunk[1] - previous[0] <= maxChars) previous[1] = chunk[1];
    else packed.push([...chunk]);
  }
  return packed;
}

export function segmentText(text, language, options = {}) {
  if (typeof text !== "string")
    throw TypeError("原文は文字列で指定してください。");
  const granularity = options.granularity || "paragraph",
    maxChars = options.maxChars ?? Infinity;
  if (!["sentence", "paragraph"].includes(granularity))
    throw TypeError("分割単位を確認してください。");
  if (
    maxChars !== Infinity &&
    (!Number.isSafeInteger(maxChars) || maxChars < 2)
  )
    throw TypeError("文字数の上限は2以上の整数にしてください。");
  const parts = [];
  let cursor = 0;
  for (const unit of rawUnits(text)) {
    const raw = text.slice(unit.start, unit.end),
      normalized = normalizedSource(raw, language, unit.kind, options);
    const prose = ["paragraph", "list", "quote"].includes(unit.kind);
    let ranges =
      prose && (granularity === "sentence" || normalized.text.length > maxChars)
        ? sentenceRanges(normalized.text, language)
        : [[0, normalized.text.length]];
    if (!["table", "code"].includes(unit.kind))
      ranges = boundedRanges(
        normalized.text,
        ranges,
        maxChars,
        granularity === "paragraph",
      );
    for (let i = 0; i < ranges.length; i++) {
      const [a, b] = ranges[i];
      if (b <= a) continue;
      const start = unit.start + normalized.starts[a],
        end = unit.start + normalized.ends[b - 1];
      parts.push({
        gap: text.slice(cursor, start),
        source: text.slice(start, end),
        target: "",
        links: [],
        kind: unit.kind,
        ...(i > 0 &&
        prose &&
        !normalized.text.slice(ranges[i - 1][1], a).includes("\n\n")
          ? { softGap: true }
          : {}),
      });
      cursor = end;
    }
  }
  // Keeping the final whitespace in source makes source + gap exactly reversible.
  // Old v1 files which stored it only in doc.text remain valid as before.
  if (parts.length) parts.at(-1).source += text.slice(cursor);
  return parts;
}
const positiveInt = (n) => Number.isSafeInteger(n) && n >= 0;
export function validateDocument(doc) {
  if (
    !doc ||
    doc.format !== "translationhub.text" ||
    doc.version !== 1 ||
    !Object.hasOwn(languages, doc.from) ||
    !Object.hasOwn(languages, doc.to) ||
    !Array.isArray(doc.segments) ||
    doc.segments.length > 20000 ||
    typeof doc.text !== "string" ||
    doc.text.length > 4e6
  )
    throw Error("translationhub形式の対訳ファイルを選んでください。");
  const segments = doc.segments.map((s) => {
    if (
      !s ||
      typeof s.source !== "string" ||
      typeof s.target !== "string" ||
      typeof s.gap !== "string" ||
      s.target.length > 4e6
    )
      throw Error("対訳データが壊れています。");
    const links = Array.isArray(s.links)
      ? s.links.filter(
          (l) =>
            Array.isArray(l) &&
            l.length === 4 &&
            l.every(positiveInt) &&
            l[0] < l[1] &&
            l[1] <= s.source.length &&
            l[2] < l[3] &&
            l[3] <= s.target.length,
        )
      : [];
    return {
      source: s.source,
      target: s.target,
      gap: s.gap,
      links,
      edited: s.edited === true,
      ...(unitKinds.has(s.kind) ? { kind: s.kind } : {}),
      ...(s.softGap === true ? { softGap: true } : {}),
      ...(typeof s.targetGap === "string" && /^\s*$/.test(s.targetGap)
        ? { targetGap: s.targetGap }
        : {}),
    };
  });
  if (
    segments.length &&
    segments
      .map((s) => s.gap + s.source)
      .join("")
      .trimEnd() !== doc.text.trimEnd()
  )
    throw Error("原文と対訳の対応を確認できません。");
  return {
    format: doc.format,
    version: 1,
    from: doc.from,
    to: doc.to,
    text: doc.text,
    segments,
    engine: typeof doc.engine === "string" ? doc.engine : "",
    ...(normalizeEngineIdentity(doc.engineIdentity)
      ? { engineIdentity: normalizeEngineIdentity(doc.engineIdentity) }
      : {}),
    title: String(
      doc.title || doc.text.trim().split(/\r?\n/)[0] || "無題",
    ).slice(0, 96),
  };
}
let dbPromise;
function database() {
  if (!dbPromise)
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open("translationhub-text", 1);
      req.onupgradeneeded = () =>
        req.result.createObjectStore("docs", { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((e) => {
      dbPromise = null;
      throw e;
    });
  return dbPromise;
}
export async function shelf(action = "getAll", value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
        "docs",
        action === "getAll" ? "readonly" : "readwrite",
      ),
      store = tx.objectStore("docs");
    const req = action === "getAll" ? store.getAll() : store[action](value);
    tx.oncomplete = () => resolve(req.result);
    tx.onabort = tx.onerror = () =>
      reject(tx.error || Error("端末内の保存領域にアクセスできません。"));
  });
}
export function exportDoc(doc) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download =
    (doc.title || "対訳").replace(/[\\/:*?"<>|]/g, "_") +
    ".translationhub.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}
