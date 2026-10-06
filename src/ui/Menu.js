/**
 * Menu.js
 * ------------------------------------------------------------------
 * Écran d'accueil BOXING ARENA : JOUER, DIFFICULTÉ, OPTIONS, COMMANDES.
 * Le panneau de droite affiche l'affiche du combat (« tale of the tape ») ou
 * le sous-menu choisi. La salle 3D tourne en arrière-plan.
 */

import { el, esc, num } from './dom.js';
import { OptionsPanel } from './OptionsPanel.js';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../config/Difficulty.js';
import { BOXERS } from '../config/Boxers.js';
import { CONTROL_HELP } from '../config/Controls.js';
import { COMBOS } from '../config/Punches.js';

const STAT_LABELS = [
  ['power', 'Puissance', 0.7, 1.2],
  ['speed', 'Vitesse', 0.8, 1.15],
  ['defense', 'Défense', 0.8, 1.15],
  ['staminaRegen', 'Endurance', 0.8, 1.15],
];

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
          <p class="tagline">Boxe en vue subjective. Trois rounds, un adversaire qui vous lit.</p>
          <ul class="menu-list" role="menu">
            <li><button class="menu-item primary" type="button" data-action="play">Jouer</button></li>
            <li><button class="menu-item" type="button" data-action="difficulty">Difficulté <small data-id="diffLabel"></small></button></li>
            <li><button class="menu-item" type="button" data-action="options">Options</button></li>
            <li><button class="menu-item" type="button" data-action="controls">Commandes</button></li>
          </ul>
          <div class="menu-foot" data-id="foot"></div>
          ${touch ? '<div class="touch-note">Ce jeu se joue au clavier et à la souris, sur ordinateur.</div>' : ''}
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

  show() {
    this.el.hidden = false;
    this.refresh();
  }

  hide() {
    this.el.hidden = true;
  }

  refresh() {
    const d = DIFFICULTIES[this.settings.get('difficulty')] || DIFFICULTIES.intermediate;
    this.$.diffLabel.textContent = d.label;
    const best = this.settings.bestScore(d.id);
    this.$.foot.innerHTML = `<span>Format : <b>${this.settings.get('rounds')} × ${this.settings.get('roundDuration')} s</b></span>`
      + `<span>Record (${esc(d.label)}) : <b>${best ? num(best) : '—'}</b></span>`;
    this.el.querySelectorAll('.menu-item').forEach((b) => b.classList.toggle('active', b.dataset.action === this.panel));
    this.showPanel(this.panel, true);
  }

  showPanel(name, silent = false) {
    this.panel = name;
    const p = this.$.panel;
    p.innerHTML = '';
    if (name === 'options') {
      this.options.refresh();
      p.appendChild(this.options.el);
    } else if (name === 'difficulty') p.appendChild(this._difficultyPanel());
    else if (name === 'controls') p.appendChild(this._controlsPanel());
    else p.appendChild(this._posterPanel());
    this.el.querySelectorAll('.menu-item').forEach((b) => b.classList.toggle('active', b.dataset.action === name));
    if (!silent) this.$.diffLabel.textContent = (DIFFICULTIES[this.settings.get('difficulty')] || {}).label || '';
  }

  /** Affiche du combat : comparaison des deux boxeurs. */
  _posterPanel() {
    const d = DIFFICULTIES[this.settings.get('difficulty')] || DIFFICULTIES.intermediate;
    const o = BOXERS[d.opponent];
    const t = o.tape;
    const row = (a, l, b) => `<tr><td>${esc(a)}</td><td>${esc(l)}</td><td>${esc(b)}</td></tr>`;
    return el(`
      <div>
        <h2 class="panel-title">Ce soir</h2>
        <div class="poster">
          <div class="corner red"><small>Coin rouge</small>Vous</div>
          <div class="vs">VS</div>
          <div class="corner blue"><small>Coin bleu · ${esc(o.nickname)}</small>${esc(o.name)}</div>
        </div>
        <table class="tape">
          ${row('—', 'Âge', `${t.age} ans`)}
          ${row('180 cm', 'Taille', `${t.height} cm`)}
          ${row('183 cm', 'Allonge', `${t.reach} cm`)}
          ${row('76 kg', 'Poids', `${t.weight} kg`)}
          ${row('0-0-0', 'Palmarès', `${t.record} (${t.kos} KO)`)}
          ${row('—', 'Ville', o.hometown)}
        </table>
        <div class="fight-format">
          <span>Niveau <b>${esc(d.label)}</b></span>
          <span><b>${this.settings.get('rounds')}</b> rounds de <b>${this.settings.get('roundDuration')} s</b></span>
        </div>
        <p class="hint">${esc(o.style)}</p>
      </div>`);
  }

  _difficultyPanel() {
    const current = this.settings.get('difficulty');
    const cards = DIFFICULTY_ORDER.map((id) => {
      const d = DIFFICULTIES[id];
      const o = BOXERS[d.opponent];
      const bars = STAT_LABELS.map(([k, label, lo, hi]) => {
        const v = Math.max(0.08, Math.min(1, (o.stats[k] - lo) / (hi - lo)));
        return `<span class="stat">${label}<i style="--v:${Math.round(v * 100)}%"></i></span>`;
      }).join('');
      return `<button type="button" class="card ${id === current ? 'selected' : ''}" data-diff="${id}" aria-pressed="${id === current}">
          <span class="lvl">${esc(d.label)}</span>
          <span class="who">${esc(o.name)} · « ${esc(o.nickname)} »</span>
          <span class="desc">${esc(d.description)}</span>
          <span class="bars">${bars}</span>
        </button>`;
    }).join('');
    const rounds = this.settings.get('rounds');
    const dur = this.settings.get('roundDuration');
    const node = el(`
      <div>
        <h2 class="panel-title">Difficulté</h2>
        <p class="panel-sub">Chaque niveau a son propre adversaire et sa propre façon de boxer.</p>
        <div class="cards">${cards}</div>
        <div class="field">
          <div class="label">Nombre de rounds</div>
          <div class="segmented" data-id="rounds">
            ${[1, 3, 5].map((n) => `<button type="button" class="${n === rounds ? 'on' : ''}" data-v="${n}">${n}</button>`).join('')}
          </div>
        </div>
        <div class="field">
          <div class="label">Durée d'un round</div>
          <div class="segmented" data-id="dur">
            ${[60, 90, 120].map((n) => `<button type="button" class="${n === dur ? 'on' : ''}" data-v="${n}">${n} s</button>`).join('')}
          </div>
        </div>
      </div>`);
    node.querySelector('.cards').addEventListener('click', (e) => {
      const c = e.target.closest('.card');
      if (!c) return;
      this.settings.set('difficulty', c.dataset.diff);
      this.onSound('ui_click');
      this.refresh();
      this.showPanel('difficulty');
    });
    node.querySelector('[data-id="rounds"]').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.settings.set('rounds', Number(b.dataset.v));
      this.onSound('ui_click');
      this.refresh();
      this.showPanel('difficulty');
    });
    node.querySelector('[data-id="dur"]').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.settings.set('roundDuration', Number(b.dataset.v));
      this.onSound('ui_click');
      this.refresh();
      this.showPanel('difficulty');
    });
    return node;
  }

  _controlsPanel() {
    const rows = CONTROL_HELP.map((c) => {
      const keys = c.keys.map((k) => (k.startsWith('+') ? `<em>${esc(k)}</em>` : `<kbd>${esc(k)}</kbd>`)).join('');
      return `<div class="keys">${keys}${c.alt ? `<em>${esc(c.alt)}</em>` : ''}</div><div>${esc(c.action)}</div>`;
    }).join('');
    const combos = COMBOS.map((c) => `<li><b>${esc(c.name)}</b> · +${Math.round(c.damageBonus * 100)} % sur le dernier coup</li>`).join('');
    return el(`
      <div>
        <h2 class="panel-title">Commandes</h2>
        <div class="controls-list">${rows}</div>
        <p class="hint">Visez la tête ou le corps avec le regard. Les coups au corps vident l'endurance adverse ; regarder vers le bas en gardant protège le ventre.</p>
        <p class="hint">Esquives : de côté contre les directs et uppercuts, tête baissée contre les directs et crochets, recul contre tout. Un coup placé juste après une esquive ou un blocage est un contre.</p>
        <ul class="combo-list">${combos}</ul>
      </div>`);
  }
}
