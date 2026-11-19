/* TranslationHub PDF workspace. All document storage is local and opt-in.
 * PDF.js (Apache-2.0) is vendored under ./vendor; no CDN or automatic model calls.
 */
const ASSET = new URL("./vendor/", import.meta.url);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const median = (a) =>
  a.length ? [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)] : 12;
const normalize = (s) => s.replace(/[\t ]+/g, " ").trim();
const mathChars = /[∑∫∂√≠≤≥≈∞∇∏∈∉⊂⊆∀∃±×÷αβγδθλμσφψω]/g;
function formulaLike(text, font = "") {
  const letters = (text.match(/[A-Za-z\u3040-\u30ff\u3400-\u9fff]/g) || [])
    .length;
  const symbols = (text.match(mathChars) || []).length;
  return (
    !letters ||
    (/math|symbol|cmsy|cmmi|cmex/i.test(font) && letters < 15) ||
    (symbols > 1 && symbols / Math.max(1, letters) > 0.12) ||
    /^[\d\s.,:;()\[\]+−=\-/%]+$/.test(text) ||
    (/^[A-Za-z]\s*[=≃≈]/.test(text) && letters < 35)
  );
}

/** Geometric paragraph grouping. Wide gaps remain separate cells/columns.
 * This deliberately leaves formula-like text untouched instead of guessing.
 */
export function groupTextItems(items) {
  const usable = items.filter((i) => i.text.trim() && i.w > 0 && i.h > 0);
  const lines = [];
  // Baselines are stable across serif/italic/bold runs. Sorting by glyph top
  // would place a mid-sentence italic word before text to its left.
  for (const item of [...usable].sort((a, b) =>
    Math.abs(a.baseline - b.baseline) < Math.max(a.h, b.h) * 0.23
      ? a.x - b.x
      : a.baseline - b.baseline,
  )) {
    const line = lines.find(
      (l) =>
        Math.abs(l.baseline - item.baseline) < Math.max(2, item.h * 0.23) &&
        item.x >= l.x - 2 &&
        item.x - (l.x + l.w) < Math.max(12, item.h * 1.9),
    );
    if (line) {
      const gap = item.x - (line.x + line.w);
      line.text +=
        (gap > item.h * 0.12 && !/[\s-]$/.test(line.text) ? " " : "") +
        item.text;
      line.items.push(item);
      line.w = Math.max(line.x + line.w, item.x + item.w) - line.x;
      const bottom = Math.max(line.y + line.h, item.y + item.h);
      line.y = Math.min(line.y, item.y);
      line.h = bottom - line.y;
    } else lines.push({ ...item, items: [item] });
  }
  const blocks = [];
  for (const line of lines.sort((a, b) => a.y - b.y || a.x - b.x)) {
    line.text = normalize(line.text);
    line.protected = formulaLike(
      line.text,
      line.items.map((x) => x.font).join(" "),
    );
    const previous = [...blocks]
      .reverse()
      .find(
        (b) =>
          !b.protected &&
          !line.protected &&
          Math.abs(b.x - line.x) < Math.max(8, line.h * 0.65) &&
          line.y - b.bottom > -line.h * 0.15 &&
          line.y - b.bottom < line.h * 0.8 &&
          Math.abs(b.size - line.h) < line.h * 0.25 &&
          b.text.length < 1350 &&
          b.lastWidth > Math.max(80, b.w * 0.63) &&
          line.w > 50 &&
          !/^([•●▪]|\d+[.)]\s)/.test(line.text),
      );
    if (previous) {
      previous.text = /[A-Za-z]-$/.test(previous.text)
        ? previous.text.slice(0, -1) + line.text
        : previous.text + " " + line.text;
      previous.items.push(...line.items);
      previous.lines.push(line);
      previous.w = Math.max(previous.w, line.x + line.w - previous.x);
      previous.bottom = Math.max(previous.bottom, line.y + line.h);
      previous.h = previous.bottom - previous.y;
      previous.lastWidth = line.w;
    } else
      blocks.push({
        id: blocks.length,
        text: line.text,
        x: line.x,
        y: line.y,
        w: line.w,
        h: line.h,
        bottom: line.y + line.h,
        size: line.h,
        lastWidth: line.w,
        items: [...line.items],
        lines: [line],
        protected: line.protected,
      });
  }
  return blocks.map((b, i) => ({ ...b, id: i, text: normalize(b.text) }));
}

/** Reading order for common two-column papers, leaving full-width headings first. */
export function readingOrder(blocks, width) {
  const left = blocks.filter(
    (b) => b.x < width * 0.25 && b.w > width * 0.25 && b.x + b.w < width * 0.58,
  );
  const right = blocks.filter((b) => b.x > width * 0.43 && b.w > width * 0.25);
  if (!left.length || !right.length)
    return [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
  const top = Math.min(...left.map((b) => b.y), ...right.map((b) => b.y));
  const headers = blocks
    .filter((b) => b.y < top - 2)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const rest = blocks.filter((b) => b.y >= top - 2),
    result = [...headers];
  const spanning = rest
    .filter((b) => b.x < width * 0.3 && b.x + b.w > width * 0.73)
    .sort((a, b) => a.y - b.y);
  let floor = top - 2;
  for (const separator of [...spanning, { y: Infinity, bottom: Infinity }]) {
    const band = rest.filter(
      (b) => b.y >= floor && b.y < separator.y && !spanning.includes(b),
    );
    for (const side of [0, 1])
      result.push(
        ...band
          .filter((b) => (b.x + b.w / 2 < width * 0.51 ? 0 : 1) === side)
          .sort((a, b) => a.y - b.y || a.x - b.x),
      );
    if (Number.isFinite(separator.y)) result.push(separator);
    floor = separator.y + 0.01;
  }
  return result;
}

export function parsePageRange(value, total, current = 1) {
  if (value === "current") return [current];
  if (value === "all") return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set();
  for (const part of value.split(",")) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw new Error("ページは「1-3, 5」のように指定してください。");
    const first = Number(m[1]),
      last = Number(m[2] || m[1]);
    if (first < 1 || last > total || first > last)
      throw new Error(`1〜${total}ページの範囲を指定してください。`);
    for (let p = first; p <= last; p++) set.add(p);
  }
  if (!set.size) throw new Error("翻訳するページを指定してください。");
  return [...set].sort((a, b) => a - b);
}

export function validateProject(data) {
  if (
    data?.format !== "translationhub-pdf" ||
    data.version !== 1 ||
    typeof data.pdf !== "string" ||
    !data.pdf.length
  )
    throw new Error("TranslationHubのPDF作業ファイルではありません。");
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(data.pdf))
    throw new Error("保存ファイルのPDFデータを読み取れません。");
  if (
    !data.translations ||
    typeof data.translations !== "object" ||
    Array.isArray(data.translations)
  )
    throw new Error("保存ファイルの翻訳データを読み取れません。");
  for (const [key, value] of Object.entries(data.translations)) {
    if (
      !/^\d+\|\d+\|[^|]{0,30}\|[^|]{1,30}$/.test(key) ||
      typeof value !== "string" ||
      value.length > 200000
    )
      throw new Error("保存ファイルの翻訳データが正しくありません。");
  }
  return data;
}

function toBase64(bytes) {
  let result = "";
  for (let i = 0; i < bytes.length; i += 24576)
    result += btoa(String.fromCharCode(...bytes.subarray(i, i + 24576)));
  return result;
}
function fromBase64(s) {
  const raw = atob(s);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function element(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function mountPdf(container, options = {}) {
  container.classList.add("th-pdf");
  const state = {
    doc: null,
    bytes: null,
    name: "",
    page: 1,
    pages: new Map(),
    translations: {},
    mode: "split",
    busy: false,
    dirty: false,
    render: 0,
    job: null,
    destroyed: false,
    font: 15,
    printUrls: [],
  };
  const langs = () => {
    const v = options.getLanguages?.() || {};
    return {
      source: v.source || v.from || "en",
      target: v.target || v.to || "ja",
    };
  };
  const key = (p, b, l = langs()) => `${p}|${b.id}|${l.source}|${l.target}`;
  const translated = (p, b) => state.translations[key(p, b)];
  const notice = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle("is-error", error);
    options.notify?.(message, error ? "error" : "info");
  };
  container.innerHTML = `
    <div class="pdf-topline"><span class="pdf-local-badge"><span></span>ファイルはこの端末で処理</span></div>
    <input class="pdf-file-input" type="file" accept="application/pdf,.pdf,.thpdf,.json" aria-label="PDFまたはPDF作業ファイルを開く" hidden>
    <div class="pdf-empty"><div class="pdf-file-icon" aria-hidden="true">▤</div><h3>PDFをここにドロップ</h3><p>図表と数式を原文で確認しながら翻訳できます。</p><button class="pdf-primary" data-action="open">PDFを選ぶ</button><span class="pdf-empty-note">.pdf / 保存した .thpdf</span><div class="pdf-privacy-note">開くだけでは外部に送信しません。<br>翻訳するときだけ、選択した接続先へ本文テキストを送ります。</div></div>
    <div class="pdf-workspace" hidden>
      <div class="pdf-document-bar"><div class="pdf-document-name"><span aria-hidden="true">▤</span><strong></strong><small></small></div><div class="pdf-document-actions"><button data-action="open">別のPDF</button><button data-action="save">作業を保存</button><details class="pdf-export-menu"><summary>書き出し <span aria-hidden="true">⌄</span></summary><div><button data-action="print-options">図表つきPDF / 印刷</button><button data-action="markdown">対訳テキスト (.md)</button><button data-action="html">読むためのHTML</button><button data-action="original">元のPDF</button></div></details></div></div>
      <section class="pdf-print-options" hidden aria-label="図表つきPDFの保存設定"><div class="pdf-print-heading"><strong>図表つきPDF / 印刷</strong><button data-action="print-close" aria-label="印刷設定を閉じる">×</button></div><p>翻訳済みの内容から、オフラインで使える印刷ページを作ります。追加の翻訳は行いません。</p><div class="pdf-print-fields"><label>ページ<input class="pdf-print-range" placeholder="1-3, 5" aria-label="印刷するページ範囲"></label><label>ページの順序<select class="pdf-print-order"><option value="dual">原文 → 訳文の順</option><option value="translated">訳文のみ</option></select></label><label>解像度<select class="pdf-print-quality"><option value="2">標準（144 dpi）</option><option value="3">高精細（216 dpi）</option></select></label><button class="pdf-primary" data-action="print-build">印刷ページを作成</button></div><p class="pdf-print-help">一度に20ページまで。未翻訳の箇所は原文を保持します。作成後、ブラウザの「印刷」から「PDFに保存」を選んでください。</p></section>
      <div class="pdf-controls"><div class="pdf-navigation"><button data-action="prev" aria-label="前のページ">←</button><label><input class="pdf-page-number" type="number" min="1" value="1" aria-label="ページ番号"><span class="pdf-page-total"></span></label><button data-action="next" aria-label="次のページ">→</button></div><div class="pdf-views" role="group" aria-label="表示形式"><button data-mode="split" aria-pressed="true">原文と並べる</button><button data-mode="layout" aria-pressed="false">翻訳ページ</button><button data-mode="read" aria-pressed="false">読みやすく</button></div><label class="pdf-font-label">文字 <input class="pdf-font" type="range" min="13" max="24" value="15" aria-label="読みやすい表示の文字サイズ"></label></div>
      <div class="pdf-translation-controls"><div><select class="pdf-scope" aria-label="翻訳するページ"><option value="current">このページ</option><option value="all">すべてのページ</option><option value="range">ページを指定</option></select><input class="pdf-range" placeholder="1-3, 5" aria-label="翻訳ページの範囲" hidden><button class="pdf-primary" data-action="translate">翻訳する</button><button data-action="stop" hidden>中止</button><label class="pdf-retranslate-label"><input class="pdf-retranslate" type="checkbox">訳済みも更新</label></div><span class="pdf-engine-note">接続先は上の翻訳設定を使用 <button data-action="settings">接続設定</button></span></div>
      <div class="pdf-status" role="status" aria-live="polite"></div><div class="pdf-progress" hidden><div></div></div>
      <div class="pdf-canvas-area"><section class="pdf-pane pdf-original-pane"><div class="pdf-pane-label">原文</div><div class="pdf-page-host pdf-original-host"></div></section><section class="pdf-pane pdf-translated-pane"><div class="pdf-pane-label">訳文 <span class="pdf-translation-label"></span></div><div class="pdf-page-host pdf-translated-host"></div></section></div>
      <div class="pdf-layout-note"><span>●</span><p>原本の図・数式をそのまま表示。対応箇所は文・段落単位で連動します。翻訳ページで文字が小さい場合は「読みやすく」へ。画像だけのPDFや複雑な組版は、ローカル文書ツールでも確認できます。</p><details><summary>ローカル文書ツール ↗</summary><p>EasyReadを起動してから開いてください。「このPDFを渡す」は、この端末のEasyReadの文献庫にPDFを保存します。翻訳は自動で開始せず、EasyRead側でモデルと処理を選べます。</p><label>EasyReadのローカルURL<input class="pdf-easyread-url" value="http://127.0.0.1:8765" type="url" aria-label="EasyReadのローカルURL"></label><button data-action="easyread">EasyReadを開く ↗</button> <button data-action="easyread-import" hidden>このPDFをEasyReadに渡す ↗</button><p class="pdf-local-import-note" hidden>直接渡す機能はローカル版と127.0.0.1:8765の組み合わせで使えます。</p></details></div>
    </div>`;
  const $ = (s) => container.querySelector(s),
    $$ = (s) => [...container.querySelectorAll(s)];
  const status = $(".pdf-status"),
    workspace = $(".pdf-workspace"),
    empty = $(".pdf-empty"),
    input = $(".pdf-file-input");
  const sourceHost = $(".pdf-original-host"),
    targetHost = $(".pdf-translated-host");
  if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
    $('[data-action="easyread-import"]').hidden = false;
    $(".pdf-local-import-note").hidden = false;
  }
  let libraryPromise;
  async function library() {
    libraryPromise ||= import("./vendor/pdf.mjs").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL("pdf.worker.mjs", ASSET).href;
      return lib;
    });
    return libraryPromise;
  }
  function updateControls() {
    const total = state.doc?.numPages || 0;
    $(".pdf-page-total").textContent = `/ ${total}`;
    $(".pdf-page-number").value = state.page;
    $(".pdf-page-number").max = total;
    $('[data-action="prev"]').disabled = state.page <= 1;
    $('[data-action="next"]').disabled = state.page >= total;
    $('[data-action="translate"]').disabled = state.busy;
    $('[data-action="stop"]').hidden = !state.busy;
    $('[data-action="print-build"]').disabled = state.busy;
    $(".pdf-scope").disabled = state.busy;
    $(".pdf-range").disabled = state.busy;
    $(".pdf-retranslate").disabled = state.busy;
    $$(".pdf-views button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)),
    );
    $(".pdf-canvas-area").dataset.mode = state.mode;
    $(".pdf-font-label").hidden = state.mode !== "read";
  }
  async function pageData(number) {
    if (state.pages.has(number)) return state.pages.get(number);
    const page = await state.doc.getPage(number),
      viewport = page.getViewport({ scale: 1 }),
      content = await page.getTextContent();
    const lib = await library();
    const items = content.items
      .filter((i) => "str" in i && i.str.trim())
      .map((i) => {
        const t = lib.Util.transform(viewport.transform, i.transform),
          style = content.styles[i.fontName] || {};
        const height = Math.hypot(t[2], t[3]) || i.height || 10,
          ascent = style.ascent ?? (style.descent ? 1 + style.descent : 0.8);
        return {
          text: i.str,
          x: t[4],
          y: t[5] - height * ascent,
          w: i.width,
          h: height,
          baseline: t[5],
          font: i.fontName,
          dir: i.dir,
          rotated: Math.abs(t[1]) > Math.abs(t[0]) * 0.1,
          hasEOL: i.hasEOL,
        };
      });
    const blocks = groupTextItems(items.filter((i) => !i.rotated));
    const data = { page, viewport, blocks, items };
    state.pages.set(number, data);
    return data;
  }
  function frame(viewport) {
    const f = element("div", "pdf-page-frame");
    f.style.aspectRatio = `${viewport.width}/${viewport.height}`;
    f.style.setProperty("--pdf-width", viewport.width);
    f.style.setProperty("--pdf-height", viewport.height);
    return f;
  }
  async function renderBase(data, host, withSelection = false) {
    const f = frame(data.viewport),
      canvas = element("canvas", "pdf-page-canvas");
    f.append(canvas);
    host.replaceChildren(f);
    const width = Math.max(420, Math.min(1300, host.clientWidth || 660)),
      scale =
        (width / data.viewport.width) * Math.min(devicePixelRatio || 1, 1.65);
    const vp = data.page.getViewport({ scale });
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    await data.page.render({
      canvasContext: canvas.getContext("2d"),
      viewport: vp,
    }).promise;
    if (withSelection) {
      const layer = element("div", "pdf-source-text");
      f.append(layer);
      for (const b of data.blocks)
        for (const item of b.items) {
          const span = element("span", "pdf-source-span", item.text);
          span.dataset.pdfBlock = b.id;
          span.dataset.pdfPage = state.page;
          position(span, item, data.viewport);
          span.style.fontSize = `${(item.h / data.viewport.width) * 100}cqw`;
          span.style.lineHeight = "1";
          span.style.fontFamily = "sans-serif";
          layer.append(span);
          const range = document.createRange();
          range.selectNodeContents(span);
          const natural = range.getBoundingClientRect().width;
          if (natural > 0) {
            span.style.width = "auto";
            span.style.transform = `scaleX(${((item.w / data.viewport.width) * f.clientWidth) / natural})`;
          }
        }
    }
    return { f, canvas };
  }
  function position(el, rect, vp) {
    el.style.left = (rect.x / vp.width) * 100 + "%";
    el.style.top = (rect.y / vp.height) * 100 + "%";
    el.style.width = (rect.w / vp.width) * 100 + "%";
    el.style.height = (rect.h / vp.height) * 100 + "%";
  }
  function fitOverlay(el, block, vp) {
    const width = el.parentElement.clientWidth / vp.width,
      limit = Math.max(7, block.size * 0.98) * width;
    let px = limit;
    el.style.fontSize = px + "px";
    while (
      px > 6.5 * width &&
      (el.scrollHeight > el.clientHeight + 1 ||
        el.scrollWidth > el.clientWidth + 1)
    ) {
      px -= 0.4 * width;
      el.style.fontSize = px + "px";
    }
    if (el.scrollHeight > el.clientHeight + 1 || px < 8 * width)
      el.classList.add("pdf-tight-text");
  }
  function drawTranslation(data, base) {
    const { f, canvas } = base,
      vp = data.viewport,
      ctx = canvas.getContext("2d"),
      sx = canvas.width / vp.width,
      sy = canvas.height / vp.height;
    let count = 0;
    for (const b of readingOrder(data.blocks, data.viewport.width)) {
      const text = translated(state.page, b);
      if (!text) continue;
      count++;
      // Cover each text run rather than a broad paragraph rectangle. Pictures,
      // rules, whitespace and protected mathematical blocks retain the source.
      for (const item of b.items) {
        const x = item.x * sx,
          y = item.y * sy,
          w = item.w * sx,
          h = item.h * sy;
        let color = "#fff";
        try {
          const c = ctx.getImageData(
            clamp(Math.floor(x), 0, canvas.width - 1),
            clamp(Math.floor(y - 3), 0, canvas.height - 1),
            1,
            1,
          ).data;
          if (c[0] + c[1] + c[2] > 480) color = `rgb(${c[0]},${c[1]},${c[2]})`;
        } catch {}
        ctx.fillStyle = color;
        ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      }
      const el = element("div", "pdf-translation-block", text);
      el.dataset.pdfBlock = b.id;
      el.dataset.pdfPage = state.page;
      position(el, b, vp);
      el.title = "クリックして、この段落を読みやすい表示で確認";
      f.append(el);
      fitOverlay(el, b, vp);
    }
    if (!count) {
      const badge = element(
        "div",
        "pdf-not-translated",
        "このページはまだ翻訳されていません",
      );
      f.append(badge);
    }
    $(".pdf-translation-label").textContent = count
      ? `${count}段落 · ${langs().target.toUpperCase()}`
      : "";
  }
  function readView(data) {
    const article = element("article", "pdf-reading-page");
    article.style.fontSize = state.font + "px";
    const valid = data.blocks.filter((b) => !b.protected);
    if (!valid.length)
      article.append(
        element(
          "p",
          "pdf-reading-empty",
          "選択できる本文が見つかりません。原文を表示するか、ローカルのOCR対応ツールをご利用ください。",
        ),
      );
    for (const b of readingOrder(data.blocks, data.viewport.width)) {
      const section = element("section", "pdf-reading-block");
      section.dataset.pdfBlock = b.id;
      section.dataset.pdfPage = state.page;
      const text = translated(state.page, b);
      if (b.protected) {
        const p = element("p", "pdf-preserved", b.text);
        p.title = "数式・数値は原文を保持";
        section.append(p);
      } else {
        section.append(
          element(
            "p",
            text ? "pdf-reading-translation" : "pdf-reading-pending",
            text || b.text,
          ),
        );
        if (text) {
          const d = element("details", "pdf-reading-source");
          d.append(element("summary", "", "原文を確認"));
          d.append(element("p", "", b.text));
          section.append(d);
        }
      }
      article.append(section);
    }
    targetHost.replaceChildren(article);
    $(".pdf-translation-label").textContent = langs().target.toUpperCase();
  }
  function refreshTranslation(data) {
    if (state.mode === "read") {
      readView(data);
      return;
    }
    const sourceCanvas = sourceHost.querySelector("canvas");
    if (!sourceCanvas) return;
    const f = frame(data.viewport),
      canvas = element("canvas", "pdf-page-canvas");
    canvas.width = sourceCanvas.width;
    canvas.height = sourceCanvas.height;
    canvas.getContext("2d").drawImage(sourceCanvas, 0, 0);
    f.append(canvas);
    targetHost.replaceChildren(f);
    drawTranslation(data, { f, canvas });
  }
  async function renderPage() {
    if (!state.doc || state.destroyed) return;
    const ticket = ++state.render;
    updateControls();
    try {
      const data = await pageData(state.page);
      if (ticket !== state.render) return;
      await renderBase(data, sourceHost, true);
      if (ticket !== state.render) return;
      refreshTranslation(data);
      if (!state.busy) {
        const eligible = data.blocks.filter((b) => !b.protected).length,
          done = data.blocks.filter((b) => translated(state.page, b)).length;
        status.classList.remove("is-error");
        status.textContent = eligible
          ? `${state.page}ページ · ${done}/${eligible}段落を翻訳済み`
          : "このページには抽出できる本文がありません。画像PDFはOCRが必要です。";
      }
    } catch (error) {
      if (ticket === state.render)
        notice(`PDFを表示できませんでした。${error.message}`, true);
    }
  }
  async function openFile(file) {
    if (!file) return;
    if (state.busy)
      throw new Error("翻訳を中止してから、別のファイルを開いてください。");
    const savedFile = /\.(thpdf|json)$/i.test(file.name);
    if (file.size > (savedFile ? 220 : 150) * 1024 * 1024)
      throw new Error("PDFは150MB、保存した作業ファイルは220MBまで開けます。");
    let bytes,
      project = null;
    if (/\.(thpdf|json)$/i.test(file.name)) {
      project = validateProject(JSON.parse(await file.text()));
      bytes = fromBase64(project.pdf);
    } else bytes = new Uint8Array(await file.arrayBuffer());
    if (new TextDecoder().decode(bytes.subarray(0, 1024)).indexOf("%PDF-") < 0)
      throw new Error(
        "PDFファイルまたは保存したPDF作業ファイルを選んでください。",
      );
    const lib = await library();
    const loading = lib.getDocument({
      data: bytes.slice(),
      cMapUrl: new URL("pdf-cmaps/", ASSET).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("pdf-standard_fonts/", ASSET).href,
      wasmUrl: new URL("pdf-wasm/", ASSET).href,
      isEvalSupported: false,
      enableXfa: false,
      stopEventPropagation: true,
    });
    const doc = await loading.promise;
    if (
      state.dirty &&
      !window.confirm(
        "翻訳結果がまだ保存されていません。保存せずに別のPDFを開きますか？",
      )
    ) {
      await doc.destroy();
      return false;
    }
    const old = state.doc;
    state.doc = doc;
    state.bytes = bytes;
    state.name = project?.name || file.name;
    state.pages.clear();
    state.translations = project?.translations || {};
    state.dirty = false;
    state.page = clamp(Number(project?.page) || 1, 1, doc.numPages);
    state.mode = ["split", "layout", "read"].includes(project?.mode)
      ? project.mode
      : "split";
    if (project?.languages) options.setLanguages?.(project.languages);
    if (old) await old.destroy();
    empty.hidden = true;
    workspace.hidden = false;
    $(".pdf-document-name strong").textContent = state.name;
    $(".pdf-document-name strong").title = state.name;
    $(".pdf-document-name small").textContent = `${doc.numPages}ページ`;
    await renderPage();
    if (project?.languages && !options.setLanguages)
      notice(
        `作業を開きました。保存時の言語は ${project.languages.source} → ${project.languages.target} です。`,
      );
    options.onDocumentChange?.({ name: state.name, pages: doc.numPages });
  }
  async function startTranslation() {
    if (state.busy || !state.doc) return;
    if (typeof options.translate !== "function") {
      options.openSettings?.();
      return notice("翻訳の接続先を設定してください。", true);
    }
    const range =
      $(".pdf-scope").value === "range"
        ? $(".pdf-range").value
        : $(".pdf-scope").value;
    let pages;
    try {
      pages = parsePageRange(range, state.doc.numPages, state.page);
    } catch (e) {
      return notice(e.message, true);
    }
    const language = langs(),
      overwrite = $(".pdf-retranslate").checked,
      controller = new AbortController();
    state.job = controller;
    state.busy = true;
    options.onBusyChange?.(true);
    updateControls();
    $(".pdf-progress").hidden = false;
    let completed = 0,
      failed = 0,
      done = 0,
      eligible = 0;
    const tasks = [];
    try {
      for (const p of pages) {
        if (controller.signal.aborted) break;
        const data = await pageData(p);
        for (const b of data.blocks)
          if (!b.protected) {
            eligible++;
            if (overwrite || !state.translations[key(p, b, language)])
              tasks.push({ p, b });
          }
      }
      if (!tasks.length) {
        notice(
          eligible
            ? "この範囲の翻訳は完了しています。"
            : "翻訳できる本文を抽出できませんでした。画像だけのページにはOCRが必要です。",
          !eligible,
        );
        return;
      }
      for (const { p, b } of tasks) {
        if (controller.signal.aborted) break;
        status.textContent = `${p}ページを翻訳中 · ${done + 1}/${tasks.length}段落`;
        try {
          const result = await options.translate(b.text, {
            ...language,
            signal: controller.signal,
            context: "pdf",
          });
          if (controller.signal.aborted) break;
          if (typeof result !== "string" || !result.trim())
            throw new Error("空の翻訳が返されました。");
          state.translations[key(p, b, language)] = result.trim();
          state.dirty = true;
          completed++;
        } catch (e) {
          if (controller.signal.aborted) break;
          failed++;
          status.textContent = `翻訳エラー: ${e.message}`;
          // Stop on provider failures rather than repeatedly consuming a key or quota.
          notice(
            `翻訳を停止しました。${e.message} 完了した段落は保持しています。`,
            true,
          );
          break;
        }
        done++;
        $(".pdf-progress > div").style.width =
          `${(done / tasks.length) * 100}%`;
        if (p === state.page) refreshTranslation(await pageData(p));
      }
      if (!failed)
        notice(
          controller.signal.aborted
            ? `翻訳を中止しました。${completed}段落の結果を保持しています。`
            : `${completed}段落の翻訳が完了しました。`,
        );
    } catch (e) {
      if (!controller.signal.aborted) notice(e.message, true);
    } finally {
      state.busy = false;
      state.job = null;
      options.onBusyChange?.(false);
      $(".pdf-progress").hidden = true;
      updateControls();
    }
  }
  async function serialize() {
    if (!state.bytes) throw new Error("PDFを先に開いてください。");
    return {
      format: "translationhub-pdf",
      version: 1,
      name: state.name,
      pdf: toBase64(state.bytes),
      translations: { ...state.translations },
      languages: langs(),
      page: state.page,
      mode: state.mode,
      savedAt: new Date().toISOString(),
    };
  }
  async function exportText(html = false) {
    const language = langs(),
      title = state.name.replace(/\.pdf$/i, "");
    let content = html
      ? `<!doctype html><html lang="${escapeHtml(language.target)}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><style>body{max-width:980px;margin:50px auto;padding:0 24px;color:#252c2a;font:17px/1.85 system-ui,sans-serif}h1{font-size:26px}h2{margin-top:3em;border-bottom:1px solid #ddd}.pair{display:grid;grid-template-columns:1fr 1fr;gap:28px;border-bottom:1px solid #eee;padding:16px 0;break-inside:avoid}.source{color:#68706c}p{white-space:pre-wrap;margin:0}.note{font-size:13px;color:#68706c}@media(max-width:650px){.pair{grid-template-columns:1fr}}@media print{body{margin:0}}</style><h1>${escapeHtml(title)}</h1><p class="note">TranslationHub · ${escapeHtml(language.source)} → ${escapeHtml(language.target)} · ${new Date().toISOString().slice(0, 10)}<br>テキストの対訳です。図表・数式の正確な配置は元のPDFで確認してください。</p>`
      : `# ${title}\n\n${language.source} → ${language.target}\n\n`;
    for (let p = 1; p <= state.doc.numPages; p++) {
      const data = await pageData(p);
      content += html ? `<h2>${p}ページ</h2>` : `## ${p}ページ\n\n`;
      for (const b of readingOrder(data.blocks, data.viewport.width)) {
        const t =
          state.translations[key(p, b, language)] ||
          (b.protected ? b.text : "［未翻訳］");
        content += html
          ? `<section class="pair"><p class="source">${escapeHtml(b.text)}</p><p>${escapeHtml(t)}</p></section>`
          : `${b.text}\n\n${t}\n\n---\n\n`;
      }
    }
    if (html) content += "</html>";
    download(
      `${title}-対訳.${html ? "html" : "md"}`,
      content,
      html ? "text/html;charset=utf-8" : "text/markdown;charset=utf-8",
    );
    notice(
      "対訳をこの端末に書き出しました。図表を含む原本と翻訳結果は「作業を保存」で一緒に保存できます。",
    );
  }
  function printTextStyle(block, text, measure) {
    const h = block.h;
    measure.style.width = block.w + "pt";
    measure.style.height = h + "pt";
    measure.textContent = text;
    let size = Math.max(7, block.size * 0.98);
    measure.style.fontSize = size + "pt";
    while (
      size > 2 &&
      (measure.scrollHeight > measure.clientHeight + 1 ||
        measure.scrollWidth > measure.clientWidth + 1)
    ) {
      size = Math.max(2, size - 0.25);
      measure.style.fontSize = size + "pt";
    }
    return {
      size,
      h,
      overflow:
        measure.scrollHeight > measure.clientHeight + 1 ||
        measure.scrollWidth > measure.clientWidth + 1,
    };
  }
  function maskPrintText(canvas, block, vp) {
    const ctx = canvas.getContext("2d"),
      sx = canvas.width / vp.width,
      sy = canvas.height / vp.height;
    for (const item of block.items) {
      const x = item.x * sx,
        y = item.y * sy,
        w = item.w * sx,
        h = item.h * sy;
      let color = "#fff";
      try {
        const c = ctx.getImageData(
          clamp(Math.floor(x), 0, canvas.width - 1),
          clamp(Math.floor(y - 3), 0, canvas.height - 1),
          1,
          1,
        ).data;
        if (c[0] + c[1] + c[2] > 480) color = `rgb(${c[0]},${c[1]},${c[2]})`;
      } catch {}
      ctx.fillStyle = color;
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    }
  }
  async function buildPrintable() {
    if (state.busy || !state.doc) return;
    const pages = parsePageRange(
      $(".pdf-print-range").value,
      state.doc.numPages,
      state.page,
    );
    if (pages.length > 20)
      throw new Error(
        "印刷は一度に20ページまでです。長い文書は範囲を分けてください。",
      );
    const dual = $(".pdf-print-order").value === "dual",
      scale = Number($(".pdf-print-quality").value) || 2,
      language = langs();
    const controller = new AbortController();
    state.job = controller;
    state.busy = true;
    options.onBusyChange?.(true);
    updateControls();
    // Open synchronously from the click. A blocked popup still leaves a download link.
    const popup = window.open("", "_blank");
    if (popup) {
      popup.document.title = "印刷ページを準備中";
      popup.document.body.textContent =
        "この端末で印刷ページを作成しています。この画面は閉じずにお待ちください。";
      popup.opener = null;
    }
    const measure = element("div", "pdf-print-measure");
    document.body.append(measure);
    const parts = [],
      pageStyles = [],
      appendix = [];
    let pixels = 0,
      missing = 0,
      done = 0,
      count = 0;
    try {
      // Preflight pixel budget before allocating a single large canvas.
      for (const p of pages) {
        const data = await pageData(p);
        pixels +=
          data.viewport.width *
          data.viewport.height *
          scale *
          scale *
          (dual ? 2 : 1);
      }
      if (pixels > 64000000)
        throw new Error(
          "この範囲は画像サイズが大きいため、ページ数を減らすか標準解像度を選んでください。",
        );
      $(".pdf-progress").hidden = false;
      for (const p of pages) {
        if (controller.signal.aborted)
          throw new DOMException(
            "印刷ページの作成を中止しました。",
            "AbortError",
          );
        const data = await pageData(p),
          vp = data.viewport,
          canvas = document.createElement("canvas"),
          renderVp = data.page.getViewport({ scale });
        if (renderVp.width > 16000 || renderVp.height > 16000)
          throw new Error(
            "このPDFの用紙サイズは印刷用画像の上限を超えています。",
          );
        canvas.width = Math.ceil(renderVp.width);
        canvas.height = Math.ceil(renderVp.height);
        status.textContent = `印刷ページを作成中 · ${done + 1}/${pages.length}ページ`;
        const renderTask = data.page.render({
          canvasContext: canvas.getContext("2d"),
          viewport: renderVp,
        });
        const cancel = () => renderTask.cancel();
        controller.signal.addEventListener("abort", cancel, { once: true });
        try {
          await renderTask.promise;
        } finally {
          controller.signal.removeEventListener("abort", cancel);
        }
        pageStyles.push(
          `@page pdf${p}{size:${vp.width}pt ${vp.height}pt;margin:0}`,
        );
        const sheet = (image, overlays, kind) =>
          `<section class="sheet" data-source-page="${p}" data-kind="${kind}" style="page:pdf${p};width:${vp.width}pt;height:${vp.height}pt"><img alt="${p}ページ・${kind === "original" ? "原文" : "訳文"}" src="${image}">${overlays}</section>`;
        const originalSpans = (blocks) =>
          blocks
            .flatMap((b) => b.items)
            .map(
              (i) =>
                `<span class="original-text" style="left:${i.x}pt;top:${i.y}pt;width:${i.w}pt;height:${i.h}pt;font-size:${i.h}pt">${escapeHtml(i.text)}</span>`,
            )
            .join("");
        if (dual) {
          parts.push(
            sheet(
              canvas.toDataURL("image/png"),
              originalSpans(data.blocks),
              "original",
            ),
          );
          count++;
        }
        let overlays = "";
        for (const b of data.blocks) {
          const text = state.translations[key(p, b, language)];
          if (!text) {
            if (!b.protected) missing++;
            overlays += originalSpans([b]);
            continue;
          }
          maskPrintText(canvas, b, vp);
          const fitted = printTextStyle(b, text, measure);
          if (fitted.overflow) appendix.push({ p, source: b.text, text });
          overlays += `<div class="translation" style="left:${b.x}pt;top:${b.y}pt;width:${b.w}pt;height:${fitted.h}pt;font-size:${fitted.size}pt">${escapeHtml(text)}</div>`;
        }
        parts.push(
          sheet(canvas.toDataURL("image/png"), overlays, "translated"),
        );
        count++;
        canvas.width = canvas.height = 1;
        done++;
        $(".pdf-progress > div").style.width =
          `${(done / pages.length) * 100}%`;
        // Yield between pages, keeping Cancel responsive; render buffers are reused one page at a time.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (controller.signal.aborted)
        throw new DOMException(
          "印刷ページの作成を中止しました。",
          "AbortError",
        );
      const title =
        state.name.replace(/\.pdf$/i, "") +
        (dual ? " — 原文と訳文" : " — 訳文");
      const html = `<!doctype html><html lang="${escapeHtml(language.target)}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)}</title><style>html,body{margin:0;padding:0}body{background:#e9ede6;color:#22362c;font:14px/1.8 system-ui,sans-serif}.instructions{max-width:900px;margin:20px auto;padding:16px 22px;background:white;border-radius:8px}.instructions h1{font-size:18px;margin:0 0 8px}.instructions p{margin:4px 0}.sheet{position:relative;margin:20px auto;background:#fff;overflow:hidden;break-after:page;box-shadow:0 2px 10px #0001}.sheet:last-child{break-after:auto}.sheet>img{position:absolute;inset:0;width:100%;height:100%}.original-text{position:absolute;white-space:pre;line-height:1;color:rgba(0,0,0,.001);font-family:serif;overflow:visible}.translation{position:absolute;box-sizing:border-box;white-space:pre-wrap;overflow:hidden;overflow-wrap:anywhere;line-height:1.14;color:#1e2923;font-family:"Yu Gothic",YuGothic,"Noto Sans CJK JP",system-ui,sans-serif}.appendix{page:annex;background:white;max-width:650px;margin:30px auto;padding:35px;font:11pt/1.65 system-ui,sans-serif}.appendix section{break-inside:avoid;margin-bottom:18px;white-space:pre-wrap}.appendix h2{font-size:16pt}@page annex{size:A4;margin:18mm}${pageStyles.join("")}@media print{body{background:white}.instructions{display:none}.sheet{margin:0;box-shadow:none}.appendix{margin:0;padding:0;max-width:none}}</style><div class="instructions"><h1>${escapeHtml(title)}</h1><p>${count}ページを準備しました。<strong>Ctrl+P（Macでは⌘P）</strong>から、送信先を「PDFに保存」にしてください。</p><p>余白なし・ヘッダーとフッターなし・倍率100%で、元の用紙比率を保てます。このHTMLは保存後もオフラインで印刷できます。</p><p>翻訳済みのテキストは選択・検索できます。原文の図表・数式は${scale * 72}dpiの画像として保持しています。${missing ? ` 未翻訳の${missing}段落は原文のままです。` : ""}${appendix.length ? ` 枠に収まらない${appendix.length}段落は末尾の補足にも全文を載せています。` : ""}</p></div>${parts.join("")}${appendix.length ? `<article class="appendix"><h2>枠に収まらなかった訳文</h2>${appendix.map((a) => `<section><strong>${a.p}ページ</strong><p>${escapeHtml(a.text)}</p><details><summary>原文</summary>${escapeHtml(a.source)}</details></section>`).join("")}</article>` : ""}</html>`;
      const blob = new Blob([html], { type: "text/html;charset=utf-8" }),
        url = URL.createObjectURL(blob);
      state.printUrls.push(url);
      if (popup && !popup.closed) popup.location.href = url;
      notice(
        `${count}ページの印刷用データを作成しました。開いた画面で「印刷 → PDFに保存」を選んでください。`,
      );
      const open = element("a", "pdf-easyread-result", "印刷ページを開く");
      open.href = url;
      open.target = "_blank";
      open.rel = "noopener";
      const save = element("a", "pdf-easyread-result", "印刷用HTMLを保存");
      save.href = url;
      save.download =
        state.name.replace(/\.pdf$/i, "") +
        (dual ? "-原文と訳文" : "-訳文") +
        "-印刷.html";
      status.append(" ", open, " / ", save);
      return { url, pages: count, missing, appendix: appendix.length };
    } catch (e) {
      if (popup && !popup.closed) popup.close();
      notice(
        controller.signal.aborted
          ? "印刷ページの作成を中止しました。"
          : `印刷ページを作成できませんでした。${e.message}`,
        !controller.signal.aborted,
      );
    } finally {
      measure.remove();
      state.busy = false;
      state.job = null;
      options.onBusyChange?.(false);
      $(".pdf-progress").hidden = true;
      updateControls();
    }
  }
  async function action(name) {
    try {
      if (name === "open") input.click();
      else if (name === "prev" || name === "next") {
        state.page = clamp(
          state.page + (name === "next" ? 1 : -1),
          1,
          state.doc.numPages,
        );
        await renderPage();
      } else if (name === "translate") await startTranslation();
      else if (name === "stop") state.job?.abort();
      else if (name === "save") {
        download(
          state.name.replace(/\.pdf$/i, "") + ".thpdf",
          JSON.stringify(await serialize()),
          "application/json",
        );
        state.dirty = false;
        notice(
          "原本と翻訳をこの端末に保存しました。APIキーは保存ファイルに含まれません。",
        );
      } else if (name === "original")
        download(state.name, state.bytes, "application/pdf");
      else if (name === "markdown" || name === "html")
        await exportText(name === "html");
      else if (name === "print-options") {
        const scope = $(".pdf-scope").value;
        $(".pdf-print-range").value =
          scope === "range"
            ? $(".pdf-range").value
            : scope === "all"
              ? `1-${state.doc.numPages}`
              : String(state.page);
        $(".pdf-print-options").hidden = false;
        $(".pdf-export-menu").open = false;
        $(".pdf-print-range").focus();
      } else if (name === "print-close") $(".pdf-print-options").hidden = true;
      else if (name === "print-build") await buildPrintable();
      else if (name === "settings") options.openSettings?.();
      else if (name === "easyread") {
        const url = new URL($(".pdf-easyread-url").value);
        if (
          !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
          !["http:", "https:"].includes(url.protocol)
        )
          throw new Error("この欄にはlocalhostのURLを指定してください。");
        window.open(url.href, "_blank", "noopener,noreferrer");
      } else if (name === "easyread-import") {
        const button = $('[data-action="easyread-import"]');
        button.disabled = true;
        try {
          if (!state.bytes) throw new Error("PDFを先に開いてください。");
          const session = await fetch("/api/session", { cache: "no-store" });
          if (!session.ok)
            throw new Error("ローカル起動版からこの操作を行ってください。");
          const { token } = await session.json();
          if (!token) throw new Error("ローカル接続を確認できませんでした。");
          const response = await fetch(
            "/api/easyread/import?name=" + encodeURIComponent(state.name),
            {
              method: "POST",
              headers: {
                "Content-Type": "application/pdf",
                "X-TranslationHub-Token": token,
              },
              body: state.bytes,
            },
          );
          const result = await response.json();
          if (!response.ok)
            throw new Error(
              result.error || "EasyReadへの受け渡しに失敗しました。",
            );
          const url = new URL(result.url);
          if (
            url.origin !== "http://127.0.0.1:8765" ||
            !/^\/read\/[a-zA-Z0-9_-]+$/.test(url.pathname)
          )
            throw new Error("EasyReadの応答URLを確認できませんでした。");
          notice(
            "この端末のEasyReadに保存しました。翻訳はEasyRead側で開始してください。",
          );
          const link = element(
            "a",
            "pdf-easyread-result",
            "EasyReadでこのPDFを開く ↗",
          );
          link.href = url.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          status.append(" ", link);
          window.open(url.href, "_blank", "noopener,noreferrer");
        } finally {
          button.disabled = false;
        }
      }
    } catch (e) {
      if (workspace.hidden) {
        empty.querySelector(".pdf-privacy-note").textContent = e.message;
        options.notify?.(e.message, "error");
      } else notice(e.message, true);
    }
  }
  const click = (e) => {
    const a = e.target.closest("[data-action]");
    if (a) {
      action(a.dataset.action);
      return;
    }
    const m = e.target.closest("[data-mode]");
    if (m) {
      state.mode = m.dataset.mode;
      renderPage();
      return;
    }
    const b = e.target.closest(".pdf-translation-block");
    if (b) {
      state.mode = "read";
      renderPage().then(() =>
        targetHost
          .querySelector(`[data-pdf-block="${b.dataset.pdfBlock}"]`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" }),
      );
    }
  };
  container.addEventListener("click", click);
  input.addEventListener("change", () => {
    openFile(input.files[0]).catch((e) => {
      empty.querySelector(".pdf-privacy-note").textContent = e.message;
      notice(e.message, true);
    });
    input.value = "";
  });
  $(".pdf-page-number").addEventListener("change", (e) => {
    state.page = clamp(Number(e.target.value) || 1, 1, state.doc.numPages);
    renderPage();
  });
  $(".pdf-scope").addEventListener("change", (e) => {
    $(".pdf-range").hidden = e.target.value !== "range";
  });
  $(".pdf-font").addEventListener("input", (e) => {
    state.font = Number(e.target.value);
    const article = targetHost.querySelector("article");
    if (article) article.style.fontSize = state.font + "px";
  });
  container.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types.includes("Files")) {
      e.preventDefault();
      container.classList.add("pdf-dragging");
    }
  });
  container.addEventListener("dragleave", (e) => {
    if (!container.contains(e.relatedTarget))
      container.classList.remove("pdf-dragging");
  });
  container.addEventListener("drop", (e) => {
    e.preventDefault();
    container.classList.remove("pdf-dragging");
    openFile(e.dataTransfer.files[0]).catch((e) => {
      empty.querySelector(".pdf-privacy-note").textContent = e.message;
      notice(e.message, true);
    });
  });
  function highlight(id) {
    $$("[data-pdf-block]").forEach((n) =>
      n.classList.toggle("pdf-linked", n.dataset.pdfBlock === id),
    );
  }
  container.addEventListener("mouseover", (e) => {
    const block = e.target.closest("[data-pdf-block]");
    if (block) highlight(block.dataset.pdfBlock);
  });
  container.addEventListener("mouseleave", () => {
    if (window.getSelection()?.isCollapsed) highlight(null);
  });
  const selection = () => {
    const s = window.getSelection();
    if (!s || s.isCollapsed) return;
    const n = s.anchorNode?.parentElement?.closest("[data-pdf-block]");
    if (n && container.contains(n)) highlight(n.dataset.pdfBlock);
  };
  document.addEventListener("selectionchange", selection);
  let resizeTimer,
    lastWidth = 0;
  const observer = new ResizeObserver((entries) => {
    const width = Math.round(entries[0].contentRect.width);
    if (width === lastWidth) return;
    lastWidth = width;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.doc && !state.busy) renderPage();
    }, 180);
  });
  observer.observe(container);
  updateControls();
  return {
    openFile,
    serialize,
    refresh: renderPage,
    hasUnsavedChanges: () => state.dirty,
    destroy() {
      state.destroyed = true;
      state.job?.abort();
      state.render++;
      observer.disconnect();
      clearTimeout(resizeTimer);
      state.printUrls.forEach((u) => URL.revokeObjectURL(u));
      document.removeEventListener("selectionchange", selection);
      state.doc?.destroy();
      container.replaceChildren();
    },
  };
}
