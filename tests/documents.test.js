import test from "node:test";
import assert from "node:assert/strict";
import {
  segmentText,
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
    ["heading", "list", "list", "table", "code", "quote", "separator", "list"],
  );
  assert.equal(
    modelText(segments[1], "en"),
    "- First item has a wrapped continuation.",
  );
  assert.equal(
    modelText(segments[3], "en"),
    "Year  Revenue\n2025  120\n2024  96",
  );
  assert.equal(
    modelText(segments[4], "en"),
    "```js\nconst a = 1;\n\nconst b = 2;\n```",
  );
  assert.equal(modelText(segments[5], "en"), "> line one line two");
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
