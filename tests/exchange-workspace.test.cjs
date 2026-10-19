const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('workspace HTML contains unified exchange section and dialog form', () => {
    const workspaceHtml = fs.readFileSync(path.join(__dirname, '../public/workspace.html'), 'utf8');

    // Section elements
    assert.match(workspaceHtml, /id="exchange-section"/);
    assert.match(workspaceHtml, /id="open-add-exchange"/);
    assert.match(workspaceHtml, /id="exchange-list"/);
    assert.match(workspaceHtml, /id="exchange-list-status"/);

    // Dialog & Form elements
    assert.match(workspaceHtml, /id="exchange-dialog"/);
    assert.match(workspaceHtml, /id="exchange-form"/);
    assert.match(workspaceHtml, /id="exchange-scope"/);
    assert.match(workspaceHtml, /id="exchange-title"/);
    assert.match(workspaceHtml, /id="exchange-partner-ids"/);
    assert.match(workspaceHtml, /id="exchange-agreement-id"/);
    assert.match(workspaceHtml, /id="exchange-start-date"/);
    assert.match(workspaceHtml, /id="exchange-end-date"/);
    assert.match(workspaceHtml, /id="exchange-participant-users"/);
    assert.match(workspaceHtml, /id="exchange-outcome-summary"[^>]+maxlength="10000"/);
    assert.match(workspaceHtml, /id="staff-exchange-fields"/);
    assert.match(workspaceHtml, /id="exchange-responsible-users"/);
    assert.match(workspaceHtml, /id="exchange-submit-btn"/);
    assert.match(workspaceHtml, /id="exchange-close-btn"/);
});

test('workspace JS renders exchange cards with textContent and handles permissions', () => {
    const workspaceJs = fs.readFileSync(path.join(__dirname, '../public/assets/workspace.js'), 'utf8');

    // Safe DOM construction with textContent
    assert.match(workspaceJs, /titleEl\.textContent\s*=\s*ex\.title/);
    assert.match(workspaceJs, /statusBadge\.textContent\s*=\s*ex\.status/);

    // Verification that innerHTML is not used with untrusted variables
    assert.doesNotMatch(workspaceJs, /innerHTML\s*=\s*[^;]*ex\./);

    // Error status code handling
    assert.match(workspaceJs, /error\.status\s*===\s*401/);
    assert.match(workspaceJs, /error\.status\s*===\s*403/);
    assert.match(workspaceJs, /error\.status\s*===\s*409/);
    assert.match(workspaceJs, /error\.status\s*===\s*422/);

    // CstuAuth usage
    assert.match(workspaceJs, /CstuAuth\.create\(['"]\/exchanges['"]/);
    assert.match(workspaceJs, /CstuAuth\.mutate\(['"]\/exchanges\//);
    assert.match(workspaceJs, /payload\.outcomeSummary\s*=\s*exchangeOutcomeSummary\.value\.trim\(\)/);
});

test('workspace contains status transition controls and wires status API', () => {
    const workspaceHtml = fs.readFileSync(path.join(__dirname, '../public/workspace.html'), 'utf8');
    const workspaceJs = fs.readFileSync(path.join(__dirname, '../public/assets/workspace.js'), 'utf8');

    // HTML elements for transition
    assert.match(workspaceHtml, /id="exchange-status-transition-section"/);
    assert.match(workspaceHtml, /id="exchange-btn-ongoing"/);
    assert.match(workspaceHtml, /id="exchange-btn-completed"/);
    assert.match(workspaceHtml, /id="exchange-btn-cancelled"/);

    // JS wires /status endpoint
    assert.ok(workspaceJs.includes('/status'));
    assert.ok(workspaceJs.includes('handleStatusTransition'));
    assert.match(workspaceJs, /handleStatusTransition\(['"]ongoing['"]\)/);
    assert.match(workspaceJs, /handleStatusTransition\(['"]completed['"]\)/);
    assert.match(workspaceJs, /handleStatusTransition\(['"]cancelled['"]\)/);
});

test('workspace HTML and JS support My Exchange for students with read-only documents and projection', () => {
    const workspaceHtml = fs.readFileSync(path.join(__dirname, '../public/workspace.html'), 'utf8');
    const workspaceJs = fs.readFileSync(path.join(__dirname, '../public/assets/workspace.js'), 'utf8');

    // Section and dialog elements in HTML
    assert.match(workspaceHtml, /id="my-exchange-section"/);
    assert.match(workspaceHtml, /id="my-exchange-status"/);
    assert.match(workspaceHtml, /id="my-exchange-list"/);
    assert.match(workspaceHtml, /id="my-exchange-dialog"/);
    assert.match(workspaceHtml, /id="my-exchange-detail-title"/);
    assert.match(workspaceHtml, /id="my-exchange-detail-status-badge"/);
    assert.match(workspaceHtml, /id="my-exchange-detail-dates"/);
    assert.match(workspaceHtml, /id="my-exchange-detail-info"/);
    assert.match(workspaceHtml, /id="my-exchange-detail-docs-status"/);
    assert.match(workspaceHtml, /id="my-exchange-detail-docs-list"/);
    assert.match(workspaceHtml, /id="my-exchange-detail-close-btn"/);

    // JS wires /me/exchanges listing and documents
    assert.ok(workspaceJs.includes('/me/exchanges'));
    assert.ok(workspaceJs.includes('loadMyExchanges'));
    assert.ok(workspaceJs.includes('openMyExchangeDetail'));
    assert.ok(workspaceJs.includes('/documents'));
    assert.ok(workspaceJs.includes('/content?disposition=attachment'));

    // Read-only safeguards: no edit or status mutation button in student listing
    assert.ok(workspaceJs.includes('detailBtn'));
    const loadMyExchangesFn = workspaceJs.slice(workspaceJs.indexOf('async function loadMyExchanges'), workspaceJs.indexOf('function openAddExchangeDialog'));
    assert.doesNotMatch(loadMyExchangesFn, /openEditExchange/);
    assert.doesNotMatch(loadMyExchangesFn, /handleStatusTransition/);
});

