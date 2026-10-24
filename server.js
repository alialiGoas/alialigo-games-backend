'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

const server = http.createServer(app);
const io = new Server(server, {
  // Prototype only. For a public release, restrict this to your app's known origins.
  cors: { origin: '*' }
});

// Prototype rooms live only in RAM. Restarting the service clears them.
const rooms = new Map();
const MAX_PLAYERS = 4;

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function safeName(value) {
  const name = String(value || '').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, 20);
  return name || 'Player';
}

function roomSummary(room) {
  return {
    roomCode: room.code,
    game: room.game,
    players: room.players.map(({ id, username }) => ({ id, username })),
    maxPlayers: room.maxPlayers,
    status: room.players.length >= room.maxPlayers ? 'full' : 'waiting'
  };
}

function emitRoomUpdate(code) {
  const room = rooms.get(code);
  if (!room) return;
  io.to(code).emit('roomUpdate', roomSummary(room));
}

app.get('/', (_req, res) => {
  res.json({
    app: 'alialiGo Games backend starter',
    status: 'running',
    note: 'This is a starter test backend, not yet connected to the Android app.',
    health: '/health',
    activeRooms: rooms.size
  });
});

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'alialiGo-games-backend' });
});

app.get('/api/rooms', (_req, res) => {
  res.json({ rooms: Array.from(rooms.values()).map(roomSummary) });
});

io.on('connection', (socket) => {
  socket.data.roomCode = null;
  socket.data.username = 'Player';

  socket.on('createRoom', (data = {}, callback) => {
    const username = safeName(data.username);
    const game = ['manch', 'snakes_ladders'].includes(data.game) ? data.game : 'manch';
    const code = makeRoomCode();
    const room = {
      code,
      game,
      maxPlayers: Math.min(Math.max(Number(data.maxPlayers) || MAX_PLAYERS, 2), MAX_PLAYERS),
      players: [{ id: socket.id, username }],
      createdAt: Date.now()
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.username = username;
    const result = { ok: true, room: roomSummary(room) };
    if (typeof callback === 'function') callback(result);
    socket.emit('roomCreated', result);
    emitRoomUpdate(code);
  });

  socket.on('joinRoom', (data = {}, callback) => {
    const code = String(data.roomCode || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      const result = { ok: false, error: 'ROOM_NOT_FOUND', message: 'Room not found.' };
      if (typeof callback === 'function') callback(result);
      else socket.emit('serverError', result);
      return;
    }
    if (room.players.length >= room.maxPlayers) {
      const result = { ok: false, error: 'ROOM_FULL', message: 'Room is full.' };
      if (typeof callback === 'function') callback(result);
      else socket.emit('serverError', result);
      return;
    }
    // Avoid duplicate entries when a client sends joinRoom more than once.
    if (!room.players.some((player) => player.id === socket.id)) {
      const username = safeName(data.username);
      room.players.push({ id: socket.id, username });
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.username = username;
    }
    const result = { ok: true, room: roomSummary(room) };
    if (typeof callback === 'function') callback(result);
    socket.emit('roomJoined', result);
    emitRoomUpdate(code);
  });

  socket.on('gameAction', (data = {}) => {
    const code = socket.data.roomCode;
    const room = code && rooms.get(code);
    if (!room || !room.players.some((player) => player.id === socket.id)) return;

    // Do not trust this relay as the authority for dice rolls or legal moves.
    // The game's real rules/anti-cheat validation must be implemented before release.
    socket.to(code).emit('gameAction', {
      username: socket.data.username,
      action: data.action,
      payload: data.payload ?? null
    });
  });

  socket.on('leaveRoom', () => leaveCurrentRoom(socket));
  socket.on('disconnect', () => leaveCurrentRoom(socket));
});

function leaveCurrentRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  socket.leave(code);
  socket.data.roomCode = null;
  if (!room) return;
  room.players = room.players.filter((player) => player.id !== socket.id);
  if (room.players.length === 0) {
    rooms.delete(code);
  } else {
    emitRoomUpdate(code);
  }
}

const port = Number(process.env.PORT) || 3000;
server.listen(port, '0.0.0.0', () => {
  console.log(`alialiGo Games backend listening on ${port}`);
});
