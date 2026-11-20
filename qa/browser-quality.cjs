// Run the published UI or start a temporary copy. Only synthetic text and
// device-local engines are used. No provider key or signed-in profile is needed.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { createServer } = require("node:net");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright-core");

const fixtures = [
  {
    id: "finance-table",
    from: "en",
    text: "Metric\tFY2025\tQ1 2026\nOperating cash flow\t(12.40)\t+8.75\nDiluted EPS\t−0.08\t$0.06",
    check(result) {
      const rows = result.split("\n").map((s) => s.split("\t"));
      assert.deepEqual(
        rows.map((c) => c.slice(1)),
        [
          ["FY2025", "Q1 2026"],
          ["(12.40)", "+8.75"],
          ["−0.08", "$0.06"],
        ],
      );
      assert(rows.every((r) => r[0].trim()));
    },
  },
  {
    id: "technical-literals",
    from: "en",
    text: "Use `calibrate --gain=0.125` before measurement. Keep the label `FINAL_V2` exactly as written.\n\nThe threshold was not\nreached at 0.05 mA.",
    check(result) {
      for (const literal of ["`FINAL_V2`", "`calibrate --gain=0.125`"])
        assert(result.includes(literal), result);
      assert.match(result, /0\.05\s*(?:mA|ミリアンペア)/);
      assert(result.includes("\n\n"));
    },
  },
  {
    id: "measurement",
    from: "ja",
    text: "120 Hzで測定した遅延は2.5 msだった。",
    check(result) {
      assert.match(result, /120\s*Hz/);
      assert.match(result, /2\.5\s*ms/);
      assert.doesNotMatch(result, /7\.5\s*ms/);
    },
  },
  {
    id: "financial-scale-and-negation",
    from: "en",
    text: "Capital expenditure is JPY 12.5 billion. The change was 0.6 percentage points, not 0.6%.",
    check(result) {
      assert.match(
        result,
        /125\s*億\s*円|(?:JPY|¥|￥)\s*12,500,000,000|12,500,000,000\s*円/,
      );
      assert.match(result, /0\.6\s*パーセントポイント/);
      assert.match(result, /0\.6%ではない/);
    },
  },
  {
    id: "research-table",
    from: "en",
    text: "| Measure | Before | After |\n| :--- | ---: | ---: |\n| Median latency | 12.0 ms | 7.5 ms |\n| Error rate | 0.025% | <0.010% |",
    check(result) {
      const rows = result.split("\n");
      assert.equal(rows.length, 4);
      assert.equal(rows[1], "| :--- | ---: | ---: |");
      assert.match(rows[2], /\| 12\.0 ms \| 7\.5 ms \|$/);
      assert.match(rows[3], /\| 0\.025% \| <0\.010% \|$/);
    },
  },
];

async function launchCompanion() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const child = spawn(
    process.platform === "win32" ? "python" : "python3",
    ["-B", "-u", "server.py", "--port", String(port)],
    {
      cwd: path.join(__dirname, ".."),
      windowsHide: true,
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      reject(Error("Local server exited with " + code)),
    );
    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("TranslationHub:")) resolve();
    });
  });
  return { url: "http://127.0.0.1:" + port, close: () => child.kill() };
}

async function main() {
  const engine = process.env.TRANSLATIONHUB_ENGINE || "browser";
  assert(
    ["browser", "wasm"].includes(engine),
    "Choose browser or wasm for local translation.",
  );
  const server = process.env.TRANSLATIONHUB_QA_URL
    ? null
    : await launchCompanion();
  const url = server?.url || process.env.TRANSLATIONHUB_QA_URL;
  let context;
  try {
    context = await chromium.launchPersistentContext(
      process.env.TRANSLATIONHUB_QA_PROFILE || "",
      {
        channel: "chrome",
        headless: true,
        ignoreDefaultArgs: [
          "--disable-component-update",
          "--disable-background-networking",
        ],
      },
    );
    const page = await context.newPage(),
      errors = [],
      report = { engine, cases: {} };
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    await context.route("**/*", (r) => {
      const request = r.request(),
        u = new URL(request.url());
      if (
        u.origin === new URL(url).origin ||
        (request.method() === "GET" &&
          /(^|\.)(huggingface\.co|hf\.co)$/.test(u.hostname))
      )
        return r.continue();
      errors.push("Unexpected request to " + u.hostname);
      return r.abort();
    });
    await page.goto(url);
    await page.locator("#engine").click();
    await page.getByLabel("翻訳方式", { exact: true }).selectOption(engine);
    await page.locator("#close").click();
    for (const [i, c] of fixtures.entries()) {
      await page.locator("#new").click();
      await page.locator("#from").selectOption(c.from);
      await page.locator("#to").selectOption(c.from === "en" ? "ja" : "en");
      await page.locator("#input").fill(c.text);
      await page.locator("#run").click();
      if (i === 0 && engine === "wasm")
        await page.getByRole("button", { name: "許可して翻訳" }).click();
      await page.waitForFunction(
        () =>
          !document.querySelector("#new").disabled &&
          (document.querySelector("#translation .segment") ||
            document.querySelector("dialog[open]")),
        null,
        { timeout: 240000 },
      );
      assert(
        !(await page.locator("dialog").isVisible()),
        await page.locator("#dialog-body").innerText(),
      );
      assert.equal(await page.locator("#original").textContent(), c.text);
      const result = await page.locator("#translation").textContent();
      c.check(result);
      report.cases[c.id] = { source: c.text, translation: result };
      console.log("PASS", engine, c.id);
    }
    assert.deepEqual(errors, []);
    if (process.env.TRANSLATIONHUB_QA_REPORT)
      fs.writeFileSync(
        process.env.TRANSLATIONHUB_QA_REPORT,
        JSON.stringify(report, null, 2),
      );
  } finally {
    await context?.close();
    server?.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
