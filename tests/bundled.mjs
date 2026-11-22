// Bundled-data checks. Builds a throw-away copy of dist/ with a temporary data/ folder (slices of the project CSVs,
// deleted afterwards), serves it as a plain static site (no launcher), and checks the manifest behaviour:
// empty manifest, default dataset opens on load, switching replaces it, a wrong hash is refused, a bad manifest is ignored.
// Nothing from this test is kept or published.   Run: node tests/bundled.mjs   (THERMO_ENGINE=webkit for Safari's engine)
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium, webkit } from 'playwright';
import { projectRoot, dataDir, check, finish } from './helpers.mjs';

const engine = process.env.THERMO_ENGINE || 'chrome';
const tmp = mkdtempSync(path.join(tmpdir(), 'thermo-bundled-'));
const site = path.join(tmp, 'site'); cpSync(path.join(projectRoot, 'dist'), site, { recursive: true });
const dataOut = path.join(site, 'data');
const lines = (f) => readFileSync(path.join(dataDir, f), 'utf8').split('\n');
const sha = (t) => createHash('sha256').update(t).digest('hex');
// slices: header + rows with date <= cutoff (SKKU "approved" slice), and a smaller "manuscript" slice
const skkuAll = lines('Lithgow_SKKU_ldh.csv'); const head = skkuAll[0]; const dcol = head.replace(/^﻿/, '').split(',').indexOf('date');
const slice = (cut) => [head, ...skkuAll.slice(1).filter((l) => { const d = l.split(',')[dcol]; return d && d <= cut; })].join('\n') + '\n';
const wide = slice('2026-07-25'), narrow = slice('2026-03-01');
const jhu = readFileSync(path.join(dataDir, 'Lithgow_NEWset3_Frontiers2020_subset.csv'), 'utf8');
const files = { 'skku_narrow.csv': narrow, 'skku_wide.csv': wide, 'jhu_subset.csv': jhu };
const entry = (id, label, source, file, def = false, hash) => ({ id, label, source, file, sha256: hash ?? sha(files[file]), default: def });
const setManifest = (m) => writeFileSync(path.join(dataOut, 'manifest.json'), JSON.stringify(m));
mkdirSync(dataOut, { recursive: true });
for (const [n, t] of Object.entries(files)) writeFileSync(path.join(dataOut, n), t);
const nrows = (t) => t.trim().split('\n').length - 1;

// A plain static server with no launcher, as GitHub Pages would serve it.
const port = 8800 + Math.floor(Math.random() * 100);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', site], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const url = `http://127.0.0.1:${port}/`;
const browser = await (engine === 'webkit' ? webkit.launch() : chromium.launch({ channel: 'chrome' }));
const open = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } }); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/404/.test(m.text())) errs.push(m.text()); });
  await page.goto(url); await page.waitForSelector('body[data-ready=true]'); await page.waitForTimeout(700);
  return { ctx, page, errs };
};
const rowsOf = (page, src) => page.evaluate((s) => window.thermo.rows.filter((r) => r.source === s).length, src);
try {
  // 1. empty manifest: viewer unchanged
  setManifest({ manifest_version: 1, datasets: [], glossary: [] });
  let t = await open();
  check('empty manifest: bundled box hidden', await t.page.locator('#bundled-data').isHidden());
  check('empty manifest: nothing loaded', (await t.page.evaluate(() => window.thermo.rows.length)) === 0);
  check('empty manifest: welcome visible', await t.page.locator('#welcome').isVisible());
  check('empty manifest: no errors', t.errs.length === 0, t.errs.join(' | ')); await t.ctx.close();

  // 2. default dataset opens loaded; the other entry replaces it
  setManifest({ manifest_version: 1, datasets: [entry('narrow', 'Manuscript-related SKKU', 'SKKU', 'skku_narrow.csv', true), entry('wide', 'All SKKU through 2026-07-25', 'SKKU', 'skku_wide.csv'), entry('jhu', 'JHU public subset', 'JHU', 'jhu_subset.csv')], glossary: [] });
  t = await open();
  check('default: bundled box shown', await t.page.locator('#bundled-data').isVisible());
  check('default: SKKU slot lists both entries', (await t.page.locator('#bundled-SKKU option').count()) === 2);
  check('default: SKKU slice loaded on open', (await rowsOf(t.page, 'SKKU')) === nrows(narrow), String(await rowsOf(t.page, 'SKKU')));
  check('default: JHU not loaded until chosen', (await rowsOf(t.page, 'JHU')) === 0);
  check('default: plot area populated', (await t.page.evaluate(() => !!window.thermo.view?.ok)));
  await t.page.selectOption('#bundled-SKKU', 'wide'); await t.page.waitForFunction((n) => window.thermo.rows.filter((r) => r.source === 'SKKU').length === n, nrows(wide)); 
  check('switching replaces the SKKU slice', (await rowsOf(t.page, 'SKKU')) === nrows(wide));
  check('loaded file hash equals manifest hash', (await t.page.evaluate(() => window.thermo.files.SKKU.sha256)) === sha(wide));
  check('wide slice has no date after 2026-07-25', (await t.page.evaluate(() => window.thermo.rows.filter((r) => r.source === 'SKKU').every((r) => !r.date || r.date <= '2026-07-25'))));
  check('user CSV picker still works after bundled data', await t.page.locator('#file-SKKU').count() === 1);
  await t.page.setInputFiles('#file-SKKU', path.join(dataDir, 'Lithgow_SKKU_ldh.csv')); await t.page.waitForFunction(() => window.thermo.rows.length > 9000);
  check('own CSV replaces bundled SKKU', (await rowsOf(t.page, 'SKKU')) === nrows(skkuAll.join('\n') + '\n') || (await rowsOf(t.page, 'SKKU')) > nrows(wide));
  check('default: no errors', t.errs.length === 0, t.errs.join(' | ')); await t.ctx.close();

  // 3. wrong hash is refused
  setManifest({ manifest_version: 1, datasets: [entry('bad', 'Bad hash', 'SKKU', 'skku_narrow.csv', true, '0'.repeat(64))], glossary: [] });
  t = await open();
  check('wrong hash: nothing loaded', (await t.page.evaluate(() => window.thermo.rows.length)) === 0);
  check('wrong hash: user told why', /SHA-256/.test(await t.page.locator('body').innerText()));
  await t.ctx.close();

  // 4. malformed manifest ignored
  for (const bad of [{ manifest_version: 2, datasets: [] }, { manifest_version: 1, datasets: [{ id: 'x', label: 'x', source: 'SKKU', file: '../secret.csv', sha256: 'a'.repeat(64) }] }]) {
    setManifest(bad); t = await open();
    check('malformed manifest ignored', (await t.page.locator('#bundled-data').isHidden()) && (await t.page.evaluate(() => window.thermo.rows.length)) === 0); await t.ctx.close();
  }
} catch (e) { check('bundled run completed', false, e.message.split('\n')[0]); }
finally { await browser.close(); server.kill(); rmSync(tmp, { recursive: true, force: true }); }
finish(`bundled-data checks (${engine})`);
