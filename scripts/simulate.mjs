/**
 * simulate.mjs
 * ------------------------------------------------------------------
 * Banc d'essai sans rendu (Node) pour équilibrer le gameplay :
 *   1. test géométrique des esquives (qui évite quoi) ;
 *   2. combats simulés « joueur robot » contre chaque niveau d'IA,
 *      et IA contre IA.
 *
 * Usage : npm run simulate            (toutes les simulations)
 *         node scripts/simulate.mjs 40 (40 combats par confrontation)
 */

import { Vector3 } from 'three';
import { EventBus } from '../src/core/EventBus.js';
import { setSeed, random, range, chance, pick } from '../src/core/Random.js';
import { BOXERS } from '../src/config/Boxers.js';
import { DIFFICULTIES } from '../src/config/Difficulty.js';
import { GameConfig } from '../src/config/GameConfig.js';
import { PUNCHES } from '../src/config/Punches.js';
import { Player } from '../src/game/Player.js';
import { Opponent } from '../src/game/Opponent.js';
import { CombatSystem } from '../src/game/CombatSystem.js';
import { RoundSystem } from '../src/game/RoundSystem.js';
import { AI } from '../src/game/AI.js';
import { yawFromDirection, wrapAngle } from '../src/core/MathUtils.js';

const DT = 1 / 60;

/* ------------------------------------------------------------------ */
/* 1. Test géométrique des esquives                                    */
/* ------------------------------------------------------------------ */

function dodgeMatrix(distanceMode) {
  const results = {};
  const punches = ['jab', 'cross', 'hookL', 'hookR', 'upperL', 'upperR'];
  const dodges = ['none', 'slipL', 'slipR', 'duck', 'pullback'];
  for (const zone of ['head', 'body']) {
    for (const pid of punches) {
      for (const dodge of dodges) {
        const events = new EventBus();
        const att = new Opponent({ id: 'att', profile: BOXERS.tempest, events });
        const def = new Opponent({ id: 'def', profile: BOXERS.tempest, events });
        const combat = new CombatSystem(events);
        combat.setFighters(att, def);
        const dist = distanceMode === 'max' ? Math.min(PUNCHES[pid].reach + 0.08, 1.05) : Math.max(0.7, PUNCHES[pid].reach - 0.02);
        att.reset(new Vector3(0, 0, 0), 0);
        def.reset(new Vector3(0, 0, -dist), Math.PI);
        att.windupMultiplier = 1;
        let outcome = 'pending';
        events.on('punch:land', (e) => (outcome = e.zone === 'head' ? 'HIT-h' : 'HIT-b'));
        events.on('punch:blocked', () => (outcome = 'BLOCK'));
        events.on('punch:whiff', () => (outcome = 'miss'));
        att.aimError.set(0, 0, 0);
        att.tryPunch(pid, zone);
        // L'esquive démarre juste avant le départ du gant
        const punch = att.punches.hands[PUNCHES[pid].hand];
        let dodged = false;
        for (let i = 0; i < 120 && outcome === 'pending'; i++) {
          if (!dodged && dodge !== 'none' && punch.phase === 'windup' && punch.windup - punch.time < 0.03) {
            dodged = true;
            if (dodge === 'slipL') def.tryDodge('slip', -1);
            else if (dodge === 'slipR') def.tryDodge('slip', 1);
            else def.tryDodge(dodge);
          }
          att.update(DT);
          def.update(DT);
          combat.update();
        }
        results[`${zone}:${pid}:${dodge}`] = outcome;
      }
    }
  }
  console.log(`\n=== Esquives (distance ${distanceMode === 'max' ? 'maximale' : 'normale'}) ===`);
  for (const zone of ['head', 'body']) {
    console.log(`\nZone ${zone}`.padEnd(12) + dodges.map((d) => d.padEnd(9)).join(''));
    for (const pid of punches) {
      console.log(pid.padEnd(11) + dodges.map((d) => results[`${zone}:${pid}:${d}`].padEnd(9)).join(''));
    }
  }
  return results;
}

/* ------------------------------------------------------------------ */
/* 2. Joueur robot (imite un joueur moyen)                             */
/* ------------------------------------------------------------------ */

class PlayerBot {
  constructor(fighter, skill = 0.5) {
    this.f = fighter;
    this.skill = skill;
    this.timer = 0.5;
    this.plan = [];
    this.guardTimer = 0;
    this.reactAt = -1;
    this.watched = null;
    this.time = 0;
  }

  update(dt) {
    const f = this.f;
    const o = f.opponent;
    this.time += dt;
    const dx = o.position.x - f.position.x;
    const dz = o.position.z - f.position.z;
    const dist = Math.hypot(dx, dz);
    // Visée : tourne vers l'adversaire avec un léger retard (souris humaine)
    const target = yawFromDirection(dx, dz);
    f.yaw += wrapAngle(target - f.yaw) * Math.min(1, dt * 8);
    f.pitch = 0;

    // Réaction humaine (~0.25 s) aux coups adverses
    const op = o.punches.currentCommitted();
    if (op && op !== this.watched) {
      this.watched = op;
      this.reactAt = this.time + range(0.2, 0.32);
    }
    if (this.reactAt > 0 && this.time >= this.reactAt) {
      this.reactAt = -1;
      if (op && op.committed) {
        if (chance(0.25 * this.skill)) {
          if (op.def.kind === 'hook') f.tryDodge('duck');
          else if (op.def.kind === 'uppercut') f.tryDodge('slip', chance(0.5) ? 1 : -1);
          else f.tryDodge(chance(0.5) ? 'slip' : 'duck', chance(0.5) ? 1 : -1);
        } else if (chance(0.5 * this.skill + 0.15)) this.guardTimer = 0.5;
      }
    }
    if (this.guardTimer > 0) this.guardTimer -= dt;
    f.setGuard(this.guardTimer > 0, false);

    // Garde tenue « à l'instinct » quand l'adversaire est proche
    if (dist < 1.25 && chance(dt * (0.6 + this.skill))) this.guardTimer = Math.max(this.guardTimer, range(0.2, 0.6));

    // Déplacement : se placer à distance de jab, tourner un peu
    const desired = f.stamina.ratio < 0.25 ? 1.6 : 0.98;
    let mz = Math.max(-1, Math.min(1, (dist - desired) * 2));
    const mx = Math.sin(this.time * 0.7) * 0.4;
    f.setMoveInput(mx, mz);

    // Attaques
    this.timer -= dt;
    if (this.timer <= 0 && !this.plan.length && f.stamina.ratio > 0.12 && dist < 1.4) {
      this.timer = range(0.3, 1.0) / (0.6 + this.skill * 0.6);
      const combos = [['jab'], ['jab', 'cross'], ['cross'], ['jab', 'jab', 'cross'], ['jab', 'hookL', 'upperR'], ['hookL'], ['upperR', 'hookL']];
      this.plan = pick(combos).map((t) => ({ t, zone: chance(0.2) ? 'body' : 'head' }));
    }
    if (this.plan.length && f.canPunch()) {
      const it = this.plan[0];
      if (dist <= PUNCHES[it.t].reach + 0.2) {
        if (f.tryPunch(it.t, it.zone) !== 'rejected') this.plan.shift();
      } else if (dist > 1.6) this.plan = [];
    }
  }
}

/* ------------------------------------------------------------------ */
/* 3. Combat complet                                                   */
/* ------------------------------------------------------------------ */

function runFight({ playerMode, aDiff, bDiff, seed }) {
  setSeed(seed);
  const events = new EventBus();
  let a;
  let ctrlA;
  if (playerMode === 'bot') {
    a = new Player({ id: 'player', profile: BOXERS.player, events });
    ctrlA = new PlayerBot(a, 0.55);
  } else {
    a = new Opponent({ id: 'player', profile: BOXERS[DIFFICULTIES[aDiff].opponent], events });
  }
  const bProfile = DIFFICULTIES[bDiff];
  const b = new Opponent({ id: 'opponent', profile: BOXERS[bProfile.opponent], events });
  const combat = new CombatSystem(events);
  combat.setFighters(a, b);
  const rounds = new RoundSystem(events);
  rounds.configure({ rounds: 3, roundDuration: 60, breakDuration: 2 });
  const aiB = new AI(b, bProfile, events);
  if (playerMode !== 'bot') ctrlA = new AI(a, DIFFICULTIES[aDiff], events);

  let result = null;
  let errors = 0;
  const counts = { stuns: 0, crits: 0, combos: 0, guardBreaks: 0, dodgesA: 0, dodgesB: 0 };
  events.on('match:end', (r) => (result = r));
  events.on('fighter:ko', ({ fighter }) => rounds.registerKO(fighter));
  events.on('fighter:stunned', () => counts.stuns++);
  events.on('punch:land', (e) => { if (e.crit) counts.crits++; });
  events.on('combo', () => counts.combos++);
  events.on('guard:break', () => counts.guardBreaks++);
  events.on('round:intro', () => {
    a.placeAt(new Vector3(0, 0, 1.4), 0);
    b.placeAt(new Vector3(0, 0, -1.4), Math.PI);
    if (rounds.round > 1) {
      for (const f of [a, b]) {
        f.stamina.recover(GameConfig.match.breakStaminaRecovery);
        f.hp = Math.min(f.maxHp, f.hp + (f.maxHp - f.hp) * GameConfig.match.breakHpRecovery);
      }
    }
  });

  a.reset(new Vector3(0, 0, 1.4), 0);
  b.reset(new Vector3(0, 0, -1.4), Math.PI);
  rounds.start([a, b]);

  let t = 0;
  while (!result && t < 600) {
    const active = rounds.combatActive || rounds.phase === 'ko';
    a.frozen = b.frozen = !active;
    aiB.context.round = rounds.round;
    if (active) {
      ctrlA.update(DT);
      aiB.update(DT);
    }
    a.update(DT);
    b.update(DT);
    if (rounds.combatActive) combat.update();
    rounds.update(DT);
    for (const f of [a, b]) {
      if (!Number.isFinite(f.position.x) || !Number.isFinite(f.hp) || !Number.isFinite(f.stamina.value)) errors++;
    }
    t += DT;
  }
  aiB.dispose();
  if (ctrlA.dispose) ctrlA.dispose();
  counts.dodgesA = a.matchStats.dodges;
  counts.dodgesB = b.matchStats.dodges;
  return { result, a, b, counts, errors, t };
}

function matchup(label, opts, n) {
  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  let kos = 0;
  let koRoundSum = 0;
  let errors = 0;
  const agg = { aThrown: 0, aLanded: 0, bThrown: 0, bLanded: 0, aDmg: 0, bDmg: 0, stuns: 0, crits: 0, combos: 0, gb: 0, dodA: 0, dodB: 0, blocksA: 0, blocksB: 0 };
  for (let i = 0; i < n; i++) {
    const { result, a, b, counts, errors: e } = runFight({ ...opts, seed: 1000 + i * 7919 });
    errors += e;
    if (!result) continue;
    if (result.winner === a) winsA++;
    else if (result.winner === b) winsB++;
    else draws++;
    if (result.method === 'KO') {
      kos++;
      koRoundSum += result.round;
    }
    agg.aThrown += a.matchStats.thrown;
    agg.aLanded += a.matchStats.landed;
    agg.bThrown += b.matchStats.thrown;
    agg.bLanded += b.matchStats.landed;
    agg.aDmg += a.matchStats.damage;
    agg.bDmg += b.matchStats.damage;
    agg.stuns += counts.stuns;
    agg.crits += counts.crits;
    agg.combos += counts.combos;
    agg.gb += counts.guardBreaks;
    agg.dodA += counts.dodgesA;
    agg.dodB += counts.dodgesB;
    agg.blocksA += a.matchStats.blocks;
    agg.blocksB += b.matchStats.blocks;
  }
  const f = (x) => (x / n).toFixed(1);
  console.log(
    `${label.padEnd(26)} A:${String(winsA).padStart(3)}  B:${String(winsB).padStart(3)}  nul:${String(draws).padStart(2)}  KO:${String(kos).padStart(3)} (round moy. ${kos ? (koRoundSum / kos).toFixed(1) : '-'})` +
      `  | A ${f(agg.aLanded)}/${f(agg.aThrown)} coups, ${f(agg.aDmg)} dmg, ${f(agg.blocksA)} blocs, ${f(agg.dodA)} esq.` +
      `  | B ${f(agg.bLanded)}/${f(agg.bThrown)} coups, ${f(agg.bDmg)} dmg, ${f(agg.blocksB)} blocs, ${f(agg.dodB)} esq.` +
      `  | stun ${f(agg.stuns)} crit ${f(agg.crits)} combo ${f(agg.combos)} brisGarde ${f(agg.gb)}` +
      (errors ? `  !! ${errors} valeurs invalides` : ''),
  );
}

/* ------------------------------------------------------------------ */

const n = Number(process.argv[2]) || 24;
dodgeMatrix('normal');
dodgeMatrix('max');
console.log(`\n=== Combats simulés (${n} par confrontation, 3 x 60 s) ===`);
matchup('Robot vs Débutant', { playerMode: 'bot', bDiff: 'beginner' }, n);
matchup('Robot vs Équilibré', { playerMode: 'bot', bDiff: 'intermediate' }, n);
matchup('Robot vs Expert', { playerMode: 'bot', bDiff: 'expert' }, n);
matchup('Équilibré vs Équilibré', { playerMode: 'ai', aDiff: 'intermediate', bDiff: 'intermediate' }, n);
matchup('Équilibré vs Débutant', { playerMode: 'ai', aDiff: 'intermediate', bDiff: 'beginner' }, n);
matchup('Expert vs Équilibré', { playerMode: 'ai', aDiff: 'expert', bDiff: 'intermediate' }, n);
matchup('Expert vs Débutant', { playerMode: 'ai', aDiff: 'expert', bDiff: 'beginner' }, n);
