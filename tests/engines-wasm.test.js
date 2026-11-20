import test from "node:test";
import assert from "node:assert/strict";

test("WASM cancellation isolates queued work, stops active inference, and recovers", async () => {
  const instances = [];
  globalThis.Worker = class {
    requests = [];
    stopped = false;
    constructor() {
      instances.push(this);
    }
    postMessage(message) {
      this.requests.push(message);
    }
    terminate() {
      this.stopped = true;
    }
    answer(result) {
      this.onmessage({
        data: { id: this.requests.at(-1).id, type: "result", result },
      });
    }
  };
  const engine = await import("../dist/engines.js");
  engine.enableLightweight();
  const run = (text, signal) =>
    engine.translate(text, { source: "en", target: "ja", signal });
  const first = run("First request");
  const queuedAbort = new AbortController();
  const queued = run("Queued request", queuedAbort.signal);
  const queuedRejected = assert.rejects(queued, { name: "AbortError" });
  queuedAbort.abort();
  await queuedRejected;
  assert.equal(instances[0].stopped, false);
  assert.equal(instances[0].requests.length, 1);
  instances[0].answer("最初の訳");
  assert.equal(await first, "最初の訳");

  const activeAbort = new AbortController();
  const active = run("Active request", activeAbort.signal);
  const oldHandler = instances[0].onmessage;
  const oldId = instances[0].requests.at(-1).id;
  const remaining = run("Independent queued request");
  const activeRejected = assert.rejects(active, { name: "AbortError" });
  activeAbort.abort();
  await activeRejected;
  assert.equal(instances[0].stopped, true);
  assert.equal(instances.length, 2);
  assert.equal(instances[1].requests[0].text, "Independent queued request");
  oldHandler({ data: { id: oldId, type: "result", result: "stale output" } });
  instances[1].answer("残った依頼の訳");
  assert.equal(await remaining, "残った依頼の訳");

  const retry = run("Retry after cancellation");
  assert.equal(instances.length, 2);
  instances[1].answer("再開後の訳");
  assert.equal(await retry, "再開後の訳");
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(run("Never dispatched", alreadyAborted.signal), {
    name: "AbortError",
  });
  assert.equal(instances[1].requests.length, 2);

  const incomplete = run("Cannot complete this translation");
  const incompleteRejected = assert.rejects(incomplete, {
    code: "LOCAL_TRANSLATION_INCOMPLETE",
  });
  instances[1].onmessage({
    data: {
      id: instances[1].requests.at(-1).id,
      type: "error",
      message: "Translation incomplete",
      code: "LOCAL_TRANSLATION_INCOMPLETE",
    },
  });
  await incompleteRejected;
  const runtimeFailure = run("Unrelated runtime failure");
  const runtimeRejected = assert.rejects(
    runtimeFailure,
    (error) => error.message === "Out of memory" && error.code === undefined,
  );
  instances[1].onmessage({
    data: {
      id: instances[1].requests.at(-1).id,
      type: "error",
      message: "Out of memory",
      code: "UNRELATED_RUNTIME_ERROR",
    },
  });
  await runtimeRejected;
});
