#!/usr/bin/env node
// Capture an ANONYMIZED LeagueData fixture from a real Sleeper league, using js/sleeper.js.
//
//   node scripts/capture-fixture.mjs --league <leagueId> --out tests/fixtures/sleeper-2025.json \
//        [--season 2025] [--label "Test League A"] [--slug test-league-a]
//
// The real league id is passed on the command line on purpose: it is never written to the repo.
// Anonymization: team name → "Team N", managerName → "Manager N", ownerId → "uN", avatar → null,
// league.name → --label, league.id → --slug. Player names / NFL data are public and kept.
// The script refuses to write if any original name, user id, avatar id or league id leaks through.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { loadLeague, loadPlayers } = await import(pathToFileURL(resolve(root, 'js/sleeper.js')).href);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.league || !args.out) {
  console.error('usage: node scripts/capture-fixture.mjs --league <leagueId> --out <file.json> [--season YYYY] [--label "Test League A"] [--slug test-league-a]');
  process.exit(2);
}
const label = args.label || 'Test League A';
const slug = args.slug || 'test-league-a';

const t0 = Date.now();
const data = await loadLeague(args.league, {
  season: args.season,
  onProgress: ({ done, total, label: what }) => process.stderr.write(`\r  ${done}/${total} ${what}`.padEnd(40)),
});
process.stderr.write('\n');

// ── collect the secrets we must not leak (before anonymizing) ──
const secrets = new Set([String(data.league.id), String(args.league), data.league.name]);
for (const t of data.teams) {
  for (const v of [t.name, t.managerName, t.ownerId, t.avatar && t.avatar.split('/').pop()]) {
    if (v && !/^(Team|Manager) \d+$|^(Unknown|No) manager$/.test(v)) secrets.add(String(v));
  }
}

// ── anonymize ──
data.league.id = slug;
data.league.name = label;
data.teams = data.teams.map((t, i) => ({
  teamId: t.teamId,
  ownerId: t.ownerId ? `u${i + 1}` : null,
  name: `Team ${i + 1}`,
  managerName: `Manager ${i + 1}`,
  avatar: null,
}));

// ── players: only ids referenced in weeks ──
const ids = new Set();
for (const wk of data.weeks) {
  for (const m of wk.matchups) {
    for (const id of m.starters) if (id !== '0') ids.add(id);
    for (const id of Object.keys(m.playerPoints)) ids.add(id);
  }
}
data.players = await loadPlayers(ids);

// ── validate shape (CONTRACT §1) ──
const problems = validate(data);
if (problems.length) {
  console.error('Fixture failed validation:\n  ' + problems.slice(0, 20).join('\n  '));
  process.exit(1);
}

// ── leak check on everything except the public players map ──
const { players, ...nonPlayer } = data;
const haystack = JSON.stringify(nonPlayer).toLowerCase();
const leaks = [...secrets].filter((s) => s && s.length >= 3 && haystack.includes(s.toLowerCase()));
if (leaks.length) {
  console.error(`Refusing to write: ${leaks.length} original identifier(s) still present after anonymization.`);
  process.exit(1);
}

const outPath = resolve(root, args.out);
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(data, null, 1) + '\n');

const unknown = Object.values(players).filter((p) => p.position === 'UNK').length;
console.log(
  `wrote ${args.out}: season ${data.league.season}, ${data.teams.length} teams, weeks ${data.weeks[0].week}–${data.weeks.at(-1).week} ` +
    `(${data.weeks.length}), medianGame=${data.league.medianGame}, playoffWeekStart=${data.league.playoffWeekStart}, ` +
    `${Object.keys(players).length} players (${unknown} unknown), byeWeeks=${data.byeWeeks ? Object.keys(data.byeWeeks).length + ' teams' : 'none'}, ` +
    `${Date.now() - t0} ms`,
);

function validate(d) {
  const p = [];
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
  const L = d.league;
  if (!L || typeof L.id !== 'string' || typeof L.name !== 'string' || !/^\d{4}$/.test(L.season)) p.push('league header');
  if (L.platform !== 'sleeper') p.push('league.platform');
  if (!Array.isArray(L.rosterPositions) || !L.rosterPositions.every((x) => typeof x === 'string')) p.push('league.rosterPositions');
  if (typeof L.medianGame !== 'boolean') p.push('league.medianGame');
  if (!Number.isInteger(L.playoffWeekStart)) p.push('league.playoffWeekStart');
  const teamIds = new Set(d.teams.map((t) => t.teamId));
  if (teamIds.size !== d.teams.length || d.teams.length < 2) p.push('teams');
  for (const t of d.teams) {
    if (!Number.isInteger(t.teamId) || typeof t.name !== 'string' || typeof t.managerName !== 'string') p.push(`team ${t.teamId}`);
  }
  let prev = 0;
  for (const wk of d.weeks) {
    if (!Number.isInteger(wk.week) || wk.week <= prev || wk.week >= L.playoffWeekStart) p.push(`week order ${wk.week}`);
    prev = wk.week;
    const counts = new Map();
    for (const m of wk.matchups) {
      if (!teamIds.has(m.teamId)) p.push(`week ${wk.week}: unknown team ${m.teamId}`);
      if (m.matchupId !== null && !Number.isInteger(m.matchupId)) p.push(`week ${wk.week}: matchupId`);
      if (m.matchupId !== null) counts.set(m.matchupId, (counts.get(m.matchupId) || 0) + 1);
      if (!isNum(m.points)) p.push(`week ${wk.week} team ${m.teamId}: points`);
      if (m.starters.length !== m.startersPoints.length) p.push(`week ${wk.week} team ${m.teamId}: starters misaligned`);
      if (!m.startersPoints.every(isNum) || !Object.values(m.playerPoints).every(isNum)) p.push(`week ${wk.week} team ${m.teamId}: NaN`);
      for (const id of [...m.starters.filter((x) => x !== '0'), ...Object.keys(m.playerPoints)]) {
        if (!d.players[id]) p.push(`week ${wk.week}: player ${id} missing from players map`);
      }
    }
    for (const [mid, n] of counts) if (n !== 2) p.push(`week ${wk.week}: matchup ${mid} has ${n} teams`);
  }
  for (const [id, pl] of Object.entries(d.players)) {
    if (typeof pl.name !== 'string' || typeof pl.position !== 'string' || !Array.isArray(pl.fantasyPositions)) p.push(`player ${id}`);
  }
  if (d.byeWeeks && !Object.values(d.byeWeeks).every((w) => Number.isInteger(w))) p.push('byeWeeks');
  return p;
}
