# E2E Tests – How to Run

Tests run **only against the ngrok URL**. No localhost or local dev server is used.

## App URL

The app under test is served at:

- **Base:** `https://f4895d81cf84.ngrok-free.app/tls-manager`
- **Login page:** `https://f4895d81cf84.ngrok-free.app/tls-manager/login`

This is the only URL that matters. All tests use this ngrok base.

## Running tests

1. **Ensure the app is available** at the ngrok URL above (however you normally run or expose it).

2. **From the project root** (`web-ui/web-ui`), run:
   ```bash
   npm run test -- tests/login.spec.ts --project=chromium
   ```

Playwright will load the app from the ngrok URL. If `playwright.config.ts` uses a different URL (e.g. another ngrok subdomain), update **baseURL** and **webServer.url** in that config to:

`https://f4895d81cf84.ngrok-free.app/tls-manager`

so they match the URL above. No localhost URLs should be used in the config or test setup.

## “No tests found” or web server timeout

Those errors usually mean Playwright could not reach the configured URL. Confirm:

- The app is reachable at `https://f4895d81cf84.ngrok-free.app/tls-manager`.
- `baseURL` and `webServer.url` in `playwright.config.ts` are set to that same ngrok URL (no localhost).
