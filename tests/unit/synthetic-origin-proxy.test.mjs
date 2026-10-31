import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { createOriginProxy } from '../../synthetic/browser-origin-proxy.mjs';

// Chrome may reset a denied speculative CONNECT socket while the proxy is
// replying. A transport rejection must never crash the smoke's cleanup path.
test('origin proxy survives reset denied CONNECT sockets', async () => {
  const proxy = await createOriginProxy('http://127.0.0.1:4173');
  try {
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => {
        const socket = createConnection({ host: '127.0.0.1', port: Number(new URL(proxy.url).port) }, () => {
          socket.write('CONNECT 127.0.0.1:49999 HTTP/1.1\r\nHost: 127.0.0.1:49999\r\n\r\n');
        });
        socket.on('data', () => socket.resetAndDestroy());
        socket.on('error', () => {});
        socket.on('close', resolve);
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(proxy.denied, 30);
  } finally { await proxy.close(); }
});
