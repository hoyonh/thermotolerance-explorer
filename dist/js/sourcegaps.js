// Why a ticked data source contributes nothing. For each selected source whose rows are all removed by the sidebar
// filters, name the filter(s) that remove them on their own and say what that source does contain.
// Pure functions (used by the notice above the curves and by the tests).
import { filterData, asArray } from './data.js';
import { rCompare } from './rcompat.js';

const LABELS = { genotype: 'Genotype', strain: 'Strain', culture: 'Culture temperature', bacteria: 'Bacterial diet', config: 'Experimental configuration', sync: 'Synchronization' };
const SOURCE_NAMES = { SKKU: 'SKKU', JHU: 'JHU' };
const list = (v, max = 3) => { const a = [...v]; return a.slice(0, max).join(', ') + (a.length > max ? ` and ${a.length - max} more` : ''); };

export function sourceGaps(rows, s) {
  const out = [];
  for (const src of asArray(s.sources)) {
    const mine = rows.filter((r) => r.source === src);
    if (!mine.length) continue;
    if (filterData(mine, { ...s, sources: [src] }, false).length > 0) continue;
    const name = SOURCE_NAMES[src] ?? src; const why = [];
    for (const f of Object.keys(LABELS)) {
      const chosen = asArray(s[f]); if (!chosen.length) continue;
      if (filterData(mine, { sources: [src], [f]: chosen }, false).length === 0) {
        const have = [...new Set(mine.map((r) => r[f]).filter((v) => v !== null))].sort(rCompare);
        why.push(`the ${LABELS[f]} filter (${list(chosen)}); ${name} has ${list(have, 4)}`);
      }
    }
    const dates = asArray(s.dates);
    if (dates.length === 2 && filterData(mine, { sources: [src], dates, undated: s.undated }, false).length === 0) {
      const ds = mine.map((r) => r.date).filter((d) => d !== null).sort();
      why.push(`the assay dates (${dates[0]} to ${dates[1]}); ${name} has ${ds[0]} to ${ds.at(-1)}`);
    }
    const hours = asArray(s.hours);
    if (hours.length === 2 && filterData(mine, { sources: [src], hours }, false).length === 0) why.push('the heat-exposure range');
    if (asArray(s.runs).length && filterData(mine, { sources: [src], runs: s.runs }, false).length === 0) why.push('the recorded-runs filter');
    out.push(why.length ? `${name} contributes no data: no rows pass ${why.join(', and ')}.` : `${name} contributes no data: none of its rows pass all the filters together.`);
  }
  return out;
}
