/**
 * check-footwork.mjs
 * ------------------------------------------------------------------
 * Contrôle du jeu de jambes sur le fichier du personnage : pour une série de
 * vitesses et de directions, rejoue le mélange de clips comme le fait
 * `MixamoBoxerModel._footwork` et mesure le glissement des pieds.
 *
 * Le pied en appui doit reculer, dans le repère du boxeur, exactement à la
 * vitesse à laquelle le jeu déplace le boxeur. L'écart est le patinage.
 *
 * Usage : node scripts/check-footwork.mjs <personnage.glb>
 */

import { readFileSync } from 'node:fs';
import { AnimationMixer, LoopOnce, LoopRepeat, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { DIRS, directionWeights, movingAmount, blendNeed, pickTier, cycleTime } from '../src/characters/Footwork.js';

const HEAD_HEIGHT = 1.6;
const DT = 1 / 60;

const file = process.argv[2];
if (!file) {
  console.error('Usage : node scripts/check-footwork.mjs <personnage.glb>');
  process.exit(1);
}

await MeshoptDecoder.ready;
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const buf = readFileSync(file);
const gltf = await new Promise((res, rej) =>
  loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));

const scene = gltf.scene;
const clips = {};
for (const c of gltf.animations) clips[c.name] = c;
const bone = (n) => scene.getObjectByName(`mixamorig${n}`);

const mixer = new AnimationMixer(scene);
const actions = {};
for (const [name, clip] of Object.entries(clips)) {
  const a = mixer.clipAction(clip);
  const loop = name === 'idle' || /^step[FBLR][0-9]+$/.test(name);
  a.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
  a.enabled = true;
  a.setEffectiveWeight(0);
  if (loop) a.play();
  actions[name] = a;
}

// Échelle du jeu : même calcul que MixamoBoxerModel
actions.idle.setEffectiveWeight(1);
mixer.update(0);
scene.updateMatrixWorld(true);
const head = bone('Head').getWorldPosition(new Vector3());
const top = bone('HeadTop_End');
if (top) head.lerp(top.getWorldPosition(new Vector3()), 0.45);
const scale = HEAD_HEIGHT / head.y;

const hipsName = 'mixamorigHips.position';
const hipsTrack = (n) => clips[n] && clips[n].tracks.find((t) => t.name === hipsName);
const idleHipsT = hipsTrack('idle');
const idleHips = new Vector3(idleHipsT.values[0], idleHipsT.values[1], idleHipsT.values[2]);
const hips = bone('Hips');

// Paliers, comme au chargement du modèle
const loco = { f: [], b: [], l: [], r: [] };
for (const [dir, axis, sign] of [['f', 2, 1], ['b', 2, -1], ['l', 0, 1], ['r', 0, -1]]) {
  for (let i = 1; i <= 9; i++) {
    const name = `step${dir.toUpperCase()}${i}`;
    const clip = clips[name];
    if (!clip) continue;
    const t = hipsTrack(name);
    if (!t) continue;
    const n = t.values.length / 3;
    const disp = (t.values[(n - 1) * 3 + axis] - t.values[axis]) * sign * scale;
    if (!(disp > 0.02)) continue;
    loco[dir].push({ name, action: actions[name], disp, dur: clip.duration, speed: disp / clip.duration, w: 0 });
  }
  loco[dir].sort((a, b) => a.speed - b.speed);
}
console.log('paliers mesurés (déplacement m, durée s, vitesse m/s) :');
for (const d of DIRS) {
  console.log(
    `  ${d} : ${loco[d].map((t) => `${t.name} ${t.disp.toFixed(3)}m/${t.dur.toFixed(2)}s=${t.speed.toFixed(2)}`).join('  ')}`,
  );
}

/** Rejoue le mélange et mesure le patinage du pied en appui. */
function run(vf, vr, seconds = 4) {
  const share = { f: 0, b: 0, l: 0, r: 0 };
  const tierIdx = { f: -1, b: -1, l: -1, r: -1 };
  let phase = 0;
  const feet = { Left: bone('LeftFoot'), Right: bone('RightFoot') };
  const prev = { Left: new Vector3(), Right: new Vector3() };
  let planted = null;
  let slip = 0;
  let tPlanted = 0;
  let rateMin = Infinity;
  let rateMax = -Infinity;
  const settle = 1.0;

  for (let t = 0; t < seconds; t += DT) {
    const k = Math.min(1, DT * 6);
    const w = directionWeights(vf, vr);
    const moving = movingAmount(w.speed);

    const active = [];
    for (const d of DIRS) {
      share[d] += (w[d] * moving - share[d]) * k;
      for (const x of loco[d]) x.w = 0;
      if (!loco[d].length || share[d] < 0.01) { tierIdx[d] = -1; continue; }
      const need = blendNeed(d === 'f' || d === 'b' ? vf : vr, share[d]);
      const i = pickTier(loco[d], need, tierIdx[d]);
      tierIdx[d] = i;
      loco[d][i].w = share[d];
      active.push({ tier: loco[d][i], share: share[d], need, disp: loco[d][i].disp, dur: loco[d][i].dur });
    }
    const cycle = cycleTime(active);
    if (cycle > 0) phase = (phase + DT / cycle) % 1;

    let total = 0;
    for (const a of active) {
      total += a.share;
      const rate = a.dur / cycle;
      if (t > settle) { rateMin = Math.min(rateMin, rate); rateMax = Math.max(rateMax, rate); }
    }
    for (const d of DIRS) {
      for (const x of loco[d]) {
        if (x.w <= 0) { x.action.setEffectiveWeight(0); continue; }
        x.action.timeScale = 0;
        x.action.time = phase * x.dur;
        x.action.setEffectiveWeight(x.w);
      }
    }
    actions.idle.setEffectiveWeight(Math.max(0, 1 - total));

    mixer.update(DT);
    // Le jeu déplace le boxeur : la translation horizontale du clip est annulée
    hips.position.x = idleHips.x;
    hips.position.z = idleHips.z;
    scene.updateMatrixWorld(true);

    const p = {
      Left: feet.Left.getWorldPosition(new Vector3()).multiplyScalar(scale),
      Right: feet.Right.getWorldPosition(new Vector3()).multiplyScalar(scale),
    };
    const low = p.Left.y <= p.Right.y ? 'Left' : 'Right';
    if (t > settle) {
      if (planted === low) {
        slip += Math.hypot(p[low].x - prev[low].x, p[low].z - prev[low].z);
        tPlanted += DT;
      }
      planted = low;
    }
    prev.Left.copy(p.Left);
    prev.Right.copy(p.Right);
  }

  const produced = tPlanted > 0 ? slip / tPlanted : 0;
  const want = Math.hypot(vf, vr);
  return { want, produced, err: want > 0 ? (produced - want) / want : 0, rateMin, rateMax };
}

console.log('\nvitesse demandée → vitesse produite au sol par l’animation :');
console.log('  (écart = patinage ; négatif = le pied traîne, positif = il devance)\n');
const cases = [
  ['avant lent', 0.6, 0],
  ['avant garde', 1.75, 0],
  ['avant sprint', 2.85, 0],
  ['arrière lent', -0.6, 0],
  ['arrière garde', -1.55, 0],
  ['arrière vite', -2.5, 0],
  ['droite garde', 0, 1.65],
  ['droite vite', 0, 2.7],
  ['gauche garde', 0, -1.65],
  ['gauche vite', 0, -2.7],
  ['diagonale av+dr', 1.2, 1.2],
  ['diagonale ar+ga', -1.1, -1.1],
];
let worst = 0;
for (const [label, vf, vr] of cases) {
  const r = run(vf, vr);
  worst = Math.max(worst, Math.abs(r.err));
  const pct = (r.err * 100).toFixed(0);
  console.log(
    `  ${label.padEnd(17)} ${r.want.toFixed(2)} m/s → ${r.produced.toFixed(2)} m/s  ` +
      `écart ${pct > 0 ? '+' : ''}${pct}%   lecture ${r.rateMin.toFixed(2)}–${r.rateMax.toFixed(2)}×`,
  );
}
console.log(`\npatinage maximal : ${(worst * 100).toFixed(0)} %`);
