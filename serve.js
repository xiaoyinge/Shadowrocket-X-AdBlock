const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const PORT = 8088;

const server = http.createServer((req, res) => {
  let u = decodeURIComponent((req.url || '/').split('?')[0]);
  if (u === '/') u = '/index.html';
  const fp = path.join(ROOT, path.normalize(u).replace(/^(\.\.[\/\\])+/, ''));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('404 ' + u);
  }
  const body = fs.readFileSync(fp);
  const ext = path.extname(fp).toLowerCase();
  const type = ext === '.conf' ? 'text/plain; charset=utf-8'
    : ext === '.html' ? 'text/html; charset=utf-8'
    : 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': body.length,
    'Content-Disposition': 'inline; filename="' + path.basename(fp) + '"',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
  console.log('[200] ' + req.socket.remoteAddress + ' ' + u + ' ' + body.length + 'B');
});

server.listen(PORT, '0.0.0.0', () => console.log('serving ' + ROOT + ' on 0.0.0.0:' + PORT));
