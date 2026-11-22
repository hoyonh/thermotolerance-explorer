// The chain the R app runs reactively: settings -> filtered rows -> decorated rows -> summary.
// Pure functions so the same code is used by the interface and by the Node tests.
import { filterData, selectGroupDates, decorateData, curvesWithPeriods, summariseCurves, asArray } from './data.js';
import { assignTimePeriod, validatePeriodCutoffs, validatePeriodN } from './periods.js';
import { parseDate, unique, rCompare } from './rcompat.js';
import { analysisSettings } from './settings.js';

export class Invalid extends Error {}    // a message the interface shows in place of results

export function filtered(rows, rawSettings) {
  const s = analysisSettings(rawSettings);
  if (s.compare_periods && s.period_method === 'cutoffs') {
    try { validatePeriodCutoffs(s.period_cutoffs); } catch { throw new Invalid('Enter valid cutoff dates in strictly increasing order.'); }
  }
  const dates = asArray(s.dates).map((d) => parseDate(d));
  if (dates.length !== 2 || dates.some((d) => d === null) || dates[0] > dates[1]) throw new Invalid('Assay dates: enter both dates, with the start no later than the end.');
  const sel = selectGroupDates(filterData(rows, s), s.group, s.date_selection);
  if (s.compare_periods && ['equal', 'balanced'].includes(s.period_method)) {
    try { validatePeriodN(s.period_n, new Set(sel.rows.filter((r) => r.date !== null).map((r) => r.date)).size); } catch (e) { throw new Invalid(e.message); }
  }
  const data = assignTimePeriod(sel.rows, s.compare_periods, s.period_cutoffs, s.period_method, s.period_n);
  const candidate = filterData(rows, s, false).length;
  return { data, info: sel.info, candidate, settings: s };
}

export function decorated(data, s) {
  let rows = decorateData(data, s.group, s.facet); let levels = null;
  if (s.compare_periods) { const c = curvesWithPeriods(rows, s.group); rows = c.rows; levels = c.levels; }
  return { rows, levels };
}

export function curveSummary(dec, s) { return summariseCurves(dec.rows, s.unit, dec.levels); }

export const PANELS_PER_PAGE = 12;
export function panelList(dec) { return unique(dec.rows.map((r) => r.panel)).sort(rCompare); }
export function safePage(value, total) {
  let p = Math.trunc(Number(value)); if (!Number.isFinite(p)) p = 1;
  return Math.max(1, Math.min(Math.max(1, total), p));
}
export function pagePanels(panels, page) {
  const p = safePage(page, Math.ceil(panels.length / PANELS_PER_PAGE));
  return panels.slice((p - 1) * PANELS_PER_PAGE, p * PANELS_PER_PAGE);
}
export function curveOrder(dec) { return dec.levels || unique(dec.rows.map((r) => r.curve)).sort(rCompare); }
