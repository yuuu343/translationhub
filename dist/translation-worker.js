// TranslationHub — browser-only inference. No text is sent to a model service.
import { pipeline, env } from "./vendor/transformers.min.js";

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = new URL("./vendor/", import.meta.url).href;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

const MODELS = {
  "en:ja": {
    id: "Kadonox/fugumt-en-ja-onnx",
    revision: "0997e6ce157c3e784fcfc9917bf57ab4c74dbadc",
  },
  "ja:en": {
    id: "onnx-community/opus-mt-ja-en",
    revision: "05470cd69b62aa32e3ee64ccfd41279789ee4b1e",
  },
};
const pipelines = new Map();
let queue = Promise.resolve();

function progress(id, detail) {
  self.postMessage({
    id,
    type: "progress",
    detail: {
      status: detail.status,
      file: detail.file,
      progress: detail.progress,
      loaded: detail.loaded,
      total: detail.total,
    },
  });
}

async function translateComplete(pipe, text) {
  // These compact models are sentence translators; paragraph input can omit sentences.
  const parts = [
    ...new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(text),
  ]
    .map((s) => s.segment.trim())
    .filter(Boolean);
  if (parts.length > 1) {
    const translated = [];
    for (const part of parts)
      translated.push(await translateComplete(pipe, part));
    return translated.join("\n");
  }
  // Marian has a 512 token input window. Split explicitly instead of truncating.
  const encoded = await pipe.tokenizer(text);
  if (encoded.input_ids.dims.at(-1) > 480) {
    let cut = Math.floor(text.length / 2);
    const before = text.slice(0, cut);
    const boundary = Math.max(
      before.lastIndexOf("。"),
      before.lastIndexOf(". "),
      before.lastIndexOf("\n"),
      before.lastIndexOf(" "),
    );
    if (boundary > cut / 2) cut = boundary + 1;
    const left = await translateComplete(pipe, text.slice(0, cut));
    const right = await translateComplete(pipe, text.slice(cut));
    return `${left}\n${right}`;
  }
  const result = await pipe(text, {
    max_new_tokens: 512,
    num_beams: 2,
    do_sample: false,
  });
  const translated = result?.[0]?.translation_text;
  if (typeof translated !== "string" || !translated.trim())
    throw new Error(
      "訳文を生成できませんでした。文章を短くして再試行してください。",
    );
  return translated.trim();
}

self.onmessage = ({ data }) => {
  queue = queue
    .catch(() => {})
    .then(async () => {
      const { id, action, text, source, target } = data;
      try {
        const key = `${source}:${target}`;
        const spec = MODELS[key];
        if (!spec)
          throw new Error("軽量ローカル翻訳は英語 ↔ 日本語に対応しています。");
        let pipe = pipelines.get(key);
        if (!pipe) {
          progress(id, { status: "loading" });
          pipe = await pipeline("translation", spec.id, {
            revision: spec.revision,
            dtype: "q8",
            device: "wasm",
            progress_callback: (detail) => progress(id, detail),
          });
          pipelines.set(key, pipe);
        }
        const result =
          action === "prepare" ? "ready" : await translateComplete(pipe, text);
        self.postMessage({ id, type: "result", result });
      } catch (error) {
        self.postMessage({
          id,
          type: "error",
          message: error.message || String(error),
        });
      }
    });
};
