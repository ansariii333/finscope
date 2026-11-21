const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/model.js': ['model.js', 'text/javascript; charset=utf-8'],
  '/agent.js': ['agent.js', 'text/javascript; charset=utf-8'],
  '/storage.js': ['storage.js', 'text/javascript; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/mark.svg': ['mark.svg', 'image/svg+xml'],
  '/example.csv': ['example.csv', 'text/csv; charset=utf-8'],
};
const port = Number(process.argv[2] || 4173);
const address = '127.0.0.1';

http.createServer((request, response) => {
  const route = request.url.split('?')[0];
  if (!Object.hasOwn(assets, route)) {
    response.writeHead(404).end();
    return;
  }
  const [filename, type] = assets[route];
  fs.readFile(path.join(__dirname, 'dist', filename), (error, body) => {
    if (error) {
      response.writeHead(500).end('Preview asset is unavailable.');
      return;
    }
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(body);
  });
}).listen(port, address, () => {
  console.log('http://' + address + ':' + port);
});
