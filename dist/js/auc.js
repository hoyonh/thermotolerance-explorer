// Port of the AUC functions in thermotolerance_explorer/R/auc.R.
import { asCharacter, orderBy, pairKey, rCompare, rMean, rSd, sortUnique, splitBy, unique } from './rcompat.js';
import { assignTimePeriod } from './periods.js';

export const AUC_HOURS = [2, 2.5, 3, 3.5];
const HOUR_NAMES = ['2h', '2_5h', '3h', '3_5h'];

export function trapezoidAuc(values) {
  if (values.length !== 4 || values.some((v) => !Number.isFinite(v))) return NaN;
  let s = 0; for (let i = 0; i < 3; i++) s += (AUC_HOURS[i + 1] - AUC_HOURS[i]) * (values[i] + values[i + 1]) / 2;
  return s;
}

const runMean = (z) => { const m = new Map(); for (const r of z) { if (!m.has(r.run_id)) m.set(r.run_id, []); m.get(r.run_id).push(r.survival_pct); } return rMean([...m.entries()].sort((a, b) => rCompare(a[0], b[0])).map(([, x]) => rMean(x))); };

export function aucCurveStats(rows, unit = 'plate') {
  const means = AUC_HOURS.map((h) => {
    const z = rows.filter((r) => r.hours === h && Number.isFinite(r.survival_pct));
    if (!z.length) return NaN;
    return unit === 'run' ? runMean(z) : rMean(z.map((r) => r.survival_pct));
  });
  const counts = AUC_HOURS.map((h) => rows.filter((r) => r.hours === h && Number.isFinite(r.survival_pct)).length);
  const missing = AUC_HOURS.filter((_, i) => !Number.isFinite(means[i]));
  const area = trapezoidAuc(means);
  const out = { auc_pct_h: area, mean_survival_pct: area / 1.5, complete: !missing.length, status: missing.length ? `Missing: ${missing.join(', ')} h` : 'Complete' };
  HOUR_NAMES.forEach((n, i) => { out[`mean_${n}`] = means[i]; });
  HOUR_NAMES.forEach((n, i) => { out[`n_${n}`] = counts[i]; });
  out.weighting = unit;
  return out;
}

const withPeriods = (rows) => (rows.length && 'time_period' in rows[0] ? rows : assignTimePeriod(rows));

export function allSelectedAuc(rows, group, unit = 'plate') {
  if (!rows.length) return [];
  const d = withPeriods(rows);
  const groups = splitBy(d.length, (i) => pairKey(d[i], [group, 'time_period']));
  const out = groups.map(([, idx]) => {
    const z = idx.map((i) => d[i]);
    return { group: asCharacter(z[0][group]), time_period: z[0].time_period, time_period_index: z[0].time_period_index, ...aucCurveStats(z, unit) };
  });
  return orderBy(out, [[(r) => r.group, 'collate'], [(r) => r.time_period_index, 'number']]);
}

export function completeDateAuc(rows, group, reference, comparison, unit = 'plate') {
  if (reference === comparison) throw new Error('reference and comparison must differ');
  let d = withPeriods(rows).filter((r) => [reference, comparison].includes(r[group]));
  const undated = d.filter((r) => r.date === null);
  d = d.filter((r) => r.date !== null);
  if (!d.length) return { pairs: [], audit: [], undated };
  const groups = splitBy(d.length, (i) => pairKey(d[i], ['source', 'date']));
  const audit = groups.map(([, idx]) => {
    const z = idx.map((i) => d[i]);
    const a = z.filter((r) => r[group] === reference);
    const b = z.filter((r) => r[group] === comparison);
    const sa = aucCurveStats(a, unit), sb = aucCurveStats(b, unit);
    const used = z.filter((r) => AUC_HOURS.includes(r.hours));
    const row = {
      source: z[0].source, date: z[0].date, time_period: z[0].time_period, time_period_index: z[0].time_period_index,
      reference, comparison, reference_auc: sa.auc_pct_h, comparison_auc: sb.auc_pct_h, difference_pct_h: sb.auc_pct_h - sa.auc_pct_h,
      eligible: sa.complete && sb.complete, reference_status: sa.status, comparison_status: sb.status,
      n_reference: a.filter((r) => AUC_HOURS.includes(r.hours)).length, n_comparison: b.filter((r) => AUC_HOURS.includes(r.hours)).length,
      weighting: unit, observation_ids: used.map((r) => r.observation_id).join('; '),
    };
    for (const f of ['culture', 'bacteria', 'config', 'sync', 'strain', 'expt']) {
      row[`reference_${f}`] = sortUnique(a.filter((r) => AUC_HOURS.includes(r.hours)).map((r) => r[f])).join('; ');
      row[`comparison_${f}`] = sortUnique(b.filter((r) => AUC_HOURS.includes(r.hours)).map((r) => r[f])).join('; ');
    }
    for (const f of [...HOUR_NAMES.map((n) => `mean_${n}`), ...HOUR_NAMES.map((n) => `n_${n}`)]) { row[`reference_${f}`] = sa[f]; row[`comparison_${f}`] = sb[f]; }
    return row;
  });
  const sorted = orderBy(audit, [[(r) => r.date, 'number'], [(r) => r.source, 'collate']]);
  return { pairs: sorted.filter((r) => r.eligible), audit: sorted, undated };
}

export function summarisePairedAuc(pairs) {
  if (!pairs.length) return [];
  const groups = splitBy(pairs.length, (i) => pairs[i].time_period);
  const out = groups.map(([, idx]) => {
    const z = idx.map((i) => pairs[i]);
    const diffs = z.map((r) => r.difference_pct_h);
    return {
      time_period: z[0].time_period, time_period_index: z[0].time_period_index, reference: z[0].reference, comparison: z[0].comparison,
      n_date_pairs: z.length, reference_auc: rMean(z.map((r) => r.reference_auc)), comparison_auc: rMean(z.map((r) => r.comparison_auc)),
      difference_pct_h: rMean(diffs), difference_se: z.length > 1 ? rSd(diffs) / Math.sqrt(z.length) : NaN,
    };
  });
  return orderBy(out, [[(r) => r.time_period_index, 'number']]);
}
export { unique };
