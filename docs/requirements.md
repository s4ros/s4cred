# s4cred — Requirements and Application Design

**Status:** Released as version 1.0.0. Product requirements are agreed and implemented.

## 1. Goal

s4cred is a small web application for sharing confidential notes via single-use links. The sender creates a note and gives the link to a recipient. The recipient explicitly confirms the read, after which the note is deleted from the database. Unread notes expire after a duration chosen by the sender.

## 2. Agreed Requirements

- The application is public and does not require accounts or login.
- Note contents are encrypted in the browser before being sent to the server; the key is not sent to the server.
- The sender chooses how long the note remains valid.
- Notes may expire after 1 hour, 24 hours, or 7 days; the default is 24 hours.
- The maximum note size is 1 MB, defined as 1,000,000 bytes of UTF-8 text.
- The service allows up to 10,000 active notes and 1 GB of active ciphertext by default; both limits are configurable by the operator. Here, 1 GB means 1,000,000,000 bytes.
- The sender can select an optional additional password, required to decrypt the note. The password is shared with the recipient outside the application.
- Consuming a note requires a separate random read token. The server stores only its hash; knowing the note identifier alone is insufficient to consume it.
- SQLite is stored on a volume so unread notes survive container replacement.
- Opening a link does not consume the note. The recipient must click a button confirming the read and deletion.
- Replacing the container does not mean restoring read or expired notes from backups.
- The backend is written in Go.
- The interface is available in Polish and English; the browser language is selected automatically, and the user can switch languages.
- The frontend has a friendly, futuristic design with dark mode by default and a light-mode option.
- The repository will include deployment examples for Nginx, Traefik, and Caddy.
- Code, documentation, comments, identifiers, and other project files are in English, except for Polish translation strings required by the localized interface. Communication with the user remains in Polish.

## 3. Technical Defaults

The product limits and expiration choices are agreed in section 2. The following technical defaults support them:

| Parameter | Default |
| --- | --- |
| Maximum request size | 1,400,000 bytes for the base64url-encoded ciphertext and JSON metadata |
| Expired note cleanup | On startup and every 60 seconds while running |
| Additional password | No enforced minimum in the first version; recommend a hard-to-guess password of at least 12 characters |
| Password strengthening | PBKDF2-HMAC-SHA-256, 600,000 iterations, random 128-bit salt |

The note limit is measured in UTF-8 bytes, not characters. AES-GCM adds a 16-byte tag, and base64url encoding expands the maximum ciphertext to 1,333,355 characters; the request limit also leaves room for JSON metadata. The active ciphertext byte limit is enforced independently of the note-count limit.

## 4. Functionality

### 4.1. Creating a Note

1. The sender opens the home page, enters text, and selects the expiration period. Optionally, they select the **Protect with a password** checkbox, enter a password, and confirm it in a second field.
2. The interface explains the single-use read, expiration, and size limit. Empty notes and text exceeding the limit are rejected.
3. The browser independently generates a random encryption key, nonce, and read token, then encrypts the text locally. If a password was selected, the browser protects both the note key and read token with the password as described in section 7.1.
4. Only the encrypted data, nonce, selected lifetime, and SHA-256 hash of the read token are sent to the server. The server generates a random identifier and stores the data in SQLite.
5. The browser creates a link containing the identifier and either the key and read token or their password-protected form, and offers a copy button. The application does not send the link or password to third parties. If a password is used, the interface reminds the sender to share it through a separate channel.
6. After success, the form clears the text and password fields; the sender can create another note. An empty password or one that does not match its confirmation is rejected.

If sending fails, the application displays an error and does not claim that the note was created. If the response is lost after storage, an unclaimed note may remain until its selected expiration.

### 4.2. Reading a Note

1. The recipient opens the link. Loading the page does not fetch or delete the note; this reduces consumption by link previews and scanners.
2. The interface warns that confirming will delete the note and it cannot be recovered. A missing or invalid link fragment is detected before sending the read request.
3. If the link is password-protected, the recipient enters the password. The browser checks it locally by decrypting the key and read token before sending the read request. An incorrect password neither reads nor consumes the note, and the user may retry.
4. After confirmation, the browser sends the read token in the request body. The server verifies it, atomically checks validity, deletes the record, and returns the ciphertext to at most one authorized request.
5. The browser decrypts the contents locally and displays them as text, not HTML. A copy button allows the recipient to copy the contents to their device clipboard.
6. Subsequent attempts receive the same general message: the note does not exist, has expired, or has already been read.

Deletion occurs before the data is delivered and decrypted. A dropped connection, a correctly formatted but incorrect key in an unprotected link, or a decryption error can consume the note irreversibly. For password-protected links, an incorrect password is detected locally before retrieval, but later network or data errors remain possible. The interface must make the risk clear; there is no recovery mechanism.

### 4.3. Expiration

- The server computes the expiration time using its own clock and the selected allowed option.
- After expiration, a note cannot be read even if the cleanup job has not yet deleted it.
- Cleanup removes expired records on startup and periodically while running. If the application is stopped, cleanup runs after it starts again.
- Expiration uses the host wall clock and assumes it is synchronized. A backward clock adjustment before cleanup can extend apparent validity; operators must monitor clock synchronization and avoid backward jumps. Expiration is evaluated after the database write lock is acquired, at the atomic deletion check, not when the response reaches the client.

### 4.4. Interface Behavior

- A friendly, futuristic, responsive interface for phones and computers, without accounts or required user-side configuration. Use a restrained visual style, clear hierarchy, and subtle effects that do not obstruct reading or interaction.
- Dark theme is the default. A visible theme switch allows selecting light or dark mode; remember an explicit choice locally when browser storage is available. If storage is unavailable, the switch still works for the current page.
- Polish and English interface translations cover navigation, forms, validation, errors, warnings, and accessibility labels. Automatically select a language using the browser's ordered language preferences, including regional variants such as `pl-PL` and `en-US`. Use English when neither language is supported. Do not perform IP-based geolocation or request location permission.
- Provide a visible language selector. An explicit user selection takes precedence over automatic detection and is remembered locally when browser storage is available; otherwise it applies for the current page. Detection and selection must work without a setup step. Note contents are never translated.
- Accessible form labels, keyboard support, clear errors, understandable button behavior, sufficient contrast in both themes, and support for reduced-motion preferences.
- JavaScript and a browser supporting Web Crypto are required. HTTPS is required except on local `localhost`.
- If clipboard access is unavailable, the user can manually select and copy the link or contents.

## 5. Out of Scope for the First Version

- Accounts, login, listing notes, an administration panel, and history.
- Multiple reads, editing, manual revocation, and note recovery.
- Attachments, HTML/Markdown formatting, email, and messaging integrations.
- Notifications and per-note custom domains.
- Clustering, replication, and multiple application instances sharing a SQLite file.

## 6. Architecture and Data

### 6.1. Components

1. **Browser:** static HTML/CSS/JavaScript, with encryption and decryption using Web Crypto; local language and theme preferences contain no secrets.
2. **Application:** Go with the standard `net/http` package for HTTP, validation, API, interface assets, and periodic cleanup. The pure-Go `modernc.org/sqlite` driver supports a static container build.
3. **SQLite:** a single file on a container volume. Separate connection per request and short transactions. A single service instance supports concurrent requests.
4. **Reverse proxy / ingress:** HTTPS termination, request and connection limits, and safe logging. Required before publicly exposing the application.

No separate database server is required. The implementation requires Go 1.27.3 or newer and pins `modernc.org/sqlite` to v1.40.1. The container build image is pinned by version and digest.

The repository will include separate, clearly documented examples for Nginx, Traefik, and Caddy. An operator chooses one; running all three is not required. Each example must address HTTPS, request size, rate and connection limits, request timeouts, disabling consume retries, trusted forwarding headers, and avoiding sensitive URL and request-body logging. Where a proxy cannot provide a control directly, the example must document the required additional infrastructure or application-level control rather than claiming it is enabled.

### 6.2. Note Record

- SHA-256 hash of a random identifier with at least 256 bits of entropy.
- SHA-256 hash of the independently generated 256-bit read token, stored as a 32-byte SQLite BLOB.
- Ciphertext including the AES-GCM authentication tag, stored as a SQLite BLOB rather than base64 text.
- Random 96-bit nonce, stored as a SQLite BLOB.
- Expiration timestamp.

The database does not store plaintext, passwords, encryption keys, raw read tokens, password-protected keys or tokens, or complete links. The server hashes the identifier received in a request for lookup; it does not need to store the original identifier persistently.

### 6.3. Single-Use Semantics

The read uses a SQLite write transaction: prevent concurrent writes, obtain the current time after acquiring the write lock, locate the record, check expiration, compare the supplied token's SHA-256 hash with the stored hash using a constant-time comparison, and delete the record only if all checks pass. Quota checks likewise use a fresh time and a consistent view after obtaining the write lock. Lock waits are bounded. The server returns the ciphertext only after the transaction commits successfully. Missing or incorrect tokens do not consume a note. When multiple authorized requests use the same identifier concurrently, at most one can receive the data.

### 6.4. API — Proposed Contract

| Method and path | Behavior | Response |
| --- | --- | --- |
| `GET /` | Note creation interface | HTML; does not change data |
| `GET /n/{id}` | Note reading interface | HTML; does not fetch or delete the note |
| `POST /api/notes` | Validates and stores `ciphertext`, `nonce`, `ttl`, and `read_token_hash` | `201` with random `id`; data, capacity, or availability errors |
| `POST /api/notes/{id}/consume` | Validates `read_token` and atomically deletes and returns a valid note | `200` with `ciphertext` and `nonce`, or a general `404` |

Binary JSON values use unpadded base64url. `read_token_hash` is the SHA-256 digest of the 32 raw read-token bytes; both the decoded digest and decoded `read_token` must be exactly 32 bytes. The raw read token is sent only in the JSON body of a confirmed consume request, never in the URL; it is not persistently stored or logged. A syntactically valid consume request with a missing, invalid, or incorrect token receives the same general `404` as a missing, expired, or consumed note; malformed JSON may receive `400`.

For a 1,000,000-byte note, the AES-GCM ciphertext is 1,000,016 bytes, before base64url encoding. The server must bound and read the entire request before mutation, accept exactly one JSON object with no duplicate fields or trailing values, and validate the decoded ciphertext length as well as the total request size. `ttl` is one of the allowed durations in seconds. Because the server has no encryption key, it cannot verify the GCM tag, plaintext UTF-8, or plaintext content; the browser validates those for compliant clients. State-changing requests require JSON and a valid `Origin` matching the configured public application origin; CORS is not enabled for other origins. `Origin` protects browser interactions but is not authentication and can be forged by a non-browser client. All responses containing note data and pages using them have `Cache-Control: no-store`. API errors use stable, non-sensitive English error codes that the browser maps to localized messages; they do not reveal contents, keys, identifiers, or internal details.

## 7. Security and Limitations

### 7.1. Protection Model

- Encryption uses AES-256-GCM: a new 256-bit key and 96-bit nonce for every note, generated cryptographically in the browser.
- The browser independently generates a 256-bit read token for every note using a cryptographically secure random generator. The SHA-256 hash sent on creation is a verifier, not the read token or a password hash. Only the raw token authorizes a consume request; the server receives it at that point but never stores or logs it.
- Without a password, the note key and read token are in the URL fragment after `#`, which the browser does not send in HTTP requests.
- With a password, the browser generates a separate random salt and nonce; derives a wrapping key from the password using PBKDF2-HMAC-SHA-256; and encrypts the concatenation of the 32-byte note key and 32-byte read token using AES-256-GCM. The link fragment contains the format version, salt, nonce, and encrypted key-and-token package, but not the password. The password is Unicode NFC-normalized and encoded as UTF-8; it is not trimmed or case-folded.
- The fragment format is `#v1.<key>.<read-token>` without a password or `#v1p.<salt>.<nonce>.<encrypted-key-and-token>` with a password; binary values are unpadded base64url encoded. The encrypted package is 80 bytes, including the AES-GCM tag. KDF parameters are bound to the format version so existing links remain readable after future changes.
- Password verification locally decrypts the key and read token. An incorrect password does not send a read request. Neither the password nor its hash is sent to or stored by the server; the application also does not store it in `localStorage` or `sessionStorage`. Forgotten passwords cannot be recovered.
- The identifier is in the path and can appear in infrastructure logs; path and `Referer` logging must be disabled for the application at every layer.
- The link is secret. Without a password, anyone with the complete link can open the note; with a password, the correct password is also needed. A link can appear in browser history, the clipboard, a messaging service, or a screenshot.
- A password limits the impact of a link leak, but anyone with the link can attempt to guess it offline. Request rate limits cannot stop such attempts, so a strong, unique password matters. Knowing only the identifier does not authorize consumption; anyone who obtains the raw read token can nevertheless consume the note, even without its decryption key.
- The server and infrastructure administrator do not receive the key during the normal protocol, but they control the JavaScript delivered to the browser. A malicious or compromised application can capture the contents or key. This design does not protect against such a server, malicious extensions, or a compromised device.
- HTTPS must be configured correctly up to the trusted termination point; the connection from proxy to application should stay on a trusted network or also be encrypted.

### 7.2. Application Protection

- Strict server-side validation of inputs and limits, independent of browser validation.
- Display contents as text; no third-party scripts, fonts, analytics, or tracking pixels.
- CSP limiting resources to the same origin, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, a frame embedding prohibition, and disabled caching; HSTS at the proxy after HTTPS is configured.
- Explicitly configured public origin; no trust in arbitrary `Host` or `X-Forwarded-*` headers. The proxy must remove client-supplied forwarding headers and set its own.
- No contents, passwords, keys, complete URLs, or tokens in application, proxy, or error logs. Restrict memory dumps and volume access as well.
- SQLite secure deletion is enabled, but it does not guarantee physical erasure: remnants may exist in journals, filesystem layers, SSDs, snapshots, and backups. Encryption reduces the impact of retained ciphertext but does not replace device and key protection.

### 7.3. Public Exposure and Abuse

- Without accounts, the service can be flooded. The active-note count and total active ciphertext bytes are checked atomically when creating a note; once either limit would be exceeded, creation is rejected with a clear message. Expired notes do not count against active capacity.
- Before public deployment, the proxy must limit creation and read rates, request sizes, connection counts, and request duration. Starting points for testing are separate per-IP limits of 10 creations/minute and 60 read attempts/minute; tune them for actual traffic and shared IP addresses.
- IP limits and global capacity will not stop distributed attacks and may affect legitimate users. Operators should monitor availability and volume usage and use a WAF or restrict access at the network edge when necessary. The ciphertext quota limits active data, not the physical database or volume size: SQLite pages, journals, filesystem overhead, and available free space must also be monitored.
- The proxy must not automatically retry consume requests. A scanner that executes JavaScript and clicks the confirmation button can still consume a note.

## 8. Deployment Requirements

- A multi-stage Go build produces the application binary; the runtime container runs it as a non-root user and contains only what is needed at runtime.
- One application process handles concurrent requests with a single cleanup task; the database is on a named volume writable by the container user.
- Database operations, including pool and SQLite lock waits, have a 10-second context deadline. The application has 30-second request-read and 60-second response-write timeouts; uninterruptible filesystem stalls and network failures after a commit can still prevent delivery.
- Container and reverse proxy examples bind the application port to localhost by default rather than exposing it directly to the Internet.
- Configuration includes at least the public origin, database path, active-note count limit, and active ciphertext byte limit. User secrets are not server environment variables.
- Operational documentation covers container replacement, volume access and permissions, capacity monitoring, and failure consequences. A database backup can restore read notes and prolong ciphertext retention: database backups are not recommended for the first version.
- The Nginx, Traefik, and Caddy examples explain how to adapt each configuration to the operator's domain, certificates, deployment topology, and trusted upstream proxies; no privileged Docker socket access is required by the examples.

## 9. Acceptance Criteria

1. A user can create a note for each allowed expiration period, with or without an additional password, and receive a working link.
2. The server, database, and logs do not contain plaintext, passwords, or encryption keys. The complete link is not sent to the server. The raw read token is sent only in a confirmed consume request, never persistently stored or logged, and only its hash is retained in the database before consumption.
3. Opening the link, even repeatedly, does not consume the note; a confirmed read deletes it from the database.
4. Under concurrent reads, exactly one recipient receives the ciphertext; subsequent attempts receive a general unavailable message.
5. An expired note cannot be read, and cleanup deletes it after startup or while the application is running.
6. An unread, unexpired note survives container replacement with the same volume. A read note does not return unless a database backup is restored.
7. Invalid data, notes larger than 1,000,000 UTF-8 bytes, an unsupported lifetime, a foreign `Origin`, and count or byte capacity overflow are rejected. A note exactly at the size limit can be created and read.
8. The container runs without root; HTTPS, volumes, limits, observability, and risks are documented.
9. Tests cover the API, concurrency, expiration, encryption, the complete flow in a real browser, and container startup.
10. For a password-protected note, an incorrect password sends no read request and does not consume the note; the correct password allows decryption. The password is not part of the link, requests, or persistent application data.
11. The interface selects Polish or English from the browser preferences, falls back to English for unsupported languages, and allows an explicit switch. Switching languages does not change or translate note contents.
12. The futuristic interface defaults to dark mode and supports an accessible light mode. Explicit language and theme selections persist when browser storage is available; neither is required to use the service.
13. The backend is written in Go and the container runs the Go application binary without requiring a Python runtime.
14. The repository contains independently usable, documented Nginx, Traefik, and Caddy examples, with limitations and equivalent security requirements made explicit for each.
15. Missing, malformed, or incorrect read tokens in syntactically valid requests cannot consume a note and return the same general response as a missing or expired note; a subsequent request with the correct token can consume it exactly once.
