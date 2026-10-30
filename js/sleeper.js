// js/sleeper.js — client for Sleeper's public, read-only API (https://docs.sleeper.com).
//
// Browser-first ES module that also runs under Node 22 (global fetch; no IndexedDB there,
// so the players DB falls back to an in-memory cache).
//
// Privacy/security: no auth, no cookies (credentials: 'omit'), no custom headers — every
// request is a CORS "simple request", so the browser never needs a preflight.
// Sleeper sends `Access-Control-Allow-Origin: *` on every endpoint used here.
//
// Public API (see docs/CONTRACT.md §3):
//   getNflState, resolveUser, getUserLeagues, loadLeague, loadPlayers,
//   looksLikeLeagueId, SleeperError

const API = 'https://api.sleeper.app/v1';
// Undocumented endpoint, used best-effort only (bye weeks). Failure is silently ignored.
const SCHEDULE_API = 'https://api.sleeper.com/schedule/nfl/regular';
const AVATAR_CDN = 'https://sleepercdn.com/avatars/thumbs/';

const TIMEOUT_MS = 15_000;
const PLAYERS_TIMEOUT_MS = 60_000; // ~2.6 MB gzipped; give slow phones room
const SCHEDULE_TIMEOUT_MS = 8_000;
const CONCURRENCY = 6;
const SESSION_TTL_MS = 5 * 60_000;
const STATE_TTL_MS = 60_000;
const PLAYERS_TTL_MS = 24 * 60 * 60_000; // Sleeper asks: fetch /players/nfl at most once a day

const IDB_NAME = 'bad-or-unlucky-sleeper';
const IDB_STORE = 'kv';
const PLAYERS_KEY = 'players-nfl-v1';
const IDB_OP_TIMEOUT_MS = 3_000;

// Player ids are numeric strings ("4046") or NFL team abbreviations for defenses ("PHI").
// Anything else is rejected — this also keeps keys like "__proto__" out of our objects.
const PLAYER_ID_RE = /^[A-Za-z0-9]{1,16}$/;
const TEAM_ABBR_RE = /^[A-Z]{2,3}$/;
const AVATAR_ID_RE = /^[A-Za-z0-9]{1,64}$/;

// ───────────────────────────── errors ─────────────────────────────

export class SleeperError extends Error {
  /**
   * @param {'not_found'|'network'|'rate_limit'|'no_games'} kind
   * @param {string} message  human-readable, safe to show in the UI (via textContent)
   * @param {{status?: number|null, cause?: unknown}} [opts]
   */
  constructor(kind, message, { status = null, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'SleeperError';
    this.kind = kind;
    this.status = status;
  }
}

// ───────────────────────────── helpers ─────────────────────────────

/** True if the input is plausibly a Sleeper league id (15–20 digits). */
export function looksLikeLeagueId(str) {
  return /^\d{15,20}$/.test(String(str ?? '').trim());
}

/** Coerce anything to a finite number rounded to 2 dp; null/NaN/garbage → 0. */
function num(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function toInt(v) {
  const n = typeof v === 'number' ? v : Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function avatarUrl(id) {
  return typeof id === 'string' && AVATAR_ID_RE.test(id) ? AVATAR_CDN + id : null;
}

function cleanText(v) {
  return typeof v === 'string' ? v.trim() : '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run async task factories with at most `limit` in flight. Rejects on first failure. */
async function runPool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  let failed = false;
  async function worker() {
    while (!failed && next < tasks.length) {
      const i = next++;
      try {
        results[i] = await tasks[i]();
      } catch (err) {
        failed = true; // stop starting new requests
        throw err;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// ───────────────────────────── HTTP layer ─────────────────────────────

/** url → { at, promise }. Dedupes in-flight requests and caches results for the session. */
const sessionCache = new Map();

function getJson(url, { ttl = SESSION_TTL_MS, timeout = TIMEOUT_MS, cache = true } = {}) {
  const now = Date.now();
  if (cache) {
    const hit = sessionCache.get(url);
    if (hit && now - hit.at < ttl) return hit.promise;
  }
  const promise = fetchJsonWithRetry(url, timeout);
  if (cache) {
    sessionCache.set(url, { at: now, promise });
    promise.catch(() => {
      if (sessionCache.get(url)?.promise === promise) sessionCache.delete(url);
    });
  }
  return promise;
}

async function fetchJsonWithRetry(url, timeout) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchJsonOnce(url, timeout);
    } catch (err) {
      const retryable =
        err.kind === 'rate_limit' ||
        (err.kind === 'network' && !err.timedOut && (err.status == null || err.status >= 500));
      if (!retryable || attempt >= 2) throw err;
      await sleep(err.kind === 'rate_limit' ? Math.min(err.retryAfterMs || 2000, 5000) : 700);
    }
  }
}

async function fetchJsonOnce(url, timeout) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    let res;
    try {
      res = await fetch(url, {
        signal: ctrl.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    } catch (err) {
      throw networkError(err, ctrl.signal.aborted);
    }
    if (res.status === 404) {
      throw new SleeperError('not_found', 'Not found on Sleeper.', { status: 404 });
    }
    if (res.status === 429) {
      const e = new SleeperError('rate_limit', 'Sleeper is rate-limiting requests. Try again in a minute.', { status: 429 });
      const ra = Number(res.headers.get('retry-after'));
      e.retryAfterMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 0;
      throw e;
    }
    if (!res.ok) {
      throw new SleeperError('network', `Sleeper returned an error (HTTP ${res.status}). Try again shortly.`, { status: res.status });
    }
    let text;
    try {
      text = await res.text();
    } catch (err) {
      throw networkError(err, ctrl.signal.aborted);
    }
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new SleeperError('network', 'Sleeper sent an unreadable response.', { status: res.status, cause: err });
    }
  } finally {
    clearTimeout(timer);
  }
}

function networkError(cause, timedOut) {
  const e = new SleeperError(
    'network',
    timedOut ? 'Sleeper took too long to respond. Try again.' : "Couldn't reach Sleeper. Check your connection and try again.",
    { cause },
  );
  e.timedOut = timedOut;
  return e;
}

// ───────────────────────────── state / users / leagues ─────────────────────────────

/** @returns {Promise<{season: string, week: number, seasonType: string}>} */
export async function getNflState() {
  const s = await getJson(`${API}/state/nfl`, { ttl: STATE_TTL_MS });
  if (!s || typeof s !== 'object') {
    throw new SleeperError('network', 'Sleeper sent an unexpected response for the NFL state.');
  }
  return {
    season: String(s.season ?? s.league_season ?? ''),
    week: toInt(s.week),
    seasonType: String(s.season_type || 'regular'),
  };
}

/** @returns {Promise<{userId: string, username: string, displayName: string, avatar: string|null}>} */
export async function resolveUser(username) {
  const name = String(username ?? '').trim().replace(/^@/, '').toLowerCase();
  const notFound = () => new SleeperError('not_found', 'No Sleeper user with that username.');
  if (!name) throw notFound();
  let u;
  try {
    u = await getJson(`${API}/user/${encodeURIComponent(name)}`);
  } catch (err) {
    throw err.kind === 'not_found' ? notFound() : err;
  }
  // Unknown usernames come back as HTTP 200 with a `null` body.
  if (!u || typeof u !== 'object' || !u.user_id) throw notFound();
  return {
    userId: String(u.user_id),
    username: cleanText(u.username) || name,
    displayName: cleanText(u.display_name) || cleanText(u.username) || name,
    avatar: avatarUrl(u.avatar),
  };
}

/** @returns {Promise<{id: string, name: string, season: string, totalRosters: number, status: string, avatar: string|null}[]>} */
export async function getUserLeagues(userId, season) {
  const uid = String(userId ?? '').trim();
  if (!/^\d+$/.test(uid)) throw new SleeperError('not_found', 'Unknown Sleeper user.');
  const yr = season != null && String(season).trim() ? String(season).trim() : (await getNflState()).season;
  if (!/^\d{4}$/.test(yr)) throw new SleeperError('not_found', 'Unknown season.');
  const list = await getJson(`${API}/user/${uid}/leagues/nfl/${yr}`);
  return (Array.isArray(list) ? list : [])
    .filter((l) => l && typeof l === 'object' && l.league_id)
    .map((l) => ({
      id: String(l.league_id),
      name: cleanText(l.name) || 'Unnamed league',
      season: String(l.season ?? yr),
      totalRosters: toInt(l.total_rosters),
      status: String(l.status || 'unknown'),
      avatar: avatarUrl(l.avatar),
    }));
}

// ───────────────────────────── league ─────────────────────────────

async function fetchLeague(id) {
  const l = await getJson(`${API}/league/${id}`).catch((err) => {
    throw err.kind === 'not_found' ? new SleeperError('not_found', 'No Sleeper league with that ID.', { status: 404 }) : err;
  });
  if (!l || typeof l !== 'object' || !l.league_id || (l.sport && l.sport !== 'nfl')) {
    throw new SleeperError('not_found', 'No Sleeper league with that ID.');
  }
  return l;
}

/** Follow previous_league_id back to the requested season (Sleeper issues a new id each season). */
async function walkToSeason(league, season) {
  let cur = league;
  for (let hops = 0; hops < 20 && toInt(cur.season) > toInt(season); hops++) {
    const prev = cur.previous_league_id;
    if (!prev || prev === '0' || !/^\d+$/.test(String(prev))) break;
    cur = await fetchLeague(String(prev));
  }
  if (String(cur.season) !== season) {
    throw new SleeperError('not_found', `This league has no ${season} season on Sleeper.`);
  }
  return cur;
}

/**
 * Which regular-season weeks are complete for this league, given the NFL state.
 * Exported for tests; not part of the contract.
 */
export function completedWeeks(league, state) {
  const s = (league && league.settings) || {};
  const seasonNum = toInt(league.season);
  const maxWeeks = seasonNum >= 2021 ? 18 : 17;
  const pws = toInt(s.playoff_week_start);
  // playoff_week_start 0/missing = no playoffs (e.g. guillotine leagues) → whole NFL regular season.
  const playoffWeekStart = pws > 1 ? Math.min(pws, maxWeeks + 1) : maxWeeks + 1;
  const lastRegular = playoffWeekStart - 1;
  const startWeek = Math.max(1, toInt(s.start_week) || 1);

  let lastDone = lastRegular;
  const stateSeason = toInt(state.season);
  if (seasonNum > stateSeason) lastDone = 0;
  else if (seasonNum === stateSeason) {
    if (state.seasonType === 'regular') lastDone = Math.min(lastRegular, state.week - 1);
    else if (state.seasonType === 'pre') lastDone = 0;
    // 'post' / 'off': the whole regular season is in the books.
  }
  const weeks = [];
  for (let w = startWeek; w <= lastDone; w++) weeks.push(w);
  return { weeks, playoffWeekStart };
}

function cleanPlayerId(id) {
  const s = id == null ? '' : String(id);
  return PLAYER_ID_RE.test(s) ? s : '0';
}

function normalizeMatchup(m) {
  const starters = (Array.isArray(m.starters) ? m.starters : []).map(cleanPlayerId);
  const rawSp = Array.isArray(m.starters_points) ? m.starters_points : [];
  const startersPoints = starters.map((id, i) => (id === '0' ? 0 : num(rawSp[i])));

  const pp = m.players_points && typeof m.players_points === 'object' ? m.players_points : {};
  const playerPoints = {};
  for (const id of Array.isArray(m.players) ? m.players : []) {
    const pid = cleanPlayerId(id);
    if (pid !== '0') playerPoints[pid] = num(pp[pid]);
  }
  for (const [id, v] of Object.entries(pp)) {
    const pid = cleanPlayerId(id);
    if (pid !== '0' && !(pid in playerPoints)) playerPoints[pid] = num(v);
  }
  starters.forEach((id, i) => {
    if (id !== '0' && !(id in playerPoints)) playerPoints[id] = startersPoints[i];
  });

  // custom_points = commissioner override; points can be null → fall back to the starters' sum.
  const raw = m.custom_points ?? m.points;
  const hasRaw = raw != null && Number.isFinite(Number(raw));
  const points = hasRaw ? num(raw) : num(startersPoints.reduce((a, b) => a + b, 0));

  const mid = toInt(m.matchup_id);
  return {
    teamId: toInt(m.roster_id),
    matchupId: mid > 0 ? mid : null,
    points,
    starters,
    startersPoints,
    playerPoints,
  };
}

function normalizeWeek(week, raw, teamIds) {
  const matchups = (Array.isArray(raw) ? raw : [])
    .filter((m) => m && typeof m === 'object' && teamIds.has(toInt(m.roster_id)))
    .map(normalizeMatchup)
    .sort((a, b) => a.teamId - b.teamId);
  // H2H requires exactly two teams per matchup_id. Guillotine leagues give every team its own id;
  // glitches can produce 1 or 3 — treat anything that isn't a clean pair as "no H2H opponent".
  const counts = new Map();
  for (const m of matchups) if (m.matchupId != null) counts.set(m.matchupId, (counts.get(m.matchupId) || 0) + 1);
  for (const m of matchups) if (m.matchupId != null && counts.get(m.matchupId) !== 2) m.matchupId = null;
  return { week, matchups };
}

function buildTeams(rosters, users) {
  const byId = new Map();
  for (const u of Array.isArray(users) ? users : []) if (u && u.user_id) byId.set(String(u.user_id), u);
  return (Array.isArray(rosters) ? rosters : [])
    .filter((r) => r && toInt(r.roster_id) > 0)
    .map((r) => {
      const teamId = toInt(r.roster_id);
      const ownerId = r.owner_id ? String(r.owner_id) : null;
      const u = ownerId ? byId.get(ownerId) : null;
      const displayName = cleanText(u && u.display_name);
      const teamName = cleanText(u && u.metadata && u.metadata.team_name);
      return {
        teamId,
        ownerId,
        name: teamName || displayName || `Team ${teamId}`,
        managerName: displayName || (ownerId ? 'Unknown manager' : 'No manager'),
        avatar: avatarUrl(u && u.avatar),
      };
    })
    .sort((a, b) => a.teamId - b.teamId);
}

/** NFL team abbr → bye week, from the (undocumented) schedule endpoint. null if unavailable. */
export function byeWeeksFromSchedule(games) {
  if (!Array.isArray(games) || !games.length) return null;
  const teams = new Set();
  const playing = new Map(); // week → Set(team)
  for (const g of games) {
    const w = toInt(g && g.week);
    if (w < 1 || !TEAM_ABBR_RE.test(g.home) || !TEAM_ABBR_RE.test(g.away)) continue;
    teams.add(g.home).add(g.away);
    if (!playing.has(w)) playing.set(w, new Set());
    playing.get(w).add(g.home).add(g.away);
  }
  if (teams.size < 28) return null;
  const byes = {};
  for (const w of [...playing.keys()].sort((a, b) => a - b)) {
    for (const t of teams) if (!playing.get(w).has(t) && !(t in byes)) byes[t] = w;
  }
  return Object.keys(byes).length ? byes : null;
}

async function fetchByeWeeks(season) {
  if (!/^\d{4}$/.test(season)) return null;
  try {
    return byeWeeksFromSchedule(await getJson(`${SCHEDULE_API}/${season}`, { timeout: SCHEDULE_TIMEOUT_MS }));
  } catch {
    return null;
  }
}

function makeProgress(cb) {
  let done = 0;
  let total = 1;
  const emit = (label) => {
    if (typeof cb !== 'function') return;
    try {
      cb({ done, total, label });
    } catch {
      /* a UI bug must never break loading */
    }
  };
  return {
    set(d, t, label) {
      done = d;
      total = t;
      emit(label);
    },
    tick(label) {
      done = Math.min(total, done + 1);
      emit(label);
    },
  };
}

/**
 * Load a Sleeper league and normalize it to LeagueData (CONTRACT §1).
 * Only COMPLETED regular-season weeks are included. `players` is {} — call loadPlayers() after.
 *
 * @param {string} leagueId
 * @param {{ onProgress?: (p: {done: number, total: number, label: string}) => void, season?: string|number }} [opts]
 *   season: optional — if it differs from the league's season, follows previous_league_id back to it.
 */
export async function loadLeague(leagueId, { onProgress, season } = {}) {
  const id = String(leagueId ?? '').trim();
  if (!/^\d{1,20}$/.test(id)) throw new SleeperError('not_found', 'That doesn’t look like a Sleeper league ID.');

  const progress = makeProgress(onProgress);
  progress.set(0, 1, 'Finding league');

  let [state, league] = await Promise.all([getNflState(), fetchLeague(id)]);
  if (season != null && String(season).trim() && String(season).trim() !== String(league.season)) {
    league = await walkToSeason(league, String(season).trim());
  }
  const leagueKey = String(league.league_id);
  const leagueSeason = String(league.season ?? '');
  const { weeks: weekNums, playoffWeekStart } = completedWeeks(league, state);
  if (!weekNums.length) {
    throw new SleeperError('no_games', 'This league hasn’t finished any regular-season weeks yet.');
  }

  let byeWeeks = null;
  const tasks = [
    () => getJson(`${API}/league/${leagueKey}/rosters`).finally(() => progress.tick('Rosters')),
    () => getJson(`${API}/league/${leagueKey}/users`).finally(() => progress.tick('Managers')),
    () => fetchByeWeeks(leagueSeason).then((b) => { byeWeeks = b; }).finally(() => progress.tick('NFL schedule')),
    ...weekNums.map((w) => () => getJson(`${API}/league/${leagueKey}/matchups/${w}`).finally(() => progress.tick(`Week ${w}`))),
  ];
  progress.set(2, 2 + tasks.length, `Loading ${weekNums.length} weeks`);
  const [rosters, users, , ...weekRaw] = await runPool(tasks, CONCURRENCY);

  const teams = buildTeams(rosters, users);
  if (teams.length < 2) throw new SleeperError('no_games', 'This league doesn’t have enough teams to analyze.');
  const teamIds = new Set(teams.map((t) => t.teamId));

  // Drop weeks nobody scored in (not started / unscored), wherever they are.
  const weeks = weekNums
    .map((w, i) => normalizeWeek(w, weekRaw[i], teamIds))
    .filter((wk) => wk.matchups.length > 0 && wk.matchups.some((m) => m.points !== 0));
  if (!weeks.length) {
    throw new SleeperError('no_games', 'This league hasn’t finished any regular-season weeks yet.');
  }

  const s = league.settings || {};
  /** @type {any} */
  const data = {
    league: {
      id: leagueKey,
      name: cleanText(league.name) || 'Sleeper league',
      season: leagueSeason,
      platform: 'sleeper',
      rosterPositions: (Array.isArray(league.roster_positions) ? league.roster_positions : []).map(String),
      medianGame: toInt(s.league_average_match) === 1,
      playoffWeekStart,
    },
    teams,
    weeks,
    players: {},
  };
  if (byeWeeks) data.byeWeeks = byeWeeks;
  return data;
}

// ───────────────────────────── players DB ─────────────────────────────

let playersMem = null; // { savedAt: number, players: Object<string, Player> }
let playersInflight = null;
let dbPromise = null;

const isFresh = (entry) =>
  !!entry && typeof entry.savedAt === 'number' && entry.players && typeof entry.players === 'object' &&
  Date.now() - entry.savedAt < PLAYERS_TTL_MS && entry.savedAt <= Date.now() + 60_000;

function defensePlayer(abbr) {
  return { name: `${abbr} D/ST`, position: 'DEF', fantasyPositions: ['DEF'], team: abbr };
}

/** Full Sleeper players blob (~15 MB) → slim map (~1 MB) with only what the analysis needs. */
function slimPlayers(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SleeperError('network', 'Sleeper sent an unexpected players list.');
  }
  const out = {};
  for (const [id, p] of Object.entries(raw)) {
    if (!PLAYER_ID_RE.test(id) || !p || typeof p !== 'object') continue;
    const fp = Array.isArray(p.fantasy_positions) ? p.fantasy_positions.filter((x) => typeof x === 'string' && x) : [];
    const position = cleanText(p.position) || fp[0] || '';
    if (TEAM_ABBR_RE.test(id)) {
      // Team defenses are keyed by team abbreviation ("PHI").
      out[id] = defensePlayer(id);
      continue;
    }
    const name = cleanText(p.full_name) || `${cleanText(p.first_name)} ${cleanText(p.last_name)}`.trim() || `Player ${id}`;
    out[id] = {
      name,
      position: position || 'UNK',
      fantasyPositions: fp.length ? fp : position ? [position] : [],
      team: cleanText(p.team) || null,
    };
  }
  return out;
}

function unknownPlayer(id) {
  if (TEAM_ABBR_RE.test(id)) return defensePlayer(id);
  return { name: `Player ${id}`, position: 'UNK', fantasyPositions: [], team: null };
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms))]);
}

function openDb() {
  if (typeof indexedDB === 'undefined' || !indexedDB) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = withTimeout(
      new Promise((resolve) => {
        let req;
        try {
          req = indexedDB.open(IDB_NAME, 1);
        } catch {
          resolve(null); // e.g. some private-browsing modes
          return;
        }
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      }),
      IDB_OP_TIMEOUT_MS,
      null,
    );
  }
  return dbPromise;
}

async function idbGet(key) {
  const db = await openDb();
  if (!db) return null;
  return withTimeout(
    new Promise((resolve) => {
      try {
        const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    }),
    IDB_OP_TIMEOUT_MS,
    null,
  );
}

async function idbSet(key, value) {
  const db = await openDb();
  if (!db) return false;
  return withTimeout(
    new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false); // e.g. quota exceeded
      } catch {
        resolve(false);
      }
    }),
    IDB_OP_TIMEOUT_MS,
    false,
  );
}

async function getPlayersDb() {
  if (isFresh(playersMem)) return playersMem.players;
  if (!playersInflight) {
    playersInflight = (async () => {
      const cached = await idbGet(PLAYERS_KEY);
      if (isFresh(cached)) {
        playersMem = cached;
        return cached.players;
      }
      try {
        const raw = await getJson(`${API}/players/nfl`, { cache: false, timeout: PLAYERS_TIMEOUT_MS });
        const entry = { savedAt: Date.now(), players: slimPlayers(raw) };
        playersMem = entry;
        await idbSet(PLAYERS_KEY, entry);
        return entry.players;
      } catch (err) {
        // Stale beats nothing: names/positions barely change day to day.
        const stale = cached && cached.players && typeof cached.players === 'object' ? cached : playersMem;
        if (stale && stale.players) return stale.players;
        if (err instanceof SleeperError && err.kind === 'not_found') {
          throw new SleeperError('network', 'Couldn’t load the Sleeper players list.', { status: err.status, cause: err });
        }
        throw err;
      }
    })().finally(() => {
      playersInflight = null;
    });
  }
  return playersInflight;
}

/**
 * Look up players by id. Fetches Sleeper's full players DB at most once per 24h
 * (cached as a slim map in IndexedDB, or in memory where IndexedDB is unavailable).
 * Every requested id gets an entry; unknown ids get a placeholder (fantasyPositions: []).
 * @param {Iterable<string>} playerIds
 * @returns {Promise<Object<string, {name: string, position: string, fantasyPositions: string[], team: string|null}>>}
 */
export async function loadPlayers(playerIds) {
  const wanted = new Set();
  for (const id of playerIds || []) {
    const pid = cleanPlayerId(id);
    if (pid !== '0') wanted.add(pid);
  }
  if (!wanted.size) return {};
  const db = await getPlayersDb();
  const out = {};
  for (const id of wanted) {
    const p = Object.prototype.hasOwnProperty.call(db, id) ? db[id] : unknownPlayer(id);
    out[id] = { name: p.name, position: p.position, fantasyPositions: [...p.fantasyPositions], team: p.team };
  }
  return out;
}
