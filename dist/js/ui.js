// Minimal DOM helpers and widgets (multi-select with search, tabs, tables, downloads, notifications).
import { isNA } from './rcompat.js';
import { compareRank } from './genotype.js';

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const hint = (text, cls = '') => h('p', { class: `hint ${cls}`.trim(), text });

let uid = 0;
export const nextId = (p = 'f') => `${p}${++uid}`;

export function field(label, control, { tip = null, id = null } = {}) {
  const lab = h('label', { class: 'control-label', for: id || control.id || '' }, label, tip ? infoTip(label, tip) : null);
  return h('div', { class: 'form-group' }, lab, control);
}
export function infoTip(title, tip) {
  const el = h('span', { class: 'info-tip', tabindex: '0', role: 'button', 'aria-label': `About ${title}`, 'data-tip': tip, text: 'i' });
  const open = (e) => { e.preventDefault(); e.stopPropagation(); toggleCard(el, title, tip); };
  el.addEventListener('click', open);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); });
  return el;
}
function toggleCard(tip, title, text) {
  if (tip._card) { tip._card.remove(); tip._card = null; tip.classList.remove('pinned'); return; }
  const close = h('button', { class: 'tip-card-close', type: 'button', 'aria-label': 'Close', text: '×', onclick: () => toggleCard(tip) });
  const card = h('div', { class: 'tip-card', role: 'dialog' }, h('div', { class: 'tip-card-bar' }, h('span', { text: title }), close), h('div', { class: 'tip-card-body', text }));
  const r = tip.getBoundingClientRect();
  card.style.left = `${Math.max(8, Math.min(r.left - 8, window.innerWidth - 288))}px`;
  card.style.top = `${Math.min(r.bottom + 6, window.innerHeight - 160)}px`;
  document.body.append(card); tip._card = card; tip.classList.add('pinned');
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.tip-card-close').forEach((b) => b.click()); });

export function select(options, value, onChange, props = {}) {
  const el = h('select', { class: 'form-control', ...props }, options.map(([label, v]) => h('option', { value: String(v), text: label })));
  el.value = String(value);
  el.addEventListener('change', () => onChange(el.value));
  return el;
}
export function setOptions(el, options, value) {
  clear(el); for (const [label, v] of options) el.append(h('option', { value: String(v), text: label }));
  if (value !== undefined && options.some(([, v]) => String(v) === String(value))) el.value = String(value);
}
export function checkbox(label, checked, onChange, props = {}) {
  const input = h('input', { type: 'checkbox', checked, ...props });
  input.addEventListener('change', () => onChange(input.checked));
  return { el: h('label', { class: 'check' }, input, h('span', { text: label })), input };
}

// Multi-select with a search box. options: [{ value, lines: [title, ...details] }]
// rank(query, option) is optional: null = no match, otherwise a sort key (smaller first); options may carry a small `tag`.
export function multiSelect({ placeholder = 'All — type to filter', onChange, maxShown = 300, rank = null }) {
  let options = []; let selected = []; let active = 0; let shown = [];
  const chips = h('span', { class: 'chips' });
  const input = h('input', { type: 'text', class: 'ms-input', placeholder, autocomplete: 'off', 'aria-autocomplete': 'list' });
  const box = h('div', { class: 'ms-box' }, chips, input);
  const list = h('div', { class: 'ms-list', role: 'listbox', hidden: true });
  const root = h('div', { class: 'ms' }, box, list);
  const close = () => { list.hidden = true; };
  const set = (values, notify) => { selected = values; renderChips(); if (notify) onChange([...selected]); renderList(); };
  const renderChips = () => {
    clear(chips);
    for (const v of selected) chips.append(h('span', { class: 'chip' }, v, h('button', { type: 'button', class: 'chip-x', 'aria-label': `Remove ${v}`, text: '×', onclick: (e) => { e.stopPropagation(); set(selected.filter((x) => x !== v), true); } })));
    input.placeholder = selected.length ? '' : placeholder;
  };
  const renderList = () => {
    const q = input.value.trim().toLowerCase();
    let pool;
    if (rank && q) {
      const text = (o) => o.lines.slice(1).some((l) => l.toLowerCase().includes(q));
      pool = options.filter((o) => !selected.includes(o.value)).map((o, i) => ({ o, i, k: rank(input.value, o.value) ?? (text(o) ? [5] : null) }))
        .filter((x) => x.k !== null).sort((a, b) => compareRank(a.k, b.k) || a.i - b.i).map((x) => x.o);
    } else pool = options.filter((o) => !selected.includes(o.value) && (!q || o.value.toLowerCase().includes(q) || o.lines.some((l) => l.toLowerCase().includes(q))));
    shown = pool.slice(0, maxShown);
    active = Math.min(active, Math.max(0, shown.length - 1));
    clear(list);
    shown.forEach((o, i) => list.append(h('div', { class: `ms-option${i === active ? ' active' : ''}`, role: 'option', onmousedown: (e) => { e.preventDefault(); pick(o.value); } },
      h('div', { class: 'ms-code' }, o.lines[0] ?? o.value, ...(o.tag ? [h('span', { class: 'ms-tag', text: o.tag })] : [])), ...o.lines.slice(1).map((l) => h('div', { class: 'ms-line', text: l })))));
    if (pool.length > shown.length) list.append(h('div', { class: 'ms-more', text: `${pool.length - shown.length} more — keep typing to narrow` }));
    if (!pool.length) list.append(h('div', { class: 'ms-more', text: selected.length === options.length && options.length ? 'Everything is selected' : 'No matches' }));
  };
  const pick = (v) => { set([...selected, v], true); input.value = ''; renderList(); input.focus(); };
  const open = () => { list.hidden = false; renderList(); };
  input.addEventListener('focus', open); input.addEventListener('input', () => { active = 0; open(); });
  box.addEventListener('click', () => input.focus());
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { active = Math.min(shown.length - 1, active + 1); renderList(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); renderList(); e.preventDefault(); }
    else if (e.key === 'Enter' && shown[active]) { pick(shown[active].value); e.preventDefault(); }
    else if (e.key === 'Escape') close();
    else if (e.key === 'Backspace' && !input.value && selected.length) set(selected.slice(0, -1), true);
  });
  return {
    el: root, input,
    setOptions(o) { options = o; renderList(); },
    setValue(v) { set([...v], false); },
    getValue: () => [...selected],
  };
}

export function tabs(defs, { initial = 0, onSelect = () => {} } = {}) {
  const bar = h('ul', { class: 'tabs', role: 'tablist' });
  const body = h('div', { class: 'tab-body' });
  const panes = defs.map((d) => h('div', { class: 'tab-pane', role: 'tabpanel', 'data-tab': d.id, hidden: true }));
  const btns = defs.map((d, i) => h('li', { role: 'presentation' }, h('button', { type: 'button', role: 'tab', class: 'tab-btn', text: d.label, onclick: () => show(i) })));
  btns.forEach((b) => bar.append(b)); panes.forEach((p) => body.append(p));
  let current = -1;
  function show(i) {
    current = i;
    btns.forEach((b, j) => { b.classList.toggle('active', j === i); b.firstChild.setAttribute('aria-selected', j === i ? 'true' : 'false'); });
    panes.forEach((p, j) => { p.hidden = j !== i; });
    onSelect(defs[i].id);
  }
  show(initial);
  return { el: h('div', { class: 'tabset' }, bar, body), panes, show, ids: defs.map((d) => d.id), get current() { return defs[current].id; }, paneFor: (id) => panes[defs.findIndex((d) => d.id === id)] };
}

export function formatCell(v) {
  if (isNA(v)) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}
// columns: [key] or [key, label]
export function dataTable(rows, columns, { empty = '' } = {}) {
  if (!rows.length) return empty ? h('p', { class: 'hint', text: empty }) : h('span');
  const cols = columns.map((c) => (Array.isArray(c) ? c : [c, c]));
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
    h('thead', {}, h('tr', {}, cols.map(([, label]) => h('th', { text: label })))),
    h('tbody', {}, rows.map((r) => h('tr', {}, cols.map(([k]) => h('td', { text: formatCell(r[k]) })))))));
}

export function download(filename, content, type = 'text/csv;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function svgToPng(svg, scaleFactor = 2) {
  return new Promise((resolve, reject) => {
    const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
    const w = Math.round(+m[1]), hgt = Math.round(+m[2]);
    const img = new Image();
    img.onload = () => {
      const c = h('canvas', { width: w * scaleFactor, height: hgt * scaleFactor });
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image.'))), 'image/png');
    };
    img.onerror = () => reject(new Error('Could not render the figure.'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

let toastHost;
export function toast(message, kind = 'message', sticky = false) {
  if (!toastHost) { toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastHost); }
  const close = () => t.remove();
  const t = h('div', { class: `toast ${kind}` }, h('span', { text: message }), h('button', { type: 'button', class: 'toast-x', 'aria-label': 'Dismiss', text: '×', onclick: close }));
  toastHost.append(t);
  if (!sticky) setTimeout(close, 6000);
  return t;
}

// A modal dialog with a title and a close button (Escape also closes it). Falls back to a plain open dialog where showModal is missing.
// docked: a non-modal side panel that stays open while the page is used (the page makes room for it), instead of a blocking dialog.
export function modal(title, content, { id = 'modal', docked = false } = {}) {
  document.getElementById(id)?.remove();
  const dlg = h('dialog', { class: 'modal', id, 'aria-labelledby': `${id}-title` },
    h('div', { class: 'modal-head' }, h('h2', { id: `${id}-title`, text: title }), h('button', { type: 'button', class: 'btn', id: `${id}-close`, 'aria-label': 'Close', text: 'Close', onclick: () => dlg.close?.() ?? dlg.removeAttribute('open') })),
    h('div', { class: 'modal-body' }, content));
  if (docked) {
    dlg.classList.add('docked');
    const onKey = (e) => { if (e.key === 'Escape') dlg.close?.() ?? dlg.removeAttribute('open'); };
    document.addEventListener('keydown', onKey);
    dlg.addEventListener('close', () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('help-docked'); dlg.remove(); });
    document.body.append(dlg);
    document.body.classList.add('help-docked');
    if (typeof dlg.show === 'function') dlg.show(); else dlg.setAttribute('open', '');
    return dlg;
  }
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close?.(); });   // a click on the backdrop closes it
  document.body.append(dlg);
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  return dlg;
}
