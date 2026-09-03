const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/live',
  timeout: 60_000,
  expect: { timeout: 12_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-live-report', open: 'never' }]
  ],
  use: {
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    navigationTimeout: 30_000
  },
  projects: [
    { name: 'live-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'live-webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'live-iphone', use: { ...devices['iPhone 14'] } }
  ]
});
