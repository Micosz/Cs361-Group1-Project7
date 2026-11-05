/* Generate the staff shell from the shared record page to avoid two copies of forms. */
const fs = require('node:fs');
let page = fs.readFileSync('public/index.html', 'utf8');
page = page.replace('<title>CSTUHub - Information Board</title>', '<title>หน้าทำงาน | CSTUHub</title>')
 .replace('<body>', '<body class="work-home work-checking">')
 .replace(/    <div class="hero-scroll">[\s\S]*?(?=    <div class="board-scene">)/, '')
 .replace(/    <script src="assets\/(opening|constellation|header-motion)\.js[^>]*><\/script>\n/g, '')
 .replace('</head>', '<link rel="stylesheet" href="assets/work-home.css?v=work-logout-1">\n</head>');
const shell = fs.readFileSync('public/partials/work-home.html', 'utf8');
page = page.replace('    <div class="board-scene">', shell + '\n    <div class="board-scene">')
 .replace('href="/"', 'href="work.html"')
 .replace('href="index.html"', 'href="work.html"');
fs.writeFileSync('public/work.html', page);
