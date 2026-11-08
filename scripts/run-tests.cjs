/* Run suites from the repository root and preserve failures from either suite. */
const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const selection = process.argv[2] || 'all';
if (!['all', 'frontend', 'backend', 'lambda', 'deployment'].includes(selection)) {
    console.error('Usage: node scripts/run-tests.cjs [all|frontend|backend|lambda|deployment]');
    process.exit(2);
}
let failed = false;
function run(command, args) {
    const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) failed = true;
}
if (['all', 'frontend'].includes(selection)) {
    const files = readdirSync(path.join(root, 'tests/frontend')).filter(name => name.endsWith('.test.cjs')).sort();
    if (!files.length) { console.error('No frontend tests found'); failed = true; }
    else run(process.execPath, ['--test', ...files.map(name => `tests/frontend/${name}`)]);
}
if (['all', 'backend'].includes(selection)) run(process.env.PYTHON || 'python3', ['tests/run-backend.py', '-v']);
if (['all', 'backend', 'lambda'].includes(selection)) {
    const suites = ['tuAuthLogin', 'fetchPartnersData', 'getPublicPartners'];
    run(process.execPath, ['--experimental-vm-modules', '--test', ...suites.map(name => `tests/backend/${name}/handler.test.cjs`)]);
}
if (['all', 'deployment'].includes(selection)) run(process.env.PYTHON || 'python3', ['-m', 'unittest', 'discover', '-s', 'tests/deployment', '-v']);
process.exit(failed ? 1 : 0);
