import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  analyzeLeague,
  classifyVerdict,
  ordinal,
  roundTo,
  median,
  zScores,
  plural,
  article,
  playerBaseline,
  activeMean,
  optimalLineup,
  inferByeWeeks,
  percentile,
  VERDICTS,
} from '../js/analysis.js';
import { generateDemoLeague, DEMO_YOUR_TEAM_ID } from '../js/demo.js';

// ─── builders ────────────────────────────────────────────────────────────────────────────────

const STD = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN'];

function league({ teams = 4, weeks, players = {}, medianGame = false, rosterPositions = STD, byeWeeks } = {}) {
  const data = {
    league: { id: 'L', name: 'Test', season: '2026', platform: 'sleeper', rosterPositions, medianGame, playoffWeekStart: 15 },
    teams: Array.from({ length: teams }, (_, i) => ({ teamId: i + 1, ownerId: `u${i + 1}`, name: `T${i + 1}`, managerName: `M${i + 1}`, avatar: null })),
    weeks,
    players,
  };
  if (byeWeeks) data.byeWeeks = byeWeeks;
  return data;
}

/** m(teamId, matchupId, points, starters?, startersPoints?, playerPoints?) */
function m(teamId, matchupId, points, starters = [], startersPoints = [], playerPoints = {}) {
  return { teamId, matchupId, points, starters, startersPoints, playerPoints };
}

/** Simple week where team i's points are pts[i-1] and pairs = [[a,b], ...]. */
function wk(week, pts, pairs) {
  const mid = new Map();
  pairs.forEach(([a, b], i) => { mid.set(a, i + 1); mid.set(b, i + 1); });
  return { week, matchups: pts.map((p, i) => m(i + 1, mid.has(i + 1) ? mid.get(i + 1) : null, p)) };
}

const byId = (report, id) => report.teams.find((t) => t.teamId === id);

/** Collects paths of any non-finite number anywhere in a value. */
function badNumbers(value, path = '$', out = []) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) out.push(path);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => badNumbers(v, `${path}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) badNumbers(v, `${path}.${k}`, out);
  }
  return out;
}

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

// ─── helpers ─────────────────────────────────────────────────────────────────────────────────

describe('helpers', () => {
  test('ordinal', () => {
    const cases = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 10: '10th', 11: '11th', 12: '12th', 13: '13th', 21: '21st', 22: '22nd', 23: '23rd', 101: '101st', 111: '111th', 112: '112th' };
    for (const [n, s] of Object.entries(cases)) assert.equal(ordinal(Number(n)), s);
  });

  test('roundTo rounds half away from zero, never -0 or NaN', () => {
    assert.equal(roundTo(-0.75, 1), -0.8);
    assert.equal(roundTo(0.75, 1), 0.8);
    assert.equal(roundTo(1.35, 1), 1.4);
    assert.equal(Object.is(roundTo(-0.04, 1), -0), false);
    assert.equal(roundTo(NaN, 1), 0);
    assert.equal(roundTo(Infinity, 2), 0);
    assert.equal(roundTo(2 / 3, 3), 0.667);
  });

  test('median, zScores, plural, article', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(median([]), 0);
    assert.deepEqual(zScores([5, 5, 5]), [0, 0, 0]);
    const z = zScores([1, 2, 3]);
    close(z[0], -Math.sqrt(1.5));
    close(z[1], 0);
    assert.equal(plural(1, 'win'), 'win');
    assert.equal(plural(2, 'win'), 'wins');
    assert.equal(plural(0.5, 'win'), 'wins');
    assert.equal(plural(1, 'opponent'), 'opponent');
    assert.equal(article('8.2-1.8'), 'an');
    assert.equal(article('11.5-2.5'), 'an');
    assert.equal(article('18-0'), 'an');
    assert.equal(article('5.6-1.4'), 'a');
    assert.equal(article('1.2-5.8'), 'a');
  });

  test('verdict matrix boundaries (inclusive at ±0.75 and 0.5)', () => {
    assert.equal(classifyVerdict(0.5, -0.75), 'ROBBED');
    assert.equal(classifyVerdict(0.5, -0.7499), 'LEGIT');
    assert.equal(classifyVerdict(0.5, 0.7499), 'LEGIT');
    assert.equal(classifyVerdict(0.5, 0.75), 'COOKING');
    assert.equal(classifyVerdict(0.4999, -0.75), 'CURSED');
    assert.equal(classifyVerdict(0.4999, 0), 'BAD');
    assert.equal(classifyVerdict(0.4999, 0.75), 'FRAUD');
    assert.equal(classifyVerdict(0.9, -3), 'ROBBED');
    assert.equal(classifyVerdict(0.1, 3), 'FRAUD');
    // floating-point noise at the boundary still lands on the inclusive side
    assert.equal(classifyVerdict(0.5 - 1e-12, -0.75 + 1e-12), 'ROBBED');
  });

  test('verdict emoji are old enough to render on Windows 10 / older Android (Emoji <= 12)', () => {
    assert.deepEqual(Object.fromEntries(Object.values(VERDICTS).map((v) => [v.code, v.emoji])), {
      ROBBED: '🚨', LEGIT: '💪', COOKING: '🔥', CURSED: '💀', BAD: '🗑️', FRAUD: '🤡',
    });
    // Emoji 12.0 started at U+1F971 (plus U+1FA70+ blocks); everything here predates it.
    for (const { emoji } of Object.values(VERDICTS)) {
      for (const ch of emoji) {
        const cp = ch.codePointAt(0);
        assert.ok(cp === 0xfe0f || (cp >= 0x1f300 && cp <= 0x1f92f), `U+${cp.toString(16)}`);
      }
    }
  });
});

// ─── records ─────────────────────────────────────────────────────────────────────────────────

describe('records, all-play, expected wins', () => {
  // Week 1: 1=100 2=90 3=80 4=70; 1v2, 3v4.  Week 2: 1=60 2=120 3=110 4=50; 1v3, 2v4.
  const data = league({ weeks: [wk(1, [100, 90, 80, 70], [[1, 2], [3, 4]]), wk(2, [60, 120, 110, 50], [[1, 3], [2, 4]])] });
  const r = analyzeLeague(data);

  test('H2H records', () => {
    assert.deepEqual(byId(r, 1).record, { wins: 1, losses: 1, ties: 0 });
    assert.deepEqual(byId(r, 2).record, { wins: 1, losses: 1, ties: 0 });
    assert.deepEqual(byId(r, 3).record, { wins: 2, losses: 0, ties: 0 });
    assert.deepEqual(byId(r, 4).record, { wins: 0, losses: 2, ties: 0 });
    assert.deepEqual(byId(r, 3).h2hRecord, byId(r, 3).record);
  });

  test('all-play', () => {
    assert.deepEqual(byId(r, 1).allPlay, { wins: 4, losses: 2, ties: 0, pct: 0.667 });
    assert.deepEqual(byId(r, 2).allPlay, { wins: 5, losses: 1, ties: 0, pct: 0.833 });
    assert.deepEqual(byId(r, 3).allPlay, { wins: 3, losses: 3, ties: 0, pct: 0.5 });
    assert.deepEqual(byId(r, 4).allPlay, { wins: 0, losses: 6, ties: 0, pct: 0 });
  });

  test('expected wins and wins above expected', () => {
    // team 1: 3/3 + 1/3 = 1.333; team 2: 2/3 + 3/3 = 1.667; team 3: 1/3 + 2/3 = 1; team 4: 0
    assert.deepEqual(byId(r, 1).expected, { wins: 1.3, losses: 0.7 });
    assert.deepEqual(byId(r, 2).expected, { wins: 1.7, losses: 0.3 });
    assert.deepEqual(byId(r, 3).expected, { wins: 1, losses: 1 });
    assert.deepEqual(byId(r, 4).expected, { wins: 0, losses: 2 });
    assert.equal(byId(r, 1).luck.winsAboveExpected, -0.3);
    assert.equal(byId(r, 2).luck.winsAboveExpected, -0.7);
    assert.equal(byId(r, 3).luck.winsAboveExpected, 1);
    assert.equal(byId(r, 2).luck.scheduleRank, 1); // -0.667 is the unluckiest
    assert.equal(byId(r, 3).luck.scheduleRank, 4);
  });

  test('ranks, verdict codes and sort order', () => {
    assert.equal(byId(r, 2).strengthRank, 1);
    assert.equal(byId(r, 1).strengthRank, 2);
    assert.equal(byId(r, 3).strengthRank, 3);
    assert.equal(byId(r, 3).recordRank, 1);
    // teams 1 and 2 are both 1-1; team 2 has more points (210 vs 160)
    assert.equal(byId(r, 2).recordRank, 2);
    assert.equal(byId(r, 1).recordRank, 3);
    assert.equal(byId(r, 1).verdict.code, 'LEGIT');
    assert.equal(byId(r, 2).verdict.code, 'LEGIT');
    assert.equal(byId(r, 3).verdict.code, 'COOKING');
    assert.equal(byId(r, 4).verdict.code, 'BAD');
    const scores = r.teams.map((t) => t.luck.composite.score);
    assert.deepEqual(scores, [...scores].sort((a, b) => a - b));
    assert.deepEqual(r.teams.map((t) => t.luck.composite.rank), [1, 2, 3, 4]);
    assert.equal(r.hasPlayerData, false);
  });

  test('opponent heat, season highs and weekly tiles', () => {
    // team 1 faced 2 (90 vs its other-week 120 => -30) and 3 (110 vs 80 => +30)
    const t1 = byId(r, 1);
    assert.deepEqual(t1.luck.oppHeat, { total: 0, perGame: 0, rank: t1.luck.oppHeat.rank, seasonHighsAgainst: 1 });
    assert.equal(t1.weeks[1].oppAvg, 80);
    assert.equal(t1.weeks[1].oppSeasonHigh, true);
    assert.equal(t1.weeks[0].oppSeasonHigh, false);
    // team 4 faced 3 (80 vs its other-week 110 => -30) and 2 (120 vs 90 => +30)
    assert.equal(byId(r, 4).luck.oppHeat.total, 0);
    // team 2 faced 1 (100 vs 60 => +40) and 4 (50 vs 70 => -20) => +20, the most heat
    assert.equal(byId(r, 2).luck.oppHeat.total, 20);
    assert.equal(byId(r, 2).luck.oppHeat.perGame, 10);
    assert.equal(byId(r, 2).luck.oppHeat.rank, 1);
    // tiles: team 1 W wk1 beating 3/3 => earned; L wk2 beating 1/3 => deserved
    assert.deepEqual(t1.weeks.map((w) => w.tile), ['earned', 'deserved']);
    // team 3 W wk1 beating 1/3 => stole
    assert.equal(byId(r, 3).weeks[0].tile, 'stole');
    // team 2 L wk1 beating 2/3 => robbed
    assert.equal(byId(r, 2).weeks[0].tile, 'robbed');
    assert.equal(t1.weeks[0].opponentName, 'T2');
    assert.equal(t1.weeks[0].allPlayWins, 3);
    assert.equal(t1.weeks[1].allPlayLosses, 2);
  });

  test('ties in H2H and all-play', () => {
    const rr = analyzeLeague(league({ weeks: [wk(1, [100, 100, 50, 50], [[1, 2], [3, 4]])] }));
    const t1 = byId(rr, 1);
    assert.deepEqual(t1.record, { wins: 0, losses: 0, ties: 1 });
    assert.deepEqual(t1.allPlay, { wins: 2, losses: 0, ties: 1, pct: 0.833 });
    assert.equal(t1.expected.wins, 0.8); // (2 + 0.5) / 3
    assert.equal(t1.luck.winsAboveExpected, -0.3); // 0.5 - 0.833
    assert.equal(t1.weeks[0].tile, 'tie');
    assert.equal(byId(rr, 3).allPlay.pct, 0.167);
  });

  test('median game adds one result per week to record only', () => {
    const rr = analyzeLeague(league({ medianGame: true, weeks: [wk(1, [100, 90, 80, 70], [[1, 2], [3, 4]])] }));
    // median = 85
    assert.deepEqual(byId(rr, 1).record, { wins: 2, losses: 0, ties: 0 });
    assert.deepEqual(byId(rr, 2).record, { wins: 1, losses: 1, ties: 0 });
    assert.deepEqual(byId(rr, 3).record, { wins: 1, losses: 1, ties: 0 });
    assert.deepEqual(byId(rr, 4).record, { wins: 0, losses: 2, ties: 0 });
    assert.deepEqual(byId(rr, 2).h2hRecord, { wins: 0, losses: 1, ties: 0 });
    // expected is H2H-only
    assert.deepEqual(byId(rr, 1).expected, { wins: 1, losses: 0 });
    assert.equal(byId(rr, 2).luck.winsAboveExpected, -0.7);
    // a team exactly at the median ties it
    const r2 = analyzeLeague(league({ teams: 3, medianGame: true, weeks: [wk(1, [100, 90, 80], [[1, 2]])] }));
    assert.deepEqual(byId(r2, 2).record, { wins: 0, losses: 1, ties: 1 });
  });

  test('matchupId null = no H2H game but still counts for all-play', () => {
    const rr = analyzeLeague(league({ weeks: [wk(1, [100, 90, 80, 70], [[1, 2]])] }));
    const t3 = byId(rr, 3);
    assert.deepEqual(t3.record, { wins: 0, losses: 0, ties: 0 });
    assert.deepEqual(t3.allPlay, { wins: 1, losses: 2, ties: 0, pct: 0.333 });
    assert.deepEqual(t3.expected, { wins: 0, losses: 0 });
    assert.equal(t3.weeks[0].tile, 'bye');
    assert.equal(t3.weeks[0].result, null);
    assert.equal(t3.weeks[0].opponentId, null);
    assert.equal(t3.weeks[0].points, 80);
    // a team absent from a week gets a bye tile too
    const r2 = analyzeLeague(league({ weeks: [{ week: 1, matchups: [m(1, 1, 100), m(2, 1, 90), m(3, 2, 80)] }] }));
    assert.deepEqual(byId(r2, 4).weeks, [{ week: 1, opponentId: null, opponentName: null, points: 0, oppPoints: null, result: null, allPlayWins: 0, allPlayLosses: 0, tile: 'bye', oppAvg: null, oppSeasonHigh: false, optimal: null }]);
    // matchupId shared by one team only (orphan) is not a game
    assert.equal(byId(r2, 3).weeks[0].result, null);
  });
});

// ─── player-level ────────────────────────────────────────────────────────────────────────────

describe('player baselines and slumps', () => {
  test('prior (default) baseline: active weeks strictly before, needs >= 2', () => {
    const pts = { 1: 10, 2: 20, 3: 0, 4: 30 };
    assert.equal(playerBaseline(pts, 1), null);
    assert.equal(playerBaseline(pts, 2), null); // only 1 prior active week
    assert.equal(playerBaseline(pts, 3), 15);
    assert.equal(playerBaseline(pts, 4), 15); // week 3's 0 is not active
    assert.equal(playerBaseline(pts, 5), 20);
    assert.equal(playerBaseline(pts, 4, 'prior'), 15);
    assert.equal(playerBaseline(new Map([[1, 10], [2, 20], [3, 30]]), 3), 15);
    assert.equal(activeMean(pts), 20);
    assert.equal(activeMean({ 1: 0 }), null);
  });

  test("'loo' baseline: other active weeks, needs >= 2", () => {
    const pts = { 1: 10, 2: 20, 3: 0, 4: 30 };
    assert.equal(playerBaseline(pts, 1, 'loo'), 25);
    assert.equal(playerBaseline(pts, 2, 'loo'), 20);
    assert.equal(playerBaseline(pts, 3, 'loo'), 20); // inactive week: mean of all active weeks
    assert.equal(playerBaseline(pts, 4, 'loo'), 15);
    assert.equal(playerBaseline({ 1: 10, 2: 20 }, 1, 'loo'), null);
    assert.equal(playerBaseline({ 1: 10, 2: 0, 3: 20 }, 3, 'loo'), null);
  });

  test('a fading star started every week: LOO nets exactly 0, prior does not', () => {
    // f1 scores 30, 30, 10, 10 and starts every week for team 1.
    const fp = { f1: { name: 'Fading Star', position: 'RB', fantasyPositions: ['RB'], team: 'AAA' }, g1: { name: 'Steady', position: 'RB', fantasyPositions: ['RB'], team: 'BBB' } };
    const f1 = [30, 30, 10, 10];
    const fw = f1.map((p, i) => ({ week: i + 1, matchups: [m(1, 1, p, ['f1'], [p], { f1: p }), m(2, 1, 15, ['g1'], [15], { g1: 15 })] }));
    const data = league({ teams: 2, weeks: fw, players: fp, rosterPositions: ['RB'] });
    const loo = byId(analyzeLeague(data, { slumpBaseline: 'loo' }), 1).luck.slumps;
    assert.equal(loo.net, 0);
    assert.equal(loo.worst.length, 2); // individual dud games still show up under LOO
    const prior = byId(analyzeLeague(data), 1).luck.slumps;
    // wk3: 10 vs prior mean(30, 30) = 30 => -20; wk4: 10 vs mean(30, 30, 10) = 23.33 => -13.33
    assert.equal(prior.net, -33.3);
    assert.deepEqual(prior.worst, [
      { playerId: 'f1', name: 'Fading Star', week: 3, points: 10, expected: 30 },
      { playerId: 'f1', name: 'Fading Star', week: 4, points: 10, expected: 23.3 },
    ]);
    assert.deepEqual(prior.best, []);
    assert.equal(prior.rank, 1);
    const reasons = byId(analyzeLeague(data), 1).verdict.reasons.join('\n');
    assert.match(reasons, /Your starters scored 33 pts below their recent form, 17 more than a typical team \(most in the league\)/);
  });

  // Team 1 starts p1 in weeks 1-2 and benches him in 3-4 (10, 20, 30, 40).
  // LOO: week 1 baseline = (20+30+40)/3 = 30 => -20. Week 2 = (10+30+40)/3 = 26.667 => -6.667.
  // Team 2 starts q1 every active week (5, 15, 0, 25) => LOO deltas sum to exactly 0;
  // prior: only week 4 has 2 prior active weeks => 25 vs mean(5, 15) = 10 => +15.
  const players = {
    p1: { name: 'Pat One', position: 'WR', fantasyPositions: ['WR'], team: 'AAA' },
    p2: { name: 'Pat Two', position: 'WR', fantasyPositions: ['WR'], team: 'AAA' },
    q1: { name: 'Quinn One', position: 'WR', fantasyPositions: ['WR'], team: 'BBB' },
    q2: { name: 'Quinn Two', position: 'WR', fantasyPositions: ['WR'], team: 'BBB' },
  };
  const p1 = [10, 20, 30, 40];
  const p2 = [12, 12, 12, 12];
  const q1 = [5, 15, 0, 25];
  const weeks = [1, 2, 3, 4].map((w) => {
    const i = w - 1;
    const t1Starter = w <= 2 ? 'p1' : 'p2';
    const t1Pts = w <= 2 ? p1[i] : p2[i];
    return {
      week: w,
      matchups: [
        m(1, 1, t1Pts, [t1Starter], [t1Pts], { p1: p1[i], p2: p2[i] }),
        m(2, 1, q1[i] + 1, ['q1'], [q1[i]], { q1: q1[i], q2: 1 }),
      ],
    };
  });
  const data = league({ teams: 2, weeks, players, rosterPositions: ['WR', 'BN'] });
  const r = analyzeLeague(data);
  const rLoo = analyzeLeague(data, { slumpBaseline: 'loo' });

  test('default (prior) slump net, worst/best lists and ranks', () => {
    const s1 = byId(r, 1).luck.slumps;
    assert.equal(s1.net, 0); // p1 never had 2 prior active weeks while started; p2 is flat
    assert.deepEqual(s1.worst, []);
    assert.equal(s1.rank, 1);
    const s2 = byId(r, 2).luck.slumps;
    assert.equal(s2.net, 15);
    assert.deepEqual(s2.best, [{ playerId: 'q1', name: 'Quinn One', week: 4, points: 25, expected: 10 }]);
    assert.deepEqual(s2.worst, []);
    assert.equal(s2.rank, 2);
    assert.equal(r.hasPlayerData, true);
    assert.equal(r.leagueAverages.slumpNet, 7.5);
  });

  test("'loo' option: slump net, worst/best lists and ranks", () => {
    const s1 = byId(rLoo, 1).luck.slumps;
    assert.equal(s1.net, -26.7);
    assert.deepEqual(s1.worst, [
      { playerId: 'p1', name: 'Pat One', week: 1, points: 10, expected: 30 },
      { playerId: 'p1', name: 'Pat One', week: 2, points: 20, expected: 26.7 },
    ]);
    assert.deepEqual(s1.best, []); // p2 has a flat 12 => deltas are 0
    assert.equal(s1.rank, 1);
    const s2 = byId(rLoo, 2).luck.slumps;
    assert.equal(s2.net, 0); // started every active week => LOO identity
    assert.equal(s2.rank, 2);
    assert.equal(s2.worst.length, 1); // q1 wk1: 5 vs 20
    assert.equal(s2.best.length, 1); // q1 wk4: 25 vs 10
    // explicit 'prior' equals the default
    assert.deepEqual(analyzeLeague(data, { slumpBaseline: 'prior' }), r);
  });

  test("a starter's 0 is not a slump", () => {
    // Team 2 started q1 in week 3 when he scored 0 (prior baseline 10). Counting it would make net 5.
    const s2 = byId(r, 2).luck.slumps;
    assert.equal(weeks[2].matchups[1].starters[0], 'q1');
    assert.equal(weeks[2].matchups[1].startersPoints[0], 0);
    assert.ok([...s2.worst, ...s2.best].every((c) => c.week !== 3));
    assert.equal(s2.net, 15);
  });
});

describe('injuries and byes', () => {
  // Team 1: star s1 (team AAA) starts weeks 1-3, scores 0 in week 4 (AAA plays) and week 5 (AAA bye).
  // Bench b1 (AAA) never starts and scores 0 in week 2 => not a key player.
  // Team 2 rostered a2 (AAA): his 0 in week 5 plus s1's 0 confirm AAA's week-5 bye by inference.
  const players = {
    s1: { name: 'Star One', position: 'RB', fantasyPositions: ['RB'], team: 'AAA' },
    b1: { name: 'Bench One', position: 'RB', fantasyPositions: ['RB'], team: 'AAA' },
    r1: { name: 'Repl One', position: 'RB', fantasyPositions: ['RB'], team: 'BBB' },
    a2: { name: 'Other Two', position: 'RB', fantasyPositions: ['RB'], team: 'AAA' },
    c2: { name: 'Core Two', position: 'RB', fantasyPositions: ['RB'], team: 'BBB' },
  };
  const s1 = [20, 10, 30, 0, 0];
  const b1 = [3, 0, 4, 5, 0];
  const r1 = [6, 7, 8, 9, 10];
  const a2 = [8, 9, 7, 6, 0];
  const c2 = [11, 12, 13, 14, 15];
  const weeks = [1, 2, 3, 4, 5].map((w) => {
    const i = w - 1;
    const t1s = w <= 3 ? 's1' : 'r1';
    const t1p = w <= 3 ? s1[i] : r1[i];
    return {
      week: w,
      matchups: [
        m(1, 1, t1p, [t1s], [t1p], { s1: s1[i], b1: b1[i], r1: r1[i] }),
        m(2, 1, c2[i], ['c2'], [c2[i]], { a2: a2[i], c2: c2[i] }),
      ],
    };
  });
  const data = league({ teams: 2, weeks, players, rosterPositions: ['RB', 'BN', 'BN'] });

  test('bye inference requires >= 2 rostered players, all at exactly 0', () => {
    assert.deepEqual(inferByeWeeks(data), { AAA: [5] });
    // with only s1 and a2 at 0 in week 5 but b1 scoring, it is not a bye
    const d2 = structuredClone(data);
    d2.weeks[4].matchups[0].playerPoints.b1 = 2;
    assert.deepEqual(inferByeWeeks(d2), {});
  });

  test('key player 0 on a non-bye week is a missed game, valued over replacement; bye excluded', () => {
    const inj = byId(analyzeLeague(data), 1).luck.injuries;
    assert.equal(inj.gamesMissed, 1);
    // RB active starter scores (10 samples): 9,10,10,11,12,13,14,15,20,30 => 25th pct = 10.25.
    // s1 active mean = (20+10+30)/3 = 20 => lost 9.75 (displays 9.8)
    assert.equal(inj.pointsLost, 9.8);
    assert.deepEqual(inj.cases, [{ playerId: 's1', name: 'Star One', week: 4, expected: 20, lost: 9.8 }]);
    assert.equal(inj.rank, 1);
    assert.equal(byId(analyzeLeague(data), 2).luck.injuries.gamesMissed, 0);
    assert.match(byId(analyzeLeague(data), 1).verdict.reasons.join('\n'), /Injuries cost you ~10 pts vs replacement over 1 missed game \(most in the league\)/);
  });

  test('explicit byeWeeks override inference', () => {
    const inj = byId(analyzeLeague({ ...data, byeWeeks: { AAA: 4 } }), 1).luck.injuries;
    assert.deepEqual(inj.cases.map((c) => c.week), [5]);
  });

  test('a one-week spot starter is no longer a key player', () => {
    // x1 scores 9 in week 1 (started), 0 in week 2: 1 start < 2 => not key.
    const d3 = structuredClone(data);
    d3.players.x1 = { name: 'Spot Starter', position: 'RB', fantasyPositions: ['RB'], team: 'BBB' };
    d3.weeks[0].matchups[0].starters = ['s1', 'x1'];
    d3.weeks[0].matchups[0].startersPoints = [20, 9];
    d3.weeks[0].matchups[0].playerPoints.x1 = 9;
    d3.weeks[1].matchups[0].playerPoints.x1 = 0;
    d3.league.rosterPositions = ['RB', 'RB', 'BN'];
    assert.ok(byId(analyzeLeague(d3), 1).luck.injuries.cases.every((c) => c.playerId !== 'x1'));
  });

  test('key-player rule: >= 2 starts AND >= 50% of active weeks AND mean >= 5; replacement fallback', () => {
    const wr = (name) => ({ name, position: 'WR', fantasyPositions: ['WR'], team: 'CCC' });
    const qb = (name) => ({ name, position: 'QB', fantasyPositions: ['QB'], team: 'DDD' });
    const kp = { k1: wr('Key'), half: wr('Half'), third: wr('Third'), low: wr('Low'), spot: wr('Spot'), q2: qb('QB Two'), q3: qb('QB Three') };
    const pts = {
      k1: [10, 12, 14, 16, 0], // starts wk1-4 => key, mean 13
      half: [6, 8, 10, 12, 0], // starts wk1-2 of 4 active weeks (exactly 50%) => key, mean 9
      third: [7, 7, 7, 7, 0], // starts wk1 + wk5 (at 0): 2 starts but 1 of 4 active (25%) => not key
      low: [3, 4, 3, 4, 0], // starts wk1-4 but mean 3.5 < 5 => not key
      spot: [9, 0, 0, 0, 0], // 1 start => not key
      q2: [20, 22, 24, 0, 0], // team 2 QB, starts wk1-3 => key, mean 22
      q3: [null, null, null, 15, 16], // picked up in week 4 (not rostered before)
    };
    const t1Starts = [['k1', 'half', 'third', 'low', 'spot'], ['k1', 'half', 'low'], ['k1', 'low'], ['k1', 'low'], ['third']];
    const t2Starts = [['q2'], ['q2'], ['q2'], ['q3'], ['q3']];
    const team = (ids, starters, w) => {
      const pp = Object.fromEntries(ids.filter((id) => pts[id][w] !== null).map((id) => [id, pts[id][w]]));
      const sp = starters.map((id) => pp[id]);
      return [starters, sp, pp, sp.reduce((a, b) => a + b, 0)];
    };
    const kw = [0, 1, 2, 3, 4].map((w) => {
      const [s1, sp1, pp1, p1] = team(['k1', 'half', 'third', 'low', 'spot'], t1Starts[w], w);
      const [s2, sp2, pp2, p2] = team(['q2', 'q3'], t2Starts[w], w);
      return { week: w + 1, matchups: [m(1, 1, p1, s1, sp1, pp1), m(2, 1, p2, s2, sp2, pp2)] };
    });
    // explicit byes so CCC's all-zero week 5 is not inferred as a bye
    const r = analyzeLeague(league({ teams: 2, weeks: kw, players: kp, rosterPositions: ['QB', 'WR', 'WR', 'BN'], byeWeeks: { ZZZ: 9 } }));
    const inj1 = byId(r, 1).luck.injuries;
    // WR active starter scores (12): 3,3,4,4,6,7,8,9,10,12,14,16 => 25th pct = 4
    assert.deepEqual(inj1.cases, [
      { playerId: 'k1', name: 'Key', week: 5, expected: 13, lost: 9 },
      { playerId: 'half', name: 'Half', week: 5, expected: 9, lost: 5 },
    ]);
    assert.equal(inj1.pointsLost, 14);
    assert.equal(inj1.gamesMissed, 2);
    // QB has only 5 active starter scores (< 8) => replacement 0 => lost = full mean
    const inj2 = byId(r, 2).luck.injuries;
    assert.deepEqual(inj2.cases, [
      { playerId: 'q2', name: 'QB Two', week: 4, expected: 22, lost: 22 },
      { playerId: 'q2', name: 'QB Two', week: 5, expected: 22, lost: 22 },
    ]);
    assert.equal(inj2.pointsLost, 44);
    assert.equal(inj2.rank, 1);
  });

  test('percentile helper (linear interpolation)', () => {
    assert.equal(percentile([9, 10, 10, 11, 12, 13, 14, 15, 20, 30], 0.25), 10.25);
    assert.equal(percentile([1, 2, 3, 4, 5], 0.25), 2);
    assert.equal(percentile([5], 0.25), 5);
    assert.equal(percentile([], 0.25), 0);
  });
});

describe('optimal lineup', () => {
  const players = {
    qb1: { name: 'QB1', position: 'QB', fantasyPositions: ['QB'], team: 'X' },
    qb2: { name: 'QB2', position: 'QB', fantasyPositions: ['QB'], team: 'X' },
    rb1: { name: 'RB1', position: 'RB', fantasyPositions: ['RB'], team: 'X' },
    rb2: { name: 'RB2', position: 'RB', fantasyPositions: ['RB'], team: 'X' },
    wr1: { name: 'WR1', position: 'WR', fantasyPositions: ['WR'], team: 'X' },
    wr2: { name: 'WR2', position: 'WR', fantasyPositions: ['WR'], team: 'X' },
    te1: { name: 'TE1', position: 'TE', fantasyPositions: ['TE'], team: 'X' },
    k1: { name: 'K1', position: 'K', fantasyPositions: [], team: 'X' }, // falls back to position
    neg: { name: 'NegDEF', position: 'DEF', fantasyPositions: ['DEF'], team: 'X' },
  };
  const pp = { qb1: 25, qb2: 22, rb1: 15, rb2: 4, wr1: 12, wr2: 9, te1: 7, k1: 8, neg: -3 };

  test('FLEX and SUPER_FLEX', () => {
    const { total, lineup } = optimalLineup(['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF', 'BN', 'IR', 'TAXI'], pp, players);
    // QB qb1 25, RB rb1 15, WR wr1 12, TE te1 7, K k1 8, DEF empty (negative), FLEX wr2 9, SUPER_FLEX qb2 22
    assert.equal(total, 25 + 15 + 12 + 7 + 8 + 9 + 22);
    assert.deepEqual(lineup.map((l) => l.playerId), ['qb1', 'rb1', 'wr1', 'te1', 'k1', null, 'wr2', 'qb2']);
  });

  test('flex order: WRRB_FLEX before REC_FLEX before FLEX', () => {
    const { lineup } = optimalLineup(['FLEX', 'REC_FLEX', 'WRRB_FLEX'], { rb1: 15, wr1: 12, te1: 7 }, players);
    assert.deepEqual(lineup.map((l) => [l.slot, l.playerId]), [['WRRB_FLEX', 'rb1'], ['REC_FLEX', 'wr1'], ['FLEX', 'te1']]);
  });

  test('skill block: optimal, efficiency, bench points and ranks', () => {
    // Team 1 starts qb2 (22) over qb1 (25); team 2 starts its best.
    const weeks = [{
      week: 1,
      matchups: [
        m(1, 1, 22, ['qb2'], [22], { qb1: 25, qb2: 22 }),
        m(2, 1, 15, ['rb1'], [15], { rb1: 15, rb2: 4 }),
      ],
    }];
    const r = analyzeLeague(league({ teams: 2, weeks, players, rosterPositions: ['SUPER_FLEX', 'BN'] }));
    assert.deepEqual(byId(r, 1).skill, { optimalPoints: 25, efficiency: 0.88, benchPointsLeft: 3, efficiencyRank: 2 });
    assert.deepEqual(byId(r, 2).skill, { optimalPoints: 15, efficiency: 1, benchPointsLeft: 0, efficiencyRank: 1 });
    assert.equal(byId(r, 1).weeks[0].optimal, 25);
    assert.equal(r.leagueAverages.efficiency, 0.94);
  });
});

// ─── modes and edge cases ────────────────────────────────────────────────────────────────────

describe('no player data and degenerate leagues', () => {
  test('players: {} => player-level fields null, composite from schedule + heat', () => {
    const demo = generateDemoLeague();
    const r = analyzeLeague({ ...demo, players: {} });
    assert.equal(r.hasPlayerData, false);
    for (const t of r.teams) {
      assert.equal(t.luck.injuries, null);
      assert.equal(t.luck.slumps, null);
      assert.equal(t.skill, null);
      assert.ok(t.weeks.every((w) => w.optimal === null));
      assert.ok(t.verdict.reasons.length >= 2 && t.verdict.reasons.length <= 4);
    }
    assert.equal(r.leagueAverages.injuryPointsLost, null);
    assert.equal(r.leagueAverages.slumpNet, null);
    assert.equal(r.leagueAverages.efficiency, null);
    assert.deepEqual(badNumbers(r), []);
    // records don't depend on player data
    const full = analyzeLeague(demo);
    assert.deepEqual(byId(r, 1).record, byId(full, 1).record);
    assert.deepEqual(byId(r, 1).expected, byId(full, 1).expected);
  });

  test('0 weeks, 1 team, all-zero weeks, garbage input never produce NaN', () => {
    const inputs = [
      league({ weeks: [] }),
      league({ teams: 1, weeks: [wk(1, [100], [])] }),
      league({ weeks: [wk(1, [0, 0, 0, 0], [[1, 2], [3, 4]])] }),
      league({ weeks: [wk(1, [100, 90, 80, 70], [[1, 2], [3, 4]]), wk(2, [0, 0, 0, 0], [[1, 3], [2, 4]])] }),
      league({ teams: 0, weeks: [] }),
      league({ weeks: [{ week: 1, matchups: [m(1, 1, 'abc'), m(2, 1, null), { teamId: 99, matchupId: 1, points: 5 }, null] }] }),
      {},
      null,
    ];
    for (const input of inputs) {
      const r = analyzeLeague(input);
      assert.deepEqual(badNumbers(r), [], JSON.stringify(input)?.slice(0, 80));
      for (const t of r.teams) {
        assert.ok(t.verdict.headline.length > 0);
        assert.ok(t.verdict.reasons.length >= 2 && t.verdict.reasons.length <= 4);
      }
    }
    // an all-zero week is treated as unplayed
    assert.deepEqual(analyzeLeague(inputs[3]).league.weeksAnalyzed, [1]);
    assert.deepEqual(analyzeLeague(inputs[2]).league.weeksAnalyzed, []);
    // one team: no opponents, everything neutral
    const one = analyzeLeague(inputs[1]).teams[0];
    assert.equal(one.allPlay.pct, 0.5);
    assert.equal(one.luck.composite.score, 0);
  });
});

// ─── copy ────────────────────────────────────────────────────────────────────────────────────

describe('verdict copy', () => {
  test('ROBBED headline uses strength vs record rank; BAD uses points rank', () => {
    // 4 teams, 3 weeks. Team 1 always 2nd-highest scorer but loses to the top scorer every week.
    const weeks = [
      wk(1, [110, 120, 80, 70], [[1, 2], [3, 4]]),
      wk(2, [110, 80, 120, 70], [[1, 3], [2, 4]]),
      wk(3, [110, 80, 70, 120], [[1, 4], [2, 3]]),
    ];
    const r = analyzeLeague(league({ weeks }));
    const t1 = byId(r, 1);
    assert.equal(t1.verdict.code, 'ROBBED');
    assert.equal(t1.strengthRank, 1);
    assert.equal(t1.recordRank, 4);
    assert.equal(t1.verdict.headline, "You're the best team in the league but sit 4th.");
    assert.equal(t1.verdict.title, 'ROBBED');
    assert.equal(t1.verdict.emoji, '🚨');
    assert.match(t1.verdict.reasons.join('\n'), /Your points deserved 2 wins, but you have 0 \(unluckiest in the league\)/);
    assert.match(t1.verdict.reasons.join('\n'), /3 opponents posted their season high against you/);
    assert.deepEqual(t1.weeks.map((w) => w.tile), ['robbed', 'robbed', 'robbed']);
  });

  test('copy is singular-aware', () => {
    // Team 1 plays team 2 twice; team 2's 120 in week 2 is its season high (the only one in the league).
    const weeks = [wk(1, [100, 90, 80, 70], [[1, 2], [3, 4]]), wk(2, [100, 120, 80, 70], [[1, 2], [3, 4]])];
    const r = analyzeLeague(league({ weeks }));
    const t1 = byId(r, 1);
    assert.equal(t1.luck.oppHeat.seasonHighsAgainst, 1);
    assert.ok(t1.verdict.reasons.includes('1 opponent posted their season high against you'));
    assert.ok(t1.verdict.reasons.includes('Your record is about what your points deserved: 1 win vs 1.7 expected'));
    const all = r.teams.flatMap((t) => [t.verdict.headline, ...t.verdict.reasons]).join('\n');
    assert.doesNotMatch(all, /\b1 opponents\b|\b1 games\b|\b1 wins\b|NaN|undefined|Infinity|null/);
  });
});

// ─── demo + fixtures ─────────────────────────────────────────────────────────────────────────

describe('demo league', () => {
  const demo = generateDemoLeague();
  const report = analyzeLeague(demo);

  test('full report with no NaN anywhere', () => {
    assert.deepEqual(badNumbers(report), []);
    assert.equal(report.hasPlayerData, true);
    assert.equal(report.teams.length, 12);
    assert.deepEqual(report.league.weeksAnalyzed, [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(report.league.platform, 'demo');
    for (const t of report.teams) {
      assert.equal(t.weeks.length, 7);
      assert.ok(['ROBBED', 'LEGIT', 'COOKING', 'CURSED', 'BAD', 'FRAUD'].includes(t.verdict.code));
      assert.ok(t.verdict.reasons.length >= 2 && t.verdict.reasons.length <= 4);
      assert.ok(t.skill.efficiency > 0 && t.skill.efficiency <= 1);
      assert.ok(t.skill.benchPointsLeft >= 0);
      close(t.expected.wins + t.expected.losses, t.h2hRecord.wins + t.h2hRecord.losses + t.h2hRecord.ties, 1e-6);
    }
    const ranks = (key) => report.teams.map(key).sort((a, b) => a - b);
    const oneToN = Array.from({ length: 12 }, (_, i) => i + 1);
    assert.deepEqual(ranks((t) => t.strengthRank), oneToN);
    assert.deepEqual(ranks((t) => t.recordRank), oneToN);
    assert.deepEqual(ranks((t) => t.luck.composite.rank), oneToN);
    assert.deepEqual(ranks((t) => t.skill.efficiencyRank), oneToN);
    assert.deepEqual(report.teams.map((t) => t.luck.composite.rank), oneToN);
  });

  test('your team (teamId 1) is ROBBED with injuries and opponent heat', () => {
    const me = byId(report, DEMO_YOUR_TEAM_ID);
    assert.equal(me.verdict.code, 'ROBBED');
    assert.ok(me.luck.winsAboveExpected <= -0.75);
    assert.ok(me.luck.injuries.gamesMissed >= 2);
    assert.ok(me.luck.oppHeat.total > 0);
    assert.ok(me.luck.slumps.net < 0, 'starters below their recent form');
    assert.ok(me.luck.slumps.rank <= 3);
    assert.ok(me.strengthRank < me.recordRank);
    assert.equal(me.luck.composite.rank, 1);
  });

  test('bye inference recovers the demo schedule', () => {
    assert.deepEqual(inferByeWeeks(demo), { ABQ: [5], BOI: [5], CHS: [6], DUL: [6], ELP: [7], FRS: [7] });
  });

  test('deterministic: two runs deep-equal, input not mutated', () => {
    const copy = structuredClone(demo);
    assert.deepEqual(analyzeLeague(generateDemoLeague()), report);
    analyzeLeague(demo);
    assert.deepEqual(demo, copy);
  });
});

const FIXTURES = ['sleeper-2025', 'sleeper-2026'];
for (const name of FIXTURES) {
  const path = fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url));
  test(`real fixture ${name} analyzes cleanly`, { skip: !existsSync(path) && 'fixture not present' }, () => {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const r = analyzeLeague(data);
    assert.deepEqual(badNumbers(r), []);
    assert.equal(r.teams.length, data.teams.length);
    assert.equal(r.hasPlayerData, Object.keys(data.players || {}).length > 0);
    const n = r.teams.length;
    for (const t of r.teams) {
      assert.ok(t.verdict.reasons.length >= 2 && t.verdict.reasons.length <= 4);
      assert.ok(t.strengthRank >= 1 && t.strengthRank <= n);
      const games = t.h2hRecord.wins + t.h2hRecord.losses + t.h2hRecord.ties;
      close(t.expected.wins + t.expected.losses, games, 1e-6);
      assert.equal(t.weeks.length, r.league.weeksAnalyzed.length);
    }
    // Opponent heat is a zero-sum leave-one-out measure when every week is H2H.
    assert.ok(Math.abs(r.leagueAverages.oppHeatPerGame) <= 0.1);
    // No-player-data mode on real data works too.
    assert.deepEqual(badNumbers(analyzeLeague({ ...data, players: {} })), []);
  });
}
