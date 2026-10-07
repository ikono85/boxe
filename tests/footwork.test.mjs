/**
 * tests/footwork.test.mjs
 * ------------------------------------------------------------------
 * Logique de sélection des clips de pas (src/characters/Footwork.js).
 * Fonctions pures : pas de moteur de rendu, pas de fichier à charger.
 *
 *   node --test tests/footwork.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIRS, RATE_LIMITS, directionWeights, pickTier, cycleTime, clipRate,
} from '../src/characters/Footwork.js';

/**
 * Paliers avant réels (déplacement et durée mesurés sur les clips Mixamo du
 * jeu). `speed` est dérivée comme dans `MixamoBoxerModel`, et non recopiée
 * arrondie : c'est ce rapport exact que `cycleTime` doit retrouver.
 */
const mkTier = (name, disp, dur) => ({ name, disp, dur, speed: disp / dur });
const FWD = [
  mkTier('stepF1', 0.570, 1.000),
  mkTier('stepF2', 0.956, 0.933),
  mkTier('stepF3', 1.137, 1.000),
];

test('directionWeights : une seule direction à la fois', () => {
  assert.deepEqual(directionWeights(2, 0), { f: 1, b: 0, l: 0, r: 0, speed: 2 });
  assert.deepEqual(directionWeights(-2, 0), { f: 0, b: 1, l: 0, r: 0, speed: 2 });
  assert.deepEqual(directionWeights(0, 2), { f: 0, b: 0, l: 0, r: 1, speed: 2 });
  assert.deepEqual(directionWeights(0, -2), { f: 0, b: 0, l: 1, r: 0, speed: 2 });
});

test('directionWeights : diagonale répartie à parts égales', () => {
  const w = directionWeights(1, 1);
  assert.equal(w.f, 0.5);
  assert.equal(w.r, 0.5);
  assert.equal(w.b, 0);
  assert.equal(w.l, 0);
  assert.ok(Math.abs(w.speed - Math.SQRT2) < 1e-9);
});

test('directionWeights : les parts somment toujours à 1 en mouvement', () => {
  for (const [vf, vr] of [[3, 1], [-2, 0.5], [0.1, -2], [-1, -1], [0.7, 0.3]]) {
    const w = directionWeights(vf, vr);
    const sum = DIRS.reduce((s, d) => s + w[d], 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `somme ${sum} pour (${vf}, ${vr})`);
  }
});

test('directionWeights : à l’arrêt, aucune direction', () => {
  const w = directionWeights(0, 0);
  assert.equal(w.speed, 0);
  assert.equal(DIRS.reduce((s, d) => s + w[d], 0), 0);
});

test('directionWeights : jamais deux directions opposées ensemble', () => {
  for (const [vf, vr] of [[2, 1], [-2, 1], [2, -1], [-2, -1]]) {
    const w = directionWeights(vf, vr);
    assert.equal(w.f * w.b, 0, 'avant et arrière simultanés');
    assert.equal(w.l * w.r, 0, 'gauche et droite simultanées');
  }
});

test('pickTier : choisit le palier le plus proche de la vitesse demandée', () => {
  assert.equal(pickTier(FWD, 0.55), 0);
  assert.equal(pickTier(FWD, 1.02), 1);
  assert.equal(pickTier(FWD, 1.5), 2);
});

test('pickTier : garde le palier courant dans la marge (hystérésis)', () => {
  // 0.78 est entre stepF1 (0.57) et stepF2 (1.025) : les deux restent tenables
  const best = pickTier(FWD, 0.78);
  const other = best === 0 ? 1 : 0;
  assert.equal(pickTier(FWD, 0.78, other), other, 'le palier courant devrait tenir');
  // Loin du seuil, l’hystérésis ne doit pas empêcher le changement
  assert.equal(pickTier(FWD, 1.6, 0), 2);
});

test('pickTier : liste vide', () => {
  assert.equal(pickTier([], 1), -1);
});

test('cycleTime : une direction, vitesse de lecture exacte', () => {
  const tier = FWD[1];
  // On demande exactement la vitesse naturelle : cycle = durée du clip
  const cycle = cycleTime([{ share: 1, disp: tier.disp, need: tier.speed, dur: tier.dur }]);
  assert.ok(Math.abs(cycle - tier.dur) < 1e-9, `cycle ${cycle} ≠ ${tier.dur}`);
  assert.ok(Math.abs(clipRate(tier.dur, cycle) - 1) < 1e-9);
});

test('cycleTime : deux fois plus vite → cycle deux fois plus court', () => {
  const tier = FWD[1];
  const cycle = cycleTime([{ share: 1, disp: tier.disp, need: tier.speed * 1.5, dur: tier.dur }]);
  assert.ok(Math.abs(clipRate(tier.dur, cycle) - 1.5) < 1e-9);
});

test('cycleTime : la vitesse de lecture reste dans les bornes', () => {
  const tier = FWD[0];
  for (const need of [0.01, 0.2, 1, 5, 50]) {
    const cycle = cycleTime([{ share: 1, disp: tier.disp, need, dur: tier.dur }]);
    const rate = clipRate(tier.dur, cycle);
    assert.ok(
      rate >= RATE_LIMITS.slowest - 1e-9 && rate <= RATE_LIMITS.fastest + 1e-9,
      `vitesse ${rate.toFixed(3)} hors bornes pour need=${need}`,
    );
  }
});

test('cycleTime : rien d’actif → 0', () => {
  assert.equal(cycleTime([]), 0);
  assert.equal(cycleTime([{ share: 0, disp: 1, need: 1, dur: 1 }]), 0);
});

test('cycleTime : moyenne pondérée entre deux directions', () => {
  const a = { share: 0.5, disp: 1.0, need: 1.0, dur: 1.0 }; // veut T = 1
  const b = { share: 0.5, disp: 1.0, need: 2.0, dur: 1.0 }; // veut T = 0.5
  const cycle = cycleTime([a, b]);
  assert.ok(Math.abs(cycle - 0.75) < 1e-9, `cycle ${cycle} ≠ 0.75`);
});
