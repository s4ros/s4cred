'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
let tempDir;
let server;
let browser;
let origin;

async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Server exited with status ${server.exitCode}`);
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch (_) {
      // The listener may not have started yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Server did not start');
}

function makeNote() {
  const token = crypto.randomBytes(32);
  return {
    token: token.toString('base64url'),
    request: {
      nonce: crypto.randomBytes(12).toString('base64url'),
      ciphertext: crypto.randomBytes(17).toString('base64url'),
      ttl: 3600,
      read_token_hash: crypto.createHash('sha256').update(token).digest('base64url'),
    },
  };
}

async function post(route, body) {
  return fetch(`${origin}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });
}

function decryptGCM(key, nonce, ciphertext) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  return Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
}

function chunkedPost(route, body) {
  return new Promise((resolve, reject) => {
    const request = http.request(new URL(route, origin), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'Transfer-Encoding': 'chunked' },
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end(body);
  });
}

before(async () => {
  const tempRoot = fs.existsSync('/tmp/opencode') ? '/tmp/opencode' : os.tmpdir();
  tempDir = fs.mkdtempSync(path.join(tempRoot, 's4cred-browser-'));
  const executable = path.join(tempDir, 's4cred');
  execFileSync('go', ['build', '-o', executable, './cmd/s4cred'], { cwd: root, stdio: 'inherit', timeout: 180000 });
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  server = spawn(executable, [], {
    cwd: root,
    env: { ...process.env, PUBLIC_ORIGIN: origin, LISTEN_ADDR: `127.0.0.1:${port}`, DATABASE_PATH: path.join(tempDir, 'notes.db') },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await waitForServer();
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
}, { timeout: 200000 });

after(async () => {
  if (browser) await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('exit', resolve));
  }
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('the application opens in a real browser', async () => {
  const context = await browser.newContext({ locale: 'en-US' });
  try {
    const page = await context.newPage();
    const response = await page.goto(origin);
    assert.equal(response.status(), 200);
    await page.locator('textarea').first().waitFor({ state: 'visible' });
  } finally {
    await context.close();
  }
});

test('browser cryptography matches the password-protected link vector', async () => {
  const context = await browser.newContext({ locale: 'en-US' });
  try {
    const page = await context.newPage();
    await page.goto(origin);
    const actual = await page.evaluate(async () => {
      const salt = Uint8Array.from({ length: 16 }, (_, i) => i);
      const nonce = Uint8Array.from({ length: 12 }, (_, i) => i + 16);
      const payload = Uint8Array.from({ length: 64 }, (_, i) => i);
      const password = new TextEncoder().encode('Cafe\u0301'.normalize('NFC'));
      const material = await crypto.subtle.importKey('raw', password, 'PBKDF2', false, ['deriveKey']);
      const key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600000 },
        material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
      );
      const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, payload));
      return btoa(Array.from(ciphertext, (value) => String.fromCharCode(value)).join(''))
        .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    });
    assert.equal(actual, 'dh4znpvTKHtls1i_UFF5E8qKWndmQIW2VttmrDqiZ63o6oOM7c6c5Xm6pGLT2GlrdHHgaPdq-SX90RwiioLutbnW3OXQo8XU0cSV4sOiyH4');
  } finally {
    await context.close();
  }
});

test('unprotected browser flow encrypts locally and reads only once', { timeout: 30000 }, async () => {
  const context = await browser.newContext({ locale: 'en-US' });
  try {
    const page = await context.newPage();
    const requests = [];
    page.on('request', (request) => {
      if (request.method() === 'POST') requests.push({ url: request.url(), body: request.postData() });
    });
    await page.goto(origin);
    const secret = 'Hello 🌍 <img src=x onerror="window.injected=true">\nżółć';
    await page.locator('#note').fill(secret);
    await page.locator('#create-button').click();
    await page.locator('#created').waitFor({ state: 'visible' });
    const link = await page.locator('#link').inputValue();
    const url = new URL(link);
    const [version, keyText, tokenText] = url.hash.slice(1).split('.');
    assert.equal(version, 'v1');
    const key = Buffer.from(keyText, 'base64url');
    const token = Buffer.from(tokenText, 'base64url');
    assert.equal(key.length, 32);
    assert.equal(token.length, 32);
    const creation = JSON.parse(requests.find((request) => request.url.endsWith('/api/notes')).body);
    assert.equal(creation.read_token_hash, crypto.createHash('sha256').update(token).digest('base64url'));
    assert.equal(decryptGCM(key, Buffer.from(creation.nonce, 'base64url'), Buffer.from(creation.ciphertext, 'base64url')).toString('utf8'), secret);
    const sent = JSON.stringify(creation);
    assert(!sent.includes(secret) && !sent.includes(keyText) && !sent.includes(tokenText));
    await page.goto(link);
    await page.reload();
    assert.equal(requests.filter((request) => request.url.endsWith('/consume')).length, 0);
    await page.locator('#read-button').click();
    await page.locator('#opened').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#opened-note').textContent(), secret);
    assert.equal(await page.locator('#opened-note img').count(), 0);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    const consume = requests.filter((request) => request.url.endsWith('/consume'));
    assert.equal(consume.length, 1);
    assert.deepEqual(JSON.parse(consume[0].body), { read_token: tokenText });
    await page.reload();
    await page.locator('#read-button').click();
    await page.locator('#read-error').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#read-error').getAttribute('data-message'), 'notFound');
  } finally {
    await context.close();
  }
});

test('password-protected browser flow verifies locally and interoperates with Node crypto', { timeout: 30000 }, async () => {
  const context = await browser.newContext({ locale: 'en-US' });
  try {
    const page = await context.newPage();
    const requests = [];
    page.on('request', (request) => {
      if (request.method() === 'POST') requests.push({ url: request.url(), body: request.postData() });
    });
    await page.goto(origin);
    const secret = 'Protected note 🗝';
    await page.locator('#note').fill(secret);
    await page.locator('#protect').check();
    await page.locator('#create-password').fill('Cafe\u0301 password');
    await page.locator('#confirm-password').fill('Café password');
    await page.locator('#create-button').click();
    await page.locator('#created').waitFor({ state: 'visible' });
    const link = await page.locator('#link').inputValue();
    const [version, saltText, nonceText, wrappedText] = new URL(link).hash.slice(1).split('.');
    assert.equal(version, 'v1p');
    assert(!link.includes('password'));
    const salt = Buffer.from(saltText, 'base64url');
    const nonce = Buffer.from(nonceText, 'base64url');
    const wrapped = Buffer.from(wrappedText, 'base64url');
    assert.equal(salt.length, 16);
    assert.equal(nonce.length, 12);
    assert.equal(wrapped.length, 80);
    const wrappingKey = crypto.pbkdf2Sync('Café password', salt, 600000, 32, 'sha256');
    const pair = decryptGCM(wrappingKey, nonce, wrapped);
    assert.equal(pair.length, 64);
    const creation = JSON.parse(requests.find((request) => request.url.endsWith('/api/notes')).body);
    assert.equal(creation.read_token_hash, crypto.createHash('sha256').update(pair.subarray(32)).digest('base64url'));
    assert.equal(decryptGCM(pair.subarray(0, 32), Buffer.from(creation.nonce, 'base64url'), Buffer.from(creation.ciphertext, 'base64url')).toString('utf8'), secret);
    assert(!JSON.stringify(creation).includes('password'));
    await page.goto(link);
    await page.locator('#read-password').fill('incorrect');
    await page.locator('#read-button').click();
    await page.locator('#read-error').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#read-error').getAttribute('data-message'), 'wrongPassword');
    assert.equal(requests.filter((request) => request.url.endsWith('/consume')).length, 0);
    await page.locator('#read-password').fill('Café password');
    await page.locator('#read-button').click();
    await page.locator('#opened').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#opened-note').textContent(), secret);
    const consume = requests.filter((request) => request.url.endsWith('/consume'));
    assert.equal(consume.length, 1);
    assert.deepEqual(JSON.parse(consume[0].body), { read_token: pair.subarray(32).toString('base64url') });
    assert(!consume[0].body.includes('password'));
  } finally {
    await context.close();
  }
});

test('correcting a same-page link fragment uses the corrected credentials', { timeout: 30000 }, async () => {
  const context = await browser.newContext({ locale: 'en-US' });
  try {
    const page = await context.newPage();
    await page.goto(origin);
    await page.locator('#note').fill('Corrected link');
    await page.locator('#create-button').click();
    await page.locator('#created').waitFor({ state: 'visible' });
    const link = await page.locator('#link').inputValue();
    const wrong = new URL(link);
    const parts = wrong.hash.slice(1).split('.');
    parts[1] = (parts[1][0] === 'A' ? 'B' : 'A') + parts[1].slice(1);
    wrong.hash = parts.join('.');
    await page.goto(wrong.href);
    await page.goto(link);
    await page.locator('#read-interrupted').waitFor({ state: 'visible' });
    await page.locator('#read-button').click();
    await page.locator('#opened').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#opened-note').textContent(), 'Corrected link');
  } finally {
    await context.close();
  }
});

test('changing a protected fragment during password derivation cannot send stale credentials', { timeout: 30000 }, async () => {
  const context = await browser.newContext({ locale: 'en-US' });
  try {
    const page = await context.newPage();
    const consumes = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/consume')) consumes.push(request);
    });
    await page.goto(origin);
    await page.locator('#note').fill('Derivation race');
    await page.locator('#protect').check();
    await page.locator('#create-password').fill('race password');
    await page.locator('#confirm-password').fill('race password');
    await page.locator('#create-button').click();
    await page.locator('#created').waitFor({ state: 'visible' });
    const link = await page.locator('#link').inputValue();
    const url = new URL(link);
    const parts = url.hash.slice(1).split('.');
    const wrappingKey = crypto.pbkdf2Sync('race password', Buffer.from(parts[1], 'base64url'), 600000, 32, 'sha256');
    const pair = decryptGCM(wrappingKey, Buffer.from(parts[2], 'base64url'), Buffer.from(parts[3], 'base64url'));
    await page.goto(link);
    await page.evaluate(() => {
      const original = crypto.subtle.deriveKey.bind(crypto.subtle);
      crypto.subtle.deriveKey = async (...args) => {
        await new Promise((resolve) => { window.releaseDerivation = resolve; });
        return original(...args);
      };
    });
    await page.locator('#read-password').fill('race password');
    await page.locator('#read-button').click();
    await page.waitForFunction(() => typeof window.releaseDerivation === 'function');
    parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
    await page.evaluate((fragment) => { location.hash = fragment; }, parts.join('.'));
    await page.locator('#read-interrupted').waitFor({ state: 'visible' });
    await page.evaluate(() => { if (window.releaseDerivation) window.releaseDerivation(); });
    await page.waitForFunction(() => !document.getElementById('read-button').disabled);
    assert.equal(consumes.length, 0);
    const response = await post(`/api/notes/${url.pathname.split('/').pop()}/consume`, { read_token: pair.subarray(32).toString('base64url') });
    assert.equal(response.status, 200);
  } finally {
    await context.close();
  }
});

test('changing a fragment after a read was sent warns about possible consumption', { timeout: 30000 }, async () => {
  const context = await browser.newContext({ locale: 'en-US' });
  try {
    const page = await context.newPage();
    await page.goto(origin);
    await page.locator('#note').fill('Already sent');
    await page.locator('#create-button').click();
    await page.locator('#created').waitFor({ state: 'visible' });
    const link = await page.locator('#link').inputValue();
    const url = new URL(link);
    const parts = url.hash.slice(1).split('.');
    let responseReady;
    const received = new Promise((resolve) => { responseReady = resolve; });
    let releaseResponse;
    const release = new Promise((resolve) => { releaseResponse = resolve; });
    await page.route('**/api/notes/*/consume', async (route) => {
      const response = await route.fetch();
      responseReady();
      await release;
      await route.fulfill({ response });
    });
    await page.goto(link);
    await page.locator('#read-button').click();
    await received;
    parts[1] = (parts[1][0] === 'A' ? 'B' : 'A') + parts[1].slice(1);
    await page.evaluate((fragment) => { location.hash = fragment; }, parts.join('.'));
    await page.locator('#read-interrupted').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#read-interrupted').getAttribute('data-message'), 'readChangedAfterRequest');
    releaseResponse();
    await page.waitForFunction(() => !document.getElementById('read-button').disabled);
    assert.equal(await page.locator('#opened').isVisible(), false);
    const response = await post(`/api/notes/${url.pathname.split('/').pop()}/consume`, { read_token: parts[2] });
    assert.equal(response.status, 404);
  } finally {
    await context.close();
  }
});

test('language and theme preferences are accessible and persist', async () => {
  const context = await browser.newContext({ locale: 'pl-PL', reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    await page.goto(origin);
    assert.equal(await page.locator('html').getAttribute('lang'), 'pl');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.locator('#language').selectOption('en');
    await page.locator('#theme').click();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  } finally {
    await context.close();
  }
  const fallback = await browser.newContext({ locale: 'de-DE' });
  try {
    const page = await fallback.newPage();
    await page.goto(origin);
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  } finally {
    await fallback.close();
  }
});

test('interface remains readable in both themes on a narrow screen', async () => {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 375, height: 812 } });
  try {
    const page = await context.newPage();
    await page.goto(origin);
    for (const theme of ['dark', 'light']) {
      if (theme === 'light') await page.locator('#theme').click();
      const metrics = await page.evaluate(() => {
        const color = (element, property) => getComputedStyle(element)[property].match(/[\d.]+/g).slice(0, 3).map(Number);
        const luminance = (rgb) => rgb.map((channel) => {
          channel /= 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
        const contrast = (foreground, background) => {
          const a = luminance(foreground), b = luminance(background);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        const primary = document.querySelector('#create-button');
        const hint = document.querySelector('#note-help');
        const card = document.querySelector('.card');
        return {
          width: document.documentElement.scrollWidth,
          viewport: innerWidth,
          button: contrast(color(primary, 'color'), color(primary, 'backgroundColor')),
          hint: contrast(color(hint, 'color'), color(card, 'backgroundColor')),
        };
      });
      assert(metrics.width <= metrics.viewport, `${theme} overflows on a narrow screen`);
      assert(metrics.button >= 4.5, `${theme} button contrast ${metrics.button}`);
      assert(metrics.hint >= 4.5, `${theme} hint contrast ${metrics.hint}`);
    }
    await page.keyboard.press('Tab');
    assert.notEqual(await page.evaluate(() => document.activeElement.tagName), 'BODY');
  } finally {
    await context.close();
  }
});

test('creation controls are reachable and usable with a keyboard', async () => {
  const context = await browser.newContext({ locale: 'en-US' });
  try {
    const page = await context.newPage();
    await page.goto(origin);
    for (const selector of ['.brand', '#language', '#theme', '#note', '#ttl', '#protect']) {
      await page.keyboard.press('Tab');
      assert.equal(await page.locator(selector).evaluate((element) => element === document.activeElement), true, `${selector} is reachable`);
    }
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#protect').isChecked(), true);
    assert.equal(await page.locator('#password-fields').isVisible(), true);
    for (const selector of ['#create-password', '#confirm-password', '#create-button']) {
      await page.keyboard.press('Tab');
      assert.equal(await page.locator(selector).evaluate((element) => element === document.activeElement), true, `${selector} is reachable`);
    }
  } finally {
    await context.close();
  }
});

test('language and theme switching work when browser storage is unavailable', async () => {
  const context = await browser.newContext({ locale: 'en-US' });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked'); } });
    });
    await page.goto(origin);
    await page.locator('#language').selectOption('pl');
    await page.locator('#theme').click();
    assert.equal(await page.locator('html').getAttribute('lang'), 'pl');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  } finally {
    await context.close();
  }
});

test('browser enforces the exact UTF-8 note size boundary', { timeout: 60000 }, async () => {
  const context = await browser.newContext({ locale: 'en-US' });
  try {
    const page = await context.newPage();
    const creationRequests = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/notes')) creationRequests.push(request);
    });
    await page.goto(origin);
    const exact = 'ż'.repeat(500000);
    await page.locator('#note').fill(exact + 'x');
    await page.locator('#create-button').click();
    assert.equal(await page.locator('#create-error').getAttribute('data-message'), 'tooLarge');
    assert.equal(creationRequests.length, 0);
    await page.locator('#note').fill(exact);
    await page.locator('#create-button').click();
    await page.locator('#created').waitFor({ state: 'visible', timeout: 30000 });
    assert.equal(creationRequests.length, 1);
    const link = await page.locator('#link').inputValue();
    await page.goto(link);
    await page.locator('#read-button').click();
    await page.locator('#opened').waitFor({ state: 'visible', timeout: 30000 });
    assert.equal(await page.locator('#opened-note').textContent(), exact);
  } finally {
    await context.close();
  }
});

test('invalid read-token types cannot consume a note', async () => {
  const note = makeNote();
  const created = await post('/api/notes', note.request);
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const route = `/api/notes/${id}/consume`;
  for (const payload of [{}, { read_token: null }, { read_token: 1 }, { read_token: [] },
    { read_token: 'invalid' }, { read_token: crypto.randomBytes(32).toString('base64url') },
    { read_token: note.token, extra: 'unexpected' }]) {
    const result = await post(route, payload);
    assert.equal(result.status, 404, `Unexpected status for ${JSON.stringify(payload)}`);
    await result.arrayBuffer();
  }
  assert.equal(await chunkedPost(route, `{"read_token":"${note.token}","read_token":"${note.token}"}`), 404);
  const consumed = await post(route, { read_token: note.token });
  assert.equal(consumed.status, 200);
  assert.deepEqual(await consumed.json(), { nonce: note.request.nonce, ciphertext: note.request.ciphertext });
  assert.equal((await post(route, { read_token: note.token })).status, 404);
});

test('opening a link does not consume the note and responses have privacy headers', async () => {
  const note = makeNote();
  const created = await post('/api/notes', note.request);
  assert.equal(created.status, 201);
  const { id } = await created.json();
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(`${origin}/n/${id}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
    await response.arrayBuffer();
  }
  assert.equal((await post(`/api/notes/${id}/consume`, { read_token: note.token })).status, 200);
});

test('only one concurrent authorized reader can consume the note', async () => {
  const note = makeNote();
  const created = await post('/api/notes', note.request);
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const results = await Promise.all(Array.from({ length: 16 }, async () => {
    const response = await post(`/api/notes/${id}/consume`, { read_token: note.token });
    await response.arrayBuffer();
    return response.status;
  }));
  assert.equal(results.filter((status) => status === 200).length, 1);
  assert.equal(results.filter((status) => status === 404).length, 15);
});

test('the API accepts the exact ciphertext size limit and rejects a larger ciphertext', async () => {
  const note = makeNote();
  note.request.ciphertext = crypto.randomBytes(1000016).toString('base64url');
  const allowed = await post('/api/notes', note.request);
  assert.equal(allowed.status, 201);
  const { id } = await allowed.json();
  note.request.ciphertext = crypto.randomBytes(1000017).toString('base64url');
  assert.equal((await post('/api/notes', note.request)).status, 400);
  assert.equal((await post(`/api/notes/${id}/consume`, { read_token: note.token })).status, 200);
});

test('a foreign origin cannot create a note', async () => {
  const note = makeNote();
  const response = await fetch(`${origin}/api/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
    body: JSON.stringify(note.request),
  });
  assert.equal(response.status, 403);
});

test('JSON framing and size are checked before a note is created', async () => {
  const note = makeNote();
  const valid = JSON.stringify(note.request);
  assert.equal(await chunkedPost('/api/notes', `${valid} {}`), 400);
  const duplicate = valid.replace('"ttl":3600', '"ttl":3600,"ttl":604800');
  assert.notEqual(duplicate, valid);
  assert.equal(await chunkedPost('/api/notes', duplicate), 400);
  assert.equal(await chunkedPost('/api/notes', valid + ' '.repeat(1400001)), 413);
});
