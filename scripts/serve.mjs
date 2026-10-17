import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { exec } from 'node:child_process';

const root = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const port = Number(process.env.PORT || 5173);
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.woff2':'font/woff2', '.woff':'font/woff', '.png':'image/png', '.svg':'image/svg+xml', '.json':'application/json' };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const target = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (target !== root && !target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    if (!(await stat(target)).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(target).pipe(res);
  } catch { res.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' }).end('Fichier introuvable.'); }
});
const url = `http://127.0.0.1:${port}/`;
// --open shows the game only once the server answers, never a refused page.
function openBrowser() {
  if (!process.argv.includes('--open')) return;
  const command = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(command, error => { if (error) console.log(`Ouvrez ${url} dans votre navigateur.`); });
}
server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Le port ${port} est déjà utilisé : STARWARD tourne sans doute déjà dans une autre fenêtre. Ouverture de ${url}`);
    openBrowser();
  } else console.error(error);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`STARWARD est prêt : ${url}\nGardez cette fenêtre ouverte pendant la partie.`);
  openBrowser();
});
