/**
 * FistFactory.js
 * ------------------------------------------------------------------
 * Construit un poing nu à partir de primitives (aucun modèle à charger), pour
 * les boxeurs dont le modèle n'a pas de main : le boxeur en primitives
 * (`BoxerModel`) et les bras en vue première personne (`FirstPersonArms`). Le
 * personnage Mixamo, lui, a ses propres mains et n'en a pas besoin.
 *
 * Repère du poing (identique à celui des anciens gants, pour que le reste du
 * code n'ait pas à changer de convention) : origine au centre du poing,
 * jointures vers -Z, dos de la main vers +Y, poignet vers +Z.
 */

import { Group, Mesh, SphereGeometry, CapsuleGeometry, MeshStandardMaterial, Color } from 'three';

/**
 * Distance entre le centre du poing et le poignet (pour placer l'avant-bras).
 * Un poing nu est bien plus court qu'un gant rembourré : cette valeur est aussi
 * celle qui relie le point de frappe logique au poignet, donc la réduire est ce
 * qui empêche l'avant-bras de flotter devant la main.
 */
export const FIST_WRIST_OFFSET = 0.07;

const geoCache = {};
function geo(key, make) {
  if (!geoCache[key]) geoCache[key] = make();
  return geoCache[key];
}

/**
 * @param {'left'|'right'} hand
 * @param {string} skinColor couleur de peau (hex)
 * @param {number} scale taille du poing
 */
export function createFist(hand, skinColor = '#c98d66', scale = 1) {
  const thumbSide = hand === 'left' ? 1 : -1;
  const flesh = new MeshStandardMaterial({
    color: new Color(skinColor),
    roughness: 0.52,
    metalness: 0,
  });

  const group = new Group();
  group.name = `fist-${hand}`;

  // Corps du poing (doigts repliés)
  const fist = new Mesh(geo('fist', () => new SphereGeometry(1, 20, 14)), flesh);
  fist.scale.set(0.046, 0.042, 0.056);
  fist.position.set(0, 0, -0.008);
  group.add(fist);

  // Jointures : léger renflement à l'avant, là où le coup porte
  const knuckles = new Mesh(geo('knuckles', () => new SphereGeometry(1, 16, 10)), flesh);
  knuckles.scale.set(0.045, 0.036, 0.032);
  knuckles.position.set(0, 0.009, -0.038);
  group.add(knuckles);

  // Pouce replié sur le côté de l'index
  const thumb = new Mesh(geo('thumb', () => new CapsuleGeometry(0.015, 0.034, 4, 8)), flesh);
  thumb.rotation.x = Math.PI / 2;
  thumb.rotation.y = thumbSide * 0.34;
  thumb.position.set(thumbSide * 0.036, 0.004, -0.006);
  group.add(thumb);

  group.scale.setScalar(scale);
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });
  group.userData.materials = [flesh];
  return group;
}

/** Libère les matériaux d'un poing (les géométries sont partagées). */
export function disposeFist(fist) {
  for (const m of fist.userData.materials || []) m.dispose();
}
