// TranslationHub — browser-only inference. No text is sent to a model service.
import { pipeline, env } from "./vendor/transformers.min.js";
import {
  LOCAL_TRANSLATION_INCOMPLETE,
  translateLocalText,
} from "./local-nmt.js";

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
          action === "prepare"
            ? "ready"
            : await translateLocalText(pipe, text, source, target);
        self.postMessage({ id, type: "result", result });
      } catch (error) {
        self.postMessage({
          id,
          type: "error",
          message: error.message || String(error),
          ...(error.code === LOCAL_TRANSLATION_INCOMPLETE
            ? { code: error.code }
            : {}),
        });
      }
    });
};
