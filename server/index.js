const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*'}
});

// ---- Simple racing game state ----
const GAME_CONFIG = {
  worldWidth: 1000,
  worldHeight: 600,
  tickRate: 30,
  maxPlayers: 16,
};

const PHYSICS = {
  accelPerSecond: 220, // px/s^2
  brakePerSecond: 300, // px/s^2
  maxForwardSpeed: 320, // px/s
  maxReverseSpeed: 120, // px/s
  frictionPerSecond: 0.96, // applied each tick as multiplier^(dt*60)
  turnRateAtMax: Math.PI, // rad/s at max speed
};

/** @type {Map<string, Player>} */
const players = new Map();

/**
 * @typedef {Object} InputState
 * @property {boolean} up
 * @property {boolean} down
 * @property {boolean} left
 * @property {boolean} right
 *
 * @typedef {Object} Player
 * @property {string} id
 * @property {string} name
 * @property {string} color
 * @property {number} x
 * @property {number} y
 * @property {number} angle
 * @property {number} speed
 * @property {InputState} input
 */

function getSpawnPosition(index) {
  const rowSize = 8;
  const spacingX = 45;
  const spacingY = 50;
  const startX = 120;
  const startY = GAME_CONFIG.worldHeight / 2 - 2 * spacingY;
  const col = index % rowSize;
  const row = Math.floor(index / rowSize);
  return { x: startX + col * spacingX, y: startY + row * spacingY, angle: 0 };
}

function randomColor() {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 80%, 60%)`;
}

io.on('connection', (socket) => {
  const playerIndex = players.size;
  const spawn = getSpawnPosition(playerIndex);
  const newPlayer = {
    id: socket.id,
    name: `Player-${String(playerIndex + 1).padStart(2, '0')}`,
    color: randomColor(),
    x: spawn.x,
    y: spawn.y,
    angle: spawn.angle,
    speed: 0,
    input: { up: false, down: false, left: false, right: false },
  };
  players.set(socket.id, newPlayer);

  socket.emit('init', {
    id: socket.id,
    config: GAME_CONFIG,
  });

  socket.on('join', (data) => {
    const p = players.get(socket.id);
    if (!p) return;
    if (data && typeof data.name === 'string' && data.name.trim()) {
      p.name = data.name.trim().slice(0, 20);
    }
  });

  socket.on('input', /** @param {InputState} input */ (input) => {
    const p = players.get(socket.id);
    if (!p) return;
    p.input = {
      up: !!input.up,
      down: !!input.down,
      left: !!input.left,
      right: !!input.right,
    };
  });

  // Ack-based ping responder
  socket.on('pingCheck', (_payload, ack) => {
    if (typeof ack === 'function') ack();
  });

  socket.on('disconnect', () => {
    players.delete(socket.id);
  });
});

// Authoritative simulation loop
const TICK_MS = 1000 / GAME_CONFIG.tickRate;
setInterval(gameTick, TICK_MS);

function gameTick() {
  const dt = TICK_MS / 1000;
  const frictionFactor = Math.pow(PHYSICS.frictionPerSecond, dt * 60);

  for (const p of players.values()) {
    // Acceleration and braking
    if (p.input.up) {
      p.speed += PHYSICS.accelPerSecond * dt;
    }
    if (p.input.down) {
      p.speed -= PHYSICS.brakePerSecond * dt;
    }

    // Friction if no input
    if (!p.input.up && !p.input.down) {
      p.speed *= frictionFactor;
      if (Math.abs(p.speed) < 1) p.speed = 0;
    }

    // Clamp speeds
    if (p.speed > PHYSICS.maxForwardSpeed) p.speed = PHYSICS.maxForwardSpeed;
    if (p.speed < -PHYSICS.maxReverseSpeed) p.speed = -PHYSICS.maxReverseSpeed;

    // Turning depends on speed
    const speedRatio = Math.min(Math.abs(p.speed) / PHYSICS.maxForwardSpeed, 1);
    const turnRate = PHYSICS.turnRateAtMax * (0.25 + 0.75 * speedRatio);
    if (p.input.left) p.angle -= turnRate * dt;
    if (p.input.right) p.angle += turnRate * dt;

    // Integrate
    p.x += Math.cos(p.angle) * p.speed * dt;
    p.y += Math.sin(p.angle) * p.speed * dt;

    // Bounds
    const margin = 20;
    if (p.x < margin) { p.x = margin; p.speed = 0; }
    if (p.x > GAME_CONFIG.worldWidth - margin) { p.x = GAME_CONFIG.worldWidth - margin; p.speed = 0; }
    if (p.y < margin) { p.y = margin; p.speed = 0; }
    if (p.y > GAME_CONFIG.worldHeight - margin) { p.y = GAME_CONFIG.worldHeight - margin; p.speed = 0; }
  }

  // Broadcast compact state
  const state = [];
  for (const p of players.values()) {
    state.push({ id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, angle: p.angle });
  }
  io.emit('state', { players: state });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});