// Simulation de match partagée entre le client (mode solo/local) et le serveur (mode en ligne).
// Aucune dépendance au rendu : x = longueur du terrain, z = largeur, y = hauteur. Unités : mètres, secondes.

export const PITCH = { L: 105, W: 68, GW: 7.32, GH: 2.44, GD: 2.0 };
export const BALL_R = 0.11;
export const BTN = { PASS: 1, SHOOT: 2, LOB: 4, THROUGH: 8, SWITCH: 16, SPRINT: 32 };
export const TEAM_SIZE = 11;

const HL = PITCH.L / 2, HW = PITCH.W / 2;
const G = 9.81;
const RUN = 6.3, SPRINT = 8.7;
const ROLL_A = 1.1, ROLL_K = 0.22; // décélération au sol : a + k·v

// 4-4-2 : [rôle, x relatif (-1 = propre but, 1 = but adverse), z relatif]
const FORMATION = [
  ['GK', -0.96, 0],
  ['DF', -0.62, -0.62], ['DF', -0.7, -0.22], ['DF', -0.7, 0.22], ['DF', -0.62, 0.62],
  ['MF', -0.3, -0.62], ['MF', -0.36, -0.18], ['MF', -0.36, 0.18], ['MF', -0.3, 0.62],
  ['FW', -0.04, -0.2], ['FW', -0.08, 0.22],
];
const ROLE_RANGE = { DF: [-0.88, 0.3], MF: [-0.72, 0.62], FW: [-0.45, 0.86] };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hyp = Math.hypot;
const r2 = (v) => Math.round(v * 100) / 100;
function randn() { return (Math.random() + Math.random() + Math.random() - 1.5) * 1.15; }

// Vitesse initiale d'une passe au sol pour parcourir d et arriver à v1.
function rollDist(v0, v1) {
  return (1 / ROLL_K) * ((v0 - v1) - (ROLL_A / ROLL_K) * Math.log((ROLL_A + ROLL_K * v0) / (ROLL_A + ROLL_K * v1)));
}
function solveV0(d, v1) {
  let lo = v1, hi = 40;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (rollDist(m, v1) < d) lo = m; else hi = m; }
  return hi;
}

// Transforme un état de boutons continu en fronts (appui/relâché) sans en perdre entre deux ticks.
export class EdgeTracker {
  constructor() { this.last = 0; this.pressed = 0; this.released = 0; this.mx = 0; this.mz = 0; }
  feed(mx, mz, held) {
    const ch = held ^ this.last;
    this.pressed |= ch & held;
    this.released |= ch & ~held;
    this.last = held; this.mx = mx; this.mz = mz;
  }
  take() {
    const o = { mx: this.mx, mz: this.mz, held: this.last, pressed: this.pressed, released: this.released };
    this.pressed = 0; this.released = 0;
    return o;
  }
}

export class Match {
  constructor(opts = {}) {
    this.halfLen = opts.halfLength ?? 150;
    this.difficulty = opts.difficulty ?? 1;
    this.teamNames = opts.teamNames ?? ['BLEUS', 'ROUGES'];
    this.players = [];
    for (let t = 0; t < 2; t++) {
      for (let i = 0; i < TEAM_SIZE; i++) {
        this.players.push({
          id: t * TEAM_SIZE + i, team: t, idx: i, role: FORMATION[i][0], num: i + 1,
          x: 0, z: 0, vx: 0, vz: 0, face: 0, stamina: 1,
          human: -1, stun: 0, slideT: 0, kickCd: 0, tackleCd: 0, kickAnim: 0, diveT: 0, diveDir: 0,
          aiT: Math.random() * 0.3, holdT: 0,
        });
      }
    }
    this.ball = { x: 0, y: BALL_R, z: 0, vx: 0, vy: 0, vz: 0, owner: -1, lastTeam: -1, target: -1, shot: 0, shotTeam: -1, saved: 0 };
    this.score = [0, 0];
    this.half = 1;
    this.clock = 0;
    this.firstKick = Math.random() < 0.5 ? 0 : 1;
    this.phase = 'setpiece';
    this.phaseT = 0;
    this.piece = null;
    this.message = '';
    this.events = [];
    this.humans = [];
    this.shotSeq = 0;
    this.prevPossTeam = -1;
    this.setupKickoff(this.firstKick);
    this.message = 'COUP D\'ENVOI';
  }

  dirOf(team) { const d = team === 0 ? 1 : -1; return this.half === 1 ? d : -d; }
  possTeam() { return this.ball.owner >= 0 ? this.players[this.ball.owner].team : -1; }
  teamPlayers(t) { return this.players.slice(t * TEAM_SIZE, (t + 1) * TEAM_SIZE); }
  emit(e) { this.events.push(e); }
  aiSkill(team) {
    // L'IA adverse s'adapte à la difficulté seulement face à un humain.
    const humanOpp = this.humans.some((h) => h && h.team !== team);
    const humanMine = this.humans.some((h) => h && h.team === team);
    if (humanMine || !humanOpp) return 1;
    return [0.75, 1, 1.18][this.difficulty] ?? 1;
  }

  // ---------- Joueurs humains ----------
  addHuman(slot, team) {
    this.humans[slot] = { team, pid: -1, charging: false, charge: 0 };
    this.assignNearest(slot);
  }
  removeHuman(slot) {
    const h = this.humans[slot];
    if (h && h.pid >= 0) this.players[h.pid].human = -1;
    this.humans[slot] = null;
  }
  setControl(slot, pid) {
    const h = this.humans[slot];
    if (!h || pid < 0) return;
    const p = this.players[pid];
    if (p.team !== h.team || p.role === 'GK') return;
    if (p.human >= 0 && p.human !== slot) return;
    if (h.pid >= 0) this.players[h.pid].human = -1;
    h.pid = pid; p.human = slot; h.charging = false; h.charge = 0;
  }
  assignNearest(slot, exclude = -1) {
    const h = this.humans[slot];
    if (!h) return;
    const b = this.ball;
    let best = -1, bd = 1e9;
    for (const p of this.teamPlayers(h.team)) {
      if (p.role === 'GK' || p.id === exclude || (p.human >= 0 && p.human !== slot)) continue;
      const tx = b.x + b.vx * 0.4, tz = b.z + b.vz * 0.4;
      const d = hyp(p.x - tx, p.z - tz);
      if (d < bd) { bd = d; best = p.id; }
    }
    if (best >= 0) this.setControl(slot, best);
  }

  // ---------- Remises en jeu ----------
  setupKickoff(team) {
    const b = this.ball;
    Object.assign(b, { x: 0, y: BALL_R, z: 0, vx: 0, vy: 0, vz: 0, owner: -1, target: -1, lastTeam: team });
    for (const p of this.players) {
      const dir = this.dirOf(p.team);
      const f = FORMATION[p.idx];
      let rx = Math.min(f[1], -0.03), rz = f[2];
      if (p.team !== team && p.role === 'FW') rx = -0.2;
      if (p.team === team && p.idx === 9) { rx = -0.006; rz = 0; }
      if (p.team === team && p.idx === 10) { rx = -0.02; rz = 0.18; }
      p.x = dir * rx * HL; p.z = rz * HW; p.vx = p.vz = 0;
      p.face = dir > 0 ? 0 : Math.PI;
      p.stun = p.slideT = p.kickCd = p.diveT = 0;
    }
    const taker = this.players[team * TEAM_SIZE + 9];
    this.startPiece('kickoff', team, taker, 0, 0, true);
  }

  startPiece(type, team, taker, x, z, frozenAll = false) {
    const b = this.ball;
    this.phase = 'setpiece';
    this.phaseT = 0;
    this.piece = { type, team, taker: taker.id, frozenAll };
    b.x = x; b.z = z; b.y = BALL_R; b.vx = b.vy = b.vz = 0;
    const dir = this.dirOf(team);
    // Le tireur se place derrière le ballon, tourné vers le jeu.
    let fx = dir, fz = 0;
    if (type === 'throw') { fx = dir * 0.3; fz = -Math.sign(z); }
    if (type === 'corner') { fx = -Math.sign(x); fz = -Math.sign(z) * 0.8; }
    const fl = hyp(fx, fz); fx /= fl; fz /= fl;
    taker.x = x - fx * 0.5; taker.z = z - fz * 0.5; taker.vx = taker.vz = 0;
    taker.face = Math.atan2(fz, fx);
    b.owner = taker.id; b.target = -1;
    taker.stun = 0; taker.kickCd = 0;
    // Les adversaires reculent à distance réglementaire.
    for (const p of this.players) {
      if (p.team === team) continue;
      const dx = p.x - x, dz = p.z - z, d = hyp(dx, dz);
      const minD = type === 'kickoff' ? 0 : 9.15;
      if (d < minD && d > 0.01) { p.x = x + (dx / d) * minD; p.z = z + (dz / d) * minD; }
    }
    for (const h of this.humans) if (h && h.team === team && taker.role !== 'GK') this.setControl(this.humans.indexOf(h), taker.id);
  }

  ballOut(type, team, x, z, msg) {
    this.phase = 'out';
    this.phaseT = 0;
    this.message = msg;
    this.pending = { type, team, x, z };
    this.ball.owner = -1;
    this.emit({ t: 'whistle', n: 1 });
  }

  // ---------- Boucle principale ----------
  step(dt, inputs = []) {
    this.phaseT += dt;
    const b = this.ball;

    if (this.phase === 'fulltime') { this.updatePlayers(dt, inputs, true); this.updateBall(dt); return; }
    if (this.phase === 'halftime') {
      if (this.phaseT > 4) {
        this.half = 2; this.clock = 0; this.message = '2E MI-TEMPS';
        this.setupKickoff(1 - this.firstKick);
      }
      return;
    }
    if (this.phase === 'goal') {
      this.updatePlayers(dt, inputs, true);
      this.updateBall(dt);
      if (this.phaseT > 3.2) { this.setupKickoff(this.pending.team); this.message = ''; }
      return;
    }
    if (this.phase === 'out') {
      this.updatePlayers(dt, inputs, true);
      this.updateBall(dt);
      if (this.phaseT > 1.1) {
        const pd = this.pending;
        let taker;
        if (pd.type === 'goalkick') taker = this.players[pd.team * TEAM_SIZE];
        else taker = this.nearestOf(pd.team, pd.x, pd.z, true);
        this.startPiece(pd.type, pd.team, taker, pd.x, pd.z);
        this.message = '';
      }
      return;
    }

    if (this.phase === 'play' || this.phase === 'setpiece') {
      this.clock += dt;
      if (this.clock >= this.halfLen && this.phase === 'play') {
        this.emit({ t: 'whistle', n: this.half === 1 ? 2 : 3 });
        if (this.half === 1) { this.phase = 'halftime'; this.phaseT = 0; this.message = 'MI-TEMPS'; }
        else { this.phase = 'fulltime'; this.phaseT = 0; this.message = 'FIN DU MATCH'; b.owner = -1; }
        return;
      }
    }
    if (this.phase === 'setpiece' && this.phaseT > 1.6 && this.message !== '' && this.piece.type !== 'kickoff') this.message = '';

    this.updatePlayers(dt, inputs, false);
    this.updateBall(dt);
    if (this.phase === 'play') {
      this.checkPickup();
      this.checkBounds();
    }
    // Changement de possession : bascule automatique du contrôle humain.
    const pt = this.possTeam();
    if (pt !== this.prevPossTeam) {
      if (pt >= 0) {
        const owner = this.players[b.owner];
        this.humans.forEach((h, slot) => {
          if (!h) return;
          if (h.team === pt && owner.role !== 'GK') this.setControl(slot, owner.id);
          else if (h.team !== pt && h.pid >= 0) {
            const me = this.players[h.pid];
            if (hyp(me.x - b.x, me.z - b.z) > 12) this.assignNearest(slot);
          }
        });
      }
      this.prevPossTeam = pt;
    }
  }

  nearestOf(team, x, z, outfield = false) {
    let best = null, bd = 1e9;
    for (const p of this.teamPlayers(team)) {
      if (outfield && p.role === 'GK') continue;
      const d = hyp(p.x - x, p.z - z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // ---------- Joueurs ----------
  updatePlayers(dt, inputs, idle) {
    const b = this.ball;
    const chasers = [-1, -1];
    if (!idle && this.phase === 'play') {
      for (let t = 0; t < 2; t++) {
        if (this.possTeam() === t) continue;
        const human = this.humans.find((h) => h && h.team === t && h.pid >= 0);
        // Avec un humain, l'IA ne presse que s'il est loin du ballon.
        if (human) {
          const hp = this.players[human.pid];
          if (hyp(hp.x - b.x, hp.z - b.z) < 9) continue;
        }
        if (b.target >= 0 && this.players[b.target].team === t && this.players[b.target].human < 0) { chasers[t] = b.target; continue; }
        let best = -1, bd = 1e9;
        for (const p of this.teamPlayers(t)) {
          if (p.role === 'GK' || p.human >= 0 || p.stun > 0) continue;
          const d = hyp(p.x - b.x, p.z - b.z);
          if (d < bd) { bd = d; best = p.id; }
        }
        chasers[t] = best;
      }
    }

    for (const p of this.players) {
      p.kickCd = Math.max(0, p.kickCd - dt);
      p.tackleCd = Math.max(0, p.tackleCd - dt);
      p.kickAnim = Math.max(0, p.kickAnim - dt);
      p.diveT = Math.max(0, p.diveT - dt);
      let dvx = 0, dvz = 0, sprint = false, accel = 22;

      const frozen = this.phase === 'setpiece' && (this.piece.frozenAll || p.id === this.piece.taker);
      if (p.stun > 0) {
        p.stun -= dt;
        if (p.slideT > 0) {
          p.slideT -= dt;
          this.slideContact(p);
        } else { p.vx *= Math.max(0, 1 - dt * 6); p.vz *= Math.max(0, 1 - dt * 6); }
      } else if (frozen) {
        p.vx = p.vz = 0;
        if (p.id === this.piece.taker) {
          // Un humain inactif ne bloque pas le match : l'IA joue à sa place au bout de 6 s.
          if (p.human >= 0 && this.phaseT < 6) this.humanPiece(p, inputs[p.human], dt);
          else this.aiPiece(p);
        }
      } else if (idle) {
        const t = this.phase === 'goal' && this.ball.lastTeam === p.team ? null : this.formationTarget(p);
        if (t) { [dvx, dvz] = this.arrive(p, t.x, t.z, RUN * 0.6); }
      } else if (p.human >= 0) {
        [dvx, dvz, sprint] = this.humanControl(p, inputs[p.human] ?? { mx: 0, mz: 0, held: 0, pressed: 0, released: 0 }, dt);
      } else if (p.role === 'GK') {
        [dvx, dvz, sprint] = this.aiKeeper(p, dt);
        accel = 30;
      } else {
        [dvx, dvz, sprint] = this.aiPlayer(p, dt, chasers[p.team] === p.id);
      }

      if (p.stun <= 0 && !frozen) {
        // Endurance et vitesse max.
        if (sprint && hyp(dvx, dvz) > 0.5) p.stamina = Math.max(0, p.stamina - dt * 0.07);
        else p.stamina = Math.min(1, p.stamina + dt * 0.045);
        let maxS = (sprint ? SPRINT : RUN) * (0.82 + 0.18 * p.stamina);
        if (b.owner === p.id) maxS *= 0.9;
        if (p.human < 0) maxS *= this.aiSkill(p.team) > 1 ? 1.03 : this.aiSkill(p.team) < 1 ? 0.92 : 1;
        if (p.role === 'GK' && p.diveT > 0) maxS = 11;
        const dl = hyp(dvx, dvz);
        if (dl > 1) { dvx /= dl; dvz /= dl; }
        const tvx = dvx * maxS, tvz = dvz * maxS;
        const ax = tvx - p.vx, az = tvz - p.vz, al = hyp(ax, az);
        const maxA = accel * dt;
        if (al > maxA) { p.vx += (ax / al) * maxA; p.vz += (az / al) * maxA; } else { p.vx = tvx; p.vz = tvz; }
        const sp = hyp(p.vx, p.vz);
        if (sp > 0.4) {
          const target = Math.atan2(p.vz, p.vx);
          let da = target - p.face;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          const rate = (b.owner === p.id ? 9 : 12) * dt;
          p.face += clamp(da, -rate, rate);
        }
      }
      p.x += p.vx * dt; p.z += p.vz * dt;
      p.x = clamp(p.x, -HL - 4, HL + 4); p.z = clamp(p.z, -HW - 4, HW + 4);
    }
    // Séparation entre joueurs.
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], c = ps[j];
        const dx = c.x - a.x, dz = c.z - a.z, d = dx * dx + dz * dz;
        if (d < 0.64 && d > 1e-6) {
          const dd = Math.sqrt(d), push = (0.8 - dd) / 2;
          const nx = dx / dd, nz = dz / dd;
          if (!(this.phase === 'setpiece' && (a.id === this.piece.taker))) { a.x -= nx * push; a.z -= nz * push; }
          if (!(this.phase === 'setpiece' && (c.id === this.piece.taker))) { c.x += nx * push; c.z += nz * push; }
        }
      }
    }
  }

  arrive(p, tx, tz, speed) {
    const dx = tx - p.x, dz = tz - p.z, d = hyp(dx, dz);
    if (d < 0.3) return [0, 0];
    const s = Math.min(1, d / 3) * (speed / RUN);
    return [(dx / d) * s, (dz / d) * s];
  }

  formationTarget(p) {
    const dir = this.dirOf(p.team);
    const f = FORMATION[p.idx];
    const b = this.ball;
    const bxr = clamp((b.x * dir) / HL, -1, 1);
    const bzr = clamp(b.z / HW, -1, 1);
    const pt = this.possTeam();
    const att = pt === p.team || (pt < 0 && b.lastTeam === p.team);
    let rx = f[1] * 0.6 + bxr * 0.45 + (att ? 0.2 : -0.05);
    if (p.role === 'FW' && att) rx += 0.1;
    const rr = ROLE_RANGE[p.role] ?? [-0.9, 0.9];
    rx = clamp(rx, rr[0], rr[1]);
    let rz = f[2] * (att ? 1.05 : 0.75) + bzr * 0.3;
    rz = clamp(rz, -0.94, 0.94);
    // Petit balancement pour paraître vivant.
    const wob = Math.sin(this.clock * 0.6 + p.id * 1.7) * 1.2;
    return { x: dir * rx * HL + wob, z: rz * HW };
  }

  humanControl(p, inp, dt) {
    const h = this.humans[p.human];
    const b = this.ball;
    const sprint = !!(inp.held & BTN.SPRINT);
    let mx = inp.mx, mz = inp.mz;
    const ml = hyp(mx, mz);
    if (ml < 0.15) { mx = 0; mz = 0; }
    const dirx = ml > 0.15 ? mx / ml : Math.cos(p.face);
    const dirz = ml > 0.15 ? mz / ml : Math.sin(p.face);

    if (inp.pressed & BTN.SWITCH && b.owner !== p.id) { this.assignNearest(p.human, p.id); return [0, 0, false]; }

    if (b.owner === p.id) {
      if (inp.pressed & BTN.SHOOT) { h.charging = true; h.charge = 0; }
      if (h.charging) {
        h.charge = Math.min(1, h.charge + dt * 1.1);
        if ((inp.released & BTN.SHOOT) || !(inp.held & BTN.SHOOT)) { h.charging = false; this.kickShoot(p, 0.15 + h.charge * 0.85, mx, mz); h.charge = 0; }
      } else if (inp.pressed & BTN.PASS) this.kickPass(p, dirx, dirz, 'ground');
      else if (inp.pressed & BTN.LOB) this.kickPass(p, dirx, dirz, 'lob');
      else if (inp.pressed & BTN.THROUGH) this.kickPass(p, dirx, dirz, 'through');
    } else {
      h.charging = false; h.charge = 0;
      const dball = hyp(b.x - p.x, b.z - p.z);
      if (b.owner < 0 && dball < 1.7 && b.y < 1.9 && p.kickCd <= 0) {
        // Reprise de volée / passe en une touche.
        if (inp.pressed & BTN.SHOOT) { this.kickShoot(p, 0.75, mx, mz); }
        else if (inp.pressed & BTN.PASS) this.kickPass(p, dirx, dirz, 'ground');
        else if (inp.pressed & BTN.LOB) this.kickPass(p, dirx, dirz, 'lob');
      } else if (b.owner >= 0 && this.players[b.owner].team !== p.team) {
        if (inp.pressed & BTN.PASS) this.tryTackle(p, 0.62);
        else if (inp.pressed & BTN.SHOOT) this.startSlide(p);
      }
      // Sans direction, le receveur d'une passe va chercher le ballon.
      if (ml < 0.15 && b.target === p.id && b.owner < 0) {
        const [ax, az] = this.arrive(p, b.x + b.vx * 0.25, b.z + b.vz * 0.25, RUN);
        return [ax, az, false];
      }
    }
    return [mx, mz, sprint];
  }

  humanPiece(p, inp, dt) {
    if (!inp) return;
    const h = this.humans[p.human];
    let mx = inp.mx, mz = inp.mz;
    const ml = hyp(mx, mz);
    if (ml > 0.3) { p.face = Math.atan2(mz, mx); }
    const dirx = Math.cos(p.face), dirz = Math.sin(p.face);
    if (inp.pressed & BTN.SHOOT && this.piece.type !== 'throw') { h.charging = true; h.charge = 0; }
    if (h.charging) {
      h.charge = Math.min(1, h.charge + dt * 1.1);
      if (!(inp.held & BTN.SHOOT)) { h.charging = false; this.kickShoot(p, 0.15 + h.charge * 0.85, mx, mz); h.charge = 0; }
      return;
    }
    if (inp.pressed & BTN.PASS) this.kickPass(p, dirx, dirz, 'ground');
    else if (inp.pressed & BTN.LOB) this.kickPass(p, dirx, dirz, 'lob');
    else if (inp.pressed & BTN.THROUGH) this.kickPass(p, dirx, dirz, 'through');
  }

  aiPiece(p) {
    if (this.phaseT < (this.piece.type === 'kickoff' ? 1.4 : 1.5)) return;
    const dir = this.dirOf(p.team);
    const type = this.piece.type;
    if (type === 'kickoff') { this.kickPass(p, -dir, 0.3, 'ground', this.players[p.team * TEAM_SIZE + 7]); return; }
    if (type === 'corner') {
      const mates = this.teamPlayers(p.team).filter((m) => m.id !== p.id && Math.abs(m.x - dir * HL) < 20 && Math.abs(m.z) < 16);
      const tgt = mates.length ? mates[Math.floor(Math.random() * mates.length)] : null;
      if (tgt) { this.kickPass(p, 0, 0, 'lob', tgt); return; }
    }
    if (type === 'goalkick') {
      const mids = this.teamPlayers(p.team).filter((m) => m.role === 'MF' || m.role === 'FW');
      const tgt = this.bestPassTarget(p, mids) ?? mids[0];
      this.kickPass(p, 0, 0, Math.random() < 0.5 ? 'lob' : 'ground', tgt);
      return;
    }
    const tgt = this.bestPassTarget(p) ?? this.nearestOf(p.team, p.x + dir * 8, p.z * 0.6, true);
    this.kickPass(p, 0, 0, 'ground', tgt);
  }

  aiPlayer(p, dt, chaser) {
    const b = this.ball;
    const dir = this.dirOf(p.team);
    const skill = this.aiSkill(p.team);
    if (b.owner === p.id) return this.aiWithBall(p, dt);
    if (chaser) {
      const d = hyp(b.x - p.x, b.z - p.z);
      const t = clamp(d / 8, 0, 1.2);
      let tx = b.x + b.vx * t, tz = b.z + b.vz * t;
      if (b.owner >= 0) {
        // Se placer entre le porteur et son but.
        const o = this.players[b.owner];
        tx = o.x - dir * 0.9 + o.vx * 0.3; tz = o.z + o.vz * 0.3;
        if (d < 1.7 && p.tackleCd <= 0 && o.team !== p.team) {
          if (Math.random() < 0.35 * skill) this.tryTackle(p, 0.32 * skill);
          p.tackleCd = 1.0 / skill;
        }
      }
      const [ax, az] = this.arrive(p, tx, tz, SPRINT);
      return [ax * 1.5, az * 1.5, d > 4];
    }
    // Reprise de volée automatique des IA quand le ballon arrive près d'elles.
    const t = this.formationTarget(p);
    // Un attaquant se démarque quand l'équipe a le ballon.
    if (this.possTeam() === p.team && (p.role === 'FW' || p.role === 'MF')) {
      const o = this.players[b.owner];
      if (o && Math.abs(o.x - p.x) < 25 && Math.sin(this.clock * 0.9 + p.id) > 0.55) t.x += dir * 6;
    }
    // Marquage : en défense, se rapprocher de l'attaquant le plus proche de sa zone.
    if (this.possTeam() >= 0 && this.possTeam() !== p.team && p.role !== 'FW') {
      let mk = null, md = 9;
      for (const o of this.teamPlayers(1 - p.team)) { const d = hyp(o.x - t.x, o.z - t.z); if (d < md) { md = d; mk = o; } }
      if (mk) { t.x = mk.x * 0.6 + t.x * 0.4 - dir * 1.2; t.z = mk.z * 0.6 + t.z * 0.4; }
    }
    const [ax, az] = this.arrive(p, t.x, t.z, RUN);
    const far = hyp(t.x - p.x, t.z - p.z) > 10;
    return [ax, az, far];
  }

  pressureOn(p) {
    let md = 1e9;
    for (const o of this.teamPlayers(1 - p.team)) md = Math.min(md, hyp(o.x - p.x, o.z - p.z));
    return md;
  }

  laneOpen(p, tx, tz) {
    const dx = tx - p.x, dz = tz - p.z, L2 = dx * dx + dz * dz;
    let minD = 1e9;
    for (const o of this.teamPlayers(1 - p.team)) {
      const t = clamp(((o.x - p.x) * dx + (o.z - p.z) * dz) / L2, 0, 1);
      const d = hyp(p.x + dx * t - o.x, p.z + dz * t - o.z);
      minD = Math.min(minD, d);
    }
    return minD;
  }

  bestPassTarget(p, pool = null) {
    const dir = this.dirOf(p.team);
    let best = null, bs = -1e9;
    for (const m of pool ?? this.teamPlayers(p.team)) {
      if (m.id === p.id || m.role === 'GK') continue;
      const d = hyp(m.x - p.x, m.z - p.z);
      if (d < 6 || d > 42) continue;
      const lane = this.laneOpen(p, m.x, m.z);
      if (lane < 1.6) continue;
      const progress = (m.x - p.x) * dir;
      const free = Math.min(this.pressureOn(m), 10);
      const s = progress * 0.5 + free * 0.45 + Math.min(lane, 6) * 0.4 - d * 0.04;
      if (s > bs) { bs = s; best = m; }
    }
    return best;
  }

  aiWithBall(p, dt) {
    const dir = this.dirOf(p.team);
    const skill = this.aiSkill(p.team);
    const gx = dir * HL;
    const distGoal = hyp(gx - p.x, p.z);
    const pressure = this.pressureOn(p);
    p.holdT += dt;
    p.aiT -= dt;
    if (p.aiT <= 0 && p.kickCd <= 0) {
      p.aiT = 0.22 / skill + Math.random() * 0.15;
      const angleOk = Math.abs(p.z) < 18 + (30 - distGoal) * 0.3;
      if (distGoal < 28 && angleOk && (Math.random() < 0.3 || distGoal < 17)) {
        // Vise le côté opposé au gardien.
        const gk = this.players[(1 - p.team) * TEAM_SIZE];
        const side = gk.z > 0 ? -1 : 1;
        this.kickShoot(p, 0.55 + Math.random() * 0.35, 0, side * (0.5 + Math.random() * 0.5), true);
        return [0, 0, false];
      }
      const tgt = this.bestPassTarget(p);
      const wantPass = (pressure < 3 && Math.random() < 0.6) || p.holdT > 3 || (tgt && (tgt.x - p.x) * dir > 10 && Math.random() < 0.25);
      if (tgt && wantPass) {
        const ahead = (tgt.x - p.x) * dir;
        const kind = ahead > 12 && Math.random() < 0.4 ? 'through' : hyp(tgt.x - p.x, tgt.z - p.z) > 30 ? 'lob' : 'ground';
        this.kickPass(p, 0, 0, kind, tgt);
        return [0, 0, false];
      }
    }
    // Conduite de balle vers le but en évitant les adversaires.
    let vx = gx - p.x, vz = -p.z * 0.5;
    const vl = hyp(vx, vz); vx /= vl; vz /= vl;
    for (const o of this.teamPlayers(1 - p.team)) {
      const dx = p.x - o.x, dz = p.z - o.z, d = hyp(dx, dz);
      if (d < 7 && d > 0.01) { const w = (7 - d) / 7; vx += (dx / d) * w * 1.1; vz += (dz / d) * w * 1.4; }
    }
    if (Math.abs(p.z) > HW - 4) vz -= Math.sign(p.z) * 1.5;
    if (Math.abs(p.x) > HL - 3 && Math.sign(p.x) !== dir) vx += dir;
    const l = hyp(vx, vz) || 1;
    return [vx / l, vz / l, pressure > 4 && p.stamina > 0.3];
  }

  aiKeeper(p, dt) {
    const b = this.ball;
    const dir = this.dirOf(p.team);
    const gx = -dir * HL;
    const skill = this.aiSkill(p.team);
    if (b.owner === p.id) {
      p.holdT += dt;
      if (p.holdT > 1.2) {
        const tgt = this.bestPassTarget(p) ?? this.players[p.team * TEAM_SIZE + 2 + Math.floor(Math.random() * 2)];
        this.kickPass(p, 0, 0, hyp(tgt.x - p.x, tgt.z - p.z) > 28 ? 'lob' : 'ground', tgt);
      }
      return this.arrive(p, gx + dir * 6, 0, RUN * 0.5).concat(false);
    }
    // Tir cadré en approche : plongeon vers le point d'impact.
    if (b.owner < 0 && b.vx * -dir > 6) {
      const t = (gx - b.x) / b.vx;
      if (t > 0 && t < 1.6) {
        const zc = b.z + b.vz * t;
        if (Math.abs(zc) < PITCH.GW / 2 + 1.2) {
          const tx = gx + dir * 0.6, tz = clamp(zc, -PITCH.GW / 2, PITCH.GW / 2);
          if (Math.abs(tz - p.z) > 1.2 && p.diveT <= 0 && t < 0.7) { p.diveT = 0.6; p.diveDir = Math.sign(tz - p.z); }
          return [...this.arrive(p, tx, tz, SPRINT * 1.4), true];
        }
      }
    }
    // Sortie sur un ballon libre dans la surface.
    const inBox = Math.abs(b.x - gx) < 16.5 && Math.abs(b.z) < 20;
    if (b.owner < 0 && inBox && b.y < 2) {
      const closest = this.players.every((o) => o === p || hyp(o.x - b.x, o.z - b.z) > hyp(p.x - b.x, p.z - b.z) - 1);
      if (closest) return [...this.arrive(p, b.x, b.z, SPRINT), true];
    }
    // Placement sur la bissectrice ballon / centre du but.
    const dx = b.x - gx, dz = b.z, d = hyp(dx, dz) || 1;
    const off = clamp(d * 0.12 + 0.8, 1, 5) * (0.9 + 0.1 * skill);
    const tx = gx + (dx / d) * off;
    const tz = clamp((dz / d) * off * 1.4, -PITCH.GW / 2 + 0.3, PITCH.GW / 2 - 0.3);
    return [...this.arrive(p, tx, tz, RUN), false];
  }

  // ---------- Actions ----------
  releaseBall(p) {
    const b = this.ball;
    b.owner = -1;
    b.lastTeam = p.team;
    p.kickCd = 0.32;
    p.kickAnim = 0.3;
    p.holdT = 0;
    if (this.phase === 'setpiece') { this.phase = 'play'; this.phaseT = 0; if (this.piece.type === 'kickoff') { this.emit({ t: 'whistle', n: 1 }); this.message = ''; } }
  }

  kickPass(p, dirx, dirz, kind, forced = null) {
    const b = this.ball;
    const dir = this.dirOf(p.team);
    let tgt = forced, bs = -1e9;
    if (!tgt) {
      const dl = hyp(dirx, dirz) || 1; dirx /= dl; dirz /= dl;
      for (const m of this.teamPlayers(p.team)) {
        if (m.id === p.id) continue;
        const dx = m.x - p.x, dz = m.z - p.z, d = hyp(dx, dz);
        if (d < 2) continue;
        const cos = (dx * dirx + dz * dirz) / d;
        const s = cos * 2.2 - d / 40 - (m.role === 'GK' ? 1 : 0) + Math.min(this.laneOpen(p, m.x, m.z), 4) * 0.12;
        if (s > bs) { bs = s; tgt = m; }
      }
    }
    if (!tgt) return;
    let ax = tgt.x + tgt.vx * 0.6, az = tgt.z + tgt.vz * 0.6;
    if (kind === 'through') { ax = tgt.x + dir * 7 + tgt.vx * 0.8; az = tgt.z + tgt.vz * 0.8; }
    ax = clamp(ax, -HL + 1, HL - 1); az = clamp(az, -HW + 1, HW - 1);
    const dx = ax - b.x, dz = az - b.z, d = Math.max(1, hyp(dx, dz));
    const err = (p.human >= 0 ? 0.03 : 0.05 / this.aiSkill(p.team)) * (1 + (hyp(p.vx, p.vz) > 7 ? 1 : 0));
    const ang = Math.atan2(dz, dx) + randn() * err;
    if (kind === 'lob') {
      const T = clamp(0.55 + d / 24, 0.8, 2.3);
      const vh = d / T * 0.98;
      b.vx = Math.cos(ang) * vh; b.vz = Math.sin(ang) * vh; b.vy = G * T / 2;
    } else {
      const v0 = Math.min(32, solveV0(d, kind === 'through' ? 5.5 : 4.2));
      b.vx = Math.cos(ang) * v0; b.vz = Math.sin(ang) * v0; b.vy = kind === 'through' ? 0.6 : 0;
    }
    b.target = tgt.id;
    this.releaseBall(p);
    this.emit({ t: 'kick', v: r2(hyp(b.vx, b.vz)) });
    // Le contrôle humain suit la passe.
    if (p.human >= 0 && tgt.role !== 'GK') this.setControl(p.human, tgt.id);
  }

  kickShoot(p, power, mx, mz, aiAim = false) {
    const b = this.ball;
    const dir = this.dirOf(p.team);
    const gx = dir * HL;
    // Visée latérale : composante perpendiculaire au but (axe z), sinon côté opposé au gardien.
    let aim;
    if (aiAim) aim = mz * 3.0;
    else if (Math.abs(mz) > 0.2) aim = clamp(mz, -1, 1) * 3.1;
    else { const gk = this.players[(1 - p.team) * TEAM_SIZE]; aim = (gk.z > b.z ? -1 : 1) * 1.8; }
    const skill = p.human >= 0 ? 1 : this.aiSkill(p.team);
    const dist = hyp(gx - b.x, b.z);
    let err = (0.12 + dist / 120) / skill + (hyp(p.vx, p.vz) > 7.5 ? 0.15 : 0) + (this.pressureOn(p) < 1.5 ? 0.15 : 0);
    let tz = aim + randn() * err * 2.2;
    let ty = 0.2 + power * 1.5 + Math.abs(randn() * err);
    if (power > 0.9) ty += (power - 0.9) * 14;
    const speed = 15 + 17 * power;
    const dx = gx - b.x, dz = tz - b.z, d = hyp(dx, dz);
    const T = d / speed;
    b.vx = dx / T; b.vz = dz / T;
    b.vy = clamp((ty - b.y + 0.5 * G * T * T) / T, 0, 14);
    b.target = -1;
    b.shot = ++this.shotSeq; b.shotTeam = p.team;
    this.releaseBall(p);
    this.emit({ t: 'kick', v: r2(speed), shot: 1 });
  }

  tryTackle(p, chance) {
    const b = this.ball;
    if (b.owner < 0 || p.tackleCd > 0) return;
    const o = this.players[b.owner];
    const d = hyp(o.x - p.x, o.z - p.z);
    p.tackleCd = 0.6;
    if (d > 1.9) return;
    if (Math.random() < chance) {
      b.owner = -1; b.target = -1; b.lastTeam = p.team;
      const a = Math.atan2(o.z - p.z, o.x - p.x) + randn() * 0.4;
      b.vx = Math.cos(a) * 3 + p.vx * 0.3; b.vz = Math.sin(a) * 3 + p.vz * 0.3; b.vy = 0.5;
      o.stun = 0.55; o.kickCd = 0.6;
      this.emit({ t: 'tackle' });
    } else {
      p.stun = 0.45;
    }
  }

  startSlide(p) {
    if (p.slideT > 0 || p.stun > 0) return;
    p.slideT = 0.55; p.stun = 1.2;
    const v = Math.max(8.5, hyp(p.vx, p.vz) + 2);
    p.vx = Math.cos(p.face) * v; p.vz = Math.sin(p.face) * v;
  }

  slideContact(p) {
    const b = this.ball;
    p.vx *= 0.97; p.vz *= 0.97;
    const d = hyp(b.x - p.x, b.z - p.z);
    if (d > 1.3 || b.y > 0.8) return;
    if (b.owner >= 0) {
      const o = this.players[b.owner];
      if (o.team === p.team) return;
      o.stun = 0.9; o.kickCd = 0.8;
      this.emit({ t: 'tackle' });
    }
    b.owner = -1; b.target = -1; b.lastTeam = p.team;
    b.vx = Math.cos(p.face) * 7 + randn(); b.vz = Math.sin(p.face) * 7 + randn(); b.vy = 0.8;
    p.slideT = 0;
  }

  checkPickup() {
    const b = this.ball;
    if (b.owner >= 0) return;
    let best = null, bd = 1e9;
    for (const p of this.players) {
      if (p.kickCd > 0 || p.stun > 0) continue;
      const d = hyp(b.x - p.x, b.z - p.z);
      const gk = p.role === 'GK' && Math.abs(p.x - (-this.dirOf(p.team) * HL)) < 16.5 && Math.abs(p.z) < 20.2;
      const reach = gk ? (p.diveT > 0 ? 2.0 : 1.3) : 0.95;
      const height = gk ? 2.7 : 1.1;
      if (d < reach && b.y < height && d < bd) { bd = d; best = p; }
    }
    if (!best) return;
    const sp = hyp(b.vx, b.vy, b.vz);
    if (best.role === 'GK' && b.shot && b.saved !== b.shot && b.shotTeam !== best.team) {
      // Arrêt du gardien : plus le tir est puissant, plus il est difficile.
      b.saved = b.shot;
      const pSave = clamp(1.05 - (sp - 14) * 0.028, 0.25, 0.97) * (0.85 + 0.15 * this.aiSkill(best.team));
      if (Math.random() > pSave) { best.kickCd = 0.5; return; }
      this.emit({ t: 'save' });
      if (sp > 21) {
        // Parade : le ballon est repoussé.
        b.vx = -b.vx * 0.25 + randn() * 2; b.vz = b.vz * 0.3 + (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 4);
        b.vy = 3 + Math.random() * 2; b.lastTeam = best.team; b.shot = 0;
        best.kickCd = 0.6;
        return;
      }
    } else if (best.role !== 'GK' && sp > 23 && Math.random() < 0.6) {
      // Contrôle raté sur un ballon trop rapide.
      b.vx *= -0.3; b.vz *= -0.3; b.vy = 1.5; best.kickCd = 0.3; b.lastTeam = best.team; return;
    }
    b.owner = best.id; b.target = -1; b.lastTeam = best.team; b.shot = 0;
    best.holdT = 0; best.aiT = 0.15 + Math.random() * 0.2;
    if (best.role === 'GK') { best.vx *= 0.2; best.vz *= 0.2; }
    this.emit({ t: 'touch' });
  }

  // ---------- Ballon ----------
  updateBall(dt) {
    const b = this.ball;
    if (b.owner >= 0) {
      const p = this.players[b.owner];
      const sp = hyp(p.vx, p.vz);
      const dd = p.role === 'GK' && this.phase !== 'setpiece' ? 0.35 : 0.5 + sp * 0.045;
      const tx = p.x + Math.cos(p.face) * dd, tz = p.z + Math.sin(p.face) * dd;
      const k = Math.min(1, dt * 16);
      b.x += (tx - b.x) * k; b.z += (tz - b.z) * k;
      b.y = p.role === 'GK' && this.phase !== 'setpiece' ? 1.0 : BALL_R;
      b.vx = p.vx; b.vz = p.vz; b.vy = 0;
      return;
    }
    const px = b.x, py = b.y;
    b.vy -= G * dt;
    const air = 1 - 0.06 * dt;
    b.vx *= air; b.vz *= air;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (b.y <= BALL_R) {
      b.y = BALL_R;
      if (b.vy < -1.6) { b.vy = -b.vy * 0.52; this.emit({ t: 'bounce', v: r2(-b.vy) }); b.vx *= 0.9; b.vz *= 0.9; }
      else b.vy = 0;
      if (b.vy === 0) {
        const sp = hyp(b.vx, b.vz);
        if (sp > 0) { const ns = Math.max(0, sp - (ROLL_A + ROLL_K * sp) * dt); b.vx *= ns / sp; b.vz *= ns / sp; }
      }
    }
    // Poteaux et transversale.
    for (const side of [-1, 1]) {
      const lx = side * HL;
      if ((px - lx) * (b.x - lx) <= 0 && px !== b.x) {
        const az = Math.abs(b.z);
        if (az > PITCH.GW / 2 - 0.15 && az < PITCH.GW / 2 + 0.2 && b.y < PITCH.GH + 0.1) {
          b.x = lx - side * 0.15; b.vx = -b.vx * 0.55; b.vz += Math.sign(b.z) * 1.5; this.emit({ t: 'post' }); return;
        }
        if (az < PITCH.GW / 2 && b.y > PITCH.GH - 0.12 && b.y < PITCH.GH + 0.2) {
          b.x = lx - side * 0.15; b.vx = -b.vx * 0.5; b.vy = Math.abs(b.vy) * 0.5 + 1; this.emit({ t: 'post' }); return;
        }
      }
    }
    if (this.phase === 'goal') {
      // Filets.
      const ax = Math.abs(b.x);
      if (ax > HL && Math.abs(b.z) < PITCH.GW / 2 + 0.5) {
        if (ax > HL + PITCH.GD) { b.x = Math.sign(b.x) * (HL + PITCH.GD); b.vx *= -0.15; b.vz *= 0.4; }
        if (Math.abs(b.z) > PITCH.GW / 2) { b.z = Math.sign(b.z) * PITCH.GW / 2; b.vz *= -0.2; }
        if (b.y > PITCH.GH) { b.y = PITCH.GH; b.vy *= -0.2; }
      }
    }
  }

  checkBounds() {
    const b = this.ball;
    if (Math.abs(b.x) > HL + BALL_R) {
      const side = Math.sign(b.x);
      if (Math.abs(b.z) < PITCH.GW / 2 && b.y < PITCH.GH) {
        const scorer = this.dirOf(0) === side ? 0 : 1;
        this.score[scorer]++;
        if (b.owner >= 0) { b.owner = -1; b.vx = side * 4; }
        this.phase = 'goal'; this.phaseT = 0;
        this.message = 'BUT !';
        this.pending = { team: 1 - scorer };
        b.lastTeam = scorer;
        this.emit({ t: 'goal', team: scorer });
        return;
      }
      const defending = this.dirOf(0) === -side ? 0 : 1;
      const lastTeam = b.owner >= 0 ? this.players[b.owner].team : b.lastTeam;
      const zs = Math.sign(b.z) || 1;
      if (lastTeam === defending) this.ballOut('corner', 1 - defending, side * (HL - 0.3), zs * (HW - 0.3), 'CORNER');
      else this.ballOut('goalkick', defending, side * (HL - 5.5), zs * 4, 'SORTIE DE BUT');
      return;
    }
    if (Math.abs(b.z) > HW + BALL_R) {
      const lastTeam = b.owner >= 0 ? this.players[b.owner].team : b.lastTeam;
      const x = clamp(b.x, -HL + 1, HL - 1);
      this.ballOut('throw', 1 - lastTeam, x, Math.sign(b.z) * (HW - 0.3), 'TOUCHE');
    }
  }

  // ---------- Réseau / rendu ----------
  snapshot() {
    const b = this.ball;
    const ev = this.events; this.events = [];
    return {
      p: this.players.map((p) => [r2(p.x), r2(p.z), r2(p.face), r2(hyp(p.vx, p.vz)),
        (p.slideT > 0 ? 1 : 0) | (p.stun > 0 && p.slideT <= 0 && p.diveT <= 0 ? 2 : 0) | (p.kickAnim > 0 ? 4 : 0) | (p.diveT > 0 ? 8 : 0) | (p.diveDir > 0 ? 16 : 0),
        r2(p.stamina)]),
      b: [r2(b.x), r2(b.y), r2(b.z), r2(b.vx), r2(b.vz)],
      o: b.owner,
      s: this.score.slice(),
      c: r2(this.clock), hl: this.halfLen, h: this.half,
      ph: this.phase, m: this.message,
      hu: this.humans.map((h) => (h ? [h.team, h.pid, r2(h.charging ? h.charge : 0)] : null)),
      d: [this.dirOf(0), this.dirOf(1)],
      e: ev,
    };
  }
}
