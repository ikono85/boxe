/**
 * SimState.js
 * ------------------------------------------------------------------
 * Photographie et restauration de l'état d'une simulation (deux boxeurs,
 * rounds, générateur aléatoire), pour le netcode à rollback.
 *
 * La photographie est un objet « simple » (sérialisable en JSON) :
 *  - nombres, booléens, chaînes, tableaux et objets copiés ;
 *  - Vector3 / Quaternion → { $v: [...] } / { $q: [...] } ;
 *  - références à un boxeur → { $f: index } ;
 *  - définitions de coups, combos, esquives (configuration) → { $p }, { $c }, { $d }.
 * La restauration écrit DANS les objets existants (mêmes instances, mêmes
 * classes) : le rendu et l'interface gardent leurs références.
 *
 * Champs ignorés : liens vers le bus d'événements et le profil, réglages
 * propres à chaque joueur (sensibilité…), données d'affichage recalculées.
 */

import { PUNCHES, COMBOS } from '../config/Punches.js';
import { GameConfig } from '../config/GameConfig.js';

const SKIP = new Set([
  'events', 'profile', 'ai', 'id', 'name',
  'sensitivity', 'invertY', 'aimAssist', // réglages locaux
  'aim', '_euler', 'target', // affichage / calcul intermédiaire
]);

const PUNCH_DEFS = new Map(Object.values(PUNCHES).map((d) => [d, d.id]));
const COMBO_INDEX = new Map(COMBOS.map((c, i) => [c, i]));
// Définitions d'esquive (GameConfig.dodge.slip…) : configuration partagée, jamais copiée ni écrasée
const DODGE_DEFS = new Map(Object.entries(GameConfig.dodge).filter(([, v]) => v && typeof v === 'object').map(([k, v]) => [v, k]));

/** Objets de configuration : enregistrés par leur nom, restaurés par référence. */
function isConfig(v) {
  return PUNCH_DEFS.has(v) || COMBO_INDEX.has(v) || DODGE_DEFS.has(v);
}

function encode(v, fighters, root) {
  if (v === null || typeof v !== 'object') {
    // Infini et -0 ne survivent pas au JSON (l'hôte envoie son état en JSON)
    if (typeof v === 'number' && (!Number.isFinite(v) || Object.is(v, -0))) return { $n: Object.is(v, -0) ? '-0' : String(v) };
    return v;
  }
  if (v.isVector3) return { $v: [v.x, v.y, v.z] };
  if (v.isQuaternion) return { $q: [v.x, v.y, v.z, v.w] };
  if (v !== root) {
    const fi = fighters.indexOf(v);
    if (fi >= 0) return { $f: fi };
  }
  if (PUNCH_DEFS.has(v)) return { $p: PUNCH_DEFS.get(v) };
  if (COMBO_INDEX.has(v)) return { $c: COMBO_INDEX.get(v) };
  if (DODGE_DEFS.has(v)) return { $d: DODGE_DEFS.get(v) };
  if (Array.isArray(v)) return v.map((x) => encode(x, fighters, null));
  const o = {};
  for (const k of Object.keys(v)) {
    if (SKIP.has(k)) continue;
    const x = v[k];
    if (typeof x === 'function') continue;
    o[k] = encode(x, fighters, null);
  }
  return o;
}

function decode(s, cur, fighters, root = false) {
  if (s === null || typeof s !== 'object') return s;
  if (s.$v) {
    if (cur && cur.isVector3) return cur.set(s.$v[0], s.$v[1], s.$v[2]);
    throw new Error('SimState : vecteur attendu');
  }
  if (s.$q) {
    if (cur && cur.isQuaternion) return cur.set(s.$q[0], s.$q[1], s.$q[2], s.$q[3]);
    throw new Error('SimState : quaternion attendu');
  }
  if ('$f' in s) return fighters[s.$f];
  if ('$p' in s) return PUNCHES[s.$p];
  if ('$c' in s) return COMBOS[s.$c];
  if ('$d' in s) return GameConfig.dodge[s.$d];
  if ('$n' in s) return Number(s.$n);
  if (Array.isArray(s)) {
    const arr = Array.isArray(cur) ? cur : [];
    if (arr.length !== s.length) arr.length = s.length;
    for (let i = 0; i < s.length; i++) arr[i] = decode(s[i], arr[i], fighters);
    return arr;
  }
  const usable = root || (cur && typeof cur === 'object' && !Array.isArray(cur) && !cur.isVector3
    && !isConfig(cur) && !fighters.includes(cur));
  const o = usable ? cur : {};
  for (const k of Object.keys(s)) o[k] = decode(s[k], o[k], fighters);
  return o;
}

/**
 * @param {{fighters: object[], rounds: object, rng: number, tick: number, evc: object}} world
 */
export function captureState(world) {
  const f = world.fighters;
  return {
    tick: world.tick,
    rng: world.rng,
    evc: { ...world.evc },
    f: f.map((x) => encode(x, f, x)),
    r: encode(world.rounds, f, world.rounds),
  };
}

export function restoreState(world, snap) {
  const f = world.fighters;
  world.tick = snap.tick;
  world.rng = snap.rng;
  world.evc = { ...snap.evc };
  snap.f.forEach((s, i) => decode(s, f[i], f, true));
  decode(snap.r, world.rounds, f, true);
  // Zones d'impact et repère de visée sont restaurés tels quels (pas recalculés) :
  // la séparation des corps les laisse volontairement d'un tick en retard.
}
