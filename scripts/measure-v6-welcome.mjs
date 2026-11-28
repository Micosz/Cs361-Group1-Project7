// Reproducible Welcome page performance & Network benchmark using Chrome DevTools Protocol (CDP).
// Uses Node.js 24 built-in fetch + WebSocket and local Google Chrome (no external dependencies).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TARGET_URL = process.env.TARGET_URL || 'https://main.d1d0za87xu48iv.amplifyapp.com/';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const COLD_RUNS = Number(process.env.COLD_RUNS || 10);
const WARM_RUNS = Number(process.env.WARM_RUNS || 10);
const CONCURRENT_USERS = Number(process.env.CONCURRENT_USERS || 3);
const CONCURRENT_ROUNDS = Number(process.env.CONCURRENT_ROUNDS || 3);
const MAIN_SHA = process.env.MAIN_SHA || '13d21921cf82ea8532fa484ce8efc8244c000623';
import { fileURLToPath } from 'node:url';
const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const OUT_JSON = process.env.OUT_JSON || join(SCRIPT_DIR, '..', 'docs', 'evidence', 'assets', 'v6', 'issue-259', 'baseline-58a40f8.json');
const PORT = Number(process.env.CDP_PORT || (9222 + Math.floor(Math.random() * 500)));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function stats(values) {
  const nums = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return {
    n: nums.length,
    min: Number(Math.min(...nums).toFixed(1)),
    p50: Number(percentile(nums, 50).toFixed(1)),
    p95: Number(percentile(nums, 95).toFixed(1)),
    max: Number(Math.max(...nums).toFixed(1)),
    avg: Number((sum / nums.length).toFixed(1)),
  };
}

async function verifyDeploymentMatch() {
  const ghUrl = `https://raw.githubusercontent.com/Micosz/Cs361-Group1-Project7/${MAIN_SHA}/public/index.html`;
  const [ghRes, liveRes, fetchRes, pubRes] = await Promise.all([
    fetch(ghUrl, { cache: 'no-store' }),
    fetch(TARGET_URL, { cache: 'no-store' }),
    fetch(new URL('/fetchPartnersData', TARGET_URL), { cache: 'no-store' }),
    fetch(new URL('/api/public/records', TARGET_URL), { cache: 'no-store' }),
  ]);
  const ghHtml = await ghRes.text();
  const liveHtml = await liveRes.text();
  const ghNorm = ghHtml.replace(/\r\n/g, '\n');
  const liveNorm = liveHtml.replace(/\r\n/g, '\n');
  const ghLines = ghNorm.split('\n');
  const liveLines = liveNorm.split('\n');
  const diffs = [];
  for (let i = 0; i < Math.max(ghLines.length, liveLines.length); i++) {
    if (ghLines[i] !== liveLines[i]) {
      diffs.push({ line: i + 1, gh: ghLines[i] ?? null, live: liveLines[i] ?? null });
      if (diffs.length >= 10) break;
    }
  }
  const fetchText = await fetchRes.text();
  const pubText = await pubRes.text();
  const fetchJson = JSON.parse(fetchText);
  const pubJson = JSON.parse(pubText);
  const fetchIds = new Set(fetchJson.map(r => r.id));
  const pubIds = new Set(pubJson.map(r => r.id));
  const overlap = [...fetchIds].filter(id => pubIds.has(id)).length;
  const partners = fetchJson.filter(r => r.name);
  const activities = fetchJson.filter(r => r.partnerId);

  // Compare field differences between the two endpoints for the same IDs
  const pubById = new Map(pubJson.map(r => [r.id, r]));
  const onlyInFetchFields = new Set();
  const onlyInPubFields = new Set();
  for (const r of fetchJson) {
    const p = pubById.get(r.id);
    if (!p) continue;
    for (const k of Object.keys(r)) if (!(k in p)) onlyInFetchFields.add(k);
    for (const k of Object.keys(p)) if (!(k in r)) onlyInPubFields.add(k);
  }

  return {
    mainSha: MAIN_SHA,
    liveUrl: TARGET_URL,
    indexExactMatchAfterLfNormalize: ghNorm === liveNorm,
    ghSha256: sha256(ghNorm).slice(0, 12),
    liveSha256: sha256(liveNorm).slice(0, 12),
    indexDiffSample: diffs,
    dataset: {
      fetchPartnersData: {
        status: fetchRes.status,
        records: fetchJson.length,
        partners: partners.length,
        activities: activities.length,
        bytes: Buffer.byteLength(fetchText, 'utf8'),
        cacheControl: fetchRes.headers.get('cache-control'),
        contentEncoding: fetchRes.headers.get('content-encoding'),
      },
      apiPublicRecords: {
        status: pubRes.status,
        records: pubJson.length,
        partners: pubJson.filter(r => r.name).length,
        activities: pubJson.filter(r => r.partnerId).length,
        bytes: Buffer.byteLength(pubText, 'utf8'),
        cacheControl: pubRes.headers.get('cache-control'),
        contentEncoding: pubRes.headers.get('content-encoding'),
      },
      overlapIds: overlap,
      onlyInFetchPartnersData: [...fetchIds].filter(id => !pubIds.has(id)),
      onlyInApiPublicRecords: [...pubIds].filter(id => !fetchIds.has(id)),
      onlyInFetchFields: [...onlyInFetchFields].sort(),
      onlyInPubFields: [...onlyInPubFields].sort(),
    },
  };
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
          else p.resolve(msg.result);
        }
      } else if (msg.method) {
        const key = `${msg.sessionId || ''}:${msg.method}`;
        for (const fn of this.listeners.get(key) || []) fn(msg.params);
        for (const fn of this.listeners.get(`*:${msg.method}`) || []) fn(msg.params, msg.sessionId);
      }
    });
  }
  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }
  on(method, fn, sessionId = '') {
    const key = `${sessionId}:${method}`;
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    this.listeners.get(key).push(fn);
    return () => {
      const arr = this.listeners.get(key);
      if (arr) this.listeners.set(key, arr.filter(x => x !== fn));
    };
  }
  close() {
    try { this.ws?.close(); } catch {}
  }
}

const CARD_OBSERVER_SCRIPT = `
(() => {
  window.__v6Perf = {
    firstCardMs: null,
    cardsSettledMs: null,
    partnerCardCount: 0,
    eventCardCount: 0,
    domContentLoadedMs: null,
    loadEventMs: null,
    errors: [],
  };
  const check = () => {
    const pCards = document.querySelectorAll('#collaboratorGrid .card');
    const eCards = document.querySelectorAll('#eventGrid .card');
    if (pCards.length > 0 && window.__v6Perf.firstCardMs === null) {
      window.__v6Perf.firstCardMs = performance.now();
    }
    if (pCards.length > 0) {
      window.__v6Perf.partnerCardCount = pCards.length;
      window.__v6Perf.eventCardCount = eCards.length;
      window.__v6Perf.cardsSettledMs = performance.now();
    }
  };
  document.addEventListener('DOMContentLoaded', () => {
    window.__v6Perf.domContentLoadedMs = performance.now();
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { childList: true, subtree: true });
  });
  window.addEventListener('load', () => {
    window.__v6Perf.loadEventMs = performance.now();
    check();
  });
  window.addEventListener('error', e => window.__v6Perf.errors.push(String(e.message || e)));
})();
`;

function classifyUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.pathname === '/fetchPartnersData') return { isApi: true, apiKey: 'GET /fetchPartnersData' };
    if (u.pathname.startsWith('/api/')) return { isApi: true, apiKey: `API ${u.pathname}` };
    return { isApi: false, apiKey: null };
  } catch {
    return { isApi: false, apiKey: null };
  }
}

async function measureOneLoad(cdp, { browserContextId = null, clearCache = false, clearCookies = false, label = '' }) {
  const { targetId } = await cdp.send('Target.createTarget', {
    url: 'about:blank',
    ...(browserContextId ? { browserContextId } : {}),
  });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  try {
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Network.enable', { maxTotalBufferSize: 10 * 1024 * 1024 }, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    }, sessionId);
    if (clearCache) await cdp.send('Network.clearBrowserCache', {}, sessionId);
    if (clearCookies) await cdp.send('Network.clearBrowserCookies', {}, sessionId);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: CARD_OBSERVER_SCRIPT }, sessionId);

    const requests = new Map();
    let navWallStart = null;
    let navMonoStart = null;

    const unsubs = [
      cdp.on('Network.requestWillBeSent', p => {
        if (navMonoStart === null && p.type === 'Document') {
          navMonoStart = p.timestamp;
          navWallStart = p.wallTime;
        }
        requests.set(p.requestId, {
          requestId: p.requestId,
          url: p.request.url,
          method: p.request.method,
          type: p.type,
          startTs: p.timestamp,
          status: null,
          fromDiskCache: false,
          fromMemoryCache: false,
          encodedDataLength: 0,
          timing: null,
          endTs: null,
          failed: false,
          errorText: null,
        });
      }, sessionId),
      cdp.on('Network.responseReceived', p => {
        const rec = requests.get(p.requestId);
        if (!rec) return;
        rec.status = p.response.status;
        rec.fromDiskCache = Boolean(p.response.fromDiskCache);
        rec.fromMemoryCache = Boolean(p.response.fromMemoryCache);
        rec.timing = p.response.timing || null;
        rec.mimeType = p.response.mimeType;
        rec.cacheControl = p.response.headers?.['cache-control'] || p.response.headers?.['Cache-Control'] || null;
      }, sessionId),
      cdp.on('Network.loadingFinished', p => {
        const rec = requests.get(p.requestId);
        if (!rec) return;
        rec.endTs = p.timestamp;
        rec.encodedDataLength = p.encodedDataLength;
      }, sessionId),
      cdp.on('Network.loadingFailed', p => {
        const rec = requests.get(p.requestId);
        if (!rec) return;
        rec.endTs = p.timestamp;
        rec.failed = true;
        rec.errorText = p.errorText;
      }, sessionId),
    ];

    const t0 = performance.now();
    await cdp.send('Page.navigate', { url: TARGET_URL }, sessionId);

    // Wait until cards are rendered AND network settles (no pending API calls) or 20s timeout
    let perfData = null;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const evalRes = await cdp.send('Runtime.evaluate', {
        expression: `JSON.stringify({
          perf: window.__v6Perf || null,
          readyState: document.readyState,
          nav: performance.getEntriesByType('navigation')[0] ? {
            ttfb: performance.getEntriesByType('navigation')[0].responseStart,
            dcl: performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd,
            load: performance.getEntriesByType('navigation')[0].loadEventEnd,
          } : null,
          fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
        })`,
        returnByValue: true,
      }, sessionId);
      if (evalRes?.result?.value) {
        perfData = JSON.parse(evalRes.result.value);
        const pendingApi = [...requests.values()].some(r => classifyUrl(r.url).isApi && r.endTs === null);
        if (perfData.perf?.firstCardMs !== null && perfData.readyState === 'complete' && !pendingApi) {
          // Small settle window (350ms) to catch any trailing API calls fired on load
          await sleep(350);
          const pendingApiAfter = [...requests.values()].some(r => classifyUrl(r.url).isApi && r.endTs === null);
          if (!pendingApiAfter) break;
        }
      }
      await sleep(100);
    }
    const wallElapsedMs = performance.now() - t0;
    for (const u of unsubs) u();

    const originTs = navMonoStart ?? Math.min(...[...requests.values()].map(r => r.startTs));
    const reqList = [...requests.values()].map(r => {
      const { isApi, apiKey } = classifyUrl(r.url);
      const startRelMs = Number(((r.startTs - originTs) * 1000).toFixed(1));
      const endRelMs = r.endTs ? Number(((r.endTs - originTs) * 1000).toFixed(1)) : null;
      const totalMs = r.endTs ? Number(((r.endTs - r.startTs) * 1000).toFixed(1)) : null;
      let ttfbMs = null;
      if (r.timing && r.timing.receiveHeadersEnd >= 0 && r.timing.sendEnd >= 0) {
        ttfbMs = Number((r.timing.receiveHeadersEnd - r.timing.sendEnd).toFixed(1));
      }
      return {
        url: r.url,
        pathname: (() => { try { return new URL(r.url).pathname; } catch { return r.url; } })(),
        method: r.method,
        type: r.type,
        isApi,
        apiKey,
        status: r.status,
        cached: r.fromDiskCache || r.fromMemoryCache,
        fromDiskCache: r.fromDiskCache,
        fromMemoryCache: r.fromMemoryCache,
        bytes: r.encodedDataLength,
        startRelMs,
        endRelMs,
        totalMs,
        ttfbMs,
        failed: r.failed,
        errorText: r.errorText,
        cacheControl: r.cacheControl,
      };
    });

    const apiReqs = reqList.filter(r => r.isApi);
    const networkReqs = reqList.filter(r => !r.cached);
    const totalTransferBytes = reqList.reduce((sum, r) => sum + (r.bytes || 0), 0);

    return {
      label,
      wallElapsedMs: Number(wallElapsedMs.toFixed(1)),
      ttfbDocMs: perfData?.nav?.ttfb ? Number(perfData.nav.ttfb.toFixed(1)) : null,
      fcpMs: perfData?.fcp ? Number(perfData.fcp.toFixed(1)) : null,
      domContentLoadedMs: perfData?.perf?.domContentLoadedMs ? Number(perfData.perf.domContentLoadedMs.toFixed(1)) : null,
      firstCardMs: perfData?.perf?.firstCardMs ? Number(perfData.perf.firstCardMs.toFixed(1)) : null,
      cardsSettledMs: perfData?.perf?.cardsSettledMs ? Number(perfData.perf.cardsSettledMs.toFixed(1)) : null,
      loadEventMs: perfData?.nav?.load ? Number(perfData.nav.load.toFixed(1)) : null,
      partnerCardCount: perfData?.perf?.partnerCardCount ?? 0,
      eventCardCount: perfData?.perf?.eventCardCount ?? 0,
      totalRequests: reqList.length,
      networkRequests: networkReqs.length,
      cachedRequests: reqList.length - networkReqs.length,
      apiRequestCount: apiReqs.length,
      totalTransferBytes,
      apiTransferBytes: apiReqs.reduce((s, r) => s + (r.bytes || 0), 0),
      non200Api: apiReqs.filter(r => r.status !== 200 || r.failed).map(r => ({ pathname: r.pathname, status: r.status, errorText: r.errorText })),
      apiRequests: apiReqs,
      allRequests: reqList,
    };
  } finally {
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
  }
}

function summarizeGroup(runs) {
  const apiByPath = new Map();
  for (const run of runs) {
    for (const r of run.apiRequests) {
      const key = `${r.method} ${r.pathname}`;
      if (!apiByPath.has(key)) apiByPath.set(key, []);
      apiByPath.get(key).push(r);
    }
  }
  const perEndpoint = {};
  for (const [key, list] of apiByPath.entries()) {
    perEndpoint[key] = {
      totalCalls: list.length,
      callsPerLoad: Number((list.length / runs.length).toFixed(2)),
      non200: list.filter(r => r.status !== 200 || r.failed).length,
      totalMs: stats(list.map(r => r.totalMs)),
      ttfbMs: stats(list.map(r => r.ttfbMs)),
      startRelMs: stats(list.map(r => r.startRelMs)),
      endRelMs: stats(list.map(r => r.endRelMs)),
      bytes: stats(list.map(r => r.bytes)),
    };
  }
  const allApiDurations = runs.flatMap(r => r.apiRequests.map(a => a.totalMs));
  return {
    runs: runs.length,
    firstCardMs: stats(runs.map(r => r.firstCardMs)),
    fcpMs: stats(runs.map(r => r.fcpMs)),
    domContentLoadedMs: stats(runs.map(r => r.domContentLoadedMs)),
    loadEventMs: stats(runs.map(r => r.loadEventMs)),
    ttfbDocMs: stats(runs.map(r => r.ttfbDocMs)),
    allApiDurationMs: stats(allApiDurations),
    totalRequests: stats(runs.map(r => r.totalRequests)),
    networkRequests: stats(runs.map(r => r.networkRequests)),
    cachedRequests: stats(runs.map(r => r.cachedRequests)),
    apiRequestCount: stats(runs.map(r => r.apiRequestCount)),
    totalTransferKB: stats(runs.map(r => Number((r.totalTransferBytes / 1024).toFixed(1)))),
    partnerCardCount: stats(runs.map(r => r.partnerCardCount)),
    non200ApiTotal: runs.reduce((s, r) => s + r.non200Api.length, 0),
    perEndpoint,
  };
}

async function main() {
  console.log('1) Verifying deployment SHA and dataset...');
  const deployment = await verifyDeploymentMatch();
  console.log('   index match (LF normalized):', deployment.indexExactMatchAfterLfNormalize);
  console.log('   fetchPartnersData:', deployment.dataset.fetchPartnersData.records, 'records,', deployment.dataset.fetchPartnersData.bytes, 'bytes');
  console.log('   /api/public/records:', deployment.dataset.apiPublicRecords.records, 'records,', deployment.dataset.apiPublicRecords.bytes, 'bytes');
  console.log('   overlap IDs:', deployment.dataset.overlapIds);

  const userDataDir = mkdtempSync(join(tmpdir(), 'v6-chrome-'));
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-background-networking',
  ], { stdio: 'ignore' });

  let cdp;
  try {
    let versionInfo = null;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
        if (res.ok) { versionInfo = await res.json(); break; }
      } catch {}
      await sleep(250);
    }
    if (!versionInfo?.webSocketDebuggerUrl) throw new Error('Chrome CDP failed to start');
    console.log('2) Chrome started:', versionInfo.Browser);

    cdp = new CdpClient(versionInfo.webSocketDebuggerUrl);
    await cdp.connect();

    // --- Cold cache runs (fresh BrowserContext each time, cache & cookies cleared) ---
    console.log(`3) Running ${COLD_RUNS} Cold Cache loads...`);
    const coldRuns = [];
    for (let i = 1; i <= COLD_RUNS; i++) {
      const { browserContextId } = await cdp.send('Target.createBrowserContext', {});
      try {
        const res = await measureOneLoad(cdp, {
          browserContextId, clearCache: true, clearCookies: true, label: `cold-${i}`,
        });
        coldRuns.push(res);
        console.log(`   [cold-${i}] firstCard=${res.firstCardMs}ms, totalReqs=${res.totalRequests} (net=${res.networkRequests}), apiReqs=${res.apiRequestCount}, transfer=${(res.totalTransferBytes/1024).toFixed(1)}KB`);
      } finally {
        await cdp.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
      }
      await sleep(1200);
    }

    // --- Warm cache runs (1 persistent BrowserContext: 1 priming load + WARM_RUNS measured loads) ---
    console.log(`4) Running 1 priming load + ${WARM_RUNS} Warm Cache loads...`);
    const warmRuns = [];
    const { browserContextId: warmCtx } = await cdp.send('Target.createBrowserContext', {});
    try {
      await measureOneLoad(cdp, { browserContextId: warmCtx, clearCache: false, clearCookies: false, label: 'warm-prime' });
      await sleep(1200);
      for (let i = 1; i <= WARM_RUNS; i++) {
        const res = await measureOneLoad(cdp, {
          browserContextId: warmCtx, clearCache: false, clearCookies: false, label: `warm-${i}`,
        });
        warmRuns.push(res);
        console.log(`   [warm-${i}] firstCard=${res.firstCardMs}ms, totalReqs=${res.totalRequests} (net=${res.networkRequests}, cached=${res.cachedRequests}), apiReqs=${res.apiRequestCount}, transfer=${(res.totalTransferBytes/1024).toFixed(1)}KB`);
        await sleep(1200);
      }
    } finally {
      await cdp.send('Target.disposeBrowserContext', { browserContextId: warmCtx }).catch(() => {});
    }

    // --- Concurrent users (CONCURRENT_USERS cold contexts opening simultaneously x CONCURRENT_ROUNDS) ---
    console.log(`5) Running ${CONCURRENT_ROUNDS} rounds x ${CONCURRENT_USERS} concurrent cold users...`);
    const concurrentRuns = [];
    for (let round = 1; round <= CONCURRENT_ROUNDS; round++) {
      const ctxIds = [];
      for (let u = 0; u < CONCURRENT_USERS; u++) {
        const { browserContextId } = await cdp.send('Target.createBrowserContext', {});
        ctxIds.push(browserContextId);
      }
      try {
        const batch = await Promise.all(ctxIds.map((ctxId, idx) =>
          measureOneLoad(cdp, {
            browserContextId: ctxId, clearCache: true, clearCookies: true,
            label: `conc-r${round}-u${idx + 1}`,
          })
        ));
        concurrentRuns.push(...batch);
        console.log(`   [round-${round}] firstCard=${batch.map(b => b.firstCardMs + 'ms').join(', ')} | non200=${batch.reduce((s, b) => s + b.non200Api.length, 0)}`);
      } finally {
        for (const ctxId of ctxIds) {
          await cdp.send('Target.disposeBrowserContext', { browserContextId: ctxId }).catch(() => {});
        }
      }
      await sleep(2500);
    }

    const report = {
      measuredAt: new Date().toISOString(),
      environment: {
        browser: versionInfo.Browser,
        userAgent: versionInfo['User-Agent'],
        viewport: '1440x900',
        network: 'Unthrottled broadband (Thailand -> AWS ap-southeast-1 Singapore)',
        coldRuns: COLD_RUNS,
        warmRuns: WARM_RUNS,
        concurrentUsers: CONCURRENT_USERS,
        concurrentRounds: CONCURRENT_ROUNDS,
      },
      deployment,
      summary: {
        cold: summarizeGroup(coldRuns),
        warm: summarizeGroup(warmRuns),
        concurrent: summarizeGroup(concurrentRuns),
      },
      sampleColdWaterfall: coldRuns[Math.floor(coldRuns.length / 2)]?.allRequests
        .sort((a, b) => a.startRelMs - b.startRelMs),
      sampleWarmWaterfall: warmRuns[Math.floor(warmRuns.length / 2)]?.allRequests
        .sort((a, b) => a.startRelMs - b.startRelMs),
      raw: {
        cold: coldRuns.map(({ allRequests, ...rest }) => rest),
        warm: warmRuns.map(({ allRequests, ...rest }) => rest),
        concurrent: concurrentRuns.map(({ allRequests, ...rest }) => rest),
      },
    };

    writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');
    console.log('\nSaved full results to:', OUT_JSON);
    console.log('\n=== SUMMARY ===');
    console.log(JSON.stringify(report.summary, null, 2));
  } finally {
    cdp?.close();
    chrome.kill();
    await sleep(400);
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

