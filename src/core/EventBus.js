/**
 * EventBus.js
 * ------------------------------------------------------------------
 * Bus d'événements minimal. Les systèmes de jeu émettent des événements
 * (coup porté, bloqué, KO, round…) et l'audio, le HUD et les effets s'y
 * abonnent : aucun système n'a besoin de connaître les autres.
 *
 * Principaux événements :
 *   punch:start   { fighter, punch }            début d'un coup (anticipation)
 *   punch:strike  { fighter, punch }            le gant part
 *   punch:land    { attacker, defender, ... }   coup qui touche
 *   punch:blocked { attacker, defender, ... }   coup bloqué
 *   punch:whiff   { attacker, defender, punch, dodged }
 *   dodge:start   { fighter, type }
 *   fighter:stunned / fighter:ko / guard:break
 *   combo         { fighter, combo }
 *   round:intro / round:start / round:end / round:break / match:end
 */

export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const set = this.listeners.get(type);
    if (set) set.delete(fn);
  }

  emit(type, payload) {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of set) fn(payload);
  }

  clear() {
    this.listeners.clear();
  }
}
