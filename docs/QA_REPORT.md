# QA & Security Report — Bad or Unlucky?

Reviewer: QA & Security Reviewer · 2026-10-30 · Scope: `index.html`, `404.html`, `css/`, `js/*` (except the injury-estimate logic in `js/analysis.js`, which is being reworked), repo + git history.
Test leagues are called **League A** (2025, completed, 12 teams × 14 weeks) and **League B** (2026, in season, median league). No real league ids, usernames, or team/league names appear in this file.

## Verdict

**No Blocker or High issues.** One Medium (layout) fixed; one Medium (leaderboard ordering) needs a product call from the Lead. Security posture is good: no HTML sinks, strict hash routing, tight CSP, only Sleeper hosts contacted, nothing sensitive stored, no PII or secrets in the repo or its history.

## Findings

| # | Sev | Finding | Repro | Status |
|---|---|---|---|---|
| M1 | Medium | A long unbroken API string (league or team name, e.g. 80+ chars with no spaces) widened the page past the viewport: on a 320px phone the page zoomed out to ~1066px. Affected: team picker and leaderboard (`.sub` line), result card (`.context-name` is `nowrap`), and the expanded luck rows (opponent name in `.cases`). Cause: single-column grids with an `auto` track size to the longest unbreakable word (`overflow-wrap: break-word` does not lower min-content). | Mock `/league/<id>` + `/users` with a long name; open the picker, a result, the board at 320px; expand every luck row. | **Fixed** (`css/styles.css`, 2 rules): `.landing, .picker, .result, .result-card, .board { grid-template-columns: minmax(0, 1fr) }` and `.cases li > span:first-child { min-width: 0; overflow-wrap: anywhere }`. Re-tested: scrollWidth = viewport on every screen at 320/375/768/1440. |
| M2 | Medium | Leaderboard order disagrees with the number it shows. Rows are in contract order (composite luck score) but display wins-above-expected, so League A reads e.g. #1 −2.0, #2 −2.1 … #5 +0.4, #6 −0.3, #8 +0.6 (the demo has #9 +0.8 above #10 +0.6). Users will read this as a bug, and the footnote says the number is "wins above or below what your points deserved". | `#/demo/board`, or League A's board. | **Fixed by Lead** (option b): Luck tab, chips and share-text rank all use `scheduleRank` (wins above expected). Verified on demo board: −2.8 → +2.0 monotonic. Original options: either (a) keep composite order and show the composite as the value (e.g. a "luck score" or the composite rank), or (b) sort the Luck tab by `luck.winsAboveExpected` ascending (tie → composite) and pick the "Most robbed" / "Luckiest" chips from the same order. Both are ~5 lines in `js/board.js` `paint()`. |
| L1 | Low | CSP `img-src` allowed `data:` but nothing uses data: images. | Read `index.html` CSP; grep `data:` in css/js. | **Fixed**: `img-src 'self' https://sleepercdn.com`. No CSP violations across demo, League A result/board/picker. |
| L2 | Low | Every reveal opened without a prior user gesture (shared deep link, back/forward) logged a Chrome console error: "Blocked call to navigator.vibrate because user hasn't tapped…". | Open `#/demo/7` in a fresh tab; read console. | **Fixed** (`js/result.js`): vibrate only when `navigator.userActivation.hasBeenActive` (or the API is absent). Console clean between markers afterwards. |
| L3 | Low | An HTTP 5xx / unreadable response from Sleeper showed "Can't reach Sleeper. Check your connection." (blames the user's network). | Mock `fetch` → 503 for `api.sleeper.app`, open a league id. | **Fixed** (`js/app.js`): when `err.status` is set → "Sleeper is having trouble right now. Try again in a minute."; true network failures keep the old text. Both verified. |
| L4 | Low | `rateRetries` resets only after a successful route, so a later 429 in the same session gets fewer (or zero) automatic retries. Request volume stays bounded either way. | Mock 429 twice on two different league ids. | Open. Suggest resetting `rateRetries = 0` at the start of `route()` unless the call came from the 3 s auto-retry timer (pass a flag). |
| L5 | Low | Median leagues: headline quotes the overall record incl. median games ("…your 11-3 record says so") while the big number shows the H2H record (5–2). Note under the numbers explains it, but the headline still mixes the two. | League B, any team. | **Fixed by Lead**: headline `rec` now uses the H2H record. |
| L6 | Low | Viewing a friend's team (from the leaderboard) still says "You went", "Should've gone", and "Share my result". | `#/demo/9`. | **Fixed by Lead**: "They went" / "Share this result" / third-person aria summary when `teamId !== ui.youId`. Verified on `#/demo/9`. Original note: when `teamId !== ui.youId`, use "They went"/"Share this result" (≈3 lines in `js/result.js`). |
| L7 | Low | Username path → league with no finished games → "Try 2025": the owner hint is lost, so the user gets the team picker instead of their own team; the error screen also pre-fills the league id rather than the username they typed. | Username with a pre-draft 2026 league; pick it; tap "Try 2025". | Open. Carry `ownerHints` over to the previous-season league key in `tryLastSeason`. |
| L8 | Low | Week tiles are 35×52px at 320px and 39×55px at 375px (brief asks for 44px at 375). Above the WCAG 2.2 AA 24px minimum. | Measure `.tile-btn`. | Accept / design call. |
| L9 | Low | A right-to-left override character (U+202E) in a team name reverses the text that follows it in the same string (the result context line "team · league", luck case rows). Cosmetic only; no markup injection. | Mock a team name starting with U+202E. | Open (optional): render names in their own `<bdi>`/`unicode-bidi: isolate` span. |
| L10 | Low | The page can be framed (meta CSP cannot set `frame-ancestors`; GitHub Pages cannot send headers). Nothing on the page is sensitive or state-changing. | n/a | Accepted risk. |
| L11 | Low | Where IndexedDB is unavailable (some private modes) the players DB (~2.6 MB gzipped) is downloaded on every page load, not once a day. | Disable `IDBFactory.open`; load a league. | Accepted (rare; still one request per load). |
| I1 | Info | Test fixtures keep real weekly scores/rosters (names, ids, avatars replaced). Re-identifying the source league would need a brute-force search of Sleeper. | `tests/fixtures/*.json` | Accepted. |
| I2 | Info | `docs/PROJECT_LOG.md` names the owner by first name; commit author name is a first name. Both sit next to the already-public GitHub handle. | grep | Owner's call; no action needed. |
| I3 | Info | `emoji()` reads canvas pixels to detect unsupported emoji. Tor Browser / Firefox `resistFingerprinting` may show a canvas-extraction prompt or randomize the result (code already falls back to showing the emoji). | n/a | Accepted. |

## Fixes applied by QA (uncommitted, ≤ 3 lines each)

1. `css/styles.css` — M1 grid/overflow rules (2 rules + comment).
2. `index.html` — L1 dropped `data:` from `img-src`.
3. `js/result.js` — L2 gate `navigator.vibrate` on user activation.
4. `js/app.js` — L3 distinct message for Sleeper-side HTTP errors.

`node --test`: **41/41 pass** after the fixes.

## Security & privacy checks (all pass)

- **XSS sinks**: no `innerHTML`, `insertAdjacentHTML`, `outerHTML`, `document.write`, `eval`, `new Function`, `on*` attributes, `srcdoc`, or string timers anywhere in `js/`. `h()` builds everything through `textContent`/`setAttribute`/CSSOM and throws on `innerHTML`. Every `href` is a `#/…` fragment built from validated ids or `encodeURIComponent(username)`; the only `src` is the avatar, gated by `safeAvatar()` (`https://sleepercdn.com/` prefix) on top of `sleeper.js`'s `[A-Za-z0-9]{1,64}` avatar-id check.
- **Live XSS test** (mocked Sleeper responses): league/team/display names `<img src=x onerror=alert(1)>`, `"><svg onload=alert(1)>`, `<script>alert(1)</script>`, U+202E, 300-char and emoji/ZWJ/flag names, avatar `javascript:alert(1)` and `../../evil`, `metadata.avatar` pointing at another host → rendered as text; `alert` never called; the only image loaded was from `sleepercdn.com`.
- **Hash routes** (21 cases): `#/u/<img…>` raw and percent-encoded, `#/l/123/../../`, `..%2F`, 5,000-char user and id, `%00`, malformed `%E0%A4%A`, unicode and full-width digits, `#/demo/1e3`, `#/demo/-1`, `#/javascript:alert(1)`, `#//evil.com`, extra segments, season `1999` → all redirected to `#/` without any API call. Valid-shape ids that don't exist give the "No Sleeper league with ID" message (text only).
- **CSP**: `index.html` has no `unsafe-inline`/`unsafe-eval`; `connect-src` is only the two Sleeper API hosts; `base-uri`/`form-action`/`object-src` locked. `404.html` (`default-src 'none'`) — recomputed SHA-256 of the inline script matches the allowlisted hash; loading `/404.html#/demo/4` redirected to `/#/demo/4` with no violation. The 404 redirect cannot become an open redirect (base is always `/` or `/<first-segment>/`; an empty segment yields an invalid `//#…` URL that the browser rejects).
- **Third-party requests**: hosts seen in Resource Timing over the whole session: the page origin, `api.sleeper.app`, `api.sleeper.com`, `sleepercdn.com`. Fonts are self-hosted; no analytics, no CDNs. Fetches use `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`; avatars use `referrerpolicy="no-referrer"`.
- **Storage**: localStorage `bou:theme`, `bou:user` (last username typed, for prefill), `bou:team:<leagueId>` (your team per league); sessionStorage `bou:seen:<league>:<team>` (reveal played); IndexedDB `bad-or-unlucky-sleeper/kv/players-nfl-v1` (slim public NFL players map, ~1.06 MB, 24 h TTL). Nothing sensitive. With `Storage.prototype` getters/setters throwing, theme toggle, landing, demo, and a real league all worked with zero errors; with IndexedDB disabled, players load from the network.
- **Secrets / PII**: tracked + untracked files and `git log -p --all` scanned: no tokens/keys, no `C:\Users…`/AppData paths, no emails except the GitHub noreply address and the Claude co-author trailer. Neither test league id appears anywhere. All member display names, team names, user ids, avatar ids, and league names of Leagues A and B (87 strings) were checked against the working tree and full history: **0 hits**. All 5 commits use the noreply address as author and committer; `user.email` is the noreply address.
- **API politeness**: concurrency 6, at most 2 attempts per request (bounded back-off), at most 3 automatic route retries on 429, players DB fetched at most once per 24 h per browser (IndexedDB), session cache dedupes in-flight requests. A League A load is 19 requests with no duplicates (verified by wrapping `fetch`).

## Functional QA (real browser, own tab)

- **Demo**: `#/demo` → ROBBED; tile tap shows "Wk 2 · Robbed loss vs … · their season high", `aria-pressed` updates; League → leaderboard with YOU row; tap a friend → their verdict; ← twice returns board → your result.
- **League A by id**: team picker (12 teams, sorted by record, no luck spoilers) → result → board. **League B by id**: median note shown ("Overall 11–3 · Includes median games"), weekly hook "Week 8 is live…" shown.
- **Username path** (one owner username from League A's public member list, used only in the browser and removed from storage afterwards): league picker with season chips, 5 leagues, in-season first; tapping an in-season league auto-selected the user's team (≈0.4 s to verdict). Unknown username → "No Sleeper user …" error, input marked invalid.
- **No finished games**: a real pre-draft 2026 league from that user's list → "No finished games yet this season" with "Try 2025" + "Demo"; "Try 2025" walked `previous_league_id` to the 2025 league's team picker.
- **Single-league auto path** (mocked user with one league) → straight to their own result.
- **Failures** (mocked `fetch`): offline → "Can't reach Sleeper" + Try again; 503 → new "having trouble" message; 429 → "Retrying…" ×3 then "Give it a minute".
- **Widths** 320 / 375 / 768 / 1440: no horizontal overflow on landing, demo result, demo board, League A picker/result/board (and the long-name mock after the M1 fix); share bar sticks to the bottom; stamps fit at 320 after the reveal.
- **Themes**: dark and light screenshots checked; toggle updates `aria-label` and both theme-color metas.
- **Reduced motion** (emulated via `matchMedia`): reveal skipped (`fade-in`), no scroll-in animation; CSS `prefers-reduced-motion` block present.
- **Keyboard**: tab order input → button → demo → footer → wordmark → theme → help; help sheet opens on Enter, Tab cycles Close ↔ Got it, Esc closes, focus returns to "?". Route changes move focus to the screen's h1.
- **Console**: clean apart from expected 404s from the invalid-id tests (and the vibrate message, now fixed).

## Numbers sanity — League A, one team, by hand from `/matchups/1..14`

| Metric | Hand calc | App |
|---|---|---|
| H2H record | 7–7 | 7–7 |
| All-play | 70–84 (.455) | weekly "beat N of 11" all 14 match |
| Expected H2H wins | 6.36 | 6.4–7.6 |
| Tiles | wins with < 6 of 11 beaten = stole; losses with ≥ 6 = robbed | identical for all 14 weeks |
| Verdict | weak (.455) + fair (+0.64) → BAD | BAD |

## Performance

- **First load** (landing): HTML 6 KB, CSS 30 KB, JS 10 modules ≈ 140 KB, fonts 4 × woff2 = 103 KB → ≈ 280 KB raw, **≈ 160 KB on the wire** with GitHub Pages gzip (text ≈ 57 KB gz + fonts). Display font is preloaded and fetched once.
- **League A (14 weeks, 19 requests)**: ≈ 0.2 s to load and normalize; ≈ 0.5–0.6 s from submit to team picker including the 250 ms loader delay; verdict renders ≈ 20 ms after the team tap; `analyzeLeague` ≈ 3 ms.
- **Players DB**: cold (no IndexedDB copy) ≈ 1.9 s extra for the injuries/slumps/efficiency sections (14.7 MB raw JSON); warm (IndexedDB) ≈ 10 ms. The verdict never waits for it (D8).
- Username → auto-picked team → verdict: ≈ 0.4 s with a warm players cache.
