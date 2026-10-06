/**
 * Arena.js
 * ------------------------------------------------------------------
 * Assemble la salle : ring, éclairage, public, cube d'affichage suspendu,
 * brouillard. Point d'entrée unique pour changer de salle plus tard
 * (il suffira de créer d'autres « arènes » avec leurs propres réglages).
 */

import { Color, Fog, Group, Mesh, BoxGeometry, MeshStandardMaterial, MeshBasicMaterial } from 'three';
import { Ring } from './Ring.js';
import { Lighting } from './Lighting.js';
import { Audience } from './Audience.js';
import { createScoreboardCanvas, drawScoreboard, canvasTexture } from './Textures.js';
import { GameConfig } from '../config/GameConfig.js';
// Modèle « Professional Boxing Ring » par A1905 (Sketchfab), CC BY 4.0 — préparé par scripts/optimize-ring.mjs
import ringModelUrl from '../assets/models/ring.glb?url';

export class Arena {
  constructor(scene) {
    this.scene = scene;
    scene.background = new Color('#05060b');
    scene.fog = new Fog('#05060b', 11, 32);

    this.ring = new Ring();
    scene.add(this.ring.group);
    this.lighting = new Lighting(scene);
    this.audience = new Audience(scene);
    this._buildScoreboard();
    this.quality = null;
  }

  _buildScoreboard() {
    this.scoreCanvas = createScoreboardCanvas();
    drawScoreboard(this.scoreCanvas, {});
    this.scoreTex = canvasTexture(this.scoreCanvas);
    const screen = new MeshBasicMaterial({ map: this.scoreTex, toneMapped: false });
    const frame = new MeshStandardMaterial({ color: '#15171d', roughness: 0.5, metalness: 0.6 });
    // Faces : +x, -x, haut, bas, +z, -z
    const mats = [screen, screen, frame, frame, screen, screen];
    this.scoreboard = new Group();
    const box = new Mesh(new BoxGeometry(2.4, 1.2, 2.4), mats);
    this.scoreboard.add(box);
    this.scoreboard.position.set(0, 9.3, 0);
    this.scene.add(this.scoreboard);
    this._scoreState = '';
    this._scoreDisposables = [box.geometry, screen, frame, this.scoreTex];
  }

  /** Met à jour l'écran suspendu (seulement quand le texte change). */
  setScoreboard(info) {
    const key = `${info.round}/${info.total}/${info.time}/${info.red}/${info.blue}`;
    if (key === this._scoreState) return;
    this._scoreState = key;
    drawScoreboard(this.scoreCanvas, info);
    this.scoreTex.needsUpdate = true;
  }

  applyQuality(renderer, level) {
    const q = GameConfig.quality[level] || GameConfig.quality.medium;
    this.lighting.applyQuality(renderer, level);
    if (q.ringModel) this.ring.useModel(ringModelUrl);
    else this.ring.useProcedural();
    if (this.quality !== level) this.audience.build(q.audience);
    this.quality = level;
  }

  update(dt, cameraPos, focus, fighters) {
    this.ring.update(dt, fighters);
    this.lighting.update(dt, cameraPos, focus);
    this.audience.update(dt);
    this.scoreboard.rotation.y += dt * 0.08;
  }

  dispose() {
    this.ring.dispose();
    this.lighting.dispose();
    this.audience.dispose();
    for (const d of this._scoreDisposables) d.dispose();
  }
}
