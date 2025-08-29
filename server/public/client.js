(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  let worldWidth = 1000;
  let worldHeight = 600;
  let scale = 1;

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    scale = Math.min(canvas.width / worldWidth, canvas.height / worldHeight);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }
  window.addEventListener('resize', resizeCanvas);

  const socket = io({ transports: ['websocket'] });
  let myId = null;
  let lastPing = 0;

  socket.on('connect', () => {
    // will receive init next
  });

  socket.on('init', ({ id, config }) => {
    myId = id;
    if (config) {
      worldWidth = config.worldWidth || worldWidth;
      worldHeight = config.worldHeight || worldHeight;
    }
    resizeCanvas();
  });

  const input = { up: false, down: false, left: false, right: false };
  const keyMap = new Map([
    ['ArrowUp', 'up'], ['KeyW', 'up'],
    ['ArrowDown', 'down'], ['KeyS', 'down'],
    ['ArrowLeft', 'left'], ['KeyA', 'left'],
    ['ArrowRight', 'right'], ['KeyD', 'right'],
  ]);

  function handleKey(e, isDown) {
    const code = e.code;
    if (keyMap.has(code)) {
      input[keyMap.get(code)] = isDown;
      e.preventDefault();
      e.stopPropagation();
    }
  }
  window.addEventListener('keydown', (e) => handleKey(e, true));
  window.addEventListener('keyup', (e) => handleKey(e, false));

  // Send inputs at 30Hz or when changed
  let lastSent = 0;
  let lastInputSent = JSON.stringify(input);
  function maybeSendInput(ts) {
    const now = ts || performance.now();
    const payload = JSON.stringify(input);
    if (payload !== lastInputSent || now - lastSent > 1000 / 30) {
      socket.emit('input', input);
      lastInputSent = payload;
      lastSent = now;
    }
  }

  // Join form
  const form = document.getElementById('joinForm');
  const overlay = document.getElementById('overlay');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = (document.getElementById('name').value || '').trim();
    socket.emit('join', { name });
    overlay.style.display = 'none';
  });

  // HUD
  const pingEl = document.getElementById('ping');
  const playersEl = document.getElementById('players');

  // Simple ping measurement
  setInterval(() => {
    const start = performance.now();
    socket.timeout(3000).emit('pingCheck', null, () => {
      lastPing = Math.round(performance.now() - start);
      pingEl.textContent = `${lastPing} ms`;
    });
  }, 2000);

  // Server may not handle pingCheck; ignore errors
  socket.on('connect_error', () => {});

  let latestState = { players: [] };
  socket.on('state', (state) => {
    latestState = state || { players: [] };
    playersEl.textContent = `Players: ${latestState.players.length}`;
  });

  function drawTrack() {
    // Outer boundary
    const W = worldWidth;
    const H = worldHeight;

    // Background
    ctx.fillStyle = '#0b1021';
    ctx.fillRect(0, 0, W, H);

    // Track: simple oval-like rounded rectangle
    const trackOuter = { x: 40, y: 40, w: W - 80, h: H - 80, r: 140 };
    const trackInner = { x: 200, y: 140, w: W - 400, h: H - 280, r: 100 };

    function roundedRectPath({ x, y, w, h, r }) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    // Grass
    ctx.fillStyle = '#0e3b1a';
    ctx.fillRect(0, 0, W, H);

    // Outer asphalt
    ctx.save();
    roundedRectPath(trackOuter);
    ctx.clip();
    ctx.fillStyle = '#333949';
    ctx.fillRect(0, 0, W, H);

    // Inner grass hole
    ctx.globalCompositeOperation = 'destination-out';
    roundedRectPath(trackInner);
    ctx.fill();
    ctx.restore();

    // Lane markers
    ctx.strokeStyle = '#bfc7ff';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    roundedRectPath({ x: (trackOuter.x + trackInner.x) / 2, y: (trackOuter.y + trackInner.y) / 2, w: (trackOuter.w + trackInner.w) / 2, h: (trackOuter.h + trackInner.h) / 2, r: (trackOuter.r + trackInner.r) / 2 });
    ctx.stroke();
    ctx.setLineDash([]);

    // Start/finish line
    ctx.fillStyle = '#ffffff';
    const lineX = 100;
    ctx.fillRect(lineX, trackInner.y, 6, trackOuter.h);
  }

  function drawCar(p, isMe) {
    const carLength = 30;
    const carWidth = 18;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);

    // Body
    ctx.fillStyle = p.color;
    ctx.strokeStyle = isMe ? '#ffffff' : '#11161f';
    ctx.lineWidth = isMe ? 2.5 : 1.2;
    ctx.beginPath();
    ctx.roundRect(-carLength / 2, -carWidth / 2, carLength, carWidth, 4);
    ctx.fill();
    ctx.stroke();

    // Nose
    ctx.fillStyle = '#00000055';
    ctx.beginPath();
    ctx.moveTo(carLength / 2, 0);
    ctx.lineTo(carLength / 2 - 8, -carWidth / 2);
    ctx.lineTo(carLength / 2 - 8, carWidth / 2);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // Nameplate
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = isMe ? '#ffffff' : '#d2d9ff';
    ctx.fillText(p.name, p.x, p.y - 16);
  }

  function loop(ts) {
    maybeSendInput(ts);

    drawTrack();

    // Draw players
    const list = latestState.players || [];
    for (const p of list) {
      drawCar(p, p.id === myId);
    }

    requestAnimationFrame(loop);
  }
  resizeCanvas();
  requestAnimationFrame(loop);
})();