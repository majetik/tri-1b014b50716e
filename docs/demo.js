import { addDays, mondayOf } from './logic.js';

// Sample data shown only until a Worker URL is configured, or with ?demo.
export function demoData(today) {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const monday = mondayOf(today);
  const activities = [];
  const add = (type, date, hours, kmh, hard) => {
    const duration = hours * 3600 * (0.85 + rand() * 0.3);
    activities.push({
      type, startTimeLocal: `${date} 07:00:00`, duration, distance: (duration / 3600) * kmh * 1000,
      hrTimeInZone_2: duration * (1 - hard), hrTimeInZone_4: duration * hard,
    });
  };
  for (let i = 16; i >= 1; i--) {
    const wk = addDays(monday, -7 * i);
    const ramp = (i % 4 === 0 ? 0.7 : 1) * (1 + (16 - i) * 0.035);
    add('lap_swimming', addDays(wk, 1), 0.45 * ramp, 2.6, 0.06);
    if (i % 3) add('lap_swimming', addDays(wk, 4), 0.4 * ramp, 2.6, 0.1);
    add('indoor_cycling', addDays(wk, 2), 0.7 * ramp, 28, 0.16);
    add(i % 2 ? 'road_biking' : 'virtual_ride', addDays(wk, 5), 1.15 * ramp, 26, 0.08);
    add('running', addDays(wk, 3), 0.5 * ramp, 10, 0.18);
    add('trail_running', addDays(wk, 6), 0.7 * ramp, 9, 0.07);
  }
  return {
    syncedAt: new Date().toISOString(),
    activities,
    recovery: { sleep: [{ date: addDays(today, -1), hours: 7.4, score: 78 }], hrv: [{ date: addDays(today, -1), status: 'BALANCED' }] },
  };
}
