// Serveur du jeu : fichiers statiques + salles multijoueur en WebSocket.
// La simulation tourne sur le serveur (autorité) ; les clients envoient leurs entrées et reçoivent des instantanés.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Match, EdgeTracker } from './public/shared/sim.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const TICK = 1 / 60;
const SNAP_EVERY = 2; // 30 instantanés par seconde
const MAX_PLAYERS = 4;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };
const PUBLIC = path.join(ROOT, 'public');

function resolveStatic(urlPath) {
  const file = path.normalize(path.join(PUBLIC, urlPath === '/' ? 'index.html' : urlPath));
  return file.startsWith(PUBLIC) ? file : null;
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/health') { res.writeHead(200); res.end('ok'); return; }
  const file = resolveStatic(urlPath);
  if (!file) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Introuvable'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const rooms = new Map();
function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}
const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };

function roomState(room) {
  return room.clients.map((c) => ({ slot: c.slot, name: c.name, team: c.team }));
}
function broadcastRoom(room) {
  for (const c of room.clients) {
    send(c.ws, { t: 'room', code: room.code, you: c.slot, host: room.host === c, players: roomState(room), teams: room.teams, halfLength: room.halfLength, started: !!room.match });
  }
}

function startMatch(room) {
  room.match = new Match({ halfLength: room.halfLength });
  for (const c of room.clients) { room.match.addHuman(c.slot, c.team); c.edges = new EdgeTracker(); }
  for (const c of room.clients) send(c.ws, { t: 'start', teams: room.teams });
  broadcastRoom(room);
  room.tick = 0;
  let last = process.hrtime.bigint(), acc = 0;
  room.loop = setInterval(() => {
    const now = process.hrtime.bigint();
    acc += Number(now - last) / 1e9; last = now;
    if (acc > 0.25) acc = 0.25;
    while (acc >= TICK) {
      acc -= TICK;
      const inputs = [];
      for (const c of room.clients) inputs[c.slot] = c.edges.take();
      room.match.step(TICK, inputs);
      room.tick++;
      if (room.tick % SNAP_EVERY === 0) {
        const snap = JSON.stringify({ t: 's', ...room.match.snapshot() });
        for (const c of room.clients) if (c.ws.readyState === 1) c.ws.send(snap);
      }
    }
    if (room.match.phase === 'fulltime' && room.match.phaseT > 8) stopMatch(room);
  }, 8);
}

function stopMatch(room) {
  clearInterval(room.loop); room.loop = null; room.match = null;
  broadcastRoom(room);
}

function leave(client) {
  const room = client.room;
  if (!room) return;
  room.clients = room.clients.filter((c) => c !== client);
  // Un joueur parti est remplacé par l'IA.
  if (room.match) room.match.removeHuman(client.slot);
  client.room = null;
  if (room.clients.length === 0) { if (room.loop) clearInterval(room.loop); rooms.delete(room.code); return; }
  if (room.host === client) room.host = room.clients[0];
  broadcastRoom(room);
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
wss.on('connection', (ws) => {
  const client = { ws, name: 'Joueur', room: null, slot: -1, team: 0, edges: new EdgeTracker(), alive: true };
  ws.on('pong', () => { client.alive = true; });
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'in') {
      if (client.room?.match) client.edges.feed(clamp1(m.mx), clamp1(m.mz), (m.h | 0) & 63);
      return;
    }
    if (m.t === 'ping') { send(ws, { t: 'pong', c: m.c }); return; }
    if (m.t === 'create' || m.t === 'join') {
      leave(client);
      client.name = String(m.name || 'Joueur').slice(0, 16);
      let room;
      if (m.t === 'create') {
        room = { code: makeCode(), clients: [], host: client, match: null, loop: null, halfLength: [60, 120, 180, 300].includes(m.halfLength) ? m.halfLength : 180, teams: Array.isArray(m.teams) ? m.teams.slice(0, 2).map((x) => x | 0) : [0, 1] };
        rooms.set(room.code, room);
      } else {
        room = rooms.get(String(m.code || '').toUpperCase().trim());
        if (!room) { send(ws, { t: 'err', msg: 'Salle introuvable.' }); return; }
        if (room.clients.length >= MAX_PLAYERS) { send(ws, { t: 'err', msg: 'La salle est pleine.' }); return; }
      }
      const used = new Set(room.clients.map((c) => c.slot));
      client.slot = [0, 1, 2, 3].find((s) => !used.has(s));
      const counts = [0, 0]; for (const c of room.clients) counts[c.team]++;
      client.team = counts[0] <= counts[1] ? 0 : 1;
      client.room = room;
      room.clients.push(client);
      if (room.match) { room.match.addHuman(client.slot, client.team); client.edges = new EdgeTracker(); send(ws, { t: 'start', teams: room.teams }); }
      broadcastRoom(room);
      return;
    }
    const room = client.room;
    if (!room) return;
    if (m.t === 'team' && !room.match) { client.team = 1 - client.team; broadcastRoom(room); }
    else if (m.t === 'start' && room.host === client && !room.match) startMatch(room);
    else if (m.t === 'leave') { leave(client); send(ws, { t: 'left' }); }
  });
  ws.on('close', () => leave(client));
});
const clamp1 = (v) => Math.max(-1, Math.min(1, Number(v) || 0));

// Détection des connexions mortes.
setInterval(() => {
  for (const ws of wss.clients) {
    const c = [...rooms.values()].flatMap((r) => r.clients).find((x) => x.ws === ws);
    if (c && !c.alive) { ws.terminate(); continue; }
    if (c) c.alive = false;
    ws.ping();
  }
}, 15000);

server.listen(PORT, () => {
  console.log(`Foot Libre prêt : http://localhost:${PORT}`);
});
