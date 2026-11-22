// Row-position checks: the viewer's row means (mean curves) and its within-genotype / within-run deviations against an
// independent R calculation (tools/ref_rowfx.R), using the "Does row position matter?" selection. Also covers the
// exclusion rules (filters, quality rule, whole-number rows) through the plate counts.
// Needs R, the lab R explorer next to this folder, and the CSVs.
//   node tests/rowfx.mjs   (THERMO_ROWFX_SKKU / THERMO_ROWFX_JHU override the default files in the data folder)
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as T from '../dist/js/index.js';
import { filtered, decorated, curveSummary } from '../dist/js/pipeline.js';
import { defaultSettings } from '../dist/js/settings.js';
import { rowPositionSettings } from '../dist/js/questions.js';
import { rowEffect, nonIntegerRows } from '../dist/js/rowfx.js';
import { check, finish, dataDir, projectRoot } from './helpers.mjs';

const skkuP = process.env.THERMO_ROWFX_SKKU || path.join(dataDir, 'Lithgow_SKKU_ldh_through_2026-07-25.csv');
const jhuP = process.env.THERMO_ROWFX_JHU || path.join(dataDir, 'Lithgow_NEWset3_Frontiers2020_subset.csv');
if (!existsSync(skkuP) || !existsSync(jhuP)) { console.log('skipped: data files not found'); process.exit(0); }
const tmp = mkdtempSync(path.join(tmpdir(), 'thermo-rowfx-')); const out = path.join(tmp, 'ref.csv');
const r = spawnSync('Rscript', ['--vanilla', path.join(projectRoot, 'tools', 'ref_rowfx.R'), skkuP, jhuP, out], { encoding: 'utf8' });
check('R reference ran', r.status === 0, (r.stderr || '').split('\n').slice(-3).join(' '));
if (r.status === 0) {
  const lines = readFileSync(out, 'utf8').trim().split('\n'); const head = lines[0].replace(/"/g, '').split(',');
  const ref = new Map(lines.slice(1).map((l) => { const c = l.split(','); const o = Object.fromEntries(head.map((h, i) => [h, c[i]])); return [`${o.panel.replace(/"/g, '').replace(' ', ' · ')}|${+o.row}`, o]; }));
  const skku = T.normaliseData(T.readCsv(readFileSync(skkuP, 'utf8')), 'SKKU'), jhu = T.normaliseData(T.readCsv(readFileSync(jhuP, 'utf8')), 'JHU');
  const rows = T.combineFrames([skku, jhu]).rows; const ds = rows.filter((x) => x.date !== null).map((x) => x.date).sort();
  const f = filtered(rows, { ...defaultSettings(), ...rowPositionSettings(rows, ['SKKU', 'JHU'], [ds[0], ds.at(-1)]) });
  const eff = rowEffect(f.data); const sm = curveSummary(decorated(f.data, f.settings), f.settings);
  const num = (x) => (x === 'NA' ? NaN : +x); const close = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) < 1e-9;
  const got = new Map(eff.map((e) => [`${e.panel}|${e.row}`, e]));
  check('same panel-row combinations', ref.size === got.size && [...ref.keys()].every((k) => got.has(k)), `${ref.size} vs ${got.size}`);
  for (const [k, o] of ref) {
    const e = got.get(k); if (!e) continue;
    check(`${k}: plates behind genotype deviation`, e.n_obs === +o.n_gen, `${e.n_obs} vs ${o.n_gen}`);
    check(`${k}: genotype-adjusted deviation`, close(e.genotype_adjusted, num(o.gen_adj)), `${e.genotype_adjusted} vs ${o.gen_adj}`);
    check(`${k}: plates behind within-run deviation`, e.n_matched === +o.n_mat, `${e.n_matched} vs ${o.n_mat}`);
    check(`${k}: within-run deviation`, close(e.matched, num(o.mat_adj)), `${e.matched} vs ${o.mat_adj}`);
    const [panel, row] = k.split('|'); const lab = `Row ${String(+row).padStart(2, '0')}`;
    const hm = [2, 2.5, 3, 3.5].map((h) => sm.find((s) => s.panel === panel && s.curve === lab && s.hours === h)?.mean ?? NaN);
    ['h2', 'h25', 'h3', 'h35'].forEach((c, i) => check(`${k}: mean curve at ${[2, 2.5, 3, 3.5][i]} h`, close(hm[i], num(o[c])), `${hm[i]} vs ${o[c]}`));
    const n = sm.filter((s) => s.panel === panel && s.curve === lab).reduce((a, s) => a + s.n_observations, 0);
    check(`${k}: plate count (exclusion rules)`, n === +o.n_plates, `${n} vs ${o.n_plates}`);
  }
  check('non-integer row plates are not in the row comparison', nonIntegerRows(f.data).length >= 0 && ![...got.values()].some((e) => !Number.isInteger(e.row)));
}
rmSync(tmp, { recursive: true, force: true });
finish('row-position checks vs R');
