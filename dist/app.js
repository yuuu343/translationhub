import { icons } from "./icons.js";
import {
  languages,
  validateDocument,
  shelf,
  exportDoc,
  translatedGap,
} from "./documents.js";
import { installAlignment } from "./alignment.js";
import { initAppearance, mountAppearance } from "./appearance.js";
import { initTextSizing } from "./text-size.js";
import { prepareTextJob, translateTextUnit } from "./text-job.js";
import {
  translate,
  engineLabel,
  enginePrivacy,
  getEngineState,
  mountEngines,
  enableLightweight,
  subscribeEngineStatus,
} from "./engines.js";
import { fundingPage } from "./site-config.js";
const $ = (id) => document.getElementById(id);
const dialog = $("dialog"),
  body = $("dialog-body"),
  input = $("input");
let pdf,
  loadingPdf,
  dialogCleanup,
  toastTimer,
  activeJob,
  currentId,
  dirty = false,
  editMode = true;
let segments = [],
  originalText = "",
  label = "",
  title = "",
  pdfBusy = false,
  layout = "side";
let selectedSentence = 0;
const readyDirections = new Set();
function directionKey({ source, target }) {
  return getEngineState().engine + "|" + source + "|" + target;
}
const getLanguages = () => ({ source: $("from").value, target: $("to").value });
const getPdfLanguages = () => ({
  source: $("pdf-from").value,
  target: $("pdf-to").value,
});
function notify(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  toastTimer = setTimeout(() => ($("toast").textContent = ""), 5000);
}
function element(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function button(text, fn, cls = "secondary") {
  const b = element("button", text, cls);
  b.addEventListener("click", fn);
  return b;
}
function modal(name, setup) {
  dialogCleanup?.();
  dialogCleanup = null;
  body.replaceChildren();
  $("dialog-title").textContent = name;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  const cleanup = setup(body);
  if (typeof cleanup === "function") dialogCleanup = cleanup;
  else if (cleanup?.destroy) dialogCleanup = () => cleanup.destroy();
  icons(body);
}
dialog.addEventListener("close", () => {
  dialogCleanup?.();
  dialogCleanup = null;
});
$("close").onclick = () => dialog.close();
dialog.addEventListener("click", (e) => {
  const r = dialog.getBoundingClientRect();
  if (
    e.target === dialog &&
    (e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom)
  )
    dialog.close();
});
function markDirty() {
  dirty = true;
}
function doc() {
  const { source: from, target: to } = getLanguages();
  return {
    format: "translationhub.text",
    version: 1,
    text: originalText,
    segments,
    engine: label,
    from,
    to,
    title:
      title || input.value.trim().split(/\r?\n/)[0]?.slice(0, 64) || "無題",
  };
}
function isLocalEngine() {
  return ["browser", "wasm", "plamo", "gemma", "ollama"].includes(
    getEngineState().engine,
  );
}
const align = installAlignment({
  sourcePane: $("original"),
  targetPane: $("translation"),
  getDoc: doc,
  canSuggest: (direction) =>
    !activeJob &&
    !dialog.open &&
    !editMode &&
    isLocalEngine() &&
    readyDirections.has(directionKey(direction)),
  translate,
  setHint,
  markDirty,
  notify,
});
function setHint(message, action = "") {
  const hint = $("match-info");
  const fallback = segments.some((s) => s.target)
    ? "原文・訳文のどちらからでも選択できます"
    : "";
  hint.replaceChildren(document.createTextNode(message || fallback));
  if (action) {
    const b = button(
      action === "confirm" ? "この範囲で確定" : "語句を結ぶ",
      () => align.linkSelection(),
      "mini inline-action",
    );
    b.onmousedown = (e) => e.preventDefault();
    hint.append(" ", b);
  }
}
function renderSegments(pane, field) {
  const frag = document.createDocumentFragment();
  segments.forEach((s, i) => {
    frag.append(
      document.createTextNode(
        field === "target" ? translatedGap(s, i, $("to").value) : s.gap,
      ),
    );
    const span = element("span", s[field], "segment");
    span.dataset.i = i;
    frag.append(span);
  });
  pane.replaceChildren(frag);
}
function controls() {
  const any = input.value.trim().length > 0,
    hasOutput = segments.some((s) => s.target);
  $("input").hidden = !editMode;
  $("original").hidden = editMode;
  $("edit").hidden = editMode || !!activeJob;
  $("copy").disabled = !hasOutput;
  $("save").disabled = !any || !!activeJob;
  $("run").disabled = !any;
  $("revise").hidden = !hasOutput || !!activeJob;
  $("run").lastElementChild.textContent = activeJob
    ? "中止"
    : hasOutput &&
        label === engineLabel() &&
        segments.every((s) => s.kind) &&
        segments.some((s) => !s.target)
      ? "続きから翻訳"
      : "翻訳する";
  for (const id of ["from", "to", "swap", "new"]) $(id).disabled = !!activeJob;
  for (const id of ["settings", "engine", "pdf-engine", "pdf-from", "pdf-to"])
    $(id).disabled = !!activeJob || pdfBusy;
  if (pdfBusy) $("run").disabled = true;
  input.readOnly = !!activeJob;
  $("count").textContent =
    Array.from(input.value).length.toLocaleString() + " 文字";
  $("engine-name").textContent = engineLabel();
  $("pdf-engine").querySelector("span").textContent = engineLabel();
  $("privacy").textContent = enginePrivacy();
}
function draw() {
  align.reset();
  controls();
  if (!editMode) renderSegments($("original"), "source");
  if (segments.some((s) => s.target))
    renderSegments($("translation"), "target");
  else
    $("translation").replaceChildren(
      element(
        "span",
        activeJob ? "翻訳しています…" : "翻訳した文章がここに表示されます。",
        "empty-translation",
      ),
    );
  setHint("");
}
function updateLangOptions() {
  for (const id of ["from", "to", "pdf-from", "pdf-to"]) {
    for (const [k, v] of Object.entries(languages)) $(id).add(new Option(v, k));
    $(id).value = id.endsWith("from") ? "en" : "ja";
  }
}
function applyDoc(data, id = null) {
  selectedSentence = 0;
  originalText = data.text;
  input.value = data.text;
  segments = data.segments;
  label = data.engine;
  title = data.title;
  $("from").value = data.from;
  $("to").value = data.to;
  currentId = id;
  editMode = !segments.length;
  dirty = false;
  draw();
}
function canReplace() {
  return (
    !activeJob &&
    (!dirty ||
      !input.value.trim() ||
      confirm("保存していない変更があります。この文章を入れ替えますか？"))
  );
}
function blank() {
  if (!canReplace()) return;
  const { source: from, target: to } = getLanguages();
  applyDoc({ text: "", segments: [], engine: "", title: "", from, to });
  input.focus();
}
$("new").onclick = blank;
$("edit").onclick = () => {
  editMode = true;
  draw();
  input.focus();
};
input.addEventListener("input", () => {
  originalText = input.value;
  segments = [];
  title = "";
  label = "";
  editMode = true;
  markDirty();
  draw();
});
for (const id of ["from", "to"])
  $(id).onchange = () => {
    segments = [];
    label = "";
    editMode = true;
    markDirty();
    draw();
  };
$("swap").onclick = () => {
  const { source, target } = getLanguages();
  if (segments.some((s) => s.target) && segments.every((s) => s.target)) {
    segments = segments.map((s, i) => ({
      source: s.target,
      target: s.source,
      gap: translatedGap(s, i, target),
      targetGap: s.gap,
      edited: s.edited,
      links: s.links.map(([a, b, c, d]) => [c, d, a, b]),
    }));
    originalText = segments.map((s) => s.gap + s.source).join("");
    input.value = originalText;
    editMode = false;
  } else {
    segments = [];
    editMode = true;
  }
  $("from").value = target;
  $("to").value = source;
  title = "";
  markDirty();
  draw();
};
function setLayout(mode, save = true) {
  layout = mode;
  $("panels").classList.toggle("stacked", mode === "stack");
  $("panels").classList.toggle("forced-side", mode === "side");
  $("side").setAttribute("aria-pressed", String(mode === "side"));
  $("stack").setAttribute("aria-pressed", String(mode === "stack"));
  if (save)
    try {
      localStorage.setItem("translationhub-layout", mode);
    } catch {}
}
$("side").onclick = () => setLayout("side");
$("stack").onclick = () => setLayout("stack");
function openSettings() {
  if (activeJob || pdfBusy) return;
  modal("翻訳エンジン", (c) => {
    const pane = element("div");
    c.append(pane);
    return mountEngines(pane, {
      onChange: controls,
      notify,
      getLanguages: () =>
        $("pdf-area").hidden ? getLanguages() : getPdfLanguages(),
    });
  });
}
for (const id of ["engine", "pdf-engine", "settings"])
  $(id).onclick = openSettings;
$("appearance").onclick = () =>
  modal("外観と読みやすさ", (c) => mountAppearance(c, { notify }));
function localModelChoice(c, langs) {
  const size = langs.source === "en" ? "約150 MB" : "約240 MB";
  c.append(
    element(
      "p",
      "この言語のモデルが未取得の場合、Hugging Faceから" +
        size +
        "をダウンロードします。取得済みならキャッシュを使います。原文の翻訳は端末内で行います。",
      "modal-copy",
    ),
  );
  const actions = element("div", undefined, "modal-actions");
  actions.append(
    button(
      "許可して翻訳",
      () => {
        enableLightweight();
        dialog.close();
        run();
      },
      "primary",
    ),
    button("別のエンジンを選ぶ", openSettings),
  );
  c.append(actions);
}
async function run() {
  if (activeJob) {
    activeJob.abort();
    return;
  }
  if (pdfBusy) {
    notify("PDFの翻訳が終わると文章を翻訳できます。");
    return;
  }
  if (!input.value.trim()) return;
  const langs = getLanguages();
  if (langs.source === langs.target) {
    notify("異なる言語を選んでください。");
    return;
  }
  const lightweightPair =
      [langs.source, langs.target].sort().join(":") === "en:ja",
    engineState = getEngineState();
  if (
    lightweightPair &&
    engineState.engine === "wasm" &&
    !engineState.wasmConsent
  ) {
    modal("端末内で翻訳する", (c) => localModelChoice(c, langs));
    return;
  }
  if (input.value.length > 4e6) {
    notify("文章を400万字以内に分けてください。");
    return;
  }
  const controller = new AbortController(),
    engine = engineLabel();
  const { next, resume } = prepareTextJob(
    originalText,
    langs.source,
    engineState.engine,
    label === engine ? segments : [],
  );
  if (
    !resume &&
    segments.some((s) => s.edited) &&
    !confirm("手で修正した訳文も含めて翻訳し直しますか？")
  )
    return;
  if (next.length > 20000) {
    notify("文章が長いため、いくつかに分けて翻訳してください。");
    return;
  }
  activeJob = controller;
  controls();
  let touched = false;
  try {
    for (let i = 0; i < next.length; i++) {
      const seg = next[i];
      if (resume && seg.target) continue;
      $("match-info").textContent = "翻訳中… " + (i + 1) + " / " + next.length;
      const translated = await translateTextUnit(
        seg,
        { ...langs, signal: controller.signal },
        engineState.engine,
        translate,
      );
      if (controller.signal.aborted) break;
      if (!translated?.trim())
        throw Error("翻訳エンジンから空の応答が届きました。");
      readyDirections.add(directionKey(langs));
      seg.target = translated.trim();
      segments = next;
      label = engine;
      editMode = false;
      markDirty();
      if (!touched) {
        draw();
        touched = true;
      } else {
        const target = $("translation").querySelector('[data-i="' + i + '"]');
        if (target) target.textContent = seg.target;
      }
    }
  } catch (e) {
    if (!controller.signal.aborted) {
      activeJob = null;
      draw();
      modal("翻訳を続けるには", (c) => {
        const p = element(
          "p",
          e.message || "接続を確認してください。",
          "modal-copy",
        );
        c.append(p);
        if (lightweightPair && engineState.engine === "browser") {
          localModelChoice(c, langs);
          return;
        }
        const actions = element("div", undefined, "modal-actions");
        actions.append(button("翻訳エンジン設定", openSettings, "primary"));
        c.append(actions);
      });
    }
  } finally {
    activeJob = null;
    draw();
    if (controller.signal.aborted)
      notify(
        touched || resume
          ? "中止しました。翻訳済みの文は残っています。"
          : "翻訳を中止しました。",
      );
  }
}
$("run").onclick = run;
$("panels").addEventListener("pointerup", (e) => {
  const s = e.target.closest(".segment");
  if (s) selectedSentence = Number(s.dataset.i);
});
$("revise").onclick = () =>
  modal("訳文を修正", (c) => {
    const select = element("select");
    select.setAttribute("aria-label", "修正する文");
    segments.forEach((s, i) => {
      if (s.target)
        select.add(
          new Option(i + 1 + " · " + s.source.slice(0, 60), String(i)),
        );
    });
    if (segments[selectedSentence]?.target)
      select.value = String(selectedSentence);
    const source = element("p", undefined, "revision-source");
    const target = element("textarea");
    target.rows = 5;
    target.setAttribute("aria-label", "修正後の訳文");
    const update = () => {
      const s = segments[Number(select.value)];
      source.textContent = s.source;
      target.value = s.target;
    };
    select.onchange = update;
    update();
    const editor = element("div", undefined, "revision-editor");
    editor.append(select, source, target);
    const ok = button(
      "修正を反映",
      () => {
        const text = target.value.trim();
        if (!text) {
          target.focus();
          return;
        }
        const index = Number(select.value),
          s = segments[index];
        if (s.target !== text) {
          s.target = text;
          s.links = [];
          s.edited = true;
          selectedSentence = index;
          markDirty();
          draw();
        }
        dialog.close();
        notify("訳文に反映しました。「対訳を保存」でこの端末に残せます。");
      },
      "primary",
    );
    editor.append(ok);
    c.append(editor);
  });
$("copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("translation").textContent);
    notify("訳文をコピーしました。");
  } catch {
    notify("ブラウザーのコピー許可を確認してください。");
  }
};
async function save() {
  if (!input.value.trim()) return;
  try {
    const record = {
      ...doc(),
      saved: Date.now(),
      id: currentId || crypto.randomUUID(),
    };
    await shelf("put", record);
    currentId = record.id;
    dirty = false;
    notify("この端末に対訳を保存しました。");
  } catch {
    notify("端末に保存できません。対訳ファイルを書き出します。");
    exportDoc(doc());
  }
}
$("save").onclick = save;
async function openLibrary() {
  if (activeJob) return;
  const c = element("div");
  modal("保存した対訳", (root) => root.append(c));
  const actions = element("div", undefined, "modal-actions");
  actions.append(
    button("ファイルを読み込む", () => $("import-file").click()),
    button("現在の対訳を書き出す", () => exportDoc(doc())),
  );
  actions.lastChild.disabled = !input.value.trim();
  try {
    const docs = (await shelf()).sort((a, b) => b.saved - a.saved);
    if (!docs.length)
      c.append(
        element(
          "p",
          "「対訳を保存」を押すと、このブラウザーで続きから読めます。別の端末へ移すにはファイルに書き出してください。",
          "library-empty",
        ),
      );
    const ul = element("ul", undefined, "library-list");
    for (const d of docs) {
      const li = element("li"),
        open = button(
          "",
          () => {
            if (!canReplace()) return;
            applyDoc(validateDocument(d), d.id);
            showView("text");
            dialog.close();
          },
          "library-item",
        );
      open.append(
        element("strong", d.title),
        element(
          "small",
          languages[d.from] +
            " → " +
            languages[d.to] +
            " · " +
            new Date(d.saved).toLocaleDateString("ja-JP"),
        ),
      );
      const out = button("書出", () => exportDoc(validateDocument(d)), "mini");
      out.setAttribute("aria-label", d.title + "を書き出す");
      const del = button(
        "削除",
        async () => {
          if (!confirm("この端末から「" + d.title + "」を削除しますか？"))
            return;
          try {
            await shelf("delete", d.id);
            if (currentId === d.id) {
              currentId = null;
              dirty = true;
            }
            openLibrary();
          } catch {
            notify("削除できませんでした。");
          }
        },
        "mini",
      );
      li.append(open, out, del);
      ul.append(li);
    }
    c.append(ul);
  } catch {
    c.append(
      element(
        "p",
        "端末の保存領域を利用できません。ファイルで保存・読み込みできます。",
      ),
    );
  }
  c.append(actions);
}
$("library").onclick = openLibrary;
$("import-file").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f || !canReplace()) return;
  try {
    if (f.size > 32e6)
      throw Error("対訳ファイルは32 MB以内で読み込んでください。");
    const data = validateDocument(JSON.parse(await f.text()));
    applyDoc(data);
    dirty = true;
    showView("text");
    dialog.close();
    notify("対訳ファイルを開きました。");
  } catch (err) {
    notify(err.message);
  }
};
async function showView(mode) {
  mode = mode === "pdf" ? "pdf" : "text";
  $("text-area").hidden = mode !== "text";
  $("pdf-area").hidden = mode !== "pdf";
  for (const b of document.querySelectorAll("[data-view]"))
    b.dataset.view === mode
      ? b.setAttribute("aria-current", "page")
      : b.removeAttribute("aria-current");
  const name = mode === "pdf" ? "PDFリーダー" : "文章翻訳";
  $("view-title").textContent = name;
  document.title = "translationhub · " + name;
  if (location.hash !== "#" + mode) history.replaceState(null, "", "#" + mode);
  if (mode === "pdf" && !pdf) {
    try {
      loadingPdf ??= import("./pdf.js");
      const { mountPdf } = await loadingPdf;
      pdf ??= mountPdf($("pdf-mount"), {
        translate: (text, options) => {
          if (activeJob) throw Error("文章翻訳の完了後に試してください。");
          return translate(text, options);
        },
        notify,
        getLanguages: getPdfLanguages,
        onBusyChange: (isBusy) => {
          pdfBusy = isBusy;
          controls();
        },
        setLanguages: ({ source, target }) => {
          if (Object.hasOwn(languages, source)) $("pdf-from").value = source;
          if (Object.hasOwn(languages, target)) $("pdf-to").value = target;
        },
        openSettings,
      });
    } catch (e) {
      loadingPdf = null;
      $("pdf-mount").textContent =
        "PDFリーダーの読み込みに失敗しました。 " + e.message;
    }
  }
}
for (const b of document.querySelectorAll("[data-view]"))
  b.onclick = () => showView(b.dataset.view);
window.addEventListener("hashchange", () => showView(location.hash.slice(1)));
for (const id of ["pdf-from", "pdf-to"])
  $(id).addEventListener("change", () => pdf?.refresh());
$("about").onclick = () =>
  modal("プライバシーとソースコード", (c) => {
    const box = element("div", undefined, "modal-copy");
    for (const t of [
      "原文・訳文・APIキーをtranslationhubの運営サーバーへ送信する機能はありません。「対訳を保存」は、このブラウザーの保存領域にだけ書き込みます。",
      "クラウド翻訳を選ぶと、翻訳対象の文章が指定したサービスへ送られます。ローカルモデルの初回取得時には配布元へ接続します。サイトの配信元とモデル配布元は、接続時にIPアドレス等の通信情報を扱います。",
      "本体はMITライセンスです。ソースコードとローカル起動版を公開しています。同梱ライブラリと外部モデルには各配布元の条件が適用されます。",
    ])
      box.append(element("p", t));
    const a = element("a", "ソースコード・ローカル版の入手");
    a.href = "https://github.com/yuuu343/translationhub";
    a.target = "_blank";
    a.rel = "noreferrer";
    box.append(element("br"), a);
    c.append(box);
  });
document.addEventListener("keydown", (e) => {
  if (dialog.open || !$("pdf-area").hidden) return;
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    run();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (!activeJob) save();
  }
});
window.addEventListener("beforeunload", (e) => {
  if (
    (dirty && input.value.trim()) ||
    activeJob ||
    pdfBusy ||
    pdf?.hasUnsavedChanges?.()
  ) {
    e.preventDefault();
    e.returnValue = "";
  }
});
updateLangOptions();
icons();
initAppearance().catch(() => {});
subscribeEngineStatus((state) => {
  if (activeJob && /取得中|準備しています/.test(state.status))
    $("match-info").textContent = state.status;
});
if (fundingPage) {
  try {
    const url = new URL(fundingPage);
    if (url.protocol === "https:" && !url.username && !url.password) {
      const a = element("a", "開発を支援");
      a.href = url.href;
      a.target = "_blank";
      a.rel = "noreferrer";
      $("about").before(a);
    }
  } catch {
    /* Incomplete local configuration does not enable a payment link. */
  }
}
try {
  layout =
    localStorage.getItem("translationhub-layout") ||
    (innerWidth <= 520 ? "stack" : "side");
} catch {}
setLayout(layout === "stack" ? "stack" : "side", false);
initTextSizing();
draw();
showView(location.hash.slice(1));
