// Receives what bake.html cooks for Godot and writes it into godot/.
// node scripts/bake-server.mjs, then open http://127.0.0.1:5173/bake.html
// (npm run dev). POST /save/<path inside godot/> with the file as the body;
// only paths under assets/ are accepted.
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'godot');
const port = Number(process.env.BAKE_PORT ?? 5199);

createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (request.method === 'OPTIONS') return response.end();
  const path = decodeURIComponent((request.url ?? '').replace(/^\/save\//, ''));
  const target = resolve(root, normalize(path));
  if (request.method !== 'POST' || !target.startsWith(join(root, 'assets') + sep)) {
    response.statusCode = 400;
    return response.end('bad request');
  }
  const chunks = [];
  request.on('data', chunk => chunks.push(chunk));
  request.on('end', () => {
    mkdirSync(dirname(target), { recursive: true });
    const body = Buffer.concat(chunks);
    writeFileSync(target, body);
    console.log(`${path} (${(body.length / 1024).toFixed(0)} Ko)`);
    response.end('ok');
  });
}).listen(port, '127.0.0.1', () => console.log(`Cuisson Godot : en attente sur http://127.0.0.1:${port} → ${root}`));
