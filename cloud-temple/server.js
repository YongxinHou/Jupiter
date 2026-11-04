// 云寺 Cloud Temple — zero-dependency realtime server.
// Static files from ./public, presence via Server-Sent Events, actions via POST.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOM_CAP = Number(process.env.ROOM_CAP || 100);
const PUBLIC = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data.json');
const WORLD = { w: 1000, h: 700 };

const ADJ = ['悠闲的', '淡淡的', '安静的', '慢慢的', '清晨的', '微凉的', '远山的', '不急的', '温柔的', '空空的', '轻轻的', '午后的'];
const NOUN = ['云', '月光', '松风', '溪水', '竹影', '雨声', '晨钟', '落叶', '灯火', '山雾', '石阶', '茶烟'];
const ROBES = ['#8a8f98', '#b5763a', '#6b7b5e', '#7d6a8c', '#a65e4e', '#5f7f91'];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json',
};

// ---- persistent merit counter ----
let stats = { bows: 0, palms: 0, beads: 0 };
try { stats = { ...stats, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; } catch {}
let dirty = false;
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  fs.writeFile(DATA_FILE, JSON.stringify(stats), () => {});
}, 5000);

// ---- rooms ----
const rooms = new Map(); // roomId -> Map(id -> player)
const players = new Map(); // id -> player

function pickRoom() {
  for (const [rid, r] of rooms) if (r.size < ROOM_CAP) return rid;
  const rid = rooms.size + 1;
  rooms.set(rid, new Map());
  return rid;
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const pub = (p) => ({ id: p.id, name: p.name, robe: p.robe, x: p.x, y: p.y, act: p.act });

function send(p, event, data) {
  p.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function broadcast(room, event, data, exceptId) {
  for (const p of rooms.get(room).values()) if (p.id !== exceptId) send(p, event, data);
}

function join(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const room = pickRoom();
  const p = {
    id: crypto.randomBytes(6).toString('hex'),
    token: crypto.randomBytes(16).toString('hex'),
    name: pick(ADJ) + pick(NOUN),
    robe: pick(ROBES),
    x: 400 + Math.random() * 200,
    y: 520 + Math.random() * 80,
    act: null,
    room,
    res,
    lastMove: 0,
    lastAct: 0,
  };
  rooms.get(room).set(p.id, p);
  players.set(p.id, p);

  send(p, 'welcome', {
    me: { ...pub(p), token: p.token },
    room,
    players: [...rooms.get(room).values()].filter((o) => o.id !== p.id).map(pub),
    stats,
  });
  broadcast(room, 'join', pub(p), p.id);

  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(ping);
    rooms.get(room).delete(p.id);
    players.delete(p.id);
    broadcast(room, 'leave', { id: p.id });
  });
}

function readBody(req, cb) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 1024) req.destroy(); });
  req.on('end', () => { try { cb(JSON.parse(body || '{}')); } catch { cb(null); } });
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));

function action(req, res) {
  readBody(req, (msg) => {
    const p = msg && players.get(msg.id);
    if (!p || p.token !== msg.token) { res.writeHead(403); return res.end(); }
    const now = Date.now();
    if (msg.type === 'move' && now - p.lastMove > 80) {
      p.lastMove = now;
      p.x = clamp(msg.x, 40, WORLD.w - 40);
      p.y = clamp(msg.y, 330, WORLD.h - 30);
      broadcast(p.room, 'move', { id: p.id, x: p.x, y: p.y }, p.id);
    } else if (msg.type === 'act' && now - p.lastAct > 400) {
      const kind = { bow: 'bows', palm: 'palms', beads: 'beads' }[msg.act];
      if (kind) {
        p.lastAct = now;
        stats[kind]++;
        dirty = true;
        broadcast(p.room, 'act', { id: p.id, act: msg.act }, p.id);
      }
    }
    res.writeHead(204);
    res.end();
  });
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const file = path.normalize(path.join(PUBLIC, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/events') return join(req, res);
  if (req.method === 'POST' && req.url === '/action') return action(req, res);
  if (req.method === 'GET' && req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ...stats, online: players.size }));
  }
  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405);
  res.end();
});

// broadcast global stats every 3s so counters feel alive
setInterval(() => {
  for (const rid of rooms.keys()) broadcast(rid, 'stats', { ...stats, online: players.size, here: rooms.get(rid).size });
}, 3000);

server.listen(PORT, () => console.log(`云寺 running at http://localhost:${PORT}`));
