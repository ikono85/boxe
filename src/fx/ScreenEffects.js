/**
 * ScreenEffects.js
 * ------------------------------------------------------------------
 * Effets plein écran en CSS (pas de post-processing WebGL = économique) :
 * vignette rouge quand on encaisse, flash des coups critiques, pulsation
 * quand la vie est basse, voile sombre quand on est essoufflé, flou quand
 * on est sonné, bandes « cinéma » pendant le ralenti du KO.
 */

export class ScreenEffects {
  constructor(root, canvas) {
    this.canvas = canvas;
    this.el = document.createElement('div');
    this.el.className = 'screen-fx';
    this.el.innerHTML = `
      <div class="fx-damage"></div>
      <div class="fx-lowhp"></div>
      <div class="fx-tired"></div>
      <div class="fx-flash"></div>
      <div class="fx-bars"><i></i><i></i></div>
      <div class="fx-fade"></div>`;
    root.appendChild(this.el);
    this.damage = this.el.querySelector('.fx-damage');
    this.lowhp = this.el.querySelector('.fx-lowhp');
    this.tired = this.el.querySelector('.fx-tired');
    this.flashEl = this.el.querySelector('.fx-flash');
    this.bars = this.el.querySelector('.fx-bars');
    this.fadeEl = this.el.querySelector('.fx-fade');
    this.state = { damage: 0, flash: 0, fade: 0, bars: 0 };
    this.applied = {};
    this.time = 0;
    this.lastFilter = '';
  }

  /** Coup encaissé : intensité 0-1. */
  hit(amount) {
    this.state.damage = Math.min(1, this.state.damage + amount);
  }

  flash(amount = 1) {
    this.state.flash = Math.min(1, Math.max(this.state.flash, amount));
  }

  setBars(on) {
    this.state.barsTarget = on ? 1 : 0;
  }

  setFade(v) {
    this.state.fadeTarget = v;
  }

  reset() {
    this.state = { damage: 0, flash: 0, fade: 0, bars: 0, barsTarget: 0, fadeTarget: 0 };
    this._setFilter('');
  }

  _set(el, key, value) {
    const v = Math.round(value * 100) / 100;
    if (this.applied[key] === v) return;
    this.applied[key] = v;
    el.style.opacity = v;
  }

  _setFilter(f) {
    if (f === this.lastFilter) return;
    this.lastFilter = f;
    this.canvas.style.filter = f;
  }

  /**
   * @param {number} dt temps réel
   * @param {object|null} player état du joueur (null hors combat)
   */
  update(dt, player) {
    this.time += dt;
    const s = this.state;
    s.damage = Math.max(0, s.damage - dt * 2.2);
    s.flash = Math.max(0, s.flash - dt * 5);
    s.bars += ((s.barsTarget || 0) - s.bars) * Math.min(1, dt * 4);
    s.fade += ((s.fadeTarget || 0) - s.fade) * Math.min(1, dt * 1.5);

    let low = 0;
    let tired = 0;
    let filter = '';
    if (player && !player.ko) {
      const hp = player.hp / player.maxHp;
      if (hp < 0.3) low = (0.35 + 0.25 * Math.sin(this.time * 6)) * (1 - hp / 0.3) + 0.15;
      if (player.stamina.isExhausted()) tired = 0.45 + 0.15 * Math.sin(this.time * 3.2);
      if (player.isStunned) {
        const b = 1.6 + Math.sin(this.time * 7) * 0.8;
        filter = `blur(${b.toFixed(1)}px) saturate(0.55)`;
      }
    }
    if (player && player.ko) filter = `saturate(${Math.max(0.2, 1 - player.koTime * 0.6).toFixed(2)})`;
    this._setFilter(filter);

    this._set(this.damage, 'damage', s.damage);
    this._set(this.lowhp, 'lowhp', low);
    this._set(this.tired, 'tired', tired);
    this._set(this.flashEl, 'flash', s.flash);
    this._set(this.fadeEl, 'fade', s.fade);
    const barsV = Math.round(s.bars * 100) / 100;
    if (this.applied.bars !== barsV) {
      this.applied.bars = barsV;
      this.bars.style.setProperty('--bars', barsV);
    }
  }
}
