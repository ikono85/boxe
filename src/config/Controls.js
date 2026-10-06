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
 */

export const CONTROLS = {
  forward: ['KeyW', 'KeyZ', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'KeyQ', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],

  guard: ['Space'],
  dodge: ['ShiftLeft', 'ShiftRight'], // + direction : esquive latérale / recul / baisser la tête
  duck: ['KeyC'],

  jab: ['Mouse0'],
  cross: ['Mouse2'],
  hookL: ['KeyE', 'Mouse3'],
  hookR: ['KeyR', 'Mouse4'],
  upperL: ['KeyF'],
  upperR: ['KeyG'],

  pause: ['Escape', 'KeyP'],
  toggleHelp: ['KeyH'],
  skip: ['Enter', 'Space'],
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

export const PUNCH_ACTIONS = ['jab', 'cross', 'hookL', 'hookR', 'upperL', 'upperR'];
