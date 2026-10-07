/**
 * Boxers.js
 * ------------------------------------------------------------------
 * Profils des boxeurs : statistiques de combat, apparence et « fiche technique »
 * (tale of the tape). Pour ajouter un boxeur, il suffit d'ajouter une entrée :
 * le modèle 3D, l'IA et l'interface lisent tout ici.
 *
 * fightStyle : façon de boxer de l'IA (clé de FIGHT_STYLES dans config/Styles.js).
 *
 * look.model : personnage 3D animé par capture (clé de MIXAMO_MODELS dans
 * characters/MixamoBoxerModel.js). Sans cette clé, le boxeur est construit en
 * primitives (BoxerModel) à partir des autres champs de `look`.
 *
 * stats :
 *   power        multiplicateur de dégâts
 *   speed        multiplicateur de vitesse des coups
 *   defense      divise les dégâts reçus
 *   staminaMax   endurance maximale
 *   staminaRegen multiplicateur de récupération
 *   chin         résistance à l'étourdissement (« menton »)
 */

export const BOXERS = {
  player: {
    id: 'player',
    name: 'Vous',
    nickname: 'Coin rouge',
    corner: 'red',
    stats: { power: 1, speed: 1, defense: 1, staminaMax: 100, staminaRegen: 1, chin: 1 },
    look: { skin: '#c98d66' },
  },

  rookie: {
    id: 'rookie',
    name: 'Léo Martin',
    nickname: 'Le Rookie',
    corner: 'blue',
    hometown: 'Lyon',
    stats: { power: 0.82, speed: 0.9, defense: 0.88, staminaMax: 100, staminaRegen: 0.9, chin: 0.85 },
    look: {
      skin: '#e2b08a', hair: '#4a2c18', hairStyle: 'crop', beard: false,
      shorts: '#1f8a52', trim: '#f4f1e6', shoes: '#f2f2f2', build: 0.94, height: 1.0,
      model: 'xbot', // personnage 3D (characters/createBoxerModel.js)
    },
    tape: { age: 21, height: 178, reach: 180, weight: 71, record: '4-3-0', kos: 1 },
    style: 'Garde fermée, attaque peu, se déplace en ligne droite.',
    fightStyle: 'standard',
  },

  tempest: {
    id: 'tempest',
    name: 'Marco Reyes',
    nickname: 'La Tempête',
    corner: 'blue',
    hometown: 'Marseille',
    stats: { power: 1, speed: 1.06, defense: 1, staminaMax: 100, staminaRegen: 1, chin: 1 },
    look: {
      skin: '#a8714c', hair: '#161211', hairStyle: 'fade', beard: true,
      shorts: '#1d4fd8', trim: '#f5c542', shoes: '#16181d', build: 1.0, height: 0.98,
      model: 'xbot',
    },
    tape: { age: 27, height: 175, reach: 179, weight: 70, record: '19-4-1', kos: 11 },
    style: 'Rythme régulier, esquive, bloque et contre de temps en temps.',
    fightStyle: 'standard',
  },

  hammer: {
    id: 'hammer',
    name: 'Viktor Kral',
    nickname: 'Le Marteau',
    corner: 'blue',
    hometown: 'Prague',
    stats: { power: 1.1, speed: 1.04, defense: 1.08, staminaMax: 105, staminaRegen: 1.1, chin: 1.2 },
    look: {
      skin: '#e8c3a3', hair: '#c9b48a', hairStyle: 'buzz', beard: false,
      shorts: '#0f1115', trim: '#d62828', shoes: '#0f1115', build: 1.08, height: 1.04,
      model: 'xbot',
    },
    tape: { age: 31, height: 188, reach: 193, weight: 84, record: '31-1-0', kos: 24 },
    style: 'Lit vos habitudes, contre, gère son souffle et cherche le KO.',
    fightStyle: 'standard',
  },

  /* ---------- Styles de combat (choisis dans « Adversaire ») ---------- */

  bulldozer: {
    id: 'bulldozer',
    name: 'Bruno Ferrand',
    nickname: 'Le Bulldozer',
    corner: 'blue',
    hometown: 'Saint-Étienne',
    stats: { power: 1.26, speed: 0.93, defense: 1.1, staminaMax: 110, staminaRegen: 1, chin: 1.4 },
    look: { shorts: '#8c1c13', body: '#b9b4ab', model: 'xbot' },
    tape: { age: 29, height: 181, reach: 183, weight: 86, record: '22-3-0', kos: 19 },
    style: 'Avance sans reculer, encaisse derrière sa garde et cherche le gros coup. Gardez vos distances, faites-le tourner.',
    fightStyle: 'brawler',
  },

  eel: {
    id: 'eel',
    name: 'Yanis Belkacem',
    nickname: 'L’Anguille',
    corner: 'blue',
    hometown: 'Bordeaux',
    stats: { power: 0.86, speed: 1.1, defense: 0.98, staminaMax: 105, staminaRegen: 1.1, chin: 0.9 },
    look: { shorts: '#0f8b8d', body: '#d3d8dc', model: 'xbot' },
    tape: { age: 24, height: 184, reach: 191, weight: 69, record: '15-1-0', kos: 4 },
    style: 'Tourne sans arrêt et vous tient au bout de son jab. Coupez-lui la route vers les cordes, il encaisse mal.',
    fightStyle: 'outboxer',
  },

  gatling: {
    id: 'gatling',
    name: 'Kenji Moreau',
    nickname: 'La Mitraillette',
    corner: 'blue',
    hometown: 'Lille',
    stats: { power: 0.84, speed: 1.08, defense: 0.92, staminaMax: 115, staminaRegen: 1.15, chin: 1 },
    look: { shorts: '#6b2bb8', body: '#c9ccd2', model: 'xbot' },
    tape: { age: 26, height: 170, reach: 172, weight: 63, record: '18-4-0', kos: 8 },
    style: 'Colle à vous et enchaîne sans s’arrêter, surtout au corps. Bloquez bas, esquivez et contrez entre ses séries.',
    fightStyle: 'swarmer',
  },

  sniper: {
    id: 'sniper',
    name: 'Dmitri Volkov',
    nickname: 'Le Sniper',
    corner: 'blue',
    hometown: 'Nice',
    stats: { power: 1.06, speed: 1.02, defense: 1.12, staminaMax: 100, staminaRegen: 1.05, chin: 1 },
    look: { shorts: '#c48a1a', body: '#a9adb4', model: 'xbot' },
    tape: { age: 33, height: 186, reach: 188, weight: 79, record: '27-2-1', kos: 14 },
    style: 'Attend que vous attaquiez, puis punit chaque erreur. Feintez, frappez court et ne restez pas devant lui.',
    fightStyle: 'counter',
  },
};

/**
 * Adversaire du combat : choix du joueur, ou celui du niveau (« auto »).
 * @param {string} choice réglage « opponent »
 * @param {object} difficulty profil de Difficulty.js
 */
export function opponentFor(choice, difficulty) {
  return BOXERS[choice] && choice !== 'player' ? BOXERS[choice] : BOXERS[difficulty.opponent];
}

/** Adversaires proposés dans le menu « Adversaire » (après « Selon le niveau »). */
export const OPPONENT_ORDER = ['rookie', 'tempest', 'hammer', 'bulldozer', 'eel', 'gatling', 'sniper'];

