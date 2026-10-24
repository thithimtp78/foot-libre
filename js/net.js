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
