/**
 * A contrast audit for one of Bop's windows, run through the DevTools protocol:
 *
 *   node tools/cdp-eval.js <port> "renderer/index.html" "$(cat tools/contrast.js)"
 *
 * It walks every visible element that holds text, resolves the colour it actually ends up on (walking
 * up through transparent backgrounds) and reports the WCAG contrast ratio of anything below 4.5:1. It
 * exists because "the text does not follow the theme" is not something a person can disprove by looking:
 * measured on 0.1.6 in dark theme, the app names inside the new-space dialog computed to rgb(0, 0, 0) on
 * a #262235 tile — 1.36:1, effectively invisible — while everything around them was fine.
 *
 * Run it for the dark theme and again for the light one; both must come back empty.
 */
(() => {
  const lum = ([r, g, b]) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parse = (value) => {
    const m = String(value).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((v) => parseFloat(v));
    return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (top, bottom) => top.rgb.map((c, i) => c * top.a + bottom[i] * (1 - top.a));
  const backgroundOf = (el) => {
    const layers = [];
    for (let node = el; node; node = node.parentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0) layers.push(bg);
      if (bg && bg.a === 1) break;
    }
    let base = [255, 255, 255];
    const root = parse(getComputedStyle(document.documentElement).backgroundColor);
    if (root && root.a === 1) base = root.rgb;
    for (const layer of layers.reverse()) base = over(layer, base);
    return base;
  };
  const rows = [];
  for (const el of document.querySelectorAll('*')) {
    const text = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
    if (!text) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) < 0.3) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const fg = parse(style.color);
    if (!fg) continue;
    const bg = backgroundOf(el);
    const fgRgb = fg.a === 1 ? fg.rgb : over(fg, bg);
    const l1 = lum(fgRgb);
    const l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    if (ratio < 4.5) {
      rows.push({
        ratio: Math.round(ratio * 100) / 100,
        element: String(el.className || el.tagName),
        color: style.color,
        background: `rgb(${bg.map(Math.round).join(',')})`,
        text: text.slice(0, 60),
      });
    }
  }
  rows.sort((a, b) => a.ratio - b.ratio);
  return JSON.stringify({ theme: document.documentElement.dataset.theme, colorScheme: getComputedStyle(document.documentElement).colorScheme, belowThreshold: rows.length, worst: rows.slice(0, 8) }, null, 1);
})()
