/**
 * add-animations.mjs
 * ------------------------------------------------------------------
 * Ajoute des clips Mixamo (.fbx « Without Skin ») dans le .glb du personnage,
 * sous les noms attendus par `MixamoBoxerModel`, puis réapplique l'allègement
 * de `optimize-character.mjs` (pistes inutiles, rééchantillonnage, meshopt).
 *
 * Les clips sont montés sur exactement les nœuds que cible déjà un clip du
 * fichier (le .glb contient deux squelettes : on ne touche qu'à celui qui est
 * animé).
 *
 * Usage : node scripts/add-animations.mjs <dossier .fbx> <entrée.glb> <sortie.glb>
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, resample, weld, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

/**
 * Fichier Mixamo → nom du clip dans le jeu.
 *
 * Jeu de jambes : 4 directions × 3 amplitudes. Les amplitudes sont rangées du
 * plus petit au plus grand pas ; `MixamoBoxerModel` mesure le déplacement de la
 * racine au chargement et choisit le palier selon la vitesse demandée.
 * Convention (holder tourné de 180°) : clip +Z = avant du jeu, clip +X = gauche.
 */
const MAP = [
  // --- avant ---
  ['Short Step Forward.fbx', 'stepF1'],
  ['Medium Step Forward.fbx', 'stepF2'],
  ['Long Step Forward.fbx', 'stepF3'],
  // --- arrière ---
  ['Step Backward (2).fbx', 'stepB1'],
  ['Step Backward (1).fbx', 'stepB2'],
  ['Step Backward.fbx', 'stepB3'],
  // --- gauche ---
  ['Short Left Side Step.fbx', 'stepL1'],
  ['Medium Left Side Step.fbx', 'stepL2'],
  ['Long Left Side Step.fbx', 'stepL3'],
  // --- droite ---
  ['Short Right Side Step.fbx', 'stepR1'],
  ['Medium Right Side Step.fbx', 'stepR2'],
  ['Long Right Side Step.fbx', 'stepR3'],
  // --- relevé après knockdown (prise courte : 2,7 s) ---
  ['Getting Up (1).fbx', 'getUp'],
  // --- uppercut lourd encaissé ---
  ['Receiving A Big Uppercut.fbx', 'upperHitBig'],
];

const [fbxDir, input, output] = process.argv.slice(2);
if (!fbxDir || !input || !output) {
  console.error('Usage : node scripts/add-animations.mjs <dossier .fbx> <entrée.glb> <sortie.glb>');
  process.exit(1);
}

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const doc = await io.read(input);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];

/* ----------------------------------------------------------------
 * Nœuds animés : relevés sur un clip existant (le .glb contient deux
 * squelettes, seul celui-ci est piloté par les animations).
 * ---------------------------------------------------------------- */
const reference = root.listAnimations()[0];
if (!reference) {
  console.error('le .glb ne contient aucun clip de référence');
  process.exit(1);
}
const target = new Map();
for (const ch of reference.listChannels()) {
  const n = ch.getTargetNode();
  if (n) target.set(n.getName(), n);
}
console.log(`squelette animé : ${target.size} os (référence : « ${reference.getName()} »)`);

/* ----------------------------------------------------------------
 * Ajout des clips
 * ---------------------------------------------------------------- */
const loader = new FBXLoader();
const PATH = { position: 'translation', quaternion: 'rotation', scale: 'scale' };
const report = [];

for (const [file, name] of MAP) {
  const full = join(fbxDir, file);
  if (!existsSync(full)) {
    report.push({ name, file, error: 'fichier absent' });
    continue;
  }

  // Un clip du même nom est remplacé (le script est rejouable)
  for (const a of root.listAnimations()) {
    if (a.getName() !== name) continue;
    for (const ch of a.listChannels()) ch.dispose();
    for (const s of a.listSamplers()) {
      s.getInput()?.dispose();
      s.getOutput()?.dispose();
      s.dispose();
    }
    a.dispose();
  }

  const buf = readFileSync(full);
  const group = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const clip = group.animations[0];
  if (!clip) {
    report.push({ name, file, error: 'aucun clip dans le .fbx' });
    continue;
  }

  const anim = doc.createAnimation(name);
  let added = 0;
  const missing = new Set();

  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    const boneName = track.name.slice(0, dot);
    const prop = track.name.slice(dot + 1);
    const path = PATH[prop];
    if (!path) continue;
    // Mêmes retraits que optimize-character.mjs : pas d'échelle, translation du bassin seulement
    if (path === 'scale') continue;
    if (path === 'translation' && !/Hips$/.test(boneName)) continue;

    const node = target.get(boneName);
    if (!node) { missing.add(boneName); continue; }

    const size = path === 'rotation' ? 4 : 3;
    const inAcc = doc
      .createAccessor(`${name}_${boneName}_${path}_in`)
      .setArray(new Float32Array(track.times))
      .setType('SCALAR')
      .setBuffer(buffer);
    const outAcc = doc
      .createAccessor(`${name}_${boneName}_${path}_out`)
      .setArray(new Float32Array(track.values))
      .setType(size === 4 ? 'VEC4' : 'VEC3')
      .setBuffer(buffer);
    const sampler = doc
      .createAnimationSampler()
      .setInput(inAcc)
      .setOutput(outAcc)
      .setInterpolation('LINEAR');
    const channel = doc
      .createAnimationChannel()
      .setTargetNode(node)
      .setTargetPath(path)
      .setSampler(sampler);
    anim.addSampler(sampler).addChannel(channel);
    added++;
  }

  // Déplacement de la racine : sert à calibrer la vitesse du jeu de jambes
  const hips = clip.tracks.find((t) => /Hips\.position$/.test(t.name));
  let disp = null;
  if (hips) {
    const V = hips.values;
    const n = V.length / 3;
    disp = {
      dx: +(V[(n - 1) * 3] - V[0]).toFixed(1),
      dz: +(V[(n - 1) * 3 + 2] - V[2]).toFixed(1),
    };
  }

  report.push({
    name, file, canaux: added, dur: +clip.duration.toFixed(3), disp,
    missing: [...missing],
  });
}

/* ----------------------------------------------------------------
 * Allègement (mêmes passes que optimize-character.mjs)
 * ---------------------------------------------------------------- */
let dropped = 0;
for (const anim of root.listAnimations()) {
  for (const ch of anim.listChannels()) {
    const path = ch.getTargetPath();
    const nm = ch.getTargetNode()?.getName() || '';
    if (path === 'scale' || (path === 'translation' && !/Hips$/.test(nm))) {
      const s = ch.getSampler();
      ch.dispose();
      s.dispose();
      dropped++;
    }
  }
}

await doc.transform(
  resample({ tolerance: 1e-4 }),
  weld(),
  dedup(),
  prune(),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write(output, doc);

/* ---------------------------------------------------------------- */
console.log('');
for (const r of report) {
  if (r.error) { console.log(`  ✗ ${r.name.padEnd(12)} ${r.error} (${r.file})`); continue; }
  const d = r.disp ? `racine dXZ=(${r.disp.dx}, ${r.disp.dz}) cm` : 'pas de racine';
  console.log(`  ✓ ${r.name.padEnd(12)} ${String(r.dur).padStart(6)}s  canaux=${r.canaux}  ${d}`);
  if (r.missing.length) console.log(`      os absents du squelette : ${r.missing.join(', ')}`);
}
console.log(`\npistes retirées : ${dropped}`);
console.log(`clips (${root.listAnimations().length}) : ${root.listAnimations().map((a) => a.getName()).join(', ')}`);
