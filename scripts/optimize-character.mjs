/**
 * optimize-character.mjs
 * ------------------------------------------------------------------
 * Allège un personnage Mixamo exporté en .glb (maillage + squelette + clips) :
 *   - retire les pistes inutiles (échelle partout, translation hors du bassin) ;
 *   - rééchantillonne les clips (supprime les clés redondantes) ;
 *   - compresse la géométrie et les animations (meshopt).
 *
 * Usage : node scripts/optimize-character.mjs <entrée.glb> <sortie.glb>
 */

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, resample, weld, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage : node scripts/optimize-character.mjs <entrée.glb> <sortie.glb>');
  process.exit(1);
}
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);

let dropped = 0;
for (const anim of doc.getRoot().listAnimations()) {
  for (const ch of anim.listChannels()) {
    const path = ch.getTargetPath();
    const name = ch.getTargetNode()?.getName() || '';
    if (path === 'scale' || (path === 'translation' && !/Hips$/.test(name))) {
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
console.log(`pistes retirées : ${dropped}`);
console.log(`clips : ${doc.getRoot().listAnimations().map((a) => a.getName()).join(', ')}`);
