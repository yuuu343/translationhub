// Each composition is laid out from the viewport edges. Sizes are relative to a
// 1440px-wide print; CSS keeps the same subjects in frame on small screens.
// Rows: illustration, x%, y%, width, rotation, depth, mobile x%, mobile y%.
const compositions = {
  sakura: [
    [3, 35, 7, 25, 24, "far", 33, 8],
    [2, 80, 4, 58, -24, "middle", 72, 4],
    [3, 68, 18, 24, -70, "far", 50, 16],
    [1, 25, 15, 59, -23, "middle", 51, 13],
    [3, 18, 25, 27, 130, "middle", 21, 24],
    [4, 82, 16, 126, 7, "middle", 73, 15],
    [3, 81, 29, 44, -73, "middle", 82, 25],
    [2, 2, 36, 116, -44, "soft", -1, 40],
    [3, 98, 45, 73, 58, "soft", 97, 45],
    [1, 86, 61, 80, 36, "soft", 86, 59],
    [3, 13, 67, 49, -103, "middle", 9, 67],
    [3, 76, 83, 29, -73, "far", 73, 83],
    [1, -1, 85, 249, 30, "near", -4, 86],
    [2, 99, 91, 181, -24, "near", 101, 91],
    [3, 26, 98, 62, 88, "soft", 31, 98],
  ],
  flight: [
    [1, 27, 15, 61, -9, "middle", 49, 13],
    [3, 28, 9, 28, 7, "far", 19, 7],
    [2, 66, 10, 43, -11, "far", 58, 10],
    [3, 76, 15, 81, 10, "middle", 72, 16],
    [1, 83, 17, 137, -8, "middle", 73, 16],
    [4, 95, 8, 63, 30, "soft", 101, 7],
    [2, 99, 36, 147, 17, "soft", 100, 37],
    [1, 4, 48, 105, -18, "soft", 1, 48],
    [4, 12, 58, 51, -17, "far", 9, 57],
    [3, 20, 65, 32, 14, "far", 17, 65],
    [4, -3, 83, 241, -20, "near", -3, 85],
    [2, 84, 80, 76, 14, "soft", 88, 79],
    [1, 98, 93, 178, -17, "near", 100, 95],
  ],
  sunlit: [
    [1, 24, 15, 59, -17, "middle", 45, 13],
    [3, 32, 7, 31, 40, "far", 23, 7],
    [2, 76, 9, 43, -21, "soft", 69, 8],
    [4, 82, 16, 107, 16, "middle", 73, 15],
    [1, 96, 26, 52, -20, "middle", 102, 25],
    [2, 4, 35, 117, 21, "soft", -3, 36],
    [3, 16, 43, 37, 13, "far", 12, 42],
    [4, 102, 51, 162, -10, "near", 103, 52],
    [2, 86, 64, 68, 32, "middle", 86, 65],
    [1, 11, 69, 54, 7, "middle", 8, 68],
    [3, -1, 87, 248, -22, "near", -2, 87],
    [2, 70, 91, 32, 31, "far", 71, 91],
    [1, 96, 93, 128, 21, "soft", 99, 94],
  ],
};

function draw(canvas, scene) {
  const fragments = document.createDocumentFragment();
  for (const [index, row] of (compositions[scene] || []).entries()) {
    const [asset, x, y, width, angle, depth, mobileX, mobileY] = row;
    const motif = document.createElement("span");
    motif.className = "scene-motif";
    motif.dataset.depth = depth;
    const styles = {
      "--x": x + "%", "--y": y + "%", "--mx": mobileX + "%", "--my": mobileY + "%",
      "--size": width, "--angle": angle + "deg",
      "--duration": 13 + (index * 7 % 15) + "s", "--phase": -(index * 3.17) + "s",
      "--drift": (index % 2 ? -1 : 1) * (5 + index % 8) + "px",
    };
    for (const [name, value] of Object.entries(styles)) motif.style.setProperty(name, value);
    const img = document.createElement("img");
    img.alt = "";
    img.draggable = false;
    img.src = new URL(`./assets/atmosphere/${scene}-${asset}.webp`, import.meta.url).href;
    motif.append(img);
    fragments.append(motif);
  }
  canvas.replaceChildren(fragments);
}

export function initAtmosphere() {
  const canvas = document.getElementById("atmosphere");
  let rendered, active = false, frame = 0;
  function position() {
    frame = 0;
    const offset = active ? 20 * (1 - Math.exp(-Math.max(0, scrollY) / 450)) : 0;
    canvas.style.setProperty("--scroll-shift", -offset.toFixed(2) + "px");
  }
  function scroll() {
    if (!frame) frame = requestAnimationFrame(position);
  }
  function update() {
    const root = document.documentElement;
    const scene = root.dataset.scene;
    const visible = Number(root.style.getPropertyValue("--scene-opacity") || 1) > 0;
    const effective = visible && Object.hasOwn(compositions, scene) ? scene : "";
    if (effective !== rendered) {
      draw(canvas, effective);
      rendered = effective;
    }
    const animate = Boolean(effective && root.dataset.motion === "on" && !document.hidden);
    canvas.dataset.moving = String(animate);
    if (active === animate) return;
    active = animate;
    if (active) window.addEventListener("scroll", scroll, { passive: true });
    else window.removeEventListener("scroll", scroll);
    cancelAnimationFrame(frame);
    position();
  }
  window.addEventListener("translationhub:appearance", update);
  document.addEventListener("visibilitychange", update);
  update();
}
