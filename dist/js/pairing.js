// Port of thermotolerance_explorer/R/pairing.R (the calculations; plots are drawn elsewhere).
import { asCharacter, isNA, parseDate, orderBy, pairKey, rMean, rSd, sortUnique, splitBy, unique } from './rcompat.js';

const CONDITIONS = ['source', 'culture', 'bacteria', 'config', 'sync'];
const missingValue = (x) => isNA(x) || ['', 'Not recorded'].includes(String(asCharacter(x)).trim());
const collapse = (values) => sortUnique(values.map((v) => asCharacter(v))).join('; ');

// pair_dates(): match the two groups on date, hour and every recorded condition except the one compared.
export function pairDates(rows, group, reference, comparison, cutoff, { sameExperiment = true, separateMales = true, allowUnknown = false } = {}) {
  if (!['strain', 'genotype', 'config', 'sync'].includes(group)) throw new Error('group must be strain, genotype, config or sync');
  if (reference === comparison) throw new Error('reference and comparison must differ');
  cutoff = parseDate(cutoff);
  if (cutoff === null) throw new Error('cutoff must be a valid date');
  const d = rows.filter((r) => [reference, comparison].includes(r[group])).map((r) => ({ ...r }));
  for (const r of d) {
    r.pair_status = 'No counterpart at matching date, time and conditions';
    r.pair_block = null; r.pair_stratum = null;
    r.sex_label = r.raw_strain !== null && /(^|[. _])male([. _]|$)/.test(String(asCharacter(r.raw_strain))) ? 'male-labelled' : 'not male-labelled';
    const prefix = `${r.sync} `;
    r.config_without_sync = r.config !== null && r.config.startsWith(prefix) ? r.config.slice(prefix.length) : r.config;
  }
  if (!d.length) return { pairs: [], audit: d };
  let matched = CONDITIONS.filter((c) => c !== group);
  if (group === 'sync') matched = matched.map((c) => (c === 'config' ? 'config_without_sync' : c));
  const eligible = [];
  d.forEach((r, i) => {
    const unknown = CONDITIONS.some((c) => missingValue(r[c]));
    const invalid = !Number.isFinite(r.survival_pct) || !Number.isFinite(r.hours);
    if (!allowUnknown && unknown) r.pair_status = 'Missing condition metadata';
    if (sameExperiment && missingValue(r.expt)) r.pair_status = 'Missing experiment identifier';
    if (r.date === null) r.pair_status = 'Missing assay date';
    if (invalid) r.pair_status = 'Invalid survival or time';
    if (!invalid && r.date !== null && (allowUnknown || !unknown) && (!sameExperiment || !missingValue(r.expt))) eligible.push(i);
  });
  const blockFields = [...matched, ...(['config', 'sync'].includes(group) ? ['strain'] : []), 'date', ...(sameExperiment ? ['expt'] : []), ...(separateMales ? ['sex_label'] : [])];
  for (const i of eligible) d[i].pair_block = pairKey(d[i], blockFields);
  const groups = splitBy(eligible.length, (k) => pairKey(d[eligible[k]], [...blockFields, 'hours']));
  const result = [];
  for (const [, ks] of groups) {
    const idx = ks.map((k) => eligible[k]);
    const z = idx.map((i) => d[i]);
    const a = z.filter((r) => r[group] === reference);
    const b = z.filter((r) => r[group] === comparison);
    if (!a.length || !b.length) continue;
    const row = {};
    for (const c of matched) row[c] = z[0][c];
    row.date = z[0].date; row.hours = z[0].hours; row.pair_block = z[0].pair_block;
    row.sex_label = separateMales ? z[0].sex_label : 'Sex labels pooled';
    row.compared_by = group; row.reference = reference; row.comparison = comparison;
    row.reference_strains = collapse(a.map((r) => r.strain)); row.comparison_strains = collapse(b.map((r) => r.strain));
    row.reference_experiments = collapse(a.map((r) => r.expt)); row.comparison_experiments = collapse(b.map((r) => r.expt));
    row.reference_mean = rMean(a.map((r) => r.survival_pct)); row.comparison_mean = rMean(b.map((r) => r.survival_pct));
    row.difference_pp = row.comparison_mean - row.reference_mean;
    row.n_reference = a.length; row.n_comparison = b.length;
    row.reference_rows = collapse(a.map((r) => r.observation_id)); row.comparison_rows = collapse(b.map((r) => r.observation_id));
    row.period = row.date >= cutoff ? 'Recent' : 'Historic';
    row.recent_from = cutoff;
    row.same_experiment = sameExperiment;
    row.pair_stratum = pairKey(row, [...matched, 'sex_label', 'reference_strains', 'comparison_strains']);
    const strains = row.reference_strains === row.comparison_strains ? row.reference_strains : `${row.reference_strains} vs ${row.comparison_strains}`;
    row.stratum_label = [...matched.map((c) => asCharacter(row[c])), row.sex_label, strains].join(' · ');
    row.pair_panel = `${row.date} ${sameExperiment ? `/ experiment ${row.reference_experiments}` : '/ all experiments'}`;
    for (const i of idx) { d[i].pair_status = 'Paired'; d[i].pair_stratum = row.pair_stratum; }
    result.push(row);
  }
  const pairs = orderBy(result, [[(r) => r.date, 'number'], [(r) => r.pair_block, 'collate'], [(r) => r.hours, 'number']]);
  return { pairs, audit: d };
}

export function pairedDaily(pairs, hour) {
  const z = pairs.filter((r) => r.hours === hour);
  if (!z.length) return [];
  const out = splitBy(z.length, (i) => pairKey(z[i], ['pair_stratum', 'date'])).map(([, idx]) => {
    const x = idx.map((i) => z[i]);
    const f = x[0];
    return {
      pair_stratum: f.pair_stratum, stratum_label: f.stratum_label, date: f.date, period: f.period, recent_from: f.recent_from, hours: f.hours,
      reference: f.reference, comparison: f.comparison, reference_mean: rMean(x.map((r) => r.reference_mean)),
      comparison_mean: rMean(x.map((r) => r.comparison_mean)), difference_pp: rMean(x.map((r) => r.difference_pp)),
      n_blocks: x.length, n_reference: x.reduce((s, r) => s + r.n_reference, 0), n_comparison: x.reduce((s, r) => s + r.n_comparison, 0),
    };
  });
  return orderBy(out, [[(r) => r.date, 'number']]);
}

export function pairedPeriodSummary(daily) {
  if (!daily.length) return [];
  const out = splitBy(daily.length, (i) => pairKey(daily[i], ['pair_stratum', 'period'])).map(([, idx]) => {
    const z = idx.map((i) => daily[i]);
    const diffs = z.map((r) => r.difference_pp);
    const dates = z.map((r) => r.date).sort();
    return {
      stratum: z[0].stratum_label, period: z[0].period, recent_from: z[0].recent_from, hours: z[0].hours, reference: z[0].reference,
      comparison: z[0].comparison, n_dates: z.length, n_blocks: z.reduce((s, r) => s + r.n_blocks, 0),
      reference_mean: rMean(z.map((r) => r.reference_mean)), comparison_mean: rMean(z.map((r) => r.comparison_mean)),
      difference_pp: rMean(diffs), difference_se: z.length > 1 ? rSd(diffs) / Math.sqrt(z.length) : NaN,
      first_date: dates[0], last_date: dates.at(-1),
    };
  });
  return orderBy(out, [[(r) => r.stratum, 'collate'], [(r) => r.period, 'collate']]);
}
export { unique };
