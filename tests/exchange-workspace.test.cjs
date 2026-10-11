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
});

