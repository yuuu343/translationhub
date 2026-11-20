/* Device-only visual preferences. No network requests or third-party resources. */
const STORAGE_KEY = "translationhub.appearance.v1";
const PHOTO_DB = "translationhub-appearance";
const DEFAULTS = Object.freeze({
  scene: "sakura",
  opacity: 100,
  readingTransparency: 12,
  motion: "auto",
  font: "sans",
  fontSize: 18,
  lineHeight: 1.95,
});
const sceneURL = (name) =>
  new URL(`./assets/${name}.svg`, import.meta.url).href;
export const SCENES = Object.freeze([
  {
    id: "sakura",
    name: "花霞",
    image: new URL("./assets/atmosphere/sakura-preview.webp", import.meta.url).href,
    base: "#f7edf2",
    accent: "#8d4f79",
    position: "center",
  },
  {
    id: "flight",
    name: "燕の空",
    image: new URL("./assets/atmosphere/flight-preview.webp", import.meta.url).href,
    base: "#edf3f9",
    accent: "#3b668c",
    position: "center",
  },
  {
    id: "sunlit",
    name: "陽だまり",
    image: new URL("./assets/atmosphere/sunlit-preview.webp", import.meta.url).href,
    base: "#f6f2e9",
    accent: "#8a6c3f",
    position: "center",
  },
  {
    id: "alpenglow",
    name: "夕映えの稜線",
    subtitle: "雪山を染める最後の光",
    image: new URL("./assets/alpenglow.webp", import.meta.url).href,
    base: "#eef1f7",
    accent: "#385ed1",
    position: "center 51%",
    legacy: true,
  },
  {
    id: "blue-hour",
    name: "青の時間",
    subtitle: "海と、暮れていく空",
    image: sceneURL("blue-hour"),
    base: "#e9edf6",
    accent: "#385ed1",
    legacy: true,
  },
  {
    id: "mountain-morning",
    name: "山の朝",
    subtitle: "光がほどける稜線",
    image: sceneURL("mountain-morning"),
    base: "#eef0f2",
    accent: "#36658a",
    legacy: true,
  },
  {
    id: "forest-stillness",
    name: "森の静けさ",
    subtitle: "湖畔の、深い呼吸",
    image: sceneURL("forest-stillness"),
    base: "#e8efec",
    accent: "#2b726b",
    legacy: true,
  },
]);
export const READING_FONTS = Object.freeze([
  {
    id: "sans",
    name: "ゴシック",
    family:
      '"Yu Gothic UI", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Meiryo", system-ui, sans-serif',
  },
  {
    id: "serif",
    name: "明朝",
    family:
      '"Yu Mincho", "Hiragino Mincho ProN", "Noto Serif JP", "Times New Roman", serif',
  },
  {
    id: "book",
    name: "欧文セリフ",
    family:
      'Georgia, "Iowan Old Style", "Yu Mincho", "Hiragino Mincho ProN", serif',
  },
]);
let preferences = { ...DEFAULTS };
let customPhotoURL = null;
let persistedCustomPhoto = false;
let initializePromise;
let sequence = 0;
let motionQuery;
const subscribers = new Set();
const clamp = (value, low, high, fallback) =>
  Number.isFinite(Number(value))
    ? Math.min(high, Math.max(low, Number(value)))
    : fallback;

function normalize(value = {}) {
  const knownScenes = [...SCENES.map((scene) => scene.id), "custom", "none"];
  return {
    scene: knownScenes.includes(value.scene) ? value.scene : DEFAULTS.scene,
    opacity: Math.round(clamp(value.opacity, 0, 100, DEFAULTS.opacity)),
    readingTransparency: Math.round(clamp(value.readingTransparency, 0, 100, DEFAULTS.readingTransparency)),
    motion: ["auto", "on", "off"].includes(value.motion) ? value.motion : DEFAULTS.motion,
    font: READING_FONTS.some((font) => font.id === value.font)
      ? value.font
      : DEFAULTS.font,
    fontSize: Math.round(clamp(value.fontSize, 16, 28, DEFAULTS.fontSize)),
    lineHeight:
      Math.round(clamp(value.lineHeight, 1.5, 2.5, DEFAULTS.lineHeight) * 100) /
      100,
  };
}

function initializeMotion() {
  if (motionQuery || !globalThis.matchMedia) return;
  motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const changed = () => {
    if (preferences.motion !== "auto") return;
    applyPreferences();
    emitChange();
  };
  if (motionQuery.addEventListener) motionQuery.addEventListener("change", changed);
  else motionQuery.addListener(changed);
}

function motionEnabled() {
  return preferences.motion === "on" || (preferences.motion === "auto" && !motionQuery?.matches);
}

function photoDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB)
      return reject(new Error("このブラウザーでは写真を保存できません。"));
    const request = indexedDB.open(PHOTO_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("photos");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(
        new Error(
          "写真の保存を開けませんでした。ほかのタブを閉じて試してください。",
        ),
      );
  });
}

async function photoOperation(mode, action) {
  const db = await photoDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("photos", mode);
      const request = action(transaction.objectStore("photos"));
      let result;
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error || new Error("写真の保存を中止しました。"));
    });
  } finally {
    db.close();
  }
}

function applyPreferences() {
  initializeMotion();
  const root = document.documentElement;
  const scene =
    SCENES.find((item) => item.id === preferences.scene) || SCENES.find((item) => item.id === "alpenglow");
  const image =
    preferences.scene === "none"
      ? null
      : preferences.scene === "custom"
        ? customPhotoURL
        : scene.image;
  root.style.setProperty("--scene-image", image ? `url("${image}")` : "none");
  root.style.setProperty("--scene-opacity", String(preferences.opacity / 100));
  root.style.setProperty("--reading-opacity", String((100 - preferences.readingTransparency) / 100));
  root.style.setProperty("--scene-play-state", motionEnabled() ? "running" : "paused");
  root.style.setProperty("--scene-position", scene.position || "center 51%");
  root.style.setProperty("--page-base", scene.base);
  root.style.setProperty("--accent", scene.accent);
  root.style.setProperty(
    "--reading-font",
    READING_FONTS.find((font) => font.id === preferences.font).family,
  );
  root.style.setProperty("--reading-size", `${preferences.fontSize}px`);
  root.style.setProperty(
    "--reading-line-height",
    String(preferences.lineHeight),
  );
  root.dataset.scene = preferences.scene;
  root.dataset.motion = motionEnabled() ? "on" : "off";
  root.dataset.motionPreference = preferences.motion;
}

function emitChange() {
  const detail = getAppearance();
  subscribers.forEach((callback) => callback(detail));
  globalThis.dispatchEvent(
    new CustomEvent("translationhub:appearance", { detail }),
  );
}

export function getAppearance() {
  initializeMotion();
  return { ...preferences, hasCustomPhoto: Boolean(customPhotoURL), motionEnabled: motionEnabled() };
}

export function setAppearance(changes, { persist = true } = {}) {
  preferences = normalize({ ...preferences, ...changes });
  if (preferences.scene === "custom" && !customPhotoURL)
    preferences.scene = DEFAULTS.scene;
  let saved = true;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      saved = false;
    }
  }
  applyPreferences();
  emitChange();
  return { ...getAppearance(), saved };
}

export function initAppearance() {
  if (initializePromise) return initializePromise;
  try {
    preferences = normalize(
      JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"),
    );
  } catch {
    preferences = { ...DEFAULTS };
  }
  applyPreferences();
  initializePromise = (async () => {
    try {
      const savedPhoto = await photoOperation("readonly", (store) =>
        store.get("custom"),
      );
      if (savedPhoto instanceof Blob && savedPhoto.type.startsWith("image/")) {
        customPhotoURL = URL.createObjectURL(savedPhoto);
        persistedCustomPhoto = true;
      }
    } catch {
      /* Browsing and built-in scenes also work when storage is unavailable. */
    }
    if (preferences.scene === "custom" && !customPhotoURL)
      preferences.scene = DEFAULTS.scene;
    applyPreferences();
    emitChange();
    return getAppearance();
  })();
  // Built-in themes can render immediately; restoring a local photo may wait on storage.
  emitChange();
  return initializePromise;
}

async function normalizePhoto(file) {
  if (!file || !/^image\/(jpeg|png|webp|avif|gif|bmp)$/i.test(file.type)) {
    throw new Error("JPEG・PNG・WebP・AVIFの画像を選んでください。");
  }
  if (file.size > 30 * 1024 * 1024)
    throw new Error("写真は30MB以下のものを選んでください。");
  const objectURL = URL.createObjectURL(file);
  try {
    const decoded = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () =>
        reject(
          new Error("この画像を開けませんでした。別の画像を選んでください。"),
        );
      image.src = objectURL;
    });
    if (!decoded.naturalWidth || !decoded.naturalHeight)
      throw new Error("画像のサイズを読み取れませんでした。");
    const scale = Math.min(
      1,
      2560 / Math.max(decoded.naturalWidth, decoded.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(decoded.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(decoded.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("このブラウザーでは画像を処理できません。");
    context.fillStyle = "#e9edf6";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(decoded, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("画像を読み込めませんでした。")),
        "image/webp",
        0.9,
      ),
    );
  } finally {
    URL.revokeObjectURL(objectURL);
  }
}

export async function setCustomPhoto(file) {
  await initAppearance();
  const blob = await normalizePhoto(file);
  let saved = true;
  try {
    await photoOperation("readwrite", (store) => store.put(blob, "custom"));
    persistedCustomPhoto = true;
  } catch {
    saved = false;
  }
  if (customPhotoURL) URL.revokeObjectURL(customPhotoURL);
  customPhotoURL = URL.createObjectURL(blob);
  const settingResult = setAppearance({ scene: "custom" });
  return { ...settingResult, saved: saved && settingResult.saved };
}

export async function removeCustomPhoto() {
  await initAppearance();
  // Remove durable data first, so a failed operation does not claim deletion.
  if (persistedCustomPhoto)
    await photoOperation("readwrite", (store) => store.delete("custom"));
  persistedCustomPhoto = false;
  if (customPhotoURL) URL.revokeObjectURL(customPhotoURL);
  customPhotoURL = null;
  setAppearance(
    preferences.scene === "custom" ? { scene: DEFAULTS.scene } : {},
  );
  return getAppearance();
}

export function mountAppearance(
  container,
  { notify = () => {}, onChange = () => {} } = {},
) {
  if (typeof container === "string")
    container = document.querySelector(container);
  if (!container) throw new Error("外観パネルの表示先がありません。");
  const id = `appearance-${++sequence}`;
  const abort = new AbortController();
  const listen = (node, type, handler) =>
    node.addEventListener(type, handler, { signal: abort.signal });
  const sceneCard = (scene) => `<button type="button" class="appearance-scene" data-scene="${scene.id}" aria-pressed="false"><span class="appearance-scene-image" style="--card-image:url('${scene.image}');--card-base:${scene.base};--card-position:${scene.position || "center 51%"}"><span class="appearance-scene-check" aria-hidden="true">✓</span></span><span class="appearance-scene-name">${scene.name}</span></button>`;
  container.classList.add("appearance-panel");
  container.innerHTML = `
    <fieldset class="appearance-section"><legend>背景</legend><div class="appearance-scenes appearance-scenes-current">${SCENES.filter(scene => !scene.legacy).map(sceneCard).join("")}</div>
      <details class="appearance-legacy" data-legacy-scenes><summary>写真・これまでの背景</summary><div class="appearance-scenes">${SCENES.filter(scene => scene.legacy).map(sceneCard).join("")}<button type="button" class="appearance-scene" data-scene="custom" data-custom-card aria-pressed="false" hidden><span class="appearance-scene-image" data-custom-image><span class="appearance-scene-check" aria-hidden="true">✓</span></span><span class="appearance-scene-name">自分の写真</span></button></div>
      <div class="appearance-photo-actions"><button type="button" class="appearance-photo-button" data-upload><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.3"/><path d="m3 17 5-5 4 4 4-6 5 7"/></svg><span data-upload-label>写真を選ぶ</span></button><input data-photo-file type="file" accept="image/jpeg,image/png,image/webp,image/avif" hidden><button class="appearance-text-button" type="button" data-remove-custom hidden>写真を削除</button></div><p class="appearance-help">写真はこの端末にだけ保存します。</p></details>
      <button class="appearance-text-button appearance-none" type="button" data-no-scene aria-pressed="false">背景なし</button></fieldset>
    <div class="appearance-surface-sliders"><section class="appearance-slider-group"><label for="${id}-opacity"><span>背景の濃さ</span><output data-opacity-value></output></label><input id="${id}-opacity" type="range" min="0" max="100" step="1" data-setting="opacity"><div class="appearance-range-captions"><span>なし</span><span>濃く</span></div></section><section class="appearance-slider-group"><label for="${id}-transparency"><span>読書面の透明度</span><output data-transparency-value></output></label><input id="${id}-transparency" type="range" min="0" max="100" step="1" data-setting="readingTransparency"><div class="appearance-range-captions"><span>不透明</span><span>透明</span></div></section></div>
    <fieldset class="appearance-section"><legend>動き</legend><div class="appearance-motion"><button type="button" data-motion="auto" aria-pressed="false">端末に合わせる</button><button type="button" data-motion="on" aria-pressed="false">動かす</button><button type="button" data-motion="off" aria-pressed="false">止める</button></div></fieldset>
    <fieldset class="appearance-section"><legend>書体</legend><div class="appearance-fonts">${READING_FONTS.map((font) => `<button type="button" data-font="${font.id}" aria-pressed="false"><span class="appearance-font-sample" style="font-family:${font.family.replaceAll('"', "&quot;")}">あ Aa</span><span>${font.name}</span></button>`).join("")}</div></fieldset>
    <div class="appearance-type-sliders"><section class="appearance-slider-group"><label for="${id}-size"><span>文字サイズ</span><output data-size-value></output></label><input id="${id}-size" type="range" min="16" max="28" step="1" data-setting="fontSize"></section><section class="appearance-slider-group"><label for="${id}-leading"><span>行のゆとり</span><output data-leading-value></output></label><input id="${id}-leading" type="range" min="1.5" max="2.5" step="0.05" data-setting="lineHeight"></section></div>
    <div class="appearance-reading-preview" aria-label="読みやすさのプレビュー"><div class="appearance-preview-pane appearance-preview-source"><span class="appearance-preview-label">原文</span><p lang="en">A quiet moment, a clearer view.</p></div><div class="appearance-preview-pane appearance-preview-target"><span class="appearance-preview-label">訳文</span><p lang="ja">少し落ち着くと、よく見えてくる。</p></div></div>
    <footer class="appearance-footer"><span>このブラウザーに保存</span><button type="button" class="appearance-text-button" data-reset>初期設定に戻す</button></footer><p class="appearance-feedback" role="status" aria-live="polite" data-feedback></p>`;

  const feedback = (message) => {
    container.querySelector("[data-feedback]").textContent = message;
    notify(message);
  };
  let displayedScene;
  let alive = true;
  const update = (state) => {
    container
      .querySelectorAll("button[data-scene]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.scene === state.scene),
        ),
      );
    container.querySelectorAll("button[data-motion]").forEach(button =>
      button.setAttribute("aria-pressed", String(button.dataset.motion === state.motion)),
    );
    container
      .querySelectorAll("[data-font]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.font === state.font),
        ),
      );
    container.querySelectorAll("[data-setting]").forEach((input) => {
      input.value = state[input.dataset.setting];
    });
    container.querySelector("[data-opacity-value]").textContent =
      `${state.opacity}%`;
    container.querySelector("[data-transparency-value]").textContent =
      `${state.readingTransparency}%`;
    container.querySelector("[data-size-value]").textContent =
      `${state.fontSize}px`;
    container.querySelector("[data-leading-value]").textContent =
      state.lineHeight.toFixed(2);
    container.querySelector("[data-custom-card]").hidden = !state.hasCustomPhoto;
    const customImage = container.querySelector("[data-custom-image]");
    customImage.style.setProperty("--card-image", customPhotoURL ? `url("${customPhotoURL}")` : "none");
    customImage.style.setProperty("--card-base", SCENES.find(scene => scene.id === "alpenglow").base);
    container.querySelector("[data-upload-label]").textContent = state.hasCustomPhoto ? "写真を変更" : "写真を選ぶ";
    container.querySelector("[data-remove-custom]").hidden =
      !state.hasCustomPhoto;
    if (displayedScene !== state.scene && (state.scene === "custom" || SCENES.some(scene => scene.id === state.scene && scene.legacy)))
      container.querySelector("[data-legacy-scenes]").open = true;
    displayedScene = state.scene;
    container
      .querySelector("[data-no-scene]")
      .setAttribute("aria-pressed", String(state.scene === "none"));
    onChange(state);
  };
  subscribers.add(update);
  const change = (patch) => {
    const result = setAppearance(patch);
    if (!result.saved)
      feedback(
        "設定をこの端末に保存できませんでした。この画面では反映されています。",
      );
  };
  container
    .querySelectorAll("button[data-scene]")
    .forEach((button) =>
      listen(button, "click", () => change({ scene: button.dataset.scene })),
    );
  container.querySelectorAll("button[data-motion]").forEach(button =>
    listen(button, "click", () => change({ motion: button.dataset.motion })),
  );
  container
    .querySelectorAll("[data-font]")
    .forEach((button) =>
      listen(button, "click", () => change({ font: button.dataset.font })),
    );
  container
    .querySelectorAll("[data-setting]")
    .forEach((input) =>
      listen(input, "input", () =>
        change({ [input.dataset.setting]: Number(input.value) }),
      ),
    );
  const fileInput = container.querySelector("[data-photo-file]");
  const uploadButton = container.querySelector("[data-upload]");
  listen(uploadButton, "click", () => fileInput.click());
  listen(fileInput, "change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    uploadButton.disabled = true;
    uploadButton.setAttribute("aria-busy", "true");
    try {
      const result = await setCustomPhoto(file);
      feedback(
        result.saved
          ? "写真を設定しました。この端末にだけ保存されています。"
          : "写真を設定しました。保存できなかったため、この画面を閉じるまで有効です。",
      );
    } catch (error) {
      feedback(error.message || "写真を設定できませんでした。");
    } finally {
      uploadButton.disabled = false;
      uploadButton.removeAttribute("aria-busy");
      fileInput.value = "";
    }
  });
  listen(container.querySelector("[data-no-scene]"), "click", () =>
    change({ scene: "none" }),
  );
  listen(container.querySelector("[data-remove-custom]"), "click", async () => {
    try {
      await removeCustomPhoto();
      feedback("保存した写真を、この端末から削除しました。");
    } catch {
      feedback("写真を削除できませんでした。もう一度お試しください。");
    }
  });
  listen(container.querySelector("[data-reset]"), "click", () => {
    change(DEFAULTS);
    feedback("外観を初期設定に戻しました。");
  });
  update(getAppearance());
  initAppearance().then(state => { if (alive) update(state); });
  return {
    update: () => update(getAppearance()),
    destroy() {
      alive = false;
      abort.abort();
      subscribers.delete(update);
    },
  };
}
