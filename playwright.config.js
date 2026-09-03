const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }]
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    navigationTimeout: 20_000
  },
  projects: [
    {
      name: 'static',
      testMatch: /static\/.*\.spec\.js/
    },
    {
      name: 'chromium',
      testMatch: /browser\/.*\.spec\.js/,
      use: { ...devices['Desktop Chrome'], serviceWorkers: 'block' }
    },
    {
      name: 'firefox',
      testMatch: /browser\/frontend\.spec\.js/,
      use: { ...devices['Desktop Firefox'], serviceWorkers: 'block' }
    },
    {
      name: 'webkit',
      testMatch: /browser\/.*\.spec\.js/,
      use: { ...devices['Desktop Safari'], serviceWorkers: 'block' }
    },
    {
      name: 'iphone',
      testMatch: /browser\/.*\.spec\.js/,
      use: { ...devices['iPhone 14'], serviceWorkers: 'block' }
    },
    {
      name: 'admin-functional',
      testMatch: /functional\/.*\.spec\.js/,
      use: { ...devices['Desktop Chrome'], serviceWorkers: 'block' }
    }
  ],
  webServer: {
    command: 'python3 -m http.server 4173 --bind 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 20_000
  }
});
