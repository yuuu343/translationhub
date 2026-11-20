import test from "node:test";
import assert from "node:assert/strict";
import {
  explicitLiteralRanges,
  protectLiterals,
} from "../dist/text-literals.js";
import { prepareTextJob, translateTextUnit } from "../dist/text-job.js";
import { translatedGap } from "../dist/documents.js";

const enJa = { source: "en", target: "ja" };
const jaEn = { source: "ja", target: "en" };
const unit = (source) => ({ source, kind: "paragraph" });

test("standalone financial quantities use target-language notation without inventing prose", async () => {
  const unexpected = () =>
    assert.fail("A complete literal does not need model generation");
  assert.equal(
    await translateTextUnit(
      unit("125億円"),
      jaEn,
      "browser",
      async () => "12.5 billion yen",
    ),
    "12.5 billion yen",
  );
  assert.equal(
    await translateTextUnit(
      unit("125億円"),
      jaEn,
      "wasm",
      async () => "12 billion yen",
    ),
    "JPY 12,500,000,000",
  );
  assert.equal(
    await translateTextUnit(
      unit("2.5 percentage points"),
      enJa,
      "wasm",
      async () => "2.5%の年齢ポイント",
    ),
    "2.5パーセントポイント",
  );
  assert.equal(
    await translateTextUnit(
      unit("125億円"),
      jaEn,
      "browser",
      async (text) => text,
    ),
    "JPY 12,500,000,000",
  );
  assert.equal(
    await translateTextUnit(
      unit("3.2ミリ秒"),
      jaEn,
      "wasm",
      async (text) => text,
    ),
    "3.2 ms",
  );
  assert.equal(
    await translateTextUnit(
      unit("3.2ミリ秒"),
      jaEn,
      "browser",
      async () => "3.2 ms",
    ),
    "3.2 ms",
  );
  assert.equal(
    await translateTextUnit(
      unit("100万ドル"),
      jaEn,
      "browser",
      async () => "a million dollars",
    ),
    "a million dollars",
  );
  assert.equal(
    await translateTextUnit(
      unit("1パーセントポイント"),
      jaEn,
      "browser",
      async () => "one percentage point",
    ),
    "one percentage point",
  );
  assert.equal(
    await translateTextUnit(unit("`MAX_LIMIT`"), jaEn, "browser", unexpected),
    "`MAX_LIMIT`",
  );
});

test("a standalone amount never accepts invented surrounding facts or an approximation", async () => {
  for (const natural of [
    "The company lost 12.5 billion yen.",
    "12.5 billion yen in 2025",
    "About 12.5 billion yen",
    "≈12.5 billion yen",
  ]) {
    assert.equal(
      await translateTextUnit(
        unit("125億円"),
        jaEn,
        "browser",
        async () => natural,
      ),
      "JPY 12,500,000,000",
    );
  }
  assert.equal(
    await translateTextUnit(
      unit("125億円"),
      jaEn,
      "browser",
      async () => "The 12.5 billion yen.",
    ),
    "The 12.5 billion yen.",
  );
  assert.equal(
    await translateTextUnit(
      unit("125億円"),
      jaEn,
      "browser",
      async () => "125 億円",
    ),
    "JPY 12,500,000,000",
  );
  assert.equal(
    await translateTextUnit(
      unit("2.5 percentage points"),
      enJa,
      "browser",
      async () => "2.5 percent points",
    ),
    "2.5パーセントポイント",
  );
  assert.equal(
    await translateTextUnit(
      unit("JPY 12.5 billion"),
      enJa,
      "browser",
      async () => "JPY 12500000000",
    ),
    "JPY 12500000000",
  );
});

test("Japanese spacing in correct financial translations does not force a masked retry", async () => {
  let calls = 0;
  const result = await translateTextUnit(
    unit("Net income rose from JPY 340 million to JPY 510 million."),
    enJa,
    "browser",
    async () => {
      calls++;
      return "純利益は 3 億 4000 万円から 5 億 1000 万円に増加しました。";
    },
  );
  assert.equal(
    result,
    "純利益は 3 億 4000 万円から 5 億 1000 万円に増加しました。",
  );
  assert.equal(calls, 1);
});

test("explicit code, math and variables retain their spelling without mistaking prices for equations", () => {
  const text =
    "Pay $20 or $30. Use `FINAL_V2` and ``two ` ticks``, then compare $x_1 = 2$ to |x| and ||y||.";
  assert.deepEqual(
    explicitLiteralRanges(text).map(([a, b]) => text.slice(a, b)),
    ["`FINAL_V2`", "``two ` ticks``", "$x_1 = 2$", "|x|", "||y||"],
  );
});

test("restores reordered values but refuses missing, invented, or duplicated markers", () => {
  const p = protectLiterals("Use [X101] with 2.5 ms and 120 Hz.", true);
  assert.equal(p.masked, "Use [X101] with [X102] and [X103].");
  assert.equal(
    p.restore("At ［ｘ１０３］ use [X101] with [x102]."),
    "At 120 Hz use [X101] with 2.5 ms.",
  );
  assert.equal(p.restore("Use [X101] with [X102]."), null);
  assert.equal(p.restore("Use [X103] with [X102], again [X103]."), null);
  assert.equal(p.restore("Use [X103] with [X102] and [X109]."), null);
  assert.equal(p.restore("[X102] [X103]"), null);
  assert.equal(p.intact("測定は2.5ミリ秒、周波数は120 Hz。"), true);
  assert.equal(p.intact("測定は12.5 ms、周波数は120 Hz。"), false);
  assert.equal(p.intact("2.5 ms, 120 Hz."), false);
});

test("recovers the unit's case or a changed quantity without altering the original", async () => {
  const calls = [];
  const s = unit("0.05 mA is the limit.");
  const result = await translateTextUnit(s, enJa, "browser", async (text) => {
    calls.push(text);
    return text.includes("[X101]")
      ? "上限は[x101]です。"
      : "上限は0.05 Maです。";
  });
  assert.deepEqual(calls, ["0.05 mA is the limit.", "[X101] is the limit."]);
  assert.equal(result, "上限は0.05 mAです。");
  assert.equal(s.source, "0.05 mA is the limit.");
  assert.equal(
    await translateTextUnit(
      unit("120 Hzで測定した遅延は2.5 msだった。"),
      jaEn,
      "wasm",
      async () => "At [X101] the delay was [X102].",
    ),
    "At 120 Hz the delay was 2.5 ms.",
  );
});

test("a damaged protected result stays unconfirmed, including when a local retry also fails", async () => {
  for (const engine of ["wasm", "google", "plamo"]) {
    let requests = 0;
    await assert.rejects(
      translateTextUnit(
        unit("Run `SAMPLE_ID` twice."),
        enJa,
        engine,
        async () => {
          requests++;
          return "実行します。";
        },
      ),
      /確定していません/,
    );
    assert.equal(requests, engine === "google" ? 1 : 2);
  }
});

test("a canceled local job stops before the second attempt", async () => {
  const controller = new AbortController();
  let requests = 0;
  await assert.rejects(
    translateTextUnit(
      unit("Run `A`."),
      { ...enJa, signal: controller.signal },
      "browser",
      async () => {
        requests++;
        controller.abort();
        return "実行します。";
      },
    ),
    { name: "AbortError" },
  );
  assert.equal(requests, 1);
});

test("only an incomplete WASM decoding result is retried with protected input", async () => {
  const s = unit("Measure 2.5 ms.");
  for (const code of ["LOCAL_TRANSLATION_INCOMPLETE", "NETWORK_ERROR"]) {
    let count = 0;
    const job = translateTextUnit(s, enJa, "wasm", async () => {
      if (++count === 1)
        throw Object.assign(new Error("worker error"), { code });
      return "[X101]を測定します。";
    });
    if (code === "LOCAL_TRANSLATION_INCOMPLETE")
      assert.equal(await job, "2.5 msを測定します。");
    else {
      await assert.rejects(job, /worker error/);
      assert.equal(count, 1);
    }
  }
});

test("the input planner lets the local tokenizer process a complete sentence across the 3000-character boundary", () => {
  const text = "Include " + "each item, ".repeat(340) + "and the last item.";
  const { next } = prepareTextJob(text, "en", "wasm");
  assert.equal(next.length, 1);
  assert.equal(next[0].source, text);
});

test("a lost marker in a local LLM paragraph recovers all sentences atomically", async () => {
  const sent = [];
  async function reply(text) {
    sent.push(text);
    if (text === "First [X101].") return "先に[X101]。";
    if (text === "Then [X101].") return "次に[X101]。";
    return "省略されました。";
  }
  const answer = await translateTextUnit(
    unit("First `ORIG_A`. Then `ORIG_B`."),
    enJa,
    "plamo",
    reply,
  );
  assert.equal(answer, "先に`ORIG_A`。次に`ORIG_B`。");
  assert.equal(sent.length, 5);
});

test("an explicitly excluded quantity stays negative when a model drops the comparison", async () => {
  const result = await translateTextUnit(
    unit("The change was 2 percentage points, not 2%."),
    enJa,
    "gemma",
    async (text) =>
      text.includes("[X101]") ? "変化は[X101]だった。" : "変化は2%だった。",
  );
  assert.equal(result, "変化は2パーセントポイントだった（2%ではない）。");
});

test("a tenfold currency error triggers a verified local retry; an equivalent unambiguous amount passes directly", async () => {
  let calls = 0;
  const repaired = await translateTextUnit(
    unit("The budget is ¥12.5 billion."),
    enJa,
    "gemma",
    async (text) => {
      calls++;
      return text.includes("[X101]")
        ? "予算は[X101]です。"
        : "予算は12.5億円です。";
    },
  );
  assert.equal(repaired, "予算は¥12,500,000,000です。");
  assert.equal(calls, 2);
  calls = 0;
  const correct = await translateTextUnit(
    unit("The budget is JPY 12.5 billion."),
    enJa,
    "plamo",
    async () => {
      calls++;
      return "予算は125億円です。";
    },
  );
  assert.equal(correct, "予算は125億円です。");
  assert.equal(calls, 1);
});

test("TSV numeric cells, empty columns, indentation and row endings survive the actual translation path", async () => {
  const src =
    "Metric\tFY2025\tQ1 2026\r\n\tCash flow\t(12.40)\t+8.75\t\r\nMargin\t18.00%\t17.25%\r\n";
  const { next } = prepareTextJob(src, "en", "browser");
  const sent = [];
  let target = "";
  for (const [i, seg] of next.entries()) {
    const translated = await translateTextUnit(
      seg,
      enJa,
      "browser",
      async (text) => {
        sent.push(text);
        return text === "Margin (%)" ? "[Margin] （％）" : "[" + text + "]";
      },
    );
    target += translatedGap(seg, i, "ja") + translated;
  }
  assert.deepEqual(sent, ["Metric", "Cash flow", "Margin (%)"]);
  assert.equal(
    target,
    "[Metric]\tFY2025\tQ1 2026\r\n\t[Cash flow]\t(12.40)\t+8.75\t\r\n[Margin]\t18.00%\t17.25%\r\n",
  );
});

test("Markdown separators and escaped or quoted pipes survive; an empty translated label fails the row", async () => {
  const row = { kind: "table", source: "| Mode | `A|B` | 0.025% |" };
  assert.equal(
    await translateTextUnit(row, enJa, "browser", async () => "モード"),
    "| モード | `A|B` | 0.025% |",
  );
  const sent = [];
  await translateTextUnit(
    { kind: "table", source: "| Alpha\\|Beta | 0.025% |" },
    enJa,
    "browser",
    async (s) => {
      sent.push(s);
      return s;
    },
  );
  assert.deepEqual(sent, ["Alpha\\|Beta"]);
  assert.equal(
    await translateTextUnit(
      { kind: "table", source: "| :--- | ---: |" },
      enJa,
      "google",
      async () => assert.fail("rule sent for translation"),
    ),
    "| :--- | ---: |",
  );
  await assert.rejects(
    translateTextUnit(row, enJa, "browser", async () => ""),
    /セル/,
  );
});

test("scientific notation, hexadecimal values and leading empty TSV columns are never sent as labels", async () => {
  const sent = [];
  const row = "\tTolerance\t1.2e-3\t1E+06\t0xFF\t1.20e-05 mA\t";
  const got = await translateTextUnit(
    { kind: "table", source: row },
    enJa,
    "google",
    async (text) => {
      sent.push(text);
      return "許容誤差";
    },
  );
  assert.deepEqual(sent, ["Tolerance"]);
  assert.equal(got, row.replace("Tolerance", "許容誤差"));
});
