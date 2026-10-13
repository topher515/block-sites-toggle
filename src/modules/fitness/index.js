// Fitness: log sets of push-ups, pull-ups, etc. Each set is a `reps` event:
//   { exercise: 'pushup', n: 10 }
import { h, fmt, useCss } from '../../core/dom.js';

function totals(ctx, events, exercise) {
  return ctx.stats.tally(events.filter((e) => e.data.exercise === exercise.id), (e) => e.data.n, ctx.now());
}

// The exercise furthest behind its daily goal (by fraction done).
function suggestion(ctx, events, exercises) {
  let best = null;
  for (const ex of exercises) {
    if (!ex.dailyGoal) continue;
    const frac = totals(ctx, events, ex).today / ex.dailyGoal;
    if (frac < 1 && (!best || frac < best.frac)) best = { ex, frac };
  }
  return best && best.ex;
}

export default {
  id: 'fitness',
  title: 'Fitness 💪',
  description: 'Do a set instead. Counts reps today, this week and ever.',
  order: 10,
  defaultSettings: {
    exercises: [
      { id: 'pushup', label: 'Push-ups', step: 1, dailyGoal: 50 },
      { id: 'pullup', label: 'Pull-ups', step: 1, dailyGoal: 20 },
    ],
  },

  async mount(el, ctx) {
    useCss(ctx.assetUrl('fitness.css'));
    const exercises = ctx.settings.exercises || [];
    let lastLogged = null;

    async function render() {
      const events = await ctx.events({ type: 'reps' });
      const next = suggestion(ctx, events, exercises);
      el.replaceChildren(
        h('div', { class: 'fit' },
          h('h1', {}, 'Do a set instead'),
          h('p', { class: 'muted' }, next
            ? `Suggested: ${next.label.toLowerCase()} (${fmt(next.dailyGoal - totals(ctx, events, next).today)} to go today), then back to work.`
            : 'All daily goals done. Nice. A bonus set never hurts.'),
          h('div', { class: 'fit-grid' }, exercises.map((ex) => card(ex, totals(ctx, events, ex), ex === next))),
          lastLogged
            ? h('p', { class: 'fit-undo muted' },
                `Logged ${lastLogged.data.n} ${label(lastLogged.data.exercise)}. `,
                h('button', { class: 'ghost small', onclick: undo }, 'Undo'))
            : null,
        ),
      );
    }

    function label(id) {
      const ex = exercises.find((e) => e.id === id);
      return ex ? ex.label.toLowerCase() : id;
    }

    function card(ex, t, suggested) {
      const input = h('input', { type: 'number', min: 1, max: 1000, placeholder: 'other', 'aria-label': `Custom ${ex.label}` });
      const logCustom = () => {
        const n = Math.round(Number(input.value));
        if (n > 0 && n <= 1000) log(ex, n);
      };
      input.addEventListener('keydown', (e) => e.key === 'Enter' && logCustom());
      const pct = ex.dailyGoal ? Math.min(100, Math.round((t.today / ex.dailyGoal) * 100)) : null;
      return h('section', { class: `panel fit-card${suggested ? ' suggested' : ''}` },
        h('h2', {}, ex.label),
        h('div', { class: 'fit-stats num' },
          stat('Today', t.today, ex.dailyGoal ? `of ${fmt(ex.dailyGoal)}` : ''),
          stat('7 days', t.week),
          stat('Ever', t.ever)),
        pct != null ? h('div', { class: 'fit-bar', role: 'progressbar', 'aria-valuenow': pct }, h('span', { style: { width: `${pct}%` } })) : null,
        h('div', { class: 'row fit-actions' },
          h('button', { class: 'primary', onclick: () => log(ex, ex.step) }, `+${ex.step}`),
          input,
          h('button', { onclick: logCustom }, 'Log')),
      );
    }

    function stat(name, value, sub = '') {
      return h('div', {}, h('div', { class: 'fit-num' }, fmt(value)), h('div', { class: 'muted small' }, name, sub ? ` ${sub}` : ''));
    }

    async function log(ex, n) {
      lastLogged = await ctx.log('reps', { exercise: ex.id, n });
      await render();
    }

    async function undo() {
      if (!lastLogged) return;
      await ctx.undo(lastLogged.id);
      lastLogged = null;
      await render();
    }

    await render();
  },

  async summary(ctx) {
    const events = await ctx.events({ type: 'reps' });
    return (ctx.settings.exercises || [])
      .map((ex) => `${ex.label} ${fmt(totals(ctx, events, ex).today)}`)
      .join(' · ') + ' today';
  },
};
