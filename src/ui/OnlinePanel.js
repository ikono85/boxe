/**
 * OnlinePanel.js
 * ------------------------------------------------------------------
 * Écran EN LIGNE (panneau de droite du menu) : nom, boxeur, partie rapide,
 * duel privé (code de 5 lettres + lien), rejoindre avec un code, attente,
 * erreurs, fin de connexion. La connexion elle-même est dans net/Netcode.js.
 */

import { el, esc } from './dom.js';
import { NetSession, MODELS, QUICK_SLOTS, cleanCode, cleanName } from '../net/Netcode.js';

const MODEL_LABELS = { xbot: 'X Bot', beach: 'Short rouge', casual: 'T-shirt', worker: 'Gilet orange' };
const QUICK_FORMAT = { rounds: 3, dur: 60 };

const NET_ERR = {
  lib: ['Module réseau indisponible', 'Le module de connexion n’a pas pu démarrer dans ce navigateur. Rechargez la page et réessayez.'],
  'browser-incompatible': ['Navigateur incompatible', 'Ce navigateur ne gère pas les connexions directes (WebRTC). Essayez un Chrome, Firefox, Edge ou Safari récent.'],
  server: ['Serveur injoignable', 'Le serveur de mise en relation ne répond pas. Vérifiez votre connexion internet, puis réessayez dans un moment.'],
  none: ['Code introuvable', 'Aucun duel n’est ouvert avec ce code. Vérifiez le code, ou demandez à votre ami d’en créer un nouveau.'],
  busy: ['Duel complet', 'Quelqu’un a déjà rejoint ce duel.'],
  version: ['Versions différentes', 'Vous n’avez pas la même version du jeu. Rechargez la page tous les deux, puis recommencez.'],
  closed: ['Connexion impossible', 'Impossible d’établir la connexion directe entre vos deux ordinateurs. Certains réseaux (école, entreprise) la bloquent : essayez depuis un autre réseau, par exemple le partage de connexion d’un téléphone.'],
  full: ['Trop de monde', 'Tous les emplacements de partie rapide sont pris. Réessayez dans un instant, ou créez un duel privé.'],
};

/** Le jeu en ligne a besoin de WebRTC (absent dans certaines pages intégrées). */
function webrtcAvailable() {
  return typeof window !== 'undefined' && typeof window.RTCPeerConnection === 'function';
}

export class OnlinePanel {
  /**
   * @param {object} game le jeu (net/Netcode.js l'appelle pour démarrer les combats)
   * @param {import('../core/Settings.js').Settings} settings
   */
  constructor(game, settings, { onSound } = {}) {
    this.game = game;
    this.settings = settings;
    this.onSound = onSound || (() => {});
    this.el = el('<div class="online" aria-live="polite"></div>');
    this.session = null;
    this.notice = null; // message à afficher en revenant (forfait, coupure…)
    this.home();
  }

  /* ---------- Écrans ---------- */

  _render(html) {
    this.el.innerHTML = html;
    this.$ = {};
    this.el.querySelectorAll('[data-id]').forEach((n) => {
      this.$[n.dataset.id] = n;
    });
  }

  _on(id, fn) {
    const n = this.$[id];
    if (n) n.addEventListener('click', (e) => {
      this.onSound('ui_click');
      fn(e);
    });
  }

  /** Accueil : nom, boxeur, modes. */
  home(prefillCode = '') {
    this._cancelSession();
    const s = this.settings;
    const model = MODELS.includes(s.get('netSkin')) ? s.get('netSkin') : MODELS[0];
    const notice = this.notice;
    this.notice = null;
    const blocked = !webrtcAvailable();
    this._render(`
      <h2 class="panel-title">En ligne</h2>
      <p class="panel-sub">Affrontez un ami ou un inconnu, chacun sur son écran. Vos deux navigateurs se connectent directement.</p>
      ${notice ? `<div class="net-notice ${notice.good ? 'good' : ''}" role="status"><b>${esc(notice.title)}</b>${esc(notice.text)}</div>` : ''}
      ${blocked ? `<div class="net-notice">
          <b>Indisponible ici</b>Cette page ne peut pas ouvrir de connexion directe (WebRTC).
          Jouez en ligne depuis <a href="https://ikono85.github.io/boxe/" target="_blank" rel="noopener">ikono85.github.io/boxe</a>.</div>` : ''}
      <div class="field">
        <label for="net-name">Votre nom de boxeur</label>
        <input id="net-name" class="net-input" data-id="name" type="text" maxlength="14" autocomplete="off" spellcheck="false" placeholder="Boxeur">
      </div>
      <div class="field">
        <div class="label" id="net-model-label">Votre boxeur</div>
        <div class="segmented" role="radiogroup" aria-labelledby="net-model-label" data-id="model">
          ${MODELS.map((m) => `<button type="button" role="radio" data-v="${m}" class="${m === model ? 'on' : ''}" aria-checked="${m === model}">${MODEL_LABELS[m]}</button>`).join('')}
        </div>
      </div>
      <div class="net-actions">
        <button class="btn primary" type="button" data-id="quick" ${blocked ? 'disabled' : ''}>Partie rapide
          <small>Adversaire au hasard · ${QUICK_FORMAT.rounds} rounds de ${QUICK_FORMAT.dur} s</small></button>
        <button class="btn" type="button" data-id="host" ${blocked ? 'disabled' : ''}>Créer un duel privé
          <small>Vous recevez un code à donner à votre ami · ${s.get('rounds')} × ${s.get('roundDuration')} s</small></button>
      </div>
      <div class="field net-join">
        <label for="net-code">Rejoindre avec un code</label>
        <div class="net-join-row">
          <input id="net-code" class="net-input code" data-id="code" type="text" maxlength="5" autocomplete="off" spellcheck="false" autocapitalize="characters" placeholder="ABCDE" value="${esc(cleanCode(prefillCode))}">
          <button class="btn" type="button" data-id="join" ${blocked ? 'disabled' : ''}>Rejoindre</button>
        </div>
        <p class="net-msg" data-id="msg" role="alert"></p>
      </div>
      <p class="hint">Format d’un duel privé : celui de l’hôte (menu Difficulté). Pas de pause en ligne : Échap propose d’abandonner.</p>`);
    this.$.name.value = s.get('netName') || '';
    this.$.name.addEventListener('change', () => this._keepName());
    this.$.model.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.onSound('ui_click');
      s.set('netSkin', b.dataset.v);
      this.$.model.querySelectorAll('button').forEach((x) => {
        x.classList.toggle('on', x === b);
        x.setAttribute('aria-checked', String(x === b));
      });
    });
    const code = this.$.code;
    code.addEventListener('input', () => {
      code.value = cleanCode(code.value);
    });
    code.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._join();
      }
    });
    this._on('quick', () => this._quick());
    this._on('host', () => this._host());
    this._on('join', () => this._join());
    if (prefillCode) setTimeout(() => this.$.name && this.$.name.focus(), 0);
  }

  _keepName() {
    if (this.$.name) this.settings.set('netName', cleanName(this.$.name.value));
  }

  _opts(kind, format) {
    this._keepName();
    return {
      role: null, kind, format,
      name: this.settings.get('netName'),
      model: this.settings.get('netSkin'),
    };
  }

  _quick() {
    this.session = new NetSession(this.game, this, this._opts('quick', QUICK_FORMAT));
    this.session.quickMatch();
  }

  _host() {
    const fmt = { rounds: this.settings.get('rounds'), dur: this.settings.get('roundDuration') };
    this.session = new NetSession(this.game, this, { ...this._opts('private', fmt), role: 'host' });
    this._wait('Duel privé', 'Ouverture du duel…', 'Connexion au serveur de mise en relation');
    this.session.hostPrivate();
  }

  _join() {
    const code = cleanCode(this.$.code.value);
    if (code.length !== 5) {
      this.$.msg.textContent = 'Le code fait 5 caractères.';
      this.$.code.focus();
      return;
    }
    this.session = new NetSession(this.game, this, { ...this._opts('private', null), role: 'guest' });
    this._wait('Rejoindre', `Duel ${code}`, 'Connexion au serveur de mise en relation');
    this.session.joinPrivate(code);
  }

  /** Écran d'attente générique : un message d'état qui change, et Annuler. */
  _wait(title, lead, status, extra = '') {
    this.mode = null;
    this._render(`
      <h2 class="panel-title">${esc(title)}</h2>
      <p class="panel-sub">${esc(lead)}</p>
      ${extra}
      <p class="net-status busy" data-id="status" role="status">${esc(status)}</p>
      <div class="net-actions" data-id="btns"></div>
      <button class="btn small quiet" type="button" data-id="cancel">Annuler</button>`);
    this._on('cancel', () => this.home());
  }

  /* ---------- Appelé par la session (net/Netcode.js) ---------- */

  status(text) {
    if (this.$ && this.$.status) this.$.status.textContent = text;
  }

  /** Hôte d'un duel privé : le code et le lien à envoyer. */
  waiting(N) {
    const link = /^https?:$/.test(location.protocol) ? `${location.href.split('#')[0]}#duel=${N.code}` : null;
    const fmt = N.format ? `${N.format.rounds} round${N.format.rounds > 1 ? 's' : ''} de ${N.format.dur} s` : '';
    this._wait('Duel privé',
      `Envoyez le lien à votre ami, ou dites-lui le code : il choisit « Rejoindre avec un code ». Format : ${fmt}.`,
      'En attente de votre ami',
      `<div class="netcode" aria-label="Code : ${N.code.split('').join(' ')}">${esc(N.code)}</div>`);
    const btns = this.$.btns;
    const copy = (txt, b) => {
      const sub = b.querySelector('small');
      const ok = () => { sub.textContent = 'Copié !'; };
      const ko = () => { sub.textContent = 'Copie impossible : recopiez-le à la main'; };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, ko);
        else ko();
      } catch { ko(); }
    };
    if (link) {
      const b1 = el('<button class="btn primary" type="button">Copier le lien<small>Votre ami l’ouvre et rejoint le duel</small></button>');
      b1.addEventListener('click', () => copy(link, b1));
      btns.appendChild(b1);
    }
    const b2 = el(`<button class="btn ${link ? '' : 'primary'}" type="button">Copier le code<small>${esc(N.code)}</small></button>`);
    b2.addEventListener('click', () => copy(N.code, b2));
    btns.appendChild(b2);
  }

  searching(N, status = 'Connexion au serveur de mise en relation') {
    if (this.mode !== 'search' || !this.$.status) {
      this._wait('Partie rapide',
        `Le combat commence dès qu’un autre joueur lance une partie rapide (${QUICK_SLOTS} places d’attente).`,
        status,
        '<p class="hint">Pour jouer tout de suite avec un ami, créez plutôt un duel privé et envoyez-lui le code.</p>');
      this.mode = 'search';
      const start = performance.now();
      clearInterval(N.uiTimer);
      N.uiTimer = setInterval(() => {
        if (!N.active || N.phase !== 'lobby' || N.conn) return;
        if (!N.waiting) return;
        const s = Math.floor((performance.now() - start) / 1000);
        this.status(`Recherche d’un adversaire, ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      }, 500);
    } else this.status(status);
  }

  error(key, { role, kind, code }) {
    this.session = null;
    this.mode = null;
    const [title, lead] = NET_ERR[key] || NET_ERR.closed;
    this._render(`
      <h2 class="panel-title">${esc(title)}</h2>
      <p class="panel-sub">${esc(lead)}</p>
      <div class="net-actions">
        <button class="btn primary" type="button" data-id="retry">Réessayer</button>
        <button class="btn small quiet" type="button" data-id="back">Retour</button>
      </div>`);
    this._on('retry', () => {
      if (kind === 'quick') this._quick();
      else if (role === 'host') this._host();
      else {
        this.home(code || '');
        if (code) this._join();
      }
    });
    this._on('back', () => this.home());
  }

  /** Message affiché au prochain retour sur l'écran (forfait, coupure…). */
  setNotice(notice) {
    this.notice = notice;
  }

  /** Annule une attente en cours (ex. : le joueur lance un combat solo). */
  cancel() {
    this._cancelSession();
    this.home();
  }

  _cancelSession() {
    this.mode = null;
    if (this.session && this.session.active) this.session.close();
    this.session = null;
  }
}
