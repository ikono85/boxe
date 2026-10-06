/**
 * Punches.js
 * ------------------------------------------------------------------
 * Définition data-driven des coups et des combos.
 *
 * Chaque coup passe par 4 phases :
 *   windup   : anticipation (le gant recule légèrement, le corps se charge)
 *   strike   : déplacement rapide du gant le long de sa trajectoire
 *   hold     : impact / extension maximale (gel de l'image si touché)
 *   recovery : retour en garde
 *
 * Champs :
 *   hand        main utilisée ('left' | 'right')
 *   kind        'straight' | 'hook' | 'uppercut' (forme de la trajectoire)
 *   family      clé utilisée pour reconnaître les combos ('jab', 'cross', 'hook', 'uppercut')
 *   damage      dégâts de base à la tête (HP)
 *   cost        coût en endurance
 *   staminaDamage endurance retirée à l'adversaire touché
 *   stun        accumulation d'étourdissement (tête)
 *   reach       portée horizontale max du gant depuis le centre du boxeur (m)
 *   flinch      durée pendant laquelle l'adversaire touché ne peut pas agir
 *   knockback   impulsion (m/s) qui fait reculer l'adversaire
 *   crit        chance de coup critique de base (tête uniquement)
 *   hitStop     durée du gel d'image à l'impact (s)
 *   shake       intensité du tremblement de caméra
 *   score       points d'arcade quand le coup touche
 */

export const PUNCHES = {
  jab: {
    id: 'jab', label: 'Jab', short: 'J', hand: 'left', kind: 'straight', family: 'jab',
    windup: 0.06, strike: 0.1, hold: 0.05, recovery: 0.16,
    damage: 3.5, cost: 5, staminaDamage: 3, stun: 7, reach: 0.98,
    flinch: 0.17, knockback: 0.45, crit: 0.03, hitStop: 0.04, shake: 0.12, score: 10,
  },
  cross: {
    id: 'cross', label: 'Direct', short: 'D', hand: 'right', kind: 'straight', family: 'cross',
    windup: 0.09, strike: 0.12, hold: 0.06, recovery: 0.22,
    damage: 6.4, cost: 8, staminaDamage: 5, stun: 13, reach: 1.02,
    flinch: 0.24, knockback: 0.9, crit: 0.06, hitStop: 0.06, shake: 0.22, score: 20,
  },
  hookL: {
    id: 'hookL', label: 'Crochet gauche', short: 'CG', hand: 'left', kind: 'hook', family: 'hook',
    windup: 0.12, strike: 0.14, hold: 0.06, recovery: 0.25,
    damage: 7.7, cost: 10, staminaDamage: 6, stun: 17, reach: 0.8,
    flinch: 0.28, knockback: 0.75, crit: 0.09, hitStop: 0.07, shake: 0.3, score: 30,
  },
  hookR: {
    id: 'hookR', label: 'Crochet droit', short: 'CD', hand: 'right', kind: 'hook', family: 'hook',
    windup: 0.13, strike: 0.14, hold: 0.06, recovery: 0.26,
    damage: 8.5, cost: 11, staminaDamage: 6, stun: 18, reach: 0.8,
    flinch: 0.28, knockback: 0.8, crit: 0.09, hitStop: 0.07, shake: 0.32, score: 30,
  },
  upperL: {
    id: 'upperL', label: 'Uppercut gauche', short: 'UG', hand: 'left', kind: 'uppercut', family: 'uppercut',
    windup: 0.13, strike: 0.14, hold: 0.07, recovery: 0.27,
    damage: 8.5, cost: 11, staminaDamage: 6, stun: 20, reach: 0.72,
    flinch: 0.3, knockback: 0.6, crit: 0.11, hitStop: 0.075, shake: 0.32, score: 40,
  },
  upperR: {
    id: 'upperR', label: 'Uppercut droit', short: 'UD', hand: 'right', kind: 'uppercut', family: 'uppercut',
    windup: 0.14, strike: 0.14, hold: 0.07, recovery: 0.28,
    damage: 9.4, cost: 12, staminaDamage: 6, stun: 22, reach: 0.72,
    flinch: 0.3, knockback: 0.65, crit: 0.12, hitStop: 0.08, shake: 0.35, score: 40,
  },
};

export const PUNCH_IDS = Object.keys(PUNCHES);

/** Coups « puissants » (comptés à part dans les statistiques et par les juges). */
export function isPowerPunch(id) {
  return id !== 'jab';
}

/**
 * Combos reconnus. `sequence` contient des familles de coups ('hook' accepte
 * crochet gauche ou droit) ou des identifiants précis ('hookL').
 * Le dernier coup de la séquence reçoit le bonus de dégâts.
 */
export const COMBOS = [
  { id: 'jab-hook-upper', name: 'Jab → Crochet → Uppercut', sequence: ['jab', 'hook', 'uppercut'], damageBonus: 0.35, score: 250 },
  { id: 'jab-jab-cross', name: 'Jab → Jab → Direct', sequence: ['jab', 'jab', 'cross'], damageBonus: 0.25, score: 160 },
  { id: 'one-two-hook', name: 'Jab → Direct → Crochet', sequence: ['jab', 'cross', 'hookL'], damageBonus: 0.3, score: 200 },
  { id: 'one-two', name: 'Jab → Direct', sequence: ['jab', 'cross'], damageBonus: 0.15, score: 80 },
  { id: 'cross-hook', name: 'Direct → Crochet', sequence: ['cross', 'hookL'], damageBonus: 0.2, score: 110 },
  { id: 'upper-hook', name: 'Uppercut → Crochet', sequence: ['uppercut', 'hook'], damageBonus: 0.2, score: 130 },
  { id: 'double-hook', name: 'Double crochet', sequence: ['hookL', 'hookR'], damageBonus: 0.15, score: 100 },
];

// Les combos les plus longs sont testés en premier.
COMBOS.sort((a, b) => b.sequence.length - a.sequence.length);

function tokenMatches(token, punchId) {
  return token === punchId || PUNCHES[punchId].family === token;
}

/**
 * Cherche un combo qui se termine par la chaîne de coups donnée
 * (liste d'identifiants, du plus ancien au plus récent).
 */
export function findCombo(chain) {
  for (const combo of COMBOS) {
    const n = combo.sequence.length;
    if (chain.length < n) continue;
    let ok = true;
    for (let i = 0; i < n; i++) {
      if (!tokenMatches(combo.sequence[i], chain[chain.length - n + i])) {
        ok = false;
        break;
      }
    }
    if (ok) return combo;
  }
  return null;
}
