import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 30 * 1000, // 30 seconds per test
  expect: {
    timeout: 5 * 1000, // 5 seconds for assertions
  },
  use: {
    // Local dev server URL with the app's base path (trailing slash required for path joining)
    baseURL: 'https://e1685d618dad.ngrok-free.app/tls-manager',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'https://e1685d618dad.ngrok-free.app/tls-manager',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000, // 2 minutes for server to start
  },
});