// Searching the genotype list by gene names. A genotype such as "tax-2(gk117937); sma-9(wk55)" is read as its genes
// (tax-2, sma-9) so that "tax2 sma-9" finds it without the allele numbers, and matches are ranked: the exact single
// mutant first, other single mutants, doubles, triples and larger, then entries with no gene (controls, N2 labels).
// Pure functions (used by the multi-select in ui.js and by the tests).

const GENE = /([A-Za-z][A-Za-z0-9]*-\d+[A-Za-z]?)\(/g;
const squash = (s) => String(s).toLowerCase().replace(/-/g, '');

// Gene names in a genotype value, in order. "C1", "N2", "daf-2(e1370) LTEE" -> [] , [] , ["daf-2"].
export function genesOf(value) {
  return [...String(value).matchAll(GENE)].map((m) => m[1]);
}
// "single", "double", "triple", "4 genes" ...; empty for values with no gene.
export function genotypeTag(value) {
  const n = genesOf(value).length;
  return n === 0 ? '' : n === 1 ? 'single' : n === 2 ? 'double' : n === 3 ? 'triple' : `${n} genes`;
}
// Query words: split on spaces, ";" and ",", ignoring case and hyphens ("tax2" = "tax-2").
export function queryTokens(q) { return String(q).split(/[\s;,]+/).map(squash).filter(Boolean); }

// null when the value does not match every query word; otherwise a rank key (smaller sorts first).
// A word matches when it occurs anywhere in the value (gene, allele or other text), as the plain search did.
export function genotypeRank(query, value) {
  const tokens = queryTokens(query);
  if (!tokens.length) return [0];
  const v = squash(value);
  if (!tokens.every((t) => v.includes(t))) return null;
  const genes = genesOf(value).map(squash);
  const exact = tokens.every((t) => genes.includes(t) || v === t);
  const group = genes.length === 0 ? 4 : genes.length === 1 ? (exact && tokens.length === 1 ? 0 : 1) : genes.length === 2 ? 2 : 3;
  return [group, exact ? 0 : 1, v.startsWith(tokens[0]) ? 0 : 1];
}
export const compareRank = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d) return d; } return 0; };
