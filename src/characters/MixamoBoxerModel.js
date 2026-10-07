/**
 * MixamoBoxerModel.js
 * ------------------------------------------------------------------
 * Adversaire affiché avec un personnage Mixamo (squelette « mixamorig… ») et
 * de vraies animations de boxe capturées (garde, jab, direct, crochet,
 * uppercut, parades, coups reçus, étourdissement, KO).
 *
 * Animation hybride :
 *  1. BoxerModel calcule la pose « logique » : position des gants sur la
 *     trajectoire qui sert à la détection des coups, tête (esquives), etc. ;
 *  2. un AnimationMixer joue les clips Mixamo : garde/pas en boucle, coups
 *     calés pour que l'impact du clip tombe à l'impact du jeu, réactions
 *     choisies selon la zone et le type du coup reçu, étourdissement, KO ;
 *  3. des corrections procédurales ramènent ensuite le corps sur la logique :
 *     bassin et colonne (la tête suit la tête logique : les esquives se voient
 *     et la zone touchée correspond à ce qu'on voit), bras par IK à deux os
 *     vers les gants logiques (le coude garde la forme du clip), pieds
 *     maintenus au sol. Ces corrections s'effacent pendant les coups reçus
 *     et le KO pour laisser vivre la capture.
 *
 * Les gants de boxe du jeu sont fixés aux mains du personnage.
 * Tant que le fichier n'est pas chargé (ou s'il ne se charge pas), le boxeur
 * en primitives reste affiché.
 */

import {
  Group, Vector3, Quaternion, Matrix4, AnimationMixer, AnimationClip, LoopOnce, LoopRepeat,
  QuaternionKeyframeTrack, VectorKeyframeTrack, Color,
} from 'three';
import { BoxerModel } from './BoxerModel.js';
import { createGlove, disposeGlove, GLOVE_WRIST_OFFSET } from './GloveFactory.js';
import { solveTwoBone, gloveQuaternion } from './Rig.js';
import { loadGlb } from '../core/loadGlb.js';
import { GameConfig } from '../config/GameConfig.js';
import { clamp } from '../core/MathUtils.js';
import { DIRS, directionWeights, movingAmount, blendNeed, pickTier, cycleTime } from './Footwork.js';

import xbotUrl from '../assets/models/characters/xbot.glb?url';

/** Personnages Mixamo disponibles (look.model). */
export const MIXAMO_MODELS = {
  xbot: xbotUrl,
};

/** Hauteur du centre de la tête en garde (repère du boxeur, m) : celle de la tête logique. */
const HEAD_HEIGHT = 1.6;
/** Taille des mains sous les gants. */
const HAND_SCALE = 0.75;
const GLOVE_SCALE = 1.03;

/**
 * Coups → clip, instant de l'impact dans le clip (s), clip miroir (main gauche
 * jouée à partir d'un clip de main droite).
 */
const PUNCH_CLIPS = {
  jab: { clip: 'jab', impact: 0.49 },
  cross: { clip: 'cross', impact: 1.15 },
  hookR: { clip: 'hookR', impact: 0.92 },
  upperR: { clip: 'upperR', impact: 0.63 },
  hookL: { clip: 'hookL', impact: 0.92, mirrorOf: 'hookR' },
  upperL: { clip: 'upperL', impact: 0.63, mirrorOf: 'upperR' },
};
/** Durée de clip jouée avant l'impact (accélérée pour tenir dans l'anticipation du jeu). */
const PUNCH_LEAD = 0.42;
/** Début du clip KO (avant : garde immobile). */
const KO_CLIP_START = 1.05;
/** Relevé : on remonte le clip de chute jusqu'à cet instant (juste avant la chute). */
const KO_RISE_TO = 1.85;
const RISE = GameConfig.knockdown.riseDuration;
/** Relevé : fin du clip laissée de côté (le personnage y reprend sa garde tout seul). */
const GETUP_TAIL = 0.35;
/** Coups reçus : durée de clip jouée avant de rendre la main à la garde. */
const REACT_END = { block: 0.8, hit: 1.05, big: 1.5 };

const B = (n) => `mixamorig${n}`;

const _v = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _s = new Vector3();
const _t = new Vector3();
const _e = new Vector3();
const _p = new Vector3();
const _g = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _qi = new Quaternion();
const _qg = new Quaternion();
const _m = new Matrix4();
const _m2 = new Matrix4();
const _sc = new Vector3();

/* ================================================================
 * Préparation des clips
 * ================================================================ */

/**
 * Clip miroir (gauche ↔ droite) : noms d'os échangés, rotations et translations
 * reflétées en X. Les jambes gardent la pose de garde de `stance` (sinon le
 * boxeur changerait de pied d'appui le temps du coup).
 */
function mirrorClip(clip, name, stance) {
  const swap = (s) => s.replace(/Left|Right/g, (m) => (m === 'Left' ? 'Right' : 'Left'));
  const isLeg = (n) => /(UpLeg|Leg|Foot|ToeBase|Toe_End)\./.test(n);
  const tracks = clip.tracks.map((t) => {
    const n = swap(t.name);
    if (isLeg(n) && stance) {
      const src = stance.tracks.find((x) => x.name === n);
      if (src) {
        const size = src.getValueSize();
        const v0 = Array.from(src.values.slice(0, size));
        const Track = src.constructor;
        return new Track(n, [0, clip.duration], [...v0, ...v0]);
      }
    }
    const v = t.values.slice();
    if (t.name.endsWith('.quaternion')) {
      for (let i = 0; i < v.length; i += 4) {
        v[i + 1] = -v[i + 1];
        v[i + 2] = -v[i + 2];
      }
      // Bassin : rotation atténuée (pieds de garde orthodoxe, le buste fait le travail)
      const src = /Hips\./.test(n) && stance && stance.tracks.find((x) => x.name === n);
      if (src) {
        const q0 = new Quaternion().fromArray(src.values, 0);
        for (let i = 0; i < v.length; i += 4) {
          _q.fromArray(v, i);
          _q2.copy(q0).slerp(_q, 0.3).toArray(v, i);
        }
      }
      return new QuaternionKeyframeTrack(n, t.times.slice(), v);
    }
    if (t.name.endsWith('.position')) {
      for (let i = 0; i < v.length; i += 3) v[i] = -v[i];
      return new VectorKeyframeTrack(n, t.times.slice(), v);
    }
    return t.clone();
  });
  return new AnimationClip(name, clip.duration, tracks);
}

/** Valeur (vecteur) d'une piste à l'instant t (interpolation linéaire). */
function sampleVec(track, t, out) {
  const T = track.times;
  const V = track.values;
  let i = 0;
  while (i < T.length - 1 && T[i + 1] < t) i++;
  const j = Math.min(i + 1, T.length - 1);
  const k = T[j] > T[i] ? clamp((t - T[i]) / (T[j] - T[i]), 0, 1) : 0;
  return out.set(
    V[i * 3] + (V[j * 3] - V[i * 3]) * k,
    V[i * 3 + 1] + (V[j * 3 + 1] - V[i * 3 + 1]) * k,
    V[i * 3 + 2] + (V[j * 3 + 2] - V[i * 3 + 2]) * k,
  );
}

/* ================================================================
 * Modèle
 * ================================================================ */

export class MixamoBoxerModel extends BoxerModel {
  constructor(profile) {
    super(profile);
    this.rig = null;
    this.disposed = false;
    const url = MIXAMO_MODELS[profile.look && profile.look.model];
    this.ready = url
      ? loadGlb(url)
        .then((gltf) => {
          if (this.disposed) return false;
          this._setupRig(gltf, profile);
          return true;
        })
        .catch((err) => {
          console.warn('Boxeur : personnage Mixamo indisponible, modèle simplifié conservé.', err);
          return false;
        })
      : Promise.resolve(false);
  }

  _setupRig(gltf, profile) {
    const scene = gltf.scene;
    const bones = {};
    scene.traverse((o) => {
      if (o.isBone && !bones[o.name]) bones[o.name] = o;
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false; // la boîte englobante ne suit pas l'animation
      }
    });
    const bone = (n) => {
      const b = bones[B(n)];
      if (!b) throw new Error(`os manquant : ${B(n)}`);
      return b;
    };

    // Couleurs : corps clair, articulations aux couleurs du boxeur
    const look = profile.look || {};
    scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) {
        if (/joint/i.test(o.name) || /joint/i.test(m.name)) m.color = new Color(look.shorts || '#1d4fd8');
        else m.color = new Color(look.body || '#c9ccd2');
        m.roughness = 0.45;
        m.metalness = 0.1;
      }
    });

    // --- Clips ---
    const clips = {};
    for (const c of gltf.animations) clips[c.name] = c;
    for (const def of Object.values(PUNCH_CLIPS)) {
      if (def.mirrorOf && clips[def.mirrorOf]) clips[def.clip] = mirrorClip(clips[def.mirrorOf], def.clip, clips.idle);
    }
    for (const n of ['idle', 'step', 'dizzy', 'ko']) if (!clips[n]) throw new Error(`clip manquant : ${n}`);

    const mixer = new AnimationMixer(scene);
    const actions = {};
    const isLoco = (n) => /^step[FBLR][0-9]+$/.test(n);
    for (const [name, clip] of Object.entries(clips)) {
      const a = mixer.clipAction(clip);
      const loop = name === 'idle' || name === 'step' || name === 'dizzy' || isLoco(name);
      a.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
      a.clampWhenFinished = !loop;
      a.enabled = true;
      a.setEffectiveWeight(0);
      if (loop) a.play();
      actions[name] = a;
    }

    // Bassin : position de départ (on retire le déplacement des clips) et
    // instant où le corps est au sol dans le clip KO
    const hipsName = `${B('Hips')}.position`;
    const hipsTrack = (n) => clips[n] && clips[n].tracks.find((t) => t.name === hipsName);
    const idleHips = sampleVec(hipsTrack('idle'), 0, new Vector3());
    const koTrack = hipsTrack('ko');
    let koLie = clips.ko.duration;
    if (koTrack) {
      let minY = Infinity;
      for (let i = 0; i < koTrack.times.length; i++) {
        const y = koTrack.values[i * 3 + 1];
        if (y < minY - 1e-3) {
          minY = y;
          koLie = koTrack.times[i];
        }
      }
    }

    // Pose de repos (T-pose) des os, avant toute animation
    const rest = [];
    scene.traverse((o) => {
      if (o.isBone) rest.push([o, o.position.clone(), o.quaternion.clone()]);
    });

    // --- Mesures sur la pose de garde ---
    actions.idle.setEffectiveWeight(1);
    mixer.update(0);
    scene.updateMatrixWorld(true);
    const headCenter = (out) => {
      const h = bone('Head').getWorldPosition(out);
      const top = bones[B('HeadTop_End')];
      if (top) h.lerp(top.getWorldPosition(_v), 0.45);
      return h;
    };
    const scale = HEAD_HEIGHT / headCenter(new Vector3()).y;

    // --- Jeu de jambes : paliers mesurés sur le déplacement de la racine ---
    // Les clips de pas sont capturés avec leur déplacement. On le mesure ici
    // (en mètres, une fois le personnage à l'échelle du jeu) pour pouvoir
    // choisir l'amplitude et la vitesse de lecture qui collent à la vitesse
    // demandée par le jeu. Le déplacement lui-même est annulé à l'affichage.
    const loco = { f: [], b: [], l: [], r: [] };
    for (const [dir, axis, sign] of [['f', 2, 1], ['b', 2, -1], ['l', 0, 1], ['r', 0, -1]]) {
      for (let i = 1; i <= 9; i++) {
        const name = `step${dir.toUpperCase()}${i}`;
        const clip = clips[name];
        if (!clip) continue;
        const track = hipsTrack(name);
        if (!track) continue;
        const n = track.values.length / 3;
        const d = (track.values[(n - 1) * 3 + axis] - track.values[axis]) * sign;
        const disp = d * scale;
        // Un clip qui ne va pas dans le sens attendu est écarté plutôt que subi
        if (!(disp > 0.02)) continue;
        loco[dir].push({ name, action: actions[name], disp, dur: clip.duration, speed: disp / clip.duration, w: 0 });
      }
      loco[dir].sort((a, b) => a.speed - b.speed);
    }
    const hasLoco = DIRS.some((d) => loco[d].length > 0);

    // Appuis de garde (repère du personnage) : les coups « miroir » gardent ces appuis
    const stance = {};
    for (const side of ['Left', 'Right']) {
      const foot = bone(`${side}Foot`);
      stance[side] = { p: foot.getWorldPosition(new Vector3()), q: foot.getWorldQuaternion(new Quaternion()) };
    }

    // --- Pose de liaison (T-pose) pour fixer les gants aux mains ---
    for (const [o, p, q] of rest) {
      o.position.copy(p);
      o.quaternion.copy(q);
    }
    scene.updateMatrixWorld(true);

    const arms = {};
    for (const [hand, side] of [['left', 'Left'], ['right', 'Right']]) {
      const up = bone(`${side}Arm`);
      const low = bone(`${side}ForeArm`);
      const wr = bone(`${side}Hand`);
      const mid = bones[B(`${side}HandMiddle1`)];
      wr.scale.setScalar(HAND_SCALE);
      wr.updateWorldMatrix(false, true);
      // Gant : jointures dans l'axe des doigts, dos de la main vers le haut (T-pose, paumes en bas)
      const W = wr.getWorldPosition(new Vector3());
      const F = mid ? mid.getWorldPosition(new Vector3()).sub(W).normalize() : new Vector3(hand === 'left' ? 1 : -1, 0, 0);
      const gq = gloveQuaternion(F, _v.set(0, 1, 0), new Quaternion());
      const gp = W.clone().addScaledVector(F, (GLOVE_WRIST_OFFSET * GLOVE_SCALE) / scale);
      _m.compose(gp, gq, _sc.setScalar(GLOVE_SCALE / scale));
      _m2.copy(wr.matrixWorld).invert().multiply(_m);
      const glove = createGlove(hand, profile.gloves || 'cobalt', 1);
      _m2.decompose(glove.position, glove.quaternion, glove.scale);
      wr.add(glove);
      arms[hand] = {
        up, low, wr, glove,
        upDir: low.position.clone().normalize(),
        lowDir: wr.position.clone().normalize(),
        gloveLocalQ: glove.quaternion.clone(),
        gloveLocalP: glove.position.clone(),
      };
    }
    const legs = {};
    for (const side of ['Left', 'Right']) {
      const up = bone(`${side}UpLeg`);
      const low = bone(`${side}Leg`);
      const foot = bone(`${side}Foot`);
      legs[side] = {
        up, low, foot,
        upDir: low.position.clone().normalize(),
        lowDir: foot.position.clone().normalize(),
        footP: new Vector3(), footQ: new Quaternion(), knee: new Vector3(),
        stanceP: stance[side].p, stanceQ: stance[side].q,
      };
    }

    // Conteneur : même repère que le boxeur en primitives (regard vers -Z).
    // Rattaché à la racine (et non au groupe « chute ») : le KO vient du clip.
    const holder = new Group();
    holder.name = 'mixamo-character';
    holder.rotation.y = Math.PI;
    holder.scale.setScalar(scale);
    holder.add(scene);
    this.root.add(holder);

    // Le boxeur en primitives s'efface
    this.fall.visible = false;

    this.rig = {
      holder, scene, mixer, actions, clips, arms, legs, scale,
      hips: bone('Hips'),
      spine: [bone('Spine'), bone('Spine1'), bone('Spine2')],
      head: bone('Head'),
      headTop: bones[B('HeadTop_End')] || null,
      idleHips,
      koLie,
      // Couches « une fois » : { action, w, target, rate, kind, end }
      layers: [],
      punchSerial: { left: -1, right: -1 },
      hitSerial: -1,
      ko: null,
      base: { idle: 1, step: 0, dizzy: 0 },
      // Jeu de jambes : paliers par direction, part lissée de chaque direction,
      // palier retenu (hystérésis) et phase commune à tous les clips actifs
      loco, hasLoco,
      locoShare: { f: 0, b: 0, l: 0, r: 0 },
      locoTier: { f: -1, b: -1, l: -1, r: -1 },
      locoPhase: 0,
      wArm: 1,
      wHead: 1,
      stanceW: 0,
    };
    this.lastHitSerial = -1;
  }

  /* ---------- Animation ---------- */

  update(dt, f, state = {}) {
    super.update(dt, f, state);
    if (this.rig) this._drive(dt, f);
  }

  _layer(name, kind, { time = 0, timeScale = 1, rate = 12, weight = 1 } = {}) {
    const R = this.rig;
    const action = R.actions[name];
    if (!action) return null;
    // Même clip déjà en cours : on le relance
    R.layers = R.layers.filter((l) => l.action !== action);
    action.reset();
    action.time = time;
    action.timeScale = timeScale;
    action.setEffectiveWeight(0);
    action.play();
    const layer = { action, kind, w: 0, target: weight, rate, end: Infinity, data: null };
    R.layers.push(layer);
    return layer;
  }

  _fadeOut(kind, rate = 6) {
    for (const l of this.rig.layers) {
      if (!kind || l.kind === kind) {
        l.target = 0;
        l.rate = rate;
      }
    }
  }

  _drive(dt, f) {
    const R = this.rig;
    const A = R.actions;

    /* ---- Événements : coups lancés, coups reçus, KO ---- */
    if (f.ko) {
      if (!R.ko) {
        this._fadeOut(null, 10);
        // Le clip commence par une seconde de garde : on part du moment où il vacille
        R.ko = this._layer('ko', 'ko', { time: KO_CLIP_START, timeScale: 1.5, rate: 7 });
      }
      if (R.ko && R.ko.action.time >= R.koLie) R.ko.action.timeScale = 0;
    } else if (R.ko) {
      // Relevé après un knockdown : clip de relevé si le fichier en contient un,
      // sinon repli sur le clip de chute rejoué à l'envers.
      const L = R.ko;
      const riseT = f.down ? f.down.riseT : 10;
      if (riseT < RISE) {
        if (!L.rising) {
          L.rising = true;
          if (R.clips.getUp) {
            // Le clip de chute s'efface, le relevé prend la main. Sa fin (reprise
            // de garde) est laissée de côté : la garde du jeu s'en charge.
            L.target = 0;
            L.rate = 1 / Math.max(0.12, RISE * 0.25);
            const span = Math.max(0.3, R.clips.getUp.duration - GETUP_TAIL);
            const g = this._layer('getUp', 'ko', { time: 0, timeScale: span / RISE, rate: 7 });
            if (g) {
              g.rising = true;
              g.end = span;
              R.ko = g;
            }
          } else {
            L.action.time = Math.min(L.action.time, R.koLie);
            L.action.timeScale = -(L.action.time - KO_RISE_TO) / RISE;
          }
        }
        if (riseT > RISE * 0.72 && R.ko) {
          R.ko.target = 0;
          R.ko.rate = 5;
        }
      } else {
        L.target = 0;
        L.rate = 4;
        R.ko = null;
      }
    }

    const hr = f.hitReact;
    if (hr.serial !== R.hitSerial) {
      R.hitSerial = hr.serial;
      if (hr.time < 0.25 && !f.ko) this._onHitClip(hr);
    }

    if (!f.ko) {
      for (const hand of ['left', 'right']) {
        const p = f.punches.hands[hand];
        if (p.active && p.def && p.serial !== R.punchSerial[hand] && (p.phase === 'windup' || p.phase === 'strike')) {
          R.punchSerial[hand] = p.serial;
          this._onPunchClip(p);
        }
      }
      // Coup interrompu (touché pendant l'anticipation…) : le clip s'efface
      for (const l of R.layers) {
        if (l.kind !== 'punch' || l.target === 0) continue;
        const p = l.data;
        if (!p.active || p.serial !== l.serial) {
          l.target = 0;
          l.rate = 5;
        } else if (p.phase === 'hold' || p.phase === 'recovery') {
          // Après l'impact : le clip continue plus vite et s'efface pendant le retour en garde
          if (!l.impacted) {
            l.impacted = true;
            l.action.timeScale = 1.3;
            l.target = 0;
            l.rate = 1 / Math.max(0.15, p.hold + p.recovery);
          }
        }
      }
    }

    /* ---- Poids ---- */
    for (const l of R.layers) {
      if (l.action.time >= l.end && l.target > 0) {
        l.target = 0;
        l.rate = 4;
      }
      l.w += clamp(l.target - l.w, -l.rate * dt, l.rate * dt);
    }
    R.layers = R.layers.filter((l) => {
      if (l.w <= 0.001 && l.target === 0) {
        l.action.setEffectiveWeight(0);
        l.action.stop();
        return false;
      }
      return true;
    });
    let over = 0;
    for (const l of R.layers) over += l.w;
    const norm = over > 1 ? 1 / over : 1;
    for (const l of R.layers) l.action.setEffectiveWeight(l.w * norm);
    const baseW = Math.max(0, 1 - over);

    const k = Math.min(1, dt * 6);
    const stunned = f.isStunned && !f.ko ? 1 : 0;
    R.base.dizzy += (stunned - R.base.dizzy) * k;

    if (R.hasLoco) {
      this._footwork(dt, f, k, baseW);
    } else {
      // Repli : l'ancien clip de pas unique, non directionnel
      const moving = clamp(f.moveSpeed / 2.2, 0, 1);
      R.base.step += (moving * 0.55 * (1 - R.base.dizzy) - R.base.step) * k;
      R.base.idle = 1 - R.base.dizzy - R.base.step;
      A.step.setEffectiveWeight(baseW * R.base.step);
      A.step.timeScale = 0.8 + moving * 0.6;
    }
    A.idle.setEffectiveWeight(baseW * R.base.idle);
    A.dizzy.setEffectiveWeight(baseW * R.base.dizzy);

    // Poids des corrections : les coups reçus et le KO laissent jouer la capture
    let react = 0;
    for (const l of R.layers) if (l.kind === 'react') react = Math.max(react, l.w * (l.data ? 0.35 : 1));
    // Max sur toutes les couches « ko » : pendant la bascule chute → relevé, les
    // deux clips coexistent et les corrections ne doivent pas revenir d'un coup.
    const koW = R.layers.reduce((m, l) => (l.kind === 'ko' ? Math.max(m, l.w) : m), 0);
    const celebrate = this.celebrate;
    let wArm = 1 - react * 0.75 - R.base.dizzy * 0.5;
    let wHead = 1 - react * 0.65 - R.base.dizzy * 0.45;
    wArm = Math.max(wArm * (1 - koW), celebrate);
    wHead *= 1 - koW;
    R.wArm += (wArm - R.wArm) * Math.min(1, dt * 14);
    R.wHead += (wHead - R.wHead) * Math.min(1, dt * 14);

    // Coups « miroir » : les pieds restent sur les appuis de garde
    R.stanceW = 0;
    for (const l of R.layers) if (l.kind === 'punch' && l.mirror) R.stanceW = Math.max(R.stanceW, l.w);

    /* ---- Clips ---- */
    R.mixer.update(dt);

    // Le jeu déplace le boxeur : on retire le déplacement horizontal des clips (sauf KO)
    const hips = R.hips;
    // Au tapis : le corps reste près de sa position logique (le clip l'emmène loin sur le côté)
    const free = clamp(koW, 0, 1) * 0.3;
    hips.position.x += (R.idleHips.x - hips.position.x) * (1 - free);
    hips.position.z += (R.idleHips.z - hips.position.z) * (1 - free);
    R.holder.updateMatrixWorld(true);

    /* ---- Corrections procédurales ---- */
    this._correctBody(R.wHead);
    this._driveArms(R.wArm);
  }

  /**
   * Jeu de jambes : répartit le déplacement sur les clips de pas, choisit
   * l'amplitude de chaque direction et garde les clips actifs en phase.
   *
   * La phase est pilotée à la main (`timeScale = 0`, `time` posé à chaque
   * image) : c'est le seul moyen de garantir que deux clips mélangés restent
   * exactement au même point de leur cycle. Laissés au mixer, ils dérivent et
   * les jambes se contredisent (un clip pose le pied droit pendant que l'autre
   * le lève).
   */
  _footwork(dt, f, k, baseW) {
    const R = this.rig;
    // Vitesse dans le repère du boxeur : avant = forwardFromYaw, droite = rightFromYaw
    const c = Math.cos(f.yaw);
    const s = Math.sin(f.yaw);
    const vf = -f.velocity.x * s - f.velocity.z * c;
    const vr = f.velocity.x * c - f.velocity.z * s;
    const w = directionWeights(vf, vr);
    const moving = movingAmount(w.speed) * (1 - R.base.dizzy);

    const active = [];
    for (const d of DIRS) {
      R.locoShare[d] += (w[d] * moving - R.locoShare[d]) * k;
      const tiers = R.loco[d];
      for (const t of tiers) t.w = 0;
      const share = R.locoShare[d];
      if (!tiers.length || share < 0.01) {
        R.locoTier[d] = -1;
        continue;
      }
      // Vitesse demandée : la composante le long de cette direction, rapportée
      // au poids du clip dans le mélange (voir Footwork.blendNeed)
      const need = blendNeed(d === 'f' || d === 'b' ? vf : vr, share);
      const i = pickTier(tiers, need, R.locoTier[d]);
      R.locoTier[d] = i;
      const tier = tiers[i];
      tier.w = share;
      active.push({ tier, share, need, disp: tier.disp, dur: tier.dur });
    }

    const cycle = cycleTime(active);
    if (cycle > 0) R.locoPhase = (R.locoPhase + dt / cycle) % 1;

    let total = 0;
    for (const a of active) total += a.share;
    for (const d of DIRS) {
      for (const t of R.loco[d]) {
        if (t.w <= 0) {
          t.action.setEffectiveWeight(0);
          continue;
        }
        t.action.timeScale = 0;
        t.action.time = R.locoPhase * t.dur;
        t.action.setEffectiveWeight(baseW * t.w);
      }
    }
    R.base.step = 0;
    if (R.actions.step) R.actions.step.setEffectiveWeight(0);
    // La garde ne comble que ce que le jeu de jambes ne couvre pas : la mélanger
    // davantage diluerait les pas et ferait patiner les pieds.
    R.base.idle = Math.max(0, 1 - R.base.dizzy - total);
  }

  _onPunchClip(p) {
    const def = PUNCH_CLIPS[p.def.id];
    const R = this.rig;
    if (!def || !R.actions[def.clip]) return;
    // Les autres coups s'effacent
    for (const l of R.layers) {
      if (l.kind === 'punch') {
        l.target = 0;
        l.rate = 8;
      }
    }
    const toImpact = Math.max(0.05, (p.phase === 'windup' ? p.windup - p.time : 0) + p.strike - (p.phase === 'strike' ? p.time : 0));
    const lead = Math.min(PUNCH_LEAD, def.impact);
    const timeScale = clamp(lead / toImpact, 0.6, 3);
    const start = Math.max(0, def.impact - toImpact * timeScale);
    const l = this._layer(def.clip, 'punch', { time: start, timeScale, rate: 14, weight: 1 });
    if (!l) return;
    l.data = p;
    l.serial = p.serial;
    l.mirror = !!def.mirrorOf;
    l.impacted = false;
  }

  _onHitClip(hr) {
    const R = this.rig;
    const n = hr.serial;
    let clip;
    let weight = 1;
    if (hr.blocked) {
      clip = hr.kind === 'straight' ? 'blockC' : hr.side > 0 ? 'blockL' : 'blockR';
      weight = 0.8;
    } else if (hr.zone === 'body') clip = n % 2 ? 'bodyHit1' : 'bodyHit2';
    else if (hr.kind === 'uppercut') {
      // Uppercut critique : la grosse réaction si le fichier la contient
      if (hr.strength > 1.2) clip = R.actions.upperHitBig ? 'upperHitBig' : 'upperHitHeavy';
      else clip = 'upperHitLight';
    } else clip = ['headHit1', 'headHit2', 'headHit3'][n % 3];
    if (!R.actions[clip]) return;
    this._fadeOut('punch', 10);
    this._fadeOut('react', 10);
    const dur = R.clips[clip].duration;
    const l = this._layer(clip, 'react', {
      time: hr.blocked ? 0.12 : 0.04,
      timeScale: hr.blocked ? 1.6 : 1.25,
      rate: 16,
      weight,
    });
    if (!l) return;
    l.data = hr.blocked ? 'block' : null;
    // Fin anticipée : on rend la main avant le long retour en garde du clip.
    // La grosse réaction d'uppercut garde plus de temps : c'est un encaissement
    // qui doit se voir jusqu'au bout du déséquilibre.
    const span = hr.blocked ? REACT_END.block : clip === 'upperHitBig' ? REACT_END.big : REACT_END.hit;
    l.end = Math.min(dur - 0.25, span);
  }

  /* ---------- Corrections ---------- */

  /** Centre de la tête du personnage (monde). */
  _headCenter(out) {
    const R = this.rig;
    R.head.getWorldPosition(out);
    if (R.headTop) out.lerp(R.headTop.getWorldPosition(_v), 0.45);
    return out;
  }

  _correctBody(w) {
    const R = this.rig;
    if (w < 0.01) return;
    // Pieds du clip, avant de déplacer le bassin
    for (const L of Object.values(R.legs)) {
      L.foot.getWorldPosition(L.footP);
      L.foot.getWorldQuaternion(L.footQ);
      L.low.getWorldPosition(L.knee);
      if (R.stanceW > 0) {
        L.footP.lerp(R.scene.localToWorld(_v.copy(L.stanceP)), R.stanceW);
        L.footQ.slerp(R.scene.getWorldQuaternion(_q).multiply(L.stanceQ), R.stanceW);
      }
    }

    // Bassin : décalage horizontal logique + hauteur pour que la tête tombe juste
    this._headCenter(_a);
    this.head.getWorldPosition(_t); // tête logique
    this.pelvis.getWorldPosition(_p);
    const hips = R.hips;
    hips.getWorldPosition(_b);
    // horizontal : bassin logique relatif à la racine
    _v.set(_p.x - this.root.position.x, 0, _p.z - this.root.position.z);
    // la référence : le bassin du clip relatif à la racine
    _g.set(_b.x - this.root.position.x, 0, _b.z - this.root.position.z);
    _v.sub(_g).multiplyScalar(w * 0.5);
    _v.y = clamp(_t.y - _a.y, -0.35, 0.12) * w;
    _b.add(_v);
    hips.position.copy(hips.parent.worldToLocal(_b));
    hips.updateWorldMatrix(false, true);

    // Colonne : rotation qui amène la tête du personnage sur la tête logique
    const pivot = R.spine[0].getWorldPosition(_s);
    this._headCenter(_a).sub(pivot);
    _b.copy(_t).sub(pivot);
    if (_a.lengthSq() > 1e-6 && _b.lengthSq() > 1e-6) {
      _q.setFromUnitVectors(_a.normalize(), _b.normalize());
      _q2.identity().slerp(_q, w / R.spine.length);
      for (const b of R.spine) this._rotateWorld(b, _q2);
    }

    // Jambes : pieds maintenus là où le clip les pose
    for (const L of Object.values(R.legs)) {
      L.up.getWorldPosition(_s);
      const l1 = _s.distanceTo(L.knee);
      const l2 = L.knee.distanceTo(L.footP);
      _e.copy(L.knee);
      // pôle : le genou du clip, un peu vers l'avant
      solveTwoBone(_s, L.footP, l1 || 0.4, l2 || 0.4, L.knee, _e);
      this._aim(L.up, L.upDir, _e);
      this._aim(L.low, L.lowDir, L.footP);
      this._setWorldQuaternion(L.foot, L.footQ);
    }
  }

  _driveArms(w) {
    const R = this.rig;
    if (w < 0.01) return;
    this.body.getWorldQuaternion(_qg);
    for (const hand of ['left', 'right']) {
      const L = R.arms[hand];
      const arm = this.arms[hand];
      // Main du clip
      L.up.getWorldPosition(_s);
      L.low.getWorldPosition(_e);
      L.wr.getWorldPosition(_a);
      L.wr.getWorldQuaternion(_qi);
      const l1 = _s.distanceTo(_e);
      const l2 = _e.distanceTo(_a);
      const pole = _p.copy(_e);

      // Gant logique (monde) → main visée : main = gant ∘ (gant dans le repère de la main)⁻¹
      this.body.localToWorld(_g.copy(arm.glove.position));
      _q.copy(_qg).multiply(arm.quat); // orientation monde du gant
      _q2.copy(L.gloveLocalQ).invert();
      _q.multiply(_q2); // orientation monde de la main
      L.wr.getWorldScale(_sc);
      _t.copy(L.gloveLocalP).multiply(_sc).applyQuaternion(_q);
      _t.subVectors(_g, _t); // position monde de la main

      // Mélange capture ↔ logique
      _t.lerpVectors(_a, _t, w);
      _q.slerpQuaternions(_qi, _q, w);

      // Hors de portée : la main s'arrête au bout du bras
      _v.copy(_t).sub(_s);
      const reach = (l1 + l2) * 0.998;
      if (_v.length() > reach) _t.copy(_s).addScaledVector(_v.normalize(), reach);

      solveTwoBone(_s, _t, l1, l2, pole, _e);
      this._aim(L.up, L.upDir, _e);
      this._aim(L.low, L.lowDir, _t);
      this._setWorldQuaternion(L.wr, _q);
    }
  }

  /* ---------- Outils ---------- */

  _rotateWorld(bone, qWorld) {
    bone.getWorldQuaternion(_qi);
    _qi.premultiply(qWorld);
    this._setWorldQuaternion(bone, _qi);
  }

  _setWorldQuaternion(bone, qWorld) {
    bone.parent.getWorldQuaternion(_m2q);
    bone.quaternion.copy(_m2q.invert().multiply(qWorld));
    bone.updateWorldMatrix(false, true);
  }

  /** Oriente un os pour que sa direction de repos pointe vers `target` (monde). */
  _aim(bone, restDir, target) {
    bone.getWorldPosition(_aimP);
    bone.getWorldQuaternion(_aimQ);
    _aimA.copy(restDir).applyQuaternion(_aimQ).normalize();
    _aimB.copy(target).sub(_aimP);
    if (_aimB.lengthSq() < 1e-10) return;
    _aimB.normalize();
    _aimR.setFromUnitVectors(_aimA, _aimB);
    _aimQ.premultiply(_aimR);
    this._setWorldQuaternion(bone, _aimQ);
  }

  dispose() {
    this.disposed = true;
    if (this.rig) {
      this.rig.mixer.stopAllAction();
      for (const a of Object.values(this.rig.arms)) disposeGlove(a.glove);
      this.rig.scene.traverse((o) => {
        if (!o.isMesh || (o.parent && o.parent.name.startsWith('glove-'))) return; // gants : géométries partagées
        o.geometry.dispose();
        for (const m of [].concat(o.material)) m.dispose();
      });
    }
    super.dispose();
  }
}

// Temporaires réservés aux outils (évite les conflits avec ceux des corrections)
const _m2q = new Quaternion();
const _aimP = new Vector3();
const _aimA = new Vector3();
const _aimB = new Vector3();
const _aimQ = new Quaternion();
const _aimR = new Quaternion();
