(() => {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayText = document.getElementById('overlayText');
  const startBtn = document.getElementById('startBtn');
  const scoreEl = document.getElementById('score');
  const livesEl = document.getElementById('lives');
  const levelEl = document.getElementById('level');

  const W = canvas.width;
  const H = canvas.height;

  const STATE = { MENU: 0, PLAYING: 1, PAUSED: 2, GAMEOVER: 3 };

  // 隕石のサイズ定義（3=大, 2=中, 1=小）
  const ASTEROID = {
    3: { radius: 44, score: 20, speed: 0.6 },
    2: { radius: 26, score: 50, speed: 1.1 },
    1: { radius: 14, score: 100, speed: 1.7 },
  };

  let state = STATE.MENU;
  let score = 0;
  let lives = 3;
  let level = 1;
  let frame = 0;
  let shakeTimer = 0;

  const keys = {};
  const stars = [];
  const bullets = [];        // 自機の弾
  const enemyBullets = [];   // 敵宇宙船の弾
  const asteroids = [];
  const particles = [];

  // 敵の宇宙船（一度に1機のみ）
  let ufo = null;
  let ufoTimer = 0;

  const ship = {
    x: W / 2,
    y: H / 2,
    angle: -Math.PI / 2, // 上向き
    vx: 0,
    vy: 0,
    radius: 14,
    rotSpeed: 0.06,
    thrust: 0.12,
    friction: 0.994,
    fireCooldown: 0,
    invincible: 0,
    thrusting: false,
    reversing: false,
  };

  for (let i = 0; i < 120; i++) {
    stars.push({
      x: Math.random() * W,
      y: Math.random() * H,
      size: Math.random() * 1.8 + 0.4,
      twinkle: Math.random() * Math.PI * 2,
    });
  }

  document.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'Space') e.preventDefault();
    if (e.code === 'KeyP' && state === STATE.PLAYING) {
      state = STATE.PAUSED;
      showOverlay('一時停止', 'P キーで再開', '再開');
    } else if (e.code === 'KeyP' && state === STATE.PAUSED) {
      state = STATE.PLAYING;
      hideOverlay();
    }
  });

  document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });

  startBtn.addEventListener('click', () => {
    if (state === STATE.MENU || state === STATE.GAMEOVER) {
      resetGame();
      state = STATE.PLAYING;
      hideOverlay();
    } else if (state === STATE.PAUSED) {
      state = STATE.PLAYING;
      hideOverlay();
    }
  });

  function showOverlay(title, text, btnText) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    startBtn.textContent = btnText || 'ゲーム開始';
    overlay.classList.remove('hidden');
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  function updateHUD() {
    scoreEl.textContent = score;
    livesEl.textContent = lives;
    levelEl.textContent = level;
  }

  function resetShip() {
    ship.x = W / 2;
    ship.y = H / 2;
    ship.angle = -Math.PI / 2;
    ship.vx = 0;
    ship.vy = 0;
    ship.fireCooldown = 0;
    ship.invincible = 120;
  }

  function resetGame() {
    score = 0;
    lives = 3;
    level = 1;
    frame = 0;
    bullets.length = 0;
    enemyBullets.length = 0;
    asteroids.length = 0;
    particles.length = 0;
    ufo = null;
    ufoTimer = 0;
    resetShip();
    ship.invincible = 90;
    startLevel();
    updateHUD();
  }

  // レベル開始時に隕石を配置
  function startLevel() {
    asteroids.length = 0;
    const count = 3 + level; // 大きな隕石の数
    for (let i = 0; i < count; i++) {
      // 自機の近くには湧かせない
      let x, y;
      do {
        x = Math.random() * W;
        y = Math.random() * H;
      } while (Math.hypot(x - ship.x, y - ship.y) < 140);
      spawnAsteroid(x, y, 3);
    }
    // 次のレベルの敵宇宙船出現タイマー（レベル3以降で使用）
    ufo = null;
    ufoTimer = 0;
  }

  function makeAsteroidShape(radius) {
    const verts = [];
    const n = 10 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const r = radius * (0.75 + Math.random() * 0.4);
      verts.push({ ang, r });
    }
    return verts;
  }

  function spawnAsteroid(x, y, size, vx, vy) {
    const def = ASTEROID[size];
    if (vx === undefined) {
      const a = Math.random() * Math.PI * 2;
      const sp = def.speed * (0.6 + Math.random() * 0.8);
      vx = Math.cos(a) * sp;
      vy = Math.sin(a) * sp;
    }
    asteroids.push({
      x, y, vx, vy,
      size,
      radius: def.radius,
      shape: makeAsteroidShape(def.radius),
      spin: (Math.random() - 0.5) * 0.03,
      rot: Math.random() * Math.PI * 2,
      hitCooldown: 0, // 隕石同士の連続衝突を防ぐ
    });
  }

  // 隕石を破壊（弾 or 衝突）→ 小さい隕石に分裂
  function breakAsteroid(index, bonus) {
    const a = asteroids[index];
    if (!a) return;
    score += ASTEROID[a.size].score;
    if (bonus) score += bonus;
    addParticles(a.x, a.y, '#c9d4e0', a.size * 6);
    asteroids.splice(index, 1);

    if (a.size > 1) {
      const childSize = a.size - 1;
      const pieces = 2;
      for (let i = 0; i < pieces; i++) {
        const a2 = Math.random() * Math.PI * 2;
        const sp = ASTEROID[childSize].speed * (0.8 + Math.random() * 0.6);
        spawnAsteroid(
          a.x, a.y, childSize,
          Math.cos(a2) * sp + a.vx * 0.3,
          Math.sin(a2) * sp + a.vy * 0.3
        );
      }
    }
    updateHUD();
  }

  function spawnUfo() {
    const fromLeft = Math.random() < 0.5;
    ufo = {
      x: fromLeft ? -40 : W + 40,
      y: 60 + Math.random() * (H - 120),
      vx: (fromLeft ? 1 : -1) * (1.2 + level * 0.1),
      vy: 0,
      radius: 18,
      fireCooldown: 90,
      wobble: Math.random() * Math.PI * 2,
      score: 500,
    };
  }

  function fireBullet() {
    const speed = 8;
    bullets.push({
      x: ship.x + Math.cos(ship.angle) * ship.radius,
      y: ship.y + Math.sin(ship.angle) * ship.radius,
      vx: Math.cos(ship.angle) * speed + ship.vx,
      vy: Math.sin(ship.angle) * speed + ship.vy,
      life: 70,
      radius: 2.5,
    });
  }

  function fireUfoBullet() {
    const dx = ship.x - ufo.x;
    const dy = ship.y - ufo.y;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = 3.2 + level * 0.15;
    enemyBullets.push({
      x: ufo.x,
      y: ufo.y,
      vx: (dx / dist) * speed,
      vy: (dy / dist) * speed,
      life: 160,
      radius: 3.5,
    });
  }

  function addParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 3.5 + 0.5;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 24 + Math.random() * 22,
        maxLife: 46,
        color,
        size: Math.random() * 2.5 + 1,
      });
    }
  }

  function wrap(obj) {
    if (obj.x < -obj.radius) obj.x = W + obj.radius;
    else if (obj.x > W + obj.radius) obj.x = -obj.radius;
    if (obj.y < -obj.radius) obj.y = H + obj.radius;
    else if (obj.y > H + obj.radius) obj.y = -obj.radius;
  }

  function circleHit(a, b, pad = 0) {
    return Math.hypot(a.x - b.x, a.y - b.y) < a.radius + b.radius + pad;
  }

  function killShip() {
    if (ship.invincible > 0) return;
    lives--;
    shakeTimer = 18;
    addParticles(ship.x, ship.y, '#00f0ff', 26);
    updateHUD();
    if (lives <= 0) {
      state = STATE.GAMEOVER;
      showOverlay('ゲームオーバー', `スコア: ${score}  /  レベル: ${level}`, 'もう一度');
    } else {
      resetShip();
    }
  }

  function update() {
    if (state !== STATE.PLAYING) return;
    frame++;

    // --- 自機の操作 ---
    if (keys['ArrowLeft'] || keys['KeyA']) ship.angle -= ship.rotSpeed;
    if (keys['ArrowRight'] || keys['KeyD']) ship.angle += ship.rotSpeed;

    ship.thrusting = false;
    ship.reversing = false;
    if (keys['ArrowUp'] || keys['KeyW']) {
      ship.vx += Math.cos(ship.angle) * ship.thrust;
      ship.vy += Math.sin(ship.angle) * ship.thrust;
      ship.thrusting = true;
    }
    if (keys['ArrowDown'] || keys['KeyS']) {
      // 逆噴射で減速
      ship.vx -= Math.cos(ship.angle) * ship.thrust * 0.7;
      ship.vy -= Math.sin(ship.angle) * ship.thrust * 0.7;
      ship.reversing = true;
    }

    ship.vx *= ship.friction;
    ship.vy *= ship.friction;
    // 最高速度制限
    const sp = Math.hypot(ship.vx, ship.vy);
    const maxSp = 7;
    if (sp > maxSp) { ship.vx = ship.vx / sp * maxSp; ship.vy = ship.vy / sp * maxSp; }

    ship.x += ship.vx;
    ship.y += ship.vy;
    wrap(ship);

    if (ship.invincible > 0) ship.invincible--;
    if (ship.fireCooldown > 0) ship.fireCooldown--;

    if ((keys['Space'] || keys['KeyZ']) && ship.fireCooldown <= 0) {
      fireBullet();
      ship.fireCooldown = 10;
    }

    if (ship.thrusting && frame % 2 === 0) {
      const bx = ship.x - Math.cos(ship.angle) * ship.radius;
      const by = ship.y - Math.sin(ship.angle) * ship.radius;
      addParticles(bx, by, '#ff8800', 1);
    }

    // --- 自機の弾 ---
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx;
      b.y += b.vy;
      b.life--;
      wrap(b);
      if (b.life <= 0) { bullets.splice(i, 1); continue; }

      let consumed = false;
      // 隕石に命中
      for (let j = asteroids.length - 1; j >= 0; j--) {
        if (circleHit(b, asteroids[j])) {
          bullets.splice(i, 1);
          breakAsteroid(j);
          consumed = true;
          break;
        }
      }
      if (consumed) continue;

      // 敵宇宙船に命中
      if (ufo && circleHit(b, ufo)) {
        bullets.splice(i, 1);
        score += ufo.score;
        addParticles(ufo.x, ufo.y, '#39ff14', 30);
        ufo = null;
        ufoTimer = 400 + Math.floor(Math.random() * 300);
        updateHUD();
      }
    }

    // --- 隕石の移動と衝突 ---
    for (const a of asteroids) {
      a.x += a.vx;
      a.y += a.vy;
      a.rot += a.spin;
      if (a.hitCooldown > 0) a.hitCooldown--;
      wrap(a);
    }

    // 隕石同士の衝突 → 小さくなる
    for (let i = 0; i < asteroids.length; i++) {
      for (let j = i + 1; j < asteroids.length; j++) {
        const a = asteroids[i], b = asteroids[j];
        if (!a || !b) continue;
        if (a.hitCooldown > 0 || b.hitCooldown > 0) continue;
        if (circleHit(a, b)) {
          // 速度を交換して弾く
          const tvx = a.vx, tvy = a.vy;
          a.vx = b.vx; a.vy = b.vy;
          b.vx = tvx; b.vy = tvy;
          a.hitCooldown = 20;
          b.hitCooldown = 20;
          // 大きい方から分裂させる（インデックスの大きい順に処理）
          if (b.size > 1) breakAsteroid(j);
          if (a.size > 1) breakAsteroid(i);
          // 配列が変化したのでこのペア処理を終える
          i = -1;
          break;
        }
      }
      if (i === -1) break; // 分裂で配列が変わったら次フレームに委ねる
    }

    // 自機と隕石の衝突
    if (ship.invincible <= 0) {
      for (let j = asteroids.length - 1; j >= 0; j--) {
        if (circleHit(ship, asteroids[j], -2)) {
          killShip();
          break;
        }
      }
    }

    // --- 敵宇宙船 ---
    if (level >= 3) {
      if (ufo) {
        updateUfo();
      } else if (ufoTimer > 0) {
        ufoTimer--;
        if (ufoTimer <= 0) spawnUfo();
      } else if (asteroids.length > 0 && asteroids.length <= 3 + level - 3) {
        // 隕石が減ってきたら出現準備
        ufoTimer = 120;
      }
    }

    // --- 敵の弾 ---
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      b.x += b.vx;
      b.y += b.vy;
      b.life--;
      wrap(b);
      if (b.life <= 0) { enemyBullets.splice(i, 1); continue; }
      if (ship.invincible <= 0 && circleHit(b, ship)) {
        enemyBullets.splice(i, 1);
        killShip();
      }
    }

    // --- パーティクル ---
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life--;
      if (p.life <= 0) particles.splice(i, 1);
    }

    if (shakeTimer > 0) shakeTimer--;

    // --- レベルクリア判定 ---
    if (asteroids.length === 0) {
      level++;
      updateHUD();
      ship.invincible = Math.max(ship.invincible, 60);
      startLevel();
    }
  }

  function updateUfo() {
    const u = ufo;
    u.wobble += 0.04;
    u.x += u.vx;
    u.y += Math.sin(u.wobble) * 1.4;
    // 画面外（左右）に出たら消える
    if (u.x < -60 || u.x > W + 60) {
      ufo = null;
      ufoTimer = 400 + Math.floor(Math.random() * 300);
      return;
    }
    u.y = Math.max(u.radius, Math.min(H - u.radius, u.y));

    u.fireCooldown--;
    if (u.fireCooldown <= 0) {
      fireUfoBullet();
      u.fireCooldown = Math.max(45, 100 - level * 5);
    }

    // 敵宇宙船が隕石に当たると破壊される
    for (let j = asteroids.length - 1; j >= 0; j--) {
      if (circleHit(u, asteroids[j])) {
        addParticles(u.x, u.y, '#39ff14', 26);
        breakAsteroid(j);
        ufo = null;
        ufoTimer = 400 + Math.floor(Math.random() * 300);
        return;
      }
    }

    // 自機との接触
    if (ship.invincible <= 0 && circleHit(u, ship)) {
      addParticles(u.x, u.y, '#39ff14', 26);
      ufo = null;
      ufoTimer = 400 + Math.floor(Math.random() * 300);
      killShip();
    }
  }

  // ===== 描画 =====

  function drawShip() {
    if (ship.invincible > 0 && Math.floor(ship.invincible / 4) % 2 === 0) return;
    const { x, y, angle, radius } = ship;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 14;

    // 機体（三角形）
    ctx.strokeStyle = '#00f0ff';
    ctx.fillStyle = 'rgba(0,240,255,0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.lineTo(-radius * 0.8, -radius * 0.7);
    ctx.lineTo(-radius * 0.4, 0);
    ctx.lineTo(-radius * 0.8, radius * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 噴射炎
    if (ship.thrusting) {
      ctx.shadowColor = '#ff8800';
      ctx.fillStyle = '#ffaa33';
      ctx.beginPath();
      ctx.moveTo(-radius * 0.4, -radius * 0.3);
      ctx.lineTo(-radius * (1.1 + Math.random() * 0.5), 0);
      ctx.lineTo(-radius * 0.4, radius * 0.3);
      ctx.closePath();
      ctx.fill();
    }
    // 逆噴射炎（前方）
    if (ship.reversing) {
      ctx.shadowColor = '#ffd700';
      ctx.fillStyle = '#ffe066';
      ctx.beginPath();
      ctx.moveTo(radius * 0.9, -radius * 0.25);
      ctx.lineTo(radius * (1.3 + Math.random() * 0.3), 0);
      ctx.lineTo(radius * 0.9, radius * 0.25);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  function drawAsteroid(a) {
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(a.rot);
    ctx.shadowColor = '#8898aa';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = '#c9d4e0';
    ctx.fillStyle = 'rgba(140,152,170,0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    a.shape.forEach((v, i) => {
      const px = Math.cos(v.ang) * v.r;
      const py = Math.sin(v.ang) * v.r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawUfo() {
    if (!ufo) return;
    const u = ufo;
    ctx.save();
    ctx.translate(u.x, u.y);
    ctx.shadowColor = '#39ff14';
    ctx.shadowBlur = 16;
    ctx.strokeStyle = '#39ff14';
    ctx.fillStyle = 'rgba(57,255,20,0.15)';
    ctx.lineWidth = 2;

    // 円盤
    ctx.beginPath();
    ctx.ellipse(0, 0, u.radius, u.radius * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // ドーム
    ctx.beginPath();
    ctx.ellipse(0, -u.radius * 0.25, u.radius * 0.5, u.radius * 0.5, 0, Math.PI, 0);
    ctx.stroke();
    // ライト
    for (let i = -1; i <= 1; i++) {
      ctx.fillStyle = `rgba(200,255,180,${0.4 + Math.sin(frame * 0.2 + i) * 0.4})`;
      ctx.beginPath();
      ctx.arc(i * u.radius * 0.5, u.radius * 0.2, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function render() {
    let ox = 0, oy = 0;
    if (shakeTimer > 0) {
      ox = (Math.random() - 0.5) * 6;
      oy = (Math.random() - 0.5) * 6;
    }

    ctx.save();
    ctx.translate(ox, oy);

    ctx.fillStyle = '#050510';
    ctx.fillRect(-10, -10, W + 20, H + 20);

    for (const s of stars) {
      s.twinkle += 0.03;
      const a = 0.3 + Math.abs(Math.sin(s.twinkle)) * 0.5;
      ctx.fillStyle = `rgba(255,255,255,${a * (s.size / 2)})`;
      ctx.fillRect(s.x, s.y, s.size, s.size);
    }

    // 弾
    for (const b of bullets) {
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#aef6ff';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const b of enemyBullets) {
      ctx.shadowColor = '#ff2266';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#ff5588';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    for (const a of asteroids) drawAsteroid(a);
    drawUfo();
    drawShip();

    for (const p of particles) {
      const alpha = p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  function loop() {
    update();
    render();
    requestAnimationFrame(loop);
  }

  loop();
})();
