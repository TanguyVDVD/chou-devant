import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import type { ClientToServer, ServerToClient, Welcome } from '../shared/protocol';
import { Room, type Player } from './room';

const PORT = Number(process.env.PORT) || 3000;
const MAX_ROOMS = 200;
const TICK_MS = 100;
const EVENTS_PER_SECOND = 80;
const MAX_SOCKETS_PER_ADDRESS = 12;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPRSTUVWXYZ';
const CLIENT_DIR = path.join(__dirname, '..', 'client');

interface SocketData {
  code: string | null;
  pid: string | null;
}
type GameSocket = Socket<ClientToServer, ServerToClient, Record<string, never>, SocketData>;

const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:",
  );
  next();
});

const rooms = new Map<string, Room>();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', rooms: rooms.size, uptime: Math.round(process.uptime()) });
});
app.use('/assets', express.static(path.join(CLIENT_DIR, 'assets'), { immutable: true, maxAge: '30d' }));
app.use(express.static(CLIENT_DIR));

const server = http.createServer(app);
const io = new Server<ClientToServer, ServerToClient, Record<string, never>, SocketData>(server, {
  maxHttpBufferSize: 32 * 1024,
  serveClient: false,
});

function newCode(): string | null {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = '';
    for (let i = 0; i < 4; i += 1) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return null;
}

function normalizeCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) : '';
}

/** Envoie tout ce que le salon a mis en file d'attente. */
function flush(room: Room): void {
  for (const message of room.flush()) {
    const target = message.to === 'all' ? room.code : `${room.code}:${message.to}`;
    // Le couple (ev, data) est garanti cohérent par le type OutMessage.
    (io.to(target).emit as (ev: string, data: unknown) => void)(message.ev, message.data);
  }
}

/** Le socket qui tient actuellement chaque place, par « code:joueur ». */
const owners = new Map<string, GameSocket>();
const socketsPerAddress = new Map<string, number>();

/** Adresse réelle du visiteur : derrière le tunnel, c'est Cloudflare qui la transmet. */
function addressOf(socket: GameSocket): string {
  const forwarded = socket.handshake.headers['cf-connecting-ip'];
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? socket.handshake.address;
}

/** Un message mal formé ne doit jamais faire tomber le serveur ni les autres salons. */
function safely<A extends unknown[]>(handler: (...args: A) => void): (...args: A) => void {
  return (...args: A) => {
    try {
      handler(...args);
    } catch (error) {
      process.stderr.write(`Message ignoré : ${error instanceof Error ? error.message : String(error)}
`);
    }
  };
}

function attach(socket: GameSocket, room: Room, player: Player): void {
  // Une place n'a qu'un socket : l'ancien (onglet dupliqué, connexion fantôme) est
  // détaché, pour que sa déconnexion tardive n'élimine pas le joueur revenu.
  const key = `${room.code}:${player.id}`;
  const previous = owners.get(key);
  if (previous && previous !== socket) {
    detach(previous);
    previous.disconnect(true);
  }
  owners.set(key, socket);
  socket.data.code = room.code;
  socket.data.pid = player.id;
  void socket.join([room.code, `${room.code}:${player.id}`]);
}

function detach(socket: GameSocket): void {
  const { code, pid } = socket.data;
  if (code) {
    if (owners.get(`${code}:${pid}`) === socket) owners.delete(`${code}:${pid}`);
    void socket.leave(code);
    void socket.leave(`${code}:${pid}`);
  }
  socket.data.code = null;
  socket.data.pid = null;
}

function context(socket: GameSocket): { room: Room; pid: string } | null {
  const room = socket.data.code ? rooms.get(socket.data.code) : undefined;
  if (!room || !socket.data.pid) return null;
  return { room, pid: socket.data.pid };
}

function reply<T>(ack: unknown, payload: T): void {
  if (typeof ack === 'function') (ack as (payload: T) => void)(payload);
}

function welcome(room: Room, player: Player): Welcome {
  return { ok: true, code: room.code, you: player.id, room: room.snapshot(), offers: player.offers };
}

io.use((socket, next) => {
  const address = addressOf(socket);
  const count = socketsPerAddress.get(address) ?? 0;
  if (count >= MAX_SOCKETS_PER_ADDRESS) return next(new Error('Trop de connexions depuis cette adresse.'));
  socketsPerAddress.set(address, count + 1);
  socket.once('disconnect', () => {
    const left = (socketsPerAddress.get(address) ?? 1) - 1;
    if (left <= 0) socketsPerAddress.delete(address);
    else socketsPerAddress.set(address, left);
  });
  next();
});

io.on('connection', (socket: GameSocket) => {
  socket.data.code = null;
  socket.data.pid = null;

  let budget = EVENTS_PER_SECOND;
  let budgetAt = Date.now();
  socket.use((_packet, next) => {
    const now = Date.now();
    if (now - budgetAt >= 1000) {
      budget = EVENTS_PER_SECOND;
      budgetAt = now;
    }
    budget -= 1;
    if (budget >= 0) next();
  });

  socket.on('room:create', safely((data, ack) => {
    if (context(socket)) return reply<Welcome>(ack, { error: 'Tu es déjà dans un salon.' });
    if (rooms.size >= MAX_ROOMS) {
      return reply<Welcome>(ack, { error: 'Trop de salons ouverts, réessaie plus tard.' });
    }
    const code = newCode();
    if (!code) return reply<Welcome>(ack, { error: 'Impossible de créer un salon, réessaie.' });
    const room = new Room(code);
    const result = room.addPlayer(data ?? {});
    if (!result.player) return reply<Welcome>(ack, { error: result.error });
    rooms.set(code, room);
    attach(socket, room, result.player);
    reply(ack, welcome(room, result.player));
    flush(room);
  }));

  socket.on('room:join', safely((data, ack) => {
    if (context(socket)) return reply<Welcome>(ack, { error: 'Tu es déjà dans un salon.' });
    const room = rooms.get(normalizeCode(data?.code));
    if (!room) {
      return reply<Welcome>(ack, { error: "Ce salon n'existe pas (ou plus). Vérifie le code." });
    }
    const result = data?.rejoin ? room.reconnect(data.token) : room.addPlayer(data ?? {});
    if (!result.player) return reply<Welcome>(ack, { error: result.error });
    attach(socket, room, result.player);
    reply(ack, welcome(room, result.player));
    flush(room);
  }));

  socket.on('room:leave', safely(() => {
    const ctx = context(socket);
    if (!ctx) return;
    ctx.room.leave(ctx.pid);
    detach(socket);
    flush(ctx.room);
  }));

  socket.on('room:ready', safely((ready) => {
    const ctx = context(socket);
    if (!ctx) return;
    ctx.room.setReady(ctx.pid, ready);
    flush(ctx.room);
  }));

  socket.on('game:start', safely((ack) => {
    const ctx = context(socket);
    if (!ctx) return reply(ack, { error: 'Salon introuvable.' });
    reply(ack, ctx.room.start(ctx.pid));
    flush(ctx.room);
  }));

  socket.on('game:lobby', safely(() => {
    const ctx = context(socket);
    if (!ctx) return;
    ctx.room.backToLobby(ctx.pid);
    flush(ctx.room);
  }));

  socket.on('state', safely((raw) => {
    const ctx = context(socket);
    if (!ctx) return;
    const state = ctx.room.onState(ctx.pid, raw);
    if (state) socket.to(ctx.room.code).volatile.emit('state', { id: ctx.pid, ...state });
    flush(ctx.room);
  }));

  socket.on('brick:lost', safely(() => {
    const ctx = context(socket);
    if (!ctx) return;
    ctx.room.onBrickLost(ctx.pid);
    flush(ctx.room);
  }));

  socket.on('card:use', safely((data, ack) => {
    const ctx = context(socket);
    if (!ctx) return reply(ack, { error: 'Salon introuvable.' });
    reply(ack, ctx.room.useCard(ctx.pid, data ?? {}));
    flush(ctx.room);
  }));

  socket.on('disconnect', safely(() => {
    const ctx = context(socket);
    if (!ctx) return;
    ctx.room.disconnect(ctx.pid);
    detach(socket);
    flush(ctx.room);
  }));
});

const ticker = setInterval(() => {
  for (const [code, room] of rooms) {
    room.tick();
    flush(room);
    if (room.isDead()) rooms.delete(code);
  }
}, TICK_MS);

server.listen(PORT, () => {
  process.stdout.write(`Chou Devant ! est servi sur le port ${PORT}\n`);
});

function shutdown(): void {
  clearInterval(ticker);
  void io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
