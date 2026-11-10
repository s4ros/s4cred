const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { domain, examples, command, listen, close, unusedPort, request, waitForProxy, configure, certificate } = require('./fixtures.cjs');

const maxBody = 1_400_000;

// Traefik rejects from Content-Length and resets a socket that still holds the
// unread body, which hides the 413 if the body is written immediately.
// Expect: 100-continue lets that status arrive before the body is sent.
function limitedFileRequest(port, ca, body) {
  return new Promise((resolve, reject) => {
    let status;
    let settled = false;
    const chunks = [];
    const finish = (err) => {
      if (settled) return;
      settled = true;
      if (err && !status) reject(err);
      else resolve({ status, body: Buffer.concat(chunks).toString() });
    };
    const req = https.request({
      host: '127.0.0.1', port, servername: domain, ca,
      path: '/api/files', method: 'POST', agent: false,
      headers: {
        Host: domain,
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        Expect: '100-continue',
      },
    }, (res) => {
      status = res.statusCode;
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => finish());
      res.on('error', (err) => finish(err));
    });
    req.setTimeout(10_000, () => finish(new Error('HTTPS request timed out')));
    req.on('error', (err) => finish(err));
    let sent = false;
    req.on('continue', () => {
      if (sent || status) return;
      sent = true;
      req.end(body);
    });
    req.flushHeaders();
  });
}

for (const example of examples) {
  test(`${example.name}: HTTPS proxy integration`, { timeout: 240_000 }, async (t) => {
    // The random name and directory are owned by this test only. Remove a
    // container only after Docker has returned the ID of our successful create.
    const name = `s4cred-proxy-test-${randomUUID()}`;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 's4cred-proxy-test-'));
    let container;
    let upstream;
    let upstreamListening = false;
    const seen = [];
    const secrets = {
      path: `path-${randomUUID()}`,
      referer: `referer-${randomUUID()}`,
      token: `token-${randomUUID()}`,
      idempotency: `idempotency-${randomUUID()}`,
    };
    try {
      const ca = await certificate(dir);

      upstream = http.createServer((req, res) => {
        const entry = { url: req.url, headers: req.headers, bytes: 0 };
        const body = [];
        seen.push(entry);
        req.on('data', (chunk) => {
          entry.bytes += chunk.length;
          if (req.url === '/api/notes/fail-consume/consume') body.push(chunk);
        });
        req.on('end', () => {
          if (req.url === '/api/notes/fail-consume/consume') {
            entry.body = Buffer.concat(body).toString();
            req.socket.destroy();
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(req.method === 'GET' ? 'mock upstream' : String(entry.bytes));
        });
      });
      const upstreamPort = await listen(upstream);
      upstreamListening = true;
      const proxyPort = await unusedPort();
      const args = await configure(example, dir, upstreamPort, proxyPort);
      const created = await command('docker', [
        'create', '--name', name, '--network', 'host',
        '--mount', `type=bind,src=${dir},dst=/fixtures,readonly`, ...args,
      ]);
      const createdId = created.stdout.trim();
      assert.match(createdId, /^[0-9a-f]{64}$/);
      container = createdId;
      await command('docker', ['start', container]);
      await waitForProxy(proxyPort, ca, container);

      const page = await request(proxyPort, ca, {
        url: `/n/${secrets.path}`,
        headers: {
          Referer: `https://referer.invalid/${secrets.referer}`,
          Forwarded: 'for=192.0.2.254;proto=http;host=attacker.invalid',
          'X-Forwarded-For': '192.0.2.254',
          'X-Forwarded-Proto': 'http',
          'X-Forwarded-Host': 'attacker.invalid',
        },
      });
      assert.equal(page.status, 200);
      assert.equal(page.body, 'mock upstream');
      assert.match(page.headers['strict-transport-security'], /max-age=31536000/);
      const pageRequest = seen.find((entry) => entry.url === `/n/${secrets.path}`);
      assert.ok(pageRequest, 'HTTPS request reached the mock upstream');
      assert.equal(pageRequest.headers.forwarded, undefined);
      assert.equal(pageRequest.headers['x-forwarded-for'], '127.0.0.1');
      assert.equal(pageRequest.headers['x-forwarded-proto'], 'https');
      assert.equal(pageRequest.headers['x-forwarded-host'], domain);

      const exact = await request(proxyPort, ca, { url: '/api/notes', body: Buffer.alloc(maxBody, 120) });
      assert.equal(exact.status, 200, 'body exactly at the limit is allowed');
      assert.equal(exact.body, String(maxBody), 'the complete body reached the upstream');
      const oversized = await request(proxyPort, ca, { url: '/api/notes', body: Buffer.alloc(maxBody + 1, 120) });
      assert.equal(oversized.status, 413, 'body above the limit is rejected');
      assert.ok(!seen.some((entry) => entry.url === '/api/notes' && entry.bytes > maxBody), 'oversized body did not reach the upstream in full');

      const fileMax = 33_562_644;
      const fileExact = await request(proxyPort, ca, { url: '/api/files', body: Buffer.alloc(fileMax, 120) });
      assert.equal(fileExact.status, 200, 'file body exactly at the limit is allowed');
      assert.equal(fileExact.body, String(fileMax), 'the complete file body reached the upstream');
      const fileOversized = await limitedFileRequest(proxyPort, ca, Buffer.alloc(fileMax + 1, 120));
      assert.equal(fileOversized.status, 413, 'file body above the limit is rejected');
      assert.ok(!seen.some((entry) => entry.url === '/api/files' && entry.bytes > fileMax), 'oversized file body did not reach the upstream in full');

      let failed;
      try {
        failed = await request(proxyPort, ca, {
          url: '/api/notes/fail-consume/consume', body: JSON.stringify({ read_token: secrets.token }),
          headers: {
            'Idempotency-Key': secrets.idempotency,
            'X-Idempotency-Key': secrets.idempotency,
            Referer: `https://referer.invalid/${secrets.referer}`,
          },
        });
      } catch (err) {
        assert.ok(['ECONNRESET', 'EPIPE'].includes(err.code), `Unexpected failed-request error: ${err.message}`);
      }
      if (failed) assert.ok(failed.status >= 500, `Expected a failed upstream response, got ${failed.status}`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const attempts = seen.filter((entry) => entry.url === '/api/notes/fail-consume/consume');
      assert.equal(attempts.length, 1, 'a consume-like POST whose upstream drops the connection is not retried');
      assert.equal(JSON.parse(attempts[0].body).read_token, secrets.token);
      assert.equal(attempts[0].headers['idempotency-key'], undefined);
      assert.equal(attempts[0].headers['x-idempotency-key'], undefined);

      if (example.name !== 'caddy') {
        for (const [url, count] of [['/api/notes', 24], ['/api/notes/not-a-note/consume', 72]]) {
          const codes = [];
          for (let i = 1; i <= count; i++) {
            const response = await request(proxyPort, ca, {
              url, body: '{}', headers: { 'X-Forwarded-For': `192.0.2.${i}` },
            });
            codes.push(response.status);
          }
          assert.ok(codes.every((code) => code === 200 || code === 429), `${url}: unexpected status codes ${codes}`);
          assert.ok(codes.includes(200), `${url}: the limiter must allow some requests`);
          assert.ok(codes.includes(429), `${url}: changing untrusted X-Forwarded-For must not bypass the limit`);
        }
      } else {
        t.diagnostic('Caddy core example does not configure per-IP rate or connection limits; external controls are required.');
      }

      const logs = await command('docker', ['logs', container]);
      for (const [field, value] of Object.entries(secrets)) {
        assert.ok(!`${logs.stdout}${logs.stderr}`.includes(value), `container stdout/stderr must not contain the ${field} sentinel`);
      }
    } finally {
      try {
        if (container) await command('docker', ['rm', '-f', container]);
      } finally {
        try {
          if (upstreamListening) {
            upstream.closeAllConnections();
            await close(upstream);
          }
        } finally {
          await fs.rm(dir, { recursive: true, force: true });
        }
      }
    }
  });
}
