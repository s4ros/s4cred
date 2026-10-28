'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const net = require('node:net');

const image = process.env.S4CRED_IMAGE || 's4cred:test';
const suffix = crypto.randomBytes(8).toString('hex');
const container = `s4cred-test-${suffix}`;
const volume = `s4cred-test-${suffix}`;
let volumeCreated = false;
let containerCreated = false;

function docker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8', timeout: 30000 }).trim();
}

async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(origin) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(origin)).ok) return;
    } catch (_) {
      // Allow the container's listener to start.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Container did not become ready');
}

async function post(origin, path, body) {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });
}

function start(port, origin) {
  docker('run', '-d', '--name', container, '-p', `127.0.0.1:${port}:8080`,
    '--mount', `type=volume,src=${volume},dst=/data`, '-e', `PUBLIC_ORIGIN=${origin}`, image);
  containerCreated = true;
  assert.equal(docker('inspect', '--format', '{{.Config.User}}', container), '65532:65532');
}

function removeContainer() {
  if (containerCreated) {
    docker('rm', '-f', container);
    containerCreated = false;
  }
}

async function main() {
  try {
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    docker('volume', 'create', volume);
    volumeCreated = true;
    start(port, origin);
    await waitForServer(origin);
    const token = crypto.randomBytes(32);
    const note = {
      nonce: crypto.randomBytes(12).toString('base64url'),
      ciphertext: crypto.randomBytes(32).toString('base64url'),
      read_token_hash: crypto.createHash('sha256').update(token).digest('base64url'),
      ttl: 3600,
    };
    const created = await post(origin, '/api/notes', note);
    assert.equal(created.status, 201);
    const { id } = await created.json();
    assert.equal((await fetch(`${origin}/n/${id}`)).status, 200);

    removeContainer();
    start(port, origin);
    await waitForServer(origin);
    const route = `/api/notes/${id}/consume`;
    const wrong = await post(origin, route, { read_token: crypto.randomBytes(32).toString('base64url') });
    assert.equal(wrong.status, 404);
    const read = await post(origin, route, { read_token: token.toString('base64url') });
    assert.equal(read.status, 200);
    assert.deepEqual(await read.json(), { ciphertext: note.ciphertext, nonce: note.nonce });
    assert.equal((await post(origin, route, { read_token: token.toString('base64url') })).status, 404);
    console.log('Container smoke test passed: non-root, volume persistence, token validation and single-use read.');
  } finally {
    removeContainer();
    if (volumeCreated) docker('volume', 'rm', volume);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
