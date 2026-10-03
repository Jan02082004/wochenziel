'use strict';

const STORAGE_KEY = 'wochenziel:v2';
const LEGACY_KEY = 'wochenziel:v1';
const MAX_GOAL = 14;
const CARD_WEEKS = 8;
const STATS_WEEKS = 12;

const COLORS = ['#34c759', '#0a84ff', '#ff9f0a', '#ff375f', '#bf5af2', '#30b0c7', '#5e5ce6'];
const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const DAY_NAMES = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

// Kategorien mit Trainingsarten: beim Eintragen wird nachgefragt, was trainiert wurde
const SESSION_TYPES = {
  gym: [
    { id: 'legs', name: 'Legs', short: 'Legs' },
    { id: 'upper', name: 'Upper', short: 'Upper' },
    { id: 'arms', name: 'Arms', short: 'Arms' },
    { id: 'chestback', name: 'Chest + Back', short: 'C+B' },
  ],
};

const DEFAULT_CATEGORIES = [
  { id: 'gym', name: 'Gym', emoji: '🏋️', color: COLORS[0], goal: 4 },
  { id: 'run', name: 'Joggen', emoji: '🏃', color: COLORS[1], goal: 1 },
];

// ---------- Datum ----------
// Alle Daten sind lokale Tage als "YYYY-MM-DD" (lassen sich als String vergleichen).

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function toKey(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

function weekdayIndex(key) {
  return (fromKey(key).getDay() + 6) % 7; // Mo=0 … So=6
}

function mondayOf(key) {
  return addDays(key, -weekdayIndex(key));
}

function today() {
  return toKey(new Date());
}

function currentMonday() {
  return mondayOf(today());
}

function weekLabel(mondayKey) {
  const fmt = (k) => fromKey(k).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
  return `${fmt(mondayKey)} – ${fmt(addDays(mondayKey, 6))}`;
}

// ---------- Speicher ----------
// state = {
//   categories: [{ id, name, emoji, color, goal, created }],  created = Montag der ersten Woche
//   sessions:   [{ id, cat, date, type? }],                   eine erledigte Einheit (type siehe SESSION_TYPES)
//   goalHistory: { [montag]: { [catId]: ziel } },             Ziele vergangener Wochen
// }

function uid() {
  return crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function defaultState() {
  const week = currentMonday();
  return {
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c, created: week })),
    sessions: [],
    goalHistory: {},
  };
}

// Prüft gespeicherte oder importierte Daten und gibt einen sauberen State zurück (oder null).
function normalize(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.categories) || !Array.isArray(raw.sessions)) {
    return null;
  }

  const categories = [];
  const ids = new Set();
  for (const c of raw.categories) {
    if (!c || typeof c.id !== 'string' || !c.id || ids.has(c.id)) continue;
    ids.add(c.id);
    categories.push({
      id: c.id,
      name: typeof c.name === 'string' ? c.name.slice(0, 40) : 'Kategorie',
      emoji: typeof c.emoji === 'string' ? c.emoji.slice(0, 8) : '',
      color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : COLORS[categories.length % COLORS.length],
      goal: Number.isInteger(c.goal) ? clamp(c.goal, 0, MAX_GOAL) : 0,
      created: KEY_RE.test(c.created) ? mondayOf(c.created) : currentMonday(),
    });
  }

  const sessions = raw.sessions
    .filter((s) => s && ids.has(s.cat) && KEY_RE.test(s.date))
    .map((s) => {
      const session = { id: typeof s.id === 'string' ? s.id : uid(), cat: s.cat, date: s.date };
      if (typeOf(s.cat, s.type)) session.type = s.type;
      return session;
    });

  // Eine Kategorie beginnt spätestens mit ihrer ersten Einheit
  for (const s of sessions) {
    const cat = categories.find((c) => c.id === s.cat);
    const week = mondayOf(s.date);
    if (week < cat.created) cat.created = week;
  }

  const goalHistory = {};
  if (raw.goalHistory && typeof raw.goalHistory === 'object') {
    for (const [week, goals] of Object.entries(raw.goalHistory)) {
      if (!KEY_RE.test(week) || !goals || typeof goals !== 'object') continue;
      goalHistory[week] = {};
      for (const [id, g] of Object.entries(goals)) {
        if (ids.has(id) && Number.isInteger(g)) goalHistory[week][id] = clamp(g, 0, MAX_GOAL);
      }
    }
  }

  return { categories, sessions, goalHistory };
}

// Alte Version speicherte nur Zähler der aktuellen Woche -> in datierte Einheiten umwandeln
function migrateV1(old) {
  const state = defaultState();
  const week = KEY_RE.test(old.week) ? old.week : currentMonday();
  const date = week === currentMonday() ? today() : week;
  for (const c of state.categories) {
    if (Number.isInteger(old.goals?.[c.id])) c.goal = clamp(old.goals[c.id], 0, MAX_GOAL);
    const done = old.done?.[c.id];
    if (!Number.isInteger(done)) continue;
    for (let i = 0; i < clamp(done, 0, MAX_GOAL); i++) state.sessions.push({ id: uid(), cat: c.id, date });
  }
  return state;
}

function load() {
  try {
    const saved = normalize(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    if (saved) return saved;
    const old = JSON.parse(localStorage.getItem(LEGACY_KEY));
    if (old && typeof old === 'object') return normalize(migrateV1(old));
  } catch { /* defekte Daten -> Standardwerte */ }
  return defaultState();
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* z. B. Speicher voll / privat */ }
}

let state = load();

// ---------- Auswertung ----------

function sessionsIn(catId, monday) {
  const end = addDays(monday, 7);
  return state.sessions
    .filter((s) => s.cat === catId && s.date >= monday && s.date < end)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function weekCounts(catId) {
  const counts = new Map();
  for (const s of state.sessions) {
    if (s.cat !== catId) continue;
    const week = mondayOf(s.date);
    counts.set(week, (counts.get(week) || 0) + 1);
  }
  return counts;
}

function goalFor(cat, week) {
  if (week === currentMonday()) return cat.goal;
  return state.goalHistory[week]?.[cat.id] ?? cat.goal;
}

// 'done' = Ziel geschafft, 'missed' = verfehlt, 'free' = kein Ziel / zählt nicht
function weekStatus(cat, counts, week) {
  if (week < cat.created) return 'free';
  const goal = goalFor(cat, week);
  if (goal === 0) return 'free';
  return (counts.get(week) || 0) >= goal ? 'done' : 'missed';
}

// Die laufende Woche bricht keine Serie, solange sie noch nicht geschafft ist.
function streakOf(start, statusAt) {
  const now = currentMonday();
  let current = 0;
  let best = 0;
  for (let week = start; week <= now; week = addDays(week, 7)) {
    const status = statusAt(week);
    if (status === 'done') best = Math.max(best, ++current);
    else if (status === 'missed' && week !== now) current = 0;
  }
  return { current, best };
}

function categoryStreak(cat) {
  const counts = weekCounts(cat.id);
  return streakOf(cat.created, (week) => weekStatus(cat, counts, week));
}

// Wochen, in denen alle Kategorien mit Ziel geschafft wurden
function overallStreak() {
  if (!state.categories.length) return { current: 0, best: 0 };
  const counts = new Map(state.categories.map((c) => [c.id, weekCounts(c.id)]));
  const start = state.categories.reduce((min, c) => (c.created < min ? c.created : min), currentMonday());
  return streakOf(start, (week) => {
    const statuses = state.categories.map((c) => weekStatus(c, counts.get(c.id), week));
    if (statuses.includes('missed')) return 'missed';
    return statuses.includes('done') ? 'done' : 'free';
  });
}

function snapshotGoals() {
  state.goalHistory[currentMonday()] = Object.fromEntries(state.categories.map((c) => [c.id, c.goal]));
}

function typeOf(catId, typeId) {
  return SESSION_TYPES[catId]?.find((t) => t.id === typeId);
}

function displayName(cat) {
  return cat.name.trim() || 'Ohne Namen';
}

function title(cat) {
  return `${cat.emoji} ${displayName(cat)}`.trim();
}

// ---------- Darstellung ----------

const $categories = document.getElementById('categories');
const $weekLabel = document.getElementById('weekLabel');
const $settings = document.getElementById('settings');
const $catRows = document.getElementById('catRows');
const $stats = document.getElementById('stats');
const $statsBody = document.getElementById('statsBody');
const $session = document.getElementById('session');
const $sessionTitle = document.getElementById('sessionTitle');
const $sessionDays = document.getElementById('sessionDays');
const $sessionTypesWrap = document.getElementById('sessionTypesWrap');
const $sessionTypes = document.getElementById('sessionTypes');
const $importFile = document.getElementById('importFile');

function render() {
  $weekLabel.textContent = weekLabel(currentMonday());
  if (!state.categories.length) {
    $categories.replaceChildren(el('p', { class: 'empty center' }, 'Noch keine Kategorien – leg in den Einstellungen eine an.'));
    return;
  }
  $categories.replaceChildren(...state.categories.map(renderCard));
}

function renderCard(cat) {
  const sessions = sessionsIn(cat.id, currentMonday());
  const goal = cat.goal;
  const count = sessions.length;
  const complete = goal > 0 && count >= goal;
  const streak = categoryStreak(cat).current;

  const card = el('section', { class: 'card' + (complete ? ' complete' : ''), style: `--c: ${cat.color}` });
  const head = el('div', { class: 'card-head' });
  const meta = el('div', { class: 'card-meta' });
  if (streak > 0) {
    meta.append(el('span', { class: 'streak', 'aria-label': `${streak} Wochen in Folge geschafft` }, `🔥 ${streak}`));
  }
  meta.append(el('span', { class: 'count' }, `${count} / ${goal}`));
  head.append(el('h2', {}, title(cat)), meta);
  card.append(head);

  const dots = el('div', { class: 'dots' });
  sessions.forEach((s, i) => {
    const day = weekdayIndex(s.date);
    const type = typeOf(cat.id, s.type);
    const dot = el('button', {
      class: 'dot on',
      'aria-label': `${displayName(cat)} Einheit ${i + 1} am ${DAY_NAMES[day]}${type ? ` (${type.name})` : ''} bearbeiten`,
    }, DAYS[day]);
    if (type) dot.append(el('small', {}, type.short));
    dot.addEventListener('click', () => openSession(s.id));
    dots.append(dot);
  });
  for (let i = count; i < goal; i++) {
    const dot = el('button', { class: 'dot', 'aria-label': `${displayName(cat)} Einheit ${i + 1} heute eintragen` });
    dot.addEventListener('click', () => addSession(cat.id));
    dots.append(dot);
  }
  if (count >= goal) {
    const extra = el('button', { class: 'dot extra', 'aria-label': `Zusätzliche ${displayName(cat)}-Einheit heute eintragen` }, '+');
    extra.addEventListener('click', () => addSession(cat.id));
    dots.append(extra);
  }
  card.append(dots);

  card.append(renderBars(cat, CARD_WEEKS, 'bars mini'));
  return card;
}

// Balken pro Woche: Höhe = Anteil am Wochenziel, volle Farbe = geschafft
function renderBars(cat, weeks, className) {
  const counts = weekCounts(cat.id);
  const now = currentMonday();
  let met = 0;
  const wrap = el('div', { class: className, role: 'img' });
  for (let i = weeks - 1; i >= 0; i--) {
    const week = addDays(now, -7 * i);
    const goal = goalFor(cat, week);
    const count = counts.get(week) || 0;
    const status = weekStatus(cat, counts, week);
    if (status === 'done') met++;
    const ratio = goal > 0 ? Math.min(count / goal, 1) : (count > 0 ? 1 : 0);
    const bar = el('span', {
      class: 'bar' + (status === 'done' ? ' met' : '') + (week === now ? ' now' : '') + (week < cat.created ? ' before' : ''),
    });
    bar.append(el('span', { class: 'fill', style: `height: ${Math.round(ratio * 100)}%` }));
    wrap.append(bar);
  }
  wrap.setAttribute('aria-label', `Verlauf: ${met} von ${weeks} Wochen geschafft`);
  return wrap;
}

function renderStats() {
  const year = today().slice(0, 4);
  const overall = overallStreak();
  const yearCount = state.sessions.filter((s) => s.date.startsWith(year)).length;

  const parts = [
    tiles([
      [`🔥 ${overall.current}`, 'Wochen alle Ziele'],
      [overall.best, 'Beste Serie'],
      [yearCount, `Einheiten ${year}`],
      [state.sessions.length, 'Einheiten gesamt'],
    ]),
  ];

  for (const cat of state.categories) {
    const sessions = state.sessions.filter((s) => s.cat === cat.id);
    const streak = categoryStreak(cat);
    const section = el('section', { class: 'stat-cat', style: `--c: ${cat.color}` });
    section.append(
      el('h3', {}, title(cat)),
      tiles([
        [`🔥 ${streak.current}`, 'Serie'],
        [streak.best, 'Beste'],
        [sessions.filter((s) => s.date.startsWith(year)).length, year],
        [sessions.length, 'Gesamt'],
      ]),
      el('h4', {}, `Letzte ${STATS_WEEKS} Wochen`),
      renderBars(cat, STATS_WEEKS, 'bars big'),
    );
    const axis = el('div', { class: 'axis' });
    axis.append(el('span', {}, `vor ${STATS_WEEKS - 1} Wo.`), el('span', {}, 'diese Woche'));
    section.append(axis, el('h4', {}, 'Wochentage'), renderWeekdays(sessions));
    parts.push(section);
  }

  $statsBody.replaceChildren(...parts);
}

function tiles(items) {
  const wrap = el('div', { class: 'tiles' });
  for (const [value, label] of items) {
    const tile = el('div', { class: 'tile' });
    tile.append(el('strong', {}, String(value)), el('span', {}, label));
    wrap.append(tile);
  }
  return wrap;
}

function renderWeekdays(sessions) {
  const counts = Array(7).fill(0);
  for (const s of sessions) counts[weekdayIndex(s.date)]++;
  const max = Math.max(1, ...counts);
  const wrap = el('div', { class: 'weekdays' });
  counts.forEach((n, i) => {
    const col = el('div', { class: 'wd', 'aria-label': `${DAY_NAMES[i]}: ${n}` });
    const bar = el('span', { class: 'bar' + (n > 0 ? ' met' : '') });
    bar.append(el('span', { class: 'fill', style: `height: ${Math.round((n / max) * 100)}%` }));
    col.append(el('span', { class: 'wd-count' }, String(n)), bar, el('span', { class: 'wd-label' }, DAYS[i]));
    wrap.append(col);
  });
  return wrap;
}

function renderSettings() {
  $catRows.replaceChildren(...state.categories.map((cat) => {
    const row = el('div', { class: 'cat-row', style: `--c: ${cat.color}` });

    const line = el('div', { class: 'cat-line' });
    const emoji = el('input', { class: 'emoji-input', value: cat.emoji, maxlength: '8', 'aria-label': 'Emoji' });
    const name = el('input', { class: 'name-input', value: cat.name, maxlength: '40', 'aria-label': 'Name' });
    const swatch = el('button', { type: 'button', class: 'swatch', 'aria-label': `Farbe von ${displayName(cat)} ändern` });
    const remove = el('button', { type: 'button', class: 'remove', 'aria-label': `${displayName(cat)} löschen` }, '×');
    emoji.addEventListener('input', () => { cat.emoji = emoji.value.trim(); save(); render(); });
    name.addEventListener('input', () => { cat.name = name.value; save(); render(); });
    swatch.addEventListener('click', () => {
      cat.color = COLORS[(COLORS.indexOf(cat.color) + 1) % COLORS.length];
      save();
      renderSettings();
      render();
    });
    remove.addEventListener('click', () => removeCategory(cat));
    line.append(emoji, name, swatch, remove);

    const goalRow = el('div', { class: 'goal-row' });
    const stepper = el('div', { class: 'stepper' });
    const minus = el('button', { type: 'button', 'aria-label': `${displayName(cat)} Ziel verringern` }, '−');
    const plus = el('button', { type: 'button', 'aria-label': `${displayName(cat)} Ziel erhöhen` }, '+');
    minus.disabled = cat.goal <= 0;
    plus.disabled = cat.goal >= MAX_GOAL;
    minus.addEventListener('click', () => changeGoal(cat, -1));
    plus.addEventListener('click', () => changeGoal(cat, +1));
    stepper.append(minus, el('output', {}, String(cat.goal)), plus);
    goalRow.append(el('span', {}, 'Ziel pro Woche'), stepper);

    row.append(line, goalRow);
    return row;
  }));
}

let editingSessionId = null;

function renderSession() {
  const session = state.sessions.find((s) => s.id === editingSessionId);
  if (!session) {
    $session.close();
    return;
  }
  const cat = state.categories.find((c) => c.id === session.cat);
  $session.style.setProperty('--c', cat.color);
  $sessionTitle.textContent = title(cat);
  const monday = mondayOf(session.date);
  const now = today();
  $sessionDays.replaceChildren(...DAYS.map((label, i) => {
    const date = addDays(monday, i);
    const chip = el('button', {
      type: 'button',
      class: 'day' + (date === session.date ? ' selected' : ''),
      'aria-label': DAY_NAMES[i],
      'aria-pressed': String(date === session.date),
    });
    chip.append(el('span', {}, label), el('small', {}, String(fromKey(date).getDate())));
    chip.disabled = date > now;
    chip.addEventListener('click', () => {
      session.date = date;
      save();
      render();
      renderSession();
    });
    return chip;
  }));

  const types = SESSION_TYPES[cat.id];
  $sessionTypesWrap.hidden = !types;
  $sessionTypes.replaceChildren(...(types ?? []).map((type) => {
    const chip = el('button', {
      type: 'button',
      class: 'type' + (type.id === session.type ? ' selected' : ''),
      'aria-pressed': String(type.id === session.type),
    }, type.name);
    chip.addEventListener('click', () => {
      session.type = type.id;
      save();
      render();
      $session.close();
    });
    return chip;
  }));
}

// ---------- Aktionen ----------

function addSession(catId) {
  const session = { id: uid(), cat: catId, date: today() };
  state.sessions.push(session);
  save();
  render();
  if (navigator.vibrate) navigator.vibrate(10);
  // Direkt nachfragen, was trainiert wurde
  if (SESSION_TYPES[catId]) openSession(session.id);
}

function openSession(id) {
  editingSessionId = id;
  renderSession();
  $session.showModal();
}

function changeGoal(cat, delta) {
  cat.goal = clamp(cat.goal + delta, 0, MAX_GOAL);
  snapshotGoals();
  save();
  renderSettings();
  render();
}

function addCategory() {
  const used = new Set(state.categories.map((c) => c.color));
  state.categories.push({
    id: uid(),
    name: '',
    emoji: '⭐',
    color: COLORS.find((c) => !used.has(c)) ?? COLORS[state.categories.length % COLORS.length],
    goal: 3,
    created: currentMonday(),
  });
  snapshotGoals();
  save();
  renderSettings();
  render();
  const inputs = $catRows.querySelectorAll('.name-input');
  inputs[inputs.length - 1]?.focus();
}

function removeCategory(cat) {
  const n = state.sessions.filter((s) => s.cat === cat.id).length;
  const detail = n ? ` und alle ${n} eingetragenen Einheiten` : '';
  if (!confirm(`„${displayName(cat)}“${detail} löschen?`)) return;
  state.categories = state.categories.filter((c) => c.id !== cat.id);
  state.sessions = state.sessions.filter((s) => s.cat !== cat.id);
  for (const goals of Object.values(state.goalHistory)) delete goals[cat.id];
  save();
  renderSettings();
  render();
}

async function exportBackup() {
  const json = JSON.stringify({ app: 'wochenziel', exportedAt: new Date().toISOString(), ...state }, null, 2);
  const name = `wochenziel-backup-${today()}.json`;
  const file = new File([json], name, { type: 'application/json' });

  // Auf dem iPhone über das Teilen-Menü (z. B. „In Dateien sichern“), sonst als Download
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Wochenziel Backup' });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const link = el('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importBackup(file) {
  let data = null;
  try {
    data = normalize(JSON.parse(await file.text()));
  } catch { /* ungültige Datei */ }
  if (!data || !data.categories.length) {
    alert('Das ist keine gültige Wochenziel-Sicherung.');
    return;
  }
  const summary = `${data.categories.length} Kategorien und ${data.sessions.length} Einheiten`;
  if (!confirm(`Backup mit ${summary} laden? Deine aktuellen Daten werden ersetzt.`)) return;
  state = data;
  snapshotGoals();
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

document.getElementById('openStats').addEventListener('click', () => {
  renderStats();
  $stats.showModal();
  $stats.scrollTop = 0;
});

document.getElementById('addCategory').addEventListener('click', addCategory);
document.getElementById('exportBtn').addEventListener('click', exportBackup);
document.getElementById('importBtn').addEventListener('click', () => $importFile.click());
$importFile.addEventListener('change', () => {
  const file = $importFile.files[0];
  $importFile.value = '';
  if (file) importBackup(file);
});

document.getElementById('deleteSession').addEventListener('click', () => {
  state.sessions = state.sessions.filter((s) => s.id !== editingSessionId);
  save();
  render();
  $session.close();
});

// Tippen auf den abgedunkelten Hintergrund schließt Dialoge
for (const dialog of [$settings, $stats, $session]) {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}

// Neue Woche: Ziele der Woche merken, damit der Verlauf später stimmt
function refresh() {
  snapshotGoals();
  save();
  render();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});
window.addEventListener('pageshow', refresh);

refresh();

if ('serviceWorker' in navigator) {
  // Neue Version installiert -> einmal neu laden, damit sie sofort sichtbar ist
  if (navigator.serviceWorker.controller) {
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
