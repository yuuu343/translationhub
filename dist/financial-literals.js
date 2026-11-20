// Narrow financial facts, not a locale guesser or a general number parser.
// Decimal-dot / comma-thousands notation is accepted; ambiguous decimal-comma,
// shared-unit ranges and unspecified currency countries are never inferred.
const number = String.raw`(?:\d{1,3}(?:,\d{3}){1,9}|\d{1,30})(?:\.\d{1,18})?`;
const horizontalSpace = String.raw`[ \t\u00a0\u3000]*`;
const japanese = String.raw`(?:${number}${horizontalSpace}(?:兆|億|千万|百万|十万|万|千|百)${horizontalSpace}){1,10}(?:${number})?`;
const amount = `(?:${japanese}|${number})`;
const scale = String.raw`(?:\s*(?<scale>trillion|billion|million|thousand)\b)?`;
const currencyCodes = "USD|JPY|EUR|GBP|CNY|CAD|AUD|NZD|HKD|SGD";
const prefix = String.raw`(?:USD\s*\$|(?:JPY|CNY)\s*[¥￥]|(?:CAD|AUD|NZD|HKD|SGD)\s*\$|US\$|CA\$|A\$|NZ\$|HK\$|S\$|${currencyCodes}|[$¥￥€£])`;
const suffix = String.raw`(?:シンガポールドル|ニュージーランドドル|カナダドル|香港ドル|米ドル|豪ドル|NZドル|USドル|ドル|円|ユーロ|英ポンド|人民元|U\.?S\.?\s+dollars?|Canadian\s+dollars?|Australian\s+dollars?|New\s+Zealand\s+dollars?|Hong\s+Kong\s+dollars?|Singapore\s+dollars?|dollars?|yen|euros?|pounds\s+sterling|Chinese\s+yuan|renminbi|${currencyCodes})`;
const sign = String.raw`(?<sign>(?:negative|positive)(?:\s+at)?\s+|(?:マイナス|プラス)\s*|[+−-]\s*)?`;
const comparison = String.raw`(?<comparison>(?:<=|>=|[<>≤≥＜＞])\s*)?`;
const begin = String.raw`(?<![A-Za-z\p{N}_.,〇零一二三四五六七八九十百千万億兆京])`;
const prefixMoney = new RegExp(
  `${begin}${comparison}${sign}(?<currency>${prefix})\\s*(?<afterSign>[+−-]\\s*)?(?<amount>${amount})${scale}`,
  "giu",
);
const tail = String.raw`(?:(?:の)?(?<tailSign>マイナス|プラス))?(?<tailComparison>以上|以下|未満)?`;
const suffixMoney = new RegExp(
  `${begin}${comparison}${sign}(?<currencyPrefix>[$¥￥€£])?(?<amount>${amount})${scale}\\s*(?<currency>${suffix})(?![A-Za-z])${tail}`,
  "giu",
);
const rates = new RegExp(
  `${begin}${comparison}${sign}(?<amount>${number})\\s*(?<unit>percentage\\s+points?|percent\\s+points?|パーセント${horizontalSpace}ポイント|%${horizontalSpace}ポイント|basis\\s+points?|ベーシス${horizontalSpace}ポイント|percent|per\\s+cent|パーセント|%)(?![A-Za-z])${tail}`,
  "giu",
);
const adjacentCurrencyBefore = new RegExp(`(?:${prefix})\\s*$`, "iu");
const adjacentCurrencyAfter = new RegExp(
  `^\\s*(?:${suffix})(?![A-Za-z])`,
  "iu",
);
const jpScale = {
  兆: 12,
  億: 8,
  千万: 7,
  百万: 6,
  十万: 5,
  万: 4,
  千: 3,
  百: 2,
};
const enScale = { trillion: 12, billion: 9, million: 6, thousand: 3 };

function decimal(value) {
  const [whole, fraction = ""] = value.replaceAll(",", "").split(".");
  return { coefficient: BigInt(whole + fraction), places: fraction.length };
}
function multiply(value, exponent) {
  return exponent >= value.places
    ? {
        coefficient: value.coefficient * 10n ** BigInt(exponent - value.places),
        places: 0,
      }
    : { coefficient: value.coefficient, places: value.places - exponent };
}
function add(a, b) {
  const places = Math.max(a.places, b.places);
  return {
    coefficient:
      a.coefficient * 10n ** BigInt(places - a.places) +
      b.coefficient * 10n ** BigInt(places - b.places),
    places,
  };
}
function numericValue(raw, englishScale) {
  raw = raw.replace(/[ \t\u00a0\u3000]/g, "");
  if (/[兆億万千百]/.test(raw)) {
    if (englishScale) return null;
    const parts = new RegExp(
      `(${number})(兆|億|千万|百万|十万|万|千|百)?`,
      "gu",
    );
    let value = { coefficient: 0n, places: 0 },
      cursor = 0,
      previous = Infinity;
    for (const m of raw.matchAll(parts)) {
      if (m.index !== cursor) return null;
      const power = jpScale[m[2]] ?? 0;
      if (power >= previous) return null;
      previous = power;
      value = add(value, multiply(decimal(m[1]), power));
      cursor += m[0].length;
    }
    return cursor === raw.length ? value : null;
  }
  // One separator with exactly three trailing digits is ambiguous without a
  // language-bearing magnitude (e.g. "million" or "億"). Do not choose a locale.
  if (!englishScale && /^[1-9]\d{0,2}[,.]\d{3}$/.test(raw)) return null;
  return multiply(decimal(raw), enScale[englishScale?.toLowerCase()] ?? 0);
}
function canonical(value) {
  let digits = value.coefficient.toString().padStart(value.places + 1, "0");
  if (value.places)
    digits = digits.slice(0, -value.places) + "." + digits.slice(-value.places);
  return digits.includes(".")
    ? digits.replace(/0+$/, "").replace(/\.$/, "")
    : digits;
}
function grouped(value) {
  const [whole, fraction] = value.split(".");
  let formatted = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  // Make our own expanded replacement unambiguous when parsed without a locale.
  if (!fraction && /^\d{1,3},\d{3}$/.test(formatted)) formatted = whole;
  if (fraction) formatted += "." + fraction;
  return /^[1-9]\d{0,2}\.\d{3}$/.test(formatted) ? formatted + "0" : formatted;
}
function currency(raw) {
  const c = raw.replaceAll("￥", "¥").replace(/\s+/g, " ").trim();
  const compact = c.replace(/\s/g, "").toUpperCase();
  const code = compact.match(
    /^(USD|JPY|EUR|GBP|CNY|CAD|AUD|NZD|HKD|SGD)(?:[$¥])?$/,
  )?.[1];
  if (code) return code;
  const map = {
    $: "dollar",
    ドル: "dollar",
    dollar: "dollar",
    dollars: "dollar",
    "¥": "yen-yuan-symbol",
    "£": "pound-symbol",
    "€": "EUR",
    US$: "USD",
    USドル: "USD",
    米ドル: "USD",
    "us dollar": "USD",
    "us dollars": "USD",
    "u.s. dollar": "USD",
    "u.s. dollars": "USD",
    円: "JPY",
    yen: "JPY",
    ユーロ: "EUR",
    euro: "EUR",
    euros: "EUR",
    英ポンド: "GBP",
    "pounds sterling": "GBP",
    CA$: "CAD",
    カナダドル: "CAD",
    "canadian dollar": "CAD",
    "canadian dollars": "CAD",
    A$: "AUD",
    豪ドル: "AUD",
    "australian dollar": "AUD",
    "australian dollars": "AUD",
    NZ$: "NZD",
    NZドル: "NZD",
    ニュージーランドドル: "NZD",
    "new zealand dollar": "NZD",
    "new zealand dollars": "NZD",
    HK$: "HKD",
    香港ドル: "HKD",
    "hong kong dollar": "HKD",
    "hong kong dollars": "HKD",
    S$: "SGD",
    シンガポールドル: "SGD",
    "singapore dollar": "SGD",
    "singapore dollars": "SGD",
    人民元: "CNY",
    "chinese yuan": "CNY",
    renminbi: "CNY",
  };
  return map[c] ?? map[c.toLowerCase()] ?? map[compact] ?? null;
}
function signed(raw) {
  if (!raw) return "";
  return /negative|マイナス|[−-]/i.test(raw) ? "-" : "+";
}
function comparator(raw) {
  if (raw === "以上") return ">=";
  if (raw === "以下") return "<=";
  if (raw === "未満") return "<";
  return (
    raw
      ?.trim()
      .replace("≤", "<=")
      .replace("≥", ">=")
      .replace("＜", "<")
      .replace("＞", ">") || ""
  );
}
function ambiguousEdge(text, m, currencyAtEnd) {
  const before = text.slice(0, m.index),
    after = text.slice(m.index + m[0].length);
  // Never accept a prefix of a malformed number, shorthand or a shared range.
  if (/^(?:\d|[.,]\d)/.test(after)) return true;
  if (/^['’]\d/.test(after) || /^\s+\d/.test(after)) return true;
  if (/^\s*(?:bn|mn|[kmb])\b/i.test(after)) return true;
  if (
    !currencyAtEnd &&
    !m.groups.scale &&
    !/[兆億万千百]/.test(m.groups.amount) &&
    /^\s*(?:[-–—〜～]|to\b|から)\s*[+−-]?\d/.test(after)
  )
    return true;
  if (
    currencyAtEnd &&
    !m.groups.currencyPrefix &&
    /\d\s*(?:[-–—〜～]|\bto|から)\s*$/.test(before)
  )
    return true;
  // Parentheses alone do not establish the accounting-negative convention.
  if (/\(\s*$/.test(before) && /^\s*\)/.test(after)) return true;
  return false;
}

/** Exact, explicit monetary amounts and percentage units, with source offsets.
 * targetLanguage only changes the unambiguous replacement wording for points.
 * A literal's surrounding "from/to", "not", etc. stay outside its span.
 */
export function financialLiterals(text, targetLanguage = "en") {
  if (typeof text !== "string")
    throw new TypeError("Financial source must be a string");
  const candidates = [];
  for (const [kind, pattern] of [
    ["money", prefixMoney],
    ["money", suffixMoney],
    ["rate", rates],
  ]) {
    for (const m of text.matchAll(pattern)) {
      if (ambiguousEdge(text, m, pattern !== prefixMoney)) continue;
      const g = m.groups;
      if (
        [g.sign, g.afterSign, g.tailSign].filter(Boolean).length > 1 ||
        (g.comparison && g.tailComparison)
      )
        continue;
      if (
        pattern === prefixMoney &&
        adjacentCurrencyAfter.test(text.slice(m.index + m[0].length))
      )
        continue;
      if (
        pattern !== prefixMoney &&
        g.currency &&
        adjacentCurrencyBefore.test(text.slice(0, m.index))
      )
        continue;
      if (
        pattern === prefixMoney &&
        new RegExp(`(?:${currencyCodes})\\s+$`, "iu").test(
          text.slice(0, m.index),
        )
      )
        continue;
      if (
        kind === "money" &&
        (new RegExp(`(?:${currencyCodes})\\s*[/／]\\s*$`, "iu").test(
          text.slice(0, m.index),
        ) ||
          /^\s*(?:[/／]|per\s)/i.test(text.slice(m.index + m[0].length)))
      )
        continue;
      const value = numericValue(g.amount, g.scale);
      if (!value) continue;
      const denomination =
        kind === "money"
          ? currency(g.currency)
          : /percentage|percent\s+point|パーセント\s*ポイント|%\s*ポイント/i.test(
                g.unit,
              )
            ? "percentage-point"
            : /basis|ベーシス/i.test(g.unit)
              ? "basis-point"
              : "percent";
      if (!denomination) continue;
      if (g.currencyPrefix) {
        const compatible = {
          $: ["dollar", "USD", "CAD", "AUD", "NZD", "HKD", "SGD"],
          "¥": ["JPY", "CNY"],
          "￥": ["JPY", "CNY"],
          "€": ["EUR"],
          "£": ["GBP"],
        };
        if (!compatible[g.currencyPrefix].includes(denomination)) continue;
      }
      candidates.push({
        start: m.index,
        end: m.index + m[0].length,
        kind,
        denomination,
        prefix: pattern === prefixMoney,
        scaled: Boolean(g.scale || /[兆億万千百]/.test(g.amount)),
        value: canonical(value),
        sign: signed(g.sign || g.afterSign || g.tailSign),
        signText: g.sign || "",
        comparison: comparator(g.comparison || g.tailComparison),
      });
    }
  }
  candidates.sort((a, b) => a.start - b.start || b.end - a.end);
  const selected = [];
  for (const entry of candidates)
    if (!selected.length || entry.start >= selected.at(-1).end)
      selected.push(entry);
  for (let i = 0; i < selected.length - 1; i++) {
    const a = selected[i],
      b = selected[i + 1],
      gap = text.slice(a.end, b.start);
    const range =
      /^\s*(?:[-–—〜～]|to|から)\s*$/i.test(gap) ||
      (/^[−-]\s*$/.test(b.signText) && /^\s*$/.test(gap));
    // "$1–$2 million" shares an unstated scale; neither endpoint is guessed.
    if (
      range &&
      a.kind === "money" &&
      b.kind === "money" &&
      a.prefix &&
      !a.scaled &&
      b.scaled
    ) {
      a.ambiguous = b.ambiguous = true;
    }
  }
  const result = [];
  for (const entry of selected) {
    if (entry.ambiguous) continue;
    // With two explicit endpoints, the separating '-' belongs to the range,
    // not to the second value: "$1 million - $2 million".
    if (
      entry.signText &&
      /^[−-]\s*$/.test(entry.signText) &&
      result.length &&
      /^\s*$/.test(text.slice(result.at(-1).end, entry.start))
    ) {
      entry.start += entry.signText.length;
      entry.sign = "";
    }
    const value = entry.sign + grouped(entry.value),
      comparison = entry.comparison;
    let replacement;
    if (entry.kind === "money") {
      const symbol = {
        dollar: "$",
        "yen-yuan-symbol": "¥",
        "pound-symbol": "£",
      }[entry.denomination];
      replacement =
        comparison +
        (symbol
          ? entry.sign + symbol + grouped(entry.value)
          : entry.sign + entry.denomination + " " + grouped(entry.value));
    } else if (entry.denomination === "percent")
      replacement = comparison + value + "%";
    else
      replacement =
        comparison +
        value +
        (targetLanguage === "ja"
          ? entry.denomination === "percentage-point"
            ? "パーセントポイント"
            : "ベーシスポイント"
          : entry.denomination === "percentage-point"
            ? " percentage points"
            : " basis points");
    result.push({
      start: entry.start,
      end: entry.end,
      key: `financial:${entry.kind}:${entry.denomination}:${comparison || "literal"}:${entry.sign || "unsigned"}:${entry.value}`,
      replacement,
    });
  }
  return result;
}
