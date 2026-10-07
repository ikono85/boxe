/**
 * Input.js
 * ------------------------------------------------------------------
 * Clavier + souris + Pointer Lock + manette (Gamepad API).
 *  - état « maintenu » (isDown) et « appuyé cette frame » (pressed) par action ;
 *  - mouvements de souris accumulés entre deux frames ;
 *  - mode de secours sans Pointer Lock (souris libre + rotation aux bords) ;
 *  - manette : boutons → codes 'Pad0'…'Pad15', stick gauche → 'PadUp'…,
 *    stick droit → regard (ajouté aux mouvements de souris). Lue une fois
 *    par image (pollGamepads) ; la dernière manette utilisée est retenue.
 */

import { CONTROLS } from '../config/Controls.js';

// Juste après le verrouillage du pointeur, certains navigateurs (Chrome notamment)
// envoient un premier mouvement aberrant (saut de plusieurs centaines de pixels).
const LOCK_GRACE_MS = 120;
const LOCK_SKIP_MOVES = 2;

// Manette : zone morte des sticks, seuils du stick gauche (avec hystérésis),
// vitesse de rotation du stick droit (pixels de souris par seconde, à fond)
const PAD_DEADZONE = 0.16;
const PAD_MOVE_ON = 0.45;
const PAD_MOVE_OFF = 0.32;
const PAD_LOOK_X = 1250;
const PAD_LOOK_Y = 850;
const PAD_STICK_CODES = ['PadLeft', 'PadRight', 'PadUp', 'PadDown'];

const GAME_KEYS = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyZ', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyG', 'KeyC',
]);

export class Input {
  constructor(element, bindings = CONTROLS) {
    this.element = element;
    this.bindings = bindings;
    this.down = new Set(); // codes maintenus
    this.pressedCodes = new Set(); // codes appuyés depuis la dernière frame
    this.lookX = 0;
    this.lookY = 0;
    this.gameActive = false; // capture des touches pendant le combat
    this.locked = false;
    this.lockGraceUntil = 0; // mouvements ignorés jusqu'à cet instant (performance.now)
    this.lockSkipMoves = 0; // nombre de mouvements à ignorer après le verrouillage
    this.fallbackMode = false; // pas de Pointer Lock disponible
    this.cursor = { x: 0.5, y: 0.5, inside: false };
    this.lockListeners = new Set();
    this.anyKeyListeners = new Set();
    // Manette
    this.padIndex = -1;
    this.padPrev = []; // boutons enfoncés à l'image précédente
    this.padStick = { PadLeft: false, PadRight: false, PadUp: false, PadDown: false };
    this.padActive = false; // la manette est le dernier périphérique utilisé
    this.padConnected = false;
    this.padListeners = new Set(); // appuis de la manette (navigation dans les menus)

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onContextMenu = (e) => {
      if (this.gameActive || e.target === this.element) e.preventDefault();
    };
    this._onBlur = () => this.releaseAll();
    this._onLockChange = this._onLockChange.bind(this);
    this._onLockError = () => {
      this.locked = false;
      this._emitLock(false, true);
    };
    this._onAuxClick = (e) => {
      if (this.gameActive) e.preventDefault();
    };
  }

  attach() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('auxclick', this._onAuxClick);
    window.addEventListener('contextmenu', this._onContextMenu);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('pointerlockerror', this._onLockError);
  }

  detach() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('auxclick', this._onAuxClick);
    window.removeEventListener('contextmenu', this._onContextMenu);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    document.removeEventListener('pointerlockerror', this._onLockError);
  }

  /* ---------- API ---------- */

  setGameActive(active) {
    this.gameActive = active;
    if (!active) this.releaseAll();
  }

  isDown(action) {
    const codes = this.bindings[action];
    if (!codes) return false;
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  pressed(action) {
    const codes = this.bindings[action];
    if (!codes) return false;
    for (const c of codes) if (this.pressedCodes.has(c)) return true;
    return false;
  }

  /** Retourne et remet à zéro le mouvement de souris accumulé. */
  consumeLook(out) {
    out.x = this.lookX;
    out.y = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    return out;
  }

  /** Rotation continue quand la souris libre approche des bords (mode de secours). */
  edgeTurn() {
    if (!this.fallbackMode || !this.cursor.inside) return 0;
    const m = 0.08;
    if (this.cursor.x < m) return -(1 - this.cursor.x / m);
    if (this.cursor.x > 1 - m) return (this.cursor.x - (1 - m)) / m;
    return 0;
  }

  endFrame() {
    this.pressedCodes.clear();
  }

  releaseAll() {
    this.down.clear();
    this.pressedCodes.clear();
    this.lookX = 0;
    this.lookY = 0;
    // (les boutons de manette encore enfoncés ne comptent plus : il faut les relâcher puis rappuyer)
  }

  onLockChange(fn) {
    this.lockListeners.add(fn);
    return () => this.lockListeners.delete(fn);
  }

  onAnyKey(fn) {
    this.anyKeyListeners.add(fn);
    return () => this.anyKeyListeners.delete(fn);
  }

  /** Appuis de la manette : fn(code) avec code 'Pad0'…'Pad15' ou 'PadUp'… */
  onPad(fn) {
    this.padListeners.add(fn);
    return () => this.padListeners.delete(fn);
  }

  /**
   * Lit la manette (à appeler une fois par image, avant de lire les actions).
   * @param {number} dt temps réel écoulé (s)
   */
  pollGamepads(dt) {
    const list = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : null;
    let pad = null;
    if (list) {
      // La manette utilisée en dernier, sinon la première branchée
      if (this.padIndex >= 0 && list[this.padIndex] && list[this.padIndex].connected) pad = list[this.padIndex];
      for (let i = 0; i < list.length && !pad; i++) if (list[i] && list[i].connected) pad = list[i];
    }
    this.padConnected = !!pad;
    if (!pad) {
      if (this.padPrev.length || PAD_STICK_CODES.some((c) => this.padStick[c])) this._releasePad();
      return;
    }
    this.padIndex = pad.index;
    let used = false;

    // Boutons
    const n = Math.min(pad.buttons.length, 17);
    for (let i = 0; i < n; i++) {
      const b = pad.buttons[i];
      const on = !!b && (b.pressed || b.value > 0.5);
      const was = !!this.padPrev[i];
      if (on === was) continue;
      this.padPrev[i] = on;
      this._padCode(`Pad${i}`, on);
      if (on) used = true;
    }

    // Stick gauche → directions (avec hystérésis)
    const ax = pad.axes;
    const lx = ax[0] || 0;
    const ly = ax[1] || 0;
    const want = {
      PadLeft: lx < -(this.padStick.PadLeft ? PAD_MOVE_OFF : PAD_MOVE_ON),
      PadRight: lx > (this.padStick.PadRight ? PAD_MOVE_OFF : PAD_MOVE_ON),
      PadUp: ly < -(this.padStick.PadUp ? PAD_MOVE_OFF : PAD_MOVE_ON),
      PadDown: ly > (this.padStick.PadDown ? PAD_MOVE_OFF : PAD_MOVE_ON),
    };
    for (const c of PAD_STICK_CODES) {
      if (want[c] === this.padStick[c]) continue;
      this.padStick[c] = want[c];
      this._padCode(c, want[c]);
      if (want[c]) used = true;
    }

    // Stick droit → regard (comme la souris), courbe progressive
    const curve = (v) => {
      const a = Math.abs(v);
      if (a < PAD_DEADZONE) return 0;
      const k = (a - PAD_DEADZONE) / (1 - PAD_DEADZONE);
      return Math.sign(v) * k * k;
    };
    const rx = curve(ax[2] || 0);
    const ry = curve(ax[3] || 0);
    if (rx || ry) {
      used = true;
      if (this.gameActive) {
        this.lookX += rx * PAD_LOOK_X * dt;
        this.lookY += ry * PAD_LOOK_Y * dt;
      }
    }
    if (used) this.padActive = true;
  }

  _padCode(code, on) {
    if (on) {
      this.down.add(code);
      this.pressedCodes.add(code);
      for (const fn of this.padListeners) fn(code);
    } else {
      this.down.delete(code);
    }
  }

  _releasePad() {
    for (let i = 0; i < this.padPrev.length; i++) if (this.padPrev[i]) this.down.delete(`Pad${i}`);
    this.padPrev = [];
    for (const c of PAD_STICK_CODES) {
      this.padStick[c] = false;
      this.down.delete(c);
    }
  }

  /**
   * Demande le verrouillage du pointeur. Résout true si obtenu.
   * Doit être appelé depuis un geste de l'utilisateur (clic).
   */
  async requestPointerLock() {
    const el = this.element;
    if (!el.requestPointerLock) {
      this.fallbackMode = true;
      return false;
    }
    if (document.pointerLockElement === el) return true;
    try {
      let result;
      try {
        result = el.requestPointerLock({ unadjustedMovement: true });
      } catch {
        result = el.requestPointerLock();
      }
      if (result && typeof result.then === 'function') {
        try {
          await result;
        } catch (err) {
          // unadjustedMovement non supporté : on réessaie sans option
          if (err && err.name === 'NotSupportedError') {
            await el.requestPointerLock();
          } else {
            throw err;
          }
        }
      } else {
        // Anciens navigateurs : pas de promesse, on attend l'événement
        await new Promise((resolve, reject) => {
          const ok = () => { cleanup(); resolve(); };
          const ko = () => { cleanup(); reject(new Error('pointerlockerror')); };
          const cleanup = () => {
            document.removeEventListener('pointerlockchange', ok);
            document.removeEventListener('pointerlockerror', ko);
          };
          document.addEventListener('pointerlockchange', ok, { once: true });
          document.addEventListener('pointerlockerror', ko, { once: true });
          setTimeout(ko, 800);
        });
      }
      return document.pointerLockElement === el;
    } catch {
      return false;
    }
  }

  exitPointerLock() {
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  }

  /* ---------- Événements DOM ---------- */

  _onKeyDown(e) {
    this.padActive = false;
    for (const fn of this.anyKeyListeners) fn(e);
    if (this.gameActive && GAME_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    this.pressedCodes.add(e.code);
  }

  _onKeyUp(e) {
    this.down.delete(e.code);
  }

  _onMouseDown(e) {
    if (!this.gameActive) return;
    if (!this.locked && !this.fallbackMode) return; // le clic sert à verrouiller
    if (!this.locked && e.target !== this.element) return; // clic sur l'interface
    this.padActive = false;
    const code = `Mouse${e.button}`;
    this.down.add(code);
    this.pressedCodes.add(code);
    if (e.button !== 0) e.preventDefault();
  }

  _onMouseUp(e) {
    this.down.delete(`Mouse${e.button}`);
    if (this.gameActive && (e.button === 3 || e.button === 4)) e.preventDefault();
  }

  _onMouseMove(e) {
    const rect = this.element.getBoundingClientRect();
    this.cursor.x = (e.clientX - rect.left) / Math.max(1, rect.width);
    this.cursor.y = (e.clientY - rect.top) / Math.max(1, rect.height);
    this.cursor.inside = this.cursor.x >= 0 && this.cursor.x <= 1 && this.cursor.y >= 0 && this.cursor.y <= 1;
    if (!this.gameActive) return;
    if (!this.locked && !this.fallbackMode) return;
    // Premier(s) mouvement(s) après le verrouillage : souvent un saut parasite
    if (this.locked && (this.lockSkipMoves > 0 || performance.now() < this.lockGraceUntil)) {
      if (this.lockSkipMoves > 0) this.lockSkipMoves--;
      return;
    }
    // Certains navigateurs envoient des pics aberrants : on les écrête
    const dx = Math.max(-250, Math.min(250, e.movementX || 0));
    const dy = Math.max(-250, Math.min(250, e.movementY || 0));
    this.lookX += dx;
    this.lookY += dy;
  }

  _onLockChange() {
    this.locked = document.pointerLockElement === this.element;
    if (this.locked) {
      this.fallbackMode = false;
      this.lockGraceUntil = performance.now() + LOCK_GRACE_MS;
      this.lockSkipMoves = LOCK_SKIP_MOVES;
    }
    this.releaseAll();
    this._emitLock(this.locked, false);
  }

  _emitLock(locked, error) {
    for (const fn of this.lockListeners) fn(locked, error);
  }
}
