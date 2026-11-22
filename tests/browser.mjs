// Browser acceptance checks. Starts tools/preview.py, drives the real page, and compares what it shows with
// the Node pipeline (itself checked against R). THERMO_ENGINE=webkit runs the same checks in Safari's engine.
//   node tests/browser.mjs            (Chrome, installed)
//   THERMO_ENGINE=webkit node tests/browser.mjs
import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import * as T from '../dist/js/index.js';
import * as S from '../dist/js/settings.js';
import * as P from '../dist/js/pipeline.js';
import * as Q from '../dist/js/questions.js';
import * as RF from '../dist/js/rowfx.js';
import { check, finish, dataDir, projectRoot } from './helpers.mjs';

const engine = process.env.THERMO_ENGINE || 'chrome';
const art = path.join(projectRoot, 'tests', 'artifacts', engine); mkdirSync(art, { recursive: true });
const csv = (f) => readFileSync(path.join(dataDir, f), 'utf8');
const skkuFile = path.join(dataDir, 'Lithgow_SKKU_ldh.csv'), jhuFile = path.join(dataDir, 'Lithgow_NEWset3.csv');

// expected values from the pipeline
const skku = T.normaliseData(T.readCsv(csv('Lithgow_SKKU_ldh.csv')), 'SKKU');
const both = T.combineFrames([skku, T.normaliseData(T.readCsv(csv('Lithgow_NEWset3.csv')), 'JHU')]);
const exampleSettings = () => {
  const d = T.defaultFilterSelection(skku.rows, ['SKKU']);
  const ds = skku.rows.filter((r) => r.date).map((r) => r.date).sort(); const hs = skku.rows.map((r) => r.hours);
  return S.resetSettings(S.defaultSettings(), { sources: ['SKKU'], defaults: { ...d, genotype: ['wild type', 'sma-9(wk55)'] }, dateRange: [ds[0], ds.at(-1)], hourRange: Math.min(...hs) <= 2 && Math.max(...hs) >= 3.5 ? [2, 3.5] : [Math.min(...hs), Math.max(...hs)] });  // default heat-exposure window is 2–3.5 h when the data cover it
};

const srv = spawn('python3', ['tools/preview.py', '--port', '0'], { cwd: projectRoot, stdio: ['ignore', 'pipe', 'inherit'] });
const url = await new Promise((resolve, reject) => { srv.stdout.on('data', (b) => { const m = /(http:\/\/127\.0\.0\.1:\d+\/)/.exec(String(b)); if (m) resolve(m[1]); }); setTimeout(() => reject(new Error('server did not start')), 8000); });
const browser = await (engine === 'webkit' ? webkit.launch() : chromium.launch({ channel: 'chrome' }));
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const problems = []; var timings;
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
const settle = async () => { await page.waitForFunction(() => document.body.dataset.ready === 'true'); await page.waitForTimeout(350); };
const val = (sel) => page.locator(sel).innerText();
const ui = (fn, arg) => page.evaluate(fn, arg);
const grab = async (sel) => { const [d] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch((e) => { throw new Error(`no download from ${sel}`); }), page.click(sel)]); return { name: d.suggestedFilename(), text: readFileSync(await d.path(), 'utf8') }; };

try {
  // ---- start-up and empty state --------------------------------------------------------------
  const t0 = Date.now();
  await page.goto(url); await page.waitForSelector('body[data-ready=true]');
  check('start-up under 3 s', Date.now() - t0 < 3000, `${Date.now() - t0} ms`);
  check('empty state invites loading data', (await val('#welcome')).includes('Choose your data'));
  check('project-folder button offered by the local server', await page.locator('#load-project').isVisible());

  // ---- loading by file picker (the path used on any computer) ------------------------------------------
  const tLoad = Date.now();
  await page.setInputFiles('#file-SKKU', skkuFile); await page.waitForFunction(() => window.thermo.rows.length > 0 && window.thermo.view?.ok); await settle();
  const loadMs = Date.now() - tLoad;
  check('SKKU loads in under 5 s', loadMs < 5000, `${loadMs} ms`);
  timings = { startup_ms: Date.now() - t0, load_and_first_plot_ms: loadMs };
  const exp = exampleSettings(); const expFiltered = P.filtered(skku.rows, exp);
  const metrics = (await page.locator('.metric-value').allInnerTexts()).map((x) => Number(x.replace(/,/g, '')));
  const expMetrics = [expFiltered.data.length, new Set(expFiltered.data.map((r) => r.run_id)).size, new Set(expFiltered.data.filter(T.plateIdentified).map((r) => r.plate_id)).size, new Set(expFiltered.data.map((r) => r.genotype)).size];
  check('default view metrics match the pipeline', JSON.stringify(metrics) === JSON.stringify(expMetrics), `${metrics} vs ${expMetrics}`);
  check('default sources', JSON.stringify(await ui(() => window.thermo.settings.sources)) === '["SKKU"]');
  check('JHU checkbox disabled until loaded', await page.locator('input[data-source=JHU]').isDisabled());
  check('legend and points drawn', (await page.locator('#curve_container svg').count()) === 1 && (await page.locator('#curve_container .mark').count()) > 100);

  { const off = await ui(() => { const svg = document.querySelector('#curve_container svg'); const means = new Set([...svg.querySelectorAll('circle.mark')].filter((c) => c.getAttribute('data-k').startsWith('mean::')).map((c) => Math.round(+c.getAttribute('cx')))); const obs = [...svg.querySelectorAll('circle.mark')].filter((c) => !c.getAttribute('data-k').startsWith('mean::')); return { means: means.size, offObs: obs.filter((c) => ![...means].some((m) => Math.abs(m - +c.getAttribute('cx')) < 1)).length, obs: obs.length }; });
    check('observations are offset from the means', off.offObs > 0.8 * off.obs, JSON.stringify(off)); }
  // ---- hover, click, inspector, manual exclusion --------------------------------------------------------
  const box = await page.locator('#curve_container .mark').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(150);
  const tip = await page.locator('.plot-tip:not([hidden])').first().innerText().catch(() => '');
  check('hover shows observation details', /survival/.test(tip) && /Alive \/ dead/.test(tip), tip.slice(0, 60));
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(200);
  const selectedId = await ui(() => window.thermo.selected);
  check('click selects an observation', /^SKKU:\d+$/.test(selectedId), String(selectedId));
  check('inspector shows its source row', (await val('#point_detail')).includes(`data row ${selectedId.split(':')[1]}`));
  const nBefore = await ui(() => window.thermo.view.data.length);
  await page.click('#exclude_point'); await settle();
  check('exclusion removes one observation', (await ui(() => window.thermo.view.data.length)) === nBefore - 1);
  check('exclusion count reported', (await val('#excluded_count')).startsWith('1 manually'));
  await page.click('#clear_exclusions'); await settle();
  check('clearing restores it', (await ui(() => window.thermo.view.data.length)) === nBefore);

  // ---- controls ------------------------------------------------------------------------------------------
  { const t = Date.now(); await page.selectOption('#group', 'strain'); await settle(); timings.change_group_ms = Date.now() - t - 350; }
  const strainExp = P.filtered(skku.rows, { ...exp, group: 'strain' });
  check('Color / compare by strain', (await ui(() => window.thermo.view.order.length)) === P.curveOrder(P.decorated(strainExp.data, strainExp.settings)).length);
  await page.selectOption('#facet', 'date'); await settle();
  const panels = await ui(() => window.thermo.view.panels.length);
  check('panels by date paged', panels > 12 && (await val('#panel_count')).includes(`${panels} panels`), `${panels}`);
  await page.fill('#panel_page', '2'); await page.press('#panel_page', 'Tab'); await settle();
  check('second panel page', (await page.locator('#curve_container svg text', { hasText: /^\d{4}-\d\d-\d\d$/ }).count()) > 0);
  await page.selectOption('#facet', 'none'); await page.selectOption('#group', 'genotype'); await settle();
  await page.selectOption('#date_selection', 'shared'); await settle();
  check('shared-dates note', (await val('#data_notice')).includes('Dates shared by every compared group'));
  await page.selectOption('#date_selection', 'all');
  await page.fill('#ms-strain', 'N2.th'); await page.waitForTimeout(150);
  check('filter list narrows while typing', (await page.locator('.ms-option:visible').count()) >= 1);
  await page.keyboard.press('Escape'); await page.click('body', { position: { x: 700, y: 4 } });
  await page.click('#clear'); await settle();
  check('Clear filters selects everything', (await ui(() => window.thermo.settings.culture.length)) === 0);
  await page.click('#example'); await settle();
  check('Example comparison restores the default', (await ui(() => window.thermo.view.data.length)) === expFiltered.data.length);

  // ---- time periods -------------------------------------------------------------------------------------------
  for (const [method, n] of [['equal', 4], ['balanced', 5], ['cutoffs', 3]]) {
    await page.check('#compare_periods'); await page.locator(`input[name=period_method][value=${method}]`).check();
    if (method === 'cutoffs') await page.selectOption('#period_count', String(n)); else await page.selectOption('#period_n', String(n));
    await settle();
    const s = { ...exp, compare_periods: true, period_method: method, period_n: n, period_count: n };
    const f = P.filtered(skku.rows, s);
    const lines = T.describeTimePeriods(f.data);
    const shown = (await page.locator('#period_summary .period-line').allInnerTexts()).map((x) => x.replace(/\n+/g, ' '));
    check(`${method} periods listed as in the pipeline`, shown.length === lines.length && shown.every((x, i) => x.replace(/\s+/g, ' ').startsWith(lines[i].replace(/: [^:]*$/, '').replace(/\s+/g, ' '))), `${shown.length} vs ${lines.length}`);
  }
  await page.fill('#cutoff1', '2026-07-01'); await page.locator('#cutoff1').dispatchEvent('change'); await page.waitForTimeout(300);
  check('non-increasing cutoffs explained', (await val('#curve_container')).includes('strictly increasing order'));
  await page.fill('#cutoff1', '2026-08-01'); await page.locator('#cutoff1').dispatchEvent('change'); await settle();
  // regression: Safari clipped the curves when figures shared clip-path ids (every id on the page must be unique)
  const dupIds = await ui(() => { const seen = new Set(), dup = []; document.querySelectorAll('[id]').forEach((e) => { if (seen.has(e.id)) dup.push(e.id); seen.add(e.id); }); return dup; });
  check('no duplicate element ids (clip paths)', dupIds.length === 0, dupIds.slice(0, 5).join(','));
  // the lowest plotted value must lie inside its panel's clip rectangle
  const clipOk = await ui(() => { const svg = document.querySelector('#curve_container svg'); const cp = svg.querySelector('clipPath rect'); const bottom = +cp.getAttribute('y') + +cp.getAttribute('height'); return [...svg.querySelectorAll('circle.mark')].every((c) => +c.getAttribute('cy') <= bottom); });
  check('every point lies inside the clip rectangle', clipOk);
  await page.uncheck('#compare_periods'); await settle();
  // ---- error bars: 95% confidence interval ---------------------------------------------------------------------
  const lines = () => page.locator('#curve_container svg line').count();
  await page.selectOption('#uncertainty', 'none'); await settle(); const noBars = await lines();
  await page.selectOption('#uncertainty', 'ci95'); await settle();
  const ciSummary = await ui(() => window.thermo.view.summary.filter((s) => Number.isFinite(s.ci95)).length);
  check('95% CI option draws one bar (3 lines) per interval', ciSummary > 0 && (await lines()) - noBars === 3 * ciSummary, `${(await lines()) - noBars} vs ${3 * ciSummary}`);
  const ciTip = await (async () => { const m = await page.locator('#curve_container .mark').last().boundingBox(); await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2); await page.waitForTimeout(120); return page.locator('.plot-tip:not([hidden])').first().innerText().catch(() => ''); })();
  check('mean tooltip reports the interval', /95% CI/.test(ciTip), ciTip.slice(0, 80));
  await page.selectOption('#uncertainty', 'se'); await settle();

  // ---- genotype search: gene words, single mutants first -----------------------------------------------------------
  const opts = async () => page.locator('#curve_container ~ * .ms-option:visible, .ms-list:visible .ms-option').evaluateAll((els) => els.map((e) => ({ code: e.querySelector('.ms-code').childNodes[0].textContent, tag: e.querySelector('.ms-tag')?.textContent ?? '' })));
  await page.fill('#ms-genotype', 'daf-4'); await page.waitForTimeout(150);
  const g1 = await opts(); const order = { single: 1, double: 2, triple: 3 };
  check('typing daf-4 lists single mutants first, tagged', g1.length > 3 && g1[0].tag === 'single' && /^daf-4\(/.test(g1[0].code), JSON.stringify(g1.slice(0, 2)));
  check('then doubles', g1.every((o, i) => i === 0 || (order[o.tag] ?? 9) >= (order[g1[i - 1].tag] ?? 9)) && g1.some((o) => o.tag === 'double'), g1.map((o) => o.tag).join(','));
  await page.fill('#ms-genotype', 'tax2 sma9'); await page.waitForTimeout(150);
  const g2 = await opts();
  check('gene words without allele numbers find the double mutant', g2.some((o) => o.code === 'tax-2(gk117937); sma-9(wk55)' && o.tag === 'double'), JSON.stringify(g2));
  await page.fill('#ms-genotype', ''); await page.keyboard.press('Escape'); await page.click('body', { position: { x: 700, y: 4 } });

  // ---- notice when a filter narrows what the curves represent -----------------------------------------------------
  const notice = () => val('#data_notice');
  await page.selectOption('#group', 'genotype'); await settle();
  check('no narrowing notice without a strain filter', !/curves use only/.test(await notice()));
  await page.fill('#ms-strain', 'DHL107'); await page.waitForTimeout(150); await page.locator('.ms-list:visible .ms-option').first().click(); await settle();
  check('genotype curves name the strains in use', (await notice()).includes('Genotype curves use only the selected strains: DHL107.'), (await notice()).slice(0, 160));
  { const n = await notice(); const i = n.indexOf('curves use only'), j = n.indexOf('omitted by quality'); check('narrowing notice comes before the quality-rules note', i >= 0 && (j === -1 || i < j), n.slice(0, 200)); }
  await page.selectOption('#group', 'strain'); await settle();
  check('strain curves name the genotypes in use', (await notice()).includes('Strain curves use only the selected genotypes: sma-9(wk55).'), (await notice()).slice(0, 160));
  await page.selectOption('#group', 'genotype'); await page.locator('#ms-strain').locator('xpath=ancestor::div[contains(@class,"ms")][1]').locator('.chip-x').first().click(); await settle();
  check('notice disappears when the filter is removed', !/curves use only/.test(await notice()));

  // ---- x-axis labels only at measured hours -----------------------------------------------------------------------
  { const ticks = await page.locator('#curve_container svg text').evaluateAll((els) => els.map((e) => e.textContent).filter((x) => /^\d+(\.\d+)?$/.test(x)));
    const hoursShown = await ui(() => [...new Set(window.thermo.view.dec.rows.map((r) => String(r.hours)))]);
    const xLabels = ticks.filter((x) => hoursShown.includes(x) || !['0', '25', '50', '75', '100'].includes(x));
    check('no x-axis label without data (e.g. 2.25)', !ticks.includes('2.25') && !ticks.includes('2.75') && !ticks.includes('3.25'), ticks.join(',')); }
  // ---- date-cutoff shortcut ------------------------------------------------------------------------------------------
  const svgText = () => page.locator('#curve_container svg').first().innerText().catch(() => '');
  const viewDates = () => ui(() => window.thermo.view.dec.rows.map((r) => r.date));
  const noteIn = async () => (await page.locator('#curve_container svg text').evaluateAll((els) => els.map((e) => e.textContent))).filter((x) => /^Assays? (up to|after|dates)/.test(x));
  const fullDates = await ui(() => window.thermo.settings.dates); const fullLen = (await viewDates()).filter((d) => d !== null).length;
  check('full range by default: no indicator, cutoff date preset', (await noteIn()).length === 0 && (await page.inputValue('#cut-mode')) === 'all' && (await page.inputValue('#cut-date')) === '2026-07-25');
  await page.selectOption('#cut-mode', 'upto'); await settle();
  const cutEarly = await viewDates();
  check('up to and including 2026-07-25: the date range follows', (await page.inputValue('#date-to')) === '2026-07-25' && (await page.inputValue('#date-from')) === fullDates[0]);
  check('up to and including: every plotted observation is on or before the cutoff', cutEarly.length > 0 && cutEarly.every((d) => d !== null && d <= '2026-07-25'), `${cutEarly.length} rows`);
  check('indicator on the figure says how the cutoff is used', JSON.stringify(await noteIn()) === '["Assays up to and including 2026-07-25 only"]', JSON.stringify(await noteIn()));
  check('the indicator is in the exported SVG', (await grab('#plot-svg')).text.includes('Assays up to and including 2026-07-25 only'));
  await page.selectOption('#cut-mode', 'after'); await settle();
  const cutLate = await viewDates();
  check('after the cutoff: range starts the next day', (await page.inputValue('#date-from')) === '2026-07-26' && (await page.inputValue('#date-to')) === fullDates[1]);
  check('after: every plotted observation is later than the cutoff', cutLate.length > 0 && cutLate.every((d) => d !== null && d > '2026-07-25'), `${cutLate.length} rows`);
  check('indicator for the other side', JSON.stringify(await noteIn()) === '["Assays after 2026-07-25 only"]', JSON.stringify(await noteIn()));
  check('before + after partition the full selection', cutEarly.length + cutLate.length === fullLen, `${cutEarly.length} + ${cutLate.length} vs ${fullLen}`);
  await page.fill('#date-to', '2026-08-30'); await page.dispatchEvent('#date-to', 'change'); await settle();
  check('editing the dates by hand drops the shortcut but still states the range', (await page.inputValue('#cut-mode')) === 'all' && JSON.stringify(await noteIn()) === `["Assay dates 2026-07-26 to 2026-08-30 only"]`, JSON.stringify(await noteIn()));
  await page.selectOption('#cut-mode', 'upto'); await settle();
  await page.fill('#cut-date', '2026-06-30'); await page.dispatchEvent('#cut-date', 'change'); await settle();
  check('changing the cutoff date updates range and indicator', (await page.inputValue('#date-to')) === '2026-06-30' && JSON.stringify(await noteIn()) === '["Assays up to and including 2026-06-30 only"]');
  await page.fill('#cut-date', '2026-07-25'); await page.dispatchEvent('#cut-date', 'change'); await settle();
  await page.selectOption('#cut-mode', 'all'); await settle();
  check('All dates restores the full range and removes the indicator', JSON.stringify(await ui(() => window.thermo.settings.dates)) === JSON.stringify(fullDates) && (await noteIn()).length === 0);

  // ---- AUC ----------------------------------------------------------------------------------------------------------
  const expAuc = T.allSelectedAuc(expFiltered.data, 'genotype', 'plate');
  const aucText = await val('#auc_all');
  check('all-selected AUC table', expAuc.every((r) => aucText.includes(r.group) && aucText.includes(r.auc_pct_h.toFixed(2))), aucText.slice(0, 80));
  await page.click('#auc-card button:has-text("Paired AUC")'); await settle();
  check('paired AUC coverage reported', (await val('#auc_coverage')).includes('candidate source/dates'));

  // ---- paired-date comparison -------------------------------------------------------------------------------------------
  { const t = Date.now(); await page.click('#pair-example'); await page.waitForFunction(() => document.body.dataset.ready === 'true' && document.querySelector('#pair_absolute svg')); timings.pairing_example_ms = Date.now() - t; }
  await settle();
  const ex2 = { ...exp, genotype: [], strain: ['N2.thaw', 'N2.therm'], hours: [2, 3.5], group: 'strain' };
  const f2 = P.filtered(skku.rows, ex2);
  const pd = T.pairDates(f2.data, 'strain', 'N2.thaw', 'N2.therm', '2026-09-01');
  const cov = await val('#pair_coverage');
  const paired = pd.audit.filter((x) => x.pair_status === 'Paired').length;
  check('pairing coverage matches the pipeline', cov.includes(`${paired} of ${pd.audit.length} candidate observations`), cov.slice(0, 120));
  check('both trend figures drawn', (await page.locator('#pair_absolute svg').count()) === 1 && (await page.locator('#pair_difference svg').count()) === 1);
  check('paired-gap message', (await val('#pair_period_message')).length > 10);
  // ---- Across hours: gap by exposure time and matched-block AUC ---------------------------------------------------------
  { const st = [...new Set(pd.pairs.map((x) => x.pair_stratum))][0]; const sel = pd.pairs.filter((x) => x.pair_stratum === st);
    const total = new Set(sel.map((x) => x.pair_block)).size, done = T.completeBlockIds(sel).length, ba = T.blockAuc(sel);
    check('Paired AUC card says it is date-level', (await page.locator('#auc-card .tab-btn', { hasText: 'date-level' }).count()) === 1);
    await page.click('#pairing-card button.tab-btn:has-text("Across hours")'); await settle();
    check('profile status counts complete blocks', (await val('#pair_profile_status')).startsWith(`${done} of ${total} matched blocks`), (await val('#pair_profile_status')).slice(0, 80));
    check('profile figure drawn with per-hour counts', (await page.locator('#pair_profile svg').count()) === 1 && (await val('#pair_profile_table')).includes('n_blocks'));
    const nAt = async () => (await page.evaluate(() => [...document.querySelectorAll('#pair_profile_table tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent)))).reduce((o, r) => { o[r[0]] = (o[r[0]] || 0) + Number(r[3]); return o; }, {});
    const all = await nAt();
    const expN = {}; for (const x of sel) expN[x.hours] = (expN[x.hours] || 0) + 1;     // one block per hour; one date per block here
    check('every eligible block counts at its hours', Object.keys(expN).length === Object.keys(all).length && Object.entries(all).every(([h, n]) => expN[Number(h)] === n), JSON.stringify(all) + ' vs ' + JSON.stringify(expN));
    await page.check('#pair-complete-only'); await settle();
    const only = await nAt();
    check('complete-block restriction gives the same n at every hour', Object.values(only).every((n) => n === done), JSON.stringify(only));
    await page.uncheck('#pair-complete-only'); await settle();
    check('AUC message reports blocks and exclusions', (await val('#pair_blockauc_message')).startsWith(`${ba.blocks.length} of ${total} matched blocks have all of 2, 2.5, 3, 3.5 h`) && (await val('#pair_blockauc_message')).includes(`${ba.excluded.length} excluded`), (await val('#pair_blockauc_message')).slice(0, 120));
    check('AUC gap figure drawn', (await page.locator('#pair_blockauc_plot svg').count()) === 1);
    const bk = await grab('#pair-blockauc-csv'); check('block AUC CSV', bk.text.trimEnd().split('\n').length === ba.blocks.length + 1 && bk.text.includes('"difference_auc"'));
    const ex = await grab('#pair-blockauc-excluded-csv'); check('excluded-blocks CSV lists missing hours', ex.text.trimEnd().split('\n').length === ba.excluded.length + 1 && ex.text.includes('"hours_missing"'));
    const hp = await grab('#pair-profile-periods-csv'); check('gap-by-hour CSV', hp.text.includes('"difference_pp"'));
  }
  await page.click('#clear'); await settle();
  await page.selectOption('#pair-dimension', 'sync'); await settle();
  check('synchronization comparison notes lifted filters', (await val('#pair_coverage')).includes('not applied here'), (await val('#pair_coverage')).slice(0, 200));
  await page.selectOption('#pair-dimension', 'strain'); await page.click('#pair-example'); await settle();

  // ---- exports --------------------------------------------------------------------------------------------------------------
  const rowsCsv = await grab('#export-rows');
  check('selected-data CSV has every observation', rowsCsv.text.trimEnd().split('\n').length === (await ui(() => window.thermo.view.data.length)) + 1);
  check('CSV matches R write.csv conventions', rowsCsv.text.startsWith('"strain","date"') && /,NA|NaN|undefined/.test(rowsCsv.text) === false);
  const sumCsv = await grab('#export-summary'); check('summary CSV', sumCsv.text.startsWith('"panel","curve","hours","mean"'));
  const svg = await grab('#plot-svg'); check('figure SVG', svg.text.startsWith('<svg') && svg.text.includes('Survival (%)'));
  writeFileSync(path.join(art, 'figure.svg'), svg.text);
  const [png] = await Promise.all([page.waitForEvent('download'), page.click('#plot-png')]);
  const pngBytes = readFileSync(await png.path()); check('figure PNG', pngBytes.length > 5000 && pngBytes.subarray(1, 4).toString() === 'PNG');
  const pairCsv = await grab('#pair-blocks-csv'); check('matched blocks CSV', pairCsv.text.includes('"pair_block"'));
  await page.click('#auc-card button:has-text("All selected data")'); const aucCsv = await grab('#auc-all-csv'); check('AUC CSV', aucCsv.text.includes('"auc_pct_h"'));

  // ---- saved views -----------------------------------------------------------------------------------------------------------------
  const before = await ui(() => JSON.stringify({ s: window.thermo.settings, p: window.thermo.pairing }));
  const saved = await grab('#save-view'); const doc = JSON.parse(saved.text);
  check('saved view records settings and fingerprints', doc.schema_version === 1 && doc.hashes.SKKU?.length === 64 && doc.settings.pairing.reference === 'N2.thaw');
  await page.selectOption('#group', 'strain'); await page.selectOption('#unit', 'run'); await page.click('#clear'); await settle();
  writeFileSync(path.join(art, 'view.json'), saved.text);
  await page.setInputFiles('#restore-view', path.join(art, 'view.json')); await settle(); await page.waitForTimeout(300);
  const after = await ui(() => JSON.stringify({ s: window.thermo.settings, p: window.thermo.pairing }));
  { const a = JSON.parse(after), b = JSON.parse(before); const diff = [];
    for (const part of ['s', 'p']) for (const k of Object.keys({ ...a[part], ...b[part] })) if (JSON.stringify(a[part][k]) !== JSON.stringify(b[part][k])) diff.push(`${part}.${k}: ${JSON.stringify(b[part][k])} -> ${JSON.stringify(a[part][k])}`);
    check('restore reproduces settings and pairing', diff.length === 0, diff.join('; ')); }
  check('matching fingerprints reported', (await page.locator('.toast').allInnerTexts()).some((x) => x.includes('fingerprints match')));
  // a view saved for different data warns
  doc.hashes.SKKU = '0'.repeat(64); writeFileSync(path.join(art, 'view-changed.json'), JSON.stringify(doc));
  await page.setInputFiles('#restore-view', path.join(art, 'view-changed.json')); await page.waitForTimeout(500);
  check('changed fingerprint warns', (await page.locator('.toast.warning').count()) > 0);
  writeFileSync(path.join(art, 'view-bad.json'), JSON.stringify({ schema_version: 1, settings: { dates: ['x', 'y'] } }));
  await page.setInputFiles('#restore-view', path.join(art, 'view-bad.json')); await page.waitForTimeout(400);
  check('invalid view refused with a message', (await page.locator('.toast.error').count()) > 0);

  // ---- a bad file keeps the previous data; a second source; removal --------------------------------------------------------------------------
  writeFileSync(path.join(art, 'bad.csv'), 'a,b\n1,2\n');
  await page.setInputFiles('#file-SKKU', path.join(art, 'bad.csv')); await page.waitForTimeout(500);
  check('invalid CSV refused, data kept', (await ui(() => window.thermo.rows.length)) === skku.rows.length && (await page.locator('.toast.error').count()) > 1);
  await page.setInputFiles('#file-JHU', jhuFile); await page.waitForFunction(() => window.thermo.rows.length > 20000); await settle();
  check('latest file shown alone', JSON.stringify(await ui(() => window.thermo.settings.sources)) === '["JHU"]');
  await page.check('input[data-source=SKKU]'); await settle();
  check('both sources: separate-laboratories notice', (await val('#data_notice')).includes('different laboratories'));
  check('ticking SKKU beside JHU adds OP50-1 to the untouched diet filter', JSON.stringify((await ui(() => window.thermo.settings.bacteria)).sort()) === '["OP50","OP50-1"]');
  check('the diet change is announced', (await page.locator('.toast:has-text("Bacterial diet filter is now")').count()) >= 1);
  await page.uncheck('input[data-source=SKKU]'); await settle();
  check('unticking SKKU returns the diet filter to OP50', JSON.stringify(await ui(() => window.thermo.settings.bacteria)) === '["OP50"]');
  await page.check('input[data-source=SKKU]'); await settle();
  const dietBox = page.locator('#ms-bacteria').locator('xpath=ancestor::div[contains(@class,"ms")][1]');
  await dietBox.locator('.chip').filter({ hasText: /^OP50×$/ }).locator('.chip-x').click(); await settle();
  const gapNote = await val('#data_notice');
  check('notice says JHU contributes nothing when the diet filter is OP50-1 only', gapNote.includes('JHU contributes no data') && gapNote.includes('Bacterial diet filter (OP50-1)'), gapNote.slice(0, 200));

  // ---- row-position question ---------------------------------------------------------------------------------------
  const beforeQ = JSON.stringify(await ui(() => window.thermo.settings));
  check('Back to my view is hidden until a question is asked', await page.locator('#question-back').isHidden());
  await page.click('#question-row'); await settle();
  const qs = await ui(() => window.thermo.settings);
  check('question sets the view', qs.group === 'row_position' && qs.facet === 'source_config' && qs.mode === 'mean' && qs.uncertainty === 'none' && JSON.stringify(qs.hours) === '[2,3.5]' && JSON.stringify(qs.culture) === '["20°C"]' && JSON.stringify(qs.sync) === '["standard"]' && qs.genotype.length === 0, JSON.stringify(qs).slice(0, 200));
  check('sidebar shows the question settings', (await page.inputValue('#group')) === 'row_position' && (await page.inputValue('#facet')) === 'source_config' && (await page.inputValue('#mode')) === 'mean' && (await page.inputValue('#uncertainty')) === 'none');
  const qView = await ui(() => ({ panels: window.thermo.view.panels, summary: window.thermo.view.summary.map((x) => [x.panel, x.curve, x.hours, x.mean, x.n_observations]) }));
  const qExp = (() => { const f = P.filtered(both.rows, { ...S.defaultSettings(), ...Q.rowPositionSettings(both.rows, ['SKKU', 'JHU'], S.dataDateSpan(both.rows)) }); const d = P.decorated(f.data, f.settings); return { panels: P.panelList(d), summary: P.curveSummary(d, f.settings).map((x) => [x.panel, x.curve, x.hours, x.mean, x.n_observations]) }; })();
  check('three panels as expected', JSON.stringify(qView.panels) === JSON.stringify(qExp.panels) && qView.panels.length === 3, JSON.stringify(qView.panels));
  check('curves match the Node pipeline', qView.summary.length === qExp.summary.length && qView.summary.every((x, i) => x[0] === qExp.summary[i][0] && x[1] === qExp.summary[i][1] && x[2] === qExp.summary[i][2] && Math.abs(x[3] - qExp.summary[i][3]) < 1e-9 && x[4] === qExp.summary[i][4]), `${qView.summary.length} vs ${qExp.summary.length}`);
  { const dashes = await page.locator('#curve_container svg path[stroke-dasharray]').count(); const svgTxt = await page.locator('#curve_container svg text').evaluateAll((els) => els.map((e) => e.textContent).join(' | '));
    check('second-rack curves are dashed and the figure says so', dashes > 0 && svgTxt.includes('Solid = first rack, dashed = second rack (JHU rows 1–11 | 12+; SKKU rows 1–6 | 7+)'), `${dashes} dashed; ${svgTxt.slice(0, 160)}`); }
  check('observation counts are reported', /Fewest observations at any hour, per row/.test(await val('#data_notice')) && (await val('#data_notice')).includes('SKKU · bare'));
  { const keys = await page.locator('#curve_container svg circle.mark').evaluateAll((els) => els.map((e) => e.getAttribute('data-k'))); const lines = await page.locator('#curve_container svg line').count();
    check('only mean points are drawn: no observations, and no error-bar caps beyond axes', keys.length > 0 && keys.every((k) => k.startsWith('mean::')), `${keys.length} marks, ${keys.filter((k) => !k.startsWith('mean::')).length} other`);
    await page.selectOption('#uncertainty', 'se'); await settle(); const withBars = await page.locator('#curve_container svg line').count(); await page.selectOption('#uncertainty', 'none'); await settle();
    check('turning error bars on adds lines, so none are drawn now', withBars > lines, `${lines} vs ${withBars}`); }
  // within-genotype comparison: off by default, opt-in, follows the filters
  check('the question shows the within-genotype card by itself', await page.locator('#rowfx-card').isVisible() && await page.isChecked('#row-within'));
  check('the AUC and paired-date cards are hidden during the question', await page.locator('#auc-card').isHidden() && await page.locator('#pairing-card').isHidden());
  check('the card shows a figure and a table', (await page.locator('#rowfx_plot svg').count()) === 1 && (await page.locator('#rowfx_table tr').count()) > 5);
  { const expRf = (() => { const f = P.filtered(both.rows, { ...S.defaultSettings(), ...Q.rowPositionSettings(both.rows, ['SKKU', 'JHU'], S.dataDateSpan(both.rows)) }); return RF.rowEffect(f.data); })();
    const csvRf = (await grab('#rowfx-csv')).text; const lines = csvRf.trim().split('\n');
    check('row-effect CSV matches the Node calculation', lines.length - 1 === expRf.length && lines[0].includes('genotype_adjusted'), `${lines.length - 1} vs ${expRf.length}`);
    const svgRf = await page.locator('#rowfx_plot svg text').evaluateAll((els) => els.map((e) => e.textContent).join(' | '));
    check('figure labels panels, racks and the baseline', svgRf.includes('JHU · standard') && svgRf.includes('SKKU · bare') && svgRf.includes('rack 2') && svgRf.includes('Genotype + experiment (same recorded run)') && svgRf.includes('Deviation from mean') && svgRf.includes('(percentage points)'), svgRf.slice(0, 200)); }
  await page.selectOption('#group', 'genotype'); await settle();
  check('the card does not depend on Color / compare', await page.locator('#rowfx-card').isVisible());
  await page.selectOption('#group', 'row_position'); await settle();
  await page.uncheck('#row-within'); await settle();
  check('unticking hides it again', await page.locator('#rowfx-card').isHidden());
  // ---- "How to read these figures" ----------------------------------------------------------------------------------
  await page.check('#row-within'); await settle();
  check('the curves card offers the explanation while the question is active', await page.locator('#curves-help').isVisible() && await page.locator('#question-help').isVisible());
  await page.click('#question-help');
  { const dlg = page.locator('dialog#help-dialog[open]'); check('the sidebar button opens the dialog', (await dlg.count()) === 1);
    const txt = await dlg.innerText();
    check('the dialog explains the figures and gives live numbers', ['What is compared', 'Survival curves', 'Row effect within genotype', 'What the current data show', 'Things to keep in mind'].every((s) => txt.includes(s)) && /JHU · standard: mean survival at 3 h/.test(txt) && /SKKU · bare: mean survival at 3 h/.test(txt), txt.slice(0, 120));
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    check('Escape closes the dialog', (await page.locator('dialog#help-dialog').count()) === 0); }
  await page.click('#rowfx-help'); check('the within-genotype card has its own button', (await page.locator('dialog#help-dialog[open]').count()) === 1);
  await page.click('#help-dialog-close'); await page.waitForTimeout(150);
  await page.click('#curves-help'); check('the curves card button opens it too', (await page.locator('dialog#help-dialog[open]').count()) === 1);
  await page.click('#help-dialog-close'); await page.waitForTimeout(150);
  check('closing removes the dialog', (await page.locator('dialog#help-dialog').count()) === 0);
  await page.selectOption('#group', 'rack'); await settle();
  { const order = await ui(() => window.thermo.view.order); const dashes = await page.locator('#curve_container svg path[stroke-dasharray]').count();
    check('Rack is a Color / compare choice with Rack 1 and Rack 2 curves, no dashes', order.includes('Rack 1') && order.includes('Rack 2') && dashes === 0, JSON.stringify(order) + ' ' + dashes); }
  await page.click('#question-back'); await settle();
  check('Back to my view restores the previous settings', JSON.stringify(await ui(() => window.thermo.settings)) === beforeQ && await page.locator('#question-back').isHidden());
  check('the curves-card explanation button goes away with the question', await page.locator('#curves-help').isHidden());
  check('after the question, AUC and paired-date cards are back and the within-genotype card is off', await page.locator('#auc-card').isVisible() && await page.locator('#pairing-card').isVisible() && await page.locator('#rowfx-card').isHidden());
  await page.click('.file-item[data-source=JHU] .link-button'); await settle();
  check('removing a file shows the one that remains', JSON.stringify(await ui(() => window.thermo.settings.sources)) === '["SKKU"]' && (await ui(() => window.thermo.rows.length)) === skku.rows.length);
  await page.screenshot({ path: path.join(art, 'final.png'), fullPage: true });
  const methods = await page.locator('button.tab-btn:has-text("Methods")'); await methods.click();
  check('methods tab lists repeat counts and fingerprints', (await val('#provenance')).includes('sha256'));
  check('no console errors or warnings', problems.length === 0, problems.slice(0, 3).join(' | '));
} catch (e) {
  check('browser run completed', false, e.message.split('\n')[0]);
  await page.screenshot({ path: path.join(art, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  await browser.close(); srv.kill();
}
console.log(`timings (${engine}):`, JSON.stringify(typeof timings === 'undefined' ? {} : timings));
finish(`browser checks (${engine})`);
