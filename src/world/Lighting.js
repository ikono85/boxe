/**
 * Lighting.js
 * ------------------------------------------------------------------
 * Éclairage de salle de boxe : ring très éclairé, public dans la pénombre.
 *  - un projecteur zénithal (seul à projeter des ombres, pour les perfs) ;
 *  - deux projecteurs latéraux chaud / froid pour le contraste ;
 *  - une lumière de contre-jour qui suit la caméra pour détacher l'adversaire ;
 *  - une rampe de projecteurs visibles avec halos et faux faisceaux volumétriques ;
 *  - de la poussière qui flotte dans la lumière.
 */

import {
  Group, HemisphereLight, SpotLight, DirectionalLight, Object3D, Mesh, BoxGeometry, CylinderGeometry,
  ConeGeometry, CircleGeometry, MeshStandardMaterial, MeshBasicMaterial, ShaderMaterial, AdditiveBlending,
  Sprite, SpriteMaterial, Points, PointsMaterial, BufferGeometry, Float32BufferAttribute, Color, Vector3,
  FrontSide, PCFShadowMap,
} from 'three';
import { GameConfig } from '../config/GameConfig.js';
import { createGlowTexture } from './Textures.js';

const TRUSS_Y = 7.4;
const TRUSS_HALF = 4.4;

/** Matériau des faisceaux : additif, s'estompe vers le bas et sur les bords. */
function createBeamMaterial(color) {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(color) },
      uIntensity: { value: 0.22 },
    },
    vertexShader: /* glsl */ `
      varying float vH;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        vH = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying float vH;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        float edge = abs(dot(normalize(vNormalV), normalize(vViewDir)));
        float soft = pow(edge, 1.6);
        float fade = smoothstep(0.0, 0.85, vH);
        gl_FragColor = vec4(uColor * uIntensity * soft * fade, 1.0);
      }`,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: FrontSide,
  });
}

export class Lighting {
  constructor(scene) {
    this.scene = scene;
    this.group = new Group();
    this.group.name = 'lighting';
    this.disposables = [];
    this.time = 0;
    this.flicker = 0;
    this._build();
    scene.add(this.group);
  }

  _track(x) {
    this.disposables.push(x);
    return x;
  }

  _build() {
    // Ambiance générale très sombre, légèrement bleutée
    this.hemi = new HemisphereLight('#3a4a74', '#0b0c12', 0.55);
    this.group.add(this.hemi);

    // Projecteur principal au-dessus du ring (ombres)
    this.key = new SpotLight('#fff3e2', 420, 0, 0.62, 0.55, 2);
    this.key.position.set(0, 9.2, 0.6);
    this.key.target.position.set(0, 0, 0);
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.camera.near = 4;
    this.key.shadow.camera.far = 13;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 3;
    this.group.add(this.key, this.key.target);

    // Projecteurs latéraux (sans ombres) : chaud d'un côté, froid de l'autre
    this.warm = new SpotLight('#ffcf8f', 330, 0, 0.5, 0.65, 2);
    this.warm.position.set(6.5, 7.5, 5.5);
    this.warm.target.position.set(0, 1.1, 0);
    this.cool = new SpotLight('#7fb4ff', 300, 0, 0.5, 0.65, 2);
    this.cool.position.set(-6.5, 7.5, -5.5);
    this.cool.target.position.set(0, 1.1, 0);
    this.group.add(this.warm, this.warm.target, this.cool, this.cool.target);

    // Lumière d'appoint « télé » : depuis la caméra vers l'adversaire,
    // pour que son visage et son buste restent lisibles
    this.fill = new DirectionalLight('#ffe9d2', 1.1);
    this.fillTarget = new Object3D();
    this.fill.target = this.fillTarget;
    this.group.add(this.fill, this.fillTarget);

    // Contre-jour : placé derrière l'adversaire par rapport à la caméra
    this.rim = new DirectionalLight('#a9cbff', 1.6);
    this.rimTarget = new Object3D();
    this.rim.target = this.rimTarget;
    this.group.add(this.rim, this.rimTarget);

    this._buildTruss();
    this._buildDust();
  }

  _buildTruss() {
    const metal = this._track(new MeshStandardMaterial({ color: '#1b1e26', roughness: 0.55, metalness: 0.7 }));
    const beamGeo = this._track(new BoxGeometry(TRUSS_HALF * 2 + 0.3, 0.28, 0.28));
    for (let i = 0; i < 4; i++) {
      const b = new Mesh(beamGeo, metal);
      const a = (i * Math.PI) / 2;
      b.position.set(Math.sin(a) * TRUSS_HALF, TRUSS_Y, Math.cos(a) * TRUSS_HALF);
      b.rotation.y = a + Math.PI / 2;
      this.group.add(b);
    }
    // Câbles de suspension
    const cableGeo = this._track(new CylinderGeometry(0.012, 0.012, 8, 4));
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const c = new Mesh(cableGeo, metal);
        c.position.set(sx * TRUSS_HALF, TRUSS_Y + 4, sz * TRUSS_HALF);
        this.group.add(c);
      }
    }

    // Projecteurs visibles, halos et faisceaux
    const canGeo = this._track(new CylinderGeometry(0.16, 0.2, 0.36, 12, 1, true));
    const lensGeo = this._track(new CircleGeometry(0.17, 16));
    const lensMat = this._track(new MeshBasicMaterial({ color: '#fff6e6' }));
    const glowTex = this._track(createGlowTexture('rgba(255,244,225,1)'));
    // Faisceaux courts : ils s'arrêtent au-dessus des têtes (moins de surdessin)
    const beamGeo2 = this._track(new ConeGeometry(0.95, 4.6, 20, 1, true));
    beamGeo2.translate(0, -2.3, 0); // apex à l'origine, ouverture vers le bas
    this.beams = [];
    this.lamps = [];
    const positions = [];
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      for (const off of [-1.6, 1.6]) {
        const ox = Math.sin(a) * TRUSS_HALF + Math.cos(a) * off;
        const oz = Math.cos(a) * TRUSS_HALF - Math.sin(a) * off;
        positions.push(new Vector3(ox, TRUSS_Y - 0.25, oz));
      }
    }
    positions.forEach((p, i) => {
      const lamp = new Group();
      lamp.position.copy(p);
      // Orientation vers le ring
      const target = new Vector3(p.x * 0.18, 0.4, p.z * 0.18);
      lamp.lookAt(target);
      lamp.rotateX(Math.PI / 2);
      const can = new Mesh(canGeo, metal);
      lamp.add(can);
      // Après lookAt + rotateX, l'axe +Y local pointe vers le ring
      const lens = new Mesh(lensGeo, lensMat);
      lens.position.y = 0.181;
      lens.rotation.x = -Math.PI / 2;
      lamp.add(lens);
      const warm = i % 2 === 0;
      const beamMat = this._track(createBeamMaterial(warm ? '#ffe3b8' : '#bcd6ff'));
      const beam = new Mesh(beamGeo2, beamMat);
      beam.rotation.x = Math.PI; // le cône s'ouvre vers +Y (vers le ring)
      beam.position.y = 0.18;
      beam.renderOrder = 2;
      lamp.add(beam);
      this.beams.push(beam);
      const glow = new Sprite(this._track(new SpriteMaterial({
        map: glowTex, color: warm ? '#ffe6c2' : '#d2e3ff', blending: AdditiveBlending, depthWrite: false, transparent: true,
      })));
      glow.scale.set(1.5, 1.5, 1);
      glow.position.y = 0.3;
      lamp.add(glow);
      this.lamps.push({ lamp, glow });
      this.group.add(lamp);
    });
  }

  _buildDust() {
    const count = 260;
    const pos = new Float32Array(count * 3);
    this.dustSeeds = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = Math.sqrt(Math.random()) * 3.6;
      const a = Math.random() * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 0.4 + Math.random() * 6.5;
      pos[i * 3 + 2] = Math.sin(a) * r;
      this.dustSeeds[i * 3] = Math.random() * 100;
      this.dustSeeds[i * 3 + 1] = 0.02 + Math.random() * 0.05;
      this.dustSeeds[i * 3 + 2] = Math.random() * 100;
    }
    const geo = this._track(new BufferGeometry());
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    const tex = this._track(createGlowTexture('rgba(255,250,235,1)'));
    this.dust = new Points(geo, this._track(new PointsMaterial({
      size: 0.022, map: tex, transparent: true, opacity: 0.32, depthWrite: false, blending: AdditiveBlending, color: '#fff2da',
    })));
    this.dust.frustumCulled = false;
    this.dustCount = count;
    this.group.add(this.dust);
  }

  /** Qualité graphique : ombres, nombre de particules, lumières d'appoint. */
  applyQuality(renderer, level) {
    const q = GameConfig.quality[level] || GameConfig.quality.medium;
    renderer.shadowMap.enabled = q.shadows;
    renderer.shadowMap.type = PCFShadowMap;
    this.key.castShadow = q.shadows;
    if (this.key.shadow.mapSize.x !== q.shadowMapSize) {
      this.key.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      if (this.key.shadow.map) {
        this.key.shadow.map.dispose();
        this.key.shadow.map = null;
      }
    }
    this.warm.visible = q.extraLights;
    this.cool.visible = q.extraLights;
    // En qualité basse, un faisceau sur deux seulement
    this.beams.forEach((b, i) => {
      b.visible = level !== 'low' || i % 2 === 0;
    });
    this.dust.geometry.setDrawRange(0, Math.min(this.dustCount, q.dust));
    // Sans lumières d'appoint, on compense avec l'ambiance
    this.hemi.intensity = q.extraLights ? 0.55 : 0.95;
    this.scene.traverse((o) => {
      if (o.material && o.material.needsUpdate !== undefined && o.isMesh) o.material.needsUpdate = true;
    });
  }

  /**
   * @param {number} dt
   * @param {Vector3} cameraPos
   * @param {Vector3} focus point à mettre en valeur (l'adversaire)
   */
  update(dt, cameraPos, focus) {
    this.time += dt;
    // Contre-jour : de derrière l'adversaire vers la caméra, en hauteur
    if (focus) {
      const dx = focus.x - cameraPos.x;
      const dz = focus.z - cameraPos.z;
      const len = Math.hypot(dx, dz) || 1;
      this.rim.position.set(focus.x + (dx / len) * 4, 4.5, focus.z + (dz / len) * 4);
      this.rimTarget.position.set(focus.x, 1.3, focus.z);
      this.fill.position.set(cameraPos.x - (dx / len) * 2, cameraPos.y + 1.6, cameraPos.z - (dz / len) * 2);
      this.fillTarget.position.set(focus.x, 1.25, focus.z);
    }
    // Poussière : dérive lente
    const arr = this.dust.geometry.attributes.position.array;
    const s = this.dustSeeds;
    const t = this.time;
    for (let i = 0; i < this.dustCount; i++) {
      const k = i * 3;
      arr[k] += Math.sin(t * 0.3 + s[k]) * 0.04 * dt;
      arr[k + 1] += (Math.sin(t * 0.2 + s[k + 2]) * 0.5 + 0.2) * s[k + 1] * dt;
      arr[k + 2] += Math.cos(t * 0.25 + s[k + 2]) * 0.04 * dt;
      if (arr[k + 1] > 7) arr[k + 1] = 0.4;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;

    // Halos : légère pulsation (+ éclat lors des gros coups)
    this.flicker = Math.max(0, this.flicker - dt * 2.5);
    const pulse = 1 + Math.sin(t * 2.2) * 0.03 + this.flicker * 0.4;
    for (const { glow } of this.lamps) glow.scale.setScalar(1.5 * pulse);
  }

  /** Flash des projecteurs (KO, gros coup). */
  burst(amount = 1) {
    this.flicker = Math.min(1.5, this.flicker + amount);
  }

  dispose() {
    for (const d of this.disposables) if (d && d.dispose) d.dispose();
    this.scene.remove(this.group);
  }
}
