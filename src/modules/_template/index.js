// Template for a new mode. Copy with `make new-module NAME=<dir>`.
// Folders starting with "_" are not registered.
import { h, fmt } from '../../core/dom.js';

export default {
  id: '__ID__',
  title: '__TITLE__',
  description: 'One line shown on the options page.',
  order: 50,
  defaultSettings: {},

  async mount(el, ctx) {
    async function render() {
      const t = ctx.stats.tally(await ctx.events({ type: 'done' }), () => 1, ctx.now());
      el.replaceChildren(
        h('div', { class: 'panel stack', style: { textAlign: 'center', marginTop: '10vh' } },
          h('h1', {}, '__TITLE__'),
          h('p', { class: 'num' }, `${fmt(t.today)} today · ${fmt(t.week)} this week · ${fmt(t.ever)} ever`),
          h('button', { class: 'primary', onclick: async () => { await ctx.log('done', {}); render(); } }, 'Did it'),
        ),
      );
    }
    await render();
  },

  async summary(ctx) {
    const t = ctx.stats.tally(await ctx.events({ type: 'done' }), () => 1, ctx.now());
    return `${t.today} today`;
  },
};
