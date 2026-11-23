export const RACE = '2027-10-17';
export const PLAN_START = '2026-11-23';

// Weekly hours for a finish-focused 70.3 plan. Edit these to change the whole ramp.
export const SPORTS = {
  swim: { label: 'Swim', start: 1, peak: 2.5, longShare: 0.4, long: 'Long swim', easy: 'Technique swim' },
  bike: { label: 'Bike', start: 2, peak: 6, longShare: 0.5, long: 'Long ride', easy: 'Easy ride' },
  run: { label: 'Run', start: 1.25, peak: 3.25, longShare: 0.5, long: 'Long run', easy: 'Easy run' },
};
const SPORT_KEYS = Object.keys(SPORTS);
const DAY = 86400000;
const toMs = (d) => Date.parse(`${d}T00:00:00Z`);

export const addDays = (d, n) => new Date(toMs(d) + n * DAY).toISOString().slice(0, 10);
export const mondayOf = (d) => addDays(d, -((new Date(toMs(d)).getUTCDay() + 6) % 7));
export const weeksOut = (monday) => Math.round((toMs(mondayOf(RACE)) - toMs(monday)) / (7 * DAY));
export const daysToRace = (today) => Math.round((toMs(RACE) - toMs(today)) / DAY);

export function classify(type = '') {
  const t = type.toLowerCase();
  if (t.includes('swim')) return 'swim';
  if (t.includes('motor')) return null;
  if (/cycl|bik|ride/.test(t) && !t.includes('hik')) return 'bike';
  if (/running|_run$|^run$/.test(t)) return 'run';
  return null;
}

export function phase(w) {
  if (w <= 1) return 'Taper';
  if (w <= 5) return 'Peak';
  if (w <= 16) return 'Build';
  if (w <= 28) return 'Base';
  return 'Foundation';
}

export function planHours(sport, w) {
  const { start, peak } = SPORTS[sport];
  if (w < 0) return 0;
  if (w === 0) return peak * 0.35;
  if (w === 1) return peak * 0.6;
  if (w === 2) return peak * 0.85;
  const total = weeksOut(PLAN_START);
  const progress = Math.min(1, Math.max(0, (total - w) / (total - 3)));
  const hours = start + (peak - start) * progress;
  return w % 4 === 0 ? hours * 0.7 : hours; // every 4th week is a recovery week
}

export function weeklyTotals(activities) {
  const weeks = {};
  for (const a of activities) {
    const sport = classify(a.type);
    if (!sport || !a.startTimeLocal) continue;
    const monday = mondayOf(a.startTimeLocal.slice(0, 10));
    weeks[monday] ??= Object.fromEntries(SPORT_KEYS.map((s) => [s, { hours: 0, km: 0, load: 0, hardSec: 0, hrSec: 0 }]));
    const w = weeks[monday][sport];
    w.hours += (a.duration ?? 0) / 3600;
    w.km += (a.distance ?? 0) / 1000;
    w.load += a.activityTrainingLoad ?? 0;
    w.hardSec += (a.hrTimeInZone_4 ?? 0) + (a.hrTimeInZone_5 ?? 0);
    for (let z = 1; z <= 5; z++) w.hrSec += a[`hrTimeInZone_${z}`] ?? 0;
  }
  return weeks;
}

export const hardPct = (x) => (x?.hrSec ? Math.round((100 * x.hardSec) / x.hrSec) : null);

function recentAverages(totals, monday) {
  const out = {};
  for (const s of SPORT_KEYS) {
    let actual = 0;
    let plan = 0;
    for (let i = 1; i <= 4; i++) {
      const wk = addDays(monday, -7 * i);
      actual += totals[wk]?.[s].hours ?? 0;
      plan += planHours(s, weeksOut(wk));
    }
    out[s] = { actual: actual / 4, plan: plan / 4 };
  }
  return out;
}

export function progress(activities, today) {
  const days = daysToRace(today);
  const totals = weeklyTotals(activities);
  const recent = recentAverages(totals, mondayOf(today));
  const sports = SPORT_KEYS.map((s) => ({
    sport: s,
    ...recent[s],
    readiness: Math.min(1, recent[s].actual / SPORTS[s].peak),
  }));
  const actual = sports.reduce((n, s) => n + s.actual, 0);
  const plan = sports.reduce((n, s) => n + s.plan, 0);
  const readiness = Math.round((100 * sports.reduce((n, s) => n + s.readiness, 0)) / sports.length);
  const ratio = plan ? actual / plan : 0;
  const weakest = sports.reduce((a, b) => (a.actual / a.plan <= b.actual / b.plan ? a : b)).sport;

  const weekHours = (i) => {
    const wk = totals[addDays(mondayOf(today), -7 * i)];
    return wk ? SPORT_KEYS.reduce((n, s) => n + wk[s].hours, 0) : 0;
  };
  const priorAvg = (weekHours(2) + weekHours(3) + weekHours(4)) / 3;
  // Being fitter than the plan is fine. Only a sudden jump in volume is a risk.
  const spiked = priorAvg > 0 && weekHours(1) > priorAvg * 1.3;

  let status;
  if (days < 0) status = 'done';
  else if (actual === 0) status = 'start';
  else if (spiked) status = 'fast';
  else if (ratio >= 0.85) status = 'on-track';
  else if (ratio >= 0.6) status = 'close';
  else status = 'behind';
  return { status, days, readiness, ratio, weakest, sports, phase: phase(weeksOut(mondayOf(today))) };
}

export function needsRecovery(recovery) {
  const sleep = (recovery?.sleep ?? []).filter((s) => s.date).sort((a, b) => a.date.localeCompare(b.date)).slice(-3);
  const avg = (key) => {
    const v = sleep.map((s) => s[key]).filter((n) => n != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const hours = avg('hours');
  const score = avg('score');
  const hrv = (recovery?.hrv ?? []).filter((h) => h.status)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')).at(-1)?.status ?? '';
  if (hours != null && hours < 6) return 'You averaged under 6 hours of sleep over the last 3 nights.';
  if (score != null && score < 60) return 'Your recent sleep scores are low.';
  if (/LOW|POOR|UNBALANCED/i.test(hrv)) return 'Your HRV is outside your normal range.';
  return null;
}

const minutes = (hours) => Math.max(20, Math.round((hours * 60) / 5) * 5);

function effort(ph, isLong, sport, hadHard, tired, mins) {
  if (tired) return 'Keep it conversational, in Zone 1–2.';
  if (ph === 'Taper') return 'Short and relaxed, with a few 30-second race-pace pickups.';
  if (isLong && ph === 'Peak') return 'Mostly Zone 2, with the last third at race effort.';
  if (isLong) return sport !== 'swim' && mins > 75 ? 'Steady Zone 2. Practice your race fueling.' : 'Steady Zone 2.';
  if ((ph === 'Build' || ph === 'Peak') && !hadHard) return 'Quality day: warm up, then 3 × 8 minutes in Zone 4 with 3 minutes easy.';
  return sport === 'swim' ? 'Drills first, then relaxed aerobic sets.' : 'Easy Zone 2.';
}

export function suggestions(activities, today, recovery) {
  const days = daysToRace(today);
  if (days < 0) return [{ sport: null, title: 'Race complete', minutes: 0, detail: 'Take time to recover before picking the next goal.' }];
  if (days === 0) return [{ sport: null, title: 'Race day', minutes: 0, detail: 'Start easy, fuel early, and finish strong.' }];

  const monday = mondayOf(today);
  const w = weeksOut(monday);
  const ph = phase(w);
  const totals = weeklyTotals(activities);
  const recent = recentAverages(totals, monday);
  const thisWeek = activities.filter((a) => a.startTimeLocal && mondayOf(a.startTimeLocal.slice(0, 10)) === monday);
  const tired = needsRecovery(recovery);

  const rows = SPORT_KEYS.map((s) => {
    // Cap the ramp so a missed block is not repaid with a sudden jump in volume.
    const target = Math.min(planHours(s, w), Math.max(SPORTS[s].start, recent[s].actual * 1.15));
    const done = totals[monday]?.[s].hours ?? 0;
    const sessions = thisWeek.filter((a) => classify(a.type) === s);
    const longHours = target * SPORTS[s].longShare;
    return {
      sport: s, target, remaining: target - done, longHours,
      hadLong: sessions.some((a) => (a.duration ?? 0) / 3600 >= longHours * 0.9),
      hadHard: sessions.some((a) => (a.hrTimeInZone_4 ?? 0) + (a.hrTimeInZone_5 ?? 0) > 600),
    };
  });

  const out = [];
  if (tired) out.push({ sport: null, title: 'Prioritize recovery today', minutes: 0, detail: `${tired} Rest, or keep any session short and easy.` });

  const bike = rows.find((r) => r.sport === 'bike');
  const run = rows.find((r) => r.sport === 'run');
  const dayOf = (a) => a.startTimeLocal.slice(0, 10);
  const hasBrick = thisWeek.some((a) => classify(a.type) === 'bike'
    && thisWeek.some((b) => classify(b.type) === 'run' && dayOf(b) === dayOf(a)));
  let open = rows.filter((r) => r.remaining >= 0.25).sort((a, b) => b.remaining / b.target - a.remaining / a.target);

  if (!tired && (ph === 'Build' || ph === 'Peak') && !hasBrick && bike.remaining >= 0.5 && run.remaining >= 0.25) {
    out.push({
      sport: 'bike', title: 'Brick: ride, then run', minutes: minutes(Math.min(bike.remaining, 1.5)) + 20,
      detail: `Ride ${minutes(Math.min(bike.remaining, 1.5))} minutes in Zone 2, then run 20 minutes straight off the bike.`,
    });
    open = open.filter((r) => r.sport !== 'bike');
  }

  for (const r of open) {
    if (out.length >= 3) break;
    const isLong = !tired && !r.hadLong;
    const hours = tired ? Math.min(r.remaining, 0.5) : Math.min(r.remaining, isLong ? r.longHours : 1);
    out.push({
      sport: r.sport, title: isLong ? SPORTS[r.sport].long : SPORTS[r.sport].easy,
      minutes: minutes(hours), detail: effort(ph, isLong, r.sport, r.hadHard, tired, minutes(hours)),
    });
  }
  if (!out.length) out.push({ sport: null, title: 'Week complete', minutes: 0, detail: 'You hit this week’s targets. Rest or do light mobility.' });
  return out;
}
