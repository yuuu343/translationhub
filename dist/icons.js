// Small interface symbols. All paths are authored for this application.
const paths = {
  text: "M3 6h18M3 12h12M3 18h16",
  pdf: "M6 2h8l4 4v16H6z M14 2v5h4 M9 12h6m-6 4h5",
  library: "M4 4h4v16H4z M10 4h3v16h-3z M15 5l3-1 4 15-3 1z",
  settings: "M4 7h8m5 0h3M4 17h3m5 0h8 M12 4h5v6h-5z M7 14h5v6H7z",
  palette: "M4 18 15 5q2-2 4 0t0 4L8 20l-5 1z M13 8l4 4",
  swap: "M3 8h16l-4-4M21 16H5l4 4",
  cpu: "M7 6h10v12H7z M4 9h3m-3 6h3m10-6h3m-3 6h3M9 3v3m6-3v3M9 18v3m6-3v3",
  chevron: "m6 9 6 6 6-6",
  columns: "M3 4h18v16H3z M12 4v16",
  rows: "M3 4h18v16H3z M3 12h18",
  pen: "M5 5h14v15H5z M8 9h8m-8 4h6",
  edit: "m4 16-1 5 5-1L20 8l-4-4z M13 7l4 4",
  translate: "M2 6h12M8 3v3m3 1q-1 7-8 10m2-8q2 4 6 6m2 5 4-12 5 12m-7-4h5",
  copy: "M8 8h12v13H8z M16 8V3H3v14h5",
  plus: "M12 4v16M4 12h16",
  shield: "m12 3 8 3v6q0 5-8 10-8-5-8-10V6z M8 12l3 3 5-6",
  bookmark: "M6 3h12v18l-6-4-6 4z",
  book: "M3 4q5-1 9 2 4-3 9-2v15q-5-1-9 2-4-3-9-2z M12 6v15",
  chart: "M3 20h18M5 16v-5m6 5V7m6 9V4",
  atom: "M4 6c3-5 19 6 16 12S1 12 4 6z M4 18C1 12 17 1 20 6S7 24 4 18z M12 11v2",
  open: "m9 5 7 7-7 7",
  x: "m5 5 14 14M19 5 5 19",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  trash: "M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15",
};
export function icons(root = document) {
  for (const i of root.querySelectorAll("i[data-i]")) {
    if (!paths[i.dataset.i] || i.firstChild) continue;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
      p = document.createElementNS(svg.namespaceURI, "path");
    for (const [k, v] of Object.entries({
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.65",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    }))
      svg.setAttribute(k, v);
    p.setAttribute("d", paths[i.dataset.i]);
    svg.append(p);
    i.append(svg);
  }
}
