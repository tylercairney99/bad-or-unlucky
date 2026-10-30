// js/app.js — router, data cache, and the landing / picker / loading screens.
// Result and leaderboard screens live in js/result.js and js/board.js.
//
// Routes (hash-based, D6):
//   #/                      landing
//   #/u/<username>[/<yr>]   league picker (season chips)
//   #/l/<leagueId>          team picker
//   #/l/<leagueId>/<team>   result
//   #/l/<leagueId>/board    leaderboard
//   #/demo, #/demo/<team>, #/demo/board

import { h, store, avatar, prefersReducedMotion } from './dom.js';
import { recordText, weeksText } from './format.js';
import { getNflState, resolveUser, getUserLeagues, loadLeague, loadPlayers, SleeperError } from './sleeper.js';
import { analyzeLeague } from './analysis.js';
import { generateDemoLeague, DEMO_YOUR_TEAM_ID } from './demo.js';
import { renderResult } from './result.js';
import { renderBoard } from './board.js';

const DEMO = 'demo';
const USERNAME_RE = /^[A-Za-z0-9_]{1,40}$/;
const ID_RE = /^\d{1,20}$/;
const SEASON_RE = /^20\d{2}$/;
const KEY_USER = 'bou:user';
const KEY_THEME = 'bou:theme';
const teamKey = (leagueKey) => `bou:team:${leagueKey}`;

const app = document.getElementById('app');
const backBtn = document.getElementById('back-btn');

// ───────────────────────────── paths ─────────────────────────────

const paths = {
  teams: (key) => (key === DEMO ? '#/demo/board' : `#/l/${key}`),
  team: (key, id) => (key === DEMO ? (id === DEMO_YOUR_TEAM_ID ? '#/demo' : `#/demo/${id}`) : `#/l/${key}/${id}`),
  board: (key) => (key === DEMO ? '#/demo/board' : `#/l/${key}/board`),
  user: (name, season) => `#/u/${encodeURIComponent(name)}${season ? `/${season}` : ''}`,
};

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return '\u0000'; // fails every validator below
  }
}

/** Parse + validate the hash. null = invalid (we redirect to the landing). */
function parseRoute(hash = location.hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(safeDecode);
  const [a, b, c] = parts;
  const len = parts.length;
  if (!a) return { name: 'landing' };
  if (a === 'u' && USERNAME_RE.test(b || '') && len <= 3 && (len < 3 || SEASON_RE.test(c))) {
    return { name: 'leagues', username: b, season: c || null };
  }
  if (a === 'l' && ID_RE.test(b || '')) {
    if (len === 2) return { name: 'teams', key: b };
    if (len === 3 && c === 'board') return { name: 'board', key: b };
    if (len === 3 && ID_RE.test(c)) return { name: 'result', key: b, teamId: Number(c) };
  }
  if (a === DEMO) {
    if (len === 1) return { name: 'result', key: DEMO, teamId: DEMO_YOUR_TEAM_ID };
    if (len === 2 && b === 'board') return { name: 'board', key: DEMO };
    if (len === 2 && ID_RE.test(b)) return { name: 'result', key: DEMO, teamId: Number(b) };
  }
  return null;
}

// In-app history so the ← button can use history.back() without leaving the site.
const visited = [];
let replacing = false;

function replaceRoute(hash) {
  replacing = true;
  location.replace(hash);
}

function trackHistory() {
  const cur = location.hash || '#/';
  if (replacing) {
    replacing = false;
    visited[visited.length ? visited.length - 1 : 0] = cur;
  } else if (visited.length > 1 && visited[visited.length - 2] === cur) {
    visited.pop();
  } else {
    visited.push(cur);
  }
}

function parentOf(r) {
  if (!r || r.name === 'teams' || r.name === 'leagues') return '#/';
  if (r.name === 'result') return r.key === DEMO ? '#/' : paths.teams(r.key);
  if (r.name === 'board') {
    const you = youIn(r.key);
    return you ? paths.team(r.key, you) : r.key === DEMO ? '#/' : paths.teams(r.key);
  }
  return '#/';
}

// ───────────────────────────── data cache ─────────────────────────────
// key ('demo' or Sleeper league id) → Entry { key, data, report, players: 'loading'|'ready'|'failed', listeners }

const entries = new Map();
const pending = new Map();
const ownerHints = new Map(); // leagueId → userId, set when a league is picked from a username's list

function getEntry(key, { onProgress, season } = {}) {
  if (entries.has(key) && !season) return Promise.resolve(entries.get(key));
  const pendingKey = season ? `${key}@${season}` : key;
  if (pending.has(pendingKey)) return pending.get(pendingKey);
  const load = key === DEMO ? Promise.resolve().then(() => generateDemoLeague()) : loadLeague(key, { onProgress, season });
  const p = load
    .then((data) => createEntry(season ? String(data.league.id) : key, data))
    .finally(() => pending.delete(pendingKey));
  pending.set(pendingKey, p);
  return p;
}

function createEntry(key, data) {
  const entry = { key, data, report: analyzeLeague(data), players: 'ready', listeners: new Set() };
  entries.set(key, entry);
  if (!entry.report.hasPlayerData) {
    entry.players = 'loading';
    fillPlayers(entry);
  }
  return entry;
}

function playerIdsOf(data) {
  const ids = new Set();
  for (const w of data.weeks) {
    for (const m of w.matchups) {
      for (const id of Object.keys(m.playerPoints || {})) ids.add(id);
      for (const id of m.starters || []) if (id && id !== '0') ids.add(id);
    }
  }
  return ids;
}

/** D8: the verdict is already on screen; player-level sections fill in when the players DB arrives. */
function fillPlayers(entry) {
  loadPlayers(playerIdsOf(entry.data))
    .then((players) => {
      const data = { ...entry.data, players };
      entry.report = analyzeLeague(data);
      entry.data = data;
      entry.players = 'ready';
    })
    .catch((err) => {
      console.warn('Player data unavailable:', err);
      entry.players = 'failed';
    })
    .finally(() => {
      for (const fn of entry.listeners) fn(entry);
    });
}

const youIn = (key) => {
  if (key === DEMO) return DEMO_YOUR_TEAM_ID;
  const v = Number(store.get(teamKey(key)));
  return Number.isInteger(v) && v > 0 ? v : null;
};
const rememberTeam = (key, teamId) => key !== DEMO && store.set(teamKey(key), teamId);

// ───────────────────────────── shell: mount, toast, announcer ─────────────────────────────

let routeToken = 0;
let cleanup = null;
let firstMount = true;

function mount(node) {
  app.replaceChildren(node);
  window.scrollTo(0, 0);
  if (!firstMount) {
    const target = node.querySelector('h1') || app;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }
  firstMount = false;
}

const toastEl = document.getElementById('toast');
let toastTimer = 0;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
    setTimeout(() => (toastEl.textContent = ''), 250);
  }, 2400);
}

const announcer = document.getElementById('announcer');
function announce(message) {
  announcer.textContent = '';
  setTimeout(() => (announcer.textContent = message), 60);
}

const shareUrlFor = (key, teamId) => location.origin + location.pathname + paths.team(key, teamId);

function uiFor(key) {
  return {
    mount,
    toast,
    announce,
    youId: youIn(key),
    isDemo: key === DEMO,
    paths: {
      team: (id) => paths.team(key, id),
      teams: paths.teams(key),
      board: paths.board(key),
    },
    shareUrl: (teamId) => (key === DEMO ? `${location.origin}${location.pathname}#/demo` : shareUrlFor(key, teamId)),
    hook: weeklyHook,
  };
}

/** "Week 8 is live — …" for leagues in the current, in-progress season. Uses the cached NFL state. */
async function weeklyHook(entry) {
  if (entry.data.league.platform !== 'sleeper') return null;
  try {
    const s = await getNflState();
    if (s.seasonType !== 'regular' || s.season !== entry.data.league.season || s.week < 2) return null;
    return `Week ${s.week} is live — numbers update after Monday Night Football.`;
  } catch {
    return null;
  }
}

// ───────────────────────────── router ─────────────────────────────

async function route() {
  const token = ++routeToken;
  if (cleanup) cleanup();
  cleanup = null;
  const r = parseRoute();
  if (!r) {
    replaceRoute('#/');
    return;
  }
  backBtn.hidden = r.name === 'landing';
  try {
    if (r.name === 'landing') renderLanding();
    else if (r.name === 'leagues') await showLeagues(token, r);
    else if (r.name === 'teams') await showTeams(token, r);
    else if (r.name === 'result') await showResult(token, r);
    else if (r.name === 'board') await showBoard(token, r);
    if (token === routeToken) rateRetries = 0;
  } catch (err) {
    if (token === routeToken) showError(err, r, token);
  }
}

async function showLeagues(token, r) {
  const loader = startLoader(token, 'Finding you', 'Found you');
  try {
    const [user, state] = await Promise.all([resolveUser(r.username), getNflState()]);
    store.set(KEY_USER, r.username);
    const season = r.season || state.season;
    const leagues = await getUserLeagues(user.userId, season);
    if (token !== routeToken) return;
    loader.done(0);

    // Fewest taps: one league this season → straight to the user's own result.
    if (!r.season && leagues.length === 1) {
      const lg = leagues[0];
      const entry = await getEntry(lg.id, { onProgress: loader.onProgress });
      if (token !== routeToken) return;
      loader.loaded(entry);
      const mine = entry.data.teams.find((t) => t.ownerId === user.userId);
      if (mine) {
        rememberTeam(lg.id, mine.teamId);
        replaceRoute(paths.team(lg.id, mine.teamId));
      } else {
        replaceRoute(paths.teams(lg.id)); // co-owner or orphan: let them pick
      }
      return;
    }
    loader.stop();
    mount(leaguePickerView(r.username, user.userId, season, Number(state.season), leagues));
  } finally {
    loader.stop();
  }
}

async function showTeams(token, r) {
  const entry = await withEntry(token, r.key);
  if (!entry) return;
  const hint = ownerHints.get(r.key);
  if (hint) {
    ownerHints.delete(r.key);
    const mine = entry.data.teams.find((t) => t.ownerId === hint);
    if (mine) {
      rememberTeam(r.key, mine.teamId);
      replaceRoute(paths.team(r.key, mine.teamId));
      return;
    }
  }
  mount(teamPickerView(entry));
}

async function showResult(token, r) {
  const entry = await withEntry(token, r.key);
  if (!entry) return;
  if (!entry.report.teams.some((t) => t.teamId === r.teamId)) {
    replaceRoute(paths.teams(r.key));
    return;
  }
  cleanup = renderResult(entry, r.teamId, uiFor(r.key));
}

async function showBoard(token, r) {
  const entry = await withEntry(token, r.key);
  if (!entry) return;
  cleanup = renderBoard(entry, uiFor(r.key));
}

/** Cached entry instantly, else load behind the (delayed) loader. Resolves null if the route changed. */
async function withEntry(token, key) {
  if (entries.has(key)) return entries.get(key);
  const loader = startLoader(token, 'Finding your league', 'Found your league');
  try {
    const entry = await getEntry(key, { onProgress: loader.onProgress });
    loader.loaded(entry);
    return token === routeToken ? entry : null;
  } finally {
    loader.stop();
  }
}

// ───────────────────────────── errors (DESIGN_BRIEF §7) ─────────────────────────────

let rateRetries = 0;

function showError(err, r, token) {
  const kind = err instanceof SleeperError ? err.kind : 'unknown';
  if (kind === 'unknown') console.error(err);
  const typed = r.username || (r.key && r.key !== DEMO ? r.key : '');
  const isUser = r.name === 'leagues';
  const retry = { label: 'Try again', onclick: () => route() };
  let message;
  let actions = [];

  if (kind === 'not_found') {
    message = isUser
      ? `No Sleeper user “${typed}”. Check the spelling, or paste a league ID.`
      : `No Sleeper league with ID “${typed}”. Check it, or try your username.`;
  } else if (kind === 'network') {
    // err.status is set when Sleeper answered (HTTP 5xx / unreadable body): the user's connection is fine.
    message = err.status ? 'Sleeper is having trouble right now. Try again in a minute.' : "Can't reach Sleeper. Check your connection.";
    actions = [retry];
  } else if (kind === 'rate_limit' && rateRetries < 3) {
    rateRetries += 1;
    message = 'Sleeper asked us to slow down. Retrying…';
    setTimeout(() => token === routeToken && route(), 3000);
  } else if (kind === 'rate_limit') {
    message = 'Sleeper asked us to slow down. Give it a minute.';
    actions = [retry];
  } else if (kind === 'no_games') {
    message = 'No finished games yet this season. Try last season or the demo league.';
    actions = [{ label: 'Try last season', onclick: () => tryLastSeason(r) }, { label: 'Demo', href: '#/demo' }];
    getNflState()
      .then((s) => {
        const btn = document.querySelector('[data-last-season]');
        if (btn && SEASON_RE.test(s.season)) btn.textContent = `Try ${Number(s.season) - 1}`;
      })
      .catch(() => {});
  } else {
    message = 'Something went wrong on our end. Try again.';
    actions = [retry];
  }
  renderLanding({ value: typed, error: { message, actions } });
}

async function tryLastSeason(r) {
  const token = ++routeToken;
  try {
    const state = await getNflState();
    const prev = String(Number(state.season) - 1);
    if (r.username) {
      location.hash = paths.user(r.username, prev);
      return;
    }
    const entry = await withEntryForSeason(token, r.key, prev);
    if (entry) location.hash = paths.teams(entry.key);
  } catch (err) {
    if (token === routeToken) showError(err, r, token);
  }
}

async function withEntryForSeason(token, key, season) {
  const loader = startLoader(token, 'Finding last season', 'Found last season');
  try {
    const entry = await getEntry(key, { onProgress: loader.onProgress, season });
    return token === routeToken ? entry : null;
  } finally {
    loader.stop();
  }
}

// ───────────────────────────── landing ─────────────────────────────

const SAMPLE = ['earned', 'robbed', 'earned', 'deserved', 'robbed', 'earned', 'stole'];
const GLYPH = { earned: 'W', stole: '★', robbed: '!', deserved: 'L', tie: '=', bye: '–' };

function parseQuery(raw) {
  const s = String(raw || '').trim().replace(/^@/, '');
  const url = s.match(/sleeper\.(?:com|app)\/leagues\/(\d{10,20})/i);
  if (url) return { leagueId: url[1] };
  if (/^\d{10,20}$/.test(s)) return { leagueId: s };
  if (USERNAME_RE.test(s)) return { username: s };
  return { invalid: s };
}

function renderLanding({ value = '', error = null } = {}) {
  const last = store.get(KEY_USER);
  const input = h('input', {
    id: 'q', class: 'input', type: 'text', name: 'q', maxlength: '200',
    placeholder: 'Sleeper username or league ID',
    autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', autocomplete: 'username', enterkeyhint: 'go',
    'aria-describedby': 'q-error',
  });
  input.value = value || last || '';
  const errorBox = h('div', { id: 'q-error', class: 'error-wrap', role: 'alert' });

  const setError = (err) => {
    errorBox.replaceChildren();
    input.removeAttribute('aria-invalid');
    if (!err) return;
    input.setAttribute('aria-invalid', 'true');
    errorBox.append(h('p', { class: 'error' }, h('span', { class: 'error-icon', 'aria-hidden': 'true' }, '⚠'), h('span', null, err.message)));
    if (err.actions && err.actions.length) {
      errorBox.append(h('div', { class: 'error-actions' }, err.actions.map((a) => (a.href
        ? h('a', { class: 'btn btn-secondary btn-small', href: a.href }, a.label)
        : h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: a.onclick, 'data-last-season': a.label === 'Try last season' ? '' : null }, a.label)))));
    }
    if (!prefersReducedMotion()) {
      input.classList.remove('shake');
      void input.offsetWidth; // restart the animation
      input.classList.add('shake');
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    const q = parseQuery(input.value);
    if (!q.username && !q.leagueId) {
      setError({
        message: q.invalid ? `No Sleeper user “${q.invalid.slice(0, 40)}”. Check the spelling, or paste a league ID.` : 'Type your Sleeper username to start.',
      });
      input.focus();
      return;
    }
    const target = q.username ? paths.user(q.username) : paths.teams(q.leagueId);
    if (location.hash === target) route();
    else location.hash = target;
  };

  const sample = h('ol', { class: 'tiles flipping', 'aria-hidden': 'true' },
    SAMPLE.map((k, i) => h('li', null, h('span', { class: 'tile', dataset: { k }, style: { '--i': i } }, GLYPH[k]))));

  const view = h('section', { class: 'view landing' },
    h('div', { class: 'hero' },
      h('h1', { class: 'hero-title', tabindex: '-1' }, h('span', null, 'Bad'), ' ', h('span', null, 'or Unlucky?')),
      h('p', { class: 'tagline' }, 'Your record lies. We checked.'),
      h('p', { class: 'tagline-sub' }, 'Find out if you’re actually bad — or just unlucky.')),
    h('form', { class: 'landing-form', novalidate: true, onsubmit: onSubmit },
      h('label', { class: 'sr-only', for: 'q' }, 'Sleeper username or league ID'),
      input,
      errorBox,
      h('button', { class: 'btn btn-primary', type: 'submit' }, last ? 'Check again' : 'Check my luck')),
    h('a', { class: 'link-btn demo-link', href: '#/demo' }, 'Try a demo league'),
    h('div', { class: 'sample' },
      sample,
      h('p', { class: 'legend' }, h('b', null, 'W'), ' earned · ', h('b', null, '★'), ' stole · ', h('b', null, '!'), ' robbed · ', h('b', null, 'L'), ' deserved')),
  );
  mount(view);
  setError(error);
  if (prefersReducedMotion()) sample.classList.remove('flipping');
}

// ───────────────────────────── pickers ─────────────────────────────

const STATUS = { pre_draft: 'Pre-draft', drafting: 'Drafting', in_season: 'In season', complete: 'Complete' };

function leaguePickerView(username, userId, season, currentSeason, leagues) {
  const seasons = [currentSeason, currentSeason - 1, currentSeason - 2].map(String);
  if (!seasons.includes(season)) seasons.push(season);
  const sorted = [...leagues].sort(
    (a, b) => (b.status === 'in_season') - (a.status === 'in_season') || a.name.localeCompare(b.name),
  );
  return h('section', { class: 'view picker' },
    h('div', null,
      h('h1', { class: 'screen-title', tabindex: '-1' }, 'Pick a league'),
      h('p', { class: 'sub' }, `@${username} · ${season}`)),
    h('nav', { class: 'chips', 'aria-label': 'Season' },
      seasons.map((s) => h('a', { class: 'chip', href: paths.user(username, s), 'aria-current': s === season ? 'page' : null }, s))),
    sorted.length
      ? h('ul', { class: 'card-list' }, sorted.map((lg) => h('li', null,
        h('a', { class: 'card', href: paths.teams(lg.id), onclick: () => ownerHints.set(lg.id, userId) },
          avatar(lg.avatar, lg.name),
          h('span', { class: 'card-body' },
            h('span', { class: 'card-title ellipsis' }, lg.name),
            h('span', { class: 'card-meta' }, `${lg.totalRosters} teams · ${STATUS[lg.status] || 'Sleeper league'}`)),
          h('span', { class: 'chev', 'aria-hidden': 'true' })))))
      : h('p', { class: 'empty' }, `No ${season} leagues for @${username}.`),
  );
}

function teamPickerView(entry) {
  const { league } = entry.report;
  const teams = [...entry.report.teams].sort((a, b) => a.recordRank - b.recordRank); // never by luck (spoilers)
  const list = h('ul', { class: 'card-list' }, teams.map((t) => h('li', { dataset: { q: `${t.name} ${t.managerName}`.toLowerCase() } },
    h('a', { class: 'card team-card', href: paths.team(entry.key, t.teamId), onclick: () => rememberTeam(entry.key, t.teamId) },
      avatar(t.avatar, t.name),
      h('span', { class: 'card-body' },
        h('span', { class: 'card-title ellipsis' }, t.name),
        h('span', { class: 'card-meta ellipsis' }, t.managerName)),
      h('span', { class: 'card-record' }, recordText(t.record))))));

  let search = null;
  if (teams.length > 12) {
    const input = h('input', { id: 'team-q', class: 'input input-sm', type: 'search', placeholder: 'Find your team', autocomplete: 'off', spellcheck: 'false' });
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      for (const li of list.children) li.hidden = q !== '' && !li.dataset.q.includes(q);
    });
    search = h('div', null, h('label', { class: 'sr-only', for: 'team-q' }, 'Find your team'), input);
  }

  return h('section', { class: 'view picker' },
    h('div', null,
      h('h1', { class: 'screen-title', tabindex: '-1' }, 'Which team is yours?'),
      h('p', { class: 'sub' }, `${league.name} · ${league.season} · ${weeksText(league.weeksAnalyzed)}`)),
    search,
    list);
}

// ───────────────────────────── loading (DESIGN_BRIEF §2.4) ─────────────────────────────

const LINES = [
  'Calling Sleeper…', 'Replaying every week…', 'Counting the cheap wins…', 'Auditing your opponents…',
  'Finding the guy who dropped 40 on you…', 'Checking your bench for crimes…', 'Scanning for injury bad luck…',
  'Asking the schedule hard questions…',
];

/** Loader shown only if work takes > 250ms. Steps: find → teams → weeks → injuries & slumps. */
function startLoader(token, firstLabel, firstDone) {
  const steps = [
    { label: `${firstLabel}…`, state: 'active' },
    { label: 'Loading teams…', state: 'todo' },
    { label: 'Scoring weeks…', state: 'todo' },
    { label: 'Checking injuries & slumps', state: 'todo' },
  ];
  let stepEls = null;
  let lineTimer = 0;
  let slowTimer = 0;
  let stopped = false;
  const seen = new Set();

  const paint = () => {
    if (!stepEls) return;
    steps.forEach((s, i) => {
      stepEls[i].dataset.state = s.state;
      stepEls[i].textContent = s.label;
    });
  };
  const done = (i, label) => {
    if (label) steps[i].label = label;
    steps[i].state = 'done';
    if (steps[i + 1] && steps[i + 1].state === 'todo') steps[i + 1].state = 'active';
    paint();
  };

  const show = () => {
    if (stopped || token !== routeToken) return;
    stepEls = steps.map(() => h('li', { class: 'step' }));
    const line = h('p', { class: 'loading-line', 'aria-hidden': 'true' }, LINES[0]);
    const slow = h('p', { class: 'slow', hidden: true }, 'Big league — still working.');
    mount(h('section', { class: 'view loading', 'aria-busy': 'true' },
      h('h1', { class: 'sr-only', tabindex: '-1' }, 'Loading your league'),
      h('ol', { class: 'tiles', 'aria-hidden': 'true' }, Array.from({ length: 7 }, () => h('li', { class: 'skel-tile' }))),
      line,
      h('ol', { class: 'steps', role: 'status' }, stepEls),
      slow));
    paint();
    if (!prefersReducedMotion()) {
      let i = 0;
      lineTimer = setInterval(() => {
        line.classList.add('out');
        setTimeout(() => {
          i = (i + 1) % LINES.length;
          line.textContent = LINES[i];
          line.classList.remove('out');
        }, 200);
      }, 1400);
    }
    slowTimer = setTimeout(() => (slow.hidden = false), 8000 - 250);
  };
  const showTimer = setTimeout(show, 250);

  return {
    done: (i) => done(i, i === 0 ? firstDone : undefined),
    /** sleeper.js progress labels: 'Finding league', 'Loading N weeks', 'Rosters', 'Managers', 'NFL schedule', 'Week N'. */
    onProgress: ({ done: d, total, label }) => {
      if (/^Loading \d+ weeks/.test(label) && steps[0].state !== 'done') done(0, firstDone);
      if (label === 'Rosters' || label === 'Managers') seen.add(label);
      if (seen.size === 2 && steps[1].state !== 'done') done(1, 'Loaded teams');
      if (/^Week \d+/.test(label) && steps[2].state !== 'done') {
        steps[2].label = `Scoring weeks… ${Math.max(0, d - 2)}/${Math.max(1, total - 2)}`;
        if (steps[2].state === 'todo') steps[2].state = 'active';
        paint();
      }
    },
    loaded: (entry) => {
      done(0, firstDone);
      done(1, `Loaded ${entry.report.league.teamCount} teams`);
      done(2, `Scored ${weeksText(entry.report.league.weeksAnalyzed).replace('Wk', 'weeks')}`);
    },
    stop: () => {
      stopped = true;
      clearTimeout(showTimer);
      clearInterval(lineTimer);
      clearTimeout(slowTimer);
    },
  };
}

// ───────────────────────────── chrome: theme, help sheet, back ─────────────────────────────

function initTheme() {
  const root = document.documentElement;
  const btn = document.getElementById('theme-btn');
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  const apply = (theme, manual) => {
    root.setAttribute('data-theme', theme);
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    if (manual) for (const m of metas) m.setAttribute('content', theme === 'dark' ? '#0F1115' : '#F7F5F0');
  };
  apply(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light', false);
  btn.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    apply(next, true);
    store.set(KEY_THEME, next);
  });
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!store.get(KEY_THEME)) apply(e.matches ? 'dark' : 'light', false);
    });
  } catch {
    /* old browser */
  }
}

function initHelp() {
  const dialog = document.getElementById('how');
  const opener = document.getElementById('help-btn');
  if (typeof dialog.showModal !== 'function') {
    opener.hidden = true;
    return;
  }
  const close = () => dialog.open && dialog.close();
  opener.addEventListener('click', () => {
    dialog.showModal();
    dialog.querySelector('[data-close]').focus();
  });
  for (const b of dialog.querySelectorAll('[data-close]')) b.addEventListener('click', close);
  dialog.addEventListener('click', (e) => e.target === dialog && close()); // backdrop
  dialog.addEventListener('close', () => opener.focus());
  // Explicit focus trap (showModal already makes the page inert; this keeps Tab cycling inside).
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll('button, a[href], input')].filter((el) => !el.disabled && el.offsetParent);
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

function initBack() {
  backBtn.addEventListener('click', () => {
    if (visited.length > 1) history.back();
    else location.hash = parentOf(parseRoute());
  });
}

initTheme();
initHelp();
initBack();
window.addEventListener('hashchange', () => {
  trackHistory();
  route();
});
trackHistory();
route();
