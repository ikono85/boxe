/**
 * main.js
 * ------------------------------------------------------------------
 * Point d'entrée : charge les polices, vérifie WebGL, crée le jeu.
 */

import './styles/main.css';
import { Settings } from './core/Settings.js';
import { Game } from './game/Game.js';

async function waitForFonts(timeout = 1800) {
  if (!document.fonts || !document.fonts.load) return;
  const loads = [
    document.fonts.load('900 64px "Big Shoulders Display"'),
    document.fonts.load('800 64px "Saira Extra Condensed"'),
    document.fonts.load('600 16px "Barlow Semi Condensed"'),
  ];
  await Promise.race([Promise.allSettled(loads), new Promise((r) => setTimeout(r, timeout))]);
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function boot(hotData = {}) {
  const loading = document.getElementById('loading');
  const settings = new Settings();
  if (hotData && hotData.settings) settings.assign(hotData.settings);

  if (!webglAvailable()) {
    loading.innerHTML = '<div><strong>BOXING ARENA</strong><span>Ce navigateur ne peut pas afficher la 3D (WebGL désactivé). Essayez Chrome, Edge ou Firefox à jour.</span></div>';
    return;
  }

  await waitForFonts();
  const game = new Game({
    canvas: document.getElementById('game-canvas'),
    uiRoot: document.getElementById('ui-root'),
    settings,
  });
  game.start();
  loading.classList.add('done');
  setTimeout(() => loading.remove(), 700);

  // Accès au jeu depuis la console (tests, réglages) : ?debug ou #debug
  if (import.meta.env.DEV || /debug/.test(location.search + location.hash)) window.__boxing = game;

  // Conserve les réglages si la page est mise à jour à chaud
  const hot = window.claude && window.claude.hot;
  if (hot && typeof hot.snapshot === 'function') hot.snapshot(() => ({ settings: settings.values }));
}

const hot = window.claude && window.claude.hot;
if (hot && typeof hot.ready === 'function') hot.ready(boot);
else boot((hot && hot.data) || {});
