/**
 * Opponent.js
 * ------------------------------------------------------------------
 * Boxeur contrôlé par l'IA. Il utilise exactement les mêmes règles que le
 * joueur (endurance, timings, détection) : l'IA ne triche pas, elle décide.
 * Son état est lu à chaque frame par l'affichage.
 */

import { Vector3 } from 'three';
import { Fighter } from './Fighter.js';
import { GameConfig } from '../config/GameConfig.js';
import { lerp, localToWorld } from '../core/MathUtils.js';

const ST = GameConfig.stance;

export class Opponent extends Fighter {
  constructor(opts) {
    super({ ...opts, isPlayer: false });
    this.aimError = new Vector3(); // erreur de visée choisie par l'IA
    this.target = new Vector3();
    this.ai = null;
  }

  /** Change de profil (nouveau boxeur) en gardant les mêmes objets. */
  setProfile(profile) {
    this.profile = profile;
    this.stats = { ...profile.stats };
    this.name = profile.name;
    this.stamina.max = this.stats.staminaMax || 100;
    this.stamina.regenMultiplier = this.stats.staminaRegen || 1;
  }

  getHandRestWorld(hand, out) {
    const r = ST.rest[hand];
    const g = ST.guard[hand];
    const ga = this.guard.amount;
    const low = this.guard.lowBlend * ga;
    let x = lerp(r[0], g[0], ga);
    let y = lerp(r[1], g[1], ga);
    let z = lerp(r[2], g[2], ga);
    // Garde basse : coudes serrés devant le ventre
    y = lerp(y, 1.2, low);
    z = lerp(z, -0.25, low);
    x *= 1 - low * 0.15;
    // Les gants suivent la tête pendant les esquives
    const h = this.headOffset;
    x += h.x * 0.85;
    y += h.y * 0.85;
    z += h.z * 0.7;
    if (this.isStunned) y -= 0.2;
    return localToWorld(this.position, this.yaw, x, y, z, out);
  }

  resolvePunchTarget(def, zone) {
    const opp = this.opponent;
    const z = zone || 'head';
    if (z === 'head') this.target.copy(opp.zones.head);
    else this.target.copy(opp.zones.chest).lerp(opp.zones.belly, 0.45);
    this.target.add(this.aimError);
    return { zone: z, point: this.target, hasTarget: true };
  }
}
