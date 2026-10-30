/**
 * Bad or Unlucky? — analysis engine.
 *
 *   analyzeLeague(LeagueData, options?) -> Report        (shapes: docs/CONTRACT.md §1 and §2)
 *
 * Pure and deterministic: no DOM, no network, no Date, no Math.random. Same input -> same output.
 * Everything is iterated in a fixed order (teams by teamId, weeks ascending, players by id).
 *
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 * EDGE-CASE POLICY
 *
 * Input hygiene
 *  - Nothing throws on missing/garbage fields: non-numeric points become 0, missing arrays/objects
 *    become empty. No NaN/Infinity can reach the output.
 *  - Teams are de-duplicated by teamId. Matchups for unknown teamIds, and a second matchup for the
 *    same team in the same week, are ignored (first one wins).
 *  - Weeks are sorted ascending and de-duplicated. A week where EVERY team scored exactly 0 is
 *    treated as unplayed and dropped (otherwise it would hand every team a tie).
 *  - A matchupId shared by exactly two teams is a H2H game. A null matchupId, or one shared by 1 or
 *    3+ teams, is "no H2H game" that week (the team still counts for all-play and points).
 *  - A starter missing from playerPoints is added to it from startersPoints.
 *
 * Records
 *  - Scores are compared with a 1e-9 tolerance; equal = tie.
 *  - Median game: every team with a matchup entry that week gets one extra W/L/T against the median
 *    of all entries' points. It counts in `record` (and recordRank) only. The additive field
 *    `h2hRecord` carries the pure H2H record that `expected` and winsAboveExpected are based on.
 *  - All-play pct / record win% with zero games = 0.5 (neutral prior: no NaN, and a team with no
 *    games is not labelled BAD). Such a team gets a "no games yet" headline.
 *
 * Opponent heat
 *  - oppAvg = the opponent's mean over its OTHER played weeks (needs >= 1 other week, else null and
 *    the game is left out of heat). perGame = total / number of games that had an oppAvg.
 *  - "Season high against you": the opponent has >= 2 played weeks, scored >= every other week AND
 *    strictly above its leave-one-out average (so flat or all-zero teams never qualify). Ties for a
 *    season high count.
 *
 * Players (only when the players map is non-empty; otherwise hasPlayerData = false and
 * injuries / slumps / skill / weeks[].optimal are null and the composite uses schedule + oppHeat)
 *  - Weekly points are pooled per player across all rosters; if a player shows up on two rosters
 *    in one week, the larger |points| wins. "Active" = points != 0.
 *  - Slump baseline = the player's "recent form" (Lead decision, overrides CONTRACT's LOO wording):
 *    default 'prior' = mean of his active weeks strictly BEFORE week w, pooled across all rosters,
 *    needing >= 2 such weeks, else the start is skipped (so weeks 1–2 never count as slumps).
 *    slumps.worst/best[].expected is that prior mean. options.slumpBaseline = 'loo' (mean of all
 *    his OTHER active weeks) is kept as an option; it was dropped as the default because the LOO
 *    deltas of a player started in every active week sum to exactly 0 (see playerBaseline).
 *    Injury "expected" is unaffected: always the player's overall active-week mean.
 *  - Byes: data.byeWeeks (abbr -> week, or week[]) when it has at least one key; else inferred
 *    (see inferByeWeeks).
 *  - Injuries: only players present in the players map are judged (we need the NFL team to rule
 *    out a bye). A key player whose team is null cannot be on bye, so his 0s count. Expected =
 *    his mean over all active weeks league-wide; a case is ignored when that mean is missing or
 *    <= 0. Limitation: a healthy scratch / stashed rookie who later became a starter also looks
 *    "injured" in his early 0 weeks — this is an estimate, as the UI must say.
 *  - Optimal lineup: greedy as specified. Only players with points > 0 are used (an empty slot
 *    beats a negative score). Unknown slot names are treated as single-position slots named after
 *    themselves. Weekly optimal is floored at the points actually scored, so bench points are never
 *    negative and efficiency stays in [0, 1] (efficiency = 1 when optimal is 0).
 *
 * Composite
 *  - z-scores use the population SD; a factor with SD < 1e-9 gives every team z = 0 (its weight
 *    stays in the denominator). With 1 team everything is 0.
 *
 * Ranks
 *  - Unique 1..N: sort by the metric (1e-9 tolerance), then the documented tiebreak, then teamId.
 *
 * Rounding (display only — ranks and verdicts always use full precision)
 *  - Raw per-game scores (weeks[].points, weeks[].oppPoints, slump case points): 2 decimals, so a
 *    100.04–100.01 win never displays as a tie. Season totals and other derived numbers: 1
 *    decimal. Ratios (allPlay.pct, efficiency): 3 decimals. composite.score: 2 decimals.
 *    Halves round away from zero (so -0.75 shows as -0.8, consistent with the verdict boundary).
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 */

const EPS = 1e-9;

export const COMPOSITE_WEIGHTS = Object.freeze({ schedule: 0.5, oppHeat: 0.2, injuries: 0.15, slumps: 0.15 });

export const VERDICTS = Object.freeze({
  ROBBED: Object.freeze({ code: 'ROBBED', title: 'ROBBED', emoji: '🫠' }),
  LEGIT: Object.freeze({ code: 'LEGIT', title: 'LEGIT', emoji: '💪' }),
  COOKING: Object.freeze({ code: 'COOKING', title: 'COOKING', emoji: '🔥' }),
  CURSED: Object.freeze({ code: 'CURSED', title: 'CURSED', emoji: '🪦' }),
  BAD: Object.freeze({ code: 'BAD', title: 'BAD', emoji: '🗑️' }),
  FRAUD: Object.freeze({ code: 'FRAUD', title: 'FRAUD', emoji: '🤡' }),
});

const IGNORED_SLOTS = new Set(['BN', 'IR', 'TAXI']);
const FLEX_ELIGIBILITY = Object.freeze({
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  FLEX: ['RB', 'WR', 'TE'],
  IDP_FLEX: ['DL', 'LB', 'DB'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
});
const FLEX_ORDER = ['WRRB_FLEX', 'REC_FLEX', 'FLEX', 'IDP_FLEX', 'SUPER_FLEX'];

// ─── small helpers (exported for tests) ────────────────────────────────────────────────────────

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Coerce to a finite number (numeric strings allowed); anything else -> 0. */
export function num(x) {
  if (typeof x === 'number') return Number.isFinite(x) ? x : 0;
  if (typeof x === 'string' && x.trim() !== '') {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Round half away from zero; never returns -0 or NaN. */
export function roundTo(x, digits = 1) {
  const v = num(x);
  const f = 10 ** digits;
  const r = (v < 0 ? -1 : 1) * (Math.round(Math.abs(v) * f + 1e-7) / f);
  return r === 0 ? 0 : r;
}

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th", 21 -> "21st", 112 -> "112th". */
export function ordinal(n) {
  const i = Math.trunc(num(n));
  const a = Math.abs(i);
  const m100 = a % 100;
  if (m100 >= 11 && m100 <= 13) return `${i}th`;
  switch (a % 10) {
    case 1: return `${i}st`;
    case 2: return `${i}nd`;
    case 3: return `${i}rd`;
    default: return `${i}th`;
  }
}

/** Pick the singular/plural word for a (displayed) count. */
export function plural(count, singular, pluralForm = `${singular}s`) {
  return roundTo(count, 1) === 1 ? singular : pluralForm;
}

export function mean(values) {
  if (!values.length) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Population z-scores; zero variance -> all zeros. */
export function zScores(values) {
  const v = values.map(num);
  if (!v.length) return [];
  const m = mean(v);
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
  if (!(sd > EPS)) return v.map(() => 0);
  return v.map((x) => (x - m) / sd);
}

/** Verdict code from the CONTRACT matrix (inclusive ±0.75 and 0.5 boundaries). */
export function classifyVerdict(allPlayPct, winsAboveExpected) {
  const strong = num(allPlayPct) >= 0.5 - EPS;
  const w = num(winsAboveExpected);
  const luck = w >= 0.75 - EPS ? 'lucky' : w <= -0.75 + EPS ? 'unlucky' : 'fair';
  if (strong) return luck === 'unlucky' ? 'ROBBED' : luck === 'lucky' ? 'COOKING' : 'LEGIT';
  return luck === 'unlucky' ? 'CURSED' : luck === 'lucky' ? 'FRAUD' : 'BAD';
}

function cmpAsc(a, b) {
  return Math.abs(a - b) < EPS ? 0 : a < b ? -1 : 1;
}
const cmpDesc = (a, b) => cmpAsc(b, a);
function cmpStr(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function entriesOf(pointsByWeek) {
  if (pointsByWeek instanceof Map) return [...pointsByWeek.entries()];
  if (isObj(pointsByWeek)) return Object.entries(pointsByWeek);
  return [];
}

/**
 * A player's expected points for `week`.
 *  'prior' (default): mean of his active (!= 0) weeks strictly BEFORE `week`, needs >= 2
 *           ("recent form" going into the game).
 *  'loo':   mean of his active weeks other than `week`, needs >= 2.
 * Why 'prior': with 'loo', Σ(x_w − mean of the others) over all of a player's active weeks is
 * exactly 0, so a team that starts him every week nets 0 no matter how badly he slumped, and the
 * team total only reflects start/sit timing. 'prior' has no such identity: a player fading from his
 * early-season form produces a negative net.
 * @param {Map<number,number>|Object<string,number>} pointsByWeek
 */
export function playerBaseline(pointsByWeek, week, mode = 'prior') {
  let s = 0;
  let c = 0;
  for (const [wk, pts] of entriesOf(pointsByWeek)) {
    const w = Number(wk);
    if (mode === 'loo' ? w === week : w >= week) continue;
    const p = num(pts);
    if (p !== 0) {
      s += p;
      c += 1;
    }
  }
  return c >= 2 ? s / c : null;
}

/** Mean over a player's active weeks, or null when he never scored. */
export function activeMean(pointsByWeek) {
  let s = 0;
  let c = 0;
  for (const [, pts] of entriesOf(pointsByWeek)) {
    const p = num(pts);
    if (p !== 0) {
      s += p;
      c += 1;
    }
  }
  return c ? s / c : null;
}

/** Team leave-one-out mean over its other played weeks (>= 1), else null. */
function looMean(ptsByWeek, week) {
  let s = 0;
  let c = 0;
  for (const [wk, p] of ptsByWeek) {
    if (wk === week) continue;
    s += p;
    c += 1;
  }
  return c ? s / c : null;
}

function isSeasonHigh(ptsByWeek, week) {
  if (!ptsByWeek || ptsByWeek.size < 2 || !ptsByWeek.has(week)) return false;
  const p = ptsByWeek.get(week);
  let max = -Infinity;
  let s = 0;
  let c = 0;
  for (const [wk, v] of ptsByWeek) {
    if (wk === week) continue;
    if (v > max) max = v;
    s += v;
    c += 1;
  }
  return p >= max - EPS && p > s / c + EPS;
}

function getPlayer(players, pid) {
  return hasOwn(players, pid) && isObj(players[pid]) ? players[pid] : null;
}

function playerName(info, pid) {
  return info && typeof info.name === 'string' && info.name ? info.name : `Player ${pid}`;
}

function eligiblePositions(info) {
  if (!info) return [];
  if (Array.isArray(info.fantasyPositions) && info.fantasyPositions.length) return info.fantasyPositions.map(String);
  return typeof info.position === 'string' && info.position ? [info.position] : [];
}

// ─── normalization ─────────────────────────────────────────────────────────────────────────────

function normalizeTeams(raw) {
  const out = [];
  const seen = new Set();
  for (const t of Array.isArray(raw) ? raw : []) {
    if (!isObj(t) || t.teamId == null) continue;
    const id = Number(t.teamId);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    const managerName = typeof t.managerName === 'string' ? t.managerName : '';
    const name = typeof t.name === 'string' && t.name.trim() ? t.name : managerName || `Team ${id}`;
    out.push({ teamId: id, name, managerName, avatar: typeof t.avatar === 'string' ? t.avatar : null });
  }
  return out.sort((a, b) => a.teamId - b.teamId);
}

function normalizeMatchup(m, id) {
  const starters = Array.isArray(m.starters) ? m.starters.map((s) => (s == null ? '0' : String(s))) : [];
  const rawSp = Array.isArray(m.startersPoints) ? m.startersPoints : [];
  const startersPoints = starters.map((pid, i) => (pid === '0' ? 0 : num(rawSp[i])));
  const playerPoints = {};
  if (isObj(m.playerPoints)) {
    for (const [pid, v] of Object.entries(m.playerPoints)) if (pid !== '0') playerPoints[pid] = num(v);
  }
  starters.forEach((pid, i) => {
    if (pid !== '0' && !hasOwn(playerPoints, pid)) playerPoints[pid] = startersPoints[i];
  });
  return {
    teamId: id,
    matchupId: m.matchupId == null ? null : String(m.matchupId),
    points: num(m.points),
    starters,
    startersPoints,
    playerPoints,
  };
}

/** -> [{ week, entries: Map<teamId, entry> (teamId order), opp: Map<teamId, teamId> }] */
function normalizeWeeks(raw, teamSet) {
  const byWeek = new Map();
  for (const w of Array.isArray(raw) ? raw : []) {
    if (!isObj(w) || w.week == null) continue;
    const week = Number(w.week);
    if (!Number.isFinite(week) || byWeek.has(week)) continue;
    const list = [];
    const seen = new Set();
    for (const m of Array.isArray(w.matchups) ? w.matchups : []) {
      if (!isObj(m) || m.teamId == null) continue;
      const id = Number(m.teamId);
      if (!teamSet.has(id) || seen.has(id)) continue;
      seen.add(id);
      list.push(normalizeMatchup(m, id));
    }
    if (!list.length || list.every((e) => e.points === 0)) continue; // unplayed week
    list.sort((a, b) => a.teamId - b.teamId);
    const entries = new Map(list.map((e) => [e.teamId, e]));
    const groups = new Map();
    for (const e of list) {
      if (e.matchupId === null) continue;
      if (!groups.has(e.matchupId)) groups.set(e.matchupId, []);
      groups.get(e.matchupId).push(e.teamId);
    }
    const opp = new Map();
    for (const ids of groups.values()) {
      if (ids.length !== 2) continue;
      opp.set(ids[0], ids[1]);
      opp.set(ids[1], ids[0]);
    }
    byWeek.set(week, { week, entries, opp });
  }
  return [...byWeek.values()].sort((a, b) => a.week - b.week);
}

// ─── player-level building blocks ──────────────────────────────────────────────────────────────

function buildPlayerWeeks(weeks) {
  const map = new Map(); // pid -> Map(week -> pts)
  for (const w of weeks) {
    for (const e of w.entries.values()) {
      for (const [pid, pts] of Object.entries(e.playerPoints)) {
        let m = map.get(pid);
        if (!m) map.set(pid, (m = new Map()));
        const prev = m.get(w.week);
        if (prev === undefined || Math.abs(pts) > Math.abs(prev)) m.set(w.week, pts);
      }
    }
  }
  return map;
}

function inferByesFromWeeks(weeks, players) {
  const out = new Map(); // abbr -> Set(week)
  for (const w of weeks) {
    const seen = new Set();
    const stat = new Map(); // abbr -> { count, allZero }
    for (const e of w.entries.values()) {
      for (const [pid, pts] of Object.entries(e.playerPoints)) {
        if (seen.has(pid)) continue;
        seen.add(pid);
        const team = getPlayer(players, pid)?.team;
        if (typeof team !== 'string' || !team) continue;
        const s = stat.get(team) || { count: 0, allZero: true };
        s.count += 1;
        if (pts !== 0) s.allZero = false;
        stat.set(team, s);
      }
    }
    for (const [abbr, s] of stat) {
      if (s.count < 2 || !s.allZero) continue;
      if (!out.has(abbr)) out.set(abbr, new Set());
      out.get(abbr).add(w.week);
    }
  }
  return out;
}

/**
 * Infer NFL bye weeks from league data: a week is team X's bye when every league-rostered player
 * whose players[id].team === X scored exactly 0 that week AND at least 2 such players exist.
 * @returns {Object<string, number[]>} abbr -> sorted bye weeks
 */
export function inferByeWeeks(data) {
  const input = isObj(data) ? data : {};
  const players = isObj(input.players) ? input.players : {};
  const teams = normalizeTeams(input.teams);
  const weeks = normalizeWeeks(input.weeks, new Set(teams.map((t) => t.teamId)));
  const out = {};
  const inferred = inferByesFromWeeks(weeks, players);
  for (const abbr of [...inferred.keys()].sort(cmpStr)) out[abbr] = [...inferred.get(abbr)].sort((a, b) => a - b);
  return out;
}

function resolveByes(byeWeeks, weeks, players) {
  if (isObj(byeWeeks) && Object.keys(byeWeeks).length) {
    const m = new Map();
    for (const [abbr, v] of Object.entries(byeWeeks)) {
      const list = (Array.isArray(v) ? v : [v]).map(Number).filter(Number.isFinite);
      m.set(abbr, new Set(list));
    }
    return m;
  }
  return inferByesFromWeeks(weeks, players);
}

/**
 * Best possible lineup from one team-week's playerPoints.
 * Dedicated slots first (in rosterPositions order), then flex slots from most to least
 * restrictive; each slot takes the highest-scoring eligible player not yet used.
 * @returns {{ total: number, lineup: {slot: string, playerId: string|null, points: number}[] }}
 */
export function optimalLineup(rosterPositions, playerPoints, players) {
  const plist = isObj(players) ? players : {};
  const slots = (Array.isArray(rosterPositions) ? rosterPositions : []).map(String).filter((s) => !IGNORED_SLOTS.has(s));
  const dedicated = slots.filter((s) => !hasOwn(FLEX_ELIGIBILITY, s));
  const flex = FLEX_ORDER.flatMap((f) => slots.filter((s) => s === f));
  const pool = Object.entries(isObj(playerPoints) ? playerPoints : {})
    .filter(([pid]) => pid !== '0')
    .map(([pid, pts]) => ({ pid, pts: num(pts), pos: eligiblePositions(getPlayer(plist, pid)) }))
    .filter((p) => p.pts > 0 && p.pos.length)
    .sort((a, b) => b.pts - a.pts || cmpStr(a.pid, b.pid));
  const used = new Set();
  const lineup = [];
  let total = 0;
  const fill = (slot, elig) => {
    const pick = pool.find((p) => !used.has(p.pid) && p.pos.some((x) => elig.includes(x)));
    if (pick) {
      used.add(pick.pid);
      total += pick.pts;
      lineup.push({ slot, playerId: pick.pid, points: pick.pts });
    } else {
      lineup.push({ slot, playerId: null, points: 0 });
    }
  };
  for (const s of dedicated) fill(s, [s]);
  for (const s of flex) fill(s, FLEX_ELIGIBILITY[s]);
  return { total, lineup };
}

function computeInjuries(teamId, weeks, pWeeks, players, byes) {
  const stats = new Map(); // pid -> { starts, active, activeStarts, zeroWeeks }
  for (const w of weeks) {
    const e = w.entries.get(teamId);
    if (!e) continue;
    const starterSet = new Set(e.starters.filter((p) => p !== '0'));
    for (const [pid, pts] of Object.entries(e.playerPoints)) {
      let s = stats.get(pid);
      if (!s) stats.set(pid, (s = { starts: 0, active: 0, activeStarts: 0, zeroWeeks: [] }));
      const started = starterSet.has(pid);
      if (started) s.starts += 1;
      if (pts !== 0) {
        s.active += 1;
        if (started) s.activeStarts += 1;
      } else {
        s.zeroWeeks.push(w.week);
      }
    }
  }
  const cases = [];
  for (const pid of [...stats.keys()].sort(cmpStr)) {
    const s = stats.get(pid);
    const key = s.starts >= 2 || (s.active > 0 && s.activeStarts / s.active >= 0.5);
    if (!key || !s.zeroWeeks.length) continue;
    const info = getPlayer(players, pid);
    if (!info) continue;
    const expected = activeMean(pWeeks.get(pid));
    if (expected === null || expected <= 0) continue;
    const nfl = typeof info.team === 'string' && info.team ? info.team : null;
    for (const wk of s.zeroWeeks) {
      if (nfl && byes.get(nfl)?.has(wk)) continue;
      cases.push({ playerId: pid, name: playerName(info, pid), week: wk, expected });
    }
  }
  cases.sort((a, b) => cmpDesc(a.expected, b.expected) || a.week - b.week || cmpStr(a.playerId, b.playerId));
  return { pointsLost: cases.reduce((t, c) => t + c.expected, 0), gamesMissed: cases.length, cases };
}

function computeSlumps(teamId, weeks, pWeeks, players, mode) {
  const deltas = [];
  for (const w of weeks) {
    const e = w.entries.get(teamId);
    if (!e) continue;
    e.starters.forEach((pid, i) => {
      if (pid === '0') return;
      const pts = e.startersPoints[i];
      if (pts === 0) return; // a 0 is an injury question, not a slump
      const base = playerBaseline(pWeeks.get(pid), w.week, mode);
      if (base === null) return;
      deltas.push({ playerId: pid, name: playerName(getPlayer(players, pid), pid), week: w.week, points: pts, expected: base, delta: pts - base });
    });
  }
  const tie = (a, b) => a.week - b.week || cmpStr(a.playerId, b.playerId);
  const worst = deltas.filter((d) => d.delta < -EPS).sort((a, b) => cmpAsc(a.delta, b.delta) || tie(a, b)).slice(0, 3);
  const best = deltas.filter((d) => d.delta > EPS).sort((a, b) => cmpDesc(a.delta, b.delta) || tie(a, b)).slice(0, 3);
  return { net: deltas.reduce((t, d) => t + d.delta, 0), worst, best };
}

// ─── copy ──────────────────────────────────────────────────────────────────────────────────────

const fmtWins = (x) => String(roundTo(x, 1));
const fmtPts = (x) => roundTo(x, 1).toFixed(1);
const fmtRecord = (r) => `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}`;
const bestPhrase = (rank) => (rank === 1 ? 'best' : `${ordinal(rank)}-best`);

/** "a 5.6-1.4 team" vs "an 8.2-..." / "an 11.5-..." / "an 18-...". */
export function article(numText) {
  const lead = String(numText).split(/[^0-9]/)[0];
  return /^8/.test(lead) || lead === '11' || lead === '18' ? 'an' : 'a';
}

/** "most" / "fewest" / "4th-most" for a points-for rank. */
function pointsPhrase(rank, n) {
  if (rank === 1) return 'most';
  if (rank === n) return 'fewest';
  return `${ordinal(rank)}-most`;
}

/**
 * Rank note where rank 1 = "most": top -> "most in the league", bottom -> "<least> in the league",
 * top half -> "3rd most", bottom half -> "2nd <least>".
 */
function rankMost(rank, n, least = 'least') {
  if (rank === 1) return 'most in the league';
  if (rank === n) return `${least} in the league`;
  return rank <= Math.ceil(n / 2) ? `${ordinal(rank)} most` : `${ordinal(n - rank + 1)} ${least}`;
}

function headlineFor(code, v) {
  switch (code) {
    case 'ROBBED':
      return v.rr > v.sr
        ? `You're the ${bestPhrase(v.sr)} team in the league but sit ${ordinal(v.rr)}.`
        : `You scored like ${article(v.exp)} ${v.exp} team but you're ${v.h2h}.`;
    case 'LEGIT':
      return `You're the ${bestPhrase(v.sr)} team in the league and your ${v.rec} record says so. No notes.`;
    case 'COOKING':
      return `Good AND lucky: you're ${v.h2h} when your points say ${v.exp}.`;
    case 'CURSED':
      return v.rr > v.sr
        ? `You're the ${bestPhrase(v.sr)} team and somehow sit ${ordinal(v.rr)}. Bad AND unlucky.`
        : `Bad AND unlucky: your points say ${v.exp}, your record says ${v.h2h}.`;
    case 'BAD':
      return v.pr > Math.ceil(v.n / 2)
        ? `It's not luck. You're ${ordinal(v.pr)} in points and your record agrees.`
        : `It's not luck. You'd beat just ${v.apPctText} of the league in a typical week, and your record agrees.`;
    default: // FRAUD
      return v.winning
        ? `${v.rec} with the ${pointsPhrase(v.pr, v.n)} points. Enjoy it while it lasts.`
        : `${v.h2h} with the ${pointsPhrase(v.pr, v.n)} points, and it should be worse (${v.exp}).`;
  }
}

// ─── main ──────────────────────────────────────────────────────────────────────────────────────

/**
 * @param {import('./sleeper.js').LeagueData|Object} data  CONTRACT §1
 * @param {{slumpBaseline?: 'prior'|'loo'}} [options]  default 'prior'
 * @returns {Object} Report (CONTRACT §2)
 */
export function analyzeLeague(data, options = {}) {
  const input = isObj(data) ? data : {};
  const lg = isObj(input.league) ? input.league : {};
  const players = isObj(input.players) ? input.players : {};
  const hasPlayerData = Object.keys(players).length > 0;
  const slumpMode = isObj(options) && options.slumpBaseline === 'loo' ? 'loo' : 'prior';
  const medianGame = lg.medianGame === true;

  const teams = normalizeTeams(input.teams);
  const teamIds = teams.map((t) => t.teamId);
  const teamById = new Map(teams.map((t) => [t.teamId, t]));
  const weeks = normalizeWeeks(input.weeks, new Set(teamIds));
  const weekNums = weeks.map((w) => w.week);
  const N = teams.length;

  const teamPts = new Map(teamIds.map((id) => [id, new Map()]));
  for (const w of weeks) for (const e of w.entries.values()) teamPts.get(e.teamId).set(w.week, e.points);

  const S = new Map(
    teamIds.map((id) => [id, {
      h2h: { w: 0, l: 0, t: 0 }, med: { w: 0, l: 0, t: 0 }, ap: { w: 0, l: 0, t: 0 },
      games: 0, expW: 0, pf: 0, pa: 0, weeksPlayed: 0,
      heatTotal: 0, heatGames: 0, seasonHighs: 0,
      weekMap: new Map(),
      injuries: null, slumps: null, optimal: 0, efficiency: 1, bench: 0,
    }]),
  );

  // ── records, all-play, opponent heat ──
  for (const w of weeks) {
    const entries = [...w.entries.values()];
    const n = entries.length;
    const med = median(entries.map((e) => e.points));
    for (const e of entries) {
      const s = S.get(e.teamId);
      s.pf += e.points;
      s.weeksPlayed += 1;
      let apW = 0;
      let apL = 0;
      let apT = 0;
      for (const o of entries) {
        if (o.teamId === e.teamId) continue;
        const c = cmpAsc(e.points, o.points);
        if (c > 0) apW += 1;
        else if (c < 0) apL += 1;
        else apT += 1;
      }
      s.ap.w += apW;
      s.ap.l += apL;
      s.ap.t += apT;
      const wr = {
        week: w.week, opponentId: null, points: e.points, oppPoints: null, result: null,
        apW, apL, apT, opponents: n - 1, oppAvg: null, oppSeasonHigh: false, optimal: null,
      };
      const oppId = w.opp.get(e.teamId);
      if (oppId !== undefined) {
        const o = w.entries.get(oppId);
        const c = cmpAsc(e.points, o.points);
        wr.result = c > 0 ? 'W' : c < 0 ? 'L' : 'T';
        if (c > 0) s.h2h.w += 1;
        else if (c < 0) s.h2h.l += 1;
        else s.h2h.t += 1;
        wr.opponentId = oppId;
        wr.oppPoints = o.points;
        s.games += 1;
        s.pa += o.points;
        s.expW += (apW + 0.5 * apT) / (n - 1); // n >= 2 whenever a H2H game exists
        const avg = looMean(teamPts.get(oppId), w.week);
        wr.oppAvg = avg;
        if (avg !== null) {
          s.heatTotal += o.points - avg;
          s.heatGames += 1;
        }
        wr.oppSeasonHigh = isSeasonHigh(teamPts.get(oppId), w.week);
        if (wr.oppSeasonHigh) s.seasonHighs += 1;
      }
      if (medianGame) {
        const c = cmpAsc(e.points, med);
        if (c > 0) s.med.w += 1;
        else if (c < 0) s.med.l += 1;
        else s.med.t += 1;
      }
      s.weekMap.set(w.week, wr);
    }
  }

  // ── player-level factors ──
  if (hasPlayerData) {
    const pWeeks = buildPlayerWeeks(weeks);
    const byes = resolveByes(input.byeWeeks, weeks, players);
    for (const id of teamIds) {
      const s = S.get(id);
      s.injuries = computeInjuries(id, weeks, pWeeks, players, byes);
      s.slumps = computeSlumps(id, weeks, pWeeks, players, slumpMode);
      let opt = 0;
      for (const w of weeks) {
        const e = w.entries.get(id);
        if (!e) continue;
        const weekly = Math.max(optimalLineup(lg.rosterPositions, e.playerPoints, players).total, e.points);
        s.weekMap.get(w.week).optimal = weekly;
        opt += weekly;
      }
      s.optimal = opt;
      s.efficiency = opt > EPS ? Math.min(1, Math.max(0, s.pf / opt)) : 1;
      s.bench = Math.max(0, opt - s.pf);
    }
  }

  // ── derived per-team numbers ──
  for (const id of teamIds) {
    const s = S.get(id);
    const apGames = s.ap.w + s.ap.l + s.ap.t;
    s.apPct = apGames ? (s.ap.w + 0.5 * s.ap.t) / apGames : 0.5;
    s.record = { wins: s.h2h.w + s.med.w, losses: s.h2h.l + s.med.l, ties: s.h2h.t + s.med.t };
    const recGames = s.record.wins + s.record.losses + s.record.ties;
    s.winPct = recGames ? (s.record.wins + 0.5 * s.record.ties) / recGames : 0.5;
    s.wae = s.h2h.w + 0.5 * s.h2h.t - s.expW;
    s.heatPerGame = s.heatGames ? s.heatTotal / s.heatGames : 0;
    s.noGames = s.games === 0 && apGames === 0;
  }

  // ── ranks (unique; tiebreak documented, then teamId) ──
  const get = (id) => S.get(id);
  const rankIds = (cmp) => new Map([...teamIds].sort((a, b) => cmp(get(a), get(b)) || a - b).map((id, i) => [id, i + 1]));
  const strengthRank = rankIds((a, b) => cmpDesc(a.apPct, b.apPct) || cmpDesc(a.pf, b.pf));
  const recordRank = rankIds((a, b) => cmpDesc(a.winPct, b.winPct) || cmpDesc(a.pf, b.pf));
  const pointsRank = rankIds((a, b) => cmpDesc(a.pf, b.pf));
  const scheduleRank = rankIds((a, b) => cmpAsc(a.wae, b.wae));
  const heatRank = rankIds((a, b) => cmpDesc(a.heatTotal, b.heatTotal));
  const injRank = hasPlayerData ? rankIds((a, b) => cmpDesc(a.injuries.pointsLost, b.injuries.pointsLost)) : null;
  const slumpRank = hasPlayerData ? rankIds((a, b) => cmpAsc(a.slumps.net, b.slumps.net)) : null;
  const effRank = hasPlayerData ? rankIds((a, b) => cmpDesc(a.efficiency, b.efficiency)) : null;

  // ── z-scores and composite (negative = unlucky) ──
  const zOf = (fn) => {
    const z = zScores(teamIds.map((id) => fn(get(id))));
    return new Map(teamIds.map((id, i) => [id, z[i]]));
  };
  const z = {
    schedule: zOf((s) => s.wae),
    oppHeat: zOf((s) => -s.heatTotal),
    injuries: hasPlayerData ? zOf((s) => -s.injuries.pointsLost) : null,
    slumps: hasPlayerData ? zOf((s) => s.slumps.net) : null,
    efficiency: hasPlayerData ? zOf((s) => s.efficiency) : null,
    seasonHighs: zOf((s) => s.seasonHighs),
  };
  const factors = hasPlayerData ? ['schedule', 'oppHeat', 'injuries', 'slumps'] : ['schedule', 'oppHeat'];
  const wSum = factors.reduce((t, f) => t + COMPOSITE_WEIGHTS[f], 0);
  for (const id of teamIds) {
    get(id).composite = factors.reduce((t, f) => t + COMPOSITE_WEIGHTS[f] * z[f].get(id), 0) / wSum;
  }
  const compositeRank = rankIds((a, b) => cmpAsc(a.composite, b.composite));

  // ── verdict copy ──
  const buildVerdict = (id) => {
    const s = get(id);
    const code = classifyVerdict(s.apPct, s.wae);
    const meta = VERDICTS[code];
    if (s.noGames) {
      return {
        code, title: meta.title, emoji: meta.emoji,
        headline: 'No games on the books yet, so there is nothing to judge.',
        reasons: ['No completed head-to-head games yet', 'Check back after a few weeks of games'],
      };
    }
    const expW = roundTo(s.expW, 1);
    const expL = roundTo(s.games - expW, 1);
    const v = {
      n: N, sr: strengthRank.get(id), rr: recordRank.get(id), pr: pointsRank.get(id),
      rec: fmtRecord(s.record),
      h2h: fmtRecord({ wins: s.h2h.w, losses: s.h2h.l, ties: s.h2h.t }),
      exp: `${fmtWins(expW)}-${fmtWins(expL)}`,
      apPctText: `${Math.round(s.apPct * 100)}%`,
      winning: s.winPct >= 0.5 - EPS,
    };
    const cands = [];
    const add = (key, mag, text) => cands.push({ key, mag: Math.abs(mag), order: cands.length, text });

    // schedule (always shown: it is what the verdict is built on)
    const actual = s.h2h.w + 0.5 * s.h2h.t;
    const sRank = scheduleRank.get(id);
    const lRank = N - sRank + 1;
    const deserved = `${fmtWins(s.expW)} ${plural(s.expW, 'win')}`;
    let schedText;
    if (s.wae <= -0.75 + EPS) {
      schedText = `Your points deserved ${deserved}, but you have ${fmtWins(actual)} (${sRank === 1 ? 'unluckiest in the league' : `${ordinal(sRank)}-unluckiest`})`;
    } else if (s.wae >= 0.75 - EPS) {
      schedText = `Your points deserved only ${deserved}, yet you have ${fmtWins(actual)} (${lRank === 1 ? 'luckiest in the league' : `${ordinal(lRank)}-luckiest`})`;
    } else {
      schedText = `Your record is about what your points deserved: ${fmtWins(actual)} ${plural(actual, 'win')} vs ${fmtWins(s.expW)} expected`;
    }
    add('schedule', z.schedule.get(id), schedText);

    // opponent heat
    const hRank = heatRank.get(id);
    const coldRank = N - hRank + 1;
    let heatText;
    if (!s.heatGames) heatText = 'Too early to tell whether opponents ran hot against you';
    else if (roundTo(s.heatPerGame, 1) > 0) heatText = `Opponents averaged +${fmtPts(s.heatPerGame)} pts above their norm against you (${rankMost(hRank, N)})`;
    else if (roundTo(s.heatPerGame, 1) < 0) heatText = `Opponents averaged ${fmtPts(-s.heatPerGame)} pts below their norm against you (${coldRank === 1 ? 'coldest in the league' : `${ordinal(coldRank)} coldest`})`;
    else heatText = 'Opponents played right to their averages against you';
    add('oppHeat', z.oppHeat.get(id), heatText);

    if (s.seasonHighs >= 1 && z.seasonHighs.get(id) > EPS) {
      add('seasonHighs', z.seasonHighs.get(id), `${s.seasonHighs} ${plural(s.seasonHighs, 'opponent')} posted their season high against you`);
    }

    if (hasPlayerData) {
      const inj = s.injuries;
      const iRank = injRank.get(id);
      const injText = inj.gamesMissed && Math.round(inj.pointsLost) > 0
        ? `Injuries cost you ~${Math.round(inj.pointsLost)} pts over ${inj.gamesMissed} missed ${plural(inj.gamesMissed, 'game')} (${rankMost(iRank, N, 'fewest')})`
        : 'Your key players stayed on the field all season';
      add('injuries', z.injuries.get(id), injText);

      const net = s.slumps.net;
      const slRank = slumpRank.get(id);
      let slText;
      const form = slumpMode === 'loo' ? 'their season averages' : 'their recent form';
      // 'prior' nets run negative league-wide (hot players get started, then cool off),
      // so compare against the typical team, not against zero.
      const vsAvg = Math.round(net - teamIds.reduce((sum, t) => sum + get(t).slumps.net, 0) / N);
      const vsText = vsAvg < 0 ? `, ${-vsAvg} more than a typical team` : vsAvg > 0 ? `, ${vsAvg} fewer than a typical team` : '';
      if (Math.round(net) < 0) slText = `Your starters scored ${Math.round(-net)} pts below ${form}${vsText} (${rankMost(slRank, N, 'least')})`;
      else if (Math.round(net) > 0) slText = `Your starters scored ${Math.round(net)} pts above ${form} (${rankMost(N - slRank + 1, N, 'least')})`;
      else slText = `Your starters played right to ${form}`;
      add('slumps', z.slumps.get(id), slText);

      const perWeek = s.weeksPlayed ? s.bench / s.weeksPlayed : 0;
      const eRank = effRank.get(id);
      const effNote = eRank === 1 ? 'best in the league' : eRank === N ? 'worst in the league' : `${ordinal(eRank)} of ${N}`;
      const benchText = roundTo(perWeek, 1) > 0
        ? `You left ${fmtPts(perWeek)} pts/week on your bench (${effNote})`
        : 'You set a perfect lineup every single week';
      add('bench', z.efficiency.get(id), benchText);
    }

    const sorted = [...cands].sort((a, b) => (Math.abs(a.mag - b.mag) > EPS ? b.mag - a.mag : a.order - b.order));
    const picks = sorted.slice(0, 3);
    if (!picks.some((p) => p.key === 'schedule')) picks.push(sorted.find((p) => p.key === 'schedule'));
    return { code, title: meta.title, emoji: meta.emoji, headline: headlineFor(code, v), reasons: picks.map((p) => p.text) };
  };

  // ── assemble ──
  const tileFor = (wr) => {
    if (!wr || wr.result === null) return 'bye';
    if (wr.result === 'T') return 'tie';
    const beatHalf = wr.apW + 0.5 * wr.apT >= wr.opponents / 2 - EPS;
    if (wr.result === 'W') return beatHalf ? 'earned' : 'stole';
    return beatHalf ? 'robbed' : 'deserved';
  };

  const teamReports = teamIds.map((id) => {
    const t = teamById.get(id);
    const s = get(id);
    const expW = roundTo(s.expW, 1);
    const weeksOut = weekNums.map((wk) => {
      const wr = s.weekMap.get(wk);
      if (!wr) {
        return {
          week: wk, opponentId: null, opponentName: null, points: 0, oppPoints: null, result: null,
          allPlayWins: 0, allPlayLosses: 0, tile: 'bye', oppAvg: null, oppSeasonHigh: false, optimal: null,
        };
      }
      return {
        week: wk,
        opponentId: wr.opponentId,
        opponentName: wr.opponentId === null ? null : teamById.get(wr.opponentId).name,
        points: roundTo(wr.points, 2),
        oppPoints: wr.oppPoints === null ? null : roundTo(wr.oppPoints, 2),
        result: wr.result,
        allPlayWins: wr.apW,
        allPlayLosses: wr.apL,
        tile: tileFor(wr),
        oppAvg: wr.oppAvg === null ? null : roundTo(wr.oppAvg, 1),
        oppSeasonHigh: wr.oppSeasonHigh,
        optimal: hasPlayerData ? roundTo(wr.optimal, 1) : null,
      };
    });
    const slumpCase = (d) => ({ playerId: d.playerId, name: d.name, week: d.week, points: roundTo(d.points, 2), expected: roundTo(d.expected, 1) });
    return {
      teamId: id,
      name: t.name,
      managerName: t.managerName,
      avatar: t.avatar,
      record: { ...s.record },
      h2hRecord: { wins: s.h2h.w, losses: s.h2h.l, ties: s.h2h.t },
      allPlay: { wins: s.ap.w, losses: s.ap.l, ties: s.ap.t, pct: roundTo(s.apPct, 3) },
      expected: { wins: expW, losses: roundTo(s.games - expW, 1) },
      pointsFor: roundTo(s.pf, 1),
      pointsAgainst: roundTo(s.pa, 1),
      strengthRank: strengthRank.get(id),
      recordRank: recordRank.get(id),
      luck: {
        winsAboveExpected: roundTo(s.wae, 1),
        scheduleRank: scheduleRank.get(id),
        oppHeat: { total: roundTo(s.heatTotal, 1), perGame: roundTo(s.heatPerGame, 1), rank: heatRank.get(id), seasonHighsAgainst: s.seasonHighs },
        injuries: hasPlayerData
          ? {
            pointsLost: roundTo(s.injuries.pointsLost, 1),
            gamesMissed: s.injuries.gamesMissed,
            rank: injRank.get(id),
            cases: s.injuries.cases.slice(0, 5).map((c) => ({ playerId: c.playerId, name: c.name, week: c.week, expected: roundTo(c.expected, 1) })),
          }
          : null,
        slumps: hasPlayerData
          ? { net: roundTo(s.slumps.net, 1), rank: slumpRank.get(id), worst: s.slumps.worst.map(slumpCase), best: s.slumps.best.map(slumpCase) }
          : null,
        composite: { score: roundTo(s.composite, 2), rank: compositeRank.get(id) },
      },
      skill: hasPlayerData
        ? { optimalPoints: roundTo(s.optimal, 1), efficiency: roundTo(s.efficiency, 3), benchPointsLeft: roundTo(s.bench, 1), efficiencyRank: effRank.get(id) }
        : null,
      verdict: buildVerdict(id),
      weeks: weeksOut,
    };
  });

  teamReports.sort((a, b) => cmpAsc(get(a.teamId).composite, get(b.teamId).composite) || a.teamId - b.teamId);

  const avgOf = (fn) => mean(teamIds.map((id) => fn(get(id))));
  return {
    league: {
      id: lg.id == null ? '' : String(lg.id),
      name: typeof lg.name === 'string' ? lg.name : '',
      season: lg.season == null ? '' : String(lg.season),
      platform: typeof lg.platform === 'string' ? lg.platform : 'sleeper',
      teamCount: N,
      weeksAnalyzed: weekNums,
    },
    teams: teamReports,
    leagueAverages: {
      pointsFor: roundTo(avgOf((s) => s.pf), 1),
      oppHeatPerGame: roundTo(avgOf((s) => s.heatPerGame), 1),
      injuryPointsLost: hasPlayerData ? roundTo(avgOf((s) => s.injuries.pointsLost), 1) : null,
      slumpNet: hasPlayerData ? roundTo(avgOf((s) => s.slumps.net), 1) : null,
      efficiency: hasPlayerData ? roundTo(avgOf((s) => s.efficiency), 3) : null,
    },
    hasPlayerData,
  };
}
