/**
 * Rig.js
 * ------------------------------------------------------------------
 * Outils d'animation procédurale partagés : IK à deux os (bras, jambes),
 * placement d'un membre entre deux articulations, orientation d'un gant.
 */

import { Vector3, Matrix4, Quaternion } from 'three';

const _d = new Vector3();
const _dir = new Vector3();
const _p = new Vector3();
const _v = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _m = new Matrix4();
const Y = new Vector3(0, 1, 0);

/**
 * IK analytique à deux segments.
 * @param {Vector3} S racine (épaule / hanche)
 * @param {Vector3} T cible (poignet / cheville)
 * @param {number} a longueur du premier segment
 * @param {number} b longueur du second segment
 * @param {Vector3} pole point vers lequel plie l'articulation (coude / genou)
 * @param {Vector3} outE position calculée de l'articulation
 * @returns {number} facteur d'étirement (> 1 si la cible est hors de portée)
 */
export function solveTwoBone(S, T, a, b, pole, outE) {
  _d.subVectors(T, S);
  let d = _d.length();
  const max = (a + b) * 0.995;
  let stretch = 1;
  if (d > max) stretch = d / max;
  const aa = a * stretch;
  const bb = b * stretch;
  d = Math.max(1e-4, Math.min(d, (aa + bb) * 0.9995));
  _dir.copy(_d).normalize();
  let cosA = (aa * aa + d * d - bb * bb) / (2 * aa * d);
  cosA = Math.max(-1, Math.min(1, cosA));
  const sinA = Math.sqrt(1 - cosA * cosA);
  _p.subVectors(pole, S);
  _p.addScaledVector(_dir, -_p.dot(_dir));
  if (_p.lengthSq() < 1e-8) _p.set(0, -1, 0);
  _p.normalize();
  outE.copy(S).addScaledVector(_dir, aa * cosA).addScaledVector(_p, aa * sinA);
  return stretch;
}

/** Place un maillage aligné sur Y entre A et B (longueur de repos `length`). */
export function placeBone(mesh, A, B, length) {
  _v.subVectors(B, A);
  const len = _v.length();
  mesh.position.copy(A).add(B).multiplyScalar(0.5);
  if (len > 1e-6) mesh.quaternion.setFromUnitVectors(Y, _v.multiplyScalar(1 / len));
  mesh.scale.set(1, len / length, 1);
}

/**
 * Orientation d'un gant à partir de la direction des jointures (F) et d'une
 * indication pour le dos de la main (U).
 */
export function gloveQuaternion(F, U, out) {
  _z.copy(F).normalize().negate();
  _x.crossVectors(U, _z);
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0);
  _x.normalize();
  _y.crossVectors(_z, _x).normalize();
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

export const tmpQuat = new Quaternion();
