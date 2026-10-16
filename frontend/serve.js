const http = require('http');
const fs = require('fs');
const path = require('path');

const folder = path.join(__dirname, process.argv[2] || 'dashboard');
const port = Number(process.argv[3]) || 5173;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};

http.createServer((req, res) => {
  const name = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.join(folder, path.normalize(name).replace(/^(\.\.[\/\\])+/, ''));

  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, '0.0.0.0', () => {
  console.log('Serving ' + path.basename(folder) + ' on port ' + port);
});
