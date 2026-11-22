// Checks the JavaScript core against reference output produced by the existing R code
// (tools/make_fixtures.R). Run: node tests/numerical.mjs
import { createHash } from 'node:crypto';
import * as T from '../dist/js/index.js';
import { check, compareFrame, dataDir, finish, loadFixture, readData, same } from './helpers.mjs';

const norm = loadFixture('normalised.json.gz');
const scenarios = loadFixture('scenarios.json.gz');
const misc = loadFixture('misc.json.gz');
const grid = loadFixture('period_grid.json.gz');
const collation = loadFixture('collation.json.gz');
const text = (f) => readData(f).toString('utf8');

// ---- source identity -----------------------------------------------------------
for (const [src, file] of Object.entries(norm.files)) {
  check(`md5 ${src}`, createHash('md5').update(readData(file)).digest('hex') === norm.md5[src]);
}

// ---- normalised data --------------------------------------------------------------
const frames = {};
const skku = T.normaliseData(T.readCsv(text(norm.files.SKKU)), 'SKKU');
const jhu = T.normaliseData(T.readCsv(text(norm.files.JHU)), 'JHU');
frames.SKKU_only = skku; frames.JHU_only = jhu; frames.both = T.combineFrames([skku, jhu]);
for (const [name, frame] of Object.entries(frames)) {
  const exp = norm.frames[name];
  const missingCols = Object.keys(exp.columns).filter((c) => !frame.columns.includes(c));
  check(`${name}: columns present`, !missingCols.length, missingCols.join(','));
  for (const p of compareFrame(frame.rows, exp, `normalised ${name}`)) check(p, false);
  check(`${name}: row count`, frame.rows.length === exp.n);
  const names = Object.keys(exp.columns);
  const rType = (c) => (Array.isArray(exp.types) ? exp.types[names.indexOf(c)] : exp.types[c]);
  const typeDiff = names.filter((c) => c !== 'date' && (rType(c) === 'character') !== (frame.types[c] === 'character'));
  check(`${name}: character/numeric column types`, !typeDiff.length, typeDiff.join(','));
}

// ---- collation ------------------------------------------------------------------------
for (const [kind, v] of Object.entries(collation)) {
  const shuffled = [...v.sorted].reverse();
  const got = shuffled.sort(T.rCompare);
  const bad = got.findIndex((x, i) => x !== v.sorted[i]);
  check(`collation ${kind} (${v.sorted.length} values)`, bad < 0, bad >= 0 ? `first difference at ${bad}: ${got[bad]} vs ${v.sorted[bad]}` : '');
}

// ---- period grid ------------------------------------------------------------------------
for (const g of grid) {
  check(`cut m=${g.m} n=${g.n}`, JSON.stringify(T.cutBins(g.m, g.n)) === JSON.stringify(g.cut));
  check(`balanced m=${g.m} n=${g.n}`, JSON.stringify(T.balancedDateGroups(g.weights, g.n)) === JSON.stringify(g.balanced));
}

// ---- misc --------------------------------------------------------------------------------
for (const name of ['both', 'JHU_only']) {
  const r = T.repeatCounts(frames[name].rows);
  for (const p of compareFrame(r, misc.repeats[name], `repeat_counts ${name}`)) check(p, false);
  check(`repeat_counts ${name} rows`, r.length === misc.repeats[name].n);
}
for (const name of ['both', 'JHU_only', 'SKKU_only']) check(`date coverage ${name}`, JSON.stringify(T.dateCoverageLines(frames[name].rows)) === JSON.stringify(T.asArray(misc.coverage[name])), JSON.stringify(T.dateCoverageLines(frames[name].rows)));
for (const [k, src] of [['skku', ['SKKU']], ['jhu', ['JHU']], ['both', ['SKKU', 'JHU']]]) {
  const got = T.defaultFilterSelection(frames.both.rows, src);
  for (const f of Object.keys(misc.defaults[k])) check(`defaults ${k}.${f}`, JSON.stringify(got[f]) === JSON.stringify(T.asArray(misc.defaults[k][f])));
}

// ---- scenarios ----------------------------------------------------------------------------
const settingsOf = (s) => ({ ...s, hours: T.asArray(s.hours), dates: T.asArray(s.dates), period_cutoffs: T.asArray(s.period_cutoffs) });
for (const sc of Object.values(scenarios)) {
  const id = sc.id; const s = settingsOf(sc.settings);
  const rows = frames[sc.frame].rows;
  let d; let info; let error = null;
  try {
    const filtered = T.filterData(rows, s);
    const sel = T.selectGroupDates(filtered, s.group, s.date_selection);
    info = sel.info;
    if (s.compare_periods && ['equal', 'balanced'].includes(s.period_method)) T.validatePeriodN(s.period_n, new Set(sel.rows.filter((r) => r.date !== null).map((r) => r.date)).size);
    d = T.assignTimePeriod(sel.rows, s.compare_periods, s.period_cutoffs, s.period_method, s.period_n);
  } catch (e) { error = e.message; }
  if (sc.error !== undefined) { check(`${id}: error`, error === sc.error, `got ${JSON.stringify(error)}, expected ${JSON.stringify(sc.error)}`); continue; }
  check(`${id}: no error`, error === null, error);
  if (error) continue;
  // filtering and periods
  const ids = d.map((r) => r.observation_id);
  check(`${id}: kept ids`, JSON.stringify(ids) === JSON.stringify(T.asArray(sc.kept.ids)), `${ids.length} vs ${T.asArray(sc.kept.ids).length}`);
  check(`${id}: time_period`, JSON.stringify(d.map((r) => r.time_period)) === JSON.stringify(T.asArray(sc.kept.time_period)));
  check(`${id}: time_period_index`, JSON.stringify(d.map((r) => r.time_period_index)) === JSON.stringify(T.asArray(sc.kept.time_period_index)));
  check(`${id}: candidate count`, T.filterData(rows, s, false).length === sc.candidate_n);
  check(`${id}: period lines`, JSON.stringify(T.describeTimePeriods(d)) === JSON.stringify(T.asArray(sc.period_lines)), JSON.stringify(T.describeTimePeriods(d)));
  if (sc.date_selection) {
    const e = sc.date_selection;
    check(`${id}: date selection text`, T.describeDateSelection(info) === e.text, `${T.describeDateSelection(info)} | ${e.text}`);
    check(`${id}: date selection counts`, info.rows_before === e.rows_before && info.rows_kept === e.rows_kept && info.dates_before === e.dates_before && info.dates_kept === e.dates_kept);
  } else check(`${id}: no date selection info`, info === null);
  // curve summary
  let dec = T.decorateData(d, s.group, s.facet); let levels = null;
  if (s.compare_periods) { const c = T.curvesWithPeriods(dec, s.group); dec = c.rows; levels = c.levels; check(`${id}: curve levels`, JSON.stringify(levels) === JSON.stringify(T.asArray(sc.curve_levels))); }
  for (const p of compareFrame(T.summariseCurves(dec, s.unit, levels), sc.summary, `${id} summary`)) check(p, false);
  // AUC
  for (const p of compareFrame(T.allSelectedAuc(d, s.group, s.unit), sc.auc_all, `${id} auc_all`)) check(p, false);
  sc.auc_pairs.forEach((ap, i) => {
    const r = T.completeDateAuc(d, s.group, ap.reference, ap.comparison, s.unit);
    for (const p of compareFrame(r.pairs, ap.pairs, `${id} auc pair ${i} pairs`)) check(p, false);
    for (const p of compareFrame(r.audit, ap.audit, `${id} auc pair ${i} audit`)) check(p, false);
    check(`${id} auc pair ${i} undated`, r.undated.length === ap.undated_n);
    for (const p of compareFrame(T.summarisePairedAuc(r.pairs), ap.summary, `${id} auc pair ${i} summary`)) check(p, false);
  });
  // date pairing
  sc.pairing.forEach((pp, i) => {
    let data = d;
    if (['config', 'sync'].includes(pp.dimension)) {
      const s2 = { ...s, config: [], sync: [] };
      data = T.assignTimePeriod(T.selectGroupDates(T.filterData(rows, s2), s2.group, s2.date_selection).rows);
    }
    const label = `${id} pairing ${i} (${pp.dimension}: ${pp.reference} vs ${pp.comparison}, ${JSON.stringify(pp.flags)})`;
    const r = T.pairDates(data, pp.dimension, pp.reference, pp.comparison, pp.cutoff, { sameExperiment: pp.flags.same_experiment, separateMales: pp.flags.separate_males, allowUnknown: pp.flags.allow_unknown });
    for (const p of compareFrame(r.pairs, pp.pairs, `${label} pairs`)) check(p, false);
    for (const p of compareFrame(r.audit, pp.audit, `${label} audit`)) check(p, false);
    check(`${label} pair count`, r.pairs.length === pp.pairs.n);
    // matched-block AUC and the gap-by-hour profile (reference: independent R implementation in make_fixtures.R)
    {
      const ba = T.blockAuc(r.pairs); const ad = T.aucDaily(ba.blocks);
      for (const p of compareFrame(ba.blocks, pp.block_auc.blocks, `${label} block AUC blocks`)) check(p, false);
      for (const p of compareFrame(ba.excluded, pp.block_auc.excluded, `${label} block AUC excluded`)) check(p, false);
      for (const p of compareFrame(ad, pp.block_auc.daily, `${label} block AUC daily`)) check(p, false);
      for (const p of compareFrame(T.aucPeriodSummary(ad), pp.block_auc.period, `${label} block AUC periods`)) check(p, false);
      check(`${label} block counts`, T.completeBlockIds(r.pairs).length === pp.complete_blocks && new Set(r.pairs.map((x) => x.pair_block)).size === pp.total_blocks && ba.blocks.length + ba.excluded.length === pp.total_blocks);
      for (const [name, only] of [['profile_all', false], ['profile_complete', true]]) {
        const prof = T.hourProfile(r.pairs, only); const exp = T.asArray(pp[name]);
        check(`${label} ${name} hours`, JSON.stringify(prof.map((x) => x.hour)) === JSON.stringify(exp.map((x) => x.hour)));
        prof.forEach((x, k) => { if (!exp[k]) return; for (const p of compareFrame(x.daily, exp[k].daily, `${label} ${name} ${x.hour}h daily`)) check(p, false); for (const p of compareFrame(x.period, exp[k].period, `${label} ${name} ${x.hour}h period`)) check(p, false); });
      }
    }
    T.asArray(pp.daily).forEach((dd) => {
      const daily = T.pairedDaily(r.pairs, dd.hour);
      for (const p of compareFrame(daily, dd.daily, `${label} daily ${dd.hour}h`)) check(p, false);
      for (const p of compareFrame(T.pairedPeriodSummary(daily), dd.period, `${label} period ${dd.hour}h`)) check(p, false);
    });
  });
}
finish('numerical core vs R');
