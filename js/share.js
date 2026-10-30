// js/share.js — Wordle-style share text (CONTRACT §4) and the share/copy action.
import { fmt1, luckRankText, recordText, weeksText } from './format.js';

export const TILE_EMOJI = { earned: '🟩', stole: '🟪', robbed: '🟨', deserved: '🟥', tie: '⬜', bye: '⬛' };
const ROW = 7; // matches the on-screen grid

/**
 * Bad or Unlucky? 🏈 2026 · Wk 1–7
 * ROBBED 🚨
 * 4-3 · should be 5.6-1.4
 * 🟩🟨🟩🟥🟨🟩🟩
 * Luck rank: 2nd unluckiest of 12
 * <url>
 * No team or manager names: the link carries the context, the text stays spoiler- and privacy-light.
 */
export function buildShareText(teamReport, report, url) {
  const wk = weeksText(report.league.weeksAnalyzed);
  const tiles = teamReport.weeks.map((w) => TILE_EMOJI[w.tile] || TILE_EMOJI.bye);
  const rows = [];
  for (let i = 0; i < tiles.length; i += ROW) rows.push(tiles.slice(i, i + ROW).join(''));
  const v = teamReport.verdict;
  const lines = [
    `Bad or Unlucky? 🏈 ${report.league.season}${wk ? ` · ${wk}` : ''}`,
    `${v.title} ${v.emoji}`.trim(),
    // H2H record vs H2H expected — in median leagues `record` also counts median games.
    `${recordText(teamReport.h2hRecord || teamReport.record, '-')} · should be ${fmt1(teamReport.expected.wins)}-${fmt1(teamReport.expected.losses)}`,
    ...rows,
    `Luck rank: ${luckRankText(teamReport.luck.composite.rank, report.teams.length)}`,
  ];
  if (url) lines.push(url);
  return lines.join('\n');
}

/** Touch devices get the native share sheet; desktops get a clipboard copy (the OS sheet is clunky there). */
function wantsNativeShare() {
  try {
    return typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/**
 * Share or copy. Resolves to 'shared' | 'copied' | 'cancelled' | 'manual' ('manual' = caller must show
 * the text for the user to copy by hand).
 */
export async function shareResult(text) {
  if (wantsNativeShare()) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      /* share failed for another reason — fall through to copy */
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return legacyCopy(text) ? 'copied' : 'manual';
  }
}

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.className = 'offscreen';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}
