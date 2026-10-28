// Run with: node web/browser_test.js (requires Google Chrome or CHROME_BIN).
// The mock API records requests and enforces the read-token hash, without a database.
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");

const notes = new Map();
const calls = [];
const harness = String.raw`
<!doctype html><meta charset="utf-8"><title>Browser test</title><iframe id="app"></iframe><script>
(async function () {
  const frame = document.getElementById('app');
  let count = 0;
  function assert(condition, message) { if (!condition) throw new Error(message); count++; }
  function waitFor(predicate, label) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function poll() {
        try { if (predicate()) return resolve(); } catch (_) {}
        if (Date.now() - start > 20000) return reject(new Error('Timed out: ' + label));
        setTimeout(poll, 25);
      })();
    });
  }
  async function open(url) {
    await new Promise((resolve) => { frame.onload = resolve; frame.src = 'about:blank'; });
    await new Promise((resolve) => { frame.onload = resolve; frame.src = url; });
    await waitFor(() => frame.contentDocument.getElementById('language').value, 'application load');
    return frame.contentDocument;
  }
  function el(doc, id) { return doc.getElementById(id); }
  function fill(doc, id, value) { const input = el(doc, id); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }
  function click(doc, id) { el(doc, id).click(); }
  async function stats() { return (await fetch('/test/stats')).json(); }
  function decode64(value) {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  async function create(doc, note, password) {
    fill(doc, 'note', note);
    if (password !== undefined) {
      click(doc, 'protect');
      fill(doc, 'create-password', password);
      fill(doc, 'confirm-password', password.normalize('NFC'));
    }
    click(doc, 'create-button');
    await waitFor(() => !el(doc, 'created').hidden || !el(doc, 'create-error').hidden, 'creation');
    assert(!el(doc, 'created').hidden, 'creation failed: ' + el(doc, 'create-error').textContent);
    return el(doc, 'link').value;
  }
  try {
    localStorage.clear();
    let doc = await open('/?languages=fr-FR,pl-PL,en-US');
    assert(doc.documentElement.lang === 'pl', 'ordered browser language detection');
    doc = await open('/?languages=fr-FR,de-DE');
    assert(doc.documentElement.lang === 'en', 'unsupported browser language fallback');
    doc = await open('/?nostorage=1&languages=pl-PL');
    assert(doc.documentElement.lang === 'pl', 'language detection with storage unavailable');
    click(doc, 'theme');
    el(doc, 'language').value = 'en';
    el(doc, 'language').dispatchEvent(new Event('change', { bubbles: true }));
    assert(doc.documentElement.lang === 'en' && doc.documentElement.dataset.theme === 'light', 'controls work without storage');
    doc = await open('/?languages=fr-FR,de-DE');
    assert(doc.documentElement.dataset.theme === 'dark', 'dark default');
    assert(doc.documentElement.lang === 'en', 'English default');
    click(doc, 'theme');
    el(doc, 'language').value = 'pl';
    el(doc, 'language').dispatchEvent(new Event('change', { bubbles: true }));
    assert(doc.documentElement.dataset.theme === 'light' && doc.documentElement.lang === 'pl', 'preference controls');
    doc = await open('/');
    assert(doc.documentElement.dataset.theme === 'light' && doc.documentElement.lang === 'pl', 'preferences persist');
    el(doc, 'language').value = 'en';
    el(doc, 'language').dispatchEvent(new Event('change', { bubbles: true }));
    fill(doc, 'note', 'é🙂');
    assert(el(doc, 'byte-count').textContent.startsWith('6 /'), 'counter measures UTF-8 bytes');
    click(doc, 'protect');
    fill(doc, 'create-password', 'first');
    fill(doc, 'confirm-password', 'second');
    const beforeMismatch = (await stats()).creates;
    click(doc, 'create-button');
    assert(el(doc, 'create-error').dataset.message === 'passwordMismatch' && (await stats()).creates === beforeMismatch, 'password mismatch rejected without request');
    click(doc, 'protect');
    const secret = 'Hello 🌍 <img src=x onerror="window.injected=true">\nżółć';
    el(doc, 'ttl').value = '3600';
    const link = await create(doc, secret);
    const plainParts = new URL(link).hash.slice(1).split('.');
    assert(plainParts[0] === 'v1' && plainParts.length === 3, 'plain fragment format');
    assert(el(doc, 'note').value === '', 'note cleared');
    Object.defineProperty(frame.contentWindow.navigator, 'clipboard', { value: undefined, configurable: true });
    click(doc, 'copy-link');
    await waitFor(() => el(doc, 'link-copy-status').dataset.message === 'copyFailed', 'manual link copy fallback');
    assert(el(doc, 'link').selectionStart === 0 && el(doc, 'link').selectionEnd === link.length, 'manual copy selects link');
    let state = await stats();
    const created = state.calls[state.calls.length - 1];
    assert(created.body.ttl === 3600 && Object.keys(created.body).sort().join(',') === 'ciphertext,nonce,read_token_hash,ttl', 'creation request contract');
    assert(!JSON.stringify(created.body).includes(secret) && !JSON.stringify(created.body).includes(plainParts[1]) && !JSON.stringify(created.body).includes(plainParts[2]), 'no plaintext, key, or raw token on creation');
    const before = state.consumes;
    doc = await open(link);
    doc = await open(link);
    state = await stats();
    assert(state.consumes === before, 'opening and reloading do not consume');
    click(doc, 'read-button');
    await waitFor(() => !el(doc, 'opened').hidden || !el(doc, 'read-error').hidden, 'read plain');
    assert(!el(doc, 'opened').hidden && el(doc, 'opened-note').textContent === secret, 'plaintext round trip');
    assert(!doc.querySelector('#opened-note img') && !frame.contentWindow.injected, 'HTML remains text');
    Object.defineProperty(frame.contentWindow.navigator, 'clipboard', { value: undefined, configurable: true });
    click(doc, 'copy-note');
    await waitFor(() => el(doc, 'note-copy-status').dataset.message === 'copyFailed', 'manual clipboard fallback');
    assert(frame.contentWindow.getSelection().toString() === secret, 'manual copy selects note');
    state = await stats();
    const consumed = state.calls[state.calls.length - 1];
    assert(Object.keys(consumed.body).join(',') === 'read_token' && consumed.body.read_token === plainParts[2], 'consume sends only read token');
    doc = await open(link);
    click(doc, 'read-button');
    await waitFor(() => !el(doc, 'read-error').hidden, 'second read');
    assert(el(doc, 'read-error').dataset.message === 'notFound', 'second read unavailable');

    doc = await open('/');
    fill(doc, 'note', 'Network test');
    frame.contentWindow.fetch = () => Promise.reject(new Error('Offline'));
    click(doc, 'create-button');
    await waitFor(() => !el(doc, 'create-error').hidden, 'creation network failure');
    assert(el(doc, 'create-error').dataset.message === 'createNetwork' && el(doc, 'note').value === 'Network test', 'creation network failure retains input and warns of uncertain outcome');
    frame.contentWindow.fetch = () => Promise.resolve(new Response('{"error":"capacity_exceeded"}', { status: 503, headers: { 'Content-Type': 'application/json' } }));
    click(doc, 'create-button');
    await waitFor(() => el(doc, 'create-error').dataset.message === 'capacity', 'capacity error');
    assert(el(doc, 'created').hidden, 'API errors do not claim creation');

    doc = await open('/');
    el(doc, 'ttl').value = '604800';
    const protectedLink = await create(doc, 'Protected 🗝', 'cafe\u0301 password');
    const protectedParts = new URL(protectedLink).hash.slice(1).split('.');
    assert(protectedParts[0] === 'v1p' && protectedParts.length === 4 && !protectedLink.includes('password'), 'protected fragment format');
    state = await stats();
    const protectedCreate = state.calls[state.calls.length - 1].body;
    assert(protectedCreate.ttl === 604800 && !JSON.stringify(protectedCreate).includes('password'), 'password omitted from create');
    const salt = decode64(protectedParts[1]), nonce = decode64(protectedParts[2]), wrapped = decode64(protectedParts[3]);
    assert(salt.length === 16 && nonce.length === 12 && wrapped.length === 80, 'protected package field lengths');
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode('café password'), 'PBKDF2', false, ['deriveKey']);
    const wrappingKey = await crypto.subtle.deriveKey({ name:'PBKDF2', salt, iterations:600000, hash:'SHA-256' }, material, { name:'AES-GCM', length:256 }, false, ['decrypt']);
    const pair = new Uint8Array(await crypto.subtle.decrypt({ name:'AES-GCM', iv:nonce }, wrappingKey, wrapped));
    assert(pair.length === 64, 'independent PBKDF2 and AES-GCM unwrap');
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', pair.slice(32)));
    assert(hash.every((value, index) => value === decode64(protectedCreate.read_token_hash)[index]), 'wrapped read token matches creation hash');
    const noteKey = await crypto.subtle.importKey('raw', pair.slice(0, 32), 'AES-GCM', false, ['decrypt']);
    const decodedNote = await crypto.subtle.decrypt({ name:'AES-GCM', iv:decode64(protectedCreate.nonce) }, noteKey, decode64(protectedCreate.ciphertext));
    assert(new TextDecoder().decode(decodedNote) === 'Protected 🗝', 'wrapped key independently decrypts note');
    doc = await open(protectedLink);
    const beforeWrong = (await stats()).consumes;
    fill(doc, 'read-password', 'wrong');
    click(doc, 'read-button');
    await waitFor(() => !el(doc, 'read-error').hidden, 'wrong password');
    assert(el(doc, 'read-error').dataset.message === 'wrongPassword' && (await stats()).consumes === beforeWrong, 'wrong password sends no consume');
    fill(doc, 'read-password', 'café password');
    click(doc, 'read-button');
    await waitFor(() => !el(doc, 'opened').hidden, 'protected read');
    assert(el(doc, 'opened-note').textContent === 'Protected 🗝', 'NFC password and protected round trip');
    state = await stats();
    assert(!JSON.stringify(state.calls[state.calls.length - 1].body).includes('password'), 'password omitted from consume');

    doc = await open('/');
    const originalLink = await create(doc, 'Token check');
    const originalURL = new URL(originalLink);
    const originalParts = originalURL.hash.slice(1).split('.');
    originalParts[2] = (originalParts[2][0] === 'A' ? 'B' : 'A') + originalParts[2].slice(1);
    doc = await open(originalURL.pathname + '#' + originalParts.join('.'));
    click(doc, 'read-button');
    await waitFor(() => !el(doc, 'read-error').hidden, 'incorrect token');
    assert(el(doc, 'read-error').dataset.message === 'notFound', 'incorrect token returns unavailable');
    doc = await open(originalLink);
    click(doc, 'read-button');
    await waitFor(() => !el(doc, 'opened').hidden, 'correct token after incorrect token');
    assert(el(doc, 'opened-note').textContent === 'Token check', 'incorrect token does not consume');

    doc = await open('/');
    const correctedLink = await create(doc, 'Corrected fragment');
    const correctedURL = new URL(correctedLink);
    const correctedParts = correctedURL.hash.slice(1).split('.');
    correctedParts[1] = (correctedParts[1][0] === 'A' ? 'B' : 'A') + correctedParts[1].slice(1);
    doc = await open(correctedURL.pathname + '#' + correctedParts.join('.'));
    await new Promise((resolve) => {
      frame.contentWindow.addEventListener('hashchange', resolve, { once: true });
      frame.contentWindow.location.hash = correctedURL.hash;
    });
    click(doc, 'read-button');
    await waitFor(() => !el(doc, 'opened').hidden || !el(doc, 'read-error').hidden, 'corrected fragment read');
    assert(!el(doc, 'opened').hidden && el(doc, 'opened-note').textContent === 'Corrected fragment', 'corrected fragment uses the new key before consuming');

    doc = await open('/');
    const immediateLink = await create(doc, 'Immediate fragment correction');
    const immediateURL = new URL(immediateLink);
    const immediateParts = immediateURL.hash.slice(1).split('.');
    immediateParts[1] = (immediateParts[1][0] === 'A' ? 'B' : 'A') + immediateParts[1].slice(1);
    doc = await open(immediateURL.pathname + '#' + immediateParts.join('.'));
    frame.contentWindow.location.hash = immediateURL.hash;
    click(doc, 'read-button');
    await waitFor(() => !el(doc, 'opened').hidden || !el(doc, 'read-error').hidden, 'immediate corrected fragment read');
    assert(!el(doc, 'opened').hidden && el(doc, 'opened-note').textContent === 'Immediate fragment correction', 'confirmation uses current fragment even before hashchange event');

    doc = await open('/');
    const delayedLink = await create(doc, 'Delayed password check', 'delay password');
    doc = await open(delayedLink);
    const subtle = frame.contentWindow.crypto.subtle;
    const deriveKey = subtle.deriveKey.bind(subtle);
    let startedKDF = false;
    let releaseKDF;
    const kdfGate = new Promise((resolve) => { releaseKDF = resolve; });
    subtle.deriveKey = async function (...args) { startedKDF = true; await kdfGate; return deriveKey(...args); };
    const beforeDelayed = (await stats()).consumes;
    fill(doc, 'read-password', 'delay password');
    click(doc, 'read-button');
    await waitFor(() => startedKDF, 'password KDF started');
    await new Promise((resolve) => {
      frame.contentWindow.addEventListener('hashchange', resolve, { once: true });
      frame.contentWindow.location.hash = '#v1.' + 'A'.repeat(43) + '.' + 'A'.repeat(43);
    });
    assert(el(doc, 'read-password-field').hidden, 'fragment navigation updates password field');
    await new Promise((resolve) => {
      frame.contentWindow.addEventListener('hashchange', resolve, { once: true });
      frame.contentWindow.location.hash = new URL(delayedLink).hash;
    });
    assert(!el(doc, 'read-password-field').hidden, 'restored protected fragment shows password field');
    releaseKDF();
    await waitFor(() => !el(doc, 'read-button').disabled, 'stale KDF finishes');
    assert((await stats()).consumes === beforeDelayed, 'hash change and restoration during KDF send no stale consume request');
    subtle.deriveKey = deriveKey;
    fill(doc, 'read-password', 'delay password');
    click(doc, 'read-button');
    await waitFor(() => !el(doc, 'opened').hidden || !el(doc, 'read-error').hidden, 'read after cancelled KDF');
    assert(!el(doc, 'opened').hidden && el(doc, 'opened-note').textContent === 'Delayed password check', 'note remains readable after cancelled KDF');

    doc = await open('/');
    const sentLink = await create(doc, 'Already requested');
    doc = await open(sentLink);
    const originalFetch = frame.contentWindow.fetch.bind(frame.contentWindow);
    let responseArrived = false;
    let releaseResponse;
    const responseGate = new Promise((resolve) => { releaseResponse = resolve; });
    frame.contentWindow.fetch = async function (...args) {
      const response = await originalFetch(...args);
      responseArrived = true;
      await responseGate;
      return response;
    };
    click(doc, 'read-button');
    await waitFor(() => responseArrived, 'consume response received');
    await new Promise((resolve) => {
      frame.contentWindow.addEventListener('hashchange', resolve, { once: true });
      frame.contentWindow.location.hash = '#v1.' + 'A'.repeat(43) + '.' + 'A'.repeat(43);
    });
    assert(el(doc, 'read-interrupted').dataset.message === 'readChangedAfterRequest', 'navigation after request warns note may have been deleted');
    releaseResponse();
    await waitFor(() => !el(doc, 'read-button').disabled, 'interrupted request finishes');
    assert(el(doc, 'opened').hidden && el(doc, 'read-interrupted').dataset.message === 'readChangedAfterRequest', 'stale response is not displayed and uncertainty remains visible');
    frame.contentWindow.fetch = originalFetch;
    await new Promise((resolve) => {
      frame.contentWindow.addEventListener('hashchange', resolve, { once: true });
      frame.contentWindow.location.hash = new URL(sentLink).hash;
    });
    click(doc, 'read-button');
    await waitFor(() => !el(doc, 'read-error').hidden, 'read after interrupted request');
    assert(el(doc, 'read-error').dataset.message === 'notFound', 'already-sent request can consume the note');

    doc = await open('/');
    const keyLink = await create(doc, 'Key check');
    const keyURL = new URL(keyLink);
    const keyParts = keyURL.hash.slice(1).split('.');
    keyParts[1] = (keyParts[1][0] === 'A' ? 'B' : 'A') + keyParts[1].slice(1);
    doc = await open(keyURL.pathname + '#' + keyParts.join('.'));
    click(doc, 'read-button');
    await waitFor(() => !el(doc, 'read-error').hidden, 'incorrect key');
    assert(el(doc, 'read-error').dataset.message === 'decryptError', 'incorrect key explains irreversible decryption failure');
    doc = await open(keyLink);
    click(doc, 'read-button');
    await waitFor(() => !el(doc, 'read-error').hidden, 'read after incorrect key');
    assert(el(doc, 'read-error').dataset.message === 'notFound', 'incorrect key consumed the note');

    doc = await open('/');
    fill(doc, 'note', 'x'.repeat(1000001));
    const beforeLarge = (await stats()).creates;
    click(doc, 'create-button');
    assert(el(doc, 'create-error').dataset.message === 'tooLarge' && (await stats()).creates === beforeLarge, 'oversize rejected without request');
    const largeLink = await create(doc, 'x'.repeat(1000000));
    state = await stats();
    assert(state.calls[state.calls.length - 1].body.ttl === 86400, 'default lifetime');
    assert(state.calls[state.calls.length - 1].body.ciphertext.length === 1333355, 'maximum ciphertext encoded');
    doc = await open(largeLink);
    click(doc, 'read-button');
    await waitFor(() => !el(doc, 'opened').hidden, 'maximum read');
    assert(el(doc, 'opened-note').textContent.length === 1000000, 'maximum note round trip');

    const beforeInvalid = (await stats()).consumes;
    doc = await open(new URL(largeLink).pathname + '#v1.bad.bad');
    assert(el(doc, 'read-button').disabled && el(doc, 'read-error').dataset.message === 'invalidLink', 'invalid link blocked');
    assert((await stats()).consumes === beforeInvalid, 'invalid link sends no consume');
    await fetch('/test/result', { method:'POST', body:JSON.stringify({ ok:true, count }) });
  } catch (error) {
    await fetch('/test/result', { method:'POST', body:JSON.stringify({ ok:false, count, error:error.stack || String(error) }) });
  }
})();
</script>`;

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}
function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}
let browser;
let done = false;
let timeout;
let profile;
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  const pathname = url.pathname;
  try {
    if (pathname === "/test") { response.writeHead(200, { "Content-Type": "text/html" }); return response.end(harness); }
    if (pathname === "/test/result") {
      const result = JSON.parse(await readBody(request));
      json(response, 200, {});
      console.log(result.ok ? `Browser tests passed (${result.count} assertions).` : `Browser tests failed after ${result.count} assertions: ${result.error}`);
      finish(result.ok ? 0 : 1);
      return;
    }
    if (pathname === "/test/stats") return json(response, 200, { calls, creates: calls.filter((call) => call.type === "create").length, consumes: calls.filter((call) => call.type === "consume").length });
    if (request.method === "POST" && pathname === "/api/notes") {
      const body = JSON.parse(await readBody(request));
      calls.push({ type: "create", body });
      const id = crypto.randomBytes(32).toString("base64url");
      notes.set(id, body);
      return json(response, 201, { id });
    }
    const consume = /^\/api\/notes\/([^/]+)\/consume$/.exec(pathname);
    if (request.method === "POST" && consume) {
      const body = JSON.parse(await readBody(request));
      calls.push({ type: "consume", body });
      const note = notes.get(consume[1]);
      const hash = crypto.createHash("sha256").update(Buffer.from(body.read_token, "base64url")).digest("base64url");
      if (!note || hash !== note.read_token_hash) return json(response, 404, { error: "not_found" });
      notes.delete(consume[1]);
      return json(response, 200, { ciphertext: note.ciphertext, nonce: note.nonce });
    }
    const asset = pathname === "/" || pathname.startsWith("/n/") ? "index.html" : pathname.slice(1);
    if (!["index.html", "app.js", "style.css"].includes(asset)) { response.writeHead(404); return response.end(); }
    const type = asset.endsWith(".html") ? "text/html" : asset.endsWith(".js") ? "application/javascript" : "text/css";
    response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    let content = fs.readFileSync(path.join(__dirname, asset), "utf8");
    if (asset === "index.html" && (url.searchParams.has("languages") || url.searchParams.has("nostorage"))) {
      const languages = url.searchParams.get("languages");
      let setup = languages ? `Object.defineProperty(navigator, 'languages', {value: ${JSON.stringify(languages.split(","))}});` : "";
      if (url.searchParams.has("nostorage")) setup += "Object.defineProperty(window, 'localStorage', {get() {throw new Error('Unavailable');}});";
      content = content.replace('<script src="/app.js" defer></script>', `<script>${setup}</script><script src="/app.js" defer></script>`);
    }
    response.end(content);
  } catch (error) { console.error(error); response.writeHead(500); response.end(); }
});

function finish(code) {
  if (done) return;
  done = true;
  clearTimeout(timeout);
  const removeProfile = () => {
    if (!profile) return;
    fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }, (error) => {
      if (error) { console.error(`Could not remove test profile: ${error.message}`); process.exitCode = 1; }
    });
  };
  if (browser && browser.pid && browser.exitCode === null) {
    browser.once("exit", removeProfile);
    browser.kill();
  } else removeProfile();
  server.close();
  process.exitCode = code;
}
server.listen(0, "127.0.0.1", () => {
  profile = fs.mkdtempSync(path.join(fs.existsSync("/tmp/opencode") ? "/tmp/opencode" : os.tmpdir(), "s4cred-browser-"));
  browser = spawn(process.env.CHROME_BIN || "google-chrome", ["--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}/test`], { stdio: "ignore" });
  browser.on("error", (error) => { console.error(`Chrome could not start: ${error.message}`); finish(1); });
  browser.on("exit", (code) => { if (!done) { console.error(`Chrome exited unexpectedly: ${code}`); finish(1); } });
  timeout = setTimeout(() => { console.error("Browser tests timed out."); finish(1); }, 90000);
});
