/**
 * CameraRig.js
 * ------------------------------------------------------------------
 * Pilote la caméra :
 *  - vue subjective (œil du joueur) + secousses (« trauma ») + reculs à ressort ;
 *  - petit coup de caméra quand on frappe, gros recul quand on encaisse ;
 *  - chute de la caméra quand le joueur est KO, zoom quand l'adversaire tombe ;
 *  - caméra « cinéma » qui tourne autour du ring dans le menu, puis transition
 *    fluide vers la vue subjective au début du combat.
 * L'option « Camera shake » désactive secousses et reculs.
 */

import { Vector3, Quaternion, Euler } from 'three';
import { GameConfig } from '../config/GameConfig.js';
import { Spring, clamp, Ease, lerp } from '../core/MathUtils.js';

const _pos = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _e = new Euler(0, 0, 0, 'YXZ');
const _off = new Vector3();
const _look = new Vector3();
const _fromPos = new Vector3();
const _fromQuat = new Quaternion();

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.baseFov = GameConfig.camera.fov;
    this.enabled = true; // option « camera shake »
    this.trauma = 0;
    this.time = 0;
    this.kickPitch = new Spring(130, 13);
    this.kickYaw = new Spring(130, 13);
    this.kickRoll = new Spring(120, 11);
    this.pushZ = new Spring(150, 14);
    this.pushX = new Spring(150, 14);
    this.fovKick = new Spring(90, 11);
    this.mode = 'orbit';
    this.orbitAngle = 0.6;
    this.orbitRadius = 5.4;
    this.orbitHeight = 2.5;
    this.transition = 1;
    this.transitionDuration = 1.2;
    this.zoom = 0; // zoom cinéma (KO de l'adversaire)
    this.zoomTarget = 0;
  }

  /** Secousse aléatoire (0-1, cumulative). */
  addTrauma(amount) {
    if (!this.enabled) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Recul directionnel (impulsions en rad/s et m/s). */
  kick({ pitch = 0, yaw = 0, roll = 0, push = 0, side = 0, fov = 0 } = {}) {
    if (!this.enabled) return;
    this.kickPitch.impulse(pitch);
    this.kickYaw.impulse(yaw);
    this.kickRoll.impulse(roll);
    this.pushZ.impulse(push);
    this.pushX.impulse(side);
    this.fovKick.impulse(fov);
  }

  setMode(mode, { transition = false } = {}) {
    if (transition) {
      _fromPos.copy(this.camera.position);
      _fromQuat.copy(this.camera.quaternion);
      this.from = { pos: _fromPos.clone(), quat: _fromQuat.clone() };
      this.transition = 0;
    }
    this.mode = mode;
  }

  resetEffects() {
    this.trauma = 0;
    for (const s of [this.kickPitch, this.kickYaw, this.kickRoll, this.pushZ, this.pushX, this.fovKick]) s.reset(0);
    this.zoom = 0;
    this.zoomTarget = 0;
  }

  /**
   * @param {number} realDt temps réel (les secousses ne ralentissent pas)
   * @param {object} player Player
   * @param {object} opponent Opponent
   */
  update(realDt, player, opponent) {
    this.time += realDt;
    const cam = this.camera;
    for (const s of [this.kickPitch, this.kickYaw, this.kickRoll, this.pushZ, this.pushX, this.fovKick]) s.update(realDt);
    this.trauma = Math.max(0, this.trauma - realDt * 1.6);
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, realDt * 2.5);

    if (this.mode === 'orbit' || this.mode === 'results') {
      const speed = this.mode === 'orbit' ? 0.07 : 0.05;
      this.orbitAngle += realDt * speed;
      const r = this.mode === 'orbit' ? this.orbitRadius : 3.9;
      const h = this.mode === 'orbit' ? this.orbitHeight + Math.sin(this.time * 0.23) * 0.35 : 1.7;
      _pos.set(Math.sin(this.orbitAngle) * r, h, Math.cos(this.orbitAngle) * r);
      const focus = opponent ? opponent.position : _look.set(0, 0, 0);
      _look.set(focus.x * 0.6, this.mode === 'orbit' ? 1.25 : 0.7, focus.z * 0.6);
      cam.position.copy(_pos);
      cam.lookAt(_look);
      _q.copy(cam.quaternion);
    } else {
      // --- Vue subjective ---
      _pos.copy(player.eye);
      _q.copy(player.cameraQuat);

      // Joueur KO : la caméra tombe au sol en regardant les projecteurs
      if (player.ko) {
        const k = Ease.inOutCubic(clamp(player.koTime / 1.15, 0, 1));
        _off.set(player.position.x, 0.32, player.position.z);
        _pos.lerp(_off, k);
        _e.set(lerp(player.pitch, 0.95, k), player.yaw + k * 0.3, lerp(0, 1.15, k));
        _q2.setFromEuler(_e);
        _q.slerp(_q2, k);
      }

      // Secousses et reculs (repère caméra)
      const tr = this.trauma * this.trauma;
      const n1 = Math.sin(this.time * 37.1) * 0.6 + Math.sin(this.time * 61.7) * 0.4;
      const n2 = Math.sin(this.time * 43.3 + 1.7) * 0.6 + Math.sin(this.time * 71.9) * 0.4;
      const n3 = Math.sin(this.time * 29.9 + 3.1) * 0.6 + Math.sin(this.time * 53.3) * 0.4;
      _e.set(
        this.kickPitch.value + tr * 0.05 * n1,
        this.kickYaw.value + tr * 0.05 * n2,
        this.kickRoll.value + tr * 0.06 * n3,
        'YXZ',
      );
      _q2.setFromEuler(_e);
      _q.multiply(_q2);
      _off.set(this.pushX.value * 0.05 + tr * 0.02 * n2, tr * 0.015 * n1, this.pushZ.value * 0.05).applyQuaternion(_q);
      _pos.add(_off);

      if (this.transition < 1 && this.from) {
        this.transition = Math.min(1, this.transition + realDt / this.transitionDuration);
        const k = Ease.inOutCubic(this.transition);
        _pos.lerpVectors(this.from.pos, _pos, k);
        _q.slerpQuaternions(this.from.quat, _q, k);
      }
      cam.position.copy(_pos);
      cam.quaternion.copy(_q);
    }

    const fov = this.baseFov + this.fovKick.value * 4 - this.zoom * 14;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
