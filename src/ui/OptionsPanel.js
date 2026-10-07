/**
 * OptionsPanel.js
 * ------------------------------------------------------------------
 * Formulaire des options, partagé entre le menu principal et la pause.
 * Chaque contrôle écrit directement dans Settings (sauvegarde automatique).
 */

import { el } from './dom.js';

let instance = 0;

export class OptionsPanel {
  constructor(settings, { onBack = null, onSound = null } = {}) {
    this.settings = settings;
    this.onSound = onSound;
    const id = `opt${++instance}`;
    this.el = el(`
      <div class="options">
        <h2 class="panel-title">Options</h2>
        <div class="field">
          <label for="${id}-sens">Sensibilité de la souris <output data-id="sensOut"></output></label>
          <input id="${id}-sens" data-id="sens" type="range" min="0.2" max="3" step="0.05">
        </div>
        <div class="field">
          <label for="${id}-master">Volume général <output data-id="masterOut"></output></label>
          <input id="${id}-master" data-id="master" type="range" min="0" max="1" step="0.01">
        </div>
        <div class="field">
          <label for="${id}-sfx">Volume des effets <output data-id="sfxOut"></output></label>
          <input id="${id}-sfx" data-id="sfx" type="range" min="0" max="1" step="0.01">
        </div>
        <div class="field">
          <div class="label" id="${id}-q-label">Qualité graphique</div>
          <div class="segmented" role="radiogroup" aria-labelledby="${id}-q-label" data-id="quality">
            <button type="button" role="radio" data-value="low">Basse</button>
            <button type="button" role="radio" data-value="medium">Moyenne</button>
            <button type="button" role="radio" data-value="high">Haute</button>
          </div>
        </div>
        <label class="toggle" for="${id}-shake">Camera shake <input id="${id}-shake" data-id="shake" type="checkbox"></label>
        <label class="toggle" for="${id}-assist">Aide à la visée <input id="${id}-assist" data-id="assist" type="checkbox"></label>
        <label class="toggle" for="${id}-invert">Inverser l'axe vertical <input id="${id}-invert" data-id="invert" type="checkbox"></label>
        <label class="toggle" for="${id}-help">Afficher l'aide des commandes <input id="${id}-help" data-id="help" type="checkbox"></label>
        <label class="toggle" for="${id}-fps">Afficher les FPS <input id="${id}-fps" data-id="fps" type="checkbox"></label>
        <p class="hint">Qualité basse : ring simplifié, sans ombres, moins de public et de particules. À choisir si le jeu descend sous 60 FPS.</p>
        <p class="hint credits">Ring 3D : « <a href="https://sketchfab.com/3d-models/professional-boxing-ring-a2b5a268fc5149e78ccf4bbe2a64b399" target="_blank" rel="noopener">Professional Boxing Ring</a> » par <a href="https://sketchfab.com/al1905" target="_blank" rel="noopener">A1905</a>, licence <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a> (allégé et adapté pour le jeu). Boxeurs : personnage et animations <a href="https://www.mixamo.com" target="_blank" rel="noopener">Mixamo</a>.</p>
        ${onBack ? '<button class="btn small" type="button" data-id="back">Retour</button>' : ''}
      </div>`);
    this.$ = {};
    this.el.querySelectorAll('[data-id]').forEach((n) => {
      this.$[n.dataset.id] = n;
    });
    this._bind(onBack);
    this.refresh();
  }

  _bind(onBack) {
    const s = this.settings;
    const $ = this.$;
    $.sens.addEventListener('input', () => {
      s.set('mouseSensitivity', Number($.sens.value));
      this.refresh();
    });
    $.master.addEventListener('input', () => {
      s.set('masterVolume', Number($.master.value));
      this.refresh();
    });
    $.sfx.addEventListener('input', () => {
      s.set('sfxVolume', Number($.sfx.value));
      this.refresh();
    });
    $.sfx.addEventListener('change', () => this.onSound && this.onSound('impact_head'));
    $.quality.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      s.set('quality', b.dataset.value);
      this.onSound && this.onSound('ui_click');
      this.refresh();
    });
    const toggles = { shake: 'cameraShake', assist: 'aimAssist', invert: 'invertY', help: 'showControls', fps: 'showFps' };
    for (const [k, key] of Object.entries(toggles)) {
      $[k].addEventListener('change', () => {
        s.set(key, $[k].checked);
        this.onSound && this.onSound('ui_click');
      });
    }
    if (onBack && $.back) $.back.addEventListener('click', onBack);
  }

  /** Relit les réglages (ils ont pu changer ailleurs). */
  refresh() {
    const v = this.settings.values;
    const $ = this.$;
    $.sens.value = v.mouseSensitivity;
    $.sensOut.textContent = `× ${Number(v.mouseSensitivity).toFixed(2)}`;
    $.master.value = v.masterVolume;
    $.masterOut.textContent = `${Math.round(v.masterVolume * 100)} %`;
    $.sfx.value = v.sfxVolume;
    $.sfxOut.textContent = `${Math.round(v.sfxVolume * 100)} %`;
    for (const b of $.quality.querySelectorAll('button')) {
      const on = b.dataset.value === v.quality;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    $.shake.checked = v.cameraShake;
    $.assist.checked = v.aimAssist;
    $.invert.checked = v.invertY;
    $.help.checked = v.showControls;
    $.fps.checked = v.showFps;
  }
}
