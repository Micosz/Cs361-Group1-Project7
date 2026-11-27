const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const path = require('node:path');

function startFixture() {
    const child = spawn(process.env.PYTHON || 'python3', [path.join(__dirname, 'driver.py')], {
        stdio: ['pipe', 'pipe', 'inherit']
    });
    let serial = 0;
    const waiting = new Map();
    createInterface({ input: child.stdout }).on('line', (line) => {
        const reply = JSON.parse(line),
            jobs = waiting.get(reply.id);
        if (!jobs) return;
        waiting.delete(reply.id);
        if (reply.error) jobs.reject(Error(reply.error));
        else jobs.resolve(reply.result);
    });
    child.once('exit', (code) => {
        for (const p of waiting.values()) p.reject(Error('Fixture exited: ' + code));
        waiting.clear();
    });
    function send(op, fields = {}) {
        const id = ++serial;
        return new Promise((resolve, reject) => {
            waiting.set(id, { resolve, reject });
            child.stdin.write(JSON.stringify({ id, op, ...fields }) + '\n');
        });
    }
    async function browserPage(browser, client, device = {}) {
        const context = await browser.newContext({
            baseURL: 'http://127.0.0.1:4173',
            viewport: { width: 1280, height: 860 },
            timezoneId: 'Asia/Bangkok',
            reducedMotion: 'reduce',
            serviceWorkers: 'block',
            ...device
        });
        await context.route('**/*', async (route) => {
            const req = route.request(),
                url = new URL(req.url());
            if (url.origin !== 'http://127.0.0.1:4173') return route.abort();
            if (url.pathname === '/fetchPartnersData') return route.fulfill({ json: await send('catalog') });
            if (!url.pathname.startsWith('/api/')) return route.continue();
            const [status, json] = await send('request', {
                client,
                path: url.pathname + url.search,
                method: req.method(),
                body: req.postDataJSON(),
                headers: req.headers()
            });
            if (json.bodyBase64)
                return route.fulfill({
                    status,
                    headers: json.headers,
                    body: Buffer.from(json.bodyBase64, 'base64')
                });
            await route.fulfill({ status, json });
        });
        const page = await context.newPage();
        return page;
    }
    return { send, browserPage, close: () => child.stdin.end() };
}
module.exports = { startFixture };
