// Hand-built edge cases the real data do not exercise (period and pairing boundaries, CSV and date parsing).
import * as T from '../dist/js/index.js';
import { check, finish } from './helpers.mjs';

const header = 'strain,date,hours,culture,genotype,alive,dead,Rup,suicide,missing,expt,config,row,note,sync,bacteria';
const csv = (lines) => [header, ...lines].join('\n');
const load = (lines) => T.normaliseData(T.readCsv(csv(lines)), 'SKKU');

// ---- CSV parsing -----------------------------------------------------------------
{
  const f = T.readCsv('﻿a,b,c\r\n"x, y",NA,"q""uote"\r\n1,,3\r\nshort\r\n');
  check('csv BOM/CRLF/quotes', f.columns.join() === 'a,b,c' && f.rows[0].a === 'x, y' && f.rows[0].c === 'q"uote');
  check('csv NA and short rows', f.rows[0].b === null && f.rows[2].b === null && f.rows[2].c === null && f.rows.length === 3);
  check('csv types', f.types.a === 'character' && f.types.c === 'character');
  const g = T.readCsv('n,m,l\n1,2.5,T\n,3,F\n');
  check('csv numeric types', g.types.n === 'integer' && g.types.m === 'double' && g.types.l === 'logical' && Number.isNaN(g.rows[1].n));
}
// ---- dates -------------------------------------------------------------------------
check('parseDate valid', T.parseDate('2024-02-29') === '2024-02-29' && T.parseDate('2024-1-5') === '2024-01-05');
check('parseDate invalid', T.parseDate('2023-02-29') === null && T.parseDate('2024-13-01') === null && T.parseDate('x') === null && T.parseDate('') === null);
check('parseDate trailing text', T.parseDate('2024-05-06 12:00') === '2024-05-06');
check('day arithmetic', T.isoFromDay(T.dayNumber('2026-08-01') - 1) === '2026-07-31' && T.isoFromDay(T.dayNumber('2025-03-01') - 1) === '2025-02-28');
check('as.Date slash format', JSON.stringify(T.asDateDefault(['2026/07/01'])) === '["2026-07-01"]');

// ---- normalisation ------------------------------------------------------------------
{
  const f = load([
    'N2 extra,2026-09-01,3,20°C,wild type,10,5,0,0,0,1,standard,2,,standard,OP50',
    'N2,2026-09-01,3,20°C,wild type,10,3,0,0,0,1,standard,2.5,10 total,standard,plain',
    'CB1370-SNU,2026-09-01,3,20°C,x,15,0,0,0,0,1,standard,1,,standard,OP50-1',
    'N2,notadate,3,20°C,wild type,0,0,0,0,0,1,standard,1,,standard,OP50',
    'N2,2026-09-01,-1,20°C,wild type,10,5,0,0,0,1,standard,1,,standard,OP50',
  ]).rows;
  check('strain suffix removed, raw kept', f[0].strain === 'N2' && f[0].raw_strain === 'N2 extra');
  check('bacteria relabelling', f[0].bacteria === 'OP50-1' && f[1].bacteria === 'OP50' && f[2].bacteria === 'OP50-1');
  check('CB1370-SNU relabelled', f[2].strain === 'CB1370');
  check('survival', Math.abs(f[0].survival_pct - 100 * 10 / 15) < 1e-12);
  check('10 total note excluded', f[1].exclusion_reason.includes('SKKU note: 10 total') && !f[1].standard_included);
  check('total 15 passes', f[2].standard_included && f[2].total === 15);
  check('bad date -> NA, not a plate', f[3].date === null && f[3].run_id.includes('Not recorded') && !f[3].valid);
  check('negative hours invalid', !f[4].valid && Number.isNaN(f[4].survival_pct));
  check('row labels', f[0].row_position === 'Row 02' && f[1].row_position === 'Row 02.5');
  check('plate id', f[0].plate_id === 'SKKU / 2026-09-01 / 1 | 2 | N2 extra | 20°C | OP50-1 | standard | standard');
}

// ---- time periods ----------------------------------------------------------------------
{
  const mk = (date) => ({ date, observation_id: date });
  const rows = ['2026-06-30', '2026-07-01', '2026-07-31', '2026-08-01', '2026-08-31', '2026-09-01', null].map(mk);
  const out = T.assignTimePeriod(rows, true, ['2026-07-01', '2026-08-01', '2026-09-01']);
  check('cutoff indices (starts inclusive)', JSON.stringify(out.map((r) => r.time_period_index)) === '[1,2,2,3,3,4,5]');
  check('cutoff labels', out[0].time_period === 'Before 2026-07-01' && out[2].time_period === '2026-07-01 to 2026-07-31' && out[5].time_period === '2026-09-01 onward' && out[6].time_period === 'Undated (not assigned)');
  check('disabled', T.assignTimePeriod(rows, false).every((r) => r.time_period === 'All dates' && r.time_period_index === 1));
  let msg = ''; try { T.assignTimePeriod(rows, true, ['2026-08-01', '2026-07-01']); } catch (e) { msg = e.message; }
  check('cutoffs must increase', /increasing/.test(msg));
  msg = ''; try { T.assignTimePeriod(rows, true, ['2026-07-01', '2026-07-01']); } catch (e) { msg = e.message; }
  check('equal cutoffs rejected', /increasing/.test(msg));
  msg = ''; try { T.assignTimePeriod(rows, true, 'x'); } catch (e) { msg = e.message; }
  check('unparseable cutoff rejected', /valid cutoff/.test(msg));
  msg = ''; try { T.assignTimePeriod(rows, true, '2026-07-01', 'equal', 7); } catch (e) { msg = e.message; }
  check('too many periods', msg === 'The selected data have 6 distinct assay dates, too few for 7 time periods.');
  msg = ''; try { T.validatePeriodN(11, 20); } catch (e) { msg = e.message; }
  check('period count range', msg === 'Choose two to ten time periods.');
}

// ---- AUC --------------------------------------------------------------------------------
{
  check('trapezoid', Math.abs(T.trapezoidAuc([100, 80, 60, 40]) - 105) < 1e-12 && Number.isNaN(T.trapezoidAuc([1, 2, 3, NaN])));
  const mk = (strain, date, hours, alive, dead) => `${strain},${date},${hours},20°C,${strain},${alive},${dead},0,0,0,1,standard,1,,standard,OP50-1`;
  const lines = [];
  for (const [h, a] of [[2, 15], [2.5, 12], [3, 9], [3.5, 6]]) { lines.push(mk('A', '2026-06-30', h, a, 15 - a)); lines.push(mk('B', '2026-06-30', h, a - 3, 18 - a)); }
  for (const h of [2, 3]) { lines.push(mk('A', '2026-07-01', h, 15, 0)); lines.push(mk('B', '2026-07-01', h, 15, 0)); }
  const rows = T.assignTimePeriod(load(lines).rows, true, ['2026-07-01']);
  const r = T.completeDateAuc(rows, 'strain', 'A', 'B');
  check('only complete dates are paired', r.pairs.length === 1 && r.audit.length === 2 && r.pairs[0].date === '2026-06-30');
  check('incomplete status reported', r.audit[1].reference_status === 'Missing: 2.5, 3.5 h');
  check('pair difference', Math.abs(r.pairs[0].difference_pct_h - (r.pairs[0].comparison_auc - r.pairs[0].reference_auc)) < 1e-12);
  const all = T.allSelectedAuc(rows, 'strain');
  check('all-selected AUC per group and period', all.length === 4 && all[0].group === 'A' && all[0].time_period_index === 1 && all[0].complete && !all[1].complete);
}

// ---- pairing: the recent/historic boundary is inclusive ------------------------------------------
{
  const mk = (strain, date, alive, dead) => `${strain},${date},3,20°C,wt,${alive},${dead},0,0,0,1,standard,1,,standard,OP50-1`;
  const rows = load([mk('A', '2026-08-31', 10, 10), mk('B', '2026-08-31', 12, 8), mk('A', '2026-09-01', 10, 10), mk('B', '2026-09-01', 14, 6)]).rows;
  const r = T.pairDates(rows, 'strain', 'A', 'B', '2026-09-01');
  check('pairs found', r.pairs.length === 2 && r.audit.every((x) => x.pair_status === 'Paired'));
  check('cutoff date is Recent', r.pairs[0].period === 'Historic' && r.pairs[1].period === 'Recent');
  check('difference in percentage points', Math.abs(r.pairs[1].difference_pp - 20) < 1e-9);
  const daily = T.pairedDaily(r.pairs, 3);
  check('daily trend', daily.length === 2 && daily[0].n_blocks === 1);
  const s = T.pairedPeriodSummary(daily);
  check('period summary', s.length === 2 && Number.isNaN(s[0].difference_se));
  const unmatched = T.pairDates(rows.filter((x) => x.strain === 'A'), 'strain', 'A', 'B', '2026-09-01');
  check('no counterpart', unmatched.pairs.length === 0 && unmatched.audit.every((x) => x.pair_status.startsWith('No counterpart')));
}
// ---- matched-block AUC: complete blocks only, exclusions reported ------------------------------------------------------
{
  const mk = (strain, date, hours, alive, dead, expt = 1) => `${strain},${date},${hours},20°C,wt,${alive},${dead},0,0,0,${expt},standard,1,,standard,OP50-1`;
  const lines = [];
  const prof = { A: [14, 12, 9, 6], B: [15, 14, 12, 10] };       // alive out of 15 at 2, 2.5, 3, 3.5 h
  const add = (date, expt, skip = []) => { [2, 2.5, 3, 3.5].forEach((h, i) => { if (skip.includes(h)) return; for (const s of ['A', 'B']) lines.push(mk(s, date, h, prof[s][i], 15 - prof[s][i], expt)); }); };
  add('2026-08-30', 1); add('2026-09-02', 1); add('2026-09-02', 2); add('2026-09-05', 1, [3]); add('2026-09-06', 1, [2, 3.5]);
  const rows = load(lines).rows;
  const pr = T.pairDates(rows, 'strain', 'A', 'B', '2026-09-01');
  const ba = T.blockAuc(pr.pairs);
  check('complete blocks enter, others are reported', ba.blocks.length === 3 && ba.excluded.length === 2 && T.completeBlockIds(pr.pairs).length === 3);
  check('exclusions name the missing hours', ba.excluded[0].hours_missing === '3' && ba.excluded[0].hours_present === '2; 2.5; 3.5' && ba.excluded[1].hours_missing === '2; 3.5' && ba.excluded[1].hours_present === '2.5; 3');
  const expectA = T.trapezoidAuc(prof.A.map((a) => (100 * a) / 15)), expectB = T.trapezoidAuc(prof.B.map((a) => (100 * a) / 15));
  check('block AUC and gap', ba.blocks.every((b) => Math.abs(b.reference_auc - expectA) < 1e-9 && Math.abs(b.comparison_auc - expectB) < 1e-9 && Math.abs(b.difference_auc - (expectB - expectA)) < 1e-9));
  check('mean survival is AUC / 1.5', Math.abs(ba.blocks[0].reference_mean_survival - expectA / 1.5) < 1e-12);
  const daily = T.aucDaily(ba.blocks);
  check('blocks on one date are averaged', daily.length === 2 && daily.find((d) => d.date === '2026-09-02').n_blocks === 2);
  const per = T.aucPeriodSummary(daily);
  check('periods split at the cutoff, undefined SE for one date', per.length === 2 && per[0].period === 'Historic' && per[0].n_dates === 1 && Number.isNaN(per[0].difference_se) && per[1].period === 'Recent' && per[1].n_dates === 1);
  check('no blocks, no output', T.blockAuc([]).blocks.length === 0 && T.aucDaily([]).length === 0 && T.aucPeriodSummary([]).length === 0);
  // gap-by-hour profile keeps every eligible block at each hour; the optional restriction keeps complete blocks only
  const all = T.hourProfile(pr.pairs, false), comp = T.hourProfile(pr.pairs, true);
  const nAt = (p, h) => p.find((x) => x.hour === h).daily.reduce((s, d) => s + d.n_blocks, 0);
  check('profile uses every eligible block at each hour', nAt(all, 2) === 4 && nAt(all, 2.5) === 5 && nAt(all, 3) === 4 && nAt(all, 3.5) === 4, JSON.stringify(all.map((x) => [x.hour, x.daily.reduce((s, d) => s + d.n_blocks, 0)])));
  check('complete-block restriction', comp.every((x) => x.daily.reduce((s, d) => s + d.n_blocks, 0) === 3));
}
// ---- filters ------------------------------------------------------------------------------------
{
  const mk = (d, strain) => `${strain},${d},3,20°C,wt,10,5,0,0,0,1,standard,1,,standard,OP50`;
  const rows = load([mk('2026-01-01', 'A'), mk('2026-01-05', 'B'), 'C,,3,20°C,wt,10,5,0,0,0,1,standard,1,,standard,OP50'].map((x) => x)).rows;
  const base = { sources: ['SKKU'], dates: ['2026-01-01', '2026-01-02'], hours: [], quality: true, undated: false };
  check('date range inclusive, undated off', T.filterData(rows, base).map((r) => r.strain).join() === 'A');
  check('undated on', T.filterData(rows, { ...base, undated: true }).map((r) => r.strain).join() === 'A,C');
  check('no source ticked -> none', T.filterData(rows, { ...base, sources: [] }).length === 0);
  check('scalar settings accepted', T.filterData(rows, { ...base, sources: 'SKKU', strain: 'A' }).length === 1);
  check('manual exclusion', T.filterData(rows, { ...base, excluded: ['SKKU:1'] }).length === 0);
}
// ---- 95% confidence interval --------------------------------------------------------------------------
{
  // qt(0.975, df) from R 4.5.2
  const R = { 1: 12.7062047, 2: 4.3026527, 3: 3.1824463, 5: 2.5705818, 10: 2.2281389, 20: 2.0859634, 30: 2.0422725, 100: 1.9839715, 1000: 1.9623391 };
  check('t quantiles match R', Object.entries(R).every(([df, q]) => Math.abs(T.tQuantile(0.975, +df) - q) < 5e-7), JSON.stringify(Object.keys(R).map((df) => T.tQuantile(0.975, +df).toFixed(7))));
  const mk = (alive, dead, run) => ({ panel: 'p', curve: 'c', hours: 2, run_id: run, plate_id: run, survival_pct: (100 * alive) / (alive + dead), date: '2026-01-01', expt: run, row: 1 });
  const rows = [mk(10, 5, 'a'), mk(12, 3, 'b'), mk(9, 6, 'c')];
  const s = T.summariseCurves(rows, 'plate')[0];
  const v = rows.map((r) => r.survival_pct);
  check('ci95 = t(0.975, n-1) x SE', Math.abs(s.ci95 - T.tQuantile(0.975, 2) * s.se) < 1e-12 && Math.abs(s.ci95 - 4.3026527 * T.rSd(v) / Math.sqrt(3)) < 1e-5);
  check('one unit has no interval', Number.isNaN(T.summariseCurves([rows[0]], 'plate')[0].ci95));
}
finish('unit edge cases');
