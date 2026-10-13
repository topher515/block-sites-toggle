import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteToHost, hostRegex, buildRules } from '../src/core/rules.js';
import { effective, tally, startOfDay, countBy } from '../src/core/stats.js';
import { ulid } from '../src/core/ulid.js';

test('siteToHost normalizes old patterns and bare domains', () => {
  assert.equal(siteToHost('*://*.reddit.com/*'), 'reddit.com');
  assert.equal(siteToHost('*://news.ycombinator.com/*'), 'news.ycombinator.com');
  assert.equal(siteToHost('https://www.YouTube.com/watch?v=1'), 'youtube.com');
  assert.equal(siteToHost('  instagram.com  '), 'instagram.com');
});

test('hostRegex matches host and subdomains only', () => {
  const re = new RegExp(hostRegex('reddit.com'));
  for (const u of ['https://reddit.com', 'https://reddit.com/', 'https://www.reddit.com/r/x?y=1', 'http://old.reddit.com:8080/']) {
    assert.ok(re.test(u), u);
  }
  for (const u of ['https://notreddit.com/', 'https://reddit.com.evil.io/', 'https://example.com/?u=reddit.com']) {
    assert.ok(!re.test(u), u);
  }
});

test('buildRules only includes enabled sections and dedupes hosts', () => {
  const sections = [
    { id: 'a', sites: ['*://*.reddit.com/*', 'reddit.com'] },
    { id: 'b', sites: ['youtube.com'] },
  ];
  const rules = buildRules(sections, { a: true, b: false }, 'chrome-extension://x/blocked.html');
  assert.equal(rules.length, 1);
  assert.equal(rules[0].id, 1);
  assert.equal(rules[0].action.redirect.regexSubstitution, 'chrome-extension://x/blocked.html?from=\\0');
});

test('effective drops undone events and undo markers', () => {
  const evs = [
    { id: '1', type: 'reps', ts: 1, data: { n: 10 } },
    { id: '2', type: 'reps', ts: 2, data: { n: 5 } },
    { id: '3', type: 'undo', ts: 3, data: { target: '2' } },
  ];
  assert.deepEqual(effective(evs).map((e) => e.id), ['1']);
});

test('tally splits today, last 7 days, ever', () => {
  const now = new Date(2026, 9, 12, 15, 0).getTime();
  const evs = [
    { ts: now - 60 * 1000, data: { n: 10 } },             // today
    { ts: startOfDay(now, 3) + 1000, data: { n: 5 } },     // this week
    { ts: startOfDay(now, 6), data: { n: 1 } },            // edge of week
    { ts: startOfDay(now, 7) + 1000, data: { n: 100 } },   // older
  ];
  assert.deepEqual(tally(evs, (e) => e.data.n, now), { today: 10, week: 16, ever: 116 });
});

test('countBy sorts descending', () => {
  const evs = [{ h: 'a' }, { h: 'b' }, { h: 'b' }];
  assert.deepEqual(countBy(evs, (e) => e.h), [['b', 2], ['a', 1]]);
});

test('ulid is 26 chars and time-sortable', () => {
  const a = ulid(1000);
  const b = ulid(2000);
  assert.equal(a.length, 26);
  assert.ok(a < b);
});
