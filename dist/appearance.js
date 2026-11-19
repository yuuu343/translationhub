/* Device-only visual preferences. No network requests or third-party resources. */
const STORAGE_KEY = "translationhub.appearance.v1";
const PHOTO_DB = "translationhub-appearance";
const DEFAULTS = Object.freeze({
  scene: "alpenglow",
  opacity: 100,
  font: "sans",
  fontSize: 18,
  lineHeight: 1.95,
});
const sceneURL = (name) =>
  new URL(`./assets/${name}.svg`, import.meta.url).href;
export const SCENES = Object.freeze([
  {
    id: "alpenglow",
    name: "夕映えの稜線",
    subtitle: "雪山を染める最後の光",
    image: new URL("./assets/alpenglow.webp", import.meta.url).href,
    base: "#eef1f7",
    accent: "#385ed1",
    position: "center 51%",
  },
  {
    id: "blue-hour",
    name: "青の時間",
    subtitle: "海と、暮れていく空",
    image: sceneURL("blue-hour"),
    base: "#e9edf6",
    accent: "#385ed1",
  },
  {
    id: "mountain-morning",
    name: "山の朝",
    subtitle: "光がほどける稜線",
    image: sceneURL("mountain-morning"),
    base: "#eef0f2",
    accent: "#36658a",
  },
  {
    id: "forest-stillness",
    name: "森の静けさ",
    subtitle: "湖畔の、深い呼吸",
    image: sceneURL("forest-stillness"),
    base: "#e8efec",
    accent: "#2b726b",
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
    font: READING_FONTS.some((font) => font.id === value.font)
      ? value.font
      : DEFAULTS.font,
    fontSize: Math.round(clamp(value.fontSize, 16, 28, DEFAULTS.fontSize)),
    lineHeight:
      Math.round(clamp(value.lineHeight, 1.5, 2.5, DEFAULTS.lineHeight) * 100) /
      100,
  };
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
  const root = document.documentElement;
  const scene =
    SCENES.find((item) => item.id === preferences.scene) || SCENES[0];
  const image =
    preferences.scene === "none"
      ? null
      : preferences.scene === "custom"
        ? customPhotoURL
        : scene.image;
  root.style.setProperty("--scene-image", image ? `url("${image}")` : "none");
  root.style.setProperty("--scene-opacity", String(preferences.opacity / 100));
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
}

function emitChange() {
  const detail = getAppearance();
  subscribers.forEach((callback) => callback(detail));
  globalThis.dispatchEvent(
    new CustomEvent("translationhub:appearance", { detail }),
  );
}

export function getAppearance() {
  return { ...preferences, hasCustomPhoto: Boolean(customPhotoURL) };
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
  container.classList.add("appearance-panel");
  container.innerHTML = `
    <header class="appearance-intro"><span class="appearance-eyebrow">YOUR READING SPACE</span><h2>心地よく、読む。</h2><p>景色と文字を、あなたの好みに。</p></header>
    <fieldset class="appearance-section"><legend>窓の向こうの景色</legend><div class="appearance-scenes">
      ${SCENES.map((scene) => `<button type="button" class="appearance-scene" data-scene="${scene.id}" aria-pressed="false"><span class="appearance-scene-image" style="background-image:url('${scene.image}')"><span class="appearance-scene-check" aria-hidden="true">✓</span></span><span class="appearance-scene-name">${scene.name}</span><span class="appearance-scene-description">${scene.subtitle}</span></button>`).join("")}
    </div><div class="appearance-photo-actions"><button type="button" class="appearance-photo-button" data-upload><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.3"/><path d="m3 17 5-5 4 4 4-6 5 7"/></svg>好きな写真を選ぶ</button><input data-photo-file type="file" accept="image/jpeg,image/png,image/webp,image/avif" hidden><button class="appearance-text-button" type="button" data-use-custom hidden>自分の写真にする</button><button class="appearance-text-button" type="button" data-remove-custom hidden>写真を削除</button><button class="appearance-text-button" type="button" data-no-scene>背景なし</button></div><p class="appearance-help">選んだ写真はこの端末にだけ保存されます。</p></fieldset>
    <section class="appearance-section appearance-slider-group"><label for="${id}-opacity"><span>背景の濃さ</span><output data-opacity-value></output></label><input id="${id}-opacity" type="range" min="0" max="100" step="1" data-setting="opacity"><div class="appearance-range-captions"><span>ほのかに</span><span>鮮やかに</span></div></section>
    <fieldset class="appearance-section"><legend>読むときの書体</legend><div class="appearance-fonts">${READING_FONTS.map((font) => `<button type="button" data-font="${font.id}" aria-pressed="false"><span class="appearance-font-sample" style="font-family:${font.family.replaceAll('"', "&quot;")}">あ Aa</span><span>${font.name}</span></button>`).join("")}</div></fieldset>
    <div class="appearance-type-sliders"><section class="appearance-slider-group"><label for="${id}-size"><span>文字サイズ</span><output data-size-value></output></label><input id="${id}-size" type="range" min="16" max="28" step="1" data-setting="fontSize"></section><section class="appearance-slider-group"><label for="${id}-leading"><span>行のゆとり</span><output data-leading-value></output></label><input id="${id}-leading" type="range" min="1.5" max="2.5" step="0.05" data-setting="lineHeight"></section></div>
    <div class="appearance-reading-preview"><span class="appearance-preview-label">READING PREVIEW</span><p>言葉の向こうに、<br>まだ知らない世界がある。</p><p lang="en">A quiet space for a new perspective.</p></div>
    <footer class="appearance-footer"><p>設定は、このブラウザーに保存されます。</p><button type="button" class="appearance-text-button" data-reset>初期設定に戻す</button></footer><p class="appearance-feedback" role="status" aria-live="polite" data-feedback></p>`;

  const feedback = (message) => {
    container.querySelector("[data-feedback]").textContent = message;
    notify(message);
  };
  const update = (state) => {
    container
      .querySelectorAll("[data-scene]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.scene === state.scene),
        ),
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
    container.querySelector("[data-size-value]").textContent =
      `${state.fontSize}px`;
    container.querySelector("[data-leading-value]").textContent =
      state.lineHeight.toFixed(2);
    container.querySelector("[data-use-custom]").hidden =
      !state.hasCustomPhoto || state.scene === "custom";
    container.querySelector("[data-remove-custom]").hidden =
      !state.hasCustomPhoto;
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
    .querySelectorAll("[data-scene]")
    .forEach((button) =>
      listen(button, "click", () => change({ scene: button.dataset.scene })),
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
  listen(container.querySelector("[data-use-custom]"), "click", () =>
    change({ scene: "custom" }),
  );
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
  initAppearance().then(update);
  return {
    update: () => update(getAppearance()),
    destroy() {
      abort.abort();
      subscribers.delete(update);
    },
  };
}
