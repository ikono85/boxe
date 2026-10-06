/**
 * Difficulty.js
 * ------------------------------------------------------------------
 * Profils de comportement de l'IA. Chaque niveau choisit aussi un adversaire
 * par défaut (voir Boxers.js). Toutes les valeurs de probabilité sont entre 0 et 1.
 *
 * reactionTime      délai avant de réagir à un coup du joueur (s)
 * blockSkill        chance de lever la garde quand il voit venir un coup
 * dodgeSkill        chance d'esquiver plutôt que bloquer
 * wrongDodge        chance de choisir la mauvaise esquive (ex. baisser la tête face à un uppercut)
 * counterSkill      chance de contre-attaquer après une défense réussie ou un coup raté du joueur
 * aggression        envie d'attaquer en situation neutre
 * comboSkill        chance d'enchaîner plusieurs coups
 * guardHabit        tendance à garder la garde haute quand il n'attaque pas
 * windupMultiplier  anticipation plus longue = coups plus lisibles pour le joueur
 * turnSpeed         vitesse de rotation pour faire face au joueur (rad/s)
 * footwork          déplacements latéraux, angles, tours de ring
 * staminaDiscipline gestion de l'endurance (0 = frappe jusqu'à l'épuisement)
 * adaptation        analyse des habitudes du joueur
 * killInstinct      pression quand le joueur est sonné ou affaibli
 * bodyShotRate      proportion de coups au corps
 * feintRate         chance de feinter pour provoquer une réaction
 * accuracy          précision de la visée
 * anticipation      défense préventive quand le joueur est à portée
 * lead              anticipation du déplacement du joueur quand il vise
 * headMovement      mouvements de tête préventifs quand le joueur est à portée
 * preferredRange    distance de travail en situation neutre (m)
 * decisionInterval  intervalle entre deux décisions tactiques (s)
 */

export const DIFFICULTIES = {
  beginner: {
    id: 'beginner',
    label: 'Débutant',
    opponent: 'rookie',
    description: 'Attaque peu, garde souvent, se déplace simplement.',
    reactionTime: 0.34, reactionJitter: 0.1,
    blockSkill: 0.4, dodgeSkill: 0.04, wrongDodge: 0.5, counterSkill: 0.05,
    aggression: 0.22, comboSkill: 0.08, guardHabit: 0.78,
    windupMultiplier: 2.5, turnSpeed: 2.4, footwork: 0.15,
    staminaDiscipline: 0.1, adaptation: 0, killInstinct: 0.15,
    bodyShotRate: 0.12, feintRate: 0, accuracy: 0.74, anticipation: 0.05,
    lead: 0.3, headMovement: 0.02,
    preferredRange: 1.12, decisionInterval: [0.55, 1.0],
    punchWeights: { jab: 5, cross: 3, hookL: 1, hookR: 0.6, upperL: 0.2, upperR: 0.4 },
  },

  intermediate: {
    id: 'intermediate',
    label: 'Équilibré',
    opponent: 'tempest',
    description: 'Attaque régulièrement, esquive, bloque et contre parfois.',
    reactionTime: 0.18, reactionJitter: 0.06,
    blockSkill: 0.55, dodgeSkill: 0.35, wrongDodge: 0.25, counterSkill: 0.35,
    aggression: 0.5, comboSkill: 0.4, guardHabit: 0.5,
    windupMultiplier: 1.65, turnSpeed: 4, footwork: 0.6,
    staminaDiscipline: 0.45, adaptation: 0.25, killInstinct: 0.45,
    bodyShotRate: 0.25, feintRate: 0.04, accuracy: 0.86, anticipation: 0.18,
    lead: 0.7, headMovement: 0.16,
    preferredRange: 1.18, decisionInterval: [0.3, 0.6],
    punchWeights: { jab: 4, cross: 3, hookL: 2, hookR: 1.5, upperL: 0.8, upperR: 1 },
  },

  expert: {
    id: 'expert',
    label: 'Expert',
    opponent: 'hammer',
    description: 'Analyse vos attaques, contre, varie ses coups, gère son souffle et cherche le KO.',
    reactionTime: 0.14, reactionJitter: 0.04,
    blockSkill: 0.7, dodgeSkill: 0.55, wrongDodge: 0.08, counterSkill: 0.75,
    aggression: 0.58, comboSkill: 0.65, guardHabit: 0.42,
    windupMultiplier: 1.3, turnSpeed: 6, footwork: 0.9,
    staminaDiscipline: 1, adaptation: 1, killInstinct: 0.95,
    bodyShotRate: 0.32, feintRate: 0.12, accuracy: 0.9, anticipation: 0.35,
    lead: 1, headMovement: 0.26,
    preferredRange: 1.2, decisionInterval: [0.16, 0.34],
    punchWeights: { jab: 4, cross: 3, hookL: 2.5, hookR: 2, upperL: 1.5, upperR: 1.8 },
  },
};

export const DIFFICULTY_ORDER = ['beginner', 'intermediate', 'expert'];
