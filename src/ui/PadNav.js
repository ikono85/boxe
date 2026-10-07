/**
 * PadNav.js
 * ------------------------------------------------------------------
 * Navigation dans les menus à la manette :
 *  - croix ou stick gauche : passe au bouton le plus proche dans la direction ;
 *  - A : active le bouton (ou coche la case) ; sur un curseur, gauche / droite
 *    changent la valeur ;
 *  - B : retour (le jeu décide quoi faire : fermer un panneau, reprendre…).
 *
 * Seul l'écran au premier plan est parcouru (pause, résultats, carton de
 * pause entre les rounds, menu principal).
 */

const LAYERS = ['.screen.pause:not([hidden])', '.screen.results:not([hidden])', '.overlay:not([hidden])', '.screen.menu:not([hidden])'];
const FOCUSABLE = 'button, input, select, a[href], [tabindex]:not([tabindex="-1"])';
const DIRS = {
  Pad12: 'up', PadUp: 'up', Pad13: 'down', PadDown: 'down', Pad14: 'left', PadLeft: 'left', Pad15: 'right', PadRight: 'right',
};

export class PadNav {
  /**
   * @param {HTMLElement} root racine de l'interface
   * @param {{onBack?: () => boolean}} opts onBack retourne true s'il a traité le retour
   */
  constructor(root, { onBack } = {}) {
    this.root = root;
    this.onBack = onBack || (() => false);
    this.current = null;
  }

  /** Traite un appui de la manette. Retourne true s'il a servi. */
  handle(code) {
    const layer = this._layer();
    if (!layer) return false;
    if (DIRS[code]) {
      this._move(layer, DIRS[code]);
      return true;
    }
    if (code === 'Pad0') {
      const cur = this._valid(layer) ? this.current : null;
      if (!cur) {
        this._focus(this._first(layer));
        return true;
      }
      if (cur.type === 'range') return true;
      cur.click();
      // Le contenu a pu changer (nouveau panneau) : on garde le focus s'il existe encore
      requestAnimationFrame(() => {
        if (!this._valid(this._layer())) this._focus(this._first(this._layer()));
      });
      return true;
    }
    if (code === 'Pad1') return this.onBack();
    return false;
  }

  /** Oublie le focus (changement d'écran). */
  reset() {
    if (this.current) this.current.classList.remove('pad-focus');
    this.current = null;
  }

  _layer() {
    for (const sel of LAYERS) {
      const el = this.root.querySelector(sel);
      if (el && this._candidates(el).length) return el;
    }
    return null;
  }

  _candidates(layer) {
    if (!layer) return [];
    return [...layer.querySelectorAll(FOCUSABLE)].filter((el) => {
      if (el.disabled || el.closest('[hidden]')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }

  _valid(layer) {
    return !!this.current && !!layer && layer.contains(this.current) && this._candidates(layer).includes(this.current);
  }

  _first(layer) {
    const list = this._candidates(layer);
    return list.find((el) => el.classList.contains('primary') || el.classList.contains('selected')) || list[0] || null;
  }

  _focus(el) {
    if (this.current) this.current.classList.remove('pad-focus');
    this.current = el;
    if (!el) return;
    el.classList.add('pad-focus');
    try {
      el.focus({ preventScroll: false });
    } catch {
      /* élément non focalisable : la classe suffit */
    }
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  _move(layer, dir) {
    const cur = this._valid(layer) ? this.current : null;
    if (!cur) {
      this._focus(this._first(layer));
      return;
    }
    // Curseur : gauche / droite changent la valeur
    if (cur.type === 'range' && (dir === 'left' || dir === 'right')) {
      for (let i = 0; i < 4; i++) (dir === 'right' ? cur.stepUp() : cur.stepDown());
      cur.dispatchEvent(new Event('input', { bubbles: true }));
      cur.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best = null;
    let bestScore = Infinity;
    for (const el of this._candidates(layer)) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      const dx = b.left + b.width / 2 - ax;
      const dy = b.top + b.height / 2 - ay;
      let main;
      let side;
      if (dir === 'up') [main, side] = [-dy, dx];
      else if (dir === 'down') [main, side] = [dy, dx];
      else if (dir === 'left') [main, side] = [-dx, dy];
      else [main, side] = [dx, dy];
      if (main <= 2) continue;
      const score = main + Math.abs(side) * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (!best) return;
    // En entrant dans un autre bloc (menu → panneau), on arrive sur l'élément choisi
    const group = (el) => el.closest('.side-panel, .menu-main, .cards, .segmented') || layer;
    if (group(best) !== group(cur)) {
      const g = group(best);
      const sel = g.querySelector('.selected, .on, [aria-pressed="true"]');
      if (sel && this._candidates(layer).includes(sel)) best = sel;
    }
    this._focus(best);
  }
}
