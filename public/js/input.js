// Entrées clavier/souris et manettes (API Gamepad, disposition standard Xbox/PlayStation).
import { BTN } from '../shared/sim.js';

// e.code = position physique : ZQSD sur AZERTY et WASD sur QWERTY fonctionnent pareil.
const KEYMAP = {
  KeyJ: BTN.PASS, KeyK: BTN.SHOOT, KeyL: BTN.LOB, KeyI: BTN.THROUGH,
  Space: BTN.SWITCH, ShiftLeft: BTN.SPRINT, ShiftRight: BTN.SPRINT,
};
// Joueur 2 au clavier (sans manette) : flèches + pavé numérique.
const KEYMAP_R = {
  Numpad1: BTN.PASS, Numpad2: BTN.SHOOT, Numpad3: BTN.LOB, Numpad5: BTN.THROUGH, Numpad0: BTN.SWITCH,
  ShiftRight: BTN.SPRINT, NumpadEnter: BTN.SPRINT,
  Comma: BTN.PASS, Period: BTN.SHOOT, Slash: BTN.LOB, Semicolon: BTN.THROUGH, ControlRight: BTN.SWITCH,
};
// Manette : A passe, X tir, B lob/centre, Y profondeur, LB changer, RT/RB sprint.
const PADMAP = [[0, BTN.PASS], [2, BTN.SHOOT], [1, BTN.LOB], [3, BTN.THROUGH], [4, BTN.SWITCH], [5, BTN.SPRINT]];
const DEAD = 0.18;

export class Input {
  constructor(target) {
    this.keys = new Set();
    this.mouse = 0;
    this.onAction = null; // actions d'interface : pause, caméra, navigation de menu
    this.padPrev = [];
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!e.repeat) {
        if (e.code === 'Escape' || e.code === 'KeyP') this.emit('pause');
        if (e.code === 'KeyC') this.emit('camera');
        if (e.code === 'ArrowUp') this.emit('up');
        if (e.code === 'ArrowDown') this.emit('down');
        if (e.code === 'ArrowLeft') this.emit('left');
        if (e.code === 'ArrowRight') this.emit('right');
        if (e.code === 'Enter') this.emit('confirm');
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse = 0; });
    target.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouse |= BTN.PASS;
      if (e.button === 2) this.mouse |= BTN.SHOOT;
      if (e.button === 1) { this.mouse |= BTN.LOB; e.preventDefault(); }
      if (e.button === 3) this.mouse |= BTN.THROUGH;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse &= ~BTN.PASS;
      if (e.button === 2) this.mouse &= ~BTN.SHOOT;
      if (e.button === 1) this.mouse &= ~BTN.LOB;
      if (e.button === 3) this.mouse &= ~BTN.THROUGH;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('gamepadconnected', (e) => this.emit('padconnected', e.gamepad));
    window.addEventListener('gamepaddisconnected', (e) => this.emit('paddisconnected', e.gamepad));
  }

  emit(a, data) { if (this.onAction) this.onAction(a, data); }

  pads() { return [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean); }

  // variant : 'kb' (clavier complet), 'kbL' (moitié gauche + souris), 'kbR' (flèches + pavé numérique).
  keyboard(variant = 'kb') {
    const k = this.keys;
    let mx = 0, mz = 0, held = 0;
    const left = variant !== 'kbR', right = variant !== 'kbL';
    if ((left && k.has('KeyA')) || (right && k.has('ArrowLeft'))) mx -= 1;
    if ((left && k.has('KeyD')) || (right && k.has('ArrowRight'))) mx += 1;
    if ((left && k.has('KeyW')) || (right && k.has('ArrowUp'))) mz -= 1;
    if ((left && k.has('KeyS')) || (right && k.has('ArrowDown'))) mz += 1;
    if (left) {
      for (const code in KEYMAP) if (k.has(code) && (variant === 'kb' || code !== 'ShiftRight')) held |= KEYMAP[code];
      held |= this.mouse;
    }
    if (variant === 'kbR') for (const code in KEYMAP_R) if (k.has(code)) held |= KEYMAP_R[code];
    const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
    return { mx, mz, held };
  }

  gamepad(pad) {
    if (!pad) return { mx: 0, mz: 0, held: 0 };
    let mx = pad.axes[0] ?? 0, mz = pad.axes[1] ?? 0;
    const l = Math.hypot(mx, mz);
    if (l < DEAD) { mx = 0; mz = 0; } else { const s = Math.min(1, (l - DEAD) / (1 - DEAD)) / l; mx *= s; mz *= s; }
    const b = pad.buttons;
    if (b[14]?.pressed) mx = -1; if (b[15]?.pressed) mx = 1;
    if (b[12]?.pressed) mz = -1; if (b[13]?.pressed) mz = 1;
    let held = 0;
    for (const [i, bit] of PADMAP) if (b[i]?.pressed) held |= bit;
    if ((b[7]?.value ?? 0) > 0.3) held |= BTN.SPRINT;
    return { mx, mz, held };
  }

  // Fusionne plusieurs sources (ex. clavier + manette pour un joueur seul).
  merged(sources) {
    let mx = 0, mz = 0, held = 0;
    for (const s of sources) {
      const v = typeof s === 'string' ? this.keyboard(s) : this.gamepad(this.pads().find((p) => p.index === s));
      if (Math.hypot(v.mx, v.mz) > Math.hypot(mx, mz)) { mx = v.mx; mz = v.mz; }
      held |= v.held;
    }
    return { mx, mz, held };
  }

  // Boutons d'interface des manettes (Start, Select, croix, A/B) détectés sur front montant.
  pollUi() {
    for (const pad of this.pads()) {
      const prev = this.padPrev[pad.index] || [];
      const now = pad.buttons.map((b) => b.pressed);
      const ax = pad.axes[1] ?? 0, ay = pad.axes[0] ?? 0;
      now.push(ax < -0.6, ax > 0.6, ay < -0.6, ay > 0.6);
      const edge = (i) => now[i] && !prev[i];
      if (edge(9)) this.emit('pause');
      if (edge(8)) this.emit('camera');
      if (edge(12) || edge(17)) this.emit('up');
      if (edge(13) || edge(18)) this.emit('down');
      if (edge(14) || edge(19)) this.emit('left');
      if (edge(15) || edge(20)) this.emit('right');
      if (edge(0)) this.emit('padconfirm');
      if (edge(1)) this.emit('back');
      this.padPrev[pad.index] = now;
    }
  }
}
