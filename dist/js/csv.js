// CSV reading equivalent to read.csv(stringsAsFactors = FALSE, check.names = FALSE):
// quoted fields, "NA" (quoted or not) is missing, blank numeric fields are missing, columns are typed
// logical / integer / double / character, and short rows are padded with missing values.
import { parseRNumber } from './rcompat.js';

export function parseCsvText(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = []; let row = []; let field = ''; let quoted = false; let i = 0;
  const n = text.length;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); if (!(row.length === 1 && row[0] === '')) rows.push(row); row = []; };
  while (i < n) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
      field += c; i++;
    } else if (c === '"') { quoted = true; i++; }
    else if (c === ',') { endField(); i++; }
    else if (c === '\n') { endRow(); i++; }
    else if (c === '\r') { endRow(); i += text[i + 1] === '\n' ? 2 : 1; }
    else { field += c; i++; }
  }
  if (field !== '' || row.length) endRow();
  return rows;
}

export function readCsv(text) {
  const all = parseCsvText(text);
  if (!all.length) throw new Error('The file is empty.');
  const columns = all[0];
  const raw = all.slice(1);
  for (const r of raw) if (r.length > columns.length) throw new Error('A data row has more fields than the header.');
  const types = {}; const values = {};
  columns.forEach((name, j) => {
    const tokens = raw.map((r) => (j < r.length ? r[j] : 'NA'));
    const present = tokens.filter((t) => t !== 'NA' && t.trim() !== '');
    let type;
    if (!present.length) type = 'logical';
    else if (present.every((t) => /^(T|F|TRUE|FALSE|true|false|True|False)$/.test(t.trim()))) type = 'logical';
    else if (present.every((t) => /^[+-]?\d+$/.test(t.trim()) && Math.abs(Number(t)) <= 2147483647)) type = 'integer';
    else if (present.every((t) => !Number.isNaN(parseRNumber(t)) || /^[+-]?(Inf|inf)$/.test(t.trim()))) type = 'double';
    else type = 'character';
    types[name] = type;
    values[name] = tokens.map((t) => {
      if (t === 'NA') return type === 'integer' || type === 'double' ? NaN : null;
      if (type === 'character') return t;
      if (t.trim() === '') return type === 'logical' ? null : NaN;
      if (type === 'logical') return /^(T|TRUE|true|True)$/.test(t.trim());
      return parseRNumber(t);
    });
  });
  const rows = raw.map((_, i) => { const o = {}; for (const name of columns) o[name] = values[name][i]; return o; });
  return { columns, types, rows };
}
