// Port of thermotolerance_explorer/R/data.R: normalisation, filtering, date selection,
// curve summaries and default selections. Rows are plain objects; NA is null (text, dates) or NaN (numbers).
import { asCharacter, isNA, numToString, parseDate, parseRNumber, rMean, rSd, tQuantile, orderBy, rCompare, splitBy, unique, sortUnique, dayNumber } from './rcompat.js';

export const SOURCE_FILES = { SKKU: 'Lithgow_SKKU_ldh.csv', JHU: 'Lithgow_NEWset3.csv' };
const REQUIRED = ['strain', 'genotype', 'date', 'hours', 'alive', 'dead', 'Rup', 'suicide', 'missing', 'expt', 'row', 'culture', 'note'];
const COUNT_FIELDS = ['alive', 'dead', 'Rup', 'suicide', 'missing'];
const NOT_RECORDED = 'Not recorded';

export function rowLabel(row) {
  if (Number.isNaN(row)) return 'Row not recorded';
  if (row === Math.round(row)) return `Row ${String(Math.round(row)).padStart(2, '0')}`;
  return `Row ${row.toFixed(1).padStart(4, '0')}`;
}
// Incubator racks: rows run left to right through the first rack and then the second (SKKU rows 1-6 | 7-12; JHU rows 1-11 | 12 and up; the JHU boundary is from the legend of Supplementary Figure S1 of Hwang et al. 2020, Front. Genet. 11).
export const RACK_LAST_ROW = { SKKU: 6, JHU: 11 };
export function rackOf(source, row) {
  if (Number.isNaN(row) || !(source in RACK_LAST_ROW)) return 'Not recorded';
  return row <= RACK_LAST_ROW[source] ? 'Rack 1' : 'Rack 2';
}
const blank = (x) => isNA(x) || String(asCharacter(x)).trim() === '';
export const plateIdentified = (r) => !(blank(r.date) || blank(r.expt) || blank(r.row));

// normalise_data(): frame = {columns, types, rows} from readCsv().
export function normaliseData(frame, source) {
  for (const f of REQUIRED) if (!frame.columns.includes(f)) throw new Error(`Missing required column: ${f}`);
  const types = { ...frame.types };
  const columns = [...frame.columns];
  const addColumn = (name, type) => { if (!columns.includes(name)) columns.push(name); types[name] = type; };
  const textFields = ['strain', 'genotype', 'culture', 'bacteria', 'config', 'sync'];
  for (const f of textFields) { if (!frame.columns.includes(f)) addColumn(f, 'character'); }
  const rows = frame.rows.map((src, i) => {
    const r = { ...src };
    r.source = source; r.source_row = i + 1; r.observation_id = `${source}:${i + 1}`;
    for (const f of textFields) {
      if (!(f in src)) r[f] = NOT_RECORDED;
      r[`raw_${f}`] = r[f];
      let v = asCharacter(r[f]);
      if (v === null || v === '') v = NOT_RECORDED;
      r[f] = v;
    }
    r.raw_date = asCharacter(src.date);
    r.date = parseDate(src.date);
    if (isNA(r.note)) r.note = '';
    r.note = asCharacter(r.note);
    r.strain = r.strain.replace(/ .*/s, '');
    if (source === 'SKKU') {
      r.strain = r.strain.split('CB1370-SNU').join('CB1370');
      if (r.bacteria === 'OP50') r.bacteria = 'OP50-1';
      else if (r.bacteria === 'plain') r.bacteria = 'OP50';
    } else {
      if (r.culture === '15C') r.culture = '15°C'; else if (r.culture === '20C') r.culture = '20°C';
      r.genotype = r.genotype.split('arl-13(gk691642)').join('arl-13(gk961642)');
    }
    if (source === 'JHU') { r.bacteria = 'OP50'; r.config = 'standard'; r.sync = 'standard'; }
    for (const f of [...COUNT_FIELDS, 'hours']) r[f] = parseRNumber(r[f]);
    let total = 0; for (const f of COUNT_FIELDS) total += r[f];
    r.total = total; // NaN when any count is missing, like rowSums()
    const countsOk = COUNT_FIELDS.every((f) => Number.isFinite(r[f]) && r[f] >= 0 && r[f] === Math.floor(r[f]));
    r.valid = countsOk && Number.isFinite(r.hours) && r.hours >= 0 && Number.isFinite(r.alive + r.dead) && r.alive + r.dead > 0;
    r.survival_pct = r.valid ? (100 * r.alive) / (r.alive + r.dead) : NaN;
    const reasons = [];
    if (!r.valid) reasons.push('Invalid counts, time or zero survival denominator');
    if (Number.isNaN(r.total) || r.total < 15) reasons.push('Total below 15 or missing');
    if (source === 'SKKU') {
      if (r.note === '10 total') reasons.push('SKKU note: 10 total');
    } else {
      if (r.strain === 'IW938cuz_4G') reasons.push('Legacy excluded strain');
      if (/room_temp_high_setup|donotuse|odd_result_all|special_N2/.test(r.note)) reasons.push('Legacy exclusion note');
      if (r.raw_strain !== null && /20C-to-15C|15C-to-20C/.test(String(asCharacter(r.raw_strain)))) reasons.push('Temperature-shift assay');
    }
    r.exclusion_reason = reasons.join('; ');
    r.standard_included = r.valid && r.exclusion_reason === '';
    const value = (x) => (isNA(x) || String(asCharacter(x)) === '' ? NOT_RECORDED : asCharacter(x));
    r.run_id = ['source', 'date', 'expt'].map((f) => value(r[f])).join(' / ');
    r.plate_id = ['run_id', 'row', 'raw_strain', 'culture', 'bacteria', 'config', 'sync'].map((f) => value(r[f])).join(' | ');
    r.row_position = rowLabel(r.row);
    r.rack = rackOf(r.source, r.row);
    return r;
  });
  for (const n of ['source', 'source_row', 'observation_id', 'raw_date', 'total', 'valid', 'survival_pct', 'exclusion_reason', 'standard_included', 'run_id', 'plate_id', 'row_position', 'rack', 'raw_strain', 'raw_genotype', 'raw_culture', 'raw_bacteria', 'raw_config', 'raw_sync']) if (!columns.includes(n)) columns.push(n);
  for (const f of [...COUNT_FIELDS, 'hours', 'total', 'survival_pct', 'source_row']) types[f] = 'double';
  for (const f of ['source', 'observation_id', 'raw_date', 'exclusion_reason', 'run_id', 'plate_id', 'row_position', 'rack', 'note', 'raw_strain', 'raw_genotype', 'raw_culture', 'raw_bacteria', 'raw_config', 'raw_sync']) if (types[f] !== 'logical') types[f] = 'character';
  for (const f of ['valid', 'standard_included']) types[f] = 'logical';
  types.date = 'Date';
  return { columns, types, rows };
}

// rbind() of normalised frames: columns are the union, a column that differs in type becomes text.
export function combineFrames(frames) {
  const columns = unique(frames.flatMap((f) => f.columns));
  const types = {};
  for (const c of columns) {
    const ts = unique(frames.filter((f) => f.columns.includes(c)).map((f) => f.types[c]));
    const present = frames.filter((f) => f.columns.includes(c));
    types[c] = present.length < frames.length && ts.length === 1 && ts[0] === 'character' ? 'character' : ts.length === 1 && present.length === frames.length ? ts[0] : ts.includes('character') ? 'character' : ts.includes('double') ? 'double' : ts[0] === undefined ? 'logical' : ts[0];
  }
  const rows = frames.flatMap((f) => f.rows.map((r) => {
    const o = {};
    for (const c of columns) {
      let v = c in r ? r[c] : (types[c] === 'double' || types[c] === 'integer' ? NaN : null);
      if (types[c] === 'character' && typeof v === 'number') v = numToString(v);
      o[c] = v;
    }
    return o;
  }));
  return { columns, types, rows };
}

// load_data(): texts = { SKKU: csvText, JHU: csvText } (either or both).
export function loadFrames(frames) {
  const parts = Object.entries(frames).map(([source, frame]) => normaliseData(frame, source));
  return parts.length === 1 ? parts[0] : combineFrames(parts);
}

export function filterData(rows, s, applyQuality = true) {
  const sources = asArray(s.sources);
  const fieldSets = ['genotype', 'strain', 'culture', 'bacteria', 'config', 'sync'].map((f) => [f, asArray(s[f])]).filter(([, v]) => v.length).map(([f, v]) => [f, new Set(v)]);
  const dates = asArray(s.dates);
  const range = dates.length === 2 ? dates.map((x) => parseDate(x)) : null;
  const hours = asArray(s.hours);
  const runs = asArray(s.runs).length ? new Set(asArray(s.runs)) : null;
  const excluded = new Set(asArray(s.excluded));
  return rows.filter((r) => {
    if (!sources.includes(r.source)) return false;
    for (const [f, set] of fieldSets) if (!set.has(r[f])) return false;
    if (range) {
      const inDates = r.date !== null && range[0] !== null && range[1] !== null && r.date >= range[0] && r.date <= range[1];
      if (!(inDates || (s.undated === true && r.date === null))) return false;
    }
    if (hours.length === 2 && !(Number.isFinite(r.hours) && r.hours >= hours[0] && r.hours <= hours[1])) return false;
    if (runs && !runs.has(r.run_id)) return false;
    if (applyQuality) {
      if (!(s.quality === true ? r.standard_included : r.valid)) return false;
      if (excluded.has(r.observation_id)) return false;
    }
    return true;
  });
}
export const asArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

// select_group_dates(): returns { rows, info } (info is null when the data are unchanged).
export function selectGroupDates(rows, group, mode = 'all') {
  if (mode === 'all' || !rows.length) return { rows, info: null };
  if (!['shared', 'overlap'].includes(mode)) throw new Error('mode must be shared or overlap');
  const groups = rows.map((r) => asCharacter(r[group]));
  const datesByGroup = new Map();
  rows.forEach((r, i) => { if (r.date !== null) { if (!datesByGroup.has(groups[i])) datesByGroup.set(groups[i], []); datesByGroup.get(groups[i]).push(r.date); } });
  const groupCount = unique(groups).length;
  if (groupCount < 2) return { rows, info: null };
  let keep; let span;
  if (datesByGroup.size < groupCount) { keep = rows.map(() => false); span = [null, null]; }
  else if (mode === 'shared') {
    let shared = null;
    for (const ds of datesByGroup.values()) { const u = new Set(ds); shared = shared === null ? u : new Set([...shared].filter((x) => u.has(x))); }
    keep = rows.map((r) => r.date !== null && shared.has(r.date));
    const sorted = [...shared].sort();
    span = sorted.length ? [sorted[0], sorted[sorted.length - 1]] : [null, null];
  } else {
    const mins = [], maxs = [];
    for (const ds of datesByGroup.values()) { const s = [...ds].sort(); mins.push(s[0]); maxs.push(s[s.length - 1]); }
    span = [mins.sort().at(-1), maxs.sort()[0]];
    keep = rows.map((r) => r.date !== null && r.date >= span[0] && r.date <= span[1]);
  }
  const out = rows.filter((_, i) => keep[i]);
  const datesOf = (rs) => unique(rs.filter((r) => r.date !== null).map((r) => r.date)).length;
  return { rows: out, info: { mode, rows_before: rows.length, rows_kept: out.length, dates_before: datesOf(rows), dates_kept: unique(out.map((r) => r.date)).length, span } };
}

export function describeDateSelection(info) {
  if (!info) return null;
  const what = info.mode === 'shared' ? 'Dates shared by every compared group' : 'Overlapping date range of the compared groups';
  if (!info.dates_kept) return `${what}: none. No date satisfies this rule for the current groups.`;
  return `${what}: ${info.dates_kept} of ${info.dates_before} dates (${info.span[0]} to ${info.span[1]}); ${info.rows_before - info.rows_kept} observations outside them are omitted.`;
}

export function dateCoverageLines(rows) {
  if (!rows.length) return ['No data loaded.'];
  const present = unique(rows.map((r) => r.source));
  const sources = unique([...['SKKU', 'JHU'].filter((s) => present.includes(s)), ...present]);
  const lines = sources.map((src) => {
    const ds = rows.filter((r) => r.source === src && r.date !== null).map((r) => r.date).sort();
    return `${src}: ${ds.length ? `${ds[0]} to ${ds.at(-1)}` : 'no dated observations'}`;
  });
  const undated = rows.filter((r) => r.date === null).length;
  if (undated) lines.push(`${undated.toLocaleString('en-US')} ${undated === 1 ? 'undated observation' : 'undated observations'}`);
  return lines;
}

export function decorateData(rows, group, facet) {
  return rows.map((r) => {
    const panel = facet === 'none' ? 'All selected observations' : facet === 'source_config' ? `${asCharacter(r.source)} · ${asCharacter(r.config) ?? NOT_RECORDED}` : asCharacter(r[facet]);
    return { ...r, curve: asCharacter(r[group]), panel: panel === null ? NOT_RECORDED : panel };
  });
}

// With time periods the app labels each curve "<group> · <period>", ordered by group then period.
export function curvesWithPeriods(rows, group) {
  const out = rows.map((r) => ({ ...r, curve: `${r.curve} · ${r.time_period}` }));
  const order = orderBy(out.map((r, i) => ({ r, i })), [[(x) => asCharacter(x.r[group]), 'collate'], [(x) => x.r.time_period_index, 'number']]);
  return { rows: out, levels: unique(order.map((x) => x.r.curve)) };
}

export function summariseCurves(rows, unit = 'plate', curveLevels = null) {
  if (!rows.length) return [];
  const groups = new Map();
  rows.forEach((r) => {
    const k = JSON.stringify([r.panel, r.curve, r.hours]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  const out = [];
  for (const z of groups.values()) {
    let v;
    if (unit === 'run') {
      const byRun = new Map();
      for (const r of z) { if (!byRun.has(r.run_id)) byRun.set(r.run_id, []); byRun.get(r.run_id).push(r.survival_pct); }
      v = [...byRun.entries()].sort((a, b) => rCompare(a[0], b[0])).map(([, x]) => rMean(x));
    } else v = z.map((r) => r.survival_pct);
    const n = v.length;
    const sd = n > 1 ? rSd(v) : NaN;
    out.push({
      panel: z[0].panel, curve: z[0].curve, hours: z[0].hours, mean: rMean(v), sd, se: n > 1 ? sd / Math.sqrt(n) : NaN,
      ci95: n > 1 ? (tQuantile(0.975, n - 1) * sd) / Math.sqrt(n) : NaN,   // half-width of the 95% confidence interval
      n_units: n, n_observations: z.length, n_runs: unique(z.map((r) => r.run_id)).length,
      n_plates: unique(z.filter(plateIdentified).map((r) => r.plate_id)).length, unit,
    });
  }
  const level = curveLevels ? new Map(curveLevels.map((c, i) => [c, i])) : null;
  return orderBy(out, [[(r) => r.panel, 'collate'], [(r) => (level ? level.get(r.curve) : r.curve), level ? 'number' : 'collate'], [(r) => r.hours, 'number']]);
}

// default_filter_selection(): 20°C, OP50-1 (plus OP50 with JHU), standard configuration and synchronisation.
export function defaultFilterSelection(rows, sources = unique(rows.map((r) => r.source))) {
  const wanted = { culture: ['20°C'], bacteria: ['OP50-1', ...(sources.includes('JHU') ? ['OP50'] : [])], config: ['standard'], sync: ['standard'] };
  const inSources = rows.filter((r) => sources.includes(r.source));
  const out = {};
  for (const [field, values] of Object.entries(wanted)) { const have = new Set(inSources.map((r) => r[field])); out[field] = unique(values).filter((v) => have.has(v)); }
  return out;
}

// repeat_counts(): plates with more than one count at the same hour (a data-entry check).
export function repeatCounts(rows) {
  const d = rows.filter(plateIdentified);
  const key = (r) => `${r.plate_id} ${numToString(r.hours)}`;
  const counts = new Map();
  for (const r of d) counts.set(key(r), (counts.get(key(r)) || 0) + 1);
  const dup = d.filter((r) => counts.get(key(r)) > 1);
  const groups = splitBy(dup.length, (i) => key(dup[i]));
  const out = groups.map(([, idx]) => {
    const z = idx.map((i) => dup[i]);
    return {
      source: z[0].source, date: z[0].date, expt: z[0].expt, row: z[0].row, strain: z[0].strain, hours: z[0].hours, counts: z.length,
      alive_dead: z.map((r) => `${numToString(r.alive)}/${numToString(r.dead)}`).join(' + '),
      notes: unique(z.map((r) => r.note).filter((n) => n)).join('; '),
    };
  });
  return orderBy(out, [[(r) => r.source, 'collate'], [(r) => r.date, 'number'], [(r) => (typeof r.expt === 'number' ? r.expt : asCharacter(r.expt)), typeof out[0]?.expt === 'number' ? 'number' : 'collate'], [(r) => r.row, 'number'], [(r) => r.hours, 'number']]);
}
export { sortUnique, dayNumber };
