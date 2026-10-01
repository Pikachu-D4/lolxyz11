// Simple local development server. Vercel uses the /api functions directly.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const root = __dirname;
const routes = {
  '/api/analyze': require('./api/analyze'),
  '/api/download': require('./api/download'),
};
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (u.pathname.startsWith('/api/')) {
    const handler = routes[u.pathname];
    if (!handler) return res.writeHead(404).end('Not found');
    // Local adapter: parse JSON body for POST.
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      req.body = body ? JSON.parse(body) : {};
      res.status = (code) => ({ json: (payload) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(payload)); } });
      res.json = (payload) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(payload)); };
      try { await handler(req, res); }
      catch (e) { console.error(e); if (!res.headersSent) res.writeHead(500).end('Internal server error'); }
    });
    return;
  }
  const filePath = u.pathname === '/' ? path.join(root, 'index.html') : path.join(root, u.pathname.replace(/^\//, ''));
  if (!filePath.startsWith(root)) return res.writeHead(403).end('Forbidden');
  fs.readFile(filePath, (err, data) => {
    if (err) return res.writeHead(404).end('Not found');
    res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Eomeg Downloader: http://localhost:${PORT}`));
