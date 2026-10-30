# Module Contracts — Bad or Unlucky?

Owner: Lead (Eng Manager). Any change to this file must be logged in `PROJECT_LOG.md`.
All workers code against these shapes so modules can be built in parallel.

## Ground rules (all workers)

- **No build step.** Plain ES modules (`<script type="module">`), no npm runtime deps. Node 22 is used only for tests (`node --test tests/`).
- **Pure engine.** `js/analysis.js` never touches the DOM, network, or `Date.now()`. Same input → same output.
- **Untrusted text.** Team names, usernames, league names come from the API and are user-controlled. UI must render them with `textContent` / attribute setters only — never `innerHTML` with API data.
- **No secrets, no tracking, no backend.** Everything runs in the visitor's browser against Sleeper's public read-only API.
- **No real people's data committed.** Test fixtures captured from real leagues must have names/usernames/avatars/ids replaced with fakes.

## File ownership

| File | Owner |
|---|---|
| `js/sleeper.js` | API Engineer |
| `js/analysis.js`, `js/demo.js`, `tests/analysis.test.js` | Analytics Engineer |
| `index.html`, `css/styles.css`, `js/app.js`, `js/share.js` | Frontend Engineer |
| `docs/*`, `README.md`, deploy | Lead |

## 1. `LeagueData` — normalized input (sleeper.js → analysis.js, demo.js → analysis.js)

```js
/** @typedef {Object} LeagueData
 * @property {Object}  league
 * @property {string}  league.id
 * @property {string}  league.name
 * @property {string}  league.season            e.g. "2026"
 * @property {'sleeper'|'demo'} league.platform
 * @property {string[]} league.rosterPositions  Sleeper slot names incl. bench, e.g. ["QB","RB","RB","WR","WR","TE","FLEX","K","DEF","BN","BN",...]
 * @property {boolean} league.medianGame        true if league plays an extra game vs the weekly median (Sleeper settings.league_average_match === 1)
 * @property {number}  league.playoffWeekStart  first playoff week (regular season = weeks < this)
 * @property {Team[]}  teams
 * @property {Week[]}  weeks                    COMPLETED regular-season weeks only, ascending
 * @property {Object<string, Player>} players   every playerId referenced in weeks (may be {} until players DB loads)
 * @property {Object<string, number>} [byeWeeks] optional NFL team abbr → bye week
 */

/** @typedef {Object} Team
 * @property {number} teamId        Sleeper roster_id
 * @property {string|null} ownerId  Sleeper user_id
 * @property {string} name          team name (metadata.team_name) or manager display name fallback
 * @property {string} managerName   display_name
 * @property {string|null} avatar   full URL or null
 */

/** @typedef {Object} Week
 * @property {number} week
 * @property {Matchup[]} matchups   one entry per team that played; teams sharing matchupId faced each other
 */

/** @typedef {Object} Matchup
 * @property {number} teamId
 * @property {number|null} matchupId     null = no H2H opponent this week (skip for H2H)
 * @property {number} points             total points (custom_points if set, else points)
 * @property {string[]} starters         playerIds in lineup order; "0" = empty slot
 * @property {number[]} startersPoints   aligned with starters
 * @property {Object<string, number>} playerPoints  ALL rostered players' points this week (starters + bench)
 */

/** @typedef {Object} Player
 * @property {string} name
 * @property {string} position          primary position (QB/RB/WR/TE/K/DEF/DL/LB/DB)
 * @property {string[]} fantasyPositions positions eligible for slots
 * @property {string|null} team          NFL team abbr
 */
```

## 2. `analyzeLeague(data: LeagueData): Report` — analysis.js output

```js
/** @typedef {Object} Report
 * @property {Object} league            { id, name, season, platform, teamCount, weeksAnalyzed: number[] }
 * @property {TeamReport[]} teams       sorted by luck.composite.score ascending (unluckiest first)
 * @property {Object} leagueAverages    { pointsFor, oppHeatPerGame, injuryPointsLost, slumpNet, efficiency }
 * @property {boolean} hasPlayerData    false if players map was empty (injury/slump/efficiency fields are null)
 */

/** @typedef {Object} TeamReport
 * @property {number} teamId
 * @property {string} name
 * @property {string} managerName
 * @property {string|null} avatar
 * @property {{wins:number, losses:number, ties:number}} record          H2H (+ median games if medianGame)
 * @property {{wins:number, losses:number, ties:number, pct:number}} allPlay   vs every other team every week
 * @property {{wins:number, losses:number}} expected                       H2H expected record = Σ weekly all-play pct (1 decimal)
 * @property {number} pointsFor
 * @property {number} pointsAgainst
 * @property {number} strengthRank      1 = best all-play pct in league
 * @property {number} recordRank        1 = best actual record (tiebreak points for)
 * @property {Object} luck
 * @property {number} luck.winsAboveExpected          actual H2H wins − expected H2H wins (negative = unlucky)
 * @property {number} luck.scheduleRank               1 = unluckiest schedule
 * @property {{total:number, perGame:number, rank:number, seasonHighsAgainst:number}} luck.oppHeat
 *           opponents' points vs their own season average (leave-one-out) when facing you; rank 1 = faced the most heat
 * @property {{pointsLost:number, gamesMissed:number, rank:number, cases:{playerId,name,week,expected:number}[]}|null} luck.injuries
 *           rank 1 = most points lost to key players missing games
 * @property {{net:number, rank:number, worst:{playerId,name,week,points,expected}[], best:{...}[]}|null} luck.slumps
 *           Σ(starter points − that player's leave-one-out average); negative = your guys underperformed; rank 1 = worst
 * @property {{score:number, rank:number}} luck.composite   z-score blend, negative = unlucky; rank 1 = unluckiest
 * @property {Object|null} skill
 * @property {number} skill.optimalPoints     best possible lineup points, summed
 * @property {number} skill.efficiency        pointsFor / optimalPoints (0–1)
 * @property {number} skill.benchPointsLeft   optimalPoints − pointsFor
 * @property {number} skill.efficiencyRank    1 = best manager
 * @property {Verdict} verdict
 * @property {WeekResult[]} weeks
 */

/** @typedef {Object} Verdict
 * @property {'ROBBED'|'LEGIT'|'COOKING'|'CURSED'|'BAD'|'FRAUD'} code
 * @property {string} title     e.g. "ROBBED"
 * @property {string} emoji
 * @property {string} headline  one short sentence, e.g. "You're the 3rd-best team but sit 9th."
 * @property {string[]} reasons 2–4 short evidence bullets, biggest factor first
 *
 * Matrix: strength = allPlay.pct >= 0.5 ? strong : weak
 *         luck = winsAboveExpected >= +0.75 lucky | <= -0.75 unlucky | else fair
 *   strong+unlucky ROBBED · strong+fair LEGIT · strong+lucky COOKING
 *   weak+unlucky   CURSED · weak+fair   BAD   · weak+lucky   FRAUD
 */

/** @typedef {Object} WeekResult
 * @property {number} week
 * @property {number|null} opponentId
 * @property {string|null} opponentName
 * @property {number} points
 * @property {number|null} oppPoints
 * @property {'W'|'L'|'T'|null} result
 * @property {number} allPlayWins     teams you'd have beaten this week
 * @property {number} allPlayLosses
 * @property {'earned'|'stole'|'robbed'|'deserved'|'tie'|'bye'} tile
 *           earned = W & beat ≥50% · stole = W & beat <50% · robbed = L & beat ≥50% · deserved = L & beat <50%
 * @property {number|null} oppAvg     opponent's leave-one-out average
 * @property {boolean} oppSeasonHigh  opponent's season-high came vs you
 * @property {number|null} optimal    best possible lineup this week (null w/o player data)
 */
```

## 3. `js/sleeper.js` — public API

```js
export async function getNflState()                          // → { season, week, seasonType }
export async function resolveUser(username)                  // → { userId, username, displayName, avatar } | throws NotFound
export async function getUserLeagues(userId, season)         // → [{ id, name, season, totalRosters, status, avatar }]
export async function loadLeague(leagueId, { onProgress, season })  // → LeagueData (players = {}), completed weeks only;
                                                             //   `season` walks previous_league_id back to that season;
                                                             //   fills `byeWeeks` best-effort from Sleeper's schedule endpoint
export async function loadPlayers(playerIds)                 // → Object<string, Player> (cached 24h in IndexedDB; unknown ids → fantasyPositions [])
export class SleeperError extends Error { /* .kind: 'not_found'|'network'|'rate_limit'|'no_games' */ }
export function looksLikeLeagueId(str)                       // 15–20 digits
export function completedWeeks(league, state)                // helper, exported for tests
export function byeWeeksFromSchedule(games)                  // helper, exported for tests
```

Notes (v1.0, from API Engineer):
- `playoffWeekStart` is **19** when Sleeper's setting is 0 (no playoffs, e.g. guillotine). Any matchup id that isn't an exact pair is nulled.
- Slot eligibility must use `fantasyPositions` (two-way players exist), not `position`.

## 4. `js/share.js`

`buildShareText(teamReport, report, url) → string` — Wordle-style:

```
Bad or Unlucky? 🏈 2026 · Wk 1–7
ROBBED 🫠
4-3 · should be 5.6-1.4
🟩🟨🟩🟥🟨🟩🟩
Luck rank: 2nd unluckiest of 12
<url>
```
Tiles: earned 🟩 · stole 🟪 · robbed 🟨 · deserved 🟥 · tie ⬜ · bye ⬛
