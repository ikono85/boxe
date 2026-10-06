/**
 * loadGlb.js
 * ------------------------------------------------------------------
 * Chargement des modèles .glb du jeu (ring, personnages).
 * Une URL data: (fichier intégré au build) est décodée sur place, sans
 * requête réseau : le jeu fonctionne en un seul fichier et hors ligne.
 * La géométrie compressée (meshopt) est prise en charge.
 */

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

let loader = null;

/** @returns {Promise<import('three/addons/loaders/GLTFLoader.js').GLTF>} */
export async function loadGlb(url) {
  let buffer;
  if (url.startsWith('data:')) {
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    buffer = bytes.buffer;
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} : ${res.status}`);
    buffer = await res.arrayBuffer();
  }
  if (!loader) {
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader.parseAsync(buffer, '');
}
