/**
 * SoundSynth.js
 * ------------------------------------------------------------------
 * Synthèse procédurale des sons du jeu (aucun fichier audio requis).
 * Chaque générateur renvoie un Float32Array mono à `sr` Hz.
 * Ces sons servent de repli : un fichier déposé dans src/assets/sounds/
 * avec le même nom les remplace automatiquement (voir SoundLibrary.js).
 */

const TAU = Math.PI * 2;
const rnd = () => Math.random() * 2 - 1;

/** Filtre biquad (RBJ) appliqué échantillon par échantillon. */
class Biquad {
  constructor() {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }

  set(type, freq, q, sr) {
    const w = (TAU * Math.min(freq, sr * 0.45)) / sr;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    let b0;
    let b1;
    let b2;
    if (type === 'lowpass') {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
    } else if (type === 'highpass') {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    const a0 = 1 + alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
    return this;
  }

  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

function buffer(sr, dur) {
  return new Float32Array(Math.max(1, Math.floor(sr * dur)));
}

function normalize(out, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < out.length; i++) m = Math.max(m, Math.abs(out[i]));
  if (m > 0) {
    const k = peak / m;
    for (let i = 0; i < out.length; i++) out[i] *= k;
  }
  return out;
}

function fadeEdges(out, sr, fadeIn = 0.002, fadeOut = 0.01) {
  const a = Math.floor(sr * fadeIn);
  const b = Math.floor(sr * fadeOut);
  for (let i = 0; i < a && i < out.length; i++) out[i] *= i / a;
  for (let i = 0; i < b && i < out.length; i++) out[out.length - 1 - i] *= i / b;
  return out;
}

/* ---------------------------------------------------------------- */

/** Souffle d'un coup qui fend l'air. */
export function whoosh(sr, { dur = 0.16, f0 = 900, f1 = 2600, q = 1.4, attack = 0.35 } = {}) {
  const out = buffer(sr, dur);
  const bp = new Biquad();
  for (let i = 0; i < out.length; i++) {
    const t = i / out.length;
    if (i % 32 === 0) bp.set('bandpass', f0 * Math.pow(f1 / f0, t), q, sr);
    const env = t < attack ? Math.pow(t / attack, 1.5) : Math.pow(1 - (t - attack) / (1 - attack), 2);
    out[i] = bp.process(rnd()) * env;
  }
  return fadeEdges(normalize(out, 0.8), sr);
}

/** Impact : « thump » grave + claquement + chair. */
export function impact(sr, { dur = 0.3, f0 = 150, f1 = 50, thump = 1, crack = 0.6, crackHp = 2200, body = 0.3, decay = 0.09 } = {}) {
  const out = buffer(sr, dur);
  const hp = new Biquad().set('highpass', crackHp, 0.7, sr);
  const lp = new Biquad().set('lowpass', 700, 0.8, sr);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const f = f1 + (f0 - f1) * Math.exp(-t / 0.035);
    phase += (TAU * f) / sr;
    const th = Math.sin(phase) * Math.exp(-t / decay) * thump;
    const cr = hp.process(rnd()) * Math.exp(-t / 0.012) * crack;
    const bd = lp.process(rnd()) * Math.exp(-t / 0.05) * body;
    const click = t < 0.003 ? rnd() * (1 - t / 0.003) * 0.8 : 0;
    out[i] = th + cr + bd + click;
  }
  // Légère saturation pour plus de punch
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * 1.6);
  return fadeEdges(normalize(out, 0.95), sr, 0.0005, 0.02);
}

/** Coup bloqué : cuir contre cuir. */
export function block(sr) {
  const dur = 0.16;
  const out = buffer(sr, dur);
  const bp = new Biquad().set('bandpass', 950, 1.2, sr);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const f = 120 + 120 * Math.exp(-t / 0.02);
    phase += (TAU * f) / sr;
    out[i] = Math.sin(phase) * Math.exp(-t / 0.035) * 0.8 + bp.process(rnd()) * Math.exp(-t / 0.025) * 1.2;
  }
  return fadeEdges(normalize(out, 0.85), sr, 0.0005, 0.02);
}

/** Cloche de ring : partiels inharmoniques. */
export function bell(sr, { f0 = 760, dur = 3.2 } = {}) {
  const out = buffer(sr, dur);
  const partials = [
    [1, 1, 2.6], [1.004, 0.5, 2.4], [2.32, 0.55, 1.7], [4.25, 0.38, 1.0], [6.63, 0.22, 0.6], [9.38, 0.13, 0.35],
  ];
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    let v = 0;
    for (const [ratio, amp, d] of partials) v += Math.sin(TAU * f0 * ratio * t) * amp * Math.exp(-t / d);
    if (t < 0.006) v += rnd() * (1 - t / 0.006) * 0.6;
    out[i] = v;
  }
  return fadeEdges(normalize(out, 0.8), sr, 0.0005, 0.05);
}

/** Claquoir des 10 dernières secondes (deux coups de bois). */
export function clapper(sr) {
  const out = buffer(sr, 0.32);
  const bp = new Biquad().set('bandpass', 2300, 3, sr);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    let v = 0;
    for (const start of [0, 0.16]) {
      const u = t - start;
      if (u >= 0) v += (rnd() * Math.exp(-u / 0.008) + Math.sin(TAU * 1650 * u) * Math.exp(-u / 0.03) * 0.6);
    }
    out[i] = bp.process(v) + v * 0.15;
  }
  return fadeEdges(normalize(out, 0.8), sr);
}

/** Expiration du boxeur (« tss ») au moment du coup. */
export function exhale(sr) {
  const dur = 0.15;
  const out = buffer(sr, dur);
  const bp = new Biquad().set('bandpass', 4200, 0.9, sr);
  for (let i = 0; i < out.length; i++) {
    const t = i / out.length;
    const env = t < 0.08 ? t / 0.08 : Math.pow(1 - (t - 0.08) / 0.92, 2.2);
    out[i] = bp.process(rnd()) * env;
  }
  return fadeEdges(normalize(out, 0.6), sr);
}

/** Boucle d'ambiance du public (brouhaha). */
export function crowdLoop(sr, { dur = 6 } = {}) {
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  const bands = [
    [300, 0.8, 1], [520, 0.9, 0.8], [900, 1, 0.6], [1500, 1.2, 0.35], [2600, 1.4, 0.18],
  ].map(([f, q, g]) => ({ f: new Biquad().set('bandpass', f, q, sr), g, lfo: Math.random() * TAU, rate: 0.2 + Math.random() * 0.6 }));
  // Bruit rose approché
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = rnd();
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    const pink = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    const t = i / sr;
    let v = 0;
    for (const b of bands) v += b.f.process(pink) * b.g * (0.7 + 0.3 * Math.sin(TAU * b.rate * t + b.lfo));
    out[i] = v;
  }
  // « Voix » : rafales formantiques aléatoires
  const voices = Math.floor(dur * 14);
  for (let k = 0; k < voices; k++) {
    const start = Math.floor(Math.random() * (n - sr * 0.4));
    const len = Math.floor(sr * (0.12 + Math.random() * 0.3));
    const f = new Biquad().set('bandpass', 350 + Math.random() * 900, 6, sr);
    const amp = 0.15 + Math.random() * 0.25;
    for (let i = 0; i < len; i++) {
      const env = Math.sin((Math.PI * i) / len);
      out[start + i] += f.process(rnd()) * env * amp;
    }
  }
  // Boucle sans couture : fondu enchaîné fin → début
  const xf = Math.floor(sr * 0.5);
  for (let i = 0; i < xf; i++) {
    const a = i / xf;
    out[i] = out[i] * a + out[n - xf + i] * (1 - a);
  }
  const looped = out.subarray(0, n - xf);
  return normalize(Float32Array.from(looped), 0.5);
}

/** Ovation (KO, gros coup). */
export function crowdCheer(sr, { dur = 3.4 } = {}) {
  const out = buffer(sr, dur);
  const bands = [700, 1100, 1700, 2600, 3800].map((f) => new Biquad().set('bandpass', f, 0.9, sr));
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const env = t < 0.35 ? t / 0.35 : Math.max(0, 1 - (t - 0.35) / (dur - 0.35)) ** 1.4;
    const flutter = 0.75 + 0.25 * Math.sin(TAU * 7 * t + Math.sin(TAU * 0.7 * t) * 3);
    const w = rnd();
    let v = 0;
    for (const b of bands) v += b.process(w);
    out[i] = v * env * flutter;
  }
  return fadeEdges(normalize(out, 0.7), sr, 0.02, 0.2);
}

/** « Ooooh » du public après un gros coup. */
export function crowdOoh(sr) {
  const dur = 1.3;
  const out = buffer(sr, dur);
  const f1 = new Biquad();
  const f2 = new Biquad();
  for (let i = 0; i < out.length; i++) {
    const t = i / out.length;
    if (i % 64 === 0) {
      f1.set('bandpass', 380 + 140 * t, 5, sr);
      f2.set('bandpass', 820 + 180 * t, 6, sr);
    }
    const env = t < 0.15 ? t / 0.15 : (1 - (t - 0.15) / 0.85) ** 1.6;
    const w = rnd();
    out[i] = (f1.process(w) + f2.process(w) * 0.6) * env;
  }
  return fadeEdges(normalize(out, 0.6), sr, 0.02, 0.1);
}

/** Battement de cœur (vie basse). */
export function heartbeat(sr) {
  const out = buffer(sr, 0.55);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    let v = 0;
    for (const [start, amp] of [[0, 1], [0.19, 0.7]]) {
      const u = t - start;
      if (u >= 0) v += Math.sin(TAU * (48 + 20 * Math.exp(-u / 0.03)) * u) * Math.exp(-u / 0.06) * amp;
    }
    out[i] = v;
  }
  return fadeEdges(normalize(out, 0.9), sr);
}

/** Respiration haletante (essoufflement). */
export function breath(sr) {
  const dur = 1.1;
  const out = buffer(sr, dur);
  const lp = new Biquad().set('bandpass', 1300, 0.7, sr);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const inhale = t < 0.4 ? Math.sin((Math.PI * t) / 0.4) * 0.6 : 0;
    const ex = t > 0.5 ? Math.sin((Math.PI * (t - 0.5)) / 0.6) : 0;
    out[i] = lp.process(rnd()) * (inhale + ex);
  }
  return fadeEdges(normalize(out, 0.5), sr);
}

/** Bourdonnement d'oreille (sonné). */
export function ringing(sr) {
  const dur = 1.8;
  const out = buffer(sr, dur);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    out[i] = (Math.sin(TAU * 3150 * t) * 0.5 + Math.sin(TAU * 3170 * t) * 0.3) * Math.exp(-t / 0.7) * Math.min(1, t / 0.05);
  }
  return fadeEdges(normalize(out, 0.35), sr);
}

/** Petit carillon de combo (arcade). */
export function chime(sr) {
  const dur = 0.5;
  const out = buffer(sr, dur);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    let v = Math.sin(TAU * 1318.5 * t) * Math.exp(-t / 0.12);
    if (t > 0.07) v += Math.sin(TAU * 1975.5 * (t - 0.07)) * Math.exp(-(t - 0.07) / 0.18);
    out[i] = v;
  }
  return fadeEdges(normalize(out, 0.5), sr);
}

/** Sons d'interface. */
export function uiTick(sr, { f = 1100, dur = 0.05 } = {}) {
  const out = buffer(sr, dur);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    out[i] = Math.sin(TAU * f * t) * Math.exp(-t / (dur / 4));
  }
  return fadeEdges(normalize(out, 0.5), sr, 0.001, 0.005);
}

/** Réponse impulsionnelle de salle (réverbération stéréo). */
export function roomImpulse(ctx, { dur = 2.2, decay = 2.8 } = {}) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * dur);
  const ir = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    const lp = new Biquad().set('lowpass', 3500, 0.7, sr);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      d[i] = lp.process(rnd()) * Math.pow(1 - t, decay) * (i < sr * 0.01 ? i / (sr * 0.01) : 1);
    }
  }
  return ir;
}
