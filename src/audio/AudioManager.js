/**
 * AudioManager.js
 * ------------------------------------------------------------------
 * Gestion du son avec la Web Audio API.
 *
 *  sources ─┬─ bus sfx ──── filtre « étouffé » ─┐
 *           ├─ bus ambiance ─────────────────────┼─ master ─ compresseur ─ sortie
 *           ├─ bus interface ────────────────────┤
 *           └─ envoi réverbération (salle) ──────┘
 *
 * - Les sons sont synthétisés au démarrage (SoundSynth) ou chargés depuis
 *   src/assets/sounds/ s'ils existent (même nom que la clé).
 * - Le contexte audio est créé au premier clic (règle des navigateurs).
 * - Le public réagit : volume et brillance suivent l'excitation de la salle.
 */

import { SOUND_LIBRARY, discoverSoundFiles } from './SoundLibrary.js';
import { roomImpulse } from './SoundSynth.js';

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.ready = false;
    this.loading = null;
    this.volumes = { master: 0.8, sfx: 0.9 };
    this.crowd = null;
    this.excitement = 0.15;
    this.lastPlayed = new Map();
  }

  /** À appeler depuis un geste de l'utilisateur. */
  async init() {
    if (this.loading) return this.loading;
    this.loading = this._init();
    return this.loading;
  }

  async _init() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;

    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);

    this.sfx = ctx.createGain();
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.sfx.connect(this.muffle).connect(this.master);
    this.ambience = ctx.createGain();
    this.ambience.connect(this.master);
    this.ui = ctx.createGain();
    this.ui.connect(this.master);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = roomImpulse(ctx);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.32;
    this.reverb.connect(this.reverbGain).connect(this.master);

    this.applyVolumes();

    // Chargement / synthèse (on rend la main au navigateur entre deux sons)
    const files = discoverSoundFiles();
    for (const [key, def] of Object.entries(SOUND_LIBRARY)) {
      let buf = null;
      if (files[key]) {
        try {
          const res = await fetch(files[key]);
          buf = await ctx.decodeAudioData(await res.arrayBuffer());
        } catch {
          buf = null; // fichier illisible : on garde le son synthétisé
        }
      }
      if (!buf) {
        const data = def.synth(ctx.sampleRate);
        buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
        buf.copyToChannel(data, 0);
      }
      this.buffers.set(key, buf);
      await new Promise((r) => setTimeout(r, 0));
    }
    this.ready = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  setVolumes({ master, sfx }) {
    if (master !== undefined) this.volumes.master = master;
    if (sfx !== undefined) this.volumes.sfx = sfx;
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.ui.gain.setTargetAtTime(Math.min(1, this.volumes.sfx * 1.1), t, 0.05);
    this.ambience.gain.setTargetAtTime(1, t, 0.05);
  }

  /**
   * Joue un son.
   * @param {string} key clé de SOUND_LIBRARY
   * @param {{volume?: number, rate?: number, pan?: number, delay?: number, minGap?: number}} opts
   */
  play(key, { volume = 1, rate = 1, pan = 0, delay = 0, minGap = 0.03, vary = 0.06 } = {}) {
    if (!this.ready) return null;
    const buf = this.buffers.get(key);
    const def = SOUND_LIBRARY[key];
    if (!buf || !def) return null;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // Anti-saturation : un même son ne repart pas plusieurs fois dans la même frame
    const last = this.lastPlayed.get(key) || 0;
    if (now - last < minGap) return null;
    this.lastPlayed.set(key, now);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * vary);
    const gain = ctx.createGain();
    gain.gain.value = def.volume * volume;
    let node = src.connect(gain);
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node = node.connect(p);
    }
    const bus = def.category === 'ambience' ? this.ambience : def.category === 'ui' ? this.ui : this.sfx;
    node.connect(bus);
    if (def.reverb) node.connect(this.reverb);
    src.start(now + delay);
    return src;
  }

  /**
   * Voix de l'arbitre (synthèse vocale du navigateur, en français).
   * Silencieuse si le navigateur ne la propose pas ou si le son est coupé.
   */
  say(text) {
    try {
      const synth = typeof window !== 'undefined' && window.speechSynthesis;
      if (!synth || !this.ctx || this.volumes.master <= 0.01) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'fr-FR';
      u.rate = 1.15;
      u.pitch = 0.8;
      u.volume = Math.min(1, this.volumes.master * this.volumes.sfx * 1.1);
      if (!this.voice) {
        const voices = synth.getVoices();
        this.voice = voices.find((v) => /^fr/i.test(v.lang)) || null;
      }
      if (this.voice) u.voice = this.voice;
      synth.speak(u);
    } catch {
      /* pas de voix : le chiffre reste affiché */
    }
  }

  /** Coup reçu violent : le son s'étouffe un instant. */
  muffleFor(amount = 1, duration = 0.6) {
    if (!this.ctx) return;
    const f = this.muffle.frequency;
    const t = this.ctx.currentTime;
    f.cancelScheduledValues(t);
    f.setValueAtTime(Math.max(500, 2600 - amount * 2000), t);
    f.exponentialRampToValueAtTime(20000, t + duration);
  }

  /** Démarre la boucle du public. */
  startCrowd() {
    if (!this.ready || this.crowd) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.buffers.get('crowd_ambience');
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2200;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.ambience);
    gain.connect(this.reverb);
    src.start();
    this.crowd = { src, filter, gain };
    this.setCrowdExcitement(this.excitement);
  }

  /** 0 = salle calme, 1 = salle en délire. */
  setCrowdExcitement(v) {
    this.excitement = v;
    if (!this.crowd) return;
    const t = this.ctx.currentTime;
    const base = SOUND_LIBRARY.crowd_ambience.volume;
    this.crowd.gain.gain.setTargetAtTime(base * (0.45 + v * 0.9), t, 0.25);
    this.crowd.filter.frequency.setTargetAtTime(1600 + v * 4500, t, 0.25);
  }

  /** Volume du public dans le menu / en pause. */
  setCrowdLevel(level) {
    if (!this.crowd) return;
    this.crowd.gain.gain.setTargetAtTime(SOUND_LIBRARY.crowd_ambience.volume * level, this.ctx.currentTime, 0.4);
  }
}
