export const languages = {
  en: "英語",
  ja: "日本語",
  zh: "中国語",
  ko: "韓国語",
  fr: "フランス語",
  de: "ドイツ語",
  es: "スペイン語",
  it: "イタリア語",
  pt: "ポルトガル語",
  ru: "ロシア語",
  ar: "アラビア語",
  hi: "ヒンディー語",
};
export function translatedGap(s, i, lang) {
  if (typeof s.targetGap === "string") return s.targetGap;
  if (!i || /[\r\n]/.test(s.gap)) return s.gap;
  return ["ja", "zh"].includes(lang) ? "" : s.gap || " ";
}
export const samples = {
  letter: [
    ["Dear shareholders,", "株主の皆様へ", [["shareholders", "株主"]]],
    [
      "This quarter, operating income rose even as revenue remained flat.",
      "今四半期は、売上高が横ばいで推移する一方、営業利益は増加しました。",
      [
        ["This quarter", "今四半期"],
        ["operating income", "営業利益"],
        ["revenue", "売上高"],
        ["remained flat", "横ばいで推移"],
      ],
    ],
    [
      "We will use the additional cash to invest in research and strengthen our balance sheet.",
      "増加した現金を研究投資と財務基盤の強化に充てます。",
      [
        ["cash", "現金"],
        ["research", "研究"],
        ["balance sheet", "財務基盤"],
      ],
    ],
  ],
  paper: [
    [
      "A smaller model can be useful when memory is limited.",
      "利用できるメモリが限られているとき、小型モデルは有用である。",
      [
        ["smaller model", "小型モデル"],
        ["memory", "メモリ"],
      ],
    ],
    [
      "We measured the time from the first input token to the first output token.",
      "最初の入力トークンから最初の出力トークンまでの時間を測定した。",
      [
        ["first input token", "最初の入力トークン"],
        ["first output token", "最初の出力トークン"],
      ],
    ],
    [
      "In our experiments, reducing the input length improved latency without changing the output format.",
      "実験では、入力長を短くすると、出力形式を変えずに遅延が改善した。",
      [
        ["input length", "入力長"],
        ["latency", "遅延"],
        ["output format", "出力形式"],
      ],
    ],
  ],
};
export function segmentText(text, language) {
  const parts = [];
  const segmenter =
    typeof Intl.Segmenter === "function"
      ? new Intl.Segmenter(language, { granularity: "sentence" })
      : null;
  let gap = "";
  for (const line of text.split(/(\r\n|\r|\n)/)) {
    if (!line.trim()) {
      gap += line;
      continue;
    }
    const spans = segmenter
      ? Array.from(segmenter.segment(line), (x) => x.segment)
      : line.match(/[^。！？.!?]+(?:[。！？.!?]+|$)|[。！？.!?]+/g) || [line];
    for (const span of spans) {
      const source = span.trim();
      if (!source) {
        gap += span;
        continue;
      }
      const start = span.indexOf(source);
      parts.push({
        gap: gap + span.slice(0, start),
        source,
        target: "",
        links: [],
      });
      gap = span.slice(start + source.length);
    }
  }
  return parts;
}
const positiveInt = (n) => Number.isSafeInteger(n) && n >= 0;
export function validateDocument(doc) {
  if (
    !doc ||
    doc.format !== "translationhub.text" ||
    doc.version !== 1 ||
    !Object.hasOwn(languages, doc.from) ||
    !Object.hasOwn(languages, doc.to) ||
    !Array.isArray(doc.segments) ||
    doc.segments.length > 20000 ||
    typeof doc.text !== "string" ||
    doc.text.length > 4e6
  )
    throw Error("translationhub形式の対訳ファイルを選んでください。");
  const segments = doc.segments.map((s) => {
    if (
      !s ||
      typeof s.source !== "string" ||
      typeof s.target !== "string" ||
      typeof s.gap !== "string" ||
      s.target.length > 4e6
    )
      throw Error("対訳データが壊れています。");
    const links = Array.isArray(s.links)
      ? s.links.filter(
          (l) =>
            Array.isArray(l) &&
            l.length === 4 &&
            l.every(positiveInt) &&
            l[0] < l[1] &&
            l[1] <= s.source.length &&
            l[2] < l[3] &&
            l[3] <= s.target.length,
        )
      : [];
    return {
      source: s.source,
      target: s.target,
      gap: s.gap,
      links,
      edited: s.edited === true,
      ...(typeof s.targetGap === "string" && /^\s*$/.test(s.targetGap)
        ? { targetGap: s.targetGap }
        : {}),
    };
  });
  if (
    segments.length &&
    segments
      .map((s) => s.gap + s.source)
      .join("")
      .trimEnd() !== doc.text.trimEnd()
  )
    throw Error("原文と対訳の対応を確認できません。");
  return {
    format: doc.format,
    version: 1,
    from: doc.from,
    to: doc.to,
    text: doc.text,
    segments,
    engine: typeof doc.engine === "string" ? doc.engine : "",
    title: String(
      doc.title || doc.text.trim().split(/\r?\n/)[0] || "無題",
    ).slice(0, 96),
  };
}
export function sampleDoc(key) {
  const segments = samples[key].map(([source, target, words], i) => ({
    source,
    target,
    gap: i === 0 ? "" : i === 1 ? "\n\n" : " ",
    links: words.map(([a, b]) => [
      source.indexOf(a),
      source.indexOf(a) + a.length,
      target.indexOf(b),
      target.indexOf(b) + b.length,
    ]),
  }));
  return {
    format: "translationhub.text",
    version: 1,
    text: segments.map((s) => s.gap + s.source).join(""),
    from: "en",
    to: "ja",
    title: key === "paper" ? "研究の要旨" : "株主への手紙",
    segments,
    engine: "収録例文",
  };
}
let dbPromise;
function database() {
  if (!dbPromise)
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open("translationhub-text", 1);
      req.onupgradeneeded = () =>
        req.result.createObjectStore("docs", { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((e) => {
      dbPromise = null;
      throw e;
    });
  return dbPromise;
}
export async function shelf(action = "getAll", value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
        "docs",
        action === "getAll" ? "readonly" : "readwrite",
      ),
      store = tx.objectStore("docs");
    const req = action === "getAll" ? store.getAll() : store[action](value);
    tx.oncomplete = () => resolve(req.result);
    tx.onabort = tx.onerror = () =>
      reject(tx.error || Error("端末内の保存領域にアクセスできません。"));
  });
}
export function exportDoc(doc) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download =
    (doc.title || "対訳").replace(/[\\/:*?"<>|]/g, "_") +
    ".translationhub.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}
