/**
 * RiggedBoxerModel.js
 * ------------------------------------------------------------------
 * Adversaire affiché avec un personnage 3D riggé (glTF, squelette humanoïde
 * Quaternius : Hips, Abdomen, Torso, Chest, Neck, Head, UpperArm.L, …).
 *
 * Principe : BoxerModel calcule toujours la pose « logique » (gants sur la
 * trajectoire des coups, inclinaisons des esquives, réactions, KO…). Ce
 * modèle-ci recopie cette pose sur le squelette du personnage :
 *   - bassin et colonne suivent le bassin et le buste calculés ;
 *   - la tête suit la tête calculée ;
 *   - bras et jambes sont résolus par IK à deux os vers les mêmes cibles
 *     (poignets derrière les gants, chevilles) avec les longueurs du modèle ;
 *   - les gants de boxe du jeu sont conservés (les mains sont réduites dessous).
 *
 * Les personnages stylisés ont des bras très courts : au chargement, les bras
 * sont allongés (os ET maillage, sommets déplacés le long des segments) pour
 * retrouver l'allonge des coups du jeu.
 *
 * Tant que le fichier n'est pas chargé (ou s'il ne se charge pas), le
 * boxeur en primitives reste affiché : aucun risque d'adversaire invisible.
 */

import { Group, Vector3, Quaternion, Matrix4, BufferAttribute } from 'three';
import { BoxerModel, BOXER_PELVIS_Y, BOXER_ANKLE_Y } from './BoxerModel.js';
import { GLOVE_WRIST_OFFSET } from './GloveFactory.js';
import { solveTwoBone } from './Rig.js';
import { loadGlb } from '../core/loadGlb.js';
import { clamp, lerp } from '../core/MathUtils.js';

import casualUrl from '../assets/models/characters/casual.glb?url';
import beachUrl from '../assets/models/characters/beach.glb?url';
import workerUrl from '../assets/models/characters/worker.glb?url';

/** Personnages disponibles (Quaternius, « Ultimate Modular Men », CC0). */
export const CHARACTER_MODELS = {
  casual: casualUrl,
  beach: beachUrl,
  worker: workerUrl,
};

/** Échelle : la tête du personnage tombe à la hauteur de la tête logique. */
const MODEL_SCALE = 0.96;
/** Longueurs cibles des bras dans le repère du modèle (avant échelle). */
const TARGET_UPPER_ARM = 0.32;
const TARGET_FOREARM = 0.3;
/** Taille des mains sous les gants. */
const HAND_SCALE = 0.45;

const SPINE = ['Abdomen', 'Torso', 'Chest'];

const _v = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _s = new Vector3();
const _t = new Vector3();
const _e = new Vector3();
const _p = new Vector3();
const _r = new Vector3();
const _g = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _qd = new Quaternion();
const _qi = new Quaternion();
const _m = new Matrix4();
const _m2 = new Matrix4();

/* ================================================================
 * Préparation du personnage (une fois au chargement)
 * ================================================================ */

/**
 * Os indexés par nom. Three.js retire « . : / [ ] » des noms au chargement
 * (UpperArm.L devient UpperArmL) : on enregistre les deux écritures.
 */
function findBones(root) {
  const byName = {};
  root.traverse((o) => {
    if (o.isBone) byName[o.name] = o;
  });
  return new Proxy(byName, {
    get: (t, name) => (typeof name === 'string' ? t[name] || t[name.replace(/[.:/[\]]/g, '')] : undefined),
  });
}

function isDescendant(bone, ancestor) {
  for (let b = bone; b; b = b.parent) if (b === ancestor) return true;
  return false;
}

/**
 * Allonge un bras : segment épaule→coude multiplié par k1, coude→poignet par k2.
 * Les sommets sont déplacés selon leurs poids (la peau s'étire le long du
 * segment au lieu de se déchirer), puis les matrices de liaison et la position
 * de repos des os sont mises à jour. À appeler avant toute animation.
 */
function stretchArm(skinnedMeshes, bones, side, k1, k2) {
  const upper = bones[`UpperArm.${side}`];
  const lower = bones[`LowerArm.${side}`];
  const wrist = bones[`Wrist.${side}`];
  if (!upper || !lower || !wrist) return;

  // Positions de repos (repère monde = repère de liaison : le modèle n'est pas encore placé)
  const S = upper.getWorldPosition(new Vector3());
  const E = lower.getWorldPosition(new Vector3());
  const W = wrist.getWorldPosition(new Vector3());
  const e1 = E.clone().sub(S).multiplyScalar(k1 - 1);
  const e2 = W.clone().sub(E).multiplyScalar(k2 - 1);
  const SE = E.clone().sub(S);
  const EW = W.clone().sub(E);
  const lenSE = SE.lengthSq();
  const lenEW = EW.lengthSq();

  const done = new Set();
  for (const mesh of skinnedMeshes) {
    const sk = mesh.skeleton;
    const idx = (b) => sk.bones.indexOf(b);
    const iUpper = idx(upper);
    const iLower = idx(lower);
    const handIdx = new Set();
    sk.bones.forEach((b, i) => {
      if (isDescendant(b, wrist)) handIdx.add(i);
    });

    // --- Sommets ---
    const geo = mesh.geometry;
    const src = geo.attributes.position;
    const pos = new Float32Array(src.count * 3);
    for (let i = 0; i < src.count; i++) {
      pos[i * 3] = src.getX(i);
      pos[i * 3 + 1] = src.getY(i);
      pos[i * 3 + 2] = src.getZ(i);
    }
    const si = geo.attributes.skinIndex;
    const sw = geo.attributes.skinWeight;
    const bind = mesh.bindMatrix;
    const bindInv = mesh.bindMatrixInverse;
    let moved = 0;
    for (let i = 0; i < src.count; i++) {
      let wUp = 0;
      let wLow = 0;
      let wHand = 0;
      for (let k = 0; k < 4; k++) {
        const bi = si.getComponent(i, k);
        const w = sw.getComponent(i, k);
        if (!w) continue;
        if (bi === iUpper) wUp += w;
        else if (bi === iLower) wLow += w;
        else if (handIdx.has(bi)) wHand += w;
      }
      if (wUp + wLow + wHand < 1e-4) continue;
      _v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(bind);
      const t1 = clamp(_a.copy(_v).sub(S).dot(SE) / lenSE, 0, 1);
      const t2 = clamp(_a.copy(_v).sub(E).dot(EW) / lenEW, 0, 1);
      _p.set(0, 0, 0)
        .addScaledVector(e1, wUp * t1 + wLow + wHand)
        .addScaledVector(e2, wLow * t2 + wHand);
      _v.add(_p).applyMatrix4(bindInv);
      pos[i * 3] = _v.x;
      pos[i * 3 + 1] = _v.y;
      pos[i * 3 + 2] = _v.z;
      moved++;
    }
    if (moved) {
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      geo.computeBoundingSphere();
    }

    // --- Matrices de liaison (le coude et la main se décalent) ---
    sk.bones.forEach((b, i) => {
      const inv = sk.boneInverses[i];
      if (done.has(inv)) return;
      let shift = null;
      if (handIdx.has(i)) shift = _a.copy(e1).add(e2);
      else if (b === lower) shift = _a.copy(e1);
      if (!shift) return;
      inv.multiply(_m.makeTranslation(-shift.x, -shift.y, -shift.z));
      done.add(inv);
    });
  }

  // --- Position de repos des os (repère du parent) ---
  const moveBone = (bone, offset) => {
    const wp = bone.getWorldPosition(new Vector3()).add(offset);
    bone.position.copy(bone.parent.worldToLocal(wp));
    bone.updateWorldMatrix(false, true);
  };
  moveBone(lower, e1);
  moveBone(wrist, e2);
}

/** Direction de repos d'un os vers son enfant, dans le repère de l'os. */
function restDirection(bone, child) {
  return child.position.clone().normalize();
}

/* ================================================================
 * Modèle
 * ================================================================ */

export class RiggedBoxerModel extends BoxerModel {
  /**
   * @param {object} profile profil du boxeur (config/Boxers.js), look.model = clé de CHARACTER_MODELS
   */
  constructor(profile) {
    super(profile);
    this.rig = null;
    this.disposed = false;
    const url = CHARACTER_MODELS[profile.look && profile.look.model];
    this.ready = url
      ? loadGlb(url)
        .then((gltf) => {
          if (this.disposed) return false;
          this._setupRig(gltf.scene, profile);
          return true;
        })
        .catch((err) => {
          console.warn('Boxeur : personnage 3D indisponible, modèle simplifié conservé.', err);
          return false;
        })
      : Promise.resolve(false);
  }

  _setupRig(scene, profile) {
    scene.updateMatrixWorld(true);
    const bones = findBones(scene);
    const skinned = [];
    scene.traverse((o) => {
      if (o.isSkinnedMesh) skinned.push(o);
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false; // la boîte englobante ne suit pas l'animation
      }
    });
    const required = ['Hips', 'Head', 'Neck', 'UpperArm.L', 'LowerArm.L', 'Wrist.L', 'UpperLeg.L', 'LowerLeg.L', 'Foot.L', ...SPINE];
    for (const n of required) if (!bones[n]) throw new Error(`os manquant : ${n}`);

    // Bras allongés (proportions réalistes, allonge des coups du jeu)
    for (const side of ['L', 'R']) {
      const S = bones[`UpperArm.${side}`].getWorldPosition(new Vector3());
      const E = bones[`LowerArm.${side}`].getWorldPosition(new Vector3());
      const W = bones[`Wrist.${side}`].getWorldPosition(new Vector3());
      stretchArm(skinned, bones, side, TARGET_UPPER_ARM / S.distanceTo(E), TARGET_FOREARM / E.distanceTo(W));
    }
    scene.updateMatrixWorld(true);

    // Mesures de repos (repère du modèle, avant échelle)
    const restY = (n) => bones[n].getWorldPosition(new Vector3()).y;
    const hipsHeight = restY('Hips') * MODEL_SCALE;
    const ankleHeight = restY('Foot.L') * MODEL_SCALE;
    const len = (a, b) => bones[a].getWorldPosition(new Vector3()).distanceTo(bones[b].getWorldPosition(new Vector3()));

    const limbs = {};
    for (const [key, side] of [['left', 'L'], ['right', 'R']]) {
      const up = bones[`UpperArm.${side}`];
      const low = bones[`LowerArm.${side}`];
      const wr = bones[`Wrist.${side}`];
      const fingers = bones[`Middle1.${side}`] || wr.children.find((c) => c.isBone);
      limbs[key] = {
        up, low, wr,
        upDir: restDirection(up, low),
        lowDir: restDirection(low, wr),
        wrDir: fingers ? restDirection(wr, fingers) : new Vector3(0, 1, 0),
        l1: len(`UpperArm.${side}`, `LowerArm.${side}`) * MODEL_SCALE,
        l2: len(`LowerArm.${side}`, `Wrist.${side}`) * MODEL_SCALE,
      };
      wr.scale.setScalar(HAND_SCALE);
    }
    const legs = {};
    for (const [key, side] of [[-1, 'L'], [1, 'R']]) {
      const up = bones[`UpperLeg.${side}`];
      const low = bones[`LowerLeg.${side}`];
      const foot = bones[`Foot.${side}`];
      // Sur ces squelettes, le pied est un contrôleur rattaché à la racine (pas au
      // tibia) : direction de repos du tibia vers la cheville, exprimée dans son repère.
      const lowQ = low.getWorldQuaternion(new Quaternion()).invert();
      const shinDir = foot.getWorldPosition(new Vector3()).sub(low.getWorldPosition(new Vector3())).applyQuaternion(lowQ).normalize();
      legs[key] = {
        up, low, foot,
        upDir: restDirection(up, low),
        lowDir: foot.parent === low ? restDirection(low, foot) : shinDir,
        l1: len(`UpperLeg.${side}`, `LowerLeg.${side}`) * MODEL_SCALE,
        l2: len(`LowerLeg.${side}`, `Foot.${side}`) * MODEL_SCALE,
        footQuat: foot.getWorldQuaternion(new Quaternion()), // orientation de repos (repère du modèle)
      };
    }

    // Conteneur, ajouté après les mesures (faites dans le repère du modèle) :
    // même repère que le boxeur en primitives (regard vers -Z)
    const holder = new Group();
    holder.name = 'rigged-character';
    holder.rotation.y = Math.PI;
    holder.scale.setScalar(MODEL_SCALE);
    holder.add(scene);
    this.body.add(holder);

    // Toutes les rotations de repos, pour repartir d'une pose propre à chaque image
    const rest = new Map();
    for (const b of new Set(Object.values(bones))) rest.set(b, { q: b.quaternion.clone(), p: b.position.clone() });

    let skinMat = null;
    scene.traverse((o) => {
      if (o.isMesh && !skinMat) {
        for (const m of [].concat(o.material)) if (m && /skin/i.test(m.name) && !/dark/i.test(m.name)) skinMat = m;
      }
    });

    this.rig = {
      holder, scene, bones, limbs, legs, rest, skinMat,
      hipsHeight,
      ankleHeight,
      footRest: new Quaternion(),
    };

    // Le boxeur en primitives s'efface (on garde ses gants)
    const gloves = new Set(Object.values(this.arms).map((a) => a.glove));
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      let keep = false;
      for (let p = o; p; p = p.parent) if (p === holder || gloves.has(p)) keep = true;
      if (!keep) o.visible = false;
    });
  }

  /* ---------- Animation ---------- */

  update(dt, f, state = {}) {
    super.update(dt, f, state);
    if (this.rig) this._driveRig(f);
  }

  _driveRig(f) {
    const R = this.rig;
    const B = R.bones;
    for (const [b, r] of R.rest) {
      b.quaternion.copy(r.q);
      b.position.copy(r.p);
    }
    this.root.updateMatrixWorld(true);

    // --- Bassin : même position que le bassin calculé (hauteur adaptée au modèle) ---
    const pv = this.pelvis.position;
    _t.set(pv.x, pv.y - BOXER_PELVIS_Y + R.hipsHeight, pv.z);
    this.body.localToWorld(_t);
    // On déplace l'os parent commun du bassin et des jambes (« Body » sur ces squelettes)
    const pelvisBone = B.Hips.parent && B.Hips.parent.isBone && B.Hips.parent.name !== 'Root' ? B.Hips.parent : B.Hips;
    B.Hips.getWorldPosition(_a);
    pelvisBone.getWorldPosition(_b).add(_t).sub(_a);
    pelvisBone.position.copy(pelvisBone.parent.worldToLocal(_b));
    pelvisBone.updateWorldMatrix(false, true);

    // --- Colonne : rotation du buste répartie sur trois vertèbres ---
    this.pelvis.getWorldQuaternion(_q);
    this.spine.getWorldQuaternion(_qd);
    _qd.multiply(_q.invert()); // rotation monde bassin → buste
    _q2.identity().slerp(_qd, 1 / SPINE.length);
    for (const name of SPINE) this._rotateWorld(B[name], _q2);

    // --- Cou et tête ---
    this.spine.getWorldQuaternion(_q);
    this.head.getWorldQuaternion(_qd);
    _qd.multiply(_q.invert());
    this._rotateWorld(B.Neck, _q2.identity().slerp(_qd, 0.4));
    this._rotateWorld(B.Head, _q2.identity().slerp(_qd, 0.6));

    // --- Bras ---
    for (const hand of ['left', 'right']) this._driveArm(this.arms[hand], R.limbs[hand]);

    // --- Jambes ---
    for (const side of [-1, 1]) this._driveLeg(this.legs[side], R.legs[side]);

    // Transpiration (comme le modèle simplifié)
    if (R.skinMat && 'roughness' in R.skinMat) {
      const sweat = 1 - f.stamina.ratio * 0.5 - (f.hp / f.maxHp) * 0.5;
      R.skinMat.roughness = lerp(0.62, 0.32, clamp(sweat, 0, 1));
    }
  }

  /** Applique une rotation exprimée dans le repère monde à un os. */
  _rotateWorld(bone, qWorld) {
    bone.getWorldQuaternion(_qi);
    _qi.premultiply(qWorld);
    this._setWorldQuaternion(bone, _qi);
  }

  _setWorldQuaternion(bone, qWorld) {
    bone.parent.getWorldQuaternion(_q);
    bone.quaternion.copy(_q.invert().multiply(qWorld));
    bone.updateWorldMatrix(false, true);
  }

  /** Oriente un os pour que sa direction de repos pointe vers `target` (monde). */
  _aim(bone, restDir, target) {
    bone.getWorldPosition(_p);
    bone.getWorldQuaternion(_qi);
    _a.copy(restDir).applyQuaternion(_qi).normalize();
    _b.copy(target).sub(_p);
    if (_b.lengthSq() < 1e-10) return;
    _b.normalize();
    _q.setFromUnitVectors(_a, _b);
    _qi.premultiply(_q);
    this._setWorldQuaternion(bone, _qi);
  }

  _driveArm(arm, L) {
    // Épaule du personnage, poignet visé (derrière le gant), pôle du coude
    L.up.getWorldPosition(_s);
    this.body.localToWorld(_t.copy(arm.wrist));
    this.body.localToWorld(_r.copy(arm.pole));
    solveTwoBone(_s, _t, L.l1, L.l2, _r, _e);
    // Hors de portée : le poignet s'arrête au bout du bras, le gant suit
    _v.copy(_t).sub(_s);
    const reach = (L.l1 + L.l2) * 0.995;
    const d = _v.length();
    if (d > reach) {
      _t.copy(_s).addScaledVector(_v, reach / d);
      solveTwoBone(_s, _t, L.l1, L.l2, _r, _e);
      // recule le gant d'autant (repère « body »)
      this.body.worldToLocal(_a.copy(_t));
      _b.set(0, 0, GLOVE_WRIST_OFFSET * 1.03).applyQuaternion(arm.quat);
      arm.glove.position.copy(_a).sub(_b);
    }
    this._aim(L.up, L.upDir, _e);
    this._aim(L.low, L.lowDir, _t);
    this.body.localToWorld(_g.copy(arm.glove.position));
    this._aim(L.wr, L.wrDir, _g);
  }

  _driveLeg(leg, L) {
    L.up.getWorldPosition(_s);
    _t.copy(leg.foot);
    _t.y += this.rig.ankleHeight - BOXER_ANKLE_Y;
    this.body.localToWorld(_t);
    this.body.localToWorld(_r.copy(leg.pole));
    solveTwoBone(_s, _t, L.l1, L.l2, _r, _e);
    this._aim(L.up, L.upDir, _e);
    this._aim(L.low, L.lowDir, _t);
    // Cheville au bout du tibia (le pied n'est pas un enfant du tibia)
    if (L.foot.parent !== L.low) {
      L.low.getWorldPosition(_a);
      L.low.getWorldQuaternion(_qi);
      _a.addScaledVector(_b.copy(L.lowDir).applyQuaternion(_qi).normalize(), L.l2);
      L.foot.position.copy(L.foot.parent.worldToLocal(_a));
      L.foot.updateWorldMatrix(false, true);
    }
    // Pied à plat : orientation de repos dans le repère du personnage
    this.rig.holder.getWorldQuaternion(_q);
    this._setWorldQuaternion(L.foot, _q2.copy(_q).multiply(L.footQuat));
  }

  dispose() {
    this.disposed = true;
    if (this.rig) {
      this.rig.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        for (const m of [].concat(o.material)) {
          for (const k of Object.keys(m)) if (m[k] && m[k].isTexture) m[k].dispose();
          m.dispose();
        }
      });
    }
    super.dispose();
  }
}
