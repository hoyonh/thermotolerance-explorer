// Thermotolerance viewer: application shell, data loading, sidebar filters and the render loop.
import * as T from './index.js';
import { h, clear, hint, field, select, setOptions, checkbox, multiSelect, toast, download, infoTip, nextId } from './ui.js';
import * as S from './settings.js';
import { filtered, decorated, curveSummary, curveOrder, panelList, Invalid } from './pipeline.js';
import { describeCode, parseGlossaryFile, emptyGlossary } from './glossary.js';
import { genotypeRank, genotypeTag } from './genotype.js';
import { ROW_QUESTION, rowPositionSettings } from './questions.js';
import { openRowHelp } from './help.js';
import { createRowEffect } from './view-rowfx.js';
import { createCurves } from './view-curves.js';
import { createAuc } from './view-auc.js';
import { createPairing } from './view-pairing.js';
import { createDetail } from './view-detail.js';

export const SOURCE_LABELS = { SKKU: 'SKKU · 2024–2026', JHU: 'JHU · legacy' };
const TIPS = {
  bacteria: 'The bacteria on the plates. OP50 and OP50-1 are the standard E. coli food strains; other codes mark mixed or contaminated lawns. Open the list to see what each code means.',
  config: 'Codes such as NS s-NGM EPSK-1 give the synchronization, growth plate and assay plate. Every assay used the standard incubator setup (inner container on a rack) unless the code is bare or cfloor. Open the list to see each code decoded; the Glossary tab has full definitions.',
  sync: 'How the worms were brought to the same developmental stage before the assay. The same code begins each configuration code (NS in NS s-NGM EPSK-1). Open the list to see what each code means.',
};
const FIELD_LABELS = { genotype: 'Genotype', strain: 'Strain', culture: 'Culture temperature', bacteria: 'Bacterial diet', config: 'Experimental configuration', sync: 'Synchronization' };

export const app = {
  frames: {}, files: {}, rows: [], version: 0, loadedAt: null,
  settings: S.defaultSettings(), pairing: S.defaultPairing(), auc: { reference: '', comparison: '' },
  selected: null, question: null, glossary: emptyGlossary(), glossaryFiles: [], view: null, projectData: null, sections: [],
  update() { schedule(); },
};

let queued = false;
function schedule() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; render(); }); }

function computeView() {
  if (!app.rows.length) return { ok: false, empty: true, message: 'Choose a source CSV to begin.' };
  try {
    const f = filtered(app.rows, app.settings);
    const dec = decorated(f.data, f.settings);
    const summary = curveSummary(dec, f.settings);
    return { ok: true, f, data: f.data, settings: f.settings, dec, summary, order: curveOrder(dec), panels: panelList(dec) };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, message: e.message };
    throw e;
  }
}
function render() {
  const t0 = performance.now();
  app.view = computeView();
  app.view.computeMs = performance.now() - t0;
  for (const s of app.sections) s.render(app.view);
  document.body.dataset.ready = 'true';
  document.body.dataset.renderMs = String(Math.round(performance.now() - t0));
}

// ---- data ----------------------------------------------------------------------------------
async function sha256(buffer) {
  const d = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function rebuildRows() {
  const parts = ['SKKU', 'JHU'].filter((s) => app.frames[s]).map((s) => app.frames[s]);
  app.rows = parts.length === 0 ? [] : parts.length === 1 ? parts[0].rows : T.combineFrames(parts).rows;
  app.version++;
  app.loadedAt = new Date();
}
function dateRange() {
  const ds = app.rows.filter((r) => r.date !== null).map((r) => r.date).sort();
  return ds.length ? [ds[0], ds.at(-1)] : [null, null];
}
function hourRange() {
  const hs = app.rows.map((r) => r.hours).filter(Number.isFinite);
  return hs.length ? [Math.min(...hs), Math.max(...hs)] : [0, 0];
}
// Default heat-exposure window: 2–3.5 h (the window used for AUC and in the manuscript), when the data cover it; otherwise the full range.
function defaultHours() {
  const [lo, hi] = hourRange();
  return lo <= 2 && hi >= 3.5 ? [2, 3.5] : [lo, hi];
}
// Whenever the loaded data change, filters reset to the defaults and manual exclusions are cleared.
function resetForData(sources) {
  const defaults = T.defaultFilterSelection(app.rows, sources);
  // The familiar SKKU comparison opens first (a view of all ~100 genotypes would only show a "too many curves" message).
  const pair = ['wild type', 'sma-9(wk55)'].filter((g) => app.rows.some((r) => sources.includes(r.source) && r.genotype === g));
  if (pair.length === 2) defaults.genotype = pair;
  app.settings = S.resetSettings(app.settings, { sources, defaults, dateRange: dateRange(), hourRange: defaultHours() });
  app.selected = null; app.question = null; app.pairing = { ...S.defaultPairing() }; app.auc = { reference: '', comparison: '' };
  refreshChoices(); syncControls(); app.update();
}
export async function loadSource(source, file) {
  try {
    const buffer = await file.arrayBuffer();
    const text = new TextDecoder('utf-8').decode(buffer);
    const frame = T.normaliseData(T.readCsv(text), source);
    if (!frame.rows.length) throw new Error('The file has a header but no rows.');
    app.frames[source] = frame;
    app.files[source] = { name: file.name, size: buffer.byteLength, sha256: await sha256(buffer) };
    rebuildRows();
    resetForData([source]);
    refreshFileList();
    toast(`${source}: ${frame.rows.length.toLocaleString('en-US')} rows loaded from ${file.name}.`);
  } catch (e) {
    toast(`Cannot use ${file.name} as the ${source} file: ${e.message} The previous data were kept.`, 'error', true);
  }
}
function removeSource(source) {
  delete app.frames[source]; delete app.files[source];
  rebuildRows();
  const left = Object.keys(app.frames);
  resetForData(left.length ? left : []);
  refreshFileList();
}
export async function loadGlossaryFiles(files) {
  const entries = [];
  for (const f of files) {
    try { const g = parseGlossaryFile(await f.text()); entries.push({ ...g, name: f.name }); }
    catch (e) { toast(`${f.name}: ${e.message}`, 'error', true); }
  }
  for (const g of entries) { app.glossary[g.kind] = g.rows; app.glossaryFiles = [...app.glossaryFiles.filter((x) => x.kind !== g.kind), { kind: g.kind, name: g.name }]; }
  if (entries.length) { refreshChoices(); refreshFileList(); app.update(); toast(`Glossary loaded (${entries.map((g) => g.name).join(', ')}).`); }
}

// ---- sidebar -------------------------------------------------------------------------------
const ctl = {};      // controls by name
const filterOption = (f, v) => ({ value: v, lines: [v, ...describeCode(app.glossary, f, v)], ...(f === 'genotype' && genotypeTag(v) ? { tag: genotypeTag(v) } : {}) });
const SHOWS_CONTROLS = new Set(['compare_periods', 'period_method', 'period_count']);
function onSetting(patch) {
  const keys = Object.keys(patch);
  if (keys.includes('cut_mode') || keys.includes('cut_date')) {
    // The date-cutoff shortcut only sets the assay-date range (and remembers how, so the figures can say so).
    Object.assign(app.settings, patch);
    app.settings.dates = S.cutRange(app.settings.cut_mode, app.settings.cut_date, dateRange());
    syncControls();
  } else if (keys.includes('dates')) {
    Object.assign(app.settings, patch, { cut_mode: 'all' });   // dates edited by hand: no cutoff is in use
    syncControls();
  } else Object.assign(app.settings, patch);
  if (keys.some((k) => SHOWS_CONTROLS.has(k))) syncControls();   // reveal or hide dependent controls
  app.update();
}

function askRowQuestion() {
  if (!Object.keys(app.frames).length) { toast('Load a data file first.', 'error'); return; }
  if (!app.question) app.question = { snapshot: JSON.parse(JSON.stringify(app.settings)) };   // so "Back to my view" can restore it
  const sources = ['SKKU', 'JHU'].filter((x) => app.frames[x]);
  Object.assign(app.settings, rowPositionSettings(app.rows, sources, dateRange()));
  syncControls(); app.update();
  toast(`${ROW_QUESTION.title} The sidebar now shows this question; change anything, or choose "Back to my view".`);
}
function leaveQuestion() {
  if (!app.question) return;
  app.settings = app.question.snapshot; app.question = null;
  syncControls(); app.update();
}

function buildSidebar() {
  const s = () => app.settings;
  const side = h('div', { class: 'filters' });
  // data
  const fileList = h('div', { class: 'file-list', id: 'file-list' });
  ctl.fileList = fileList;
  const pick = (source) => {
    const input = h('input', { type: 'file', accept: '.csv,text/csv', id: `file-${source}`, class: 'file-input', 'aria-label': `Choose ${source} CSV` });
    input.addEventListener('change', async () => { if (input.files[0]) await loadSource(source, input.files[0]); input.value = ''; });
    return input;
  };
  ctl.pickSKKU = pick('SKKU'); ctl.pickJHU = pick('JHU');
  const gl = h('input', { type: 'file', accept: '.csv,text/csv', multiple: true, id: 'file-glossary', class: 'file-input', 'aria-label': 'Choose glossary CSVs' });
  gl.addEventListener('change', async () => { await loadGlossaryFiles([...gl.files]); gl.value = ''; });
  ctl.projectButton = h('button', { type: 'button', class: 'btn quiet-button', id: 'load-project', text: 'Load project data folder', hidden: true, onclick: loadProjectData });
  // Bundled data (only shown when data/manifest.json lists datasets): one chooser per source slot.
  ctl.bundledBox = h('div', { class: 'bundled', id: 'bundled-data', hidden: true });
  side.append(h('div', { class: 'section-title', text: 'Data' }), ctl.bundledBox,
    h('div', { class: 'form-group' }, h('label', { class: 'control-label', for: 'file-SKKU', text: 'SKKU CSV' }), ctl.pickSKKU),
    h('div', { class: 'form-group' }, h('label', { class: 'control-label', for: 'file-JHU', text: 'JHU legacy CSV (optional)' }), ctl.pickJHU),
    h('div', { class: 'form-group' }, h('label', { class: 'control-label', for: 'file-glossary', text: 'Glossary CSVs (optional)' }), gl),
    ctl.projectButton, fileList,
    hint('Files are read in this browser and never uploaded. Choosing a file replaces the loaded one and resets the filters to their defaults.'),
    h('hr'));

  // preset questions
  ctl.questionRow = h('button', { type: 'button', class: 'btn', id: 'question-row', text: ROW_QUESTION.title, onclick: askRowQuestion });
  ctl.questionBack = h('button', { type: 'button', class: 'btn quiet-button', id: 'question-back', text: 'Back to my view', hidden: true, onclick: leaveQuestion });
  const within = checkbox('Also show the within-genotype comparison', false, (v) => onSetting({ row_within_genotype: v }), { id: 'row-within' }); ctl.rowWithin = within.input;
  ctl.questionHelp = h('button', { type: 'button', class: 'btn primary quiet-button', id: 'question-help', text: 'How to read these figures', onclick: () => openRowHelp(app) });
  side.append(h('div', { class: 'section-title', text: 'Questions' }), ctl.questionRow, ctl.questionBack, ctl.questionHelp, hint(ROW_QUESTION.text), within.el, h('hr'));
  side.append(h('div', { class: 'section-title', text: 'Build a comparison' }));
  const cmp = checkbox('Compare time periods', false, (v) => onSetting({ compare_periods: v }), { id: 'compare_periods' });
  ctl.compare = cmp.input;
  ctl.periodBox = h('div', { class: 'conditional', id: 'period-box' });
  ctl.periodMethod = h('div', { class: 'radio-group', role: 'radiogroup', 'aria-label': 'Periods from' },
    S.PERIOD_METHODS.map(([label, v]) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'period_method', value: v, onchange: () => onSetting({ period_method: v }) }), h('span', { text: label }))));
  ctl.periodCount = select([2, 3, 4, 5, 6].map((n) => [String(n), n]), 2, (v) => onSetting({ period_count: +v }), { id: 'period_count' });
  ctl.cutoffs = S.CUTOFF_LABELS.map((label, i) => {
    const input = h('input', { type: 'date', class: 'form-control', id: `cutoff${i}`, value: S.CUTOFF_DEFAULTS[i] });
    input.addEventListener('change', () => { const c = [...s().period_cutoffs]; c[i] = input.value; onSetting({ period_cutoffs: c }); });
    return { wrap: h('div', { class: 'form-group' }, h('label', { class: 'control-label', for: `cutoff${i}`, text: label }), input), input };
  });
  ctl.periodN = select(Array.from({ length: 9 }, (_, i) => [String(i + 2), i + 2]), 3, (v) => onSetting({ period_n: +v }), { id: 'period_n' });
  ctl.cutoffBlock = h('div', {}, field('Number of time periods', ctl.periodCount), ctl.cutoffs.map((c) => c.wrap),
    hint('Cutoffs must increase. Each cutoff starts the next period; dates before the first and after the last remain included.'));
  ctl.equalBlock = h('div', {}, field('Number of time periods', ctl.periodN),
    h('div', { id: 'period-help-balanced' }, hint('Consecutive periods balance observation counts in the current selection while keeping each assay date intact. Counts are pooled across selected strains; balance within each strain or in independent experiments is not guaranteed.')),
    h('div', { id: 'period-help-equal' }, hint('The distinct assay dates in the current selection are split, in order, into periods with near-equal numbers of dates. Works best with one strain selected; with several, the dates are pooled.')));
  ctl.periodSummary = h('div', { class: 'hint period-summary', id: 'period_summary' });
  ctl.periodBox.append(field('Periods from', ctl.periodMethod), ctl.cutoffBlock, ctl.equalBlock, ctl.periodSummary);
  side.append(cmp.el, ctl.periodBox);

  ctl.sources = h('div', { class: 'form-group', id: 'sources' }, h('div', { class: 'control-label', text: 'Data sources' }),
    ['SKKU', 'JHU'].map((src) => {
      const c = checkbox(SOURCE_LABELS[src], false, (v) => {
        const before = s().sources; const cur = new Set(before); v ? cur.add(src) : cur.delete(src);
        const after = ['SKKU', 'JHU'].filter((x) => cur.has(x));
        const patch = { sources: after };
        const bacteria = S.bacteriaOnSourceChange(app.rows, before, after, s().bacteria);   // untouched diet filter follows the sources
        if (bacteria) { patch.bacteria = bacteria; toast(`Bacterial diet filter is now ${bacteria.join(', ') || 'empty (all)'}, the default for the selected sources.`); }
        onSetting(patch); syncControls();
      }, { 'data-source': src });
      ctl[`src${src}`] = c.input; return c.el;
    }));
  side.append(ctl.sources);
  for (const f of S.FILTER_FIELDS) {
    ctl[f] = multiSelect({ onChange: (v) => onSetting({ [f]: v }), ...(f === 'genotype' ? { rank: genotypeRank, placeholder: 'All — type genes, e.g. tax-2 sma-9' } : {}) });
    ctl[f].input.id = `ms-${f}`;
    side.append(field(FIELD_LABELS[f], ctl[f].el, { tip: TIPS[f], id: `ms-${f}` }));
    if (f === 'bacteria') side.append(hint('JHU legacy data are all OP50, with standard configuration and synchronization; SKKU data are mostly OP50-1. Ticking a source adjusts this filter if you have not changed it. Select both diets to include both.'));
  }
  ctl.dateFrom = h('input', { type: 'date', class: 'form-control', id: 'date-from', 'aria-label': 'Assay dates from' });
  ctl.dateTo = h('input', { type: 'date', class: 'form-control', id: 'date-to', 'aria-label': 'Assay dates to' });
  const dateChange = () => onSetting({ dates: [ctl.dateFrom.value || null, ctl.dateTo.value || null] });
  ctl.dateFrom.addEventListener('change', dateChange); ctl.dateTo.addEventListener('change', dateChange);
  ctl.cutMode = select(S.DATE_CUT_MODES, 'all', (v) => onSetting({ cut_mode: v }), { id: 'cut-mode', 'aria-label': 'Date cutoff' });
  ctl.cutDate = h('input', { type: 'date', class: 'form-control', id: 'cut-date', value: S.DATE_CUT_DEFAULT, 'aria-label': 'Cutoff date' });
  ctl.cutDate.addEventListener('change', () => { if (ctl.cutDate.value) onSetting({ cut_date: ctl.cutDate.value }); });
  ctl.cutBox = h('div', { class: 'form-group', id: 'cut-box' }, h('div', { class: 'control-label', text: 'Date cutoff (shortcut)' }), ctl.cutMode, ctl.cutDate,
    hint(`Sets the assay dates above. ${S.DATE_CUT_DEFAULT} is the last assay date of the manuscript data.`));
  ctl.coverage = h('div', { class: 'hint date-coverage', id: 'date_coverage' });
  ctl.fullRange = h('button', { type: 'button', class: 'link-button', text: 'Use full range', onclick: () => { const r = dateRange(); onSetting({ dates: r }); syncControls(); } });
  const undated = checkbox('Include undated observations', false, (v) => onSetting({ undated: v }), { id: 'undated' }); ctl.undated = undated.input;
  ctl.hoursFrom = h('input', { type: 'range', id: 'hours-from', min: 0, max: 10, step: 0.5, 'aria-label': 'Heat exposure from' });
  ctl.hoursTo = h('input', { type: 'range', id: 'hours-to', min: 0, max: 10, step: 0.5, 'aria-label': 'Heat exposure to' });
  ctl.hoursText = h('div', { class: 'range-text', id: 'hours-text' });
  const hoursChange = (which) => () => {
    let a = +ctl.hoursFrom.value, b = +ctl.hoursTo.value;
    if (a > b) { if (which === 'from') a = b; else b = a; }
    onSetting({ hours: [a, b] }); syncHours();
  };
  ctl.hoursFrom.addEventListener('input', hoursChange('from')); ctl.hoursTo.addEventListener('input', hoursChange('to'));
  ctl.runs = multiSelect({ placeholder: 'All recorded runs', onChange: (v) => onSetting({ runs: v }) }); ctl.runs.input.id = 'ms-runs';
  side.append(h('div', { class: 'control-group' }, h('div', { class: 'group-title', text: 'Dates, hours & experiments' }),
    h('div', { class: 'form-group' }, h('div', { class: 'control-label', text: 'Assay dates' }), h('div', { class: 'date-pair' }, ctl.dateFrom, h('span', { text: 'to' }), ctl.dateTo)),
    h('div', { class: 'hint date-coverage-wrap' }, ctl.coverage, ctl.fullRange), ctl.cutBox, undated.el,
    h('div', { class: 'form-group' }, h('div', { class: 'control-label', text: 'Heat exposure (hours)' }), ctl.hoursFrom, ctl.hoursTo, ctl.hoursText),
    field('Recorded runs', ctl.runs.el, { id: 'ms-runs' })));
  const quality = checkbox('Apply existing analysis exclusions', true, (v) => onSetting({ quality: v }), { id: 'quality' }); ctl.quality = quality.input;
  side.append(quality.el, hint('Blank optional filters mean all. Filters combine by intersection.'),
    h('div', { class: 'button-row' }, h('button', { type: 'button', class: 'btn', id: 'example', text: 'Example comparison', onclick: () => resetFilters(true) }), h('button', { type: 'button', class: 'btn', id: 'clear', text: 'Clear filters', onclick: () => resetFilters(false) })),
    h('hr'), h('div', { class: 'section-title', text: 'Keep this view' }),
    h('button', { type: 'button', class: 'btn', id: 'save-view', text: 'Save view (.json)', onclick: saveView }),
    (() => { const i = h('input', { type: 'file', accept: '.json,application/json', id: 'restore-view', class: 'file-input', 'aria-label': 'Restore a saved view' }); i.addEventListener('change', async () => { if (i.files[0]) await restoreView(i.files[0]); i.value = ''; }); return field('Restore a saved view', i, { id: 'restore-view' }); })(),
    h('div', { class: 'hint', id: 'loaded_at' }));
  return side;
}

function syncHours() {
  const [a, b] = app.settings.hours;
  ctl.hoursFrom.value = a; ctl.hoursTo.value = b;
  ctl.hoursText.textContent = `${a} – ${b} h`;
}
function syncControls() {
  const s = app.settings;
  ctl.questionBack.hidden = !app.question; ctl.rowWithin.checked = s.row_within_genotype === true;
  ctl.compare.checked = s.compare_periods;
  ctl.periodBox.hidden = !s.compare_periods;
  ctl.periodMethod.querySelectorAll('input').forEach((i) => { i.checked = i.value === s.period_method; });
  ctl.periodCount.value = String(s.period_count); ctl.periodN.value = String(s.period_n);
  ctl.cutoffBlock.hidden = s.period_method !== 'cutoffs'; ctl.equalBlock.hidden = s.period_method === 'cutoffs';
  document.getElementById('period-help-balanced').hidden = s.period_method !== 'balanced';
  document.getElementById('period-help-equal').hidden = s.period_method !== 'equal';
  ctl.cutoffs.forEach((c, i) => { c.input.value = s.period_cutoffs[i]; c.wrap.hidden = i > 0 && i >= s.period_count - 1; });
  for (const src of ['SKKU', 'JHU']) { ctl[`src${src}`].checked = s.sources.includes(src); ctl[`src${src}`].disabled = !app.frames[src]; }
  for (const f of S.FILTER_FIELDS) ctl[f].setValue(s[f]);
  ctl.runs.setValue(s.runs);
  ctl.dateFrom.value = s.dates[0] || ''; ctl.dateTo.value = s.dates[1] || '';
  ctl.cutMode.value = s.cut_mode; ctl.cutDate.value = s.cut_date; ctl.cutDate.hidden = s.cut_mode === 'all';
  ctl.undated.checked = s.undated; ctl.quality.checked = s.quality;
  const [lo, hi] = hourRange(); for (const e of [ctl.hoursFrom, ctl.hoursTo]) { e.min = lo; e.max = hi; }
  syncHours();
  for (const c of app.sections) c.syncControls?.();
  document.getElementById('loaded_at').textContent = app.loadedAt ? `Loaded ${app.loadedAt.toLocaleString()}` : '';
}
export function refreshChoices() {
  for (const f of S.FILTER_FIELDS) {
    const values = T.sortUnique(app.rows.map((r) => r[f]));
    ctl[f].setOptions(values.map((v) => filterOption(f, v)));
  }
  ctl.runs.setOptions(T.sortUnique(app.rows.map((r) => r.run_id)).map((v) => ({ value: v, lines: [v] })));
  const lines = T.dateCoverageLines(app.rows);
  clear(ctl.coverage).append(h('div', { class: 'cov-title', text: 'Loaded data' }), ...lines.map((l) => h('div', { text: l })));
  for (const c of app.sections) c.refreshChoices?.();
}
function refreshFileList() {
  const box = clear(ctl.fileList);
  for (const src of ['SKKU', 'JHU']) {
    if (!app.files[src]) continue;
    box.append(h('div', { class: 'file-item', 'data-source': src }, h('div', {}, h('b', { text: `${src}: ` }), app.files[src].name), h('div', { class: 'hint', text: `${app.frames[src].rows.length.toLocaleString('en-US')} rows · SHA-256 ${app.files[src].sha256.slice(0, 12)}…` }),
      h('button', { type: 'button', class: 'link-button', text: 'Remove', onclick: () => removeSource(src) })));
  }
  for (const g of app.glossaryFiles) box.append(h('div', { class: 'file-item' }, h('div', {}, h('b', { text: 'Glossary: ' }), g.name)));
}

function resetFilters(example) {
  const s = app.settings;
  const all = Object.keys(app.frames).length ? ['SKKU', 'JHU'].filter((x) => app.frames[x]) : [];
  Object.assign(s, {
    sources: example ? (app.frames.SKKU ? ['SKKU'] : all) : all,
    genotype: example ? ['wild type', 'sma-9(wk55)'].filter((g) => app.rows.some((r) => r.genotype === g)) : [], strain: [],
    culture: example ? ['20°C'] : [], bacteria: example ? ['OP50-1'] : [], config: example ? ['standard'] : [], sync: [],
    runs: [], dates: dateRange(), cut_mode: 'all', cut_date: S.DATE_CUT_DEFAULT, hours: defaultHours(), undated: !example, date_selection: 'all', quality: true, compare_periods: false,
    period_cutoffs: [...S.CUTOFF_DEFAULTS], period_count: 2, period_method: 'cutoffs', period_n: 3, panel_page: 1, excluded: [],
  });
  app.selected = null;
  syncControls(); app.update();
}

// ---- saved views ------------------------------------------------------------------------------
function saveView() {
  const hashes = Object.fromEntries(Object.entries(app.files).map(([k, v]) => [k, v.sha256]));
  const files = Object.fromEntries(Object.entries(app.files).map(([k, v]) => [k, v.name]));
  const doc = S.viewDocument({ settings: app.settings, pairing: app.pairing, auc: app.auc, files, hashes, savedAt: new Date().toISOString() });
  doc.hash_algorithm = 'sha256';
  download(`thermo-view-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(doc, null, 2), 'application/json');
}
async function restoreView(file) {
  try {
    const view = JSON.parse(await file.text());
    const { settings: rawSettings, pairing, auc } = S.validateView(view);
    // Manual exclusions are row-based: apply them only when the loaded data match the fingerprints saved with the view.
    const loaded = Object.fromEntries(Object.entries(app.files).map(([k, v]) => [k, v.sha256]));
    const rec = S.reconcileRestoredView(view, rawSettings, loaded);
    const settings = rec.settings; const { status, withheld } = rec;
    app.settings = settings;
    app.pairing = pairing ? { ...S.defaultPairing(), ...pairing } : S.defaultPairing();
    app.auc = auc ? { reference: auc.reference, comparison: auc.comparison } : { reference: '', comparison: '' };
    app.selected = null;
    for (const f of S.FILTER_FIELDS) { const values = T.sortUnique([...app.rows.map((r) => r[f]), ...settings[f]]); ctl[f].setOptions(values.map((v) => filterOption(f, v))); }
    syncControls(); app.update();
    if (status === 'nodata') toast('View restored, but no data are loaded. Load your CSVs, then restore the view again.', 'warning', true);
    else if (status === 'differ') toast(`View restored, but source fingerprints differ from the data now loaded, so results may have changed.${withheld ? ` ${withheld} saved manual exclusion${withheld === 1 ? ' was' : 's were'} NOT applied, because row-based exclusions could remove different observations in a different file. Restore this view with the original CSV to apply ${withheld === 1 ? 'it' : 'them'}.` : ''}`, 'warning', true);
    else toast('View restored; source fingerprints match.');
  } catch (e) { toast(`Cannot restore this view: ${e.message}`, 'error', true); }
}

// ---- bundled data (data/manifest.json) ------------------------------------------------------------------
// The manifest lists CSVs shipped with the site. Each entry fills one source slot (SKKU or JHU); choosing another
// entry for the same slot replaces it. Every file is checked against its SHA-256 before use. With no manifest, or
// an empty one, nothing changes: the viewer asks for the user's own CSVs as before.
function validBundledManifest(m) {
  return m && m.manifest_version === 1 && Array.isArray(m.datasets)
    && m.datasets.every((d) => d && ['SKKU', 'JHU'].includes(d.source) && /^[\w.\-]+\.csv$/.test(d.file || '') && /^[0-9a-f]{64}$/.test(d.sha256 || '') && d.id && d.label);
}
async function fetchBundled(name, sha) {
  const r = await fetch(`data/${encodeURIComponent(name)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${name}: ${r.status}`);
  const buffer = await r.arrayBuffer();
  if (sha) { const got = await sha256(buffer); if (got !== sha) throw new Error(`${name} does not match its recorded SHA-256, so it was not loaded.`); }
  return new File([buffer], name, { type: 'text/csv' });
}
async function loadBundledDataset(entry) {
  try { await loadSource(entry.source, await fetchBundled(entry.file, entry.sha256)); app.bundledLoaded = { ...(app.bundledLoaded || {}), [entry.source]: entry.id }; }
  catch (e) { toast(`Could not load ${entry.label}: ${e.message}`, 'error', true); }
}
async function detectBundledData() {
  try {
    const r = await fetch('data/manifest.json', { cache: 'no-store' });
    if (!r.ok) return;
    const m = await r.json();
    if (!validBundledManifest(m)) { console.warn('data/manifest.json is not a valid manifest; ignoring it.'); return; }
    if (!m.datasets.length) return;
    app.bundled = m;
    const box = clear(ctl.bundledBox); box.hidden = false;
    box.append(h('div', { class: 'control-label', text: 'Bundled data' }));
    for (const src of ['SKKU', 'JHU']) {
      const entries = m.datasets.filter((d) => d.source === src); if (!entries.length) continue;
      const sel = select(entries.map((d) => [d.label, d.id]), (entries.find((d) => d.default) || entries[0]).id, async (v) => { await loadBundledDataset(entries.find((d) => d.id === v)); }, { id: `bundled-${src}`, 'aria-label': `Bundled ${src} data` });
      box.append(field(`${src} data`, sel));
    }
    box.append(hint('Shipped with this site. Choose a different entry to replace it, or load your own CSV below.'));
    // Open with the entries marked "default" (JHU first, so SKKU is the one shown with its own defaults).
    for (const src of ['JHU', 'SKKU']) { const d = m.datasets.find((x) => x.source === src && x.default); if (d) await loadBundledDataset(d); }
    if (m.glossary?.length) { try { await loadGlossaryFiles(await Promise.all(m.glossary.map((n) => fetchBundled(n)))); } catch (e) { console.warn(e.message); } }
  } catch { /* no manifest: file pickers only */ }
}

// ---- project data folder (only when launched with tools/preview.py) ------------------------------------
async function detectProjectData() {
  try {
    const r = await fetch('/__data__/index.json', { cache: 'no-store' });
    if (!r.ok) return;
    app.projectData = await r.json();
    ctl.projectButton.hidden = false;
  } catch { /* opened without the local server: file pickers only */ }
}
async function loadProjectData() {
  const fetchFile = async (name) => { const r = await fetch(`/__data__/${encodeURIComponent(name)}`, { cache: 'no-store' }); if (!r.ok) throw new Error(`${name}: ${r.status}`); return new File([await r.blob()], name, { type: 'text/csv' }); };
  try {
    const { sources, glossary } = app.projectData;
    if (glossary?.length) await loadGlossaryFiles(await Promise.all(glossary.map(fetchFile)));
    // Load JHU first so the SKKU file, the one chosen last, is the one shown with its own defaults.
    for (const src of ['JHU', 'SKKU']) if (sources[src]) await loadSource(src, await fetchFile(sources[src]));
  } catch (e) { toast(`Could not load the project data folder: ${e.message}`, 'error', true); }
}

// ---- page ----------------------------------------------------------------------------------------------
export function start() {
  const root = document.getElementById('app');
  const side = buildSidebar();
  const welcome = h('div', { class: 'card welcome', id: 'welcome' }, h('h2', { text: 'Choose your data to begin' }),
    h('p', { text: 'Choose the SKKU CSV in the sidebar (and, optionally, the JHU legacy CSV and the glossary CSVs). Everything is computed in this browser; no data leave this computer.' }),
    h('p', { class: 'hint', text: 'To update your data later, simply choose the newer CSV. A browser refresh clears the loaded files; choose them again. Saved views store settings, not data.' }));
  const metrics = h('div', { class: 'metrics', id: 'metrics' });
  const curves = createCurves(app); const rowfx = createRowEffect(app); const auc = createAuc(app); const pairing = createPairing(app); const detail = createDetail(app);
  const main = h('div', { class: 'main-content' }, welcome, metrics, curves.el, rowfx.el, auc.el, pairing.el, detail.el);
  // while a question is active, the AUC and paired-date cards (which say nothing about row position) are hidden
  app.sections = [
    { render(view) { welcome.hidden = !view.empty; metrics.hidden = !view.ok; for (const el of [curves.el, detail.el]) el.hidden = !!view.empty; for (const el of [auc.el, pairing.el]) el.hidden = !!view.empty || !!app.question; if (view.ok) renderMetrics(metrics, view); }, syncControls() {} },
    { render(view) { renderPeriodSummary(view); }, syncControls() {} },
    curves, rowfx, auc, pairing, detail,
  ];
  root.append(
    h('div', { class: 'topbar' }, h('div', {}, h('div', { class: 'eyebrow', text: 'THERMO / DATA WORKSPACE' }), h('h1', { text: 'Thermotolerance explorer' }), h('p', { text: 'Follow the curve. Find the experiment behind it.' })),
      h('span', { class: 'local-badge', text: 'RUNS IN YOUR BROWSER · NOTHING UPLOADED' })),
    h('div', { class: 'workspace' }, side, main),
    h('div', { class: 'footer' }, 'THERMOTOLERANCE EXPLORER', h('span', { text: 'Computed in your browser · traceable observations · reproducible views' })));
  app.syncAll = syncControls;
  refreshChoices(); syncControls(); detectProjectData(); detectBundledData();
  window.addEventListener('resize', debounce(() => app.update(), 200));
  render();
  window.thermo = app;   // handle for the browser tests
}
function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

function renderMetrics(el, view) {
  const d = view.data;
  const m = (n, label) => h('div', { class: 'metric' }, h('div', { class: 'metric-value', text: n.toLocaleString('en-US') }), h('div', { class: 'metric-label', text: label }));
  clear(el).append(m(d.length, 'observations'), m(new Set(d.map((r) => r.run_id)).size, 'recorded runs'),
    m(new Set(d.filter(T.plateIdentified).map((r) => r.plate_id)).size, 'plates'), m(new Set(d.map((r) => r.genotype)).size, 'genotypes'));
}
function renderPeriodSummary(view) {
  const box = clear(ctl.periodSummary);
  if (!view.ok || !app.settings.compare_periods) return;
  const lines = T.describeTimePeriods(view.data);
  if (!lines.length) return;
  box.append(h('div', { class: 'cov-title', text: 'Current selection' }), ...lines.map((x) => h('div', { class: 'period-line' }, h('div', { text: x.replace(/: [^:]*$/, '') }), h('div', { class: 'period-counts', text: x.replace(/^.*: /, '') }))));
}
