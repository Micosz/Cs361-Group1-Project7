const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const { createInterface } = require('node:readline');
const path = require('node:path');

const PUBLIC_ROOT = path.resolve(__dirname, '../../public');
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg'
};

async function startFixture() {
    const server = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://127.0.0.1').pathname.replace(/\/$/, '/index.html');
        const file = path.resolve(PUBLIC_ROOT, '.' + pathname);
        if (!file.startsWith(PUBLIC_ROOT + path.sep)) {
            res.writeHead(403).end();
            return;
        }
        fs.readFile(file, (err, data) => {
            if (err) {
                res.writeHead(404).end();
                return;
            }
            res.writeHead(200, {
                'Content-Type': MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
                'Cache-Control': 'no-store'
            }).end(data);
        });
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const baseURL = `http://127.0.0.1:${server.address().port}`;

    const pythonCmd = process.env.PYTHON || 'python3';
    const child = spawn(pythonCmd, [path.join(__dirname, 'driver.py')], {
        stdio: ['pipe', 'pipe', 'inherit']
    });
    let serial = 0;
    const waiting = new Map();
    const failAll = (err) => {
        for (const job of waiting.values()) job.reject(err);
        waiting.clear();
    };
    child.on('error', (err) => failAll(err));
    createInterface({ input: child.stdout }).on('line', (line) => {
        const reply = JSON.parse(line);
        const job = waiting.get(reply.id);
        if (!job) return;
        waiting.delete(reply.id);
        if (reply.error) job.reject(new Error(reply.error));
        else job.resolve(reply.result);
    });
    child.once('exit', (code) => failAll(new Error('Fixture exited: ' + code)));

    function send(op, fields = {}) {
        const id = ++serial;
        return new Promise((resolve, reject) => {
            waiting.set(id, { resolve, reject });
            child.stdin.write(JSON.stringify({ id, op, ...fields }) + '\n');
        });
    }

    async function browserPage(browser, client, options = {}) {
        const context = await browser.newContext({
            baseURL,
            viewport: { width: 1440, height: 1020 },
            timezoneId: 'Asia/Bangkok',
            locale: 'th-TH',
            reducedMotion: 'reduce',
            serviceWorkers: 'block',
            ...options
        });
        await context.route('**/*', async (route) => {
            const req = route.request();
            const url = new URL(req.url());
            if (url.origin !== baseURL) return route.abort();
            if (url.pathname === '/fetchPartnersData') {
                return route.fulfill({ json: await send('catalog') });
            }
            if (!url.pathname.startsWith('/api/')) return route.continue();
            const [status, json] = await send('request', {
                client,
                path: url.pathname + url.search,
                method: req.method(),
                body: req.postData() || '{}',
                headers: req.headers()
            });
            if (json && json.bodyBase64) {
                return route.fulfill({
                    status,
                    headers: json.headers,
                    body: Buffer.from(json.bodyBase64, 'base64')
                });
            }
            return route.fulfill({
                status,
                headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
                body: JSON.stringify(json)
            });
        });
        return context.newPage();
    }

    return {
        baseURL,
        send,
        browserPage,
        close: async () => {
            try { child.stdin.end(); } catch {}
            try { child.kill(); } catch {}
            await new Promise((resolve) => server.close(resolve));
        }
    };
}

module.exports = { startFixture };
