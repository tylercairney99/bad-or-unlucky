# Sleeper API notes

Owner: API Engineer. Verified live with curl/Node on **2026-10-30** (NFL state: season 2026, week 8, `regular`).
Docs: https://docs.sleeper.com. Base: `https://api.sleeper.app/v1`. No auth. Sleeper asks for < 1000 calls/min; no rate-limit headers are sent.

## CORS — static site can call Sleeper directly ✅

Every endpoint returns `access-control-allow-origin: *` for `Origin: https://example.github.io` (also on 404s).
Preflight (`OPTIONS`) returns 204 with `*`, but we never trigger one: `js/sleeper.js` sends plain GETs with no custom
headers and `credentials: 'omit'`.

## Documented endpoints used

| Endpoint | Notes |
|---|---|
| `GET /state/nfl` | `{season:"2026", week:8, season_type:"regular", previous_season, display_week, ...}`. `season_type` ∈ pre/regular/post/off. CDN-cached 60 s. |
| `GET /user/<username or user_id>` | Unknown user → **HTTP 200 with body `null`** (not 404). Response also has `email`/`phone`/`token` keys (null) — we read only `user_id, username, display_name, avatar`. |
| `GET /user/<user_id>/leagues/nfl/<season>` | Array (empty for unknown/future seasons). |
| `GET /league/<id>` | Unknown id → **404, body `null`**. Each season is a new league id; `previous_league_id` links back. |
| `GET /league/<id>/rosters` | `roster_id` (1..N) = our `teamId`; `owner_id` may be null (orphan); `co_owners` may be set. |
| `GET /league/<id>/users` | `display_name`, `metadata.team_name` (optional), `avatar` (id → `https://sleepercdn.com/avatars/thumbs/<id>`). `metadata.avatar` is a user-supplied URL — **ignored**. |
| `GET /league/<id>/matchups/<week>` | One entry per roster: `roster_id, matchup_id, points, custom_points, starters, starters_points, players, players_points`. Week 0 / 19 / pre-draft → `[]`. |
| `GET /players/nfl` | See below. Fetch ≤ once/day. |

## League settings that matter

- **Median league:** `settings.league_average_match === 1`. Sleeper's matchups do **not** include the median game — compute it.
- **`settings.playoff_week_start`:** first playoff week (usually 15; some 14/16). **`0` = no playoffs** (guillotine/some
  custom leagues) → we treat the whole NFL regular season (18 weeks since 2021) as regular season, `playoffWeekStart = 19`.
- `settings.start_week` (leagues can start after week 1), `settings.last_scored_leg` (last fully scored week; 7 in an
  in-season 2026 league, absent pre-draft) — not relied on, NFL state is used instead.
- `settings.type`: 0 redraft, 1 keeper, 2 dynasty, **3 guillotine**. `settings.best_ball: 1` = best ball (lineups auto-optimal).

## Matchup quirks

- `custom_points` = commissioner override; the key is always present, usually `null`. We use `custom_points ?? points`.
  If `points` is null we fall back to Σ`starters_points`. All numbers are coerced (null/NaN → 0, rounded to 2 dp).
- **Empty starter slot:** `"0"` in `starters` with `0` in `starters_points` (seen ~1 per few weeks in real leagues).
- **Team defenses** use the team abbreviation as player id (`"PHI"`).
- **`matchup_id: null`**: teams with no game that week — playoff weeks for eliminated teams; week 18 of a `pws=15` league is
  all-null. **Guillotine leagues give every team a unique `matchup_id`** (singletons). `sleeper.js` nulls any `matchupId`
  that doesn't pair exactly two teams, so H2H code can trust pairs.
- **Future weeks** return entries with `points: 0` (and placeholder matchup ids); the **in-progress week** has partial
  points. Hence: completed weeks = `start_week..playoff_week_start−1`, and for the current season only `< state.week`
  (`pre` → none; `post`/`off` → all). Weeks where every team scored 0 are dropped.

## Players DB (`/v1/players/nfl`)

- **14.7 MB uncompressed, 2.6 MB transferred** with gzip (`Content-Encoding: gzip`), 12,229 entries, ~1.5 s on a fast link.
- Entry has ~50 fields (incl. current `injury_status`, `team`). Slim map we keep (name/position/fantasyPositions/team):
  **~1.06 MB** → stored in IndexedDB (`bad-or-unlucky-sleeper` / `kv` / `players-nfl-v1`) with `savedAt`, 24 h TTL;
  stale copy is used if a refresh fails. Node/no-IndexedDB → in-memory only.
- DEF entries exist (`"PHI"`, `first_name:"Philadelphia"`, no `full_name`) → we name them `"PHI D/ST"`.
- **Use `fantasyPositions`, not `position`, for slot eligibility**: e.g. a two-way player has `position:"DB"`,
  `fantasy_positions:["DB","WR"]`. ~240 entries have no position (`"UNK"`, `fantasyPositions: []`).
- `team` is the player's **current** team, not his team in a past week (trades/cuts) — matters for bye inference.
  ~1–5% of a season's rostered players have `team: null` now (free agents/retired).

## Undocumented endpoints (CORS `*`, gzip; may change without notice)

| Endpoint | Result |
|---|---|
| `api.sleeper.app/v1/stats/nfl/regular/2025/5` | ✅ 200, 75 KB gz / 509 KB raw. Map `playerId → stats` incl. **`gp`** (1 = played) and `gms_active`, fantasy pts (`pts_ppr` etc). **No team / no player metadata.** Includes DEF as `"PHI"` and `"TEAM_PHI"`. Teams on bye (and their players) are absent. |
| `api.sleeper.com/stats/nfl/2025/5?season_type=regular&position[]=QB&...` | ✅ 200, 85 KB gz / 600 KB raw. Array of `{player_id, team, opponent, game_id, date, stats{gp,...}, player{name, position, injury_status...}}` — **historical team per game**. |
| `api.sleeper.com/schedule/nfl/regular/<season>` | ✅ 200, 3 KB gz. `[{week, home, away, status: complete/pre_game/…, game_id, date}]`, all 18 weeks (272 games). Bye = team absent from a week. |
| `api.sleeper.app/v1/projections/nfl/regular/2026/8` | ✅ 200, 93 KB gz (weekly projections). |

**Used:** only the schedule endpoint, **best-effort**, to fill the optional `LeagueData.byeWeeks` (team → bye week).
If it fails, `byeWeeks` is simply omitted. Weekly stats `gp` would let us tell "injured/inactive" (gp absent, team played)
from "bye" exactly — ~75 KB gz per week; not wired in (contract change needed).

## ESPN (note only)

`lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2025/segments/0/leagues/1` → **CORS enabled** (reflects the
`Origin`, `Allow-Credentials: true`); private league → **401** `AUTH_LEAGUE_NOT_VISIBLE`. So ESPN **public** leagues are
callable from a static site without cookies; private ones need `espn_s2`/`SWID` (out of scope, see D3).

## Test fixtures

Captured with `node scripts/capture-fixture.mjs --league <id> --out <file> [--season YYYY]` (league id passed on the
command line, never committed). Teams anonymized to `Team N` / `Manager N` / `uN`, avatars null; the script refuses to
write if any original name/id leaks. Player data (public NFL info) is kept, limited to referenced ids.

| File | League | Shape |
|---|---|---|
| `tests/fixtures/sleeper-2025.json` | Test League A — 2025, complete | 12 teams, weeks 1–14, no median, `playoffWeekStart` 15, 3 empty-slot starts, 292 players, byeWeeks 32 teams |
| `tests/fixtures/sleeper-2026.json` | Test League B — 2026, in progress | 12 teams, weeks 1–7, **median league**, `playoffWeekStart` 15, 1 empty-slot start, 262 players, byeWeeks 32 teams |

Both: standard redraft, `QB,RB,RB,WR,WR,TE,FLEX,FLEX,K,DEF` + bench, every `matchupId` pairs exactly two teams.
