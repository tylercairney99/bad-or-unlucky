// js/board.js — league luck leaderboard (DESIGN_BRIEF §2.6). Rows link to each team's result ("roast a friend").
import { h, emoji } from './dom.js';
import { signed, pct, weeksText } from './format.js';

export function renderBoard(entry, ui) {
  let mode = 'luck';
  const youId = ui.youId;

  const heading = h('div', null,
    h('h1', { class: 'screen-title', tabindex: '-1' }, 'Luck leaderboard'),
    h('p', { class: 'sub' }, `${entry.report.league.name} · ${entry.report.league.season} · ${weeksText(entry.report.league.weeksAnalyzed)}`));
  const supers = h('div', { class: 'superlatives' });
  const list = h('ol', { class: 'board-list' });
  const note = h('p', { class: 'footnote' });

  const btnLuck = h('button', { type: 'button', 'aria-pressed': 'true' }, 'Luck');
  const btnSkill = h('button', { type: 'button', 'aria-pressed': 'false' }, 'Skill');
  const setMode = (m) => {
    mode = m;
    btnLuck.setAttribute('aria-pressed', String(m === 'luck'));
    btnSkill.setAttribute('aria-pressed', String(m === 'skill'));
    paint();
  };
  btnLuck.addEventListener('click', () => setMode('luck'));
  btnSkill.addEventListener('click', () => setMode('skill'));

  function paint() {
    // Rank by wins above expected — the number each row shows and the axis the verdict is built on.
    const teams = [...entry.report.teams].sort((a, b) => a.luck.scheduleRank - b.luck.scheduleRank);
    const first = teams[0];
    const last = teams[teams.length - 1];
    supers.replaceChildren(
      superChip('🚨', 'Most robbed', first.name),
      teams.length > 1 ? superChip('🤡', 'Luckiest', last.name) : null,
    );

    const skillReady = entry.players === 'ready' && teams.every((t) => t.skill);
    const ordered = mode === 'skill' && skillReady ? [...teams].sort((a, b) => a.skill.efficiencyRank - b.skill.efficiencyRank) : teams;
    list.replaceChildren(...ordered.map((t, i) => row(t, mode === 'skill' && skillReady ? t.skill.efficiencyRank : i + 1, skillReady)));

    if (mode === 'luck') note.textContent = 'Wins above or below what your points deserved. Tap a team to see its verdict.';
    else if (skillReady) note.textContent = 'Lineup efficiency: points scored vs the best lineup you could have set.';
    else if (entry.players === 'failed') note.textContent = 'Player data didn’t load, so lineup efficiency is unavailable.';
    else note.textContent = 'Lineup data still loading…';
  }

  function row(t, rank, skillReady) {
    const you = t.teamId === youId;
    const wae = t.luck.winsAboveExpected;
    const showSkill = mode === 'skill';
    const value = showSkill ? (skillReady ? pct(t.skill.efficiency) : '…') : signed(wae);
    const tone = showSkill ? '' : wae < 0 ? 'neg' : wae > 0 ? 'pos' : '';
    const luckWords = wae === 0 ? 'right at expected' : `${signed(wae).replace(/^[+−]/, '')} wins ${wae < 0 ? 'below' : 'above'} expected`;
    const label = `${rank}. ${t.name}${you ? ' (you)' : ''}, ${t.managerName}, ${showSkill && skillReady ? `${pct(t.skill.efficiency)} lineup efficiency` : luckWords}, verdict ${t.verdict.title}`;
    return h('li', null,
      h('a', { class: `board-row${you ? ' you' : ''}`, href: ui.paths.team(t.teamId), 'aria-label': label, dataset: { team: String(t.teamId) } },
        h('span', { class: 'board-rank' }, String(rank)),
        h('span', { class: 'board-names' },
          h('span', { class: 'board-name' }, h('span', { class: 'ellipsis' }, t.name), you ? h('span', { class: 'you-pill' }, 'YOU') : null),
          h('span', { class: 'board-mgr ellipsis' }, t.managerName)),
        h('span', { class: `board-delta ${tone}` }, value),
        h('span', { class: 'board-emoji', 'aria-hidden': 'true' }, emoji(t.verdict.emoji))));
  }

  paint();
  ui.mount(h('section', { class: 'view board' },
    heading,
    supers,
    h('div', { class: 'segmented', role: 'group', 'aria-label': 'Rank by' }, btnLuck, btnSkill),
    list,
    note));

  const mine = list.querySelector('.board-row.you');
  if (mine) mine.scrollIntoView({ block: 'nearest' });

  const onUpdate = () => paint();
  entry.listeners.add(onUpdate);
  return () => entry.listeners.delete(onUpdate);
}

function superChip(icon, label, name) {
  return h('span', { class: 'super' },
    emoji(icon) ? h('span', { 'aria-hidden': 'true' }, icon) : null,
    h('span', { class: 'ellipsis' }, `${label}: `, h('b', null, name)));
}
