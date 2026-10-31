import { createServer, request } from 'node:http';

/** Browser-wide transport boundary, installed before Chrome is spawned.
 * All targets (including popups/workers) share Chrome's fixed proxy. There is
 * no DIRECT fallback or implicit loopback bypass. Tunnels and all WebSockets
 * are deliberately unsupported: the production-build smoke needs only HTTP.
 */
export async function createOriginProxy(origin) {
  const target = new URL(origin);
  const sockets = new Set();
  const upstream = new Set();
  let denied = 0;
  const server = createServer((req, res) => {
    let url;
    try { url = new URL(req.url); } catch { /* reject non-proxy request */ }
    if (!url || url.origin !== origin || url.username || url.password || url.hash) {
      denied++;
      res.writeHead(403).end('synthetic origin boundary');
      return;
    }
    const headers = { ...req.headers, host: target.host };
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];
    const outgoing = request({
      hostname: target.hostname, port: target.port, method: req.method,
      path: url.pathname + url.search, headers,
    }, (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.add(outgoing);
    outgoing.on('close', () => upstream.delete(outgoing));
    outgoing.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    res.on('close', () => outgoing.destroy());
    outgoing.setTimeout(5_000, () => outgoing.destroy());
    req.pipe(outgoing);
  });
  server.on('connection', (socket) => {
    // A denied browser CONNECT can be reset while its 403 is in flight.
    socket.on('error', () => socket.destroy());
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  const rejectTunnel = (_req, socket) => {
    denied++;
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  };
  server.on('connect', rejectTunnel);
  server.on('upgrade', rejectTunnel);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    get denied() { return denied; },
    async close() {
      for (const req of upstream) req.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
