# Browser and API integration tests

These tests build the Go application, start it on an ephemeral loopback port with a temporary SQLite database, and drive a real Chromium browser. They require Go, Node.js 18 or newer, and npm; none are application runtime dependencies.

From this directory:

```sh
npm ci
npx playwright install chromium
npm test
```

To use an already installed Chrome or Chromium instead of downloading Playwright's browser:

```sh
CHROME_PATH=/usr/bin/google-chrome npm test
```

The test process stops its server and browser and deletes its own temporary database and binary when the run finishes.
