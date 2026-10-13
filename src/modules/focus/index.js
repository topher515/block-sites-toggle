// Focus: no activity, just a nudge and how often you've been bounced.
import { h, fmt } from '../../core/dom.js';

async function bounces(ctx) {
  const visits = (await ctx.eventsOf('core')).filter((e) => e.type === 'blocked_visit');
  const today = visits.filter((e) => e.ts >= ctx.stats.startOfDay(ctx.now()));
  return { visits, today };
}

export default {
  id: 'focus',
  title: 'Focus 🚧',
  description: 'Just block. Shows how many times you tried today.',
  order: 0,
  defaultSettings: {
    message: 'Back to work. Whatever you were waiting on will be done soon.',
  },

  async mount(el, ctx) {
    const { visits, today } = await bounces(ctx);
    const t = ctx.stats.tally(visits, () => 1, ctx.now());
    const byHost = ctx.stats.countBy(today, (e) => e.data.host);
    el.append(
      h('div', { class: 'panel stack', style: { textAlign: 'center', marginTop: '10vh' } },
        h('h1', { style: { fontSize: '32px' } }, 'Stay focused'),
        h('p', { class: 'muted' }, ctx.settings.message),
        h('p', { class: 'num' },
          h('strong', {}, fmt(t.today)), ` bounce${t.today === 1 ? '' : 's'} today · `,
          h('strong', {}, fmt(t.week)), ' this week · ',
          h('strong', {}, fmt(t.ever)), ' ever'),
        byHost.length
          ? h('p', { class: 'muted small' }, byHost.map(([host, n]) => `${host} ×${n}`).join(' · '))
          : null,
      ),
    );
  },

  async summary(ctx) {
    const { today } = await bounces(ctx);
    return `${today.length} bounce${today.length === 1 ? '' : 's'} today`;
  },
};
