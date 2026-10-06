/**
 * Textures.js
 * ------------------------------------------------------------------
 * Textures générées au chargement avec un <canvas> : aucun fichier image
 * à télécharger. Pour utiliser de vraies textures, remplacez une fonction
 * par un TextureLoader pointant vers src/assets/textures/.
 */

import { CanvasTexture, SRGBColorSpace, RepeatWrapping, LinearFilter } from 'three';

export const DISPLAY_FONT = '"Big Shoulders Display", "Saira Extra Condensed", "Arial Narrow", Impact, "Arial Black", sans-serif';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(canvas, { repeat = false, srgb = true, anisotropy = 4 } = {}) {
  const tex = new CanvasTexture(canvas);
  if (srgb) tex.colorSpace = SRGBColorSpace;
  if (repeat) {
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
  }
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

/** Bruit de toile : petites variations de luminosité pixel par pixel. */
function addFabricNoise(ctx, w, h, strength = 14) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * strength;
    const weave = ((i >> 2) % 2 === 0 ? 2 : -2) * (((i >> 2) / w) % 2 < 1 ? 1 : -1);
    d[i] = Math.max(0, Math.min(255, d[i] + n + weave));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n + weave));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n + weave));
  }
  ctx.putImageData(img, 0, 0);
}

/** Tapis du ring : toile bleu roi, emblème central, coins rouge et bleu. */
export function createRingMatTexture(ringSize, apron) {
  const S = 1024;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const total = ringSize + apron * 2;
  const m2px = S / total;

  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.05, S / 2, S / 2, S * 0.75);
  g.addColorStop(0, '#2449a0');
  g.addColorStop(1, '#152c66');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  // Bord du tapis (au-delà des cordes) plus sombre
  const inner = (apron * m2px) | 0;
  ctx.fillStyle = 'rgba(5, 10, 30, 0.45)';
  ctx.fillRect(0, 0, S, inner);
  ctx.fillRect(0, S - inner, S, inner);
  ctx.fillRect(0, 0, inner, S);
  ctx.fillRect(S - inner, 0, inner, S);
  ctx.strokeStyle = 'rgba(236, 228, 210, 0.55)';
  ctx.lineWidth = 4;
  ctx.strokeRect(inner, inner, S - inner * 2, S - inner * 2);

  // Coins rouge (+x,+z) et bleu (-x,-z) : triangles discrets
  const tri = (x, y, dx, dy, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx * 150, y);
    ctx.lineTo(x, y + dy * 150);
    ctx.closePath();
    ctx.fill();
  };
  tri(S - inner, S - inner, -1, -1, 'rgba(214, 40, 40, 0.55)');
  tri(inner, inner, 1, 1, 'rgba(40, 110, 255, 0.5)');
  tri(S - inner, inner, -1, 1, 'rgba(236, 228, 210, 0.22)');
  tri(inner, S - inner, 1, -1, 'rgba(236, 228, 210, 0.22)');

  // Emblème central
  const cx = S / 2;
  const cy = S / 2;
  const R = 1.55 * m2px;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = 'rgba(8, 16, 44, 0.55)';
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#d9b25a';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, R - 34, 0, Math.PI * 2);
  ctx.stroke();

  // Texte circulaire
  const ringText = '  BOXING ARENA  ★  NUIT DES CHAMPIONS  ★  3 ROUNDS  ★ ';
  ctx.fillStyle = '#efe6cf';
  ctx.font = `700 26px ${DISPLAY_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const chars = ringText.split('');
  for (let i = 0; i < chars.length; i++) {
    const a = (i / chars.length) * Math.PI * 2 - Math.PI / 2;
    ctx.save();
    ctx.rotate(a + Math.PI / 2);
    ctx.translate(0, -(R - 17));
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
  }

  // Wordmark
  ctx.fillStyle = '#efe6cf';
  ctx.font = `800 44px ${DISPLAY_FONT}`;
  ctx.fillText('B O X I N G', 0, -62);
  ctx.font = `900 132px ${DISPLAY_FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('ARENA', 0, 18);
  ctx.fillStyle = '#d9b25a';
  ctx.fillRect(-120, 92, 240, 6);
  ctx.restore();

  // Traces d'usure
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 20 + Math.random() * 70;
    const sg = ctx.createRadialGradient(x, y, 0, x, y, r);
    sg.addColorStop(0, 'rgba(0, 0, 20, 0.08)');
    sg.addColorStop(1, 'rgba(0, 0, 20, 0)');
    ctx.fillStyle = sg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  addFabricNoise(ctx, S, S, 16);
  return toTexture(c, { anisotropy: 8 });
}

/** Jupe du ring : bande sombre avec le nom de la salle. */
export function createApronTexture() {
  const W = 2048;
  const H = 256;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#11172a');
  g.addColorStop(1, '#070a14');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#c8202a';
  ctx.fillRect(0, 0, W, 16);
  ctx.fillStyle = '#1e56d6';
  ctx.fillRect(0, H - 16, W, 16);
  ctx.fillStyle = '#d9b25a';
  ctx.fillRect(0, 16, W, 4);
  ctx.fillRect(0, H - 20, W, 4);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 2; i++) {
    const x = W * 0.25 + i * W * 0.5;
    ctx.fillStyle = '#f2ead6';
    ctx.font = `900 132px ${DISPLAY_FONT}`;
    ctx.fillText('BOXING ARENA', x, H / 2 + 6);
    ctx.fillStyle = '#d9b25a';
    ctx.font = `700 40px ${DISPLAY_FONT}`;
    ctx.fillText('★', x - 470, H / 2);
    ctx.fillText('★', x + 470, H / 2);
  }
  return toTexture(c, { repeat: true });
}

/** Panneau LED défilant autour des tribunes. */
export function createLedBoardTexture() {
  const W = 2048;
  const H = 96;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, W, H);
  const items = [
    ['BOXING ARENA', '#ff5a36'],
    ['★', '#f5c542'],
    ['NUIT DES CHAMPIONS', '#f2ead6'],
    ['★', '#f5c542'],
    ['COIN ROUGE', '#ff3b3b'],
    ['VS', '#f2ead6'],
    ['COIN BLEU', '#3b8bff'],
    ['★', '#f5c542'],
  ];
  ctx.font = `800 64px ${DISPLAY_FONT}`;
  ctx.textBaseline = 'middle';
  let x = 30;
  let k = 0;
  while (x < W) {
    const [txt, col] = items[k % items.length];
    ctx.fillStyle = col;
    ctx.fillText(txt, x, H / 2 + 3);
    x += ctx.measureText(txt).width + 48;
    k++;
  }
  // Grille de LED
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
  for (let xx = 0; xx < W; xx += 4) ctx.fillRect(xx, 0, 1, H);
  const tex = toTexture(c, { repeat: true });
  tex.minFilter = LinearFilter;
  return tex;
}

/** Halo radial (lumières, flashs, impacts). */
export function createGlowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const S = 128;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.55)'));
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(c);
}

/** Étoile d'impact (quatre branches). */
export function createImpactTexture() {
  const S = 128;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  ctx.translate(S / 2, S / 2);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,240,210,0.8)');
  g.addColorStop(1, 'rgba(255,200,150,0)');
  ctx.fillStyle = g;
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI) / 2 + Math.PI / 4);
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.lineTo(0, -S / 2);
    ctx.lineTo(7, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, S * 0.22, 0, Math.PI * 2);
  ctx.fill();
  return toTexture(c);
}

/** Écran du cube suspendu au-dessus du ring (mis à jour pendant le match). */
export function createScoreboardCanvas() {
  return makeCanvas(512, 256);
}

export function drawScoreboard(canvas, { round = 1, total = 3, time = '1:00', red = 'COIN ROUGE', blue = 'COIN BLEU' } = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = '#04060c';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f5c542';
  ctx.font = `800 40px ${DISPLAY_FONT}`;
  ctx.fillText(`ROUND ${round} / ${total}`, W / 2, 46);
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 120px ${DISPLAY_FONT}`;
  ctx.fillText(time, W / 2, 140);
  ctx.font = `700 30px ${DISPLAY_FONT}`;
  ctx.fillStyle = '#ff4a3d';
  ctx.textAlign = 'left';
  ctx.fillText(red, 24, 224);
  ctx.fillStyle = '#4d93ff';
  ctx.textAlign = 'right';
  ctx.fillText(blue, W - 24, 224);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
}

export function canvasTexture(canvas) {
  return toTexture(canvas);
}
