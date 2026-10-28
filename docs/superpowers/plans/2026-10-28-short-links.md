# Short Links (v1.1.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task after the user accepts it. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** New notes are shared as short bearer links such as `https://s4cred.infinigy.pl/n/k7hm2pqx9vlw4nrt`, while unread v1.0.0 links keep working.

**Architecture:** The browser still encrypts the note locally. It also generates a 16-character code and seals the note key and read token under a key derived from that code. The server stores only SHA-256(code) and the sealed blob. Opening `/n/{code}` still returns static HTML and does not consume the note. A separate POST returns the sealed blob; the browser unseals it and the existing confirm step still performs the single-use consume.

**Tech Stack:** Go 1.27.3+, SQLite via `modernc.org/sqlite` v1.40.1, `net/http`, Web Crypto (HKDF-SHA-256 + AES-256-GCM), existing HTML/CSS/JS. No new production dependency.

## Global Constraints

- Code, docs, comments, and identifiers stay in English. UI strings exist in English and Polish. Talk to the user in Polish.
- Do not tag `v1.1.0` or rewrite git history unless the user explicitly asks after the change is verified.
- Existing v1.0.0 links (`/n/{32-byte-id}#v1...` and `#v1p...`) must keep working until they expire or are read. Do not migrate or invalidate them.
- `GET /` and `GET /n/{id}` must not fetch, check, or delete a note.
- Consume stays single-use, atomic, and non-retriable. The new material endpoint must not delete.
- The server must not persist the raw short code, note key, read token, password, or plaintext. Application logs stay discarded (`ErrorLog` to `io.Discard`).
- No new accounts, admin UI, custom TTL, attachments, or clustering.
- Do not add a Go crypto dependency. The server treats `link_secret` as an opaque validated blob. Unsealing happens only in the browser (and in tests).
- Crockford base32 alphabet, exactly 16 characters: `0123456789abcdefghjkmnpqrstvwxyz`. Case-insensitive on input; stored and hashed as lowercase ASCII. Reject `i`, `l`, `o`, `u`.
- Password wrapping stays PBKDF2-HMAC-SHA-256, 600,000 iterations, NFC, not trimmed. KDF parameters stay bound to the existing `v1p` inner package.

## Why the link is long today

An unprotected v1.0.0 link carries three independent 256-bit secrets:

- path id, 43 base64url characters, used only as a lookup key
- fragment key, 43 characters
- fragment read token, 43 characters

The fragment is never sent to the server. That is why a database leak or an access log of `/n/{id}` cannot decrypt the note.

A 6-character code (`a123ds`) cannot encode those secrets. Anything that short either drops entropy or stores the secrets on the server in a form the short code can open. This plan does the second, with the mitigations below. It deliberately rejects a classic "store the long URL and redirect" shortener, which would persist the raw key and token.

## Accepted threat-model change

This is the decision the user must accept before implementation.

| | v1.0.0 | v1.1.0 short link |
| --- | --- | --- |
| Shared URL | `/n/{43}#v1.{43}.{43}` | `/n/{16}` with no fragment |
| Who can open it | Anyone with the complete URL | Anyone with the short URL |
| Database alone | Ciphertext only | Ciphertext plus a sealed blob. The raw code is not stored, so the blob does not open by itself |
| Path in an access log | Not sufficient to read the note | Sufficient to open an unprotected note, because the code is the whole bearer secret |
| Password note | Password required; offline guessing if the fragment leaks | Unchanged in effect. The password wrap is inside the seal, so a database leak without the code does not even give guessing material |
| Malicious server / JS | Already able to steal secrets | Unchanged. The server sees the code when the recipient loads the page |

Entropy: 16 Crockford characters are 80 bits (`32^16 = 2^80`). At 10,000 active notes and 1,000,000 guesses/second, the expected time to hit any note is on the order of a century. Six characters are `2^30` and are rejectable: a few thousand IPs at the documented 60 reads/minute can expect to hit some active note in minutes. Twelve characters (`2^60`) are the shortest length worth discussing if the user insists; this plan does not implement them.

Operational consequence, to be written into the README and the Nginx/Traefik/Caddy docs: a logged `GET /n/{code}` is now equivalent to logging the old full link. Access logs stay off. This was already required; it is now load-bearing for unprotected notes.

## Link and blob format

Example unprotected link:

```text
https://s4cred.infinigy.pl/n/k7hm2pqx9vlw4nrt
```

Code generation in the browser: 16 CSPRNG bytes; character `i` is `alphabet[byte & 31]`. This is unbiased because 256 is divisible by 32.

Sealing key, Web Crypto HKDF, matching RFC 5869:

- IKM: UTF-8 lowercase code (16 ASCII bytes)
- salt: 16 fresh CSPRNG bytes, stored in the blob
- info: the ASCII string `s4cred-short-link-v1`
- hash: SHA-256
- output: 32 bytes, imported as an AES-GCM key

Inner plaintext:

- unprotected: `note_key (32) || read_token (32)`
- password-protected: the existing v1p package, `password_salt (16) || password_nonce (12) || wrapped_key_and_token (80)`, produced by the current PBKDF2 + AES-GCM wrap before the outer seal

Stored blob, raw bytes, not base64, in SQLite:

```text
0x02 || flags || salt(16) || nonce(12) || aes-gcm-ciphertext-with-tag
```

- `flags = 0x00` and total length 110 for unprotected (64-byte plaintext + 16-byte tag)
- `flags = 0x01` and total length 154 for password-protected (108-byte plaintext + 16-byte tag)
- any other magic, flag, or length is rejected at create time

The server never unseals. Lookup key is `SHA-256(UTF-8 lowercase code)`, not the code.

## API

| Method and path | Change |
| --- | --- |
| `GET /n/{code}` | Unchanged behavior: static HTML, no database access. Already matches any single path segment. |
| `POST /api/notes` | Requires exactly these fields: `ciphertext`, `nonce`, `ttl`, `read_token_hash`, `id_hash`, `link_secret`. `id_hash` is 32 bytes. `link_secret` is the blob above. Response remains `201 {"id": ...}` but `id` is not used to build the link; the browser already has the code. Echo nothing derived from the code. Use `201 {"ok": true}` so a logged response is not a secret. |
| `POST /api/notes/{code}/material` | New. Origin and `application/json` required. Body is an empty JSON object. Does not delete. `200 {"link_secret": "<base64url>"}` or the same general `404 not_found` for missing, expired, consumed, legacy (NULL blob), and malformed codes. |
| `POST /api/notes/{code}/consume` | Same body as today (`read_token` only). Accept a 16-character code in addition to a legacy 32-byte base64url id. Wrong token, missing, expired, and consumed stay one `404`. |

`id_hash` is sent at create so the raw code is not in the create body. The code appears on the wire only in the recipient's `GET /n/{code}`, material path, and consume path. Do not log those paths.

Proxy rate limits already classify `/api/notes/` as reads. Material falls under that prefix. No Nginx, Traefik, or Caddy config change is required. Docs still need the logging warning.

## Data

Add nullable `link_secret BLOB` to `notes`.

- New databases: include the column in `CREATE TABLE`.
- Existing volumes: `CREATE TABLE IF NOT EXISTS` will not add it. After create, if `pragma_table_info('notes')` has no `link_secret`, run `ALTER TABLE notes ADD COLUMN link_secret BLOB`.
- Legacy rows stay NULL. Their consume path is unchanged: hash the 32 raw id bytes, not a string.
- Short-note consume hashes the 16 lowercase ASCII bytes. A 16-byte input and a 32-byte input cannot collide.
- Do not count `link_secret` toward `MAX_ACTIVE_BYTES`. It is about 110 or 154 bytes and is not ciphertext.
- Cleanup deletes the whole row, including the blob, as it does today.
- `secure_delete` stays on. It is still not a physical-erasure guarantee.

`Store.Create` stays as the legacy inserter used by existing tests (32-byte id, NULL blob). Add:

```go
func (s *Store) CreateSealed(ctx context.Context, idHash, linkSecret, ciphertext, nonce, tokenHash []byte, ttl int64) error
func (s *Store) Material(ctx context.Context, code []byte) ([]byte, error)
```

`CreateSealed` uses the same capacity transaction as `Create`. `idHash` must be 32 bytes and is stored as given (the browser already hashed). `linkSecret` must be 110 or 154 bytes and is stored as given. Duplicate `id_hash` returns `ErrInvalid` (client retries with a new code; expected never).

`Consume` accepts `len(id) == 32` (legacy raw id, hashed inside) or `len(id) == 16` (short code bytes, hashed inside). Do not accept other lengths.

`Material` hashes `code` (must be 16 bytes), returns `link_secret` only when the row exists, `expires_at` is in the future, and `link_secret IS NOT NULL`. It does not delete and does not check the read token.

## Files

- Modify: `internal/store/store.go` — column migration, `CreateSealed`, `Material`, `Consume` length branch
- Modify: `internal/store/store_test.go` — sealed create, material, expiry, consume deletes blob, raw code absent from the database
- Modify: `internal/httpapi/http.go` — create fields, material route, consume accepts both id forms
- Modify: `internal/httpapi/http_test.go` — new contract and legacy consume
- Modify: `web/app.js` — generate, seal, short read flow, keep legacy fragment flow
- Modify: `web/browser_test.js` — short-link round trip, password short link, legacy fragment still works, create body has no plaintext/password/raw token
- Modify: `web/index.html` — only if a new message element is required; prefer existing message nodes
- Modify: `docs/requirements.md` — status `1.1.0`, short-link contract, threat-model delta, acceptance criteria
- Modify: `README.md` — security model paragraph and the logging warning
- Modify: `deploy/nginx/README.md`, `deploy/traefik/README.md`, `deploy/caddy/README.md` — one sentence each: a logged `/n/{code}` opens an unprotected note
- Do not modify proxy configs, TTL choices, quotas, or CSP unless a test proves a hole

## Tasks

### Task 1: Sealed storage

**Files:** `internal/store/store.go`, `internal/store/store_test.go`

**Interfaces:**
- Produces: `CreateSealed(ctx, idHash, linkSecret, ciphertext, nonce, tokenHash, ttl) error`, `Material(ctx, code []byte) ([]byte, error)`, `Consume` accepting 16-byte or 32-byte ids

- [x] Write a failing test that opens a store, calls `CreateSealed` with a known 32-byte hash and a 110-byte blob, and asserts the `notes` row's `id_hash` equals that hash, `link_secret` equals the blob, and the raw code string is absent from a full SQL dump of the row.
- [x] Run `go test ./internal/store/ -run TestCreateSealed -count=1` and confirm it fails because `CreateSealed` does not exist.
- [x] Implement migration plus `CreateSealed`. Reuse the capacity transaction from `Create`. Reject bad hash length, bad blob length, bad ciphertext, bad nonce, bad token hash, and bad TTL with `ErrInvalid`.
- [x] Add failing tests: `Material` returns the blob; `Material` returns `ErrNotFound` after `Cleanup` past expiry; `Consume` with the 16 code bytes deletes the row so a second `Material` is `ErrNotFound`; a legacy `Create` row has NULL `link_secret` and `Material` is `ErrNotFound` while legacy `Consume` still works.
- [x] Run `go test ./internal/store/ -count=1`. Expected: pass.

### Task 2: HTTP contract

**Files:** `internal/httpapi/http.go`, `internal/httpapi/http_test.go`

**Interfaces:**
- Consumes: `CreateSealed`, `Material`, `Consume`
- Produces: `POST /api/notes` with six fields; `POST /api/notes/{code}/material`; consume accepts both id shapes

- [x] Write failing tests:
  - create without `id_hash` or `link_secret`, or with a 109-byte blob, or with flags/length mismatch, returns `400 invalid_note` and stores nothing
  - valid create returns `201 {"ok": true}` and does not echo the code
  - `GET /n/{code}` returns HTML and does not change the row
  - material without matching `Origin`, or with a non-empty JSON object, is rejected (`403` for origin, `404` for a body that is not `{}`)
  - material for a live sealed note returns the blob and leaves the row in place; a second material call still returns it
  - material for unknown, expired, and legacy ids returns `404 not_found`
  - consume with the short code and the correct token returns ciphertext once; the second consume is `404`
  - a legacy 32-byte id still consumes exactly once
- [x] Run `go test ./internal/httpapi/ -count=1` and confirm the new tests fail.
- [x] Implement the routes. Normalize the code to lowercase before hashing. Reject any character outside the Crockford alphabet before hashing, with the same `404` as a missing note on material and consume (do not distinguish malformed from missing).
- [x] Run `go test ./internal/httpapi/ ./internal/store/ -count=1`. Expected: pass.

### Task 3: Browser create and read

**Files:** `web/app.js`, `web/index.html` only if a status node is missing, `web/browser_test.js`

**Interfaces:**
- Consumes: the HTTP contract from Task 2
- Produces: short links with an empty fragment; legacy `#v1` / `#v1p` links still read

- [x] Update `browser_test.js` first so the current create-body assertion fails on purpose: a new note's displayed link must match `^https?://[^/]+/n/[0-9a-hjkmnp-tv-z]{16}$` and must not contain `#`.
- [x] Run `node web/browser_test.js` and confirm that assertion fails.
- [x] In `app.js`, on create: generate the code, build the inner plaintext (raw key||token, or the existing v1p package when a password is set), seal it, send `id_hash` and `link_secret`, and show `${location.origin}/n/${code}`.
- [x] On read: if the hash parses as `v1` or `v1p`, keep the current flow and do not call material. If the path is a 16-character code and the hash is empty, POST material on load, unseal, then continue with the existing password check and confirm/consume flow. A wrong password still sends no consume. Material failure must not be described as a consumed note.
- [x] Add browser coverage for: short unprotected round trip; opening the short link twice does not consume; confirm consumes once; password short link rejects a wrong password with zero consume requests and then opens with the right password; a crafted v1.0.0 fragment link still opens; create body does not contain plaintext, password, raw key, or raw token; `link_secret` does not decrypt under a wrong code.
- [x] Run `node web/browser_test.js`. Expected: pass.

### Task 4: Docs and version text

**Files:** `docs/requirements.md`, `README.md`, `deploy/nginx/README.md`, `deploy/traefik/README.md`, `deploy/caddy/README.md`

- [x] Set requirements status to version 1.1.0 and document the short-link contract, blob format, material endpoint, legacy-link compatibility, and the threat-model table above.
- [x] Add acceptance criteria: a new note yields a 16-character code and no fragment; the database row has no raw code; `GET` does not consume; material does not consume; confirm consumes once; a v1.0.0 fixture link still works; a password short link does not send the password or a consume request on a wrong password.
- [x] README: replace the "key and token are in the fragment" paragraph with the short-link model, and state that a logged short path opens an unprotected note.
- [x] Add the same one-sentence logging warning to each proxy README. Do not claim the proxies gained a new control.
- [x] Run `go test -race ./...` and `node web/browser_test.js`. Expected: pass. Do not create the git tag in this task.

## Out of scope

- Redirect shortener that stores the raw fragment
- Codes shorter than 16 characters
- Server-side unsealing, a server master key, or envelope encryption beyond the code-derived seal
- Revocation UI, link preview warnings beyond the existing confirm step, analytics
- Dual creation mode (user choosing long vs short). New notes are short. Old links still open.
- Publishing an image or tagging `v1.1.0` until the user asks

## Self-review

- Spec coverage: shortness, built-in (no third-party shortener), v1.1.0 docs, legacy links, single-use confirm, password notes, no plaintext on the server. Covered by Tasks 1–4.
- Placeholder scan: no TBD. Crypto parameters, lengths, alphabet, and routes are fixed.
- Type consistency: `CreateSealed` takes a pre-hashed 32-byte `idHash` and a raw blob; `Material` and short `Consume` take 16 raw code bytes and hash internally. HTTP normalizes case before that call.
