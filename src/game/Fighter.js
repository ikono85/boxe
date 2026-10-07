/**
 * Fighter.js
 * ------------------------------------------------------------------
 * Logique commune à tous les boxeurs (joueur et IA) : vie, endurance,
 * déplacement, garde, esquives, étourdissement, KO, volumes d'impact.
 *
 * Un Fighter ne sait rien du rendu : il expose son état (position, offsets
 * de tête et de corps, garde, coups en cours…) que les modèles 3D lisent.
 * Les contrôleurs (Player = clavier/souris, AI = cerveau) ne font que poser
 * des intentions : setMoveInput, setGuard, tryPunch, tryDodge.
 */

import { Vector3 } from 'three';
import { GameConfig, ringBound } from '../config/GameConfig.js';
import { StaminaSystem } from '../combat/StaminaSystem.js';
import { PunchSystem } from '../combat/PunchSystem.js';
import { FighterStats } from './MatchStats.js';
import { random } from '../core/Random.js';
import { clamp, damp, Ease, localToWorld, forwardFromYaw, rightFromYaw } from '../core/MathUtils.js';

const FC = GameConfig.fighter;
const DC = GameConfig.dodge;
const SC = GameConfig.stun;
const CC = GameConfig.combat;
const RC = GameConfig.ring;
const KD = GameConfig.knockdown;

const _fwd = new Vector3();
const _right = new Vector3();
const _target = new Vector3();

export class Fighter {
  constructor({ id, profile, events, isPlayer = false }) {
    this.id = id;
    this.isPlayer = isPlayer;
    this.events = events;
    this.profile = profile;
    this.stats = { ...profile.stats };
    this.name = profile.name;

    this.position = new Vector3();
    this.velocity = new Vector3();
    this.knockVel = new Vector3(); // impulsions (coups reçus, cordes, esquive arrière)
    this.yaw = 0;
    this.pitch = 0;
    this.moveInput = { x: 0, z: 0 };
    this.moveSpeed = 0;
    this.frozen = false; // pas de déplacement ni d'action (intro de round, pause…)

    this.maxHp = FC.maxHp;
    this.hp = this.maxHp;
    this.stamina = new StaminaSystem(this.stats.staminaMax || FC.maxStamina, this.stats.staminaRegen || 1);
    this.punches = new PunchSystem(this, events);
    this.windupMultiplier = 1; // l'IA « télégraphie » plus ou moins ses coups

    this.guard = { intent: false, low: false, amount: 0, lowBlend: 0, brokenTimer: 0 };
    this.dodge = { type: null, dir: 0, phase: 'none', time: 0, cooldown: 0, def: null, weight: 0, evaded: false };
    this.stun = { meter: 0, timer: 0, idle: 0, immunity: 0 };
    this.flinchTimer = 0;
    this.counterWindow = 0;
    this.lastWhiffTime = -10;
    this.ko = false;
    this.koTime = 0;
    this.koDir = new Vector3(0, 0, 1);
    // Knockdown : compte de l'arbitre, relevé (voir RoundSystem)
    this.knockdowns = 0;
    this.down = { counting: false, meter: 0, need: 0, riseAt: 0, riseT: 10 };
    this.autoRise = !isPlayer; // l'IA décide seule ; le joueur martèle ses coups
    // Déplacement automatique (vers le coin neutre pendant un compte)
    this.walkTo = new Vector3();
    this.walking = false;
    this.time = 0;
    this.opponent = null;
    this.currentRound = 0; // index du round en cours (statistiques)

    // Décalages logiques (repère local : x droite, y haut, z arrière)
    this.headOffset = new Vector3();
    this.bodyOffset = new Vector3();
    this.roll = 0; // inclinaison latérale (esquive)
    this.headForward = isPlayer ? 0 : -0.03;

    // Infos pour les animations de réaction
    this.hitReact = { time: 10, zone: 'head', kind: 'straight', side: 0, strength: 0, dir: new Vector3(), blocked: false, serial: 0 };
    this.ropeContact = { axis: null, sign: 0, depth: 0, along: 0 };

    // Volumes d'impact (mis à jour chaque frame)
    this.zones = {
      head: new Vector3(),
      chest: new Vector3(),
      belly: new Vector3(),
      guardHigh: new Vector3(),
      guardLow: new Vector3(),
    };

    this.matchStats = new FighterStats();
  }

  /* ================================================================
   * Réinitialisation
   * ================================================================ */

  reset(position, yaw) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.knockVel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.moveInput.x = 0;
    this.moveInput.z = 0;
    this.hp = this.maxHp;
    this.stamina.reset();
    this.punches.reset();
    Object.assign(this.guard, { intent: false, low: false, amount: 0, lowBlend: 0, brokenTimer: 0 });
    Object.assign(this.dodge, { type: null, dir: 0, phase: 'none', time: 0, cooldown: 0, def: null, weight: 0, evaded: false });
    Object.assign(this.stun, { meter: 0, timer: 0, idle: 0, immunity: 0 });
    this.flinchTimer = 0;
    this.counterWindow = 0;
    this.lastWhiffTime = -10;
    this.ko = false;
    this.koTime = 0;
    this.knockdowns = 0;
    Object.assign(this.down, { counting: false, meter: 0, need: 0, riseAt: 0, riseT: 10 });
    this.walking = false;
    this.headOffset.set(0, 0, 0);
    this.bodyOffset.set(0, 0, 0);
    this.roll = 0;
    this.hitReact.time = 10;
    this.ropeContact.depth = 0;
    this.updateHurtZones();
    this.updateFrame();
  }

  /** Replace le boxeur (début de round) sans toucher à la vie / l'endurance. */
  placeAt(position, yaw) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.knockVel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.punches.reset();
    this.guard.intent = false;
    this.guard.amount = 0;
    Object.assign(this.dodge, { type: null, dir: 0, phase: 'none', time: 0, cooldown: 0, def: null, weight: 0, evaded: false });
    this.stun.timer = 0;
    this.stun.meter = 0;
    this.flinchTimer = 0;
    this.walking = false;
    this.headOffset.set(0, 0, 0);
    this.bodyOffset.set(0, 0, 0);
    this.roll = 0;
    this.updateHurtZones();
    this.updateFrame();
  }

  /* ================================================================
   * Intentions (appelées par Player / AI)
   * ================================================================ */

  setMoveInput(x, z) {
    this.moveInput.x = x;
    this.moveInput.z = z;
  }

  setGuard(active, low = false) {
    this.guard.intent = active;
    this.guard.low = low;
  }

  tryPunch(type, zone = null) {
    if (this.frozen) return 'rejected';
    return this.punches.request(type, zone);
  }

  /**
   * Esquive : 'slip' (dir -1 gauche / +1 droite), 'duck' ou 'pullback'.
   * Retourne true si l'esquive démarre.
   */
  tryDodge(type, dir = 0) {
    if (this.frozen || !this.canAct()) return false;
    const d = this.dodge;
    if (d.phase !== 'none' || d.cooldown > 0) return false;
    if (this.punches.isCommitted()) return false;
    const def = DC[type];
    if (!def) return false;
    if (this.stamina.value < def.cost * DC.minStaminaRatio) {
      if (this.events) this.events.emit('dodge:fail', { fighter: this });
      return false;
    }
    this.stamina.spend(def.cost);
    d.type = type;
    d.dir = type === 'slip' ? (dir >= 0 ? 1 : -1) : 0;
    d.phase = 'in';
    d.time = 0;
    d.def = def;
    d.evaded = false;

    forwardFromYaw(this.yaw, _fwd);
    rightFromYaw(this.yaw, _right);
    if (type === 'pullback') this.knockVel.addScaledVector(_fwd, -def.dash);
    if (type === 'slip') this.knockVel.addScaledVector(_right, d.dir * 0.7);

    if (this.events) this.events.emit('dodge:start', { fighter: this, type, dir: d.dir });
    return true;
  }

  /* ================================================================
   * État
   * ================================================================ */

  get isStunned() {
    return this.stun.timer > 0;
  }

  get isGuarding() {
    return this.guard.amount >= CC.guardBlockThreshold;
  }

  get isDodging() {
    return this.dodge.phase !== 'none';
  }

  canAct() {
    return !this.ko && !this.frozen && this.stun.timer <= 0 && this.flinchTimer <= 0;
  }

  canPunch() {
    return this.canAct() && this.dodge.phase !== 'in';
  }

  /* ================================================================
   * Mise à jour
   * ================================================================ */

  update(dt) {
    this.time += dt;
    if (this.down.riseT < 10) this.down.riseT += dt;

    if (this.ko) {
      this.koTime += dt;
      this.velocity.multiplyScalar(Math.exp(-6 * dt));
      this.knockVel.multiplyScalar(Math.exp(-4 * dt));
      this.position.addScaledVector(this.knockVel, dt);
      this._applyRingBounds(dt);
      this.guard.amount = Math.max(0, this.guard.amount - 4 * dt);
      this.punches.update(dt);
      this.updateHurtZones();
      this.updateFrame();
      return;
    }

    this._updateTimers(dt);
    this._updateGuard(dt);
    this._updateDodge(dt);
    this._updateMovement(dt);
    this._applyRingBounds(dt);
    this._updateStamina(dt);
    this.updateHurtZones();
    this.updateFrame();
    this.punches.update(dt);
  }

  _updateTimers(dt) {
    if (this.flinchTimer > 0) this.flinchTimer -= dt;
    if (this.counterWindow > 0) this.counterWindow -= dt;
    if (this.hitReact.time < 10) this.hitReact.time += dt;

    const s = this.stun;
    if (s.immunity > 0) s.immunity -= dt;
    if (s.timer > 0) {
      s.timer -= dt;
      if (s.timer <= 0 && this.events) this.events.emit('fighter:recovered', { fighter: this });
    } else {
      s.idle += dt;
      if (s.idle > SC.decayDelay) s.meter = Math.max(0, s.meter - SC.decayRate * dt);
    }
  }

  _updateGuard(dt) {
    const g = this.guard;
    if (g.brokenTimer > 0) g.brokenTimer -= dt;
    let target = g.intent && g.brokenTimer <= 0 && !this.isStunned && this.flinchTimer <= 0 && !this.frozen ? 1 : 0;
    if (this.punches.isActive()) target = Math.min(target, 0.3);
    if (this.dodge.phase !== 'none') target = Math.min(target, 0.45);
    const speed = target > g.amount ? FC.guardRaiseSpeed : FC.guardLowerSpeed;
    if (g.amount < target) g.amount = Math.min(target, g.amount + speed * dt);
    else g.amount = Math.max(target, g.amount - speed * dt);
    g.lowBlend = damp(g.lowBlend, g.low ? 1 : 0, 14, dt);
  }

  _updateDodge(dt) {
    const d = this.dodge;
    if (d.cooldown > 0) d.cooldown -= dt;
    let w = 0;
    if (d.phase !== 'none') {
      d.time += dt;
      const def = d.def;
      if (d.phase === 'in') {
        w = Ease.outCubic(clamp(d.time / def.in, 0, 1));
        if (d.time >= def.in) {
          d.phase = 'hold';
          d.time -= def.in;
        }
      } else if (d.phase === 'hold') {
        w = 1;
        if (d.time >= def.hold) {
          d.phase = 'out';
          d.time -= def.hold;
        }
      } else if (d.phase === 'out') {
        w = 1 - Ease.inOutQuad(clamp(d.time / def.out, 0, 1));
        if (d.time >= def.out) {
          d.phase = 'none';
          d.cooldown = DC.cooldown;
          w = 0;
        }
      }
    }
    d.weight = w;

    const o = d.def ? d.def.offset : null;
    const sx = d.type === 'slip' ? d.dir : 1;
    if (o) {
      this.headOffset.set(o[0] * sx * w, o[1] * w, o[2] * w);
      const k = d.def.bodyShift / Math.max(0.01, Math.hypot(o[0], o[1], o[2]));
      this.bodyOffset.set(o[0] * sx * w * k, o[1] * w * k, o[2] * w * k);
      this.roll = d.def.roll * sx * w;
    } else {
      this.headOffset.set(0, 0, 0);
      this.bodyOffset.set(0, 0, 0);
      this.roll = 0;
    }

    // Boxeur sonné : la tête titube
    if (this.isStunned) {
      const t = this.time;
      this.headOffset.x += Math.sin(t * 3.1) * 0.06;
      this.headOffset.y += -0.05 + Math.sin(t * 4.3) * 0.015;
      this.headOffset.z += Math.cos(t * 2.3) * 0.03;
      this.roll += Math.sin(t * 3.1) * 0.08;
    }
  }

  _updateMovement(dt) {
    let mx = this.frozen ? 0 : this.moveInput.x;
    let mz = this.frozen ? 0 : this.moveInput.z;
    if (this.walking) {
      // Marche imposée (coin neutre) : direction monde → repère local
      const dx = this.walkTo.x - this.position.x;
      const dz = this.walkTo.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.06) {
        mx = 0;
        mz = 0;
      } else {
        forwardFromYaw(this.yaw, _fwd);
        rightFromYaw(this.yaw, _right);
        const k = Math.min(1, d * 2.2) / d;
        mx = (dx * _right.x + dz * _right.z) * k;
        mz = (dx * _fwd.x + dz * _fwd.z) * k;
      }
    }
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    let factor = 1;
    if (this.guard.amount > 0.5) factor *= FC.guardMoveFactor;
    if (this.punches.isCommitted()) factor *= FC.punchMoveFactor;
    if (this.isStunned) factor *= FC.stunMoveFactor;
    if (this.stamina.isExhausted()) factor *= FC.exhaustedMoveFactor;
    if (this.flinchTimer > 0) factor *= 0.35;
    if (this.dodge.phase !== 'none') factor *= 0.35;

    forwardFromYaw(this.yaw, _fwd);
    rightFromYaw(this.yaw, _right);
    const vx = mx * FC.strafeSpeed * factor;
    const vz = mz * (mz > 0 ? FC.forwardSpeed : FC.backSpeed) * factor;
    _target.set(0, 0, 0).addScaledVector(_right, vx).addScaledVector(_fwd, vz);

    const k = 1 - Math.exp(-FC.acceleration * dt);
    this.velocity.x += (_target.x - this.velocity.x) * k;
    this.velocity.z += (_target.z - this.velocity.z) * k;
    this.knockVel.multiplyScalar(Math.exp(-6 * dt));

    this.position.x += (this.velocity.x + this.knockVel.x) * dt;
    this.position.z += (this.velocity.z + this.knockVel.z) * dt;
    this.moveSpeed = Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** Limites du ring « souples » : le boxeur s'enfonce un peu dans les cordes puis rebondit. */
  _applyRingBounds(dt) {
    const B = ringBound();
    const soft = RC.ropeSoftZone;
    const rc = this.ropeContact;
    rc.depth = 0;
    for (const axis of ['x', 'z']) {
      const v = this.position[axis];
      const a = Math.abs(v);
      if (a <= B) continue;
      const sign = Math.sign(v);
      let depth = a - B;
      if (depth > soft) {
        this.position[axis] = sign * (B + soft);
        depth = soft;
        if (this.velocity[axis] * sign > 0) this.velocity[axis] = 0;
        if (this.knockVel[axis] * sign > 0) this.knockVel[axis] = 0;
      }
      this.knockVel[axis] -= sign * depth * RC.ropeStiffness * dt;
      if (this.velocity[axis] * sign > 0) this.velocity[axis] *= Math.exp(-7 * dt);
      if (depth > rc.depth) {
        rc.axis = axis;
        rc.sign = sign;
        rc.depth = depth;
        rc.along = axis === 'x' ? this.position.z : this.position.x;
      }
    }
  }

  _updateStamina(dt) {
    let activity = 'idle';
    if (this.punches.isActive() || this.dodge.phase !== 'none') activity = 'busy';
    else if (this.guard.amount > 0.5) activity = 'guarding';
    else if (this.moveSpeed > 0.4) activity = 'moving';
    this.stamina.update(dt, activity);
  }

  /** Volumes d'impact dans le monde. */
  updateHurtZones() {
    const p = this.position;
    const yaw = this.yaw;
    const h = this.headOffset;
    const b = this.bodyOffset;
    const z = this.zones;
    localToWorld(p, yaw, h.x, FC.headHeight + h.y, this.headForward + h.z, z.head);
    localToWorld(p, yaw, b.x, CC.chestHeight + b.y, -0.02 + b.z, z.chest);
    localToWorld(p, yaw, b.x * 0.6, CC.bellyHeight + b.y * 0.7, -0.02 + b.z * 0.6, z.belly);
    localToWorld(p, yaw, h.x * 0.8, FC.headHeight - 0.04 + h.y, this.headForward - CC.guardSphereForward + h.z, z.guardHigh);
    localToWorld(p, yaw, b.x, 1.18 + b.y, -0.17 + b.z, z.guardLow);
  }

  /** Recalcule le repère de visée (surchargé par Player). */
  updateFrame() {}

  /* ================================================================
   * Combat
   * ================================================================ */

  onPunchStart(punch) {
    const s = this.matchStats;
    s.thrown++;
    s.thrownByType[punch.def.id]++;
    s.round(this.currentRound).thrown++;
  }

  /**
   * Applique un impact calculé par le CombatSystem.
   * hit = { damage, staminaDamage, stun, flinch, knockback, dir, zone, blocked, crit, punch }
   */
  applyHit(hit) {
    if (this.ko) return;
    this.hp = Math.max(0, this.hp - hit.damage);
    this.stamina.drain(hit.staminaDamage, hit.zone === 'body' && !hit.blocked);
    this.knockVel.addScaledVector(hit.dir, hit.knockback);

    const r = this.hitReact;
    r.time = 0;
    r.zone = hit.zone;
    r.kind = hit.punch.def.kind;
    r.side = hit.punch.side;
    r.strength = hit.blocked ? 0.35 : hit.crit ? 1.6 : 1;
    r.dir.copy(hit.dir);
    r.blocked = hit.blocked;
    r.serial++;

    if (hit.blocked) {
      this.flinchTimer = Math.max(this.flinchTimer, hit.flinch * 0.35);
    } else {
      this.flinchTimer = Math.max(this.flinchTimer, hit.flinch * FC.flinchScale);
      this.punches.interruptWindups();
      this.punches.resetChain();
      if (hit.stun > 0) this.addStun(hit.stun);
    }

    if (this.hp <= 0) this.knockOut(hit.dir);
  }

  addStun(amount) {
    const s = this.stun;
    if (s.timer > 0 || this.ko) return;
    if (s.immunity > 0) amount *= SC.immunityFactor;
    s.meter += amount / (this.stats.chin || 1);
    s.idle = 0;
    if (s.meter >= SC.threshold) {
      s.timer = SC.duration / Math.sqrt(this.stats.chin || 1);
      s.meter = SC.resetValue;
      s.immunity = s.timer + SC.immunityDuration;
      this.punches.cancelAll();
      this.dodge.phase = 'none';
      if (this.events) this.events.emit('fighter:stunned', { fighter: this });
    }
  }

  /**
   * Au tapis (vie à zéro). L'arbitre compte (RoundSystem) : le boxeur se
   * relève, ou c'est le KO. Le KO définitif est décidé par le RoundSystem.
   */
  knockOut(dir) {
    this.ko = true;
    this.hp = 0;
    this.koTime = 0;
    this.koDir.copy(dir).setY(0);
    if (this.koDir.lengthSq() < 1e-6) this.koDir.set(0, 0, 1);
    this.koDir.normalize();
    this.punches.cancelAll();
    this.guard.intent = false;
    this.dodge.phase = 'none';
    this.knockVel.addScaledVector(this.koDir, 1.2);

    this.knockdowns++;
    const i = Math.min(this.knockdowns, 3) - 1;
    const D = this.down;
    D.counting = false;
    D.meter = 0;
    D.riseT = 10;
    D.need = KD.mashNeed[i];
    // Relevé automatique (IA) : à quel compte, ou pas du tout (tirage commun aux deux joueurs en ligne)
    const chin = this.stats.chin || 1;
    const stay = [0.06, 0.25, 0.55][i] / chin;
    const r1 = random();
    const r2 = random();
    D.riseAt = r1 < stay ? 99 : Math.min(9, Math.round(2 + i * 1.6 + r2 * 3.5));
    this.matchStats.downs++;
    this.matchStats.round(this.currentRound).downs++;
    if (this.events) this.events.emit('fighter:down', { fighter: this, knockdowns: this.knockdowns });
  }

  /** Se relève après un knockdown (appelé par le RoundSystem pendant le compte). */
  getUp() {
    if (!this.ko) return;
    const i = Math.min(this.knockdowns, 3) - 1;
    const chin = this.stats.chin || 1;
    this.ko = false;
    this.koTime = 0;
    this.down.counting = false;
    this.down.meter = 0;
    this.down.riseT = 0;
    this.hp = Math.min(this.maxHp, Math.max(1, Math.round(this.maxHp * KD.hpAfter[i] * Math.min(1.15, Math.sqrt(chin)))));
    if (this.stamina.ratio < 0.5) this.stamina.recover(0.5);
    Object.assign(this.stun, { meter: 0, timer: 0, idle: 0, immunity: 4 });
    this.flinchTimer = 0;
    this.knockVel.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.guard.brokenTimer = 0;
    this.punches.reset();
    if (this.events) this.events.emit('fighter:up', { fighter: this });
  }

  /* ================================================================
   * Géométrie (à surcharger)
   * ================================================================ */

  /** Yaw utilisé pour orienter les trajectoires des coups. */
  aimYaw() {
    return this.yaw;
  }

  getHeadWorld(out) {
    return out.copy(this.zones.head);
  }

  /** Position monde du gant en garde (à surcharger). */
  getHandRestWorld(hand, out) {
    const st = GameConfig.stance;
    const pose = this.guard.amount > 0.5 ? st.guard[hand] : st.rest[hand];
    return localToWorld(this.position, this.yaw, pose[0], pose[1], pose[2], out);
  }

  /** Point visé par un coup (à surcharger). */
  resolvePunchTarget(def, zone) {
    const z = zone || 'head';
    const point = z === 'body' ? this.opponent.zones.chest : this.opponent.zones.head;
    return { zone: z, point, hasTarget: true };
  }
}
