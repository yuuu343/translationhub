import { modelText, segmentText } from "./documents.js";

// Offsets refer to UTF-16 positions in the original text nodes.
function sentenceRanges(text, language) {
  let offset = 0;
  return segmentText(text, language, { granularity: "sentence" }).map((s) => {
    const start = offset + s.gap.length;
    offset = start + s.source.length;
    return [start, offset];
  });
}
function clean(text) {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "")
    .trim();
}
function exactOccurrence(text, phrase) {
  const needle = phrase.trim().replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "");
  if (!needle) return null;
  const hay = text.toLowerCase(),
    word = needle.toLowerCase(),
    i = hay.indexOf(word);
  if (i < 0 || hay.indexOf(word, i + 1) >= 0) return null;
  const end = i + needle.length;
  if (
    (/[a-z]$/i.test(hay.slice(0, i)) && /^[a-z]/i.test(word)) ||
    (/[a-z]$/i.test(word) && /^[a-z]/i.test(hay.slice(end)))
  )
    return null;
  return [i, end];
}
export function installAlignment({
  sourcePane,
  targetPane,
  getDoc,
  canSuggest,
  translate,
  setHint,
  markDirty,
  notify,
}) {
  let tick = 0,
    timer,
    pending = null,
    manual = null,
    current = null;
  function clearPaint() {
    globalThis.CSS?.highlights?.delete("pair");
    for (const el of document.querySelectorAll(".segment.matched"))
      el.classList.remove("matched");
  }
  function reset() {
    tick++;
    clearTimeout(timer);
    clearPaint();
    manual = null;
    current = null;
    pending = null;
  }
  function paint(node, start, end) {
    if (node?.firstChild?.nodeType !== Node.TEXT_NODE) return;
    const range = document.createRange();
    range.setStart(node.firstChild, start);
    range.setEnd(node.firstChild, end);
    if (globalThis.CSS?.highlights && globalThis.Highlight)
      CSS.highlights.set("pair", new Highlight(range));
    else node.classList.add("matched");
  }
  function selectionInfo() {
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0),
      start = range.startContainer.parentElement?.closest(".segment"),
      end = range.endContainer.parentElement?.closest(".segment");
    if (!start || !end || start.parentElement !== end.parentElement)
      return null;
    const side =
      start.parentElement === sourcePane
        ? "source"
        : start.parentElement === targetPane
          ? "target"
          : null;
    if (!side) return null;
    return {
      side,
      id: Number(start.dataset.i),
      endId: Number(end.dataset.i),
      a: range.startOffset,
      b: range.endOffset,
      text: sel.toString(),
    };
  }
  function update() {
    const version = ++tick;
    clearTimeout(timer);
    clearPaint();
    current = selectionInfo();
    if (manual) {
      setHint(
        "反対側の対応する語句を選び、「この範囲で確定」を押してください。",
        "confirm",
      );
      return;
    }
    if (!current) {
      setHint("");
      return;
    }
    const { side, id, endId, a, b, text } = current,
      doc = getDoc(),
      seg = doc.segments[id];
    if (!seg) return;
    const other = side === "source" ? "target" : "source",
      pane = other === "source" ? sourcePane : targetPane,
      element = pane.querySelector('[data-i="' + id + '"]');
    if (!element || !seg[other]) return;
    if (id !== endId) {
      for (let i = id; i <= endId; i++)
        pane.querySelector('[data-i="' + i + '"]')?.classList.add("matched");
      setHint("対応する文を表示");
      return;
    }
    const offset = side === "source" ? 0 : 2,
      rev = offset === 0 ? 2 : 0;
    const link = seg.links.find((l) => l[offset] === a && l[offset + 1] === b);
    const exact = link
      ? link.slice(rev, rev + 2)
      : clean(text) === clean(seg[side])
        ? exactOccurrence(seg[other], seg[other])
        : exactOccurrence(seg[other], text);
    if (exact) {
      paint(element, ...exact);
      setHint("対応する語句を表示");
      return;
    }
    const direction = {
      source: side === "source" ? doc.from : doc.to,
      target: side === "source" ? doc.to : doc.from,
    };
    let hint = "対応する文を表示";
    let estimated;
    if (seg.kind === "paragraph") {
      const from = sentenceRanges(seg[side], direction.source);
      if (from.length > 1) {
        hint = "対応する段落を表示";
        const index = from.findIndex(([start, end]) => start <= a && b <= end);
        const to = sentenceRanges(seg[other], direction.target);
        if (index >= 0 && from.length === to.length) {
          estimated = to[index];
          hint = "文の順序から推定した対応箇所";
        }
      }
    }
    if (estimated) paint(element, ...estimated);
    else element.classList.add("matched");
    setHint(hint, "pair");
    if (
      !canSuggest(direction) ||
      text.trim().length < 2 ||
      text.trim().length > 180 ||
      pending
    )
      return;
    timer = setTimeout(async () => {
      if (tick !== version) return;
      const job = {};
      pending = job;
      try {
        const result = await translate(
          modelText({ source: text, kind: seg.kind }, direction.source),
          direction,
        );
        if (tick !== version || manual) return;
        const hit = exactOccurrence(seg[other], result);
        if (hit) {
          clearPaint();
          paint(element, ...hit);
          setHint("推定した対応語句を表示", "pair");
        }
      } catch {
        /* Leave the sentence highlighted when a phrase cannot be aligned. */
      } finally {
        if (pending === job) pending = null;
      }
    }, 450);
  }
  function linkSelection() {
    if (!manual) {
      if (!current || current.id !== current.endId) return;
      manual = { ...current };
      setHint("反対側の対応する語句を選んでください。", "confirm");
      return;
    }
    if (
      !current ||
      current.id !== manual.id ||
      current.endId !== current.id ||
      current.side === manual.side
    ) {
      notify("同じ対訳文の反対側から、対応する語句を選んでください。");
      return;
    }
    const doc = getDoc(),
      s = manual.side === "source" ? manual : current,
      t = manual.side === "target" ? manual : current;
    const seg = doc.segments[s.id];
    seg.links = seg.links.filter(
      (l) => !(l[0] === s.a && l[1] === s.b) && !(l[2] === t.a && l[3] === t.b),
    );
    seg.links.push([s.a, s.b, t.a, t.b]);
    manual = null;
    markDirty();
    update();
    notify("語句の対応を設定しました。対訳と一緒に保存できます。");
  }
  document.addEventListener("selectionchange", update);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && manual) {
      manual = null;
      update();
    }
  });
  return { reset, linkSelection };
}
