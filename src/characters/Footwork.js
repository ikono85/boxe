/**
 * Footwork.js
 * ------------------------------------------------------------------
 * Choix et pondération des clips de pas (4 directions × 3 amplitudes).
 *
 * Les clips Mixamo sont des pas isolés, capturés avec leur déplacement : un
 * « Long Step Forward » avance de 1,14 m en 1 s. Le jeu, lui, déplace le boxeur
 * par sa propre physique et le modèle annule la translation de la racine. Pour
 * que les pieds ne patinent pas, il faut donc :
 *
 *  1. répartir le mouvement sur les 4 directions (un déplacement en diagonale
 *     mélange « avant » et « côté ») ;
 *  2. choisir dans chaque direction le palier d'amplitude dont la vitesse
 *     naturelle est la plus proche de la vitesse demandée, pour que la vitesse
 *     de lecture reste proche de 1× ;
 *  3. donner à tous les clips actifs une durée de cycle commune, pour qu'ils
 *     restent en phase (sinon les jambes se battent entre deux clips).
 *
 * Fonctions pures : testables sans moteur de rendu (`tests/footwork.test.mjs`).
 */

/** Directions, dans l'ordre des clips `stepF* / stepB* / stepL* / stepR*`. */
export const DIRS = ['f', 'b', 'l', 'r'];

/**
 * Bornes de la vitesse de lecture des clips de pas. Au-delà, on préfère laisser
 * le pied glisser un peu plutôt que de jouer un pas en accéléré ridicule : les
 * clips Mixamo plafonnent à ~1,2 m/s vers l'avant et ~0,7 m/s vers la gauche,
 * loin des 2,85 m/s du sprint du jeu.
 */
export const RATE_LIMITS = { slowest: 0.65, fastest: 2.2 };

/**
 * Montée du jeu de jambes : plein régime dès 0,5 m/s. Inutile de monter plus
 * progressivement — c'est le choix du palier d'amplitude (un petit pas à
 * 0,29 m/s) qui gère les déplacements lents, pas une garde à moitié mélangée.
 */
export const MOVE_RAMP = { floor: 0.12, full: 0.38 };

/** Part du jeu de jambes dans la pose, selon la vitesse horizontale (m/s). */
export function movingAmount(speed) {
  const t = (speed - MOVE_RAMP.floor) / MOVE_RAMP.full;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Vitesse à demander au clip d'une direction, compte tenu de son poids dans le
 * mélange.
 *
 * Un clip mélangé à 50 % ne déplace le personnage que de la moitié de son pas :
 * pour qu'un déplacement en diagonale (moitié avant, moitié côté) parcoure bien
 * la distance voulue, chaque clip doit donc viser une vitesse *divisée* par son
 * poids. Sans cette correction, les diagonales avancent à moitié et les pieds
 * patinent de 50 %.
 *
 * @param {number} component vitesse demandée le long de cette direction (m/s)
 * @param {number} share poids de la direction dans le mélange (0..1)
 */
export function blendNeed(component, share) {
  return Math.abs(component) / Math.max(0.05, share);
}

/**
 * Répartition du mouvement sur les 4 directions.
 *
 * @param {number} vf vitesse vers l'avant (m/s ; négatif = vers l'arrière)
 * @param {number} vr vitesse vers la droite (m/s ; négatif = vers la gauche)
 * @returns {{f: number, b: number, l: number, r: number, speed: number}}
 *   parts de chaque direction (somme = 1 dès que l'on bouge) et norme de la
 *   vitesse horizontale.
 */
export function directionWeights(vf, vr) {
  const f = Math.max(0, vf);
  const b = Math.max(0, -vf);
  const r = Math.max(0, vr);
  const l = Math.max(0, -vr);
  const sum = f + b + l + r;
  if (sum <= 1e-6) return { f: 0, b: 0, l: 0, r: 0, speed: 0 };
  return { f: f / sum, b: b / sum, l: l / sum, r: r / sum, speed: Math.hypot(vf, vr) };
}

/**
 * Palier d'amplitude le mieux adapté à la vitesse demandée.
 *
 * L'écart est mesuré sur le rapport des vitesses (et non leur différence) :
 * c'est ce rapport qui devient la vitesse de lecture du clip. Le palier courant
 * est conservé tant qu'il reste dans `margin` du meilleur, pour éviter de
 * basculer sans arrêt entre deux paliers autour du seuil.
 *
 * @param {{speed: number}[]} tiers paliers triés par vitesse naturelle croissante
 * @param {number} need vitesse demandée dans cette direction (m/s)
 * @param {number} [current] indice du palier en cours (-1 si aucun)
 * @param {number} [margin] hystérésis, en écart de rapport logarithmique
 * @returns {number} indice du palier retenu, -1 si la liste est vide
 */
export function pickTier(tiers, need, current = -1, margin = 0.12) {
  if (!tiers.length) return -1;
  const want = Math.max(1e-3, need);
  let best = 0;
  let bestErr = Infinity;
  for (let i = 0; i < tiers.length; i++) {
    const err = Math.abs(Math.log(want / tiers[i].speed));
    if (err < bestErr) {
      bestErr = err;
      best = i;
    }
  }
  if (current >= 0 && current < tiers.length) {
    const curErr = Math.abs(Math.log(want / tiers[current].speed));
    if (curErr - bestErr < margin) return current;
  }
  return best;
}

/**
 * Durée de cycle commune aux clips actifs.
 *
 * Une direction qui doit avancer de `need` m/s avec un pas de `disp` m veut un
 * cycle de `disp / need` secondes. On prend la moyenne pondérée par la part de
 * chaque direction, puis on borne le résultat pour que la vitesse de lecture
 * (`dur / T`) reste dans `limits`. Le reste du glissement est assumé : mieux
 * vaut un pas légèrement décalé qu'un clip joué au triple de sa vitesse.
 *
 * @param {{share: number, disp: number, need: number, dur: number}[]} active
 * @param {{slowest: number, fastest: number}} [limits] bornes de vitesse de lecture
 * @returns {number} durée de cycle en secondes, 0 si rien n'est actif
 */
export function cycleTime(active, limits = RATE_LIMITS) {
  let num = 0;
  let den = 0;
  let durMin = Infinity;
  let durMax = 0;
  for (const a of active) {
    if (a.share <= 1e-4) continue;
    num += a.share * (a.disp / Math.max(0.05, a.need));
    den += a.share;
    if (a.dur < durMin) durMin = a.dur;
    if (a.dur > durMax) durMax = a.dur;
  }
  if (den <= 1e-6) return 0;
  // Bornes prises sur le clip le plus long et le plus court des clips actifs,
  // et non sur leur moyenne : sinon un clip plus long que la moyenne dépasse
  // quand même la vitesse de lecture maximale.
  return Math.min(durMin / limits.slowest, Math.max(durMax / limits.fastest, num / den));
}

/**
 * Vitesse de lecture d'un clip pour une durée de cycle donnée.
 * @param {number} dur durée du clip (s)
 * @param {number} cycle durée de cycle visée (s)
 */
export function clipRate(dur, cycle) {
  if (cycle <= 1e-6) return 1;
  return dur / cycle;
}
