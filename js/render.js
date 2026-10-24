// Rendu 3D du stade, des joueurs et du ballon avec Three.js.
import * as THREE from 'three';
import { PITCH, TEAM_SIZE } from '../shared/sim.js';

const HL = PITCH.L / 2, HW = PITCH.W / 2;
const SLOT_COLORS = [0x2ee6ff, 0xffd23f, 0x7dff6a, 0xff6ad5];

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; }

// ---------- Textures procédurales ----------
function pitchTexture(hi) {
  const M = 6; // marge autour des lignes
  const W = hi ? 4096 : 2048;
  const ppm = W / (PITCH.L + 2 * M);
  const H = Math.round((PITCH.W + 2 * M) * ppm);
  const [c, g] = canvas(W, H);
  const X = (x) => (x + HL + M) * ppm, Y = (z) => (z + HW + M) * ppm;
  // Bandes de tonte.
  const stripes = 20, sw = (PITCH.L + 2 * M) / stripes;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? '#2f8a3a' : '#38983f';
    g.fillRect(i * sw * ppm, 0, sw * ppm + 1, H);
  }
  // Grain de l'herbe.
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    d[i] += n * 0.6; d[i + 1] += n; d[i + 2] += n * 0.4;
  }
  g.putImageData(img, 0, 0);
  // Usure légère devant les buts et au centre.
  for (const [cx, r] of [[-HL + 8, 10], [HL - 8, 10], [0, 9]]) {
    const gr = g.createRadialGradient(X(cx), Y(0), 0, X(cx), Y(0), r * ppm);
    gr.addColorStop(0, 'rgba(120,110,60,0.18)'); gr.addColorStop(1, 'rgba(120,110,60,0)');
    g.fillStyle = gr; g.fillRect(X(cx - r), Y(-r), 2 * r * ppm, 2 * r * ppm);
  }
  g.strokeStyle = 'rgba(255,255,255,0.92)';
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.lineWidth = 0.12 * ppm;
  const rect = (x1, z1, x2, z2) => g.strokeRect(X(x1), Y(z1), (x2 - x1) * ppm, (z2 - z1) * ppm);
  const circle = (x, z, r, a0 = 0, a1 = Math.PI * 2) => { g.beginPath(); g.arc(X(x), Y(z), r * ppm, a0, a1); g.stroke(); };
  const dot = (x, z, r) => { g.beginPath(); g.arc(X(x), Y(z), r * ppm, 0, Math.PI * 2); g.fill(); };
  rect(-HL, -HW, HL, HW);
  g.beginPath(); g.moveTo(X(0), Y(-HW)); g.lineTo(X(0), Y(HW)); g.stroke();
  circle(0, 0, 9.15); dot(0, 0, 0.18);
  for (const s of [-1, 1]) {
    const gx = s * HL;
    rect(Math.min(gx, gx - s * 16.5), -20.16, Math.max(gx, gx - s * 16.5), 20.16);
    rect(Math.min(gx, gx - s * 5.5), -9.16, Math.max(gx, gx - s * 5.5), 9.16);
    dot(gx - s * 11, 0, 0.15);
    const a = Math.acos(5.5 / 9.15);
    if (s < 0) circle(gx + 11, 0, 9.15, -a, a); else circle(gx - 11, 0, 9.15, Math.PI - a, Math.PI + a);
    for (const zs of [-1, 1]) {
      const a0 = s < 0 ? (zs < 0 ? 0 : -Math.PI / 2) : (zs < 0 ? Math.PI / 2 : Math.PI);
      circle(gx, zs * HW, 1, a0, a0 + Math.PI / 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, w: PITCH.L + 2 * M, h: PITCH.W + 2 * M };
}

function netTexture() {
  const [c, g] = canvas(256, 256);
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 3;
  for (let i = 0; i <= 256; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

function crowdTexture() {
  const [c, g] = canvas(1024, 512);
  g.fillStyle = '#1b1f2e'; g.fillRect(0, 0, 1024, 512);
  const palette = ['#c9c9c9', '#a8323a', '#34529a', '#c9a23a', '#2f6b3a', '#b8682c', '#7d3f7d', '#d8d8d8', '#2a2a2a', '#6f9cc4'];
  for (let row = 0; row < 32; row++) {
    g.fillStyle = row % 2 ? '#262b3d' : '#202436'; g.fillRect(0, row * 16, 1024, 16);
    for (let x = 0; x < 1024; x += 9 + Math.random() * 4) {
      if (Math.random() < 0.12) continue;
      g.fillStyle = palette[Math.floor(Math.random() * palette.length)];
      g.fillRect(x, row * 16 + 5, 6, 8);
      g.fillStyle = ['#f1c9a5', '#c68a5f', '#7a4d2e', '#e0b18a'][Math.floor(Math.random() * 4)];
      g.fillRect(x + 1, row * 16 + 1, 4, 4);
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}

function adTexture() {
  const [c, g] = canvas(2048, 64);
  const ads = [['FOOT LIBRE', '#0c2340', '#ffffff'], ['100% GRATUIT', '#d7263d', '#ffffff'], ['OPEN SOURCE', '#1b998b', '#ffffff'], ['JOUE À LA MANETTE', '#f46036', '#1b1b1b'], ['MULTIJOUEUR EN LIGNE', '#2e294e', '#ffd400']];
  const w = 2048 / ads.length;
  ads.forEach(([txt, bg, fg], i) => {
    g.fillStyle = bg; g.fillRect(i * w, 0, w, 64);
    g.fillStyle = fg; g.font = 'bold 30px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(txt, i * w + w / 2, 34);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t;
}

function ballTexture() {
  const [c, g] = canvas(512, 256);
  g.fillStyle = '#f7f7f7'; g.fillRect(0, 0, 512, 256);
  // Motif de panneaux (projection équirectangulaire approximative).
  const pts = [];
  for (let i = 0; i < 12; i++) {
    const y = 1 - (i + 0.5) / 12 * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963;
    pts.push([Math.atan2(Math.sin(th) * r, Math.cos(th) * r), Math.asin(y)]);
  }
  g.fillStyle = '#151515';
  for (const [lon, lat] of pts) {
    const u = (lon / (Math.PI * 2) + 0.5) * 512, v = (0.5 - lat / Math.PI) * 256;
    const sx = 1 / Math.max(0.25, Math.cos(lat));
    for (const off of [-512, 0, 512]) {
      g.beginPath();
      for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2 - Math.PI / 2; g.lineTo(u + off + Math.cos(a) * 20 * sx, v + Math.sin(a) * 20); }
      g.closePath(); g.fill();
    }
  }
  g.strokeStyle = '#bbb'; g.lineWidth = 2;
  for (let i = 0; i < 40; i++) { g.beginPath(); g.moveTo(Math.random() * 512, Math.random() * 256); g.lineTo(Math.random() * 512, Math.random() * 256); g.globalAlpha = 0.15; g.stroke(); }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function numberTexture(num, color) {
  const [c, g] = canvas(128, 128);
  g.font = 'bold 92px Arial Black, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,0.35)'; g.strokeText(String(num), 64, 68);
  g.fillStyle = color; g.fillText(String(num), 64, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function labelSprite(text, color) {
  const [c, g] = canvas(128, 64);
  g.font = 'bold 40px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.strokeText(text, 64, 32);
  g.fillStyle = '#' + color.toString(16).padStart(6, '0'); g.fillText(text, 64, 32);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.8, 1); s.renderOrder = 10;
  return s;
}

// ---------- Joueurs ----------
const GEO = {};
function geos() {
  if (GEO.torso) return GEO;
  GEO.torso = new THREE.CapsuleGeometry(0.2, 0.36, 4, 12);
  GEO.shorts = new THREE.CylinderGeometry(0.19, 0.2, 0.26, 12);
  GEO.thigh = new THREE.CapsuleGeometry(0.08, 0.32, 3, 8); GEO.thigh.translate(0, -0.24, 0);
  GEO.shin = new THREE.CapsuleGeometry(0.065, 0.32, 3, 8); GEO.shin.translate(0, -0.22, 0);
  GEO.boot = new THREE.BoxGeometry(0.24, 0.08, 0.11); GEO.boot.translate(0.05, -0.43, 0);
  GEO.arm = new THREE.CapsuleGeometry(0.055, 0.46, 3, 8); GEO.arm.translate(0, -0.27, 0);
  GEO.head = new THREE.SphereGeometry(0.125, 16, 12);
  GEO.hair = new THREE.SphereGeometry(0.132, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
  GEO.num = new THREE.PlaneGeometry(0.28, 0.28);
  GEO.blob = new THREE.CircleGeometry(0.5, 20);
  GEO.ring = new THREE.RingGeometry(0.62, 0.8, 32);
  GEO.arrow = new THREE.ConeGeometry(0.18, 0.32, 4);
  return GEO;
}

const SKINS = [0xf1c9a5, 0xd9a47a, 0xa86f48, 0x6e4529, 0xe8b48f];
const HAIRS = [0x2b1d14, 0x111111, 0x6b4a2b, 0xc89b52, 0x3a2a1e];

class PlayerModel {
  constructor(kit, num, keeper, seed, blobMat) {
    const g = geos();
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    const shirt = new THREE.MeshStandardMaterial({ color: keeper ? kit.gk : kit.shirt, roughness: 0.7 });
    const shorts = new THREE.MeshStandardMaterial({ color: keeper ? 0x222222 : kit.shorts, roughness: 0.8 });
    const socks = new THREE.MeshStandardMaterial({ color: keeper ? kit.gk : kit.socks, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: SKINS[seed % SKINS.length], roughness: 0.6 });
    const hair = new THREE.MeshStandardMaterial({ color: HAIRS[(seed * 7) % HAIRS.length], roughness: 0.9 });
    const boot = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 });
    const add = (geo, mat, parent, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
    this.hips = new THREE.Group(); this.hips.position.y = 0.92; this.body.add(this.hips);
    const torso = add(g.torso, shirt, this.hips, 0, 0.38, 0); torso.scale.set(0.72, 1, 1);
    add(g.shorts, shorts, this.hips, 0, 0.02, 0);
    const n = new THREE.Mesh(g.num, new THREE.MeshBasicMaterial({ map: numberTexture(num, '#' + (keeper ? 0xffffff : kit.number).toString(16).padStart(6, '0')), transparent: true }));
    n.position.set(-0.15, 0.42, 0); n.rotation.y = -Math.PI / 2; this.hips.add(n);
    this.legs = []; this.knees = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(0, -0.06, s * 0.1); this.hips.add(hip);
      add(g.thigh, shorts.color.getHex() === shirt.color.getHex() ? shorts : skin, hip);
      const knee = new THREE.Group(); knee.position.y = -0.46; hip.add(knee);
      add(g.shin, socks, knee); add(g.boot, boot, knee);
      this.legs.push(hip); this.knees.push(knee);
    }
    this.arms = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(0, 0.6, s * 0.26); this.hips.add(sh);
      add(g.arm, keeper ? shirt : skin, sh);
      sh.rotation.x = s * 0.12;
      this.arms.push(sh);
    }
    this.head = add(g.head, skin, this.hips, 0.01, 0.82, 0);
    const hr = add(g.hair, hair, this.head, -0.01, 0.01, 0); hr.rotation.z = 0.25;
    const blob = new THREE.Mesh(g.blob, blobMat); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.02; this.root.add(blob);
    this.phase = Math.random() * 10;
    this.marker = null;
  }

  setMarker(slot) {
    if (this.markerSlot === slot) return;
    if (this.marker) { this.root.remove(this.marker); this.marker = null; }
    this.markerSlot = slot;
    if (slot < 0) return;
    const g = geos();
    const col = SLOT_COLORS[slot % SLOT_COLORS.length];
    const grp = new THREE.Group();
    const ring = new THREE.Mesh(g.ring, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; grp.add(ring);
    const arrow = new THREE.Mesh(g.arrow, new THREE.MeshBasicMaterial({ color: col }));
    arrow.rotation.x = Math.PI; arrow.position.y = 2.35; grp.add(arrow);
    const lbl = labelSprite('J' + (slot + 1), col); lbl.position.y = 2.85; grp.add(lbl);
    this.arrow = arrow;
    this.marker = grp; this.root.add(grp);
  }

  update(dt, s, t) {
    // s = [x, z, face, speed, flags]
    const [x, z, face, speed, flags] = s;
    this.root.position.set(x, 0, z);
    this.root.rotation.y = -face;
    const slide = flags & 1, stun = flags & 2, kick = flags & 4, dive = flags & 8;
    this.phase += dt * (2.2 + speed * 1.45);
    const amp = Math.min(1, speed / 7.5);
    const sw = Math.sin(this.phase) * amp;
    this.body.position.set(0, Math.abs(Math.cos(this.phase)) * 0.06 * amp, 0);
    this.body.rotation.set(0, 0, -amp * 0.18);
    this.legs[0].rotation.z = sw * 0.85; this.legs[1].rotation.z = -sw * 0.85;
    this.knees[0].rotation.z = -Math.max(0, -Math.sin(this.phase)) * 1.1 * amp - 0.05;
    this.knees[1].rotation.z = -Math.max(0, Math.sin(this.phase)) * 1.1 * amp - 0.05;
    this.arms[0].rotation.z = -sw * 0.7; this.arms[1].rotation.z = sw * 0.7;
    if (speed < 0.3) {
      // Respiration à l'arrêt.
      const br = Math.sin(t * 2 + this.phase) * 0.03;
      this.body.position.y = br * 0.3; this.arms[0].rotation.z = br; this.arms[1].rotation.z = -br;
    }
    if (kick) { this.legs[1].rotation.z = 1.25; this.knees[1].rotation.z = -0.2; this.arms[0].rotation.z = 0.8; this.body.rotation.z = 0.12; }
    if (slide) { this.body.rotation.z = 1.25; this.body.position.y = -0.5; this.legs[0].rotation.z = 0.5; this.legs[1].rotation.z = 0.9; }
    if (stun && !slide) { this.body.rotation.x = Math.sin(t * 9) * 0.06; this.body.rotation.z = -0.25; }
    if (dive) {
      const d = flags & 16 ? 1 : -1;
      // Plongeon latéral : la direction monde est convertie en repère local.
      this.body.rotation.x = -d * 1.25 * Math.sign(Math.cos(face) || 1);
      this.body.position.y = 0.45;
      this.arms[0].rotation.x = 2.8; this.arms[1].rotation.x = -2.8;
    } else { this.arms[0].rotation.x = -0.12; this.arms[1].rotation.x = 0.12; }
    if (this.arrow) this.arrow.position.y = 2.35 + Math.sin(t * 5) * 0.08;
  }
}

// ---------- Scène ----------
export class Renderer {
  constructor(container, opts = {}) {
    this.quality = opts.quality ?? 'high';
    this.container = container;
    const r = new THREE.WebGLRenderer({ antialias: this.quality !== 'low', powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, this.quality === 'high' ? 2 : 1));
    r.setSize(container.clientWidth, container.clientHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = this.quality !== 'low';
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);
    this.r = r;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0d1630, 160, 420);
    this.camera = new THREE.PerspectiveCamera(38, container.clientWidth / container.clientHeight, 0.5, 1000);
    this.camera.position.set(0, 32, 75);
    this.camMode = 0;
    this.camTarget = new THREE.Vector3();
    this.camPos = new THREE.Vector3(0, 32, 75);
    this.buildWorld();
    this.players = [];
    this.kits = null;
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.r.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  buildWorld() {
    const s = this.scene;
    // Ciel crépusculaire.
    const skyGeo = new THREE.SphereGeometry(500, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x07122b) }, mid: { value: new THREE.Color(0x24345e) }, bot: { value: new THREE.Color(0xd9774a) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.6, h)) : mix(bot, mid, smoothstep(-0.05, 0.12, h)); gl_FragColor = vec4(c, 1.0); }',
    });
    s.add(new THREE.Mesh(skyGeo, skyMat));

    s.add(new THREE.HemisphereLight(0xb9cdf5, 0x24402a, 0.85));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    sun.position.set(-40, 80, 35);
    sun.castShadow = this.quality !== 'low';
    const sm = this.quality === 'high' ? 4096 : 2048;
    sun.shadow.mapSize.set(sm, sm);
    Object.assign(sun.shadow.camera, { left: -65, right: 65, top: 45, bottom: -45, near: 10, far: 200 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    s.add(sun);
    const fill = new THREE.DirectionalLight(0x9db8ff, 0.5); fill.position.set(50, 40, -40); s.add(fill);

    // Pelouse.
    const pt = pitchTexture(this.quality === 'high');
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(pt.w, pt.h), new THREE.MeshStandardMaterial({ map: pt.tex, roughness: 0.95 }));
    pitch.rotation.x = -Math.PI / 2; pitch.receiveShadow = true; s.add(pitch);
    const around = new THREE.Mesh(new THREE.PlaneGeometry(240, 180), new THREE.MeshStandardMaterial({ color: 0x245e2c, roughness: 1 }));
    around.rotation.x = -Math.PI / 2; around.position.y = -0.02; around.receiveShadow = true; s.add(around);

    // Buts.
    const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.1 });
    const netMat = new THREE.MeshBasicMaterial({ map: netTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.7 });
    const R = 0.06, GW = PITCH.GW, GH = PITCH.GH, GD = PITCH.GD;
    for (const side of [-1, 1]) {
      const goal = new THREE.Group(); goal.position.x = side * HL;
      const post = new THREE.CylinderGeometry(R, R, GH, 12);
      for (const zs of [-1, 1]) { const m = new THREE.Mesh(post, postMat); m.position.set(0, GH / 2, zs * GW / 2); m.castShadow = true; goal.add(m); }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(R, R, GW + 2 * R, 12), postMat); bar.rotation.x = Math.PI / 2; bar.position.y = GH; bar.castShadow = true; goal.add(bar);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(GW, GH), netMat.clone()); back.material.map = back.material.map.clone(); back.material.map.repeat.set(GW / 0.9, GH / 0.9); back.material.map.needsUpdate = true;
      back.position.set(side * GD, GH / 2, 0); back.rotation.y = Math.PI / 2; goal.add(back);
      const top = new THREE.Mesh(new THREE.PlaneGeometry(GD, GW), netMat); top.rotation.x = -Math.PI / 2; top.position.set(side * GD / 2, GH, 0); goal.add(top);
      for (const zs of [-1, 1]) { const sideNet = new THREE.Mesh(new THREE.PlaneGeometry(GD, GH), netMat); sideNet.position.set(side * GD / 2, GH / 2, zs * GW / 2); goal.add(sideNet); }
      s.add(goal);
    }
    // Drapeaux de corner.
    const flagMat = new THREE.MeshStandardMaterial({ color: 0xffd400, side: THREE.DoubleSide });
    for (const xs of [-1, 1]) for (const zs of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), postMat); pole.position.set(xs * HL, 0.8, zs * HW); s.add(pole);
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), flagMat); fl.position.set(xs * HL + 0.2, 1.45, zs * HW); s.add(fl);
    }

    // Panneaux publicitaires.
    const adT = adTexture();
    const adMat = new THREE.MeshBasicMaterial({ map: adT });
    const mkBoard = (len, x, z, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.9), adMat.clone());
      m.material.map = adT.clone(); m.material.map.repeat.set(len / 60, 1); m.material.map.needsUpdate = true;
      m.position.set(x, 0.45, z); m.rotation.y = ry; s.add(m); return m;
    };
    mkBoard(120, 0, -HW - 5, 0);
    mkBoard(120, 0, HW + 5, Math.PI);
    mkBoard(36, -HL - 5, -24, Math.PI / 2); mkBoard(36, -HL - 5, 24, Math.PI / 2);
    mkBoard(36, HL + 5, -24, -Math.PI / 2); mkBoard(36, HL + 5, 24, -Math.PI / 2);
    this.adBoards = adT;

    // Tribunes en gradins.
    const crowdT = crowdTexture();
    const standMat = new THREE.MeshStandardMaterial({ map: crowdT, roughness: 1 });
    const concrete = new THREE.MeshStandardMaterial({ color: 0x3b4152, roughness: 1 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x1d2130, roughness: 0.8, metalness: 0.3 });
    const mkStand = (len, depth, dist, ry) => {
      const grp = new THREE.Group();
      const rows = 6, rh = 2.6, rd = depth / rows;
      for (let i = 0; i < rows; i++) {
        const geo = new THREE.BoxGeometry(len, rh, rd);
        const mat = standMat.clone(); mat.map = crowdT.clone(); mat.map.repeat.set(len / 30, 1); mat.map.offset.x = Math.random(); mat.map.needsUpdate = true;
        const m = new THREE.Mesh(geo, [concrete, concrete, mat, concrete, concrete, mat]);
        m.position.set(0, 1.5 + i * rh, dist + i * rd); m.receiveShadow = true; grp.add(m);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 4, 0.6, depth + 6), roofMat);
      roof.position.set(0, 1.5 + rows * rh + 6, dist + depth / 2 - 2); grp.add(roof);
      const back = new THREE.Mesh(new THREE.BoxGeometry(len + 4, rows * rh + 8, 1), concrete);
      back.position.set(0, (rows * rh + 8) / 2, dist + depth + 1); grp.add(back);
      grp.rotation.y = ry; s.add(grp);
    };
    // Pas de tribune côté caméra (+z) : la caméra « TV » est placée dans cette tribune.
    mkStand(130, 22, HW + 8, Math.PI);
    mkStand(80, 18, HL + 8, -Math.PI / 2);
    mkStand(80, 18, HL + 8, Math.PI / 2);

    // Pylônes d'éclairage.
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfffbe8 });
    for (const xs of [-1, 1]) for (const zs of [-1, 1]) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 42, 8), concrete);
      tower.position.set(xs * (HL + 22), 21, zs * (HW + 26)); s.add(tower);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 0.6), lampMat);
      panel.position.set(xs * (HL + 21), 43, zs * (HW + 25)); panel.lookAt(0, 0, 0); s.add(panel);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex(), color: 0xfff3c4, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      glow.scale.set(26, 26, 1); glow.position.copy(panel.position); s.add(glow);
    }

    // Ballon.
    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 16), new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.45 }));
    this.ballMesh.castShadow = true; s.add(this.ballMesh);
    this.blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: this.quality === 'low' ? 0.35 : 0.18, depthWrite: false });
    this.ballBlob = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), this.blobMat.clone());
    this.ballBlob.rotation.x = -Math.PI / 2; this.ballBlob.position.y = 0.025; s.add(this.ballBlob);
  }

  glowTex() {
    if (this._glow) return this._glow;
    const [c, g] = canvas(128, 128);
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,240,200,0.6)'); gr.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    this._glow = new THREE.CanvasTexture(c); return this._glow;
  }

  setTeams(kits) {
    for (const p of this.players) this.scene.remove(p.root);
    this.players = [];
    this.kits = kits;
    for (let t = 0; t < 2; t++) {
      for (let i = 0; i < TEAM_SIZE; i++) {
        const m = new PlayerModel(kits[t], i + 1, i === 0, t * 13 + i * 5 + 3, this.blobMat);
        this.scene.add(m.root); this.players.push(m);
      }
    }
  }

  cycleCamera() { this.camMode = (this.camMode + 1) % 3; return ['TV', 'Proche', 'Large'][this.camMode]; }

  render(view, dt, t) {
    if (!view) return;
    const slotsByPlayer = new Map();
    (view.hu || []).forEach((h, slot) => { if (h && h[1] >= 0 && (view.localSlots ? view.localSlots.includes(slot) : true)) slotsByPlayer.set(h[1], slot); });
    for (let i = 0; i < this.players.length; i++) {
      this.players[i].update(dt, view.p[i], t);
      this.players[i].setMarker(slotsByPlayer.has(i) ? slotsByPlayer.get(i) : -1);
    }
    const [bx, by, bz, bvx, bvz] = view.b;
    const bm = this.ballMesh;
    bm.position.set(bx, by + 0.01, bz);
    const sp = Math.hypot(bvx, bvz);
    if (sp > 0.05) {
      const axis = new THREE.Vector3(bvz, 0, -bvx).normalize();
      bm.rotateOnWorldAxis(axis, (sp * dt) / 0.12);
    }
    this.ballBlob.position.set(bx, 0.025, bz);
    const hs = Math.max(0.3, 1 - by / 6);
    this.ballBlob.scale.setScalar(1.6 - hs * 0.6);
    this.ballBlob.material.opacity = 0.35 * hs;

    // Caméra.
    const modes = [
      { h: 19, d: 30, follow: 0.9, zf: 0.4, fov: 40 },
      { h: 10, d: 16, follow: 1, zf: 0.7, fov: 46 },
      { h: 36, d: 50, follow: 0.7, zf: 0.25, fov: 40 },
    ];
    const m = modes[this.camMode];
    let tx = Math.max(-HL + 8, Math.min(HL - 8, bx)) * m.follow;
    let tz = bz * m.zf;
    if (view.ph === 'goal') { tx = bx * 0.95; }
    this.camTarget.lerp(new THREE.Vector3(tx, 0, tz), Math.min(1, dt * 3));
    const want = new THREE.Vector3(this.camTarget.x, m.h, this.camTarget.z + m.d);
    if (view.ph === 'goal') want.y -= 6;
    this.camPos.lerp(want, Math.min(1, dt * 2.5));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget.x, 0, this.camTarget.z - 2);
    if (this.camera.fov !== m.fov) { this.camera.fov = lerp(this.camera.fov, m.fov, Math.min(1, dt * 4)); this.camera.updateProjectionMatrix(); }
    if (this.adBoards) this.adBoards.offset.x = (t * 0.02) % 1;
    this.r.render(this.scene, this.camera);
  }
}

// Interpolation entre deux instantanés réseau.
export function interpolateView(a, b, t) {
  if (!a) return b;
  const out = { ...b, p: b.p.map((pb, i) => {
    const pa = a.p[i];
    return [lerp(pa[0], pb[0], t), lerp(pa[1], pb[1], t), lerpAngle(pa[2], pb[2], t), lerp(pa[3], pb[3], t), pb[4], pb[5]];
  }) };
  out.b = b.b.map((v, i) => lerp(a.b[i], v, t));
  out.c = lerp(a.c, b.c, t);
  return out;
}
