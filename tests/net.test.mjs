/**
 * Netcode : la simulation en ligne doit être déterministe et rejouable.
 * node --test tests/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OnlineWorld } from '../src/net/OnlineWorld.js';
import { captureState, restoreState } from '../src/net/SimState.js';
import { packCommand, predictCommand, sameCommand, NO_COMMAND } from '../src/net/Command.js';
import { BOXERS } from '../src/config/Boxers.js';

const profiles = [
  { ...BOXERS.player, name: 'Hôte', look: { ...BOXERS.player.look, model: 'beach' } },
  { ...BOXERS.player, name: 'Invité', gloves: 'cobalt', look: { ...BOXERS.player.look, model: 'worker' } },
];

/** Générateur de commandes « humaines » reproductible (indépendant du jeu). */
function bot(seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  let yaw = 0; let pitch = 0; let hold = { mx: 0, mz: 1, guard: false, dodgeHeld: false };
  return (world, me) => {
    const f = world.fighters[me];
    const o = world.fighters[1 - me];
    // regarde l'adversaire avec un peu de bruit
    yaw = Math.atan2(-(o.position.x - f.position.x), -(o.position.z - f.position.z)) + (rnd() - 0.5) * 0.2;
    pitch += (rnd() - 0.5) * 0.05; pitch = Math.max(-0.5, Math.min(0.3, pitch));
    if (rnd() < 0.05) hold = { mx: Math.floor(rnd() * 3) - 1, mz: Math.floor(rnd() * 3) - 1, guard: rnd() < 0.3, dodgeHeld: rnd() < 0.05 };
    const punches = rnd() < 0.08 ? 1 << Math.floor(rnd() * 6) : 0;
    return packCommand({ ...hold, dirPressed: rnd() < 0.02, duck: rnd() < 0.01, dodge: rnd() < 0.01, punches, yaw, pitch });
  };
}

function makeWorld() {
  const w = new OnlineWorld({ profiles, rounds: 2, roundDuration: 20 });
  w.start(12345);
  return w;
}

test('deux simulations avec les mêmes commandes restent identiques', () => {
  const A = makeWorld(); const B = makeWorld();
  // réglages locaux différents chez les deux joueurs : sans effet sur la simulation
  for (const f of B.fighters) { f.aimAssist = true; f.sensitivity = 2.5; f.invertY = true; }
  const b0 = bot(1); const b1 = bot(2);
  let landed = 0;
  for (let t = 0; t < 60 * 70 && !A.over; t++) {
    const cmds = [b0(A, 0), b1(A, 1)];
    A.step(cmds); B.step(cmds);
    landed += A.drain().filter((e) => e.type === 'punch:land').length; B.drain();
    if (t % 30 === 0) assert.equal(JSON.stringify(captureState(B)), JSON.stringify(captureState(A)), `écart au tick ${A.tick}`);
  }
  assert.ok(landed > 5, `le combat doit avoir lieu (coups touchés : ${landed})`);
  assert.equal(JSON.stringify(captureState(B)), JSON.stringify(captureState(A)));
});

test('photographie → restauration → photographie identique', () => {
  const A = makeWorld();
  const b0 = bot(3); const b1 = bot(4);
  for (let t = 0; t < 60 * 15; t++) A.step([b0(A, 0), b1(A, 1)]);
  const s1 = captureState(A);
  const json = JSON.stringify(s1);
  const B = makeWorld();
  restoreState(B, JSON.parse(json));
  assert.equal(JSON.stringify(captureState(B)), json);
  // et la suite est la même
  const c0 = bot(5); const c1 = bot(6);
  for (let t = 0; t < 600; t++) { const cmds = [c0(A, 0), c1(A, 1)]; A.step(cmds); B.step(cmds); }
  assert.equal(JSON.stringify(captureState(B)), JSON.stringify(captureState(A)));
});

test('rollback : prédiction fausse puis correction = même combat', () => {
  const truth = makeWorld();
  const b0 = bot(7); const b1 = bot(8);
  const real = [];
  const truthSnaps = [captureState(truth)];
  for (let t = 0; t < 60 * 40; t++) { real.push([b0(truth, 0), b1(truth, 1)]); truth.step(real[t]); truthSnaps.push(captureState(truth)); }

  // Le joueur 0 reçoit les commandes de l'adversaire avec DELAY ticks de retard
  const DELAY = 8;
  const local = makeWorld();
  const known = [];      // commandes adverses reçues
  const used = [];       // commande adverse utilisée pour chaque tick simulé
  const snaps = [captureState(local)]; // snaps[t] = état avant le tick t
  let top = -1;          // dernier tick dont la commande adverse est connue (sans trou)
  let rolls = 0;
  const theirs = (k) => (known[k] !== undefined ? known[k] : predictCommand(top >= 0 ? known[top] : NO_COMMAND));
  const simTick = (k) => { used[k] = theirs(k); local.step([real[k][0], used[k]]); snaps[k + 1] = captureState(local); };
  const receive = (r) => {
    known[r] = real[r][1];
    while (known[top + 1] !== undefined) top++;
    return used[r] !== undefined && !sameCommand(used[r], known[r]) ? r : Infinity;
  };
  const rollback = (from, cur) => {
    rolls++;
    restoreState(local, snaps[from]);
    for (let k = from; k < cur; k++) simTick(k);
  };
  for (let t = 0; t < real.length; t++) {
    const from = t - DELAY >= 0 ? receive(t - DELAY) : Infinity;
    if (from < t) rollback(from, t);
    simTick(t);
  }
  let from = Infinity;
  for (let r = real.length - DELAY; r < real.length; r++) from = Math.min(from, receive(r));
  if (from < real.length) rollback(from, real.length);
  assert.ok(rolls > 10, `des corrections doivent avoir eu lieu (${rolls})`);
  if (process.env.DIFF) {
    const J = (x) => JSON.stringify(x, (k, v) => (Object.is(v, -0) ? '-0' : v));
    for (let t = 0; t <= real.length; t++) if (J(snaps[t]) !== J(truthSnaps[t])) {
      const walk = (x, y, p) => { if (J(x) === J(y)) return; if (x && y && typeof x === 'object' && typeof y === 'object') { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], p + '.' + k); } else console.log('DIFF  ', p, J(x), J(y)); };
      walk(truthSnaps[t], snaps[t], ''); console.log('DIFF premier tick faux', t, 'used=', JSON.stringify(used[t - 1]), 'real=', JSON.stringify(real[t - 1][1]), 'known=', JSON.stringify(known[t - 1])); break; }
    const a = captureState(truth); const b = captureState(local);
    const walk = (x, y, p) => { if (JSON.stringify(x) === JSON.stringify(y)) return; if (x && y && typeof x === 'object' && typeof y === 'object') { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], p + '.' + k); } else console.log('DIFF', p, JSON.stringify(x)?.slice(0, 60), JSON.stringify(y)?.slice(0, 60)); };
    walk(a, b, '');
  }
  assert.equal(JSON.stringify(captureState(local)), JSON.stringify(captureState(truth)));
});

test('knockdown en ligne : compte, relevé en martelant, rollback pendant le compte', () => {
  // Le joueur 0 frappe sans arrêt ; le joueur 1 ne se défend pas, puis martèle ses coups au tapis
  const attacker = (world) => {
    const f = world.fighters[0];
    const o = world.fighters[1];
    const yaw = Math.atan2(-(o.position.x - f.position.x), -(o.position.z - f.position.z));
    const d = Math.hypot(o.position.x - f.position.x, o.position.z - f.position.z);
    const punches = world.tick % 14 === 0 ? 1 << (world.tick % 28 === 0 ? 1 : 2) : 0;
    return packCommand({ mx: 0, mz: d > 0.95 ? 1 : 0, guard: false, dodgeHeld: false, dirPressed: false, duck: false, dodge: false, punches, yaw, pitch: 0 });
  };
  const victim = (world) => {
    const f = world.fighters[1];
    const mash = f.ko && world.tick % 4 === 0 ? 1 : 0;
    return packCommand({ mx: 0, mz: 0, guard: false, dodgeHeld: false, dirPressed: false, duck: false, dodge: false, punches: mash, yaw: f.yaw, pitch: 0 });
  };
  const A = makeWorld();
  const seen = new Set();
  let snapAt = null;
  let snap = null;
  const cmds = [];
  for (let t = 0; t < 60 * 60 && !A.over; t++) {
    const c = [attacker(A), victim(A)];
    cmds.push(c);
    A.step(c);
    for (const e of A.drain()) seen.add(e.type);
    if (!snap && A.rounds.phase === 'count' && A.rounds.count.n === 2) {
      snap = JSON.stringify(captureState(A));
      snapAt = cmds.length;
    }
    if (seen.has('count:end')) break;
  }
  assert.ok(seen.has('fighter:down'), 'un knockdown doit arriver');
  assert.ok(seen.has('count:tick'), "l'arbitre doit compter");
  assert.ok(seen.has('count:up'), 'le joueur qui martèle doit se relever');
  assert.ok(seen.has('count:end'), 'le combat doit reprendre après le compte');
  assert.equal(A.rounds.phase, 'fighting');
  assert.ok(A.fighters[1].hp > 0 && !A.fighters[1].ko);

  // Rejouer depuis une photo prise pendant le compte donne le même état
  const B = makeWorld();
  restoreState(B, JSON.parse(snap));
  for (let i = snapAt; i < cmds.length; i++) B.step(cmds[i]);
  assert.equal(JSON.stringify(captureState(B)), JSON.stringify(captureState(A)));
});
