/**
 * FirstPersonArms.js
 * ------------------------------------------------------------------
 * Gants et avant-bras du joueur en vue subjective (attachés à la caméra).
 *
 * La position de chaque gant vient directement de la logique de combat
 * (PunchSystem.getGloveWorld) convertie dans le repère caméra : ce que le
 * joueur voit est exactement ce qui est testé pour les impacts.
 * Par-dessus, des effets purement visuels quand on ne frappe pas :
 * respiration, rebond sur les appuis, inertie lors des mouvements de souris,
 * secousse des gants quand on encaisse ou qu'on bloque.
 */

import {
  Group, Mesh, CylinderGeometry, MeshStandardMaterial, Vector3, Quaternion, Color,
} from 'three';
import { GameConfig } from '../config/GameConfig.js';
import { createGlove, disposeGlove, GLOVE_WRIST_OFFSET } from './GloveFactory.js';
import { solveTwoBone, placeBone, gloveQuaternion } from './Rig.js';
import { clamp, wrapAngle, Ease, Spring } from '../core/MathUtils.js';

const VM = GameConfig.viewmodel;

const _w = new Vector3();
const _invQ = new Quaternion();
const _F = new Vector3();
const _U = new Vector3();
const _F2 = new Vector3();
const _U2 = new Vector3();
const _qa = new Quaternion();
const _qb = new Quaternion();
const _wrist = new Vector3();
const _pole = new Vector3();
const _tan = new Vector3();
const _tmp = new Vector3();

export class FirstPersonArms {
  constructor(camera, { gloveSkin = 'crimson', skinColor = '#c98d66' } = {}) {
    this.camera = camera;
    this.group = new Group();
    this.group.name = 'viewmodel';
    camera.add(this.group);
    this.skinMat = new MeshStandardMaterial({ color: new Color(skinColor), roughness: 0.55, metalness: 0 });
    this.wrapMat = new MeshStandardMaterial({ color: '#f1ede4', roughness: 0.8 });
    this.foreGeo = new CylinderGeometry(0.047, 0.058, 1, 14);
    this.upperGeo = new CylinderGeometry(0.06, 0.068, 1, 14);
    this.wrapGeo = new CylinderGeometry(0.052, 0.052, 0.05, 14);
    this.hands = {
      left: this._buildArm('left', gloveSkin),
      right: this._buildArm('right', gloveSkin),
    };
    this.time = 0;
    this.prevYaw = null;
    this.prevPitch = 0;
    this.sway = new Vector3();
    this.joltX = new Spring(240, 17);
    this.joltY = new Spring(240, 17);
    this.joltZ = new Spring(240, 17);
    this.lastHitSerial = -1;
    this.celebrate = 0;
    this.celebrateTarget = 0;
  }

  _buildArm(hand, gloveSkin) {
    const side = hand === 'left' ? -1 : 1;
    const glove = createGlove(hand, gloveSkin, 1);
    const fore = new Mesh(this.foreGeo, this.skinMat);
    const upper = new Mesh(this.upperGeo, this.skinMat);
    const wrap = new Mesh(this.wrapGeo, this.wrapMat);
    for (const m of [fore, upper, wrap]) {
      m.castShadow = false;
      m.frustumCulled = false;
    }
    glove.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.frustumCulled = false;
      }
    });
    this.group.add(glove, fore, upper, wrap);
    const s = hand === 'left' ? VM.shoulderL : VM.shoulderR;
    return {
      hand, side, glove, fore, upper, wrap,
      shoulder: new Vector3(s[0], s[1], s[2]),
      elbow: new Vector3(),
      pos: new Vector3(),
      quat: new Quaternion(),
    };
  }

  setGloveSkin(skin) {
    for (const h of Object.values(this.hands)) {
      this.group.remove(h.glove);
      disposeGlove(h.glove);
      h.glove = createGlove(h.hand, skin, 1);
      h.glove.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = false;
          o.frustumCulled = false;
        }
      });
      this.group.add(h.glove);
    }
  }

  setVisible(v) {
    this.group.visible = v;
  }

  /**
   * @param {number} dt temps de jeu (ralentis compris)
   * @param {number} realDt temps réel
   * @param {import('../game/Player.js').Player} player
   * @param {{victory?: boolean}} state
   */
  update(dt, realDt, player, state = {}) {
    this.time += dt;
    _invQ.copy(player.cameraQuat).invert();

    // Inertie (sway) quand la souris tourne
    if (this.prevYaw === null) this.prevYaw = player.yaw;
    const dYaw = wrapAngle(player.yaw - this.prevYaw) / Math.max(realDt, 1e-3);
    const dPitch = (player.pitch - this.prevPitch) / Math.max(realDt, 1e-3);
    this.prevYaw = player.yaw;
    this.prevPitch = player.pitch;
    const k = Math.min(1, realDt * 9);
    this.sway.x += (clamp(dYaw * 0.012, -0.05, 0.05) - this.sway.x) * k;
    this.sway.y += (clamp(-dPitch * 0.01, -0.04, 0.04) - this.sway.y) * k;

    // Secousse des gants quand on encaisse / qu'on bloque
    const hr = player.hitReact;
    if (hr.serial !== this.lastHitSerial) {
      this.lastHitSerial = hr.serial;
      if (hr.time < 0.2) {
        _tmp.copy(hr.dir).applyQuaternion(_invQ);
        const s = hr.blocked ? 0.9 : 1.6 * hr.strength;
        this.joltX.impulse(_tmp.x * s * 0.8);
        this.joltY.impulse(-0.6 * s);
        this.joltZ.impulse(1.4 * s);
      }
    }
    this.joltX.update(realDt);
    this.joltY.update(realDt);
    this.joltZ.update(realDt);

    this.celebrateTarget = state.victory ? 1 : 0;
    this.celebrate += (this.celebrateTarget - this.celebrate) * Math.min(1, dt * 4);

    const t = this.time;
    const moving = clamp(player.moveSpeed / 2.5, 0, 1);
    const bounce = Math.sin(t * Math.PI * 2 * 1.7) * 0.006 + Math.sin(t * 9.5) * 0.009 * moving;
    const breath = Math.sin(t * 1.9) * 0.004;
    let koDrop = player.ko ? Ease.inCubic(clamp(player.koTime / 0.9, 0, 1)) * 0.75 : 0;
    if (!player.ko && player.down && player.down.riseT < 1.1) koDrop = (1 - Ease.outCubic(clamp(player.down.riseT / 1.1, 0, 1))) * 0.75;

    for (const h of [this.hands.left, this.hands.right]) {
      const punch = player.punches.hands[h.hand];
      player.punches.getGloveWorld(h.hand, _w);
      h.pos.copy(_w).sub(player.eye).applyQuaternion(_invQ);

      const ext = punch.active ? punch.extension : 0;
      const idle = 1 - clamp(Math.abs(ext) * 2.5, 0, 1);
      h.pos.x += (this.sway.x + Math.sin(t * 4.7 + h.side) * 0.004 * moving) * idle;
      h.pos.y += (this.sway.y + bounce + breath * (h.side > 0 ? 1 : 0.7)) * idle;
      h.pos.x += this.joltX.value * 0.06 * (h.side > 0 ? 1 : 0.8);
      h.pos.y += this.joltY.value * 0.05;
      h.pos.z += this.joltZ.value * 0.05;

      // Victoire : gants levés
      if (this.celebrate > 0.001) {
        _tmp.set(h.side * 0.2, 0.16 + Math.sin(t * 6 + h.side) * 0.03, -0.42);
        h.pos.lerp(_tmp, Ease.inOutCubic(this.celebrate));
      }
      h.pos.y -= koDrop;

      // --- Orientation ---
      // Repos / garde : jointures vers l'avant et le haut, paume vers l'intérieur
      const g = player.guard.amount;
      _F.set(-h.side * 0.08, 0.42, -1).lerp(_F2.set(-h.side * 0.3, 1.2, -0.6), g).normalize();
      _U.set(h.side, 0.3, 0.1).lerp(_U2.set(h.side, -0.1, 0.45), g).normalize();
      if (this.celebrate > 0.001) {
        _F.lerp(_F2.set(0, 1, -0.2), this.celebrate).normalize();
        _U.lerp(_U2.set(0, 0, -1), this.celebrate).normalize();
      }
      gloveQuaternion(_F, _U, _qa);

      if (punch.active && punch.def) {
        // Direction de déplacement du gant sur sa trajectoire
        const u = clamp(punch.phase === 'windup' ? 0.15 : punch.u, 0.05, 0.98);
        _tan.copy(punch.p1).sub(punch.p0).multiplyScalar(2 * (1 - u))
          .add(_tmp.copy(punch.p2).sub(punch.p1).multiplyScalar(2 * u));
        if (punch.def.kind === 'straight') _tan.copy(punch.p2).sub(punch.p0);
        _tan.applyQuaternion(_invQ).normalize();
        if (punch.def.kind === 'uppercut') _U.set(0, 0.25, -1).normalize();
        else if (punch.def.kind === 'hook') _U.set(0, 1, 0.25).normalize();
        else _U.set(0, 1, 0);
        gloveQuaternion(_tan, _U, _qb);
        const w = clamp(ext * 1.5, 0, 1);
        _qa.slerp(_qb, w);
      }
      h.quat.copy(_qa);
      h.glove.position.copy(h.pos);
      h.glove.quaternion.copy(h.quat);

      // --- Bras (IK) ---
      _wrist.set(0, 0, GLOVE_WRIST_OFFSET).applyQuaternion(h.quat).add(h.pos);
      const hookW = punch.active && punch.def && punch.def.kind === 'hook' ? clamp(ext * 1.5, 0, 1) : 0;
      _pole.copy(h.shoulder).add(_tmp.set(h.side * (0.3 + hookW * 0.4), -0.55 + hookW * 0.5, 0.2));
      solveTwoBone(h.shoulder, _wrist, VM.upperArm, VM.forearm, _pole, h.elbow);
      placeBone(h.upper, h.shoulder, h.elbow, 1);
      placeBone(h.fore, h.elbow, _wrist, 1);
      // Bande de strapping au poignet
      _tmp.copy(h.elbow).sub(_wrist).normalize();
      h.wrap.position.copy(_wrist).addScaledVector(_tmp, 0.03);
      h.wrap.quaternion.copy(h.fore.quaternion);
    }
  }

  dispose() {
    for (const h of Object.values(this.hands)) disposeGlove(h.glove);
    this.skinMat.dispose();
    this.wrapMat.dispose();
    this.foreGeo.dispose();
    this.upperGeo.dispose();
    this.wrapGeo.dispose();
    this.camera.remove(this.group);
  }
}
