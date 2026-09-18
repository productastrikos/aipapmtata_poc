#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   Static server for the production build, bound to every interface so the
   demo is reachable across the VPN / LAN.

   Zero dependencies — plain node:http, so there is nothing to install on a
   demo machine and nothing to go wrong in a venue with no internet.

     node serve-demo.js            # port 4173
     node serve-demo.js 8080       # explicit port

   Serves ./build with SPA fallback: any path that is not a real file returns
   index.html, which is what React Router needs for /health, /risk and friends
   to survive a page refresh or a directly pasted link.
   ═══════════════════════════════════════════════════════════════════════════ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = parseInt(process.argv[2], 10) || 4173;
const ROOT = path.join(__dirname, 'build');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error('\n  No build found at ' + ROOT + '\n  Run "npm run build" first.\n');
  process.exit(1);
}

function send(res, status, body, type, extraHeaders) {
  res.writeHead(status, Object.assign({ 'Content-Type': type }, extraHeaders || {}));
  res.end(body);
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    return send(res, 400, 'Bad request', 'text/plain');
  }

  // Resolve inside ROOT only — never serve anything above the build directory
  const resolved = path.resolve(ROOT, '.' + urlPath);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    return send(res, 403, 'Forbidden', 'text/plain');
  }

  fs.stat(resolved, (err, stat) => {
    const isFile = !err && stat.isFile();
    // SPA fallback: unknown paths hand back index.html so client-side routes work
    const file = isFile ? resolved : path.join(ROOT, 'index.html');
    const ext = path.extname(file).toLowerCase();

    fs.readFile(file, (readErr, data) => {
      if (readErr) return send(res, 500, 'Internal error', 'text/plain');
      send(res, isFile ? 200 : 200, data, MIME[ext] || 'application/octet-stream', {
        // Hashed assets are immutable; the shell must never be cached stale
        'Cache-Control': /\.[0-9a-f]{8}\./.test(path.basename(file))
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      });
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const addrs = [];
  Object.keys(nets).forEach((name) => {
    (nets[name] || []).forEach((net) => {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
        addrs.push({ name, address: net.address });
      }
    });
  });

  console.log('\n  Astrikos S!aP — APM & AIP demo\n');
  console.log('  Local:    http://localhost:' + PORT);
  addrs.forEach((a) => {
    console.log('  Network:  http://' + a.address + ':' + PORT + '   (' + a.name + ')');
  });
  console.log('\n  Ctrl+C to stop.\n');
});
