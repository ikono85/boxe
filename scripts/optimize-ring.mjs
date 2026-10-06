/**
 * optimize-ring.mjs
 * ------------------------------------------------------------------
 * Prépare le modèle « Professional Boxing Ring » (Sketchfab, A1905, CC BY 4.0)
 * pour le jeu :
 *   - retire les cordes, leurs attaches et leurs bandes (le jeu dessine ses
 *     propres cordes, qui se déforment quand un boxeur s'appuie dessus) et
 *     le tapis uni (le jeu pose son tapis avec le logo) ;
 *   - met le modèle à l'échelle : les cordes forment un carré de
 *     GameConfig.ring.size mètres, le dessus du tapis est à y = 0 ;
 *   - colore les coussins de coin : rouge (+x,+z), bleu (-x,-z), neutres ailleurs ;
 *   - fusionne les pièces par matière (peu d'appels de dessin), réduit les
 *     textures, compresse la géométrie (meshopt) ;
 *   - écrit les hauteurs et le rayon des cordes dans scene.extras pour que
 *     les cordes du jeu tombent pile dans les tendeurs du modèle.
 *
 * Usage : node scripts/optimize-ring.mjs <dossier contenant scene.gltf> [sortie.glb]
 * Dépendances (dev) : @gltf-transform/core, functions, extensions, meshoptimizer, sharp
 */

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, flatten, join, weld, textureCompress, meshopt, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { join as pathJoin, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameConfig } from '../src/config/GameConfig.js';

const root = pathJoin(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = process.argv[2];
const out = process.argv[3] || pathJoin(root, 'src/assets/models/ring.glb');
if (!srcDir) {
  console.error('Usage : node scripts/optimize-ring.mjs <dossier du modèle> [sortie.glb]');
  process.exit(1);
}

// Matières du modèle d'origine
const ROPES = ['Color_01', 'Color_I0', 'Color_J0']; // cordes rouges, bleue, noire
const DROP = [...ROPES, '108_leat', '16_scrat', 'Color_B0']; // + attaches, bandes, tapis uni
const PLATFORM = 'Color_A0';
const PADS = '148_Blue';

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(pathJoin(srcDir, 'scene.gltf'));
const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];

/* ---------- Mesure (avant toute modification) ---------- */

const meshNodes = doc.getRoot().listNodes().filter((n) => n.getMesh());
const matOf = (n) => n.getMesh().listPrimitives()[0].getMaterial()?.getName();
const boundsOf = (names) => {
  const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const n of meshNodes) {
    if (!names.includes(matOf(n))) continue;
    const nb = getBounds(n);
    for (let i = 0; i < 3; i++) {
      b.min[i] = Math.min(b.min[i], nb.min[i]);
      b.max[i] = Math.max(b.max[i], nb.max[i]);
    }
  }
  return b;
};

const ropes = boundsOf(ROPES);
const blue = boundsOf(['Color_I0']); // une seule corde : donne son diamètre
const diameter = blue.max[1] - blue.min[1];
const matTop = boundsOf([PLATFORM]).max[1];
const span = ropes.max[0] - ropes.min[0] - diameter; // axe à axe
const s = GameConfig.ring.size / span;
const cx = (ropes.min[0] + ropes.max[0]) / 2;
const cz = (ropes.min[2] + ropes.max[2]) / 2;

// Hauteurs des quatre cordes (axe), du bas vers le haut
const heights = [];
for (const name of ROPES) {
  for (const n of meshNodes) {
    if (matOf(n) !== name) continue;
    const nb = getBounds(n);
    const y = (nb.min[1] + nb.max[1]) / 2;
    if (!heights.some((h) => Math.abs(h - y) < diameter)) heights.push(y);
  }
}
heights.sort((a, b) => a - b);
const ropeHeights = heights.map((y) => +((y - matTop) * s).toFixed(3));

/* ---------- Coussins de coin : une matière par coin ---------- */

const padSrc = doc.getRoot().listMaterials().find((m) => m.getName() === PADS);
const padMats = {
  // La texture d'origine est bleue : le coin rouge prend une couleur unie
  red: padSrc.clone().setName('pad_red').setBaseColorTexture(null).setBaseColorFactor([0.58, 0.015, 0.02, 1]),
  blue: padSrc.clone().setName('pad_blue'),
  neutral: padSrc.clone().setName('pad_neutral').setBaseColorTexture(null).setBaseColorFactor([0.8, 0.77, 0.7, 1]),
};
for (const n of meshNodes) {
  if (matOf(n) !== PADS) continue;
  const nb = getBounds(n);
  const x = (nb.min[0] + nb.max[0]) / 2 - cx;
  const z = (nb.min[2] + nb.max[2]) / 2 - cz;
  const corner = x > 0 && z > 0 ? 'red' : x < 0 && z < 0 ? 'blue' : 'neutral';
  for (const p of n.getMesh().listPrimitives()) p.setMaterial(padMats[corner]);
}
padSrc.dispose();

/* ---------- Retrait des pièces remplacées par le jeu ---------- */

let removed = 0;
for (const n of meshNodes) {
  if (DROP.includes(matOf(n))) {
    n.getMesh().dispose();
    n.dispose();
    removed++;
  }
}

/* ---------- Échelle et position ---------- */

const rig = doc.createNode('ring').setScale([s, s, s]).setTranslation([-cx * s, -matTop * s, -cz * s]);
for (const child of scene.listChildren()) {
  scene.removeChild(child);
  rig.addChild(child);
}
scene.addChild(rig);

scene.setExtras({
  ropeHeights,
  ropeRadius: +((diameter / 2) * s).toFixed(4),
  credit: '"Professional Boxing Ring" by A1905 (https://sketchfab.com/al1905), CC BY 4.0',
});

/* ---------- Optimisation ---------- */

await doc.transform(
  flatten(),
  join({ keepNamed: false }),
  weld(),
  dedup(),
  prune(),
  textureCompress({ encoder: sharp, resize: [512, 512] }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);

await io.write(out, doc);

let tris = 0;
for (const m of doc.getRoot().listMeshes()) {
  for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
}
console.log(`pièces retirées : ${removed}`);
console.log(`échelle : ${s.toFixed(5)}  hauteurs de cordes : ${ropeHeights.join(', ')} m  rayon : ${((diameter / 2) * s).toFixed(4)} m`);
console.log(`maillages : ${doc.getRoot().listMeshes().length}  triangles : ${tris}  matières : ${doc.getRoot().listMaterials().map((m) => m.getName()).join(', ')}`);
console.log(`écrit : ${out}`);
