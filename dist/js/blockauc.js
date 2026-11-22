// Matched-block AUC and the gap-by-hour profile. These build on the matched blocks of pair_dates() and are not in
// the original R explorer; tools/make_fixtures.R holds an independent R implementation used as the reference.
//
// Matched-block AUC: for each matched block, the trapezoid AUC of each group's mean survival over the fixed
// 2-3.5 h window. Only blocks measured at every window hour enter; the others are reported with the hours they lack.
// Blocks on one date are averaged, then dates carry equal weight in each period (as in the paired-date summaries).
import { AUC_HOURS, trapezoidAuc } from './auc.js';
import { numToString, orderBy, pairKey, rMean, rSd, splitBy } from './rcompat.js';
import { pairedDaily, pairedPeriodSummary } from './pairing.js';

export const WINDOW = AUC_HOURS;
const hoursText = (hs) => hs.map(numToString).join('; ');

function byBlock(pairs) {
  const m = new Map();
  for (const p of pairs) { if (!m.has(p.pair_block)) m.set(p.pair_block, []); m.get(p.pair_block).push(p); }
  return m;
}
export const completeBlockIds = (pairs) => [...byBlock(pairs)].filter(([, z]) => WINDOW.every((h) => z.some((p) => p.hours === h))).map(([b]) => b);
export function completePairs(pairs) { const ok = new Set(completeBlockIds(pairs)); return pairs.filter((p) => ok.has(p.pair_block)); }

export function blockAuc(pairs) {
  const blocks = []; const excluded = [];
  for (const [, rows] of byBlock(pairs)) {
    const z = [...rows].sort((a, b) => a.hours - b.hours);
    const f = z[0];
    if (WINDOW.every((h) => z.some((p) => p.hours === h))) {
      const w = WINDOW.map((h) => z.find((p) => p.hours === h));
      const ra = trapezoidAuc(w.map((p) => p.reference_mean)), ca = trapezoidAuc(w.map((p) => p.comparison_mean));
      blocks.push({
        pair_block: f.pair_block, pair_stratum: f.pair_stratum, stratum_label: f.stratum_label, date: f.date, period: f.period, recent_from: f.recent_from,
        pair_panel: f.pair_panel, reference: f.reference, comparison: f.comparison, reference_auc: ra, comparison_auc: ca, difference_auc: ca - ra,
        reference_mean_survival: ra / 1.5, comparison_mean_survival: ca / 1.5,
        n_reference: w.reduce((s, p) => s + p.n_reference, 0), n_comparison: w.reduce((s, p) => s + p.n_comparison, 0),
      });
    } else {
      excluded.push({
        pair_block: f.pair_block, date: f.date, pair_panel: f.pair_panel, stratum_label: f.stratum_label, period: f.period,
        hours_present: hoursText([...new Set(z.map((p) => p.hours))].sort((a, b) => a - b)), hours_missing: hoursText(WINDOW.filter((h) => !z.some((p) => p.hours === h))),
      });
    }
  }
  const order = [[(r) => r.date, 'number'], [(r) => r.pair_block, 'collate']];
  return { blocks: orderBy(blocks, order), excluded: orderBy(excluded, order) };
}

export function aucDaily(blocks) {
  if (!blocks.length) return [];
  const out = splitBy(blocks.length, (i) => pairKey(blocks[i], ['pair_stratum', 'date'])).map(([, idx]) => {
    const x = idx.map((i) => blocks[i]); const f = x[0];
    return {
      pair_stratum: f.pair_stratum, stratum_label: f.stratum_label, date: f.date, period: f.period, recent_from: f.recent_from, reference: f.reference, comparison: f.comparison,
      reference_auc: rMean(x.map((r) => r.reference_auc)), comparison_auc: rMean(x.map((r) => r.comparison_auc)), difference_auc: rMean(x.map((r) => r.difference_auc)), n_blocks: x.length,
    };
  });
  return orderBy(out, [[(r) => r.date, 'number']]);
}

export function aucPeriodSummary(daily) {
  if (!daily.length) return [];
  const out = splitBy(daily.length, (i) => pairKey(daily[i], ['pair_stratum', 'period'])).map(([, idx]) => {
    const z = idx.map((i) => daily[i]); const diffs = z.map((r) => r.difference_auc); const dates = z.map((r) => r.date).sort();
    const ra = rMean(z.map((r) => r.reference_auc)), ca = rMean(z.map((r) => r.comparison_auc));
    return {
      stratum: z[0].stratum_label, period: z[0].period, recent_from: z[0].recent_from, reference: z[0].reference, comparison: z[0].comparison,
      n_dates: z.length, n_blocks: z.reduce((s, r) => s + r.n_blocks, 0), reference_auc: ra, comparison_auc: ca, difference_auc: rMean(diffs),
      difference_se: z.length > 1 ? rSd(diffs) / Math.sqrt(z.length) : NaN, reference_mean_survival: ra / 1.5, comparison_mean_survival: ca / 1.5,
      first_date: dates[0], last_date: dates.at(-1),
    };
  });
  return orderBy(out, [[(r) => r.stratum, 'collate'], [(r) => r.period, 'collate']]);
}

// Gap-by-hour profile: the single-hour daily and period summaries at every recorded hour.
// completeOnly restricts to blocks measured at every window hour; otherwise every eligible block counts at each hour.
export function hourProfile(pairs, completeOnly = false) {
  const use = completeOnly ? completePairs(pairs) : pairs;
  return [...new Set(use.map((p) => p.hours))].sort((a, b) => a - b).map((hour) => {
    const daily = pairedDaily(use, hour);
    return { hour, daily, period: pairedPeriodSummary(daily) };
  });
}
