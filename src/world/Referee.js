/**
 * Referee.js
 * ------------------------------------------------------------------
 * L'arbitre (personnage X Bot en noir et blanc). Purement visuel : il ne
 * touche pas à la simulation, il la regarde.
 *
 *  - pendant le combat : il tourne autour des boxeurs, sur le côté, à bonne
 *    distance, et les regarde ;
 *  - knockdown : il se place au-dessus du boxeur au tapis et compte en
 *    abaissant le bras à chaque chiffre ;
 *  - KO : il fait signe que c'est fini (bras croisés au-dessus de la tête) ;
 *  - entre les rounds : il attend dans un coin neutre.
 *
 * Animation : clips Mixamo « garde » et « pas » pour le corps et les jambes,
 * bras et buste posés par IK (bras le long du corps, compte, signe de fin).
 */

import { Group, Vector3, Quaternion, AnimationMixer, LoopRepeat, Color } from 'three';
import { loadGlb } from '../core/loadGlb.js';
import { solveTwoBone } from '../characters/Rig.js';
import { MIXAMO_MODELS } from '../characters/MixamoBoxerModel.js';
import { GameConfig, ringBound } from '../config/GameConfig.js';
import { clamp, stepAngle, yawFromDirection } from '../core/MathUtils.js';

const KD = GameConfig.knockdown;
const HEIGHT = 1.68; // centre de la tête (m)
const B = (n) => `mixamorig${n}`;

const _v = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _s = new Vector3();
const _t = new Vector3();
const _e = new Vector3();
const _p = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _qi = new Quaternion();
const _target = new Vector3();
const _look = new Vector3();

export class Referee {
  constructor() {
    this.root = new Group();
    this.root.name = 'referee';
    this.root.visible = false;
    this.position = this.root.position;
    this.position.set(1.9, 0, 1.9);
    this.yaw = 0;
    this.speed = 0;
    this.side = 1;
    this.time = 0;
    this.countAt = -10; // dernier chiffre annoncé
    this.lastN = 0;
    this.rig = null;
    this.disposed = false;
    this.ready = loadGlb(MIXAMO_MODELS.xbot)
      .then((gltf) => {
        if (this.disposed) return false;
        this._setup(gltf);
        return true;
      })
      .catch((err) => {
        console.warn('Arbitre indisponible.', err);
        return false;
      });
  }

  _setup(gltf) {
    const scene = gltf.scene;
    const bones = {};
    scene.traverse((o) => {
      if (o.isBone && !bones[o.name]) bones[o.name] = o;
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        for (const m of [].concat(o.material)) {
          // Chemise blanche, articulations noires : la tenue de l'arbitre
          m.color = new Color(/joint/i.test(o.name) || /joint/i.test(m.name) ? '#121316' : '#f3f3f1');
          m.roughness = 0.6;
          m.metalness = 0.02;
        }
      }
    });
    const bone = (n) => {
      const b = bones[B(n)];
      if (!b) throw new Error(`os manquant : ${B(n)}`);
      return b;
    };
    const clips = {};
    for (const c of gltf.animations) clips[c.name] = c;
    const mixer = new AnimationMixer(scene);
    const idle = mixer.clipAction(clips.idle);
    const step = mixer.clipAction(clips.step);
    for (const a of [idle, step]) {
      a.setLoop(LoopRepeat, Infinity);
      a.play();
    }
    step.setEffectiveWeight(0);

    // Échelle : tête à hauteur d'homme (mesurée sur la pose de garde)
    mixer.update(0);
    scene.updateMatrixWorld(true);
    const head = bone('Head').getWorldPosition(new Vector3());
    const top = bones[B('HeadTop_End')];
    if (top) head.lerp(top.getWorldPosition(_v), 0.45);
    const scale = HEIGHT / head.y;
    const hips = bone('Hips');
    const hipsXZ = hips.position.clone();

    const holder = new Group();
    holder.rotation.y = Math.PI; // regard vers -Z, comme les boxeurs
    holder.scale.setScalar(scale);
    holder.add(scene);
    this.root.add(holder);

    const arm = (side) => ({
      up: bone(`${side}Arm`),
      low: bone(`${side}ForeArm`),
      wr: bone(`${side}Hand`),
    });
    const L = arm('Left');
    const R = arm('Right');
    for (const a of [L, R]) {
      a.upDir = a.low.position.clone().normalize();
      a.lowDir = a.wr.position.clone().normalize();
    }
    this.rig = {
      holder, scene, mixer, idle, step, hips, hipsXZ,
      spine: [bone('Spine'), bone('Spine1'), bone('Spine2')],
      neck: bone('Neck'),
      head: bone('Head'),
      arms: { left: L, right: R },
      lean: 0,
      wave: 0,
      count: 0,
    };
  }

  setVisible(v) {
    this.root.visible = v;
  }

  /** Place l'arbitre dans un coin neutre (début de combat). */
  resetPosition() {
    const c = ringBound() - 0.55;
    this.position.set(c, 0, c);
    this.yaw = yawFromDirection(-c, -c);
    this.speed = 0;
    this.lastN = 0;
  }

  /**
   * @param {number} dt
   * @param {{phase: string, count: object|null, fighters: object[], result: object|null}} s
   */
  update(dt, s) {
    this.time += dt;
    if (!this.root.visible) return;
    const [a, b] = s.fighters;
    const bound = ringBound() - 0.5;
    let maxSpeed = 1.6;
    let mode = 'watch';
    let lookAt = null;

    if (s.phase === 'count' && s.count) {
      // Au-dessus du boxeur au tapis, un peu décalé. Si c'est l'adversaire, l'arbitre
      // se place derrière lui : le joueur voit à la fois le boxeur au sol et le compte.
      mode = 'count';
      const down = s.count.fighter;
      const other = s.count.other;
      _v.set(other.position.x - down.position.x, 0, other.position.z - down.position.z);
      if (_v.lengthSq() < 1e-4) _v.set(0, 0, 1);
      _v.normalize();
      const away = down === s.fighters[0] ? 0.85 : -0.8;
      _target.copy(down.position).addScaledVector(_v, away).add(_a.set(-_v.z, 0, _v.x).multiplyScalar(0.5));
      lookAt = down.position;
      maxSpeed = 3;
      if (s.count.n !== this.lastN) {
        this.lastN = s.count.n;
        if (s.count.n > 0) this.countAt = this.time;
      }
    } else if ((s.phase === 'ko' || s.phase === 'over') && s.result && s.result.method === 'KO') {
      mode = 'stop';
      const loser = s.result.loser;
      const winner = s.result.winner;
      _v.set(winner.position.x - loser.position.x, 0, winner.position.z - loser.position.z);
      if (_v.lengthSq() < 1e-4) _v.set(0, 0, 1);
      _v.normalize();
      _target.copy(loser.position).addScaledVector(_v, 1).add(_a.set(-_v.z, 0, _v.x).multiplyScalar(0.4));
      lookAt = loser.position;
      maxSpeed = 2.6;
    } else if (s.phase === 'fighting') {
      // Sur le côté du couple de boxeurs, à bonne distance
      const mx = (a.position.x + b.position.x) / 2;
      const mz = (a.position.z + b.position.z) / 2;
      _v.set(b.position.x - a.position.x, 0, b.position.z - a.position.z);
      if (_v.lengthSq() < 1e-4) _v.set(1, 0, 0);
      _v.normalize();
      const px = -_v.z;
      const pz = _v.x;
      const tx = mx + px * this.side * 2;
      const tz = mz + pz * this.side * 2;
      if (Math.abs(tx) > bound || Math.abs(tz) > bound) {
        // Trop près des cordes de ce côté : il passe de l'autre
        const ox = mx - px * this.side * 2;
        const oz = mz - pz * this.side * 2;
        if (Math.abs(ox) <= bound && Math.abs(oz) <= bound) this.side *= -1;
      }
      _target.set(mx + px * this.side * 2, 0, mz + pz * this.side * 2);
      _look.set(mx, 0, mz);
      lookAt = _look;
    } else {
      // Intro, pauses : coin neutre le plus proche
      const c = ringBound() - 0.55;
      _target.set(Math.sign(this.position.x || 1) * c, 0, Math.sign(this.position.z || 1) * c);
      _look.set(0, 0, 0);
      lookAt = _look;
      maxSpeed = 1.4;
    }
    _target.x = clamp(_target.x, -bound, bound);
    _target.z = clamp(_target.z, -bound, bound);

    // Ne pas traverser les boxeurs (sauf au-dessus de celui qui est au tapis)
    for (const f of s.fighters) {
      if (mode === 'count' && s.count && f === s.count.fighter) continue;
      if (mode === 'stop' && s.result && f === s.result.loser) continue;
      _a.set(_target.x - f.position.x, 0, _target.z - f.position.z);
      const d = _a.length();
      if (d < 1.1 && d > 1e-4) _target.copy(f.position).addScaledVector(_a, 1.1 / d).setY(0);
    }

    // Déplacement doux
    _a.set(_target.x - this.position.x, 0, _target.z - this.position.z);
    const dist = _a.length();
    const want = dist > 0.05 ? Math.min(maxSpeed, dist * 2.2) : 0;
    this.speed += (want - this.speed) * Math.min(1, dt * 5);
    if (dist > 1e-4) this.position.addScaledVector(_a, Math.min(dist, this.speed * dt) / dist);
    if (lookAt) {
      const yaw = yawFromDirection(lookAt.x - this.position.x, lookAt.z - this.position.z);
      this.yaw = stepAngle(this.yaw, yaw, 5 * dt);
    }
    this.root.rotation.y = this.yaw;

    if (this.rig) this._animate(dt, mode, lookAt);
  }

  _animate(dt, mode, lookAt) {
    const R = this.rig;
    const moving = clamp(this.speed / 1.4, 0, 1);
    R.step.setEffectiveWeight(moving * 0.8);
    R.idle.setEffectiveWeight(1 - moving * 0.8);
    R.step.timeScale = 0.8 + moving * 0.7;
    R.mixer.update(dt);
    R.hips.position.x = R.hipsXZ.x;
    R.hips.position.z = R.hipsXZ.z;
    // Un arbitre se tient plus droit qu'un boxeur
    R.hips.position.y += (R.hipsXZ.y - R.hips.position.y) * 0.5;

    const k = Math.min(1, dt * 6);
    R.lean += ((mode === 'count' ? 0.42 : mode === 'stop' ? 0.05 : 0.08) - R.lean) * k;
    R.wave += ((mode === 'stop' ? 1 : 0) - R.wave) * k;
    R.count += ((mode === 'count' ? 1 : 0) - R.count) * k;
    this.root.updateMatrixWorld(true); // position de cette image (pas celle du dernier rendu)

    // Buste : redressé, penché vers le boxeur au tapis pendant le compte
    this.root.getWorldQuaternion(_q);
    _v.set(1, 0, 0).applyQuaternion(_q); // axe gauche-droite du corps
    const straighten = -0.12;
    _q2.setFromAxisAngle(_v, (R.lean + straighten) / R.spine.length);
    for (const b of R.spine) this._rotateWorld(b, _q2);
    // Tête : regarde la cible
    if (lookAt) {
      R.head.getWorldPosition(_p);
      _b.set(lookAt.x, mode === 'count' ? 0.3 : 1.4, lookAt.z).sub(_p).normalize();
      _a.set(0, 0, -1).applyQuaternion(_q); // regard actuel du corps
      _q2.setFromUnitVectors(_a, _b);
      _qi.identity().slerp(_q2, 0.6);
      this._rotateWorld(R.neck, _qi);
    }

    // Bras : cibles dans le repère de l'arbitre (x droite, y haut, -z devant)
    const t = this.time;
    const sinceCount = this.time - this.countAt;
    const chop = clamp(sinceCount / (KD.fastInterval * 0.9), 0, 1); // 0 = bras en bas (chiffre), 1 = relevé
    for (const hand of ['left', 'right']) {
      const s = hand === 'left' ? -1 : 1;
      // Repos : bras le long du corps, légèrement devant
      _t.set(s * 0.24, 0.86, -0.1);
      if (R.count > 0.01) {
        if (hand === 'right') {
          // Compte : la main descend sur chaque chiffre, puis remonte
          const up = Math.sin(chop * Math.PI * 0.5);
          _a.set(0.3, 0.72 + up * 1.12, -0.58 + up * 0.36);
          _t.lerp(_a, R.count);
        } else {
          _a.set(-0.26, 0.68, -0.32); // l'autre main en appui sur la cuisse
          _t.lerp(_a, R.count);
        }
      }
      if (R.wave > 0.01) {
        // Signe de fin : bras qui se croisent au-dessus de la tête
        const w = Math.sin(t * 9) * 0.22;
        _a.set(s * (0.05 + w * s), 1.85, -0.12);
        _t.lerp(_a, R.wave);
      }
      this.root.localToWorld(_t);
      this._driveArm(R.arms[hand], _t, s);
    }
  }

  _driveArm(L, target, side) {
    L.up.getWorldPosition(_s);
    L.low.getWorldPosition(_e);
    L.wr.getWorldPosition(_p);
    const l1 = _s.distanceTo(_e);
    const l2 = _e.distanceTo(_p);
    // Coude vers l'extérieur et l'arrière
    this.root.localToWorld(_b.set(side * 0.55, 1.05, 0.35));
    _v.copy(target).sub(_s);
    const reach = (l1 + l2) * 0.998;
    if (_v.length() > reach) target.copy(_s).addScaledVector(_v.normalize(), reach);
    solveTwoBone(_s, target, l1, l2, _b, _e);
    this._aim(L.up, L.upDir, _e);
    this._aim(L.low, L.lowDir, target);
  }

  _rotateWorld(bone, qWorld) {
    bone.getWorldQuaternion(_qi);
    _qi.premultiply(qWorld);
    this._setWorldQuaternion(bone, _qi);
  }

  _setWorldQuaternion(bone, qWorld) {
    bone.parent.getWorldQuaternion(_rq);
    bone.quaternion.copy(_rq.invert().multiply(qWorld));
    bone.updateWorldMatrix(false, true);
  }

  _aim(bone, restDir, target) {
    bone.getWorldPosition(_ap);
    bone.getWorldQuaternion(_aq);
    _aa.copy(restDir).applyQuaternion(_aq).normalize();
    _ab.copy(target).sub(_ap);
    if (_ab.lengthSq() < 1e-10) return;
    _ab.normalize();
    _ar.setFromUnitVectors(_aa, _ab);
    _aq.premultiply(_ar);
    this._setWorldQuaternion(bone, _aq);
  }

  dispose() {
    this.disposed = true;
    if (this.rig) {
      this.rig.mixer.stopAllAction();
      this.rig.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        for (const m of [].concat(o.material)) m.dispose();
      });
    }
    if (this.root.parent) this.root.parent.remove(this.root);
  }
}

const _rq = new Quaternion();
const _ap = new Vector3();
const _aa = new Vector3();
const _ab = new Vector3();
const _aq = new Quaternion();
const _ar = new Quaternion();
