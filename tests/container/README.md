# Container smoke test

This test uses Docker and Node.js 18 or newer. It starts a disposable container on a random loopback port, replaces it while retaining an isolated named volume, and checks non-root execution, persistence, token validation, and single-use reads. It removes only the uniquely named container and volume that it creates.

Run from the repository root:

```sh
docker build -t s4cred:test .
S4CRED_IMAGE=s4cred:test node tests/container/smoke.cjs
```
