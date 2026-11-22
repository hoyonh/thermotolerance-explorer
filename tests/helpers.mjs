import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, '..');
export const dataDir = process.env.THERMO_DATA_DIR || path.resolve(projectRoot, '..', 'data');
export const loadFixture = (name) => JSON.parse(gunzipSync(readFileSync(path.join(here, 'fixtures', name))).toString('utf8'));
export const readData = (file) => readFileSync(path.join(dataDir, file));

let passed = 0; const failures = [];
export function check(name, ok, detail = '') { if (ok) passed++; else failures.push(`${name}${detail ? `: ${detail}` : ''}`); }
export function finish(title) {
  console.log(`${title}: ${passed} checks passed, ${failures.length} failed`);
  for (const f of failures.slice(0, 40)) console.log('  FAIL ' + f);
  if (failures.length > 40) console.log(`  ... ${failures.length - 40} more`);
  process.exit(failures.length ? 1 : 0);
}

const REL = 1e-9, ABS = 1e-9;
export function same(a, b) {
  const an = a === null || a === undefined || (typeof a === 'number' && Number.isNaN(a));
  const bn = b === null || b === undefined || (typeof b === 'number' && Number.isNaN(b));
  if (an || bn) return an && bn;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= ABS + REL * Math.max(Math.abs(a), Math.abs(b));
  if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b);
  return String(a) === String(b);
}
// Compare JS rows with an R data frame exported by as_cols() ({ n, columns }); returns mismatch descriptions.
export function compareFrame(rows, exp, label, { columns = null, map = {} } = {}) {
  const problems = [];
  if (rows.length !== exp.n) { problems.push(`${label}: ${rows.length} rows, expected ${exp.n}`); return problems; }
  for (const col of columns || Object.keys(exp.columns)) {
    const e = exp.columns[col];
    if (!e) { problems.push(`${label}: column ${col} not in reference`); continue; }
    const key = map[col] || col;
    for (let i = 0; i < rows.length; i++) {
      if (!same(rows[i][key], e[i])) { problems.push(`${label}: row ${i + 1} ${col}: got ${JSON.stringify(rows[i][key])}, expected ${JSON.stringify(e[i])}`); break; }
    }
  }
  return problems;
}
