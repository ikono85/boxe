/**
 * PauseMenu.js
 * ------------------------------------------------------------------
 * Menu PAUSE (Échap) : Reprendre, Recommencer, Options, Quitter le combat.
 */

import { el } from './dom.js';
import { OptionsPanel } from './OptionsPanel.js';

export class PauseMenu {
  constructor(root, { settings, onResume, onRestart, onQuit, onSound }) {
    this.onSound = onSound || (() => {});
    this.el = el(`
      <div class="screen pause" hidden role="dialog" aria-modal="true" aria-label="Pause">
        <div class="pause-box">
          <div data-id="main">
            <h2>PAUSE</h2>
            <div class="pause-actions">
              <button class="btn primary" type="button" data-action="resume">Reprendre</button>
              <button class="btn" type="button" data-action="restart">Recommencer</button>
              <button class="btn" type="button" data-action="options">Options</button>
              <button class="btn" type="button" data-action="quit">Quitter le combat</button>
            </div>
            <p class="pause-hint" data-id="hint" hidden></p>
          </div>
          <div data-id="opts" hidden></div>
        </div>
      </div>`);
    root.appendChild(this.el);
    this.$ = {};
    this.el.querySelectorAll('[data-id]').forEach((n) => {
      this.$[n.dataset.id] = n;
    });
    this.options = new OptionsPanel(settings, { onBack: () => this._showMain(), onSound: this.onSound });
    this.$.opts.appendChild(this.options.el);
    this.el.querySelector('.pause-actions').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.onSound('ui_click');
      const a = b.dataset.action;
      if (a === 'resume') onResume();
      else if (a === 'restart') onRestart();
      else if (a === 'quit') onQuit();
      else if (a === 'options') this._showOptions();
    });
  }

  _showMain() {
    this.$.main.hidden = false;
    this.$.opts.hidden = true;
    const r = this.el.querySelector('[data-action="resume"]');
    if (r) r.focus({ preventScroll: true });
  }

  _showOptions() {
    this.options.refresh();
    this.$.main.hidden = true;
    this.$.opts.hidden = false;
  }

  get optionsOpen() {
    return !this.$.opts.hidden;
  }

  /**
   * @param {boolean} online en ligne : pas de pause (le combat continue derrière
   * ce menu) ; « Quitter » devient « Abandonner » (victoire par forfait pour l'autre).
   */
  show(online = false) {
    this.el.hidden = false;
    const q = (a) => this.el.querySelector(`[data-action="${a}"]`);
    this.el.querySelector('h2').textContent = online ? 'Quitter le duel ?' : 'PAUSE';
    q('restart').hidden = online;
    q('resume').textContent = online ? 'Reprendre le combat' : 'Reprendre';
    q('quit').textContent = online ? 'Abandonner' : 'Quitter le combat';
    this.setHint(online ? 'Pas de pause en ligne : le combat continue derrière ce menu et votre boxeur ne bouge plus. Abandonner donne la victoire à votre adversaire.' : '');
    this._showMain();
  }

  hide() {
    this.el.hidden = true;
  }

  get visible() {
    return !this.el.hidden;
  }

  setHint(text) {
    this.$.hint.hidden = !text;
    this.$.hint.textContent = text || '';
  }

  /** Échap dans le menu pause : referme les options. */
  back() {
    if (this.optionsOpen) this._showMain();
  }
}
