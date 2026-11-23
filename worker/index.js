const BASE = 'https://personal.connectapi.garmin.com';
const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
const CACHE_SECONDS = 120;
const HISTORY_DAYS = 400;
const PAGE_SIZE = 100;
const MAX_PAGES = 20; // Cloudflare's free plan allows 50 outbound requests per invocation

// Allowlist, because this response is public: no GPS, place names, or activity titles.
const ACTIVITY_FIELDS = [
  'activityId', 'parentId', 'startTimeLocal', 'duration', 'movingDuration', 'distance',
  'averageHR', 'maxHR', 'avgPower', 'normPower', 'trainingStressScore', 'intensityFactor',
  'activityTrainingLoad', 'aerobicTrainingEffect', 'anaerobicTrainingEffect',
  'hrTimeInZone_1', 'hrTimeInZone_2', 'hrTimeInZone_3', 'hrTimeInZone_4', 'hrTimeInZone_5',
];

let cachedToken = null;

export function sanitizeActivities(raw) {
  return raw
    .filter((a) => !a.isParent && !a.parent) // multisport parents would double count their legs
    .map((a) => {
      const clean = { type: a.activityType?.typeKey ?? 'other' };
      for (const f of ACTIVITY_FIELDS) if (a[f] != null) clean[f] = a[f];
      return clean;
    });
}

export function sanitizeRecovery(hrvRaw, sleepRaw) {
  const hrv = [hrvRaw ?? []].flat().flatMap((d) => d.hrvSummaries ?? [d])
    .map((h) => ({ date: h.calendarDate, lastNightAvg: h.lastNightAvg, weeklyAvg: h.weeklyAvg, status: h.status }));
  const sleep = [sleepRaw ?? []].flat().map((s) => ({
    date: s.calendarDate,
    hours: s.sleepTimeSeconds != null ? s.sleepTimeSeconds / 3600 : null,
    score: s.sleepScores?.overall?.value ?? null,
  }));
  return { hrv, sleep };
}

function jwtExpiry(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).exp * 1000;
  } catch {
    return Date.now() + 3600_000;
  }
}

async function getToken(env) {
  if (cachedToken && cachedToken.expiresAt - Date.now() > 3600_000) return cachedToken.value;
  const res = await fetch(BASE + TOKEN_PATH, {
    method: 'POST',
    headers: { Accept: '*/*', Authorization: `ApiKey ${env.GARMIN_API_KEY}` },
  });
  if (!res.ok) throw new Error(`token ${res.status}`);
  const value = (await res.text()).trim();
  cachedToken = { value, expiresAt: jwtExpiry(value) };
  return value;
}

async function garmin(env, path, params = {}, retried = false) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${await getToken(env)}` },
  });
  if (res.status === 401 && !retried) {
    cachedToken = null;
    return garmin(env, path, params, true);
  }
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function allActivities(env, startDate, endDate) {
  const out = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await garmin(env, '/activitylist-service/activities/search/activities', {
      start: page * PAGE_SIZE, limit: PAGE_SIZE, startDate, endDate, excludeChildren: false,
    }) ?? [];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) return { raw: out, truncated: false };
  }
  return { raw: out, truncated: true };
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

async function buildPayload(env) {
  const now = Date.now();
  const today = isoDay(now + 86400_000); // UTC can trail the athlete's local date
  const recent = isoDay(now - 14 * 86400_000);
  const { raw, truncated } = await allActivities(env, isoDay(now - HISTORY_DAYS * 86400_000), today);
  // Recovery is optional: a failure here must not hide training data.
  const [hrv, sleep] = await Promise.allSettled([
    garmin(env, `/hrv-service/hrv/daily/${recent}/${today}`),
    garmin(env, '/sleep-service/sleep/dailySleepSummariesByDate', { startDate: recent, endDate: today }),
  ]);
  return {
    syncedAt: new Date(now).toISOString(),
    truncated,
    activities: sanitizeActivities(raw),
    recovery: sanitizeRecovery(hrv.value, sleep.value),
  };
}

export default {
  async fetch(request, env, ctx) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET',
      Vary: 'Origin',
    };
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET' || url.pathname !== '/data') {
      return new Response('Not found', { status: 404, headers: cors });
    }

    const cacheKey = new Request(url.origin + '/data');
    const hit = await caches.default.match(cacheKey);
    if (hit) return hit;

    try {
      const res = new Response(JSON.stringify(await buildPayload(env)), {
        headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_SECONDS}` },
      });
      ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
      return res;
    } catch (err) {
      console.error(err.message); // never echo upstream detail to the public response
      return new Response(JSON.stringify({ error: 'Garmin sync failed' }), {
        status: 502, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  },
};
