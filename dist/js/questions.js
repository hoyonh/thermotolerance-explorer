// Preset questions: each one sets up the sidebar for a single scientific question (like the genetic questions of the
// MAD viewer). A question only changes settings the user can see and change afterwards; "Back to my view" restores them.
import { defaultFilterSelection } from './data.js';
import { rCompare } from './rcompat.js';

export const ROW_QUESTION = {
  id: 'row_position',
  title: 'Does row position matter?',
  text: 'Curves by transfer order, one panel per source and configuration. Details: How to read these figures.',
};

// Settings changes for the row-position question, given the loaded rows and sources.
export function rowPositionSettings(rows, sources, dateSpan) {
  const mine = rows.filter((r) => sources.includes(r.source));
  const has = (field, v) => mine.some((r) => r[field] === v);
  return {
    sources: [...sources], genotype: [], strain: [], runs: [], culture: ['20°C'].filter((v) => has('culture', v)),
    bacteria: defaultFilterSelection(rows, sources).bacteria, config: ['standard', 'bare'].filter((v) => has('config', v)),
    sync: ['standard'].filter((v) => has('sync', v)), dates: dateSpan, cut_mode: 'all', undated: true, hours: [2, 3.5], date_selection: 'all',
    group: 'row_position', facet: 'source_config', mode: 'mean', uncertainty: 'none', compare_periods: false, panel_page: 1, row_within_genotype: true,
  };
}

// Observation counts behind each row's curve: the notice that keeps thin rows from being over-read.
export const THIN = 10;
export function rowCountNote(summary) {
  const by = new Map();
  for (const x of summary) {
    if (!by.has(x.panel)) by.set(x.panel, new Map());
    const m = by.get(x.panel); m.set(x.curve, Math.min(m.get(x.curve) ?? Infinity, x.n_observations));
  }
  const parts = [];
  for (const panel of [...by.keys()].sort(rCompare)) {
    const m = by.get(panel); const ns = [...m.values()];
    const thin = [...m].filter(([, n]) => n < THIN).map(([c]) => c).sort(rCompare);
    parts.push(`${panel}: ${Math.min(...ns)}–${Math.max(...ns)}${thin.length ? ` (under ${THIN} at ${thin.slice(0, 6).join(', ')}${thin.length > 6 ? ` and ${thin.length - 6} more` : ''})` : ''}`);
  }
  return parts.length ? `Fewest observations at any hour, per row — ${parts.join('; ')}. Rows with few observations are not reliable.` : '';
}

// ---- the "How to read these figures" text -------------------------------------------------------------------------------
import { filtered, decorated, curveSummary } from './pipeline.js';
import { defaultSettings } from './settings.js';
import { rowEffect, THIN_N } from './rowfx.js';

const LIVE_MIN = 30;   // rows with fewer observations are left out of the descriptive numbers
const sign = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v * 10) / 10)}`;

// Descriptive numbers for the question's own selection (recomputed from the loaded files; independent of later sidebar edits).
export function rowLiveNumbers(rows, sources, dateSpan) {
  if (!rows.length || !sources.length) return [];
  const patch = rowPositionSettings(rows, sources, dateSpan);
  let f; try { f = filtered(rows, { ...defaultSettings(), ...patch }); } catch { return []; }
  const dec = decorated(f.data, f.settings); const summary = curveSummary(dec, f.settings); const effect = rowEffect(f.data);
  const panels = [...new Set(dec.rows.map((r) => r.panel))].sort(rCompare); const lines = [];
  for (const panel of panels) {
    const parts = [];
    // recorded rows with at least LIVE_MIN observations: the extremes of a handful of plates would mislead
    const total = new Map(); for (const x of summary.filter((y) => y.panel === panel)) total.set(x.curve, (total.get(x.curve) ?? 0) + x.n_observations);
    const solid = (curve) => /^Row \d/.test(curve) && (total.get(curve) ?? 0) >= LIVE_MIN;
    const at3 = summary.filter((x) => x.panel === panel && x.hours === 3 && solid(x.curve)).sort((a, b) => rCompare(a.curve, b.curve));
    if (at3.length >= 2) { const first = at3[0], last = at3.at(-1); parts.push(`mean survival at 3 h ${last.mean < first.mean ? 'falls' : 'rises'} from ${Math.round(first.mean * 10) / 10}% in ${first.curve} to ${Math.round(last.mean * 10) / 10}% in ${last.curve}`); }
    const eff = effect.filter((x) => x.panel === panel && x.n_obs >= LIVE_MIN && Number.isFinite(x.genotype_adjusted));
    if (eff.length >= 2) {
      const hi = eff.reduce((a, b) => (b.genotype_adjusted > a.genotype_adjusted ? b : a)), lo = eff.reduce((a, b) => (b.genotype_adjusted < a.genotype_adjusted ? b : a));
      parts.push(`within genotype, highest at row ${hi.row} (${sign(hi.genotype_adjusted)} points) and lowest at row ${lo.row} (${sign(lo.genotype_adjusted)} points)`);
    }
    if (parts.length) lines.push(`${panel}: ${parts.join('; ')}.`);
  }
  return lines;
}

// Sections of the dialog: { heading, paragraphs, items, live }.
export function rowHelpSections(live) {
  return [
    { heading: 'What is compared', paragraphs: [
      'Row position is the plate’s place in the incubator, counted left to right through one rack and then the next. SKKU: rows 1–6 are the first rack and rows 7–12 the second. JHU: rows 1–11 are the first rack and rows 12 and up the second (a separate shelf below).',
      'Each panel is one source and configuration: SKKU bare (assays without the inner container), SKKU standard (with the inner container, which limits capacity to six rows) and JHU standard (no inner container was ever used). All genotypes are pooled. Conditions are 20°C, standard synchronization and heat exposures of 2–3.5 h.',
      'The within-genotype comparison appears below the curves. While this question is shown, the AUC and paired-date cards are hidden; choose “Back to my view” to return to them.'] },
    { heading: 'Survival curves', paragraphs: [
      'One curve per row, showing mean survival at each heat exposure (no error bars). Dashed curves are the second rack. If row position does not matter, the curves in a panel lie on top of each other; if it matters, they fan out.',
      'The notice above the figure gives the fewest observations per row. Rows with fewer than 10 observations are not reliable.'] },
    { heading: 'Row effect within genotype', paragraphs: [
      'Pooling genotypes could mislead if different strains sit in different rows. This figure compares each observation with the mean of the same genotype at the same heat exposure (same source and configuration), and then averages by row. It is a descriptive adjustment for average genotype differences, not a test of cause, and it follows the sidebar filters.'],
      items: ['Zero: the same as that genotype’s own mean. Above zero: the plates survive better than that genotype does on average; below zero: worse.',
        'Black line: every row in which the genotype was measured. Blue dashed line: stricter, using only the same genotype within the same recorded run (date and experiment).',
        'Hollow points have fewer than 30 observations. The dashed vertical line is the boundary between the two racks.'] },
    { heading: 'What the current data show', live: true, paragraphs: live.length
      ? ['Descriptive numbers for the question’s own settings, recomputed from the loaded files. Rows with fewer than 30 observations are left out, so a few plates cannot set the extremes:'] : ['Load data to see numbers here.'], items: live },
    { heading: 'Things to keep in mind', items: [
      'The figures show a pattern, not its cause. A trend across rows may reflect the position in the incubator or anything else that varies with row.',
      'Some rows have few observations. Hover over a point for its count, or see the table under the within-genotype figure.',
      'The container history and the rack layout come from the lab’s records, not from the data files.'] },
  ];
}
