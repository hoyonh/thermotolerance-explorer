// Paired-date comparison card: contemporaneous groups matched on date, hour and conditions.
import { h, clear, hint, field, select, setOptions, checkbox, tabs, dataTable, download } from './ui.js';
import { pairDates, pairedDaily, pairedPeriodSummary } from './pairing.js';
import { assignTimePeriod } from './periods.js';
import { filterData, selectGroupDates } from './data.js';
import { asCharacter, orderBy, rCompare, sortUnique, unique } from './rcompat.js';
import { trendPlot, pairedCurvePlot, profilePlot, aucGapPlot } from './plots.js';
import { blockAuc, aucDaily, aucPeriodSummary, hourProfile, completeBlockIds, WINDOW } from './blockauc.js';
import { safePage } from './pipeline.js';
import { toCsv } from './csvout.js';
import { message } from './view-curves.js';
import { esc } from './chart.js';
import { defaultPairing, dateRangeNote, dataDateSpan } from './settings.js';

const DIMENSIONS = [['Strain / stock', 'strain'], ['Genotype', 'genotype'], ['Configuration', 'config'], ['Synchronization', 'sync']];
const PAGE = 12;
const sign = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;

export function createPairing(app) {
  const p = () => app.pairing;
  const dim = select(DIMENSIONS, p().dimension, (v) => { p().dimension = v; p().reference = ''; p().comparison = ''; p().stratum = ''; p().hour = ''; app.update(); }, { id: 'pair-dimension' });
  const ref = h('select', { class: 'form-control', id: 'pair-reference', 'aria-label': 'Reference' });
  const cmp = h('select', { class: 'form-control', id: 'pair-comparison', 'aria-label': 'Comparison' });
  const cutoff = h('input', { type: 'date', class: 'form-control', id: 'pair-cutoff', value: p().cutoff });
  const hourSel = h('select', { class: 'form-control', id: 'pair-hour', 'aria-label': 'Time point for date trends' });
  const pageIn = h('input', { type: 'number', class: 'form-control', id: 'pair-page', min: 1, step: 1, value: 1 });
  const stratum = h('select', { class: 'form-control', id: 'pair-stratum', 'aria-label': 'Matched conditions and stock combination' });
  ref.addEventListener('change', () => { p().reference = ref.value; p().stratum = ''; app.update(); });
  cmp.addEventListener('change', () => { p().comparison = cmp.value; p().stratum = ''; app.update(); });
  cutoff.addEventListener('change', () => { p().cutoff = cutoff.value; app.update(); });
  hourSel.addEventListener('change', () => { p().hour = hourSel.value; app.update(); });
  pageIn.addEventListener('change', () => { p().page = Math.max(1, Math.trunc(+pageIn.value) || 1); app.update(); });
  stratum.addEventListener('change', () => { p().stratum = stratum.value; app.update(); });
  const rules = {};
  const rule = (key, label) => { const c = checkbox(label, p()[key], (v) => { p()[key] = v; app.update(); }, { id: `pair-${key}` }); rules[key] = c.input; return c.el; };

  const coverage = h('div', { id: 'pair_coverage' });
  const periodMessage = h('div', { id: 'pair_period_message' });
  const absBox = h('div', { class: 'plot', id: 'pair_absolute' }); const diffBox = h('div', { class: 'plot', id: 'pair_difference' }); const periodTable = h('div', { id: 'pair_period_table' });
  const curveCount = h('div', { class: 'hint', id: 'pair_page_count' }); const curveBox = h('div', { class: 'plot', id: 'pair_curves' });
  const auditCounts = h('div', { id: 'pair_audit_counts' }); const unmatched = h('div', { id: 'pair_unmatched' });
  // Across hours: gap by exposure time and matched-block AUC
  const completeBox = checkbox('Only complete blocks (measured at every one of 2, 2.5, 3 and 3.5 h)', p().complete_only, (v) => { p().complete_only = v; app.update(); }, { id: 'pair-complete-only' });
  const profileStatus = h('div', { class: 'hint', id: 'pair_profile_status' }); const profileBox = h('div', { class: 'plot', id: 'pair_profile' }); const profileTable = h('div', { id: 'pair_profile_table' });
  const profileBar = h('div', { class: 'export-bar' });
  const aucMsg = h('div', { id: 'pair_blockauc_message' }); const aucPlotBox = h('div', { class: 'plot', id: 'pair_blockauc_plot' }); const aucTable = h('div', { id: 'pair_blockauc_table' });
  const aucChange = h('div', { id: 'pair_blockauc_change' }); const aucExcluded = h('div', { id: 'pair_blockauc_excluded' }); const aucBlocks = h('div', { id: 'pair_blockauc_blocks' });
  const aucBar = h('div', { class: 'export-bar' });
  const ts = tabs([{ id: 'dates', label: 'Across dates' }, { id: 'hours', label: 'Across hours' }, { id: 'curves', label: 'Paired curves' }, { id: 'audit', label: 'Pairing audit' }]);
  ts.paneFor('dates').append(periodMessage, absBox, diffBox, periodTable, hint('Each point uses only matched observations at the chosen hour. Average observations within each group and matching block, average blocks within a date, then give dates equal weight in each period. A positive gap means the comparison survived better. SE describes variation among date-level gaps; no significance test is performed.'));
  ts.paneFor('hours').append(
    h('h3', { text: 'Gap by exposure time' }),
    hint('Each thin line is one assay date: the gap (comparison − reference, percentage points) at every exposure time that date was measured. Thick lines are period means ± SE across dates. Every eligible matched block counts at each hour, so the number of dates and blocks differs by hour (see the table); an hour with one date has no SE.'),
    completeBox.el, profileStatus, profileBox, profileTable, profileBar,
    h('h3', { text: 'Matched-block AUC (2–3.5 h)' }),
    hint('Area under each group\'s mean survival curve over the fixed 2–3.5 h window (trapezoid; % survival × hours, range 0–150), computed within every matched block under this card\'s matching rules (date, experiment, conditions). Only blocks measured at all of 2, 2.5, 3 and 3.5 h are used; the others are listed as excluded with the hours they lack. Blocks on one date are averaged, then dates carry equal weight in each period. Gap = comparison − reference; mean survival = AUC ÷ 1.5 h. This differs from the date-level Paired AUC card above, which matches on source and date only. No significance test is performed.'),
    aucMsg, aucChange, aucPlotBox, aucTable, h('details', {}, h('summary', { text: 'Block AUC values' }), aucBlocks), h('details', {}, h('summary', { text: 'Excluded blocks: missing exposure times' }), aucExcluded), aucBar);
  ts.paneFor('curves').append(curveCount, curveBox, hint('Only time points observed in both groups within the same matching block are drawn. A date can contribute at one hour but be missing at another.'));
  ts.paneFor('audit').append(auditCounts, hint('The audit covers all sidebar-selected observations in the two chosen groups, before selecting a matched condition combination. First 100 unmatched observations shown; download the audit for every row.'), unmatched);
  const bar = h('div', { class: 'export-bar' });
  const tip = h('div', { class: 'plot-tip', hidden: true }); document.body.append(tip);

  const example = () => {
    Object.assign(app.settings, { sources: app.frames.SKKU ? ['SKKU'] : app.settings.sources, genotype: [], strain: ['N2.thaw', 'N2.therm'], culture: ['20°C'], bacteria: ['OP50-1'], config: ['standard'], sync: [], runs: [], hours: [2, 3.5], group: 'strain', excluded: [], panel_page: 1 });
    const ds = app.rows.filter((r) => r.date !== null).map((r) => r.date).sort(); if (ds.length) app.settings.dates = [ds[0], ds.at(-1)]; app.settings.cut_mode = 'all';
    app.pairing = { ...defaultPairing(), dimension: 'strain', reference: 'N2.thaw', comparison: 'N2.therm', cutoff: '2026-09-01', hour: '3', stratum: '', same_experiment: true, separate_males: true, allow_unknown: false, page: 1 };
    app.syncAll?.(); app.update();
  };
  const el = h('div', { class: 'card paired-card', id: 'pairing-card' },
    h('div', { class: 'card-heading' }, h('h2', { text: 'Paired-date comparison' }), h('button', { type: 'button', class: 'btn', id: 'pair-example', text: 'Example: N2.thaw vs N2.therm', onclick: example })),
    hint('Compare contemporaneous groups first, then examine their difference over time. Uses the sidebar filters and exclusions.'),
    h('div', { class: 'plot-controls' }, field('Compare by', dim, { id: 'pair-dimension' }), field('Reference', ref, { id: 'pair-reference' }), field('Comparison', cmp, { id: 'pair-comparison' }),
      field('Recent period begins', cutoff, { id: 'pair-cutoff' }), field('Time point for date trends', hourSel, { id: 'pair-hour' }), field('Curve panel page (12 per page)', pageIn, { id: 'pair-page' })),
    h('div', { class: 'control-group' }, h('div', { class: 'group-title', text: 'Matching rules' }),
      hint('Always match assay date, heat-exposure time, source, culture temperature, bacterial diet, configuration and synchronization, except the setting being compared. Genotype comparisons also keep the actual stock combinations separate across dates. Configuration and synchronization comparisons pair the same strain/stock; a synchronization comparison matches configurations after removing their leading synchronization label (NS s-NGM NGM-1 pairs with SS s-NGM NGM-1).'),
      rule('same_experiment', 'Also require the same experiment identifier'), rule('separate_males', 'Keep male-labelled and other observations separate'), rule('allow_unknown', 'Allow equal ‘Not recorded’ condition labels to match'),
      hint('Matching is based on recorded labels; it does not establish that unrecorded experimental conditions were identical.')),
    field('Matched conditions and stock combination', stratum, { id: 'pair-stratum' }), coverage, ts.el, bar);

  const cache = { key: '', value: null };
  function sourceData(view) {
    if (!['config', 'sync'].includes(p().dimension)) return view.data;
    const s2 = { ...view.settings, config: [], sync: [] };
    const key = `u${app.version}|${JSON.stringify(s2)}`;
    if (cache.ukey !== key) { cache.ukey = key; cache.udata = assignTimePeriod(selectGroupDates(filterData(app.rows, s2), s2.group, s2.date_selection).rows); }
    return cache.udata;
  }
  const bindTips = (box, lookup) => {
    box.addEventListener('mousemove', (e) => { const m = e.target.closest?.('.mark'); const html = m && lookup(m.getAttribute('data-k')); if (!html) { tip.hidden = true; return; } tip.innerHTML = html; tip.hidden = false; tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 330)}px`; tip.style.top = `${e.clientY + 14}px`; });
    box.addEventListener('mouseleave', () => { tip.hidden = true; });
  };
  let cur = null;
  bindTips(absBox, (k) => dayTip(k)); bindTips(diffBox, (k) => dayTip(k)); bindTips(curveBox, (k) => curveTip(k)); bindTips(profileBox, (k) => profileTip(k)); bindTips(aucPlotBox, (k) => aucTip(k));
  const dayTip = (k) => {
    if (!cur) return null; const [, st, date] = k.split('::'); const d = cur.daily.find((r) => r.pair_stratum === st && r.date === date); if (!d) return null;
    return `${esc(d.date)} · ${d.hours} h<br>${esc(d.period)}<br>${d.n_blocks} matched blocks · observations ${d.n_reference} / ${d.n_comparison}<br>${esc(d.reference)}: ${d.reference_mean.toFixed(2)}%<br>${esc(d.comparison)}: ${d.comparison_mean.toFixed(2)}%<br>${esc(d.comparison)} − ${esc(d.reference)}: ${d.difference_pp.toFixed(2)} percentage points`;
  };
  const profileTip = (k) => {
    if (!cur?.profile) return null; const parts = k.split('::');
    if (parts[0] === 'pm') { const hr = Number(parts[2]); const x = cur.profile.find((q) => q.hour === hr)?.period.find((q) => q.period === parts[1]); if (!x) return null;
      return `${esc(x.period)} · ${hr} h<br>${x.n_dates} dates · ${x.n_blocks} blocks<br>Mean gap ${x.difference_pp.toFixed(2)} pp${Number.isFinite(x.difference_se) ? ` · SE ${x.difference_se.toFixed(2)}` : ' · SE undefined (one date)'}<br>${esc(x.reference)} ${x.reference_mean.toFixed(1)}% · ${esc(x.comparison)} ${x.comparison_mean.toFixed(1)}%`; }
    const hr = Number(parts[3]); const d = cur.profile.find((q) => q.hour === hr)?.daily.find((q) => q.pair_stratum === parts[1] && q.date === parts[2]); if (!d) return null;
    return `${esc(d.date)} · ${hr} h<br>${esc(d.period)} · ${d.n_blocks} matched blocks<br>${esc(d.reference)} ${d.reference_mean.toFixed(1)}% · ${esc(d.comparison)} ${d.comparison_mean.toFixed(1)}%<br>Gap ${d.difference_pp.toFixed(2)} pp`;
  };
  const aucTip = (k) => {
    if (!cur?.aucDaily) return null; const [, st, date] = k.split('::'); const d = cur.aucDaily.find((q) => q.pair_stratum === st && q.date === date); if (!d) return null;
    return `${esc(d.date)} · ${esc(d.period)}<br>${d.n_blocks} complete blocks<br>${esc(d.reference)} AUC ${d.reference_auc.toFixed(1)} · ${esc(d.comparison)} AUC ${d.comparison_auc.toFixed(1)}<br>Gap ${d.difference_auc.toFixed(1)} % survival × hours`;
  };
  const curveTip = (k) => {
    if (!cur) return null; const parts = k.split('::'); const hours = +parts[parts.length - 2]; const i = +parts[parts.length - 1]; const block = parts.slice(1, -2).join('::');
    const r = cur.pages.find((x) => x.pair_block === block && x.hours === hours); if (!r) return null;
    return `${esc(r.pair_panel)}<br>${i === 0 ? 'Reference: ' + esc(r.reference) : 'Comparison: ' + esc(r.comparison)}<br>${r.hours} h · ${(i === 0 ? r.reference_mean : r.comparison_mean).toFixed(2)}%<br>Reference / comparison observations: ${r.n_reference} / ${r.n_comparison}`;
  };
  const btn = (label, id, fn) => h('button', { type: 'button', class: 'btn', id, text: label, onclick: fn });

  const pp = (x) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(1);
  function renderAcrossHours(sel, width) {
    const totalBlocks = new Set(sel.map((r) => r.pair_block)).size; const completeN = completeBlockIds(sel).length;
    const profile = hourProfile(sel, p().complete_only);
    clear(profileStatus).append(`${completeN} of ${totalBlocks} matched blocks in this combination are measured at every one of 2, 2.5, 3 and 3.5 h.${p().complete_only ? ' Only these are used below.' : ' All eligible blocks are used below.'}`);
    if (!profile.length) { clear(profileBox).append(message('No matched blocks for this combination.')); clearAll(profileTable, profileBar); }
    else {
      profileBox.innerHTML = profilePlot({ profile, width, note: dateRangeNote(app.settings, dataDateSpan(app.rows)) }).svg;
      const flat = profile.flatMap((x) => x.period.map((q) => ({ hours: x.hour, ...q })));
      const rows = orderBy(flat, [[(r) => r.hours, 'number'], [(r) => r.period, 'collate']]);
      clear(profileTable).append(dataTable(rows, ['hours', 'period', 'n_dates', 'n_blocks', 'reference_mean', 'comparison_mean', 'difference_pp', 'difference_se']));
      const dailyRows = profile.flatMap((x) => x.daily.map((d) => ({ hours: x.hour, ...d })));
      clear(profileBar).append(btn('Gap by hour: dates CSV', 'pair-profile-dates-csv', () => download('gap_by_hour_dates.csv', toCsv(dailyRows))), btn('Gap by hour: periods CSV', 'pair-profile-periods-csv', () => download('gap_by_hour_periods.csv', toCsv(rows))));
    }
    cur.profile = profile;
    const ba = blockAuc(sel); const daily = aucDaily(ba.blocks); const per = aucPeriodSummary(daily); cur.aucDaily = daily;
    clear(aucMsg).append(h('div', { class: 'notice', text: totalBlocks ? `${ba.blocks.length} of ${totalBlocks} matched blocks have all of ${WINDOW.join(', ')} h and enter the AUC; ${ba.excluded.length} excluded for missing exposure times${ba.excluded.length ? ' (listed under Excluded blocks)' : ''}.${ba.blocks.length ? '' : ' Matched-block AUC is not estimable for this combination; nothing is filled in.'}` : 'No matched blocks for this combination.' }));
    clear(aucChange);
    const hi = per.find((x) => x.period === 'Historic'), re = per.find((x) => x.period === 'Recent');
    if (per.length) aucChange.append(hi && re ? h('p', { class: 'paired-change', text: `Recent − historic: reference ${pp(re.reference_auc - hi.reference_auc)} · comparison ${pp(re.comparison_auc - hi.comparison_auc)} · paired AUC gap ${pp(re.difference_auc - hi.difference_auc)} % survival × hours.` })
      : h('p', { class: 'notice', text: 'Only one period has complete blocks for this combination. Historic-versus-recent change in AUC is not estimable from this selection.' }));
    if (daily.length) aucPlotBox.innerHTML = aucGapPlot({ daily, width, note: dateRangeNote(app.settings, dataDateSpan(app.rows)) }).svg; else clear(aucPlotBox);
    clear(aucTable).append(dataTable(per, ['period', 'n_dates', 'n_blocks', 'reference_auc', 'comparison_auc', 'difference_auc', 'difference_se', 'reference_mean_survival', 'comparison_mean_survival']));
    clear(aucBlocks).append(dataTable(ba.blocks.slice(0, 100), ['date', 'pair_panel', 'period', 'reference_auc', 'comparison_auc', 'difference_auc', 'n_reference', 'n_comparison']), hint(ba.blocks.length > 100 ? 'First 100 blocks shown; download the CSV for all.' : ''));
    clear(aucExcluded).append(dataTable(ba.excluded, [['date', 'date'], ['pair_panel', 'date / experiment'], 'period', 'hours_present', 'hours_missing'], { empty: 'No block is missing an exposure time.' }));
    clear(aucBar).append(btn('Block AUC CSV', 'pair-blockauc-csv', () => download('matched_block_auc.csv', toCsv(ba.blocks))), btn('Block AUC periods CSV', 'pair-blockauc-periods-csv', () => download('matched_block_auc_periods.csv', toCsv(per))),
      btn('Excluded blocks CSV', 'pair-blockauc-excluded-csv', () => download('matched_block_auc_excluded.csv', toCsv(ba.excluded))));
  }
  const clearAll = (...x) => x.forEach(clear);
  return {
    el,
    syncControls() { dim.value = p().dimension; cutoff.value = p().cutoff; pageIn.value = p().page; for (const k of Object.keys(rules)) rules[k].checked = p()[k]; completeBox.input.checked = p().complete_only; },
    render(view) {
      cur = null; tip.hidden = true;
      if (!view.ok) { clearAll(coverage, periodMessage, absBox, diffBox, periodTable, curveBox, auditCounts, unmatched, bar, profileStatus, profileBox, profileTable, profileBar, aucMsg, aucChange, aucPlotBox, aucTable, aucBlocks, aucExcluded, aucBar); clear(coverage).append(message(view.message)); return; }
      const data = sourceData(view);
      const values = sortUnique(data.map((r) => asCharacter(r[p().dimension])));
      if (!values.includes(p().reference)) p().reference = ['wild type', 'N2.thaw', 'N2', 'standard'].find((x) => values.includes(x)) ?? values[0] ?? '';
      if (!values.includes(p().comparison) || p().comparison === p().reference) p().comparison = values.find((x) => x !== p().reference) ?? '';
      setOptions(ref, values.map((v) => [v, v]), p().reference); setOptions(cmp, values.map((v) => [v, v]), p().comparison);
      dim.value = p().dimension; cutoff.value = p().cutoff; pageIn.value = p().page;
      for (const k of Object.keys(rules)) rules[k].checked = p()[k];
      if (!p().reference || !p().comparison) { clearAll(absBox, diffBox, periodTable, curveBox, auditCounts, unmatched, bar, periodMessage, profileStatus, profileBox, profileTable, profileBar, aucMsg, aucChange, aucPlotBox, aucTable, aucBlocks, aucExcluded, aucBar); clear(coverage).append(message('Select two groups. Clear the sidebar genotype or strain filters if a group is missing.')); return; }
      const key = `${app.version}|${JSON.stringify([view.settings, p().dimension, p().reference, p().comparison, p().cutoff, p().same_experiment, p().separate_males, p().allow_unknown])}`;
      if (cache.key !== key) cache.value = null;
      if (!cache.value) { cache.key = key; cache.value = pairDates(data, p().dimension, p().reference, p().comparison, p().cutoff, { sameExperiment: p().same_experiment, separateMales: p().separate_males, allowUnknown: p().allow_unknown }); }
      const result = cache.value;
      const strata = unique(result.pairs.map((r) => r.pair_stratum)); const labels = strata.map((st) => result.pairs.find((r) => r.pair_stratum === st).stratum_label);
      if (!strata.includes(p().stratum)) p().stratum = strata[0] ?? '';
      setOptions(stratum, strata.map((st, i) => [labels[i], st]), p().stratum);
      const sel = result.pairs.filter((r) => r.pair_stratum === p().stratum);
      const hours = [...new Set(sel.map((r) => r.hours))].sort((a, b) => a - b);
      if (!hours.map(String).includes(String(p().hour))) p().hour = String(hours.includes(3) ? 3 : hours[0] ?? '');
      setOptions(hourSel, hours.map((x) => [String(x), String(x)]), p().hour);
      const daily = pairedDaily(sel, Number(p().hour)); const periods = pairedPeriodSummary(daily);
      const a = result.audit; const chosen = (x) => x.pair_status === 'Paired' && x.pair_stratum === p().stratum;
      let text = `${a.filter(chosen).length} of ${a.length} candidate observations in the selected matched combination (all hours). ${a.filter((x) => x.pair_status !== 'Paired').length} observations could not be paired. ${a.filter((x) => x.pair_status === 'Paired' && !chosen(x)).length} paired observations belong to other condition/stock combinations.`;
      if (daily.length) text += ` At ${p().hour} h: ${daily.filter((d) => d.period === 'Historic').length} historic and ${daily.filter((d) => d.period === 'Recent').length} recent paired dates.`;
      if (!result.pairs.length) text += ' No shared observations under these rules. See Pairing audit; a missing match is not a zero difference.';
      if (['config', 'sync'].includes(p().dimension)) text += ' The sidebar configuration and synchronization filters are not applied here, so every recorded setting is available.';
      if (p().allow_unknown) text += ' Unknown metadata are allowed to match; equivalence of those conditions cannot be checked.';
      clear(coverage).append(h('div', { class: 'notice', text }));
      clear(periodMessage);
      if (periods.length) {
        const hi = periods.find((x) => x.period === 'Historic'), re = periods.find((x) => x.period === 'Recent');
        periodMessage.append(hi && re ? h('p', { class: 'paired-change', text: `Recent − historic: reference ${sign(re.reference_mean - hi.reference_mean)} pp · comparison ${sign(re.comparison_mean - hi.comparison_mean)} pp · paired gap ${sign(re.difference_pp - hi.difference_pp)} pp.` })
          : h('p', { class: 'notice', text: 'Only one period has paired dates for this exact condition/stock combination. Historic-versus-recent change is not estimable from this selection.' }));
      }
      const width = Math.max(620, Math.floor(absBox.clientWidth || el.clientWidth - 44 || 900));
      if (daily.length) { clear(absBox); absBox.innerHTML = trendPlot({ daily, width, note: dateRangeNote(app.settings, dataDateSpan(app.rows)) }).svg; clear(diffBox); diffBox.innerHTML = trendPlot({ daily, difference: true, width, note: dateRangeNote(app.settings, dataDateSpan(app.rows)) }).svg; }
      else for (const b of [absBox, diffBox]) clear(b).append(message('No paired observations at this time point. Choose a matched condition combination or check the pairing audit.'));
      clear(periodTable).append(dataTable(periods, ['period', 'n_dates', 'n_blocks', 'reference_mean', 'comparison_mean', 'difference_pp', 'difference_se']));
      const names = unique(sel.map((r) => r.pair_panel)).sort(rCompare); const pages = Math.max(1, Math.ceil(names.length / PAGE));
      const page = safePage(p().page, pages); p().page = page; pageIn.value = page;
      curveCount.textContent = `${names.length} matched date/experiment panels · ${pages} pages`;
      const pageNames = new Set(names.slice((page - 1) * PAGE, page * PAGE)); const pagePairs = sel.filter((r) => pageNames.has(r.pair_panel));
      if (pagePairs.length) curveBox.innerHTML = pairedCurvePlot({ pairs: pagePairs, width, note: dateRangeNote(app.settings, dataDateSpan(app.rows)) }).svg; else clear(curveBox).append(message('No matched curves for these groups and conditions.'));
      cur = { daily, pages: pagePairs };
      completeBox.input.checked = p().complete_only;
      renderAcrossHours(sel, width);
      const counts = new Map(); for (const x of a) counts.set(x.pair_status, (counts.get(x.pair_status) ?? 0) + 1);
      clear(auditCounts).append(dataTable([...counts.entries()].sort((x, y) => rCompare(x[0], y[0])).map(([status, n]) => ({ Status: status, Observations: n })), ['Status', 'Observations']));
      clear(unmatched).append(dataTable(a.filter((x) => x.pair_status !== 'Paired').slice(0, 100), ['observation_id', 'date', 'hours', 'strain', 'expt', 'culture', 'bacteria', 'config', 'sync', 'pair_status']));
      clear(bar).append(btn('Paired dates CSV', 'pair-daily-csv', () => download('paired_dates.csv', toCsv(daily))), btn('Matched blocks CSV', 'pair-blocks-csv', () => download('matched_blocks.csv', toCsv(sel))),
        btn('Period summary CSV', 'pair-period-csv', () => download('paired_period_summary.csv', toCsv(periods))),
        btn('Pairing audit CSV', 'pair-audit-csv', () => download('pairing_audit.csv', toCsv(a.map((x) => ({ ...x, selected_combination: x.pair_stratum === p().stratum }))))));
    },
  };
}
