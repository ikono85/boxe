/**
 * HitDetection.js
 * ------------------------------------------------------------------
 * Détection géométrique des impacts.
 *
 * Le gant (une sphère) est balayé le long de sa trajectoire entre deux frames
 * et testé contre les volumes du défenseur :
 *   - la garde haute (gants devant le visage) ou basse (devant le ventre),
 *   - la tête, la poitrine et le ventre.
 * Seuls les volumes de la zone visée sont testés (tête + garde haute, ou
 * corps + garde basse) ; le premier touché le long de la trajectoire l'emporte.
 *
 * Comme les esquives déplacent réellement la tête (et le corps), on obtient
 * naturellement un « pierre-feuille-ciseaux » :
 *   - esquive latérale : évite les directs et uppercuts, pas les crochets ;
 *   - tête baissée : évite directs et crochets, pas les uppercuts ;
 *   - recul : met hors de portée ;
 *   - les coups au corps ne s'esquivent pas avec la tête.
 */

import { Vector3 } from 'three';
import { GameConfig } from '../config/GameConfig.js';
import { smoothstep } from '../core/MathUtils.js';

const CC = GameConfig.combat;

const _a = new Vector3();
const _b = new Vector3();
const _toAttacker = new Vector3();
const _fwd = new Vector3();

/**
 * Plus petit t ∈ [0,1] où le segment AB entre dans la sphère (c, R).
 * Retourne -1 s'il n'y a pas de contact.
 */
export function segmentSphereTOI(a, b, c, R) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const fx = a.x - c.x;
  const fy = a.y - c.y;
  const fz = a.z - c.z;
  const C = fx * fx + fy * fy + fz * fz - R * R;
  if (C <= 0) return 0; // déjà au contact
  const A = dx * dx + dy * dy + dz * dz;
  if (A < 1e-10) return -1;
  const B = 2 * (fx * dx + fy * dy + fz * dz);
  const disc = B * B - 4 * A * C;
  if (disc < 0) return -1;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  return t >= 0 && t <= 1 ? t : -1;
}

/**
 * Part de la garde du défenseur qui couvre l'attaquant (0 = attaqué de côté,
 * 1 = de face). Une garde ne protège pas des coups portés depuis le flanc.
 */
export function guardCoverage(defender, attacker) {
  _toAttacker.copy(attacker.position).sub(defender.position).setY(0);
  const len = _toAttacker.length();
  if (len < 1e-4) return 1;
  _toAttacker.divideScalar(len);
  _fwd.set(-Math.sin(defender.yaw), 0, -Math.cos(defender.yaw));
  const angle = Math.acos(Math.max(-1, Math.min(1, _fwd.dot(_toAttacker))));
  return 1 - smoothstep(CC.flankAngleFull, CC.flankAngleNone, angle);
}

/**
 * Balaye le coup entre prevU et u. Retourne null ou
 * { type: 'guard' | 'head' | 'body', u, point, coverage }.
 */
export function sweepPunch(punch, attacker, defender, punchSystem, out) {
  const from = punch.prevU;
  const to = punch.u;
  if (to <= from && !punch.pendingResolution) return null;

  const zones = defender.zones;
  const gr = CC.gloveRadius;
  const coverage = guardCoverage(defender, attacker);
  const guardUp = defender.guard.amount >= CC.guardBlockThreshold && coverage >= 0.5;
  const lowGuard = defender.guard.lowBlend > 0.5;

  const span = Math.max(0, to - from);
  const steps = Math.max(1, Math.ceil(span / 0.1));
  const origin = attacker.position;

  punchSystem.pathPoint(punch, from, _a).add(origin);
  let uA = from;
  for (let i = 1; i <= steps; i++) {
    const uB = from + (span * i) / steps;
    punchSystem.pathPoint(punch, uB, _b).add(origin);

    let bestT = 2;
    let bestType = null;
    const test = (center, radius, type) => {
      const t = segmentSphereTOI(_a, _b, center, radius + gr);
      if (t >= 0 && t < bestT) {
        bestT = t;
        bestType = type;
      }
    };

    // Un coup ne teste que la zone visée : un coup à la tête esquivé ne
    // « glisse » pas sur la poitrine, et la garde haute ne protège que la tête.
    if (punch.zone === 'head') {
      if (guardUp && !lowGuard) test(zones.guardHigh, CC.guardSphereRadius, 'guard');
      test(zones.head, CC.headRadius, 'head');
    } else {
      if (guardUp && lowGuard) test(zones.guardLow, CC.guardSphereRadius * 1.15, 'guard');
      test(zones.chest, CC.chestRadius, 'body');
      test(zones.belly, CC.bellyRadius, 'body');
    }

    if (bestType) {
      const uHit = uA + (uB - uA) * bestT;
      out.type = bestType;
      out.u = uHit;
      out.coverage = coverage;
      out.lowGuard = lowGuard;
      out.point.copy(_a).lerp(_b, bestT);
      return out;
    }
    _a.copy(_b);
    uA = uB;
  }
  return null;
}

/** Objet résultat réutilisable (évite les allocations à chaque frame). */
export function createHitResult() {
  return { type: null, u: 0, point: new Vector3(), coverage: 1, lowGuard: false };
}
