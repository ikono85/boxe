/**
 * Audience.js
 * ------------------------------------------------------------------
 * Public en tribunes, très léger à afficher :
 *  - deux InstancedMesh (corps + têtes) : 2 appels de dessin pour tout le public ;
 *  - l'animation (balancement, sauts quand la salle s'enflamme) est faite dans
 *    le vertex shader : aucun calcul CPU par spectateur ;
 *  - gradins fusionnés en une seule géométrie ;
 *  - flashs d'appareils photo et panneau LED défilant au bord du ring.
 */

import {
  Group, InstancedMesh, Mesh, BoxGeometry, CapsuleGeometry, SphereGeometry, PlaneGeometry,
  MeshLambertMaterial, MeshBasicMaterial, MeshStandardMaterial, Matrix4, Quaternion, Vector3, Euler, Color,
  Sprite, SpriteMaterial, AdditiveBlending,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GameConfig } from '../config/GameConfig.js';
import { createLedBoardTexture, createGlowTexture } from './Textures.js';

const FLOOR_Y = -GameConfig.ring.platformHeight;
const FIRST_ROW = 5.6;
const ROW_DEPTH = 0.92;
const ROW_RISE = 0.5;
const SEAT_SPACING = 0.64;

const CLOTHES = ['#23283a', '#3a2f2a', '#2b3b4f', '#4a1f24', '#1f3b2c', '#545454', '#6b5b4b', '#1c1c22', '#2e2e3a', '#5c2a2a', '#3d4a5c', '#7a6a55'];
const SKINS = ['#e3bb98', '#c88d63', '#94603f', '#5f3c27', '#f0cfb2', '#b17652'];

export class Audience {
  constructor(scene) {
    this.scene = scene;
    this.group = new Group();
    this.group.name = 'audience';
    scene.add(this.group);
    this.uniforms = { uTime: { value: 0 }, uExcite: { value: 0.1 } };
    this.excitement = 0.1;
    this.targetExcitement = 0.1;
    this.flashTimer = 0;
    this.time = 0;
    this.seats = [];
    this.disposables = [];
    this._buildStatic();
    this._buildFlashes();
  }

  _track(x) {
    this.disposables.push(x);
    return x;
  }

  _injectBob(material) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uExcite = this.uniforms.uExcite;
      shader.vertexShader = `uniform float uTime;\nuniform float uExcite;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float ph = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
          float freq = 1.6 + ph * 2.4;
          float wave = sin(uTime * freq * (1.0 + uExcite * 1.5) + ph * 6.2831);
          float jumper = step(0.45, ph) * uExcite;
          transformed.y += 0.012 * wave + jumper * 0.16 * max(0.0, wave);
          transformed.x += sin(uTime * 0.6 + ph * 12.0) * 0.025 * (0.4 + uExcite);
        #endif`,
      );
    };
  }

  _buildStatic() {
    // Gradins : une marche par rangée et par côté, fusionnées
    const rows = 10;
    const parts = [];
    for (let r = 0; r < rows; r++) {
      const h = FIRST_ROW + r * ROW_DEPTH;
      const top = FLOOR_Y + 0.05 + r * ROW_RISE;
      const height = top - FLOOR_Y + 0.4;
      for (let s = 0; s < 4; s++) {
        const g = new BoxGeometry(2 * h + ROW_DEPTH * 2, height, ROW_DEPTH);
        const a = (s * Math.PI) / 2;
        g.rotateY(a);
        g.translate(Math.sin(a) * (h + ROW_DEPTH / 2), top - height / 2, Math.cos(a) * (h + ROW_DEPTH / 2));
        parts.push(g);
      }
    }
    const stands = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    this._track(stands);
    const standMat = this._track(new MeshStandardMaterial({ color: '#12141b', roughness: 0.95, metalness: 0.05 }));
    this.stands = new Mesh(stands, standMat);
    this.stands.receiveShadow = false;
    this.group.add(this.stands);

    // Sol de la salle
    const floor = new Mesh(
      this._track(new PlaneGeometry(60, 60)),
      this._track(new MeshStandardMaterial({ color: '#0b0c11', roughness: 0.9 })),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Panneau LED au bord de la zone ringside
    this.ledTex = this._track(createLedBoardTexture());
    this.ledTex.repeat.set(0.8, 1); // conserve les proportions du texte sur 10 m de panneau
    const ledMat = this._track(new MeshBasicMaterial({ map: this.ledTex, toneMapped: false }));
    const ledH = 0.62;
    const ledHalf = FIRST_ROW - 0.35;
    for (let s = 0; s < 4; s++) {
      const a = (s * Math.PI) / 2;
      const panel = new Mesh(this._track(new PlaneGeometry(ledHalf * 2, ledH)), ledMat);
      panel.position.set(Math.sin(a) * ledHalf, FLOOR_Y + ledH / 2 + 0.05, Math.cos(a) * ledHalf);
      panel.rotation.y = a + Math.PI; // face vers le ring
      this.group.add(panel);
      const back = new Mesh(this._track(new BoxGeometry(ledHalf * 2, ledH + 0.1, 0.12)), standMat);
      back.position.set(Math.sin(a) * (ledHalf + 0.07), FLOOR_Y + ledH / 2 + 0.05, Math.cos(a) * (ledHalf + 0.07));
      back.rotation.y = a;
      this.group.add(back);
    }
  }

  /** (Re)crée les spectateurs selon le niveau de qualité. */
  build(count) {
    this._disposeCrowd();
    const seats = [];
    const rows = 10;
    for (let r = 0; r < rows; r++) {
      const h = FIRST_ROW + r * ROW_DEPTH + ROW_DEPTH * 0.45;
      const y = FLOOR_Y + 0.05 + r * ROW_RISE;
      for (let s = 0; s < 4; s++) {
        const a = (s * Math.PI) / 2;
        const n = Math.floor((2 * h) / SEAT_SPACING);
        for (let i = 0; i < n; i++) {
          const along = -h + (i + 0.5) * SEAT_SPACING + (Math.random() - 0.5) * 0.12;
          const x = Math.sin(a) * h + Math.cos(a) * along;
          const z = Math.cos(a) * h - Math.sin(a) * along;
          seats.push({ x, y, z, row: r, yaw: a + Math.PI });
        }
      }
    }
    // On garde en priorité les premiers rangs (les plus visibles)
    for (const s of seats) s.keep = Math.random() * (1 + s.row * 0.22);
    seats.sort((p, q) => p.keep - q.keep);
    const chosen = seats.slice(0, Math.min(count, seats.length));
    this.seats = chosen;

    const bodyGeo = this._track(new CapsuleGeometry(0.2, 0.3, 3, 8));
    const headGeo = this._track(new SphereGeometry(0.115, 10, 8));
    const bodyMat = this._track(new MeshLambertMaterial({ color: '#ffffff' }));
    const headMat = this._track(new MeshLambertMaterial({ color: '#ffffff' }));
    this._injectBob(bodyMat);
    this._injectBob(headMat);

    this.bodies = new InstancedMesh(bodyGeo, bodyMat, chosen.length);
    this.heads = new InstancedMesh(headGeo, headMat, chosen.length);
    const m = new Matrix4();
    const q = new Quaternion();
    const e = new Euler();
    const p = new Vector3();
    const sc = new Vector3();
    const c = new Color();
    chosen.forEach((seat, i) => {
      const standing = Math.random() < 0.12;
      const k = 0.9 + Math.random() * 0.22;
      e.set(0, seat.yaw + (Math.random() - 0.5) * 0.5, 0);
      q.setFromEuler(e);
      const lift = standing ? 0.42 : 0;
      p.set(seat.x, seat.y + 0.62 * k + lift, seat.z);
      sc.set(k * (0.95 + Math.random() * 0.15), k, k);
      m.compose(p, q, sc);
      this.bodies.setMatrixAt(i, m);
      c.set(CLOTHES[(Math.random() * CLOTHES.length) | 0]).multiplyScalar(0.7 + Math.random() * 0.5);
      this.bodies.setColorAt(i, c);

      p.set(seat.x, seat.y + 0.62 * k + lift + 0.5 * k, seat.z);
      sc.set(k, k * 1.08, k);
      m.compose(p, q, sc);
      this.heads.setMatrixAt(i, m);
      c.set(SKINS[(Math.random() * SKINS.length) | 0]).multiplyScalar(0.75 + Math.random() * 0.3);
      this.heads.setColorAt(i, c);
    });
    this.bodies.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
    if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;
    if (this.heads.instanceColor) this.heads.instanceColor.needsUpdate = true;
    this.bodies.frustumCulled = false;
    this.heads.frustumCulled = false;
    this.group.add(this.bodies, this.heads);
    this._crowdDisposables = [bodyGeo, headGeo, bodyMat, headMat];
  }

  _disposeCrowd() {
    if (this.bodies) {
      this.group.remove(this.bodies, this.heads);
      this.bodies.dispose();
      this.heads.dispose();
      for (const d of this._crowdDisposables) {
        d.dispose();
        const i = this.disposables.indexOf(d);
        if (i >= 0) this.disposables.splice(i, 1);
      }
      this.bodies = null;
      this.heads = null;
    }
  }

  _buildFlashes() {
    const tex = this._track(createGlowTexture('rgba(235,245,255,1)'));
    this.flashes = [];
    for (let i = 0; i < 10; i++) {
      const s = new Sprite(this._track(new SpriteMaterial({
        map: tex, color: '#eef6ff', blending: AdditiveBlending, transparent: true, depthWrite: false,
      })));
      s.visible = false;
      s.scale.setScalar(0.9);
      this.group.add(s);
      this.flashes.push({ sprite: s, life: 0 });
    }
  }

  /** Réaction du public : 0 = calme, 1 = délire. */
  cheer(amount) {
    this.targetExcitement = Math.min(1, this.targetExcitement + amount);
  }

  setBaseExcitement(v) {
    this.baseExcitement = v;
  }

  update(dt) {
    this.time += dt;
    const base = this.baseExcitement ?? 0.12;
    this.targetExcitement = Math.max(base, this.targetExcitement - dt * 0.18);
    this.excitement += (this.targetExcitement - this.excitement) * Math.min(1, dt * 3);
    this.uniforms.uTime.value = this.time;
    this.uniforms.uExcite.value = this.excitement;
    this.ledTex.offset.x = (this.ledTex.offset.x + dt * 0.035) % 1;

    // Flashs photo
    this.flashTimer -= dt;
    if (this.flashTimer <= 0 && this.seats.length) {
      this.flashTimer = 1 / (0.7 + this.excitement * 9) * (0.5 + Math.random());
      const f = this.flashes.find((x) => x.life <= 0);
      if (f) {
        const seat = this.seats[(Math.random() * this.seats.length) | 0];
        f.sprite.position.set(seat.x, seat.y + 1.25, seat.z);
        f.sprite.visible = true;
        f.life = 0.07 + Math.random() * 0.05;
      }
    }
    for (const f of this.flashes) {
      if (f.life > 0) {
        f.life -= dt;
        f.sprite.material.opacity = Math.max(0, f.life / 0.1);
        if (f.life <= 0) f.sprite.visible = false;
      }
    }
  }

  dispose() {
    this._disposeCrowd();
    for (const d of this.disposables) if (d && d.dispose) d.dispose();
    this.scene.remove(this.group);
  }
}
