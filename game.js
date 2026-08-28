'use strict';

// =====================================================================
// BATTLE ROYALE 3D — Three.js (offline, three.min.js lokal)
// Logika gameplay tetap 2D (bidang x/z, y = tinggi utk render 3D).
// =====================================================================

const CFG = { PLAYER_SPEED: 2.6, BOT_SPEED: 1.9, ENTITY_RADIUS: 12, SIGHT_RANGE: 420, VISION_ANGLE: Math.PI * 0.72, RETREAT_HP_PCT: 0.3, PICKUP_RANGE: 32, BULLET_SPEED: 9, BULLET_LIFE: 90, ZONE_INTERVAL: 1800, ZONE_SHRINK_TIME: 900, ZONE_DAMAGE_TICK: 30, ZONE_DAMAGE: 1, MAX_HP: 100, MEDKIT_HEAL: 50, MEDKIT_USE_TIME: 180, JUMP_VELOCITY: 7.5, GRAVITY: 0.35, MUZZLE_Y: 26 };
const WEAPONS = { p92: { name: 'P92', damage: 18, mag: 12, range: 300, fireRate: 20, spread: 0.03, idealRange: 170 }, ak47: { name: 'AK-47', damage: 32, mag: 30, range: 550, fireRate: 10, spread: 0.05, idealRange: 280 }, shotgun: { name: 'S12K', damage: 70, mag: 5, range: 150, fireRate: 40, spread: 0.25, idealRange: 60 } };
const LOOT_TYPES = ['p92', 'ak47', 'shotgun', 'ammo', 'medkit'];

const canvas = document.getElementById('gameCanvas');
// PENTING: jangan panggil getContext('2d') di canvas utama —
// context 2D membuat canvas tidak bisa dipakai WebGL (Three.js).
const isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const input = { keys: {}, mouse: { x: 0, y: 0, down: false, locked: false }, joystick: { active: false, dx: 0, dy: 0, touchId: null }, firePressed: false, yaw: 0, pitch: 0.35 };

// state: dunia memakai sumbu x & z; y hanya dipakai sebagai tinggi visual 3D
const state = { running: false, frame: 0, world: { width: 3000, depth: 3000 }, player: null, bots: [], bullets: [], loots: [], obstacles: [], zone: null, aliveCount: 1, totalEntities: 1, gameOver: false };

function createEntity(x, z, isPlayer, name) { return { x, z, vx: 0, vz: 0, jumpY: 0, vJump: 0, angle: 0, hp: CFG.MAX_HP, isPlayer, name, alive: true, weapon: null, ammoInMag: 0, reserveAmmo: 0, slots: [], slotIndex: 0, fireCooldown: 0, medkits: 0, usingMedkit: 0, aiState: 'WANDER', aiTarget: null, aiMoveTarget: { x, z }, aiTimer: 0, skill: 0.7, strafeDir: 1, strafeTimer: 0, lastSeen: null, reactTimer: 0 }; }
function rand(min, max) { return Math.random() * (max - min) + min; }
function distance(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
// Menentukan apakah target berada di dalam jarak dan cone pandangan observer.
function canSee(observer, target) { const angleToTarget = Math.atan2(target.z - observer.z, target.x - observer.x); let diff = angleToTarget - observer.angle; while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2; return distance(observer, target) <= CFG.SIGHT_RANGE && Math.abs(diff) <= CFG.VISION_ANGLE / 2; }

// --- Rintangan (gedung/kotak cover) ---
function pointInObstacle(x, z, pad) { for (const o of state.obstacles) if (x > o.x - o.w / 2 - pad && x < o.x + o.w / 2 + pad && z > o.z - o.d / 2 - pad && z < o.z + o.d / 2 + pad) return o; return null; }
// Mendorong entita keluar dari rintangan (circle vs AABB).
function resolveObstacles(entity) { for (const o of state.obstacles) { const nx = clamp(entity.x, o.x - o.w / 2, o.x + o.w / 2), nz = clamp(entity.z, o.z - o.d / 2, o.z + o.d / 2); const dx = entity.x - nx, dz = entity.z - nz, d = Math.hypot(dx, dz); if (d < CFG.ENTITY_RADIUS) { if (d > 0.001) { entity.x = nx + dx / d * CFG.ENTITY_RADIUS; entity.z = nz + dz / d * CFG.ENTITY_RADIUS; } else { entity.x = o.x + o.w / 2 + CFG.ENTITY_RADIUS; } } } }
function randomFreeSpot(pad) { for (let tries = 0; tries < 60; tries++) { const x = rand(100, state.world.width - 100), z = rand(100, state.world.depth - 100); if (!pointInObstacle(x, z, pad)) return { x, z }; } return { x: 1500, z: 1500 }; }

// Menginisialisasi match baru, spawn entitas, loot, rintangan, dan zona awal.
function startGame(botCount) {
  const count = clamp(Number(botCount) || 15, 1, 20);
  state.frame = 0; state.gameOver = false; state.bullets = []; state.loots = []; state.bots = []; state.obstacles = [];
  // Gedung/cover 3D acak
  for (let i = 0; i < 26; i++) { const w = rand(60, 220), d = rand(60, 220); state.obstacles.push({ x: rand(200, 2800), z: rand(200, 2800), w, d, h: rand(40, 160) }); }
  const pSpot = randomFreeSpot(40);
  state.player = createEntity(pSpot.x, pSpot.z, true, 'Pemain');
  giveWeapon(state.player, 'p92'); state.player.slots[0].reserve += 12;
  for (let i = 0; i < count; i++) { const s = randomFreeSpot(40); const bot = createEntity(s.x, s.z, false, `Bot_${String(i + 1).padStart(2, '0')}`); giveWeapon(bot, ['p92', 'ak47', 'shotgun'][i % 3]); bot.skill = rand(0.55, 1.0); bot.medkits = Math.floor(rand(0, 3)); state.bots.push(bot); }
  for (let i = 0; i < 70; i++) { const s = randomFreeSpot(10); state.loots.push({ x: s.x, z: s.z, type: LOOT_TYPES[Math.floor(Math.random() * LOOT_TYPES.length)] }); }
  state.zone = { cx: 1500, cz: 1500, r: 1500, targetCx: 1500, targetCz: 1500, targetR: 1500, shrinking: false, nextShrink: CFG.ZONE_INTERVAL };
  state.totalEntities = count + 1; state.aliveCount = state.totalEntities;
  input.yaw = state.player.angle = rand(0, Math.PI * 2); input.pitch = 0.35;
  state.running = true;
  hideOverlay('mainMenu'); hideOverlay('gameOverScreen');
  buildScene(); updateHUD();
}

// Input keyboard, mouse (pointer-lock), dan kontrol sentuh multi-touch.
function setupInput() {
  if (isMobile) { document.getElementById('mobileControls').style.display = 'block'; setupTouchControls(); return; }
  window.addEventListener('keydown', event => { input.keys[event.key.toLowerCase()] = true; handleKeyDown(event); });
  window.addEventListener('keyup', event => { input.keys[event.key.toLowerCase()] = false; });
  // Klik canvas untuk pointer-lock (bidikan FPS ala game 3D)
  canvas.addEventListener('click', () => { if (!isMobile && canvas.requestPointerLock) canvas.requestPointerLock(); });
  document.addEventListener('pointerlockchange', () => { input.mouse.locked = document.pointerLockElement === canvas; });
  window.addEventListener('mousemove', event => {
    if (input.mouse.locked) { input.yaw += event.movementX * 0.0022; input.pitch = clamp(input.pitch + event.movementY * 0.0018, 0.08, 1.15); }
    else { input.mouse.x = event.clientX; input.mouse.y = event.clientY; }
  });
  window.addEventListener('mousedown', event => { if (event.button === 0) input.mouse.down = true; });
  window.addEventListener('mouseup', event => { if (event.button === 0) input.mouse.down = false; });
  window.addEventListener('contextmenu', event => event.preventDefault());
}
function handleKeyDown(event) { const player = state.player; if (!player || !player.alive) return; const key = event.key.toLowerCase(); if (key === 'r') reloadWeapon(player); if (key === 'e') tryPickupLoot(player); if (key === 'f') useMedkit(player); if (key === '1') switchSlot(player, 0); if (key === '2') switchSlot(player, 1); if (key === '3') switchSlot(player, 2); }
function setupTouchControls() { const zone = document.getElementById('joystickZone'), base = document.getElementById('joystickBase'), knob = document.getElementById('joystickKnob'), maxRadius = 48; zone.addEventListener('touchstart', event => { event.preventDefault(); const touch = event.changedTouches[0]; input.joystick.touchId = touch.identifier; input.joystick.active = true; base.style.left = `${touch.clientX - 60}px`; base.style.top = `${touch.clientY - 60}px`; }, { passive: false }); zone.addEventListener('touchmove', event => { event.preventDefault(); for (const touch of event.changedTouches) if (touch.identifier === input.joystick.touchId) { let dx = touch.clientX - (parseFloat(base.style.left) + 60), dy = touch.clientY - (parseFloat(base.style.top) + 60); const length = Math.hypot(dx, dy); if (length > maxRadius) { dx *= maxRadius / length; dy *= maxRadius / length; } input.joystick.dx = dx / maxRadius; input.joystick.dy = dy / maxRadius; knob.style.left = `${34 + dx}px`; knob.style.top = `${34 + dy}px`; } }, { passive: false }); const end = event => { for (const touch of event.changedTouches) if (touch.identifier === input.joystick.touchId) { input.joystick.active = false; input.joystick.touchId = null; input.joystick.dx = 0; input.joystick.dy = 0; knob.style.left = '34px'; knob.style.top = '34px'; } }; zone.addEventListener('touchend', end); zone.addEventListener('touchcancel', end); const bind = (id, press, release) => { const element = document.getElementById(id); element.addEventListener('touchstart', event => { event.preventDefault(); press(); }, { passive: false }); if (release) element.addEventListener('touchend', release); }; bind('btnFire', () => { input.firePressed = true; }, () => { input.firePressed = false; }); bind('btnJump', () => { input.keys[' '] = true; }, () => { input.keys[' '] = false; }); bind('btnReload', () => reloadWeapon(state.player)); bind('btnMedkit', () => useMedkit(state.player)); bind('btnInteract', () => tryPickupLoot(state.player)); }

// Loop utama: zona, fisika, AI, kamera, render, HUD.
function gameLoop() { requestAnimationFrame(gameLoop); if (!state.running) { renderFrame(); return; } state.frame++; updateZone(); updatePhysics(); updateAI(); updateCamera(); renderFrame(); updateHUD(); }

// Fisika pemain: gerak relatif kamera (yaw), tabrakan rintangan, menembak, zona.
function updatePhysics() {
  const player = state.player; if (!player || !player.alive) return;
  // Fallback tanpa pointer-lock: yaw/pitch mengikuti posisi kursor di layar
  if (!isMobile && !input.mouse.locked && input.mouse.x > 0) {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    input.yaw = (input.mouse.x / w - 0.5) * 2.6;
    input.pitch = clamp(0.32 + (input.mouse.y / h - 0.5) * 0.9, 0.08, 1.15);
  }
  let dx = (input.keys.d ? 1 : 0) - (input.keys.a ? 1 : 0), dy = (input.keys.s ? 1 : 0) - (input.keys.w ? 1 : 0);
  if (input.joystick.active) { dx = input.joystick.dx; dy = input.joystick.dy; }
  if (player.usingMedkit > 0) { player.usingMedkit--; dx = 0; dy = 0; }
  const length = Math.hypot(dx, dy) || 1;
  const mvx = dx / length * CFG.PLAYER_SPEED, mvz = dy / length * CFG.PLAYER_SPEED;
  if (!isMobile) {
    // Gerak relatif kamera: forward F=(cos,sin), right R=(-sin,cos) pada bidang x/z
    const cos = Math.cos(input.yaw), sin = Math.sin(input.yaw);
    player.x += (-mvz * cos - mvx * sin);
    player.z += (-mvz * sin + mvx * cos);
  } else { player.x += mvx; player.z += mvz; }
  player.x = clamp(player.x, 20, state.world.width - 20); player.z = clamp(player.z, 20, state.world.depth - 20);
  resolveObstacles(player);
  // Lompat (Spasi): gravitasi sederhana di sumbu Y
  if (input.keys[' '] && player.jumpY <= 0 && player.vJump <= 0) player.vJump = CFG.JUMP_VELOCITY;
  if (player.vJump !== 0 || player.jumpY > 0) {
    player.jumpY += player.vJump; player.vJump -= CFG.GRAVITY;
    if (player.jumpY <= 0) { player.jumpY = 0; player.vJump = 0; }
  }
  if (!isMobile) player.angle = input.yaw; else if (dx || dy) player.angle = Math.atan2(dy, dx);
  if (input.mouse.down || input.firePressed) tryShoot(player);
  for (const entity of [player, ...state.bots]) { if (entity.fireCooldown > 0) entity.fireCooldown--; applyZoneDamage(entity); }
  updateBullets();
}
// ---- Inventaris 3 slot senjata (tombol 1/2/3) ----
// Menyelaraskan slot aktif dengan properti senjata aktif.
function equipSlot(entity, index) { const slot = entity.slots[index]; if (!slot) return; entity.slotIndex = index; entity.weapon = WEAPONS[slot.key]; entity.ammoInMag = slot.mag; entity.reserveAmmo = slot.reserve; }
// Menyimpan amunisi aktif kembali ke slot (dipanggil sebelum pindah slot).
function saveActiveSlot(entity) { const slot = entity.slots[entity.slotIndex]; if (slot) { slot.mag = entity.ammoInMag; slot.reserve = entity.reserveAmmo; } }
function switchSlot(entity, index) { if (!entity || !entity.slots[index] || index === entity.slotIndex) return; saveActiveSlot(entity); equipSlot(entity, index); }
// Mengambil/mengganti senjata: isi slot kosong, atau timpa slot aktif.
function giveWeapon(entity, type) {
  const existing = entity.slots.findIndex(s => s && s.key === type);
  if (existing >= 0) { entity.slots[existing].reserve += WEAPONS[type].mag; equipSlot(entity, existing); return; }
  const slot = { key: type, mag: WEAPONS[type].mag, reserve: WEAPONS[type].mag * 2 };
  if (entity.slots.length < 3) { entity.slots.push(slot); equipSlot(entity, entity.slots.length - 1); }
  else { entity.slots[entity.slotIndex] = slot; equipSlot(entity, entity.slotIndex); }
}

// Menembak 3D: arah horizontal dari angle + komponen vertikal dari pitch.
function tryShoot(entity) {
  const weapon = entity.weapon; if (!weapon || entity.fireCooldown > 0) return;
  if (entity.ammoInMag <= 0) { reloadWeapon(entity); return; }
  entity.ammoInMag--; entity.fireCooldown = weapon.fireRate;
  const angle = entity.angle + rand(-weapon.spread, weapon.spread);
  let vy;
  if (entity.isPlayer) { // bidikan vertikal mengikuti pitch kamera: pitch kecil = ke atas
    vy = Math.sin(0.3 - input.pitch) * CFG.BULLET_SPEED;
  } else { // bot membidik sejajar + sedikit noise vertikal
    vy = rand(-0.35, 0.35);
  }
  const hSpeed = Math.sqrt(Math.max(1, CFG.BULLET_SPEED * CFG.BULLET_SPEED - vy * vy));
  state.bullets.push({ x: entity.x + Math.cos(angle) * 18, z: entity.z + Math.sin(angle) * 18, y: CFG.MUZZLE_Y + entity.jumpY, vx: Math.cos(angle) * hSpeed, vz: Math.sin(angle) * hSpeed, vy, damage: weapon.damage, range: weapon.range, traveled: 0, life: CFG.BULLET_LIFE, owner: entity });
}
function reloadWeapon(entity) { if (!entity || !entity.weapon) return; const amount = Math.min(entity.weapon.mag - entity.ammoInMag, entity.reserveAmmo); entity.ammoInMag += amount; entity.reserveAmmo -= amount; }
function useMedkit(entity) { if (!entity || entity.medkits <= 0 || entity.hp >= CFG.MAX_HP || entity.usingMedkit > 0) return; entity.medkits--; entity.usingMedkit = CFG.MEDKIT_USE_TIME; setTimeout(() => { if (entity.alive) entity.hp = Math.min(CFG.MAX_HP, entity.hp + CFG.MEDKIT_HEAL); }, 3000); }
function tryPickupLoot(entity) { if (!entity) return; const index = state.loots.findIndex(loot => Math.hypot(loot.x - entity.x, loot.z - entity.z) <= CFG.PICKUP_RANGE); if (index < 0) return; const loot = state.loots[index]; if (loot.type === 'ammo') { entity.reserveAmmo += 30; saveActiveSlot(entity); } else if (loot.type === 'medkit') entity.medkits = Math.min(3, entity.medkits + 1); else giveWeapon(entity, loot.type); state.loots.splice(index, 1); }
// Peluru 3D: maju (x/z + tinggi y), cek rintangan (sesuai tinggi gedung) & entitas.
function updateBullets() {
  for (let index = state.bullets.length - 1; index >= 0; index--) {
    const bullet = state.bullets[index];
    bullet.x += bullet.vx; bullet.z += bullet.vz; bullet.y += bullet.vy;
    bullet.traveled += Math.hypot(bullet.vx, bullet.vz); bullet.life--;
    const obstacle = pointInObstacle(bullet.x, bullet.z, 0);
    let remove = bullet.life <= 0 || bullet.traveled > bullet.range || bullet.y <= 0 || bullet.y > 400 || (obstacle && bullet.y < obstacle.h);
    if (!remove) for (const target of [state.player, ...state.bots]) {
      if (!target.alive || target === bullet.owner) continue;
      const centerY = 20 + target.jumpY; // pusat tubuh target (ikut lompatan)
      if (Math.hypot(target.x - bullet.x, target.z - bullet.z) <= CFG.ENTITY_RADIUS && Math.abs(centerY - bullet.y) <= 24) {
        target.hp -= bullet.damage * (target.armor ? 0.7 : 1);
        if (target.hp <= 0) killEntity(target, bullet.owner);
        remove = true; break;
      }
    }
    if (remove) state.bullets.splice(index, 1);
  }
}
function killEntity(entity, killer) { if (!entity.alive) return; entity.alive = false; entity.hp = 0; state.aliveCount--; addKillFeed(`${entity.name} tereliminasi oleh ${killer ? killer.name : 'Zona'}`); for (const slot of entity.slots) if (slot) state.loots.push({ x: entity.x + rand(-10, 10), z: entity.z + rand(-10, 10), type: slot.key }); state.loots.push({ x: entity.x + 15, z: entity.z, type: 'medkit' }); if (entity.isPlayer) endGame(false); else if (state.aliveCount === 1 && state.player.alive) endGame(true); }
// Zona aman menyusut secara berkala dan halus.
function updateZone() { const zone = state.zone; if (!zone) return; if (!zone.shrinking && state.frame >= zone.nextShrink && zone.r > 250) { zone.targetR = zone.r * 0.65; const offset = (zone.r - zone.targetR) * 0.5; zone.targetCx = clamp(zone.cx + rand(-offset, offset), zone.targetR, state.world.width - zone.targetR); zone.targetCz = clamp(zone.cz + rand(-offset, offset), zone.targetR, state.world.depth - zone.targetR); zone.shrinking = true; zone.shrinkStart = state.frame; zone.startCx = zone.cx; zone.startCz = zone.cz; zone.startR = zone.r; } if (zone.shrinking) { const progress = Math.min(1, (state.frame - zone.shrinkStart) / CFG.ZONE_SHRINK_TIME); zone.cx = zone.startCx + (zone.targetCx - zone.startCx) * progress; zone.cz = zone.startCz + (zone.targetCz - zone.startCz) * progress; zone.r = zone.startR + (zone.targetR - zone.startR) * progress; if (progress >= 1) { zone.shrinking = false; zone.nextShrink = state.frame + CFG.ZONE_INTERVAL; } } }
function applyZoneDamage(entity) { if (!entity.alive || !state.zone || state.frame % CFG.ZONE_DAMAGE_TICK !== 0) return; if (Math.hypot(entity.x - state.zone.cx, entity.z - state.zone.cz) > state.zone.r) { entity.hp -= CFG.ZONE_DAMAGE; if (entity.hp <= 0) killEntity(entity, null); } }

// =====================================================================
// AI BOT — FSM: RETREAT, MOVE_TO_ZONE, ATTACK, HUNT, LOOT, WANDER
// Peningkatan: prediksi posisi target (leading), strafing, jarak ideal
// per senjata, memory posisi musuh terakhir, reload strategis, reaksi
// bertingkat (skill), patroli di dalam zona, dan menghindari rintangan.
// =====================================================================
function visibleEnemies(bot) { return [state.player, ...state.bots].filter(target => target.alive && target !== bot && canSee(bot, target)); }

function botThink(bot) {
  const zone = state.zone, distToCenter = Math.hypot(bot.x - zone.cx, bot.z - zone.cz);
  const outsideZone = distToCenter > zone.r, nearEdge = distToCenter > zone.r * 0.85;
  const enemy = visibleEnemies(bot).sort((a, b) => distance(bot, a) - distance(bot, b))[0];

  // Memory: ingat posisi musuh terakhir selama ~6 detik
  if (enemy) { bot.aiTarget = enemy; bot.lastSeen = { x: enemy.x, z: enemy.z, frame: state.frame }; }
  else if (bot.lastSeen && state.frame - bot.lastSeen.frame > 360) bot.lastSeen = null;

  const hpPct = bot.hp / CFG.MAX_HP;
  if ((hpPct < CFG.RETREAT_HP_PCT * (0.7 + bot.skill * 0.5)) && bot.medkits > 0 && (!enemy || distance(bot, enemy) > 220)) bot.aiState = 'RETREAT';
  else if (outsideZone || (nearEdge && !enemy)) bot.aiState = 'MOVE_TO_ZONE';
  else if (enemy) bot.aiState = 'ATTACK';
  else if (!bot.weapon || bot.reserveAmmo <= bot.weapon.mag * 0.5 || (bot.hp < CFG.MAX_HP * 0.6 && bot.medkits < 1)) { const needed = needsLoot(bot); bot.aiState = needed ? 'LOOT' : 'WANDER'; if (needed) bot.aiMoveTarget = needed; }
  else if (bot.lastSeen && state.frame - bot.lastSeen.frame < 240) bot.aiState = 'HUNT';
  else bot.aiState = 'WANDER';

  switch (bot.aiState) {
    case 'RETREAT': { // lari menjauh dari ancaman lalu sembuhkan diri
      const lx = bot.lastSeen ? bot.lastSeen.x : zone.cx, lz = bot.lastSeen ? bot.lastSeen.z : zone.cz;
      const away = Math.atan2(bot.z - lz, bot.x - lx);
      bot.aiMoveTarget = { x: bot.x + Math.cos(away) * 250, z: bot.z + Math.sin(away) * 250 };
      if (distance(bot, { x: lx, z: lz }) > 260 && bot.usingMedkit === 0) useMedkit(bot);
      bot.angle = Math.atan2(lz - bot.z, lx - bot.x);
      moveBot(bot, 1.15); return;
    }
    case 'MOVE_TO_ZONE': { // menuju zona, terburu-buru bila di luar
      const margin = outsideZone ? 0.25 : 0.7;
      bot.aiMoveTarget = { x: zone.cx + (bot.x - zone.cx) * margin, z: zone.cz + (bot.z - zone.cz) * margin };
      bot.angle = Math.atan2(bot.aiMoveTarget.z - bot.z, bot.aiMoveTarget.x - bot.x);
      moveBot(bot, outsideZone ? 1.4 : 1.0);
      if (!bot.weapon) tryPickupLoot(bot);
      return;
    }
    case 'ATTACK': combatBehavior(bot, bot.aiTarget); return;
    case 'HUNT': { // pergi ke posisi terakhir musuh terlihat
      bot.aiMoveTarget = { x: bot.lastSeen.x, z: bot.lastSeen.z };
      bot.angle = Math.atan2(bot.aiMoveTarget.z - bot.z, bot.aiMoveTarget.x - bot.x);
      moveBot(bot, 1.1);
      if (distance(bot, bot.aiMoveTarget) < 30) bot.lastSeen = null;
      return;
    }
    case 'LOOT': { bot.angle = Math.atan2(bot.aiMoveTarget.z - bot.z, bot.aiMoveTarget.x - bot.x); moveBot(bot, 1.2); tryPickupLoot(bot); return; }
    default: { // WANDER: patroli acak di dalam zona (bukan peta kosong)
      if (--bot.aiTimer <= 0 || distance(bot, bot.aiMoveTarget) < 25) {
        const a = rand(0, Math.PI * 2), rr = rand(0, zone.r * 0.8);
        bot.aiMoveTarget = { x: clamp(zone.cx + Math.cos(a) * rr, 50, state.world.width - 50), z: clamp(zone.cz + Math.sin(a) * rr, 50, state.world.depth - 50) };
        bot.aiTimer = 120 + Math.floor(rand(0, 180));
      }
      bot.angle = Math.atan2(bot.aiMoveTarget.z - bot.z, bot.aiMoveTarget.x - bot.x);
      moveBot(bot, 0.85);
      if (!bot.weapon || bot.reserveAmmo < bot.weapon.mag) tryPickupLoot(bot);
    }
  }
}

// Bot mencari loot yang benar-benar dibutuhkan (senjata > ammo > medkit).
function needsLoot(bot) {
  let best = null, bestDist = 700;
  for (const loot of state.loots) {
    const d = Math.hypot(loot.x - bot.x, loot.z - bot.z); if (d > bestDist) continue;
    const useful = (!bot.weapon && loot.type in WEAPONS) || (loot.type === 'ammo' && bot.reserveAmmo < 30) || (loot.type === 'medkit' && bot.medkits < 2);
    if (useful) { best = { x: loot.x, z: loot.z }; bestDist = d; }
  }
  return best;
}

// Perilaku tempur: jaga jarak ideal senjata, strafing, tembakan prediktif.
function combatBehavior(bot, target) {
  const weapon = bot.weapon || WEAPONS.p92, dist = distance(bot, target);
  const angleToTarget = Math.atan2(target.z - bot.z, target.x - bot.x);
  // Bidikan prediktif: bidik depan gerakan target (leading) + error akurasi
  const leadTime = dist / CFG.BULLET_SPEED;
  const aimX = target.x + (target.vx || 0) * leadTime * bot.skill, aimZ = target.z + (target.vz || 0) * leadTime * bot.skill;
  const aimAngle = Math.atan2(aimZ - bot.z, aimX - bot.x) + rand(-1, 1) * (1 - bot.skill) * 0.15;
  let turn = aimAngle - bot.angle; while (turn > Math.PI) turn -= Math.PI * 2; while (turn < -Math.PI) turn += Math.PI * 2;
  bot.angle += clamp(turn, -0.12 - bot.skill * 0.08, 0.12 + bot.skill * 0.08);

  // Strafing kiri/kanan + jaga jarak ideal senjata
  if (--bot.strafeTimer <= 0) { bot.strafeDir *= -1; bot.strafeTimer = 40 + Math.floor(rand(0, 70)); }
  const strafeAngle = angleToTarget + Math.PI / 2 * bot.strafeDir;
  const approach = clamp((dist - weapon.idealRange) / 80, -1, 1);
  const mx = Math.cos(strafeAngle) * 0.8 + Math.cos(angleToTarget) * approach;
  const mz = Math.sin(strafeAngle) * 0.8 + Math.sin(angleToTarget) * approach;
  moveBot(bot, 1.0, mx, mz);

  // Menembak: burst dengan jeda; reload saat kosong
  if (bot.ammoInMag <= 0) { reloadWeapon(bot); return; }
  if (dist <= weapon.range && Math.abs(turn) < 0.35) {
    if (bot.burst > 0) { tryShoot(bot); bot.burst--; }
    else if (state.frame % 3 === 0 && Math.random() < 0.2 + bot.skill * 0.3) bot.burst = weapon.name === 'S12K' ? 1 : 3 + Math.floor(bot.skill * 4);
  }
}

// Bergerak dengan steering + hindari rintangan (sidestep otomatis).
function moveBot(bot, speedMul, dirX, dirZ) {
  const speed = CFG.BOT_SPEED * speedMul;
  let dx = dirX, dz = dirZ;
  if (dx === undefined) { const d = distance(bot, bot.aiMoveTarget) || 1; dx = (bot.aiMoveTarget.x - bot.x) / d; dz = (bot.aiMoveTarget.z - bot.z) / d; }
  const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
  bot.vx = dx * speed; bot.vz = dz * speed;
  let nx = bot.x + bot.vx, nz = bot.z + bot.vz;
  if (pointInObstacle(nx, nz, CFG.ENTITY_RADIUS)) {
    const px = -dz * bot.strafeDir, pz = dx * bot.strafeDir;
    bot.vx = px * speed; bot.vz = pz * speed; nx = bot.x + bot.vx; nz = bot.z + bot.vz;
    if (pointInObstacle(nx, nz, CFG.ENTITY_RADIUS)) { bot.strafeDir *= -1; bot.vx = -px * speed; bot.vz = -pz * speed; nx = bot.x + bot.vx; nz = bot.z + bot.vz; }
  }
  bot.x = clamp(nx, 20, state.world.width - 20); bot.z = clamp(nz, 20, state.world.depth - 20);
  resolveObstacles(bot);
}

function updateAI() { for (const bot of state.bots) { if (!bot.alive) continue; botThink(bot); } }

// =====================================================================
// RENDER 3D (Three.js) — ground, gedung, entitas, zona, loot, peluru
// =====================================================================
let renderer = null, scene = null, camera3D = null;
const visuals = { entities: new Map(), bullets: [], loots: [], zoneRing: null, dangerDisc: null };

function init3D() {
  if (typeof THREE === 'undefined') return; // mode headless (smoke test) — skip render
  // Bungkus dengan try/catch agar kegagalan WebGL tidak mematikan game logic
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
  } catch (error) { console.error('WebGL gagal diinisialisasi:', error); return; }
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b7e0);
  scene.fog = new THREE.Fog(0x87b7e0, 600, 2200);
  camera3D = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 1, 5000);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x445533, 0.9); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d0, 0.9); sun.position.set(500, 900, 300); scene.add(sun);
  // Ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(state.world.width + 400, state.world.depth + 400), new THREE.MeshLambertMaterial({ color: 0x2f7a4f }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  // Grid halus sebagai referensi jarak
  const grid = new THREE.GridHelper(3000, 60, 0x28603f, 0x28603f); grid.position.y = 0.2; scene.add(grid);
  window.addEventListener('resize', () => { camera3D.aspect = window.innerWidth / window.innerHeight; camera3D.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });
}
// Membangun ulang mesh dunia saat match baru dimulai.
function buildScene() {
  if (!renderer) { init3D(); if (!renderer) return; }
  // Bersihkan scene dinamis lama
  for (const v of visuals.entities.values()) scene.remove(v.group); visuals.entities.clear();
  for (const m of visuals.bullets) scene.remove(m); visuals.bullets = [];
  for (const l of visuals.loots) scene.remove(l.mesh); visuals.loots = [];
  if (visuals.obstacles) for (const o of visuals.obstacles) scene.remove(o);
  if (visuals.zoneRing) scene.remove(visuals.zoneRing);
  if (visuals.dangerDisc) scene.remove(visuals.dangerDisc);
  // Gedung/cover
  visuals.obstacles = state.obstacles.map(o => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), new THREE.MeshLambertMaterial({ color: 0x8d8577 }));
    mesh.position.set(o.x, o.h / 2, o.z); scene.add(mesh); return mesh;
  });
  // Zona: lingkaran putih + disc biru transparan di luar zona
  const pts = []; for (let i = 0; i <= 128; i++) { const a = i / 128 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a))); }
  visuals.zoneRing = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff }));
  scene.add(visuals.zoneRing);
  visuals.dangerDisc = new THREE.Mesh(new THREE.RingGeometry(1, 2.6, 64), new THREE.MeshBasicMaterial({ color: 0x2f75be, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
  visuals.dangerDisc.rotation.x = -Math.PI / 2; visuals.dangerDisc.position.y = 0.4; scene.add(visuals.dangerDisc);
  // Entitas (pemain + bot)
  const mkEntity = color => {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(10, 12, 30, 10), new THREE.MeshLambertMaterial({ color }));
    body.position.y = 15; group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(8, 10, 8), new THREE.MeshLambertMaterial({ color: 0xf1c08a }));
    head.position.y = 36; group.add(head);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(22, 4, 4), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    gun.position.set(12, 20, 0); group.add(gun);
    scene.add(group); return group;
  };
  const playerGroup = mkEntity(0x3d7bf0);
  visuals.entities.set(state.player, { group: playerGroup, isPlayer: true });
  for (const bot of state.bots) visuals.entities.set(bot, { group: mkEntity(0xd84848), isPlayer: false });
  // Loot
  for (const loot of state.loots) {
    const color = loot.type === 'medkit' ? 0x43d17a : loot.type === 'ammo' ? 0xd8b13a : 0xe8e4da;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(14, 14, 14), new THREE.MeshLambertMaterial({ color }));
    mesh.position.set(loot.x, 8, loot.z); scene.add(mesh); visuals.loots.push({ ref: loot, mesh });
  }
}
// Mesh peluru (pool sederhana: buang saat habis)
function syncBullets3D() {
  if (!renderer) return;
  while (visuals.bullets.length < state.bullets.length) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(2.5, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffe27a }));
    scene.add(mesh); visuals.bullets.push(mesh);
  }
  while (visuals.bullets.length > state.bullets.length) scene.remove(visuals.bullets.pop());
  state.bullets.forEach((b, i) => visuals.bullets[i].position.set(b.x, Math.max(1.5, b.y), b.z));
}

// Kamera third-person over-the-shoulder: pemain di kiri layar, bidik bebas.
function updateCamera() {
  if (!state.player) return;
  if (!camera3D) { state.camera = { x: state.player.x, z: state.player.z }; return; }
  const p = state.player, D = 170, side = 36; // side: geser kamera ke kanan badan
  const fx = Math.cos(input.yaw), fz = Math.sin(input.yaw);  // arah hadap
  const rx = -fz, rz = fx;                                   // vektor kanan
  const horiz = Math.cos(input.pitch) * D, height = 30 + Math.sin(input.pitch) * D;
  // Kamera & titik pandang digeser sama ke kanan -> garis bidik sejajar crosshair
  camera3D.position.set(p.x - fx * horiz + rx * side, height, p.z - fz * horiz + rz * side);
  camera3D.lookAt(p.x + fx * 60 + rx * side, 26, p.z + fz * 60 + rz * side);
}
// Render 3D + minimap 2D.
function renderFrame() {
  if (renderer && state.player && scene) {
    for (const [entity, visual] of visuals.entities) {
      visual.group.visible = entity.alive;
      if (!entity.alive) continue;
      visual.group.position.set(entity.x, entity.jumpY, entity.z);
      // Model menghadap arah (cos a, sin a): rotasi Y sebesar -a (senjata = sumbu +x lokal)
      visual.group.rotation.y = -entity.angle;
    }
    for (const lootVisual of visuals.loots) { lootVisual.mesh.rotation.y += 0.03; lootVisual.mesh.position.y = 8 + Math.sin(state.frame * 0.05 + lootVisual.mesh.position.x) * 2; }
    const zone = state.zone;
    if (zone) { visuals.zoneRing.position.set(zone.cx, 0.5, zone.cz); visuals.zoneRing.scale.set(zone.r, 1, zone.r); visuals.dangerDisc.position.set(zone.cx, 0.4, zone.cz); visuals.dangerDisc.scale.set(zone.r, zone.r, zone.r); }
    syncBullets3D();
    renderer.render(scene, camera3D);
  }
  drawMinimap();
}
// Minimap 2D (canvas overlay) — posisi pemain, bot, zona, dan loot.
function drawMinimap() {
  const mini = document.getElementById('minimap'); if (!mini) return;
  const mctx = mini.getContext('2d'), size = mini.width, scale = size / state.world.width;
  mctx.clearRect(0, 0, size, size);
  mctx.fillStyle = 'rgba(10, 20, 16, 0.75)'; mctx.fillRect(0, 0, size, size);
  if (state.zone) { mctx.strokeStyle = '#fff'; mctx.lineWidth = 1.5; mctx.beginPath(); mctx.arc(state.zone.cx * scale, state.zone.cz * scale, state.zone.r * scale, 0, Math.PI * 2); mctx.stroke(); }
  mctx.fillStyle = '#f5c542';
  for (const loot of state.loots) mctx.fillRect(loot.x * scale - 1, loot.z * scale - 1, 2, 2);
  for (const bot of state.bots) if (bot.alive) { mctx.fillStyle = '#e55454'; mctx.beginPath(); mctx.arc(bot.x * scale, bot.z * scale, 2.5, 0, Math.PI * 2); mctx.fill(); }
  if (state.player && state.player.alive) { mctx.fillStyle = '#4c9cff'; mctx.beginPath(); mctx.arc(state.player.x * scale, state.player.z * scale, 3.5, 0, Math.PI * 2); mctx.fill(); }
}
// Ikon senjata sederhana (SVG inline) untuk panel slot.
function weaponIcon(key) {
  const shapes = {
    p92: '<rect x="3" y="8" width="18" height="5" rx="1"/><rect x="5" y="12" width="6" height="7" rx="1"/>',
    ak47: '<rect x="1" y="8" width="26" height="4" rx="1"/><rect x="24" y="6" width="6" height="3" rx="1"/><rect x="10" y="12" width="4" height="7" rx="1"/><rect x="4" y="12" width="5" height="4" rx="1"/>',
    shotgun: '<rect x="1" y="9" width="29" height="3" rx="1"/><rect x="1" y="12" width="29" height="3" rx="1"/><rect x="4" y="15" width="7" height="4" rx="1"/>'
  };
  return `<svg viewBox="0 0 32 20" class="wicon"><g fill="currentColor">${shapes[key] || shapes.p92}</g></svg>`;
}
// Memperbarui teks HUD, bar HP, dan panel slot senjata.
function updateHUD() {
  const player = state.player; if (!player) return;
  document.getElementById('aliveNum').textContent = state.aliveCount; document.getElementById('totalNum').textContent = state.totalEntities;
  document.getElementById('hpText').textContent = `${Math.ceil(player.hp)} HP`;
  const fill = document.getElementById('hpBarFill'); fill.style.width = `${clamp(player.hp, 0, 100)}%`; fill.className = player.hp <= 20 ? 'low' : player.hp <= 50 ? 'medium' : '';
  document.getElementById('weaponName').textContent = player.weapon ? player.weapon.name : 'Tangan Kosong';
  document.getElementById('ammoText').textContent = player.weapon ? `${player.ammoInMag} / ${player.reserveAmmo}` : '- / -';
  document.getElementById('medkitNum').textContent = player.medkits;
  // Panel 3 slot senjata (kanan atas)
  let html = '';
  for (let i = 0; i < 3; i++) {
    const slot = player.slots[i];
    if (slot) {
      html += `<div class="wslot ${i === player.slotIndex ? 'active' : ''}"><span class="wkey">${i + 1}</span>${weaponIcon(slot.key)}<span class="wname">${WEAPONS[slot.key].name}</span><span class="wammo">${slot.mag}/${slot.reserve}</span></div>`;
    } else {
      html += `<div class="wslot empty"><span class="wkey">${i + 1}</span><span class="wname">Kosong</span></div>`;
    }
  }
  document.getElementById('weaponSlots').innerHTML = html;
}
function addKillFeed(message) { const feed = document.getElementById('killFeed'), entry = document.createElement('div'); entry.className = 'kill-entry'; entry.textContent = message; feed.prepend(entry); setTimeout(() => entry.remove(), 4000); }
function hideOverlay(id) { document.getElementById(id).classList.add('hidden'); }
function showOverlay(id) { document.getElementById(id).classList.remove('hidden'); }
function endGame(victory) { state.running = false; document.getElementById('gameOverTitle').textContent = victory ? 'VICTORY' : 'DEFEATED'; document.getElementById('gameOverDetail').textContent = victory ? 'Anda adalah yang terakhir bertahan.' : 'HP Anda telah habis.'; showOverlay('gameOverScreen'); }

document.getElementById('btnStart').addEventListener('click', () => startGame(document.getElementById('botCount').value));
document.getElementById('btnRestart').addEventListener('click', () => startGame(document.getElementById('botCount').value));
setupInput(); requestAnimationFrame(gameLoop);
if (typeof module !== 'undefined') module.exports = { CFG, WEAPONS, state, startGame, updateZone, updatePhysics, updateAI, updateBullets, canSee };






