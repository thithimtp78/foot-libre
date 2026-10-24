// Gestion des salles multijoueur, partagée entre le serveur Node et le navigateur hôte (mode pair à pair).
// Chaque client est un objet { send(texte), open() } ; la simulation fait autorité ici.
import { Match, EdgeTracker } from './sim.js';

const TICK = 1 / 60;
const SNAP_EVERY = 2; // 30 instantanés par seconde
const MAX_PLAYERS = 4;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
const clamp1 = (v) => Math.max(-1, Math.min(1, Number(v) || 0));

export function randomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join('');
}

export class RoomManager {
  // makeCode : permet au navigateur hôte d'imposer le code (= identifiant pair à pair).
  constructor({ makeCode } = {}) {
    this.rooms = new Map();
    this.makeCode = makeCode ?? (() => { let c; do c = randomCode(); while (this.rooms.has(c)); return c; });
  }

  connect(transport) {
    return { transport, name: 'Joueur', room: null, slot: -1, team: 0, edges: new EdgeTracker() };
  }

  send(client, msg) { if (client.transport.open()) client.transport.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); }

  roomState(room) { return room.clients.map((c) => ({ slot: c.slot, name: c.name, team: c.team })); }

  broadcastRoom(room) {
    for (const c of room.clients) {
      this.send(c, { t: 'room', code: room.code, you: c.slot, host: room.host === c, players: this.roomState(room), teams: room.teams, halfLength: room.halfLength, started: !!room.match });
    }
  }

  startMatch(room) {
    room.match = new Match({ halfLength: room.halfLength });
    for (const c of room.clients) { room.match.addHuman(c.slot, c.team); c.edges = new EdgeTracker(); }
    for (const c of room.clients) this.send(c, { t: 'start', teams: room.teams });
    this.broadcastRoom(room);
    room.tick = 0;
    let last = now(), acc = 0;
    room.loop = setInterval(() => {
      const t = now();
      acc += t - last; last = t;
      if (acc > 0.25) acc = 0.25;
      while (acc >= TICK) {
        acc -= TICK;
        const inputs = [];
        for (const c of room.clients) inputs[c.slot] = c.edges.take();
        room.match.step(TICK, inputs);
        room.tick++;
        if (room.tick % SNAP_EVERY === 0) {
          const snap = JSON.stringify({ t: 's', ...room.match.snapshot() });
          for (const c of room.clients) this.send(c, snap);
        }
      }
      if (room.match.phase === 'fulltime' && room.match.phaseT > 8) this.stopMatch(room);
    }, 8);
  }

  stopMatch(room) {
    clearInterval(room.loop); room.loop = null; room.match = null;
    this.broadcastRoom(room);
  }

  leave(client) {
    const room = client.room;
    if (!room) return;
    room.clients = room.clients.filter((c) => c !== client);
    // Un joueur parti est remplacé par l'IA.
    if (room.match) room.match.removeHuman(client.slot);
    client.room = null;
    if (room.clients.length === 0) { if (room.loop) clearInterval(room.loop); this.rooms.delete(room.code); return; }
    if (room.host === client) room.host = room.clients[0];
    this.broadcastRoom(room);
  }

  message(client, raw) {
    let m;
    try { m = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'in') {
      if (client.room?.match) client.edges.feed(clamp1(m.mx), clamp1(m.mz), (m.h | 0) & 63);
      return;
    }
    if (m.t === 'ping') { this.send(client, { t: 'pong', c: m.c }); return; }
    if (m.t === 'create' || m.t === 'join') {
      this.leave(client);
      client.name = String(m.name || 'Joueur').slice(0, 16);
      let room;
      if (m.t === 'create') {
        room = { code: this.makeCode(), clients: [], host: client, match: null, loop: null, halfLength: [60, 120, 180, 300].includes(m.halfLength) ? m.halfLength : 180, teams: Array.isArray(m.teams) ? m.teams.slice(0, 2).map((x) => x | 0) : [0, 1] };
        this.rooms.set(room.code, room);
      } else {
        room = this.rooms.get(String(m.code || '').toUpperCase().trim());
        if (!room) { this.send(client, { t: 'err', msg: 'Salle introuvable.' }); return; }
        if (room.clients.length >= MAX_PLAYERS) { this.send(client, { t: 'err', msg: 'La salle est pleine.' }); return; }
      }
      const used = new Set(room.clients.map((c) => c.slot));
      client.slot = [0, 1, 2, 3].find((s) => !used.has(s));
      const counts = [0, 0]; for (const c of room.clients) counts[c.team]++;
      client.team = counts[0] <= counts[1] ? 0 : 1;
      client.room = room;
      room.clients.push(client);
      if (room.match) { room.match.addHuman(client.slot, client.team); client.edges = new EdgeTracker(); this.send(client, { t: 'start', teams: room.teams }); }
      this.broadcastRoom(room);
      return;
    }
    const room = client.room;
    if (!room) return;
    if (m.t === 'team' && !room.match) { client.team = 1 - client.team; this.broadcastRoom(room); }
    else if (m.t === 'start' && room.host === client && !room.match) this.startMatch(room);
    else if (m.t === 'leave') { this.leave(client); this.send(client, { t: 'left' }); }
  }
}
