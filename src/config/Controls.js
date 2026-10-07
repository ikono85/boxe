/**
 * Controls.js
 * ------------------------------------------------------------------
 * Association actions → touches. On utilise `KeyboardEvent.code` (position
 * physique de la touche) : 'KeyW' correspond à W en QWERTY et à Z en AZERTY,
 * 'KeyA' à A en QWERTY et à Q en AZERTY. En liant les deux codes, ZQSD et WASD
 * fonctionnent quel que soit le clavier.
 *
 * Boutons de souris : 'Mouse0' gauche, 'Mouse1' milieu, 'Mouse2' droit,
 * 'Mouse3' / 'Mouse4' boutons latéraux.
 *
 * Manette (disposition « standard » de la Gamepad API, noms Xbox) :
 *   'Pad0' A, 'Pad1' B, 'Pad2' X, 'Pad3' Y, 'Pad4' LB, 'Pad5' RB,
 *   'Pad6' LT, 'Pad7' RT, 'Pad8' Back/View, 'Pad9' Start/Menu,
 *   'Pad10' L3, 'Pad11' R3, 'Pad12'-'Pad15' croix (haut, bas, gauche, droite).
 *   Stick gauche : 'PadUp' 'PadDown' 'PadLeft' 'PadRight'. Stick droit : regard.
 */

export const CONTROLS = {
  forward: ['KeyW', 'KeyZ', 'ArrowUp', 'PadUp', 'Pad12'],
  back: ['KeyS', 'ArrowDown', 'PadDown', 'Pad13'],
  left: ['KeyA', 'KeyQ', 'ArrowLeft', 'PadLeft', 'Pad14'],
  right: ['KeyD', 'ArrowRight', 'PadRight', 'Pad15'],

  guard: ['Space', 'Pad6'],
  dodge: ['ShiftLeft', 'ShiftRight', 'Pad7'], // + direction : esquive latérale / recul / baisser la tête
  duck: ['KeyC', 'Pad10', 'Pad11'],

  jab: ['Mouse0', 'Pad2'],
  cross: ['Mouse2', 'Pad3'],
  hookL: ['KeyE', 'Mouse3', 'Pad0'],
  hookR: ['KeyR', 'Mouse4', 'Pad1'],
  upperL: ['KeyF', 'Pad4'],
  upperR: ['KeyG', 'Pad5'],

  pause: ['Escape', 'KeyP', 'Pad9'],
  toggleHelp: ['KeyH', 'Pad8'],
  skip: ['Enter', 'Space', 'Pad0'],
};

/** Libellés affichés dans l'aide (HUD, menu « Commandes »). */
export const CONTROL_HELP = [
  { keys: ['Z', 'Q', 'S', 'D'], alt: 'ou W A S D', action: 'Se déplacer' },
  { keys: ['Souris'], action: 'Regarder et viser (tête ou corps)' },
  { keys: ['Clic G'], action: 'Jab (gauche)' },
  { keys: ['Clic D'], action: 'Direct (droit)' },
  { keys: ['E'], action: 'Crochet gauche' },
  { keys: ['R'], action: 'Crochet droit' },
  { keys: ['F'], action: 'Uppercut gauche' },
  { keys: ['G'], action: 'Uppercut droit' },
  { keys: ['Espace'], action: 'Garde (maintenir)' },
  { keys: ['Maj', '+ direction'], action: 'Esquive : côté, recul ou tête baissée' },
  { keys: ['C'], action: 'Baisser la tête' },
  { keys: ['Échap'], action: 'Pause' },
];

/** Aide pour la manette (menu « Commandes », HUD quand la manette est utilisée). */
export const PAD_HELP = [
  { keys: ['Stick G'], action: 'Se déplacer' },
  { keys: ['Stick D'], action: 'Regarder et viser (tête ou corps)' },
  { keys: ['X'], action: 'Jab (gauche)' },
  { keys: ['Y'], action: 'Direct (droit)' },
  { keys: ['A'], action: 'Crochet gauche' },
  { keys: ['B'], action: 'Crochet droit' },
  { keys: ['LB'], action: 'Uppercut gauche' },
  { keys: ['RB'], action: 'Uppercut droit' },
  { keys: ['LT'], action: 'Garde (maintenir)' },
  { keys: ['RT', '+ stick G'], action: 'Esquive : côté, recul ou tête baissée' },
  { keys: ['L3'], action: 'Baisser la tête' },
  { keys: ['Start'], action: 'Pause' },
];

export const PUNCH_ACTIONS = ['jab', 'cross', 'hookL', 'hookR', 'upperL', 'upperR'];
