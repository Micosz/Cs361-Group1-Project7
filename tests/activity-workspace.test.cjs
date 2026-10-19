const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const base = join(__dirname, '..', 'public');
const workspaceHtml = readFileSync(`${base}/workspace.html`, 'utf8');
const workspaceJs = readFileSync(`${base}/assets/workspace.js`, 'utf8') + readFileSync(`${base}/assets/activity-workspace.js`, 'utf8');

test('workspace HTML includes unified Activity management section and dialog', () => {
    // Activity Section
    assert.match(workspaceHtml, /id="activity-section"/);
    assert.match(workspaceHtml, /id="open-add-activity"/);
    assert.match(workspaceHtml, /id="activity-list"/);
    assert.match(workspaceHtml, /id="activity-list-status"/);

    // Activity Dialog & Form
    assert.match(workspaceHtml, /id="activity-dialog"/);
    assert.match(workspaceHtml, /id="activity-form"/);
    assert.match(workspaceHtml, /id="activity-id"/);
    assert.match(workspaceHtml, /id="activity-version"/);
    assert.match(workspaceHtml, /id="activity-scope"/);
    assert.match(workspaceHtml, /id="activity-title"[^>]+maxlength="200"/);
    assert.match(workspaceHtml, /id="activity-type"/);
    assert.match(workspaceHtml, /id="activity-summary"[^>]+maxlength="2000"/);
    assert.match(workspaceHtml, /id="activity-full-description"[^>]+maxlength="20000"/);
    assert.match(workspaceHtml, /id="activity-outcome-summary"[^>]+maxlength="10000"/);
    assert.match(workspaceHtml, /id="activity-partner-id"/);
    assert.match(workspaceHtml, /id="activity-cohost-ids"/);
    assert.match(workspaceHtml, /id="activity-agreement-ids"/);
    assert.match(workspaceHtml, /id="activity-period-date"[^>]+type="date"/);
    assert.match(workspaceHtml, /id="activity-period-text"/);
    assert.match(workspaceHtml, /id="activity-image-path"/);

    // Staff-only fields
    assert.match(workspaceHtml, /id="staff-activity-fields"/);
    assert.match(workspaceHtml, /id="activity-publication"/);
    assert.match(workspaceHtml, /id="activity-responsible-users"/);

    // Status and Action buttons
    assert.match(workspaceHtml, /id="activity-status"[^>]+role="status"/);
    assert.match(workspaceHtml, /id="activity-submit-btn"[^>]+type="submit"/);
    assert.match(workspaceHtml, /id="activity-close-btn"/);
});

test('workspace JS binds activity operations and handles mutation contracts', () => {
    // Verifies CstuAuth.request('/activities') used for fetching activities
    assert.match(workspaceJs, /allWorkspaceRows\(['"]\/activities['"]\)/);

    // Verifies CstuAuth.create used for new activity creation with idempotency key
    assert.match(workspaceJs, /window\.CstuAuth\.create\(['"]\/activities['"],\s*payload,\s*currentSubmissionKey\)/);

    // Verifies CstuAuth.mutate used with version for PATCH
    assert.match(workspaceJs, /window\.CstuAuth\.mutate\(['"]\/activities\/['"]/);
    assert.match(workspaceJs, /payload\.outcomeSummary\s*=\s*activityOutcomeSummary\.value\.trim\(\)/);

    // Verifies optimistic concurrency 409 conflict handling with reload
    assert.match(workspaceJs, /error\.status === 409/);
    assert.match(workspaceJs, /Version Conflict/);

    // Verifies 422 validation failure handling
    assert.match(workspaceJs, /error\.status === 422/);

    // Verifies 403 forbidden handling
    assert.match(workspaceJs, /error\.status === 403/);

    // Verifies safe DOM textContent rendering (no raw innerHTML injection on user fields)
    assert.match(workspaceJs, /title\.textContent = act\.title/);
    assert.match(workspaceJs, /summary\.textContent = act\.summary/);
});

test('workspace JS respects Coordinator public activity editing restrictions', () => {
    // When publication is public and caller is not staff, coordinator is prevented from submitting
    assert.match(workspaceJs, /!isStaff\s*&&\s*act\.publication === ['"]public['"]/);
    assert.match(workspaceJs, /activitySubmitBtn\.disabled = true/);
});
