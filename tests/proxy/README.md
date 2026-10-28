# Proxy integration tests

These tests exercise the repository's Nginx, Traefik and Caddy examples independently of the Go application. They use a local mock upstream and do not require a running s4cred service.

## Requirements and running

- Linux with a working Docker daemon and permission to use it; host networking must reach the same loopback interface as the test process. Docker Desktop, remote daemons and some rootless setups may not provide this topology.
- Node.js 20 or later, OpenSSL with `req -addext` support, and access to the Docker images `nginx:1.29-alpine`, `traefik:v3.7` and `caddy:2.11`. Docker may need network access to pull missing images.

From the repository root:

```sh
node --test tests/proxy/proxy.test.cjs
```

Each case copies the checked-in sample config into a newly created temporary directory, rewrites its paths and ports, and generates a short-lived self-signed test certificate. The HTTPS client verifies that certificate. The upstream and proxy use separately allocated loopback ports, not host ports 443 or 8080. A port must be released before Docker binds it, so another process can still win that small race; rerun if that happens. Each container has a unique name, no Docker socket mount, and host networking. Cleanup removes only the temporary directory and Docker container created by that case. If the process is killed forcibly or Docker becomes unavailable during cleanup, its uniquely named resources may need manual removal.

## Coverage and limitations

Each proxy is exercised for HTTPS routing and HSTS, replacement of spoofed standard forwarding headers, acceptance of a 1,400,000-byte body and rejection of a 1,400,001-byte body, and absence of fake secrets in container stdout/stderr after requests with a sensitive-looking path, `Referer`, request body, and idempotency headers. The mock drops the connection after receiving a consume-like POST; the test checks that it received exactly one attempt and that idempotency headers were removed. Nginx and Traefik are additionally tested for both create and read throttling while spoofing `X-Forwarded-For`.

The stock Caddy example does **not** configure per-IP rate or connection limits; external edge controls or vetted modules are required before public deployment. The suite does not establish a connection limit for any proxy or test timeout durations, HTTP/2, upstream TLS, every possible failure/retry mode, chunked request bodies, external infrastructure logs, proxy temporary files, or logs written to arbitrary files outside container stdout/stderr. A single dropped-connection test is not proof that every intermediary or client avoids retries. Traefik's deployment instructions additionally discard general output; this test runs it without that redirection so stdout/stderr logging can be inspected.
