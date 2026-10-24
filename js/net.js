import { RoomManager, randomCode } from '../shared/rooms.js';
// Client WebSocket du mode en ligne.
export class Net {
  constructor(url, handlers) {
    this.handlers = handlers;
    this.ws = new WebSocket(url);
    this.ping = 0;
    this.ws.onopen = () => {
      handlers.open?.();
      this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
    };
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'pong') { this.ping = Math.round(performance.now() - m.c); return; }
      handlers.message?.(m);
    };
    this.ws.onclose = () => { clearInterval(this.pingTimer); handlers.close?.(); };
    this.ws.onerror = () => handlers.error?.();
  }
  get open() { return this.ws.readyState === 1; }
  send(m) { if (this.open) this.ws.send(JSON.stringify(m)); }
  close() { this.handlers = {}; clearInterval(this.pingTimer); this.ws.close(); }
}

export function defaultServerUrl(custom) {
  if (custom) {
    let u = custom.trim();
    if (!/^wss?:\/\//.test(u)) u = (u.startsWith('localhost') || /^\d/.test(u) ? 'ws://' : 'wss://') + u;
    return u.replace(/\/$/, '') + (u.endsWith('/ws') ? '' : '/ws');
  }
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  return proto + location.host + '/ws';
}

// ---------- Mode pair à pair (sans serveur de jeu) ----------
// Le navigateur qui crée la salle fait tourner la simulation ; les autres s'y connectent en WebRTC.
// PeerJS et son serveur public ne servent qu'à la mise en relation.

const PEER_PREFIX = 'footlibre-v1-';
let peerJsPromise = null;
function loadPeerJs() {
  if (window.Peer) return Promise.resolve();
  peerJsPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/peerjs.min.js', import.meta.url).href;
    s.onload = resolve;
    s.onerror = () => { peerJsPromise = null; reject(new Error('PeerJS')); };
    document.head.appendChild(s);
  });
  return peerJsPromise;
}

export class P2PHost {
  constructor(handlers) {
    this.handlers = handlers;
    this.ping = 0;
    this.ready = false;
    this.code = randomCode();
    this.mgr = new RoomManager({ makeCode: () => this.code });
    // Le joueur hôte est un client local de sa propre salle.
    this.local = this.mgr.connect({
      send: (t) => queueMicrotask(() => { const m = JSON.parse(t); if (m.t !== 'pong') this.handlers.message?.(m); }),
      open: () => true,
    });
    loadPeerJs().then(() => this.listen()).catch(() => handlers.error?.());
  }

  listen(tries = 0) {
    this.peer = new window.Peer(PEER_PREFIX + this.code);
    this.peer.on('open', () => { this.ready = true; this.handlers.open?.(); });
    this.peer.on('connection', (conn) => {
      const c = this.mgr.connect({ send: (t) => conn.send(t), open: () => conn.open });
      conn.on('data', (d) => this.mgr.message(c, String(d)));
      conn.on('close', () => this.mgr.leave(c));
      conn.on('error', () => this.mgr.leave(c));
    });
    this.peer.on('disconnected', () => { if (!this.peer.destroyed) this.peer.reconnect(); });
    this.peer.on('error', (e) => {
      if (e.type === 'unavailable-id' && tries < 3) { this.peer.destroy(); this.code = randomCode(); this.listen(tries + 1); return; }
      if (!this.ready) this.handlers.error?.(e);
    });
  }

  get open() { return this.ready; }
  send(m) { this.mgr.message(this.local, m); }
  close() { this.handlers = {}; this.mgr.leave(this.local); this.peer?.destroy(); }
}

export class P2PGuest {
  constructor(code, handlers) {
    this.handlers = handlers;
    this.ping = 0;
    this.conn = null;
    const fail = (msg) => { clearTimeout(this.timer); this.handlers.message?.({ t: 'err', msg }); };
    this.timer = setTimeout(() => { if (!this.conn?.open) { fail('La connexion à la salle a échoué. Vérifie le code, ou essayez sur un autre réseau.'); this.peer?.destroy(); } }, 15000);
    loadPeerJs().then(() => {
      this.peer = new window.Peer();
      this.peer.on('open', () => {
        this.conn = this.peer.connect(PEER_PREFIX + code.toUpperCase(), { reliable: true, serialization: 'raw' });
        this.conn.on('open', () => {
          clearTimeout(this.timer);
          this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
          this.handlers.open?.();
        });
        this.conn.on('data', (d) => {
          const m = JSON.parse(String(d));
          if (m.t === 'pong') { this.ping = Math.round(performance.now() - m.c); return; }
          this.handlers.message?.(m);
        });
        this.conn.on('close', () => { clearInterval(this.pingTimer); this.handlers.close?.(); });
      });
      this.peer.on('error', (e) => {
        if (e.type === 'peer-unavailable') fail('Salle introuvable. Vérifie le code.');
        else if (!this.conn?.open) fail('Impossible de se connecter. Vérifie ta connexion Internet.');
      });
    }).catch(() => fail('Impossible de charger le module réseau. Vérifie ta connexion Internet.'));
  }

  get open() { return !!this.conn?.open; }
  send(m) { if (this.open) this.conn.send(JSON.stringify(m)); }
  close() { this.handlers = {}; clearTimeout(this.timer); clearInterval(this.pingTimer); this.peer?.destroy(); }
}
