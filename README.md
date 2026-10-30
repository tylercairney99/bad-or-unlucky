# Bad or Unlucky?

**Is your fantasy football team actually bad, or just unlucky?** Type your Sleeper username and get a one-word verdict in seconds, with a Wordle-style row of weekly tiles you can paste into the group chat.

Live: https://tylercairney99.github.io/bad-or-unlucky/

## What it measures

| Factor | How |
|---|---|
| **Schedule luck** | All-play record: every week, your score vs *every* team, not just your opponent. Expected wins = Σ weekly all-play win %. Luck = actual H2H wins − expected. |
| **Opponents going off** | Each opponent's score vs their own average in their other weeks. Also counts how many posted their season high against you. |
| **Injuries** (estimate) | Weeks a regular starter of yours scored 0 while his NFL team played, valued over a replacement-level starter at his position. |
| **Slumps** | Your starters' points vs their recent form (average of their earlier weeks), compared with a typical team in your league. |
| **Lineup efficiency** | Points scored ÷ best possible lineup from your roster. This one is skill, not luck. |

The verdict comes from two axes, strength (all-play win %) and luck (wins above expected):

|  | Unlucky | Fair | Lucky |
|---|---|---|---|
| **Strong** | 🚨 ROBBED | 💪 LEGIT | 🔥 COOKING |
| **Weak** | 💀 CURSED | 🗑️ BAD | 🤡 FRAUD |

## Tiles

🟩 **W** earned win · 🟪 **★** stole a win (won, but scored in the bottom half) · 🟨 **!** robbed (lost, but beat half the league) · 🟥 **L** deserved loss

## How it works

- A static site: plain HTML, CSS and ES modules. No build step, no backend, no tracking, no login.
- Reads Sleeper's public read-only API directly from the browser. The players list (several MB) is cached in IndexedDB for 24 hours.
- Strict Content-Security-Policy. API-sourced names are only ever rendered as text.

## Develop

```bash
python -m http.server 8080      # then open http://localhost:8080
node --test                     # engine tests (Node 22+)
```

`js/analysis.js` is a pure function (`LeagueData → Report`) and is easy to test. `js/demo.js` generates a deterministic fake league. See `docs/CONTRACT.md` for the data shapes and `docs/PROJECT_LOG.md` for decisions and roadmap.

Not affiliated with Sleeper.
