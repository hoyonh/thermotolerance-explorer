// Plain-language meanings for condition codes (port of R/glossary.R). Codes stay the filter values.
import { readCsv } from './csv.js';
import { asCharacter } from './rcompat.js';

export const GLOSSARY_CATEGORIES = { sync: 'synchronization', bacteria: 'bacterial diet', config: 'configuration' };
export const GLOSSARY_HEADINGS = { synchronization: 'Synchronization', growth: 'Growth plates', assay: 'Assay plates', medium: 'Media', configuration: 'Incubator setup', 'bacterial diet': 'Bacterial diet', term: 'Terms' };
const TERM_COLS = ['item', 'category', 'definition'];
const CONFIG_COLS = ['config', 'label1', 'synchronization', 'growth', 'assay'];

export const emptyGlossary = () => ({ terms: [], configs: [] });

// Accepts the text of data/glossary.csv or data/config_glossary.csv; returns { kind, rows }.
export function parseGlossaryFile(text) {
  const f = readCsv(text);
  const kind = TERM_COLS.every((c) => f.columns.includes(c)) ? 'terms' : CONFIG_COLS.every((c) => f.columns.includes(c)) ? 'configs' : null;
  if (!kind) throw new Error('Not a glossary file: expected columns item, category, definition (glossary.csv) or config, label1, synchronization, growth, assay (config_glossary.csv).');
  const cols = kind === 'terms' ? TERM_COLS : CONFIG_COLS;
  const rows = f.rows.map((r) => Object.fromEntries(cols.map((c) => [c, (asCharacter(r[c]) ?? '').trim()])));
  return { kind, rows };
}
export function defineTerm(g, category, item) {
  const hit = g.terms.find((t) => t.category === category && t.item === item && t.definition);
  return hit ? hit.definition : null;
}
const firstSentence = (x) => (x === null ? null : x.replace(/^(.+?\.)\s.*$/s, '$1'));
export function configParts(g, code) {
  const row = g.configs.find((c) => c.config === code);
  const bare = ['bare', 'cfloor'].includes(code);
  const incubator = defineTerm(g, 'configuration', bare ? code : 'standard');
  if (!row) return g.terms.some((t) => t.category === 'configuration' && t.item === code) && incubator ? [['Incubator', incubator]] : [];
  const parts = [['Label', bare ? '' : row.label1], ['Incubator', incubator],
    ['Synchronization', firstSentence(defineTerm(g, 'synchronization', row.synchronization))],
    ['Growth', firstSentence(defineTerm(g, 'growth', row.growth))], ['Assay', firstSentence(defineTerm(g, 'assay', row.assay))]];
  return parts.filter(([, v]) => v !== null && v !== '');
}
export function describeCode(g, field, code) {
  if (field === 'config') return configParts(g, code).map(([k, v]) => (k === 'Label' ? v : `${k}: ${v}`));
  if (!(field in GLOSSARY_CATEGORIES)) return [];
  const x = defineTerm(g, GLOSSARY_CATEGORIES[field], code);
  return x === null ? [] : [x];
}
