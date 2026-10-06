/**
 * CombatSystem.js
 * ------------------------------------------------------------------
 * Résout les échanges entre deux boxeurs :
 *  - balayage des coups en phase de frappe (HitDetection) ;
 *  - calcul des dégâts : puissance, endurance, zone, combo, contre, critique,
 *    garde, défense ;
 *  - étourdissement, recul, bris de garde, KO ;
 *  - statistiques et score d'arcade ;
 *  - séparation physique des deux corps.
 *
 * Tous les résultats sont publiés sur le bus d'événements : l'audio, le HUD
 * et les effets visuels réagissent sans que ce système les connaisse.
 */

import { Vector3 } from 'three';
import { GameConfig } from '../config/GameConfig.js';
import { isPowerPunch } from '../config/Punches.js';
import { sweepPunch, createHitResult } from '../combat/HitDetection.js';
import { chance } from '../core/Random.js';
import { rightFromYaw } from '../core/MathUtils.js';

const CC = GameConfig.combat;
const FC = GameConfig.fighter;
const SCORE = GameConfig.score;

const _dir = new Vector3();
const _right = new Vector3();

export class CombatSystem {
  constructor(events) {
    this.events = events;
    this.a = null;
    this.b = null;
    this.enabled = true;
    this._hit = createHitResult();
    // Objet réutilisé pour décrire un impact au défenseur
    this._impact = {
      damage: 0, staminaDamage: 0, stun: 0, flinch: 0, knockback: 0,
      dir: new Vector3(), zone: 'head', blocked: false, crit: false, punch: null,
    };
    // Étourdissement infligé : compté pour l'attaquant
    // (seulement pour les boxeurs de ce système : en ligne, la simulation a son propre bus)
    events.on('fighter:stunned', ({ fighter }) => {
      if (fighter.opponent && (fighter === this.a || fighter === this.b)) fighter.opponent.matchStats.stuns++;
    });
  }

  setFighters(a, b) {
    this.a = a;
    this.b = b;
    a.opponent = b;
    b.opponent = a;
  }

  update() {
    if (!this.enabled || !this.a || !this.b) return;
    this._processPunches(this.a, this.b);
    this._processPunches(this.b, this.a);
    this._separate();
  }

  _processPunches(attacker, defender) {
    for (const p of attacker.punches.list) {
      if (p.phase !== 'strike') continue;
      if (defender.ko) {
        if (p.pendingResolution) attacker.punches.resolveWhiff(p);
        continue;
      }
      const hit = sweepPunch(p, attacker, defender, attacker.punches, this._hit);
      if (hit) this._resolveHit(attacker, defender, p, hit);
      else if (p.pendingResolution) this._resolveWhiff(attacker, defender, p);
    }
  }

  /* ---------------------------------------------------------------- */

  _resolveHit(att, def, p, hit) {
    const pd = p.def;
    const blocked = hit.type === 'guard';
    const zone = blocked ? (hit.lowGuard ? 'body' : 'head') : hit.type;

    // --- Type de contre ---
    let counter = null;
    if (!blocked) {
      const defPunch = def.punches.currentCommitted();
      if (defPunch) counter = 'interrupt';
      else if (def.punches.inRecoveryAfterWhiff() && def.time - def.lastWhiffTime < CC.punishWindow) counter = 'punish';
      else if (att.counterWindow > 0) counter = 'riposte';
    }
    const cdef = counter ? CC.counter[counter] : null;

    // --- Critique (tête, coup propre) ---
    let crit = false;
    if (!blocked && zone === 'head') {
      let c = pd.crit + (cdef ? cdef.crit : 0) + (def.isStunned ? 0.15 : 0) + (att.stamina.ratio > 0.8 ? 0.03 : 0);
      // Baisser la tête dans un uppercut : critique assuré
      if (pd.kind === 'uppercut' && def.dodge.type === 'duck' && def.dodge.phase !== 'none') c = 1;
      crit = chance(c);
    }

    // --- Dégâts ---
    let damage = pd.damage * att.stats.power * att.stamina.efficiency() * (0.5 + 0.5 * p.paid);
    if (zone === 'body') damage *= CC.bodyDamageFactor;
    damage *= 1 + p.comboBonus;
    if (cdef) damage *= cdef.damage;
    if (crit) damage *= CC.critMultiplier;
    if (def.isStunned) damage *= CC.stunnedDamageMultiplier;
    damage /= def.stats.defense || 1;

    let staminaDamage = pd.staminaDamage * (zone === 'body' ? CC.bodyStaminaFactor : 1);
    let stun = pd.stun * (zone === 'body' ? CC.bodyStunFactor : 1) * (crit ? CC.critStunMultiplier : 1) * (cdef ? 1.25 : 1);
    let knockback = pd.knockback * (crit ? 1.8 : 1);

    if (blocked) {
      let reduction = zone === 'head' ? CC.blockReductionHead : CC.blockReductionBody;
      if (pd.kind === 'uppercut' && zone === 'head') reduction = 0.5; // l'uppercut se glisse entre les gants
      reduction *= hit.coverage;
      damage *= 1 - reduction;
      staminaDamage = pd.staminaDamage * CC.blockStaminaFactor + pd.cost * 0.3;
      stun = 0;
      knockback *= 0.5;
    }

    // --- Direction du recul : de l'attaquant vers le défenseur (+ latéral pour les crochets) ---
    _dir.copy(def.position).sub(att.position).setY(0);
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, 1);
    _dir.normalize();
    if (pd.kind === 'hook') {
      rightFromYaw(att.yaw, _right);
      _dir.addScaledVector(_right, -p.side * 0.6).normalize();
    }

    const imp = this._impact;
    imp.damage = damage;
    imp.staminaDamage = staminaDamage;
    imp.stun = stun;
    imp.flinch = pd.flinch;
    imp.knockback = knockback;
    imp.dir.copy(_dir);
    imp.zone = zone;
    imp.blocked = blocked;
    imp.crit = crit;
    imp.punch = p;
    def.applyHit(imp);

    att.punches.resolveContact(p, hit.u, blocked ? 'block' : 'land');
    p.contactPoint.copy(hit.point);

    // --- Bris de garde : bloquer sans endurance ---
    let guardBroken = false;
    if (blocked) {
      def.counterWindow = CC.counterWindowAfterBlock;
      if (def.stamina.value <= 0.5) {
        def.guard.brokenTimer = FC.guardBreakDuration;
        def.guard.amount = 0;
        def.flinchTimer = Math.max(def.flinchTimer, 0.35);
        guardBroken = true;
      }
    }

    // --- Statistiques et score ---
    const as = att.matchStats;
    const ds = def.matchStats;
    const r = att.currentRound;
    if (blocked) {
      as.blockedByOpponent++;
      ds.blocks++;
      ds.round(r).blocks++;
      ds.score += SCORE.block;
    } else {
      as.landed++;
      as.byType[pd.id]++;
      if (zone === 'head') as.head++;
      else as.body++;
      if (isPowerPunch(pd.id)) as.power++;
      if (crit) as.crits++;
      if (counter) as.counters++;
      as.damage += damage;
      const rs = as.round(r);
      rs.landed++;
      if (isPowerPunch(pd.id)) rs.power++;
      rs.damage += damage;
      let pts = pd.score * (crit ? 2 : 1) * (counter ? 1.5 : 1) * (zone === 'body' ? 0.9 : 1);
      if (p.combo) {
        as.combos++;
        pts += p.combo.score * SCORE.comboBonus;
        if (!as.bestCombo || p.combo.sequence.length >= as.bestCombo.sequence.length) as.bestCombo = p.combo;
      }
      as.score += Math.round(pts);
    }

    const payload = {
      attacker: att, defender: def, punch: p, zone, damage, crit, counter,
      counterLabel: cdef ? cdef.label : null, combo: blocked ? null : p.combo,
      point: hit.point, ko: def.ko, guardBroken,
    };
    this.events.emit(blocked ? 'punch:blocked' : 'punch:land', payload);
    if (!blocked && p.combo) this.events.emit('combo', { fighter: att, combo: p.combo });
    if (guardBroken) this.events.emit('guard:break', { fighter: def });
  }

  _resolveWhiff(att, def, p) {
    att.punches.resolveWhiff(p);
    const dodged = def.dodge.phase !== 'none';
    att.matchStats.missed++;
    if (dodged) {
      def.counterWindow = CC.counterWindowAfterDodge;
      def.dodge.evaded = true;
      def.matchStats.dodges++;
      def.matchStats.round(def.currentRound).dodges++;
      def.matchStats.score += SCORE.dodge;
    }
    this.events.emit('punch:whiff', { attacker: att, defender: def, punch: p, dodged });
  }

  /** Les deux boxeurs ne peuvent pas se traverser. */
  _separate() {
    const a = this.a;
    const b = this.b;
    const dx = b.position.x - a.position.x;
    const dz = b.position.z - a.position.z;
    const dist = Math.hypot(dx, dz);
    const min = FC.minSeparation;
    if (dist >= min) return;
    const nx = dist > 1e-4 ? dx / dist : 0;
    const nz = dist > 1e-4 ? dz / dist : 1;
    const push = min - dist;
    // Un boxeur au tapis ne bouge pas : l'autre est repoussé entièrement
    const wa = a.ko ? 0 : b.ko ? 1 : 0.5;
    const wb = 1 - wa;
    a.position.x -= nx * push * wa;
    a.position.z -= nz * push * wa;
    b.position.x += nx * push * wb;
    b.position.z += nz * push * wb;
  }
}
