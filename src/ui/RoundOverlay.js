/**
 * RoundOverlay.js
 * ------------------------------------------------------------------
 * Cartons plein écran : « ROUND X », « FIGHT ! », fin de round,
 * minute de repos (statistiques + conseil du coin), « AU TAPIS ! », « BOX ! »,
 * « KNOCKOUT ».
 */

import { el, esc, pct } from './dom.js';

export class RoundOverlay {
  constructor(root, { onSkip } = {}) {
    this.el = el('<div class="overlay" hidden></div>');
    root.appendChild(this.el);
    this.onSkip = onSkip;
    this.timers = [];
  }

  _clear() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  _show(html, interactive = false) {
    this.el.innerHTML = html;
    this.el.hidden = false;
    this.el.style.pointerEvents = interactive ? 'auto' : 'none';
  }

  hide() {
    this._clear();
    this.el.hidden = true;
    this.el.innerHTML = '';
  }

  intro(round, total, delayFight = 1.35) {
    this._clear();
    const label = round === total && total > 1 ? 'Dernier round' : `Round ${round} sur ${total}`;
    this._show(`<div class="slam round"><small>${esc(label)}</small>ROUND ${round}</div>`);
    this.timers.push(setTimeout(() => this.fight(), delayFight * 1000));
  }

  fight() {
    this._clear();
    this._show('<div class="slam fight">FIGHT !</div>');
    this.timers.push(setTimeout(() => this.hide(), 1000));
  }

  end(round, last) {
    this._clear();
    this._show(`<div class="slam end"><small>Cloche</small>${last ? 'Fin du combat' : `Fin du round ${round}`}</div>`);
  }

  /**
   * Minute de repos.
   * @param {{round:number,total:number,player:object,opponent:object,tips:string[],duration:number}} d
   */
  breakScreen(d) {
    this._clear();
    const p = d.player.matchStats.round(d.round - 1);
    const o = d.opponent.matchStats.round(d.round - 1);
    const pa = p.thrown ? p.landed / p.thrown : 0;
    const oa = o.thrown ? o.landed / o.thrown : 0;
    const rows = [
      [p.landed, 'Coups portés', o.landed],
      [pct(pa), 'Précision', pct(oa)],
      [p.power, 'Coups puissants', o.power],
      [Math.round(p.damage), 'Dégâts infligés', Math.round(o.damage)],
      [p.dodges, 'Esquives réussies', o.dodges],
    ];
    this._show(`
      <div class="break-box" role="dialog" aria-label="Pause entre les rounds">
        <h2>Fin du round ${d.round}</h2>
        <p class="sub">Récupération : votre endurance remonte. Round ${d.round + 1} sur ${d.total} ensuite.</p>
        <table class="cmp">
          ${rows.map(([a, l, b]) => `<tr><td>${esc(a)}</td><td>${esc(l)}</td><td>${esc(b)}</td></tr>`).join('')}
        </table>
        <div class="advice"><b>Conseil du coin</b>${esc(d.tips[0] || '')}</div>
        <div class="countdown"><span>Round ${d.round + 1} dans <b data-id="cd">${Math.ceil(d.duration)} s</b></span>
          <button class="btn small" data-id="skip" type="button">Reprendre maintenant <kbd>Entrée</kbd></button></div>
      </div>`, true);
    this.cd = this.el.querySelector('[data-id="cd"]');
    this.el.querySelector('[data-id="skip"]').addEventListener('click', () => this.onSkip && this.onSkip());
  }

  updateBreak(timeLeft) {
    if (this.cd) this.cd.textContent = `${Math.max(0, Math.ceil(timeLeft))} s`;
  }

  ko(text = 'KNOCKOUT', sub = '') {
    this._clear();
    this.cd = null;
    this._show(`<div class="slam ko">${sub ? `<small>${esc(sub)}</small>` : ''}${esc(text)}</div>`);
  }

  /** Knockdown : le carton s'efface vite pour laisser voir le compte. */
  knockdown(text, sub = '') {
    this._clear();
    this.cd = null;
    this._show(`<div class="slam down">${sub ? `<small>${esc(sub)}</small>` : ''}${esc(text)}</div>`);
    this.timers.push(setTimeout(() => this.hide(), 1150));
  }

  /** Reprise après un compte. */
  resume(text = 'BOX !') {
    this._clear();
    this.cd = null;
    this._show(`<div class="slam fight">${esc(text)}</div>`);
    this.timers.push(setTimeout(() => this.hide(), 1000));
  }
}
