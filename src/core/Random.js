/**
 * Random.js
 * ------------------------------------------------------------------
 * Générateur pseudo-aléatoire « seedable » (mulberry32). Tout le gameplay
 * passe par lui : on peut rejouer une simulation à l'identique (tests,
 * replays, futur multijoueur déterministe).
 */

let state = (Date.now() ^ 0x9e3779b9) >>> 0;

export function setSeed(seed) {
  state = seed >>> 0;
}

/** État interne du générateur (sauvegarde / restauration : netcode, replays). */
export function getRandomState() {
  return state;
}

export function setRandomState(s) {
  state = s >>> 0;
}

export function random() {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const range = (min, max) => min + (max - min) * random();
export const chance = (p) => random() < p;
export const pick = (arr) => arr[Math.floor(random() * arr.length)];

/** Tirage pondéré dans un objet { clé: poids }. */
export function weightedPick(weights) {
  let total = 0;
  for (const k in weights) total += Math.max(0, weights[k]);
  if (total <= 0) return null;
  let r = random() * total;
  for (const k in weights) {
    r -= Math.max(0, weights[k]);
    if (r <= 0) return k;
  }
  return Object.keys(weights)[0];
}
