/**
 * AI.js
 * ------------------------------------------------------------------
 * Cerveau de l'adversaire. Il ne fait que poser des intentions sur son
 * Fighter (déplacement, garde, coups, esquives) : il obéit aux mêmes règles
 * d'endurance et de timing que le joueur.
 *
 * Organisation en couches :
 *  1. Perception    distance, angle, état du joueur, position dans le ring.
 *  2. Tactique      états : neutral (jauger, tourner), attack (entrer, enchaîner,
 *                   ressortir), defend (encaisser une vague), recover (reprendre
 *                   son souffle), kill (le joueur est touché : chercher le KO).
 *  3. Réflexes      réaction aux coups du joueur après un temps de réaction :
 *                   garde, esquive adaptée, ou coup d'arrêt (expert).
 *  4. Contres       punition des coups ratés, riposte après une défense.
 *  5. Adaptation    (expert) statistiques des habitudes du joueur : coup favori,
 *                   enchaînements, esquives préférées, usage de la garde.
 *
 * Le niveau de difficulté (Difficulty.js) règle chaque couche ; le style du
 * boxeur (Styles.js : cogneur, danseur, mitraillette, contreur) module sa
 * façon de boxer.
 */

import { PUNCHES } from '../config/Punches.js';
import { ringBound } from '../config/GameConfig.js';
import { random, range, chance, pick, weightedPick } from '../core/Random.js';
import { clamp, lerp, stepAngle, yawFromDirection } from '../core/MathUtils.js';

const PUNCH_IDS = Object.keys(PUNCHES);

/** Répertoire de combos de l'IA (le joueur a les mêmes). */
const COMBO_REPERTOIRE = [
  { seq: ['jab', 'cross'], level: 0, weight: 4 },
  { seq: ['jab', 'jab'], level: 0, weight: 2 },
  { seq: ['jab', 'jab', 'cross'], level: 1, weight: 3 },
  { seq: ['jab', 'cross', 'hookL'], level: 1, weight: 3 },
  { seq: ['cross', 'hookL'], level: 1, weight: 2 },
  { seq: ['jab', 'hookL', 'upperR'], level: 2, weight: 3 },
  { seq: ['hookL', 'hookR'], level: 2, weight: 2 },
  { seq: ['upperR', 'hookL'], level: 2, weight: 2 },
  { seq: ['jab', 'cross', 'hookL', 'cross'], level: 2, weight: 1.5 },
];

export class AI {
  constructor(fighter, profile, events) {
    this.f = fighter;
    this.events = events;
    this.enabled = true;
    this.mode = 'fight'; // 'fight' | 'shadow' (démonstration du menu)
    this.context = { round: 1, totalRounds: 3, timeLeft: 60 };
    this.setProfile(profile);
    this.reset();

    this._unsubs = [
      events.on('punch:start', (e) => this._onPunchStart(e)),
      events.on('punch:whiff', (e) => this._onWhiff(e)),
      events.on('punch:blocked', (e) => this._onBlocked(e)),
      events.on('punch:land', (e) => this._onLand(e)),
      events.on('dodge:start', (e) => this._onDodge(e)),
    ];
  }

  dispose() {
    for (const u of this._unsubs) u();
  }

  setProfile(profile) {
    this.p = profile;
    this.f.windupMultiplier = profile.windupMultiplier;
    this.level = profile.id === 'beginner' ? 0 : profile.id === 'intermediate' ? 1 : 2;
  }

  reset() {
    this.state = 'neutral';
    this.stateTime = 0;
    this.time = 0;
    this.decisionTimer = 0.6;
    this.plan = [];
    this.planDeadline = 0;
    this.attackDistance = 1;
    this.circleDir = chance(0.5) ? 1 : -1;
    this.circleTimer = range(1.5, 3);
    this.reaction = null;
    this.counter = null;
    this.feint = null;
    this.guardTimer = 0;
    this.guardLow = false;
    this.guardRoll = 0;
    this.guardHabitOn = false;
    this.habitLow = false;
    this.exitTimer = 0;
    this.dist = 2;
    this.yawToPlayer = this.f.yaw;
    this.predicted = null;
    this.habits = {
      punches: Object.fromEntries(PUNCH_IDS.map((id) => [id, 0])),
      head: 0,
      body: 0,
      total: 0,
      dodges: { slip: 0, duck: 0, pullback: 0 },
      dodgeTotal: 0,
      guardTime: 0,
      observeTime: 0,
      transitions: {},
      lastPunch: null,
      lastPunchTime: -10,
      attackTimes: [],
      whiffs: 0,
    };
    this.shadow = { timer: 1, wander: random() * 6 };
  }

  /* ================================================================
   * Boucle principale
   * ================================================================ */

  update(dt) {
    const f = this.f;
    const pl = f.opponent;
    if (!this.enabled || !pl) return;
    this.time += dt;
    this.stateTime += dt;

    if (f.ko || f.frozen) {
      f.setMoveInput(0, 0);
      f.setGuard(false);
      return;
    }

    const dx = pl.position.x - f.position.x;
    const dz = pl.position.z - f.position.z;
    this.dist = Math.hypot(dx, dz);
    this.yawToPlayer = yawFromDirection(dx, dz);

    if (this.mode === 'shadow') {
      this._shadowbox(dt);
      return;
    }
    if (pl.ko) {
      this._celebrate(dt);
      return;
    }

    this._trackHabits(dt);
    this._face(dt);
    this._processReaction();
    this._processCounter();

    this.decisionTimer -= dt;
    if (this.decisionTimer <= 0) {
      this._decide();
      this.decisionTimer = range(this.p.decisionInterval[0], this.p.decisionInterval[1]);
    }

    this._runPlan(dt);
    this._move(dt);
    this._updateGuard(dt);
  }

  _setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
    if (s !== 'attack' && s !== 'kill') this.plan = [];
  }

  /* ================================================================
   * Perception & orientation
   * ================================================================ */

  _face(dt) {
    const f = this.f;
    let speed = this.p.turnSpeed;
    if (f.isStunned) speed *= 0.35;
    if (f.punches.isCommitted()) speed *= 0.5;
    f.yaw = stepAngle(f.yaw, this.yawToPlayer, speed * dt);
  }

  _inReach(type, margin = 0.16) {
    return this.dist <= PUNCHES[type].reach + margin;
  }

  /** Le joueur attaque-t-il bientôt ? (intervalle moyen entre ses attaques) */
  _attackDue() {
    const t = this.habits.attackTimes;
    if (t.length < 5) return false;
    let sum = 0;
    for (let i = 1; i < t.length; i++) sum += Math.min(3, t[i] - t[i - 1]);
    const avg = sum / (t.length - 1);
    const since = this.time - t[t.length - 1];
    return since > avg * 0.7 && since < avg * 1.4;
  }

  /** Nombre d'attaques du joueur sur la dernière seconde et demie. */
  _playerPressure() {
    let n = 0;
    for (const t of this.habits.attackTimes) if (this.time - t < 1.6) n++;
    return n;
  }

  /* ================================================================
   * Décisions tactiques
   * ================================================================ */

  _decide() {
    const f = this.f;
    const pl = f.opponent;
    const p = this.p;
    const stam = f.stamina.ratio;
    const plHurt = pl.isStunned || pl.hp < pl.maxHp * 0.3 || pl.stamina.isExhausted() || pl.guard.brokenTimer > 0;
    const recoverAt = lerp(0.1, 0.36, p.staminaDiscipline);
    const recoverUntil = recoverAt + lerp(0.1, 0.34, p.staminaDiscipline);

    // --- Gestion de l'endurance ---
    if (this.state === 'recover') {
      const opportunist = plHurt && stam > 0.2 && chance(p.killInstinct * 0.6);
      if (stam > recoverUntil || opportunist) this._setState(opportunist ? 'kill' : 'neutral');
      return;
    }
    if (stam < recoverAt && this.state !== 'kill') {
      this._setState('recover');
      return;
    }

    // --- Instinct de tueur ---
    if (plHurt && stam > 0.22 && chance(p.killInstinct)) {
      this._setState('kill');
    } else if (this.state === 'kill' && !plHurt) {
      this._setState('neutral');
    }

    // --- Sous pression : se couvrir et reculer un moment ---
    const pressure = this._playerPressure();
    if (this.state === 'neutral' && pressure >= 3 && chance(0.55 - p.aggression * 0.35)) {
      this._setState('defend');
      return;
    }
    if (this.state === 'defend' && this.stateTime > range(0.8, 1.8)) this._setState('neutral');

    // --- Mouvements de tête préventifs (rythme du boxeur) ---
    if ((this.state === 'neutral' || this.state === 'defend') && this.dist < PUNCHES.cross.reach + 0.35) {
      let hm = p.headMovement;
      // L'expert sent venir l'attaque : le joueur frappe à intervalles réguliers
      if (p.adaptation > 0.5 && this._attackDue()) hm += 0.25 * p.adaptation;
      if (chance(hm) && f.canAct() && !f.punches.isCommitted()) {
        const fav = this.predicted ? PUNCHES[this.predicted].kind : null;
        let type = chance(0.65) ? 'slip' : 'duck';
        if (fav === 'hook') type = 'duck';
        else if (fav === 'uppercut') type = 'slip';
        f.tryDodge(type, chance(0.5) ? 1 : -1);
      }
    }
    if (this.state === 'attack' && !this.plan.length && f.punches.isActive() === false) this._setState('neutral');

    // --- Attaquer ? ---
    if ((this.state === 'neutral' || this.state === 'kill') && !this.plan.length && this.exitTimer <= 0) {
      let want = p.aggression;
      if (this.state === 'kill') want = 0.55 + p.killInstinct * 0.45;
      if (pl.punches.inRecoveryAfterWhiff()) want += 0.25;
      if (pl.stamina.isExhausted()) want += 0.15;
      if (stam < 0.4) want *= 0.45 + 0.55 * (1 - p.staminaDiscipline);
      if (this.dist > 2.1) want *= 0.6;
      // Dernier round et en retard aux points : il prend des risques
      const ctx = this.context;
      if (ctx.round >= ctx.totalRounds && f.matchStats.damage < pl.matchStats.damage) want += 0.12 * this.level;
      // Contreur : il laisse venir, sauf si le joueur ne fait rien depuis longtemps
      if (p.waitCounter && this.state !== 'kill') {
        const idle = this.time - this.habits.lastPunchTime;
        if (idle < 3.5) want *= 0.35;
      }
      if (chance(want)) this._planAttack();
    }
  }

  _planAttack() {
    const p = this.p;
    const h = this.habits;
    const pl = this.f.opponent;

    // Zone visée : le corps quand le joueur se cache derrière sa garde
    let bodyRate = p.bodyShotRate;
    if (p.adaptation > 0 && h.observeTime > 6) {
      const guardRatio = h.guardTime / h.observeTime;
      bodyRate += p.adaptation * clamp(guardRatio - 0.3, 0, 0.5) * 0.8;
      if (pl.guard.low && pl.guard.amount > 0.5) bodyRate *= 0.3;
    }
    if (pl.guard.amount > 0.5 && !pl.guard.low) bodyRate += 0.15 * this.level;

    // Combo ou coup isolé
    let seq;
    if (chance(p.comboSkill)) {
      // Répertoire commun (selon le niveau) + enchaînements favoris du style
      const list = COMBO_REPERTOIRE.filter((c) => c.level <= this.level);
      if (p.combos) for (const c of p.combos) list.push({ seq: c.seq, weight: c.weight * 1.6 });
      const options = {};
      list.forEach((c, i) => {
        options[i] = c.weight;
      });
      seq = [...list[Number(weightedPick(options))].seq];
    } else {
      seq = [weightedPick(p.punchWeights)];
    }

    // Adaptation : choisir les coups qui battent les esquives favorites du joueur
    if (p.adaptation >= 0.5 && h.dodgeTotal >= 3) {
      const fav = this._favoriteDodge();
      if (fav === 'duck' && chance(0.55 * p.adaptation)) seq = ['jab', 'upperR'];
      else if (fav === 'slip' && chance(0.55 * p.adaptation)) seq = ['jab', 'hookL'];
      else if (fav === 'pullback' && chance(0.45 * p.adaptation)) seq = ['jab', 'jab', 'cross'];
    }

    this.plan = seq.map((type) => ({ type, zone: chance(bodyRate) ? 'body' : 'head', feint: false }));
    if (chance(p.feintRate)) this.plan.unshift({ type: 'jab', zone: 'head', feint: true });

    let minReach = Infinity;
    for (const it of this.plan) minReach = Math.min(minReach, PUNCHES[it.type].reach);
    this.attackDistance = minReach + 0.1;
    this.planDeadline = this.time + 1.7;
    if (this.state !== 'kill') this._setState('attack');
  }

  _runPlan(dt) {
    const f = this.f;
    if (this.exitTimer > 0) this.exitTimer -= dt;

    // Feinte : on coupe l'anticipation au bout de quelques centièmes
    if (this.feint && this.time >= this.feint.at) {
      const hand = f.punches.hands[this.feint.hand];
      if (hand.serial === this.feint.serial && hand.phase === 'windup') f.punches.interruptWindups();
      this.feint = null;
    }

    if (!this.plan.length) return;
    if (this.time > this.planDeadline) {
      this.plan = [];
      this._afterAttack();
      return;
    }
    const item = this.plan[0];
    if (!this._inReach(item.type, 0.17) || !f.canPunch()) return;
    this._setAim(item.zone);
    const res = f.tryPunch(item.type, item.zone);
    if (res === 'rejected') return;
    if (item.feint) {
      const hand = PUNCHES[item.type].hand;
      this.feint = { hand, serial: f.punches.hands[hand].serial, at: this.time + 0.07 };
    }
    this.plan.shift();
    this.planDeadline = this.time + 1;
    if (!this.plan.length) this._afterAttack();
  }

  _afterAttack() {
    if (this.state === 'kill') return; // on reste au contact
    // Entrer, frapper, ressortir : sauf les boxeurs très agressifs
    const exit = this.p.exitRate ?? 1 - this.p.aggression * 0.6;
    if (chance(exit)) this.exitTimer = range(0.45, 1);
    this._setState('neutral');
  }

  /** Visée : petite imprécision selon le niveau + anticipation du déplacement. */
  _setAim(zone) {
    const e = this.f.aimError;
    const p = this.p;
    if (chance(p.accuracy)) e.set(range(-0.02, 0.02), range(-0.02, 0.02), range(-0.02, 0.02));
    else e.set(range(-0.26, 0.26), range(-0.1, 0.22), range(-0.15, 0.15));
    if (zone === 'body') e.y *= 0.5;
    // Le coup suit le joueur pendant l'anticipation ; il faut encore prévoir
    // où il sera pendant la frappe elle-même.
    const v = this.f.opponent.velocity;
    e.x += v.x * 0.09 * p.lead;
    e.z += v.z * 0.09 * p.lead;
  }

  /* ================================================================
   * Réflexes défensifs
   * ================================================================ */

  _onPunchStart({ fighter, punch }) {
    if (this.mode !== 'fight' || fighter !== this.f.opponent) return;
    this._recordPlayerPunch(punch);
    const p = this.p;
    let delay = p.reactionTime + range(-p.reactionJitter, p.reactionJitter);
    // Coup prévu grâce à l'analyse : réaction plus rapide
    if (this.predicted && this.predicted === punch.def.id) delay *= 0.55;
    this.reaction = { punch, serial: punch.serial, at: this.time + Math.max(0.03, delay) };
  }

  _processReaction() {
    const r = this.reaction;
    if (!r || this.time < r.at) return;
    this.reaction = null;
    const pun = r.punch;
    const f = this.f;
    const p = this.p;
    if (pun.serial !== r.serial || !pun.committed || !f.canAct()) return;
    if (this.dist > pun.def.reach + 0.45) return; // hors de portée : inutile
    const tti = pun.timeToImpact();

    // Expert : coup d'arrêt (jab) sur un coup lent et large
    if (pun.def.kind !== 'straight' && tti > 0.2 && this._inReach('jab', 0.12) && !f.punches.isCommitted() && chance(p.counterSkill * 0.45)) {
      this._setAim('head');
      if (f.tryPunch('jab', 'head') === 'started') return;
    }

    const roll = random();
    const canDodge = !f.punches.isCommitted() && f.dodge.phase === 'none' && f.dodge.cooldown <= 0 && tti > 0.045;
    if (canDodge && roll < p.dodgeSkill) {
      const d = this._chooseDodge(pun);
      if (f.tryDodge(d.type, d.dir)) return;
    }
    if (tti > 0.03 && roll < p.dodgeSkill + p.blockSkill * (1 - p.dodgeSkill)) {
      this.guardTimer = Math.max(this.guardTimer, tti + 0.3);
      this.guardLow = pun.zone === 'body';
    }
  }

  /** Esquive adaptée au coup (avec une chance de se tromper). */
  _chooseDodge(pun) {
    const kind = pun.def.kind;
    let type;
    if (pun.zone === 'body') type = 'pullback';
    else if (kind === 'straight') type = chance(0.7) ? 'slip' : 'duck';
    else if (kind === 'hook') type = chance(0.75) ? 'duck' : 'pullback';
    else type = chance(0.7) ? 'slip' : 'pullback';

    if (chance(this.p.wrongDodge)) {
      if (kind === 'hook') type = 'slip';
      else if (kind === 'uppercut') type = 'duck';
    }
    // Pas de recul quand on a les cordes dans le dos
    if (type === 'pullback' && this._ropesBehind()) type = kind === 'hook' ? 'duck' : 'slip';
    return { type, dir: chance(0.5) ? 1 : -1 };
  }

  _ropesBehind() {
    const f = this.f;
    const back = 0.9;
    const bx = f.position.x + Math.sin(f.yaw) * back;
    const bz = f.position.z + Math.cos(f.yaw) * back;
    const B = ringBound();
    return Math.abs(bx) > B || Math.abs(bz) > B;
  }

  /* ================================================================
   * Contres
   * ================================================================ */

  _onWhiff({ attacker, defender, dodged }) {
    if (this.mode !== 'fight' || attacker !== this.f.opponent || defender !== this.f) return;
    this.habits.whiffs++;
    if (chance(this.p.counterSkill * (dodged ? 1 : 0.75))) this._queueCounter();
  }

  _onBlocked({ attacker, defender }) {
    if (this.mode !== 'fight' || attacker !== this.f.opponent || defender !== this.f) return;
    if (chance(this.p.counterSkill * 0.8)) this._queueCounter();
  }

  _onLand({ attacker, defender }) {
    // Touché : il annule son plan si ce n'était pas un échange voulu
    if (defender === this.f && this.plan.length && chance(0.5)) this.plan = [];
    if (attacker === this.f && this.state === 'kill' && !this.plan.length && chance(this.p.comboSkill)) this._planAttack();
  }

  _onDodge({ fighter, type }) {
    if (fighter !== this.f.opponent) return;
    this.habits.dodges[type]++;
    this.habits.dodgeTotal++;
  }

  _queueCounter() {
    const f = this.f;
    let type;
    if (this.dist > PUNCHES.hookL.reach + 0.15) type = chance(0.65) ? 'cross' : 'jab';
    else if (f.dodge.type === 'duck' && f.dodge.phase !== 'none') type = pick(['hookL', 'upperR', 'hookR']);
    else if (f.dodge.type === 'slip' && f.dodge.phase !== 'none') type = f.dodge.dir > 0 ? 'hookL' : 'cross';
    else type = pick(['cross', 'hookL', 'upperR', 'cross']);
    const zone = chance(this.p.bodyShotRate * 0.6) ? 'body' : 'head';
    this.counter = { type, zone, at: this.time + range(0.02, 0.07), expires: this.time + 0.6 };
    // L'expert enchaîne derrière son contre
    if (chance(this.p.comboSkill * 0.5)) {
      const follow = type === 'cross' ? 'hookL' : type === 'hookL' ? 'cross' : 'hookL';
      this.plan = [{ type: follow, zone: 'head', feint: false }];
      this.attackDistance = PUNCHES[follow].reach + 0.1;
      this.planDeadline = this.time + 1.2;
    }
  }

  _processCounter() {
    const c = this.counter;
    if (!c || this.time < c.at) return;
    if (this.time > c.expires) {
      this.counter = null;
      return;
    }
    if (!this.f.canPunch() || !this._inReach(c.type, 0.2)) return;
    this._setAim(c.zone);
    if (this.f.tryPunch(c.type, c.zone) !== 'rejected') this.counter = null;
  }

  /* ================================================================
   * Déplacements
   * ================================================================ */

  _move(dt) {
    const f = this.f;
    const p = this.p;
    let desired;
    switch (this.state) {
      case 'attack':
        desired = this.plan.length ? this.attackDistance - 0.06 : p.preferredRange;
        break;
      case 'kill':
        desired = this.plan.length ? this.attackDistance - 0.06 : 0.92;
        break;
      case 'defend':
        desired = p.preferredRange + 0.35 * (1 - (p.pressure || 0));
        break;
      case 'recover':
        desired = p.preferredRange + 0.8 * (1 - (p.pressure || 0) * 0.5);
        break;
      default:
        desired = p.preferredRange + (this.exitTimer > 0 ? 0.4 : 0);
    }

    let mz = clamp((this.dist - desired) * 2.4, -1, 1);
    if (Math.abs(this.dist - desired) < 0.05) mz = 0;

    // Tourner autour du joueur (le débutant le fait très peu)
    this.circleTimer -= dt;
    if (this.circleTimer <= 0) {
      if (chance(0.6)) this.circleDir *= -1;
      this.circleTimer = range(1.2, 3.2) * (1.25 - p.footwork * 0.5);
    }
    const lateralByState = { attack: 0.25, kill: 0.1, defend: 0.85, recover: 0.95, neutral: 0.6 };
    let mx = this.circleDir * (lateralByState[this.state] ?? 0.5) * p.footwork;

    // Éviter les cordes et les coins
    const B = ringBound();
    const margin = 0.95;
    const nearX = Math.max(0, Math.abs(f.position.x) - (B - margin)) / margin;
    const nearZ = Math.max(0, Math.abs(f.position.z) - (B - margin)) / margin;
    if (nearX > 0 || nearZ > 0) {
      const awareness = 0.25 + 0.75 * p.footwork;
      const cx = -Math.sign(f.position.x) * nearX;
      const cz = -Math.sign(f.position.z) * nearZ;
      const s = Math.sin(f.yaw);
      const c = Math.cos(f.yaw);
      const lx = cx * c - cz * s; // composante vers la droite locale
      const lz = -cx * s - cz * c; // composante vers l'avant local
      mx += lx * 1.6 * awareness;
      mz += lz * 1.1 * awareness;
      if (lx * this.circleDir < 0 && chance(awareness * 0.15)) this.circleDir *= -1;
    }

    // Sonné : il titube en reculant
    if (f.isStunned) {
      mx = Math.sin(this.time * 2.1) * 0.5;
      mz = -0.35;
    }
    f.setMoveInput(clamp(mx, -1, 1), clamp(mz, -1, 1));
  }

  /* ================================================================
   * Garde
   * ================================================================ */

  _updateGuard(dt) {
    const f = this.f;
    const p = this.p;
    if (this.guardTimer > 0) this.guardTimer -= dt;
    this.guardRoll -= dt;
    if (this.guardRoll <= 0) {
      this.guardRoll = range(0.45, 1.05);
      const inDanger = this.dist < PUNCHES.cross.reach + 0.38;
      let g = p.guardHabit * (inDanger ? 1 : 0.35);
      if (this.state === 'defend' || this.state === 'recover') g = Math.max(g, 0.8);
      if (this.state === 'attack' || this.state === 'kill') g *= 0.45;
      if (inDanger && chance(p.anticipation)) g = 1;
      this.guardHabitOn = chance(g);
      const h = this.habits;
      this.habitLow = p.adaptation > 0 && h.total > 6 && h.body / h.total > 0.45 && chance(p.adaptation * 0.6);
    }
    const want = this.guardTimer > 0 || this.guardHabitOn;
    f.setGuard(want, this.guardTimer > 0 ? this.guardLow : this.habitLow);
  }

  /* ================================================================
   * Analyse des habitudes du joueur
   * ================================================================ */

  _recordPlayerPunch(punch) {
    const h = this.habits;
    const id = punch.def.id;
    h.total++;
    h.punches[id]++;
    if (punch.zone === 'body') h.body++;
    else h.head++;
    if (h.lastPunch && this.time - h.lastPunchTime < 1) {
      const key = `${h.lastPunch}>${id}`;
      h.transitions[key] = (h.transitions[key] || 0) + 1;
    }
    h.lastPunch = id;
    h.lastPunchTime = this.time;
    h.attackTimes.push(this.time);
    if (h.attackTimes.length > 16) h.attackTimes.shift();
    this.predicted = this.p.adaptation > 0 ? this._predictNext(id) : null;
  }

  _trackHabits(dt) {
    const h = this.habits;
    const pl = this.f.opponent;
    h.observeTime += dt;
    if (pl.guard.amount > 0.5) h.guardTime += dt;
  }

  /** Coup le plus probable après `id` (chaîne de Markov très simple). */
  _predictNext(id) {
    if (random() > this.p.adaptation) return null;
    let best = null;
    let bestN = 1;
    for (const [key, n] of Object.entries(this.habits.transitions)) {
      const [from, to] = key.split('>');
      if (from === id && n > bestN) {
        best = to;
        bestN = n;
      }
    }
    // Sans enchaînement connu : son coup favori
    if (!best && this.habits.total > 8) best = this.favoritePunch();
    return best;
  }

  favoritePunch() {
    let best = null;
    let n = 0;
    for (const [id, c] of Object.entries(this.habits.punches)) {
      if (c > n) {
        best = id;
        n = c;
      }
    }
    return best;
  }

  _favoriteDodge() {
    const d = this.habits.dodges;
    let best = null;
    let n = 0;
    for (const k of Object.keys(d)) {
      if (d[k] > n) {
        best = k;
        n = d[k];
      }
    }
    return best;
  }

  /**
   * Conseils du coin entre les rounds, tirés de l'analyse du joueur.
   * Retourne une liste de phrases (la plus pertinente en premier).
   */
  insights() {
    const h = this.habits;
    const pl = this.f.opponent;
    const tips = [];
    if (h.total >= 6) {
      const fav = this.favoritePunch();
      const ratio = h.punches[fav] / h.total;
      if (ratio > 0.55) {
        const name = PUNCHES[fav].label.toLowerCase();
        tips.push(this.p.adaptation >= 0.5
          ? `Il a repéré votre ${name}. Variez : mélangez crochets et uppercuts.`
          : `Vous lancez surtout des ${name}s. Variez pour l'ouvrir.`);
      }
      if (h.body / h.total < 0.1) tips.push('Visez le corps (regard plus bas) : ça vide son endurance.');
    }
    if (h.observeTime > 10 && h.guardTime / h.observeTime > 0.55) {
      tips.push('Vous restez beaucoup en garde : il va chercher le corps et les uppercuts.');
    }
    if (h.dodgeTotal >= 4) {
      const fav = this._favoriteDodge();
      if (fav === 'duck') tips.push('Vous baissez souvent la tête : méfiez-vous des uppercuts.');
      if (fav === 'slip') tips.push('Vos esquives latérales marchent sur ses directs, pas sur ses crochets.');
    }
    if (pl.matchStats.thrown > 12 && pl.matchStats.accuracy < 0.3) tips.push('Trop de coups dans le vide : rapprochez-vous avant de frapper.');
    if (pl.stamina.ratio < 0.35) tips.push("Gérez votre souffle : un boxeur essoufflé frappe moins fort.");
    if (this.f.stamina.ratio < 0.4) tips.push('Il est fatigué : mettez la pression.');
    if (!tips.length) tips.push('Restez à distance de jab, et contrez quand il rate.');
    return tips;
  }

  /* ================================================================
   * Modes spéciaux
   * ================================================================ */

  /** Joueur KO : l'IA recule et lève les bras. */
  _celebrate() {
    const f = this.f;
    f.setGuard(false);
    f.setMoveInput(0, this.dist < 2 ? -0.5 : 0);
  }

  /** Démonstration du menu : shadow-boxing au centre du ring. */
  _shadowbox(dt) {
    const f = this.f;
    const s = this.shadow;
    s.wander += dt * 0.35;
    f.yaw += Math.sin(s.wander) * 0.5 * dt;
    // Petits pas d'avant en arrière, un peu de latéral
    f.setMoveInput(Math.sin(s.wander * 1.7) * 0.35, Math.sin(s.wander * 2.3) * 0.4 - f.position.length() * 0.25);
    f.setGuard(Math.sin(s.wander * 0.9) > 0.6);
    s.timer -= dt;
    if (s.timer <= 0 && f.canPunch()) {
      s.timer = range(0.5, 1.5);
      const combos = [['jab'], ['jab', 'cross'], ['jab', 'cross', 'hookL'], ['hookL', 'upperR'], ['jab', 'jab', 'cross']];
      this.plan = pick(combos).map((type) => ({ type, zone: 'head', feint: false }));
      this.planDeadline = this.time + 1.5;
    }
    if (this.plan.length && f.canPunch()) {
      f.aimError.set(0, 0, 0);
      if (f.tryPunch(this.plan[0].type, 'head') !== 'rejected') this.plan.shift();
    }
  }
}
