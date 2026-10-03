'use strict';

const STORAGE_KEY = 'wochenziel:v1';
const MAX_GOAL = 14;

const CATEGORIES = [
  { id: 'gym', name: 'Gym', sub: 'Kraft', defaultGoal: 4 },
  { id: 'run', name: 'Joggen', sub: 'Ausdauer', defaultGoal: 1 },
];

// ---------- Datum ----------

// Montag der aktuellen Woche in lokaler Zeit als "YYYY-MM-DD"
function currentMonday(now = new Date()) {
  const daysSinceMonday = (now.getDay() + 6) % 7; // So=0 -> 6, Mo=1 -> 0
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
  return toKey(monday);
}

function toKey(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function weekLabel(mondayKey) {
  const [y, m, d] = mondayKey.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 6);
  const fmt = (x) => x.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
  return `${fmt(start)} – ${fmt(end)}`;
}

// ---------- Speicher ----------

function defaultState() {
  const state = { week: currentMonday(), goals: {}, done: {} };
  for (const c of CATEGORIES) {
    state.goals[c.id] = c.defaultGoal;
    state.done[c.id] = 0;
  }
  return state;
}

function load() {
  const state = defaultState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && typeof saved === 'object') {
      if (typeof saved.week === 'string') state.week = saved.week;
      for (const c of CATEGORIES) {
        if (Number.isInteger(saved.goals?.[c.id])) state.goals[c.id] = saved.goals[c.id];
        if (Number.isInteger(saved.done?.[c.id])) state.done[c.id] = saved.done[c.id];
      }
    }
  } catch { /* defekte Daten -> Standardwerte */ }
  return state;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* z. B. Speicher voll / privat */ }
}

let state = load();

// ---------- Wochen-Reset ----------

function checkWeek() {
  const monday = currentMonday();
  if (state.week !== monday) {
    state.week = monday;
    for (const c of CATEGORIES) state.done[c.id] = 0; // Ziele bleiben erhalten
    save();
  }
  render();
}

// ---------- Darstellung ----------

const $categories = document.getElementById('categories');
const $weekLabel = document.getElementById('weekLabel');
const $settings = document.getElementById('settings');
const $goalRows = document.getElementById('goalRows');

function render() {
  $weekLabel.textContent = weekLabel(state.week);
  $categories.replaceChildren(...CATEGORIES.map(renderCard));
}

function renderCard(c) {
  const goal = state.goals[c.id];
  const done = Math.min(state.done[c.id], goal);
  const complete = goal > 0 && done >= goal;

  const card = el('section', { class: 'card' + (complete ? ' complete' : '') });
  const head = el('div', { class: 'card-head' });
  const title = el('h2', {}, c.name + ' ');
  title.append(el('span', { class: 'sub' }, c.sub));
  head.append(title, el('span', { class: 'count' }, `${done} / ${goal}`));
  card.append(head);

  if (goal === 0) {
    card.append(el('p', { class: 'empty' }, 'Kein Ziel diese Woche'));
    return card;
  }

  const dots = el('div', { class: 'dots' });
  for (let i = 0; i < goal; i++) {
    const on = i < done;
    const dot = el('button', {
      class: 'dot' + (on ? ' on' : ''),
      'aria-label': `${c.name} Einheit ${i + 1}`,
      'aria-pressed': String(on),
    });
    // Erledigte Kreise füllen sich immer von links: Tippen auf einen
    // erledigten Kreis nimmt eine Einheit weg, auf einen offenen fügt eine hinzu.
    dot.addEventListener('click', () => {
      state.done[c.id] = Math.max(0, Math.min(goal, done + (on ? -1 : 1)));
      save();
      render();
      if (navigator.vibrate) navigator.vibrate(10);
    });
    dots.append(dot);
  }
  card.append(dots);
  return card;
}

function renderSettings() {
  $goalRows.replaceChildren(...CATEGORIES.map((c) => {
    const goal = state.goals[c.id];
    const row = el('div', { class: 'goal-row' });
    const label = el('span', {}, `${c.name} (${c.sub})`);
    const stepper = el('div', { class: 'stepper' });
    const minus = el('button', { type: 'button', 'aria-label': `${c.name} Ziel verringern` }, '−');
    const plus = el('button', { type: 'button', 'aria-label': `${c.name} Ziel erhöhen` }, '+');
    minus.disabled = goal <= 0;
    plus.disabled = goal >= MAX_GOAL;
    minus.addEventListener('click', () => changeGoal(c.id, -1));
    plus.addEventListener('click', () => changeGoal(c.id, +1));
    stepper.append(minus, el('output', {}, String(goal)), plus);
    row.append(label, stepper);
    return row;
  }));
}

function changeGoal(id, delta) {
  state.goals[id] = Math.max(0, Math.min(MAX_GOAL, state.goals[id] + delta));
  state.done[id] = Math.min(state.done[id], state.goals[id]);
  save();
  renderSettings();
  render();
}

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

// ---------- Events ----------

document.getElementById('openSettings').addEventListener('click', () => {
  renderSettings();
  $settings.showModal();
});

// Tippen auf den abgedunkelten Hintergrund schließt die Einstellungen
$settings.addEventListener('click', (e) => {
  if (e.target === $settings) $settings.close();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkWeek();
});
window.addEventListener('pageshow', checkWeek);

checkWeek();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
