// The "How to read these figures" dialog of the row-position question.
import { h, modal } from './ui.js';
import { rowLiveNumbers, rowHelpSections } from './questions.js';
import { dataDateSpan } from './settings.js';

export function openRowHelp(app) {
  const sources = ['SKKU', 'JHU'].filter((x) => app.frames[x]);
  const live = rowLiveNumbers(app.rows, sources, dataDateSpan(app.rows));
  const body = h('div', {}, rowHelpSections(live).map((s) => h('section', {}, h('h3', { text: s.heading }),
    ...(s.paragraphs || []).map((p) => h('p', { text: p })),
    ...(s.items?.length ? [h('ul', { class: s.live ? 'live' : '' }, s.items.map((i) => h('li', { text: i })))] : []))));
  return modal('How to read the row-position figures', body, { id: 'help-dialog', docked: true });
}
