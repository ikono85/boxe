/**
 * RoundSystem.js
 * ------------------------------------------------------------------
 * Déroulement du match :
 *
 *   intro (carton ROUND X + FIGHT !) → fighting (chrono) → roundEnd (cloche)
 *     → break (minute de repos, récupération partielle) → intro du round suivant
 *   …après le dernier round : décision des trois juges (système des 10 points).
 *   Knockdown (vie à zéro) : compte de l'arbitre ('count', chrono arrêté).
 *   Relevé avant 10 → compte obligatoire jusqu'à 8 puis reprise ; sinon KO.
 *   Trois knockdowns dans le même round : KO technique.
 *   KO : séquence 'ko' puis fin du match.
 *
 * Les juges notent chaque round 10-9 (10-8 si domination nette, 10-10 si
 * égalité) à partir des coups propres, des coups puissants et des dégâts.
 * Chaque knockdown coûte un point de plus à celui qui est allé au tapis (10-8).
 * Chaque juge a sa propre sensibilité : les décisions partagées existent.
 */

import { GameConfig, ringBound } from '../config/GameConfig.js';
import { range } from '../core/Random.js';

const MC = GameConfig.match;
const KD = GameConfig.knockdown;

export class RoundSystem {
  constructor(events) {
    this.events = events;
    this.totalRounds = MC.rounds;
    this.roundDuration = MC.roundDuration;
    this.breakDuration = MC.breakDuration;
    this.phase = 'idle';
    this.round = 0;
    this.timer = 0;
    this.timeLeft = 0;
    this.warned = false;
    this.result = null;
    this.fighters = null;
    this.judges = [];
    this.scorecards = [];
    this.elapsedFight = 0;
    this.count = null; // compte en cours { fighter, other, n, timer, up }
    this.kd = []; // knockdowns par round : [boxeur 0, boxeur 1]
  }

  configure({ rounds, roundDuration, breakDuration } = {}) {
    if (rounds) this.totalRounds = rounds;
    if (roundDuration) this.roundDuration = roundDuration;
    if (breakDuration) this.breakDuration = breakDuration;
  }

  /** Démarre un match. fighters = [joueur, adversaire]. */
  start(fighters) {
    this.fighters = fighters;
    this.round = 1;
    this.result = null;
    this.elapsedFight = 0;
    this.count = null;
    this.kd = [];
    // Trois juges, chacun avec sa sensibilité aux coups puissants et au volume
    this.judges = [0, 1, 2].map(() => ({ power: range(0.8, 1.25), volume: range(0.85, 1.15), damage: range(0.85, 1.2) }));
    this.scorecards = this.judges.map(() => []);
    this._enterIntro();
  }

  get combatActive() {
    return this.phase === 'fighting';
  }

  get roundIndex() {
    return this.round - 1;
  }

  update(dt) {
    switch (this.phase) {
      case 'intro':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.phase = 'fighting';
          this.timeLeft = this.roundDuration;
          this.warned = false;
          this.events.emit('round:start', { round: this.round, total: this.totalRounds });
        }
        break;

      case 'fighting':
        this.timeLeft -= dt;
        this.elapsedFight += dt;
        if (!this.warned && this.timeLeft <= MC.tenSecondWarning) {
          this.warned = true;
          this.events.emit('round:warning', { round: this.round });
        }
        if (this.timeLeft <= 0) {
          this.timeLeft = 0;
          this._endRound();
        }
        break;

      case 'roundEnd':
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.round >= this.totalRounds) this._decision();
          else {
            this.phase = 'break';
            this.timer = this.breakDuration;
            this.events.emit('round:break', { round: this.round, total: this.totalRounds, duration: this.breakDuration });
          }
        }
        break;

      case 'break':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.round++;
          this._enterIntro();
        }
        break;

      case 'count':
        this._updateCount(dt);
        break;

      case 'ko':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.phase = 'over';
          this.events.emit('match:end', this.result);
        }
        break;

      default:
        break;
    }
  }

  /** Passer la pause entre deux rounds (après un court délai). */
  skipBreak() {
    if (this.phase === 'break' && this.breakDuration - this.timer > 1.5) this.timer = 0;
  }

  /** Appelé par le jeu quand un boxeur va au tapis : l'arbitre compte. */
  registerKnockdown(fighter) {
    if (this.phase === 'ko' || this.phase === 'over' || this.phase === 'count') return;
    const idx = this.fighters.indexOf(fighter);
    const other = this.fighters[1 - idx];
    const kd = this.kd[this.roundIndex] || (this.kd[this.roundIndex] = [0, 0]);
    kd[idx]++;
    if (kd[idx] >= KD.maxPerRound) {
      this.registerKO(fighter, 'KO technique');
      return;
    }
    this.phase = 'count';
    this.count = { fighter, other, n: 0, timer: KD.countDelay, up: false, upAt: 0 };
    // L'autre boxeur recule (coin neutre), sans sortir du ring
    let dx = other.position.x - fighter.position.x;
    let dz = other.position.z - fighter.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) {
      dx = -Math.sin(other.yaw);
      dz = -Math.cos(other.yaw);
    } else {
      dx /= d;
      dz /= d;
    }
    const B = ringBound() - 0.45;
    other.walkTo.set(
      Math.max(-B, Math.min(B, fighter.position.x + dx * KD.standAway)),
      0,
      Math.max(-B, Math.min(B, fighter.position.z + dz * KD.standAway)),
    );
    other.walking = true;
    this.events.emit('count:start', { fighter, other, knockdowns: fighter.knockdowns });
  }

  _updateCount(dt) {
    const c = this.count;
    const f = c.fighter;
    c.timer -= dt;
    if (!c.up) {
      if (c.timer <= 0) {
        c.n++;
        c.timer += KD.interval;
        f.down.counting = true;
        if (c.n >= 10) {
          this.events.emit('count:tick', { fighter: f, n: c.n });
          this.registerKO(f, 'KO');
          return;
        }
        this.events.emit('count:tick', { fighter: f, n: c.n });
      }
      const rises = f.autoRise ? c.n >= f.down.riseAt : f.down.meter >= f.down.need;
      if (c.n >= KD.minRiseCount && rises) {
        f.getUp();
        c.up = true;
        c.upAt = c.n;
        c.timer = Math.min(c.timer, KD.fastInterval);
        this.events.emit('count:up', { fighter: f, n: c.n });
      }
      return;
    }
    // Relevé : compte obligatoire jusqu'à 8, puis reprise quand il est debout
    if (c.timer > 0) return;
    if (c.n < KD.mandatory) {
      c.n++;
      c.timer = KD.fastInterval;
      this.events.emit('count:tick', { fighter: f, n: c.n });
      return;
    }
    if (f.down.riseT < KD.riseDuration) return;
    this.phase = 'fighting';
    this.count = null;
    c.other.walking = false;
    this.events.emit('count:end', { fighter: f, other: c.other });
  }

  /** KO définitif (compte de 10, KO technique). */
  registerKO(loser, kind = 'KO') {
    if (this.phase === 'ko' || this.phase === 'over') return;
    const winner = this.fighters.find((f) => f !== loser);
    if (this.count) this.count.other.walking = false;
    this.count = null;
    this.phase = 'ko';
    this.timer = kind === 'KO technique' ? MC.koSequenceDuration : MC.koSequenceDuration * 0.7;
    this.result = {
      method: 'KO',
      kind,
      winner,
      loser,
      round: this.round,
      time: this.roundDuration - this.timeLeft,
      timeLeft: this.timeLeft,
      roundsLeft: this.totalRounds - this.round,
      scorecards: this.scorecards,
      totals: this._totals(),
    };
    this.events.emit('match:ko', this.result);
    this.events.emit('fighter:ko', { fighter: loser, kind });
  }

  _enterIntro() {
    this.phase = 'intro';
    this.timer = MC.introDuration;
    for (const f of this.fighters) f.currentRound = this.round - 1;
    this.events.emit('round:intro', { round: this.round, total: this.totalRounds });
  }

  _endRound() {
    this.phase = 'roundEnd';
    this.timer = MC.roundEndDuration;
    this._scoreRound();
    this.events.emit('round:end', { round: this.round, total: this.totalRounds, last: this.round >= this.totalRounds });
  }

  /** Note du round par chaque juge (système des 10 points). */
  _scoreRound() {
    const [a, b] = this.fighters;
    const ra = a.matchStats.round(this.roundIndex);
    const rb = b.matchStats.round(this.roundIndex);
    this.judges.forEach((j, i) => {
      const pa = ra.landed * j.volume + ra.power * 0.7 * j.power + ra.damage * 0.12 * j.damage + ra.dodges * 0.15 + range(-0.6, 0.6);
      const pb = rb.landed * j.volume + rb.power * 0.7 * j.power + rb.damage * 0.12 * j.damage + rb.dodges * 0.15 + range(-0.6, 0.6);
      const total = Math.max(1, pa + pb);
      const diff = pa - pb;
      let card;
      if (Math.abs(diff) < total * 0.06 + 0.8) card = [10, 10];
      else if (diff > 0) card = diff > total * 0.45 && ra.damage - rb.damage > 22 ? [10, 8] : [10, 9];
      else card = -diff > total * 0.45 && rb.damage - ra.damage > 22 ? [8, 10] : [9, 10];
      // Knockdowns : le round va à celui qui est resté debout, un point de moins par knockdown
      const kd = this.kd[this.roundIndex] || [0, 0];
      const net = kd[1] - kd[0];
      if (net > 0) card = [10, Math.max(6, 9 - net)];
      else if (net < 0) card = [Math.max(6, 9 + net), 10];
      this.scorecards[i].push(card);
    });
  }

  _totals() {
    return this.scorecards.map((rounds) => rounds.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]));
  }

  _decision() {
    const [a, b] = this.fighters;
    const totals = this._totals();
    let winsA = 0;
    let winsB = 0;
    for (const [x, y] of totals) {
      if (x > y) winsA++;
      else if (y > x) winsB++;
    }
    let winner = null;
    let kind = 'Match nul';
    if (winsA > winsB) winner = a;
    else if (winsB > winsA) winner = b;
    const w = Math.max(winsA, winsB);
    const l = Math.min(winsA, winsB);
    if (winner) {
      if (w === 3) kind = 'Décision unanime';
      else if (w === 2 && l === 1) kind = 'Décision partagée';
      else kind = 'Décision majoritaire';
    }
    this.phase = 'over';
    this.result = {
      method: winner ? 'DECISION' : 'DRAW',
      kind,
      winner,
      loser: winner ? (winner === a ? b : a) : null,
      round: this.round,
      time: this.roundDuration,
      timeLeft: 0,
      roundsLeft: 0,
      scorecards: this.scorecards,
      totals,
    };
    this.events.emit('match:end', this.result);
  }
}
