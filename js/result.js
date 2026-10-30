// js/result.js — the result ("money") screen: tiles, verdict stamp, reveal, breakdown, share (DESIGN_BRIEF §2.5, §6).
import { h, session, emoji, prefersReducedMotion } from './dom.js';
import { fmt1, signed, ordinal, recordText, expectedText, luckRankText, weeksText, pct } from './format.js';
import { buildShareText, shareResult } from './share.js';

export const GLYPH = { earned: 'W', stole: '★', robbed: '!', deserved: 'L', tie: '=', bye: '–' };
const TILE_WORDS = {
  earned: 'earned win', stole: 'stole a win', robbed: 'robbed loss', deserved: 'deserved loss', tie: 'tie', bye: 'no head-to-head game',
};
const SUBTITLES = {
  ROBBED: 'Good team. Brutal luck. Demand a recount.',
  LEGIT: 'Your record is your résumé. Respect.',
  COOKING: 'Good team, and the schedule is helping.',
  CURSED: 'Weak roster, worse luck. It’s not you.',
  BAD: 'No excuses. The record is honest.',
  FRAUD: 'Wins on loan. The schedule carried you.',
};

const pts = (x) => fmt1(x);
/** Two scores at 1 decimal, unless that would make a 100.04–100.01 win look like a tie. */
const score = (a, b) => (fmt1(a) === fmt1(b) && a !== b ? `${(+a).toFixed(2)}–${(+b).toFixed(2)}` : `${fmt1(a)}–${fmt1(b)}`);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Mount the result for one team. Returns a cleanup function (unsubscribe, cancel reveal). */
export function renderResult(entry, teamId, ui) {
  const team = () => entry.report.teams.find((t) => t.teamId === teamId);
  const t = team();
  const report = entry.report;
  const n = report.league.teamCount;
  const h2h = t.h2hRecord || t.record; // expected record is H2H-only, so compare like with like
  const mine = teamId === ui.youId; // a friend's team (from the board or a shared link) gets third-person copy
  const shareLabel = mine ? 'Share my result' : 'Share this result';

  // ── top card ──
  const detail = h('p', { class: 'tile-detail', id: 'tile-detail', 'aria-live': 'polite' }, 'Tap a week for the details.');
  const tileButtons = [];
  const select = (i) => {
    tileButtons.forEach((b, j) => b.setAttribute('aria-pressed', String(i === j)));
    const [line1, line2] = detailLines(t.weeks[i], n);
    detail.replaceChildren(h('strong', null, line1), h('br'), line2);
  };
  const tiles = h('ol', { class: 'tiles', 'aria-label': 'Week by week results' }, t.weeks.map((w, i) => {
    const btn = h('button', { class: 'tile-btn', type: 'button', 'aria-pressed': 'false', 'aria-controls': 'tile-detail', 'aria-label': tileLabel(w, n), onclick: () => select(i) },
      h('span', { class: 'tile', dataset: { k: w.tile }, style: { '--i': i }, 'aria-hidden': 'true' }, GLYPH[w.tile] || ''),
      h('span', { class: 'wk', 'aria-hidden': 'true' }, String(w.week)));
    tileButtons.push(btn);
    return h('li', null, btn);
  }));

  const v = t.verdict;
  const card = h('div', { class: 'result-card' },
    h('p', { class: 'context' },
      h('span', { class: 'context-name ellipsis' }, `${t.name} · ${report.league.name}`),
      h('span', { class: 'context-meta' }, `${report.league.season} · ${weeksText(report.league.weeksAnalyzed)}`)),
    tiles,
    detail,
    h('div', { class: 'verdict' },
      h('h1', { class: 'stamp', dataset: { v: v.code }, tabindex: '-1' },
        emoji(v.emoji) ? h('span', { class: 'stamp-emoji', 'aria-hidden': 'true' }, v.emoji) : null,
        h('span', { class: 'stamp-word' }, v.title)),
      h('p', { class: 'verdict-sub rv', style: { '--rv': '0ms' } }, SUBTITLES[v.code] || ''),
      h('p', { class: 'verdict-headline rv', style: { '--rv': '60ms' } }, v.headline)),
    h('div', { class: 'record-pair rv', style: { '--rv': '120ms' } },
      h('div', null, h('span', { class: 'record-label' }, mine ? 'You went' : 'They went'), h('span', { class: 'big-num' }, recordText(h2h))),
      h('div', null, h('span', { class: 'record-label' }, 'Should’ve gone'), h('span', { class: 'big-num' }, expectedText(t.expected)))),
    entry.data.league.medianGame
      ? h('p', { class: 'footnote record-note rv', style: { '--rv': '120ms' } }, `Overall ${recordText(t.record)} · Includes median games.`)
      : null,
  );

  // ── below the fold (progressive: re-rendered when player data lands) ──
  const why = h('ol', { class: 'why-list' });
  const breakdown = h('div', { class: 'breakdown' });
  const eff = h('div');
  const hook = h('p', { class: 'footnote', hidden: true });
  const paintBelow = () => {
    const cur = team();
    why.replaceChildren(...cur.verdict.reasons.map((r) => h('li', null, r)));
    breakdown.replaceChildren(...luckRows(cur, entry));
    eff.replaceChildren(effBlock(cur, entry));
  };
  paintBelow();
  ui.hook(entry).then((text) => {
    if (text) {
      hook.textContent = text;
      hook.hidden = false;
    }
  });

  const sections = [
    h('section', { class: 'section', 'aria-labelledby': 'why-h' }, h('h2', { class: 'section-title', id: 'why-h' }, 'Why'), why),
    h('section', { class: 'section', 'aria-labelledby': 'luck-h' },
      h('h2', { class: 'section-title', id: 'luck-h' }, 'Luck breakdown'),
      h('p', { class: 'dbar-legend', 'aria-hidden': 'true' }, h('span', null, '← unlucky'), h('span', null, 'lucky →')),
      breakdown),
    h('section', { class: 'section', 'aria-labelledby': 'eff-h' }, h('h2', { class: 'section-title', id: 'eff-h' }, 'Lineup efficiency'), eff),
  ];

  // ── share bar ──
  const shareBtn = h('button', { class: 'btn btn-primary', type: 'button' }, shareLabel);
  const fallback = h('div', { class: 'share-fallback', hidden: true });
  let labelTimer = 0;
  shareBtn.addEventListener('click', async () => {
    const text = buildShareText(team(), entry.report, ui.shareUrl(teamId));
    const res = await shareResult(text);
    if (res === 'copied') {
      shareBtn.textContent = 'Copied ✓';
      ui.toast('Copied — paste it in the group chat.');
      clearTimeout(labelTimer);
      labelTimer = setTimeout(() => (shareBtn.textContent = shareLabel), 1800);
    } else if (res === 'manual') {
      const ta = h('textarea', { readonly: true, id: 'share-text', rows: '7' });
      ta.value = text;
      fallback.replaceChildren(h('label', { class: 'caps', for: 'share-text' }, 'Copy this and paste it in the group chat'), ta);
      fallback.hidden = false;
      ta.focus();
      ta.select();
    }
  });
  const bar = h('div', { class: 'share-bar' }, shareBtn, h('a', { class: 'btn btn-secondary', href: ui.paths.board, 'aria-label': 'League luck leaderboard' }, 'League'));

  const view = h('section', { class: 'view result' },
    card,
    fallback,
    ...sections,
    h('p', { class: 'result-links' },
      h('a', { class: 'link-btn', href: ui.paths.teams }, 'Not you? Switch team'),
      h('a', { class: 'link-btn', href: '#/' }, 'Check another league')),
    hook,
    bar);

  ui.mount(view);
  const ioCleanup = fadeInOnScroll(sections);
  const summary = `Verdict: ${v.title}. ${mine ? 'You' : 'They'} went ${recordText(h2h, '-')}, should have gone ${expectedText(t.expected, '-')}.`;
  const stopReveal = reveal(view, t.weeks.length, `${entry.key}:${teamId}`, () => ui.announce(summary));

  const onUpdate = () => paintBelow();
  entry.listeners.add(onUpdate);
  return () => {
    entry.listeners.delete(onUpdate);
    stopReveal();
    ioCleanup();
    clearTimeout(labelTimer);
  };
}

// ───────────────────────────── tiles ─────────────────────────────

function tileLabel(w, n) {
  const beat = `would have beaten ${w.allPlayWins} of ${n - 1} teams`;
  if (w.result == null) return `Week ${w.week}: ${TILE_WORDS.bye}, scored ${pts(w.points)}, ${beat}`;
  return `Week ${w.week}: ${TILE_WORDS[w.tile]}, ${score(w.points, w.oppPoints).replace('–', ' to ')}, ${beat}`;
}

function detailLines(w, n) {
  const beat = `beat ${w.allPlayWins} of ${n - 1} teams`;
  if (w.result == null) return [`Wk ${w.week} · No head-to-head game`, `You scored ${pts(w.points)} · ${beat}`];
  return [
    `Wk ${w.week} · ${cap(TILE_WORDS[w.tile])} vs ${w.opponentName}`,
    `You ${score(w.points, w.oppPoints).replace('–', ' – Opp ')} · ${beat}${w.oppSeasonHigh ? ' · their season high' : ''}`,
  ];
}

// ───────────────────────────── luck breakdown ─────────────────────────────

/** Diverging bar: value in [-1, 1], negative = unlucky (left). */
function dbar(value) {
  const v = Math.max(-1, Math.min(1, Number(value) || 0));
  const fill = h('span', { class: `dbar-fill ${v < 0 ? 'neg' : 'pos'}`, style: { width: `${Math.abs(v) * 50}%` } });
  return h('span', { class: 'dbar', 'aria-hidden': 'true' }, fill);
}

const maxAbs = (teams, fn) => Math.max(1e-9, ...teams.map((x) => Math.abs(fn(x) || 0)));

function luckRow({ label, tag, value, rank, bar, cases, note }) {
  return h('details', { class: 'luck-row' },
    h('summary', null,
      h('span', { class: 'luck-head' },
        h('span', { class: 'luck-label' }, label, tag ? h('span', { class: 'tag' }, tag) : null),
        h('span', { class: 'luck-value' }, value)),
      dbar(bar),
      h('span', { class: 'luck-rank' }, rank)),
    cases.length
      ? h('ul', { class: 'cases' }, cases.map(([text, num]) => h('li', null, h('span', null, text), h('span', { class: 'num' }, num))))
      : null,
    h('p', { class: 'cases-note' }, note || (cases.length ? '' : 'Nothing notable here.')));
}

function pendingRow(label, failed) {
  return h('div', { class: `luck-row skeleton-row${failed ? '' : ' skeleton'}` },
    failed ? `${label}: player data didn’t load, so we can’t estimate this.` : `${label} — still loading…`);
}

function luckRows(t, entry) {
  const { report } = entry;
  const all = report.teams;
  const n = report.league.teamCount;
  const L = t.luck;

  const schedCases = t.weeks
    .filter((w) => w.tile === 'robbed' || w.tile === 'stole')
    .map((w) => [`Wk ${w.week} · ${w.tile === 'robbed' ? 'Robbed' : 'Stole one'} vs ${w.opponentName}`, score(w.points, w.oppPoints)]);
  const heatCases = t.weeks
    .filter((w) => w.oppAvg != null && w.oppPoints != null && w.oppPoints > w.oppAvg)
    .sort((a, b) => b.oppPoints - b.oppAvg - (a.oppPoints - a.oppAvg))
    .slice(0, 5)
    .map((w) => [`Wk ${w.week} · ${w.opponentName}${w.oppSeasonHigh ? ' (season high)' : ''}`, signed(w.oppPoints - w.oppAvg)]);

  const rows = [
    luckRow({
      label: 'Schedule luck',
      value: `${signed(L.winsAboveExpected)} wins`,
      rank: luckRankText(L.scheduleRank, n, { extremes: true }),
      bar: L.winsAboveExpected / maxAbs(all, (x) => x.luck.winsAboveExpected),
      cases: schedCases,
      note: 'Wins vs what your points would earn against an average schedule.',
    }),
    luckRow({
      label: 'Opponents above their average vs you',
      value: `${signed(L.oppHeat.perGame)} pts/gm`,
      rank: luckRankText(L.oppHeat.rank, n, { extremes: true }),
      bar: -L.oppHeat.perGame / maxAbs(all, (x) => x.luck.oppHeat.perGame),
      cases: heatCases,
    }),
  ];

  if (entry.players !== 'ready' || !L.injuries || !L.slumps) {
    const failed = entry.players === 'failed';
    rows.push(pendingRow('Injuries', failed), pendingRow('Player slumps', failed));
    return rows;
  }

  const avgLost = report.leagueAverages.injuryPointsLost || 0;
  rows.push(
    luckRow({
      label: 'Injuries',
      tag: 'estimate',
      value: `${fmt1(L.injuries.pointsLost)} pts lost`,
      rank: luckRankText(L.injuries.rank, n, { extremes: true }),
      bar: (avgLost - L.injuries.pointsLost) / maxAbs(all, (x) => (x.luck.injuries ? x.luck.injuries.pointsLost - avgLost : 0)),
      cases: L.injuries.cases.map((c) => [`${c.name} · Wk ${c.week}`, `~${fmt1(c.expected)} pts`]),
      note: 'Estimate: a regular starter scored 0 while his NFL team played. Sleeper has no injury history, so benchings can look like injuries.',
    }),
    luckRow({
      label: 'Player slumps',
      tag: 'estimate',
      value: `${signed(L.slumps.net)} pts`,
      rank: luckRankText(L.slumps.rank, n, { extremes: true }),
      bar: L.slumps.net / maxAbs(all, (x) => (x.luck.slumps ? x.luck.slumps.net : 0)),
      cases: L.slumps.worst.slice(0, 5).map((c) => [`${c.name} · Wk ${c.week}`, `${fmt1(c.points)} (avg ${fmt1(c.expected)})`]),
      note: 'Your starters vs their own average in their other games.',
    }),
  );
  return rows;
}

function effBlock(t, entry) {
  if (entry.players !== 'ready' || !t.skill) {
    return entry.players === 'failed'
      ? h('div', { class: 'eff' }, h('p', { class: 'eff-meta' }, 'Player data didn’t load, so lineup efficiency is unavailable.'))
      : h('div', { class: 'eff skeleton skeleton-row' }, 'Lineup efficiency — still loading…');
  }
  const s = t.skill;
  const n = entry.report.league.teamCount;
  const r = s.efficiencyRank;
  const rankText = r === 1 ? 'Best manager in the league'
    : r === n ? 'Worst lineups in the league'
      : r <= Math.ceil(n / 2) ? `${ordinal(r)}-best manager of ${n}` : `${ordinal(n - r + 1)}-worst lineups of ${n}`;
  return h('div', { class: 'eff' },
    h('div', { class: 'eff-line' },
      h('span', { class: 'eff-pct' }, pct(s.efficiency)),
      h('span', { class: 'eff-meta' }, `${rankText} · ${fmt1(s.benchPointsLeft)} pts left on bench`)),
    h('div', { class: 'hbar', 'aria-hidden': 'true' }, h('div', { class: 'hbar-fill', style: { width: pct(s.efficiency) } })));
}

// ───────────────────────────── motion ─────────────────────────────

const seenMemory = new Set();

/**
 * Tile flips → stamp → details (≤ 1.7s). Content is already in the DOM (screen readers get it immediately);
 * this only animates. Plays once per team per session; any tap or key skips to the end.
 */
function reveal(view, count, id, onDone) {
  const key = `bou:seen:${id}`;
  const seen = seenMemory.has(key) || session.get(key) === '1';
  seenMemory.add(key);
  session.set(key, '1');
  if (seen || prefersReducedMotion() || count === 0) {
    view.classList.add('fade-in');
    onDone();
    return () => {};
  }

  const stagger = Math.min(90, Math.max(40, 900 / count));
  const stampDelay = (count - 1) * stagger + 200;
  view.style.setProperty('--stagger', `${stagger}ms`);
  view.style.setProperty('--stamp-delay', `${stampDelay}ms`);
  view.classList.add('reveal', 'flipping');

  const thud = setTimeout(() => {
    try {
      // Chrome logs a console error for vibrate() before any user tap (e.g. opening a shared deep link).
      if (!navigator.userActivation || navigator.userActivation.hasBeenActive) navigator.vibrate?.(15);
    } catch {
      /* not supported */
    }
  }, stampDelay + 230);
  const end = setTimeout(finish, stampDelay + 380 + 180 + 220);
  const skip = () => finish();
  document.addEventListener('pointerdown', skip, true);
  document.addEventListener('keydown', skip, true);

  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(thud);
    clearTimeout(end);
    document.removeEventListener('pointerdown', skip, true);
    document.removeEventListener('keydown', skip, true);
    view.classList.remove('reveal', 'flipping');
    onDone();
  }
  return () => {
    finished = true;
    clearTimeout(thud);
    clearTimeout(end);
    document.removeEventListener('pointerdown', skip, true);
    document.removeEventListener('keydown', skip, true);
  };
}

function fadeInOnScroll(nodes) {
  if (prefersReducedMotion() || typeof IntersectionObserver !== 'function') return () => {};
  const io = new IntersectionObserver((items) => {
    for (const it of items) {
      if (!it.isIntersecting) continue;
      it.target.classList.replace('io-pending', 'io-in');
      io.unobserve(it.target);
    }
  }, { rootMargin: '0px 0px -10% 0px' });
  for (const node of nodes) {
    node.classList.add('io-pending');
    io.observe(node);
  }
  return () => io.disconnect();
}
