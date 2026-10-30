# Design Brief — Bad or Unlucky?

Author: Design Researcher · 2026-10-30 · For: Lead + Frontend Engineer. Mobile-first (375px), content column `max-width: 520px`, centered on desktop. All contrast ratios below were computed (WCAG 2.x), not eyeballed.

## 1. Research: what 82-0 and Krillion actually are

Both exist and were inspected live in a browser on 2026-10-30 (screens) plus the sources listed. Neither is copied here; patterns only.

**82-0** (82-0.com) — a viral, fan-made NBA roster game (went viral June 2026). You spin a random team + decade, draft one player per spin into a 5-slot lineup, then a simulator outputs a season record (goal: a perfect 82-0). Note: it is **not** a once-a-day game; it is an endlessly replayable "one more try" loop (a separate site, 82-0-challenge.com, has a "Daily Run" — unclear if related; not verified). Free iOS app by Vaulty Studios. Observed on the live site:
- Portrait-only ("best played in portrait mode"); home = one huge PLAY button + a smaller MODE button, both bottom-third (thumb zone).
- Draft screen: "ROUND 1 / 5" with a 5-segment progress bar; two slot-machine reels (TEAM / ERA); a half-court graphic with **5 empty jerseys that fill as you go**; one full-width SPIN button pinned to the bottom.
- Dark navy ground, one saturated primary (orange), a second hue for the second reel (purple), skewed condensed display type. Result = a record plus a named tier (lottery / playoff / contender / dynasty).
- Results have unique shareable links. Reviewers complained that a UI overhaul *removed detail* from the results screen (aggregated stats, no sorting) — keep detail one tap away.
- Sources: https://www.82-0.com · https://hcho.substack.com/p/82-0-a-user-guide · https://kottke.org/26/06/0049075-can-you-go-82-0 · https://apps.apple.com/us/app/82-0-com/id6780195090

**Krillion** (krillion.io, "the daily dive") — a free daily trivia game: 7 prompts, 25 s each, same set for everyone, resets midnight ET; type one answer, rarer answers score 10–100 pts; each point = 10 m of "depth" (700 = trench floor = perfect). Guests can play, no account. Observed on the live site:
- Landing: wordmark + one-line tagline, pixel-art ocean with a depth scale, edition tag "DIVE #107", **one full-width bordered CTA at the very bottom ("BEGIN DESCENT")**, secondary modes as small text links in a row under it.
- "How to play" is an inline, collapsible block of **six ALL-CAPS one-liners** on the landing page itself — no modal, no tutorial.
- Voice does the branding ("obvious ones float", "no second chances", "blub!"); score is translated into a metaphor (depth) instead of a bare number.
- Sources: https://krillion.io · https://aiidelist.com/blog/krillion-game-guide-how-to-play-rare-answers.md

**Other daily games (shared patterns).** Wordle: color tiles + optional orange/blue color-blind mode, emoji-grid share credited for its virality, and WordleBot later added a **luck and skill rating** (our exact theme) — https://en.wikipedia.org/wiki/Wordle. Immaculate Grid: 3x3 grid, one guess per cell, a **rarity score** added later to reward clever answers — https://en.wikipedia.org/wiki/Immaculate_Grid. Roundups agree on: same puzzle for everyone, 1–2 minutes, feedback after each try (https://www.nodes-game.com/daily-puzzle-games, search-snippet level only). Not verified by fetch: NYT Connections (page 404), Poeltl (not researched), dles.gg (403) — nothing below depends on them.

**Patterns we borrow**
1. One primary action per screen, full-width, in the lower half (82-0 PLAY/SPIN, Krillion DESCENT).
2. The result's *shape* is on screen before it exists: empty tile slots that fill (82-0 jerseys; Wordle grid).
3. Result = one named word, not a table (82-0 "dynasty") -> our verdict.
4. How-to-play = 4–6 one-liners, not a manual (Krillion). Ours lives on the landing as a tile legend + a modal.
5. Voicey microcopy + a metaphor for the score (Krillion). Ours: "robbed / stole / deserved".
6. Shareable result link + "one more" loop (82-0): hash deep links (D6) and "Check another team".
7. Weekly refresh hook (our twist on Krillion's "new dive daily"): "Week 8 is live — numbers update after Monday Night Football."

**Original identity (do not drift toward either game):** "replay booth" — scoreboard-cell tiles, a rubber-**stamp** verdict, chalk-line dividers. No photos, no pixel art, no orange-on-navy, no skewed italic. Accent is blue; color is reserved for tiles and verdicts.

## 2. Flow and screens

Flow: **Landing -> (League picker) -> (Team picker) -> Loading -> Result -> Leaderboard.** Fewest taps wins: a *username* with exactly one 2026 league skips the picker, and a username always skips the team picker (we know the roster). Only a *league ID* shows the team picker. Back arrow top-left on every inner screen; the "?" button (44px) top-right opens How it works.

### 2.1 Landing (single input)
- Top bar 56px: wordmark "BAD OR UNLUCKY?" (display 20px) left; theme toggle + "?" right.
- Hero, upper-middle (keyboard-safe — do NOT pin the CTA to the bottom here; the on-screen keyboard would cover it): display 56px two-line "BAD / OR UNLUCKY?", tagline 16px muted.
- Input 56px tall, radius 14, 18px text (>=16px stops iOS zoom). Attrs: `autocapitalize=off autocorrect=off spellcheck=false enterkeyhint=go`, `autocomplete=username`, label visually hidden ("Sleeper username or league ID"). Trim, strip leading "@"; all digits and 10+ long = league ID.
- Primary button directly under the input, full width, 56px: **Check my luck** (Enter submits). Never disabled; empty tap shows the inline error.
- Under it, centered text link **Try a demo league** (`js/demo.js`). Returning visitor: input prefilled from localStorage (try/catch), button reads **Check again**.
- Sample row: 7 static tiles (🟩🟨🟩🟥🟨🟩🟪 with glyphs) that flip once on load, then the legend on one line: `W earned · ★ stole · ! robbed · L deserved`. This is the whole onboarding.
- Footer 12px muted: "Sleeper only for now · No login · No tracking".

### 2.2 League picker
- Title "Pick a league" 24px; sub "@username · 2026". Season chips (2026 | 2025 | 2024) below; default = `getNflState().season`.
- Cards, full-width, min-height 72px, gap 12: avatar 40 circle (fallback initial) · league name 16/600, 1-line ellipsis · meta 13px muted "12 teams · In season" · chevron. **Tap goes straight to Loading (no confirm button).** Sort in-season first, then A–Z. Render names via `textContent` only (CONTRACT).
- Empty: "No 2026 leagues for @x." + chips for earlier seasons.

### 2.3 Team picker (league-ID path only)
- Title "Which team is yours?"; rows 64px: avatar · team name 16/600 · manager 13px muted · record "4-3" right (tabular). Order by current record. **Never order or badge by luck here (spoilers).** Search field only if more than 12 teams. Tap -> Loading. Remember the choice per league.

### 2.4 Loading
- Same header. Centered: skeleton tile row (7 gray cells, 1.2s opacity pulse, no spinner), one rotating fun line (swap every 1.4s, cross-fade), under it 4 real steps with a check as each completes: "Found you · Loaded 12 teams · Scored weeks 1–7 · Checking injuries & slumps" (maps to `onProgress` and D8).
- Show the loader only if work exceeds 250ms (avoid flash). After 8s add "Big league — still working." Verdict renders as soon as matchup data lands; injuries/slumps fill in later (see 2.5).

### 2.5 Result reveal (the money screen)
Order top -> bottom inside one "result card" (it must screenshot well):
1. Context chip: "Team name · League name" (ellipsis) + "2026 · Wk 1–7".
2. **Tile grid**: 7 columns x ceil(weeks/7) rows, gap 6px; tile 44px at 375 (grows to 56 on desktop). Week number under each tile 11px muted. Tap a tile -> detail strip under the grid: "Wk 4 · You 98.2 – Opp 121.5 · beat 8 of 11 teams · opp's season high (vs you)".
3. **Verdict stamp**: emoji + word in display type, tinted pill, rotated -3deg; subtitle (table in 4) and the contract `headline` (18px).
4. Two numbers side by side, tabular 32px display: "You went **4–3**" / "Should've gone **5.6–1.4**".
5. Sticky bottom bar (safe-area aware): **Share my result** (primary, 56px; mobile uses Web Share if present, else copies; label morphs to "Copied ✓" 1.8s + toast) and secondary icon button "League".
6. Below the fold (scroll, fade-up once via IntersectionObserver): **Why** (contract `reasons`, 2–4 rows, big number left); **Luck breakdown** — 4 rows (Schedule luck · Opponents scoring above avg vs you · Injuries · Player slumps): label, "3rd unluckiest of 12", diverging bar (center zero; left = unlucky, drawn in `--t-robbed`; right = lucky, `--t-stole`), tap row to expand the cases list; **Lineup efficiency**: "86% · 3rd best manager · 41.2 pts left on bench" + bar; links "Not you? Switch team" · "Check another league".
7. Progressive data (D8): Injuries and Slumps rows show a shimmer skeleton with their final height reserved (no layout shift) until `loadPlayers` resolves; label them "estimate" with an info tap (injuries are inferred, per PROJECT_LOG).
Reveal rules: see section 6 (total <=1.7s, tap anywhere = skip to final). Replays only once per team per session.

### 2.6 League luck leaderboard
- Title "Luck leaderboard"; sub league + weeks. Segmented control **Luck | Skill** (Skill = efficiency rank). Two superlative chips on top: "🫠 Most robbed: <team>", "🤡 Luckiest: <team>".
- Rows 56px: rank (tabular, 28px col) · team name 15/600 + manager 12 muted · Δ wins-above-expected "−1.6" (tabular, colored by sign, plus the sign character) · verdict emoji. Order = contract order (unluckiest first). Your row: accent left bar 3px + "YOU" pill; scrolls into view on open.
- Tap a row -> that team's result (deep link `#/l/<league>/<team>`). This is the "roast a friend" loop.

### 2.7 "How it works" modal
- Mobile = bottom sheet (max 90dvh, radius 24 top, drag handle, backdrop 60%); >=600px = centered dialog 480px. Focus trap, Esc/backdrop/✕ (44px) close, focus returns to "?". Do **not** auto-open on first visit (the landing already shows the legend).
- Content (<=140 words): 1 "We pull your league from Sleeper — public data, no login." 2 "Each week we compare your score with *every* team, not just your opponent." 3 Tile legend with glyphs: W earned win (won + beat half the league) · ★ stole a win (won but scored low) · ! robbed (lost but beat half the league) · L deserved loss. 4 "Luck = schedule, opponents who went off against you, injuries, and your players slumping vs their own trend." 5 A 2x3 matrix: rows Strong / Weak, columns Unlucky / Fair / Lucky -> ROBBED·LEGIT·COOKING / CURSED·BAD·FRAUD as colored chips. Footnote: "Estimates, not gospel." Button **Got it**.

## 3. Design tokens (paste into `:root`)
Theme: an inline `<head>` script sets `data-theme` from localStorage (try/catch) else `matchMedia('(prefers-color-scheme: dark)')`, so CSS needs only the two blocks below. Add `color-scheme: light dark`.
```css
:root{ /* LIGHT */
 --bg:#F7F5F0; --surface:#FFFFFF; --surface-2:#EFECE4; --text:#14161B; --muted:#566070;
 --border:#D9D5CA; --input-border:#737A89; --accent:#2552D9; --on-accent:#FFFFFF; --focus:#1B3FB3; --error:#B3261E;
 --t-earned:#1A7F45; --t-earned-fg:#FFFFFF; --t-stole:#6E4BE0; --t-stole-fg:#FFFFFF;
 --t-robbed:#F2B705; --t-robbed-fg:#1A1300; --t-robbed-ring:#8A6100;
 --t-deserved:#D12F3A; --t-deserved-fg:#FFFFFF; --t-tie:#6B7385; --t-tie-fg:#FFFFFF; --t-bye:#DEDACF; --t-bye-fg:#4A5160;
 --v-robbed:#8A6100; --v-legit:#16743F; --v-cooking:#A84300; --v-cursed:#0B7285; --v-bad:#C42B36; --v-fraud:#5B3BC4;
 --sh-1:0 1px 2px rgba(20,22,27,.06),0 6px 18px rgba(20,22,27,.08); --sh-2:0 -8px 40px rgba(20,22,27,.18);
 --r-sm:8px; --r-md:14px; --r-lg:18px; --r-xl:24px; --r-pill:999px;
 --s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-5:24px; --s-6:32px; --s-7:48px; --s-8:64px;
 --ease-out:cubic-bezier(.2,.8,.2,1); --ease-stamp:cubic-bezier(.2,.9,.3,1.4);
 --dur-flip:320ms; --dur-stamp:380ms; --stagger:70ms; --col:520px; --tile:44px;
}
:root[data-theme="dark"]{
 --bg:#0F1115; --surface:#181B22; --surface-2:#20242D; --text:#F2F4F8; --muted:#A3ABBA;
 --border:#2C313C; --input-border:#6B7385; --accent:#5B8CFF; --on-accent:#0A0F1E; --focus:#8FB0FF; --error:#FF8A90;
 --t-earned:#2FA866; --t-earned-fg:#04150B; --t-stole:#9B7BFF; --t-stole-fg:#0D0620;
 --t-robbed:#F2B705; --t-robbed-fg:#1A1300; --t-robbed-ring:#F2B705;
 --t-deserved:#F0545B; --t-deserved-fg:#1F0508; --t-tie:#6B7385; --t-tie-fg:#FFFFFF; --t-bye:#2A2F3A; --t-bye-fg:#A3ABBA;
 --v-robbed:#F5C518; --v-legit:#3DD68C; --v-cooking:#FF8A3D; --v-cursed:#4FD1E6; --v-bad:#FF6B73; --v-fraud:#B79CFF;
 --sh-1:0 1px 0 rgba(255,255,255,.04) inset,0 10px 28px rgba(0,0,0,.45); --sh-2:0 -10px 48px rgba(0,0,0,.6);
}
@media (min-width:600px){:root{--tile:56px}}
```
Verified contrast (text vs its own fill / UI vs page bg), light | dark: body text 16.6 | 17.2; muted on bg 5.8 | 8.2; accent on bg 5.9 | 6.0; on-accent on accent 6.4 | 6.0; tile glyphs earned 5.0 | 6.2, stole 5.6 | 6.3, robbed 10.2 | 10.2, deserved 5.0 | 5.7, tie 4.8 | 4.8; verdict colors on surface 5.4–7.3 | 6.2–10.6, and >=4.8 on their own 10% tint (`color-mix(in srgb, var(--v-x) 10%, var(--surface))`). Input border >=3.6:1 (WCAG 1.4.11). Light `--t-robbed` (amber) is only 1.7:1 against the page, so the tile must draw `box-shadow: inset 0 0 0 2px var(--t-robbed-ring)`. Tile wiring: `.tile[data-k=earned]{background:var(--t-earned);color:var(--t-earned-fg)}` etc. Decorative `--border` (1.3–1.5:1) is for dividers only, never for controls. Tie/bye tiles: bye gets a dashed `--input-border` border.

## 4. Verdicts (one color + emoji each; the color echoes the tile that dominates that verdict)
| Code | Emoji | Color token | Subtitle (static, <=40 chars) |
|---|---|---|---|
| ROBBED | 🫠 | `--v-robbed` (amber) | Good team. Brutal luck. Demand a recount. |
| LEGIT | 🫡 | `--v-legit` (green) | Your record is your résumé. Respect. |
| COOKING | 🔥 | `--v-cooking` (orange) | Good team, and the schedule is helping. |
| CURSED | 👻 | `--v-cursed` (cyan) | Weak roster, worse luck. It's not you. |
| BAD | 🗑️ | `--v-bad` (red) | No excuses. The record is honest. |
| FRAUD | 🤡 | `--v-fraud` (purple) | Wins on loan. The schedule carried you. |
Stamp styling: word in display 900, uppercase, `letter-spacing:.02em`, color `--v-x`; 3px double-ish border (`border:3px solid` + inner `outline:2px solid` offset -8px) in the same color; background = 10% tint; emoji left of the word, `aria-hidden`. Rotate -3deg. Emoji is decoration; the word carries the meaning.

## 5. Typography (Google Fonts; self-host the WOFF2 subsets — OFL — to honor "no tracking": the Google CDN sees visitors' IPs)
- **Display: Big Shoulders Display** 800, 900 (condensed, scoreboard feel; verdict, wordmark, hero, big numbers). Fallback `Impact, "Arial Narrow Bold", sans-serif`.
- **UI: Inter** 400, 600, 700 (variable ok). Fallback `system-ui, sans-serif`. Always `font-variant-numeric: tabular-nums` on numbers, scores, ranks, records.
- `font-display: swap`; preload only Big Shoulders 900 latin.
| Role | Size/line | Font |
|---|---|---|
| Verdict word | `clamp(72px, 25vw, 132px)` / .9 | Display 900 |
| Hero H1 (landing) | 56px / .95 (64px >=600) | Display 900 |
| Big numbers (record) | 32px / 1 | Display 800, tabular |
| H2 / screen title | 24px / 1.2 | Inter 700 |
| Card title / row name | 16px / 1.3 | Inter 600 |
| Body, input | 16–18px / 1.5 | Inter 400 |
| Meta, labels | 13px / 1.4; caps label 12px, `letter-spacing:.08em` | Inter 600 |
"COOKING" (7 letters) fits one line at 375px at the clamp's 25vw (~94px).

## 6. Motion (all durations are tokens)
- **Tile flip** (Wordle-like, shorter): per tile, `rotateX(0 -> 90deg)` in `--dur-flip`/2, swap fill + glyph at the midpoint, `rotateX(90deg -> 0)` in the second half, `--ease-out`. Tile i starts at `i * stagger`, where `stagger = clamp(40ms, 900ms / n, 90ms)` (7 weeks = 70ms, 14 weeks = 64ms). Placeholder tiles are empty outlines (`--surface-2`) before flipping.
- **Verdict stamp**: starts 200ms after the last tile starts flipping (about 0.9–1.1s in). Keyframes: `scale(1.8) rotate(-9deg) opacity 0` -> 60% `scale(.94) rotate(-3deg) opacity 1` -> 100% `scale(1) rotate(-3deg)`, `--dur-stamp` with `--ease-stamp`. At impact: card `translateY(2px)` for 120ms; one ring in `--v-x` expanding 0 -> 24px while fading (500ms); `navigator.vibrate?.(15)` if available.
- Then (staggered 60ms): headline/subtitle, record numbers, sticky bar slides up 200ms. **Total <= 1.7s. A tap anywhere skips to the final state.**
- Idle: loading skeleton pulse 1.2s; landing sample row flips once; button press `scale(.98)` 80ms; error input shake 2x4px 240ms.
- **`prefers-reduced-motion: reduce`**: no flip, rotation, scale, shake, vibrate or pulse. Tiles/verdict appear in final state with a <=150ms opacity fade; progress shown as static text. Test with the OS setting on.

## 7. Microcopy
- Tagline: **"Your record lies. We checked."** Sub: "Find out if you're actually bad — or just unlucky."
- Placeholder: **"Sleeper username or league ID"** · Buttons: **Check my luck**, Check again, Try a demo league, Share my result, Copied ✓, League, Got it, Not you? Switch team, Check another league, Back.
- Share toast: "Copied — paste it in the group chat." Weekly hook: "Week 8 is live — numbers update after Monday Night Football."
- Loading lines (rotate; each matches something we really compute): "Calling Sleeper…" · "Replaying every week…" · "Counting the cheap wins…" · "Auditing your opponents…" · "Finding the guy who dropped 40 on you…" · "Checking your bench for crimes…" · "Scanning for injury bad luck…" · "Asking the schedule hard questions…"
- Errors (`SleeperError.kind`, inline under input, `role=alert`, red `--error` + ⚠ icon):
 - empty input: "Type your Sleeper username to start."
 - `not_found`: "No Sleeper user “{x}”. Check the spelling, or paste a league ID."
 - `network`: "Can't reach Sleeper. Check your connection." [Try again]
 - `rate_limit`: "Sleeper asked us to slow down. Retrying…" (auto-retry, 3s)
 - `no_games`: "No finished games yet this season. Try last season or the demo league." [Try 2025] [Demo]
 - no leagues: "No 2026 leagues for @{x}." + season chips
 - injuries pending: "Injuries & slumps still loading…" · league has median games: footnote "Includes median games."

## 8. Accessibility
- **Tiles never rely on color**: glyph inside each (W earned, ★ stole, ! robbed, L deserved, = tie, – bye), plus week number below, plus robbed gets an inset ring in light theme. Row is `<ol>`; each tile `<li>` is a 44px+ button with `aria-label="Week 4: robbed loss, 98.2 to 121.5, would have beaten 8 of 11 teams"`. Legend is always visible on landing and in the modal.
- Verdict is the page `<h1>`; after the reveal, an `aria-live="polite"` region announces "Verdict: ROBBED. You went 4-3, should have gone 5.6-1.4." Reveal animation must not delay content for screen readers (render DOM first, animate after).
- Tap targets >=44x44px; one-hand reachable primaries; focus ring `outline:3px solid var(--focus); outline-offset:2px` on every control (`:focus-visible`).
- Inputs >=16px, real `<label>`, errors tied via `aria-describedby`; `aria-invalid` on failure. Toast is `aria-live=polite`.
- Modal: `role=dialog aria-modal=true`, labelled, focus trap, Esc, focus return. Diverging bars always print the number and sign next to them.
- Works at 200% zoom with no horizontal scroll; `lang="en"`; `forced-colors: active`: tiles keep `border:2px solid CanvasText` and the glyph. Emoji are `aria-hidden` with adjacent text. Optional later: a blue/orange color-blind palette toggle (Wordle-style) — glyphs already cover the need for v1.

## 9. Do / Don't
- Do: one input, one primary button per screen, results before explanations, numbers tabular, verdict in the first screenful (no scrolling needed to see the word).
- Don't: ads, cookie banner, account prompts, auto-playing sound, confetti, or any luck-ranked spoilers before the reveal. No third-party scripts or trackers (CONTRACT). Set `<meta name="theme-color">` per theme and `viewport-fit=cover`.
