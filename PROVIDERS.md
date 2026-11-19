# Translation providers

TranslationHub's own browser application and local companion do not save text, API credentials, or connection secrets on a server. Credentials stay in the current tab's memory and briefly in the local companion request. Reloading/closing the tab clears them. Local browser document saving is a separate, explicit action. Cloud providers process the text when explicitly selected; local inference does not send text to a provider.

## Start locally

Run `start.bat` on Windows, or `python server.py --open` / `python3 server.py --open`. Python 3 and a modern browser are required. The fixed address is `http://127.0.0.1:8771`. The companion binds only to the loopback address. It keeps a random session token in memory, checks Host and Origin, and does not log requests, credentials, filenames, or translation text.

## Available paths

| Choice | Processing | Setup and limits |
| --- | --- | --- |
| Browser built-in | Browser/device | Uses the standard `Translator` API when provided by the browser. The initial language-pack download may require clicking the preparation button. Availability differs by browser, device, and language. |
| Lightweight local | Browser Web Worker + WASM | English → Japanese uses FuguMT; Japanese → English uses OPUS-MT. The user explicitly permits model download/cache. Approximately 150 MB and 240 MB respectively, in addition to runtime assets. No account or API key. Sentence-oriented models; technical/financial terminology and important passages need checking. |
| PLaMo 3 Translate | Local Ollama | Prepare the model shown in the settings. Uses the official `[plamo-translate]` settings system message. Model terms apply separately from this application's license. |
| TranslateGemma | Local Ollama | Prepare `translategemma:4b` or select another installed size. Uses the official TranslateGemma translation prompt. Select the source language explicitly. |
| Other local Ollama | Local Ollama | Generic instruction-following models only. Local loopback endpoints only. Names marked cloud and model metadata indicating a remote backend are rejected. |
| Google Cloud | Google | Your Basic v2 API key and project, with your billing/quota. Not a free unlimited service. Explicit permission before sending source text. Keys are sent in a header to Google's fixed API endpoint, not query strings. Advanced v3 credentials are not supported by this implementation. |
| Google Apps Script | Your Google script | Install `integrations/google-apps-script.gs` and configure its Script Property secret. Uses your LanguageApp quota. Explicit permission before sending source text. No writes of text or translations in the connector script. |

There is no automatic fallback to another provider and no shared operator-owned paid API key. Credentials must never be added to public source code. A key entered into a webpage is accessible to that page's JavaScript; this design does not claim to eliminate all endpoint, browser-extension, or supply-chain risk.

For model cache removal, use the browser's site-data controls for the exact TranslationHub origin. Doing so may also delete saved documents; export any documents you want to keep first. Cache can be evicted by the browser under storage pressure. Private browsing generally does not preserve it after closing.

## Static hosting

The contents of `dist/` can be served as static files over HTTPS. No server database or account system is required. Browser built-in and lightweight local translation run directly there. Serve `.wasm` as `application/wasm`, `.js` and `.mjs` as JavaScript modules, and do not remove `dist/vendor`.

The local companion is needed for the supplied Google, Apps Script, and Ollama integrations. For a publicly hosted frontend, the user must start their local companion with an exact trusted origin, for example `python server.py --allow-origin https://YOUR-OWN-SITE.example`. This is an explicit trust decision: the trusted origin can ask the companion to translate. Browser local-network permission/CORS policies still apply. Do not use a wildcard origin or expose the companion to the network. The bundled local URL works without this additional setup.

The WASM runtime is approximately 21.6 MB uncompressed (under a 25 MiB per-file static-host limit). Models are fetched from fixed Hugging Face repository revisions and cached by the browser, not shipped as large weight files in `dist`. Static-host limits and policies still need checking when choosing a host.

The optional EasyRead import relay exists only in the local companion. It accepts an explicitly selected PDF (maximum 128 MB), forwards only to `127.0.0.1:8765`, and sets `translate=0&read=0`. This action saves a copy in the user's EasyRead library; it does not start translation.

## Third-party sources and licenses

- **Transformers.js 3.8.1**, Hugging Face, Apache-2.0. Unmodified browser bundle from the official npm package; source: <https://github.com/huggingface/transformers.js>. Full license: `dist/vendor/TRANSFORMERS-LICENSE.txt`. Package URL and asset SHA-256 hashes: `dist/vendor/provenance.json`.
- **ONNX Runtime Web 1.22.0 development build**, Microsoft, MIT. Bundled WASM/runtime assets distributed by Transformers.js. License: `dist/vendor/ONNXRUNTIME-LICENSE.txt`. Included third-party attribution: `dist/vendor/ONNXRUNTIME-ThirdPartyNotices.txt` (upstream release 1.22.0 notices). Upstream: <https://github.com/microsoft/onnxruntime>.
- **FuguMT English → Japanese**, original model by staka, CC-BY-SA-4.0; ONNX conversion by Kadonox. The app downloads the quantized ONNX variant unmodified. Original: <https://huggingface.co/staka/fugumt-en-ja>. Conversion: <https://huggingface.co/Kadonox/fugumt-en-ja-onnx/tree/0997e6ce157c3e784fcfc9917bf57ab4c74dbadc>. License: <https://creativecommons.org/licenses/by-sa/4.0/>. The model is separately licensed; the application's source license does not replace its terms.
- **OPUS-MT Japanese → English**, Helsinki-NLP, CC-BY-4.0; ONNX conversion by onnx-community. The app downloads the quantized ONNX variant unmodified. Original: <https://huggingface.co/Helsinki-NLP/opus-mt-ja-en>. Conversion: <https://huggingface.co/onnx-community/opus-mt-ja-en/tree/05470cd69b62aa32e3ee64ccfd41279789ee4b1e>. License: <https://creativecommons.org/licenses/by/4.0/>.
- **PLaMo 3 Translate** is an optional separately obtained model, not included. Source and terms: <https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF>.
- **TranslateGemma** is an optional separately obtained model, not included. Source: <https://huggingface.co/google/translategemma-4b-it>; terms: <https://ai.google.dev/gemma/terms>.

The application does not claim that cloud services or every optional model are OSI-licensed open-source components. Model quality, runtime compatibility, and provider quotas vary. All paragraph/sentence and terminology checks should be evaluated using the user's actual documents before relying on the translation.
