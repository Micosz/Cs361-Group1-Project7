const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: __dirname,
    testMatch: '*.spec.cjs',
    workers: 1,
    retries: 0,
    timeout: 100000,
    use: {
        baseURL: 'https://127.0.0.1:4178',
        browserName: 'chromium',
        actionTimeout: 9000,
        navigationTimeout: 15000,
        viewport: { width: 1440, height: 1000 },
        timezoneId: 'Asia/Bangkok',
        locale: 'th-TH',
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
        ignoreHTTPSErrors: true,
        launchOptions: process.env.CSTU_CHROMIUM ? { executablePath: process.env.CSTU_CHROMIUM } : {}
    },
    webServer: {
        cwd: require('node:path').resolve(__dirname, '../..'),
        command: 'npm run build && python3 tests/proposals/server.py',
        url: 'https://127.0.0.1:4178/login.html',
        ignoreHTTPSErrors: true
    }
});
