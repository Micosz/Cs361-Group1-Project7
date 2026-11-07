/* Run suites from the repository root and preserve failures from either suite. */
const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const selection = process.argv[2] || 'all';
if (!['all', 'frontend', 'backend'].includes(selection)) {
    console.error('Usage: node scripts/run-tests.cjs [all|frontend|backend]');
    process.exit(2);
}
let failed = false;
function run(command, args) {
    const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) failed = true;
}
if (selection !== 'backend') {
    const files = readdirSync(path.join(root, 'tests/frontend')).filter(name => name.endsWith('.test.cjs')).sort();
    if (!files.length) { console.error('No frontend tests found'); failed = true; }
    else run(process.execPath, ['--test', ...files.map(name => `tests/frontend/${name}`)]);
}
if (selection !== 'frontend') run(process.env.PYTHON || 'python3', ['tests/run-backend.py', '-v']);
process.exit(failed ? 1 : 0);
