/**
 * SoundLibrary.js
 * ------------------------------------------------------------------
 * Catalogue des sons du jeu.
 *
 * REMPLACER UN SON : déposez un fichier (mp3, ogg, wav, m4a ou webm) dans
 * src/assets/sounds/ en lui donnant le nom de la clé, par exemple :
 *   src/assets/sounds/impact_head.mp3
 *   src/assets/sounds/bell.ogg
 * Il sera détecté au build et utilisé à la place du son synthétisé.
 *
 * Champs : synth (générateur de repli), category (bus de volume),
 * volume, reverb (envoi vers la réverbération de salle), loop.
 */

import * as S from './SoundSynth.js';

export const SOUND_LIBRARY = {
  // Coups (élan du gant)
  punch_jab: { synth: (sr) => S.whoosh(sr, { dur: 0.12, f0: 1400, f1: 3600 }), category: 'sfx', volume: 0.35 },
  punch_cross: { synth: (sr) => S.whoosh(sr, { dur: 0.16, f0: 1000, f1: 3000 }), category: 'sfx', volume: 0.42 },
  punch_hook: { synth: (sr) => S.whoosh(sr, { dur: 0.22, f0: 700, f1: 2300, q: 1.1 }), category: 'sfx', volume: 0.45 },
  punch_uppercut: { synth: (sr) => S.whoosh(sr, { dur: 0.22, f0: 600, f1: 2600, q: 1.2, attack: 0.5 }), category: 'sfx', volume: 0.45 },
  whiff: { synth: (sr) => S.whoosh(sr, { dur: 0.26, f0: 1800, f1: 600, q: 0.9, attack: 0.25 }), category: 'sfx', volume: 0.3 },
  dodge: { synth: (sr) => S.whoosh(sr, { dur: 0.18, f0: 500, f1: 1400, q: 0.8 }), category: 'sfx', volume: 0.25 },
  exhale: { synth: (sr) => S.exhale(sr), category: 'sfx', volume: 0.22 },

  // Impacts
  impact_head: { synth: (sr) => S.impact(sr, { f0: 170, f1: 60, crack: 0.75, crackHp: 2400, body: 0.25 }), category: 'sfx', volume: 0.9, reverb: true },
  impact_body: { synth: (sr) => S.impact(sr, { f0: 120, f1: 45, crack: 0.25, crackHp: 1500, body: 0.6, decay: 0.12 }), category: 'sfx', volume: 0.95, reverb: true },
  impact_heavy: { synth: (sr) => S.impact(sr, { dur: 0.45, f0: 140, f1: 38, crack: 0.9, crackHp: 1900, body: 0.5, decay: 0.16 }), category: 'sfx', volume: 1, reverb: true },
  hit_received: { synth: (sr) => S.impact(sr, { dur: 0.4, f0: 110, f1: 40, crack: 0.5, crackHp: 1200, body: 0.7, decay: 0.15 }), category: 'sfx', volume: 1 },
  block: { synth: (sr) => S.block(sr), category: 'sfx', volume: 0.75, reverb: true },
  ko: { synth: (sr) => S.impact(sr, { dur: 0.9, f0: 90, f1: 28, crack: 1, crackHp: 1600, body: 0.8, decay: 0.32 }), category: 'sfx', volume: 1, reverb: true },
  ringing: { synth: (sr) => S.ringing(sr), category: 'sfx', volume: 0.4 },
  combo: { synth: (sr) => S.chime(sr), category: 'ui', volume: 0.35 },

  // Ring
  bell: { synth: (sr) => S.bell(sr), category: 'sfx', volume: 0.75, reverb: true },
  clapper: { synth: (sr) => S.clapper(sr), category: 'sfx', volume: 0.6, reverb: true },

  // Public
  crowd_ambience: { synth: (sr) => S.crowdLoop(sr), category: 'ambience', volume: 0.55, loop: true },
  crowd_cheer: { synth: (sr) => S.crowdCheer(sr), category: 'ambience', volume: 0.75, reverb: true },
  crowd_ooh: { synth: (sr) => S.crowdOoh(sr), category: 'ambience', volume: 0.55, reverb: true },

  // Corps du joueur
  heartbeat: { synth: (sr) => S.heartbeat(sr), category: 'sfx', volume: 0.6 },
  breath: { synth: (sr) => S.breath(sr), category: 'sfx', volume: 0.35 },

  // Interface
  ui_click: { synth: (sr) => S.uiTick(sr, { f: 1050, dur: 0.06 }), category: 'ui', volume: 0.35 },
  ui_hover: { synth: (sr) => S.uiTick(sr, { f: 2100, dur: 0.025 }), category: 'ui', volume: 0.12 },
};

/**
 * Fichiers audio présents dans src/assets/sounds/ (détectés au build par Vite).
 * Clé = nom du fichier sans extension.
 */
export function discoverSoundFiles() {
  let files = {};
  try {
    files = import.meta.glob('../assets/sounds/*.{mp3,ogg,wav,m4a,webm}', { eager: true, query: '?url', import: 'default' });
  } catch {
    files = {};
  }
  const map = {};
  for (const [path, url] of Object.entries(files)) {
    const name = path.split('/').pop().replace(/\.[^.]+$/, '');
    map[name] = url;
  }
  return map;
}
