/**
 * BoxerModel.js
 * ------------------------------------------------------------------
 * Modèle 3D procédural de l'adversaire (primitives Three.js, aucun fichier).
 *
 * Hiérarchie :
 *   root (position + orientation du Fighter)
 *    └ fall (pivot aux pieds, sert à la chute du KO)
 *       └ body (rebond, décalages)
 *          ├ pelvis → spine (torsion, inclinaison) → neck → head
 *          └ membres (bras, jambes) placés chaque frame par IK dans le repère « body »
 *
 * Tout est piloté par l'état logique du Fighter : position des poings (même
 * trajectoire que la détection des coups), décalages de tête des esquives,
 * réactions aux impacts, étourdissement, KO. Remplacer ce fichier par un
 * modèle riggé (glTF) ne demande que de reproduire `update()`.
 */

import {
  Group, Mesh, SphereGeometry, CapsuleGeometry, CylinderGeometry, LatheGeometry, BoxGeometry,
  MeshStandardMaterial, Vector2, Vector3, Quaternion, Color,
} from 'three';
import { createFist, disposeFist, FIST_WRIST_OFFSET } from './FistFactory.js';
import { solveTwoBone, placeBone, gloveQuaternion } from './Rig.js';
import { GameConfig } from '../config/GameConfig.js';
import { clamp, lerp, Ease, Spring, worldToLocal } from '../core/MathUtils.js';

const ST = GameConfig.stance;
const RISE = GameConfig.knockdown.riseDuration;
const PELVIS_Y = 0.9;
const SPINE_Y = 0.06;
const TORSO_TO_HEAD = 0.66; // distance taille → centre de la tête
const THIGH = 0.43;
const SHIN = 0.43;
const ANKLE_Y = 0.085;

const _v = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _w = new Vector3();
const _sh = new Vector3();
const _el = new Vector3();
const _wr = new Vector3();
const _pole = new Vector3();
const _F = new Vector3();
const _U = new Vector3();
const _F2 = new Vector3();
const _U2 = new Vector3();
const _qa = new Quaternion();
const _qb = new Quaternion();
const _tan = new Vector3();
const _hip = new Vector3();
const _knee = new Vector3();
const _foot = new Vector3();
const _local = new Vector3();

export class BoxerModel {
  constructor(profile) {
    this.root = new Group();
    this.root.name = `boxer-${profile.id}`;
    this.fall = new Group();
    this.body = new Group();
    this.root.add(this.fall);
    this.fall.add(this.body);
    this.materials = [];
    this.geometries = [];
    this.time = Math.random() * 10;
    this.stepPhase = 0;
    this.lastHitSerial = -1;
    // Ressorts des réactions aux coups
    this.headPitch = new Spring(160, 13);
    this.headYaw = new Spring(150, 12);
    this.headRoll = new Spring(150, 12);
    this.torsoPitch = new Spring(120, 12);
    this.torsoRoll = new Spring(120, 12);
    this.celebrate = 0;
    this._build(profile);
  }

  /* ================================================================
   * Construction
   * ================================================================ */

  _mat(params) {
    const m = new MeshStandardMaterial(params);
    this.materials.push(m);
    return m;
  }

  _geo(g) {
    this.geometries.push(g);
    return g;
  }

  _mesh(geo, mat, parent) {
    const m = new Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  _build(profile) {
    const look = profile.look || {};
    const build = look.build || 1;
    this.build = build;
    const skin = this._mat({ color: new Color(look.skin || '#c98d66'), roughness: 0.5, metalness: 0 });
    this.skinMat = skin;
    const shorts = this._mat({ color: new Color(look.shorts || '#1d4fd8'), roughness: 0.32, metalness: 0.18 });
    const trim = this._mat({ color: new Color(look.trim || '#f4f1e6'), roughness: 0.4, metalness: 0.1 });
    const shoes = this._mat({ color: new Color(look.shoes || '#f2f2f2'), roughness: 0.45, metalness: 0.05 });
    const sock = this._mat({ color: '#f4f2ec', roughness: 0.85 });
    const hair = this._mat({ color: new Color(look.hair || '#1a1210'), roughness: 0.9 });
    const dark = this._mat({ color: '#15100d', roughness: 0.6 });
    const white = this._mat({ color: '#f3efe6', roughness: 0.35 });

    // --- Bassin et short ---
    this.pelvis = new Group();
    this.body.add(this.pelvis);
    const shortsGeo = this._geo(new LatheGeometry([
      new Vector2(0.0, 0.07), new Vector2(0.16, 0.07), new Vector2(0.172, 0.0), new Vector2(0.188, -0.1),
      new Vector2(0.2, -0.2), new Vector2(0.206, -0.27),
    ], 22));
    const sh = this._mesh(shortsGeo, shorts, this.pelvis);
    sh.scale.set(1.18 * build, 1, 0.84 * build);
    const band = this._mesh(this._geo(new CylinderGeometry(0.166, 0.166, 0.065, 22)), trim, this.pelvis);
    band.scale.set(1.18 * build, 1, 0.84 * build);
    band.position.y = 0.05;
    for (const s of [-1, 1]) {
      const stripe = this._mesh(this._geo(new BoxGeometry(0.012, 0.3, 0.07)), trim, this.pelvis);
      stripe.position.set(s * 0.2 * build * 1.17, -0.11, 0);
      stripe.rotation.z = s * 0.06;
    }

    // --- Torse ---
    this.spine = new Group();
    this.spine.position.y = SPINE_Y;
    this.pelvis.add(this.spine);
    const torsoGeo = this._geo(new LatheGeometry([
      new Vector2(0.0, 0.0), new Vector2(0.13, 0.0), new Vector2(0.135, 0.08), new Vector2(0.142, 0.16),
      new Vector2(0.158, 0.26), new Vector2(0.176, 0.35), new Vector2(0.181, 0.41), new Vector2(0.16, 0.47),
      new Vector2(0.1, 0.51), new Vector2(0.0, 0.52),
    ], 24));
    const torso = this._mesh(torsoGeo, skin, this.spine);
    torso.scale.set(1.24 * build, 1, 0.78 * build);
    // Pectoraux et épaules
    for (const s of [-1, 1]) {
      const pec = this._mesh(this._geo(new SphereGeometry(1, 14, 10)), skin, this.spine);
      pec.scale.set(0.08 * build, 0.045, 0.022);
      pec.position.set(s * 0.076 * build, 0.375, -0.122 * build);
      const delt = this._mesh(this._geo(new SphereGeometry(0.068 * build, 14, 10)), skin, this.spine);
      delt.position.set(s * 0.205 * build, 0.445, 0);
      delt.scale.set(1, 1.05, 1.05);
    }
    const traps = this._mesh(this._geo(new SphereGeometry(1, 14, 8)), skin, this.spine);
    traps.scale.set(0.16 * build, 0.05, 0.08);
    traps.position.set(0, 0.49, 0.02);

    // --- Cou et tête ---
    this.neck = new Group();
    this.neck.position.set(0, 0.5, 0.005);
    this.spine.add(this.neck);
    const neckMesh = this._mesh(this._geo(new CylinderGeometry(0.058, 0.068, 0.15, 14)), skin, this.neck);
    neckMesh.position.y = 0.05;
    this.head = new Group();
    this.head.position.set(0, 0.13, -0.012);
    this.neck.add(this.head);
    this._buildHead(look, skin, hair, dark, white);

    // --- Bras ---
    this.arms = {};
    for (const hand of ['left', 'right']) {
      const upper = this._mesh(this._geo(new CapsuleGeometry(0.06 * build, ST.upperArm, 4, 12)), skin, this.body);
      const fore = this._mesh(this._geo(new CapsuleGeometry(0.052 * build, ST.forearm, 4, 12)), skin, this.body);
      const fist = createFist(hand, look.skin || '#c98d66', 1.03);
      this.body.add(fist);
      this.arms[hand] = {
        hand, side: hand === 'left' ? -1 : 1, upper, fore, fist,
        shoulderLocal: new Vector3((hand === 'left' ? -0.205 : 0.205) * build, 0.43, 0),
        pos: new Vector3(), quat: new Quaternion(),
        wrist: new Vector3(), pole: new Vector3(), // cibles IK du bras, dans le repère « body »
      };
    }

    // --- Jambes ---
    this.legs = {};
    for (const side of [-1, 1]) {
      const thigh = this._mesh(this._geo(new CapsuleGeometry(0.074 * build, THIGH, 4, 12)), skin, this.body);
      const shin = this._mesh(this._geo(new CapsuleGeometry(0.056 * build, SHIN, 4, 12)), skin, this.body);
      const boot = new Group();
      const shaft = this._mesh(this._geo(new CylinderGeometry(0.058, 0.06, 0.2, 14)), shoes, boot);
      shaft.position.y = 0.04;
      const foot = this._mesh(this._geo(new CapsuleGeometry(0.048, 0.17, 4, 10)), shoes, boot);
      foot.rotation.x = Math.PI / 2;
      foot.position.set(0, -0.045, -0.06);
      const sockBand = this._mesh(this._geo(new CylinderGeometry(0.058, 0.058, 0.04, 14)), sock, boot);
      sockBand.position.y = 0.155;
      this.body.add(boot);
      this.legs[side] = {
        side, thigh, shin, boot,
        hipLocal: new Vector3(side * 0.1 * build, -0.07, 0),
        // Garde orthodoxe : pied gauche devant
        stance: new Vector3(side * 0.15, ANKLE_Y, side < 0 ? -0.17 : 0.17),
        foot: new Vector3(), pole: new Vector3(), // cibles IK (repère « body »)
      };
    }

    // Petite ombre de contact sous les pieds (la vraie ombre vient du projecteur)
    this.root.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
  }

  _buildHead(look, skin, hair, dark, white) {
    const h = this.head;
    const skull = this._mesh(this._geo(new SphereGeometry(0.104, 22, 16)), skin, h);
    skull.scale.set(0.93, 1.1, 1.02);
    const jaw = this._mesh(this._geo(new SphereGeometry(0.082, 18, 12)), skin, h);
    jaw.scale.set(1, 0.74, 1);
    jaw.position.set(0, -0.062, -0.02);
    const nose = this._mesh(this._geo(new BoxGeometry(0.026, 0.045, 0.034)), skin, h);
    nose.position.set(0, -0.008, -0.104);
    nose.rotation.x = -0.25;
    for (const s of [-1, 1]) {
      const ear = this._mesh(this._geo(new SphereGeometry(0.03, 10, 8)), skin, h);
      ear.scale.set(0.42, 1, 0.75);
      ear.position.set(s * 0.098, -0.005, 0.005);
      const eye = this._mesh(this._geo(new SphereGeometry(0.0125, 10, 8)), dark, h);
      eye.position.set(s * 0.036, 0.012, -0.093);
      const glint = this._mesh(this._geo(new SphereGeometry(0.004, 6, 4)), white, h);
      glint.position.set(s * 0.036 + 0.004, 0.016, -0.104);
    }
    const brow = this._mesh(this._geo(new BoxGeometry(0.09, 0.014, 0.02)), look.hairStyle === 'buzz' ? skin : hair, h);
    brow.position.set(0, 0.036, -0.097);
    const mouth = this._mesh(this._geo(new BoxGeometry(0.04, 0.006, 0.01)), dark, h);
    mouth.position.set(0, -0.058, -0.098);
    // Protège-dents visible quand il souffle
    this.mouthguard = this._mesh(this._geo(new BoxGeometry(0.036, 0.012, 0.012)), white, h);
    this.mouthguard.position.set(0, -0.058, -0.096);
    this.mouthguard.visible = false;

    // Cheveux : calotte basculée vers l'arrière (front dégagé, nuque couverte)
    const style = look.hairStyle || 'crop';
    const capGeo = this._geo(new SphereGeometry(0.11, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5));
    const cap = this._mesh(capGeo, hair, h);
    cap.rotation.x = 0.5;
    cap.position.set(0, 0.018, 0.012);
    if (style === 'crop') cap.scale.set(0.98, 1.12, 1.07);
    else if (style === 'fade') {
      cap.scale.set(0.96, 1.05, 1.04);
      cap.position.y = 0.03;
      cap.rotation.x = 0.62;
    } else {
      cap.scale.set(0.955, 1.03, 1.02);
      cap.position.y = 0.024;
    }
    if (look.beard) {
      const beardGeo = this._geo(new SphereGeometry(0.086, 16, 8, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55));
      const beard = this._mesh(beardGeo, hair, h);
      beard.scale.set(1.04, 0.8, 1.04);
      beard.position.set(0, -0.06, -0.022);
    }
  }

  /* ================================================================
   * Animation
   * ================================================================ */

  /**
   * @param {number} dt temps de jeu
   * @param {import('../game/Fighter.js').Fighter} f
   * @param {{victory?: boolean}} state
   */
  update(dt, f, state = {}) {
    this.time += dt;
    const t = this.time;

    // Racine : position et orientation logiques
    this.root.position.copy(f.position);
    this.root.rotation.y = f.yaw;

    // Nouvel impact → impulsions dans les ressorts
    const hr = f.hitReact;
    if (hr.serial !== this.lastHitSerial) {
      this.lastHitSerial = hr.serial;
      if (hr.time < 0.25) this._onHit(hr, f);
    }
    for (const s of [this.headPitch, this.headYaw, this.headRoll, this.torsoPitch, this.torsoRoll]) s.update(dt);

    this.celebrate += ((state.victory ? 1 : 0) - this.celebrate) * Math.min(1, dt * 3);

    // --- KO : chute ---
    let ko = f.ko;
    let koT = ko ? f.koTime : 0;
    // Relevé après un knockdown : la chute rejouée à l'envers
    if (!ko && f.down && f.down.riseT < RISE) {
      ko = true;
      koT = 0.95 * (1 - f.down.riseT / RISE);
    }
    const buckle = ko ? Ease.outQuad(clamp(koT / 0.35, 0, 1)) : 0;
    const fallT = ko ? clamp((koT - 0.18) / 0.75, 0, 1) : 0;
    let fallAngle = ko ? Math.pow(fallT, 2.2) * (Math.PI / 2) * 0.96 : 0;
    if (ko && fallT >= 1) fallAngle += Math.sin(clamp((koT - 0.93) / 0.35, 0, 1) * Math.PI) * -0.06; // rebond
    if (ko) {
      worldToLocal(f.position, f.yaw, f.position.x + f.koDir.x, 0, f.position.z + f.koDir.z, _local);
      _local.y = 0;
      if (_local.lengthSq() < 1e-6) _local.set(0, 0, 1);
      _local.normalize();
      // Axe de rotation perpendiculaire à la direction de chute
      this.fall.quaternion.setFromAxisAngle(_v.set(_local.z, 0, -_local.x).normalize(), fallAngle);
      this.fall.position.y = Math.sin(fallAngle) * 0.12;
    } else {
      this.fall.quaternion.identity();
      this.fall.position.y = 0;
    }

    // --- Bassin : rebond sur les appuis, accroupissement ---
    const ho = f.headOffset;
    const bo = f.bodyOffset;
    const moving = clamp(f.moveSpeed / 2.4, 0, 1);
    const exhausted = f.stamina.isExhausted() ? 1 : 0;
    const bounceFreq = f.isStunned ? 1.1 : 1.8 + moving * 0.6;
    const bounce = ko ? 0 : Math.abs(Math.sin(t * Math.PI * bounceFreq)) * (0.014 + moving * 0.012) * (1 - exhausted * 0.6);
    const duck = f.dodge.type === 'duck' ? f.dodge.weight : 0;

    // Inclinaisons calculées pour que la tête visuelle suive la tête logique
    const relX = ho.x - bo.x;
    const relZ = ho.z - bo.z;
    const roll = Math.asin(clamp(relX / TORSO_TO_HEAD, -0.6, 0.6));
    let pitch = Math.asin(clamp(relZ / TORSO_TO_HEAD, -0.6, 0.6));
    pitch -= duck * 0.16;
    const leanDrop = TORSO_TO_HEAD * (1 - Math.cos(roll) * Math.cos(pitch));
    let pelvisY = PELVIS_Y + bo.y + (ho.y - bo.y) + leanDrop + bounce - buckle * 0.25 - (f.isStunned ? 0.05 : 0);
    pelvisY = Math.max(0.5, pelvisY);
    this.pelvis.position.set(bo.x, pelvisY, bo.z);

    // --- Torsion du buste selon les coups en cours ---
    let twist = -0.22; // garde de profil (épaule gauche devant)
    let lean = 0;
    for (const p of f.punches.list) {
      if (!p.active || !p.def) continue;
      const e = p.extension;
      const amt = p.def.kind === 'straight' ? (p.def.hand === 'right' ? 0.5 : 0.18) : p.def.kind === 'hook' ? 0.55 : 0.3;
      twist += p.side * amt * e;
      lean += (p.def.kind === 'uppercut' ? 0.05 : -0.1) * Math.max(0, e);
    }
    const breathe = Math.sin(t * (exhausted ? 5 : 2.2)) * (exhausted ? 0.012 : 0.006);
    this.spine.rotation.set(
      pitch + lean + this.torsoPitch.value - exhausted * 0.08 + breathe - buckle * 0.25,
      twist + this.torsoRoll.value * 0.3,
      -roll + this.torsoRoll.value,
    );
    this.spine.scale.set(1 + breathe * 0.5, 1, 1 + breathe);

    // --- Tête ---
    const stunWob = f.isStunned ? Math.sin(t * 5.5) * 0.18 : 0;
    this.head.rotation.set(
      this.headPitch.value + (exhausted ? 0.08 : 0) + buckle * 0.5,
      -twist * 0.6 + this.headYaw.value + stunWob * 0.5,
      this.headRoll.value + stunWob + roll * 0.4,
    );
    this.mouthguard.visible = exhausted > 0 || f.isStunned || ko;

    this.root.updateMatrixWorld(true);
    if (state.camera) {
      this.cameraLocal = this.cameraLocal || new Vector3();
      this.body.worldToLocal(this.cameraLocal.copy(state.camera));
    } else this.cameraLocal = null;

    // --- Bras ---
    for (const hand of ['left', 'right']) this._poseArm(this.arms[hand], f, koT, ko);

    // --- Jambes ---
    this._poseLegs(dt, f, buckle);

    // Transpiration : la peau brille quand il fatigue
    const sweat = 1 - f.stamina.ratio * 0.5 - (f.hp / f.maxHp) * 0.5;
    this.skinMat.roughness = lerp(0.52, 0.3, clamp(sweat, 0, 1));
  }

  _onHit(hr, f) {
    const s = hr.strength;
    if (hr.zone === 'body') {
      this.torsoPitch.impulse(-3.2 * s);
      this.headPitch.impulse(-1.2 * s);
      return;
    }
    if (hr.kind === 'hook') {
      this.headYaw.impulse(-hr.side * 6.5 * s);
      this.headRoll.impulse(hr.side * 3 * s);
      this.torsoRoll.impulse(hr.side * 1.2 * s);
    } else if (hr.kind === 'uppercut') {
      this.headPitch.impulse(7.5 * s);
      this.torsoPitch.impulse(2.2 * s);
    } else {
      this.headPitch.impulse(5 * s);
      this.headYaw.impulse((Math.random() - 0.5) * 2 * s);
      this.torsoPitch.impulse(1.4 * s);
    }
  }

  _poseArm(arm, f, koT, ko) {
    const punch = f.punches.hands[arm.hand];
    const side = arm.side;
    // Épaule (repère « body »)
    this.spine.localToWorld(_sh.copy(arm.shoulderLocal));
    this.body.worldToLocal(_sh);

    // Gant : position logique convertie dans le repère « body »
    f.punches.getGloveWorld(arm.hand, _w);
    this.body.worldToLocal(arm.pos.copy(_w));

    // Victoire : poings au-dessus de la tête
    if (this.celebrate > 0.001) {
      _a.set(side * 0.24, 2.0 + Math.sin(this.time * 7 + side) * 0.04, -0.05);
      arm.pos.lerp(_a, Ease.inOutCubic(this.celebrate));
    }
    // KO : bras ballants qui suivent la chute
    if (ko) {
      const limp = clamp(koT / 0.4, 0, 1);
      this.spine.localToWorld(_a.set(side * 0.42, 0.1 - limp * 0.15, -0.12));
      this.body.worldToLocal(_a);
      arm.pos.lerp(_a, limp);
    }

    // Un poing qui arrive dans l'objectif reste à distance (pas de poing « dans » la caméra)
    if (this.cameraLocal) {
      _a.copy(arm.pos).sub(this.cameraLocal);
      const d = _a.length();
      const minD = 0.34;
      if (d < minD && d > 1e-4) arm.pos.copy(this.cameraLocal).addScaledVector(_a, minD / d);
    }

    // Orientation : garde (paume vers l'intérieur) ↔ trajectoire du coup
    const g = f.guard.amount;
    _F.set(-side * 0.1, 0.5, -1).lerp(_F2.set(-side * 0.25, 1.3, -0.5), g).normalize();
    _U.set(side, 0.25, 0.15).lerp(_U2.set(side, -0.1, 0.5), g).normalize();
    gloveQuaternion(_F, _U, _qa);
    if (punch.active && punch.def && !ko) {
      const u = clamp(punch.phase === 'windup' ? 0.15 : punch.u, 0.05, 0.98);
      _tan.copy(punch.p1).sub(punch.p0).multiplyScalar(2 * (1 - u))
        .add(_v.copy(punch.p2).sub(punch.p1).multiplyScalar(2 * u));
      if (punch.def.kind === 'straight') _tan.copy(punch.p2).sub(punch.p0);
      // Direction monde → repère body (rotation seulement)
      _b.copy(_tan).applyQuaternion(_qb.copy(this.root.quaternion).invert());
      if (punch.def.kind === 'uppercut') _U.set(0, 0.25, -1).normalize();
      else if (punch.def.kind === 'hook') _U.set(0, 1, 0.25).normalize();
      else _U.set(0, 1, 0);
      gloveQuaternion(_b, _U, _qb);
      _qa.slerp(_qb, clamp(punch.extension * 1.5, 0, 1));
    }
    if (this.celebrate > 0.001) {
      gloveQuaternion(_F.set(0, 1, 0.1), _U.set(-side * 0.2, 0, 1), _qb);
      _qa.slerp(_qb, this.celebrate);
    }
    arm.quat.copy(_qa);
    arm.fist.position.copy(arm.pos);
    arm.fist.quaternion.copy(arm.quat);

    // IK épaule → coude → poignet
    _wr.set(0, 0, FIST_WRIST_OFFSET * 1.03).applyQuaternion(arm.quat).add(arm.pos);
    const hookW = punch.active && punch.def && punch.def.kind === 'hook' ? clamp(punch.extension * 1.5, 0, 1) : 0;
    _pole.copy(_sh).add(_v.set(side * (0.35 + hookW * 0.35), -0.6 + hookW * 0.55, 0.25));
    arm.wrist.copy(_wr);
    arm.pole.copy(_pole);
    solveTwoBone(_sh, _wr, ST.upperArm, ST.forearm, _pole, _el);
    placeBone(arm.upper, _sh, _el, ST.upperArm);
    placeBone(arm.fore, _el, _wr, ST.forearm);
  }

  _poseLegs(dt, f, buckle) {
    // Cycle de pas proportionnel à la vitesse
    const speed = f.moveSpeed;
    this.stepPhase += speed * dt * 5.2;
    const k = clamp(speed / 1.8, 0, 1);
    // Vitesse dans le repère local
    const c = Math.cos(f.yaw);
    const s = Math.sin(f.yaw);
    const vx = f.velocity.x * c - f.velocity.z * s;
    const vz = f.velocity.x * s + f.velocity.z * c;
    const vlen = Math.hypot(vx, vz) || 1;

    for (const side of [-1, 1]) {
      const leg = this.legs[side];
      this.pelvis.localToWorld(_hip.copy(leg.hipLocal));
      this.body.worldToLocal(_hip);
      const ph = this.stepPhase + (side < 0 ? 0 : Math.PI);
      const swing = Math.sin(ph) * 0.13 * k;
      const lift = Math.max(0, Math.cos(ph)) * 0.06 * k;
      _foot.copy(leg.stance);
      _foot.x += (vx / vlen) * swing;
      _foot.z += (vz / vlen) * swing;
      _foot.y = ANKLE_Y + lift;
      if (buckle > 0) {
        _foot.x += side * 0.06 * buckle;
      }
      _pole.copy(_hip).add(_v.set(side * 0.08, -0.3, -0.7));
      leg.foot.copy(_foot);
      leg.pole.copy(_pole);
      solveTwoBone(_hip, _foot, THIGH, SHIN, _pole, _knee);
      placeBone(leg.thigh, _hip, _knee, THIGH);
      placeBone(leg.shin, _knee, _foot, SHIN);
      leg.boot.position.copy(_foot);
      leg.boot.rotation.set(0, side * 0.25 + (side < 0 ? -0.3 : 0.35), 0);
    }
  }

  dispose() {
    for (const arm of Object.values(this.arms)) disposeFist(arm.fist);
    for (const m of this.materials) m.dispose();
    for (const g of this.geometries) g.dispose();
    if (this.root.parent) this.root.parent.remove(this.root);
  }
}
