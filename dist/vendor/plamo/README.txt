PLaMo browser runtime for translationhub

Built with PLaMo.

Bundled execution code: @wllama/wllama 3.13.0, unmodified minified ESM and
WebAssembly assets from the npm package. The npm SHA-512 integrity and each
file's SHA-256 are recorded in provenance.json. THIRD-PARTY-NOTICES.txt
retains runtime, llama.cpp, and standard-library notices with pinned sources.

Model weights are NOT bundled with the website. The app requests the exact
official PFN Q4_K_M file only after the user chooses to download it. Its
separate PLaMo Community License is reproduced in PLAMO-LICENSE-ja.txt and
PLAMO-LICENSE-en.txt. The model is not covered by the app's MIT license.

The worker checks size and SHA-256 before every load. It caches only the
model file in the origin-private directory translationhub-plamo-v1. Source
text, translated text, and translation history are not written there.
Removing this site's browser data removes that model cache as well.

Runtime mode: CPU, one thread, 16384-token context, no context shifting.
JSPI and WebAssembly Memory64 are required; they are checked before download.
There is no remote inference endpoint or automatic CDN runtime fallback.
The page and worker require wasm-unsafe-eval and worker-src blob: under CSP.
Model downloads use the pinned huggingface.co URL and its HTTPS hf.co CDN.
