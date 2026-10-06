/**
 * Settings.js
 * ------------------------------------------------------------------
 * Options du joueur, sauvegardées dans le localStorage quand il est
 * disponible (tout accès est protégé : le jeu fonctionne sans).
 */

const STORAGE_KEY = 'boxing-arena:settings:v1';
const RECORDS_KEY = 'boxing-arena:records:v1';

export const DEFAULT_SETTINGS = {
  mouseSensitivity: 1, // 0.2 → 3
  invertY: false,
  masterVolume: 0.8,
  sfxVolume: 0.9,
  quality: 'medium', // 'low' | 'medium' | 'high'
  cameraShake: true,
  aimAssist: true,
  showFps: false,
  showControls: true,
  difficulty: 'intermediate',
  rounds: 3,
  roundDuration: 60,
};

function safeRead(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeWrite(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible : on ignore */
  }
}

export class Settings {
  constructor() {
    this.values = { ...DEFAULT_SETTINGS, ...(safeRead(STORAGE_KEY) || {}) };
    this.listeners = new Set();
    this.records = safeRead(RECORDS_KEY) || {};
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    safeWrite(STORAGE_KEY, this.values);
    for (const fn of this.listeners) fn(key, value, this.values);
  }

  /** Remplace plusieurs valeurs d'un coup (ex. restauration à chaud). */
  assign(values) {
    for (const [k, v] of Object.entries(values)) {
      if (k in DEFAULT_SETTINGS) this.set(k, v);
    }
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  reset() {
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) this.set(k, v);
  }

  /** Meilleur score par difficulté. Retourne true si c'est un nouveau record. */
  submitScore(difficulty, score) {
    const best = this.records[difficulty] || 0;
    if (score > best) {
      this.records[difficulty] = score;
      safeWrite(RECORDS_KEY, this.records);
      return true;
    }
    return false;
  }

  bestScore(difficulty) {
    return this.records[difficulty] || 0;
  }
}
