// Small helpers that reproduce the R behaviour the explorer's calculations rely on.
// Conventions: string NA = null, numeric NA = NaN, date NA = null (dates are ISO "YYYY-MM-DD").

const collator = new Intl.Collator('en-US'); // R sorts strings with ICU in en_US
export const rCompare = (a, b) => collator.compare(a, b);

export const isNA = (v) => v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));

// as.character() for a number (integers print plainly; other values use 15 significant digits).
export function numToString(x) {
  if (Number.isNaN(x)) return null;
  if (x === Infinity) return 'Inf';
  if (x === -Infinity) return '-Inf';
  if (Number.isInteger(x)) return String(x);
  return String(Number(x.toPrecision(15)));
}
export const asCharacter = (v) => (v === null || v === undefined ? null : typeof v === 'number' ? numToString(v) : String(v));

// as.numeric() for a string: strict decimal parsing, NaN (= NA) otherwise.
export function parseRNumber(s) {
  if (typeof s === 'number') return s;
  if (s === null || s === undefined) return NaN;
  const t = s.trim();
  if (t === '' || t === 'NA') return NaN;
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t);
  if (/^[+-]?(Inf|inf|Infinity)$/.test(t)) return t.startsWith('-') ? -Infinity : Infinity;
  return NaN;
}

// ---- dates -------------------------------------------------------------------
const pad = (n, w) => String(n).padStart(w, '0');
const daysIn = (y, m) => { const t = new Date(0); t.setUTCFullYear(y, m, 0); return t.getUTCDate(); };
export function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(2000, 0, 1)); t.setUTCFullYear(y, m - 1, d);
  return Math.round(t.getTime() / 86400000);
}
export function isoFromDay(n) {
  const t = new Date(n * 86400000);
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1, 2)}-${pad(t.getUTCDate(), 2)}`;
}
// as.Date(x, format = "%Y-%m-%d") (or "%Y/%m/%d"): trailing text is ignored, invalid dates are NA.
export function parseDate(s, sep = '-') {
  if (s === null || s === undefined) return null;
  const m = new RegExp(`^(\\d{1,4})${sep === '-' ? '-' : '/'}(\\d{1,2})${sep === '-' ? '-' : '/'}(\\d{1,2})`).exec(String(s));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return null;
  return `${pad(y, 4)}-${pad(mo, 2)}-${pad(d, 2)}`;
}
// as.Date(character) with R's default tryFormats: "%Y-%m-%d", then "%Y/%m/%d" (decided by the first non-NA value).
export function asDateDefault(values) {
  const first = values.find((v) => v !== null && v !== undefined);
  if (first === undefined) return values.map(() => null);
  const sep = parseDate(first, '-') ? '-' : parseDate(first, '/') ? '/' : null;
  if (sep === null) throw new Error('character string is not in a standard unambiguous format');
  return values.map((v) => parseDate(v, sep));
}

// ---- statistics ----------------------------------------------------------------
export function rMean(x) {
  const n = x.length;
  if (!n) return NaN;
  let s = 0; for (const v of x) s += v;
  let m = s / n;
  if (Number.isFinite(m)) { let t = 0; for (const v of x) t += v - m; m += t / n; }
  return m;
}
export function rSd(x) {
  const n = x.length;
  if (n < 2) return NaN;
  const m = rMean(x);
  let ss = 0; for (const v of x) ss += (v - m) * (v - m);
  return Math.sqrt(ss / (n - 1));
}
export const rSum = (x) => { let s = 0; for (const v of x) s += v; return s; };

// ---- keys, sorting -----------------------------------------------------------------
const encoder = new TextEncoder();
// pair_key(): length-prefixed fields so that values containing separators cannot collide.
export function pairKey(row, fields) {
  return fields.map((f) => {
    const x = asCharacter(row[f]);
    const t = x === null ? '<missing>' : x;
    return `${encoder.encode(t).length}:${t}`;
  }).join('|');
}
// sort(unique(x)): NA dropped; numbers sort numerically, strings by locale collation.
export function sortUnique(values) {
  const u = [...new Set(values.filter((v) => !isNA(v)))];
  return u.every((v) => typeof v === 'number') ? u.sort((a, b) => a - b) : u.sort((a, b) => rCompare(String(a), String(b)));
}
// split(): groups in factor-level order (levels are sorted by collation); keys are strings.
export function splitBy(n, keyAt) {
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const k = keyAt(i);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }
  return [...groups.entries()].sort((a, b) => rCompare(a[0], b[0]));
}
export const unique = (x) => [...new Set(x)];
// Stable multi-key ordering. Each key is [accessor, 'collate' | 'number'].
export function orderBy(rows, keys) {
  const idx = rows.map((_, i) => i);
  const cmp = (a, b) => {
    for (const [get, kind] of keys) {
      const x = get(rows[a]), y = get(rows[b]);
      const xn = isNA(x), yn = isNA(y);
      if (xn || yn) { if (xn && yn) continue; return xn ? 1 : -1; }
      const c = kind === 'collate' ? rCompare(String(x), String(y)) : x < y ? -1 : x > y ? 1 : 0;
      if (c) return c;
    }
    return 0;
  };
  return idx.sort((a, b) => cmp(a, b) || a - b).map((i) => rows[i]);
}
export const errorWith = (message) => new Error(message);

// ---- Student t quantile (for 95% confidence intervals) -------------------------------------------
function logGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x; let t = x + 5.5; t -= (x + 0.5) * Math.log(t);
  let s = 1.000000000190015; for (const k of c) s += k / ++y;
  return -t + Math.log((2.5066282746310005 * s) / x);
}
function betaCf(a, b, x) {
  const tiny = 1e-300; let c = 1; let d = 1 - ((a + b) * x) / (a + 1); if (Math.abs(d) < tiny) d = tiny; d = 1 / d; let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny; c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny; d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny; c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny; d = 1 / d;
    const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}
function incompleteBeta(a, b, x) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betaCf(a, b, x)) / a : 1 - (bt * betaCf(b, a, 1 - x)) / b;
}
const tCdf = (t, df) => { const p = 0.5 * incompleteBeta(df / 2, 0.5, df / (df + t * t)); return t > 0 ? 1 - p : p; };
const tCache = new Map();
// qt(p, df) for p in (0.5, 1), by bisection on the t distribution function.
export function tQuantile(p, df) {
  const key = `${p}|${df}`;
  if (tCache.has(key)) return tCache.get(key);
  let lo = 0, hi = 1e6;
  for (let i = 0; i < 200 && hi - lo > 1e-13 * Math.max(1, hi); i++) { const mid = (lo + hi) / 2; if (tCdf(mid, df) < p) lo = mid; else hi = mid; }
  const q = (lo + hi) / 2; tCache.set(key, q); return q;
}
