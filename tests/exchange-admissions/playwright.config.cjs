const { defineConfig } = require('@playwright/test');
const base = require('../../playwright.config.cjs');

module.exports = defineConfig({
    ...base,
    testDir: __dirname,
    testMatch: '*.spec.cjs',
    workers: 1,
    webServer: { ...base.webServer, cwd: require('node:path').resolve(__dirname, '../..') },
    timeout: 120000,
    use: {
        ...base.use,
        actionTimeout: 12000,
        timezoneId: 'Asia/Bangkok',
        launchOptions: process.env.CSTU_CHROMIUM ? { executablePath: process.env.CSTU_CHROMIUM } : {}
    }
});
