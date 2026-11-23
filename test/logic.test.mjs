import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, mondayOf, weeksOut, planHours, weeklyTotals, progress, suggestions, needsRecovery, SPORTS } from '../docs/logic.js';
import worker, { sanitizeActivities } from '../worker/index.js';

test('worker exchanges the key, returns clean data, and hides failures', async () => {
  const calls = [];
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  const env = { GARMIN_API_KEY: 'secret-key', ALLOWED_ORIGIN: 'https://me.github.io' };
  const ctx = { waitUntil() {} };
  const request = new Request('https://w.dev/data');

  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), auth: init.headers.Authorization });
    if (String(url).endsWith('/token')) return new Response('tok.en.value');
    if (String(url).includes('activitylist')) {
      return Response.json([{ activityId: 9, startLatitude: 45, activityName: 'Home loop', duration: 60, activityType: { typeKey: 'cycling' } }]);
    }
    return new Response('nope', { status: 500 }); // recovery failure must not hide training data
  };
  const ok = await worker.fetch(request, env, ctx);
  const text = await ok.text();
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGIN);
  assert.equal(calls[0].auth, 'ApiKey secret-key');
  assert.equal(calls[1].auth, 'Bearer tok.en.value');
  assert.match(calls[1].url, /excludeChildren=false/);
  assert.doesNotMatch(text, /secret-key|tok\.en|startLatitude|Home loop/);

  globalThis.fetch = async () => new Response('upstream secret detail', { status: 500 });
  const failed = await worker.fetch(request, env, ctx);
  assert.equal(failed.status, 502);
  assert.doesNotMatch(await failed.text(), /upstream/);
  assert.equal((await worker.fetch(new Request('https://w.dev/other'), env, ctx)).status, 404);
});

const session = (type, date, hours, extra = {}) => ({ type, startTimeLocal: `${date} 07:00:00`, duration: hours * 3600, ...extra });

test('classifies every kind of cycling, and non-tri sports as null', () => {
  for (const t of ['cycling', 'indoor_cycling', 'virtual_ride', 'road_biking', 'gravel_cycling', 'mountain_biking']) assert.equal(classify(t), 'bike', t);
  for (const t of ['running', 'treadmill_running', 'trail_running']) assert.equal(classify(t), 'run', t);
  for (const t of ['lap_swimming', 'open_water_swimming']) assert.equal(classify(t), 'swim', t);
  for (const t of ['hiking', 'motorcycling', 'strength_training', 'multi_sport']) assert.equal(classify(t), null, t);
});

test('race week dates line up', () => {
  assert.equal(mondayOf('2027-10-17'), '2027-10-11');
  assert.equal(weeksOut('2027-10-11'), 0);
  assert.equal(weeksOut('2026-11-23'), 46);
});

test('plan peaks before race and tapers', () => {
  for (const s of Object.keys(SPORTS)) {
    assert.equal(planHours(s, 3), SPORTS[s].peak);
    assert.ok(planHours(s, 0) < planHours(s, 1) && planHours(s, 1) < planHours(s, 2));
    assert.ok(planHours(s, 12) < planHours(s, 11), 'recovery week dips');
  }
});

test('worker strips GPS, names, and multisport parents', () => {
  const [a, ...rest] = sanitizeActivities([
    { activityId: 1, activityName: 'Near home', startLatitude: 1, endLongitude: 2, locationName: 'Town', duration: 60, activityType: { typeKey: 'running' } },
    { activityId: 2, isParent: true, activityType: { typeKey: 'multi_sport' } },
  ]);
  assert.equal(rest.length, 0);
  assert.deepEqual(a, { type: 'running', activityId: 1, duration: 60 });
});

test('weekly totals bucket by Monday and track hard time', () => {
  const t = weeklyTotals([session('running', '2026-11-29', 1, { hrTimeInZone_2: 2400, hrTimeInZone_4: 1200 })]);
  assert.equal(t['2026-11-23'].run.hours, 1);
  assert.equal(t['2026-11-23'].run.hardSec, 1200);
  assert.equal(t['2026-11-23'].run.hrSec, 3600);
});

test('progress verdicts', () => {
  assert.equal(progress([], '2026-11-23').status, 'start');
  const weeks = ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'];
  const onPlan = weeks.flatMap((d) => [session('lap_swimming', d, 1), session('cycling', d, 2), session('running', d, 1.25)]);
  assert.equal(progress(onPlan, '2026-11-23').status, 'on-track');
  assert.equal(progress(weeks.map((d) => session('running', d, 0.5)), '2026-11-23').status, 'behind');
  assert.equal(progress([], '2027-10-18').status, 'done');
  const fitAndSteady = weeks.map((d) => session('cycling', d, 10));
  assert.equal(progress(fitAndSteady, '2026-11-23').status, 'on-track');
  const spike = weeks.map((d, i) => session('cycling', d, i === 3 ? 8 : 4));
  assert.equal(progress(spike, '2026-11-23').status, 'fast');
});

test('fueling advice only appears on long bike and run sessions', () => {
  for (const s of suggestions([], '2026-11-23', null)) {
    if (s.sport === 'swim' || s.minutes <= 75) assert.doesNotMatch(s.detail, /fueling/);
  }
});

test('suggestions cover missing sports, include bricks in Build, and respect fatigue', () => {
  const first = suggestions([], '2026-11-23', null);
  assert.equal(first.length, 3);
  assert.ok(first.every((s) => s.minutes >= 20));

  const build = suggestions([session('cycling', '2027-07-05', 0.1)], '2027-07-06', null);
  assert.match(build[0].title, /Brick/);

  const tired = suggestions([], '2027-07-06', { sleep: [{ date: '2027-07-05', hours: 4.5, score: 40 }], hrv: [] });
  assert.match(tired[0].title, /recovery/);
  assert.ok(tired.every((s) => !/Brick|Zone 4/.test(s.title + s.detail)));
});

test('ramp cap blocks a big jump after low recent training', () => {
  const [s] = suggestions([], '2027-08-02', null).filter((x) => x.sport === 'bike');
  assert.ok(s.minutes <= SPORTS.bike.start * 60);
});

test('needsRecovery stays quiet without data', () => {
  assert.equal(needsRecovery(null), null);
  assert.equal(needsRecovery({ sleep: [{ date: '2027-01-01', hours: 8, score: 85 }], hrv: [{ status: 'BALANCED' }] }), null);
});
