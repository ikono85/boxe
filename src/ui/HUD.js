/**
 * HUD.js
 * ------------------------------------------------------------------
 * Interface de combat, minimaliste :
 *  - en haut : vie et endurance des deux boxeurs, round et chrono ;
 *  - au centre : réticule (tête / corps), marqueur d'impact, messages
 *    (combo, contre, critique, bloqué, esquivé…) ;
 *  - en bas : commandes, état de la garde, endurance, score.
 * Le DOM n'est modifié que lorsque les valeurs changent.
 */

import { el, esc, clock, num } from './dom.js';

export class HUD {
  constructor(root) {
    this.el = el(`
      <div class="hud" hidden>
        <div class="hud-top">
          <div class="fighter me">
            <div class="fighter-name"><span data-id="pname">Vous</span><small data-id="psub">Coin rouge</small></div>
            <div class="meter"><span class="ico" aria-hidden="true">❤️</span>
              <div class="bar hp" data-id="php"><div class="ghost"></div><div class="fill"></div><div class="ticks"></div></div>
              <span class="val" data-id="phpv">100</span></div>
            <div class="meter"><span class="ico" aria-hidden="true">⚡</span>
              <div class="bar st thin" data-id="pst"><div class="fill"></div></div>
              <span class="val" data-id="pstv">100</span></div>
            <div class="chips" data-id="pchips"></div>
          </div>
          <div class="round-card" data-id="round">
            <div class="r" data-id="rlabel">ROUND 1 / 3</div>
            <div class="clock" data-id="clock">1:00</div>
          </div>
          <div class="fighter opp">
            <div class="fighter-name"><span data-id="oname">Adversaire</span><small data-id="osub"></small></div>
            <div class="meter"><span class="ico" aria-hidden="true">❤️</span>
              <div class="bar hp" data-id="ohp"><div class="ghost"></div><div class="fill"></div><div class="ticks"></div></div>
              <span class="val" data-id="ohpv">100</span></div>
            <div class="meter"><span class="ico" aria-hidden="true">⚡</span>
              <div class="bar st thin" data-id="ost"><div class="fill"></div></div>
              <span class="val" data-id="ostv">100</span></div>
            <div class="chips" data-id="ochips"></div>
          </div>
        </div>

        <div class="crosshair" data-id="cross">
          <div class="dot"></div>
          <div class="hitmarker" data-id="hm"><i></i><i></i><i></i><i></i></div>
          <div class="zone" data-id="zone"></div>
        </div>
        <div class="feed" data-id="feed" aria-live="polite"></div>
        <div class="lock-hint" data-id="lock" hidden>Cliquez pour reprendre le combat</div>
        <div class="fps" data-id="fps" hidden></div>

        <div class="hud-bottom">
          <div class="legend" data-id="legend">
            <span class="k"><kbd>Clic G</kbd> <kbd>Clic D</kbd></span><span>Jab · Direct</span>
            <span class="k"><kbd>E</kbd> <kbd>R</kbd></span><span>Crochets</span>
            <span class="k"><kbd>F</kbd> <kbd>G</kbd></span><span>Uppercuts</span>
            <span class="k"><kbd>Espace</kbd></span><span>Garde (regard bas = corps)</span>
            <span class="k"><kbd>Maj</kbd> + dir.</span><span>Esquive</span>
            <span class="k"><kbd>H</kbd></span><span>Masquer l'aide</span>
          </div>
          <div class="status">
            <div class="pill" data-id="guard">Garde</div>
            <div class="pill stamina" data-id="stam"><span aria-hidden="true">⚡</span><span class="mini"><b data-id="stambar"></b></span><span data-id="stamtxt">Souffle</span></div>
          </div>
          <div class="scorebox">
            <div class="s" data-id="score">0</div>
            <div class="acc" data-id="acc">0 coup</div>
          </div>
        </div>
      </div>`);
    root.appendChild(this.el);
    this.$ = {};
    this.el.querySelectorAll('[data-id]').forEach((n) => {
      this.$[n.dataset.id] = n;
    });
    this.cache = {};
    this.ghost = { p: 1, o: 1, pDelay: 0, oDelay: 0, pPrev: 1, oPrev: 1 };
  }

  show() {
    this.el.hidden = false;
  }

  hide() {
    this.el.hidden = true;
  }

  setFighters(player, opponent, { opponentSub = '' } = {}) {
    this.$.pname.textContent = player.name;
    this.$.oname.textContent = opponent.name;
    this.$.osub.textContent = opponentSub;
    this.cache = {};
    this.ghost = { p: 1, o: 1, pDelay: 0, oDelay: 0, pPrev: 1, oPrev: 1 };
    this.$.feed.textContent = '';
  }

  _text(key, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    this.$[key].textContent = value;
  }

  _scale(key, node, value) {
    const v = Math.round(value * 1000) / 1000;
    if (this.cache[key] === v) return;
    this.cache[key] = v;
    node.style.transform = `scaleX(${v})`;
  }

  _class(key, node, cls, on) {
    const k = `${key}:${cls}`;
    if (this.cache[k] === on) return;
    this.cache[k] = on;
    node.classList.toggle(cls, on);
  }

  _chips(key, node, list) {
    const sig = list.map((c) => c.join(':')).join('|');
    if (this.cache[key] === sig) return;
    this.cache[key] = sig;
    node.innerHTML = list.map(([cls, txt]) => `<span class="chip ${cls}">${esc(txt)}</span>`).join('');
  }

  _bars(prefix, f, dt) {
    const ratio = f.hp / f.maxHp;
    const g = this.ghost;
    // Barre « fantôme » : montre les dégâts récents puis se vide
    if (ratio < g[`${prefix}Prev`]) g[`${prefix}Delay`] = 0.45;
    g[`${prefix}Prev`] = ratio;
    if (g[`${prefix}Delay`] > 0) g[`${prefix}Delay`] -= dt;
    else g[prefix] = Math.max(ratio, g[prefix] - dt * 0.6);
    if (g[prefix] < ratio) g[prefix] = ratio;

    const hpBar = this.$[`${prefix}hp`];
    this._scale(`${prefix}hpf`, hpBar.children[1], ratio);
    this._scale(`${prefix}hpg`, hpBar.children[0], g[prefix]);
    this._class(`${prefix}hp`, hpBar, 'low', ratio < 0.25);
    this._text(`${prefix}hpv`, String(Math.ceil(f.hp)));
    const st = f.stamina.ratio;
    this._scale(`${prefix}stf`, this.$[`${prefix}st`].children[0], st);
    this._text(`${prefix}stv`, String(Math.round(f.stamina.value)));
  }

  /**
   * @param {number} dt temps réel
   * @param {object} s état : player, opponent, round, total, timeLeft, score, fps, showControls
   */
  update(dt, s) {
    const { player, opponent } = s;
    this._bars('p', player, dt);
    this._bars('o', opponent, dt);

    // États sous les barres
    const chipsFor = (f) => {
      const list = [];
      if (f.ko) list.push(['danger', 'KO']);
      else if (f.isStunned) list.push(['danger', 'Sonné']);
      if (!f.ko && f.guard.brokenTimer > 0) list.push(['danger', 'Garde brisée']);
      if (!f.ko && f.stamina.isExhausted()) list.push(['warn', 'Essoufflé']);
      return list;
    };
    this._chips('pchips', this.$.pchips, chipsFor(player));
    this._chips('ochips', this.$.ochips, chipsFor(opponent));

    // Round et chrono
    this._text('rlabel', `ROUND ${s.round} / ${s.total}`);
    this._text('clock', clock(s.timeLeft));
    this._class('round', this.$.round, 'hurry', s.phase === 'fighting' && s.timeLeft <= 10);

    // Réticule
    const aim = player.aim;
    this._class('cross', this.$.cross, 'body', aim.zone === 'body');
    this._class('cross', this.$.cross, 'off', !aim.onTarget);
    this._text('zone', aim.onTarget && aim.inRange ? (aim.zone === 'body' ? 'Corps' : 'Tête') : '');

    // Garde
    const g = player.guard;
    let guardTxt = 'Garde';
    if (g.brokenTimer > 0) guardTxt = 'Garde brisée';
    else if (g.amount > 0.5) guardTxt = g.low ? 'Garde basse' : 'Garde haute';
    this._text('guard', guardTxt);
    this._class('guard', this.$.guard, 'on', g.amount > 0.5 && g.brokenTimer <= 0);
    this._class('guard', this.$.guard, 'low-guard', g.low);
    this._class('guard', this.$.guard, 'broken', g.brokenTimer > 0);

    // Endurance (rappel en bas)
    this._scale('stambar', this.$.stambar, player.stamina.ratio);
    const tired = player.stamina.isExhausted();
    this._text('stamtxt', tired ? 'Essoufflé' : player.stamina.ratio < 0.45 ? 'Souffle court' : 'Souffle');
    this._class('stam', this.$.stam, 'tired', tired);

    // Score
    this._text('score', num(s.score));
    const ms = player.matchStats;
    this._text('acc', ms.thrown ? `${ms.landed} / ${ms.thrown} coups · ${Math.round((ms.landed / ms.thrown) * 100)} %` : 'Aucun coup lancé');

    this.$.legend.hidden = !s.showControls;
    if (s.fps !== null && s.fps !== undefined) {
      this.$.fps.hidden = false;
      this._text('fps', `${s.fps} FPS`);
    } else this.$.fps.hidden = true;
  }

  /** Message central éphémère. kind : combo | crit | counter | muted | good | bad */
  message(text, kind = '') {
    const feed = this.$.feed;
    const item = document.createElement('div');
    item.className = `feed-item ${kind}`;
    item.textContent = text;
    feed.appendChild(item);
    while (feed.children.length > 3) feed.firstElementChild.remove();
    setTimeout(() => item.remove(), 1350);
  }

  /** Marqueur d'impact au centre. kind : '' | 'crit' | 'block' */
  hitmarker(kind = '') {
    const hm = this.$.hm;
    hm.className = 'hitmarker';
    void hm.offsetWidth; // relance l'animation
    hm.className = `hitmarker show ${kind}`;
  }

  setLockHint(visible, text) {
    this.$.lock.hidden = !visible;
    if (text) this.$.lock.textContent = text;
  }

  onLockHintClick(fn) {
    this.$.lock.addEventListener('click', fn);
  }
}
