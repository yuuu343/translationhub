// Let the page scroll, while the editable source grows to fit its text.
// The live textarea is never collapsed for measurement: that would move its
// caret and make a long page jump on every keystroke.
let activeSizer = null;

export function initTextSizing({
  input = document.getElementById("input"),
  panels = document.getElementById("panels"),
  section = document.getElementById("text-area"),
} = {}) {
  activeSizer?.destroy();
  if (!input || !panels || !section) return { update() {}, destroy() {} };
  const measurement = document.createElement("textarea");
  measurement.setAttribute("aria-hidden", "true");
  measurement.setAttribute("tabindex", "-1");
  measurement.setAttribute("inert", "");
  measurement.readOnly = true;
  measurement.rows = 1;
  measurement.style.cssText =
    "position:fixed;top:0;left:-100000px;visibility:hidden;pointer-events:none;height:0;min-height:0;max-height:none;overflow:hidden;resize:none;box-sizing:border-box;margin:0;";
  document.body.append(measurement);
  const abort = new AbortController();
  let frame = 0;
  let destroyed = false;
  let measuredWidth = -1;
  let typography = "";
  const copiedStyles = [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "fontStretch",
    "fontVariant",
    "fontKerning",
    "fontFeatureSettings",
    "fontVariationSettings",
    "lineHeight",
    "letterSpacing",
    "wordSpacing",
    "textIndent",
    "textTransform",
    "tabSize",
    "whiteSpace",
    "wordBreak",
    "overflowWrap",
    "direction",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "borderTopStyle",
    "borderRightStyle",
    "borderBottomStyle",
    "borderLeftStyle",
  ];

  function update() {
    if (destroyed) return;
    cancelAnimationFrame(frame);
    frame = 0;
    if (input.hidden || section.hidden || !input.isConnected) return;
    const width = input.getBoundingClientRect().width;
    if (!width) return;
    const computed = getComputedStyle(input);
    const nextTypography = copiedStyles.map((key) => computed[key]).join("|");
    if (nextTypography !== typography) {
      copiedStyles.forEach((key) => {
        measurement.style[key] = computed[key];
      });
      typography = nextTypography;
    }
    if (width !== measuredWidth) {
      measurement.style.width = `${width}px`;
      measuredWidth = width;
    }
    measurement.value = input.value || input.placeholder || " ";
    // scrollHeight includes padding; CSS box-sizing also requires the borders.
    // Two spare pixels avoid clipping fractional line metrics and a final caret.
    const border =
      parseFloat(computed.borderTopWidth) +
      parseFloat(computed.borderBottomWidth);
    const height = `${Math.ceil(measurement.scrollHeight + border + 2)}px`;
    if (input.style.height !== height) input.style.height = height;
    if (input.scrollTop) input.scrollTop = 0;
    if (input.scrollLeft) input.scrollLeft = 0;
  }

  function schedule() {
    if (!destroyed && !frame) frame = requestAnimationFrame(update);
  }

  // A synchronous input update lets the browser paint only the final height.
  input.addEventListener("input", update, { signal: abort.signal });
  input.addEventListener("change", update, { signal: abort.signal });
  window.addEventListener("resize", schedule, { signal: abort.signal });
  window.addEventListener("pageshow", schedule, { signal: abort.signal });
  window.addEventListener("translationhub:appearance", schedule, {
    signal: abort.signal,
  });
  document.fonts?.addEventListener("loadingdone", schedule, {
    signal: abort.signal,
  });
  document.fonts?.ready.then(schedule);

  const textObserver = new MutationObserver(schedule);
  textObserver.observe(panels, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  const visibilityObserver = new MutationObserver(schedule);
  visibilityObserver.observe(section, {
    attributes: true,
    attributeFilter: ["hidden"],
  });
  visibilityObserver.observe(input, {
    attributes: true,
    attributeFilter: ["hidden", "class", "placeholder"],
  });
  visibilityObserver.observe(panels, {
    attributes: true,
    attributeFilter: ["class"],
  });
  visibilityObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style", "class"],
  });

  // Observe width only. Changing our own height must not schedule another
  // measurement or create a ResizeObserver feedback loop.
  let observedWidth = -1;
  const widthObserver = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width;
    if (width !== observedWidth) {
      observedWidth = width;
      schedule();
    }
  });
  widthObserver.observe(input);

  const instance = {
    update,
    destroy() {
      destroyed = true;
      abort.abort();
      cancelAnimationFrame(frame);
      textObserver.disconnect();
      visibilityObserver.disconnect();
      widthObserver.disconnect();
      measurement.remove();
      if (activeSizer === instance) activeSizer = null;
    },
  };
  activeSizer = instance;
  update();
  return instance;
}
