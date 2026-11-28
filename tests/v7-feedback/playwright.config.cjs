const fs = require('node:fs');
const path = require('node:path');
const { defineConfig } = require('@playwright/test');
const base = require('../../playwright.config.cjs');

function detectBrowserExecutable() {
    if (process.env.CSTU_CHROMIUM && fs.existsSync(process.env.CSTU_CHROMIUM)) {
        return process.env.CSTU_CHROMIUM;
    }
    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    return candidates.find((p) => fs.existsSync(p)) || undefined;
}

const executablePath = detectBrowserExecutable();

module.exports = defineConfig({
    testDir: __dirname,
    testMatch: '*.spec.cjs',
    workers: 1,
    retries: 0,
    timeout: 60000,
    reporter: [['list']],
    use: {
        browserName: 'chromium',
        viewport: { width: 1440, height: 900 },
        actionTimeout: 12000,
        timezoneId: 'Asia/Bangkok',
        locale: 'th-TH',
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
        launchOptions: executablePath ? { executablePath } : {}
    }
});
