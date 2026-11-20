import { financialLiterals } from "./financial-literals.js";

// Explicit inline code and math carry meaning in their spelling and spacing.
// Only paired delimiters count. A pair of currency amounts is ordinary prose.
const explicitPattern =
  /(?<![\\`])(`+)(?!`)[^\r\n]*?(?<!`)\1(?!`)|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|(?<![\\$])\$\$[\s\S]*?\$\$(?!\$)|(?<![\\$])\$(?![\s$])(?:\\.|[^$\r\n\\])+?(?<!\s)\$(?![\d$])|(?<![\w\\|])(\|{1,2})[A-Za-z](?:_[A-Za-z0-9]+)?\2(?![\w|])/gu;

export function explicitLiteralRanges(text) {
  const ranges = [];
  for (const m of text.matchAll(explicitPattern)) {
    const value = m[0];
    if (
      value.startsWith("$") &&
      !value.startsWith("$$") &&
      !/[\\^_{}=<>+*/]/.test(value.slice(1, -1)) &&
      !/^\$[A-Za-z]\$$/.test(value)
    )
      continue;
    ranges.push([m.index, m.index + value.length]);
  }
  return ranges;
}

// Match a number and a case-sensitive unit. Avoid standalone numbers: a
// translator can legitimately write "$39 million" as "3,900万ドル".
const measurement =
  /(?<![\dA-Za-z.,+−±-])([+−±-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?)[ \t\u00a0]*(GHz|MHz|kHz|Hz|μs|µs|ms|ns|mA|μA|µA|mV|kV|V|KiB|MiB|GiB|KB|MB|GB|°C|℃|ミリ秒|ミリアンペア|ミリボルト|メガヘルツ|キロヘルツ|ヘルツ)(?![A-Za-z])/gu;
const equivalents = new Map(
  Object.entries({
    μs: "µs",
    μA: "µA",
    "℃": "°C",
    ミリ秒: "ms",
    ミリアンペア: "mA",
    ミリボルト: "mV",
    メガヘルツ: "MHz",
    キロヘルツ: "kHz",
    ヘルツ: "Hz",
  }),
);
function literals(text, includeMeasures, financialTarget) {
  const explicit = explicitLiteralRanges(text);
  const spans = explicit.map(([start, end]) => ({
    start,
    end,
    key: text.slice(start, end),
  }));
  if (includeMeasures) {
    let i = 0;
    for (const m of text.matchAll(measurement)) {
      while (i < explicit.length && explicit[i][1] <= m.index) i++;
      if (i < explicit.length && explicit[i][0] < m.index + m[0].length)
        continue;
      const number = m[1].replaceAll(",", "").replace("−", "-");
      spans.push({
        start: m.index,
        end: m.index + m[0].length,
        key: number + " " + (equivalents.get(m[2]) || m[2]),
        ...(financialTarget === "en" && /\p{Script=Katakana}/u.test(m[2])
          ? { replacement: m[1] + " " + equivalents.get(m[2]) }
          : {}),
      });
    }
  }
  if (financialTarget) {
    // An amount quoted inside a code example is already covered by the
    // surrounding literal. Its spelling and its delimiters must travel together.
    const occupied = [...spans].sort((a, b) => a.start - b.start);
    let i = 0;
    for (const entry of financialLiterals(text, financialTarget)) {
      while (i < occupied.length && occupied[i].end <= entry.start) i++;
      if (i < occupied.length && occupied[i].start < entry.end) continue;
      spans.push(entry);
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

const markers = /[\[［]\s*[XxＸｘ]\s*([0-9０-９]+)\s*[\]］]/gu;
const markerNumber = (digits) => digits.normalize("NFKC");

export function protectLiterals(text, includeMeasures, financialTarget) {
  const spans = literals(text, includeMeasures, financialTarget);
  if (!spans.length) return null;
  const reserved = new Set(
    Array.from(text.matchAll(markers), (m) => markerNumber(m[1])),
  );
  const values = new Map();
  const expected = spans.map((s) => s.key).sort();
  let id = 101,
    cursor = 0,
    masked = "";
  for (const { start, end, replacement } of spans) {
    while (reserved.has(String(id))) id++;
    masked += text.slice(cursor, start) + "[X" + id + "]";
    values.set(String(id++), replacement ?? text.slice(start, end));
    cursor = end;
  }
  masked += text.slice(cursor);
  const needsProse = /\p{L}/u.test(masked.replace(markers, ""));
  return {
    masked,
    intact(result, { standalone = false } = {}) {
      // A bare quantity may acquire an article, but not an invented assertion.
      // For this validation only, an initial a/an/one denotes exactly one.
      if (standalone)
        result = result
          .trim()
          .replace(/^the\s+/i, "")
          .replace(/^(?:an?|one)\s+/i, "1 ");
      const found = literals(result, includeMeasures, financialTarget);
      const got = found.map((s) => s.key).sort();
      // Counts matter when a value is repeated or the translation has dropped
      // one measurement and introduced another at a different location.
      if (
        got.length !== expected.length ||
        !got.every((s, i) => s === expected[i])
      )
        return false;
      if (standalone) {
        let cursor = 0,
          outside = "";
        for (const s of found) {
          outside += result.slice(cursor, s.start);
          cursor = s.end;
        }
        outside += result.slice(cursor);
        return /^[\s.。]*$/u.test(outside);
      }
      if (!needsProse) return true;
      let end = 0;
      for (const s of found) {
        if (/\p{L}/u.test(result.slice(end, s.start))) return true;
        end = s.end;
      }
      return /\p{L}/u.test(result.slice(end));
    },
    restore(result) {
      const used = new Set();
      let damaged = false;
      const restored = result.replace(markers, (token, digits) => {
        const id = markerNumber(digits);
        if (reserved.has(id)) return token;
        if (!values.has(id) || used.has(id)) {
          damaged = true;
          return token;
        }
        used.add(id);
        return values.get(id);
      });
      if (needsProse && !/\p{L}/u.test(result.replace(markers, "")))
        damaged = true;
      if (damaged || used.size !== values.size) return null;
      return restored;
    },
  };
}
