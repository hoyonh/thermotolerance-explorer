// Does the viewer's default view reproduce the manuscript's AUCnorm? Loads the manuscript's thermotolerance.csv, applies the
// viewer's default filters (20 C, OP50-1, standard configuration and synchronization, 2-3.5 h), and compares the
// "All selected data" AUC (equal-observation weighting, mean_survival_pct) per genotype with the R reference.
// Needs R and the manuscript CSV:  THERMO_MANUSCRIPT_CSV=/path/to/thermotolerance.csv node tests/manuscript_auc.mjs
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as T from '../dist/js/index.js';
import { check, finish, projectRoot } from './helpers.mjs';

const csvPath = process.env.THERMO_MANUSCRIPT_CSV;
if (!csvPath) { console.log('skipped: set THERMO_MANUSCRIPT_CSV to the manuscript thermotolerance.csv'); process.exit(0); }
const tmp = mkdtempSync(path.join(tmpdir(), 'thermo-ms-')); const out = path.join(tmp, 'ref.csv');
const r = spawnSync('Rscript', ['--vanilla', path.join(projectRoot, 'tools', 'ref_manuscript_auc.R')], { env: { ...process.env, INPUT: csvPath, OUT: out }, encoding: 'utf8' });
check('R reference ran', r.status === 0, (r.stderr || '').split('\n')[0]);
if (r.status === 0) {
  const ref = new Map(readFileSync(out, 'utf8').trim().split('\n').slice(1).map((l) => { const c = l.match(/^"(.*)",(\d+),(\d+),(.*)$/); return [c[1], { n: +c[2], hours: +c[3], auc: +c[4] }]; }));
  const frame = T.normaliseData(T.readCsv(readFileSync(csvPath, 'utf8')), 'SKKU');
  const def = T.defaultFilterSelection(frame.rows, ['SKKU']);
  check('default filters are 20 C, OP50-1, standard, standard', JSON.stringify(def) === JSON.stringify({ culture: ['20°C'], bacteria: ['OP50-1'], config: ['standard'], sync: ['standard'] }), JSON.stringify(def));
  const rows = T.filterData(frame.rows, { ...def, genotype: [], strain: [], sources: ['SKKU'], quality: true, hours: [2, 3.5] });
  const auc = new Map(T.allSelectedAuc(rows, 'genotype', 'plate').map((a) => [a.group, a]));
  check('same genotypes', ref.size === auc.size && [...ref.keys()].every((g) => auc.has(g)), `${ref.size} vs ${auc.size}`);
  for (const [g, v] of ref) {
    const a = auc.get(g); if (!a) continue;
    check(`${g}: four hours present`, a.complete === true && v.hours === 4);
    check(`${g}: AUCnorm ${v.auc.toFixed(4)}`, Math.abs(a.mean_survival_pct - v.auc) < 1e-9, `${a.mean_survival_pct} vs ${v.auc}`);
  }
}
rmSync(tmp, { recursive: true, force: true });
finish('manuscript AUCnorm reproduction');
