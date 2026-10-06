/**
 * Netcode.js
 * ------------------------------------------------------------------
 * EN LIGNE : duel entre deux navigateurs (WebRTC via PeerJS), netcode à rollback.
 * Même fonctionnement que Dohyo Duel.
 *
 * Pas de serveur de jeu. PeerJS passe par un serveur public gratuit juste pour
 * que les deux joueurs se trouvent ; ensuite les deux navigateurs se parlent en
 * direct (WebRTC). Chacun simule le même combat (simulation déterministe,
 * net/OnlineWorld.js) et on ne s'échange que les commandes (net/Command.js).
 * Celle de l'adversaire arrive en retard : en attendant, on la prédit (il
 * continue ce qu'il faisait) ; quand la vraie diffère, on revient à l'état
 * sauvegardé et on resimule jusqu'à maintenant (rollback). Math.sin, Math.exp…
 * peuvent différer d'un navigateur à l'autre au dernier chiffre près : l'hôte
 * envoie donc son état toutes les 0,5 s pour corriger.
 *
 * Le jeu (game/Game.js) fournit l'affichage : `game.online*` (démarrage, événements
 * à présenter, fin de match) ; l'écran En ligne (ui/OnlinePanel.js) affiche les
 * étapes de la connexion via `ui.*`.
 */

import { Peer } from 'peerjs';
import { OnlineWorld, SIM_HZ, DT, eventKey } from './OnlineWorld.js';
import { captureState, restoreState } from './SimState.js';
import { NO_COMMAND, PRESSED_BITS, predictCommand, sameCommand, sanitizeCommand } from './Command.js';

export const NET_VER = 1;
const NET_DELAY = 2; // mes commandes s'appliquent 2 ticks plus tard (33 ms) : moins de corrections
const NET_MAX_AHEAD = 40; // plus de 0,66 s d'avance sur ce qu'on sait de l'adversaire : on l'attend
const NET_SYNC_EVERY = 30; // l'hôte envoie son état toutes les 0,5 s
const NET_KEEP = 240; // états gardés pour revenir en arrière (4 s)
const NET_TIMEOUT = 8000; // ms sans aucun message : connexion perdue
export const PEER_PREFIX = 'boxing-arena-v1-';
export const QUICK_SLOTS = 6; // partie rapide : jusqu'à 6 joueurs en attente en même temps
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // ni 0/O ni 1/I/L
export const MODELS = ['xbot', 'beach', 'casual', 'worker'];
const FORMATS = { rounds: [1, 3, 5], dur: [60, 90, 120] };

export const cleanName = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 14);
export const cleanCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

export function randomCode() {
  const b = new Uint8Array(5);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
}

/** Session courante (une seule à la fois). */
let current = null;
export const currentSession = () => current;

/* ================================================================
 * Connexion PeerJS
 * ================================================================ */

function peerOpts() {
  return Object.assign({ debug: 0 }, window.__peerOpts || {});
}

/** Ouvre une connexion au serveur de mise en relation. id null = identifiant au hasard. */
function openPeer(id) {
  return new Promise((res) => {
    let done = false;
    let p;
    const fin = (r) => {
      if (!done) {
        done = true;
        clearTimeout(to);
        res(r);
      }
    };
    const to = setTimeout(() => {
      try { p.destroy(); } catch { /* déjà fermé */ }
      fin({ error: 'timeout' });
    }, 15000);
    try {
      p = id ? new Peer(id, peerOpts()) : new Peer(peerOpts());
    } catch {
      fin({ error: 'browser-incompatible' });
      return;
    }
    p.on('open', () => fin({ peer: p }));
    p.on('error', (err) => {
      if (!done) {
        try { p.destroy(); } catch { /* déjà fermé */ }
        fin({ error: (err && err.type) || 'unknown' });
      }
    });
  });
}

/**
 * Tente de rejoindre l'hôte `target` : connexion directe, « hello », puis attend son « start ».
 * Résout { conn, start } ou { error: 'none' | 'busy' | 'version' | 'closed' | 'timeout' }.
 */
function tryConnect(peer, target, hello) {
  return new Promise((res) => {
    let done = false;
    let conn;
    const onErr = (err) => {
      if (err && err.type === 'peer-unavailable' && String(err.message || '').endsWith(target)) fin({ error: 'none' });
    };
    const fin = (r) => {
      if (done) return;
      done = true;
      clearTimeout(to);
      peer.off('error', onErr);
      if (!r.conn && conn) try { conn.close(); } catch { /* déjà fermé */ }
      res(r);
    };
    peer.on('error', onErr);
    const to = setTimeout(() => fin({ error: 'timeout' }), 15000);
    try {
      conn = peer.connect(target, { reliable: true, serialization: 'json' });
    } catch {
      fin({ error: 'closed' });
      return;
    }
    if (!conn) {
      fin({ error: 'closed' });
      return;
    }
    conn.on('open', () => {
      try { conn.send(hello); } catch { fin({ error: 'closed' }); }
    });
    conn.on('data', (m) => {
      if (!m || done) return;
      if (m.t === 'start') fin({ conn, start: m });
      else if (m.t === 'busy') fin({ error: 'busy' });
      else if (m.t === 'err') fin({ error: m.code === 'version' ? 'version' : 'closed' });
    });
    conn.on('close', () => fin({ error: 'closed' }));
    conn.on('error', () => fin({ error: 'closed' }));
  });
}

/* ================================================================
 * Session : une connexion, un ou plusieurs combats (revanches)
 * ================================================================ */

export class NetSession {
  /**
   * @param {object} game le jeu (affichage)
   * @param {object} ui l'écran En ligne
   * @param {{role: 'host'|'guest'|null, kind: 'private'|'quick', name: string, model: string, format: {rounds, dur}}} o
   */
  constructor(game, ui, { role, kind, name, model, format }) {
    if (current) current.close();
    current = this;
    this.game = game;
    this.ui = ui;
    this.role = role;
    this.me = role === 'guest' ? 1 : 0;
    this.kind = kind;
    this.code = null;
    this.peer = null;
    this.conn = null;
    this.pendingConn = null;
    this.myName = cleanName(name) || 'Boxeur';
    this.myModel = MODELS.includes(model) ? model : MODELS[0];
    this.foeName = 'Adversaire';
    this.foeModel = MODELS[1];
    this.format = format;
    this.rtt = null;
    this.lastRecv = 0;
    this.timer = null;
    this.pingK = 0;
    this.mid = null;
    this.midSeq = 0;
    this.pendingStart = null;
    this.M = null; // match en cours
    this.early = []; // messages arrivés avant le début du match
    this.phase = 'lobby'; // lobby → match → result
    this.rematch = [false, false];
    this.gone = false;
    this.closing = false;
    this.rc = null; // dernier tick annoncé par l'adversaire
    this.rcAt = 0;
    this.adv = 0; // notre avance estimée (ticks)
    this.acc = 0;
    this.lastFrame = performance.now();
  }

  get active() {
    return current === this && !this.closing;
  }

  close(delay = 0) {
    this.closing = true;
    if (current === this) current = null;
    clearInterval(this.timer);
    clearInterval(this.uiTimer);
    const shut = () => {
      for (const c of [this.conn, this.pendingConn]) if (c) try { c.close(); } catch { /* déjà fermé */ }
      if (this.peer) try { this.peer.destroy(); } catch { /* déjà fermé */ }
    };
    if (delay) setTimeout(shut, delay);
    else shut();
  }

  send(m) {
    if (!this.conn || !this.conn.open) return;
    const lag = window.__netLag; // tests : latence simulée (l'ordre des messages est conservé)
    if (!lag) {
      try { this.conn.send(m); } catch { /* canal fermé */ }
      return;
    }
    const now = performance.now();
    const at = Math.max(now + lag.ms + Math.random() * (lag.jitter || 0), this.lagAt || 0);
    this.lagAt = at;
    (this.lagQ || (this.lagQ = [])).push({ at, m });
    if (this.lagQ.length === 1) this._lagFlush();
  }

  _lagFlush() {
    const q = this.lagQ;
    while (q.length && q[0].at <= performance.now()) {
      const { m } = q.shift();
      if (this.conn && this.conn.open) try { this.conn.send(m); } catch { /* canal fermé */ }
    }
    if (q.length) setTimeout(() => this._lagFlush(), Math.max(0, q[0].at - performance.now()));
  }

  hello() {
    return { t: 'hello', v: NET_VER, kind: this.kind, name: this.myName, model: this.myModel };
  }

  /** La connexion directe est établie : on écoute, on mesure le ping, on surveille le silence. */
  attach(conn) {
    this.conn = conn;
    this.lastRecv = performance.now();
    conn.on('data', (m) => {
      if (this.active) this._onData(m);
    });
    const lost = () => {
      if (this.active && this.conn === conn) this._peerLeft(false);
    };
    conn.on('close', lost);
    conn.on('error', lost);
    clearInterval(this.timer);
    this.timer = setInterval(() => this._tick(), 250);
  }

  _tick() {
    if (!this.active || !this.conn) return;
    const now = performance.now();
    if (++this.pingK % 2 === 0) this.send({ t: 'ping', ts: now });
    if (now - this.lastRecv > (window.__netTimeout || NET_TIMEOUT)) {
      this._peerLeft(false);
      return;
    }
    // Onglet caché : plus d'images, mais le combat continue (sinon l'adversaire resterait figé)
    if (document.hidden && this.M && !this.M.ended) this.frame((now - this.lastFrame) / 1000);
  }

  /* ---------- Hôte ---------- */

  /** Duel privé : ouvre un code et attend. */
  async hostPrivate() {
    this.role = 'host';
    this.me = 0;
    this.ui.status('Connexion au serveur de mise en relation');
    let r;
    for (let k = 0; k < 5; k++) {
      this.code = randomCode();
      r = await openPeer(PEER_PREFIX + this.code);
      if (!this.active) {
        if (r.peer) r.peer.destroy();
        return;
      }
      if (r.peer || r.error !== 'unavailable-id') break; // code déjà pris : on en tire un autre
    }
    if (!r.peer) {
      this._error(r.error);
      return;
    }
    this._listen(r.peer);
    this.ui.waiting(this);
  }

  _listen(peer) {
    this.role = 'host';
    this.me = 0;
    this.peer = peer;
    peer.on('connection', (c) => this._incoming(c));
    peer.on('disconnected', () => {
      // coupure du serveur pendant l'attente : on se reconnecte
      if (this.active && this.phase === 'lobby' && !this.conn && !peer.destroyed) {
        setTimeout(() => {
          try { if (!peer.destroyed) peer.reconnect(); } catch { /* réessaiera */ }
        }, 1500);
      }
    });
  }

  _incoming(c) {
    const refuse = () => c.on('open', () => {
      try { c.send({ t: 'busy' }); } catch { /* fermé */ }
      setTimeout(() => c.close(), 300);
    });
    if (!this.active || this.conn || this.pendingConn || this.phase !== 'lobby') {
      refuse();
      return;
    }
    this.pendingConn = c;
    const to = setTimeout(() => {
      if (this.pendingConn === c) {
        this.pendingConn = null;
        c.close();
      }
    }, 12000);
    c.on('data', (m) => {
      if (this.pendingConn !== c || !m || m.t !== 'hello') return;
      clearTimeout(to);
      this.pendingConn = null;
      if (!this.active || this.conn) {
        c.close();
        return;
      }
      if (m.v !== NET_VER) {
        try { c.send({ t: 'err', code: 'version' }); } catch { /* fermé */ }
        setTimeout(() => c.close(), 300);
        return;
      }
      this.foeName = cleanName(m.name) || 'Adversaire';
      this.foeModel = MODELS.includes(m.model) ? m.model : MODELS[1];
      this.attach(c);
      this.ui.status(`${this.foeName} arrive`);
      this._hostStart();
    });
    c.on('close', () => {
      if (this.pendingConn === c) this.pendingConn = null;
    });
  }

  /** L'hôte propose le combat (graine, format, noms, personnages) ; l'invité répond « go ». */
  _hostStart() {
    if (this.role !== 'host' || this.pendingStart) return;
    const st = {
      t: 'start', v: NET_VER, mid: ++this.midSeq, seed: (Math.random() * 2 ** 31) | 0,
      rounds: this.format.rounds, dur: this.format.dur,
      names: [this.myName, this.foeName], models: [this.myModel, this.foeModel],
    };
    this.pendingStart = st;
    this.send(st);
  }

  /* ---------- Invité ---------- */

  async joinPrivate(code) {
    this.role = 'guest';
    this.me = 1;
    this.code = code;
    this.ui.status('Connexion au serveur de mise en relation');
    const r = await openPeer(null);
    if (!this.active) {
      if (r.peer) r.peer.destroy();
      return;
    }
    if (!r.peer) {
      this._error(r.error);
      return;
    }
    this.peer = r.peer;
    this.ui.status('Recherche du duel');
    const c = await tryConnect(this.peer, PEER_PREFIX + code, this.hello());
    if (!this.active) {
      if (c.conn) c.conn.close();
      return;
    }
    if (!c.conn) {
      this._error(c.error);
      return;
    }
    this.attach(c.conn);
    this._guestGotStart(c.start);
  }

  _guestGotStart(m) {
    if (this.role !== 'guest') return;
    const st = {
      mid: m.mid | 0,
      seed: m.seed | 0,
      rounds: FORMATS.rounds.includes(m.rounds) ? m.rounds : 3,
      dur: FORMATS.dur.includes(m.dur) ? m.dur : 60,
      names: [cleanName(m.names && m.names[0]) || 'Adversaire', this.myName],
      models: [MODELS.includes(m.models && m.models[0]) ? m.models[0] : MODELS[0], this.myModel],
    };
    this.foeName = st.names[0];
    this.foeModel = st.models[0];
    this.send({ t: 'go', mid: st.mid });
    // l'hôte démarre en recevant « go » : on attend le temps que le message lui parvienne
    setTimeout(() => {
      if (this.active && !this.gone) this._startMatch(st);
    }, Math.max(0, Math.min(250, (this.rtt || 60) / 2)));
  }

  /* ---------- Partie rapide ---------- */

  /** Essaie tous les emplacements à la fois : le premier hôte qui répond gagne, les autres sont refermés. */
  _probe(peer, slots) {
    return new Promise((res) => {
      let left = slots.length;
      let won = false;
      for (const s of slots) {
        tryConnect(peer, `${PEER_PREFIX}q${s}`, this.hello()).then((r) => {
          left--;
          if (r.conn) {
            if (won || !this.active) r.conn.close();
            else {
              won = true;
              res(r);
            }
          }
          if (!left && !won) res(null);
        });
      }
    });
  }

  /**
   * Partie rapide sans serveur de jeu : on cherche un hôte en attente dans l'un
   * des emplacements fixes (…-q0 à …-q5). Personne ? On s'installe dans le premier libre.
   */
  async quickMatch() {
    this.ui.searching(this);
    const guestWith = (peer, found) => {
      this.role = 'guest';
      this.me = 1;
      this.peer = peer;
      this.attach(found.conn);
      this.ui.status('Adversaire trouvé');
      this._guestGotStart(found.start);
    };
    const r = await openPeer(null);
    if (!this.active) {
      if (r.peer) r.peer.destroy();
      return;
    }
    if (!r.peer) {
      this._error(r.error);
      return;
    }
    this.ui.status('Recherche d’un adversaire');
    const found = await this._probe(r.peer, [...Array(QUICK_SLOTS).keys()]);
    if (!this.active) {
      r.peer.destroy();
      if (found) found.conn.close();
      return;
    }
    if (found) {
      guestWith(r.peer, found);
      return;
    }
    r.peer.destroy();
    for (let s = 0; s < QUICK_SLOTS; s++) {
      const h = await openPeer(`${PEER_PREFIX}q${s}`);
      if (!this.active) {
        if (h.peer) h.peer.destroy();
        return;
      }
      if (h.peer) {
        this._listen(h.peer);
        this.waiting = true;
        this.ui.searching(this, 'Recherche d’un adversaire');
        return;
      }
      if (h.error !== 'unavailable-id') {
        this._error(h.error);
        return;
      }
      // quelqu'un vient de s'installer dans cet emplacement : on tente de le rejoindre
      const g = await openPeer(null);
      if (!this.active) {
        if (g.peer) g.peer.destroy();
        return;
      }
      if (!g.peer) continue;
      const f = await this._probe(g.peer, [s]);
      if (!this.active) {
        g.peer.destroy();
        if (f) f.conn.close();
        return;
      }
      if (f) {
        guestWith(g.peer, f);
        return;
      }
      g.peer.destroy();
    }
    this._error('full');
  }

  _error(code) {
    if (!this.active) return;
    const role = this.role;
    const kind = this.kind;
    this.close();
    const key = ['lib', 'browser-incompatible', 'none', 'busy', 'version', 'full'].includes(code) ? code
      : code === 'timeout' && role === 'guest' && kind === 'private' ? 'closed'
        : ['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected', 'timeout', 'unavailable-id', 'invalid-id', 'invalid-key'].includes(code) ? 'server'
          : 'closed';
    this.ui.error(key, { role, kind, code: this.code });
  }

  /* ================================================================
   * Messages
   * ================================================================ */

  _onData(m) {
    if (!m || typeof m !== 'object') return;
    this.lastRecv = performance.now();
    const M = this.M;
    switch (m.t) {
      case 'in':
      case 'sync':
      case 'end':
        if (m.mid !== this.mid || !M) {
          if (this.early.length < 4000 && (this.mid == null || m.mid > this.mid)) this.early.push(m);
          return;
        }
        if (m.t === 'in') {
          this._remoteInputs(M, m.s | 0, Array.isArray(m.v) ? m.v : []);
          if (Number.isFinite(m.c)) {
            this.rc = m.c;
            this.rcAt = performance.now();
          }
        } else if (this.role === 'guest') {
          if (m.t === 'sync' && typeof m.s === 'string') M.pendingSync.push(m);
          if (m.t === 'end') M.hostEnd = m;
        }
        break;
      case 'start':
        if (this.role === 'guest' && this.phase !== 'match') this._guestGotStart(m);
        break;
      case 'go':
        if (this.role === 'host' && this.pendingStart && m.mid === this.pendingStart.mid) {
          const st = this.pendingStart;
          this.pendingStart = null;
          this._startMatch(st);
        }
        break;
      case 'ping':
        this.send({ t: 'pong', ts: m.ts });
        break;
      case 'pong': {
        const r = performance.now() - m.ts;
        if (r >= 0 && r < 10000) this.rtt = this.rtt == null ? r : this.rtt * 0.8 + r * 0.2;
        break;
      }
      case 'rematch':
        this.rematch[1 - this.me] = true;
        this._rematchChanged();
        break;
      case 'bye':
        this._peerLeft(true);
        break;
      default:
        break;
    }
  }

  /* ================================================================
   * Combat
   * ================================================================ */

  _startMatch(st) {
    this.mid = st.mid;
    this.phase = 'match';
    this.rematch = [false, false];
    this.resultShown = false;
    this.waiting = false;
    clearInterval(this.uiTimer);
    // libère le code / l'emplacement : personne d'autre ne peut plus se connecter
    if (this.peer && !this.peer.disconnected) try { this.peer.disconnect(); } catch { /* déjà fait */ }
    const world = this.game.onlineStart(this, st);
    const M = {
      world,
      inp: [[], []], // commandes par tick, par joueur
      used: [], // commande adverse utilisée pour chaque tick simulé (prédite ou reçue)
      remoteTop: NET_DELAY,
      localTop: NET_DELAY,
      out: [],
      outStart: NET_DELAY + 1,
      snaps: new Map(), // tick → état après ce tick
      rollFrom: Infinity,
      shown: new Set(),
      pendingSync: [],
      nextSync: NET_SYNC_EVERY,
      hostEnd: null,
      overTick: null,
      ended: false,
      stallT: 0,
      rolls: 0,
      maxRoll: 0,
      syncOk: 0,
      syncFix: 0,
      cpu: 0,
    };
    for (let t = 1; t <= NET_DELAY; t++) M.inp[0][t] = M.inp[1][t] = NO_COMMAND;
    M.snaps.set(world.tick, captureState(world));
    this.M = M;
    this.acc = 0;
    this.lastFrame = performance.now();
    const early = this.early;
    this.early = [];
    for (const m of early) if (m.mid === this.mid) this._onData(m);
  }

  _remoteInputs(M, start, flat) {
    const them = 1 - this.me;
    const n = Math.min(Math.floor(flat.length / 3), 2000);
    for (let k = 0; k < n; k++) {
      const t = start + k;
      if (t <= M.remoteTop || M.inp[them][t] !== undefined) continue; // déjà reçue
      if (t > M.remoteTop + NET_KEEP) break; // beaucoup trop loin : on ne pourrait pas revenir en arrière
      const v = sanitizeCommand([flat[k * 3], flat[k * 3 + 1], flat[k * 3 + 2]]);
      M.inp[them][t] = v;
      if (t <= M.world.tick && !sameCommand(M.used[t], v)) M.rollFrom = Math.min(M.rollFrom, t); // on s'était trompé
    }
    while (M.inp[them][M.remoteTop + 1] !== undefined) M.remoteTop++;
  }

  /** Un tick : simulation, événements présentés une seule fois, photographie. */
  _step(M) {
    const W = M.world;
    const t = W.tick + 1;
    const me = this.me;
    const them = 1 - me;
    let theirs = M.inp[them][t];
    if (theirs === undefined) theirs = predictCommand(M.inp[them][M.remoteTop] || NO_COMMAND);
    M.used[t] = theirs;
    const mine = M.inp[me][t] || NO_COMMAND;
    W.step(me === 0 ? [mine, theirs] : [theirs, mine]);
    const show = [];
    for (const e of W.drain()) {
      const key = eventKey(W, e);
      if (!M.shown.has(key)) {
        M.shown.add(key);
        show.push(e);
      }
    }
    if (show.length) this.game.onlineEvents(show);
    if (!W.over) M.overTick = null;
    else if (M.overTick == null) M.overTick = W.tick;
    M.snaps.set(W.tick, captureState(W));
    M.snaps.delete(W.tick - NET_KEEP);
  }

  /** Retour à l'état du tick (rollFrom - 1), puis on resimule jusqu'au tick courant avec les bonnes commandes. */
  _rollback(M) {
    const from = M.rollFrom;
    const W = M.world;
    const cur = W.tick;
    M.rollFrom = Infinity;
    if (from > cur) return;
    const base = M.snaps.get(from - 1);
    if (!base) {
      this._desync();
      return;
    }
    restoreState(W, base);
    M.overTick = null;
    M.rolls++;
    M.maxRoll = Math.max(M.maxRoll, cur - from + 1);
    while (W.tick < cur) this._step(M);
  }

  /** Hôte : envoie l'état de chaque tick confirmé (commandes des deux joueurs connues) multiple de 30. */
  _hostSync(M) {
    const conf = Math.min(M.world.tick, M.remoteTop);
    for (; M.nextSync <= conf; M.nextSync += NET_SYNC_EVERY) {
      const snap = M.snaps.get(M.nextSync);
      if (snap) this.send({ t: 'sync', mid: this.mid, k: M.nextSync, s: JSON.stringify(snap) });
    }
  }

  /** Invité : compare son état confirmé à celui de l'hôte ; s'il diffère (calculs flottants), on adopte celui de l'hôte. */
  _guestSync(M) {
    while (M.pendingSync.length) {
      const m = M.pendingSync[0];
      if (m.k > M.remoteTop || m.k > M.world.tick) break; // pas encore confirmé / simulé de notre côté
      M.pendingSync.shift();
      const snap = M.snaps.get(m.k);
      if (!snap) continue;
      if (JSON.stringify(snap) === m.s) {
        M.syncOk++;
        continue;
      }
      let host;
      try { host = JSON.parse(m.s); } catch { continue; }
      if (window.__netDebug) (M.diffs || (M.diffs = [])).push({ k: m.k, mine: JSON.stringify(snap), host: m.s });
      M.snaps.set(m.k, host);
      M.syncFix++;
      M.rollFrom = Math.min(M.rollFrom, m.k + 1);
    }
  }

  /** Avance plus lentement si on est en avance sur l'adversaire (sinon c'est lui qui corrigerait sans cesse). */
  _speed() {
    if (this.rc == null || this.rtt == null) return 1;
    const est = this.rc + ((performance.now() - this.rcAt + this.rtt / 2) / 1000) * SIM_HZ;
    this.adv += (this.M.world.tick - est - this.adv) * 0.05;
    return this.adv > 3 ? 0.85 : this.adv > 1.5 ? 0.95 : 1;
  }

  /**
   * Une image : corrections, ticks de simulation au rythme fixe, envoi de mes commandes.
   * @param {number} dt temps réel écoulé (s)
   */
  frame(dt) {
    const M = this.M;
    this.lastFrame = performance.now();
    if (!M || M.ended || !this.active) return;
    const t0 = performance.now();
    if (M.rollFrom !== Infinity) this._rollback(M);
    if (this.role === 'guest') {
      this._guestSync(M);
      if (M.rollFrom !== Infinity) this._rollback(M);
    } else this._hostSync(M);
    if (!this.active) return; // désynchronisation irrécupérable
    const W = M.world;
    this.acc += Math.min(dt, 2) * this._speed();
    const maxN = document.hidden ? 150 : 40;
    let n = 0;
    let stalled = false;
    while (this.acc >= DT && n < maxN) {
      if (W.tick + 1 - M.remoteTop > NET_MAX_AHEAD) {
        stalled = true; // on attend ses commandes
        break;
      }
      const ti = W.tick + 1 + NET_DELAY; // ma commande d'aujourd'hui s'applique à ce tick
      if (ti > M.localTop) {
        const v = this.game.onlineLocalCommand();
        for (let t = M.localTop + 1; t <= ti; t++) {
          // un appui (coup, esquive) ne compte qu'une fois
          const c = t === M.localTop + 1 ? v : [v[0] & ~PRESSED_BITS, v[1], v[2]];
          M.inp[this.me][t] = c;
          M.out.push(c);
        }
        M.localTop = ti;
      }
      this._step(M);
      this.acc -= DT;
      n++;
    }
    if (stalled) {
      this.acc = Math.min(this.acc, DT);
      M.stallT += dt;
    } else M.stallT = 0;
    if (M.out.length) {
      const flat = [];
      for (const c of M.out) flat.push(c[0], c[1], c[2]);
      this.send({ t: 'in', mid: this.mid, s: M.outStart, v: flat, c: W.tick });
      M.outStart += M.out.length;
      M.out = [];
    }
    M.cpu += (performance.now() - t0 - M.cpu) * 0.05; // coût moyen (ms), pour le débogage
    this._checkEnd(M);
  }

  /** Fin du match : décidée par l'hôte quand toutes les commandes jusqu'à la fin sont confirmées. */
  _checkEnd(M) {
    const W = M.world;
    if (this.role === 'host') {
      if (W.over && M.overTick != null && M.overTick <= M.remoteTop) {
        const summary = summarize(W);
        this.send({ t: 'end', mid: this.mid, k: M.overTick, r: summary });
        this._matchOver(summary);
      }
    } else if (M.hostEnd && (W.over || W.tick >= M.hostEnd.k)) {
      this._matchOver(M.hostEnd.r);
    }
  }

  _matchOver(summary) {
    const M = this.M;
    M.ended = true;
    this.phase = 'result';
    this.result = sanitizeSummary(summary);
    this.game.onlineOver(this, this.result);
  }

  /* ---------- Revanche, départ de l'adversaire ---------- */

  askRematch() {
    if (this.gone || this.rematch[this.me]) return;
    this.rematch[this.me] = true;
    this.send({ t: 'rematch' });
    this._rematchChanged();
  }

  _rematchChanged() {
    if (this.rematch[0] && this.rematch[1] && this.role === 'host') this._hostStart();
    this.game.onlineResultChanged(this);
  }

  /** L'adversaire est parti (bye = il a quitté exprès) ou la connexion est coupée. */
  _peerLeft(bye) {
    if (!this.active || this.gone) return;
    if (this.phase === 'result') {
      this.gone = true;
      this.game.onlineResultChanged(this);
      return;
    }
    if (this.phase === 'lobby' && this.role === 'host' && this.peer && !this.peer.destroyed) {
      // il est parti avant le début : on se remet en attente avec le même code
      const c = this.conn;
      this.conn = null;
      this.pendingStart = null;
      clearInterval(this.timer);
      try { if (c) c.close(); } catch { /* déjà fermé */ }
      if (this.kind === 'quick') this.ui.searching(this, 'Ton adversaire est parti. Recherche d’un autre…');
      else this.ui.waiting(this);
      return;
    }
    this.gone = true;
    const inMatch = this.phase === 'match';
    const foe = this.foeName;
    this.close();
    this.game.onlineLeft({ bye, inMatch, foe });
  }

  _desync() {
    const foe = this.foeName;
    this.gone = true;
    this.close();
    this.game.onlineLeft({ bye: false, inMatch: true, foe, desync: true });
  }

  /** Quitter (abandon en combat = victoire par forfait pour l'adversaire). */
  leave() {
    this.send({ t: 'bye' });
    this.close(250);
  }

  /** Statut réseau pour le HUD. */
  get netStatus() {
    const M = this.M;
    const slow = M && M.stallT > 0.25;
    return {
      slow,
      text: slow ? 'Connexion instable' : this.rtt != null ? `Ping ${Math.round(this.rtt)} ms` : 'Ping …',
      bad: slow || (this.rtt || 0) > 160,
    };
  }
}

/** Résumé du résultat, envoyé par l'hôte (les deux joueurs affichent le même). */
function summarize(W) {
  const r = W.result || {};
  return {
    w: r.winner ? W.indexOf(r.winner) : -1,
    method: r.method || 'DRAW',
    kind: r.kind || '',
    round: r.round | 0,
    time: +r.time || 0,
    scorecards: Array.isArray(r.scorecards) ? r.scorecards : [],
  };
}

function sanitizeSummary(s) {
  const o = s && typeof s === 'object' ? s : {};
  const cards = Array.isArray(o.scorecards) ? o.scorecards.slice(0, 3).map((j) => (Array.isArray(j) ? j.slice(0, 12).map((c) => [c[0] | 0, c[1] | 0]) : [])) : [];
  return {
    w: o.w === 0 || o.w === 1 ? o.w : -1,
    method: ['KO', 'DECISION', 'DRAW'].includes(o.method) ? o.method : 'DRAW',
    kind: String(o.kind || '').slice(0, 40),
    round: Math.max(1, Math.min(12, o.round | 0)),
    time: Math.max(0, Math.min(600, +o.time || 0)),
    scorecards: cards,
  };
}

/** Au départ de la page, on prévient l'adversaire. */
addEventListener('pagehide', () => {
  const N = current;
  if (N && N.conn && N.conn.open) try { N.conn.send({ t: 'bye' }); } catch { /* fermeture */ }
});

export { OnlineWorld };
