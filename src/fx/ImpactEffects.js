/**
 * ImpactEffects.js
 * ------------------------------------------------------------------
 * Effets visuels légers des impacts, avec des pools pré-alloués
 * (aucune création d'objet pendant le combat) :
 *  - éclat lumineux au point d'impact ;
 *  - gouttes de sueur projetées ;
 *  - onde de choc pour les coups critiques.
 */

import {
  Group, Sprite, SpriteMaterial, AdditiveBlending, Points, PointsMaterial, BufferGeometry,
  Float32BufferAttribute, Mesh, RingGeometry, MeshBasicMaterial, Vector3, DoubleSide,
} from 'three';
import { createImpactTexture, createGlowTexture } from '../world/Textures.js';

const MAX_DROPS = 160;

export class ImpactEffects {
  constructor(scene) {
    this.scene = scene;
    this.group = new Group();
    this.group.name = 'impact-fx';
    scene.add(this.group);
    this.disposables = [];
    this.particleScale = 1;

    // Éclats
    const flashTex = this._track(createImpactTexture());
    this.flashes = [];
    for (let i = 0; i < 6; i++) {
      const mat = this._track(new SpriteMaterial({
        map: flashTex, blending: AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, color: '#fff1dc',
      }));
      const s = new Sprite(mat);
      s.visible = false;
      s.renderOrder = 10;
      this.group.add(s);
      this.flashes.push({ sprite: s, life: 0, maxLife: 0.12, size: 0.4 });
    }

    // Sueur
    const pos = new Float32Array(MAX_DROPS * 3);
    this.dropVel = new Float32Array(MAX_DROPS * 3);
    this.dropLife = new Float32Array(MAX_DROPS);
    for (let i = 0; i < MAX_DROPS; i++) pos[i * 3 + 1] = -100;
    const geo = this._track(new BufferGeometry());
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    const dropTex = this._track(createGlowTexture('rgba(235,245,255,1)'));
    this.drops = new Points(geo, this._track(new PointsMaterial({
      size: 0.022, map: dropTex, transparent: true, opacity: 0.85, depthWrite: false, color: '#e8f2ff',
    })));
    this.drops.frustumCulled = false;
    this.group.add(this.drops);
    this.nextDrop = 0;
    this.activeDrops = 0;

    // Ondes de choc
    this.rings = [];
    const ringGeo = this._track(new RingGeometry(0.8, 1, 32));
    for (let i = 0; i < 3; i++) {
      const m = new Mesh(ringGeo, this._track(new MeshBasicMaterial({
        color: '#ffe2b0', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide,
      })));
      m.visible = false;
      m.renderOrder = 11;
      this.group.add(m);
      this.rings.push({ mesh: m, life: 0 });
    }
  }

  _track(x) {
    this.disposables.push(x);
    return x;
  }

  setQuality(level) {
    this.particleScale = level === 'low' ? 0.4 : level === 'high' ? 1.3 : 1;
  }

  /**
   * @param {Vector3} point point d'impact
   * @param {Vector3} dir direction du coup (normalisée)
   * @param {{crit?: boolean, blocked?: boolean, power?: number, camera?: object}} opts
   */
  spawn(point, dir, { crit = false, blocked = false, power = 1, camera = null } = {}) {
    const f = this.flashes.find((x) => x.life <= 0) || this.flashes[0];
    f.sprite.position.copy(point);
    f.sprite.visible = true;
    f.maxLife = blocked ? 0.09 : crit ? 0.18 : 0.12;
    f.life = f.maxLife;
    f.size = (blocked ? 0.22 : 0.32) * (crit ? 1.7 : 1) * (0.8 + power * 0.25);
    f.sprite.material.color.set(blocked ? '#cfd8ff' : crit ? '#ffd8a0' : '#fff1dc');
    f.sprite.material.rotation = Math.random() * Math.PI;

    // Gouttes
    const n = Math.round((blocked ? 5 : crit ? 18 : 10) * power * this.particleScale);
    const pos = this.drops.geometry.attributes.position.array;
    for (let i = 0; i < n; i++) {
      const k = this.nextDrop;
      this.nextDrop = (this.nextDrop + 1) % MAX_DROPS;
      pos[k * 3] = point.x + (Math.random() - 0.5) * 0.05;
      pos[k * 3 + 1] = point.y + (Math.random() - 0.5) * 0.05;
      pos[k * 3 + 2] = point.z + (Math.random() - 0.5) * 0.05;
      const sp = 1.2 + Math.random() * 2.2;
      this.dropVel[k * 3] = (dir.x + (Math.random() - 0.5) * 1.4) * sp;
      this.dropVel[k * 3 + 1] = (0.4 + Math.random() * 0.9) * sp * 0.6;
      this.dropVel[k * 3 + 2] = (dir.z + (Math.random() - 0.5) * 1.4) * sp;
      this.dropLife[k] = 0.35 + Math.random() * 0.4;
    }
    this.activeDrops = MAX_DROPS;

    if (crit) {
      const r = this.rings.find((x) => x.life <= 0) || this.rings[0];
      r.mesh.position.copy(point);
      if (camera) r.mesh.quaternion.copy(camera.quaternion);
      r.mesh.visible = true;
      r.life = 0.28;
    }
  }

  update(dt) {
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const k = 1 - Math.max(0, f.life) / f.maxLife;
      f.sprite.scale.setScalar(f.size * (0.55 + k * 0.7));
      f.sprite.material.opacity = 1 - k * k;
      if (f.life <= 0) f.sprite.visible = false;
    }

    if (this.activeDrops > 0) {
      const pos = this.drops.geometry.attributes.position.array;
      let alive = 0;
      for (let i = 0; i < MAX_DROPS; i++) {
        if (this.dropLife[i] <= 0) continue;
        this.dropLife[i] -= dt;
        const k = i * 3;
        this.dropVel[k + 1] -= 9.8 * dt;
        pos[k] += this.dropVel[k] * dt;
        pos[k + 1] += this.dropVel[k + 1] * dt;
        pos[k + 2] += this.dropVel[k + 2] * dt;
        if (pos[k + 1] < 0.01 || this.dropLife[i] <= 0) {
          this.dropLife[i] = 0;
          pos[k + 1] = -100;
        } else alive++;
      }
      this.drops.geometry.attributes.position.needsUpdate = true;
      this.activeDrops = alive;
    }

    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const k = 1 - Math.max(0, r.life) / 0.28;
      r.mesh.scale.setScalar(0.08 + k * 0.5);
      r.mesh.material.opacity = (1 - k) * 0.7;
      if (r.life <= 0) r.mesh.visible = false;
    }
  }

  dispose() {
    for (const d of this.disposables) if (d && d.dispose) d.dispose();
    this.scene.remove(this.group);
  }
}
