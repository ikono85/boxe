/**
 * ResultScreen.js
 * ------------------------------------------------------------------
 * Écran de fin : KNOCKOUT ou décision des juges, vainqueur, score final,
 * statistiques comparées, cartes des trois juges, REJOUER / MENU.
 */

import { el, esc, num, pct, clock } from './dom.js';

export class ResultScreen {
  constructor(root, { onReplay, onMenu, onSound }) {
    this.onSound = onSound || (() => {});
    this.el = el('<div class="screen results" hidden></div>');
    root.appendChild(this.el);
    this.onReplay = onReplay;
    this.onMenu = onMenu;
  }

  hide() {
    this.el.hidden = true;
    this.el.innerHTML = '';
  }

  /**
   * @param {object} r résultat du RoundSystem
   * @param {{player, opponent, score, newRecord, best, difficultyLabel}} ctx
   */
  show(r, ctx) {
    const { player, opponent } = ctx;
    const won = r.winner === player;
    const draw = !r.winner;
    const isKO = r.method === 'KO';
    const title = isKO ? 'KNOCKOUT' : draw ? 'Match nul' : 'Décision';
    let verdict;
    if (draw) verdict = 'Personne ne gagne ce soir';
    else verdict = won ? 'Victoire' : `Victoire de ${opponent.name}`;
    const method = isKO
      ? `KO au round ${r.round} à ${clock(r.time)}`
      : `${r.kind} après ${r.round} round${r.round > 1 ? 's' : ''}`;

    const ps = player.matchStats;
    const os = opponent.matchStats;
    const rows = [
      [ps.landed, 'Coups portés', os.landed],
      [pct(ps.accuracy), 'Précision', pct(os.accuracy)],
      [ps.power, 'Coups puissants', os.power],
      [`${ps.head} / ${ps.body}`, 'Tête / corps', `${os.head} / ${os.body}`],
      [ps.crits, 'Critiques', os.crits],
      [ps.counters, 'Contres', os.counters],
      [ps.dodges, 'Esquives', os.dodges],
      [ps.blocks, 'Coups bloqués', os.blocks],
      [Math.round(ps.damage), 'Dégâts infligés', Math.round(os.damage)],
      [ps.bestCombo ? ps.bestCombo.name : '—', 'Meilleur combo', os.bestCombo ? os.bestCombo.name : '—'],
    ];
    const statRows = rows.map(([a, l, b]) => `<tr><td>${esc(a)}</td><td>${esc(l)}</td><td>${esc(b)}</td></tr>`).join('');

    const cards = r.scorecards && r.scorecards[0] && r.scorecards[0].length
      ? r.scorecards.map((rounds, j) => {
        const tot = rounds.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
        return `<div class="judge">
            <div class="jh"><span>Juge ${j + 1}</span><span class="tot">${tot[0]} – ${tot[1]}</span></div>
            <table>
              <tr><th></th>${rounds.map((_, i) => `<th>R${i + 1}</th>`).join('')}</tr>
              <tr class="rowred"><td>Vous</td>${rounds.map(([x]) => `<td>${x}</td>`).join('')}</tr>
              <tr class="rowblue"><td>${esc(opponent.name.split(' ')[0])}</td>${rounds.map(([, y]) => `<td>${y}</td>`).join('')}</tr>
            </table>
          </div>`;
      }).join('')
      : '<p class="hint">Combat terminé avant la fin du premier round : pas de carte des juges.</p>';

    this.el.innerHTML = `
      <div class="results-box" role="dialog" aria-label="Résultat du combat">
        <div class="results-head">
          <div class="results-title">
            <h2 class="${isKO ? 'ko' : ''}">${esc(title)}</h2>
            <div class="verdict ${won ? 'win' : 'lose'}">${esc(verdict)}</div>
            <div class="method">${esc(method)} · ${esc(ctx.online ? 'En ligne' : ctx.difficultyLabel)}</div>
          </div>
          ${ctx.online ? `<div class="final-score">
            <div class="lab">En ligne</div>
            <div class="num small">${esc(ctx.online.foe)}</div>
          </div>` : `<div class="final-score">
            <div class="lab">Score final</div>
            <div class="num">${num(ctx.score)}</div>
            ${ctx.newRecord ? '<div class="rec">Nouveau record !</div>' : `<div class="lab">Record : ${num(ctx.best)}</div>`}
          </div>`}
        </div>
        <div class="results-actions">
          ${ctx.online
    ? '<button class="btn primary" type="button" data-action="rematch"></button><button class="btn" type="button" data-action="menu">Quitter</button>'
    : '<button class="btn primary" type="button" data-action="replay">Rejouer</button><button class="btn" type="button" data-action="menu">Menu</button>'}
        </div>
        <div class="results-grid">
          <div class="results-card">
            <h3>Statistiques</h3>
            <div class="cmp-head"><span>Vous</span><span>${esc(opponent.name)}</span></div>
            <table class="cmp">${statRows}</table>
          </div>
          <div class="results-card">
            <h3>Cartes des juges</h3>
            <div class="cards-judges">${cards}</div>
          </div>
        </div>
      </div>`;
    this.el.hidden = false;
    this.el.querySelector('.results-actions').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.onSound('ui_click');
      if (b.dataset.action === 'replay') this.onReplay();
      else if (b.dataset.action === 'rematch') {
        if (this.online && !b.disabled) this.online.onRematch();
      } else if (this.online) this.online.onQuit();
      else this.onMenu();
    });
    this.online = ctx.online || null;
    if (this.online) this.updateOnline(this.online);
    const replay = this.el.querySelector('[data-action="replay"], [data-action="rematch"]');
    if (replay) replay.focus({ preventScroll: true });
  }

  /**
   * En ligne : état du bouton Revanche.
   * @param {{foe, mine: boolean, theirs: boolean, gone: boolean}} o
   */
  updateOnline(o) {
    const b = this.el.querySelector('[data-action="rematch"]');
    if (!b) return;
    let label = 'Revanche';
    let sub = 'Même adversaire, même format';
    if (o.gone) sub = `${o.foe} est parti`;
    else if (o.mine) {
      label = 'Revanche demandée';
      sub = o.theirs ? 'C’est parti' : `En attente de ${o.foe}`;
    } else if (o.theirs) sub = `${o.foe} veut une revanche !`;
    b.innerHTML = `${esc(label)}<small>${esc(sub)}</small>`;
    b.disabled = !!o.gone || !!o.mine;
  }
}
