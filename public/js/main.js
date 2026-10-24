// Point d'entrée : menus, boucle de jeu, modes solo / 2 joueurs / en ligne.
import { Match, EdgeTracker, PITCH, TEAM_SIZE } from '../shared/sim.js';
import { Renderer, interpolateView } from './render.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { Net, P2PHost, P2PGuest, defaultServerUrl } from './net.js';

const TEAMS = [
  { name: 'AZUR FC', shirt: 0x1f5fd6, shorts: 0xffffff, socks: 0x1f5fd6, number: 0xffffff, gk: 0x2bd96b },
  { name: 'RUBIS UNITED', shirt: 0xd62839, shorts: 0xffffff, socks: 0xd62839, number: 0xffffff, gk: 0xffc400 },
  { name: 'ÉMERAUDE SC', shirt: 0x13a35a, shorts: 0x0b2a1b, socks: 0x13a35a, number: 0xffffff, gk: 0xff7a00 },
  { name: 'OR OLYMPIQUE', shirt: 0xf2c230, shorts: 0x1a1a1a, socks: 0xf2c230, number: 0x111111, gk: 0x7b3ff2 },
  { name: 'NUIT ATHLETIC', shirt: 0x1b1e3a, shorts: 0x1b1e3a, socks: 0xff3d81, number: 0xff3d81, gk: 0x40e0ff },
  { name: 'NEIGE CITY', shirt: 0xf4f6fa, shorts: 0x16264d, socks: 0xf4f6fa, number: 0x16264d, gk: 0xff4040 },
  { name: 'VIOLET RACING', shirt: 0x7a2bd9, shorts: 0xffffff, socks: 0x7a2bd9, number: 0xffffff, gk: 0xc6ff3d },
  { name: 'CORAIL FC', shirt: 0xff6b4a, shorts: 0x13314d, socks: 0xff6b4a, number: 0x13314d, gk: 0x2ee6ff },
];
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

// ---------- Réglages (mémorisés dans le navigateur quand c'est possible) ----------
const CYCLES = {
  difficulty: { values: [0, 1, 2], label: (v) => 'Difficulté : ' + ['Facile', 'Normale', 'Difficile'][v] },
  halfLength: { values: [60, 120, 180, 300], label: (v) => 'Durée d\'une mi-temps : ' + v / 60 + ' min' },
  quality: { values: ['low', 'medium', 'high'], label: (v) => 'Graphismes : ' + { low: 'Rapides', medium: 'Équilibrés', high: 'Beaux' }[v] },
  volume: { values: [0, 0.3, 0.5, 0.7, 1], label: (v) => 'Volume : ' + Math.round(v * 100) + ' %' },
};
const settings = { difficulty: 1, halfLength: 180, quality: 'high', volume: 0.7, name: '', server: '', teams: [0, 1] };
try { Object.assign(settings, JSON.parse(localStorage.getItem('footlibre') || '{}')); } catch { /* stockage indisponible */ }
const save = () => { try { localStorage.setItem('footlibre', JSON.stringify(settings)); } catch { /* ignoré */ } };

// ---------- Éléments ----------
const $ = (s) => document.querySelector(s);
const overlay = $('#overlay'), hud = $('#hud');
const input = new Input(document.body);
const sound = new Sound();
sound.setVolume(settings.volume);
let renderer = null;
let rendererQuality = null;
function ensureRenderer() {
  if (renderer && rendererQuality === settings.quality) return renderer;
  if (renderer) { renderer.r.dispose(); renderer.r.domElement.remove(); }
  renderer = new Renderer($('#game'), { quality: settings.quality });
  rendererQuality = settings.quality;
  return renderer;
}

// ---------- Navigation entre écrans ----------
let current = 'menu';
const history = [];
function show(name, push = true) {
  if (push && current !== name) history.push(current);
  current = name;
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'scr-' + name));
  overlay.classList.remove('hidden');
  overlay.classList.toggle('ingame', !!game);
  refreshCycles();
  if (name === 'quick') refreshPicks();
  const first = focusables()[0];
  if (first && !(first.tagName === 'INPUT' && matchMedia('(pointer: coarse)').matches)) first.focus({ preventScroll: true });
}
function hideOverlay() { overlay.classList.add('hidden'); document.activeElement?.blur(); }
function back() {
  if (current === 'pause') { resume(); return; }
  if (current === 'lobby') { leaveRoom(); return; }
  const prev = history.pop() || 'menu';
  show(prev, false);
}
function focusables() {
  const scr = document.querySelector('.screen.active');
  return scr ? [...scr.querySelectorAll('button:not(:disabled), input')].filter((e) => e.offsetParent !== null) : [];
}
function moveFocus(d) {
  const f = focusables(); if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  f[(i + d + f.length) % f.length].focus();
  sound.click();
}
function refreshCycles() {
  document.querySelectorAll('[data-cycle]').forEach((b) => { const c = CYCLES[b.dataset.cycle]; b.textContent = c.label(settings[b.dataset.cycle]) + '  ◀ ▶'; });
}
function cycle(key, d = 1) {
  const c = CYCLES[key], i = c.values.indexOf(settings[key]);
  settings[key] = c.values[(i + d + c.values.length) % c.values.length];
  if (key === 'volume') sound.setVolume(settings.volume);
  save(); refreshCycles(); sound.click();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  sound.init();
  if (b.dataset.go) { if (b.dataset.go === 'quick') quickMode = 'solo'; if (b.dataset.go === 'local') { quickMode = 'local'; show('quick'); return; } show(b.dataset.go); }
  else if (b.dataset.back !== undefined) back();
  else if (b.dataset.cycle) cycle(b.dataset.cycle);
  else if (b.dataset.pick) pickTeam(+b.dataset.pick, +b.dataset.d);
});

// ---------- Choix des équipes ----------
let quickMode = 'solo';
function pickTeam(i, d) {
  let v = settings.teams[i];
  do { v = (v + d + TEAMS.length) % TEAMS.length; } while (v === settings.teams[1 - i]);
  settings.teams[i] = v; save(); refreshPicks(); sound.click();
}
function refreshPicks() {
  $('#quick-title').textContent = quickMode === 'solo' ? 'Match rapide' : '2 joueurs (même PC)';
  $('#pick0-label').textContent = quickMode === 'solo' ? 'Ton équipe' : 'Joueur 1';
  $('#pick1-label').textContent = quickMode === 'solo' ? 'Adversaire (IA)' : 'Joueur 2';
  $('#opt-diff').classList.toggle('hidden', quickMode !== 'solo');
  for (const i of [0, 1]) {
    const t = TEAMS[settings.teams[i]], el = $('#pick' + i);
    el.querySelector('.kit').style.background = `linear-gradient(90deg, ${hex(t.shirt)} 0 70%, ${hex(t.socks)} 70% 100%)`;
    el.querySelector('.kit').style.setProperty('--shorts', hex(t.shorts));
    el.querySelector('b').textContent = t.name;
  }
  const pads = input.pads().length;
  $('#quick-note').textContent = quickMode === 'local'
    ? (pads >= 1 ? 'Joueur 1 : clavier/souris. Joueur 2 : manette.' : 'Pas de manette : joueur 1 joue avec ZQSD/WASD + J K L I, joueur 2 avec les flèches + pavé numérique (1 passe, 2 tir, 3 lob, 5 profondeur, 0 changer).')
    : 'Joue au clavier/souris ou à la manette, comme tu veux.';
}

// ---------- Partie ----------
let game = null;
const FIXED = 1 / 60;

function startLocal(mode) {
  sound.init();
  const r = ensureRenderer();
  const kits = settings.teams.map((i) => TEAMS[i]);
  r.setTeams(kits);
  const match = new Match({ halfLength: settings.halfLength, difficulty: settings.difficulty, teamNames: kits.map((k) => k.name) });
  match.addHuman(0, 0);
  if (mode === 'local') match.addHuman(1, 1);
  game = { mode, match, kits, trackers: [new EdgeTracker(), new EdgeTracker()], acc: 0, paused: false, localSlots: mode === 'local' ? [0, 1] : [0], endShown: 0 };
  for (const [i, tr] of game.trackers.entries()) tr.last = input.merged(sourcesFor(i)).held;
  beginMatchUi();
}

function sourcesFor(slot) {
  const pads = input.pads().map((p) => p.index);
  if (game.mode !== 'local') return ['kb', ...pads];
  if (pads.length === 0) return slot === 0 ? ['kbL'] : ['kbR'];
  return slot === 0 ? ['kb', ...pads.slice(1)] : [pads[0]];
}

function beginMatchUi() {
  hideOverlay();
  hud.classList.remove('hidden');
  $('#name0').textContent = game.kits[0].name;
  $('#name1').textContent = game.kits[1].name;
  document.querySelector('.team.t0 i').style.background = hex(game.kits[0].shirt === 0x1b1e3a ? game.kits[0].socks : game.kits[0].shirt);
  document.querySelector('.team.t1 i').style.background = hex(game.kits[1].shirt === 0x1b1e3a ? game.kits[1].socks : game.kits[1].shirt);
  const pads = input.pads().length;
  $('#hint').innerHTML = pads
    ? '<b>Manette :</b> A passe · X tir (maintenir) · B lob · Y profondeur · LB changer · RT sprint'
    : '<b>Clavier :</b> ZQSD/WASD bouger · J passe · K tir (maintenir) · L lob · I profondeur · Espace changer · Maj sprint · C caméra';
  $('#hint').style.opacity = 1;
  clearTimeout(game.hintTimer);
  game.hintTimer = setTimeout(() => { $('#hint').style.opacity = 0; }, 9000);
  $('#powers').innerHTML = game.localSlots.map((s) => `<div class="power" data-slot="${s}"><label><span>J${s + 1}</span><span class="pname"></span></label><div class="bar"><div class="fill"></div></div><div class="stam"><div></div></div></div>`).join('');
}

function pause() {
  if (!game) return;
  if (game.mode !== 'online') game.paused = true;
  show('pause');
}
function resume() { if (!game) return; game.paused = false; hideOverlay(); }
function quitGame() {
  if (game?.mode === 'online') { leaveRoom(); }
  game = null;
  hud.classList.add('hidden');
  history.length = 0;
  show('menu', false);
}

$('#btn-play').addEventListener('click', () => startLocal(quickMode));
$('#btn-resume').addEventListener('click', resume);
$('#btn-quit').addEventListener('click', quitGame);
$('#btn-menu').addEventListener('click', quitGame);
$('#btn-again').addEventListener('click', () => {
  if (game?.mode === 'online') { game = null; hud.classList.add('hidden'); show('lobby', false); renderLobby(); return; }
  startLocal(game ? game.mode : 'solo');
});

// ---------- En ligne ----------
let net = null, room = null;
$('#in-name').value = settings.name;
$('#in-server').value = settings.server;
// Avec le serveur Node (npm start), les salles passent par lui ; sinon (page web statique), en pair à pair.
let useServer = false;
if (window.FOOT_STATIC) {
  $('#online-status').textContent = 'Cette démo ne permet pas le jeu en ligne. Utilise la version web du jeu (lien dans le README).';
  $('#btn-create').disabled = true; $('#btn-join').disabled = true;
} else {
  fetch('health', { cache: 'no-store' }).then((r) => r.ok && r.text()).then((t) => { useServer = t === 'ok'; }).catch(() => {});
}

function connect(then, mode, code) {
  settings.name = $('#in-name').value.trim() || 'Joueur';
  settings.server = $('#in-server').value.trim();
  save();
  const server = useServer || !!settings.server;
  if (server && net?.open && net instanceof Net) { then(); return; }
  net?.close();
  room = null;
  $('#online-status').textContent = mode === 'create' && !server ? 'Création de la salle…' : 'Connexion…';
  const handlers = {
    open: then,
    message: onNet,
    close: () => {
      $('#online-status').textContent = server ? 'Déconnecté du serveur.' : 'L\'hôte a quitté la partie.';
      if (room) { room = null; if (game?.mode === 'online') { game = null; hud.classList.add('hidden'); } show('online', false); toast('Connexion perdue'); }
    },
    error: () => { $('#online-status').textContent = server ? 'Impossible de joindre le serveur. Vérifie l\'adresse ou lance « npm start ».' : 'Impossible de créer la salle. Vérifie ta connexion Internet.'; },
  };
  try {
    if (server) net = new Net(defaultServerUrl(settings.server), handlers);
    else net = mode === 'create' ? new P2PHost(handlers) : new P2PGuest(code, handlers);
  } catch { $('#online-status').textContent = 'Adresse de serveur invalide.'; }
}
$('#btn-create').addEventListener('click', () => connect(() => net.send({ t: 'create', name: settings.name, halfLength: settings.halfLength, teams: settings.teams }), 'create'));
$('#btn-join').addEventListener('click', () => {
  const code = $('#in-code').value.trim().toUpperCase();
  if (code.length < 4) { $('#online-status').textContent = 'Entre le code de la salle.'; return; }
  connect(() => net.send({ t: 'join', name: settings.name, code }), 'join', code);
});
$('#in-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-join').click(); });
$('#btn-team').addEventListener('click', () => net?.send({ t: 'team' }));
$('#btn-start').addEventListener('click', () => net?.send({ t: 'start' }));
$('#btn-leave').addEventListener('click', leaveRoom);
function leaveRoom() {
  if (net instanceof Net) net.send({ t: 'leave' });
  else { net?.close(); net = null; }
  room = null; show('online', false);
}

function onNet(m) {
  if (m.t === 'err') { $('#online-status').textContent = m.msg; return; }
  if (m.t === 'room') {
    const first = !room;
    room = m;
    if (!game && (first || current === 'lobby' || current === 'end')) { if (current !== 'end') show('lobby', current !== 'lobby'); }
    renderLobby();
    return;
  }
  if (m.t === 'start') {
    const r = ensureRenderer();
    const kits = m.teams.map((i) => TEAMS[i] ?? TEAMS[0]);
    r.setTeams(kits);
    game = { mode: 'online', kits, snaps: [], localSlots: [room.you], lastSend: 0, lastHeld: -1, endShown: 0 };
    beginMatchUi();
    return;
  }
  if (m.t === 's' && game?.mode === 'online') {
    game.snaps.push({ at: performance.now(), s: m });
    if (game.snaps.length > 30) game.snaps.shift();
    sound.handle(m.e);
  }
}
function renderLobby() {
  if (!room) return;
  $('#lobby-code').textContent = room.code;
  for (const t of [0, 1]) {
    const k = TEAMS[room.teams[t]] ?? TEAMS[t];
    $('#lobby-t' + t).textContent = k.name;
    $('#lobby-t' + t).parentElement.style.setProperty('--c', hex(k.shirt));
    $('#lobby-l' + t).innerHTML = room.players.filter((p) => p.team === t).map((p) => `<li class="${p.slot === room.you ? 'me' : ''}">${escapeHtml(p.name)}${p.slot === room.you ? ' (toi)' : ''}</li>`).join('') || '<li style="opacity:.5">IA uniquement</li>';
  }
  $('#btn-start').disabled = !room.host || room.started;
  $('#lobby-note').textContent = room.started ? 'Match en cours…' : room.host ? 'Tu es l\'hôte : lance le match quand tout le monde est prêt. Les places vides sont jouées par l\'IA.' : 'En attente du lancement par l\'hôte…';
}
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Actions d'interface ----------
let lastToast = 0;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(lastToast); lastToast = setTimeout(() => el.classList.remove('show'), 1600); }
input.onAction = (a) => {
  const menuOpen = !overlay.classList.contains('hidden');
  if (a === 'padconnected' || a === 'paddisconnected') {
    updatePadStatus();
    if (current === 'quick') refreshPicks();
    if (game) toast(a === 'padconnected' ? 'Manette connectée' : 'Manette déconnectée');
    return;
  }
  if (a === 'pause') { if (!game) { if (menuOpen && current !== 'menu') back(); return; } if (menuOpen && current === 'pause') resume(); else if (!menuOpen) pause(); return; }
  if (a === 'camera' && game && !menuOpen) { toast('Caméra : ' + renderer.cycleCamera()); return; }
  if (!menuOpen) return;
  const el = document.activeElement;
  if (a === 'up') moveFocus(-1);
  else if (a === 'down') moveFocus(1);
  else if ((a === 'left' || a === 'right') && el?.dataset?.cycle) cycle(el.dataset.cycle, a === 'left' ? -1 : 1);
  else if ((a === 'left' || a === 'right') && current === 'quick') {
    const row = el?.closest('.teampick');
    pickTeam(row?.id === 'pick1' ? 1 : 0, a === 'left' ? -1 : 1);
  }
  else if (a === 'padconfirm') { sound.init(); if (el && el.tagName === 'BUTTON') el.click(); else if (!el || el === document.body) focusables()[0]?.focus(); }
  else if (a === 'back') back();
};
function updatePadStatus() {
  const pads = input.pads();
  $('#padstatus').textContent = pads.length ? `🎮 ${pads.length} manette${pads.length > 1 ? 's' : ''} détectée${pads.length > 1 ? 's' : ''}` : 'Branche une manette et appuie sur un bouton pour l\'utiliser.';
}
updatePadStatus();

// ---------- HUD ----------
const mm = $('#minimap'), mctx = mm.getContext('2d');
let lastMsg = '';
function updateHud(v) {
  $('#score').textContent = `${v.s[0]} - ${v.s[1]}`;
  const minute = Math.min(45, Math.floor((v.c / v.hl) * 45)) + (v.h === 2 ? 45 : 0);
  $('#clock').textContent = minute + '\'';
  const msg = $('#message');
  if (v.m !== lastMsg) {
    lastMsg = v.m;
    msg.textContent = v.m;
    msg.classList.toggle('show', !!v.m);
    msg.classList.toggle('goal', v.m === 'BUT !');
  }
  for (const el of document.querySelectorAll('.power')) {
    const h = v.hu[+el.dataset.slot];
    if (!h) continue;
    el.querySelector('.fill').style.width = (h[2] * 100).toFixed(0) + '%';
    const p = v.p[h[1]];
    if (p) { el.querySelector('.stam div').style.width = (p[5] * 100).toFixed(0) + '%'; el.querySelector('.pname').textContent = 'n°' + ((h[1] % TEAM_SIZE) + 1); }
  }
  // Mini-carte.
  const W = mm.width, H = mm.height, sx = W / (PITCH.L + 6), sz = H / (PITCH.W + 6);
  const X = (x) => (x + PITCH.L / 2 + 3) * sx, Z = (z) => (z + PITCH.W / 2 + 3) * sz;
  mctx.clearRect(0, 0, W, H);
  mctx.strokeStyle = 'rgba(255,255,255,0.5)'; mctx.lineWidth = 1;
  mctx.strokeRect(X(-PITCH.L / 2), Z(-PITCH.W / 2), PITCH.L * sx, PITCH.W * sz);
  mctx.beginPath(); mctx.moveTo(X(0), Z(-PITCH.W / 2)); mctx.lineTo(X(0), Z(PITCH.W / 2)); mctx.stroke();
  mctx.beginPath(); mctx.arc(X(0), Z(0), 9.15 * sx, 0, Math.PI * 2); mctx.stroke();
  for (const s of [-1, 1]) mctx.strokeRect(X(s > 0 ? PITCH.L / 2 - 16.5 : -PITCH.L / 2), Z(-20.16), 16.5 * sx, 40.32 * sz);
  const ctl = new Set(v.hu.filter(Boolean).map((h) => h[1]));
  v.p.forEach((p, i) => {
    const k = game.kits[i < TEAM_SIZE ? 0 : 1];
    mctx.fillStyle = hex(k.shirt === 0x1b1e3a ? k.socks : k.shirt);
    mctx.beginPath(); mctx.arc(X(p[0]), Z(p[1]), ctl.has(i) ? 4 : 3, 0, Math.PI * 2); mctx.fill();
    if (ctl.has(i)) { mctx.strokeStyle = '#fff'; mctx.lineWidth = 1.5; mctx.stroke(); }
  });
  mctx.fillStyle = '#fff'; mctx.beginPath(); mctx.arc(X(v.b[0]), Z(v.b[2]), 2.5, 0, Math.PI * 2); mctx.fill();
  $('#netinfo').textContent = game.mode === 'online' && net ? `Ping ${net.ping} ms` : '';
}

function showEnd(v) {
  const [a, b] = v.s;
  const win = a === b ? 'Match nul' : `Victoire de ${game.kits[a > b ? 0 : 1].name}`;
  $('#final').innerHTML = `${game.kits[0].name} ${a} - ${b} ${game.kits[1].name}<small>${win}</small>`;
  $('#btn-again').textContent = game.mode === 'online' ? 'Retour à la salle' : 'Rejouer';
  show('end', false);
}

// ---------- Boucle ----------
let lastT = performance.now();
let view = null;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  input.pollUi();
  if (!game) { if (renderer && view) renderer.render(view, dt, now / 1000); return; }

  if (game.mode !== 'online') {
    for (const s of game.localSlots) { const i = input.merged(sourcesFor(s)); game.trackers[s].feed(i.mx, i.mz, i.held); }
    if (!game.paused) {
      game.acc += dt;
      let steps = 0;
      while (game.acc >= FIXED && steps < 6) {
        const inputs = game.localSlots.map((s) => game.trackers[s].take());
        game.match.step(FIXED, inputs);
        game.acc -= FIXED; steps++;
      }
    }
    view = game.match.snapshot();
    sound.handle(view.e);
  } else {
    const i = input.merged(['kb', ...input.pads().map((p) => p.index)]);
    if (i.held !== game.lastHeld || now - game.lastSend > 33 || Math.abs(i.mx - (game.lastMx ?? 0)) + Math.abs(i.mz - (game.lastMz ?? 0)) > 0.05) {
      net?.send({ t: 'in', mx: +i.mx.toFixed(2), mz: +i.mz.toFixed(2), h: i.held });
      game.lastHeld = i.held; game.lastSend = now; game.lastMx = i.mx; game.lastMz = i.mz;
    }
    // Interpolation avec ~100 ms de retard pour lisser le réseau.
    const rt = now - 100, sn = game.snaps;
    if (!sn.length) return;
    let a = sn[0], b = sn[sn.length - 1];
    for (let k = 0; k < sn.length - 1; k++) if (sn[k].at <= rt && sn[k + 1].at >= rt) { a = sn[k]; b = sn[k + 1]; break; }
    const t = b.at === a.at ? 1 : Math.max(0, Math.min(1, (rt - a.at) / (b.at - a.at)));
    view = interpolateView(a.s, b.s, t);
  }
  view.localSlots = game.localSlots;
  // Ambiance : la foule s'emballe près des buts.
  sound.setCrowd(Math.min(1, Math.max(0, (Math.abs(view.b[0]) - 20) / 32)) * 0.8 + (view.ph === 'goal' ? 0.6 : 0));
  renderer.render(view, dt, now / 1000);
  updateHud(view);
  if (view.ph === 'fulltime') {
    if (!game.endShown) game.endShown = now;
    else if (now - game.endShown > 3500 && current !== 'end' && overlay.classList.contains('hidden')) showEnd(view);
  }
}
requestAnimationFrame(frame);
show('menu', false);
