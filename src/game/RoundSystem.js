/**
 * RoundSystem.js
 * ------------------------------------------------------------------
 * Déroulement du match :
 *
 *   intro (carton ROUND X + FIGHT !) → fighting (chrono) → roundEnd (cloche)
 *     → break (minute de repos, récupération partielle) → intro du round suivant
 *   …après le dernier round : décision des trois juges (système des 10 points).
 *   KO à tout moment : séquence 'ko' puis fin du match.
 *
 * Les juges notent chaque round 10-9 (10-8 si domination nette, 10-10 si
 * égalité) à partir des coups propres, des coups puissants et des dégâts.
 * Chaque juge a sa propre sensibilité : les décisions partagées existent.
 */

import { GameConfig } from '../config/GameConfig.js';
import { range } from '../core/Random.js';

const MC = GameConfig.match;

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

  /** Appelé par le jeu quand un boxeur est KO. */
  registerKO(loser) {
    if (this.phase === 'ko' || this.phase === 'over') return;
    const winner = this.fighters.find((f) => f !== loser);
    this.phase = 'ko';
    this.timer = MC.koSequenceDuration;
    this.result = {
      method: 'KO',
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
