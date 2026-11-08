const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/e2e', fullyParallel: true, forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0, workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', {open:'never'}]],
  use: {baseURL:'http://127.0.0.1:4173', browserName:'chromium', reducedMotion:'reduce', serviceWorkers:'block', trace:'retain-on-failure'},
  webServer: {command:'npm run build && node tests/e2e/server.cjs', url:'http://127.0.0.1:4173', reuseExistingServer:false}
});
