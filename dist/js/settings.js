// Analysis settings: defaults, the choices the controls offer, and validation of saved views.
// Names follow the R explorer (settings() in app.R) so the two stay comparable.
import { asArray, defaultFilterSelection } from './data.js';
import { parseDate, dayNumber, isoFromDay } from './rcompat.js';
import { validatePeriodCutoffs } from './periods.js';

export const GROUP_CHOICES = [['Genotype', 'genotype'], ['Strain', 'strain'], ['Bacterial diet', 'bacteria'], ['Culture temperature', 'culture'],
  ['Configuration', 'config'], ['Source', 'source'], ['Synchronization', 'sync'], ['Row position', 'row_position'], ['Rack', 'rack']];
export const FACET_CHOICES = [['Pooled view', 'none'], ['By experiment / date', 'run_id'], ['By date', 'date'], ['By culture temperature', 'culture'],
  ['By bacterial diet', 'bacteria'], ['By configuration', 'config'], ['By source', 'source'], ['By source and configuration', 'source_config'], ['By synchronization', 'sync'], ['By row position', 'row_position']];
export const MODES = [['Mean curves', 'mean'], ['Means + observations', 'points'], ['Plate curves', 'replicates'], ['Means + plate curves', 'both']];
export const UNITS = [['Equal observations (existing method)', 'plate'], ['Equal recorded runs', 'run']];
export const UNCERTAINTY = [['Standard error', 'se'], ['Standard deviation', 'sd'], ['95% confidence interval', 'ci95'], ['None', 'none']];
export const DATE_SELECTIONS = [['All selected dates', 'all'], ['Dates shared by every group', 'shared'], ['Overlapping date range', 'overlap']];
export const PERIOD_METHODS = [['Cutoff dates', 'cutoffs'], ['Equal numbers of assay dates', 'equal'], ['Balanced numbers of observations', 'balanced']];
export const CUTOFF_DEFAULTS = ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'];
export const CUTOFF_LABELS = ['First', 'Second', 'Third', 'Fourth', 'Fifth'].map((x) => `${x} cutoff`);
export const PAIRING_CUTOFF = '2026-09-01';
// Date-cutoff shortcut: shows only the assays up to and including, or after, one date. 2026-07-25 is the last assay date
// of the dataset behind the submitted manuscript. The shortcut only sets the assay-date range; cut_mode 'all' is the default.
export const DATE_CUT_DEFAULT = '2026-07-25';
export const DATE_CUT_MODES = [['All dates', 'all'], ['Up to and including the cutoff', 'upto'], ['After the cutoff', 'after']];
// The assay-date range a cutoff implies, given the first and last dates of the loaded data.
export function cutRange(mode, cut, span) {
  const c = parseDate(cut);
  if (c === null || mode === 'all' || !span || span[0] === null) return span;
  return mode === 'upto' ? [span[0], c] : [isoFromDay(dayNumber(c) + 1), span[1]];
}
// First and last assay date of the loaded rows: what "Use full range" sets.
export function dataDateSpan(rows) {
  let lo = null, hi = null;
  for (const r of rows) if (r.date !== null) { if (lo === null || r.date < lo) lo = r.date; if (hi === null || r.date > hi) hi = r.date; }
  return [lo, hi];
}
// What the figures say whenever the assay dates are narrower than the loaded data (empty string for the full range).
// A cutoff chosen with the shortcut is described as such; any other restriction states the dates themselves.
export function dateRangeNote(s, span) {
  const d = asArray(s.dates);
  if (d.length !== 2 || d[0] === null || d[1] === null || !span || span[0] === null) return '';
  const c = parseDate(s.cut_date);
  if (c !== null && s.cut_mode === 'upto' && d[1] === c) return `Assays up to and including ${c} only`;
  if (c !== null && s.cut_mode === 'after' && d[0] === isoFromDay(dayNumber(c) + 1)) return `Assays after ${c} only`;
  if (d[0] <= span[0] && d[1] >= span[1]) return '';
  return `Assay dates ${d[0]} to ${d[1]} only`;
}

export const FILTER_FIELDS = ['genotype', 'strain', 'culture', 'bacteria', 'config', 'sync'];

// Ticking or unticking a data source: the Bacterial diet filter follows the defaults for the new set of sources (JHU is OP50,
// SKKU mostly OP50-1), but only if it still equals the default for the old set, i.e. the user has not changed it.
// Returns the new filter values, or null when nothing should change.
export function bacteriaOnSourceChange(rows, oldSources, newSources, current) {
  const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  if (!same(asArray(current), defaultFilterSelection(rows, oldSources).bacteria)) return null;
  const next = defaultFilterSelection(rows, newSources).bacteria;
  return same(next, asArray(current)) ? null : next;
}

export function defaultSettings() {
  return {
    sources: [], genotype: [], strain: [], culture: [], bacteria: [], config: [], sync: [], dates: [null, null], hours: [0, 0], runs: [], undated: false,
    quality: true, excluded: [], group: 'genotype', date_selection: 'all', facet: 'none', mode: 'points', unit: 'plate', uncertainty: 'se', panel_page: 1,
    compare_periods: false, period_method: 'cutoffs', period_count: 2, period_cutoffs: [...CUTOFF_DEFAULTS], period_n: 3,
    cut_mode: 'all', cut_date: DATE_CUT_DEFAULT, row_within_genotype: false,
  };
}
export function defaultPairing() {
  return { dimension: 'strain', reference: '', comparison: '', cutoff: PAIRING_CUTOFF, hour: '', stratum: '', same_experiment: true, separate_males: true, allow_unknown: false, complete_only: false, page: 1 };
}

// The settings object handed to the calculations (cutoffs trimmed to the chosen number of periods).
export function analysisSettings(s) {
  return { ...s, period_cutoffs: s.period_cutoffs.slice(0, Math.max(1, s.period_count - 1)) };
}

// Fresh choices when data change: dates/hours span the loaded data; conditions take the defaults.
export function resetSettings(base, { sources, defaults, dateRange, hourRange }) {
  return { ...defaultSettings(), group: base.group, facet: base.facet, mode: base.mode, unit: base.unit, uncertainty: base.uncertainty,
    sources, ...defaults, dates: dateRange, hours: hourRange };
}

// Validation of a saved view, mirroring restore_view in app.R. Returns the cleaned settings or throws.
export function validateView(view, { groups = GROUP_CHOICES, facets = FACET_CHOICES } = {}) {
  const fail = (m) => { throw new Error(m); };
  if (!view || typeof view !== 'object' || view.schema_version !== 1) fail('This is not a saved view of this explorer (schema_version 1 expected).');
  const s = view.settings;
  if (!s || typeof s !== 'object') fail('The saved view has no settings.');
  const cutoffs = validatePeriodCutoffs(asArray(s.period_cutoffs ?? s.period_cutoff ?? '2026-07-01'));
  const dates = asArray(s.dates), hours = asArray(s.hours);
  if (s.cut_mode != null && !DATE_CUT_MODES.some((x) => x[1] === s.cut_mode)) fail('The saved date-cutoff choice is not recognised.');
  if (s.cut_date != null && parseDate(s.cut_date) === null) fail('The saved date cutoff is not valid.');
  if (dates.length !== 2 || dates.some((d) => parseDate(d) === null)) fail('The saved assay dates are not valid.');
  if (hours.length !== 2 || hours.some((h) => !Number.isFinite(h)) || hours[0] > hours[1]) fail('The saved heat-exposure range is not valid.');
  const oneOf = (v, list, what) => { if (!list.includes(v)) fail(`The saved ${what} is not recognised.`); };
  oneOf(s.group, groups.map((x) => x[1]), 'Color / compare choice');
  oneOf(s.facet, facets.map((x) => x[1]), 'panel arrangement');
  oneOf(s.mode, MODES.map((x) => x[1]), 'display mode');
  oneOf(s.unit, UNITS.map((x) => x[1]), 'weighting');
  oneOf(s.uncertainty, UNCERTAINTY.map((x) => x[1]), 'error-bar choice');
  if (s.date_selection != null) oneOf(s.date_selection, DATE_SELECTIONS.map((x) => x[1]), 'date selection');
  if (s.period_method != null) oneOf(s.period_method, PERIOD_METHODS.map((x) => x[1]), 'period method');
  if (s.period_n != null && !(Number.isInteger(+s.period_n) && +s.period_n >= 2 && +s.period_n <= 10)) fail('The saved number of periods is not valid.');
  const out = defaultSettings();
  for (const f of ['sources', ...FILTER_FIELDS, 'runs', 'excluded']) out[f] = asArray(s[f]).map(String);
  Object.assign(out, {
    dates: dates.map((d) => parseDate(d)), hours: hours.map(Number), undated: s.undated === true, quality: s.quality === true,
    group: s.group, facet: s.facet, mode: s.mode, unit: s.unit, uncertainty: s.uncertainty, date_selection: s.date_selection ?? 'all',
    panel_page: Math.max(1, Math.trunc(Number(s.panel_page ?? 1)) || 1), compare_periods: s.compare_periods === true,
    period_method: s.period_method ?? 'cutoffs', period_n: Math.trunc(Number(s.period_n ?? 3)), period_count: cutoffs.length + 1,
    period_cutoffs: [...cutoffs, ...CUTOFF_DEFAULTS.slice(cutoffs.length)],
    row_within_genotype: s.row_within_genotype === true,
    cut_mode: s.cut_mode ?? 'all', cut_date: s.cut_date != null ? parseDate(s.cut_date) : DATE_CUT_DEFAULT,
  });
  const pairing = s.pairing && typeof s.pairing === 'object' ? s.pairing : null;
  if (pairing) {
    if (!['strain', 'genotype', 'config', 'sync'].includes(pairing.dimension) || !pairing.reference || !pairing.comparison || pairing.reference === pairing.comparison || parseDate(pairing.cutoff) === null) fail('The saved paired-date comparison is not valid.');
  }
  const auc = s.auc && typeof s.auc === 'object' ? s.auc : null;
  if (auc && (!auc.reference || !auc.comparison || auc.reference === auc.comparison)) fail('The saved AUC comparison is not valid.');
  return { settings: out, pairing, auc };
}

// What a saved view contains (settings only; data stay in the CSV files).
export function viewDocument({ settings, pairing, auc, files, hashes, savedAt }) {
  const s = { ...analysisSettings(settings) };   // only the active cutoffs are saved, as in the R explorer's views
  delete s.period_count;
  if (pairing && pairing.reference && pairing.comparison && pairing.reference !== pairing.comparison) s.pairing = pairing;
  if (auc && auc.reference && auc.comparison && auc.reference !== auc.comparison) s.auc = auc;
  return { schema_version: 1, saved_at: savedAt, files, hashes, settings: s };
}

// Restoring a saved view: manual exclusions are row-based, so they are applied only when the data now loaded are the data the view
// was saved with (same SHA-256 fingerprints). Otherwise they are withheld and counted, and the other settings are still restored.
export function reconcileRestoredView(view, settings, loadedHashes) {
  const saved = view.hashes || {};
  const keys = Object.keys(loadedHashes);
  const hasData = keys.length > 0;
  const match = view.hash_algorithm === 'sha256' && hasData && keys.every((k) => saved[k] === loadedHashes[k]) && Object.keys(saved).every((k) => loadedHashes[k] === saved[k]);
  const status = !hasData ? 'nodata' : match ? 'match' : 'differ';
  const excluded = Array.isArray(settings.excluded) ? settings.excluded : [];
  const withheld = status === 'differ' ? excluded.length : 0;
  return { status, withheld, settings: withheld ? { ...settings, excluded: [] } : settings };
}
