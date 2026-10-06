/**
 * OnlineWorld.js
 * ------------------------------------------------------------------
 * La simulation d'un combat en ligne : deux boxeurs humains, le combat, les
 * rounds. Elle avance par pas fixes (60 par seconde) et ne dépend que des
 * commandes reçues : les deux navigateurs calculent le même combat.
 *
 *  - fighters[0] = l'hôte, coin rouge (côté +Z) ; fighters[1] = l'invité, coin bleu ;
 *  - un bus d'événements propre à la simulation : les règles qui modifient
 *    l'état (KO → fin du match, intro de round → replacement et récupération)
 *    sont branchées ici, pas dans l'affichage ;
 *  - les événements d'un tick sont mis de côté (`drain()`) : le netcode les
 *    présente une seule fois, même si le tick est recalculé après une correction ;
 *  - le générateur aléatoire est restauré avant chaque tick : rien hors de la
 *    simulation (affichage, public…) ne peut décaler ses tirages.
 */

import { Vector3 } from 'three';
import { EventBus } from '../core/EventBus.js';
import { getRandomState, setRandomState } from '../core/Random.js';
import { GameConfig } from '../config/GameConfig.js';
import { Player } from '../game/Player.js';
import { CombatSystem } from '../game/CombatSystem.js';
import { RoundSystem } from '../game/RoundSystem.js';
import { unpackCommand, emptyCommand } from './Command.js';

export const SIM_HZ = 60;
export const DT = 1 / SIM_HZ;

const START = [new Vector3(0, 0, 1.45), new Vector3(0, 0, -1.45)];
const START_YAW = [0, Math.PI];

const _cmds = [emptyCommand(), emptyCommand()];

export class OnlineWorld {
  /**
   * @param {object} opts
   * @param {object[]} opts.profiles profils des deux boxeurs (hôte, invité)
   * @param {number} opts.rounds nombre de rounds
   * @param {number} opts.roundDuration durée d'un round (s)
   */
  constructor({ profiles, rounds, roundDuration }) {
    this.bus = new EventBus();
    this.fighters = profiles.map((profile, i) => {
      const f = new Player({ id: `net${i}`, profile, events: this.bus });
      f.name = profile.name;
      f.aimAssist = false; // l'aide à la visée n'agit que sur la vue locale (Game)
      f.targetCone = GameConfig.aim.assistCone; // même ciblage pour les deux joueurs
      return f;
    });
    const [a, b] = this.fighters;
    this.combat = new CombatSystem(this.bus);
    this.combat.setFighters(a, b);
    this.rounds = new RoundSystem(this.bus);
    this.rounds.configure({ rounds, roundDuration, breakDuration: GameConfig.match.breakDuration });
    this.tick = 0;
    this.rng = 1;
    this.evc = {}; // compteurs d'événements (clés de présentation)
    this.queue = [];

    // Événements : mis de côté pour l'affichage
    const emit = this.bus.emit.bind(this.bus);
    this.bus.emit = (type, payload) => {
      emit(type, payload);
      this.queue.push({ type, payload });
    };

    // --- Règles de la simulation (et non de l'affichage) ---
    this.bus.on('fighter:ko', ({ fighter }) => this.rounds.registerKO(fighter));
    this.bus.on('round:intro', ({ round }) => {
      if (round > 1) {
        for (const f of this.fighters) {
          f.stamina.recover(GameConfig.match.breakStaminaRecovery);
          f.hp = Math.min(f.maxHp, f.hp + (f.maxHp - f.hp) * GameConfig.match.breakHpRecovery);
        }
      }
      this.fighters.forEach((f, i) => f.placeAt(START[i], START_YAW[i]));
    });
  }

  /** Remise à zéro et premier round. `seed` : tirages identiques chez les deux joueurs. */
  start(seed) {
    setRandomState(seed);
    this.fighters.forEach((f, i) => {
      f.matchStats.reset();
      f.reset(START[i], START_YAW[i]);
      f.frozen = true;
    });
    this.tick = 0;
    this.evc = {};
    this.queue.length = 0;
    this.rounds.start(this.fighters);
    this.rng = getRandomState();
  }

  /**
   * Un tick de simulation.
   * @param {Array<number[]>} packed commandes empaquetées [hôte, invité]
   */
  step(packed) {
    setRandomState(this.rng);
    const r = this.rounds;
    const active = r.combatActive;
    const [a, b] = this.fighters;
    for (const f of this.fighters) {
      f.frozen = !active;
      f.lookLocked = r.phase === 'intro';
    }
    a.applyCommand(unpackCommand(packed[0], _cmds[0]), DT);
    b.applyCommand(unpackCommand(packed[1], _cmds[1]), DT);
    a.update(DT);
    b.update(DT);
    if (active) this.combat.update();
    r.update(DT);
    this.tick++;
    this.rng = getRandomState();
  }

  /** Événements produits depuis le dernier appel. */
  drain() {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  get over() {
    return this.rounds.phase === 'over';
  }

  get result() {
    return this.rounds.result;
  }

  /** Index (0 / 1) d'un boxeur, -1 sinon. */
  indexOf(f) {
    return this.fighters.indexOf(f);
  }
}

/**
 * Clé de présentation d'un événement : type, boxeur concerné et rang de
 * l'événement dans le match. Un tick recalculé produit les mêmes clés : ce qui
 * a déjà été montré (son, effet) ne l'est pas deux fois.
 */
export function eventKey(world, e) {
  const p = e.payload || {};
  const who = p.fighter || p.attacker || p.defender || p.loser || null;
  const k0 = `${e.type}:${who ? world.indexOf(who) : ''}:${p.round != null ? p.round : ''}`;
  const n = (world.evc[k0] = (world.evc[k0] || 0) + 1);
  return `${k0}:${n}`;
}
