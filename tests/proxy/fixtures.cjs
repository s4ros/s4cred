const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const https = require('node:https');
const net = require('node:net');
const path = require('node:path');
const { promisify } = require('node:util');

const exec = promisify(execFile);
const root = path.resolve(__dirname, '../..');
const domain = 'notes.example.com';
const examples = [
  { name: 'nginx', image: 'nginx:1.29-alpine' },
  { name: 'traefik', image: 'traefik:v3.7' },
  { name: 'caddy', image: 'caddy:2.11' },
];

async function command(program, args) {
  return exec(program, args, { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
}

function replace(text, oldValue, newValue) {
  assert.ok(text.includes(oldValue), `Fixture no longer contains ${oldValue}`);
  return text.replaceAll(oldValue, newValue);
}

async function fixtureFile(dir, source, target, replacements) {
  let text = await fs.readFile(path.join(root, source), 'utf8');
  for (const [oldValue, newValue] of replacements) text = replace(text, oldValue, newValue);
  await fs.writeFile(path.join(dir, target), text);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}

// The proxy must bind this port itself, so release the reservation immediately
// before starting the container. A competing process can still win that race.
async function unusedPort() {
  const reservation = net.createServer();
  const port = await listen(reservation);
  await close(reservation);
  return port;
}

function request(port, ca, { url = '/', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      host: '127.0.0.1', port, servername: domain, ca,
      path: url, method: body === undefined ? 'GET' : 'POST',
      headers: { Host: domain, ...headers },
      agent: false,
    };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      res.on('error', reject);
    });
    req.setTimeout(10_000, () => req.destroy(new Error('HTTPS request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

async function waitForProxy(port, ca, container, accept = (response) => response.status === 200 && response.body === 'mock upstream', options = {}) {
  let lastError;
  for (let i = 0; i < 100; i++) {
    try {
      const response = await request(port, ca, options);
      if (accept(response)) return;
      lastError = new Error(`Unexpected startup response: ${response.status}`);
    } catch (err) {
      lastError = err;
    }
    const state = await command('docker', ['inspect', '--format', '{{.State.Running}}', container]);
    if (state.stdout.trim() !== 'true') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const logs = await command('docker', ['logs', container]);
  throw new Error(`Proxy did not become ready: ${lastError?.message}\n${logs.stdout}${logs.stderr}`);
}

async function configure(example, dir, upstreamPort, proxyPort) {
  const mountPath = ['/etc/s4cred', '/fixtures'];
  const upstream = ['127.0.0.1:8080', `127.0.0.1:${upstreamPort}`];
  const listener = ['127.0.0.1:443', `127.0.0.1:${proxyPort}`];
  if (example.name === 'nginx') {
    await fixtureFile(dir, 'deploy/nginx/nginx.conf', 'nginx.conf', [mountPath, listener]);
    await fixtureFile(dir, 'deploy/nginx/nginx-proxy.conf', 'nginx-proxy.conf', [upstream]);
    return ['--entrypoint', 'nginx', example.image, '-c', '/fixtures/nginx.conf', '-g', 'daemon off;'];
  }
  if (example.name === 'traefik') {
    await fixtureFile(dir, 'deploy/traefik/traefik.yaml', 'traefik.yaml', [mountPath, listener]);
    await fixtureFile(dir, 'deploy/traefik/dynamic.yaml', 'traefik-dynamic.yaml', [mountPath, upstream]);
    return ['--entrypoint', 'traefik', example.image, '--configFile=/fixtures/traefik.yaml'];
  }
  await fixtureFile(dir, 'deploy/caddy/Caddyfile', 'Caddyfile', [
    mountPath, upstream, [`${domain} {`, `https://${domain}:${proxyPort} {`],
  ]);
  return ['--entrypoint', 'caddy', example.image, 'run', '--config', '/fixtures/Caddyfile', '--adapter', 'caddyfile'];
}

async function certificate(dir) {
  await fs.chmod(dir, 0o755);
  await fs.mkdir(path.join(dir, 'tls'));
  await command('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-keyout', path.join(dir, 'tls/privkey.pem'),
    '-out', path.join(dir, 'tls/fullchain.pem'),
    '-subj', `/CN=${domain}`, '-addext', `subjectAltName=DNS:${domain}`,
  ]);
  // This short-lived test key is not a production credential. The proxy may
  // run as a non-root user and needs to read it through the bind mount.
  await fs.chmod(path.join(dir, 'tls/privkey.pem'), 0o644);
  return fs.readFile(path.join(dir, 'tls/fullchain.pem'));
}

module.exports = { domain, examples, command, listen, close, unusedPort, request, waitForProxy, configure, certificate };
