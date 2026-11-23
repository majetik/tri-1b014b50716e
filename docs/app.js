import { API_URL } from './config.js';
import { demoData } from './demo.js';
import { SPORTS, SUPPORT, DEFAULT_PLAN, RACE, addDays, mondayOf, weeksOut, planHours, weeklyTotals, hardPct, progress, suggestions, supportSummary, getPlan, setPlan, parsePlan } from './logic.js';

const $ = (id) => document.getElementById(id);
const KEYS = Object.keys(SPORTS);
const STORE = 'tri-tracker-data';
const REFRESH_AFTER_MS = 120000;

const shown = new Set(KEYS);
let showSupport = true;
let data = null;
let lastFetch = 0;
let charts = {};

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const shortDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const hm = (h) => `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}m`.replace(/(\d+)h 60m/, (_, n) => `${+n + 1}h 00m`);
const el = (tag, props = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
};

const VERDICTS = {
  ramp: ['Ramping up', 'Build the habit before the real plan begins. Past training stays below for reference.', '●'],
  start: ['Plan started', 'Begin with the sessions below.', '●'],
  'on-track': ['On track', 'Your last 4 weeks meet or beat the plan.', '✓'],
  close: ['Slightly behind', 'You are close. A few consistent weeks will catch you up.', '!'],
  behind: ['Behind plan', 'There is time to recover this. Build back gradually.', '▼'],
  fast: ['Ramping fast', 'You are well above plan, which raises injury risk. Hold volume steady.', '!'],
  done: ['Race complete', 'October 17, 2027 has passed.', '✓'],
};

function renderSummary(today) {
  const p = progress(data.activities, today);
  const [title, why, icon] = VERDICTS[p.status];
  const tag = $('verdict-tag');
  tag.className = `verdict-row ${p.status}`;
  const tagText = { ramp: `Plan starts ${shortDate(getPlan().planStart)}`, start: 'Week 1' }[p.status] ?? `${Math.round(p.ratio * 100)}% of planned hours`;
  tag.textContent = `${icon} ${tagText}`;
  $('verdict').textContent = title;
  const focus = ['close', 'behind'].includes(p.status) ? ` Focus on ${SPORTS[p.weakest].label.toLowerCase()}.` : '';
  $('why').textContent = why + focus;
  $('days').textContent = Math.max(p.days, 0);
  $('ready').textContent = `${p.readiness}%`;
  $('phase').textContent = p.phase;
  $('bars').replaceChildren(...p.sports.map((s) => {
    const fill = el('i');
    fill.style.cssText = `width:${Math.round(s.readiness * 100)}%;background:var(--${s.sport})`;
    return el('div', {},
      el('div', { className: 'bar-label' }, el('strong', { textContent: SPORTS[s.sport].label }),
        el('span', { textContent: `${hm(s.actual)} / ${hm(s.peak)} peak per week` })),
      el('div', { className: 'track' }, fill));
  }));
  const support = supportSummary(data.activities, today);
  const parts = Object.keys(SUPPORT).filter((k) => support[k] > 0).map((k) => `${SUPPORT[k]} ${hm(support[k])}`);
  $('support').textContent = parts.length ? `Supporting, weekly average: ${parts.join(' · ')}` : '';
  $('support').hidden = !parts.length;
}

function renderNext(today) {
  $('next').replaceChildren(...suggestions(data.activities, today, data.recovery).map((s) => {
    const tick = el('span', { className: 'tick' });
    if (s.sport) tick.style.background = SPORTS[s.sport] ? `var(--${s.sport})` : 'var(--support)';
    return el('li', {}, tick, el('b', { textContent: s.title }),
      el('span', { className: 'mins', textContent: s.minutes ? `${s.minutes} min` : '' }),
      el('p', { textContent: s.detail }));
  }));
}

function renderChips() {
  const chip = (key, label) => {
    const on = key ? shown.has(key) : shown.size === KEYS.length;
    const b = el('button', { type: 'button', className: `chip${key ? '' : ' all'}`, textContent: label });
    b.setAttribute('aria-pressed', on);
    if (key) b.style.setProperty('--c', `var(--${key})`);
    b.onclick = () => {
      if (!key) KEYS.forEach((k) => shown.add(k));
      else if (shown.size === KEYS.length) { shown.clear(); shown.add(key); } // first tap isolates one sport
      else if (shown.has(key)) { shown.delete(key); if (!shown.size) KEYS.forEach((k) => shown.add(k)); }
      else shown.add(key);
      renderChips();
      renderCharts();
    };
    return b;
  };
  const support = el('button', { type: 'button', className: 'chip', textContent: 'Support' });
  support.setAttribute('aria-pressed', showSupport);
  support.setAttribute('aria-label', 'Strength, climbing, and other supporting training');
  support.style.setProperty('--c', 'var(--ink-3)');
  support.onclick = () => {
    showSupport = !showSupport;
    renderChips();
    renderCharts();
  };
  $('chips').replaceChildren(chip(null, 'All'), ...KEYS.map((k) => chip(k, SPORTS[k].label)), support);
}

function timeline(totals) {
  const start = mondayOf(getPlan().rampStart);
  const first = Object.keys(totals).sort()[0] ?? start;
  let wk = first < start ? first : start;
  const weeks = [];
  for (; wk <= mondayOf(RACE); wk = addDays(wk, 7)) weeks.push(wk);
  return weeks;
}

function chartOptions(unit) {
  const ink = css('--ink-2');
  const grid = css('--line');
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        filter: (i) => i.parsed.y != null,
        callbacks: {
          title: (items) => `Week of ${shortDate(items[0].label)}`,
          label: (i) => `${i.dataset.label}: ${unit === 'h' ? hm(i.parsed.y) : `${i.parsed.y}%`}`,
          afterLabel: (i) => i.dataset.breakdown?.[i.dataIndex] ?? '',
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: ink, maxRotation: 0, autoSkipPadding: 18, callback(v) { return shortDate(this.getLabelForValue(v)); } } },
      y: { beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { color: ink, maxTicksLimit: 5, callback: (v) => `${v}${unit}` } },
    },
  };
}

function renderCharts() {
  const today = localToday();
  const current = mondayOf(today);
  const totals = weeklyTotals(data.activities);
  const weeks = timeline(totals);
  const { planStart, rampStart } = getPlan();
  const actual = (fn) => weeks.map((w) => (w <= current ? fn(w) : null));
  const line = (s, label, values, extra = {}) => ({
    label, data: values, borderColor: css(`--${s}`), backgroundColor: css(`--${s}`),
    borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.25,
    // Training before the ramp is reference only, so it is drawn faded.
    segment: { borderColor: (c) => (weeks[c.p1DataIndex] < mondayOf(rampStart) ? `${css(`--${s}`)}55` : undefined) },
    ...extra,
  });
  const supportHours = (w) => Object.values(totals[w]?.support ?? {}).reduce((a, b) => a + b, 0);
  const supportBars = showSupport ? [{
    type: 'bar', label: 'Supporting', order: 10, maxBarThickness: 6, borderRadius: 2,
    backgroundColor: css('--support'),
    data: actual((w) => +supportHours(w).toFixed(2) || null),
    breakdown: weeks.map((w) => Object.keys(SUPPORT).filter((k) => totals[w]?.support[k] > 0)
      .map((k) => `${SUPPORT[k]} ${hm(totals[w].support[k])}`).join(', ')),
  }] : [];

  const volume = [...KEYS.filter((s) => shown.has(s)).flatMap((s) => [
    // An empty current week is unfinished, not a real drop to zero.
    line(s, SPORTS[s].label, actual((w) => (w === current && !totals[w]?.[s].hours ? null : +(totals[w]?.[s].hours ?? 0).toFixed(2)))),
    line(s, `${SPORTS[s].label} plan`, weeks.map((w) => (w < mondayOf(planStart) ? null : +planHours(s, weeksOut(w)).toFixed(2))),
      { borderDash: [4, 4], borderWidth: 1.5, tension: 0, segment: {} }),
  ]), ...supportBars];
  const intensity = KEYS.filter((s) => shown.has(s)).map((s) => line(s, SPORTS[s].label,
    actual((w) => hardPct(totals[w]?.[s])), { spanGaps: true }));

  for (const [id, datasets, unit] of [['volume', volume, 'h'], ['intensity', intensity, '%']]) {
    charts[id]?.destroy();
    charts[id] = new Chart($(id), { type: 'line', data: { labels: weeks, datasets }, options: chartOptions(unit) });
  }

  const recent = weeks.filter((w) => w <= current).slice(-8).reverse();
  const cols = KEYS.filter((s) => shown.has(s));
  $('table').replaceChildren(
    el('thead', {}, el('tr', {}, el('th', { textContent: 'Week' }), ...cols.flatMap((s) => [
      el('th', { textContent: `${SPORTS[s].label} h` }), el('th', { textContent: 'Hard' }),
    ]), el('th', { textContent: 'Support h' }))),
    el('tbody', {}, ...recent.map((w) => el('tr', {}, el('td', { textContent: shortDate(w) }), ...cols.flatMap((s) => {
      const pct = hardPct(totals[w]?.[s]);
      return [el('td', { textContent: (totals[w]?.[s].hours ?? 0).toFixed(1) }), el('td', { textContent: pct == null ? '–' : `${pct}%` })];
    }), el('td', { textContent: supportHours(w).toFixed(1) })))),
  );
}

function render() {
  const today = localToday();
  renderSummary(today);
  renderNext(today);
  renderChips();
  renderCharts();
}

function banner(text) {
  $('banner').textContent = text;
  $('banner').classList.toggle('show', !!text);
}

const syncedLabel = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

async function loadPlan() {
  try {
    const res = await fetch('plan.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setPlan(parsePlan(await res.json()));
    return '';
  } catch (err) {
    setPlan(DEFAULT_PLAN);
    return `Plan file problem: ${err.message}. Using the default plan.`;
  }
}

async function load() {
  const planIssue = await loadPlan();
  if (!API_URL || new URLSearchParams(location.search).has('demo')) {
    data = demoData(localToday());
    banner('Sample data. Connect your Garmin Worker to see your real training.');
    render();
    return;
  }
  const btn = $('refresh');
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  lastFetch = Date.now();
  try {
    const res = await fetch(`${API_URL.replace(/\/$/, '')}/data`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
    try { localStorage.setItem(STORE, JSON.stringify(data)); } catch { /* storage is only an offline convenience */ }
    banner([planIssue, data.truncated ? 'Only your most recent activities were loaded.' : ''].filter(Boolean).join(' '));
    $('race-date').textContent = `October 17, 2027 · synced ${syncedLabel(data.syncedAt)}`;
    render();
  } catch {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE)); } catch { /* fall through to the error state */ }
    if (saved) {
      data = saved;
      banner(`Couldn't reach Garmin. Showing data from ${syncedLabel(saved.syncedAt)}.`);
      render();
    } else {
      $('verdict').textContent = 'Couldn’t load';
      banner('Couldn’t reach Garmin. Check your connection and tap Refresh.');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh';
  }
}

$('refresh').onclick = load;
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - lastFetch > REFRESH_AFTER_MS) load();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => data && renderCharts());
load();
