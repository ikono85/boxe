/**
 * PunchSystem.js
 * ------------------------------------------------------------------
 * Machine à états des coups d'un boxeur (une instance par boxeur).
 *
 *  idle → windup (anticipation) → strike (frappe) → hold (impact) → recovery (retour en garde)
 *
 * - Chaque main a son propre coup : pendant que le jab revient, le direct
 *   peut déjà partir (enchaînement naturel « 1-2 »).
 * - Un coup demandé trop tôt est mémorisé (input buffer) puis lancé dès que possible,
 *   y compris (pour un joueur humain) pendant le bref recul après un coup reçu
 *   ou le début d'une esquive : la touche n'est jamais « avalée ».
 * - Les coups enchaînés partent plus vite et coûtent moins d'endurance ;
 *   une séquence reconnue (Jab → Direct, etc.) donne un bonus de dégâts.
 * - La trajectoire est une courbe de Bézier calculée au départ du coup, dans
 *   le repère du monde, relative à la position du boxeur. La détection des
 *   impacts (HitDetection) et l'affichage des gants utilisent la même courbe.
 */

import { Vector3 } from 'three';
import { PUNCHES, findCombo } from '../config/Punches.js';
import { GameConfig } from '../config/GameConfig.js';
import { Ease, clamp, quadBezier, forwardFromYaw, rightFromYaw } from '../core/MathUtils.js';

const CC = GameConfig.combat;

const _f = new Vector3();
const _r = new Vector3();
const _up = new Vector3(0, 1, 0);
const _a = new Vector3();
const _rest = new Vector3();
const _tmp = new Vector3();

let serial = 0;

const STRIKE_EASE = {
  straight: Ease.punch,
  hook: Ease.inOutSine,
  uppercut: Ease.outQuad,
};

export class Punch {
  constructor(hand) {
    this.hand = hand;
    this.side = hand === 'left' ? -1 : 1;
    this.def = null;
    this.phase = 'idle';
    this.time = 0;
    this.windup = 0;
    this.strike = 0;
    this.hold = 0;
    this.recovery = 0;
    this.u = 0;
    this.prevU = 0;
    this.zone = 'head';
    this.hasTarget = false;
    this.start = new Vector3(); // position du gant (relative au boxeur) au départ
    this.p0 = new Vector3(); // fin d'anticipation = début de frappe
    this.p1 = new Vector3(); // point de contrôle de la courbe
    this.p2 = new Vector3(); // point visé (+ accompagnement)
    this.endOffset = new Vector3(); // position du gant à l'impact / extension max
    this.result = null; // 'land' | 'block' | 'whiff' | null
    this.pendingResolution = false;
    this.chained = false;
    this.combo = null;
    this.comboBonus = 0;
    this.paid = 1;
    this.serial = 0;
    this.yaw = 0;
    this.interrupted = false;
    this.contactPoint = new Vector3();
    this.targetPoint = new Vector3(); // point visé au départ (monde)
    this.trackOrigin = new Vector3(); // position de l'adversaire au départ
  }

  get active() {
    return this.phase !== 'idle';
  }

  /** Le coup est engagé : anticipation ou frappe en cours. */
  get committed() {
    return this.phase === 'windup' || this.phase === 'strike';
  }

  /** Avancement (0-1) dans la phase courante. */
  get phaseProgress() {
    const d = this[this.phase === 'idle' ? 'windup' : this.phase] || 1;
    return clamp(this.time / d, 0, 1);
  }

  /** Temps restant avant l'arrivée du gant sur la cible (pour l'IA). */
  timeToImpact() {
    if (this.phase === 'windup') return this.windup - this.time + this.strike * 0.8;
    if (this.phase === 'strike') return Math.max(0, this.strike * 0.8 - this.time);
    return 0;
  }

  /**
   * Extension du bras (0 = garde, 1 = bras tendu). Négative pendant
   * l'anticipation. Sert à orienter le gant et à animer le corps.
   */
  get extension() {
    switch (this.phase) {
      case 'windup':
        return -0.25 * Ease.outQuad(this.phaseProgress);
      case 'strike':
      case 'hold':
        return this.u;
      case 'recovery':
        return this.u * (1 - Ease.inOutCubic(this.phaseProgress));
      default:
        return 0;
    }
  }
}

export class PunchSystem {
  constructor(fighter, events) {
    this.fighter = fighter;
    this.events = events;
    this.hands = { left: new Punch('left'), right: new Punch('right') };
    this.list = [this.hands.left, this.hands.right];
    this.buffer = null;
    this.chain = [];
    this.lastEndTime = -10;
    this.now = 0;
    // Mémoriser aussi les coups demandés pendant un empêchement bref (recul, début
    // d'esquive). Utile aux humains ; l'IA, elle, décide image par image.
    this.bufferThroughFlinch = !!fighter.isPlayer;
  }

  reset() {
    for (const p of this.list) {
      p.phase = 'idle';
      p.time = 0;
      p.result = null;
      p.pendingResolution = false;
    }
    this.buffer = null;
    this.chain = [];
    this.lastEndTime = -10;
  }

  /* ---------- État ---------- */

  isActive() {
    return this.hands.left.active || this.hands.right.active;
  }

  isCommitted() {
    return this.hands.left.committed || this.hands.right.committed;
  }

  /** Coup le plus « engagé » (pour l'IA et les contres). */
  currentCommitted() {
    const l = this.hands.left;
    const r = this.hands.right;
    if (l.committed && r.committed) return l.timeToImpact() < r.timeToImpact() ? l : r;
    if (l.committed) return l;
    if (r.committed) return r;
    return null;
  }

  inRecoveryAfterWhiff() {
    for (const p of this.list) if (p.phase !== 'idle' && p.result === 'whiff' && p.phase !== 'strike') return true;
    return false;
  }

  /* ---------- Lancer un coup ---------- */

  /**
   * Demande un coup. Retourne 'started', 'buffered' ou 'rejected'.
   * @param {string} type identifiant du coup (jab, cross, hookL…)
   * @param {'head'|'body'|null} zone zone souhaitée (null = selon la visée)
   */
  request(type, zone = null) {
    const r = this._tryStart(type, zone);
    if (r === 'wait' || (r === 'rejected' && PUNCHES[type] && this._brieflyBlocked())) {
      this.buffer = { type, zone, time: this.now };
      return 'buffered';
    }
    return r;
  }

  /** Empêchement court (recul après un coup reçu, début d'esquive), pas un étourdissement ni un KO. */
  _brieflyBlocked() {
    const f = this.fighter;
    if (!this.bufferThroughFlinch || f.ko || f.frozen || f.isStunned) return false;
    return f.flinchTimer > 0 || f.dodge.phase === 'in';
  }

  _tryStart(type, zone) {
    const f = this.fighter;
    const def = PUNCHES[type];
    if (!def || !f.canPunch()) return 'rejected';

    const p = this.hands[def.hand];
    const other = this.hands[def.hand === 'left' ? 'right' : 'left'];
    let chained = false;

    if (p.phase !== 'idle') {
      // Même main : on peut couper la fin du retour en garde (double jab…)
      if (p.phase === 'recovery' && p.phaseProgress >= 0.35) chained = true;
      else return 'wait';
    }
    if (other.committed) return 'wait';
    if (other.phase === 'hold' || other.phase === 'recovery') chained = true;
    if (!chained && this.chain.length && this.now - this.lastEndTime <= CC.chainWindow) chained = true;

    // Position actuelle du gant (continuité visuelle si on coupe un retour)
    this.getGloveOffset(p, _tmp);

    // Chaîne de combo
    if (chained) {
      this.chain.push(type);
      if (this.chain.length > 4) this.chain.shift();
    } else {
      this.chain = [type];
    }
    const combo = chained ? findCombo(this.chain) : null;

    // Endurance et vitesse
    const cost = def.cost * (chained ? CC.chainStaminaFactor : 1);
    const paid = f.stamina.spend(cost);
    const speed = f.stats.speed * f.stamina.speedFactor();

    p.def = def;
    p.serial = ++serial;
    p.phase = 'windup';
    p.time = 0;
    p.windup = (def.windup * f.windupMultiplier * (chained ? CC.chainWindupFactor : 1)) / speed;
    p.strike = def.strike / speed;
    p.hold = def.hold;
    p.recovery = def.recovery / speed;
    p.u = 0;
    p.prevU = 0;
    p.result = null;
    p.pendingResolution = false;
    p.interrupted = false;
    p.chained = chained;
    p.combo = combo;
    p.comboBonus = combo ? combo.damageBonus : 0;
    p.paid = paid;
    p.start.copy(_tmp);

    // Cible : la visée du joueur ou le choix de l'IA
    const target = f.resolvePunchTarget(def, zone);
    p.zone = target.zone;
    p.hasTarget = target.hasTarget;
    p.targetPoint.copy(target.point);
    if (f.opponent) p.trackOrigin.copy(f.opponent.position);
    this._buildPath(p, def, p.targetPoint);

    f.onPunchStart(p);
    if (this.events) this.events.emit('punch:start', { fighter: f, punch: p });
    return 'started';
  }

  /**
   * Construit la trajectoire du coup (positions relatives au boxeur).
   * straight : ligne droite ; hook : arc latéral avec accompagnement ;
   * uppercut : montée verticale sous le menton.
   */
  _buildPath(p, def, targetWorld) {
    const f = this.fighter;
    const yaw = f.aimYaw();
    p.yaw = yaw;
    forwardFromYaw(yaw, _f);
    rightFromYaw(yaw, _r);
    const side = p.side;

    // Anticipation : le gant recule / s'écarte / descend
    p.p0.copy(p.start);
    if (def.kind === 'straight') {
      p.p0.addScaledVector(_f, def.hand === 'right' ? -0.08 : -0.05).addScaledVector(_up, -0.015);
      if (def.hand === 'right') p.p0.addScaledVector(_r, 0.02);
    } else if (def.kind === 'hook') {
      p.p0.addScaledVector(_r, side * 0.08).addScaledVector(_f, -0.04).addScaledVector(_up, -0.01);
    } else {
      p.p0.addScaledVector(_up, -0.1).addScaledVector(_f, -0.03);
    }

    // Point visé, limité par l'allonge horizontale
    _a.copy(targetWorld).sub(f.position);
    const h = Math.hypot(_a.x, _a.z);
    if (h > def.reach) {
      const k = def.reach / h;
      _a.x *= k;
      _a.z *= k;
    }

    if (def.kind === 'straight') {
      p.p2.copy(_a);
      p.p1.copy(p.p0).add(_a).multiplyScalar(0.5).addScaledVector(_up, 0.02);
    } else if (def.kind === 'hook') {
      // L'arc arrive par le côté, à hauteur de cible, et la traverse (accompagnement) :
      // une esquive latérale ne suffit pas, il faut passer dessous.
      p.p2.copy(_a).addScaledVector(_r, -side * 0.2);
      p.p1.copy(_a)
        .addScaledVector(_r, side * 0.46)
        .addScaledVector(_f, 0.02)
        .addScaledVector(_up, 0.03);
    } else {
      const depth = p.zone === 'body' ? 0.36 : 0.52;
      p.p2.copy(_a).addScaledVector(_up, 0.07).addScaledVector(_f, 0.02);
      p.p1.copy(_a).addScaledVector(_up, -depth).addScaledVector(_f, -0.13);
    }
  }

  /* ---------- Mise à jour ---------- */

  update(dt) {
    this.now += dt;
    for (const p of this.list) this._advance(p, dt);

    if (this.buffer) {
      const expired = this.now - this.buffer.time > CC.inputBuffer;
      if (expired || (!this.fighter.canAct() && !this._brieflyBlocked())) {
        this.buffer = null;
      } else if (this._tryStart(this.buffer.type, this.buffer.zone) === 'started') {
        this.buffer = null;
      }
    }
  }

  _advance(p, dt) {
    if (p.phase === 'idle') return;
    p.time += dt;

    if (p.phase === 'windup') {
      // Pendant l'anticipation, le coup suit les déplacements de l'adversaire
      // (pas ses mouvements de tête : les esquives restent efficaces).
      const opp = this.fighter.opponent;
      if (p.hasTarget && opp) {
        _tmp.copy(opp.position).sub(p.trackOrigin).setY(0).add(p.targetPoint);
        this._buildPath(p, p.def, _tmp);
      }
      if (p.time < p.windup) return;
      p.time -= p.windup;
      p.phase = 'strike';
      p.u = 0;
      p.prevU = 0;
      if (this.events) this.events.emit('punch:strike', { fighter: this.fighter, punch: p });
    }

    if (p.phase === 'strike') {
      if (p.pendingResolution) {
        // Personne n'a résolu le coup (combat suspendu) : coup dans le vide
        this.resolveWhiff(p);
        return;
      }
      p.prevU = p.u;
      const t = clamp(p.time / p.strike, 0, 1);
      p.u = STRIKE_EASE[p.def.kind](t);
      if (t >= 1) {
        p.u = 1;
        p.pendingResolution = true;
      }
      return;
    }

    if (p.phase === 'hold') {
      if (p.time >= p.hold) {
        p.time -= p.hold;
        p.phase = 'recovery';
      }
      return;
    }

    if (p.phase === 'recovery' && p.time >= p.recovery) {
      p.phase = 'idle';
      p.time = 0;
      this.lastEndTime = this.now;
    }
  }

  /* ---------- Résolution (appelée par le CombatSystem) ---------- */

  resolveContact(p, u, result) {
    p.u = u;
    p.result = result;
    p.pendingResolution = false;
    p.phase = 'hold';
    p.time = 0;
    p.hold = p.def.hold * (result === 'block' ? 0.7 : 1);
    this.pathPoint(p, u, p.endOffset);
  }

  resolveWhiff(p) {
    p.u = 1;
    p.result = 'whiff';
    p.pendingResolution = false;
    p.phase = 'hold';
    p.time = 0;
    p.hold = p.def.hold * 1.5;
    p.recovery *= 1.3;
    this.pathPoint(p, 1, p.endOffset);
    // Frapper dans le vide fatigue davantage
    this.fighter.stamina.spend(p.def.cost * GameConfig.stamina.whiffPenalty * (p.chained ? CC.chainStaminaFactor : 1));
    this.fighter.lastWhiffTime = this.fighter.time;
  }

  /** Un coup reçu interrompt les coups en anticipation. Retourne true si un coup a été coupé. */
  interruptWindups() {
    let any = false;
    for (const p of this.list) {
      if (p.phase === 'windup') {
        this.getGloveOffset(p, p.endOffset);
        p.u = 0;
        p.phase = 'recovery';
        p.time = 0;
        p.recovery = 0.18;
        p.interrupted = true;
        any = true;
      }
    }
    if (any) this.buffer = null;
    return any;
  }

  resetChain() {
    this.chain = [];
    this.buffer = null;
  }

  cancelAll() {
    for (const p of this.list) {
      if (p.phase === 'idle') continue;
      this.getGloveOffset(p, p.endOffset);
      p.u = 0;
      p.phase = 'recovery';
      p.time = 0;
      p.recovery = 0.22;
      p.pendingResolution = false;
    }
    this.buffer = null;
    this.chain = [];
  }

  /* ---------- Géométrie ---------- */

  /** Point de la trajectoire (relatif au boxeur) pour le paramètre u. */
  pathPoint(p, u, out) {
    return quadBezier(p.p0, p.p1, p.p2, u, out);
  }

  /** Position du gant relative au boxeur (toutes phases confondues). */
  getGloveOffset(p, out) {
    const f = this.fighter;
    f.getHandRestWorld(p.hand, _rest).sub(f.position);
    switch (p.phase) {
      case 'windup':
        return out.copy(p.start).lerp(p.p0, Ease.outQuad(p.phaseProgress));
      case 'strike':
        return this.pathPoint(p, p.u, out);
      case 'hold':
        return out.copy(p.endOffset);
      case 'recovery':
        return out.copy(p.endOffset).lerp(_rest, Ease.inOutCubic(p.phaseProgress));
      default:
        return out.copy(_rest);
    }
  }

  /** Position monde du gant. */
  getGloveWorld(hand, out) {
    this.getGloveOffset(this.hands[hand], out);
    return out.add(this.fighter.position);
  }
}

