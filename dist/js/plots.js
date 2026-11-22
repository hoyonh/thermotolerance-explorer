// Survival-curve and paired-date figures (SVG). Ports of make_curve_plot(), paired_trend_plot() and paired_curve_plot().
import { esc, fmtNum, niceTicks, padDomain, panelGrid, path, circle, line, text, legend, wrapSvg, scale, INK } from './chart.js';
import { DARK3 } from './palette.js';
import { THIN_N } from './rowfx.js';
import { plateIdentified, RACK_LAST_ROW } from './data.js';
import { dayNumber, isoFromDay, rMean, unique, rCompare } from './rcompat.js';

export const MAX_CURVES = 30;
// Observations are drawn slightly to the side of their true hour so overlapping points can be told apart:
// each curve gets its own slot at an hour, and a fixed per-observation jitter spreads points within the slot.
// Means, lines and error bars stay at the true hours; tooltips report the true hours.
export const OFFSET_SHARE = 0.6;   // all slots together span this fraction of the closest spacing between hours
// Axis labels at the heat exposures that were actually measured (2, 2.5, 3, 3.5 ...); rounded ticks only when there are too many to label.
export function hourTicks(hours, max = 10) {
  const u = [...new Set(hours.filter(Number.isFinite).map((h) => Math.round(h * 1000) / 1000))].sort((a, b) => a - b);
  return u.length && u.length <= max ? u : niceTicks(Math.min(...u), Math.max(...u), 6);
}
export function hourSpacing(hours) {
  const u = [...new Set(hours.filter(Number.isFinite))].sort((a, b) => a - b);
  let gap = Infinity; for (let i = 1; i < u.length; i++) gap = Math.min(gap, u[i] - u[i - 1]);
  return Number.isFinite(gap) ? gap : 0.5;
}
export function unitHash(id) {   // deterministic value in [0, 1) so a redraw never moves a point
  let h = 2166136261; for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}
export function pointOffset(id, curveIndex, curveCount, spacing) {
  const slot = (OFFSET_SHARE * spacing) / Math.max(1, curveCount);
  return (curveIndex - (curveCount - 1) / 2) * slot + (unitHash(id) - 0.5) * slot * 0.8;
}
export const colorsFor = (order) => Object.fromEntries(order.map((c, i) => [c, DARK3[Math.min(order.length, MAX_CURVES) - 1][i % MAX_CURVES]]));

// rows: decorated observations on the panels to draw; summary: curve means for the same panels.
export function curvePlot({ rows, summary, panels, mode, uncertainty, order, width = 900, note = '', dashed = null }) {
  const colors = colorsFor(order);
  const hours = rows.map((r) => r.hours).filter(Number.isFinite);
  const spacing = hourSpacing(hours); const slotOf = new Map(order.map((c, i) => [c, i]));
  const [x0, x1] = padDomain(Math.min(...hours), Math.max(...hours), 0.05);
  const ncol = Math.min(3, panels.length);
  const byPanel = new Map(panels.map((p) => [p, { rows: [], summary: [] }]));
  rows.forEach((r) => byPanel.get(r.panel)?.rows.push(r));
  summary.forEach((s) => byPanel.get(s.panel)?.summary.push(s));
  const drawPanel = ({ name, sx, sy }) => {
    const { rows: obs, summary: sm } = byPanel.get(name);
    const out = [];
    if (mode === 'replicates' || mode === 'both') {
      const plates = new Map();
      for (const r of obs) {
        if (!plateIdentified(r) || !Number.isFinite(r.survival_pct)) continue;
        const k = `${r.plate_id}\u0001${r.curve}`; const h = String(r.hours);
        if (!plates.has(k)) plates.set(k, { curve: r.curve, hours: new Map() });
        const m = plates.get(k).hours; if (!m.has(h)) m.set(h, { hours: r.hours, v: [] }); m.get(h).v.push(r.survival_pct);
      }
      for (const p of plates.values()) {
        const pts = [...p.hours.values()].sort((a, b) => a.hours - b.hours).map((o) => [sx(o.hours), sy(rMean(o.v))]);
        out.push(path(pts, { stroke: colors[p.curve], width: 0.6, opacity: 0.22 }));
      }
    }
    if (mode !== 'mean') {
      for (const r of obs) if (Number.isFinite(r.survival_pct)) out.push(circle(sx(r.hours + pointOffset(r.observation_id, slotOf.get(r.curve), order.length, spacing)), sy(r.survival_pct), 2.6, colors[r.curve], { opacity: mode === 'replicates' ? 0.8 : 0.4, key: r.observation_id }));
    }
    if (mode !== 'replicates') {
      const byCurve = new Map();
      for (const s of sm) { if (!byCurve.has(s.curve)) byCurve.set(s.curve, []); byCurve.get(s.curve).push(s); }
      for (const [curve, list] of byCurve) {
        const c = colors[curve];
        if (uncertainty !== 'none') for (const s of list) {
          const err = { se: s.se, sd: s.sd, ci95: s.ci95 }[uncertainty];
          if (!Number.isFinite(err)) continue;
          const lo = Math.max(0, s.mean - err), hi = Math.min(100, s.mean + err), x = sx(s.hours), w = (sx(s.hours + 0.045) - x);
          out.push(line(x, sy(lo), x, sy(hi), { stroke: c, width: 0.9 }), line(x - w, sy(lo), x + w, sy(lo), { stroke: c, width: 0.9 }), line(x - w, sy(hi), x + w, sy(hi), { stroke: c, width: 0.9 }));
        }
        out.push(path(list.map((s) => [sx(s.hours), sy(s.mean)]), { stroke: c, width: 1.7, dash: dashed && dashed.has(`${name}::${curve}`) ? '6 3' : '' }));
        for (const s of list) out.push(circle(sx(s.hours), sy(s.mean), 3.8, c, { key: `mean::${s.panel}::${s.curve}::${s.hours}` }));
      }
    }
    return out.join('');
  };
  const g = panelGrid({ note,
    panels, width, ncol, cellH: panels.length === 1 ? 420 : 250, xDomain: [x0, x1], yDomain: [-3, 103], xTicks: hourTicks(hours), yTicks: [0, 25, 50, 75, 100],
    drawPanel, xTitle: 'Heat exposure (hours)', yTitle: 'Survival (%)', legendEntries: order.map((c) => ({ label: c, color: colors[c] })),
  });
  return { svg: wrapSvg(width, g.height, g.body, 'Survival curves'), height: g.height };
}

const SERIES = ['#287d75', '#b46187'];
const PERIOD_COLORS = { Historic: '#496b8a', Recent: '#c26b39' };
const dateTicks = (d0, d1) => {
  const span = d1 - d0; const step = [1, 2, 7, 14, 30, 61, 91, 183, 365].find((s) => span / s <= 7) ?? 730;
  const out = []; for (let v = Math.ceil(d0 / step) * step; v <= d1; v += step) out.push(v);
  return out.length ? out : [d0, d1];
};

// Paired trend over assay dates: absolute survival of both groups, or the paired difference.
export function trendPlot({ daily, difference = false, width = 900, note = '' }) {
  const days = daily.map((r) => dayNumber(r.date));
  const d0 = Math.min(...days) - 1, d1 = Math.max(...days) + 1;
  const cutoff = dayNumber(daily[0].recent_from);
  const diffs = daily.map((r) => r.difference_pp);
  const [yLo, yHi] = difference ? padDomain(Math.min(0, ...diffs), Math.max(0, ...diffs), 0.08) : [-3, 103];
  const yTicks = difference ? niceTicks(yLo, yHi, 5) : [0, 25, 50, 75, 100];
  const title = difference ? 'Does the paired difference change?' : 'Do both groups move together?';
  const ref = daily[0].reference, cmp = daily[0].comparison;
  const entries = difference ? Object.entries(PERIOD_COLORS).map(([label, color]) => ({ label, color })) : [{ label: `Reference: ${ref}`, color: SERIES[0] }, { label: `Comparison: ${cmp}`, color: SERIES[1] }];
  const drawPanel = ({ sx, sy, px0, px1, py0, py1 }) => {
    const out = [];
    const cx = sx(cutoff); if (cx >= px0 && cx <= px1) out.push(line(cx, py0, cx, py1, { stroke: '#c26b39', dash: '2 3', width: 1.2 }));
    if (difference) {
      out.push(line(px0, sy(0), px1, sy(0), { stroke: '#a3aaa8', dash: '5 4', width: 1.2 }));
      for (const r of daily) out.push(circle(sx(dayNumber(r.date)), sy(r.difference_pp), 4, PERIOD_COLORS[r.period], { key: `day::${r.pair_stratum}::${r.date}` }));
    } else {
      for (const [i, field] of [[0, 'reference_mean'], [1, 'comparison_mean']]) {
        for (const period of ['Historic', 'Recent']) out.push(path(daily.filter((r) => r.period === period).map((r) => [sx(dayNumber(r.date)), sy(r[field])]), { stroke: SERIES[i], width: 1.1, opacity: 0.55 }));
        for (const r of daily) out.push(circle(sx(dayNumber(r.date)), sy(r[field]), 3.4, SERIES[i], { key: `day::${r.pair_stratum}::${r.date}::${i}` }));
      }
    }
    return out.join('');
  };
  const g = panelGrid({ note,
    panels: [title], width, ncol: 1, cellH: 300, xDomain: [d0, d1], yDomain: [yLo, yHi], xTicks: dateTicks(d0, d1), yTicks, xFormat: (v) => isoFromDay(v),
    drawPanel, xTitle: `Assay date · recent begins ${daily[0].recent_from}`, yTitle: difference ? 'Comparison − reference (percentage points)' : 'Survival (%)', legendEntries: entries, gridX: false,
  });
  return { svg: wrapSvg(width, g.height, g.body, title), height: g.height };
}

// Matched curves: one panel per date / experiment, a line per matched block and group.
export function pairedCurvePlot({ pairs, width = 900, note = '' }) {
  const panels = unique(pairs.map((p) => p.pair_panel)).sort(rCompare);
  const ref = pairs[0].reference, cmp = pairs[0].comparison;
  const hours = pairs.map((p) => p.hours);
  const [x0, x1] = padDomain(Math.min(...hours), Math.max(...hours), 0.05);
  const ncol = Math.min(3, panels.length);
  const drawPanel = ({ name, sx, sy }) => {
    const out = [];
    const z = pairs.filter((p) => p.pair_panel === name);
    const blocks = unique(z.map((p) => p.pair_block));
    for (const b of blocks) for (const [i, field] of [[0, 'reference_mean'], [1, 'comparison_mean']]) {
      const pts = z.filter((p) => p.pair_block === b).sort((a, c) => a.hours - c.hours);
      out.push(path(pts.map((p) => [sx(p.hours), sy(p[field])]), { stroke: SERIES[i], width: 1.4 }));
      for (const p of pts) out.push(circle(sx(p.hours), sy(p[field]), 2.8, SERIES[i], { key: `pc::${p.pair_block}::${p.hours}::${i}` }));
    }
    return out.join('');
  };
  const g = panelGrid({ note,
    panels, width, ncol, cellH: 235, xDomain: [x0, x1], yDomain: [-3, 103], xTicks: hourTicks(hours), yTicks: [0, 50, 100], drawPanel,
    xTitle: 'Heat exposure (hours)', yTitle: 'Survival (%)', legendEntries: [{ label: `Reference: ${ref}`, color: SERIES[0] }, { label: `Comparison: ${cmp}`, color: SERIES[1] }],
  });
  return { svg: wrapSvg(width, g.height, g.body, 'Paired curves'), height: g.height, panels };
}

// Gap-by-hour profile: thin lines are single assay dates, thick lines are period means ± SE across dates.
export function profilePlot({ profile, width = 900, note = '' }) {
  const lines = new Map();
  for (const { hour, daily } of profile) for (const d of daily) {
    const k = `${d.pair_stratum}\u0001${d.date}`;
    if (!lines.has(k)) lines.set(k, []);
    lines.get(k).push({ hour, gap: d.difference_pp, period: d.period, date: d.date, stratum: d.pair_stratum, n_blocks: d.n_blocks });
  }
  const means = { Historic: [], Recent: [] };
  for (const { hour, period } of profile) for (const p of period) means[p.period]?.push({ hour, gap: p.difference_pp, se: p.difference_se });
  const hours = profile.map((x) => x.hour);
  const gaps = [0, ...[...lines.values()].flat().map((o) => o.gap), ...Object.values(means).flat().flatMap((m) => [m.gap - (m.se || 0), m.gap + (m.se || 0)])];
  const [x0, x1] = padDomain(Math.min(...hours), Math.max(...hours), 0.05);
  const [y0, y1] = padDomain(Math.min(...gaps), Math.max(...gaps), 0.08);
  const drawPanel = ({ sx, sy, px0, px1 }) => {
    const out = [line(px0, sy(0), px1, sy(0), { stroke: '#a3aaa8', dash: '5 4', width: 1.2 })];
    for (const pts of lines.values()) {
      const s = [...pts].sort((a, b) => a.hour - b.hour); const c = PERIOD_COLORS[s[0].period];
      out.push(path(s.map((o) => [sx(o.hour), sy(o.gap)]), { stroke: c, width: 0.9, opacity: 0.3 }));
      for (const o of s) out.push(circle(sx(o.hour), sy(o.gap), 2.4, c, { opacity: 0.55, key: `pf::${o.stratum}::${o.date}::${o.hour}` }));
    }
    for (const [period, list] of Object.entries(means)) {
      if (!list.length) continue; const c = PERIOD_COLORS[period]; const s = [...list].sort((a, b) => a.hour - b.hour);
      for (const m of s) if (Number.isFinite(m.se)) { const x = sx(m.hour), w = sx(m.hour + 0.03) - x; out.push(line(x, sy(m.gap - m.se), x, sy(m.gap + m.se), { stroke: c, width: 1.6 }), line(x - w, sy(m.gap - m.se), x + w, sy(m.gap - m.se), { stroke: c, width: 1.6 }), line(x - w, sy(m.gap + m.se), x + w, sy(m.gap + m.se), { stroke: c, width: 1.6 })); }
      out.push(path(s.map((m) => [sx(m.hour), sy(m.gap)]), { stroke: c, width: 2.6 }));
      for (const m of s) out.push(circle(sx(m.hour), sy(m.gap), 4.6, c, { key: `pm::${period}::${m.hour}` }));
    }
    return out.join('');
  };
  const ticks = hours.length <= 12 ? hours : niceTicks(Math.min(...hours), Math.max(...hours), 6);
  const g = panelGrid({ note,
    panels: ['Gap by exposure time (comparison − reference)'], width, ncol: 1, cellH: 330, xDomain: [x0, x1], yDomain: [y0, y1], xTicks: ticks, yTicks: niceTicks(y0, y1, 5),
    drawPanel, xTitle: 'Heat exposure (hours)', yTitle: 'Gap (percentage points)',
    legendEntries: [{ label: 'Historic (mean ± SE across dates)', color: PERIOD_COLORS.Historic }, { label: 'Recent (mean ± SE across dates)', color: PERIOD_COLORS.Recent }],
  });
  return { svg: wrapSvg(width, g.height, g.body, 'Gap by exposure time'), height: g.height };
}

// One point per assay date for a gap in AUC (% survival × hours), coloured by period.
export function aucGapPlot({ daily, width = 900, note = '' }) {
  const days = daily.map((r) => dayNumber(r.date));
  const d0 = Math.min(...days) - 1, d1 = Math.max(...days) + 1;
  const cutoff = dayNumber(daily[0].recent_from);
  const gaps = daily.map((r) => r.difference_auc);
  const [y0, y1] = padDomain(Math.min(0, ...gaps), Math.max(0, ...gaps), 0.08);
  const drawPanel = ({ sx, sy, px0, px1, py0, py1 }) => {
    const out = [];
    const cx = sx(cutoff); if (cx >= px0 && cx <= px1) out.push(line(cx, py0, cx, py1, { stroke: '#c26b39', dash: '2 3', width: 1.2 }));
    out.push(line(px0, sy(0), px1, sy(0), { stroke: '#a3aaa8', dash: '5 4', width: 1.2 }));
    for (const r of daily) out.push(circle(sx(dayNumber(r.date)), sy(r.difference_auc), 4, PERIOD_COLORS[r.period], { key: `ad::${r.pair_stratum}::${r.date}` }));
    return out.join('');
  };
  const g = panelGrid({ note,
    panels: ['AUC gap per assay date (comparison − reference)'], width, ncol: 1, cellH: 300, xDomain: [d0, d1], yDomain: [y0, y1], xTicks: dateTicks(d0, d1), yTicks: niceTicks(y0, y1, 5), xFormat: (v) => isoFromDay(v),
    drawPanel, xTitle: `Assay date · recent begins ${daily[0].recent_from}`, yTitle: 'AUC gap (% survival × hours)',
    legendEntries: Object.entries(PERIOD_COLORS).map(([label, color]) => ({ label, color })),
  });
  return { svg: wrapSvg(width, g.height, g.body, 'AUC gap per assay date'), height: g.height };
}

// Row effect within genotype: one panel per source and configuration; points are percentage points above or below the genotype's own mean.
export function rowEffectPlot({ rows, width = 900, note = '' }) {
  const panels = [...new Set(rows.map((r) => r.panel))];
  const vals = rows.flatMap((r) => [r.genotype_adjusted, r.matched]).filter(Number.isFinite);
  const xs = rows.map((r) => r.row);
  const [x0, x1] = padDomain(Math.min(...xs), Math.max(...xs), 0.05);
  const [y0, y1] = padDomain(Math.min(0, ...vals), Math.max(0, ...vals), 0.1);
  const G = '#000000', M = '#4169e1';   // black: within genotype; blue dashed: within genotype and recorded run (as in the manuscript figure)
  const drawPanel = ({ name, sx, sy, px0, px1, py0 }) => {
    const mine = rows.filter((r) => r.panel === name).sort((a, b) => a.row - b.row);
    const out = [line(px0, sy(0), px1, sy(0), { stroke: '#a3aaa8', dash: '5 4', width: 1.2 })];
    const cut = (mine[0]?.source === 'SKKU' && mine[0]?.panel.endsWith('standard')) ? undefined : RACK_LAST_ROW[mine[0]?.source];   // the SKKU inner container holds one shelf (six rows), so no boundary
    if (cut !== undefined && cut + 0.5 > x0 && cut + 0.5 < x1) {
      const x = sx(cut + 0.5);
      out.push(line(x, py0, x, sy(y0), { stroke: '#8d9a97', dash: '2 3', width: 1 }), text(x - 4, py0 + 10, 'rack 1', { size: 11, anchor: 'end', fill: '#6c7b83' }), text(x + 4, py0 + 10, 'rack 2', { size: 11, fill: '#6c7b83' }));
    }
    const g = mine.filter((r) => Number.isFinite(r.genotype_adjusted)), m = mine.filter((r) => Number.isFinite(r.matched));
    const racks = (a) => (cut === undefined ? [a] : [a.filter((r) => r.row <= cut), a.filter((r) => r.row > cut)]);   // lines are broken at the rack boundary
    for (const seg of racks(m)) out.push(path(seg.map((r) => [sx(r.row), sy(r.matched)]), { stroke: M, width: 1.4, dash: '5 3' }));
    for (const seg of racks(g)) out.push(path(seg.map((r) => [sx(r.row), sy(r.genotype_adjusted)]), { stroke: G, width: 1.8 }));
    for (const r of m) out.push(circle(sx(r.row), sy(r.matched), 2.8, r.n_matched < THIN_N ? '#fff' : M, { key: `rf::${name}::${r.row}::m`, stroke: M }));
    for (const r of g) out.push(circle(sx(r.row), sy(r.genotype_adjusted), 3.8, r.n_obs < THIN_N ? '#fff' : G, { key: `rf::${name}::${r.row}::g`, stroke: G }));
    return out.join('');
  };
  const rowTicks = [...new Set(xs.map(Math.round))].sort((a, b) => a - b);
  const g = panelGrid({ note, panels, width, ncol: Math.min(3, panels.length), cellH: panels.length === 1 ? 380 : 250, xDomain: [x0, x1], yDomain: [y0, y1], xTicks: rowTicks, yTicks: niceTicks(y0, y1, 5),
    drawPanel, xTitle: 'Row position', yTitle: ['Deviation from mean', '(percentage points)'],
    legendEntries: [{ label: 'Genotype', color: G }, { label: 'Genotype + experiment (same recorded run)', color: M }] });
  return { svg: wrapSvg(width, g.height, g.body, 'Row effect within genotype'), height: g.height };
}
