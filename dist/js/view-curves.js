// Survival-curve card: controls, data notice, panel pages, SVG figure with hover and click, exports.
import { h, clear, hint, field, select, download, svgToPng, toast } from './ui.js';
import { separatedFields } from './separation.js';
import * as S from './settings.js';
import { describeDateSelection, plateIdentified, RACK_LAST_ROW } from './data.js';
import { describeTimePeriods } from './periods.js';
import { curvePlot, MAX_CURVES } from './plots.js';
import { pagePanels, safePage, PANELS_PER_PAGE } from './pipeline.js';
import { esc } from './chart.js';
import { rCompare } from './rcompat.js';
import { sourceGaps } from './sourcegaps.js';
import { rowCountNote } from './questions.js';
import { openRowHelp } from './help.js';
import { toCsv } from './csvout.js';

export const message = (text, cls = 'validation') => h('div', { class: cls, text });

// Genotype and strain overlap: coloring by one while the other is filtered shows only part of each group.
const LIST_MAX = 6;
export function filterNarrowing(d, s) {
  const pair = { genotype: ['Genotype', 'strain', 'strains'], strain: ['Strain', 'genotype', 'genotypes'] }[s.group];
  if (!pair || !(s[pair[1]] || []).length) return '';
  const used = [...new Set(d.map((r) => r[pair[1]]).filter((v) => v !== null))].sort(rCompare);
  if (!used.length) return '';
  const shown = used.slice(0, LIST_MAX).join(', ') + (used.length > LIST_MAX ? ` and ${used.length - LIST_MAX} more` : '');
  return `${pair[0]} curves use only the selected ${pair[2]}: ${shown}.`;
}

// Colored by row position: the second rack is drawn dashed, and a line above the figure says so.
export function dashedRacks(view) {
  if (view.settings.group !== 'row_position') return null;
  return new Set(view.dec.rows.filter((r) => r.rack === 'Rack 2').map((r) => `${r.panel}::${r.curve}`));
}
export function rackKey(view) {
  if (view.settings.group !== 'row_position') return '';
  const src = [...new Set(view.dec.rows.map((r) => r.source))].filter((x) => x in RACK_LAST_ROW).sort();
  if (!src.length) return '';
  return `Solid = first rack, dashed = second rack (${src.map((x) => `${x} rows 1–${RACK_LAST_ROW[x]} | ${RACK_LAST_ROW[x] + 1}+`).join('; ')})`;
}

export function dataNotice(view, s, rows = []) {
  const d = view.data; const notes = [];
  const info = view.f.info;
  const kept = info ? info.rows_before : d.length;
  const narrowed = filterNarrowing(d, s); if (narrowed) notes.push(narrowed);
  notes.push(...sourceGaps(rows, s));
  if (s.group === 'row_position') { const rc = rowCountNote(view.summary); if (rc) notes.push(rc); }
  if (view.f.candidate > kept) notes.push(`${view.f.candidate - kept} observations omitted by quality rules or manual exclusions.`);
  const ds = describeDateSelection(info); if (ds) notes.push(ds);
  const sources = [...new Set(d.map((r) => r.source))].sort();
  const separated = separatedFields(s);
  const bothSources = sources.length > 1 && !separated.has('source');
  if (bothSources) notes.push(`${sources.join(' and ')} data are combined here. They come from different laboratories and years, so examine each source separately (Data sources, in the sidebar) unless you mean to compare them; to compare them, choose Source under Color / compare or By source under Arrange panels.`);
  const mixed = [...(bothSources ? [] : ['source']), 'culture', 'bacteria', 'config', 'sync'].filter((x) => new Set(d.map((r) => r[x])).size > 1 && !separated.has(x));
  if (mixed.length) notes.push(`Pooled across: ${mixed.join(', ')} — use filters or panels to separate these conditions.`);
  if (s.compare_periods && d.some((r) => r.date === null)) notes.push('Undated observations are shown separately as ‘Undated (not assigned)’; they are not placed in a dated time period.');
  return notes.join(' ');
}

export function obsTip(r) {
  const e = esc;
  const f = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : '—');
  return `<b>${e(r.strain)} · ${e(r.genotype)}</b><br>${e(r.source)} · ${e(r.date ?? 'undated')} · experiment ${e(r.expt)} · row ${e(r.row)}<br>${r.hours} h · ${f(r.survival_pct)}% survival<br>Alive / dead: ${r.alive} / ${r.dead}<br>Ruptured / suicide / missing: ${r.Rup} / ${r.suicide} / ${r.missing}<br>${e(r.culture)} · ${e(r.bacteria)} · ${e(r.config)}${r.time_period ? `<br>${e(r.time_period)}` : ''}<br>${e(r.observation_id)}${r.note ? `<br>Note: ${e(r.note)}` : ''}`;
}
export function meanTip(s) {
  const e = esc; const f = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : 'undefined (one unit)');
  return `<b>${e(s.curve)}</b><br>${e(s.panel)}<br>${s.hours} h · mean ${Math.round(s.mean * 10) / 10}%<br>${s.n_observations} observations · ${s.n_runs} recorded runs<br>Weighting: ${s.unit === 'run' ? 'equal run means' : 'equal observations'}<br>SE: ${f(s.se)}<br>95% CI: ${Number.isFinite(s.ci95) ? `${Math.round((s.mean - s.ci95) * 10) / 10} to ${Math.round((s.mean + s.ci95) * 10) / 10}%` : 'undefined (one unit)'}`;
}

const DATES_HELP = 'Dates compared: “shared” keeps only assay dates on which every Color / compare group was measured; “overlapping” keeps dates from the latest first date to the earliest last date among the groups. Both drop undated observations.';
export function createCurves(app) {
  const s = () => app.settings;
  const sel = {};
  const mk = (name, options, key, id) => { sel[name] = select(options, s()[key], (v) => { s()[key] = v; if (key !== 'mode' && key !== 'uncertainty') s().panel_page = 1; app.update(); }, { id }); return sel[name]; };
  const controls = h('div', { class: 'plot-controls' },
    field('Color / compare', mk('group', S.GROUP_CHOICES, 'group', 'group'), { id: 'group' }),
    field('Dates compared', mk('date_selection', S.DATE_SELECTIONS, 'date_selection', 'date_selection'), { id: 'date_selection' }),
    field('Arrange panels', mk('facet', S.FACET_CHOICES, 'facet', 'facet'), { id: 'facet' }),
    field('Display', mk('mode', S.MODES, 'mode', 'mode'), { id: 'mode' }),
    field('Mean weighting', mk('unit', S.UNITS, 'unit', 'unit'), { id: 'unit' }),
    field('Error bars', mk('uncertainty', S.UNCERTAINTY, 'uncertainty', 'uncertainty'), { id: 'uncertainty' }));
  const notice = h('div', { id: 'data_notice' });
  const pageInput = h('input', { type: 'number', min: 1, step: 1, value: 1, id: 'panel_page', class: 'form-control' });
  pageInput.addEventListener('change', () => { s().panel_page = Math.max(1, Math.trunc(+pageInput.value) || 1); app.update(); });
  const panelCount = h('span', { id: 'panel_count' });
  const pagination = h('div', { class: 'panel-pagination' }, h('label', { for: 'panel_page', text: `Panel page (${PANELS_PER_PAGE} per page)` }), pageInput, panelCount);
  const plot = h('div', { class: 'plot', id: 'curve_container' });
  const tip = h('div', { class: 'plot-tip', hidden: true, role: 'tooltip' });
  document.body.append(tip);
  const exportBar = h('div', { class: 'export-bar' });
  const helpBtn = h('button', { type: 'button', class: 'btn', id: 'curves-help', text: 'How to read these figures', hidden: true, onclick: () => openRowHelp(app) });   // shown while the row-position question is active
  const el = h('div', { class: 'card', id: 'curves-card' },
    h('div', { class: 'card-heading' }, h('h2', { text: 'Survival curves' }), helpBtn, h('span', { class: 'hint', text: 'Hover to inspect · click a point for details' })),
    controls,
    notice, pagination, plot, exportBar,
    hint('Individual observations are drawn slightly to the side of their hour, a separate slot for each curve, so overlapping points can be told apart; means, lines and error bars sit at the true hours, and hover shows the true hours. Figure exports use the displayed panel page. CSV exports contain all selected panels. Error bars are clipped at 0–100%; exact values are in Summary.'));

  let current = null;   // { view, svg, pageRows, byId, byMean }
  plot.addEventListener('mousemove', (e) => {
    const m = e.target.closest?.('.mark');
    if (!m || !current) { tip.hidden = true; return; }
    const k = m.getAttribute('data-k');
    let html = null;
    if (k.startsWith('mean::')) { const sm = current.byMean.get(k); html = sm ? meanTip(sm) : null; }
    else { const r = current.byId.get(k); html = r ? obsTip(r) : null; }
    if (!html) { tip.hidden = true; return; }
    tip.innerHTML = html; tip.hidden = false;
    tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 330)}px`; tip.style.top = `${e.clientY + 14}px`;
  });
  plot.addEventListener('mouseleave', () => { tip.hidden = true; });
  plot.addEventListener('click', (e) => {
    const m = e.target.closest?.('.mark'); if (!m) return;
    app.selected = m.getAttribute('data-k');
    document.dispatchEvent(new CustomEvent('thermo:select'));
  });

  const exportFile = async (kind) => {
    if (!current) return;
    try {
      if (kind === 'svg') download('thermotolerance_curves.svg', current.svg, 'image/svg+xml');
      else download('thermotolerance_curves.png', await svgToPng(current.svg, 2), 'image/png');
    } catch (e) { toast(e.message, 'error'); }
  };
  const btn = (id, label, fn, primary) => h('button', { type: 'button', class: `btn${primary ? ' primary' : ''}`, id, text: label, onclick: fn });
  clear(exportBar).append(btn('plot-png', 'Figure PNG', () => exportFile('png'), true), btn('plot-svg', 'Figure SVG', () => exportFile('svg')),
    btn('export-rows', 'Selected data CSV', () => app.view?.ok && download('thermotolerance_selected.csv', toCsv(app.view.data, Object.keys(app.view.data[0] || {})))),
    btn('export-summary', 'Summary CSV', () => app.view?.ok && download('thermotolerance_summary.csv', toCsv(app.view.summary))));

  return {
    el,
    syncControls() { for (const [k, c] of Object.entries(sel)) c.value = String(s()[k]); pageInput.value = s().panel_page; sel.date_selection.title = DATES_HELP; },
    render(view) {
      helpBtn.hidden = !app.question;
      current = null; tip.hidden = true;
      const dis = !view.ok;
      for (const x of [controls, notice, pagination, exportBar]) x.hidden = false;
      if (dis) { clear(notice); clear(plot).append(message(view.message)); pagination.hidden = true; return; }
      pagination.hidden = Math.ceil(view.panels.length / PANELS_PER_PAGE) <= 1;   // no page controls when everything fits on one page
      clear(notice); const nt = dataNotice(view, view.settings, app.rows); if (nt) notice.append(h('div', { class: 'notice', text: nt }));
      const total = Math.ceil(view.panels.length / PANELS_PER_PAGE);
      panelCount.textContent = `${view.panels.length} panels · ${Math.max(1, total)} pages`;
      const page = safePage(s().panel_page, total); s().panel_page = page; pageInput.value = page;
      if (!view.dec.rows.length) { clear(plot).append(message('No observations match these filters. Clear a filter or choose another data source.')); return; }
      if (view.order.length > MAX_CURVES) { clear(plot).append(message('More than 30 curves selected. Narrow the genotype or strain filters, or change Color / compare.')); return; }
      const names = pagePanels(view.panels, page); const set = new Set(names);
      const rows = view.dec.rows.filter((r) => set.has(r.panel)); const summary = view.summary.filter((x) => set.has(x.panel));
      const width = Math.max(620, Math.floor(plot.clientWidth || plot.parentElement.clientWidth - 44 || 900));
      const out = curvePlot({ rows, summary, panels: names, mode: s().mode, uncertainty: s().uncertainty, order: view.order, width, note: [S.dateRangeNote(s(), S.dataDateSpan(app.rows)), rackKey(view)], dashed: dashedRacks(view) });
      plot.innerHTML = out.svg;
      current = { view, svg: out.svg, byId: new Map(rows.map((r) => [r.observation_id, r])), byMean: new Map(summary.map((x) => [`mean::${x.panel}::${x.curve}::${x.hours}`, x])) };
    },
  };
}
