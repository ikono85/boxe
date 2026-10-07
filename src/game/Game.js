/**
 * Game.js
 * ------------------------------------------------------------------
 * Chef d'orchestre, réduit à la scène.
 *
 * Les boxeurs et tout le combat ont été retirés pour être refaits : il ne reste
 * que la salle (ring, public, lumières) filmée par la caméra orbitale, plus la
 * coquille d'interface (écran titre, options, pause, manette, son).
 *
 * États : 'menu' (écran titre devant la salle) ⇄ 'scene' (salle plein écran).
 *
 * Boucle (requestAnimationFrame) :
 *   1. temps réel ;
 *   2. caméra et salle ;
 *   3. rendu.
 *
 * Pour rebrancher un jeu : recréer des combattants, les ajouter à la scène,
 * les faire avancer dans `update()` et les passer à `arena.update()` (4e
 * argument) pour que le ring et le public réagissent.
 */

import {
  WebGLRenderer, Scene, PerspectiveCamera, ACESFilmicToneMapping, SRGBColorSpace, Vector3,
} from 'three';
import { EventBus } from '../core/EventBus.js';
import { Input } from '../core/Input.js';
import { GameConfig } from '../config/GameConfig.js';
import { Arena } from '../world/Arena.js';
import { CameraRig } from '../fx/CameraRig.js';
import { ScreenEffects } from '../fx/ScreenEffects.js';
import { AudioManager } from '../audio/AudioManager.js';
import { Menu } from '../ui/Menu.js';
import { PauseMenu } from '../ui/PauseMenu.js';
import { PadNav } from '../ui/PadNav.js';

/** Point que regarde la caméra orbitale, à défaut de boxeurs. */
const CENTER = new Vector3(0, 0, 0);

export class Game {
  constructor({ canvas, uiRoot, settings }) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.settings = settings;
    this.events = new EventBus();
    this.state = 'loading';
    this.time = 0;
    this.lastFrame = 0;
    this.fps = { frames: 0, time: 0, value: 60 };
    this.needsRender = true;

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

    // --- Caméra, son, entrées ---
    this.cameraRig = new CameraRig(this.camera);
    this.audio = new AudioManager();
    this.input = new Input(canvas);
    this.input.attach();

    // --- Interface ---
    this.screenFx = new ScreenEffects(uiRoot, canvas);
    const sound = (k) => this.audio.play(k);
    this.menu = new Menu(uiRoot, { settings, onPlay: () => this.enterScene(), onSound: sound });
    this.pauseMenu = new PauseMenu(uiRoot, {
      settings,
      onResume: () => this.enterScene(),
      onRestart: () => this.enterScene(),
      onQuit: () => this.enterMenu(),
      onSound: sound,
    });
    this.padNav = new PadNav(uiRoot, { onBack: () => this._padBack() });

    this._bindInput();
    this.settings.onChange((key) => this.applySettings(key === 'quality'));
    this.applySettings(true);

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(canvas);
    }
    // Premier geste : le son démarre (public, clics d'interface)
    this._unlockAudio = () => {
      window.removeEventListener('pointerdown', this._unlockAudio);
      window.removeEventListener('keydown', this._unlockAudio);
      this.audio.init().then(() => {
        this.audio.startCrowd();
        this.audio.resume();
        this.audio.setCrowdLevel(0.55);
      });
    };
    window.addEventListener('pointerdown', this._unlockAudio);
    window.addEventListener('keydown', this._unlockAudio);
    this.resize();

    this.loop = this.loop.bind(this);
  }

  /* ================================================================
   * Démarrage / états
   * ================================================================ */

  start() {
    this.enterMenu();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  /** Écran titre, la salle tourne derrière. */
  enterMenu() {
    this.state = 'menu';
    this.cameraRig.setMode('orbit');
    this.cameraRig.resetEffects();
    this.pauseMenu.hide();
    this.screenFx.reset();
    this.menu.show();
    this.input.setGameActive(false);
    this.input.exitPointerLock();
    this.arena.audience.setBaseExcitement(0.15);
    this.audio.setCrowdLevel(0.55);
  }

  /** Salle en plein écran, sans interface. Échap revient au menu. */
  enterScene() {
    this.audio.init().then(() => {
      this.audio.startCrowd();
      this.audio.resume();
    });
    this.state = 'scene';
    this.menu.hide();
    this.pauseMenu.hide();
    this.screenFx.reset();
    this.cameraRig.setMode('orbit');
    this.cameraRig.resetEffects();
    this.arena.audience.setBaseExcitement(0.3);
    this.audio.setCrowdLevel(0.7);
  }

  /* ================================================================
   * Réglages
   * ================================================================ */

  applySettings(qualityChanged = false) {
    const s = this.settings.values;
    this.audio.setVolumes({ master: s.masterVolume, sfx: s.sfxVolume });
    this.cameraRig.enabled = s.cameraShake;
    if (qualityChanged) {
      const q = GameConfig.quality[s.quality] || GameConfig.quality.medium;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
      this.arena.applyQuality(this.renderer, s.quality);
      this.resize();
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

  /* ================================================================
   * Entrées
   * ================================================================ */

  _bindInput() {
    this.input.onAnyKey((e) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (this.state === 'scene') this.enterMenu();
      }
    });
    this.input.onPad((code) => {
      if (code === 'Pad9' && this.state === 'scene') {
        this.enterMenu();
        return;
      }
      this.padNav.handle(code);
    });
  }

  /** Bouton B à la manette. */
  _padBack() {
    if (this.state === 'scene') {
      this.enterMenu();
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
   * Boucle
   * ================================================================ */

  loop(now) {
    this.raf = requestAnimationFrame(this.loop);
    const rawDt = Math.max(0, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    this.fps.frames++;
    this.fps.time += rawDt;
    if (this.fps.time >= 0.5) {
      this.fps.value = Math.round(this.fps.frames / this.fps.time);
      this.fps.frames = 0;
      this.fps.time = 0;
      this._adaptResolution();
    }

    this.update(Math.min(0.1, rawDt));
    this.render();
    this.input.endFrame();
  }

  /**
   * Résolution dynamique : si l'ordinateur ne tient pas 60 FPS, on baisse
   * la définition interne (jusqu'à 55 %), puis on la remonte quand c'est fluide.
   */
  _adaptResolution() {
    if (this.state === 'loading') return;
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
    if (this.state === 'loading') return;
    // Pas de combattants : la caméra orbite et se recentre sur le ring
    this.cameraRig.update(realDt, null, null);
    this.arena.update(realDt, this.camera.position, CENTER, []);
    this.screenFx.update(realDt, null);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    this.needsRender = false;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.input.detach();
    window.removeEventListener('resize', this._onResize);
    if (this._ro) this._ro.disconnect();
    this.arena.dispose();
    this.renderer.dispose();
    this.events.clear();
  }
}
