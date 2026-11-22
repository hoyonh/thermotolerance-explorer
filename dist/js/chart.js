// Small SVG drawing helpers shared by the survival-curve and paired-date plots. Charts are built as
// strings, so the same markup is shown on screen and saved as SVG/PNG.
export const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif';
export const INK = '#243b4a';
const f2 = (x) => (Math.round(x * 100) / 100).toString();

// "Nice" tick positions inside [lo, hi] (about n of them), like pretty().
export function niceTicks(lo, hi, n = 5) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw * 0.9999) ?? 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v / step * 1e6) / 1e6 * step);
  return out;
}
export const fmtNum = (v) => String(Math.round(v * 1e6) / 1e6);
export const scale = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
export function padDomain(lo, hi, frac) { const d = (hi - lo) || 1; return [lo - d * frac, hi + d * frac]; }

export const text = (x, y, s, { size = 10, anchor = 'start', weight = 400, fill = INK, rotate = 0, baseline = 'auto' } = {}) =>
  `<text x="${f2(x)}" y="${f2(y)}" font-size="${size}" text-anchor="${anchor}" font-weight="${weight}" fill="${fill}" dominant-baseline="${baseline}"${rotate ? ` transform="rotate(${rotate} ${f2(x)} ${f2(y)})"` : ''}>${esc(s)}</text>`;
export const line = (x1, y1, x2, y2, { stroke = '#e3e8e7', width = 1, dash = '', opacity = 1 } = {}) =>
  `<line x1="${f2(x1)}" y1="${f2(y1)}" x2="${f2(x2)}" y2="${f2(y2)}" stroke="${stroke}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}${opacity !== 1 ? ` stroke-opacity="${opacity}"` : ''}/>`;
export const path = (pts, { stroke, width = 1.2, opacity = 1, dash = '' }) => (pts.length < 2 ? '' :
  `<path d="M${pts.map(([x, y]) => `${f2(x)} ${f2(y)}`).join('L')}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"${opacity !== 1 ? ` stroke-opacity="${opacity}"` : ''}${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
export const circle = (x, y, r, fill, { opacity = 1, key = null, stroke = '' } = {}) =>
  `<circle cx="${f2(x)}" cy="${f2(y)}" r="${r}" fill="${fill}"${opacity !== 1 ? ` fill-opacity="${opacity}"` : ''}${stroke ? ` stroke="${stroke}"` : ''}${key !== null ? ` data-k="${esc(key)}" class="mark"` : ''}/>`;

// Legend laid out in rows; returns { svg, height }.
export function legend(entries, width, y0, { swatch = 'line' } = {}) {
  let x = 12, y = y0 + 14; const rowH = 21; const parts = [];
  for (const { label, color } of entries) {
    const w = 34 + label.length * 7.4;
    if (x + w > width - 8 && x > 12) { x = 12; y += rowH; }
    parts.push(line(x, y - 4, x + 16, y - 4, { stroke: color, width: 2 }), circle(x + 8, y - 4, 3, color), text(x + 22, y, label, { size: 12 }));
    x += w;
  }
  return { svg: parts.join(''), height: y - y0 + 10 };
}

export function wrapSvg(width, height, body, title = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f2(width)} ${f2(height)}" width="${f2(width)}" height="${f2(height)}" font-family='${FONT}' role="img"${title ? ` aria-label="${esc(title)}"` : ''}><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`;
}

let clipSeq = 0;   // clip-path ids must be unique across every figure on the page (Safari resolves duplicates wrongly)
// Facet grid. drawPanel(ctx) returns the marks for one panel given its scales.
export function panelGrid({ panels, width, ncol, cellH, xDomain, yDomain, xTicks, yTicks, xFormat = fmtNum, yFormat = fmtNum, drawPanel, xTitle, yTitle, legendEntries = [], gridX = false, note = '' }) {
  const left = Array.isArray(yTitle) ? 72 : 56, right = 16, strip = 26, axis = 36;   // a two-line y title needs a wider left margin
  const cellW = (width - 8) / ncol;
  const rows = Math.ceil(panels.length / ncol);
  const body = [];
  const uid = `clip${++clipSeq}`;
  const notes = [].concat(note).filter(Boolean);   // lines above the panels (date cutoff in use, rack key, ...)
  const top = notes.length ? 4 + 17 * notes.length : 0;
  notes.forEach((n, i) => body.push(text(6, 14 + 17 * i, n, { size: 12.5, weight: 700, fill: '#9a4a00' })));
  panels.forEach((name, i) => {
    const col = i % ncol, row = Math.floor(i / ncol);
    const ox = 4 + col * cellW, oy = 6 + top + row * cellH;
    const px0 = ox + left, px1 = ox + cellW - right, py0 = oy + strip, py1 = oy + cellH - axis;
    const sx = scale(xDomain[0], xDomain[1], px0, px1), sy = scale(yDomain[0], yDomain[1], py1, py0);
    body.push(`<rect x="${f2(px0)}" y="${f2(oy)}" width="${f2(px1 - px0)}" height="${strip - 2}" fill="#eef2f1"/>`);
    body.push(text((px0 + px1) / 2, oy + 17, name, { size: 12.5, weight: 700, anchor: 'middle' }));
    for (const t of yTicks) { body.push(line(px0, sy(t), px1, sy(t))); body.push(text(px0 - 6, sy(t), yFormat(t), { size: 12, anchor: 'end', fill: '#6c7b83', baseline: 'middle' })); }
    for (const t of xTicks) { if (gridX) body.push(line(sx(t), py0, sx(t), py1)); body.push(text(sx(t), py1 + 18, xFormat(t), { size: 12, anchor: 'middle', fill: '#6c7b83' })); }
    body.push(`<g clip-path="url(#${uid}-${i})"><clipPath id="${uid}-${i}"><rect x="${f2(px0)}" y="${f2(py0 - 4)}" width="${f2(px1 - px0 + 0)}" height="${f2(py1 - py0 + 8)}"/></clipPath>`);
    body.push(drawPanel({ name, sx, sy, px0, px1, py0, py1 }));
    body.push('</g>');
  });
  let height = rows * cellH + 6 + top + 28;
  body.push(text(width / 2, height - 8, xTitle, { size: 13, anchor: 'middle' }));
  if (yTitle) [].concat(yTitle).forEach((s, i) => body.push(text(13 + 16 * i, (6 + top + rows * cellH) / 2, s, { size: 13, anchor: 'middle', rotate: -90 })));
  const lg = legend(legendEntries, width, height);
  body.push(lg.svg); height += lg.height + 4;
  return { body: body.join(''), height };
}
