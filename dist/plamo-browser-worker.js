// PLaMo inference stays in this worker. Only the pinned public weight file is fetched.
export const PLAMO_MODEL = Object.freeze({
  repository: "pfnet/plamo-3-translate-0.8b-GGUF",
  revision: "7de4409f84a9d70e3a5e87b81e84883d49f77b58",
  filename: "plamo-3-translate-0.8b-Q4_K_M.gguf",
  sha256: "70891ec70dc7ab4205745a38307867c2881b99239f20327927633abfe4bc9ec6",
  bytes: 573126848,
});
export const PLAMO_LIMITS = Object.freeze({ context: 16384, output: 4096, text: 3000, sourceContext: 640, promptMargin: 1024 });
export const PLAMO_MODEL_URL = `https://huggingface.co/${PLAMO_MODEL.repository}/resolve/${PLAMO_MODEL.revision}/${PLAMO_MODEL.filename}`;
const CACHE_DIRECTORY = "translationhub-plamo-v1";
const languages = new Set(["en", "ja", "zh", "ko", "fr", "de", "es", "it", "pt", "ru", "ar", "hi"]);
const silent = () => {};
const logger = { debug: silent, log: silent, warn: silent, error: silent };
const specialTokens = /<\|plamo:[^>]*\|>/i;

function failure(message, code = "PLAMO_BROWSER_ERROR") {
  return Object.assign(new Error(message), { code });
}
const knownFailure = error => typeof error?.code === "string" && error.code.startsWith("PLAMO_");

export function supportsPlamoRuntime() {
  if (typeof WebAssembly === "undefined" || typeof WebAssembly.Suspending !== "function") return false;
  try {
    new WebAssembly.Memory({ address: "i64", initial: 1n });
    return true;
  } catch { return false; }
}

export function planPlamoRequest({ text, source, target, sourceContext = "", previousTranslation = "" }) {
  if (typeof text !== "string" || !text.trim() || text.length > PLAMO_LIMITS.text)
    throw failure("PLaMoへの1回の入力は1〜3000文字にしてください。", "PLAMO_INPUT_LIMIT");
  if (!languages.has(source) || !languages.has(target) || source === target)
    throw failure("翻訳元と翻訳先の言語を確認してください。", "PLAMO_LANGUAGE");
  if (typeof sourceContext !== "string" || sourceContext.length > PLAMO_LIMITS.sourceContext)
    throw failure("前後の文脈が長すぎます。", "PLAMO_INPUT_LIMIT");
  if (typeof previousTranslation !== "string")
    throw failure("前の対訳の形式を確認してください。", "PLAMO_REQUEST");
  if (specialTokens.test(text) || specialTokens.test(sourceContext))
    throw failure("モデルの制御記号を含む文章は、この方式では翻訳できません。", "PLAMO_CONTROL_TOKEN");
  const setting = `[plamo-translate]\ntarget_lang=${target}\nsource_lang=${source}`;
  const instruction = setting +
    (sourceContext.trim() ? "\n---\n" + sourceContext : "");
  let messages = [{ role: "system", content: instruction }, { role: "user", content: text }];
  const promptSize = entries => new TextEncoder().encode(entries.map(entry => entry.content).join("")).length + PLAMO_LIMITS.promptMargin;
  if (source === "ja" && target === "en" && sourceContext.trim() && previousTranslation.trim() &&
      previousTranslation.length <= PLAMO_LIMITS.sourceContext && !specialTokens.test(previousTranslation)) {
    const history = [{ role: "system", content: setting },
      { role: "user", content: sourceContext }, { role: "assistant", content: previousTranslation },
      { role: "user", content: text }];
    if (promptSize(history) + PLAMO_LIMITS.output <= PLAMO_LIMITS.context) messages = history;
  }
  // This byte-fallback tokenizer cannot require more text tokens than UTF-8
  // bytes. Reserve additional template tokens and the entire generation budget.
  const upperPrompt = promptSize(messages);
  if (upperPrompt + PLAMO_LIMITS.output > PLAMO_LIMITS.context)
    throw failure("原文と文脈が長すぎます。文章を短く区切ってください。", "PLAMO_INPUT_LIMIT");
  return { messages, upperPrompt, maxTokens: PLAMO_LIMITS.output };
}

export function verifyPlamoResponse(response, maximum = PLAMO_LIMITS.output) {
  const choice = response?.choices?.[0], usage = response?.usage;
  if (response?.choices?.length !== 1 || choice?.finish_reason !== "stop" || response?.truncated === true ||
      !Number.isInteger(usage?.prompt_tokens) || !Number.isInteger(usage?.completion_tokens) ||
      !Number.isInteger(usage?.total_tokens) || usage.prompt_tokens < 0 || usage.completion_tokens < 1 ||
      usage.completion_tokens >= maximum || usage.total_tokens > PLAMO_LIMITS.context ||
      usage.total_tokens < usage.prompt_tokens + usage.completion_tokens)
    throw failure("PLaMoが訳文を最後まで生成できませんでした。この箇所は確定していません。", "PLAMO_TRANSLATION_INCOMPLETE");
  const result = choice.message?.content;
  if (choice.message?.role !== "assistant" || choice.message?.tool_calls?.length || typeof result !== "string" || !result.trim() || /<\|[^>]*\|>/.test(result))
    throw failure("PLaMoから有効な訳文が届きませんでした。この箇所は確定していません。", "PLAMO_TRANSLATION_INCOMPLETE");
  return result.trim();
}

export async function sha256Blob(blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function verifiedFile(handle, progress) {
  const file = await handle.getFile();
  if (file.size !== PLAMO_MODEL.bytes) return null;
  progress({ status: "loading", phase: "verify", file: "PLaMoのデータを確認中" });
  return await sha256Blob(file) === PLAMO_MODEL.sha256 ? file : null;
}

async function cachedModel(progress) {
  if (!navigator.storage?.getDirectory)
    throw failure("このブラウザーではPLaMoのデータを保存できません。Chromeなど対応ブラウザーを使ってください。", "PLAMO_STORAGE");
  let directory;
  try {
    const root = await navigator.storage.getDirectory();
    directory = await root.getDirectoryHandle(CACHE_DIRECTORY, { create: true });
  } catch {
    throw failure("PLaMoの保存場所を開けませんでした。ブラウザーのサイト保存設定を確認してください。", "PLAMO_STORAGE");
  }
  const name = PLAMO_MODEL.sha256 + ".gguf";
  try {
    const existing = await directory.getFileHandle(name);
    const file = await verifiedFile(existing, progress);
    if (file) {
      progress({ status: "done", phase: "cached", file: "PLaMo", loaded: file.size, total: file.size, progress: 100 });
      return file;
    }
    await directory.removeEntry(name);
  } catch (error) {
    if (error.name !== "NotFoundError")
      throw failure("保存したPLaMoのデータを確認できませんでした。サイトの保存データを確認してください。", "PLAMO_STORAGE");
  }
  // Called only by an explicit prepare/translate request after the UI's model
  // consent. No module initialization, status query, or page load downloads it.
  let response;
  try {
    response = await fetch(PLAMO_MODEL_URL, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
  } catch {
    throw failure("PLaMoを取得できませんでした。初回はインターネット接続が必要です。", "PLAMO_DOWNLOAD");
  }
  if (!response.ok || !response.body)
    throw failure("PLaMoの配布元からデータを取得できませんでした。時間をおいて再試行してください。", "PLAMO_DOWNLOAD");
  const length = response.headers.get("content-length");
  if (length !== null && Number(length) !== PLAMO_MODEL.bytes)
    throw failure("PLaMoの配布データのサイズが一致しません。", "PLAMO_INTEGRITY");
  const handle = await directory.getFileHandle(name, { create: true });
  let writable;
  const reader = response.body.getReader();
  let loaded = 0, lastProgress = 0;
  try {
    writable = await handle.createWritable();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      if (loaded > PLAMO_MODEL.bytes) throw failure("PLaMoのデータのサイズが一致しません。", "PLAMO_INTEGRITY");
      await writable.write(value);
      if (performance.now() - lastProgress > 150 || loaded === PLAMO_MODEL.bytes) {
        lastProgress = performance.now();
        progress({ status: "progress", phase: "download", file: "PLaMo", loaded, total: PLAMO_MODEL.bytes, progress: loaded / PLAMO_MODEL.bytes * 100 });
      }
    }
    if (loaded !== PLAMO_MODEL.bytes) throw failure("PLaMoの取得が途中で終わりました。再試行してください。", "PLAMO_INTEGRITY");
    await writable.close();
    writable = null;
    const file = await verifiedFile(handle, progress);
    if (!file) throw failure("PLaMoのデータのハッシュが一致しません。再試行してください。", "PLAMO_INTEGRITY");
    return file;
  } catch (error) {
    try { await writable?.abort(); } catch {}
    try { await directory.removeEntry(name); } catch {}
    if (knownFailure(error)) throw error;
    throw failure("PLaMoの取得・保存を完了できませんでした。空き容量と接続を確認してください。", "PLAMO_DOWNLOAD");
  } finally {
    try { await reader.cancel(); } catch {}
    reader.releaseLock();
  }
}

let instance;
async function getModel(progress) {
  if (instance?.isModelLoaded()) return instance;
  if (!supportsPlamoRuntime())
    throw failure("このブラウザーはPLaMoの実行機能に未対応です。新しいChrome・Edgeなどを使うか、別の翻訳方式を選んでください。", "PLAMO_UNSUPPORTED");
  const file = navigator.locks
    ? await navigator.locks.request("translationhub-plamo-cache-v1", () => cachedModel(progress))
    : await cachedModel(progress);
  const { Wllama } = await import("./vendor/plamo/wllama.min.js");
  const model = new Wllama({ default: new URL("./vendor/plamo/wllama.wasm", import.meta.url).href }, { suppressNativeLog: true, logger });
  // No CDN compatibility fallback and no GPU feature detection/download path.
  model.setCompat(null);
  progress({ status: "loading", phase: "model", file: "PLaMoを準備中" });
  try {
    await model.loadModel([file], {
      n_ctx: PLAMO_LIMITS.context, n_gpu_layers: 0, n_threads: 1, n_parallel: 1,
      ctx_shift: false, cache_idle_slots: false, seed: 0,
    });
    if (model.getLoadedContextInfo().n_ctx < PLAMO_LIMITS.context)
      throw failure("必要な文脈サイズでPLaMoを起動できませんでした。", "PLAMO_RUNTIME");
    instance = model;
    return model;
  } catch (error) {
    try { await model.exit(); } catch {}
    if (knownFailure(error)) throw error;
    throw failure("この端末ではPLaMoを起動できませんでした。空きメモリを確認するか、別の翻訳方式を選んでください。", "PLAMO_RUNTIME");
  }
}

export async function handlePlamoRequest(request, progress = silent) {
  if (!["prepare", "translate"].includes(request.action))
    throw failure("未対応のPLaMo操作です。", "PLAMO_REQUEST");
  const plan = request.action === "translate" ? planPlamoRequest(request) : null;
  const model = await getModel(progress);
  if (!plan) return "ready";
  progress({ status: "inference", phase: "inference", file: "PLaMo" });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240000);
  try {
    const response = await model.createChatCompletion({
      messages: plan.messages, temperature: 0, max_tokens: plan.maxTokens,
      stop: ["<|plamo:tag|>", "<|plamo:bos|>"],
      cache_prompt: false, truncate: false, abortSignal: controller.signal,
    });
    return verifyPlamoResponse(response, plan.maxTokens);
  } catch (error) {
    if (knownFailure(error)) throw error;
    if (controller.signal.aborted)
      throw failure("PLaMoの翻訳に時間がかかりすぎたため停止しました。文章を短くしてください。", "PLAMO_TIMEOUT");
    throw failure("PLaMoで訳文を生成できませんでした。文章を短くするか、別の翻訳方式を選んでください。", "PLAMO_RUNTIME");
  } finally { clearTimeout(timer); }
}

if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  let queue = Promise.resolve();
  self.onmessage = ({ data }) => {
    if (!data || !Number.isSafeInteger(data.id) || data.id < 1) return;
    const id = data.id;
    queue = queue.catch(silent).then(async () => {
      try {
        const result = await handlePlamoRequest(data, detail => self.postMessage({ id, type: "progress", detail }));
        self.postMessage({ id, type: "result", result });
      } catch (error) {
        self.postMessage({ id, type: "error", message: knownFailure(error) ? error.message : "PLaMoの処理に失敗しました。", code: knownFailure(error) ? error.code : "PLAMO_RUNTIME" });
      }
    });
  };
}
