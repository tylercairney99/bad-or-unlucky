import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateDemoLeague, DEMO_YOUR_TEAM_ID } from '../js/demo.js';

test('demo LeagueData matches CONTRACT §1 shape', () => {
  const d = generateDemoLeague();
  assert.equal(d.league.id, 'demo');
  assert.equal(d.league.platform, 'demo');
  assert.equal(d.league.season, '2026');
  assert.equal(d.league.medianGame, false);
  assert.deepEqual(d.league.rosterPositions, ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN']);
  assert.equal(d.teams.length, 12);
  assert.equal(new Set(d.teams.map((t) => t.name)).size, 12);
  assert.equal(DEMO_YOUR_TEAM_ID, 1);
  assert.deepEqual(d.weeks.map((w) => w.week), [1, 2, 3, 4, 5, 6, 7]);

  for (const w of d.weeks) {
    assert.equal(w.matchups.length, 12);
    const byMid = new Map();
    for (const m of w.matchups) byMid.set(m.matchupId, (byMid.get(m.matchupId) || 0) + 1);
    assert.ok([...byMid.values()].every((c) => c === 2), `week ${w.week} pairs`);
    for (const m of w.matchups) {
      assert.equal(m.starters.length, 9);
      assert.equal(m.startersPoints.length, 9);
      assert.equal(Object.keys(m.playerPoints).length, 15);
      const sum = Math.round(m.startersPoints.reduce((a, b) => a + b, 0) * 100) / 100;
      assert.equal(m.points, sum);
      m.starters.forEach((id, i) => {
        if (id === '0') return assert.equal(m.startersPoints[i], 0);
        assert.equal(m.startersPoints[i], m.playerPoints[id]);
        assert.ok(d.players[id], `player ${id} defined`);
      });
    }
  }
  for (const p of Object.values(d.players)) {
    assert.ok(['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(p.position));
    assert.deepEqual(p.fantasyPositions, [p.position]);
    assert.equal(typeof p.team, 'string');
    assert.equal(typeof p.name, 'string');
  }
  // every player name is unique
  const names = Object.values(d.players).map((p) => p.name);
  assert.equal(new Set(names).size, names.length);
});

test('demo is seeded and never touches Math.random', () => {
  const original = Math.random;
  Math.random = () => { throw new Error('Math.random used'); };
  try {
    assert.deepEqual(generateDemoLeague(), generateDemoLeague(2026));
    assert.notDeepEqual(generateDemoLeague(1), generateDemoLeague(2));
    assert.doesNotThrow(() => generateDemoLeague('not a number'));
  } finally {
    Math.random = original;
  }
});

test('demo has injuries (key players at exactly 0 on non-bye weeks) and byes', () => {
  const d = generateDemoLeague();
  const zeros = d.weeks.flatMap((w) => w.matchups.flatMap((m) => Object.entries(m.playerPoints).filter(([, v]) => v === 0).map(([id]) => ({ id, week: w.week }))));
  const bye = { ABQ: 5, BOI: 5, CHS: 6, DUL: 6, ELP: 7, FRS: 7 };
  const injured = zeros.filter(({ id, week }) => bye[d.players[id].team] !== week);
  assert.ok(injured.length >= 8, `expected injuries, got ${injured.length}`);
  assert.ok(new Set(injured.map((z) => z.id)).size >= 6, 'several different injured players');
  assert.ok(zeros.length > injured.length, 'expected bye-week zeros');
  // at least one empty lineup slot somewhere (a K/DEF on bye with no backup)
  assert.ok(d.weeks.some((w) => w.matchups.some((m) => m.starters.includes('0'))));
});
