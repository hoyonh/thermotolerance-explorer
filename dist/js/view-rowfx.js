// Row effect within genotype: shown only when the user asks for it (Questions section of the sidebar).
import { h, clear, hint, dataTable, download } from './ui.js';
import { rowEffect, nonIntegerRows } from './rowfx.js';
import { rowEffectPlot } from './plots.js';
import { toCsv } from './csvout.js';
import { message } from './view-curves.js';
import { dateRangeNote, dataDateSpan } from './settings.js';
import { esc } from './chart.js';
import { openRowHelp } from './help.js';

export function createRowEffect(app) {
  const plot = h('div', { class: 'plot', id: 'rowfx_plot' }); const table = h('div', { id: 'rowfx_table' }); const bar = h('div', { class: 'export-bar' });
  const note = h('p', { class: 'hint', id: 'rowfx_note' });
  const tip = h('div', { class: 'plot-tip', hidden: true }); document.body.append(tip);
  const el = h('div', { class: 'card detail-card', id: 'rowfx-card', hidden: true }, h('div', { class: 'card-heading' }, h('h2', { text: 'Row effect within genotype' }), h('button', { type: 'button', class: 'btn', id: 'rowfx-help', text: 'How to read this', onclick: () => openRowHelp(app) })),
    hint('Each observation is compared with the mean of the same genotype at the same heat exposure, separately for each source and configuration. This is a descriptive adjustment: it removes average differences between genotypes but does not show that strain, run or date differences cannot contribute to a row pattern. Only genotypes measured in at least two rows contribute. The blue dashed line is stricter: the genotype’s mean is taken over the same recorded run (date and experiment) only. Values are percentage points above (+) or below (−) the genotype’s own mean; n counts observations. Hollow points have fewer than 30 observations. The dashed vertical line is the rack boundary. This uses the sidebar filters, so choose genotypes there to look at one strain.'),
    plot, table, bar, note);
  let rows = [];
  plot.addEventListener('mousemove', (e) => {
    const m = e.target.closest?.('.mark'); const k = m?.getAttribute('data-k');
    if (!k) { tip.hidden = true; return; }
    const [, panel, row] = k.split('::'); const r = rows.find((x) => x.panel === panel && String(x.row) === row);
    if (!r) { tip.hidden = true; return; }
    const f = (v) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10} points` : 'not available');
    tip.innerHTML = `<b>${esc(r.panel)} · row ${esc(row)}</b> (${esc(r.rack)})<br>Within genotype: ${f(r.genotype_adjusted)} · ${r.n_obs} observations<br>Within genotype and run: ${f(r.matched)} · ${r.n_matched} observations`;
    tip.hidden = false; tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 330)}px`; tip.style.top = `${e.clientY + 14}px`;
  });
  plot.addEventListener('mouseleave', () => { tip.hidden = true; });
  return {
    el,
    render(view) {
      const on = view.ok && !view.empty && app.settings.row_within_genotype === true;
      el.hidden = !on; if (!on) { rows = []; return; }
      rows = rowEffect(view.data); const skipped = nonIntegerRows(view.data).length;
      note.textContent = skipped ? `${skipped} plate${skipped === 1 ? '' : 's'} recorded at a non-integer row position (for example 5.5) ${skipped === 1 ? 'is' : 'are'} not included in this comparison.` : '';
      if (!rows.length) { clear(plot).append(message('No row-position comparison is possible: no genotype in the current selection was measured in two or more rows.')); clear(table); clear(bar); return; }
      const width = Math.max(620, Math.floor(plot.clientWidth || el.clientWidth - 44 || 900));
      plot.innerHTML = rowEffectPlot({ rows, width, note: [dateRangeNote(app.settings, dataDateSpan(app.rows))] }).svg;
      const shown = rows.map((r) => ({ panel: r.panel, row: r.row, rack: r.rack, n_obs: r.n_obs, genotype_adjusted_pts: Number.isFinite(r.genotype_adjusted) ? Math.round(r.genotype_adjusted * 100) / 100 : '—', n_matched: r.n_matched, matched_pts: Number.isFinite(r.matched) ? Math.round(r.matched * 100) / 100 : '—' }));
      clear(table).append(dataTable(shown, ['panel', 'row', 'rack', 'n_obs', 'genotype_adjusted_pts', 'n_matched', 'matched_pts']));
      clear(bar).append(h('button', { type: 'button', class: 'btn', id: 'rowfx-csv', text: 'Row effect CSV', onclick: () => download('row_effect_within_genotype.csv', toCsv(rows)) }),
        h('button', { type: 'button', class: 'btn', id: 'rowfx-svg', text: 'Figure SVG', onclick: () => download('row_effect_within_genotype.svg', plot.innerHTML, 'image/svg+xml') }));
    },
  };
}
