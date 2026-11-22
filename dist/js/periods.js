// Port of the time-period functions in thermotolerance_explorer/R/auc.R.
import { asDateDefault, dayNumber, isoFromDay } from './rcompat.js';

export const validatePeriodCutoffs = (cutoffs) => {
  const list = Array.isArray(cutoffs) ? cutoffs : [cutoffs];
  let dates;
  try { dates = asDateDefault(list); } catch { dates = [null]; }
  if (!dates.length || dates.length > 5 || dates.some((d) => d === null) || dates.some((d, i) => i > 0 && !(d > dates[i - 1]))) {
    throw new Error('Choose one to five valid cutoff dates in strictly increasing order.');
  }
  return dates;
};

export function validatePeriodN(n, available) {
  const v = typeof n === 'string' ? Number(n) : n;
  const k = Number.isFinite(v) ? Math.trunc(v) : NaN;
  if (!Number.isFinite(k) || k < 2 || k > 10) throw new Error('Choose two to ten time periods.');
  if (k > available) throw new Error(`The selected data have ${available} distinct assay date${available === 1 ? '' : 's'}, too few for ${k} time periods.`);
  return k;
}

// cut(seq_along(x), breaks = n, labels = FALSE): n equal-width bins over 1..m, right-closed.
export function cutBins(m, n) {
  const dx = m - 1;
  const by = dx / n;
  const breaks = Array.from({ length: n + 1 }, (_, k) => 1 + k * by);
  breaks[0] = 1 - dx / 1000; breaks[n] = m + dx / 1000;
  return Array.from({ length: m }, (_, i) => { const x = i + 1; let g = 1; while (g < n && x > breaks[g]) g++; return g; });
}

// Dynamic programming; each date is indivisible and squared deviations from observations / n are minimised.
export function balancedDateGroups(weights, n) {
  const m = weights.length;
  const cumulative = [0]; for (const w of weights) cumulative.push(cumulative.at(-1) + w);
  const target = cumulative[m] / n;
  const cost = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
  const previous = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(null));
  cost[0][0] = 0;
  for (let g = 1; g <= n; g++) for (let j = g; j <= m; j++) {
    let best = Infinity; let bestK = null;
    for (let k = g - 1; k <= j - 1; k++) {
      const dev = cumulative[j] - cumulative[k] - target;
      const c = cost[g - 1][k] + dev * dev;
      if (c < best) { best = c; bestK = k; }          // first minimum, like which.min()
    }
    cost[g][j] = best; previous[g][j] = bestK;
  }
  const ends = new Array(n); let j = m;
  for (let g = n; g >= 1; g--) { ends[g - 1] = j; j = previous[g][j]; }
  const groups = []; let start = 0;
  ends.forEach((e, i) => { for (; start < e; start++) groups.push(i + 1); });
  return groups;
}

export function assignTimePeriod(rows, enabled = false, cutoff = '2026-07-01', method = 'cutoffs', n = 3) {
  const base = rows.map((r) => ({ ...r, time_period: 'All dates', time_period_index: 1 }));
  if (!enabled) return base;
  const known = (r) => r.date !== null;
  let labels; let indexOf;
  if (method === 'equal' || method === 'balanced') {
    const dates = [...new Set(base.filter(known).map((r) => r.date))].sort();
    const k = validatePeriodN(n, dates.length);
    let groups;
    if (method === 'balanced') {
      const pos = new Map(dates.map((d, i) => [d, i]));
      const weights = new Array(dates.length).fill(0);
      for (const r of base) if (known(r)) weights[pos.get(r.date)]++;
      groups = balancedDateGroups(weights, k);
    } else groups = cutBins(dates.length, k);
    labels = Array.from({ length: k }, (_, i) => {
      const x = dates.filter((_, j) => groups[j] === i + 1);
      return x.length === 1 ? x[0] : `${x[0]} to ${x.at(-1)}`;
    });
    const pos = new Map(dates.map((d, i) => [d, groups[i]]));
    indexOf = (r) => pos.get(r.date);
  } else {
    const cut = validatePeriodCutoffs(cutoff);
    labels = [`Before ${cut[0]}`,
      ...cut.slice(0, -1).map((c, i) => `${c} to ${isoFromDay(dayNumber(cut[i + 1]) - 1)}`),
      `${cut.at(-1)} onward`];
    indexOf = (r) => cut.filter((c) => r.date >= c).length + 1;   // findInterval(): starts are inclusive
  }
  for (const r of base) {
    if (known(r)) { r.time_period_index = indexOf(r); r.time_period = labels[r.time_period_index - 1]; }
    else { r.time_period = 'Undated (not assigned)'; r.time_period_index = labels.length + 1; }
  }
  return base;
}

// One line per period: label, distinct assay dates and observations.
export function describeTimePeriods(rows) {
  if (!rows.length) return [];
  const idx = [...new Set(rows.map((r) => r.time_period_index))].sort((a, b) => a - b);
  return idx.map((i) => {
    const z = rows.filter((r) => r.time_period_index === i);
    const dates = new Set(z.filter((r) => r.date !== null).map((r) => r.date)).size;
    const allNA = z.every((r) => r.date === null);
    return `${z[0].time_period}: ${allNA ? '' : `${dates} ${dates === 1 ? 'date' : 'dates'}, `}${z.length} ${z.length === 1 ? 'observation' : 'observations'}`;
  });
}
