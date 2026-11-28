/* Generate the staff shell from the shared record page to avoid two copies of forms. */
const fs = require('node:fs');
let page = fs.readFileSync('public/index.html', 'utf8');
page = page.replace('<title data-ui>กระดานข้อมูล | CSTUHub</title>', '<title>หน้าทำงาน | CSTUHub</title>')
 .replace(/    <script src="assets\/public-(english|language)\.js" defer><\/script>\n/g, '')
 .replace('    <link rel="stylesheet" href="assets/public-language.css">\n', '')
 .replaceAll(' data-ui', '')
 // The incoming document must opt in before its first rendering opportunity.
 .replace('<head>', '<head>\n    <style>@media (prefers-reduced-motion: no-preference) { @supports selector(:active-view-transition-type(staff-shortcut)) { @view-transition { navigation: auto; types: staff-shortcut; } } }</style>')
 .replace('<body>', '<body class="work-home work-checking">')
 .replace(/    <div class="hero-scroll">[\s\S]*?(?=    <div class="board-scene">)/, '')
 .replace(/    <script src="assets\/(opening|constellation|header-motion)\.js[^>]*><\/script>\n/g, '')
 .replace('</head>', '<link rel="stylesheet" href="assets/work-home.css?v=workflow-1">\n<link rel="stylesheet" href="assets/staff-landing.css?v=shortcut-handoff">\n</head>');
page = page.replace('    <script src="assets/role-home.js?v=browse-shortcuts" defer></script>', [
 '    <script src="assets/proposal-avatars.js?v=1" defer></script>',
 '    <script src="assets/proposal-flow.js?v=1" defer></script>',
 '    <script src="assets/proposal-board.js?v=workflow-1" defer></script>',
 '    <script src="assets/role-home.js?v=staff-desk-2" defer></script>',
 '    <script src="assets/staff-shortcuts.js?v=1" defer></script>'
].join('\n'));
page = page.replace('assets/records.js?v=role-home-1','assets/records.js?v=proposal-board-1');
const shell = fs.readFileSync('public/partials/work-home.html', 'utf8');
page = page.replace('    <div class="board-scene">', shell + '\n    <div class="board-scene">')
 .replace('href="/"', 'href="work.html"')
 .replace('href="index.html"', 'href="work.html"');
fs.writeFileSync('public/work.html', page);
