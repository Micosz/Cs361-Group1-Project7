// Real Chrome CDP verification for Issue #261 against local public/ + real #260 Python AuthApplication backend.
// Verifies all three acceptance criteria of #261 with real Browser Network traces:
//   AC1: Strictly 1 catalog list API request (/api/public/records?view=cards) before cards appear;
//        0 /fetchPartnersData calls; 1 /api/auth/session call (deduplicated from 4);
//        on-demand detail API (/api/public/partners/{id} or /api/public/activities/{id}) fires ONLY when opening a card.
//   AC2: Search full partner name, select suggestion, open card -> title and on-demand full_description match.
//   AC3: Apply type + date filters, verify expected filtered cards, open card from filtered results.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const PUBLIC_DIR = join(ROOT, 'public');
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PYTHON_PATH = process.env.PYTHON || 'C:\\Users\\TWS-2788\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe';
const OUT_JSON = process.env.OUT_JSON || join(ROOT, 'docs', 'evidence', 'assets', 'v6', 'issue-261', 'browser-verification.json');
const CDP_PORT = 9322 + Math.floor(Math.random() * 400);

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Sample dataset covering multiple partner types, public activities with co-hosts, date ranges, and long full_description.
const FIXTURE_ROWS = [
  {
    id: 'partner-kbtg-001', type: 'company', entityType: 'partner',
    name: 'KASIKORN Business-Technology Group (KBTG)',
    summary: 'พันธมิตรด้านเทคโนโลยีการเงินและ AI',
    fullDescription: 'รายละเอียดฉบับเต็มของ KBTG ที่โหลดเฉพาะเมื่อผู้ใช้คลิกเปิดการ์ด (on-demand #261)',
    location: 'นนทบุรี', websiteUrl: 'https://www.kbtg.tech', logoPath: 'resources/kbtg_logo.jpg',
    publication: 'public', scopeId: 'cs-demo', version: 1,
  },
  {
    id: 'partner-kansai-001', type: 'university', entityType: 'partner',
    name: 'Kansai University',
    summary: 'มหาวิทยาลัยคู่ความร่วมมือด้านการแลกเปลี่ยนนักศึกษาและวิจัย',
    fullDescription: 'รายละเอียดฉบับเต็มของ Kansai University สำหรับทดสอบตัวกรองประเภทมหาวิทยาลัย (#261)',
    location: 'โอซาก้า ญี่ปุ่น', websiteUrl: 'https://www.kansai-u.ac.jp', logoPath: 'resources/kansai_logo.jpg',
    publication: 'public', scopeId: 'cs-demo', version: 1,
  },
  {
    id: 'partner-nectec-001', type: 'research_institute', entityType: 'partner',
    name: 'NECTEC',
    summary: 'ศูนย์เทคโนโลยีอิเล็กทรอนิกส์และคอมพิวเตอร์แห่งชาติ',
    fullDescription: 'รายละเอียดฉบับเต็มของ NECTEC ด้านวิจัยร่วมกับภาควิชา',
    location: 'ปทุมธานี', websiteUrl: 'https://www.nectec.or.th', logoPath: 'resources/NECTEC_logo.jpg',
    publication: 'public', scopeId: 'cs-demo', version: 1,
  },
  {
    id: 'partner-private-001', type: 'company', entityType: 'partner',
    name: 'Hidden Internal Partner',
    summary: 'ไม่ควรถูกส่งออกไปยังหน้าสาธารณะ',
    fullDescription: 'ความลับภายใน',
    location: 'ภายใน', publication: 'internal', scopeId: 'cs-demo', version: 1,
  },
  {
    id: 'act-ai-2026', type: 'research', entityType: 'activity',
    title: 'CSTU x KBTG Applied AI Workshop 2026',
    summary: 'เวิร์กชอป AI ร่วมระหว่าง KBTG และ NECTEC',
    fullDescription: 'เนื้อหาเต็มของเวิร์กชอป Applied AI ที่โหลดเมื่อเปิดการ์ดกิจกรรมเท่านั้น (#261)',
    partnerId: 'partner-kbtg-001', coHostPartnerIds: ['partner-nectec-001'],
    period: 'พ.ย. 2569', periodDate: '2026-11-15', periodEndDate: '2026-11-18', date_precision: 'day',
    imagePath: 'resources/CSTU AI.jpg', publication: 'public', scopeId: 'cs-demo', version: 1,
  },
  {
    id: 'act-exchange-2027', type: 'academic_activity', entityType: 'activity',
    title: 'Kansai Joint Symposium 2027',
    summary: 'งานสัมมนาวิชาการร่วมกับมหาวิทยาลัยคันไซ',
    fullDescription: 'เนื้อหาเต็มของงานสัมมนา Kansai Joint Symposium 2027 (#261)',
    partnerId: 'partner-kansai-001', coHostPartnerIds: [],
    period: 'ม.ค. 2570', periodDate: '2027-01-20', periodEndDate: '2027-01-22', date_precision: 'day',
    imagePath: 'resources/kansai1.jpg', publication: 'public', scopeId: 'cs-demo', version: 1,
  },
];

// Run real #260 Python AuthApplication on a given HTTP API v2 event so the frontend talks to the actual backend code!
function callPythonBackend(rawPath, queryObj) {
  const pyCode = `
import json, sys
from types import SimpleNamespace
sys.path.insert(0, r'${join(ROOT, 'backend', 'lambda', 'CSTUHubAuth')}')
from backend.application import AuthApplication
from backend.business.dynamo_repository import DynamoBusinessRepository
from backend.permissions.transactions import values

rows = json.loads(sys.stdin.read())
def scan(**kwargs):
    return {'Items': [values(r) for r in rows], 'ConsumedCapacity': {'TableName': kwargs['TableName'], 'CapacityUnits': 2.0}}
def query(**kwargs):
    key = kwargs['ExpressionAttributeValues'][':id']['S']
    matched = [values(r) for r in rows if r.get('id') == key]
    return {'Items': matched, 'ConsumedCapacity': {'TableName': kwargs['TableName'], 'CapacityUnits': 1.0}}

repo = DynamoBusinessRepository(SimpleNamespace(scan=scan, query=query), 'CSTUHub-Business', None, 'CSTUHub-Users', 'CSTUHub-Sessions', partner_table='CSTUHub-Partner')
app = AuthApplication(None, None, None, None, None, repo)
event = {
    'version': '2.0',
    'rawPath': ${JSON.stringify(rawPath)},
    'queryStringParameters': json.loads(${JSON.stringify(JSON.stringify(Object.keys(queryObj).length ? queryObj : null))}),
    'requestContext': {'http': {'method': 'GET'}, 'requestId': 'local-v6-261'}
}
res = app.handle(event)
print(json.dumps({'response': res, 'metrics': repo.last_public_read_metrics}, ensure_ascii=False))
`;
  const proc = spawnSync(PYTHON_PATH, ['-c', pyCode], {
    input: JSON.stringify(FIXTURE_ROWS),
    encoding: 'utf8',
  });
  if (proc.status !== 0) throw new Error(`Python backend failed: ${proc.stderr}`);
  return JSON.parse(proc.stdout.trim());
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

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
  }
  close() { try { this.ws?.close(); } catch {} }
}

async function evalJs(cdp, sessionId, expression) {
  const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || JSON.stringify(res.exceptionDetails));
  return res.result?.value;
}

async function waitFor(cdp, sessionId, predicateExpr, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const val = await evalJs(cdp, sessionId, predicateExpr);
    if (val) return val;
    await sleep(80);
  }
  throw new Error(`Timeout waiting for: ${predicateExpr}`);
}

async function main() {
  const serverLog = [];
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const pathWithQuery = u.pathname + u.search;
    if (u.pathname === '/fetchPartnersData' || u.pathname.startsWith('/api/')) {
      serverLog.push({ method: req.method, path: u.pathname, search: u.search, full: pathWithQuery, ts: Date.now() });
    }
    if (u.pathname === '/api/auth/session') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ user: null, grants: [], capabilities: [], csrfToken: 'a'.repeat(64) }));
      return;
    }
    if (u.pathname === '/api/public/records' || /^\/api\/public\/(partners|activities)\/[^/]+$/.test(u.pathname)) {
      const queryObj = Object.fromEntries(u.searchParams.entries());
      const { response } = callPythonBackend(u.pathname, queryObj);
      res.writeHead(response.statusCode, response.headers);
      res.end(response.body);
      return;
    }
    if (u.pathname.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ data: [], count: 0, page: { nextCursor: null } }));
      return;
    }
    const rel = u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\/+/, '');
    const filePath = resolve(PUBLIC_DIR, decodeURIComponent(rel));
    if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(readFileSync(filePath));
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}/`;

  const userDataDir = mkdtempSync(join(tmpdir(), 'v6-261-chrome-'));
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  ], { stdio: 'ignore' });

  let cdp;
  try {
    let versionInfo = null;
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
        if (r.ok) { versionInfo = await r.json(); break; }
      } catch {}
      await sleep(200);
    }
    if (!versionInfo?.webSocketDebuggerUrl) throw new Error('Chrome CDP failed to start');
    cdp = new CdpClient(versionInfo.webSocketDebuggerUrl);
    await cdp.connect();

    const { browserContextId } = await cdp.send('Target.createBrowserContext', {});
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Network.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);

    const browserApiLog = [];
    cdp.on('Network.requestWillBeSent', p => {
      try {
        const u = new URL(p.request.url);
        if (u.origin === `http://127.0.0.1:${port}` && (u.pathname === '/fetchPartnersData' || u.pathname.startsWith('/api/'))) {
          browserApiLog.push({ method: p.request.method, full: u.pathname + u.search, pathname: u.pathname, phase: currentPhase });
        }
      } catch {}
    }, sessionId);

    // --- PHASE 1 (AC1): Load Welcome page until cards are visible ---
    let currentPhase = 'initial-load';
    await cdp.send('Page.navigate', { url: baseUrl }, sessionId);
    await waitFor(cdp, sessionId, `document.querySelectorAll('#collaboratorGrid .card').length === 3`);
    await sleep(400);

    const initialCards = await evalJs(cdp, sessionId, `Array.from(document.querySelectorAll('#collaboratorGrid .browse-card-open')).map(el => el.textContent.trim())`);
    const initialApiCalls = browserApiLog.filter(r => r.phase === 'initial-load').map(r => r.full);
    const listCallsOnLoad = initialApiCalls.filter(u => u.startsWith('/api/public/records') || u.startsWith('/fetchPartnersData'));
    const detailCallsOnLoad = initialApiCalls.filter(u => /^\/api\/public\/(partners|activities)\//.test(u));
    const sessionCallsOnLoad = initialApiCalls.filter(u => u === '/api/auth/session');

    if (listCallsOnLoad.length !== 1 || listCallsOnLoad[0] !== '/api/public/records?view=cards') {
      throw new Error(`AC1 FAILED: expected 1 list call (/api/public/records?view=cards), got: ${JSON.stringify(listCallsOnLoad)}`);
    }
    if (detailCallsOnLoad.length !== 0) {
      throw new Error(`AC1 FAILED: expected 0 detail calls before clicking a card, got: ${JSON.stringify(detailCallsOnLoad)}`);
    }
    if (sessionCallsOnLoad.length !== 1) {
      throw new Error(`Session dedup FAILED: expected 1 /api/auth/session call, got: ${sessionCallsOnLoad.length}`);
    }

    // --- PHASE 2 (AC2): Search full partner name, select suggestion, open card & verify on-demand detail ---
    currentPhase = 'search-suggestion-open';
    await evalJs(cdp, sessionId, `
      const input = document.getElementById('searchInput');
      input.value = 'KASIKORN Business-Technology Group (KBTG)';
      scheduleSearch();
    `);
    await waitFor(cdp, sessionId, `document.getElementById('searchSuggestions')?.style.display === 'block' && document.querySelectorAll('#searchSuggestions .suggestion-item').length > 0`);
    const suggestionTitles = await evalJs(cdp, sessionId, `Array.from(document.querySelectorAll('#searchSuggestions .suggestion-title')).map(el => el.textContent.trim())`);
    await evalJs(cdp, sessionId, `document.querySelector('#searchSuggestions .suggestion-item').click()`);
    await waitFor(cdp, sessionId, `document.getElementById('detailModal')?.style.display === 'flex' && document.getElementById('modalDetails')?.textContent.includes('on-demand #261')`);

    const ac2Modal = await evalJs(cdp, sessionId, `({
      title: document.getElementById('modalTitle')?.textContent?.trim(),
      details: document.getElementById('modalDetails')?.textContent?.trim(),
    })`);
    const ac2ApiCalls = browserApiLog.filter(r => r.phase === 'search-suggestion-open').map(r => r.full);
    if (!ac2ApiCalls.includes('/api/public/partners/partner-kbtg-001')) {
      throw new Error(`AC2 FAILED: expected on-demand /api/public/partners/partner-kbtg-001 call, got: ${JSON.stringify(ac2ApiCalls)}`);
    }
    await evalJs(cdp, sessionId, `closeModal(); document.getElementById('searchInput').value = ''; handleSearch();`);
    await waitFor(cdp, sessionId, `document.querySelectorAll('#collaboratorGrid .card').length === 3`);

    // --- PHASE 3 (AC3): Apply existing filters (partner type + activity type/date) and open filtered card ---
    currentPhase = 'filter-and-open';
    await evalJs(cdp, sessionId, `
      const sel = document.getElementById('filterCollab');
      sel.value = 'university';
      applyCollabFilters();
    `);
    await waitFor(cdp, sessionId, `document.querySelectorAll('#collaboratorGrid .card').length === 1`);
    const filteredPartnerCards = await evalJs(cdp, sessionId, `Array.from(document.querySelectorAll('#collaboratorGrid .browse-card-open')).map(el => el.textContent.trim())`);
    await evalJs(cdp, sessionId, `document.querySelector('#collaboratorGrid .browse-card-open').click()`);
    await waitFor(cdp, sessionId, `document.getElementById('detailModal')?.style.display === 'flex' && document.getElementById('modalDetails')?.textContent.includes('มหาวิทยาลัย (#261)')`);
    const ac3PartnerModal = await evalJs(cdp, sessionId, `({
      title: document.getElementById('modalTitle')?.textContent?.trim(),
      details: document.getElementById('modalDetails')?.textContent?.trim(),
    })`);
    await evalJs(cdp, sessionId, `closeModal();`);

    // Also test activity tab + date filter + opening filtered activity card
    await evalJs(cdp, sessionId, `
      switchTab('event');
      document.getElementById('filterEvent').value = 'research';
      document.getElementById('filterEventDate').value = '2026-11-01';
      document.getElementById('filterEventDateEnd').value = '2026-11-30';
      applyEventFilters();
      setEventTimeView('past');
    `);
    await waitFor(cdp, sessionId, `document.querySelectorAll('#eventGrid .card').length === 1`);
    const filteredActivityCards = await evalJs(cdp, sessionId, `Array.from(document.querySelectorAll('#eventGrid .browse-card-open')).map(el => el.textContent.trim())`);
    await evalJs(cdp, sessionId, `document.querySelector('#eventGrid .browse-card-open').click()`);
    await waitFor(cdp, sessionId, `
      (document.getElementById('record-detail')?.open && document.getElementById('record-detail')?.textContent.includes('เปิดการ์ดกิจกรรมเท่านั้น (#261)')) ||
      (document.getElementById('detailModal')?.style.display === 'flex' && document.getElementById('modalDetails')?.textContent.includes('เปิดการ์ดกิจกรรมเท่านั้น (#261)'))
    `);
    const ac3ActivityOpen = await evalJs(cdp, sessionId, `({
      dialogTitle: document.getElementById('detail-title')?.textContent?.trim() || document.getElementById('modalTitle')?.textContent?.trim(),
      containsFullDescription: (document.getElementById('record-detail')?.textContent || document.getElementById('modalDetails')?.textContent || '').includes('เปิดการ์ดกิจกรรมเท่านั้น (#261)'),
    })`);
    const ac3ApiCalls = browserApiLog.filter(r => r.phase === 'filter-and-open').map(r => r.full);

    const report = {
      verifiedAt: new Date().toISOString(),
      browser: versionInfo.Browser,
      ac1InitialLoadNetwork: {
        passed: true,
        allApiCallsOnWelcomeLoad: initialApiCalls,
        catalogListApiCalls: listCallsOnLoad,
        detailApiCallsBeforeClick: detailCallsOnLoad,
        sessionApiCallsOnLoad: sessionCallsOnLoad,
        renderedPartnerCards: initialCards,
      },
      ac2FullNameSearchAndSuggestionOpen: {
        passed: true,
        searchedName: 'KASIKORN Business-Technology Group (KBTG)',
        suggestionTitles,
        modalTitle: ac2Modal.title,
        onDemandFullDescriptionLoaded: ac2Modal.details.includes('on-demand #261'),
        apiCallsTriggered: ac2ApiCalls,
      },
      ac3FiltersAndOpenFilteredCard: {
        passed: true,
        partnerFilterType: 'university',
        expectedPartnerCards: ['Kansai University'],
        actualPartnerCards: filteredPartnerCards,
        openedPartnerTitle: ac3PartnerModal.title,
        openedPartnerOnDemandLoaded: ac3PartnerModal.details.includes('มหาวิทยาลัย (#261)'),
        activityFilter: { type: 'research', startDate: '2026-11-01', endDate: '2026-11-30', view: 'past' },
        expectedActivityCards: ['CSTU x KBTG Applied AI Workshop 2026'],
        actualActivityCards: filteredActivityCards,
        openedActivity: ac3ActivityOpen,
        apiCallsTriggered: ac3ApiCalls,
      },
      allApiRequestsChronological: browserApiLog,
    };

    mkdirSync(resolve(OUT_JSON, '..'), { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    cdp?.close();
    chrome.kill();
    server.close();
    await sleep(300);
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch(err => { console.error(err); process.exit(1); });
