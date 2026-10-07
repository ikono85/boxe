/**
 * Styles.js
 * ------------------------------------------------------------------
 * Styles de combat des adversaires. Le niveau (Difficulty.js) règle le
 * TALENT de l'IA (réflexes, précision, lecture du joueur) ; le style règle
 * sa FAÇON de boxer (distance, coups préférés, volume, prise de risque).
 * Un même boxeur reste reconnaissable à tous les niveaux.
 *
 * mods :
 *   mul   multiplie une valeur du niveau (probabilités bornées à 0-1)
 *   add   ajoute à une valeur du niveau (après mul)
 *   set   remplace une valeur (distance de travail, répertoire de coups…)
 *
 * Champs propres aux styles (lus par game/AI.js) :
 *   exitRate   chance de ressortir après une attaque (sinon il reste au contact)
 *   combos     enchaînements favoris, ajoutés au répertoire commun [{ seq, weight }]
 *   pressure   avance même en situation neutre (0 = jamais, 1 = colle le joueur)
 *   waitCounter le contreur attend que le joueur attaque avant de lancer ses coups
 */

export const FIGHT_STYLES = {
  standard: {
    id: 'standard',
    label: 'Complet',
    summary: 'Boxe équilibrée : le niveau fait tout.',
    mods: {},
  },

  brawler: {
    id: 'brawler',
    label: 'Cogneur',
    summary: 'Avance sans reculer, encaisse derrière sa garde et cherche le gros coup : crochets, uppercuts, corps.',
    mods: {
      mul: {
        aggression: 1.25, footwork: 0.45, dodgeSkill: 0.35, headMovement: 0.35,
        blockSkill: 1.25, guardHabit: 1.3, counterSkill: 0.7, bodyShotRate: 1.6, windupMultiplier: 1.12,
      },
      add: { aggression: 0.08 },
      set: {
        preferredRange: 0.98,
        exitRate: 0.08,
        pressure: 0.8,
        punchWeights: { jab: 1.4, cross: 2.4, hookL: 3.6, hookR: 3.2, upperL: 1.6, upperR: 2.6 },
        combos: [
          { seq: ['hookL', 'hookR'], weight: 4 },
          { seq: ['upperR', 'hookL'], weight: 3 },
          { seq: ['cross', 'hookL', 'upperR'], weight: 2.5 },
        ],
      },
    },
  },

  outboxer: {
    id: 'outboxer',
    label: 'Danseur',
    summary: 'Tourne sans arrêt, vous tient au bout de son jab et ressort aussitôt. Difficile à coincer.',
    mods: {
      mul: {
        aggression: 0.8, footwork: 1.7, dodgeSkill: 1.5, headMovement: 1.8,
        guardHabit: 0.6, blockSkill: 0.85, bodyShotRate: 0.5, turnSpeed: 1.2,
      },
      add: { dodgeSkill: 0.1, headMovement: 0.06, footwork: 0.2 },
      set: {
        preferredRange: 1.42,
        exitRate: 0.95,
        pressure: 0,
        punchWeights: { jab: 7, cross: 3.2, hookL: 1, hookR: 0.5, upperL: 0.2, upperR: 0.4 },
        combos: [
          { seq: ['jab', 'jab'], weight: 4 },
          { seq: ['jab', 'cross'], weight: 4 },
          { seq: ['jab', 'jab', 'cross'], weight: 3 },
        ],
      },
    },
  },

  swarmer: {
    id: 'swarmer',
    label: 'Pression',
    summary: 'Colle à vous et enchaîne sans s’arrêter, surtout au corps. Un souffle hors norme.',
    mods: {
      mul: {
        aggression: 1.25, comboSkill: 1.35, bodyShotRate: 1.7, staminaDiscipline: 0.7,
        guardHabit: 1.1, dodgeSkill: 0.8, decisionInterval: 0.75, windupMultiplier: 0.95,
      },
      add: { comboSkill: 0.08 },
      set: {
        preferredRange: 0.94,
        exitRate: 0.15,
        pressure: 0.6,
        combos: [
          { seq: ['jab', 'cross', 'hookL', 'cross'], weight: 3 },
          { seq: ['hookL', 'hookR', 'hookL'], weight: 2.5 },
          { seq: ['jab', 'jab', 'cross', 'hookL'], weight: 2 },
          { seq: ['cross', 'hookL', 'hookR'], weight: 2 },
        ],
      },
    },
  },

  counter: {
    id: 'counter',
    label: 'Contreur',
    summary: 'Attend que vous attaquiez, bloque ou esquive, puis punit chaque erreur. Ne frappez pas dans le vide.',
    mods: {
      mul: {
        aggression: 0.45, counterSkill: 1.6, blockSkill: 1.2, dodgeSkill: 1.25,
        anticipation: 1.6, headMovement: 1.2, guardHabit: 1.2,
      },
      add: { counterSkill: 0.2, anticipation: 0.08 },
      set: {
        preferredRange: 1.2,
        exitRate: 0.85,
        pressure: 0,
        waitCounter: true,
        punchWeights: { jab: 3, cross: 4, hookL: 2.5, hookR: 1.2, upperL: 0.8, upperR: 1.6 },
      },
    },
  },
};

/** Valeurs qui ne sont pas des probabilités (pas de borne à 1). */
const UNBOUNDED = new Set(['windupMultiplier', 'turnSpeed', 'preferredRange', 'reactionTime', 'reactionJitter', 'lead']);

/**
 * Profil d'IA final : niveau (talent) + style du boxeur (façon de boxer).
 * @param {object} difficulty profil de Difficulty.js
 * @param {object} boxer profil de Boxers.js (fightStyle)
 */
export function buildAIProfile(difficulty, boxer) {
  const style = FIGHT_STYLES[(boxer && boxer.fightStyle) || 'standard'] || FIGHT_STYLES.standard;
  const p = { ...difficulty, punchWeights: { ...difficulty.punchWeights }, style: style.id };
  const { mul = {}, add = {}, set = {} } = style.mods;
  for (const [k, m] of Object.entries(mul)) {
    if (k === 'decisionInterval') p.decisionInterval = difficulty.decisionInterval.map((v) => v * m);
    else if (typeof p[k] === 'number') p[k] *= m;
  }
  for (const [k, a] of Object.entries(add)) if (typeof p[k] === 'number') p[k] += a;
  for (const k of Object.keys(p)) {
    if (typeof p[k] === 'number' && !UNBOUNDED.has(k) && (k in mul || k in add)) p[k] = Math.max(0, Math.min(1, p[k]));
  }
  if (mul.footwork || add.footwork) p.footwork = Math.max(0, Math.min(1.4, difficulty.footwork * (mul.footwork || 1) + (add.footwork || 0)));
  Object.assign(p, set);
  return p;
}
