import test from "node:test";
import assert from "node:assert/strict";
import { financialLiterals } from "../dist/financial-literals.js";
const key = (s) => financialLiterals(s)[0]?.key;

test("monetary scales compare exactly across English and Japanese notation", () => {
  for (const [a, b] of [
    ["$1.84 billion", "18億4000万ドル"],
    ["USD 1.84 billion", "18.4億米ドル"],
    ["JPY 12.5 billion", "125億円"],
    ["JPY 340 million", "3 億 4000 万円"],
    ["USD 18.6 million", "1,860 万米ドル"],
    ["JPY 12.5 billion", "125\u00a0億\u3000円"],
    ["JPY 12,500,000,000", "125億円"],
    ["$120 million", "1億2,000万ドル"],
    ["$95 million", "95百万ドル"],
    ["$95 million", "9,500万ドル"],
    ["EUR 1.25 million", "125万ユーロ"],
    ["CNY 2 billion", "20億人民元"],
    ["USD 0.000000001 billion", "1米ドル"],
    ["$1.84 billion USD", "USD 1.84 billion"],
    ["¥12.5 billion JPY", "125億円"],
  ])
    assert.equal(key(a), key(b), a + " ↔ " + b);
  assert.notEqual(key("JPY 12.5 billion"), key("12.5億円"));
});

test("currency countries and financial units are not guessed", () => {
  assert.notEqual(key("$1 million"), key("USD 1 million"));
  assert.notEqual(key("¥1 million"), key("JPY 1 million"));
  assert.notEqual(key("¥1 million"), key("CNY 1 million"));
  assert.notEqual(key("JPY 1 million"), key("CNY 1 million"));
  assert.notEqual(key("0.6 percentage points"), key("0.6%"));
  assert.notEqual(key("0.6 basis points"), key("0.6 percentage points"));
  assert.equal(key("0.6 percentage points"), key("0.6パーセントポイント"));
  assert.equal(key("0.6 percentage points"), key("0.6 パーセント ポイント"));
  assert.equal(key("0.6 basis points"), key("0.6 ベーシス ポイント"));
  assert.equal(key("7.50 percent"), key("7.5%"));
});

test("replacement expands magnitude and preserves ambiguous symbols", () => {
  assert.equal(
    financialLiterals("¥12.5 billion")[0].replacement,
    "¥12,500,000,000",
  );
  assert.equal(
    financialLiterals("$1.84 billion")[0].replacement,
    "$1,840,000,000",
  );
  assert.equal(
    financialLiterals("1億2,000万ドル")[0].replacement,
    "$120,000,000",
  );
  assert.equal(
    financialLiterals("125億円")[0].replacement,
    "JPY 12,500,000,000",
  );
  assert.equal(
    financialLiterals("0.6 percentage points", "ja")[0].replacement,
    "0.6パーセントポイント",
  );
  assert.equal(financialLiterals("0.6%", "ja")[0].replacement, "0.6%");
});

test("negative and explicit positive signs survive spelling and scale changes", () => {
  assert.equal(key("negative $95 million"), key("マイナス9,500万ドル"));
  assert.equal(key("negative at $95 million"), key("9500万ドルのマイナス"));
  assert.equal(key("negative $95 million"), key("95百万ドルマイナス"));
  assert.equal(key("positive $40 million"), key("プラス4,000万ドル"));
  assert.equal(key("-USD 1.25 million"), key("−125万米ドル"));
  assert.notEqual(key("$95 million"), key("negative $95 million"));
  assert.notEqual(key("positive $40 million"), key("$40 million"));
  assert.equal(
    financialLiterals("negative $95 million")[0].replacement,
    "-$95,000,000",
  );
});

test("offsets and explicit comparisons keep non-literal language intact", () => {
  const text =
    "Revenue was not <$1.84 billion; the change was +0.6 percentage points, not 0.6%.";
  const spans = financialLiterals(text, "ja");
  assert.deepEqual(
    spans.map((s) => text.slice(s.start, s.end)),
    ["<$1.84 billion", "+0.6 percentage points", "0.6%"],
  );
  assert.match(spans[0].key, /:<:/);
  assert.equal(spans[0].replacement, "<$1,840,000,000");
  assert.equal(key("≥JPY 12.5 billion"), key(">=125億円"));
  assert.equal(key("≥JPY 12.5 billion"), key("125億円以上"));
  assert.equal(key("<0.6%"), key("0.6%未満"));
});

test("explicit endpoints remain a range rather than inventing a negative amount", () => {
  for (const text of [
    "$1 million - $2 million",
    "$1 million–$2 million",
    "1億円〜2億円",
  ]) {
    const spans = financialLiterals(text);
    assert.equal(spans.length, 2, text);
    assert.ok(
      spans.every((s) => s.key.includes(":unsigned:")),
      text,
    );
  }
});

test("ambiguous notation, bare scales, points and shared ranges are not interpreted", () => {
  for (const text of [
    "1.84 billion",
    "25 million",
    "0.6ポイント",
    "0.6 pp",
    "€1.234,56",
    "$1,84 million",
    "$1–2 million",
    "1〜2億円",
    "1から2億円",
    "($2 million)",
    "$1.2bn",
    "priceUSD12",
    "1万2億円",
    "USD 1,234",
    "€1.234",
    "$1'234",
    "$1 234",
    "JPY $12",
    "USD ¥12",
    "$12 million yen",
    "１25円",
    "USD/JPY 150",
    "JPY/CNY 12",
    "USD 12/JPY",
    "USD 12 per share",
    "$1–$2 million",
    "$1 to $2 million",
    "¥12 USD",
    "1京2兆円",
  ])
    assert.deepEqual(financialLiterals(text), [], text);
});

test("very large money and tiny fractions are exact rather than floating-point rounded", () => {
  assert.equal(key("USD 9007199254740993"), key("9007199254740993米ドル"));
  assert.notEqual(key("USD 9007199254740993"), key("USD 9007199254740992"));
  assert.equal(
    financialLiterals("USD 0.000000001 billion")[0].replacement,
    "USD 1",
  );
});

test("Japanese particles and ordinary punctuation do not conceal financial literals", () => {
  const text =
    "設備投資額は125億円を見込み、利益率は12.0%から12.6%に上昇した。";
  assert.deepEqual(
    financialLiterals(text).map((s) => text.slice(s.start, s.end)),
    ["125億円", "12.0%", "12.6%"],
  );
  assert.equal(financialLiterals("0.6 percentage points, not 0.6%.").length, 2);
  assert.equal(
    financialLiterals("売上高は7.5%減の18億4000万ドルとなった。").length,
    2,
  );
});

test("expanded replacements have the same exact meaning on a second parse", () => {
  for (const original of [
    "$6 thousand",
    "USD 0.000001234 million",
    "¥12.5 billion",
    "125億円",
    "negative $95 million",
    "1億2,000万ドル",
    "0.6 percentage points",
    "+0.6%",
    "≥JPY 12.5 billion",
  ]) {
    const span = financialLiterals(original, "ja")[0];
    assert.ok(span, original);
    assert.equal(
      key(span.replacement),
      span.key,
      original + " → " + span.replacement,
    );
  }
});
