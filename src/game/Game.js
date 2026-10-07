/**
 * Game.js
 * ------------------------------------------------------------------
 * Chef d'orchestre du jeu.
 *
 * États : 'menu' (salle en démonstration) → 'fight' ⇄ 'paused' → 'results'
 *
 * Boucle (requestAnimationFrame) :
 *   1. temps réel → temps de jeu (gel d'image à l'impact, ralenti du KO) ;
 *   2. entrées du joueur, IA, logique des boxeurs, combat, rounds ;
 *   3. animations (poings FPS, modèle adverse), caméra, salle, effets, HUD ;
 *   4. rendu.
 *
 * Les systèmes communiquent par le bus d'événements : ce fichier abonne le
 * son, les effets et le HUD aux événements de combat.
 */

import {
  WebGLRenderer, Scene, PerspectiveCamera, ACESFilmicToneMapping, SRGBColorSpace, Vector3, Mesh,
  CapsuleGeometry, MeshBasicMaterial,
} from 'three';
import { EventBus } from '../core/EventBus.js';
import { Input } from '../core/Input.js';
import { GameConfig } from '../config/GameConfig.js';
import { BOXERS, opponentFor } from '../config/Boxers.js';
import { DIFFICULTIES } from '../config/Difficulty.js';
import { buildAIProfile } from '../config/Styles.js';
import { Player } from './Player.js';
import { Opponent } from './Opponent.js';
import { CombatSystem } from './CombatSystem.js';
import { RoundSystem } from './RoundSystem.js';
import { AI } from './AI.js';
import { Arena } from '../world/Arena.js';
import { Referee } from '../world/Referee.js';
import { createBoxerModel } from '../characters/createBoxerModel.js';
import { FirstPersonArms } from '../characters/FirstPersonArms.js';
import { CameraRig } from '../fx/CameraRig.js';
import { ImpactEffects } from '../fx/ImpactEffects.js';
import { ScreenEffects } from '../fx/ScreenEffects.js';
import { AudioManager } from '../audio/AudioManager.js';
import { HUD } from '../ui/HUD.js';
import { Menu } from '../ui/Menu.js';
import { PauseMenu } from '../ui/PauseMenu.js';
import { ResultScreen } from '../ui/ResultScreen.js';
import { RoundOverlay } from '../ui/RoundOverlay.js';
import { PadNav } from '../ui/PadNav.js';
import { clock } from '../ui/dom.js';
import { clamp } from '../core/MathUtils.js';
import { OnlinePanel } from '../ui/OnlinePanel.js';
import { OnlineWorld } from '../net/OnlineWorld.js';
import { packCommand, pressedMask, commandFromInput, emptyCommand } from '../net/Command.js';

const START_PLAYER = new Vector3(0, 0, 1.45);
const START_OPPONENT = new Vector3(0, 0, -1.45);
const SCORE_MULT = { beginner: 1, intermediate: 1.5, expert: 2.2 };
/** Compte de l'arbitre (synthèse vocale du navigateur, si disponible). */
const COUNT_WORDS = ['Un', 'Deux', 'Trois', 'Quatre', 'Cinq', 'Six', 'Sept', 'Huit', 'Neuf', 'Dix'];

const _v = new Vector3();
const _right = new Vector3();

export class Game {
  constructor({ canvas, uiRoot, settings }) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.settings = settings;
    this.events = new EventBus();
    this.state = 'loading';
    this.hitStop = 0;
    this.slowMo = { time: 0, scale: 1 };
    this.time = 0;
    this.lastFrame = 0;
    this.fps = { frames: 0, time: 0, value: 60 };
    this.msgTimes = {};
    this.heartTimer = 0;
    this.breathTimer = 0;
    this.crowdTimer = 0;
    this.lastExhausted = false;
    this.matchActive = false;
    this.needsRender = true;
    // En ligne : session, monde simulé, vue locale (le regard suit la souris tout de suite)
    this.online = null;
    this.offline = null;
    this.view = { yaw: 0, pitch: 0 };
    this.pendingPressed = 0;
    this.quitOpen = false;
    this._cmd = emptyCommand();

    // --- Rendu ---
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new Scene();
    const C = GameConfig.camera;
    this.camera = new PerspectiveCamera(C.fov, 1, C.near, C.far);
    this.scene.add(this.camera);

    // --- Monde ---
    this.arena = new Arena(this.scene);
    this.effects = new ImpactEffects(this.scene);

    // --- Boxeurs ---
    this.player = new Player({ id: 'player', profile: BOXERS.player, events: this.events });
    this.difficulty = DIFFICULTIES[settings.get('difficulty')] || DIFFICULTIES.intermediate;
    this.opponent = new Opponent({ id: 'opponent', profile: opponentFor(settings.get('opponent'), this.difficulty), events: this.events });
    this.combat = new CombatSystem(this.events);
    this.combat.setFighters(this.player, this.opponent);
    this.rounds = new RoundSystem(this.events);
    this.ai = new AI(this.opponent, buildAIProfile(this.difficulty, this.opponent.profile), this.events);
    this.opponentModel = createBoxerModel(this.opponent.profile);
    this.scene.add(this.opponentModel.root);
    this.referee = new Referee();
    this.scene.add(this.referee.root);
    this.referee.ready.then(() => this.applyQualityToModel());
    this.arms = new FirstPersonArms(this.camera, { skinColor: BOXERS.player.look.skin });
    this._buildPlayerShadow();

    // --- Caméra, son, entrées ---
    this.cameraRig = new CameraRig(this.camera);
    this.audio = new AudioManager();
    this.input = new Input(canvas);
    this.input.attach();

    // --- Interface ---
    this.screenFx = new ScreenEffects(uiRoot, canvas);
    this.hud = new HUD(uiRoot);
    this.roundOverlay = new RoundOverlay(uiRoot, { onSkip: () => { if (!this.online) this.rounds.skipBreak(); } });
    const sound = (k) => this.audio.play(k);
    this.menu = new Menu(uiRoot, { settings, onPlay: () => this.startMatch(), onSound: sound });
    this.onlinePanel = new OnlinePanel(this, settings, { onSound: sound });
    this.menu.setOnlinePanel(this.onlinePanel);
    this.pauseMenu = new PauseMenu(uiRoot, {
      settings,
      onResume: () => this.resume(),
      onRestart: () => this.startMatch(),
      onQuit: () => (this.online ? this.leaveOnline() : this.quitToMenu()),
      onSound: sound,
    });
    this.results = new ResultScreen(uiRoot, { onReplay: () => this.startMatch(), onMenu: () => this.quitToMenu(), onSound: sound });
    this.padNav = new PadNav(uiRoot, { onBack: () => this._padBack() });
    this.hud.onLockHintClick(() => this.resume());

    this._bindEvents();
    this._bindInput();
    this.settings.onChange((key) => this._onSetting(key));
    this.applySettings(true);

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(canvas);
    }
    // Premier geste dans le menu : le son démarre (public, clics d'interface)
    this._unlockAudio = () => {
      window.removeEventListener('pointerdown', this._unlockAudio);
      window.removeEventListener('keydown', this._unlockAudio);
      this.audio.init().then(() => {
        this.audio.startCrowd();
        this.audio.resume();
        if (this.state === 'menu') this.audio.setCrowdLevel(0.55);
      });
    };
    window.addEventListener('pointerdown', this._unlockAudio);
    window.addEventListener('keydown', this._unlockAudio);

    this._onVisibility = () => {
      // En ligne, le combat continue onglet caché (le netcode avance la simulation)
      if (document.hidden && this.state === 'fight' && !this.online) this.pause();
    };
    document.addEventListener('visibilitychange', this._onVisibility);
    this.resize();

    this.loop = this.loop.bind(this);
  }

  /* ================================================================
   * Démarrage / états
   * ================================================================ */

  start() {
    this.enterMenu();
    // Lien d'invitation : #duel=ABCDE ouvre l'écran En ligne avec le code
    const m = /duel=([A-Za-z0-9]{5})/.exec(location.hash || '');
    if (m) {
      this.onlinePanel.home(m[1]);
      this.menu.showPanel('online');
      try { history.replaceState(null, '', location.pathname + location.search); } catch { /* sans importance */ }
    }
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  enterMenu() {
    this.state = 'menu';
    this.matchActive = false;
    this.ai.mode = 'shadow';
    this.ai.reset();
    this.opponent.reset(new Vector3(0, 0, 0), Math.PI * 0.8);
    this.opponent.frozen = false;
    this.player.reset(new Vector3(0, 0, -1), 0);
    this.player.frozen = true;
    this.cameraRig.setMode('orbit');
    this.cameraRig.resetEffects();
    this.arms.setVisible(false);
    this.referee.setVisible(false);
    this.playerShadow.visible = false;
    this.hud.hide();
    this.pauseMenu.hide();
    this.results.hide();
    this.roundOverlay.hide();
    this.screenFx.reset();
    this.menu.show();
    this.input.setGameActive(false);
    this.input.exitPointerLock();
    this.arena.audience.setBaseExcitement(0.15);
    this.audio.setCrowdLevel(0.55);
    this.slowMo.time = 0;
    this.hitStop = 0;
  }

  /** Lance (ou relance) un combat. Appelé depuis un clic. */
  async startMatch() {
    if (this.online) return; // en ligne : les revanches passent par le netcode
    if (this.onlinePanel.session) this.onlinePanel.cancel(); // un duel en attente ne doit pas surgir pendant un combat solo
    this.audio.init().then(() => {
      this.audio.startCrowd();
      this.audio.resume();
    });
    const s = this.settings.values;
    this._setDifficulty(s.difficulty);

    this.menu.hide();
    this.pauseMenu.hide();
    this.results.hide();
    this.roundOverlay.hide();
    this.screenFx.reset();
    this.cameraRig.resetEffects();
    this.hitStop = 0;
    this.slowMo.time = 0;
    this.screenFx.setBars(false);
    this.screenFx.setFade(0);

    this.ai.mode = 'fight';
    this.ai.reset();
    this.player.matchStats.reset();
    this.opponent.matchStats.reset();
    this.player.reset(START_PLAYER, 0);
    this.opponent.reset(START_OPPONENT, Math.PI);
    this.rounds.configure({ rounds: s.rounds, roundDuration: s.roundDuration, breakDuration: GameConfig.match.breakDuration });
    this.ai.context.totalRounds = s.rounds;

    const prev = this.state;
    this.state = 'fight';
    this.matchActive = true;
    this.cameraRig.setMode('fight', { transition: prev === 'menu' || prev === 'results' });
    this.arms.setVisible(true);
    this.referee.setVisible(true);
    this.referee.resetPosition();
    this.playerShadow.visible = true;
    this.hud.setFighters(this.player, this.opponent, { opponentSub: `« ${this.opponent.profile.nickname} » · ${this.difficulty.label}` });
    this.hud.show();
    this.arena.audience.setBaseExcitement(0.3);
    this.audio.setCrowdLevel(0.8);
    this.input.setGameActive(true);
    this.rounds.start([this.player, this.opponent]);
    const ok = await this._lockPointer();
    if (!ok && this.state === 'fight') {
      // Pas de verrouillage : le combat attend un clic sur l'invite
      this.state = 'paused';
      this.input.setGameActive(false);
    }
  }

  /**
   * Verrouille le pointeur. Retourne true si le combat peut se jouer
   * (verrouillé, ou mode souris libre quand le verrouillage est impossible).
   */
  async _lockPointer() {
    const ok = await this.input.requestPointerLock();
    if (ok) {
      this.lockFailures = 0;
      this.hud.setLockHint(false);
      return true;
    }
    // À la manette, pas besoin de la souris : le combat se joue sans verrouillage
    if (this.input.padActive) {
      this.hud.setLockHint(false);
      return true;
    }
    this.lockFailures = (this.lockFailures || 0) + 1;
    if (this.lockFailures >= 2) this.input.fallbackMode = true;
    if (this.input.fallbackMode) {
      this.hud.setLockHint(false);
      this._msg('free', 'Souris libre : approchez le bord de l\'écran pour tourner', 'muted', 8);
      return true;
    }
    // Refus temporaire (ex. Échap tout juste pressé) : un clic suffira
    this.hud.setLockHint(true, 'Cliquez pour reprendre le combat');
    return false;
  }

  pause() {
    if (this.state !== 'fight') return;
    if (this.online) {
      // Pas de pause en ligne : on propose d'abandonner, le combat continue
      if (this.quitOpen) return;
      this.quitOpen = true;
      this.input.setGameActive(false);
      this.input.exitPointerLock();
      this.pauseMenu.show(true);
      this.hud.setLockHint(false);
      return;
    }
    this.state = 'paused';
    this.input.setGameActive(false);
    this.input.exitPointerLock();
    this.pauseMenu.show();
    this.hud.setLockHint(false);
    this.audio.setCrowdLevel(0.35);
  }

  async resume() {
    if (this.online && this.state === 'fight') {
      this.quitOpen = false;
      this.pauseMenu.hide();
      this.input.setGameActive(true);
      this.audio.resume();
      await this._lockPointer();
      return;
    }
    if (this.state !== 'paused') return;
    this.pauseMenu.hide();
    this.audio.resume();
    const ok = await this._lockPointer();
    if (!ok || this.state !== 'paused') return; // on reste en pause derrière l'invite
    this.state = 'fight';
    this.input.setGameActive(true);
    this.audio.setCrowdLevel(0.8);
    this.lastFrame = performance.now();
  }

  quitToMenu() {
    this.enterMenu();
  }

  _setDifficulty(id) {
    const diff = DIFFICULTIES[id] || DIFFICULTIES.intermediate;
    const boxer = opponentFor(this.settings.get('opponent'), diff);
    const changed = this.opponent.profile !== boxer;
    this.difficulty = diff;
    this.ai.setProfile(buildAIProfile(diff, boxer));
    if (changed) {
      this.opponent.setProfile(boxer);
      this.opponentModel.dispose();
      this.opponentModel = createBoxerModel(this.opponent.profile);
      this.scene.add(this.opponentModel.root);
      this.applyQualityToModel();
    }
  }

  /* ================================================================
   * Réglages
   * ================================================================ */

  _onSetting(key) {
    if ((key === 'difficulty' || key === 'opponent') && this.state === 'menu') this._setDifficulty(this.settings.get('difficulty'));
    this.applySettings(key === 'quality');
  }

  applySettings(qualityChanged = false) {
    const s = this.settings.values;
    this.player.sensitivity = s.mouseSensitivity;
    this.player.invertY = s.invertY;
    this.player.aimAssist = s.aimAssist;
    this.audio.setVolumes({ master: s.masterVolume, sfx: s.sfxVolume });
    this.cameraRig.enabled = s.cameraShake;
    if (qualityChanged) {
      const q = GameConfig.quality[s.quality] || GameConfig.quality.medium;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
      this.arena.applyQuality(this.renderer, s.quality);
      this.effects.setQuality(s.quality);
      this.applyQualityToModel();
      this.resize();
    }
  }

  applyQualityToModel() {
    const shadows = (GameConfig.quality[this.settings.get('quality')] || {}).shadows;
    const apply = (root) => root.traverse((o) => {
      if (o.isMesh) o.castShadow = !!shadows;
    });
    // Les personnages se chargent en arrière-plan : on règle aussi ce qui arrive après
    for (const m of [this.opponentModel, this.referee]) {
      if (!m) continue;
      apply(m.root);
      if (m.ready) m.ready.then(() => apply(m.root));
    }
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  _buildPlayerShadow() {
    // Corps invisible qui projette l'ombre du joueur sur le tapis
    const mat = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    this.playerShadow = new Mesh(new CapsuleGeometry(0.22, 1.1, 4, 8), mat);
    this.playerShadow.castShadow = true;
    this.playerShadow.visible = false;
    this.scene.add(this.playerShadow);
  }

  /* ================================================================
   * Entrées hors combat
   * ================================================================ */

  _bindInput() {
    this.input.onLockChange((locked, error) => {
      if (!locked && !error && this.state === 'fight' && !this.input.fallbackMode) {
        if (this.online) this.hud.setLockHint(!this.quitOpen, 'Cliquez pour reprendre la souris');
        else this.pause();
      }
      if (locked) this.hud.setLockHint(false);
    });
    this.input.onAnyKey((e) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        // Échap libère aussi le pointeur (le navigateur s'en charge) : pause() est idempotent
        if (this.state === 'fight' && this.online && this.quitOpen) this.resume();
        else if (this.state === 'fight') this.pause();
        else if (this.state === 'paused' && this.pauseMenu.optionsOpen) this.pauseMenu.back();
      }
      if (e.code === 'KeyH' && this.state === 'fight' && !e.repeat) {
        this.settings.set('showControls', !this.settings.get('showControls'));
      }
    });
    // Manette : Start = pause / reprise, Back = aide, menus parcourus à la croix
    this.input.onPad((code) => this._onPad(code));
    // Clic sur le canvas pendant le combat sans verrouillage : on (re)verrouille
    this.canvas.addEventListener('click', () => {
      if (this.state === 'fight' && !this.input.locked && !this.quitOpen) this.input.requestPointerLock();
      else if (this.state === 'paused' && !this.pauseMenu.visible) this.resume();
    });
  }

  _onPad(code) {
    if (code === 'Pad9') {
      if (this.state === 'fight' && this.online && this.quitOpen) this.resume();
      else if (this.state === 'fight') this.pause();
      else if (this.state === 'paused' && this.pauseMenu.optionsOpen) this.pauseMenu.back();
      else if (this.state === 'paused') this.resume();
      else this.padNav.handle('Pad0');
      return;
    }
    if (code === 'Pad8' && this.state === 'fight' && !this.quitOpen) {
      this.settings.set('showControls', !this.settings.get('showControls'));
      return;
    }
    // Pendant le combat, les boutons servent à boxer (sauf dialogue « quitter » en ligne)
    if (this.state === 'fight' && !this.quitOpen) return;
    this.padNav.handle(code);
  }

  /** Bouton B dans les menus. */
  _padBack() {
    if (this.state === 'paused') {
      if (this.pauseMenu.optionsOpen) this.pauseMenu.back();
      else this.resume();
      return true;
    }
    if (this.state === 'fight' && this.quitOpen) {
      this.resume();
      return true;
    }
    if (this.state === 'menu' && this.menu.panel !== 'poster') {
      this.menu.showPanel('poster');
      this.padNav.reset();
      return true;
    }
    return false;
  }

  /* ================================================================
   * Événements de combat → son, effets, HUD
   * ================================================================ */

  _pan(pos) {
    _v.copy(pos).sub(this.camera.position);
    _right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const d = _v.length() || 1;
    return clamp(_v.dot(_right) / d, -1, 1) * 0.7;
  }

  _msg(key, text, kind, cooldown = 0.6) {
    const now = this.time;
    if (this.msgTimes[key] && now - this.msgTimes[key] < cooldown) return;
    this.msgTimes[key] = now;
    this.hud.message(text, kind);
  }

  _bindEvents() {
    const ev = this.events;
    const P = () => this.player;
    const inFight = () => this.matchActive && (this.state === 'fight' || this.state === 'paused');

    ev.on('punch:start', ({ fighter }) => {
      if (!inFight()) return;
      if (fighter === this.opponent) this.audio.play('exhale', { volume: 0.9, pan: this._pan(fighter.position), rate: 0.9 });
    });

    ev.on('punch:strike', ({ fighter, punch }) => {
      if (!inFight()) return;
      const key = punch.def.kind === 'hook' ? 'punch_hook' : punch.def.kind === 'uppercut' ? 'punch_uppercut' : punch.def.id === 'jab' ? 'punch_jab' : 'punch_cross';
      if (fighter === P()) {
        this.audio.play(key, { volume: 0.8 });
        this.audio.play('exhale', { volume: 0.45, rate: 1.15 });
        const side = punch.side;
        this.cameraRig.kick({ pitch: -0.25 * punch.def.shake, roll: -side * 0.9 * punch.def.shake, push: -0.4, fov: 0.12 });
      } else {
        this.audio.play(key, { volume: 0.55, pan: this._pan(fighter.position) });
      }
    });

    ev.on('punch:land', (e) => {
      if (!inFight()) return;
      const { attacker, defender, punch, zone, crit, point, counterLabel } = e;
      const pd = punch.def;
      const toPlayer = defender === P();
      const pan = this._pan(point);

      // Son
      if (e.ko) this.audio.play('ko', { pan });
      else if (crit) this.audio.play('impact_heavy', { pan });
      else this.audio.play(zone === 'body' ? 'impact_body' : 'impact_head', { pan, rate: pd.kind === 'straight' ? 1.05 : 0.95 });
      if (toPlayer) {
        this.audio.play('hit_received', { volume: 0.6 + pd.shake });
        if (crit || pd.shake > 0.25) this.audio.muffleFor(crit ? 1 : 0.5, crit ? 0.9 : 0.4);
      }
      if (crit || e.counter || punch.combo) this.audio.play('crowd_ooh', { volume: crit ? 1 : 0.6, minGap: 0.8 });

      // Effets (pas d'éclat collé à l'objectif quand c'est le joueur qui encaisse)
      _v.copy(defender.position).sub(attacker.position).setY(0).normalize();
      if (!toPlayer) this.effects.spawn(point, _v, { crit, power: pd.shake * 3, camera: this.camera });
      if (!this.online) this.hitStop = Math.max(this.hitStop, pd.hitStop * (crit ? 1.8 : 1) * (e.ko ? 2 : 1));
      this.arena.audience.cheer(crit ? 0.35 : pd.shake * 0.4 + (e.counter ? 0.1 : 0));
      if (crit) this.arena.lighting.burst(0.6);

      if (toPlayer) {
        // Recul de la caméra dans le sens du coup
        _right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
        const lateral = _v.dot(_right);
        const s = pd.shake * (crit ? 1.6 : 1);
        this.cameraRig.kick({
          pitch: pd.kind === 'uppercut' ? 3.5 * s : zone === 'body' ? -1.6 * s : 2 * s,
          yaw: -lateral * 3 * s,
          roll: (pd.kind === 'hook' ? -punch.side * 2.6 : (Math.random() - 0.5) * 1.5) * s,
          push: 1.2 * s,
        });
        this.cameraRig.addTrauma(0.25 + pd.shake * (crit ? 1.4 : 0.8));
        this.screenFx.hit(0.25 + e.damage / 14);
        if (crit) {
          this.screenFx.flash(0.45);
          this._msg('crit-in', 'Coup critique encaissé', 'bad', 1);
        }
      } else {
        this.cameraRig.addTrauma(pd.shake * (crit ? 0.9 : 0.45));
        this.hud.hitmarker(crit ? 'crit' : '');
        if (crit) this._msg('crit', 'Critique !', 'crit', 0.3);
        if (counterLabel) this._msg('counter', counterLabel, 'counter', 0.4);
      }
    });

    ev.on('punch:blocked', ({ attacker, defender, punch, point }) => {
      if (!inFight()) return;
      this.audio.play('block', { pan: this._pan(point) });
      _v.copy(defender.position).sub(attacker.position).setY(0).normalize();
      if (defender !== this.player) this.effects.spawn(point, _v, { blocked: true, power: punch.def.shake * 2 });
      if (!this.online) this.hitStop = Math.max(this.hitStop, punch.def.hitStop * 0.5);
      if (defender === this.player) {
        this.cameraRig.kick({ pitch: 0.6 * punch.def.shake, push: 0.5 });
        this.cameraRig.addTrauma(0.1);
      } else {
        this.hud.hitmarker('block');
        this._msg('blocked', 'Bloqué', 'muted', 1.2);
      }
    });

    ev.on('punch:whiff', ({ attacker, defender, dodged }) => {
      if (!inFight()) return;
      if (attacker === this.player) {
        this.audio.play('whiff', { volume: 0.5 });
        if (dodged) this._msg('oppdodge', 'Esquivé', 'muted', 1.2);
      } else if (dodged && defender === this.player) {
        this._msg('pdodge', 'Esquive !', 'good', 0.8);
        if (!this.online) this.slowMo = { time: 0.16, scale: 0.45 };
      }
    });

    ev.on('dodge:start', ({ fighter }) => {
      if (!inFight()) return;
      this.audio.play('dodge', { volume: fighter === this.player ? 0.7 : 0.4, pan: fighter === this.player ? 0 : this._pan(fighter.position) });
    });

    ev.on('dodge:fail', ({ fighter }) => {
      if (fighter === this.player && inFight()) this._msg('dodgefail', 'Trop essoufflé pour esquiver', 'bad', 2);
    });

    ev.on('combo', ({ fighter, combo }) => {
      if (fighter !== this.player || !inFight()) return;
      this.hud.message(combo.name, 'combo');
      this.audio.play('combo');
    });

    ev.on('guard:break', ({ fighter }) => {
      if (!inFight()) return;
      this.audio.play('impact_heavy', { volume: 0.5 });
      this._msg('gb', fighter === this.player ? 'Votre garde cède !' : 'Garde brisée !', fighter === this.player ? 'bad' : 'crit', 0.5);
    });

    ev.on('fighter:stunned', ({ fighter }) => {
      if (!inFight()) return;
      if (fighter === this.player) {
        this.audio.play('ringing');
        this._msg('stun-me', 'Sonné ! Reculez', 'bad', 1);
        this.cameraRig.addTrauma(0.4);
      } else {
        this._msg('stun-opp', `${fighter.name.split(' ')[0]} est sonné !`, 'good', 1);
        this.arena.audience.cheer(0.45);
        this.audio.play('crowd_cheer', { volume: 0.6, minGap: 2 });
      }
    });

    // --- Knockdown : l'arbitre compte ---
    ev.on('fighter:down', ({ fighter, knockdowns }) => {
      if (!inFight()) return;
      // En ligne, la simulation gère le compte elle-même (net/OnlineWorld.js) et le temps ne ralentit pas
      if (!this.online) {
        this.rounds.registerKnockdown(fighter);
        this.slowMo = { time: 1.1, scale: 0.32 };
      }
      const me = fighter === this.player;
      this.cameraRig.addTrauma(0.7);
      this.arena.audience.cheer(0.9);
      this.arena.lighting.burst(1);
      this.audio.play('crowd_cheer', { volume: 1, minGap: 0.1 });
      this.screenFx.setBars(true);
      if (me) {
        this.screenFx.setFade(0.35);
        this.audio.muffleFor(1, 1.6);
      }
      if (this.rounds.phase === 'count') {
        const who = me ? 'Vous êtes' : `${fighter.name.split(' ')[0]} est`;
        this.roundOverlay.knockdown('AU TAPIS !', knockdowns > 1 ? `${knockdowns}e knockdown` : `${who} au tapis`);
      }
    });

    ev.on('count:tick', ({ fighter, n }) => {
      if (!inFight()) return;
      this.audio.play('count', { volume: 0.9, minGap: 0 });
      if (n <= 10) this.audio.say(COUNT_WORDS[n - 1]);
      this.arena.audience.cheer(fighter === this.player ? 0.12 : 0.22);
      this.hud.countPulse();
    });

    ev.on('count:up', ({ fighter }) => {
      if (!inFight()) return;
      const me = fighter === this.player;
      this.audio.play('crowd_cheer', { volume: 0.8, minGap: 0.3 });
      this.arena.audience.cheer(0.5);
      this._msg('rise', me ? 'Debout ! Tenez bon' : `${fighter.name.split(' ')[0]} se relève`, me ? 'good' : 'bad', 0.5);
      if (me) {
        this.screenFx.setFade(0);
        this.audio.muffleFor(0.5, 0.8);
      }
    });

    ev.on('count:end', () => {
      if (!inFight()) return;
      this.screenFx.setBars(false);
      this.screenFx.setFade(0);
      this.audio.play('bell', { minGap: 0 });
      this.roundOverlay.resume('BOX !');
    });

    ev.on('fighter:ko', ({ fighter, kind }) => {
      if (!inFight()) return;
      const technical = kind === 'KO technique';
      if (!this.online && technical) this.slowMo = { time: 1.6, scale: 0.28 };
      this.cameraRig.addTrauma(technical ? 0.8 : 0.3);
      this.arena.audience.cheer(1);
      this.arena.audience.setBaseExcitement(0.9);
      this.arena.lighting.burst(1.4);
      this.screenFx.setBars(true);
      this.audio.play('crowd_cheer', { volume: 1, minGap: 0.1 });
      [0.5, 0.85, 1.2].forEach((d) => this.audio.play('bell', { delay: d, minGap: 0 }));
      if (fighter === this.player) {
        this.screenFx.setFade(0.55);
        this.audio.muffleFor(1, 2.5);
      } else {
        this.cameraRig.zoomTarget = 0.6;
      }
      setTimeout(() => {
        if (this.state === 'fight' || this.state === 'paused') this.roundOverlay.ko(technical ? 'KO TECHNIQUE' : 'KNOCKOUT', technical ? 'Trois knockdowns dans le round' : 'Compté dix');
      }, technical ? 650 : 250);
    });

    ev.on('round:intro', ({ round, total }) => {
      if (this.online) {
        this.roundOverlay.intro(round, total, GameConfig.match.introDuration * 0.55);
        this.arena.audience.cheer(0.25);
        return;
      }
      if (round > 1) {
        for (const f of [this.player, this.opponent]) {
          f.stamina.recover(GameConfig.match.breakStaminaRecovery);
          f.hp = Math.min(f.maxHp, f.hp + (f.maxHp - f.hp) * GameConfig.match.breakHpRecovery);
        }
      }
      this.player.placeAt(START_PLAYER, 0);
      this.opponent.placeAt(START_OPPONENT, Math.PI);
      this.ai.context.round = round;
      this.ai.context.totalRounds = total;
      this.roundOverlay.intro(round, total, GameConfig.match.introDuration * 0.55);
      this.arena.audience.cheer(0.25);
    });

    ev.on('round:start', () => {
      this.audio.play('bell', { minGap: 0 });
      this.arena.audience.setBaseExcitement(0.3);
    });

    ev.on('round:warning', () => {
      this.audio.play('clapper');
      this.arena.audience.cheer(0.15);
    });

    ev.on('round:end', ({ round, last }) => {
      this.audio.play('bell', { minGap: 0 });
      this.audio.play('bell', { delay: 0.45, minGap: 0 });
      this.roundOverlay.end(round, last);
      this.arena.audience.cheer(0.3);
    });

    ev.on('round:break', ({ round, total, duration }) => {
      this.roundOverlay.breakScreen({
        round, total, duration, player: this.player, opponent: this.opponent,
        tips: this.online ? ['Récupérez : votre endurance remonte pendant la pause.'] : this.ai.insights(),
      });
      if (this.online) {
        const skip = this.roundOverlay.el.querySelector('[data-id="skip"]');
        if (skip) skip.remove();
      }
    });

    ev.on('match:end', (result) => {
      if (!this.online) this._showResults(result); // en ligne : fin décidée par l'hôte (onlineOver)
    });
  }

  _showResults(r) {
    const p = this.player;
    let score = p.matchStats.score;
    const SC = GameConfig.score;
    if (r.winner === p) {
      if (r.method === 'KO') score += SC.koWin + r.timeLeft * SC.perSecondLeft + r.roundsLeft * SC.perRoundLeft;
      else score += SC.decisionWin;
    }
    score = Math.round(score * (SCORE_MULT[this.difficulty.id] || 1));
    const newRecord = this.settings.submitScore(this.difficulty.id, score);
    const best = this.settings.bestScore(this.difficulty.id);

    this.state = 'results';
    this.matchActive = false;
    this.input.setGameActive(false);
    this.input.exitPointerLock();
    this.hud.hide();
    this.pauseMenu.hide();
    this.roundOverlay.hide();
    this.screenFx.setBars(false);
    this.screenFx.setFade(0);
    this.cameraRig.zoomTarget = 0;
    this.cameraRig.setMode('results', { transition: false });
    this.arms.setVisible(false);
    this.playerShadow.visible = false;
    if (r.method !== 'KO') {
      this.audio.play('bell', { minGap: 0 });
      this.audio.play('crowd_cheer', { volume: 0.8 });
    }
    this.results.show(r, {
      player: p, opponent: this.opponent, score, newRecord, best, difficultyLabel: this.difficulty.label,
    });
  }

  /* ================================================================
   * En ligne (appelé par net/Netcode.js)
   * ================================================================ */

  /** Début d'un combat en ligne (et de chaque revanche). Retourne la simulation. */
  onlineStart(session, st) {
    if (!this.offline) {
      this.offline = { player: this.player, opponent: this.opponent, rounds: this.rounds, combat: this.combat };
    }
    const me = session.me;
    const profiles = [0, 1].map((i) => ({
      ...BOXERS.player,
      id: `net${i}`,
      name: st.names[i],
      nickname: i === me ? 'Vous' : 'En ligne',
      corner: i === 0 ? 'red' : 'blue',
      look: { ...BOXERS.player.look, model: st.models[i] },
    }));
    const world = new OnlineWorld({ profiles, rounds: st.rounds, roundDuration: st.dur });
    const p = world.fighters[me];
    const o = world.fighters[1 - me];
    const s = this.settings.values;
    p.sensitivity = s.mouseSensitivity;
    p.invertY = s.invertY;
    p.aimAssist = s.aimAssist;
    this.online = { session, world, me, hudAt: 0 };
    this.player = p;
    this.opponent = o;
    this.rounds = world.rounds;
    this.combat = world.combat;
    this.opponentModel.dispose();
    this.opponentModel = createBoxerModel(o.profile);
    this.scene.add(this.opponentModel.root);
    this.applyQualityToModel();
    world.start(st.seed);
    this.view.yaw = p.yaw;
    this.view.pitch = 0;
    this.pendingPressed = 0;
    this.quitOpen = false;

    this.audio.init().then(() => {
      this.audio.startCrowd();
      this.audio.resume();
    });
    this.menu.hide();
    this.pauseMenu.hide();
    this.results.hide();
    this.roundOverlay.hide();
    this.screenFx.reset();
    this.screenFx.setBars(false);
    this.screenFx.setFade(0);
    this.cameraRig.resetEffects();
    this.hitStop = 0;
    this.slowMo.time = 0;
    const prev = this.state;
    this.state = 'fight';
    this.matchActive = true;
    this.cameraRig.setMode('fight', { transition: prev === 'menu' || prev === 'results' });
    this.arms.setVisible(true);
    this.referee.setVisible(true);
    this.referee.resetPosition();
    this.playerShadow.visible = true;
    this.hud.setFighters(p, o, { opponentSub: 'En ligne' });
    this.hud.show();
    this.arena.audience.setBaseExcitement(0.3);
    this.audio.setCrowdLevel(0.8);
    this.input.setGameActive(true);
    // Le combat démarre souvent sans clic (message réseau) : le navigateur peut refuser
    // de verrouiller la souris tout de suite → invite « Cliquez », le combat ne s'arrête pas.
    this.input.requestPointerLock().then((ok) => {
      if (this.online && !ok && !this.input.fallbackMode && !this.input.padActive) this.hud.setLockHint(true, 'Cliquez pour prendre la souris');
    });
    return world;
  }

  /** Événements de simulation à montrer (sons, effets, HUD) : une seule fois chacun. */
  onlineEvents(list) {
    for (const e of list) this.events.emit(e.type, e.payload);
  }

  /** Ma commande pour le prochain tick (format réseau). */
  onlineLocalCommand() {
    const v = this.view;
    let c;
    if (window.__netBot) {
      // tests : un bot joue à la place du clavier (voir tests de bout en bout)
      c = Object.assign(this._cmd, window.__netBot(this, v));
    } else if (this.quitOpen || !this.input.gameActive) {
      c = this._cmd;
      Object.assign(c, { mx: 0, mz: 0, guard: false, dodgeHeld: false, dirPressed: false, duck: false, dodge: false, punches: 0 });
      c.yaw = v.yaw;
      c.pitch = v.pitch;
    } else c = commandFromInput(this.input, v.yaw, v.pitch, this.pendingPressed, this._cmd);
    this.pendingPressed = 0;
    return packCommand(c);
  }

  _updateOnline(realDt) {
    const O = this.online;
    const p = this.player;
    // Regard : tout de suite, sans attendre la simulation
    if (this.input.gameActive && !this.quitOpen) {
      p.updateView(this.input, realDt, this.view);
      this.pendingPressed |= pressedMask(this.input);
    } else this.input.consumeLook({ x: 0, y: 0 });
    if (p.lookLocked || this.rounds.phase === 'intro') {
      this.view.yaw = p.yaw;
      this.view.pitch = p.pitch;
    }
    O.session.frame(realDt);
    if (this.online !== O || this.state !== 'fight') return; // fin du match / départ pendant la frame

    // Affichage avec MON regard (la simulation a celui d'il y a 2 ticks), puis on remet l'état simulé
    const simYaw = p.yaw;
    const simPitch = p.pitch;
    if (!p.ko) {
      p.yaw = this.view.yaw;
      p.pitch = this.view.pitch;
      p.updateFrame();
    }
    this._presentFight(realDt, realDt);
    p.yaw = simYaw;
    p.pitch = simPitch;
    p.updateFrame();

    // Ping dans le HUD
    O.hudAt -= realDt;
    if (O.hudAt <= 0) {
      O.hudAt = 0.5;
      const st = O.session.netStatus;
      this.hud.$.osub.textContent = `En ligne · ${st.text}`;
      this.hud.$.osub.classList.toggle('net-bad', st.bad);
    }
  }

  /** Fin du match (décidée par l'hôte) : écran de résultat avec Revanche / Quitter. */
  onlineOver(session, sum) {
    const O = this.online;
    if (!O || O.session !== session) return;
    const W = O.world;
    const me = O.me;
    const winner = sum.w >= 0 ? W.fighters[sum.w] : null;
    const r = {
      method: sum.method,
      kind: sum.kind || (winner ? 'Décision' : 'Match nul'),
      winner,
      loser: winner ? W.fighters[1 - sum.w] : null,
      round: sum.round,
      time: sum.time,
      // cartes des juges : colonne de gauche = moi
      scorecards: sum.scorecards.map((rounds) => rounds.map(([a, b]) => (me === 0 ? [a, b] : [b, a]))),
    };
    this.state = 'results';
    this.matchActive = false;
    this.quitOpen = false;
    this.input.setGameActive(false);
    this.input.exitPointerLock();
    this.hud.hide();
    this.pauseMenu.hide();
    this.roundOverlay.hide();
    this.screenFx.setBars(false);
    this.screenFx.setFade(0);
    this.cameraRig.zoomTarget = 0;
    this.cameraRig.setMode('results', { transition: false });
    this.arms.setVisible(false);
    this.playerShadow.visible = false;
    if (r.method !== 'KO') {
      this.audio.play('bell', { minGap: 0 });
      this.audio.play('crowd_cheer', { volume: 0.8 });
    }
    this.results.show(r, {
      player: this.player,
      opponent: this.opponent,
      online: {
        foe: session.foeName,
        mine: false, theirs: false, gone: false,
        onRematch: () => session.askRematch(),
        onQuit: () => this.leaveOnline(),
      },
    });
  }

  onlineResultChanged(session) {
    if (!this.online || this.online.session !== session || this.state !== 'results') return;
    this.results.updateOnline({
      foe: session.foeName,
      mine: session.rematch[session.me],
      theirs: session.rematch[1 - session.me],
      gone: session.gone,
    });
  }

  /** L'adversaire est parti (forfait) ou la connexion est coupée. */
  onlineLeft({ bye, inMatch, foe, desync }) {
    let notice;
    if (bye && inMatch) notice = { good: true, title: 'Victoire par forfait', text: `${foe} a quitté le combat.` };
    else if (desync) notice = { title: 'Combat interrompu', text: `Les deux simulations n’ont pas pu être resynchronisées avec ${foe}. Le combat est annulé.` };
    else if (inMatch) notice = { title: 'Connexion perdue', text: `Le lien avec ${foe} s’est coupé (réseau instable, onglet fermé ou ordinateur en veille). Le combat est annulé.` };
    else notice = { title: 'Connexion perdue', text: `Le lien avec ${foe} s’est coupé avant le début du combat.` };
    this._exitOnline(notice);
  }

  /** Quitter le jeu en ligne (abandon pendant un combat = victoire par forfait pour l'adversaire). */
  leaveOnline() {
    if (this.online) this.online.session.leave();
    this._exitOnline(null);
  }

  _exitOnline(notice) {
    this.online = null;
    this.quitOpen = false;
    if (this.offline) {
      this.player = this.offline.player;
      this.opponent = this.offline.opponent;
      this.rounds = this.offline.rounds;
      this.combat = this.offline.combat;
      this.offline = null;
      this.opponentModel.dispose();
      this.opponentModel = createBoxerModel(this.opponent.profile);
      this.scene.add(this.opponentModel.root);
      this.applyQualityToModel();
    }
    this.enterMenu();
    if (notice) this.onlinePanel.setNotice(notice);
    this.onlinePanel.home();
    this.menu.showPanel('online');
  }

  /* ================================================================
   * Boucle
   * ================================================================ */

  loop(now) {
    this.raf = requestAnimationFrame(this.loop);
    const rawDt = Math.max(0, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    // Compteur de FPS (temps réel non borné)
    this.fps.frames++;
    this.fps.time += rawDt;
    if (this.fps.time >= 0.5) {
      this.fps.value = Math.round(this.fps.frames / this.fps.time);
      this.fps.frames = 0;
      this.fps.time = 0;
      this._adaptResolution();
    }

    this.update(Math.min(0.1, rawDt));
    if (this.state !== 'paused' || this.needsRender) this.render();
    this.input.endFrame();
  }

  /**
   * Résolution dynamique : si l'ordinateur ne tient pas 60 FPS, on baisse
   * la définition interne (jusqu'à 55 %), puis on la remonte quand c'est fluide.
   */
  _adaptResolution() {
    if (this.state === 'paused' || this.state === 'loading') return;
    const q = GameConfig.quality[this.settings.get('quality')] || GameConfig.quality.medium;
    const max = Math.min(window.devicePixelRatio || 1, q.pixelRatio);
    const min = Math.min(max, 0.55);
    const pr = this.renderer.getPixelRatio();
    const fps = this.fps.value;
    this.fpsLow = fps < 47 ? (this.fpsLow || 0) + 1 : 0;
    this.fpsHigh = fps > 58 ? (this.fpsHigh || 0) + 1 : 0;
    let next = pr;
    if (this.fpsLow >= 3 && pr > min) next = Math.max(min, pr * 0.85);
    else if (this.fpsHigh >= 8 && pr < max) next = Math.min(max, pr * 1.1);
    if (Math.abs(next - pr) > 0.01) {
      this.fpsLow = 0;
      this.fpsHigh = 0;
      this.renderer.setPixelRatio(next);
      this.resize();
    }
  }

  /** Fait avancer le jeu de `seconds` sans rendu (tests, outils). */
  advance(seconds, step = 1 / 60) {
    for (let t = 0; t < seconds; t += step) {
      this.update(step);
      this.input.endFrame();
    }
  }

  update(realDt) {
    this.time += realDt;
    this.input.pollGamepads(realDt);
    if (this.state === 'paused') return;

    // Temps de jeu : gel d'image et ralenti
    let dt = realDt;
    if (this.hitStop > 0) {
      this.hitStop -= realDt;
      dt = 0;
    } else if (this.slowMo.time > 0) {
      this.slowMo.time -= realDt;
      dt = realDt * this.slowMo.scale;
    }

    if (this.state === 'menu') this._updateMenu(realDt);
    else if (this.state === 'fight' && this.online) this._updateOnline(realDt);
    else if (this.state === 'fight') this._updateFight(dt, realDt);
    else if (this.state === 'results') this._updateResults(realDt);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    this.needsRender = false;
  }

  _updateMenu(dt) {
    const o = this.opponent;
    const ghost = this.player;
    // Cible fantôme devant l'adversaire pour son shadow-boxing
    ghost.position.set(o.position.x - Math.sin(o.yaw) * 1.05, 0, o.position.z - Math.cos(o.yaw) * 1.05);
    ghost.updateHurtZones();
    ghost.updateFrame();
    this.ai.update(dt);
    o.update(dt);
    if (o.stamina.ratio < 0.3) o.stamina.recover(1);
    this.opponentModel.update(dt, o);
    this.cameraRig.update(dt, ghost, o);
    this.effects.update(dt);
    this.arena.update(dt, this.camera.position, o.position, [o]);
    this.screenFx.update(dt, null);
  }

  _updateFight(dt, realDt) {
    const p = this.player;
    const o = this.opponent;
    const r = this.rounds;
    const active = r.combatActive;
    p.frozen = !active;
    o.frozen = !active;
    // Pendant la présentation du round, le regard reste sur l'adversaire
    // (le joueur a été replacé face à lui) : chaque round commence de face.
    p.lookLocked = r.phase === 'intro';

    p.handleInput(this.input, realDt);
    if (r.phase === 'break' && this.input.pressed('skip')) r.skipBreak();

    if (dt > 0) {
      this.ai.context.timeLeft = r.timeLeft;
      if (active) this.ai.update(dt);
      p.update(dt);
      o.update(dt);
      if (active) this.combat.update();
      r.update(dt);
    }
    this._presentFight(dt, realDt);
  }

  /** Affichage du combat (modèles, poings, caméra, salle, HUD) : commun au solo et au jeu en ligne. */
  _presentFight(dt, realDt) {
    const p = this.player;
    const o = this.opponent;
    const r = this.rounds;
    const victory = r.phase === 'ko' || r.phase === 'over';
    this.opponentModel.update(dt, o, { victory: victory && p.ko && p.koTime > 1.2, camera: p.eye });
    this.arms.update(dt, realDt, p, { victory: victory && o.ko && o.koTime > 1 });
    this.referee.update(dt, { phase: r.phase, count: r.count, fighters: [p, o], result: r.result });
    this.cameraRig.update(realDt, p, o);
    this.effects.update(dt);
    this.arena.update(dt, this.camera.position, o.position, [p, o]);
    this.playerShadow.position.set(p.position.x, 0.86 + p.bodyOffset.y, p.position.z);

    this.screenFx.update(realDt, p);
    this.hud.update(realDt, {
      player: p,
      opponent: o,
      round: r.round,
      total: r.totalRounds,
      timeLeft: r.phase === 'intro' ? r.roundDuration : r.timeLeft,
      phase: r.phase,
      count: r.count,
      pad: !!this.input.padActive,
      score: p.matchStats.score,
      fps: this.settings.get('showFps') ? this.fps.value : null,
      showControls: this.settings.get('showControls'),
    });
    if (r.phase === 'break') this.roundOverlay.updateBreak(r.timer);

    this.arena.setScoreboard({
      round: r.round,
      total: r.totalRounds,
      time: clock(r.phase === 'intro' ? r.roundDuration : r.timeLeft),
      red: this.online ? (this.online.me === 0 ? p.name : o.name).toUpperCase().slice(0, 12) : 'VOUS',
      blue: this.online ? (this.online.me === 0 ? o.name : p.name).toUpperCase().slice(0, 12) : o.name.split(' ').pop().toUpperCase(),
    });

    this._updateBodySounds(realDt);
  }

  _updateResults(dt) {
    const p = this.player;
    const o = this.opponent;
    p.frozen = true;
    o.frozen = true;
    p.update(dt);
    o.update(dt);
    this.opponentModel.update(dt, o, { victory: p.ko });
    this.referee.update(dt, { phase: this.rounds.phase, count: null, fighters: [p, o], result: this.rounds.result });
    this.cameraRig.update(dt, p, o);
    this.effects.update(dt);
    this.arena.update(dt, this.camera.position, o.position, [p, o]);
    this.screenFx.update(dt, null);
  }

  /** Cœur qui bat (vie basse), souffle court (épuisé), réactions du public. */
  _updateBodySounds(dt) {
    const p = this.player;
    if (!p.ko && this.rounds.combatActive) {
      const hp = p.hp / p.maxHp;
      if (hp < 0.3) {
        this.heartTimer -= dt;
        if (this.heartTimer <= 0) {
          this.audio.play('heartbeat', { volume: 0.6 + (0.3 - hp), minGap: 0.3 });
          this.heartTimer = 0.55 + hp * 1.5;
        }
      }
      const tired = p.stamina.isExhausted();
      if (tired) {
        this.breathTimer -= dt;
        if (this.breathTimer <= 0) {
          this.audio.play('breath', { minGap: 0.5 });
          this.breathTimer = 1.15;
        }
        if (!this.lastExhausted) this._msg('tired', 'Essoufflé : vos coups faiblissent', 'bad', 6);
      }
      this.lastExhausted = tired;
    }
    this.crowdTimer -= dt;
    if (this.crowdTimer <= 0) {
      this.crowdTimer = 0.2;
      this.audio.setCrowdExcitement(this.arena.audience.excitement);
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.input.detach();
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    if (this._ro) this._ro.disconnect();
    this.ai.dispose();
    this.arena.dispose();
    this.effects.dispose();
    this.opponentModel.dispose();
    this.referee.dispose();
    this.arms.dispose();
    this.renderer.dispose();
    this.events.clear();
  }
}
