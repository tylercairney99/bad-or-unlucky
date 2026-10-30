/**
 * Bad or Unlucky? — deterministic demo league.
 *
 *   generateDemoLeague(seed = 2026) -> LeagueData   (docs/CONTRACT.md §1)
 *
 * Synthetic and obviously fake: fake fantasy teams, fake managers, fake players with pun
 * surnames, fake NFL franchises. Seeded PRNG (mulberry32), no Math.random, no Date.
 *
 * Shape of the league: 12 teams, 7 completed weeks, QB/RB/RB/WR/WR/TE/FLEX/K/DEF + 6 BN, 15
 * players per team. Managers start by projection (they bench known byes and known injuries), so
 * lineups look human, not optimal. A few key players get hurt (exactly 0 on non-bye weeks; the
 * first injured week is a "surprise" where he stays in the lineup). Six fake NFL teams are on bye
 * in weeks 5–7, and two teams leave a slot empty ("0") when their only K/DEF is on bye.
 *
 * Engineered story: team 1 ("your team") is one of the best-scoring teams but keeps getting
 * beaten by opponents posting big weeks against it, so its verdict comes out ROBBED. It also hits
 * all three of the product owner's luck factors: its star RB gets hurt, opponents overachieve
 * against it, and its core starters open hot then fade below their recent form (weeks 5–7).
 * `byeWeeks` is deliberately omitted so the engine's bye inference is exercised.
 */

export const DEMO_YOUR_TEAM_ID = 1;
export const DEMO_WEEKS = 7;

const ROSTER_POSITIONS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'];
const SLOTS = ROSTER_POSITIONS.filter((s) => s !== 'BN');
const FLEX_OK = ['RB', 'WR', 'TE'];

const TEAMS = [
  ['Bijan Mustard', 'Avery Quill'],
  ['Hail Mary Poppins', 'Jordan Pike'],
  ['Sack to the Future', 'Casey Thorn'],
  ['Punt Intended', 'Morgan Vale'],
  ['The Fumble Bees', 'Riley Marsh'],
  ['Fourth and Wrong', 'Quinn Harlow'],
  ['Waiver Wire Wizards', 'Drew Kestrel'],
  ['Turf Toe Truck', 'Sky Okonkwo'],
  ['Blitz Please', 'Rowan Bellamy'],
  ['Red Zone Rangers', 'Parker Lume'],
  ['Touchdown Turtles', 'Emerson Tate'],
  ['The Benchwarmers', 'Jules Navarro'],
];

// Fictional NFL franchises (abbreviations deliberately unlike real ones). 6 byes fall in weeks 5–7.
const NFL = [
  ['ABQ', 'Albuquerque Roadrunners', 5], ['BOI', 'Boise Spuds', 5],
  ['CHS', 'Charleston Herons', 6], ['DUL', 'Duluth Freighters', 6],
  ['ELP', 'El Paso Scorpions', 7], ['FRS', 'Fresno Figs', 7],
  ['HNL', 'Honolulu Breakers', 9], ['OMA', 'Omaha Stampede', 9],
  ['POR', 'Portland Lumberjacks', 10], ['RNO', 'Reno Jackpots', 10],
  ['SAV', 'Savannah Ghosts', 11], ['SPO', 'Spokane Sasquatch', 11],
  ['TUL', 'Tulsa Twisters', 12], ['ICT', 'Wichita Windmills', 12],
  ['ANC', 'Anchorage Moose', 14], ['BHM', 'Birmingham Furnaces', 14],
].map(([abbr, name, bye]) => ({ abbr, name, bye }));
const LATE_BYE = NFL.filter((t) => t.bye > DEMO_WEEKS);

const FIRST = ['Brock', 'Dax', 'Colt', 'Tre', 'Ace', 'Bo', 'Cash', 'Duke', 'Flash', 'Gage', 'Hunter', 'Jett',
  'Knox', 'Lance', 'Maverick', 'Nash', 'Ozzie', 'Rocco', 'Scooter', 'Tank', 'Zeke', 'Ty', 'Moose', 'Rex'];
const LAST = ['Thunderfoot', 'Quickstep', 'Strongbow', 'Fastbrook', 'Ironhands', 'Longstride', 'Catchwell',
  'Blitzwood', 'Goalsby', 'Hurdleman', 'Spiralton', 'Snapworth', 'Endzoner', 'Gridwell', 'Rushfield',
  'Passwater', 'Tacklebee', 'Scramblin', 'Yardsworth', 'Sidestep', 'Huddlesby', 'Fumbleroy', 'Crossbar',
  'Pylonski', 'Chainsworth', 'Turfington', 'Hashmark', 'Audibleton', 'Shotgunn', 'Redzonie'];

const PROFILE = { QB: [18, 6], RB: [12, 7], WR: [11, 7], TE: [8, 5], K: [8, 3], DEF: [7, 5] };
const DEPTH = { QB: [1.05, 0.8], RB: [1.3, 1.1, 0.9, 0.7], WR: [1.3, 1.15, 1.0, 0.85, 0.7], TE: [1.1, 0.75], K: [1], DEF: [1] };
const TEMPLATE = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

// Fixed injury story (teamId, position, depth index, weeks out, surprise = still started in week 1 of it).
const INJURIES = [
  { teamId: 1, pos: 'RB', depth: 0, weeks: [3, 4], surprise: true },
  { teamId: 1, pos: 'WR', depth: 1, weeks: [2], surprise: false },
  { teamId: 3, pos: 'QB', depth: 0, weeks: [5, 6, 7], surprise: true },
  { teamId: 5, pos: 'WR', depth: 0, weeks: [2], surprise: true },
  { teamId: 8, pos: 'TE', depth: 0, weeks: [4, 5], surprise: false },
  { teamId: 10, pos: 'RB', depth: 1, weeks: [6], surprise: true },
  { teamId: 12, pos: 'RB', depth: 0, weeks: [1, 2], surprise: true },
];
// Weeks where team 1's opponent is guaranteed a big week (if team 1 would otherwise have won).
const HEATER_WEEKS = [1, 2, 5, 7];
// Team 1's core starters open hot and then fade, so they fall below their recent form.
const FADE = { hot: [1, 2, 3], hotFactor: 1.3, cold: [5, 6, 7], coldFactor: 0.6, players: [['QB', 0], ['RB', 1], ['WR', 0], ['WR', 1], ['TE', 0]] };

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * @param {number} [seed=2026]
 * @returns {Object} LeagueData
 */
export function generateDemoLeague(seed = 2026) {
  const s = Number(seed);
  const rng = mulberry32(Number.isFinite(s) ? Math.trunc(s) : 2026);
  const gauss = () => {
    const u = rng() || 1e-12;
    const v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];
  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // ── names & franchises ──
  const names = shuffle(FIRST.flatMap((f) => LAST.map((l) => `${f} ${l}`)));
  let nameIdx = 0;
  // 12 DEFs: 10 late-bye franchises + 2 with in-window byes (those teams will leave DEF empty once).
  const earlyBye = NFL.filter((t) => t.bye <= DEMO_WEEKS);
  const defTeams = shuffle([...LATE_BYE, ...shuffle(earlyBye).slice(0, 2)]);

  // ── rosters ──
  const talent = TEAMS.map((_, i) => (i === 0 ? 1.12 : 0.9 + 0.15 * rng()));
  const players = {};
  const rosters = TEAMS.map(() => []); // [{ id, pos, depth, mean }]
  let nextId = 1001;
  TEAMS.forEach((_, ti) => {
    const teamId = ti + 1;
    for (const pos of TEMPLATE) {
      DEPTH[pos].forEach((depthFactor, depth) => {
        const [mu] = PROFILE[pos];
        const mean = Math.max(1.5, mu * depthFactor * talent[ti] * (1 + 0.1 * gauss()));
        let id;
        if (pos === 'DEF') {
          const fr = defTeams[ti];
          id = fr.abbr;
          players[id] = { name: `${fr.name} D/ST`, position: 'DEF', fantasyPositions: ['DEF'], team: fr.abbr };
        } else {
          id = String(nextId++);
          // Kickers come from late-bye franchises, except The Benchwarmers' (empty K slot on his bye).
          const fr = pos === 'K' ? (teamId === 12 ? earlyBye[2] : pick(LATE_BYE)) : pick(NFL);
          players[id] = { name: names[nameIdx++], position: pos, fantasyPositions: [pos], team: fr.abbr };
        }
        rosters[ti].push({ id, pos, depth, mean });
      });
    }
  });
  const byeOf = new Map(NFL.map((t) => [t.abbr, t.bye]));
  const injuryOf = new Map(); // id -> { weeks:Set, first }
  for (const inj of INJURIES) {
    const p = rosters[inj.teamId - 1].find((r) => r.pos === inj.pos && r.depth === inj.depth);
    injuryOf.set(p.id, { weeks: new Set(inj.weeks), first: inj.surprise ? Math.min(...inj.weeks) : null });
  }

  // ── weekly raw scores (every player draws every week so the stream is stable) ──
  const score = {}; // id -> [week1..]
  for (const roster of rosters) {
    for (const p of roster) {
      const [, sd] = PROFILE[p.pos];
      score[p.id] = [];
      for (let wk = 1; wk <= DEMO_WEEKS; wk++) {
        let pts = p.mean + 0.85 * sd * gauss();
        if (p.pos === 'DEF') pts = Math.max(-4, pts);
        else if (p.pos === 'K') pts = Math.max(1, pts);
        else pts = Math.max(0.4 + rng() * 1.6, pts);
        pts = round2(pts);
        if (pts === 0) pts = 1;
        if (byeOf.get(players[p.id].team) === wk || injuryOf.get(p.id)?.weeks.has(wk)) pts = 0;
        score[p.id].push(pts);
      }
    }
  }

  // ── lineups by projection ──
  const lineupFor = (roster, wk) => {
    const avail = roster
      .filter((p) => {
        if (byeOf.get(players[p.id].team) === wk) return false;
        const inj = injuryOf.get(p.id);
        return !(inj && inj.weeks.has(wk) && inj.first !== wk);
      })
      .sort((a, b) => b.mean - a.mean || (a.id < b.id ? -1 : 1));
    const used = new Set();
    const take = (ok) => {
      const p = avail.find((x) => !used.has(x.id) && ok.includes(x.pos));
      if (!p) return '0';
      used.add(p.id);
      return p.id;
    };
    const ded = SLOTS.map((slot) => (slot === 'FLEX' ? null : take([slot])));
    return ded.map((id, i) => (SLOTS[i] === 'FLEX' ? take(FLEX_OK) : id));
  };

  // ── schedule: circle method, team 1 fixed ──
  const ids = TEAMS.map((_, i) => i + 1);
  const pairsFor = (wk) => {
    const rot = [ids[0], ...ids.slice(1).map((_, i) => ids[1 + ((i + wk - 1) % (ids.length - 1))])];
    const out = [];
    for (let i = 0; i < rot.length / 2; i++) out.push([rot[i], rot[rot.length - 1 - i]]);
    return out;
  };

  const lineups = rosters.map((roster) => Array.from({ length: DEMO_WEEKS }, (_, i) => lineupFor(roster, i + 1)));

  // Team 1's core starters run hot early and fade late (only scores > 0 change; bye/injury 0s stay).
  for (const [pos, depth] of FADE.players) {
    const p = rosters[DEMO_YOUR_TEAM_ID - 1].find((r) => r.pos === pos && r.depth === depth);
    const pts = score[p.id];
    for (const [wks, f] of [[FADE.hot, FADE.hotFactor], [FADE.cold, FADE.coldFactor]]) {
      for (const wk of wks) if (pts[wk - 1] > 0) pts[wk - 1] = Math.max(0.3, round2(pts[wk - 1] * f));
    }
  }

  const weeks = [];
  for (let wk = 1; wk <= DEMO_WEEKS; wk++) {
    const byTeam = new Map();
    pairsFor(wk).forEach(([a, b], mi) => {
      for (const teamId of [a, b]) {
        const roster = rosters[teamId - 1];
        const starters = lineups[teamId - 1][wk - 1];
        const playerPoints = {};
        for (const p of roster) playerPoints[p.id] = score[p.id][wk - 1];
        byTeam.set(teamId, { teamId, matchupId: mi + 1, starters, playerPoints });
      }
    });

    // Team 1's opponent catches fire in the heater weeks.
    if (HEATER_WEEKS.includes(wk)) {
      const me = byTeam.get(DEMO_YOUR_TEAM_ID);
      const opp = [...byTeam.values()].find((m) => m.matchupId === me.matchupId && m.teamId !== me.teamId);
      const total = (m) => m.starters.reduce((t, id) => t + (id === '0' ? 0 : m.playerPoints[id]), 0);
      const mine = total(me);
      const theirs = total(opp);
      const live = opp.starters.filter((id) => id !== '0' && opp.playerPoints[id] > 0);
      const pos = live.reduce((t, id) => t + opp.playerPoints[id], 0);
      if (theirs <= mine && pos > 0) {
        const target = mine + 2 + rng() * 8;
        const factor = (target - (theirs - pos)) / pos;
        for (const id of live) opp.playerPoints[id] = round2(opp.playerPoints[id] * factor);
        const short = round2(mine + 0.5 - total(opp));
        if (short > 0) opp.playerPoints[live[0]] = round2(opp.playerPoints[live[0]] + short);
      }
    }

    const matchups = [...byTeam.values()]
      .sort((a, b) => a.teamId - b.teamId)
      .map((m) => {
        const startersPoints = m.starters.map((id) => (id === '0' ? 0 : m.playerPoints[id]));
        return {
          teamId: m.teamId,
          matchupId: m.matchupId,
          points: round2(startersPoints.reduce((t, x) => t + x, 0)),
          starters: m.starters,
          startersPoints,
          playerPoints: m.playerPoints,
        };
      });
    weeks.push({ week: wk, matchups });
  }

  return {
    league: {
      id: 'demo',
      name: 'The Demo Bowl',
      season: '2026',
      platform: 'demo',
      rosterPositions: [...ROSTER_POSITIONS],
      medianGame: false,
      playoffWeekStart: 15,
    },
    teams: TEAMS.map(([name, managerName], i) => ({
      teamId: i + 1,
      ownerId: `demo-user-${i + 1}`,
      name,
      managerName,
      avatar: null,
    })),
    weeks,
    players,
  };
}
