// Minimal Chrome DevTools Protocol client (Node 22+: global fetch + WebSocket). Works for both
// the renderer (--remote-debugging-port) and the Electron main process (--inspect).
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitForTarget(port, pick, timeoutMs = 30000, everyMs = 8) {
  const end = performance.now() + timeoutMs;
  while (performance.now() < end) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const t = list.find(pick);
      if (t) return t;
    } catch {}
    await sleep(everyMs);
  }
  throw new Error(`no debug target on :${port} within ${timeoutMs} ms`);
}

export class CDP {
  static async connect(wsUrl) {
    const c = new CDP();
    c.ws = new WebSocket(wsUrl);
    c.seq = 0;
    c.pending = new Map();
    c.listeners = new Map();
    c.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && c.pending.has(m.id)) {
        const { resolve, reject } = c.pending.get(m.id);
        c.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      } else if (m.method && c.listeners.has(m.method)) c.listeners.get(m.method)(m.params);
    };
    await new Promise((res, rej) => { c.ws.onopen = res; c.ws.onerror = () => rej(new Error('ws error')); });
    return c;
  }
  on(method, fn) { this.listeners.set(method, fn); }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  /** Evaluate an expression (may be async); returns its JSON value. */
  async eval(expression, { commandLineAPI = false } = {}) {
    const r = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, includeCommandLineAPI: commandLineAPI,
    });
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch {} }
}
