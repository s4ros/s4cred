# s4cred

s4cred shares confidential text through single-use links. The browser encrypts the note before sending it; the recipient must explicitly confirm its deletion before receiving it. The interface supports English and Polish, and dark and light themes.

## Local startup

Install Docker with Compose, then from this directory run:

```sh
docker compose up --build -d
```

Open <http://localhost:8080>. The published port is bound to `127.0.0.1`, not all interfaces. Localhost is a secure context for browser Web Crypto; non-local use requires HTTPS. This local configuration has no proxy rate limits and is not a public deployment. JavaScript and a browser with Web Crypto are required.

For public use choose **one** external HTTPS proxy example: [Nginx](deploy/nginx/README.md), [Traefik](deploy/traefik/README.md), or [Caddy](deploy/caddy/README.md). The examples initially bind HTTPS to loopback too. Replace their example domain and certificates, apply the documented missing controls, then deliberately change the proxy binding and firewall for your deployment. Do not expose the application port directly. Set `PUBLIC_ORIGIN` to the exact browser-facing HTTPS origin, for example:

```sh
PUBLIC_ORIGIN=https://notes.example.com docker compose up --build -d
```

Set persistent environment values in your deployment environment or an operator-managed `.env` file. The origin must match the browser's scheme, host and port; changing it without changing the external proxy causes state-changing requests to be rejected. If a proxy runs in another container or on another host, `127.0.0.1` refers to that proxy's own network namespace: adapt the upstream address and use a private, trusted network or TLS between proxy and application. Never mount the Docker socket.

## Configuration

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `PUBLIC_ORIGIN` | `http://localhost:8080` | Exact browser-facing origin. |
| `DATABASE_PATH` | `/data/notes.db` | SQLite file; use a path inside the mounted volume. |
| `LISTEN_ADDR` | `:8080` | Application listen address inside the container. The Compose port mapping targets container port 8080; update it if the port changes. |
| `MAX_ACTIVE_NOTES` | `10000` | Maximum number of unexpired notes. |
| `MAX_ACTIVE_BYTES` | `1000000000` | Maximum total bytes of active ciphertext. |

No user password, encryption key, or read token is configured as a server environment variable. The maximum plaintext is **1,000,000 UTF-8 bytes**, not characters. The request limit is 1,400,000 bytes, allowing JSON and encoded ciphertext overhead. Expiration options are one hour, 24 hours (default), or seven days.

## Operations

- Run **one application instance** per SQLite database. Multiple replicas, clustering, and shared SQLite files are not supported. Keep the host clock synchronized and avoid backward jumps: a clock rollback before cleanup can make an expired note appear valid again.
- Compose mounts the named `s4cred-data` volume at `/data`. The image runs as UID/GID **65532:65532**; its `/data` directory is owned by that user. A new Docker named volume is populated from the image. An existing volume or bind mount must already be writable by UID/GID 65532, including permission to create SQLite journal files. With rootless Docker or user-namespace remapping, map the container IDs to the corresponding host IDs. Restrict volume access to trusted administrators.
- To replace the container while retaining unread notes, run `docker compose up --build -d` again with the same project and volume. Do not use `docker compose down -v` unless you intentionally want to destroy the stored notes. Losing the volume loses all unread notes. The volume is not a backup.
- Monitor availability, rejection rates, active capacity where available, disk usage and free space without logging note identifiers, request paths, referers, bodies, or secrets. Quotas limit active ciphertext and count, **not** physical disk use: SQLite pages, journals, filesystem overhead, and snapshots consume additional space. Set disk alerts and keep headroom.
- Database operations have a 10-second deadline, including connection and SQLite lock waits; the application uses 30-second request-read and 60-second response-write timeouts. Storage failures or uninterruptible filesystem stalls can still affect availability.
- Backups are **not recommended** for this single-use service: restoring one can resurrect already-read or expired notes and extend ciphertext retention. If backups are unavoidable, explicitly accept this behavior, protect and encrypt backups and keys, define retention and deletion policies, and understand that restoring read notes violates the expected single-use behavior. SQLite secure deletion is not a physical-erasure guarantee: journals, filesystem layers, SSDs, snapshots, and backups may retain copies.
- Protect the host, database, TLS private keys, process memory, swap, crash dumps and diagnostic tools. Do not log URLs or request paths, query strings, `Referer`, bodies, passwords, tokens, keys, or plaintext at any application, proxy, CDN, WAF, load-balancer, tracing, or error-logging layer. Audit this after upgrades. HSTS is enabled in the proxy examples only after HTTPS is configured.
- Regularly review security advisories, update the pinned Go image and dependencies, and rebuild the image; pinned versions do not update themselves.

## Security model and limitations

Each note gets a fresh AES-256-GCM key and nonce in the browser. A separate random read token authorizes consumption; only its SHA-256 hash is stored before the read. New links are 16-character codes, for example `https://s4cred.example/n/k7hm2pqx9vjw4nrt`, with no fragment. The browser seals the key and token under that code and the server stores only the seal plus SHA-256 of the code. Opening the link fetches the seal and does not delete the note. On confirmation, the raw token is sent in the request body; the server deletes the record before returning ciphertext. Anyone with the short link can open an unprotected note. A logged `/n/{code}` path is the whole secret for an unprotected note, so path logging must stay disabled. A database copy without those codes does not reveal keys. Version 1.0.0 links still keep the key and token in the URL fragment, which is not sent on page load. Anyone with the raw token can consume the note even without its decryption key.

An optional password wraps the key and token locally using PBKDF2-HMAC-SHA-256 (600,000 iterations, random salt) and AES-GCM. Share the password through a separate channel. Use a strong unique password; a leaked link enables **offline guessing**, which server rate limits cannot stop. Passwords are not recoverable. Without a password, anyone with the complete link can read the note. Links can leak through browser history, clipboards, screenshots, messaging services, or compromised devices.

Opening a link alone does not consume it. Confirming the read deletes it before delivery and decryption: a dropped response, wrong key, or later decryption failure can permanently lose the note. An incorrect password is checked locally before a read, but subsequent network or data failures remain possible. A scanner that executes JavaScript and clicks the confirmation can still consume a note. There is no recovery.

The server normally receives ciphertext, not the plaintext or key, but the operator controls the JavaScript delivered to browsers. A malicious or compromised server, browser extension, or device can steal secrets. HTTPS protects traffic only to its trusted termination point. Treat the entire link and the password as secrets.

The service is unauthenticated and can be flooded. Before public exposure enforce per-IP creation and read limits (starting points: 10 creations/minute and 60 reads/minute), request and connection limits, and request timeouts. Tune for shared IPs and normal traffic. Distributed attacks can bypass per-IP limits; use a WAF, network restrictions, and capacity monitoring as needed. Prevent retries of consume requests at **every** proxy, client, and intermediary: a retry after deletion can only return an unavailable response.

## Tests

Go 1.27.3 or newer is required for builds; Go's automatic toolchain selection can download it when enabled. Run the Go tests and race detector with `go test -race ./...`. The frontend also has a dependency-free Chrome test: `node web/browser_test.js`.

Full browser and HTTP integration tests, including real encryption, require Node.js and Playwright; see [tests/browser/README.md](tests/browser/README.md). These are development dependencies only and are not included in the application image. [Container](tests/container/README.md) and [proxy](tests/proxy/README.md) smoke tests are also available.

See the [requirements and detailed threat model](docs/requirements.md) and [implementation plan](docs/superpowers/plans/2026-10-28-s4cred.md).

## License

MIT. See [LICENSE](LICENSE).
