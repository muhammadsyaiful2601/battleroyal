
const stubEl={style:{},classList:{add(){},remove(){}},textContent:'',addEventListener(){},appendChild(){},remove(){}};
const ctxStub=new Proxy({},{get:(t,k)=>typeof k==='string'?()=>{}:undefined,set:()=>true});
global.document={getElementById:()=>stubEl,createElement:()=>stubEl};
global.window={innerWidth:800,innerHeight:600,addEventListener(){}};
global.navigator={maxTouchPoints:0};
global.requestAnimationFrame=()=>{};
/* ============================================================
   game.js — HTML5 Canvas Battle Royale (Offline)
   Pure Vanilla JavaScript. No framework. Zero-build step.
   Arsitektur:
     1. Konstanta & Konfigurasi
     2. State Game & Entitas (Player, Bot, Bullet, Loot, Zone)
     3. Input (Keyboard/Mouse & Touch Joystick)
     4. Game Loop (requestAnimationFrame)
     5. Fisika & Tabrakan
     6. Bot AI — Finite State Machine
     7. Rendering Canvas
     8. HUD (DOM)
   ============================================================ */



/* ============================================================
   1. KONSTANTA & KONFIGURASI
   Semua nilai tuning gameplay dikumpulkan di sini agar mudah
   dimodifikasi tanpa menyentuh logika inti.
   ============================================================ */
const CFG = {
  PLAYER_SPEED: 2.4,        // kecepatan gerak pemain (px/frame)
  BOT_SPEED: 2.0,           // kecepatan gerak bot
  BOT_RADIUS: 12,           // radius tubuh entitas (px)
  SIGHT_RANGE: 400,         // jarak pandang bot (PRD: LOS <= 400px)
  RETREAT_HP_PCT: 0.25,     // bot retreat saat HP < 25% (PRD)
  LOOT_PICKUP_RANGE: 28,    // jarak memungut loot
  BULLET_SPEED: 9,
  BULLET_LIFETIME: 90,      // umur peluru dalam frame
  ZONE_SHRINK_INTERVAL: 30, // zona menyusut tiap 30 detik
  ZONE_SHRINK_TIME: 15,     // durasi transisi penyusutan (detik)
  ZONE_DAMAGE: 1,           // damage danger zone per interval
  ZONE_DAMAGE_TICK: 30,     // frame antar tick damage zona
  MEDKIT_HEAL: 50,
  MEDKIT_USE_TIME: 180,     // 3 detik @60fps (PRD: berhenti bergerak)
  MAX_HP: 100,
};

// Spesifikasi senjata sesuai tabel Loot Engine di PRD
const WEAPONS = {
  fist:    { name: 'Tangan Kosong', damage: 5,  mag: 0,  range: 40,  fireRate: 30, spread: 0 },
  p92:     { name: 'P92',           damage: 18, mag: 12, range: 300, fireRate: 20, spread: 0.03 },
  ak47:    { name: 'AK-47',         damage: 32, mag: 30, range: 550, fireRate: 10, spread: 0.05 },
  shotgun: { name: 'S12K',          damage: 70, mag: 5,  range: 150, fireRate: 40, spread: 0.25 },
};
const LOOT_TYPES = ['p92', 'ak47', 'shotgun', 'ammo', 'medkit'];

/* ============================================================
   2. STATE GAME & ENTITAS
   Semua objek disimpan dalam array / objek global sederhana.
   - world    : dunia permainan (peta lebih besar dari layar)
   - camera   : offset kamera mengikuti pemain
   - zone     : safe zone (putih) & danger zone (biru transparan)
   ============================================================ */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const state = {
  running: false,
  frame: 0,
  world: { width: 3000, height: 3000 },  // ukuran peta arena
  camera: { x: 0, y: 0 },
  player: null,
  bots: [],
  bullets: [],   // array peluru aktif
  loots: [],     // array item loot di tanah
  zone: null,    // { cx, cy, r, targetCx, targetCy, targetR, shrinking }
  aliveCount: 1,
  totalEntities: 1,
  gameOver: false,
};

/* ---------- Factory: buat entitas (Player / Bot) ----------
   Struktur objek entitas dipakai bersama oleh fisika, AI & render */
function createEntity(x, y, isPlayer, name) {
  return {
    x, y,
    vx: 0, vy: 0,          // kecepatan (dihitung tiap frame)
    angle: 0,              // arah hadap (radian)
    hp: CFG.MAX_HP,
    isPlayer,
    name,
    alive: true,
    weapon: null,          // null = tangan kosong
    ammoInMag: 0,
    reserveAmmo: 0,
    fireCooldown: 0,       // jeda antar tembakan
    medkits: 0,
    usingMedkit: 0,        // sisa frame pemakaian medkit (berhenti bergerak)
    // --- properti khusus AI (FSM) ---
    aiState: 'WANDER',     // WANDER | MOVE_TO_ZONE | ATTACK | RETREAT
    aiTarget: null,        // entitas musuh yang sedang diattack
    aiMoveTarget: { x, y },// titik tujuan wander/loot/retreat
  };
}

/* ---------- Init: mulai game baru ---------- */
function startGame(botCount) {
  state.frame = 0;
  state.gameOver = false;
  state.bullets = [];
  state.loots = [];
  state.bots = [];

  // Spawn pemain di posisi acak dalam peta
  state.player = createEntity(
    rand(200, state.world.width - 200),
    rand(200, state.world.height - 200),
    true, 'Pemain'
  );

  // Spawn bot sesuai jumlah yang dipilih di menu
  for (let i = 0; i < botCount; i++) {
    state.bots.push(createEntity(
      rand(100, state.world.width - 100),
      rand(100, state.world.height - 100),
      false, 'Bot_' + String(i).padStart(2, '0')
    ));
  }


/* ============================================================
   3. INPUT — Deteksi Dinamis Mobile vs Desktop
   Mobile : Touch API (virtual joystick kiri + tombol aksi kanan)
   Desktop: Keyboard WASD + Mouse (aiming & klik kiri tembak)
   ============================================================ */
const input = {
  // Keyboard state (desktop)
  keys: {},
  mouse: { x: 0, y: 0, down: false },     // koordinat layar
  // Touch joystick state (mobile)
  joystick: { active: false, dx: 0, dy: 0, touchId: null },
  firePressed: false,                     // tombol FIRE mobile ditekan
};

// Deteksi otomatis perangkat sentuh (sesuai potongan PRD Bab 6.1)
const isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

function setupInput() {
  if (isMobile) {
    // Tampilkan kontrol mobile, sembunyikan default CSS
    document.getElementById('mobileControls').style.display = 'block';
    setupTouchControls();
  } else {
    document.getElementById('mobileControls').style.display = 'none';
    window.addEventListener('keydown', (e) => { input.keys[e.key.toLowerCase()] = true; handleKeyDown(e); });
    window.addEventListener('keyup', (e) => { input.keys[e.key.toLowerCase()] = false; });
    window.addEventListener('mousemove', (e) => {
      input.mouse.x = e.clientX;
      input.mouse.y = e.clientY;
    });
    window.addEventListener('mousedown', (e) => { if (e.button === 0) input.mouse.down = true; });
    window.addEventListener('mouseup',   (e) => { if (e.button === 0) input.mouse.down = false; });
    // Cegah context menu mengganggu klik kanan
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}

/* Aksi sekunder keyboard: R reload, E ambil loot, F medkit */
function handleKeyDown(e) {
  const p = state.player;
  if (!p || !p.alive) return;
  const k = e.key.toLowerCase();
  if (k === 'r') reloadWeapon(p);
  if (k === 'e') tryPickupLoot(p);
  if (k === 'f') useMedkit(p);
}

/* ---------- Setup Virtual Joystick + Tombol (Mobile) ----------
   Multi-touch: joystick memakai touchId tersendiri sehingga tidak
   bentrok dengan tombol FIRE yang ditekan jari kedua (PRD QA). */
function setupTouchControls() {
  const zone = document.getElementById('joystickZone');
  const base = document.getElementById('joystickBase');
  const knob = document.getElementById('joystickKnob');
  const MAX_R = 48; // radius maksimal pergeseran knob

  zone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    input.joystick.touchId = t.identifier;
    input.joystick.active = true;
    // Posisi base mengikuti titik sentuh (floating joystick)
    base.style.left = (t.clientX - 60) + 'px';
    base.style.top  = (t.clientY - 60) + 'px';
  }, { passive: false });

  zone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== input.joystick.touchId) continue;
      const baseX = parseFloat(base.style.left) + 60;
      const baseY = parseFloat(base.style.top) + 60;
      let dx = t.clientX - baseX;
      let dy = t.clientY - baseY;
      const dist = Math.hypot(dx, dy);
      if (dist > MAX_R) { dx = (dx / dist) * MAX_R; dy = (dy / dist) * MAX_R; }
      input.joystick.dx = dx / MAX_R;   // normalisasi -1..1
      input.joystick.dy = dy / MAX_R;
      knob.style.left = (34 + dx) + 'px';
      knob.style.top  = (34 + dy) + 'px';
    }
  }, { passive: false });

  function endTouch(e) {
    for (const t of e.changedTouches) {
      if (t.identifier !== input.joystick.touchId) continue;
      input.joystick.active = false;
      input.joystick.dx = 0; input.joystick.dy = 0;
      knob.style.left = '34px'; knob.style.top = '34px';
    }
  }
  zone.addEventListener('touchend', endTouch);
  zone.addEventListener('touchcancel', endTouch);

  // Tombol aksi
  const hold = (id, on, off) => {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); on(); }, { passive: false });
    if (off) el.addEventListener('touchend', off);
  };
  hold('btnFire', () => input.firePressed = true, () => input.firePressed = false);
  hold('btnReload',   () => state.player && reloadWeapon(state.player));
  hold('btnMedkit',   () => state.player && useMedkit(state.player));
  hold('btnInteract', () => state.player && tryPickupLoot(state.player));
}

/* ============================================================
   4. GAME LOOP INTI (60 FPS via requestAnimationFrame)
   Urutan: updatePhysics -> updateAI -> renderCanvas -> HUD
   ============================================================ */
function gameLoop() {
  requestAnimationFrame(gameLoop); // jadwalkan frame berikutnya
  if (!state.running) return;      // masih di menu / game over

  state.frame++;

  updateZone();        // zona menyusut berdasarkan interval waktu
  updatePhysics();     // perbarui pemain, bot, peluru, damage zona
  updateAI();          // perbarui FSM logika bot
  updateCamera();
  renderCanvas();      // render background, item, karakter, efek
  updateHUD();         // sinkronisasi HUD DOM tiap frame
}

/* ---------- Update fisika & logika pemain ---------- */
function updatePhysics() {
  const p = state.player;
  if (!p || !p.alive) return;

  // --- Arah input pemain (prioritas keyboard, lalu joystick) ---
  let ix = 0, iy = 0;
  if (input.keys['w']) iy -= 1;   // W = atas (sumbu Y negatif)
  if (input.keys['s']) iy += 1;   // S = bawah
  if (input.keys['a']) ix -= 1;   // A = kiri (sumbu X negatif)
  if (input.keys['d']) ix += 1;   // D = kanan
  if (ix || iy) {
    const len = Math.hypot(ix, iy);
    ix /= len; iy /= len;
  }
  if (input.joystick.active) { ix = input.joystick.dx; iy = input.joystick.dy; }

  // Medkit sedang dipakai -> karakter terkunci tidak bisa bergerak (PRD)
  if (p.usingMedkit > 0) { p.usingMedkit--; ix = 0; iy = 0; }

  // --- Terapkan gerak + batasi ke tepi peta ---
  p.vx = ix * CFG.PLAYER_SPEED;
  p.vy = iy * CFG.PLAYER_SPEED;
  p.x = clamp(p.x + p.vx, 20, state.world.width - 20);
  p.y = clamp(p.y + p.vy, 20, state.world.height - 20);


/* ---------- Coba tembakkan senjata dari entitas ---------- */
function tryShoot(ent) {
  const w = ent.weapon;
  if (!w || ent.fireCooldown > 0) return;      // tangan kosong / masih cooldown
  if (ent.ammoInMag <= 0) { reloadWeapon(ent); return; }

  ent.ammoInMag--;
  ent.fireCooldown = w.fireRate;

  // Peluru: titik awal sedikit di depan moncong agar tidak menabrak diri
  const sx = ent.x + Math.cos(ent.angle) * 18;
  const sy = ent.y + Math.sin(ent.angle) * 18;
  // Spread: peluru menyimpang acak (signifikan pada shotgun S12K)
  const a = ent.angle + rand(-w.spread, w.spread);
  state.bullets.push({
    x: sx, y: sy,
    vx: Math.cos(a) * CFG.BULLET_SPEED,
    vy: Math.sin(a) * CFG.BULLET_SPEED,
    damage: w.damage,
    range: w.range,
    traveled: 0,
    owner: ent,
    life: CFG.BULLET_LIFETIME,
  });
}

/* ---------- Reload: pindahkan cadangan peluru ke magazin ---------- */
function reloadWeapon(ent) {
  const w = ent.weapon;
  if (!w || ent.ammoInMag >= w.mag || ent.reserveAmmo <= 0) return;
  const take = Math.min(w.mag - ent.ammoInMag, ent.reserveAmmo);
  ent.ammoInMag += take;
  ent.reserveAmmo -= take;
}

/* ---------- Gunakan medkit: +50 HP setelah 3 detik (berhenti bergerak) ---------- */
function useMedkit(ent) {
  if (ent.medkits <= 0 || ent.hp >= CFG.MAX_HP || ent.usingMedkit > 0) return;
  ent.medkits--;
  ent.usingMedkit = CFG.MEDKIT_USE_TIME; // mengunci gerakan di updatePhysics
  setTimeout(() => {
    if (ent.alive) ent.hp = Math.min(CFG.MAX_HP, ent.hp + CFG.MEDKIT_HEAL);
  }, (CFG.MEDKIT_USE_TIME / 60) * 1000);
}

/* ---------- Ambil loot terdekat dalam jangkauan ---------- */
function tryPickupLoot(ent) {

/* ============================================================
   5. PELURU, ZONA, KAMERA
   ============================================================ */

/* ---------- Update peluru: gerak, jarak, tabrakan ----------
   Tabrakan sederhana: jarak titik peluru ke pusat entitas <
   radius tubuh. Peluru mengenai siapa pun KECUALI pemiliknya. */
function updateBullets() {
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i];
    b.x += b.vx;
    b.y += b.vy;
    b.traveled += Math.hypot(b.vx, b.vy);
    b.life--;

    let dead = b.life <= 0 || b.traveled > b.range;

    // Cek tabrakan ke pemain & semua bot
    if (!dead) {
      const targets = [state.player, ...state.bots];
      for (const t of targets) {
        if (!t || !t.alive || t === b.owner) continue;
        if (Math.hypot(t.x - b.x, t.y - b.y) < CFG.BOT_RADIUS) {
          t.hp -= b.damage;
          dead = true;
          if (t.hp <= 0) killEntity(t, b.owner);
          break;
        }
      }
    }
    if (dead) state.bullets.splice(i, 1);
  }
}

/* ---------- Eliminasi entitas: mati & jatuhkan loot crate ---------- */
function killEntity(ent, killer) {
  ent.alive = false;
  ent.hp = 0;
  state.aliveCount--;
  addKillFeed(`${ent.name} tereliminasi oleh ${killer ? killer.name : 'Zona'}`);

  // Jatuhkan loot crate berisi senjata & medkit miliknya
  if (ent.weapon) {
    const t = ent.weapon === WEAPONS.p92 ? 'p92' : ent.weapon === WEAPONS.ak47 ? 'ak47' : 'shotgun';
    state.loots.push({ x: ent.x, y: ent.y, type: t });
  }
  state.loots.push({ x: ent.x + 15, y: ent.y, type: 'medkit' });

  // Kondisi menang / kalah (PRD Bab 3.1 poin 6)
  if (ent.isPlayer) endGame(false);
  else if (state.aliveCount === 1 && state.player.alive) endGame(true);
}

/* ---------- Update zona: jadwal penyusutan & interpolasi ---------- */
function updateZone() {
  const z = state.zone;
  if (!z) return;
  const now = state.frame;

  if (!z.shrinking && now >= z.nextShrink && z.r > 250) {
    // Zona target: lingkaran baru di dalam zona saat ini
    const newR = z.r * 0.65;
    const off = (z.r - newR) * 0.5;
    z.targetCx = z.cx + rand(-off, off);
    z.targetCy = z.cy + rand(-off, off);
    z.targetR = newR;
    z.shrinking = true;
    z.shrinkStart = now;
    z.shrinkEnd = now + CFG.ZONE_SHRINK_TIME * 60;
    z.startCx = z.cx; z.startCy = z.cy; z.startR = z.r;
  }

  if (z.shrinking) {
    // Interpolasi linear dari zona lama ke zona target
    const t = Math.min(1, (now - z.shrinkStart) / (z.shrinkEnd - z.shrinkStart));
    z.cx = z.startCx + (z.targetCx - z.startCx) * t;
    z.cy = z.startCy + (z.targetCy - z.startCy) * t;
    z.r  = z.startR  + (z.targetR  - z.startR)  * t;
    if (t >= 1) {
      z.shrinking = false;
      z.nextShrink = now + CFG.ZONE_SHRINK_INTERVAL * 60;
    }
  }
}

/* ---------- Damage keluar Safe Zone (tick berkala) ---------- */
function applyZoneDamage(ent) {
  if (!ent.alive) return;
  if (state.frame % CFG.ZONE_DAMAGE_TICK !== 0) return;
  const z = state.zone;
  if (Math.hypot(ent.x - z.cx, ent.y - z.cy) > z.r) {
    ent.hp -= CFG.ZONE_DAMAGE * (ent.isPlayer ? 2 : 1);
    if (ent.hp <= 0) killEntity(ent, null);
  }

/* ============================================================
   6. BOT AI — FINITE STATE MACHINE (PRD Bab 4)
   4 status:
     WANDER / LOOT   : tak ada musuh & di zona aman -> cari loot
     MOVE TO ZONE    : di luar safe zone -> lari ke tengah zona
     ATTACK / COMBAT : musuh terlihat (LOS <= 400px) -> arah & tembak
     RETREAT / HEAL  : HP < 25% & punya medkit -> menjauh & heal
   ============================================================ */
function updateAI() {
  for (const bot of state.bots) {
    if (!bot.alive) continue;

    // ---- 1. Evaluasi state baru (transisi FSM) ----
    const enemy = findNearestVisibleEnemy(bot);
    const outsideZone = Math.hypot(bot.x - state.zone.cx, bot.y - state.zone.cy) > state.zone.r;
    const lowHP = bot.hp / CFG.MAX_HP < CFG.RETREAT_HP_PCT;

    if (lowHP && bot.medkits > 0) {
      bot.aiState = 'RETREAT';               // HP < 25% & punya medkit
    } else if (outsideZone) {
      bot.aiState = 'MOVE_TO_ZONE';          // zona menyusut, lari ke zona
    } else if (enemy) {
      bot.aiState = 'ATTACK';                // ada musuh dalam LOS
      bot.aiTarget = enemy;
    } else {
      bot.aiState = 'WANDER';
    }

    // ---- 2. Eksekusi perilaku sesuai state ----
    switch (bot.aiState) {
      case 'WANDER':
        botWander(bot);
        break;
      case 'MOVE_TO_ZONE':
        // Berlari langsung ke titik tengah Safe Zone terkini (PRD)
        botMoveTarget(bot, state.zone.cx, state.zone.cy);
        break;
      case 'ATTACK':
        botAttack(bot, bot.aiTarget);
        break;
      case 'RETREAT':
        botRetreat(bot, bot.aiTarget);
        break;
    }

    // Terapkan gerakan + batas peta
    bot.x = clamp(bot.x + bot.vx, 20, state.world.width - 20);
    bot.y = clamp(bot.y + bot.vy, 20, state.world.height - 20);
    applyZoneDamage(bot);
  }
}

/* Cari musuh (pemain/bot lain) terdekat dalam jarak pandang */
function findNearestVisibleEnemy(bot) {
  let best = null, bestDist = CFG.SIGHT_RANGE;
  const candidates = [state.player, ...state.bots];
  for (const c of candidates) {
    if (!c || !c.alive || c === bot) continue;
    const d = Math.hypot(c.x - bot.x, c.y - bot.y);
    if (d < bestDist) { best = c; bestDist = d; }
  }
  return best;
}

/* WANDER: menuju loot terdekat / titik acak; ambil loot jika dekat */
function botWander(bot) {
  // Prioritas: menuju loot terdekat (looting phase PRD)
  let nearestLoot = null, nd = Infinity;
  for (const l of state.loots) {
    const d = Math.hypot(l.x - bot.x, l.y - bot.y);
    if (d < nd) { nd = d; nearestLoot = l; }
  }
  if (nearestLoot && nd < 300) {
    botMoveTarget(bot, nearestLoot.x, nearestLoot.y);
    if (nd < CFG.LOOT_PICKUP_RANGE) tryPickupLoot(bot);
  } else {
    // Titik acak baru bila tujuan lama sudah dicapai
    if (Math.hypot(bot.aiMoveTarget.x - bot.x, bot.aiMoveTarget.y - bot.y) < 30) {
      bot.aiMoveTarget = { x: rand(100, state.world.width - 100), y: rand(100, state.world.height - 100) };
    }
    botMoveTarget(bot, bot.aiMoveTarget.x, bot.aiMoveTarget.y);
  }
}

/* ATTACK: berhenti sejenak, arahkan rotasi ke target, tembak berulang */
function botAttack(bot, target) {
  if (!target || !target.alive) { bot.vx = 0; bot.vy = 0; return; }
  bot.angle = Math.atan2(target.y - bot.y, target.x - bot.x);
  // Strafe sederhana agar tidak mudah ditembak
  bot.vx = Math.cos(bot.angle + Math.PI / 2) * CFG.BOT_SPEED * 0.5;
  bot.vy = Math.sin(bot.angle + Math.PI / 2) * CFG.BOT_SPEED * 0.5;
  const dist = Math.hypot(target.x - bot.x, target.y - bot.y);
  if (dist < (bot.weapon ? bot.weapon.range : 40)) tryShoot(bot);
}

/* RETREAT: berlari menjauh dari musuh & gunakan medkit */
function botRetreat(bot, threat) {
  if (!bot.usingMedkit) useMedkit(bot); // berhenti bergerak selama heal
  let ax = 0, ay = 0;
  if (threat) {
    ax = bot.x - threat.x; ay = bot.y - threat.y; // vektor menjauh
    const len = Math.hypot(ax, ay) || 1;
    ax /= len; ay /= len;
  }
  if (bot.usingMedkit > 0) { bot.usingMedkit--; bot.vx = 0; bot.vy = 0; }
  else {
    bot.vx = ax * CFG.BOT_SPEED;
    bot.vy = ay * CFG.BOT_SPEED;
    bot.angle = Math.atan2(ay, ax);
  }
}

/* Gerakkan bot menuju titik (dx, dy) */
function botMoveTarget(bot, tx, ty) {
  const dx = tx - bot.x, dy = ty - bot.y;
  const len = Math.hypot(dx, dy) || 1;
  bot.vx = (dx / len) * CFG.BOT_SPEED;
  bot.vy = (dy / len) * CFG.BOT_SPEED;
  bot.angle = Math.atan2(dy, dx);
}

/* ============================================================
   7. RENDERING CANVAS
   Urutan: background grid -> safe/danger zone -> loot -> peluru
   -> entitas -> minimap (radar)
   ============================================================ */
function renderCanvas() {
  const cam = state.camera;

  // --- Background rumput ---
  ctx.fillStyle = '#1b3a2a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // --- Grid halus sebagai penanda dunia ---
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  const GRID = 100;
  const startX = Math.floor(cam.x / GRID) * GRID;
  const startY = Math.floor(cam.y / GRID) * GRID;
  ctx.beginPath();
  for (let x = startX; x < cam.x + canvas.width + GRID; x += GRID) {
    ctx.moveTo(x - cam.x, 0); ctx.lineTo(x - cam.x, canvas.height);
  }
  for (let y = startY; y < cam.y + canvas.height + GRID; y += GRID) {
    ctx.moveTo(0, y - cam.y); ctx.lineTo(canvas.width, y - cam.y);
  }
  ctx.stroke();

  // --- Danger Zone (biru transparan, PRD) ---
  const z = state.zone;
  ctx.fillStyle = 'rgba(60, 120, 220, 0.20)';
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.arc(z.cx - cam.x, z.cy - cam.y, z.r, 0, Math.PI * 2, true); // lubang lingkaran
  ctx.fill();

  // --- Safe Zone (lingkaran putih, PRD) ---
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(z.cx - cam.x, z.cy - cam.y, z.r, 0, Math.PI * 2);
  ctx.stroke();

  // --- Loot (kotak kuning kecil) ---
  for (const l of state.loots) {
    const sx = l.x - cam.x, sy = l.y - cam.y;
    if (sx < -40 || sy < -40 || sx > canvas.width + 40 || sy > canvas.height + 40) continue;
    ctx.fillStyle = l.type === 'medkit' ? '#e74c3c' : '#ffcc00';
    ctx.fillRect(sx - 6, sy - 6, 12, 12);
  }

  // --- Peluru (garis kecil kuning) ---
  ctx.strokeStyle = '#ffe66d';
  ctx.lineWidth = 2;
  for (const b of state.bullets) {
    ctx.beginPath();
    ctx.moveTo(b.x - cam.x, b.y - cam.y);
    ctx.lineTo(b.x - cam.x - b.vx, b.y - cam.y - b.vy);
    ctx.stroke();
  }

  // --- Entitas: Player (biru) & Bot (merah) ---
  for (const ent of [state.player, ...state.bots]) {
    if (!ent || !ent.alive) continue;
    const sx = ent.x - cam.x, sy = ent.y - cam.y;
    if (sx < -40 || sy < -40 || sx > canvas.width + 40 || sy > canvas.height + 40) continue;

    // Nama di atas kepala
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '11px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(ent.name, sx, sy - 18);

    // Tubuh lingkaran
    ctx.fillStyle = ent.isPlayer ? '#3498db' : '#e74c3c';
    ctx.beginPath();
    ctx.arc(sx, sy, CFG.BOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Arah hadap (moncong senjata)
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(ent.angle) * 18, sy + Math.sin(ent.angle) * 18);
    ctx.stroke();

    // Indikator pemakaian medkit
    if (ent.usingMedkit > 0) {
      ctx.fillStyle = '#2ecc71';
      ctx.fillText('+HEALING', sx, sy + 26);
    }
  }

  renderMinimap();
}

/* ---------- Minimap radar (digambar di pojok kanan atas canvas) ---------- */
function renderMinimap() {
  const MM = 140;                       // ukuran minimap (px)
  const ox = canvas.width - MM - 16, oy = 50;
  const scale = MM / Math.max(state.world.width, state.world.height);

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(ox, oy, MM, MM);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.strokeRect(ox, oy, MM, MM);

  // Safe zone & lingkar target
  const z = state.zone;
  ctx.strokeStyle = '#fff';
  ctx.beginPath();
  ctx.arc(ox + z.cx * scale, oy + z.cy * scale, z.r * scale, 0, Math.PI * 2);
  ctx.stroke();

  // Titik entitas
  for (const ent of [state.player, ...state.bots]) {
    if (!ent || !ent.alive) continue;
    ctx.fillStyle = ent.isPlayer ? '#3498db' : '#e74c3c';
    ctx.beginPath();
    ctx.arc(ox + ent.x * scale, oy + ent.y * scale, ent.isPlayer ? 4 : 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ============================================================
   8. HUD (DOM) & KILL FEED
   Sinkronisasi HP Bar, ammo, alive counter tiap frame.
   ============================================================ */
function updateHUD() {
  const p = state.player;
  if (!p) return;

  // HP Bar + class warna (hijau / kuning / merah sesuai PRD)
  const hp = Math.max(0, Math.round(p.hp));
  const fill = document.getElementById('hpBarFill');
  fill.style.width = hp + '%';
  fill.className = hp > 50 ? '' : hp > 20 ? 'medium' : 'low';
  document.getElementById('hpText').textContent = hp + ' HP';

  // Senjata & amunisi
  const w = p.weapon;
  document.getElementById('weaponName').textContent = w ? w.name : 'Tangan Kosong';
  document.getElementById('ammoText').textContent = w
    ? `${p.ammoInMag} / ${p.reserveAmmo}` : '- / -';

  // Alive counter
  document.getElementById('aliveNum').textContent = state.aliveCount;
  document.getElementById('totalNum').textContent = state.totalEntities;
}

/* Tambah entri kill feed (otomatis hilang via CSS animation) */
function addKillFeed(text) {
  const kf = document.getElementById('killFeed');
  const div = document.createElement('div');
  div.className = 'kill-entry';
  div.textContent = text;
  kf.appendChild(div);
  setTimeout(() => div.remove(), 4000); // sinkron dengan killFade 4s
}

/* ---------- Akhir permainan: Victory / Defeated ---------- */
function endGame(won) {
  state.gameOver = true;
  state.running = false;
  showOverlay('gameOverScreen');
  document.getElementById('gameOverTitle').textContent = won ? 'VICTORY!' : 'DEFEATED';
  document.getElementById('gameOverTitle').style.color = won ? '#ffcc00' : '#e74c3c';
  document.getElementById('gameOverDetail').textContent =
    won ? 'Chicken Dinner! Anda adalah satu-satunya yang tersisa.'
        : `Anda tereliminasi. Tersisa ${state.aliveCount} pemain.`;
}

function showOverlay(id) { document.getElementById(id).classList.remove('hidden'); }
function hideOverlay(id) { document.getElementById(id).classList.add('hidden'); }

/* ============================================================
   9. RESIZE & INISIALISASI
   Canvas mengikuti ukuran layar (devicePixelRatio untuk ketajaman)
   ============================================================ */
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);

function init() {
  resizeCanvas();
  setupInput();

  // Tombol Start: mulai game dengan jumlah bot terpilih
  document.getElementById('btnStart').addEventListener('click', () => {
    startGame(parseInt(document.getElementById('botCount').value, 10));
  });
  document.getElementById('btnRestart').addEventListener('click', () => {
    startGame(15); // default restart
  });

  requestAnimationFrame(gameLoop); // mulai game loop
}

init();


}

/* ---------- Kamera mengikuti pemain (dengan batas peta) ---------- */
function updateCamera() {
  const p = state.player;
  state.camera.x = clamp(p.x - canvas.width / 2, 0, state.world.width - canvas.width);
  state.camera.y = clamp(p.y - canvas.height / 2, 0, state.world.height - canvas.height);
}

/* Util: batasi nilai antara min–max */
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  for (let i = 0; i < state.loots.length; i++) {
    const l = state.loots[i];
    if (Math.hypot(l.x - ent.x, l.y - ent.y) > CFG.LOOT_PICKUP_RANGE) continue;

    if (l.type === 'ammo') {
      ent.reserveAmmo += 30;
    } else if (l.type === 'medkit') {
      ent.medkits = Math.min(3, ent.medkits + 1); // PRD: maks 3 item
    } else {
      // Senjata baru + isi penuh magazin pertama
      ent.weapon = WEAPONS[l.type];
      ent.ammoInMag = WEAPONS[l.type].mag;
      ent.reserveAmmo = Math.max(ent.reserveAmmo, 30);
    }
    state.loots.splice(i, 1); // hapus loot dari array dunia
    return;
  }
}

  // --- Aiming: desktop menghadap kursor; mobile menghadap arah gerak ---
  if (!isMobile) {
    const wx = input.mouse.x + state.camera.x;
    const wy = input.mouse.y + state.camera.y;
    p.angle = Math.atan2(wy - p.y, wx - p.x);
  } else if (ix || iy) {
    p.angle = Math.atan2(iy, ix);
  }

  // --- Menembak: klik kiri mouse / tombol FIRE mobile ---
  if (input.mouse.down || input.firePressed) tryShoot(p);

  // Cooldown tembak semua entitas
  for (const b of [p, ...state.bots]) if (b.fireCooldown > 0) b.fireCooldown--;

  // --- Update peluru ---
  updateBullets();

  // --- Damage danger zone (tick berkala) ---
  applyZoneDamage(p);
}

  // Sebar loot di peta (senjata, peluru, medkit)
  for (let i = 0; i < 60; i++) {
    state.loots.push({
      x: rand(100, state.world.width - 100),
      y: rand(100, state.world.height - 100),
      type: LOOT_TYPES[Math.floor(Math.random() * LOOT_TYPES.length)],
    });
  }

  // Inisialisasi Safe Zone di tengah peta
  const maxR = Math.max(state.world.width, state.world.height) / 2;
  state.zone = {
    cx: state.world.width / 2, cy: state.world.height / 2, r: maxR,
    targetCx: 0, targetCy: 0, targetR: 0, shrinking: false,
    nextShrink: state.frame + CFG.ZONE_SHRINK_INTERVAL * 60,
  };

  state.totalEntities = botCount + 1;
  state.aliveCount = state.totalEntities;
  state.running = true;

  hideOverlay('mainMenu');
  hideOverlay('gameOverScreen');
  updateHUD();
}

/* Util: angka acak antara min–max */
function rand(min, max) { return Math.random() * (max - min) + min; }

startGame(15);
for(let i=0;i<600;i++){updateZone();updatePhysics();updateAI();updateBullets();}
console.log('bots:',state.bots.length,'alive:',state.aliveCount,'loots:',state.loots.length);
console.log('AI states:',[...new Set(state.bots.filter(b=>b.alive).map(b=>b.aiState))].join(','));
console.log('zone r:',Math.round(state.zone.r));
