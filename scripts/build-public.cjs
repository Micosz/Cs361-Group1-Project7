const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

// Keep the two existing Amplify URLs while maintaining only one login page.
const publicDir = join(__dirname, '..', 'public');
const canonical = readFileSync(join(publicDir, 'login.html'), 'utf8');
if (!canonical.includes('<head>') || /<base\b/i.test(canonical)) {
    throw new Error('public/login.html must contain <head> and must not define a base URL');
}
const routed = canonical.replace('<head>', '<head>\n    <!-- Generated from public/login.html by npm run build. Do not edit. -->\n    <base href="../">');
mkdirSync(join(publicDir, 'login'), { recursive: true });
writeFileSync(join(publicDir, 'login', 'index.html'), routed);
console.log('Generated public/login/index.html from public/login.html');
