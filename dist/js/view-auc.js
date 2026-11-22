// AUC card: all-selected AUC and date-paired AUC (trapezoid over 2–3.5 h).
import { h, clear, hint, field, setOptions, tabs, dataTable, download } from './ui.js';
import { allSelectedAuc, completeDateAuc, summarisePairedAuc, AUC_HOURS } from './auc.js';
import { asCharacter, sortUnique } from './rcompat.js';
import { toCsv } from './csvout.js';
import { message } from './view-curves.js';

export function createAuc(app) {
  const refSel = h('select', { class: 'form-control', id: 'auc-reference', 'aria-label': 'Reference group' });
  const cmpSel = h('select', { class: 'form-control', id: 'auc-comparison', 'aria-label': 'Comparison group' });
  refSel.addEventListener('change', () => { app.auc.reference = refSel.value; app.update(); });
  cmpSel.addEventListener('change', () => { app.auc.comparison = cmpSel.value; app.update(); });
  const allBox = h('div', { id: 'auc_all' }); const allBar = h('div', { class: 'export-bar' });
  const coverage = h('div', { id: 'auc_coverage' }); const sumBox = h('div', { id: 'auc_paired_summary' }); const datesBox = h('div', { id: 'auc_paired_dates' }); const auditBox = h('div', { id: 'auc_audit' });
  const pairedBar = h('div', { class: 'export-bar' });
  const ts = tabs([{ id: 'all', label: 'All selected data' }, { id: 'paired', label: 'Paired AUC (date-level)' }]);
  ts.panes[0].append(allBox, hint('AUC of each group\'s mean curve. All available observations at each required hour contribute; the contributing dates can differ across hours. A missing required hour gives an undefined AUC. Mean survival is AUC / 1.5 h. With the default Equal observations weighting, mean_survival_pct is the AUCnorm used in the manuscript (trapezoidal integration of the mean plate-level percent survival at 2, 2.5, 3 and 3.5 h, divided by the 1.5 h interval); the manuscript’s confidence intervals come from bootstrap resampling of plates, which this table does not compute, and an AUC is undefined here when any of the four hours is missing. The Paired AUC and matched-block analyses answer different questions and are not the manuscript’s AUCnorm.'), allBar);
  ts.panes[1].append(h('div', { class: 'plot-controls two' }, field('Reference group', refSel, { id: 'auc-reference' }), field('Comparison group', cmpSel, { id: 'auc-comparison' })),
    hint('Date-level matching: the two groups are paired when both have all four timepoints on the same assay date and in the same source. Experiment, plate row and conditions are not matched (the notice below only warns when they vary). Computes one AUC per group/date, then gives each shared date equal weight; use sidebar filters to hold diet, temperature and other conditions constant. For AUC over matched blocks that follow the Paired-date comparison\'s stricter rules, see the Across hours tab in the Paired-date comparison below.'),
    coverage, sumBox, datesBox, hint('First 100 date pairs shown. Difference = comparison − reference, in % survival × hours. SE is across date-level differences; undefined with only one date pair.'),
    h('details', {}, h('summary', { text: 'Excluded dates and missing timepoints' }), auditBox), pairedBar);
  const el = h('div', { class: 'card detail-card', id: 'auc-card' }, h('h2', { text: 'Area under the curve (AUC)' }),
    hint(`Trapezoidal AUC at ${AUC_HOURS.join(', ')} h · units: % survival × hours · range 0–150. Uses all sidebar-filtered data and the main Color / compare and Mean weighting controls, independently of plot panels or page.`), ts.el);
  const btn = (label, id, fn) => h('button', { type: 'button', class: 'btn', id, text: label, onclick: fn });
  let last = null;
  return {
    el,
    syncControls() {},
    render(view) {
      if (!view.ok) { for (const b of [allBox, coverage, sumBox, datesBox, auditBox]) clear(b); clear(allBox).append(message(view.message)); clear(allBar); clear(pairedBar); return; }
      const s = view.settings; const group = s.group; const unit = s.unit;
      const all = allSelectedAuc(view.data, group, unit);
      clear(allBox).append(dataTable(all, ['group', 'time_period', 'auc_pct_h', 'mean_survival_pct', 'status', 'n_2h', 'n_2_5h', 'n_3h', 'n_3_5h']));
      clear(allBar).append(btn('All-selected AUC CSV', 'auc-all-csv', () => download('auc_all_selected.csv', toCsv(all))));
      const choices = sortUnique(view.data.map((r) => asCharacter(r[group])));
      const a = app.auc;
      if (!choices.includes(a.reference)) a.reference = [...['wild type', 'N2.thaw', 'N2'].filter((c) => choices.includes(c)), ...choices][0] ?? '';
      if (!choices.includes(a.comparison) || a.comparison === a.reference) a.comparison = choices.filter((c) => c !== a.reference)[0] ?? '';
      const opts = choices.map((c) => [c, c]);
      setOptions(refSel, opts, a.reference); setOptions(cmpSel, opts, a.comparison);
      if (!a.reference || !a.comparison || a.reference === a.comparison) {
        for (const b of [sumBox, datesBox, auditBox, pairedBar]) clear(b);
        clear(coverage).append(message(a.reference === a.comparison && a.reference ? 'Choose two different groups.' : 'Select two groups using the sidebar and Color / compare control.')); last = null; return;
      }
      const r = completeDateAuc(view.data, group, a.reference, a.comparison, unit);
      const summary = summarisePairedAuc(r.pairs);
      last = { r, summary };
      let text = `${r.pairs.length} complete shared source/date pairs retained out of ${r.audit.length} candidate source/dates. ${r.undated.length} undated observations cannot enter paired AUC.`;
      if (!r.pairs.length) text += ' Paired AUC is not estimable: neither missing timepoints nor unmatched dates are filled in.';
      const z = view.data.filter((x) => [a.reference, a.comparison].includes(x[group]) && AUC_HOURS.includes(x.hours));
      const mixed = ['culture', 'bacteria', 'config', 'sync'].filter((f) => new Set(z.map((x) => x[f])).size > 1);
      if (mixed.length) text += ` Selection varies in ${mixed.join(', ')} — date matching alone does not control these conditions.`;
      clear(coverage).append(h('div', { class: 'notice', text }));
      clear(sumBox).append(dataTable(summary, ['time_period', 'time_period_index', 'reference', 'comparison', 'n_date_pairs', 'reference_auc', 'comparison_auc', 'difference_pct_h', 'difference_se']));
      clear(datesBox).append(dataTable(r.pairs.slice(0, 100), ['source', 'date', 'time_period', 'reference_auc', 'comparison_auc', 'difference_pct_h']));
      clear(auditBox).append(dataTable(r.audit.filter((x) => !x.eligible).slice(0, 100), ['source', 'date', 'time_period', 'reference_status', 'comparison_status']));
      clear(pairedBar).append(btn('Paired AUC dates CSV', 'auc-pairs-csv', () => download('auc_paired_dates.csv', toCsv(last.r.pairs))), btn('Paired AUC summary CSV', 'auc-summary-csv', () => download('auc_paired_summary.csv', toCsv(last.summary))),
        btn('Date completeness audit CSV', 'auc-audit-csv', () => download('auc_date_audit.csv', toCsv(last.r.audit))), btn('Undated observations CSV', 'auc-undated-csv', () => download('auc_undated_observations.csv', toCsv(last.r.undated))));
    },
  };
}
