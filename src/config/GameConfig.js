/**
 * GameConfig.js
 * ------------------------------------------------------------------
 * Toutes les constantes de réglage du jeu, regroupées ici pour pouvoir
 * équilibrer le gameplay sans toucher au code des systèmes.
 *
 * Conventions :
 *  - unités en mètres, secondes, radians ;
 *  - axe Y vers le haut, le tapis du ring est à y = 0 ;
 *  - un boxeur regarde vers -Z dans son repère local (comme une caméra Three.js).
 */

export const GameConfig = {
  ring: {
    size: 6.2, // côté intérieur des cordes (m)
    platformHeight: 1.15, // hauteur du ring au-dessus du sol de la salle
    apron: 0.55, // bord du tapis au-delà des cordes
    // Ring simplifié (qualité Basse). Avec le modèle 3D, les hauteurs viennent du fichier.
    ropeHeights: [0.46, 0.76, 1.07, 1.37], // 18", 30", 42", 54" comme un vrai ring
    ropeRadius: 0.024,
    postHeight: 1.52,
    // Zone jouable : distance minimale entre le centre d'un boxeur et les cordes
    boundsMargin: 0.38,
    // Les boxeurs peuvent « s'enfoncer » dans les cordes de cette profondeur
    ropeSoftZone: 0.13,
    ropeStiffness: 38, // force de rappel des cordes
  },

  match: {
    rounds: 3,
    roundDuration: 60,
    breakDuration: 12,
    introDuration: 2.4, // carton « ROUND X » + « FIGHT ! »
    roundEndDuration: 1.8,
    tenSecondWarning: 10,
    koSequenceDuration: 3.4, // ralenti + chute avant l'écran KNOCKOUT
    breakStaminaRecovery: 0.6, // fraction de l'endurance manquante récupérée à la pause
    breakHpRecovery: 0.06, // petite récupération de vie entre les rounds
  },

  /** Knockdowns : compte de l'arbitre, relevé, KO technique. */
  knockdown: {
    countDelay: 1.25, // chute avant le « 1 » (s)
    interval: 0.95, // un chiffre par… (s)
    fastInterval: 0.6, // compte obligatoire jusqu'à 8 une fois relevé
    mandatory: 8, // compte obligatoire
    minRiseCount: 2, // on ne se relève pas avant « 2 »
    maxPerRound: 3, // 3e knockdown dans le round = KO technique
    riseDuration: 1.1, // temps pour se relever (animation)
    hpAfter: [0.6, 0.45, 0.32], // vie retrouvée après le 1er / 2e / 3e knockdown
    mashNeed: [6, 9, 13], // joueur : appuis sur les coups pour se relever
    mashDecay: 1.3, // appuis « perdus » par seconde
    standAway: 2.1, // l'autre boxeur recule à cette distance
  },

  fighter: {
    maxHp: 100,
    maxStamina: 100,
    headHeight: 1.62, // hauteur des yeux / centre de la tête
    radius: 0.31,
    minSeparation: 0.64, // distance mini entre les centres des deux boxeurs
    forwardSpeed: 2.85,
    strafeSpeed: 2.7,
    backSpeed: 2.5,
    acceleration: 13,
    guardMoveFactor: 0.62,
    punchMoveFactor: 0.55,
    stunMoveFactor: 0.3,
    exhaustedMoveFactor: 0.78,
    guardRaiseSpeed: 9, // vitesse de montée de la garde (par seconde)
    guardLowerSpeed: 6,
    guardBreakDuration: 0.9,
    flinchScale: 1, // multiplicateur global des durées de « flinch »
  },

  stamina: {
    regenIdle: 15,
    regenMoving: 10,
    regenGuard: 6,
    regenDelay: 0.45, // pause de régénération après un coup
    whiffPenalty: 0.5, // un coup dans le vide coûte +50 %
    efficiencyFloor: 0.5, // efficacité des coups à 0 d'endurance
    efficiencyKnee: 50, // au-dessus de cette valeur, efficacité maximale
    speedFloor: 0.72, // vitesse des coups à 0 d'endurance
    exhaustedThreshold: 18, // en dessous : « essoufflé »
    bodyShotRegenPenalty: 0.5, // les coups au corps ralentissent la récupération…
    bodyShotPenaltyDuration: 2.2, // …pendant ce temps
  },

  stun: {
    threshold: 72,
    duration: 1.6,
    decayRate: 10,
    decayDelay: 1.5,
    resetValue: 25,
    immunityDuration: 2.6, // évite d'enchaîner les étourdissements
    immunityFactor: 0.4,
  },

  dodge: {
    slip: { in: 0.085, hold: 0.2, out: 0.17, cost: 8, offset: [0.3, -0.08, 0], bodyShift: 0.1, roll: 0.2 },
    duck: { in: 0.1, hold: 0.22, out: 0.18, cost: 9, offset: [0, -0.36, -0.1], bodyShift: 0.15, roll: 0 },
    pullback: { in: 0.1, hold: 0.17, out: 0.2, cost: 11, offset: [0, 0.02, 0.26], bodyShift: 0.08, dash: 2.4, roll: 0 },
    cooldown: 0.16,
    minStaminaRatio: 0.5, // il faut au moins 50 % du coût pour esquiver
  },

  combat: {
    gloveRadius: 0.075,
    headRadius: 0.125,
    chestRadius: 0.2,
    bellyRadius: 0.18,
    chestHeight: 1.3,
    bellyHeight: 1.06,
    guardSphereForward: 0.12, // les gants en garde sont devant le visage
    guardSphereRadius: 0.17,
    guardBlockThreshold: 0.5, // garde effective au-dessus de 50 % levée
    blockReductionHead: 0.85,
    blockReductionBody: 0.55,
    blockStaminaFactor: 0.9, // endurance perdue en bloquant
    bodyStaminaFactor: 2.2, // les coups au corps vident l'endurance
    bodyDamageFactor: 0.72,
    bodyStunFactor: 0.3,
    critMultiplier: 1.6,
    critStunMultiplier: 1.8,
    stunnedDamageMultiplier: 1.2,
    counter: {
      interrupt: { damage: 1.35, crit: 0.5, label: 'Contre !' }, // touché pendant son propre coup
      punish: { damage: 1.25, crit: 0.25, label: 'Punition !' }, // touché après un coup dans le vide
      riposte: { damage: 1.3, crit: 0.3, label: 'Riposte !' }, // après une esquive / un blocage réussi
    },
    counterWindowAfterDodge: 0.7,
    counterWindowAfterBlock: 0.5,
    punishWindow: 0.45,
    chainWindow: 0.28, // délai pour enchaîner un coup et former un combo
    chainWindupFactor: 0.6, // anticipation raccourcie dans un enchaînement
    chainStaminaFactor: 0.85,
    inputBuffer: 0.22, // un clic trop tôt est mémorisé ce temps-là
    flankAngleFull: 0.7, // la garde couvre pleinement jusqu'à ~40°
    flankAngleNone: 1.45, // et plus du tout au-delà de ~83°
    hitStop: true,
  },

  camera: {
    fov: 74,
    near: 0.03,
    far: 160,
    pitchMin: -0.62,
    pitchMax: 0.5,
    baseSensitivity: 0.0022, // radians par pixel à sensibilité 1
  },

  aim: {
    assistCone: 0.42, // demi-angle (rad) dans lequel un coup « trouve » l'adversaire
    noAssistCone: 0.24,
    bodyPitchBias: 0.42, // 0 = milieu tête/corps ; part du chemin tête→corps où bascule la cible
    softLockStrength: 2.2, // rotation douce vers l'adversaire (aide à la visée)
    softLockCone: 0.55,
  },

  // Poses des gants du joueur dans le repère caméra (x droite, y haut, -z devant)
  viewmodel: {
    shoulderL: [-0.21, -0.31, 0.02],
    shoulderR: [0.21, -0.31, 0.02],
    upperArm: 0.38,
    forearm: 0.37,
    rest: { left: [-0.205, -0.205, -0.43], right: [0.215, -0.235, -0.37] },
    guard: { left: [-0.088, -0.085, -0.285], right: [0.094, -0.1, -0.265] },
  },

  // Poses des gants de l'adversaire dans son repère local (pieds à y = 0, -z devant)
  stance: {
    shoulderL: [-0.2, 1.43, -0.04],
    shoulderR: [0.2, 1.42, 0.04],
    upperArm: 0.33,
    forearm: 0.32,
    rest: { left: [-0.14, 1.44, -0.37], right: [0.15, 1.41, -0.23] },
    guard: { left: [-0.085, 1.56, -0.25], right: [0.09, 1.55, -0.21] },
  },

  score: {
    comboBonus: 1, // multiplicateur des points de combo
    dodge: 15,
    block: 5,
    koWin: 2500,
    decisionWin: 1000,
    perSecondLeft: 8,
    perRoundLeft: 400,
  },

  quality: {
    low: { pixelRatio: 0.75, shadows: false, shadowMapSize: 512, audience: 220, dust: 60, extraLights: false, ringModel: false },
    medium: { pixelRatio: 1, shadows: true, shadowMapSize: 1024, audience: 480, dust: 140, extraLights: true, ringModel: true },
    high: { pixelRatio: 1.5, shadows: true, shadowMapSize: 2048, audience: 900, dust: 240, extraLights: true, ringModel: true },
  },
};

/** Demi-côté de la zone de combat (centre des boxeurs). */
export function ringBound() {
  return GameConfig.ring.size / 2 - GameConfig.ring.boundsMargin;
}
