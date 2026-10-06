/**
 * Ring.js
 * ------------------------------------------------------------------
 * Ring de boxe 3D : plateforme, tapis, jupe, poteaux, coussins de coin,
 * quatre rangées de cordes par côté, sangles, escaliers.
 *
 * Deux habillages :
 *  - 'model'      : modèle 3D « Professional Boxing Ring » (A1905, CC BY 4.0),
 *                   préparé par scripts/optimize-ring.mjs (poteaux, coussins,
 *                   tendeurs, plateforme). Qualités Moyenne et Haute.
 *  - 'procedural' : ring construit en primitives, sans fichier. Qualité Basse,
 *                   et repli si le modèle ne se charge pas.
 * Dans les deux cas, le tapis (logo), la jupe et les cordes sont ceux du jeu :
 * les cordes se placent aux hauteurs du modèle pour tomber dans ses tendeurs.
 *
 * Les cordes réagissent aux boxeurs : quand l'un d'eux s'appuie dessus
 * (Fighter.ropeContact), le côté concerné se déforme comme une corde tendue
 * (forme triangulaire adoucie), puis vibre en revenant grâce à un ressort.
 * Les sommets sont recalculés en place : aucune allocation par frame.
 */

import {
  Group, Mesh, BoxGeometry, PlaneGeometry, CylinderGeometry, BufferGeometry, BufferAttribute,
  MeshStandardMaterial, Vector3, Sphere, Box3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GameConfig } from '../config/GameConfig.js';
import { createRingMatTexture, createApronTexture } from './Textures.js';

const RC = GameConfig.ring;

/** Habillage par défaut (ring en primitives). */
const PROCEDURAL_STYLE = {
  heights: RC.ropeHeights,
  radius: RC.ropeRadius,
  colors: ['#e9e4d6', '#c8161d', '#e9e4d6', '#c8161d'],
  strapColor: '#d9d2c0',
  inset: 0.06, // les cordes partent légèrement à l'intérieur des poteaux
  apron: RC.apron,
};

/** Couleurs des cordes du modèle (bas → haut) : rouge, bleu, noir, rouge. */
const MODEL_ROPE_COLORS = ['#c8161d', '#1f63c9', '#2a2b30', '#c8161d'];

/** Charge un .glb depuis une URL (data: décodée sur place, sans requête réseau). */
async function loadGlb(url) {
  let buffer;
  if (url.startsWith('data:')) {
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    buffer = bytes.buffer;
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ring : ${res.status}`);
    buffer = await res.arrayBuffer();
  }
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader.parseAsync(buffer, '');
}

/** Un côté de corde, maillé à la main pour pouvoir le déformer. */
class RopeSide {
  constructor(start, end, outward, radius, material, segments = 36, radial = 7) {
    this.start = start.clone();
    this.end = end.clone();
    this.outward = outward.clone();
    this.radius = radius;
    this.segments = segments;
    this.radial = radial;
    this.length = start.distanceTo(end);
    this.dir = end.clone().sub(start).normalize();
    this.up = new Vector3(0, 1, 0);
    this.side = new Vector3().crossVectors(this.dir, this.up).normalize();
    this.lastAmount = -1;
    this.lastCenter = -1;

    const vCount = (segments + 1) * (radial + 1);
    const positions = new Float32Array(vCount * 3);
    const normals = new Float32Array(vCount * 3);
    const uvs = new Float32Array(vCount * 2);
    const index = [];
    for (let i = 0; i <= segments; i++) {
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        const k = i * (radial + 1) + j;
        const nx = this.up.x * Math.cos(a) + this.side.x * Math.sin(a);
        const ny = this.up.y * Math.cos(a) + this.side.y * Math.sin(a);
        const nz = this.up.z * Math.cos(a) + this.side.z * Math.sin(a);
        normals[k * 3] = nx;
        normals[k * 3 + 1] = ny;
        normals[k * 3 + 2] = nz;
        uvs[k * 2] = i / segments;
        uvs[k * 2 + 1] = j / radial;
      }
    }
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * (radial + 1) + j;
        const b = a + radial + 1;
        index.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.setAttribute('normal', new BufferAttribute(normals, 3));
    geo.setAttribute('uv', new BufferAttribute(uvs, 2));
    geo.setIndex(index);
    // Sphère englobante fixe (avec marge pour la déformation)
    const center = start.clone().add(end).multiplyScalar(0.5);
    geo.boundingSphere = new Sphere(center, this.length / 2 + 0.3);
    this.geometry = geo;
    this.mesh = new Mesh(geo, material);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.setDeflection(0, 0.5);
  }

  /**
   * Déforme la corde : `amount` mètres vers l'extérieur au point `centerT`
   * (0 → début, 1 → fin). Une légère flèche naturelle est toujours présente.
   */
  setDeflection(amount, centerT) {
    if (Math.abs(amount - this.lastAmount) < 0.0004 && Math.abs(centerT - this.lastCenter) < 0.004) return;
    this.lastAmount = amount;
    this.lastCenter = centerT;
    const pos = this.geometry.attributes.position.array;
    const { segments, radial, radius, start, end, outward, up, side } = this;
    const c = Math.min(0.9, Math.max(0.1, centerT));
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      // Forme d'une corde tendue poussée en un point, arrondie au sommet
      let shape = t < c ? t / c : (1 - t) / (1 - c);
      shape = shape * shape * (3 - 2 * shape) * 0.35 + shape * 0.65;
      const d = amount * shape;
      const sag = -0.018 * 4 * t * (1 - t);
      const px = start.x + (end.x - start.x) * t + outward.x * d;
      const py = start.y + (end.y - start.y) * t + sag - Math.abs(d) * 0.12;
      const pz = start.z + (end.z - start.z) * t + outward.z * d;
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        const ca = Math.cos(a) * radius;
        const sa = Math.sin(a) * radius;
        const k = (i * (radial + 1) + j) * 3;
        pos[k] = px + up.x * ca + side.x * sa;
        pos[k + 1] = py + up.y * ca + side.y * sa;
        pos[k + 2] = pz + up.z * ca + side.z * sa;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
  }
}

export class Ring {
  constructor() {
    this.group = new Group();
    this.group.name = 'ring';
    this.half = RC.size / 2;
    this.sides = [];
    this.parts = {}; // sous-groupes reconstruits à chaque changement d'habillage
    this.mode = null;
    this.model = null; // { root, style, credit } une fois chargé
    this.modelPromise = null;
    this.wantModel = false;
    this.setMode('procedural');
  }

  /* ---------- Habillage ---------- */

  /**
   * Demande le modèle 3D (chargé une seule fois). Si le chargement échoue,
   * le ring en primitives reste en place.
   */
  useModel(url) {
    this.wantModel = true;
    if (this.model) {
      this.setMode('model');
      return Promise.resolve(true);
    }
    if (!this.modelPromise) {
      this.modelPromise = loadGlb(url)
        .then((gltf) => {
          this.model = this._prepareModel(gltf);
          if (this.wantModel) this.setMode('model');
          return true;
        })
        .catch((err) => {
          console.warn('Ring : modèle indisponible, ring simplifié conservé.', err);
          return false;
        });
    }
    return this.modelPromise;
  }

  /** Revient au ring en primitives (qualité Basse). */
  useProcedural() {
    this.wantModel = false;
    this.setMode('procedural');
  }

  _prepareModel(gltf) {
    const root = gltf.scene;
    const extras = root.userData || {};
    let platform = null;
    root.traverse((o) => {
      if (!o.isMesh) return;
      const name = o.material && o.material.name;
      o.castShadow = name !== 'Color_A0';
      o.receiveShadow = true;
      if (name === 'Color_A0') platform = o;
    });
    // Bord du tapis : jusqu'au bord de la plateforme du modèle
    let apron = RC.apron;
    if (platform) {
      const b = new Box3().setFromObject(platform);
      apron = Math.max(RC.apron, (Math.min(b.max.x - b.min.x, b.max.z - b.min.z) - RC.size) / 2);
    }
    const style = {
      heights: Array.isArray(extras.ropeHeights) && extras.ropeHeights.length === 4 ? extras.ropeHeights : RC.ropeHeights,
      radius: extras.ropeRadius || RC.ropeRadius,
      colors: MODEL_ROPE_COLORS,
      strapColor: '#1c1c20',
      inset: 0, // les cordes se rejoignent aux coins, comme sur le modèle
      apron,
    };
    return { root, style, credit: extras.credit || '' };
  }

  setMode(mode) {
    if (mode === 'model' && !this.model) mode = 'procedural';
    if (mode === this.mode) return;
    this.mode = mode;
    const style = mode === 'model' ? this.model.style : PROCEDURAL_STYLE;
    for (const name of Object.keys(this.parts)) this._clearPart(name);
    this._buildPlatform(style, mode === 'procedural');
    this._buildRopes(style);
    this._buildSteps(style);
    if (mode === 'procedural') this._buildCorners(style);
    if (this.model) this.model.root.removeFromParent();
    if (mode === 'model') this.group.add(this.model.root);
  }

  _part(name) {
    const g = new Group();
    g.name = `ring-${name}`;
    this.parts[name] = { group: g, disposables: [] };
    this.group.add(g);
    return this.parts[name];
  }

  _clearPart(name) {
    const p = this.parts[name];
    if (!p) return;
    p.group.removeFromParent();
    for (const d of p.disposables) if (d && d.dispose) d.dispose();
    delete this.parts[name];
  }

  /* ---------- Construction ---------- */

  _buildPlatform(style, withBase) {
    const part = this._part('platform');
    const track = (x) => (part.disposables.push(x), x);
    const total = RC.size + style.apron * 2;
    const h = RC.platformHeight;

    const matTex = track(createRingMatTexture(RC.size, style.apron));
    const matMat = track(new MeshStandardMaterial({ map: matTex, roughness: 0.86, metalness: 0 }));
    const mat = new Mesh(track(new PlaneGeometry(total, total)), matMat);
    mat.rotation.x = -Math.PI / 2;
    mat.position.y = 0.002;
    mat.receiveShadow = true;
    part.group.add(mat);

    // Bord rembourré du tapis
    const edgeMat = track(new MeshStandardMaterial({ color: '#152c66', roughness: 0.8 }));
    const edgeGeo = track(new BoxGeometry(total + 0.04, 0.08, 0.06));
    for (let i = 0; i < 4; i++) {
      const e = new Mesh(edgeGeo, edgeMat);
      const a = (i * Math.PI) / 2;
      e.position.set(Math.sin(a) * (total / 2), -0.03, Math.cos(a) * (total / 2));
      e.rotation.y = a;
      part.group.add(e);
    }

    // Jupe avec le logo
    const apronTex = track(createApronTexture());
    const apronMat = track(new MeshStandardMaterial({ map: apronTex, roughness: 0.65, metalness: 0.05 }));
    const skirtGeo = track(new PlaneGeometry(total, h));
    for (let i = 0; i < 4; i++) {
      const s = new Mesh(skirtGeo, apronMat);
      const a = (i * Math.PI) / 2;
      s.position.set(Math.sin(a) * (total / 2 + 0.031), -h / 2 - 0.04, Math.cos(a) * (total / 2 + 0.031));
      s.rotation.y = a;
      part.group.add(s);
    }

    // Structure (invisible sous la jupe, sert de sol aux ombres). Le modèle a la sienne.
    if (withBase) {
      const base = new Mesh(
        track(new BoxGeometry(total, h, total)),
        track(new MeshStandardMaterial({ color: '#0a0d18', roughness: 1 })),
      );
      base.position.y = -h / 2 - 0.01;
      part.group.add(base);
    }
  }

  _buildCorners(style) {
    const part = this._part('corners');
    const track = (x) => (part.disposables.push(x), x);
    const H = style.heights;
    const half = this.half + 0.07;
    const steel = track(new MeshStandardMaterial({ color: '#c9ccd3', roughness: 0.3, metalness: 0.85 }));
    const postGeo = track(new CylinderGeometry(0.05, 0.055, RC.postHeight + 0.05, 14));
    const capGeo = track(new CylinderGeometry(0.062, 0.062, 0.05, 14));
    const padGeo = track(new BoxGeometry(0.2, H[3] - H[0] + 0.28, 0.2));
    const padColors = {
      red: '#c8161d',
      blue: '#1a4fd0',
      neutral: '#e9e4d6',
    };
    // (+x,+z) rouge, (-x,-z) bleu, les deux autres neutres
    const corners = [
      { x: 1, z: 1, color: padColors.red },
      { x: -1, z: -1, color: padColors.blue },
      { x: 1, z: -1, color: padColors.neutral },
      { x: -1, z: 1, color: padColors.neutral },
    ];
    for (const c of corners) {
      const post = new Mesh(postGeo, steel);
      post.position.set(c.x * half, (RC.postHeight + 0.05) / 2 - 0.05, c.z * half);
      post.castShadow = true;
      part.group.add(post);
      const cap = new Mesh(capGeo, steel);
      cap.position.set(c.x * half, RC.postHeight, c.z * half);
      part.group.add(cap);

      const padMat = track(new MeshStandardMaterial({ color: c.color, roughness: 0.45, metalness: 0.05 }));
      const pad = new Mesh(padGeo, padMat);
      const inset = 0.1;
      pad.position.set(c.x * (half - inset), (H[0] + H[3]) / 2, c.z * (half - inset));
      pad.rotation.y = Math.PI / 4;
      pad.castShadow = true;
      part.group.add(pad);
    }
  }

  _buildRopes(style) {
    const part = this._part('ropes');
    const track = (x) => (part.disposables.push(x), x);
    const H = style.heights;
    const half = this.half;
    const mats = style.colors.map((c) => track(new MeshStandardMaterial({ color: c, roughness: 0.42, metalness: 0.05 })));
    const strapMat = track(new MeshStandardMaterial({ color: style.strapColor, roughness: 0.7 }));
    const strapGeo = track(new BoxGeometry(0.035, H[3] - H[0] + 0.06, 0.05));

    // axis/sign : côté x = +half (corde parallèle à z), etc.
    const defs = [
      { axis: 'x', sign: 1 },
      { axis: 'x', sign: -1 },
      { axis: 'z', sign: 1 },
      { axis: 'z', sign: -1 },
    ];
    const inset = style.inset;
    this.sides = [];
    for (const d of defs) {
      const ropes = [];
      const outward = new Vector3(d.axis === 'x' ? d.sign : 0, 0, d.axis === 'z' ? d.sign : 0);
      H.forEach((h, level) => {
        let start;
        let end;
        if (d.axis === 'x') {
          start = new Vector3(d.sign * half, h, -half + inset);
          end = new Vector3(d.sign * half, h, half - inset);
        } else {
          start = new Vector3(-half + inset, h, d.sign * half);
          end = new Vector3(half - inset, h, d.sign * half);
        }
        const rope = new RopeSide(start, end, outward, style.radius, mats[level]);
        track(rope.geometry);
        ropes.push(rope);
        part.group.add(rope.mesh);
      });
      // Sangles verticales au tiers et aux deux tiers
      for (const t of [0.33, 0.67]) {
        const s = new Mesh(strapGeo, strapMat);
        const along = -half + inset + (2 * half - 2 * inset) * t;
        if (d.axis === 'x') s.position.set(d.sign * (half + 0.012), (H[0] + H[3]) / 2, along);
        else {
          s.position.set(along, (H[0] + H[3]) / 2, d.sign * (half + 0.012));
          s.rotation.y = Math.PI / 2;
        }
        part.group.add(s);
        // Les sangles suivent la corde : on les garde pour les déplacer
        ropes.straps = ropes.straps || [];
        ropes.straps.push({ mesh: s, t, base: s.position.clone() });
      }
      this.sides.push({ ...d, ropes, outward, amount: 0, velocity: 0, target: 0, center: 0.5, targetCenter: 0.5 });
    }
  }

  _buildSteps(style) {
    const part = this._part('steps');
    const track = (x) => (part.disposables.push(x), x);
    const mat = track(new MeshStandardMaterial({ color: '#2a2f3c', roughness: 0.6, metalness: 0.3 }));
    const geo = track(new BoxGeometry(0.9, 0.08, 0.32));
    const total = RC.size / 2 + style.apron;
    for (const c of [{ x: 1, z: 1 }, { x: -1, z: -1 }]) {
      for (let i = 0; i < 3; i++) {
        const step = new Mesh(geo, mat);
        const off = total + 0.25 + i * 0.3;
        step.position.set(c.x * (off * 0.7071 + 0.25), -0.3 - i * 0.32, c.z * (off * 0.7071 + 0.25));
        step.rotation.y = Math.PI / 4;
        part.group.add(step);
      }
    }
  }

  /**
   * Met à jour la déformation des cordes.
   * @param {number} dt
   * @param {Array} fighters boxeurs (Fighter) dont on lit ropeContact
   */
  update(dt, fighters) {
    for (const side of this.sides) {
      side.target = 0;
      for (const f of fighters) {
        const rc = f.ropeContact;
        if (rc.depth > 0 && rc.axis === side.axis && rc.sign === side.sign) {
          // Les cordes cèdent un peu plus que l'enfoncement du boxeur
          const push = rc.depth * 1.35 + Math.min(0.05, f.knockVel.length() * 0.02);
          if (push > side.target) {
            side.target = push;
            side.targetCenter = (rc.along + this.half) / (2 * this.half);
          }
        }
      }
      // Ressort sous-amorti : la corde vibre en revenant
      const k = 140;
      const damping = 7;
      const force = (side.target - side.amount) * k - side.velocity * damping;
      side.velocity += force * dt;
      side.amount += side.velocity * dt;
      side.center += (side.targetCenter - side.center) * Math.min(1, dt * 10);

      const a = side.amount;
      if (Math.abs(a) < 0.0005 && Math.abs(side.velocity) < 0.001 && side.target === 0) {
        side.amount = 0;
        side.velocity = 0;
      }
      // Les cordes du milieu (hauteur des hanches / du dos) cèdent le plus
      const weights = [0.5, 0.78, 1, 0.82];
      side.ropes.forEach((rope, i) => rope.setDeflection(a * weights[i], side.center));
      if (side.ropes.straps) {
        for (const s of side.ropes.straps) {
          const c = Math.min(0.9, Math.max(0.1, side.center));
          let shape = s.t < c ? s.t / c : (1 - s.t) / (1 - c);
          shape = shape * shape * (3 - 2 * shape) * 0.35 + shape * 0.65;
          const d = a * 0.8 * shape;
          s.mesh.position.set(s.base.x + side.outward.x * d, s.base.y, s.base.z + side.outward.z * d);
        }
      }
    }
  }

  dispose() {
    for (const name of Object.keys(this.parts)) this._clearPart(name);
    if (this.model) {
      this.model.root.removeFromParent();
      this.model.root.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        for (const m of [].concat(o.material)) {
          for (const k of Object.keys(m)) if (m[k] && m[k].isTexture) m[k].dispose();
          m.dispose();
        }
      });
    }
  }
}
