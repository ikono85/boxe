/**
 * MatchStats.js
 * ------------------------------------------------------------------
 * Statistiques d'un boxeur pendant un match (affichées à la fin et utilisées
 * par les juges et par le « conseil du coin » entre les rounds).
 */

export class FighterStats {
  constructor() {
    this.reset();
  }

  reset() {
    this.thrown = 0;
    this.landed = 0; // coups propres
    this.blockedByOpponent = 0; // mes coups bloqués
    this.missed = 0;
    this.head = 0;
    this.body = 0;
    this.power = 0; // coups puissants touchés
    this.damage = 0;
    this.crits = 0;
    this.counters = 0;
    this.dodges = 0; // esquives réussies
    this.blocks = 0; // coups adverses bloqués
    this.combos = 0;
    this.bestCombo = null;
    this.stuns = 0; // étourdissements infligés
    this.downs = 0; // knockdowns subis
    this.score = 0;
    this.byType = { jab: 0, cross: 0, hookL: 0, hookR: 0, upperL: 0, upperR: 0 };
    this.thrownByType = { jab: 0, cross: 0, hookL: 0, hookR: 0, upperL: 0, upperR: 0 };
    this.rounds = [];
  }

  round(index) {
    while (this.rounds.length <= index) {
      this.rounds.push({ thrown: 0, landed: 0, power: 0, damage: 0, blocks: 0, dodges: 0, downs: 0 });
    }
    return this.rounds[index];
  }

  get accuracy() {
    return this.thrown ? this.landed / this.thrown : 0;
  }
}
