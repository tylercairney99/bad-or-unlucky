// js/format.js — number/text formatting shared by the UI and the share text. Pure; safe to import in Node.

const MINUS = '−';

/** One decimal, never "-0.0". */
export function fmt1(n) {
  const r = Math.round((Number(n) || 0) * 10) / 10;
  return (r === 0 ? 0 : r).toFixed(1);
}

/** "+1.6", "−1.6" (true minus sign), "0.0". */
export function signed(n, digits = 1) {
  const f = 10 ** digits;
  const r = Math.round((Number(n) || 0) * f) / f;
  if (r === 0) return (0).toFixed(digits);
  return (r > 0 ? '+' : MINUS) + Math.abs(r).toFixed(digits);
}

export function ordinal(n) {
  const v = Math.abs(Math.trunc(n)) % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][v % 10] || 'th';
  return `${n}${suffix}`;
}

/** {wins, losses, ties} → "4–3" / "4–3–1". */
export function recordText(r, sep = '–') {
  if (!r) return '';
  const parts = [r.wins, r.losses];
  if (r.ties) parts.push(r.ties);
  return parts.join(sep);
}

/** Expected record → "5.6–1.4". */
export function expectedText(e, sep = '–') {
  return e ? `${fmt1(e.wins)}${sep}${fmt1(e.losses)}` : '';
}

/**
 * Rank where 1 = worst luck → "2nd unluckiest of 12"; the lucky half reads from the other end
 * ("3rd luckiest of 12") so nobody is told they are "11th unluckiest".
 */
export function luckRankText(rank, count, { bad = 'unluckiest', good = 'luckiest', extremes = false } = {}) {
  if (!rank || !count) return '';
  // UI only: "Unluckiest in the league" reads better than "1st unluckiest of 12".
  if (extremes && rank === 1) return `${bad.charAt(0).toUpperCase()}${bad.slice(1)} in the league`;
  if (extremes && rank === count) return `${good.charAt(0).toUpperCase()}${good.slice(1)} in the league`;
  if (rank <= Math.ceil(count / 2)) return `${ordinal(rank)} ${bad} of ${count}`;
  return `${ordinal(count - rank + 1)} ${good} of ${count}`;
}

/** [1..7] → "Wk 1–7"; [3] → "Wk 3". */
export function weeksText(weeks) {
  if (!Array.isArray(weeks) || !weeks.length) return '';
  const lo = Math.min(...weeks);
  const hi = Math.max(...weeks);
  return lo === hi ? `Wk ${lo}` : `Wk ${lo}–${hi}`;
}

export const pct = (x) => `${Math.round((Number(x) || 0) * 100)}%`;
