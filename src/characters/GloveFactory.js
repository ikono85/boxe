/**
 * GloveFactory.js
 * ------------------------------------------------------------------
 * Construit un gant de boxe à partir de primitives (aucun modèle à charger).
 * Repère du gant : origine au centre du poing, jointures vers -Z,
 * dos de la main vers +Y, manchette vers +Z (côté poignet).
 *
 * Les skins sont définis dans config/Boxers.js (GLOVE_SKINS).
 */

import {
  Group, Mesh, SphereGeometry, CylinderGeometry, CapsuleGeometry, MeshStandardMaterial, Color,
} from 'three';
import { GLOVE_SKINS } from '../config/Boxers.js';

/** Distance entre le centre du poing et le poignet (pour placer l'avant-bras). */
export const GLOVE_WRIST_OFFSET = 0.135;

const geoCache = {};
function geo(key, make) {
  if (!geoCache[key]) geoCache[key] = make();
  return geoCache[key];
}

/**
 * @param {'left'|'right'} hand
 * @param {string|object} skin nom d'un skin ou objet { color, cuff, accent, gloss }
 * @param {number} scale taille du gant
 */
export function createGlove(hand, skin = 'crimson', scale = 1) {
  const s = typeof skin === 'string' ? GLOVE_SKINS[skin] || GLOVE_SKINS.crimson : skin;
  const thumbSide = hand === 'left' ? 1 : -1;
  const leather = new MeshStandardMaterial({
    color: new Color(s.color),
    roughness: 1 - s.gloss * 0.72,
    metalness: 0.05,
  });
  const cuffMat = new MeshStandardMaterial({ color: new Color(s.cuff), roughness: 0.55, metalness: 0.02 });
  const accentMat = new MeshStandardMaterial({ color: new Color(s.accent), roughness: 0.5, metalness: 0.1 });

  const group = new Group();
  group.name = `glove-${hand}`;

  // Corps du poing
  const fist = new Mesh(geo('fist', () => new SphereGeometry(1, 22, 16)), leather);
  fist.scale.set(0.07, 0.063, 0.092);
  fist.position.set(0, 0, -0.012);
  group.add(fist);

  // Rembourrage des jointures (rend l'avant plus massif)
  const knuckles = new Mesh(geo('knuckles', () => new SphereGeometry(1, 18, 12)), leather);
  knuckles.scale.set(0.068, 0.058, 0.06);
  knuckles.position.set(0, 0.008, -0.058);
  group.add(knuckles);

  // Pouce
  const thumb = new Mesh(geo('thumb', () => new CapsuleGeometry(0.019, 0.05, 4, 10)), leather);
  thumb.rotation.x = Math.PI / 2;
  thumb.rotation.y = thumbSide * 0.18;
  thumb.position.set(thumbSide * 0.052, -0.022, -0.022);
  group.add(thumb);

  // Manchette
  const cuff = new Mesh(geo('cuff', () => new CylinderGeometry(0.054, 0.058, 0.1, 18)), cuffMat);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.set(0, -0.004, 0.085);
  group.add(cuff);

  // Sangle / laçage
  const strap = new Mesh(geo('strap', () => new CylinderGeometry(0.06, 0.06, 0.026, 18)), accentMat);
  strap.rotation.x = Math.PI / 2;
  strap.position.set(0, -0.004, 0.072);
  group.add(strap);

  // Bande décorative sur le dos de la main
  const stripe = new Mesh(geo('stripe', () => new SphereGeometry(1, 14, 8)), accentMat);
  stripe.scale.set(0.022, 0.01, 0.06);
  stripe.position.set(0, 0.058, -0.012);
  group.add(stripe);

  group.scale.setScalar(scale);
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });
  group.userData.materials = [leather, cuffMat, accentMat];
  return group;
}

/** Libère les matériaux d'un gant (les géométries sont partagées). */
export function disposeGlove(glove) {
  for (const m of glove.userData.materials || []) m.dispose();
}
