// Row position within genotype: a descriptive adjustment. Each observation is compared with the same genotype's own mean,
// which removes average genotype differences; it does not establish that strain, run or date differences cannot contribute
// to a row pattern. Computed per source and configuration panel. Checked against an independent R calculation and against
// the values behind Supplementary Fig. 14 (tests/rowfx.mjs, tools/ref_rowfx.R).
// Plates recorded at a non-integer row (for example 5.5) are left out, as in the supplementary figure; see nonIntegerRows().
//   genotype_adjusted: observation minus the mean of its genotype at the same heat exposure (all rows of that panel);
//                      only genotypes measured in at least two different rows contribute.
//   matched:           the same, but the genotype's mean is taken over the same recorded run (date and experiment) only.
import { rackOf } from './data.js';
import { rCompare } from './rcompat.js';

export const THIN_N = 30;   // fewer observations than this: drawn as a hollow point (same rule as the manuscript's position-effect figure)
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// Plates with a usable survival value but a row that is not a whole number: not part of the row comparison.
export const nonIntegerRows = (rows) => rows.filter((r) => Number.isFinite(r.survival_pct) && Number.isFinite(r.row) && !Number.isInteger(r.row));

export function rowEffect(rows) {
  const usable = rows.filter((r) => Number.isFinite(r.survival_pct) && Number.isInteger(r.row));
  const panels = new Map();
  for (const r of usable) { const p = `${r.source} · ${r.config}`; if (!panels.has(p)) panels.set(p, []); panels.get(p).push(r); }
  const out = [];
  for (const panel of [...panels.keys()].sort(rCompare)) {
    const d = panels.get(panel);
    const deviations = (keyOf) => {
      const groups = new Map();
      for (const r of d) { const k = keyOf(r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
      const byRow = new Map();
      for (const g of groups.values()) {
        if (new Set(g.map((r) => r.row)).size < 2) continue;      // a genotype seen in one row says nothing about rows
        const mu = mean(g.map((r) => r.survival_pct));
        for (const r of g) { if (!byRow.has(r.row)) byRow.set(r.row, []); byRow.get(r.row).push(r.survival_pct - mu); }
      }
      return byRow;
    };
    const gen = deviations((r) => `${r.genotype}\u0001${r.hours}`);
    const mat = deviations((r) => `${r.run_id}\u0001${r.genotype}\u0001${r.hours}`);
    const rowsHere = [...new Set([...gen.keys(), ...mat.keys()])].sort((a, b) => a - b);
    for (const row of rowsHere) {
      const g = gen.get(row) ?? [], m = mat.get(row) ?? [];
      out.push({ panel, source: d[0].source, config: d[0].config, row, rack: rackOf(d[0].source, row),
        n_obs: g.length, genotype_adjusted: g.length ? mean(g) : NaN, n_matched: m.length, matched: m.length ? mean(m) : NaN });
    }
  }
  return out;
}
