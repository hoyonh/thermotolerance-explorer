// Detail tabs: point inspector, observations, summary, glossary, methods & provenance.
import { h, clear, hint, tabs, dataTable, toast } from './ui.js';
import { asCharacter, orderBy, sortUnique } from './rcompat.js';
import { plateIdentified, repeatCounts, SOURCE_FILES } from './data.js';
import { GLOSSARY_HEADINGS, configParts } from './glossary.js';
import { safePage } from './pipeline.js';
import { message } from './view-curves.js';

const DETAIL_COLUMNS = ['observation_id', 'date', 'expt', 'row', 'hours', 'strain', 'genotype', 'survival_pct', 'alive', 'dead', 'Rup', 'suicide', 'missing', 'note'];
const ROWS_PER_PAGE = 25;

export function createDetail(app) {
  const inspector = h('div', { id: 'point_detail' });
  const exclusionText = h('div', { class: 'hint', id: 'excluded_count' });
  const plateBox = h('div', { id: 'plate_detail' });
  const inspectorPane = h('div', {}, inspector,
    h('div', { class: 'button-row' }, h('button', { type: 'button', class: 'btn', id: 'exclude_point', text: 'Exclude selected observation', onclick: excludeSelected }),
      h('button', { type: 'button', class: 'btn', id: 'clear_exclusions', text: 'Clear manual exclusions', onclick: () => { app.settings.excluded = []; app.update(); } })),
    exclusionText, plateBox);

  let search = ''; let page = 1;
  const searchInput = h('input', { type: 'text', class: 'form-control', id: 'row_search', placeholder: 'Strain, date, note, experiment…', 'aria-label': 'Search selected rows' });
  searchInput.addEventListener('input', () => { search = searchInput.value; page = 1; pageInput.value = 1; renderRows(); });
  const pageInput = h('input', { type: 'number', class: 'form-control', id: 'row_page', min: 1, step: 1, value: 1, 'aria-label': 'Page (25 rows)' });
  pageInput.addEventListener('change', () => { page = Math.trunc(+pageInput.value) || 1; renderRows(); });
  const rowCount = h('div', { class: 'hint', id: 'row_count' });
  const rowTable = h('div', { id: 'rows' });
  const rowsPane = h('div', {}, h('div', { class: 'table-controls' }, h('div', { class: 'form-group' }, h('label', { class: 'control-label', for: 'row_search', text: 'Search selected rows' }), searchInput),
    h('div', { class: 'form-group' }, h('label', { class: 'control-label', for: 'row_page', text: 'Page (25 rows)' }), pageInput)), rowCount, rowTable);
  const summaryPane = h('div', { id: 'summary_table' });
  const glossaryPane = h('div', { id: 'glossary_tab' });
  const methodsPane = h('div', { id: 'methods' });

  const ts = tabs([{ id: 'inspector', label: 'Point inspector' }, { id: 'rows', label: 'Observations' }, { id: 'summary', label: 'Summary' }, { id: 'glossary', label: 'Glossary' }, { id: 'methods', label: 'Methods & provenance' }], { onSelect: () => {} });
  ts.panes[0].append(inspectorPane); ts.panes[1].append(rowsPane); ts.panes[2].append(summaryPane); ts.panes[3].append(glossaryPane); ts.panes[4].append(methodsPane);
  const el = h('div', { class: 'card detail-card', id: 'detail-card' }, ts.el);

  let lastView = null;
  const orderedRows = (view) => {
    const q = search.trim().toLowerCase();
    let d = view.data;
    if (q) d = d.filter((r) => DETAIL_COLUMNS.some((c) => String(asCharacter(r[c]) ?? '').toLowerCase().includes(q)));
    return orderBy(d, [[(r) => r.date, 'number'], [(r) => (typeof r.expt === 'number' ? r.expt : asCharacter(r.expt)), 'collate'], [(r) => r.row, 'number'], [(r) => r.hours, 'number']]);
  };
  function renderRows() {
    if (!lastView?.ok) return;
    const d = orderedRows(lastView); const pages = Math.max(1, Math.ceil(d.length / ROWS_PER_PAGE));
    page = safePage(page, pages); pageInput.value = page;
    rowCount.textContent = `${d.length} matching rows · ${pages} pages`;
    clear(rowTable).append(dataTable(d.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE), DETAIL_COLUMNS));
  }
  function selectedRow(view) { return app.selected && !app.selected.startsWith('mean::') ? view.data.find((r) => r.observation_id === app.selected) : null; }
  function excludeSelected() {
    const row = lastView?.ok ? selectedRow(lastView) : null;
    if (!row) { toast('Click an individual observation first.'); return; }
    app.settings.excluded = [...new Set([...app.settings.excluded, row.observation_id])];
    app.update();
  }
  function renderInspector(view) {
    clear(inspector); clear(plateBox);
    exclusionText.textContent = `${app.settings.excluded.length} manually excluded observations in this view.`;
    if (!view.ok) { inspector.append(message(view.message)); return; }
    const key = app.selected;
    if (key === null) { inspector.append(h('div', { class: 'empty-detail' }, h('h3', { text: 'Every point has a story.' }), h('p', { text: 'Click an observation to inspect its original counts, assay notes and plate time course. Click a mean point to see its summary.' }))); return; }
    if (key.startsWith('mean::')) {
      const s = view.summary.find((x) => `mean::${x.panel}::${x.curve}::${x.hours}` === key);
      if (!s) { inspector.append(h('p', { text: 'The selected mean is outside the current filters.' })); return; }
      inspector.append(h('h3', { text: `${s.curve} · ${s.hours} hours` }), h('p', { text: `Mean ${s.mean.toFixed(2)}% · ${s.n_observations} observations · ${s.n_runs} recorded runs · SE ${Number.isFinite(s.se) ? (Math.round(s.se * 100) / 100) : 'undefined'}` }));
      return;
    }
    const r = selectedRow(view);
    if (!r) { inspector.append(h('p', { text: 'The selected observation is excluded or outside the current filters.' })); return; }
    const meaning = describeConfig(app, r.config);
    inspector.append(...[h('h3', { text: `${r.strain} · ${r.date ?? 'undated'} · ${r.hours} hours` }), h('p', { text: `${r.genotype} | ${r.culture} | ${r.bacteria} | ${r.config}` }),
      meaning ? hint(meaning) : null,
      h('p', { text: `Survival ${r.survival_pct.toFixed(2)}% · alive ${r.alive} · dead ${r.dead} · ruptured ${r.Rup} · suicide ${r.suicide} · missing ${r.missing}` }),
      h('p', { text: `Original strain: ${asCharacter(r.raw_strain) ?? 'NA'} · original diet: ${asCharacter(r.raw_bacteria) ?? 'NA'}` }),
      h('p', { text: `Source: ${SOURCE_FILES[r.source]} · data row ${r.source_row} · experiment ${asCharacter(r.expt) ?? 'NA'} · row ${asCharacter(r.row) ?? 'NA'}` }),
      h('p', { text: `Note: ${r.note ? r.note : '—'}` }),
      plateIdentified(r) ? null : hint('Date, experiment or row not recorded, so this observation is not assigned to a plate.')].filter(Boolean));
    if (plateIdentified(r)) plateBox.append(dataTable(orderBy(view.data.filter((x) => x.plate_id === r.plate_id), [[(x) => x.hours, 'number']]), DETAIL_COLUMNS));
  }
  function renderGlossary() {
    const g = app.glossary; clear(glossaryPane);
    if (!g.terms.length && !g.configs.length) { glossaryPane.append(h('p', { text: 'No glossary is loaded. Choose data/glossary.csv and data/config_glossary.csv under “Glossary CSVs (optional)” in the sidebar to see plain-language meanings of the condition codes here and in the filters.' })); return; }
    const table = (header, rows) => h('table', { class: 'data-table glossary-table' }, h('thead', {}, h('tr', {}, header.map((x) => h('th', { text: x })))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c))))));
    const code = (t) => h('code', { text: t });
    const inData = sortUnique(app.rows.map((r) => r.config));
    const codes = inData.length ? inData : g.configs.map((c) => c.config);
    const configRows = codes.map((c) => {
      const row = g.configs.find((x) => x.config === c); const inc = ['bare', 'cfloor'].includes(c) ? c : 'standard';
      if (!row) return [code(c), ['bare', 'cfloor', 'standard'].includes(c) ? '' : h('em', { text: 'Not in config_glossary.csv' }), inc, '', '', ''];
      return [code(c), row.label1, inc, row.synchronization, row.growth, row.assay];
    });
    const cats = [...new Set([...Object.keys(GLOSSARY_HEADINGS).filter((k) => g.terms.some((t) => t.category === k)), ...g.terms.map((t) => t.category)])];
    glossaryPane.append(h('p', { text: 'Plain-language meanings of the condition codes used in the filters. Open a Bacterial diet, Configuration or Synchronization filter to see the same meanings next to each code.' }),
      h('h3', { text: 'Configuration codes' }),
      hint('A configuration code gives two things: the incubator setup, and how the worms and plates were prepared (synchronization, growth plate, assay plate). Every assay used the standard incubator setup (inner container on a rack) unless the code is bare or cfloor.'),
      table(['Code', 'Plot label', 'Incubator', 'Synchronization', 'Growth plate', 'Assay plate'], configRows),
      ...cats.map((cat) => [h('h3', { text: GLOSSARY_HEADINGS[cat] ?? cat[0].toUpperCase() + cat.slice(1) }),
        table(['Code', 'Meaning'], g.terms.filter((t) => t.category === cat).map((t) => [code(t.item), t.definition]))]).flat());
  }
  let repeatCache = { version: -1, rows: [] };
  function renderMethods() {
    clear(methodsPane);
    if (repeatCache.version !== app.version) repeatCache = { version: app.version, rows: repeatCounts(app.rows) };
    const n = repeatCache.rows.length;
    methodsPane.append(
      h('h3', { text: 'What the curves mean' }),
      h('p', { text: 'Survival = 100 × alive / (alive + dead). Ruptured, suicide and missing counts are retained for inspection but excluded from this denominator, matching the existing plotting code. Lines join observed times; they are not fitted survival models.' }),
      h('p', { text: 'The default mean gives each recorded observation equal weight at each time. SE = SD / √n. The 95% confidence interval is mean ± t(0.975, n − 1) × SE, where n is the number of units averaged (observations, or runs when weighting by run); it is shown as an error-bar option and as the ci95 half-width column of Summary. Equal recorded runs first averages observations within each source/date/experiment, then averages those run means. A run identifier does not establish biological independence. One unit has undefined SD/SE and no error bar.' }),
      h('h3', { text: 'Default exclusions' }),
      h('p', { text: 'All sources: total across all five count categories must be at least 15. SKKU: exclude the exact note ‘10 total’. JHU: exclude IW938cuz_4G, notes matching room_temp_high_setup, donotuse, odd_result_all or special_N2, and temperature-shift strain annotations. The checkbox controls these rules; invalid or negative/non-integer counts, invalid times and zero denominators are always omitted.' }),
      h('h3', { text: 'Labels and replicate identity' }),
      h('p', { text: 'SKKU diet labels follow the existing import convention: raw OP50 → OP50-1 and raw plain → OP50. CB1370-SNU → CB1370. Strain suffixes after a space are removed for display. JHU culture and two genotype spellings are normalized as in the existing loader. All original labels remain in raw_* export columns. Lab-confirmed JHU metadata: bacterial diet OP50, configuration standard, and synchronization standard; these annotations apply to all JHU observations. Missing source values remain ‘Not recorded’ in raw_* columns. N2, N2.therm and N2.thaw remain distinct strains.' }),
      h('p', { text: 'A plate is source + date + experiment + row + raw strain + culture + diet + configuration + synchronization. Several counts from one plate at the same hour are independent counts: each enters every summary, and the plate line passes through their mean. Observations without a date, experiment or row cannot be assigned to a plate; they are shown as points without a plate line and still enter every summary. Nothing is removed. Row position groups and panels use the recorded row (e.g. 5.5 for a plate placed between rows 5 and 6).' }),
      h('h3', { text: 'Repeat counts at the same plate and hour' }),
      hint(n ? `${n} plate/hour combinations in the loaded data have more than one count. All counts enter the analysis; this list is for checking data entry${n > 200 ? ' (first 200 shown).' : '.'}` : 'No plate has more than one count at the same hour in the loaded data.'),
      dataTable(repeatCache.rows.slice(0, 200), ['source', 'date', 'expt', 'row', 'strain', 'hours', 'counts', 'alive_dead', 'notes']),
      h('h3', { text: 'Reproducibility' }),
      h('p', { text: 'Source CSVs are read only when chosen. Saved views contain filters, manual exclusions, plotting settings and source SHA-256 fingerprints. Reopening a view warns if the data changed; a view does not contain a data snapshot. Download Selected data CSV to preserve the included observations. This explorer performs descriptive analysis; it does not calculate significance tests.' }),
      h('pre', { class: 'provenance', id: 'provenance', text: JSON.stringify({ files: Object.fromEntries(Object.entries(app.files).map(([k, v]) => [k, v.name])), sha256: Object.fromEntries(Object.entries(app.files).map(([k, v]) => [k, v.sha256])), loaded: app.loadedAt?.toISOString() ?? null }, null, 2) }));
  }
  document.addEventListener('thermo:select', () => { ts.show(0); if (lastView) renderInspector(lastView); });
  return {
    el,
    render(view) {
      lastView = view;
      renderInspector(view);
      if (view.ok) { renderRows(); clear(summaryPane).append(dataTable(view.summary.slice(0, 100), ['panel', 'curve', 'hours', 'mean', 'sd', 'se', 'ci95', 'n_units', 'n_observations', 'n_runs', 'n_plates', 'unit']), hint('First 100 rows shown. Download Summary CSV for the complete table.')); }
      else { clear(rowTable).append(message(view.message)); clear(summaryPane).append(message(view.message)); rowCount.textContent = ''; }
      renderGlossary(); renderMethods();
    },
  };
}
function describeConfig(app, code) {
  const parts = configParts(app.glossary, code);
  return parts.length ? parts.map(([k, v]) => (k === 'Label' ? v : `${k}: ${v}`)).join(' · ') : '';
}
