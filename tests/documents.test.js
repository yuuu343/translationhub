import test from "node:test";
import assert from "node:assert/strict";
import {
  segmentText,
  sentenceRanges,
  modelText,
  translatedGap,
  validateDocument,
} from "../dist/documents.js";
import { parsePageRange, validateProject } from "../dist/pdf.js";
import { prepareTextJob, translateTextUnit } from "../dist/text-job.js";

test("document offsets survive punctuation, Japanese, CRLF and an emoji", () => {
  const text =
    "  ありがとう。さようなら。\r\n\r\n👋 Hello! Watch the 3.5% margin.\n";
  const segments = segmentText(text, "ja", { granularity: "sentence" });
  assert.equal(segments.map((s) => s.gap + s.source).join(""), text);
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
  const sample = {
      format: "translationhub.text",
      version: 1,
      from: "en",
      to: "ja",
      text: "Results. Operating income improved.",
      segments: [
        { source: "Results.", target: "結果。", gap: "", links: [] },
        {
          source: "Operating income improved.",
          target: "営業利益が改善した。",
          gap: " ",
          links: [[0, 16, 0, 4]],
        },
      ],
    },
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
        part.source.slice(a, b) === "Operating income" &&
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

const wrappedPassage = `"Most propositions and questions that
have been written about philosophical
matters are not false, but nonsensical. We
therefore cannot answer questions of this
kind at all, but can only establish their
nonsensicality. Most of the questions and
propositions of philosophers rest on the
fact that we do not understand the logic of
our language.

(They are of the same kind as the question
of whether the Good is more or less
identical than the Beautiful.)

And it is not surprising that the deepest
problems are actually not problems at all."

- Ludwig Josef Johann Wittgenstein`;
const passageSentences = [
  '"Most propositions and questions that have been written about philosophical matters are not false, but nonsensical.',
  "We therefore cannot answer questions of this kind at all, but can only establish their nonsensicality.",
  "Most of the questions and propositions of philosophers rest on the fact that we do not understand the logic of our language.",
  "(They are of the same kind as the question of whether the Good is more or less identical than the Beautiful.)",
  'And it is not surprising that the deepest problems are actually not problems at all."',
  "- Ludwig Josef Johann Wittgenstein",
];
const reassemble = (segments) => segments.map((s) => s.gap + s.source).join("");

function assertExactOffsets(text, segments) {
  assert.equal(reassemble(segments), text);
  let cursor = 0;
  for (const segment of segments) {
    cursor += segment.gap.length;
    assert.equal(
      text.slice(cursor, cursor + segment.source.length),
      segment.source,
    );
    cursor += segment.source.length;
  }
  assert.equal(cursor, text.length);
}

test("OCR passage is sent as five complete sentences, never its physical lines", async () => {
  const { next: segments } = prepareTextJob(wrappedPassage, "en", "wasm");
  assertExactOffsets(wrappedPassage, segments);
  const outbound = [];
  const translate = async (text) => {
    outbound.push(text);
    return "訳";
  };
  for (const segment of segments)
    segment.target = await translateTextUnit(
      segment,
      { source: "en", target: "ja" },
      "wasm",
      translate,
    );
  assert.deepEqual(outbound, passageSentences.slice(0, -1));
  assert.equal(segments.at(-1).target, passageSentences.at(-1));
  assert.equal(segments.at(-1).kind, "attribution");
  assert.match(segments[0].source, /that\nhave/);
  assert.match(segments[1].source, /We\ntherefore/);
  assert.equal(segments[1].softGap, true);
  assert.equal(segments[3].gap, "\n\n");
  assert.equal(segments[3].softGap, undefined);
});

test("browser translation receives complete sentences and preserves an isolated signed name", async () => {
  const { next } = prepareTextJob(wrappedPassage, "en", "browser");
  const calls = [];
  for (const s of next) {
    s.target = await translateTextUnit(
      s,
      { source: "en", target: "ja" },
      "browser",
      (text) => {
        calls.push(text);
        return "訳文";
      },
    );
  }
  assert.deepEqual(calls, passageSentences.slice(0, -1));
  assert.equal(next.at(-1).target, passageSentences.at(-1));
});

test("paragraph engines receive whole paragraphs with the author as a separate unit", async () => {
  const { next: segments } = prepareTextJob(wrappedPassage, "en", "plamo");
  assertExactOffsets(wrappedPassage, segments);
  const outbound = [];
  for (const segment of segments) {
    await translateTextUnit(
      segment,
      { source: "en", target: "ja" },
      "plamo",
      (text) => outbound.push(text),
    );
  }
  assert.deepEqual(outbound, [
    passageSentences.slice(0, 3).join(" "),
    ...passageSentences.slice(3),
  ]);
  assert.equal(segments.length, 4);
  assert.equal(segmentText(wrappedPassage, "en").length, 4);
});

test("partial jobs preserve edits on resume and retranslate legacy physical-line fragments", () => {
  const text = "Sales\nrose.\n\nAnother page.";
  const { next } = prepareTextJob(text, "en", "browser");
  Object.assign(next[0], {
    target: "増収でした。",
    edited: true,
    links: [[0, 5, 0, 2]],
  });
  const saved = prepareTextJob(text, "en", "browser", next);
  assert.equal(saved.resume, true);
  assert.deepEqual(saved.next[0].links, [[0, 5, 0, 2]]);
  assert.equal(saved.next[0].target, "増収でした。");
  assert.equal(saved.next[0].edited, true);
  const legacy = [
    { source: "Sales", gap: "", target: "営業部門" },
    { source: "rose.", gap: "\n", target: "" },
    next[1],
  ];
  const rebuilt = prepareTextJob(text, "en", "browser", legacy);
  assert.equal(rebuilt.resume, false);
  assert.equal(rebuilt.next[0].source, "Sales\nrose.");
  assert.equal(rebuilt.next[0].target, "");
});

test("CRLF, leading indentation, final whitespace and phrase offsets survive cleanup and save", () => {
  const text =
    "  Our operating\r\nincome improved.\r\nRevenue stayed flat.  \r\n\r\nNext paragraph.\r\n \t";
  const segments = segmentText(text, "en", { granularity: "sentence" });
  assertExactOffsets(text, segments);
  assert.equal(modelText(segments[0], "en"), "Our operating income improved.");
  const sourcePhrase = "operating\r\nincome",
    start = segments[0].source.indexOf(sourcePhrase);
  segments[0].target = "営業利益は改善した。";
  segments[0].links = [[start, start + sourcePhrase.length, 0, 4]];
  const doc = validateDocument(
    JSON.parse(
      JSON.stringify({
        format: "translationhub.text",
        version: 1,
        from: "en",
        to: "ja",
        text,
        segments,
      }),
    ),
  );
  assert.equal(doc.text, text);
  assertExactOffsets(text, doc.segments);
  assert.equal(
    doc.segments[0].source.slice(...doc.segments[0].links[0].slice(0, 2)),
    sourcePhrase,
  );
  assert.equal(doc.segments[1].softGap, true);
  assert.equal(translatedGap(doc.segments[1], 1, "ja"), "");
  assert.equal(translatedGap(doc.segments[1], 1, "en"), " ");
  assert.equal(translatedGap(doc.segments[2], 2, "ja"), "  \r\n\r\n");
  assert.equal(
    translatedGap({ ...doc.segments[1], targetGap: "\n" }, 1, "ja"),
    "\n",
  );
});

test("lists, titles, tables, fenced code and quote lines retain their structure", () => {
  const text =
    "# Results\n\n- First item has a\n  wrapped continuation.\n- Second item stays separate.\n\nYear  Revenue\n2025  120\n2024  96\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\n> line one\n> line two\n\n---\n\n- Ludwig Josef Johann Wittgenstein\n";
  const segments = segmentText(text, "en");
  assertExactOffsets(text, segments);
  assert.deepEqual(
    segments.map((s) => s.kind),
    [
      "heading",
      "list",
      "list",
      "table",
      "table",
      "table",
      "code",
      "quote",
      "separator",
      "list",
    ],
  );
  assert.equal(
    modelText(segments[1], "en"),
    "- First item has a wrapped continuation.",
  );
  assert.equal(
    segments
      .filter((s) => s.kind === "table")
      .map((s) => modelText(s, "en"))
      .join("\n"),
    "Year  Revenue\n2025  120\n2024  96",
  );
  assert.equal(
    modelText(segments[6], "en"),
    "```js\nconst a = 1;\n\nconst b = 2;\n```",
  );
  assert.equal(modelText(segments[7], "en"), "> line one line two");
  assert.equal(
    segmentText("- Follow these instructions\ncarefully.", "en")[0].kind,
    "list",
  );
  assert.equal(
    segmentText(
      "Annual Financial Report\nThis report explains the result.",
      "en",
    )[0].kind,
    "heading",
  );
});

test("Japanese OCR spacing is repaired without creating spaces inside words or changing raw text", () => {
  const text =
    "日 本 語の\n文章です。次の\n段落は AI の説明です。\n\n2025 年の結果。";
  const segments = segmentText(text, "ja", { granularity: "sentence" });
  assertExactOffsets(text, segments);
  assert.deepEqual(
    segments.map((s) => modelText(s, "ja")),
    ["日本語の文章です。", "次の段落は AI の説明です。", "2025 年の結果。"],
  );
  assert.equal(
    modelText("한국어 문장을\n계속 읽습니다.", "ko"),
    "한국어 문장을 계속 읽습니다.",
  );
});

test("hyphens are conservative, discretionary hyphens and clear prose wrap backslashes are repaired", () => {
  const text =
    "The state-of-\nthe-art philo-\nsophical example con\u00ad\ntinues here.";
  const [segment] = segmentText(text, "en");
  assert.equal(
    modelText(segment, "en"),
    "The state-of-the-art philo-sophical example continues here.",
  );
  assertExactOffsets(text, [segment]);
  const prose = "These words belong together\\\non the next physical line.";
  const [wrapped] = segmentText(prose, "en");
  assert.equal(
    modelText(wrapped, "en"),
    "These words belong together on the next physical line.",
  );
  assert.equal(
    modelText(wrapped, "en", { unwrapBackslashes: false }),
    "These words belong together\\ on the next physical line.",
  );
  assertExactOffsets(prose, [wrapped]);
  assert.match(
    modelText("The path is C:\\tools\\\nnext directory", "en"),
    /C:\\tools\\/,
  );
  assert.match(
    modelText("These words end with two\\\\\nnext line", "en"),
    /two\\\\/,
  );
  assert.equal(
    modelText("First paragraph.\n\nSecond paragraph.", "en"),
    "First paragraph.\n\nSecond paragraph.",
  );
});

test("character budgets handle long sentences, unspaced CJK, symbols and surrogate pairs without loss", () => {
  for (const granularity of ["sentence", "paragraph"]) {
    for (const text of [
      "A sentence. Another sentence. ".repeat(190),
      "これは長い日本語の説明です".repeat(500),
      "☆※→←".repeat(1800),
      "👋".repeat(1700),
      ("word ".repeat(600) + "end. ").repeat(2),
    ]) {
      const segments = segmentText(text, "ja", { granularity, maxChars: 3000 });
      assertExactOffsets(text, segments);
      assert(segments.length > 1);
      for (const segment of segments) {
        const outgoing = modelText(segment, "ja");
        assert(outgoing.length <= 3000, `too long: ${outgoing.length}`);
        assert(!/[\uD800-\uDBFF]$/.test(outgoing));
        assert(!/^[\uDC00-\uDFFF]/.test(outgoing));
      }
    }
  }
  assert.throws(() => segmentText("text", "en", { maxChars: 1 }));
  assert.throws(() => segmentText("text", "en", { granularity: "line" }));
});

test("legacy v1 documents and old sentence gaps remain compatible", () => {
  const old = {
    format: "translationhub.text",
    version: 1,
    from: "en",
    to: "ja",
    text: "First.\r\nSecond.\r\n",
    segments: [
      { source: "First.", target: "一。", gap: "", links: [] },
      { source: "Second.", target: "二。", gap: "\r\n", links: [] },
    ],
  };
  const restored = validateDocument(old);
  assert.equal(restored.version, 1);
  assert.equal(restored.text, old.text);
  assert.equal(translatedGap(restored.segments[1], 1, "ja"), "\r\n");
  assert.equal(modelText(restored.segments[0], "en"), "First.");
  assert.equal(restored.segments[0].kind, undefined);
  assert.deepEqual(segmentText(" \t\r\n", "en"), []);
});

test("title-case bullets and ordinary OCR spaces are not misclassified as authors or tables", () => {
  const text =
    "- Free Cash Flow\n- Research Costs\n\nThis  is an  OCR line with\nwords  separated  by extra spaces.\n";
  const segments = segmentText(text, "en");
  assertExactOffsets(text, segments);
  assert.deepEqual(
    segments.map((s) => s.kind),
    ["list", "list", "paragraph"],
  );
  assert.equal(
    modelText(segments[2], "en"),
    "This is an OCR line with words separated by extra spaces.",
  );
  assert.equal(segmentText("- Free Cash Flow", "en")[0].kind, "list");
  assert.equal(segmentText("By John Smith", "en")[0].kind, "attribution");
  const quoted =
    "> This is a wrapped\n> quotation. The next\n> sentence remains together.\n>\n> Another paragraph.";
  const quotes = segmentText(quoted, "en");
  assertExactOffsets(quoted, quotes);
  assert.equal(
    modelText(quotes[0], "en"),
    "> This is a wrapped quotation. The next sentence remains together.\n\n> Another paragraph.",
  );
});

test("sentence units inside wrapped block quotes preserve paragraph breaks and do not leak repeated quote markers", () => {
  const text =
    "> One sentence. The next\n> sentence continues.\n>\n> Another paragraph.";
  const segments = segmentText(text, "en", { granularity: "sentence" });
  assertExactOffsets(text, segments);
  assert.deepEqual(
    segments.map((s) => modelText(s, "en")),
    ["> One sentence.", "The next sentence continues.", "> Another paragraph."],
  );
  assert.equal(segments[1].softGap, true);
  assert.equal(segments[2].softGap, undefined);
});

test("technical prose keeps inline norms, single tabs, decimal values and numbered references in complete sentences", () => {
  const text =
    "Dr. Chen measured 3.5 V. The\tresidual |x| and ||y|| remain\nbelow 0.05 in Eq. (2). See Fig. 3 for details.";
  const expected = [
    "Dr. Chen measured 3.5 V.",
    "The residual |x| and ||y|| remain below 0.05 in Eq. (2).",
    "See Fig. 3 for details.",
  ];
  const segments = segmentText(text, "en", { granularity: "sentence" });
  assertExactOffsets(text, segments);
  assert(segments.every((s) => s.kind === "paragraph"));
  assert.deepEqual(
    segments.map((s) => modelText(s, "en")),
    expected,
  );
  // The worker must be able to apply the same boundary function again unchanged.
  for (const sentence of expected)
    assert.deepEqual(sentenceRanges(sentence, "en"), [[0, sentence.length]]);
});

test("financial prose does not turn redundant spaces into columns or split decimal amounts", () => {
  const text =
    "Net  revenue rose  3.5% to $1,200.50 million.\r\nAdjusted EPS was $1.25 vs. $1.20 a year earlier.\r\nCash flow was -€96.25 million.";
  const segments = segmentText(text, "en", { granularity: "sentence" });
  assertExactOffsets(text, segments);
  assert(segments.every((s) => s.kind === "paragraph"));
  const outgoing = segments.map((s) => modelText(s, "en"));
  assert.deepEqual(outgoing, [
    "Net revenue rose 3.5% to $1,200.50 million.",
    "Adjusted EPS was $1.25 vs. $1.20 a year earlier.",
    "Cash flow was -€96.25 million.",
  ]);
  assert.deepEqual(
    outgoing.join(" ").match(/[-€$]*\d[\d,.]*%?/g),
    text.match(/[-€$]*\d[\d,.]*%?/g),
  );
});

test("numbered and alphabetical list markers stay with their item rather than becoming model calls", () => {
  for (const text of [
    "1. Review the 2025 results.\n2. Compare cash flow.",
    "A. Review revenue.\nB. Review costs.",
    "a. Read the report.\nb. Check the figures.",
  ]) {
    const segments = segmentText(text, "en", { granularity: "sentence" });
    assertExactOffsets(text, segments);
    assert.deepEqual(
      segments.map((s) => modelText(s, "en")),
      text.split("\n"),
    );
    assert(segments.every((s) => s.kind === "list"));
  }
});

test("explicit section headings remain distinct while bare CJK phrases are not guessed to be headings", () => {
  const text =
    "2.1 Experimental setup\nThe CPU used 3.3 V.\n第2章 実験結果\nGPUの温度は65度だった。\n【考察】\nAPIの応答時間は短い。";
  const segments = segmentText(text, "ja");
  assertExactOffsets(text, segments);
  assert.deepEqual(
    segments.map((s) => s.kind),
    ["heading", "paragraph", "heading", "paragraph", "heading", "paragraph"],
  );
  assert.deepEqual(
    segments.map((s) => modelText(s, "ja")),
    text.split("\n"),
  );
  const wrapped = "結果は\nGPUの使用率によって変わる。";
  assert.equal(
    modelText(segmentText(wrapped, "ja")[0], "ja"),
    "結果はGPUの使用率によって変わる。",
  );
});

test("Unicode line and paragraph separators preserve raw offsets and their different meanings", () => {
  const text =
    "Cafe\u0301 revenue\u2028rose 3.5%.\u2029利益は\u0085GPU部門で増加した。\fNext page.\n";
  const segments = segmentText(text, "ja");
  assertExactOffsets(text, segments);
  assert.deepEqual(
    segments.map((s) => modelText(s, "ja")),
    [
      "Cafe\u0301 revenue rose 3.5%.",
      "利益はGPU部門で増加した。",
      "Next page.",
    ],
  );
  assert.equal(segments[1].gap, "\u2029");
  assert.equal(segments[2].gap, "\f");
  segments[0].target = "Cafe\u0301の売上高";
  segments[0].links = [[0, 5, 0, 5]];
  const saved = validateDocument(
    JSON.parse(
      JSON.stringify({
        format: "translationhub.text",
        version: 1,
        from: "ja",
        to: "en",
        text,
        segments,
      }),
    ),
  );
  assertExactOffsets(text, saved.segments);
  assert.deepEqual(saved.segments[0].links, [[0, 5, 0, 5]]);
  assert.equal(saved.segments[0].source.slice(0, 5), "Cafe\u0301");
});

test("honorifics in French and German stay attached to names without swallowing a sentence ending in a unit", () => {
  for (const [lang, text, expected] of [
    [
      "fr",
      "M. Dupont a mesuré 3,5 V. Le résultat reste stable.",
      ["M. Dupont a mesuré 3,5 V.", "Le résultat reste stable."],
    ],
    [
      "de",
      "Dr. Weber misst 3,5 V. Die CPU bleibt kühl.",
      ["Dr. Weber misst 3,5 V.", "Die CPU bleibt kühl."],
    ],
    [
      "en",
      "Prof. Lee measured 6 W. Revenue grew 2%.",
      ["Prof. Lee measured 6 W.", "Revenue grew 2%."],
    ],
  ]) {
    const segments = segmentText(text, lang, { granularity: "sentence" });
    assertExactOffsets(text, segments);
    assert.deepEqual(
      segments.map((s) => modelText(s, lang)),
      expected,
    );
    assert(segments.every((s) => s.kind === "paragraph"));
  }
  // Ambiguous country abbreviations must not be joined unconditionally.
  assert.deepEqual(
    sentenceRanges("It operates in the U.S. Revenue grew 2%.", "en").map(
      ([a, b]) => "It operates in the U.S. Revenue grew 2%.".slice(a, b),
    ),
    ["It operates in the U.S.", "Revenue grew 2%."],
  );
});

test("clear TSV, Markdown and aligned numeric tables use complete rows with all cell delimiters", () => {
  for (const text of [
    "\tRegion\tRevenue\t\n\tEMEA\t120\t\n\tAPAC\t96\t",
    "| Region | Revenue |\n| :--- | ---: |\n| EMEA | 120 |\n| APAC | 96 |",
    "Region  Revenue\nEMEA    120\nAPAC    96",
  ]) {
    const rows = text.split("\n");
    const segments = segmentText(text, "en", {
      granularity: "sentence",
      maxChars: 8,
    });
    assertExactOffsets(text, segments);
    assert.deepEqual(
      segments.map((s) => s.source),
      rows,
    );
    assert.deepEqual(
      segments.map((s) => modelText(s, "en")),
      rows,
    );
    assert(segments.every((s) => s.kind === "table"));
  }
  const code = "```js\nconst message = 'a long literal value';\n```";
  assert.equal(segmentText(code, "en", { maxChars: 8 }).length, 1);
});

test("budget boundaries keep normal combining characters and emoji sequences intact when they fit", () => {
  const text = "cafe\u0301 👩🏽‍💻 最適化を確認 ".repeat(30);
  const boundaries = new Set(
    [
      ...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(text),
    ].map((s) => s.index),
  );
  boundaries.add(text.length);
  const segments = segmentText(text, "ja", {
    granularity: "paragraph",
    maxChars: 31,
  });
  assertExactOffsets(text, segments);
  let offset = 0;
  for (const s of segments) {
    offset += s.gap.length;
    assert(boundaries.has(offset));
    offset += s.source.length;
    assert(boundaries.has(offset));
    assert(modelText(s, "ja").length <= 31);
  }
});

test("fallback sentence boundaries preserve decimals, references and names when Intl.Segmenter is unavailable", () => {
  const original = Intl.Segmenter;
  try {
    Intl.Segmenter = undefined;
    const text = "Dr. Lee measured 3.5 V. See Eq. (2).";
    assert.deepEqual(
      sentenceRanges(text, "en").map(([a, b]) => text.slice(a, b)),
      ["Dr. Lee measured 3.5 V.", "See Eq. (2)."],
    );
  } finally {
    Intl.Segmenter = original;
  }
});

test("closed inline code and math preserve their spelling, spacing and sentence-like punctuation", () => {
  const text =
    "The log contains `phase one.  Phase two` and\nthe identity \\(a = 1.  B = 2\\) remains valid. Next sentence.";
  const expected = [
    "The log contains `phase one.  Phase two` and the identity \\(a = 1.  B = 2\\) remains valid.",
    "Next sentence.",
  ].map((s) => s);
  const segments = segmentText(text, "en", { granularity: "sentence" });
  assertExactOffsets(text, segments);
  assert.deepEqual(
    segments.map((s) => modelText(s, "en")),
    expected,
  );
  for (const value of expected)
    assert.deepEqual(sentenceRanges(value, "en"), [[0, value.length]]);
});

test("a closed display formula retains internal line breaks and blank lines", () => {
  const formula = "\\[\n E = m c^2\n\n\\]";
  const text = `The identity ${formula} is retained. Next sentence.`;
  const segments = segmentText(text, "en", { granularity: "sentence" });
  assertExactOffsets(text, segments);
  assert.deepEqual(
    segments.map((s) => modelText(s, "en")),
    [`The identity ${formula} is retained.`, "Next sentence."],
  );
});

test("character budgets keep a closed literal whole for the downstream placeholder adapter", () => {
  const literal = "`phase one.  phase two; phase three`";
  const text = `Read the log ${literal} before interpreting the result.`;
  const segments = segmentText(text, "en", {
    granularity: "paragraph",
    maxChars: 24,
  });
  assertExactOffsets(text, segments);
  const outgoing = segments.map((s) => modelText(s, "en"));
  assert.equal(outgoing.filter((s) => s.includes(literal)).length, 1);
  assert(outgoing.every((s) => s.length <= 24 || s === literal));
});
