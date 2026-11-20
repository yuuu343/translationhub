import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// Tiny settings DOM; every network request below is an in-process stub.
class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.attrs = {};
    this.value = "";
    this.type = "";
    this.checked = false;
    this.textContent = "";
    this.classList = { add() {} };
  }
  setAttribute(name, value) {
    this.attrs[name] = value;
  }
  addEventListener(name, fn) {
    this.listeners[name] = fn;
  }
  append(...children) {
    this.children.push(...children);
  }
  replaceChildren(...children) {
    this.children = children;
  }
  remove() {}
  all() {
    return [this, ...this.children.flatMap((c) => c.all())];
  }
  querySelector(selector) {
    return this.all().find((c) =>
      Object.hasOwn(c.attrs, selector.slice(1, -1)),
    );
  }
}
let serial = 0;
async function setup(engine, respond) {
  globalThis.location = {
    hostname: "127.0.0.1",
    origin: "http://127.0.0.1:8771",
  };
  globalThis.document = { createElement: (tag) => new Element(tag) };
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith("/api/session"))
      return { ok: true, json: async () => ({ token: "synthetic-session" }) };
    const body = JSON.parse(options.body);
    requests.push(body);
    return { ok: true, json: async () => respond(body, requests.length) };
  };
  const module = await import(`../dist/engines.js?connections=${++serial}`);
  module.setEngine(engine);
  const container = new Element("main");
  module.mountEngines(container);
  const input = (label, value) => {
    const field = container
      .all()
      .find(
        (e) =>
          e.tag === "label" &&
          e.children.some((c) => c.textContent.includes(label)),
      );
    const control = field.children.find((e) => e.tag === "input");
    control.value = value;
    control.listeners.input();
  };
  const consent = () => {
    const checkbox = container
      .all()
      .find((e) => e.tag === "input" && e.type === "checkbox");
    checkbox.checked = true;
    checkbox.listeners.change();
  };
  if (engine === "google") input("Google Cloud APIキー", "synthetic-key");
  if (engine === "gas") {
    input("WebアプリURL", "https://script.google.com/macros/s/synthetic/exec");
    input("接続用シークレット", "synthetic-secret-at-least-32-characters");
  }
  return { module, requests, input, consent };
}
const complete = {
  done: true,
  done_reason: "stop",
  message: { content: "訳文" },
};

test("PLaMo and TranslateGemma use their documented prompts", async () => {
  const plamo = await setup("plamo", () => complete);
  await plamo.module.translate("Do not change 2.5 ms.", {
    source: "en-US",
    target: "ja",
  });
  assert.equal(
    plamo.requests[0].messages[0].content,
    "[plamo-translate]\ntarget_lang=ja\nsource_lang=en",
  );
  assert.equal(plamo.requests[0].messages[1].content, "Do not change 2.5 ms.");
  assert.equal(plamo.requests[0].profile, "plamo");
  const gemma = await setup("gemma", () => complete);
  await gemma.module.translate("Do not change 2.5 ms.", {
    source: "en",
    target: "ja",
  });
  assert.equal(gemma.requests[0].messages.length, 1);
  assert.match(
    gemma.requests[0].messages[0].content,
    /English \(en\) to Japanese \(ja\)/,
  );
  assert.ok(
    gemma.requests[0].messages[0].content.endsWith(
      "Japanese:\n\n\nDo not change 2.5 ms.",
    ),
  );
});

test("unfinished Ollama output is rejected", async () => {
  const { module } = await setup("plamo", () => ({ ...complete, done: false }));
  await assert.rejects(
    module.translate("A complete sentence.", { source: "en" }),
    /完了/,
  );
});

test("cloud input requires consent and preserves literal entities and formulas", async () => {
  const raw = "x < 0; AT&T; literal &lt; and &#39; and \\alpha";
  const { module, requests, consent } = await setup("google", () => ({
    data: { translations: [{ translatedText: raw }] },
  }));
  await assert.rejects(module.translate(raw, { source: "en" }), /送信を許可/);
  assert.equal(requests.length, 0);
  consent();
  assert.equal(await module.translate(raw, { source: "en" }), raw);
  assert.equal(requests[0].text, raw);
});

test("long GAS requests are bounded, keep all non-whitespace, and freeze settings", async () => {
  const raw =
    "測定値𝛼は2.5 ms未満ではない。A < B & C; &lt; stays literal.\n\n".repeat(
      180,
    );
  let context;
  context = await setup("gas", (body, index) => {
    if (index === 1) context.module.setEngine("plamo");
    return { translation: body.text };
  });
  context.consent();
  const result = await context.module.translate(raw, {
    source: "ja",
    target: "en",
  });
  assert.ok(context.requests.length > 1);
  assert.ok(
    context.requests.every(
      (r) => r.provider === "gas" && r.text.length <= 3000 && r.text.trim(),
    ),
  );
  assert.ok(
    context.requests.every(
      (r) => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(r.text),
    ),
  );
  assert.equal(
    context.requests
      .map((r) => r.text)
      .join("")
      .replace(/\s/g, ""),
    raw.replace(/\s/g, ""),
  );
  assert.equal(result.replace(/\s/g, ""), raw.replace(/\s/g, ""));
});

test("cancelling a long cloud translation prevents later chunk requests", async () => {
  const controller = new AbortController();
  const { module, requests, consent } = await setup("gas", () => {
    controller.abort();
    return { translation: "partial" };
  });
  consent();
  await assert.rejects(
    module.translate("One sentence with a value of 17.5%. ".repeat(200), {
      source: "en",
      signal: controller.signal,
    }),
    { name: "AbortError" },
  );
  assert.equal(requests.length, 1);
});

test("cancellation also works while waiting for the companion session", async () => {
  const { module } = await setup("plamo", () => complete);
  globalThis.fetch = () => new Promise(() => {});
  const controller = new AbortController();
  const promise = module.translate("A non-secret sample.", {
    source: "en",
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(promise, { name: "AbortError" });
});

test("GAS connector enforces one bounded plain-text call without writes", async () => {
  const text = await readFile(
    new URL("../dist/integrations/google-apps-script.gs", import.meta.url),
    "utf8",
  );
  assert.equal(
    text,
    await readFile(
      new URL("../integrations/google-apps-script.gs", import.meta.url),
      "utf8",
    ),
  );
  const calls = [],
    secret = "synthetic-secret-at-least-32-characters";
  const sandbox = {
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => secret }),
    },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (value) => ({ setMimeType: () => JSON.parse(value) }),
    },
    LanguageApp: {
      translate: (...args) => {
        calls.push(args);
        return args[0];
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(text, sandbox);
  const call = (value) =>
    sandbox.doPost({
      postData: {
        contents: JSON.stringify({
          secret,
          text: value,
          source: "auto",
          target: "ja",
        }),
      },
    });
  assert.ok(call("x".repeat(3001)).error);
  assert.ok(call("   ").error);
  assert.equal(calls.length, 0);
  assert.equal(call("x < y; &lt;").translation, "x < y; &lt;");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], "");
  assert.equal(calls[0][3].contentType, "text");
});
