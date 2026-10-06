/**
 * Player.js
 * ------------------------------------------------------------------
 * Le boxeur contrôlé au clavier et à la souris, en vue subjective.
 *  - la souris oriente le regard (yaw / pitch) et donc la visée ;
 *  - viser plus bas que le menton envoie les coups au corps ;
 *  - garde + regard vers le bas = garde basse (protège le corps) ;
 *  - Maj + direction = esquive (côté, recul, tête baissée).
 */

import { Vector3, Quaternion, Euler } from 'three';
import { Fighter } from './Fighter.js';
import { GameConfig } from '../config/GameConfig.js';
import { PUNCH_ACTIONS } from '../config/Controls.js';
import { PUNCHES } from '../config/Punches.js';
import { clamp, lerp, wrapAngle, yawFromDirection } from '../core/MathUtils.js';
import { commandFromInput, pressedMask, emptyCommand } from '../net/Command.js';

const CAM = GameConfig.camera;
const AIM = GameConfig.aim;
const VM = GameConfig.viewmodel;

const _look = { x: 0, y: 0 };
const _cmd = emptyCommand();
const _fwd = new Vector3();

export class Player extends Fighter {
  constructor(opts) {
    super({ ...opts, isPlayer: true });
    this.eye = new Vector3();
    this.cameraQuat = new Quaternion();
    this._euler = new Euler(0, 0, 0, 'YXZ');
    this.sensitivity = 1;
    this.invertY = false;
    this.aimAssist = true;
    // Cône de ciblage des coups. null = selon l'aide à la visée (solo). En ligne,
    // une valeur commune aux deux boxeurs (règle du combat, pas un réglage local).
    this.targetCone = null;
    this.target = new Vector3();
    this.pendingDuck = -1; // Maj seule : on attend une éventuelle direction
    this.lookLocked = false; // présentation du round : on reste face à l'adversaire
    // Informations de visée pour le réticule du HUD
    this.aim = { zone: 'head', onTarget: false, inRange: false };
  }

  /** Repère caméra : œil = centre de la tête, orientation yaw/pitch/roulis. */
  updateFrame() {
    this.eye.copy(this.zones.head);
    this._euler.set(this.pitch, this.yaw, -this.roll, 'YXZ');
    this.cameraQuat.setFromEuler(this._euler);
  }

  /**
   * Lit les entrées et les convertit en intentions (mode solo).
   * La souris oriente le regard tout de suite ; le reste passe par une commande,
   * exactement comme en ligne (voir applyCommand).
   * @param {import('../core/Input.js').Input} input
   * @param {number} dt temps réel (la visée n'est pas ralentie par les ralentis)
   */
  handleInput(input, dt) {
    this.updateView(input, dt, this);
    this._updateAimInfo();
    const cmd = commandFromInput(input, this.yaw, this.pitch, pressedMask(input), _cmd);
    this.applyCommand(cmd, dt);
  }

  /**
   * Regard à la souris (+ aide à la visée) appliqué à `view` ({ yaw, pitch }) :
   * le boxeur lui-même en solo, une vue locale en ligne.
   */
  updateView(input, dt, view) {
    input.consumeLook(_look); // toujours consommé : rien ne s'accumule pendant un verrouillage
    const sens = CAM.baseSensitivity * this.sensitivity;
    if (!this.ko && !this.lookLocked) {
      view.yaw -= _look.x * sens;
      view.pitch -= _look.y * sens * (this.invertY ? -1 : 1);
      view.yaw -= input.edgeTurn() * 2.4 * dt;
      view.pitch = clamp(view.pitch, CAM.pitchMin, CAM.pitchMax);
    }
    // --- Aide à la visée : rotation douce vers l'adversaire ---
    const opp = this.opponent;
    if (this.aimAssist && opp && !opp.ko && !this.frozen) {
      const mx = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
      const dx = opp.position.x - this.position.x;
      const dz = opp.position.z - this.position.z;
      const err = wrapAngle(yawFromDirection(dx, dz) - view.yaw);
      if (Math.abs(err) < AIM.softLockCone) {
        const strength = AIM.softLockStrength * (mx !== 0 ? 1 : 0.45) * (input.fallbackMode ? 2 : 1);
        view.yaw += err * (1 - Math.exp(-strength * dt));
      }
    }
  }

  /**
   * Applique une commande (voir net/Command.js). Déterministe : en ligne, les
   * deux navigateurs l'appliquent au même tick avec les mêmes valeurs.
   */
  applyCommand(c, dt) {
    if (!this.ko && !this.lookLocked) {
      this.yaw = c.yaw;
      this.pitch = clamp(c.pitch, CAM.pitchMin, CAM.pitchMax);
    }

    if (this.frozen || this.ko) {
      this.setMoveInput(0, 0);
      this.setGuard(false);
      this.pendingDuck = -1;
      return;
    }

    let mx = c.mx;
    let mz = c.mz;

    // --- Esquives ---
    const dodgeHeld = c.dodgeHeld;
    if (c.duck) {
      this.tryDodge('duck');
    } else if (c.dodge || (dodgeHeld && c.dirPressed)) {
      if (mx !== 0) this.tryDodge('slip', mx);
      else if (mz < 0) this.tryDodge('pullback');
      else if (mz > 0) this.tryDodge('duck');
      else this.pendingDuck = 0.09; // laisse le temps d'appuyer sur une direction
    }
    if (this.pendingDuck >= 0) {
      if (mx !== 0) {
        this.tryDodge('slip', mx);
        this.pendingDuck = -1;
      } else if (mz < 0) {
        this.tryDodge('pullback');
        this.pendingDuck = -1;
      } else {
        this.pendingDuck -= dt;
        if (this.pendingDuck < 0 || mz > 0) {
          this.tryDodge('duck');
          this.pendingDuck = -1;
        }
      }
    }
    // Pendant qu'on maintient Maj, les directions servent à esquiver, pas à marcher
    if (dodgeHeld) {
      mx *= 0.4;
      mz *= 0.4;
    }

    this.setMoveInput(mx, mz);

    // --- Garde (regarder vers le bas = garde basse) ---
    this.setGuard(c.guard, c.guard && this.pitch < -0.27);

    // --- Coups ---
    for (let i = 0; i < PUNCH_ACTIONS.length; i++) {
      if (c.punches & (1 << i)) this.tryPunch(PUNCH_ACTIONS[i]);
    }
  }

  /** Met à jour l'indicateur de visée (zone visée, adversaire à portée). */
  _updateAimInfo() {
    const opp = this.opponent;
    if (!opp) return;
    const dx = opp.position.x - this.position.x;
    const dz = opp.position.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    const err = Math.abs(wrapAngle(yawFromDirection(dx, dz) - this.yaw));
    const cone = this.targetCone != null ? this.targetCone : this.aimAssist ? AIM.assistCone : AIM.noAssistCone;
    this.aim.onTarget = err <= cone && !opp.ko;
    this.aim.inRange = dist <= PUNCHES.cross.reach + 0.22;
    this.aim.zone = this._zoneFromPitch(dist);
  }

  _zoneFromPitch(dist) {
    const opp = this.opponent;
    const d = Math.max(0.4, dist);
    const pitchHead = Math.atan2(opp.zones.head.y - this.eye.y, d);
    const bodyY = (opp.zones.chest.y + opp.zones.belly.y) / 2;
    const pitchBody = Math.atan2(bodyY - this.eye.y, d);
    const switchPitch = lerp(pitchHead, pitchBody, AIM.bodyPitchBias);
    return this.pitch < switchPitch ? 'body' : 'head';
  }

  aimYaw() {
    return this.yaw;
  }

  /** Les gants au repos suivent la caméra (vue FPS). */
  getHandRestWorld(hand, out) {
    const r = VM.rest[hand];
    const g = VM.guard[hand];
    const ga = this.guard.amount;
    const low = this.guard.lowBlend * ga;
    let x = lerp(r[0], g[0], ga);
    let y = lerp(r[1], g[1], ga);
    let z = lerp(r[2], g[2], ga);
    // Garde basse : les gants descendent devant le ventre
    x *= 1 - low * 0.15;
    y -= low * 0.2;
    z -= low * 0.02;
    if (this.isStunned) y -= 0.12;
    return out.set(x, y, z).applyQuaternion(this.cameraQuat).add(this.eye);
  }

  /**
   * Choisit le point visé : si l'adversaire est dans le cône de visée, le coup
   * part vers sa tête ou son corps selon l'inclinaison du regard ; sinon il
   * part droit devant (et risque de finir dans le vide).
   */
  resolvePunchTarget(def, zone) {
    const opp = this.opponent;
    const dx = opp.position.x - this.position.x;
    const dz = opp.position.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    const err = Math.abs(wrapAngle(yawFromDirection(dx, dz) - this.yaw));
    const cone = this.targetCone != null ? this.targetCone : this.aimAssist ? AIM.assistCone : AIM.noAssistCone;

    if (err <= cone && !opp.ko) {
      const z = zone || this._zoneFromPitch(dist);
      if (z === 'head') this.target.copy(opp.zones.head);
      else this.target.copy(opp.zones.chest).lerp(opp.zones.belly, 0.45);
      return { zone: z, point: this.target, hasTarget: true };
    }

    _fwd.set(0, 0, -1).applyQuaternion(this.cameraQuat);
    this.target.copy(this.eye).addScaledVector(_fwd, def.reach + 0.35);
    return { zone: this.pitch < -0.2 ? 'body' : 'head', point: this.target, hasTarget: false };
  }
}
