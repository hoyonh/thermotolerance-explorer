// write.csv(row.names = FALSE, na = ""): text quoted, numbers plain, NA empty, TRUE/FALSE for logicals.
import { numToString } from './rcompat.js';

const cell = (v) => {
  if (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? numToString(v) : (v > 0 ? 'Inf' : '-Inf');
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `"${String(v).replace(/"/g, '""')}"`;
};
export function toCsv(rows, columns = rows.length ? Object.keys(rows[0]) : []) {
  const head = columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(',');
  return [head, ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}
export const isIntegerLike = (v) => typeof v === 'number' && Number.isInteger(v);
