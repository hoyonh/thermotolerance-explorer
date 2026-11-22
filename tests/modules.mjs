// Checks of the interface-support modules that need no browser: pipeline, settings, CSV output, glossary, palette.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as T from '../dist/js/index.js';
import * as P from '../dist/js/pipeline.js';
import * as S from '../dist/js/settings.js';
import { toCsv } from '../dist/js/csvout.js';
import { parseGlossaryFile, describeCode, configParts } from '../dist/js/glossary.js';
import { DARK3 } from '../dist/js/palette.js';
import { colorsFor } from '../dist/js/plots.js';
import { check, compareFrame, dataDir, finish, loadFixture, readData } from './helpers.mjs';

const text = (f) => readData(f).toString('utf8');
const skku = T.normaliseData(T.readCsv(text('Lithgow_SKKU_ldh.csv')), 'SKKU');
const jhu = T.normaliseData(T.readCsv(text('Lithgow_NEWset3.csv')), 'JHU');
const frames = { both: T.combineFrames([skku, jhu]), JHU_only: jhu, SKKU_only: skku };

// ---- the interface pipeline reproduces the R scenarios -------------------------------------------------
const scenarios = loadFixture('scenarios.json.gz');
for (const sc of Object.values(scenarios)) {
  const raw = { ...S.defaultSettings(), ...sc.settings };
  raw.hours = T.asArray(sc.settings.hours); raw.dates = T.asArray(sc.settings.dates);
  // the interface keeps all five cutoff fields and uses the first (periods - 1)
  const cuts = T.asArray(sc.settings.period_cutoffs);
  raw.period_cutoffs = [...cuts, ...S.CUTOFF_DEFAULTS.slice(cuts.length)]; raw.period_count = cuts.length + 1;
  for (const f of ['sources', 'genotype', 'strain', 'culture', 'bacteria', 'config', 'sync', 'runs', 'excluded']) raw[f] = T.asArray(sc.settings[f]);
  let f; let err = null;
  try { f = P.filtered(frames[sc.frame].rows, raw); } catch (e) { err = e; }
  if (sc.error !== undefined) { check(`pipeline ${sc.id}: refused`, err instanceof P.Invalid, String(err)); continue; }
  check(`pipeline ${sc.id}: accepted`, !err, String(err));
  if (err) continue;
  check(`pipeline ${sc.id}: same observations`, JSON.stringify(f.data.map((r) => r.observation_id)) === JSON.stringify(T.asArray(sc.kept.ids)));
  const dec = P.decorated(f.data, f.settings);
  for (const p of compareFrame(P.curveSummary(dec, f.settings), sc.summary, `pipeline ${sc.id} summary`)) check(p, false);
  if (f.settings.compare_periods) check(`pipeline ${sc.id}: curve order`, JSON.stringify(P.curveOrder(dec)) === JSON.stringify(T.asArray(sc.curve_levels)));
}
check('pipeline: reversed dates refused', (() => { try { P.filtered(skku.rows, { ...S.defaultSettings(), sources: ['SKKU'], dates: ['2026-01-02', '2026-01-01'], hours: [0, 10] }); } catch (e) { return e.message.startsWith('Assay dates'); } return false; })());
check('pipeline: paging', P.pagePanels(Array.from({ length: 30 }, (_, i) => i), 2).join() === '12,13,14,15,16,17,18,19,20,21,22,23' && P.safePage('x', 3) === 1 && P.safePage(99, 3) === 3);

// ---- settings and saved views ---------------------------------------------------------------------------------
{
  const s = { ...S.defaultSettings(), sources: ['SKKU'], dates: ['2024-12-17', '2026-11-17'], hours: [1.5, 5], period_count: 3, compare_periods: true, genotype: ['wild type'] };
  const doc = S.viewDocument({ settings: s, pairing: { ...S.defaultPairing(), reference: 'A', comparison: 'B' }, auc: { reference: '', comparison: '' }, files: { SKKU: 'x.csv' }, hashes: { SKKU: 'abc' }, savedAt: 'now' });
  check('view saves only active cutoffs', doc.settings.period_cutoffs.length === 2 && !('period_count' in doc.settings));
  check('view saves pairing only when two groups are chosen', 'pairing' in doc.settings && !('auc' in doc.settings));
  const back = S.validateView(JSON.parse(JSON.stringify(doc)));
  check('view round trip', back.settings.period_count === 3 && back.settings.genotype[0] === 'wild type' && back.pairing.reference === 'A' && back.settings.period_cutoffs.length === 5);
  const bad = (mut) => { const d = JSON.parse(JSON.stringify(doc)); mut(d); try { S.validateView(d); return false; } catch { return true; } };
  check('view validation', bad((d) => { d.schema_version = 2; }) && bad((d) => { d.settings.group = 'nope'; }) && bad((d) => { d.settings.hours = [5, 1]; }) && bad((d) => { d.settings.dates = ['x', 'y']; })
    && bad((d) => { d.settings.period_cutoffs = ['2026-08-01', '2026-07-01']; }) && bad((d) => { d.settings.pairing.reference = d.settings.pairing.comparison; }) && bad((d) => { d.settings.period_n = 11; }));
  check('analysis settings trim cutoffs', S.analysisSettings(s).period_cutoffs.length === 2);
}

// ---- CSV output (write.csv conventions) --------------------------------------------------------------------------
{
  const rows = [{ a: 'x "q", y', b: 1.5, c: NaN, d: null, e: true, f: 100000 }, { a: '', b: -2, c: 3, d: 'z', e: false, f: 0.1 + 0.2 }];
  const out = toCsv(rows);
  check('csv quoting and NA', out === '"a","b","c","d","e","f"\n"x ""q"", y",1.5,,,TRUE,100000\n"",-2,3,"z",FALSE,0.3\n', JSON.stringify(out));
  const back = T.readCsv(out);
  check('csv output reads back', back.rows[0].a === 'x "q", y' && Number.isNaN(back.rows[0].c) && back.rows[1].d === 'z');
  const real = toCsv(frames.SKKU_only.rows.slice(0, 50));
  check('real rows survive a write/read cycle', T.readCsv(real).rows.every((r, i) => r.observation_id === frames.SKKU_only.rows[i].observation_id && Math.abs(r.survival_pct - frames.SKKU_only.rows[i].survival_pct) < 1e-9 || Number.isNaN(r.survival_pct)));
}

// ---- glossary --------------------------------------------------------------------------------------------------------------
{
  const g = { terms: [], configs: [] };
  for (const f of ['glossary.csv', 'config_glossary.csv']) { const r = parseGlossaryFile(text(f)); g[r.kind] = r.rows; }
  check('glossary files recognised', g.terms.length > 5 && g.configs.length > 3);
  check('glossary: synchronization meaning', describeCode(g, 'sync', 'NS')[0].startsWith('No-starvation synchronization.'));
  check('glossary: config decoded', configParts(g, 'NS s-NGM EPJS-1').some(([k, v]) => k === 'Label' && v === '1-day lawn (E-JS)') && configParts(g, 'bare').some(([k]) => k === 'Incubator'));
  check('glossary: unknown code has no meaning', describeCode(g, 'config', 'no-such-code').length === 0 && describeCode(g, 'strain', 'N2').length === 0);
  let msg = ''; try { parseGlossaryFile('a,b\n1,2\n'); } catch (e) { msg = e.message; }
  check('glossary: wrong file rejected', msg.startsWith('Not a glossary file'));
}

// ---- palette --------------------------------------------------------------------------------------------------------------------
check('palette tables', DARK3.length === 30 && DARK3.every((p, i) => p.length === i + 1));
{ const c = colorsFor(['a', 'b', 'c']); check('colours follow curve order', c.a === DARK3[2][0] && c.c === DARK3[2][2]); }
// ---- point offsets ----------------------------------------------------------------------------------------------------------
{
  const { hourSpacing, pointOffset, unitHash } = await import('../dist/js/plots.js');
  check('hour spacing', hourSpacing([2, 2.5, 3, 3.5, 3.75, 3.75]) === 0.25 && hourSpacing([3]) === 0.5);
  check('offset is deterministic', pointOffset('SKKU:1', 0, 3, 0.5) === pointOffset('SKKU:1', 0, 3, 0.5) && unitHash('a') !== unitHash('b'));
  const ids = Array.from({ length: 2000 }, (_, i) => `SKKU:${i}`);
  for (const n of [1, 2, 5, 30]) {
    const all = ids.flatMap((id) => Array.from({ length: n }, (_, c) => pointOffset(id, c, n, 0.5)));
    check(`offsets stay within the span for ${n} curve(s)`, Math.max(...all.map(Math.abs)) <= 0.6 * 0.5 / 2 + 1e-9);
  }
  const slotMax = (c) => Math.max(...ids.map((id) => pointOffset(id, c, 3, 0.5))), slotMin = (c) => Math.min(...ids.map((id) => pointOffset(id, c, 3, 0.5)));
  check('curves occupy separate slots', slotMax(0) < slotMin(1) && slotMax(1) < slotMin(2));
  check('one curve is centred on the hour', Math.abs(pointOffset('SKKU:7', 0, 1, 0.5)) <= 0.5 * 0.6 * 0.4 + 1e-9);
}
// ---- date-cutoff shortcut ----------------------------------------------------------------------------------------
{
  const span = ['2024-12-17', '2026-11-18'];
  check('cutoff default is the manuscript date, off by default', S.DATE_CUT_DEFAULT === '2026-07-25' && S.defaultSettings().cut_mode === 'all' && S.defaultSettings().cut_date === '2026-07-25');
  check('cutRange: all keeps the span', JSON.stringify(S.cutRange('all', '2026-07-25', span)) === JSON.stringify(span));
  check('cutRange: up to and including the cutoff', JSON.stringify(S.cutRange('upto', '2026-07-25', span)) === '["2024-12-17","2026-07-25"]');
  check('cutRange: after starts the next day', JSON.stringify(S.cutRange('after', '2026-07-25', span)) === '["2026-07-26","2026-11-18"]');
  check('cutRange: month and year boundaries', S.cutRange('after', '2026-07-31', span)[0] === '2026-08-01' && S.cutRange('after', '2025-12-31', span)[0] === '2026-01-01' && S.cutRange('after', '2024-02-28', ['2024-01-01', '2025-01-01'])[0] === '2024-02-29');
  const on = { ...S.defaultSettings(), dates: S.cutRange('upto', '2026-07-25', span), cut_mode: 'upto' };
  check('note says how the cutoff is used', S.dateRangeNote(on, span) === 'Assays up to and including 2026-07-25 only');
  check('note for the later side', S.dateRangeNote({ ...S.defaultSettings(), cut_mode: 'after', dates: S.cutRange('after', '2026-07-25', span) }, span) === 'Assays after 2026-07-25 only');
  check('no note for the full range', S.dateRangeNote({ ...S.defaultSettings(), dates: span }, span) === '' && S.dateRangeNote(S.defaultSettings(), span) === '');
  check('dates restricted by hand are stated', S.dateRangeNote({ ...S.defaultSettings(), dates: ['2025-03-01', '2026-11-18'] }, span) === 'Assay dates 2025-03-01 to 2026-11-18 only' && S.dateRangeNote({ ...on, dates: ['2024-12-17', '2026-08-01'] }, span) === 'Assay dates 2024-12-17 to 2026-08-01 only');
  check('no note without data', S.dateRangeNote({ ...S.defaultSettings(), dates: ['2025-03-01', '2026-01-01'] }, [null, null]) === '');
  check('data span of loaded rows', JSON.stringify(S.dataDateSpan([{ date: '2025-02-01' }, { date: null }, { date: '2024-05-06' }, { date: '2026-01-01' }])) === '["2024-05-06","2026-01-01"]' && S.dataDateSpan([])[0] === null);
  // a saved view keeps the cutoff; older views (no cutoff keys) still load, with the cutoff off
  const raw = { ...S.defaultSettings(), sources: ['SKKU'], group: 'genotype', dates: ['2024-12-17', '2026-07-25'], hours: [0, 10], cut_mode: 'upto' };
  const doc = S.viewDocument({ settings: raw, files: {}, hashes: {}, savedAt: 'x' });
  const back = S.validateView(JSON.parse(JSON.stringify(doc))).settings;
  check('saved view round-trips the cutoff', back.cut_mode === 'upto' && back.cut_date === '2026-07-25' && S.dateRangeNote(back, span) !== '');
  const old = JSON.parse(JSON.stringify(doc)); delete old.settings.cut_mode; delete old.settings.cut_date;
  check('older saved views load with the cutoff off', S.validateView(old).settings.cut_mode === 'all');
  let bad = false; try { S.validateView({ ...JSON.parse(JSON.stringify(doc)), settings: { ...doc.settings, cut_mode: 'sideways' } }); } catch { bad = true; }
  check('an unknown cutoff choice in a saved view is refused', bad);
}

// ---- genotype search ----------------------------------------------------------------------------------------------
{
  const G = await import('../dist/js/genotype.js');
  const names = [...new Set(skku.rows.map((r) => r.genotype).filter(Boolean))].sort();
  const rankAll = (q) => names.map((v, i) => ({ v, i, k: G.genotypeRank(q, v) })).filter((x) => x.k !== null).sort((a, b) => G.compareRank(a.k, b.k) || a.i - b.i).map((x) => x.v);
  check('genes of single, double and odd values', JSON.stringify(G.genesOf('sma-2(e502) dpy-18(ldh102); sma-9(wk55)')) === '["sma-2","dpy-18","sma-9"]' && G.genesOf('C1').length === 0 && JSON.stringify(G.genesOf('daf-2(e1370) LTEE')) === '["daf-2"]');
  check('tags', G.genotypeTag('sma-9(wk55)') === 'single' && G.genotypeTag('a-1(x); b-2(y)') === 'double' && G.genotypeTag('a-1(x); b-2(y); c-3(z)') === 'triple' && G.genotypeTag('T1') === '');
  const r1 = rankAll('sma-9');
  check('sma-9: exact single mutant first', r1[0] === 'sma-9(wk55)', r1[0]);
  const plain = names.filter((v) => v.toLowerCase().includes('sma-9'));
  check('sma-9: same set as the plain search, only reordered', JSON.stringify([...r1].sort()) === JSON.stringify([...plain].sort()), `${r1.length} vs ${plain.length}`);
  const nGenes = r1.map((v) => G.genesOf(v).length);
  check('sma-9: singles, then doubles, then larger', nGenes.every((n, i) => i === 0 || n >= nGenes[i - 1]), nGenes.join(''));
  const r2 = rankAll('tax2 sma9');
  check('gene words without hyphens or alleles find the double mutant', r2.includes('tax-2(gk117937); sma-9(wk55)') && r2.every((v) => /tax-2/.test(v) && /sma-9/.test(v)), r2.join(' | '));
  check('word order does not matter', JSON.stringify(rankAll('sma-9 tax-2')) === JSON.stringify(rankAll('tax-2 sma-9')));
  check('alleles still match', rankAll('wk55').length >= rankAll('sma-9').length - 1 && rankAll('wk55').every((v) => v.includes('wk55')));
  check('a pasted full genotype finds itself first', rankAll('tax-2(gk117937); sma-9(wk55)')[0] === 'tax-2(gk117937); sma-9(wk55)');
  check('controls with no gene sort last', (() => { const r = rankAll('1'); const i = r.findIndex((v) => G.genesOf(v).length === 0); return i === -1 || r.slice(i).every((v) => G.genesOf(v).length === 0); })());
  check('empty query keeps the list order', G.genotypeRank('', 'x')[0] === 0 && G.genotypeRank('  ', 'x')[0] === 0);
  check('no match returns null', G.genotypeRank('zzz', 'sma-9(wk55)') === null);
}

// ---- source switching: diet default and "contributes no data" notice -------------------------------------------------
{
  const G = await import('../dist/js/sourcegaps.js');
  const rows = frames.both.rows; const set = (a) => JSON.stringify([...a].sort());
  check('ticking JHU adds OP50 to the untouched diet filter', set(S.bacteriaOnSourceChange(rows, ['SKKU'], ['SKKU', 'JHU'], ['OP50-1'])) === set(['OP50-1', 'OP50']));
  check('ticking SKKU after JHU alone adds OP50-1', set(S.bacteriaOnSourceChange(rows, ['JHU'], ['JHU', 'SKKU'], ['OP50'])) === set(['OP50-1', 'OP50']));
  check('unticking JHU removes OP50 again', set(S.bacteriaOnSourceChange(rows, ['SKKU', 'JHU'], ['SKKU'], ['OP50-1', 'OP50'])) === set(['OP50-1']));
  check('a diet filter the user changed is left alone', S.bacteriaOnSourceChange(rows, ['SKKU'], ['SKKU', 'JHU'], ['6C4M']) === null && S.bacteriaOnSourceChange(rows, ['SKKU'], ['SKKU', 'JHU'], []) === null);
  check('no change when the default does not move', S.bacteriaOnSourceChange(rows, ['SKKU'], ['SKKU'], ['OP50-1']) === null);
  const span = S.dataDateSpan(rows);
  const base = { ...S.defaultSettings(), sources: ['SKKU', 'JHU'], dates: span, hours: [0, 10], undated: true, bacteria: ['OP50-1'] };
  const g1 = G.sourceGaps(rows, base);
  check('JHU named as contributing nothing under an OP50-1 diet filter', g1.length === 1 && /^JHU contributes no data/.test(g1[0]) && g1[0].includes('Bacterial diet filter (OP50-1)') && g1[0].includes('JHU has OP50'), g1.join(' | '));
  check('no notice once both diets are chosen', G.sourceGaps(rows, { ...base, bacteria: ['OP50-1', 'OP50'] }).length === 0);
  const g2 = G.sourceGaps(rows, { ...base, bacteria: [], undated: false, dates: ['2026-01-01', '2026-12-31'] });
  check('dates that exclude a source are named', g2.length === 1 && g2[0].includes('assay dates') && g2[0].includes('JHU has 2017-03-12'), g2.join(' | '));
  check('a source not ticked is not reported', G.sourceGaps(rows, { ...base, sources: ['SKKU'] }).length === 0);
}

// ---- row-position question ---------------------------------------------------------------------------------------
{
  const Q = await import('../dist/js/questions.js');
  const rows = frames.both.rows; const span = S.dataDateSpan(rows);
  const dec = T.decorateData(rows.slice(0, 50).map((r) => ({ ...r })), 'row_position', 'source_config');
  check('panel by source and configuration', dec.every((r) => r.panel === `${r.source} · ${r.config}`));
  check('the new panel arrangement is a valid saved-view choice', S.FACET_CHOICES.some((x) => x[1] === 'source_config'));
  const patch = Q.rowPositionSettings(rows, ['SKKU', 'JHU'], span);
  check('the question turns the within-genotype card on', patch.row_within_genotype === true);
  check('question settings', patch.group === 'row_position' && patch.facet === 'source_config' && patch.mode === 'mean' && patch.uncertainty === 'none' && JSON.stringify(patch.hours) === '[2,3.5]' && JSON.stringify(patch.culture) === '["20°C"]' && JSON.stringify(patch.sync) === '["standard"]' && JSON.stringify(patch.config) === '["standard","bare"]' && patch.genotype.length === 0, JSON.stringify(patch));
  check('question diets cover both sources', JSON.stringify([...patch.bacteria].sort()) === '["OP50","OP50-1"]');
  const f = P.filtered(rows, { ...S.defaultSettings(), ...patch });
  check('question keeps only 20°C, standard synchronization, 2–3.5 h, standard or bare', f.data.length > 0 && f.data.every((r) => r.culture === '20°C' && r.sync === 'standard' && r.hours >= 2 && r.hours <= 3.5 && ['standard', 'bare'].includes(r.config)));
  const dec2 = P.decorated(f.data, f.settings); const sum = P.curveSummary(dec2, f.settings);
  check('three panels: JHU standard, SKKU bare, SKKU standard', JSON.stringify(P.panelList(dec2)) === '["JHU · standard","SKKU · bare","SKKU · standard"]', JSON.stringify(P.panelList(dec2)));
  check('rack boundaries: SKKU 6, JHU 11', T.rackOf('SKKU', 6) === 'Rack 1' && T.rackOf('SKKU', 7) === 'Rack 2' && T.rackOf('SKKU', 5.5) === 'Rack 1' && T.rackOf('JHU', 11) === 'Rack 1' && T.rackOf('JHU', 12) === 'Rack 2' && T.rackOf('JHU', 15) === 'Rack 2');
  check('unrecorded row or unknown source has no rack', T.rackOf('JHU', NaN) === 'Not recorded' && T.rackOf('other', 3) === 'Not recorded');
  check('every row carries its rack', rows.every((r) => r.rack === T.rackOf(r.source, r.row)) && S.GROUP_CHOICES.some((x) => x[1] === 'rack'));
  check('rack is a valid Color / compare choice', P.curveOrder(P.decorated(P.filtered(rows, { ...S.defaultSettings(), ...patch, group: 'rack' }).data, { group: 'rack', facet: 'source_config', compare_periods: false })).every((c) => ['Rack 1', 'Rack 2', 'Not recorded'].includes(c)));
  const note = Q.rowCountNote(sum);
  check('count note names the thin rows', /SKKU · bare/.test(note) && /under 10/.test(note) && /JHU · standard: \d+–\d+/.test(note), note.slice(0, 200));
  check('count note is empty without data', Q.rowCountNote([]) === '');
  const only = Q.rowPositionSettings(frames.SKKU_only.rows, ['SKKU'], span);
  check('one source only: SKKU defaults', JSON.stringify(only.bacteria) === '["OP50-1"]' && JSON.stringify(only.sources) === '["SKKU"]');
}

// ---- row effect within genotype -------------------------------------------------------------------------------------
{
  const RF = await import('../dist/js/rowfx.js');
  const mk = (source, config, genotype, run_id, row, hours, survival_pct) => ({ source, config, genotype, run_id, row, hours, survival_pct });
  const data = [mk('SKKU', 'bare', 'A', 'X', 1, 3, 80), mk('SKKU', 'bare', 'A', 'X', 2, 3, 60),   // A: same run, two rows
    mk('SKKU', 'bare', 'C', 'X', 1, 3, 50), mk('SKKU', 'bare', 'C', 'Y', 2, 3, 70),               // C: two rows, different runs
    mk('SKKU', 'bare', 'B', 'X', 1, 3, 10),                                                          // B: one row only
    mk('SKKU', 'bare', 'A', 'Z', 7, 2.5, 40), mk('SKKU', 'bare', 'A', 'Z', 8, 2.5, 20),            // other hour, rack 2
    mk('JHU', 'standard', 'A', 'W', 1, 3, 90), mk('JHU', 'standard', 'A', 'W', 2, 3, 70), mk('JHU', 'standard', 'A', 'V', NaN, 3, 5), mk('JHU', 'standard', 'A', 'V', 3, 3, NaN)];
  const out = RF.rowEffect(data); const at = (panel, row) => out.find((r) => r.panel === panel && r.row === row);
  check('panels per source and configuration, rows ascending', JSON.stringify(out.map((r) => `${r.panel}:${r.row}`)) === '["JHU · standard:1","JHU · standard:2","SKKU · bare:1","SKKU · bare:2","SKKU · bare:7","SKKU · bare:8"]', JSON.stringify(out.map((r) => `${r.panel}:${r.row}`)));
  check('genotype-adjusted deviation uses genotypes seen in two rows only', at('SKKU · bare', 1).n_obs === 2 && Math.abs(at('SKKU · bare', 1).genotype_adjusted - 0) < 1e-12 && at('SKKU · bare', 2).n_obs === 2);
  check('a genotype in one row (B) is left out', !out.some((r) => r.n_obs > 2 && r.panel === 'SKKU · bare' && r.row === 1));
  check('matched deviation needs the same run: only A', at('SKKU · bare', 1).n_matched === 1 && Math.abs(at('SKKU · bare', 1).matched - 10) < 1e-12 && at('SKKU · bare', 2).n_matched === 1 && Math.abs(at('SKKU · bare', 2).matched + 10) < 1e-12);
  check('values are relative to each genotype at the same exposure', Math.abs(at('SKKU · bare', 7).genotype_adjusted - 10) < 1e-12 && Math.abs(at('SKKU · bare', 8).genotype_adjusted + 10) < 1e-12);
  check('racks are assigned by source', at('SKKU · bare', 7).rack === 'Rack 2' && at('SKKU · bare', 2).rack === 'Rack 1' && at('JHU · standard', 2).rack === 'Rack 1');
  check('rows without a row number or survival are ignored', out.filter((r) => r.panel === 'JHU · standard').length === 2);
  check('deviations balance within each genotype group', Math.abs(out.filter((r) => r.panel === 'SKKU · bare' && r.row <= 2).reduce((s, r) => s + r.genotype_adjusted * r.n_obs, 0)) < 1e-9);
  check('nothing to compare returns nothing', RF.rowEffect([mk('SKKU', 'bare', 'A', 'X', 1, 3, 50)]).length === 0 && RF.rowEffect([]).length === 0);
  // on the project data, the question's selection reproduces the figures I read off by hand: JHU falls from row 1 to row 8
  const sel = P.filtered(frames.both.rows, { ...S.defaultSettings(), ...(await import('../dist/js/questions.js')).rowPositionSettings(frames.both.rows, ['SKKU', 'JHU'], S.dataDateSpan(frames.both.rows)) }).data;
  const real = RF.rowEffect(sel); const g = (p, r) => real.find((x) => x.panel === p && x.row === r);
  check('JHU: clearly above its genotype mean in row 1 and below it by row 8', g('JHU · standard', 1).genotype_adjusted > 5 && g('JHU · standard', 8).genotype_adjusted < -3, `${g('JHU · standard', 1).genotype_adjusted} ${g('JHU · standard', 8).genotype_adjusted}`);
  check('SKKU standard: within a few points of zero in rows 1-6', [1, 2, 3, 4, 5, 6].every((r) => Math.abs(g('SKKU · standard', r).genotype_adjusted) < 5));
  check('SKKU bare: falls across the lower rack and restarts in the upper', g('SKKU · bare', 1).genotype_adjusted - g('SKKU · bare', 6).genotype_adjusted > 10 && g('SKKU · bare', 7).genotype_adjusted > g('SKKU · bare', 6).genotype_adjusted + 10);
  check('setting defaults off and is a saved-view field', S.defaultSettings().row_within_genotype === false && S.validateView(JSON.parse(JSON.stringify(S.viewDocument({ settings: { ...S.defaultSettings(), sources: ['SKKU'], dates: ['2024-12-17', '2026-07-25'], hours: [0, 10], row_within_genotype: true }, files: {}, hashes: {}, savedAt: 'x' })))).settings.row_within_genotype === true);
}

// ---- x-axis labels only where there are data -------------------------------------------------------------------------
{
  const { hourTicks } = await import('../dist/js/plots.js');
  check('hour ticks are the measured hours', JSON.stringify(hourTicks([3, 2, 2.5, 3.5, 2, 3])) === '[2,2.5,3,3.5]');
  check('irregular hours keep their own labels', JSON.stringify(hourTicks([1.5, 2, 4, 5])) === '[1.5,2,4,5]');
  check('float noise does not create extra ticks', JSON.stringify(hourTicks([2.5, 2.5000000001, 3])) === '[2.5,3]');
  check('a single hour has one tick', JSON.stringify(hourTicks([3])) === '[3]');
  check('too many hours fall back to rounded ticks', hourTicks(Array.from({ length: 25 }, (_, i) => 1 + i * 0.25)).length < 12);
}

// ---- "How to read these figures" ---------------------------------------------------------------------------------------
{
  const Q = await import('../dist/js/questions.js'); const RFX = await import('../dist/js/rowfx.js');
  const live = Q.rowLiveNumbers(frames.both.rows, ['SKKU', 'JHU'], S.dataDateSpan(frames.both.rows));
  check('live numbers: one line per panel', live.length === 3 && live[0].startsWith('JHU · standard:') && live[1].startsWith('SKKU · bare:') && live[2].startsWith('SKKU · standard:'), JSON.stringify(live).slice(0, 300));
  check('live numbers state survival and within-genotype extremes', live.every((l) => /mean survival at 3 h (falls|rises) from [\d.]+% in Row \d\d to [\d.]+% in Row \d\d/.test(l) && /within genotype, highest at row \d+ \([+−]?[\d.]+ points\) and lowest at row \d+/.test(l)), live[0]);
  check('live numbers never quote unrecorded or thin rows', live.every((l) => !/not recorded/i.test(l)) && !/row 1[3-5]\b/.test(live[0]), live[0]);
  check('live numbers agree with the row-effect calculation', (() => { const sel = P.filtered(frames.both.rows, { ...S.defaultSettings(), ...Q.rowPositionSettings(frames.both.rows, ['SKKU', 'JHU'], S.dataDateSpan(frames.both.rows)) }).data; const e = RFX.rowEffect(sel).filter((x) => x.panel === 'JHU · standard' && x.n_obs >= 30); const hi = e.reduce((a, b) => (b.genotype_adjusted > a.genotype_adjusted ? b : a)); return live[0].includes(`highest at row ${hi.row} (`); })());
  check('no data: no live numbers', Q.rowLiveNumbers([], [], [null, null]).length === 0);
  const sec = Q.rowHelpSections(live);
  check('help sections cover what, curves, within genotype, numbers and caveats', JSON.stringify(sec.map((s) => s.heading)) === '["What is compared","Survival curves","Row effect within genotype","What the current data show","Things to keep in mind"]');
  check('help states the rack layout and container history', /rows 1–6 are the first rack/.test(sec[0].paragraphs[0]) && /rows 12 and up/.test(sec[0].paragraphs[0]) && /without the inner container/.test(sec[0].paragraphs[1]));
  check('help text without data asks to load data', Q.rowHelpSections([])[3].paragraphs[0] === 'Load data to see numbers here.');
}

// ---- regression checks added for the pre-release fixes ----------------------------------------------------------------
import { separatedFields } from '../dist/js/separation.js';
{
  const sep = (group, facet) => separatedFields({ group, facet });
  check('pooling warning: source_config panels separate source and config', sep('genotype', 'source_config').has('source') && sep('genotype', 'source_config').has('config'));
  check('pooling warning: config panels separate config only', sep('genotype', 'config').has('config') && !sep('genotype', 'config').has('source'));
  check('pooling warning: group and facet are both counted', sep('bacteria', 'culture').has('bacteria') && sep('bacteria', 'culture').has('culture') && !sep('bacteria', 'culture').has('sync'));
  const s = { ...S.defaultSettings(), sources: ['SKKU'], dates: ['2024-12-17', '2026-07-25'], hours: [0, 10], excluded: ['SKKU:12', 'SKKU:99'], genotype: ['wild type'] };
  const view = JSON.parse(JSON.stringify(S.viewDocument({ settings: s, files: { SKKU: 'a.csv' }, hashes: { SKKU: 'abc' }, savedAt: 'x' }))); view.hash_algorithm = 'sha256';
  const back = S.validateView(view).settings;
  const same = S.reconcileRestoredView(view, back, { SKKU: 'abc' });
  check('restore: matching fingerprints keep manual exclusions', same.status === 'match' && same.withheld === 0 && same.settings.excluded.length === 2);
  const diff = S.reconcileRestoredView(view, back, { SKKU: 'zzz' });
  check('restore: changed data withhold manual exclusions and report the count', diff.status === 'differ' && diff.withheld === 2 && diff.settings.excluded.length === 0);
  check('restore: other settings survive when exclusions are withheld', diff.settings.genotype.join() === 'wild type');
  check('restore: input settings are not mutated', back.excluded.length === 2);
  check('restore: no loaded data keeps settings and reports nodata', S.reconcileRestoredView(view, back, {}).status === 'nodata');
  const extra = S.reconcileRestoredView(view, back, { SKKU: 'abc', JHU: 'q' });
  check('restore: an extra loaded source counts as a mismatch', extra.status === 'differ' && extra.withheld === 2);
}

finish('interface modules');
