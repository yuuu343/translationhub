import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEngineIdentity,
  canResumeWithEngine,
} from "../dist/engine-identity.js";
import { segmentText, validateDocument } from "../dist/documents.js";
import { prepareTextJob, paragraphContext } from "../dist/text-job.js";
import { getEngineState, setEngine } from "../dist/engines.js";

const text = "Revenue increased.\n\nCosts decreased.";
function partial() {
  const segments = segmentText(text, "en");
  Object.assign(segments[0], {
    target: "売上高が増加した。",
    edited: true,
    links: [[0, 7, 0, 3]],
  });
  return segments;
}

test("resume requires the same configurable model for all Ollama profiles", () => {
  for (const engine of ["plamo", "gemma", "ollama"]) {
    const saved = { engine, model: "quality-alpha:q4" };
    const same = {
      engine,
      model: " quality-alpha:q4 ",
      label: "Same display label",
    };
    const changed = { ...same, model: "quality-beta:q8" };
    assert.equal(canResumeWithEngine(saved, same), true);
    assert.equal(canResumeWithEngine(saved, changed), false);
    assert.equal(canResumeWithEngine(undefined, same, same.label), false);
    assert.equal(canResumeWithEngine(saved, { ...same, model: "" }), false);
    const previous = partial();
    const resume = prepareTextJob(
      text,
      "en",
      engine,
      canResumeWithEngine(saved, same) ? previous : [],
    );
    assert.equal(resume.resume, true);
    assert.deepEqual(resume.next[0].links, [[0, 7, 0, 3]]);
    assert.equal(resume.next[0].edited, true);
    const restart = prepareTextJob(
      text,
      "en",
      engine,
      canResumeWithEngine(saved, changed) ? previous : [],
    );
    assert.equal(restart.resume, false);
    assert(restart.next.every((s) => !s.target));
    assert.equal(
      previous[0].target,
      "売上高が増加した。",
      "planning must not destroy the edited document",
    );
  }
});

test("fixed engines retain label-based compatibility with legacy v1 files", () => {
  for (const engine of ["wasm", "browser", "google", "gas"]) {
    const current = { engine, label: `${engine} label` };
    assert.equal(canResumeWithEngine(undefined, current, current.label), true);
    assert.equal(
      canResumeWithEngine(undefined, current, "another engine"),
      false,
    );
    assert.equal(canResumeWithEngine({ engine }, current), true);
    assert.equal(
      canResumeWithEngine(
        { engine: "ollama", model: "quality-alpha:q4" },
        current,
      ),
      false,
    );
  }
});

test("a partial Google NMT document cannot resume as Translation LLM", () => {
  const llm = { engine: "google-tllm", project: "private-project" };
  assert.deepEqual(normalizeEngineIdentity(llm), { engine: "google-tllm" });
  assert.equal(canResumeWithEngine({ engine: "google" }, llm), false);
});

test("resume records whether the local PLaMo translation used paragraph context", () => {
  const old = { engine: "plamo", model: "local" };
  const contextual = { ...old, useContext: true };
  assert.equal(canResumeWithEngine(old, contextual), false);
  assert.equal(canResumeWithEngine(contextual, old), false);
  assert.equal(canResumeWithEngine(contextual, contextual), true);
  assert.deepEqual(
    normalizeEngineIdentity({ ...contextual, sourceContext: "private" }),
    contextual,
  );
});

test("paragraph context stays within adjacent prose and retains complete sentences under its budget", () => {
  const raw = "We saw a bird\non a fence.\n\nIt took off.";
  const [a, b] = prepareTextJob(raw, "en", "plamo").next;
  assert.deepEqual(paragraphContext(a, b, "en", "ja"), {
    sourceContext: "We saw a bird on a fence.",
  });
  assert.deepEqual(paragraphContext(undefined, a, "en", "ja"), {});
  for (const kind of ["code", "table", "separator", "attribution", "list"]) {
    assert.deepEqual(paragraphContext({ ...a, kind }, b, "en", "ja"), {});
    assert.deepEqual(paragraphContext(a, { ...b, kind }, "en", "ja"), {});
  }
  assert.deepEqual(
    paragraphContext(
      { ...a, source: "x".repeat(750) + ". A short ending." },
      b,
      "en",
      "ja",
    ),
    { sourceContext: "A short ending." },
  );
});

test("Japanese to English history uses a complete adjacent pair", () => {
  const [a, b] = prepareTextJob(
    "眼鏡を買った。\n\n毎日かけている。",
    "ja",
    "plamo-web",
  ).next;
  const translated = { ...a, target: "I bought glasses." };
  assert.deepEqual(paragraphContext(translated, b, "ja", "en"), {
    sourceContext: a.source,
    previousTranslation: translated.target,
  });
  for (const target of ["", "x".repeat(641), "a <|plamo:tag|> token"]) {
    assert.deepEqual(paragraphContext({ ...a, target }, b, "ja", "en"), {
      sourceContext: a.source,
    });
  }
  assert.deepEqual(paragraphContext(translated, b, "ja", "fr"), {
    sourceContext: a.source,
  });
});

test("optional v1 provenance survives save validation and contains no connection or credential fields", () => {
  const doc = {
    format: "translationhub.text",
    version: 1,
    from: "en",
    to: "ja",
    text,
    segments: partial(),
    engine: "Other local model",
    engineIdentity: {
      engine: "ollama",
      model: "quality-alpha:q4",
      endpoint: "http://127.0.0.1:9999",
      googleKey: "not-a-real-key",
      gasSecret: "not-a-real-secret",
      token: "not-a-real-token",
    },
  };
  const saved = validateDocument(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(saved.engineIdentity, {
    engine: "ollama",
    model: "quality-alpha:q4",
  });
  assert.equal(saved.version, 1);
  assert.equal(saved.text, text);
  assert.deepEqual(saved.segments[0].links, [[0, 7, 0, 3]]);
  assert.equal(saved.segments[0].edited, true);
  assert(!JSON.stringify(saved).includes("not-a-real"));
  assert(!JSON.stringify(saved).includes("127.0.0.1"));
  const old = { ...doc };
  delete old.engineIdentity;
  assert.equal(validateDocument(old).engineIdentity, undefined);
  assert.equal(
    validateDocument({ ...doc, engineIdentity: { engine: "ollama" } })
      .engineIdentity,
    undefined,
  );
});

test("invalid model metadata never proves resume compatibility", () => {
  for (const model of [
    "",
    "https://user:pass@example.com",
    "model?key=secret",
    "model\nsecret",
    "x".repeat(513),
    42,
  ]) {
    assert.equal(
      normalizeEngineIdentity({ engine: "ollama", model }),
      undefined,
    );
  }
  assert.equal(
    normalizeEngineIdentity({ engine: "unknown", model: "valid:q4" }),
    undefined,
  );
  assert.deepEqual(
    normalizeEngineIdentity({
      engine: "wasm",
      model: "irrelevant",
      endpoint: "private",
    }),
    { engine: "wasm" },
  );
  assert.deepEqual(
    normalizeEngineIdentity({
      engine: "plamo",
      model: "hf.co/pfnet/plamo-3-translate-0.8b-GGUF:Q4_K_M",
    }),
    {
      engine: "plamo",
      model: "hf.co/pfnet/plamo-3-translate-0.8b-GGUF:Q4_K_M",
    },
  );
});

test("public engine snapshots expose local model names without exposing settings", () => {
  setEngine("plamo");
  const state = getEngineState();
  assert.match(state.model, /plamo-3-translate/);
  for (const key of ["endpoint", "googleKey", "gasUrl", "gasSecret", "token"])
    assert.equal(Object.hasOwn(state, key), false);
  setEngine("google");
  assert.equal(Object.hasOwn(getEngineState(), "model"), false);
});
