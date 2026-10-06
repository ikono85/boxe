/**
 * Boxers.js
 * ------------------------------------------------------------------
 * Profils des boxeurs : statistiques de combat, apparence et « fiche technique »
 * (tale of the tape). Pour ajouter un boxeur, il suffit d'ajouter une entrée :
 * le modèle 3D, l'IA et l'interface lisent tout ici.
 *
 * look.model : personnage 3D riggé (clé de CHARACTER_MODELS dans
 * characters/RiggedBoxerModel.js). Sans cette clé, le boxeur est construit en
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
    gloves: 'crimson',
    look: { skin: '#c98d66' },
  },

  rookie: {
    id: 'rookie',
    name: 'Léo Martin',
    nickname: 'Le Rookie',
    corner: 'blue',
    hometown: 'Lyon',
    stats: { power: 0.82, speed: 0.9, defense: 0.88, staminaMax: 100, staminaRegen: 0.9, chin: 0.85 },
    gloves: 'emerald',
    look: {
      skin: '#e2b08a', hair: '#4a2c18', hairStyle: 'crop', beard: false,
      shorts: '#1f8a52', trim: '#f4f1e6', shoes: '#f2f2f2', build: 0.94, height: 1.0,
      model: 'casual', // personnage 3D (characters/RiggedBoxerModel.js)
    },
    tape: { age: 21, height: 178, reach: 180, weight: 71, record: '4-3-0', kos: 1 },
    style: 'Garde fermée, attaque peu, se déplace en ligne droite.',
  },

  tempest: {
    id: 'tempest',
    name: 'Marco Reyes',
    nickname: 'La Tempête',
    corner: 'blue',
    hometown: 'Marseille',
    stats: { power: 1, speed: 1.06, defense: 1, staminaMax: 100, staminaRegen: 1, chin: 1 },
    gloves: 'cobalt',
    look: {
      skin: '#a8714c', hair: '#161211', hairStyle: 'fade', beard: true,
      shorts: '#1d4fd8', trim: '#f5c542', shoes: '#16181d', build: 1.0, height: 0.98,
      model: 'beach',
    },
    tape: { age: 27, height: 175, reach: 179, weight: 70, record: '19-4-1', kos: 11 },
    style: 'Rythme régulier, esquive, bloque et contre de temps en temps.',
  },

  hammer: {
    id: 'hammer',
    name: 'Viktor Kral',
    nickname: 'Le Marteau',
    corner: 'blue',
    hometown: 'Prague',
    stats: { power: 1.1, speed: 1.04, defense: 1.08, staminaMax: 105, staminaRegen: 1.1, chin: 1.2 },
    gloves: 'onyx',
    look: {
      skin: '#e8c3a3', hair: '#c9b48a', hairStyle: 'buzz', beard: false,
      shorts: '#0f1115', trim: '#d62828', shoes: '#0f1115', build: 1.08, height: 1.04,
      model: 'worker',
    },
    tape: { age: 31, height: 188, reach: 193, weight: 84, record: '31-1-0', kos: 24 },
    style: 'Lit vos habitudes, contre, gère son souffle et cherche le KO.',
  },
};

/**
 * Skins de gants : il suffit d'ajouter une entrée pour créer un nouveau skin.
 * color = cuir, cuff = manchette, accent = bande / logo, gloss = brillance (0-1).
 */
export const GLOVE_SKINS = {
  crimson: { color: '#c8161d', cuff: '#f4f1e8', accent: '#111111', gloss: 0.62 },
  cobalt: { color: '#1846c9', cuff: '#f4f1e8', accent: '#f5c542', gloss: 0.6 },
  emerald: { color: '#14824a', cuff: '#f4f1e8', accent: '#0d0d0d', gloss: 0.55 },
  onyx: { color: '#17181c', cuff: '#d62828', accent: '#e9e9e9', gloss: 0.7 },
  gold: { color: '#c9962e', cuff: '#151515', accent: '#ffffff', gloss: 0.8 },
};
