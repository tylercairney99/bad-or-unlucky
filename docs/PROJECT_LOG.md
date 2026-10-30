# Project Log — Bad or Unlucky?

> Running record of decisions, changes, and the roadmap. Newest entries at the bottom of each section.
> Anyone (human or agent) picking this project up should read this file first, then `CONTRACT.md`.

## Mission

Answer one question for a fantasy football manager in under 10 seconds:
**"Is my team actually bad, or am I just unlucky?"**
Luck factors in scope (from the product owner): injuries to my players, opponents overachieving against me, and my players underachieving vs their own trend — all compared against the other managers in my league.
Feel: a modern "daily game" — one input, instant big reveal, Wordle-style shareable result.

## Team (org chart)

```
Product Owner (Tyler) ── reviews only items tagged MUST REVIEW
        │
Lead / Eng Manager (main Claude session)
  ├─ owns contracts, integration, code review, project log, deploy
  │
  ├─ Research squad
  │    ├─ Design Researcher    → docs/DESIGN_BRIEF.md
  │    └─ API Engineer          → js/sleeper.js, anonymized fixture, API notes
  │
  ├─ Build squad
  │    ├─ Analytics Engineer    → js/analysis.js, js/demo.js, tests
  │    └─ Frontend Engineer     → index.html, css/, js/app.js, js/share.js
  │
  └─ QA & Security Reviewer    → docs/QA_REPORT.md, bug list back to Lead
```

## Decisions (ADR-lite)

| # | Date | Decision | Why |
|---|---|---|---|
| D1 | 2026-10-30 | Name: **Bad or Unlucky?** | It *is* the user's question; funny, shareable, self-explanatory. |
| D2 | 2026-10-30 | Static site, vanilla ES modules, **no build step, no backend** | Ships today, hosts anywhere (GitHub Pages), nothing to keep running, no server to secure. |
| D3 | 2026-10-30 | **Sleeper first** (public, no-auth, CORS-enabled read API) | ESPN private leagues need the user's `espn_s2`/`SWID` cookies (credential-handling risk); Yahoo needs OAuth + a backend. Both deferred to roadmap. |
| D4 | 2026-10-30 | Luck model: **all-play expected wins** for schedule luck; **leave-one-out season averages** as each player's/opponent's "trend" baseline | All-play is the standard, explainable fantasy luck metric. Leave-one-out avoids a game grading itself and works early-season. |
| D5 | 2026-10-30 | 6-way verdict matrix (strength × luck): ROBBED / LEGIT / COOKING / CURSED / BAD / FRAUD | Gives a one-word answer like a daily game, uses fantasy slang people already share. |
| D6 | 2026-10-30 | Hash-based routing (`#/l/<leagueId>/<teamId>`) | Shareable deep links; the hash never reaches the web server, so no league ids in host logs. |
| D7 | 2026-10-30 | Commits use GitHub **noreply** email | Keeps the owner's personal email out of public git history. |
| D8 | 2026-10-30 | Progressive results: verdict from matchup data first, player-level stats when the (large) players DB arrives | "Quickly see results" — the players DB is several MB. |
| D10 | 2026-10-30 | Design brief accepted with Lead overrides: UI font **Barlow** (not Inter), display **Big Shoulders Display**, fonts **self-hosted** | Inter is the over-used default; self-hosting keeps visitors' IPs away from Google's font CDN ("no tracking"). |
| D11 | 2026-10-30 | Strict **CSP** via meta tag; no inline scripts/styles; theme bootstrap in `js/theme.js` | API-sourced names are attacker-controllable; CSP is a second wall behind `textContent`-only rendering. `connect-src` limited to Sleeper. |
| D12 | 2026-10-30 | Slump baseline = **prior-weeks average** ("recent form"), not leave-one-out | Analytics Engineer proved Σ(x − LOO mean) = 0 for any player started in every active week, so LOO slumps only measured start/sit timing. Prior-weeks average answers the owner's "underachieving vs trend" question. LOO kept as an option. |
| D13 | 2026-10-30 | Headline record uses **H2H only** (`h2hRecord` vs `expected`); median games shown as a secondary line | Expected wins are all-play based, which maps to H2H games; mixing in median games would inflate "luck". |
| D14 | 2026-10-30 | Injury loss = **value over replacement** (25th-pct starter score at the position) for **real starters only** (≥2 starts, started ≥50% of active weeks, mean ≥5 pts). A starter on IR all season still counts every week. | Gross points overstated losses 2–5× (backups with one spot start counted as "injured starters"). Losing a starter for the season is exactly the bad luck owners mean, so no cap. |
| D15 | 2026-10-30 | Verdict emoji limited to Emoji ≤ 12 (ROBBED 🚨, CURSED 💀) | 🫠/🪦 render as empty boxes on Windows 10 and older Android — bad in a share text. |
| D16 | 2026-10-30 | One luck ranking everywhere users see a rank: **wins above expected** (leaderboard, chips, share text). Composite (all factors) only orders the "why" bullets. | QA M2: the board was sorted by composite but displayed wins-above-expected, which read as a bug. The verdict itself is built on wins above expected, so that's the consistent axis. |
| D9 | 2026-10-30 | Hosting: **GitHub Pages** (`tylercairney99.github.io/bad-or-unlucky`), pending owner sign-in | claude.ai Artifact hosting was evaluated and rejected: its CSP blocks `fetch` to `api.sleeper.app`, so only demo mode would work. No gh/vercel/netlify CLI is installed or logged in; the browser pane and Chrome are not signed into GitHub. `git push` works via the stored credential manager, so the only missing step is creating the repo — the owner must sign in (Lead never enters passwords or extracts stored tokens). Flagged MUST REVIEW because the public URL/repo carry the owner's GitHub identity. |

## Change log

- 2026-10-30 — Project scaffolded (`docs/`, `js/`, `css/`, `tests/`). Contracts written (`CONTRACT.md`). Sleeper API reachable; NFL state = 2026 season, week 8 in progress → weeks 1–7 analyzable.
- 2026-10-30 — Owner approved GitHub Pages (MUST REVIEW resolved) and signed in. Lead created public repo `tylercairney99/bad-or-unlucky`, pushed scaffold, enabled Pages (branch `main`, root). Added `.nojekyll` (serve files as-is) and `.gitattributes` (LF endings).
- 2026-10-30 — Design Researcher delivered `DESIGN_BRIEF.md` (82-0 = viral NBA roster sim; Krillion = daily trivia "dive"; borrowed: one primary action per screen, result shape visible before it fills, one-word named result, inline how-to). Frontend Engineer started on the UI.
- 2026-10-30 — API Engineer delivered `js/sleeper.js`, `docs/API_NOTES.md`, `scripts/capture-fixture.mjs`, and two anonymized fixtures (Test League A: 2025, 12 teams × 14 wks; Test League B: 2026 median league, 12 × 7). Findings: Sleeper sends `Access-Control-Allow-Origin: *` (direct browser calls OK, no preflight); players DB is 14.7 MB raw / 2.6 MB gzipped → slimmed to ~1 MB in IndexedDB; Sleeper's schedule endpoint gives exact bye weeks (used best-effort). ESPN private leagues 401 without cookies (confirms D3). Lead audit: fixtures contain no real names, user ids, avatars, or league ids; capture script takes the league id as a CLI arg so it is never committed. CONTRACT §3 updated (season option, extra exports, notes).
- 2026-10-30 — Analytics Engineer delivered `js/analysis.js`, `js/demo.js`, 36 passing tests (incl. both real fixtures, no-NaN deep scans, determinism). Demo team 1 = ROBBED ("best team in the league but sit 6th"). Additive contract changes: `h2hRecord`, `analyzeLeague(data, {slumpBaseline})`, `DEMO_YOUR_TEAM_ID`. Test command is `node --test` (Node 22.11 rejects a bare directory arg). Lead decisions D12, D13; rework of slump default requested.
- 2026-10-30 — Slump default switched to prior-weeks "recent form" (38 tests green). Lead fix: since prior-form nets run negative league-wide (hot players get started, then regress), the slump reason now states the gap vs a typical team in the league, not vs zero. Sanity run on real fixtures: verdict spread across all 6 codes in both leagues; biggest real-world unlucky team was −2.7 wins vs expected.
- 2026-10-30 — Frontend Engineer delivered the UI (`index.html`, `404.html`, `css/`, 7 small JS modules, self-hosted fonts). Verified live: demo, league-ID path (A), direct link (B, median), progressive player load, 320–1440px, both themes, keyboard, reduced motion, CSP clean. Committed.
- 2026-10-30 — Usage limit paused QA + Analytics mid-task (~09:50–14:00 PT); both resumed, no work lost.
- 2026-10-30 — Injury estimate reworked (D14): 2025 fixture league average dropped from ~200 to 77 pts lost. Emoji swapped (D15). 41 tests green.
- 2026-10-30 — QA & Security Reviewer: **no Blocker/High; no security holes; no PII or real league ids in tree or history**; all commits use the noreply email. XSS (mocked hostile names), 21 malicious hash routes, CSP, storage, third-party hosts, API politeness all pass. One League A team hand-checked: record, expected wins, all 14 weekly all-play counts match. First load ≈160 KB; verdict ≈20 ms after team pick. QA fixed M1 (long names overflowing at 320px), L1–L3. Lead fixed M2 (D16), L5 (headline uses H2H record), L6 (third-person copy on a friend's page). Open Lows L4, L7–L11 moved to roadmap. See `QA_REPORT.md`.
- 2026-10-30 — **v1 deployed** to https://tylercairney99.github.io/bad-or-unlucky/ (Pages build ≈20 s after push). Live smoke test: demo → ROBBED; real 2026 league by id → team picker → verdict + 7 tiles + breakdown; players DB 1.4 s cold; zero console errors/CSP violations; all assets 200 with correct MIME types. Test storage cleared afterwards.

## Roadmap

- **v1 (today):** Sleeper username/league-id → league & team pick → verdict, weekly luck tiles, luck breakdown (schedule / opponent heat / injuries / slumps), lineup efficiency, league luck leaderboard, share text, demo league, deploy.
- **v1.1:** ESPN public leagues (CORS confirmed workable for public leagues), past-season compare, "roast a friend" share cards (PNG), `league.type`/`bestBall` flags (guillotine: hide H2H luck; best ball: hide lineup efficiency), exact injury-vs-inactive detection from Sleeper weekly stats `gp` (~75 KB/week). QA leftovers: reset 429 retry budget per route (L4), keep auto team pick on "Try 2025" (L7), 44px tiles at 375px (L8), `<bdi>` isolation for RTL names (L9).
- **v2:** Yahoo / ESPN private via small serverless proxy (needs security review: never store cookies/tokens), projection-based "expected" points, weekly email/notification of new luck.

## Open questions / risks

- Sleeper's players DB (`/v1/players/nfl`) is large; must cache in IndexedDB and load after first paint.
- Injury detection has no historical injury feed → inferred from "key player on roster scored 0 while his NFL team played" (byes inferred). Document as an estimate in the UI.
