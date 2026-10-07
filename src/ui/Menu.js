/**
 * Menu.js
 * ------------------------------------------------------------------
 * Écran d'accueil BOXING ARENA, réduit à JOUER et OPTIONS.
 *
 * Les boxeurs et le combat ont été retirés pour être refaits : « Jouer »
 * n'ouvre plus un match, il montre simplement la salle en plein écran. Les
 * entrées Difficulté, Adversaire, En ligne et Commandes ont disparu avec les
 * systèmes qu'elles réglaient.
 *
 * La salle 3D tourne en arrière-plan.
 */

import { el } from './dom.js';
import { OptionsPanel } from './OptionsPanel.js';

export class Menu {
  constructor(root, { settings, onPlay, onSound }) {
    this.settings = settings;
    this.onPlay = onPlay;
    this.onSound = onSound || (() => {});
    this.panel = 'poster';
    const touch = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    this.el = el(`
      <div class="screen menu" hidden>
        <div class="menu-main">
          <h1 class="title"><span class="t1">Boxing</span><span class="t2">Arena</span></h1>
          <p class="tagline">La salle, le ring et le public. Les boxeurs sont à refaire.</p>
          <ul class="menu-list" role="menu">
            <li><button class="menu-item primary" type="button" data-action="play">Jouer</button></li>
            <li><button class="menu-item" type="button" data-action="options">Options</button></li>
          </ul>
          <div class="menu-foot" data-id="foot"></div>
          ${touch ? '<div class="touch-note">Ce jeu se joue sur ordinateur, au clavier et à la souris ou à la manette.</div>' : ''}
        </div>
        <aside class="side-panel" data-id="panel" aria-live="polite"></aside>
      </div>`);
    root.appendChild(this.el);
    this.$ = {};
    this.el.querySelectorAll('[data-id]').forEach((n) => {
      this.$[n.dataset.id] = n;
    });
    this.options = new OptionsPanel(settings, { onBack: () => this.showPanel('poster'), onSound: this.onSound });

    this.el.querySelector('.menu-list').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const a = b.dataset.action;
      this.onSound('ui_click');
      if (a === 'play') this.onPlay();
      else this.showPanel(this.panel === a ? 'poster' : a);
    });
    this.el.querySelectorAll('.menu-item').forEach((b) => b.addEventListener('mouseenter', () => this.onSound('ui_hover')));
    this.showPanel('poster');
  }

  show(panel = null) {
    this.el.hidden = false;
    if (panel) this.panel = panel;
    this.refresh();
  }

  hide() {
    this.el.hidden = true;
  }

  refresh() {
    this.$.foot.innerHTML = '<span>Aucun combat : la salle tourne à vide.</span>';
    this.el.querySelectorAll('.menu-item').forEach((b) => b.classList.toggle('active', b.dataset.action === this.panel));
    this.showPanel(this.panel, true);
  }

  showPanel(name) {
    this.panel = name;
    const p = this.$.panel;
    p.innerHTML = '';
    if (name === 'options') {
      this.options.refresh();
      p.appendChild(this.options.el);
    } else {
      p.appendChild(this._posterPanel());
    }
    this.el.querySelectorAll('.menu-item').forEach((b) => b.classList.toggle('active', b.dataset.action === name));
  }

  _posterPanel() {
    return el(`
      <div>
        <h2 class="panel-title">Ce soir</h2>
        <p class="hint">Les boxeurs, l'arbitre et tout le système de combat ont été retirés du jeu
        pour être refaits. Il reste la salle : le ring, le public, les lumières et la caméra.</p>
        <p class="hint">« Jouer » montre la salle en plein écran. Échap, ou B à la manette, ramène ici.</p>
        <p class="hint">L'historique git contient la version complète, jusqu'au commit
        « Poings nus à la place des gants ».</p>
      </div>`);
  }
}
