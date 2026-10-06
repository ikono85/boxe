/**
 * StaminaSystem.js
 * ------------------------------------------------------------------
 * Endurance d'un boxeur.
 *  - chaque coup / esquive coûte de l'endurance ;
 *  - la récupération dépend de l'activité (repos > déplacement > garde) ;
 *  - un boxeur essoufflé frappe moins fort et moins vite ;
 *  - les coups au corps encaissés ralentissent la récupération.
 */

import { GameConfig } from '../config/GameConfig.js';
import { clamp, lerp, smoothstep } from '../core/MathUtils.js';

const C = GameConfig.stamina;

export class StaminaSystem {
  constructor(max = 100, regenMultiplier = 1) {
    this.max = max;
    this.value = max;
    this.regenMultiplier = regenMultiplier;
    this.regenDelay = 0; // temps restant avant de récupérer
    this.bodyPenaltyTimer = 0;
    this.spentThisRound = 0;
  }

  reset() {
    this.value = this.max;
    this.regenDelay = 0;
    this.bodyPenaltyTimer = 0;
    this.spentThisRound = 0;
  }

  get ratio() {
    return this.value / this.max;
  }

  /**
   * Dépense de l'endurance. Retourne la fraction réellement payée (0-1) :
   * un boxeur à sec peut encore frapper, mais le coup sera très faible.
   */
  spend(amount) {
    if (amount <= 0) return 1;
    const paid = Math.min(this.value, amount);
    this.value -= paid;
    this.spentThisRound += paid;
    this.regenDelay = Math.max(this.regenDelay, C.regenDelay);
    return paid / amount;
  }

  canAfford(amount) {
    return this.value >= amount;
  }

  /** Perte d'endurance subie (coup au corps, coup bloqué). */
  drain(amount, isBody = false) {
    this.value = Math.max(0, this.value - amount);
    if (isBody) this.bodyPenaltyTimer = C.bodyShotPenaltyDuration;
  }

  /** Récupération partielle entre les rounds. */
  recover(fraction) {
    this.value = Math.min(this.max, this.value + (this.max - this.value) * fraction);
    this.regenDelay = 0;
    this.bodyPenaltyTimer = 0;
    this.spentThisRound = 0;
  }

  /**
   * @param {number} dt
   * @param {'idle'|'moving'|'guarding'|'busy'} activity
   */
  update(dt, activity) {
    if (this.bodyPenaltyTimer > 0) this.bodyPenaltyTimer -= dt;
    if (this.regenDelay > 0) {
      this.regenDelay -= dt;
      return;
    }
    if (activity === 'busy') return;
    let rate = C.regenIdle;
    if (activity === 'moving') rate = C.regenMoving;
    else if (activity === 'guarding') rate = C.regenGuard;
    if (this.bodyPenaltyTimer > 0) rate *= C.bodyShotRegenPenalty;
    this.value = clamp(this.value + rate * this.regenMultiplier * dt, 0, this.max);
  }

  /** Multiplicateur de dégâts selon l'endurance (essoufflé = coups moins efficaces). */
  efficiency() {
    return lerp(C.efficiencyFloor, 1, smoothstep(0, C.efficiencyKnee, this.value));
  }

  /** Multiplicateur de vitesse des coups. */
  speedFactor() {
    return lerp(C.speedFloor, 1, smoothstep(0, C.efficiencyKnee * 0.8, this.value));
  }

  isExhausted() {
    return this.value < C.exhaustedThreshold;
  }
}
