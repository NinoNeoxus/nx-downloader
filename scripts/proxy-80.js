const http = require('http');

const PORT_80 = 80;
const TARGET_PORT = 3000;

const server = http.createServer((req, res) => {
  // Forward original host and IP headers for Cloudflare / Next.js
  const headers = { ...req.headers };
  headers['x-forwarded-for'] = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || 'https';
  headers['x-forwarded-host'] = req.headers.host;

  const options = {
    hostname: '127.0.0.1',
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad Gateway to Next.js: ' + err.message);
  });

  req.pipe(proxyReq, { end: true });
});

server.listen(PORT_80, '0.0.0.0', () => {
  console.log(`Reverse proxy listening on 0.0.0.0:${PORT_80} -> forwarding to 127.0.0.1:${TARGET_PORT}`);
});
