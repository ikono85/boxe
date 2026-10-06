/**
 * MathUtils.js
 * ------------------------------------------------------------------
 * Fonctions mathématiques utilitaires : interpolations, courbes d'easing,
 * amortissements indépendants du framerate, ressorts, angles.
 * Aucune dépendance au rendu : utilisable dans la simulation Node.
 */

export const TAU = Math.PI * 2;

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const remap = (v, a, b, c, d) => lerp(c, d, invLerp(a, b, v));

export function smoothstep(edge0, edge1, x) {
  const t = invLerp(edge0, edge1, x);
  return t * t * (3 - 2 * t);
}

/** Amortissement exponentiel indépendant du framerate. */
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** Version Vector3 (modifie `v` sur place). */
export function dampVec3(v, target, lambda, dt) {
  const t = 1 - Math.exp(-lambda * dt);
  v.x += (target.x - v.x) * t;
  v.y += (target.y - v.y) * t;
  v.z += (target.z - v.z) * t;
  return v;
}

/** Ramène un angle dans [-PI, PI]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function dampAngle(current, target, lambda, dt) {
  return current + wrapAngle(target - current) * (1 - Math.exp(-lambda * dt));
}

/** Tourne `current` vers `target` d'au plus `maxStep` radians. */
export function stepAngle(current, target, maxStep) {
  const d = wrapAngle(target - current);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

/* ---------- Repère des boxeurs (regard vers -Z quand yaw = 0) ---------- */

export function forwardFromYaw(yaw, out) {
  return out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
}

export function rightFromYaw(yaw, out) {
  return out.set(Math.cos(yaw), 0, -Math.sin(yaw));
}

export function yawFromDirection(dx, dz) {
  return Math.atan2(-dx, -dz);
}

/**
 * Convertit un point du repère local d'un boxeur (x droite, y haut, z arrière)
 * en coordonnées monde, à partir de sa position et de son yaw.
 */
export function localToWorld(position, yaw, lx, ly, lz, out) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return out.set(position.x + lx * c + lz * s, position.y + ly, position.z - lx * s + lz * c);
}

/** Inverse de localToWorld. */
export function worldToLocal(position, yaw, wx, wy, wz, out) {
  const dx = wx - position.x;
  const dz = wz - position.z;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return out.set(dx * c - dz * s, wy - position.y, dx * s + dz * c);
}

/** Courbe de Bézier quadratique (Vector3). */
export function quadBezier(p0, p1, p2, t, out) {
  const u = 1 - t;
  const a = u * u;
  const b = 2 * u * t;
  const c = t * t;
  return out.set(
    a * p0.x + b * p1.x + c * p2.x,
    a * p0.y + b * p1.y + c * p2.y,
    a * p0.z + b * p1.z + c * p2.z,
  );
}

/* ---------- Courbes d'easing ---------- */

export const Ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outSine: (t) => Math.sin((t * Math.PI) / 2),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  outBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  // Accélère puis « claque » : idéal pour un coup de poing
  punch: (t) => {
    const a = t * t * (2.2 - 1.2 * t);
    return a > 1 ? 1 : a;
  },
};

/* ---------- Ressorts (animations secondaires) ---------- */

/** Ressort amorti 1D : valeur qui revient vers 0 (ou vers target). */
export class Spring {
  constructor(stiffness = 120, damping = 12) {
    this.stiffness = stiffness;
    this.damping = damping;
    this.value = 0;
    this.velocity = 0;
    this.target = 0;
  }

  impulse(v) {
    this.velocity += v;
  }

  update(dt) {
    // Intégration semi-implicite, sous-pas pour la stabilité
    const steps = dt > 1 / 90 ? 2 : 1;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const force = (this.target - this.value) * this.stiffness - this.velocity * this.damping;
      this.velocity += force * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }

  reset(v = 0) {
    this.value = v;
    this.velocity = 0;
  }
}
