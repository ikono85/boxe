/**
 * Command.js
 * ------------------------------------------------------------------
 * Commande d'un boxeur pour un tick de simulation. C'est la seule chose
 * échangée en ligne : chacun simule le combat à partir des commandes des deux
 * joueurs (voir net/Netcode.js).
 *
 * Forme « objet » (utilisée par Player.applyCommand) :
 *   { mx, mz,              déplacement (-1, 0, 1)
 *     guard, dodgeHeld,    touches maintenues
 *     dirPressed, duck,    appuis de ce tick (esquives)
 *     dodge, punches,      punches = masque de bits dans l'ordre de PUNCH_ACTIONS
 *     yaw, pitch }         direction du regard (radians)
 *
 * Forme « paquet » : 3 entiers [bits, yaw, pitch], le regard quantifié au
 * 1/8192 de radian. Les deux navigateurs appliquent exactement les mêmes valeurs.
 */

import { PUNCH_ACTIONS } from '../config/Controls.js';
import { wrapAngle } from '../core/MathUtils.js';

const ANGLE_Q = 8192;

// Bits du paquet
const B_GUARD = 1 << 4;
const B_DODGE_HELD = 1 << 5;
const B_DIR = 1 << 6;
const B_DUCK = 1 << 7;
const B_DODGE = 1 << 8;
const PUNCH_SHIFT = 9;

/** Bits « appuyé ce tick » : ils ne se prédisent pas (on ne devine pas un coup). */
export const PRESSED_BITS = B_DIR | B_DUCK | B_DODGE | (((1 << PUNCH_ACTIONS.length) - 1) << PUNCH_SHIFT);

/** Commande neutre (immobile, garde baissée, regard droit devant). */
export const NO_COMMAND = Object.freeze([(1) | (1 << 2), 0, 0]);

/** Commande « objet » réutilisable (évite les allocations dans la boucle). */
export function emptyCommand() {
  return { mx: 0, mz: 0, guard: false, dodgeHeld: false, dirPressed: false, duck: false, dodge: false, punches: 0, yaw: 0, pitch: 0 };
}

/**
 * Lit le clavier et la souris.
 * @param {import('../core/Input.js').Input} input
 * @param {number} pressed masque d'appuis (voir pressedMask), cumulé depuis la dernière commande
 */
export function commandFromInput(input, yaw, pitch, pressed, out = emptyCommand()) {
  out.mx = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
  out.mz = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
  out.guard = input.isDown('guard');
  out.dodgeHeld = input.isDown('dodge');
  out.dirPressed = !!(pressed & B_DIR);
  out.duck = !!(pressed & B_DUCK);
  out.dodge = !!(pressed & B_DODGE);
  out.punches = (pressed >> PUNCH_SHIFT) & ((1 << PUNCH_ACTIONS.length) - 1);
  out.yaw = yaw;
  out.pitch = pitch;
  return out;
}

/** Appuis de cette image, au format des bits du paquet. */
export function pressedMask(input) {
  let m = 0;
  if (input.pressed('left') || input.pressed('right') || input.pressed('back') || input.pressed('forward')) m |= B_DIR;
  if (input.pressed('duck')) m |= B_DUCK;
  if (input.pressed('dodge')) m |= B_DODGE;
  PUNCH_ACTIONS.forEach((a, i) => {
    if (input.pressed(a)) m |= 1 << (PUNCH_SHIFT + i);
  });
  return m;
}

export function packCommand(c) {
  let bits = (c.mx + 1) | ((c.mz + 1) << 2);
  if (c.guard) bits |= B_GUARD;
  if (c.dodgeHeld) bits |= B_DODGE_HELD;
  if (c.dirPressed) bits |= B_DIR;
  if (c.duck) bits |= B_DUCK;
  if (c.dodge) bits |= B_DODGE;
  bits |= (c.punches & ((1 << PUNCH_ACTIONS.length) - 1)) << PUNCH_SHIFT;
  return [bits, Math.round(wrapAngle(c.yaw) * ANGLE_Q), Math.round(c.pitch * ANGLE_Q)];
}

export function unpackCommand(v, out = emptyCommand()) {
  const bits = v[0] | 0;
  out.mx = Math.max(-1, Math.min(1, (bits & 3) - 1));
  out.mz = Math.max(-1, Math.min(1, ((bits >> 2) & 3) - 1));
  out.guard = !!(bits & B_GUARD);
  out.dodgeHeld = !!(bits & B_DODGE_HELD);
  out.dirPressed = !!(bits & B_DIR);
  out.duck = !!(bits & B_DUCK);
  out.dodge = !!(bits & B_DODGE);
  out.punches = (bits >> PUNCH_SHIFT) & ((1 << PUNCH_ACTIONS.length) - 1);
  out.yaw = (v[1] | 0) / ANGLE_Q;
  out.pitch = (v[2] | 0) / ANGLE_Q;
  return out;
}

/** Prédiction de la commande adverse : il continue ce qu'il faisait, sans nouvel appui. */
export function predictCommand(v) {
  return [v[0] & ~PRESSED_BITS, v[1], v[2]];
}

export function sameCommand(a, b) {
  return a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);
}

/** Paquet reçu du réseau : valeurs bornées (un pair ne doit pas pouvoir casser la simulation). */
export function sanitizeCommand(v) {
  if (!Array.isArray(v) || v.length < 3) return NO_COMMAND;
  const lim = Math.round(Math.PI * ANGLE_Q) + 1;
  return [
    (v[0] | 0) & ((1 << (PUNCH_SHIFT + PUNCH_ACTIONS.length)) - 1),
    Math.max(-lim, Math.min(lim, v[1] | 0)),
    Math.max(-lim, Math.min(lim, v[2] | 0)),
  ];
}
