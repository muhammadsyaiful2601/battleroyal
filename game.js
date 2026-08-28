'use strict';

// =====================================================================
// BATTLE ROYALE 3D — Three.js (offline, three.min.js lokal)
// Logika gameplay tetap 2D (bidang x/z, y = tinggi utk render 3D).
// =====================================================================

const CFG = { PLAYER_SPEED: 2.6, BOT_SPEED: 1.9, ENTITY_RADIUS: 12, SIGHT_RANGE: 420, VISION_ANGLE: Math.PI * 0.72, RETREAT_HP_PCT: 0.3, PICKUP_RANGE: 32, BULLET_SPEED: 9, BULLET_LIFE: 90, ZONE_INTERVAL: 1800, ZONE_SHRINK_TIME: 900, ZONE_DAMAGE_TICK: 30, ZONE_DAMAGE: 1, MAX_HP: 100, MEDKIT_HEAL: 50, MEDKIT_USE_TIME: 180, JUMP_VELOCITY: 7.5, GRAVITY: 0.35, MUZZLE_Y: 26, GRENADE_SPEED: 6.5, GRENADE_FUSE: 100, GRENADE_GRAVITY: 0.2, GRENADE_RADIUS: 130, GRENADE_DAMAGE: 90, GRENADE_COOLDOWN: 50 };
const WEAPONS = { p92: { name: 'P92', damage: 18, mag: 12, range: 300, fireRate: 20, spread: 0.03, idealRange: 170 }, ak47: { name: 'AK-47', damage: 32, mag: 30, range: 550, fireRate: 10, spread: 0.05, idealRange: 280 }, shotgun: { name: 'S12K', damage: 70, mag: 5, range: 150, fireRate: 40, spread: 0.25, idealRange: 60 }, sniper: { name: 'AWM', damage: 110, mag: 5, range: 950, fireRate: 70, spread: 0.004, idealRange: 520 } };
const LOOT_TYPES = ['p92', 'ak47', 'shotgun', 'sniper', 'ammo', 'medkit', 'grenade'];

// =====================================================================
// AUDIO — SFX sintesis via Web Audio API (offline, tanpa file audio)
// =====================================================================
let audioCtx = null, noiseBuf = null;
function ensureAudio() {
  if (typeof window === 'undefined' || (!window.AudioContext && !window.webkitAudioContext)) return null;
  if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function getNoise(ctx) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}
// Karakter suara per senjata: durasi, frekuensi filter, volume, dan thump bass
const GUN_SFX = { P92: { dur: 0.09, freq: 2400, vol: 0.45, thump: 0 }, 'AK-47': { dur: 0.14, freq: 900, vol: 0.6, thump: 100 }, S12K: { dur: 0.3, freq: 420, vol: 0.8, thump: 80 }, AWM: { dur: 0.42, freq: 650, vol: 0.9, thump: 60 } };
function playGunshot(kind, volume) {
  const ctx = ensureAudio(); if (!ctx || volume <= 0.02) return;
  const s = GUN_SFX[kind] || GUN_SFX.P92, t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = getNoise(ctx);
  const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = s.freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(s.vol * volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + s.dur);
  src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
  src.start(t); src.stop(t + s.dur + 0.05);
  if (s.thump) { // dentuman bass (ak47/shotgun/sniper)
    const osc = ctx.createOscillator(), og = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(s.thump, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.13);
    og.gain.setValueAtTime(0.5 * volume, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(og); og.connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.2);
  }
}
function playExplosion(volume) {
  const ctx = ensureAudio(); if (!ctx || volume <= 0.02) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = getNoise(ctx);
  const filter = ctx.createBiquadFilter(); filter.type = 'lowpass';
  filter.frequency.setValueAtTime(900, t);
  filter.frequency.exponentialRampToValueAtTime(90, t + 0.8);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(1.0 * volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
  src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
  src.start(t); src.stop(t + 1);
  const osc = ctx.createOscillator(), og = ctx.createGain(); // boom sub-bass
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(28, t + 0.6);
  og.gain.setValueAtTime(0.9 * volume, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
  osc.connect(og); og.connect(ctx.destination);
  osc.start(t); osc.stop(t + 0.8);
}
function playGrenadeThrow(volume) {
  const ctx = ensureAudio(); if (!ctx || volume <= 0.02) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = getNoise(ctx);
  const filter = ctx.createBiquadFilter(); filter.type = 'bandpass';
  filter.frequency.setValueAtTime(500, t);
  filter.frequency.exponentialRampToValueAtTime(1800, t + 0.2);
  filter.Q.value = 1.2;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.3 * volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
  src.start(t); src.stop(t + 0.3);
}
// Volume berdasarkan jarak dari pemain (suara bot/ledakan yang jauh lebih pelan)
function volAt(x, z) {
  if (!state.player) return 1;
  return clamp(1 - Math.hypot(x - state.player.x, z - state.player.z) / 1000, 0.05, 1);
}

const canvas = document.getElementById('gameCanvas');
// PENTING: jangan panggil getContext('2d') di canvas utama —
// context 2D membuat canvas tidak bisa dipakai WebGL (Three.js).
const isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const input = { keys: {}, mouse: { x: 0, y: 0, down: false, locked: false }, joystick: { active: false, dx: 0, dy: 0, touchId: null }, firePressed: false, yaw: 0, pitch: 0.35, scoped: false };

// state: dunia memakai sumbu x & z; y hanya dipakai sebagai tinggi visual 3D
const state = { running: false, frame: 0, world: { width: 3000, depth: 3000 }, player: null, bots: [], bullets: [], grenades: [], loots: [], obstacles: [], zone: null, aliveCount: 1, totalEntities: 1, gameOver: false };

function createEntity(x, z, isPlayer, name, team) { return { x, z, vx: 0, vz: 0, jumpY: 0, vJump: 0, angle: 0, hp: CFG.MAX_HP, isPlayer, name, alive: true, team: team || 0, knocked: false, reviveTimer: 0, weapon: null, ammoInMag: 0, reserveAmmo: 0, slots: [], slotIndex: 0, fireCooldown: 0, medkits: 0, grenades: 0, grenadeCooldown: 0, usingMedkit: 0, aiState: 'WANDER', aiTarget: null, aiMoveTarget: { x, z }, aiTimer: 0, skill: 0.7, strafeDir: 1, strafeTimer: 0, lastSeen: null, reactTimer: 0 }; }
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
function startGame(botCount, mode) {
  const count = clamp(Number(botCount) || 15, 1, 20);
  state.mode = mode === 'squad' ? 'squad' : 'solo';
  const squadSize = state.mode === 'squad' ? 3 : 1;
  state.frame = 0; state.gameOver = false; state.bullets = []; state.grenades = []; state.loots = []; state.bots = []; state.obstacles = [];
  // Gedung/cover 3D acak — setengahnya bangunan berdinding (bisa dimasuki lewat pintu)
  for (let i = 0; i < 26; i++) {
    const w = rand(60, 220), d = rand(60, 220), h = rand(40, 160);
    const x = rand(200, 2800), z = rand(200, 2800);
    if (i % 2 === 0) { // bangunan dengan pintu: 4 dinding tipis, satu sisi berlubang
      const t = 10, gap = Math.min(50, Math.min(w, d) * 0.5), door = Math.floor(rand(0, 4));
      const addWall = (cx, cz, sw, sd) => state.obstacles.push({ x: cx, z: cz, w: sw, d: sd, h });
      for (let s = 0; s < 4; s++) {
        const horizontal = s < 2; // sisi 0/1 = atas/bawah (sepanjang sumbu x)
        if (s === door) { // sisi pintu: dua segmen dengan celah di tengah
          const segLen = ((horizontal ? w : d) - gap) / 2, off = gap / 2 + segLen / 2;
          if (horizontal) { const sz = z + (s === 0 ? -1 : 1) * (d / 2 - t / 2); addWall(x - off, sz, segLen, t); addWall(x + off, sz, segLen, t); }
          else { const sx = x + (s === 2 ? -1 : 1) * (w / 2 - t / 2); addWall(sx, z - off, t, segLen); addWall(sx, z + off, t, segLen); }
        } else if (horizontal) addWall(x, z + (s === 0 ? -1 : 1) * (d / 2 - t / 2), w, t);
        else addWall(x + (s === 2 ? -1 : 1) * (w / 2 - t / 2), z, t, d);
      }
    } else state.obstacles.push({ x, z, w, d, h });
  }
  const pSpot = randomFreeSpot(40);
  state.player = createEntity(pSpot.x, pSpot.z, true, 'Pemain', 0);
  giveWeapon(state.player, 'p92'); state.player.slots[0].reserve += 12;
  // Mode squad: 2 rekan satu tim pemain; musuh dikelompokkan per squad
  if (state.mode === 'squad') {
    for (let a = 0; a < 2; a++) { const s = randomFreeSpot(40); const ally = createEntity(s.x, s.z, false, `Squad_${a + 1}`, 0); giveWeapon(ally, 'ak47'); ally.skill = rand(0.7, 1.0); ally.medkits = 1; state.bots.push(ally); }
  }
  for (let i = 0; i < count; i++) { const s = randomFreeSpot(40); const team = state.mode === 'squad' ? 1 + Math.floor(i / squadSize) : i + 1; const bot = createEntity(s.x, s.z, false, `Bot_${String(i + 1).padStart(2, '0')}`, team); giveWeapon(bot, ['p92', 'ak47', 'shotgun', 'sniper'][i % 4]); bot.skill = rand(0.55, 1.0); bot.medkits = Math.floor(rand(0, 3)); state.bots.push(bot); }
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
  window.addEventListener('keydown', event => {
    // Saat game over: Enter = main lagi, Escape = menu utama
    if (state.gameOver) {
      if (event.key === 'Enter') { state.gameOver = false; startGame(document.getElementById('botCount').value, document.getElementById('gameMode').value); }
      else if (event.key === 'Escape') { state.gameOver = false; hideOverlay('gameOverScreen'); showOverlay('mainMenu'); }
      return;
    }
    input.keys[event.key.toLowerCase()] = true; handleKeyDown(event);
  });
  window.addEventListener('keyup', event => { input.keys[event.key.toLowerCase()] = false; });
  // Klik canvas untuk pointer-lock (bidikan FPS ala game 3D)
  canvas.addEventListener('click', () => { if (!isMobile && canvas.requestPointerLock) canvas.requestPointerLock(); });
  document.addEventListener('pointerlockchange', () => { input.mouse.locked = document.pointerLockElement === canvas; });
  window.addEventListener('mousemove', event => {
    if (input.mouse.locked) { const sens = input.scoped ? 0.0008 : 0.0022; input.yaw += event.movementX * sens; input.pitch = clamp(input.pitch + event.movementY * (sens * 0.8), -0.5, 1.15); }
    else { input.mouse.x = event.clientX; input.mouse.y = event.clientY; }
  });
  window.addEventListener('mousedown', event => { if (event.button === 0) input.mouse.down = true; if (event.button === 2) input.scoped = true; });
  window.addEventListener('mouseup', event => { if (event.button === 0) input.mouse.down = false; if (event.button === 2) input.scoped = false; });
  window.addEventListener('contextmenu', event => event.preventDefault());
}
function handleKeyDown(event) { const player = state.player; if (!player || !player.alive) return; const key = event.key.toLowerCase(); if (key === 'r') reloadWeapon(player); if (key === 'e') tryPickupLoot(player); if (key === 'f') useMedkit(player); if (key === 'g') throwGrenade(player); if (key === '1') switchSlot(player, 0); if (key === '2') switchSlot(player, 1); if (key === '3') switchSlot(player, 2); }
function setupTouchControls() { const zone = document.getElementById('joystickZone'), base = document.getElementById('joystickBase'), knob = document.getElementById('joystickKnob'), maxRadius = 48; zone.addEventListener('touchstart', event => { event.preventDefault(); const touch = event.changedTouches[0]; input.joystick.touchId = touch.identifier; input.joystick.active = true; base.style.left = `${touch.clientX - 60}px`; base.style.top = `${touch.clientY - 60}px`; }, { passive: false }); zone.addEventListener('touchmove', event => { event.preventDefault(); for (const touch of event.changedTouches) if (touch.identifier === input.joystick.touchId) { let dx = touch.clientX - (parseFloat(base.style.left) + 60), dy = touch.clientY - (parseFloat(base.style.top) + 60); const length = Math.hypot(dx, dy); if (length > maxRadius) { dx *= maxRadius / length; dy *= maxRadius / length; } input.joystick.dx = dx / maxRadius; input.joystick.dy = dy / maxRadius; knob.style.left = `${34 + dx}px`; knob.style.top = `${34 + dy}px`; } }, { passive: false }); const end = event => { for (const touch of event.changedTouches) if (touch.identifier === input.joystick.touchId) { input.joystick.active = false; input.joystick.touchId = null; input.joystick.dx = 0; input.joystick.dy = 0; knob.style.left = '34px'; knob.style.top = '34px'; } }; zone.addEventListener('touchend', end); zone.addEventListener('touchcancel', end); const bind = (id, press, release) => { const element = document.getElementById(id); element.addEventListener('touchstart', event => { event.preventDefault(); press(); }, { passive: false }); if (release) element.addEventListener('touchend', release); }; bind('btnFire', () => { input.firePressed = true; }, () => { input.firePressed = false; }); bind('btnJump', () => { input.keys[' '] = true; }, () => { input.keys[' '] = false; }); bind('btnReload', () => reloadWeapon(state.player)); bind('btnMedkit', () => useMedkit(state.player)); bind('btnInteract', () => tryPickupLoot(state.player)); bind('btnGrenade', () => throwGrenade(state.player)); }

// Loop utama: zona, fisika, AI, kamera, render, HUD.
function gameLoop() { requestAnimationFrame(gameLoop); if (!state.running) { renderFrame(); return; } state.frame++; updateZone(); updatePhysics(); updateAI(); updateGrenades(); updateKnock(); updateCamera(); renderFrame(); updateHUD(); }

// Fisika pemain: gerak relatif kamera (yaw), tabrakan rintangan, menembak, zona.
function updatePhysics() {
  const player = state.player; if (!player || !player.alive) return;
  // Fallback tanpa pointer-lock: yaw/pitch mengikuti posisi kursor di layar
  if (!isMobile && !input.mouse.locked && input.mouse.x > 0) {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    input.yaw = (input.mouse.x / w - 0.5) * 2.6;
    input.pitch = clamp(0.32 + (input.mouse.y / h - 0.5) * 0.9, -0.5, 1.15);
  }
  let dx = (input.keys.d ? 1 : 0) - (input.keys.a ? 1 : 0), dy = (input.keys.s ? 1 : 0) - (input.keys.w ? 1 : 0);
  if (input.joystick.active) { dx = input.joystick.dx; dy = input.joystick.dy; }
  if (player.usingMedkit > 0) { player.usingMedkit--; dx = 0; dy = 0; }
  const length = Math.hypot(dx, dy) || 1;
  const mvx = dx / length * CFG.PLAYER_SPEED * (player.knocked ? 0.4 : 1), mvz = dy / length * CFG.PLAYER_SPEED * (player.knocked ? 0.4 : 1);
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
  if (!player.knocked) { if (input.mouse.down || input.firePressed) tryShoot(player); }
  for (const entity of [player, ...state.bots]) { if (entity.fireCooldown > 0) entity.fireCooldown--; if (entity.grenadeCooldown > 0) entity.grenadeCooldown--; applyZoneDamage(entity); }
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

// Menembak 3D. Untuk pemain: arah presisi dihitung dari ray kamera melalui
// crosshair (tengah layar) -> titik bidik, lalu peluru ditembakkan dari
// moncong senjata menuju titik itu (kompensasi offset kamera third-person).
function tryShoot(entity) {
  const weapon = entity.weapon; if (!weapon || entity.fireCooldown > 0) return;
  if (entity.ammoInMag <= 0) { reloadWeapon(entity); return; }
  entity.ammoInMag--; entity.fireCooldown = weapon.fireRate;
  let yaw = entity.angle, pitchSin = 0;
  if (entity.isPlayer && typeof THREE !== 'undefined' && camera3D) {
    // Ray dari kamera melewati crosshair ke titik bidik di depan
    const dir = new THREE.Vector3(); camera3D.getWorldDirection(dir);
    const aim = new THREE.Vector3().copy(camera3D.position).addScaledVector(dir, 400);
    const muzzle = new THREE.Vector3(entity.x + Math.cos(entity.angle) * 18, CFG.MUZZLE_Y + entity.jumpY, entity.z + Math.sin(entity.angle) * 18);
    aim.sub(muzzle);
    const len = aim.length() || 1;
    yaw = Math.atan2(aim.z, aim.x);
    pitchSin = aim.y / len; // sin sudut vertikal menuju titik bidik
  } else if (entity.isPlayer) {
    pitchSin = Math.sin(0.3 - input.pitch); // fallback headless
  }
  const angle = yaw + rand(-weapon.spread, weapon.spread);
  let vy;
  if (entity.isPlayer) vy = clamp(pitchSin + rand(-weapon.spread, weapon.spread), -0.95, 0.95) * CFG.BULLET_SPEED;
  else vy = rand(-0.35, 0.35); // bot membidik sejajar + sedikit noise vertikal
  const hSpeed = Math.sqrt(Math.max(1, CFG.BULLET_SPEED * CFG.BULLET_SPEED - vy * vy));
  state.bullets.push({ x: entity.x + Math.cos(angle) * 18, z: entity.z + Math.sin(angle) * 18, y: CFG.MUZZLE_Y + entity.jumpY, vx: Math.cos(angle) * hSpeed, vz: Math.sin(angle) * hSpeed, vy, damage: weapon.damage, range: weapon.range, traveled: 0, life: CFG.BULLET_LIFE, owner: entity });
  // Suara tembakan — berbeda per senjata, volume menurun sesuai jarak
  playGunshot({ P92: 'P92', 'AK-47': 'AK-47', S12K: 'S12K', AWM: 'AWM' }[weapon.name] || 'P92', entity.isPlayer ? 1 : volAt(entity.x, entity.z));
  // Efek muzzle flash: kilatan kuning kecil di ujung laras
  if (typeof THREE !== 'undefined' && renderer) {
    const flash = new THREE.Mesh(new THREE.SphereGeometry(4.5, 6, 5), new THREE.MeshBasicMaterial({ color: entity.isPlayer ? 0xffe08a : 0xffb84d, transparent: true, opacity: 0.95 }));
    flash.position.set(entity.x + Math.cos(angle) * 24, CFG.MUZZLE_Y + entity.jumpY + (entity.isPlayer ? 0 : 0), entity.z + Math.sin(angle) * 24);
    scene.add(flash);
    visuals.muzzleFlashes.push({ mesh: flash, life: 4 });
  }
}
// Hitung titik bidik dari ray kamera melalui crosshair (untuk pemain).
function getAimYawPitch(entity) {
  if (entity.isPlayer && typeof THREE !== 'undefined' && camera3D) {
    const dir = new THREE.Vector3(); camera3D.getWorldDirection(dir);
    const aim = new THREE.Vector3().copy(camera3D.position).addScaledVector(dir, 400);
    const muzzle = new THREE.Vector3(entity.x + Math.cos(entity.angle) * 18, CFG.MUZZLE_Y + entity.jumpY, entity.z + Math.sin(entity.angle) * 18);
    aim.sub(muzzle);
    const len = aim.length() || 1;
    return { yaw: Math.atan2(aim.z, aim.x), pitchSin: aim.y / len };
  }
  return { yaw: entity.angle, pitchSin: entity.isPlayer ? Math.sin(0.3 - input.pitch) : 0 };
}
// Melempar granat (tombol G / GRN): lengkungkan sesuai arah bidik.
function throwGrenade(entity) {
  if (!entity || !entity.alive || entity.grenades <= 0 || entity.grenadeCooldown > 0) return;
  entity.grenades--; entity.grenadeCooldown = CFG.GRENADE_COOLDOWN;
  const { yaw, pitchSin } = getAimYawPitch(entity);
  const pitch = Math.asin(clamp(pitchSin, -0.9, 0.9));
  state.grenades.push({ x: entity.x + Math.cos(yaw) * 14, z: entity.z + Math.sin(yaw) * 14, y: CFG.MUZZLE_Y + entity.jumpY, vx: Math.cos(yaw) * CFG.GRENADE_SPEED * Math.cos(pitch), vz: Math.sin(yaw) * CFG.GRENADE_SPEED * Math.cos(pitch), vy: Math.sin(pitch) * CFG.GRENADE_SPEED + 2.5, fuse: CFG.GRENADE_FUSE, owner: entity });
  playGrenadeThrow(entity.isPlayer ? 1 : volAt(entity.x, entity.z));
}
// Granat: fisika lempar + memantul, meledak sesuai fuse -> damage area.
function updateGrenades() {
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i];
    g.x += g.vx; g.z += g.vz; g.y += g.vy; g.vy -= CFG.GRENADE_GRAVITY; g.fuse--;
    if (g.y <= 1.5) { g.y = 1.5; g.vy = -g.vy * 0.35; g.vx *= 0.7; g.vz *= 0.7; }
    if (g.fuse <= 0) { explodeGrenade(g); state.grenades.splice(i, 1); }
  }
}
function explodeGrenade(g) {
  playExplosion(volAt(g.x, g.z));
  if (typeof THREE !== 'undefined' && renderer) { // efek ledakan: bola api oranye + inti putih
    const fire = new THREE.Mesh(new THREE.SphereGeometry(10, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff8830, transparent: true, opacity: 0.85 }));
    fire.position.set(g.x, Math.max(2, g.y), g.z); scene.add(fire);
    visuals.explosions.push({ mesh: fire, life: 14 });
    const core = new THREE.Mesh(new THREE.SphereGeometry(6, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 1 }));
    core.position.copy(fire.position); scene.add(core);
    visuals.explosions.push({ mesh: core, life: 8 });
  }
  for (const target of [state.player, ...state.bots]) {
    if (!target.alive) continue;
    const d = Math.hypot(target.x - g.x, target.z - g.z);
    if (d <= CFG.GRENADE_RADIUS) applyDamage(target, Math.round(CFG.GRENADE_DAMAGE * (1 - (d / CFG.GRENADE_RADIUS) * 0.7)), g.owner);
  }
}
function reloadWeapon(entity) { if (!entity || !entity.weapon) return; const amount = Math.min(entity.weapon.mag - entity.ammoInMag, entity.reserveAmmo); entity.ammoInMag += amount; entity.reserveAmmo -= amount; }
function useMedkit(entity) { if (!entity || entity.medkits <= 0 || entity.hp >= CFG.MAX_HP || entity.usingMedkit > 0) return; entity.medkits--; entity.usingMedkit = CFG.MEDKIT_USE_TIME; setTimeout(() => { if (entity.alive) entity.hp = Math.min(CFG.MAX_HP, entity.hp + CFG.MEDKIT_HEAL); }, 3000); }
function tryPickupLoot(entity) { if (!entity) return; const index = state.loots.findIndex(loot => Math.hypot(loot.x - entity.x, loot.z - entity.z) <= CFG.PICKUP_RANGE); if (index < 0) return; const loot = state.loots[index]; if (loot.type === 'ammo') { entity.reserveAmmo += 30; saveActiveSlot(entity); } else if (loot.type === 'medkit') entity.medkits = Math.min(3, entity.medkits + 1); else if (loot.type === 'grenade') entity.grenades = Math.min(3, entity.grenades + 1); else giveWeapon(entity, loot.type); state.loots.splice(index, 1); }
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
        applyDamage(target, bullet.damage * (target.armor ? 0.7 : 1), bullet.owner);
        remove = true; break;
      }
    }
    if (remove) state.bullets.splice(index, 1);
  }
}
// Damage terpusat: di mode squad, HP habis = KNOCK (bisa di-revive) selama
// masih ada satu rekan tim yang berdiri; selain itu mati permanen.
function applyDamage(target, dmg, killer) {
  if (!target.alive) return;
  target.hp -= dmg;
  if (target.hp > 0) return;
  const hasAliveMate = state.mode === 'squad' && [state.player, ...state.bots].some(a => a !== target && a.alive && !a.knocked && a.team === target.team);
  if (hasAliveMate && !target.knocked) {
    target.knocked = true; target.hp = 60; target.reviveTimer = 0;
    addKillFeed(`${target.name} TERKNOCK oleh ${killer ? killer.name : 'Zona'}`);
  } else killEntity(target, killer);
}
// Pendaran knocked + auto-revive oleh rekan tim yang mendekat.
function updateKnock() {
  if (state.mode !== 'squad' || !state.player) return;
  for (const e of [state.player, ...state.bots]) {
    if (!e.alive || !e.knocked) continue;
    e.hp -= 0.015; // pendaran perlahan
    if (e.hp <= 0) { e.knocked = false; killEntity(e, null); continue; }
    const ally = [state.player, ...state.bots].find(a => a !== e && a.alive && !a.knocked && a.team === e.team && distance(a, e) < 50);
    if (ally) {
      e.reviveTimer++;
      if (e.reviveTimer >= 180) { e.knocked = false; e.hp = 40; e.reviveTimer = 0; addKillFeed(`${e.name} telah di-revive oleh ${ally.name}`); }
    } else e.reviveTimer = Math.max(0, e.reviveTimer - 2);
  }
}
function killEntity(entity, killer) { if (!entity.alive) return; entity.alive = false; entity.hp = 0; state.aliveCount--; addKillFeed(`${entity.name} tereliminasi oleh ${killer ? killer.name : 'Zona'}`); for (const slot of entity.slots) if (slot) state.loots.push({ x: entity.x + rand(-10, 10), z: entity.z + rand(-10, 10), type: slot.key }); state.loots.push({ x: entity.x + 15, z: entity.z, type: 'medkit' }); if (entity.isPlayer) endGame(false); else if (state.player.alive && ![state.player, ...state.bots].some(t => t.alive && t.team !== 0)) endGame(true); }
// Zona aman menyusut secara berkala dan halus.
function updateZone() { const zone = state.zone; if (!zone) return; if (!zone.shrinking && state.frame >= zone.nextShrink && zone.r > 250) { zone.targetR = zone.r * 0.65; const offset = (zone.r - zone.targetR) * 0.5; zone.targetCx = clamp(zone.cx + rand(-offset, offset), zone.targetR, state.world.width - zone.targetR); zone.targetCz = clamp(zone.cz + rand(-offset, offset), zone.targetR, state.world.depth - zone.targetR); zone.shrinking = true; zone.shrinkStart = state.frame; zone.startCx = zone.cx; zone.startCz = zone.cz; zone.startR = zone.r; } if (zone.shrinking) { const progress = Math.min(1, (state.frame - zone.shrinkStart) / CFG.ZONE_SHRINK_TIME); zone.cx = zone.startCx + (zone.targetCx - zone.startCx) * progress; zone.cz = zone.startCz + (zone.targetCz - zone.startCz) * progress; zone.r = zone.startR + (zone.targetR - zone.startR) * progress; if (progress >= 1) { zone.shrinking = false; zone.nextShrink = state.frame + CFG.ZONE_INTERVAL; } } }
function applyZoneDamage(entity) { if (!entity.alive || !state.zone || state.frame % CFG.ZONE_DAMAGE_TICK !== 0) return; if (Math.hypot(entity.x - state.zone.cx, entity.z - state.zone.cz) > state.zone.r) applyDamage(entity, CFG.ZONE_DAMAGE, null); }

// =====================================================================
// AI BOT — FSM: RETREAT, MOVE_TO_ZONE, ATTACK, HUNT, LOOT, WANDER
// Peningkatan: prediksi posisi target (leading), strafing, jarak ideal
// per senjata, memory posisi musuh terakhir, reload strategis, reaksi
// bertingkat (skill), patroli di dalam zona, dan menghindari rintangan.
// =====================================================================
function visibleEnemies(bot) { return [state.player, ...state.bots].filter(target => target.alive && target !== bot && target.team !== bot.team && canSee(bot, target)); }

function botThink(bot) {
  if (bot.knocked) { // tersandam: merangkak mendekati rekan tim terdekat
    const ally = [state.player, ...state.bots].find(a => a !== bot && a.alive && !a.knocked && a.team === bot.team);
    if (ally) { bot.angle = Math.atan2(ally.z - bot.z, ally.x - bot.x); bot.aiMoveTarget = { x: ally.x, z: ally.z }; moveBot(bot, 0.45); }
    return;
  }
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
const visuals = { entities: new Map(), bullets: [], grenades: [], explosions: [], muzzleFlashes: [], loots: [], zoneRing: null, dangerDisc: null, trees: [] };

// =====================================================================
// MODEL 3D POHON (GLB) — parser GLB minimal offline + preloading + LOD
// Model di folder model3d/ dipakai sebagai pohon dekorasi arena.
// =====================================================================
const MODEL_URL = 'model3d/source/Copilot3D-b3e68fd1-dafb-45f0-b7f8-9ef6932846ab.glb';
// Jarak (unit dunia) maksimum entity tetap dirender 3D. Di luar ini
// entity otomatis diganti billboard 2D (sprite) agar hemat GPU.
const LOD_3D_DIST = 900;
let modelTemplate = null;      // { geometry, texture } — model ternormalisasi (tinggi 44, kaki di y=0)
let spriteTexture = null;      // tekstur 2D hasil render snapshot model (billboard jauh)
let modelLoadPromise = null;   // dedupe preload ganda

// Membaca data accessor glTF (posisi/normal/uv/indeks) dari chunk BIN.
function gltfAccessor(json, bin, index) {
  const acc = json.accessors[index], bv = json.bufferViews[acc.bufferView];
  const compSize = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[acc.componentType];
  const numComp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
  const ArrayCtor = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[acc.componentType];
  const stride = bv.byteStride || compSize * numComp;
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const out = new ArrayCtor(acc.count * numComp);
  const view = new DataView(bin.buffer, bin.byteOffset + base, bin.byteLength - base);
  for (let i = 0; i < acc.count; i++) for (let c = 0; c < numComp; c++) {
    const off = i * stride + c * compSize;
    out[i * numComp + c] = acc.componentType === 5126 ? view.getFloat32(off, true)
      : acc.componentType === 5125 ? view.getUint32(off, true)
      : acc.componentType === 5123 ? view.getUint16(off, true)
      : view.getUint8(off);
  }
  return out;
}

// Mengubah ArrayBuffer GLB menjadi { geometry, texture } (tekstur embedded).
function parseGLB(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  let offset = 12, json = null, bin = null;
  while (offset < arrayBuffer.byteLength) {
    const len = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    const chunk = new Uint8Array(arrayBuffer, offset + 8, len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));      // 'JSON'
    else if (type === 0x004e4942) bin = chunk;                                        // 'BIN\0'
    offset += 8 + len;
  }
  if (!json || !bin) throw new Error('GLB tidak valid');
  // Tekstur embedded (bufferView -> Blob -> TextureLoader)
  const loadTexture = index => new Promise((resolve, reject) => {
    const img = json.images[index], bv = json.bufferViews[img.bufferView];
    const blob = new Blob([bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)], { type: img.mimeType });
    const url = URL.createObjectURL(blob);
    new THREE.TextureLoader().load(url, tex => { tex.encoding = THREE.sRGBEncoding; URL.revokeObjectURL(url); resolve(tex); }, undefined, reject);
  });
  const matJson = (json.materials || [])[0];
  const baseTexIndex = matJson && matJson.pbrMetallicRoughness && matJson.pbrMetallicRoughness.baseColorTexture ? matJson.pbrMetallicRoughness.baseColorTexture.index : null;
  // Kumpulkan seluruh primitive mesh pada scene graph (tanpa skinning/animasi)
  const geometries = [];
  const walkNode = nodeIndex => {
    const node = json.nodes[nodeIndex];
    if (node.mesh !== undefined) {
      for (const prim of json.meshes[node.mesh].primitives) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(gltfAccessor(json, bin, prim.attributes.POSITION), 3));
        if (prim.attributes.NORMAL !== undefined) geo.setAttribute('normal', new THREE.BufferAttribute(gltfAccessor(json, bin, prim.attributes.NORMAL), 3));
        if (prim.attributes.TEXCOORD_0 !== undefined) geo.setAttribute('uv', new THREE.BufferAttribute(gltfAccessor(json, bin, prim.attributes.TEXCOORD_0), 2));
        if (prim.indices !== undefined) geo.setIndex(new THREE.BufferAttribute(gltfAccessor(json, bin, prim.indices), 1));
        const m = new THREE.Matrix4(); // transform node (matrix atau TRS) bila ada
        if (node.matrix) m.fromArray(node.matrix);
        else {
          const q = node.rotation || [0, 0, 0, 1], s = node.scale || [1, 1, 1], t = node.translation || [0, 0, 0];
          m.compose(new THREE.Vector3(t[0], t[1], t[2]), new THREE.Quaternion(q[0], q[1], q[2], q[3]), new THREE.Vector3(s[0], s[1], s[2]));
        }
        if (!m.equals(new THREE.Matrix4())) geo.applyMatrix4(m);
        if (!geo.attributes.normal) geo.computeVertexNormals();
        geometries.push(geo);
      }
    }
    for (const child of node.children || []) walkNode(child);
  };
  for (const n of json.scenes[json.scene || 0].nodes) walkNode(n);
  return Promise.all(baseTexIndex !== null ? [Promise.resolve(geometries[0]), loadTexture(baseTexIndex)] : [Promise.resolve(geometries[0]), Promise.resolve(null)])
    .then(([geo, texture]) => ({ geometry: geo, texture }));
}

// Memuat GLB via XHR (ada event progress) -> Promise { geometry, texture }.
function loadGLB(url, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'arraybuffer';
    xhr.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => { if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) { try { resolve(parseGLB(xhr.response)); } catch (err) { reject(err); } } else reject(new Error('HTTP ' + xhr.status)); };
    xhr.onerror = () => reject(new Error('Gagal memuat model 3D (jalankan lewat server lokal, bukan file://)'));
    xhr.send();
  });
}

// Normalisasi model: skala ke tinggi 44 unit (match placeholder lama),
// kaki di y=0, lalu buat tekstur billboard 2D dari snapshot render model.
function prepareModelTemplate(parsed) {
  const geo = parsed.geometry.clone();
  geo.computeBoundingBox();
  const bb = geo.boundingBox, size = new THREE.Vector3(); bb.getSize(size);
  const scale = 44 / Math.max(size.y, 0.001);
  geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  geo.scale(scale, scale, scale);
  modelTemplate = { geometry: geo, texture: parsed.texture };
  // Snapshot 2D: render model ke canvas kecil via renderer offscreen
  try {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 160;
    const off = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true });
    off.setSize(128, 160, false);
    const sc = new THREE.Scene();
    const probe = new THREE.Mesh(geo, new THREE.MeshBasicMaterial(parsed.texture ? { map: parsed.texture } : { color: 0xcccccc }));
    sc.add(probe);
    const box = new THREE.Box3().setFromObject(probe), s2 = new THREE.Vector3(); box.getSize(s2);
    const cam2 = new THREE.PerspectiveCamera(35, 128 / 160, 0.1, 1000);
    cam2.position.set(s2.x * 0.4, s2.y * 0.35, Math.max(s2.x, s2.y, s2.z) * 2.2);
    cam2.lookAt(0, s2.y * 0.45, 0);
    off.render(sc, cam2);
    spriteTexture = new THREE.CanvasTexture(cv);
    spriteTexture.encoding = THREE.sRGBEncoding;
    off.dispose();
  } catch (err) { console.warn('Snapshot sprite 2D gagal:', err); }
}

// Preload model (idempotent). Dimulai di background saat halaman dibuka,
// dan ditunggu saat tombol START diklik.
function preloadModel(onProgress) {
  if (typeof THREE === 'undefined') return Promise.resolve(null); // headless / smoke test
  if (modelTemplate) return Promise.resolve(modelTemplate);
  if (!modelLoadPromise) {
    modelLoadPromise = loadGLB(MODEL_URL, onProgress).then(parsed => { prepareModelTemplate(parsed); return modelTemplate; });
  }
  return modelLoadPromise;
}

// Visual karakter: placeholder asli (silinder + kepala + senjata),
// plus bar darah di atas kepala untuk bot.
function mkEntityVisual(color, withHealthBar) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(10, 12, 30, 10), new THREE.MeshLambertMaterial({ color }));
  body.position.y = 15; group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(8, 10, 8), new THREE.MeshLambertMaterial({ color: 0xf1c08a }));
  head.position.y = 36; group.add(head);
  // Senjata di tangan: model lebih detail (badan + laras + popor + magasin)
  const gun = new THREE.Group();
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(20, 5, 4), new THREE.MeshLambertMaterial({ color: 0x2b2b2b }));
  gunBody.position.set(12, 20, 0); gun.add(gunBody);
  const gunBarrel = new THREE.Mesh(new THREE.BoxGeometry(16, 2.5, 2.5), new THREE.MeshLambertMaterial({ color: 0x171717 }));
  gunBarrel.position.set(29, 21, 0); gun.add(gunBarrel);
  const gunStock = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 3.5), new THREE.MeshLambertMaterial({ color: 0x4a3520 }));
  gunStock.position.set(-2, 19, 0); gun.add(gunStock);
  const gunMag = new THREE.Mesh(new THREE.BoxGeometry(4, 8, 3), new THREE.MeshLambertMaterial({ color: 0x101010 }));
  gunMag.position.set(12, 15.5, 0); gun.add(gunMag);
  group.add(gun);
  let healthBar = null;
  if (withHealthBar) {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 8;
    const tex = new THREE.CanvasTexture(cv);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sprite.scale.set(26, 3.5, 1); sprite.position.y = 50; sprite.renderOrder = 10;
    group.add(sprite);
    healthBar = { sprite, cv, tex, lastHp: -1 };
  }
  return { group, healthBar };
}
// Menggambar ulang bar darah (dipanggil hanya saat HP berubah).
function updateHealthBar(bar, hp) {
  if (!bar || bar.lastHp === hp) return;
  bar.lastHp = hp;
  const ctx = bar.cv.getContext('2d');
  ctx.clearRect(0, 0, 64, 8);
  ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(0, 0, 64, 8);
  ctx.fillStyle = hp > 50 ? '#43d17a' : hp > 20 ? '#f5c542' : '#e55454';
  ctx.fillRect(2, 2, 60 * clamp(hp, 0, 100) / 100, 4);
  bar.tex.needsUpdate = true;
}

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
  // Ground: tanah berbukit lembut + variasi warna rumput/tanah (vertex colors)
  const geo = new THREE.PlaneGeometry(state.world.width + 400, state.world.depth + 400, 70, 70);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    // bukit halus (amplitudo kecil agar gameplay tetap terasa datar)
    const n = Math.sin(x * 0.004) * Math.cos(z * 0.0037) + Math.sin(x * 0.011 + 1.7) * 0.5 + Math.cos(z * 0.013 + 2.4) * 0.5;
    pos.setY(i, n * 2.4);
    // campuran warna: rumput segar, rumput kering, dan lahan tanah
    const t = (Math.sin(x * 0.019 + 1.3) * Math.cos(z * 0.016 + 0.6) + Math.sin(x * 0.005) * 0.5 + 1.5) / 3;
    const g = [0.16 + 0.06 * n * 0.2, 0.44 + t * 0.1, 0.26];
    const dry = [0.52, 0.47, 0.28], dirt = [0.42, 0.34, 0.24];
    const mixDry = clamp((t - 0.55) * 3, 0, 1), mixDirt = clamp((t - 0.8) * 5, 0, 1);
    const c = [
      g[0] * (1 - mixDry) + dry[0] * mixDry, g[1] * (1 - mixDry) + dry[1] * mixDry, g[2] * (1 - mixDry) + dry[2] * mixDry
    ];
    colors[i * 3] = c[0] * (1 - mixDirt) + dirt[0] * mixDirt;
    colors[i * 3 + 1] = c[1] * (1 - mixDirt) + dirt[1] * mixDirt;
    colors[i * 3 + 2] = c[2] * (1 - mixDirt) + dirt[2] * mixDirt;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(ground);
  // Batu / gundukan dekoratif acak (tanpa collision)
  visuals.rocks = [];
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  for (let i = 0; i < 40; i++) {
    const rock = new THREE.Mesh(rockGeo, new THREE.MeshLambertMaterial({ color: [0x8b8b83, 0x77746c, 0x9a958a][i % 3] }));
    const s = rand(6, 26);
    rock.scale.set(s * rand(0.8, 1.3), s * rand(0.4, 0.8), s * rand(0.8, 1.3));
    rock.position.set(rand(0, state.world.width), s * 0.2, rand(0, state.world.depth));
    rock.rotation.y = rand(0, Math.PI * 2);
    scene.add(rock); visuals.rocks.push(rock);
  }
  window.addEventListener('resize', () => { camera3D.aspect = window.innerWidth / window.innerHeight; camera3D.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });
}
// Membangun ulang mesh dunia saat match baru dimulai.
function buildScene() {
  if (!renderer) { init3D(); if (!renderer) return; }
  // Bersihkan scene dinamis lama
  for (const v of visuals.entities.values()) scene.remove(v.group); visuals.entities.clear();
  for (const m of visuals.bullets) scene.remove(m); visuals.bullets = [];
  for (const l of visuals.loots) scene.remove(l.mesh); visuals.loots = [];
  for (const g of visuals.grenades) scene.remove(g); visuals.grenades = [];
  for (const e of visuals.explosions) scene.remove(e.mesh); visuals.explosions = [];
  for (const f of visuals.muzzleFlashes) scene.remove(f.mesh); visuals.muzzleFlashes = [];
  if (visuals.obstacles) for (const o of visuals.obstacles) scene.remove(o);
  if (visuals.zoneRing) scene.remove(visuals.zoneRing);
  if (visuals.dangerDisc) scene.remove(visuals.dangerDisc);
  for (const t of visuals.trees) { scene.remove(t.mesh); if (t.billboard) scene.remove(t.billboard); }
  visuals.trees = [];
  // Gedung/cover: badan + atap + jendela (detail), warna bervariasi
  const wallPalette = [0x9a9284, 0x8d8577, 0x7d7468, 0x8a8f75, 0x96867a];
  visuals.obstacles = state.obstacles.map(o => {
    const group = new THREE.Group();
    const color = wallPalette[Math.abs(Math.round(o.x + o.z)) % wallPalette.length];
    const body = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), new THREE.MeshLambertMaterial({ color }));
    body.position.y = o.h / 2; group.add(body);
    // Atap gelap sedikit lebih lebar (plafon + lis)
    if (o.w > 30 && o.d > 30) {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(o.w + 6, 4, o.d + 6), new THREE.MeshLambertMaterial({ color: 0x5a4433 }));
      roof.position.y = o.h + 2; group.add(roof);
      // Jendela di sisi panjang (hanya bangunan besar, bukan dinding tipis)
      if (o.w > 60 && o.d > 40) {
        const winMat = new THREE.MeshLambertMaterial({ color: 0x223140 });
        const winH = Math.min(16, o.h * 0.25), winW = Math.min(18, o.w * 0.18);
        for (const sgn of [-1, 1]) for (const off of [-o.w * 0.22, o.w * 0.22]) {
          const win = new THREE.Mesh(new THREE.BoxGeometry(winW, winH, 1.5), winMat);
          win.position.set(off, o.h * 0.62, sgn * (o.d / 2 + 0.4)); group.add(win);
        }
        for (const sgn of [-1, 1]) {
          const win = new THREE.Mesh(new THREE.BoxGeometry(1.5, winH, Math.min(14, o.d * 0.2)), winMat);
          win.position.set(sgn * (o.w / 2 + 0.4), o.h * 0.62, 0); group.add(win);
        }
      }
    }
    group.position.set(o.x, 0, o.z); scene.add(group); return group;
  });
  // Zona: lingkaran putih + disc biru transparan di luar zona
  const pts = []; for (let i = 0; i <= 128; i++) { const a = i / 128 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a))); }
  visuals.zoneRing = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff }));
  scene.add(visuals.zoneRing);
  visuals.dangerDisc = new THREE.Mesh(new THREE.RingGeometry(1, 2.6, 64), new THREE.MeshBasicMaterial({ color: 0x2f75be, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
  visuals.dangerDisc.rotation.x = -Math.PI / 2; visuals.dangerDisc.position.y = 0.4; scene.add(visuals.dangerDisc);
  // Entitas (pemain + bot) — karakter placeholder asli, bot diberi bar darah
  const pv = mkEntityVisual(0x3d7bf0);
  scene.add(pv.group);
  visuals.entities.set(state.player, { group: pv.group, isPlayer: true });
  for (const bot of state.bots) {
    const v = mkEntityVisual(0xd84848, true);
    scene.add(v.group);
    visuals.entities.set(bot, { group: v.group, isPlayer: false, healthBar: v.healthBar });
  }
  // Pohon dari model3d (dekorasi, tanpa collision) + billboard 2D saat jauh
  visuals.trees = [];
  if (modelTemplate) {
    const treeMat = new THREE.MeshStandardMaterial(modelTemplate.texture ? { map: modelTemplate.texture, roughness: 0.95, metalness: 0 } : { color: 0x3f7d3a, roughness: 0.95 });
    for (let i = 0; i < 55; i++) {
      const s = randomFreeSpot(20);
      if (Math.hypot(s.x - state.player.x, s.z - state.player.z) < 120) continue; // jangan menutupi spawn pemain
      const scale = rand(60, 120) / 44;
      const mesh = new THREE.Mesh(modelTemplate.geometry, treeMat);
      mesh.scale.setScalar(scale);
      mesh.position.set(s.x, 0, s.z);
      mesh.rotation.y = rand(0, Math.PI * 2);
      mesh.visible = true; scene.add(mesh);
      let billboard = null;
      if (spriteTexture) {
        billboard = new THREE.Sprite(new THREE.SpriteMaterial({ map: spriteTexture, transparent: true }));
        const h = rand(60, 120);
        billboard.scale.set(h * 0.8, h, 1); billboard.position.set(s.x, h / 2, s.z); billboard.visible = false;
        scene.add(billboard);
      }
      visuals.trees.push({ mesh, billboard, x: s.x, z: s.z, y: mesh.position.y });
    }
  }
  // Loot — model berbeda per tipe (bukan sekadar kotak)
  for (const loot of state.loots) {
    const mesh = mkLootMesh(loot.type);
    mesh.position.set(loot.x, 8, loot.z); scene.add(mesh); visuals.loots.push({ ref: loot, mesh });
  }
}
// Model item loot: senjata berbentuk senjata, medkit dengan palang merah, dll.
function mkLootMesh(type) {
  const group = new THREE.Group();
  const mat = c => new THREE.MeshLambertMaterial({ color: c });
  if (type in WEAPONS) { // senjata: badan + laras + popor + magasin, warna per senjata
    const bodyColor = type === 'sniper' ? 0x39492e : type === 'ak47' ? 0x5d4632 : type === 'shotgun' ? 0x6b3226 : 0x2b2b2b;
    const body = new THREE.Mesh(new THREE.BoxGeometry(20, 5, 4), mat(bodyColor)); group.add(body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(16, 2.5, 2.5), mat(0x171717)); barrel.position.set(17, 1, 0); group.add(barrel);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 3.5), mat(0x4a3520)); stock.position.set(-14, -1, 0); group.add(stock);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(4, 8, 3), mat(0x101010)); mag.position.set(1, -6, 0); group.add(mag);
    if (type === 'sniper') { const scope = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 8, 8), mat(0x0d0d0d)); scope.rotation.z = Math.PI / 2; scope.position.set(2, 4.5, 0); group.add(scope); }
    group.rotation.z = Math.PI / 12; // miring sedikit biar terlihat seperti tersandar
  } else if (type === 'ammo') { // peti amunisi dengan pita kuning
    const crate = new THREE.Mesh(new THREE.BoxGeometry(16, 10, 12), mat(0x4a5d3a)); group.add(crate);
    const band = new THREE.Mesh(new THREE.BoxGeometry(16.5, 3, 12.5), mat(0xd8b13a)); group.add(band);
  } else if (type === 'medkit') { // kotak P3K putih + palang merah
    const box = new THREE.Mesh(new THREE.BoxGeometry(16, 10, 12), mat(0xe8e8e8)); group.add(box);
    const cross1 = new THREE.Mesh(new THREE.BoxGeometry(10, 1, 3), mat(0xe03c3c)); cross1.position.y = 5.2; group.add(cross1);
    const cross2 = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 10), mat(0xe03c3c)); cross2.position.y = 5.2; group.add(cross2);
  } else if (type === 'grenade') { // granat: bola gelap + pin
    const ball = new THREE.Mesh(new THREE.SphereGeometry(6, 10, 8), mat(0x33502e)); group.add(ball);
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 3, 8), mat(0x9aa0a6)); pin.position.y = 7; group.add(pin);
  }
  return group;
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
  // Granat (pool)
  while (visuals.grenades.length < state.grenades.length) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(3.5, 8, 6), new THREE.MeshLambertMaterial({ color: 0x33502e }));
    scene.add(mesh); visuals.grenades.push(mesh);
  }
  while (visuals.grenades.length > state.grenades.length) scene.remove(visuals.grenades.pop());
  state.grenades.forEach((g, i) => visuals.grenades[i].position.set(g.x, g.y, g.z));
  // Efek ledakan mengembang lalu memudar
  for (let i = visuals.explosions.length - 1; i >= 0; i--) {
    const e = visuals.explosions[i]; e.life--;
    e.mesh.scale.setScalar(1 + (14 - e.life) * 0.55);
    e.mesh.material.opacity = Math.max(0, e.life / 14) * 0.85;
    if (e.life <= 0) { scene.remove(e.mesh); visuals.explosions.splice(i, 1); }
  }
  // Kilatan laras (muzzle flash): memudar cepat
  for (let i = visuals.muzzleFlashes.length - 1; i >= 0; i--) {
    const f = visuals.muzzleFlashes[i]; f.life--;
    f.mesh.scale.setScalar(1 + (4 - f.life) * 0.35);
    f.mesh.material.opacity = Math.max(0, f.life / 4) * 0.95;
    if (f.life <= 0) { scene.remove(f.mesh); visuals.muzzleFlashes.splice(i, 1); }
  }
}

// Kamera third-person over-the-shoulder: pemain di kiri layar, bidik bebas.
function updateCamera() {
  if (!state.player) return;
  if (!camera3D) { state.camera = { x: state.player.x, z: state.player.z }; return; }
  const p = state.player, D = 170, side = 36; // side: geser kamera ke kanan badan
  const fx = Math.cos(input.yaw), fz = Math.sin(input.yaw);  // arah hadap
  const rx = -fz, rz = fx;                                   // vektor kanan
  const horiz = Math.cos(input.pitch) * D;
  // Kamera lebih tinggi (basis 55) & tidak pernah terlalu dekat tanah.
  // Pitch negatif = melihat ke atas (bisa bidik target di atas gedung).
  // Kamera ikut melompat: tinggi kamera & titik pandang + jumpY pemain.
  const jy = p.jumpY || 0;
  const height = Math.max(28, 55 + Math.sin(input.pitch) * D) + jy;
  const lookY = 55 - Math.sin(input.pitch) * 230 + jy;
  camera3D.position.set(p.x - fx * horiz + rx * side, height, p.z - fz * horiz + rz * side);
  camera3D.lookAt(p.x + fx * 60 + rx * side, lookY, p.z + fz * 60 + rz * side);
  // Scope sniper: tahan klik kanan -> FOV sempit (zoom)
  const scoped = !!(state.player.weapon && state.player.weapon.name === 'AWM' && input.scoped);
  const targetFov = scoped ? 20 : 70;
  if (camera3D.fov !== targetFov) { camera3D.fov = targetFov; camera3D.updateProjectionMatrix(); }
  if (typeof document !== 'undefined') { const s = document.getElementById('scopeOverlay'); if (s) s.classList.toggle('visible', scoped); }
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
      // Knocked: karakter rebah (miring di sumbu Z)
      visual.group.rotation.z = entity.knocked ? Math.PI / 2.4 : 0;
      // Bar darah bot: update tekstur hanya saat HP berubah, tampil saat dekat
      if (visual.healthBar) {
        updateHealthBar(visual.healthBar, entity.hp);
        visual.healthBar.sprite.visible = camera3D.position.distanceTo(visual.group.position) <= 500;
      }
    }
    // LOD pohon: jauh dari kamera -> billboard 2D, dekat -> model 3D penuh
    for (const t of visuals.trees) {
      const dx = camera3D.position.x - t.x, dz = camera3D.position.z - t.z;
      const near = (dx * dx + dz * dz) <= LOD_3D_DIST * LOD_3D_DIST;
      t.mesh.visible = near;
      if (t.billboard) t.billboard.visible = !near;
    }
    // Hapus visual loot yang sudah diambil (tidak ada lagi di state.loots)
    for (let i = visuals.loots.length - 1; i >= 0; i--) {
      if (!state.loots.includes(visuals.loots[i].ref)) { scene.remove(visuals.loots[i].mesh); visuals.loots.splice(i, 1); }
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
  for (const bot of state.bots) if (bot.alive) { mctx.fillStyle = bot.team === 0 ? '#4ce07a' : '#e55454'; mctx.beginPath(); mctx.arc(bot.x * scale, bot.z * scale, 2.5, 0, Math.PI * 2); mctx.fill(); if (bot.knocked) { mctx.strokeStyle = '#ffffff'; mctx.stroke(); } }
  if (state.player && state.player.alive) { mctx.fillStyle = '#4c9cff'; mctx.beginPath(); mctx.arc(state.player.x * scale, state.player.z * scale, 3.5, 0, Math.PI * 2); mctx.fill(); }
}
// Ikon senjata sederhana (SVG inline) untuk panel slot.
function weaponIcon(key) {
  const shapes = {
    p92: '<rect x="3" y="8" width="18" height="5" rx="1"/><rect x="5" y="12" width="6" height="7" rx="1"/>',
    ak47: '<rect x="1" y="8" width="26" height="4" rx="1"/><rect x="24" y="6" width="6" height="3" rx="1"/><rect x="10" y="12" width="4" height="7" rx="1"/><rect x="4" y="12" width="5" height="4" rx="1"/>',
    sniper: '<rect x="0" y="8" width="32" height="3" rx="1"/><rect x="8" y="4" width="12" height="3" rx="1"/><rect x="20" y="11" width="8" height="6" rx="1"/><rect x="4" y="11" width="4" height="7" rx="1"/>',
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
  document.getElementById('grenadeNum').textContent = player.grenades;
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
function endGame(victory) { state.running = false; state.gameOver = true; document.getElementById('gameOverTitle').textContent = victory ? 'VICTORY' : 'DEFEATED'; document.getElementById('gameOverDetail').textContent = (victory ? 'Tim Anda yang terakhir bertahan.' : 'HP Anda telah habis.') + ' Enter: main lagi, Escape: menu utama.'; showOverlay('gameOverScreen'); }

// Loading screen: tampilkan progres, muat & siapkan seluruh asset,
// lalu render beberapa frame warm-up (compile shader) sebelum gameplay.
function setLoadingProgress(pct) {
  const fill = document.getElementById('loadingBarFill'), pctEl = document.getElementById('loadingPct');
  if (fill) fill.style.width = `${clamp(Math.round(pct * 100), 0, 100)}%`;
  if (pctEl) pctEl.textContent = `${clamp(Math.round(pct * 100), 0, 100)}%`;
}
async function handleStartClick() {
  ensureAudio(); // aktifkan audio pada gesture klik pertama (kebijakan autoplay browser)
  const count = document.getElementById('botCount').value;
  const mode = document.getElementById('gameMode') ? document.getElementById('gameMode').value : 'solo';
  const textEl = document.getElementById('loadingText');
  showOverlay('loadingScreen');
  setLoadingProgress(0);
  // 1) Muat model 3D GLB (progress nyata dari unduhan, 0-90%)
  if (!modelTemplate && typeof THREE !== 'undefined') {
    try {
      textEl.textContent = 'Memuat model pohon…';
      await preloadModel(p => { setLoadingProgress(p * 0.9); });
      textEl.textContent = 'Menyiapkan arena…';
      setLoadingProgress(0.95);
      await new Promise(r => setTimeout(r, 50)); // beri kesempatan UI update
    } catch (err) {
      console.error('Model 3D gagal dimuat, memakai placeholder:', err);
      textEl.textContent = 'Model gagal dimuat — memakai placeholder.';
      await new Promise(r => setTimeout(r, 800));
    }
  }
  // 2) Bangun dunia (startGame juga menyembunyikan menu utama).
  // Game di-pause dulu: bot & logika baru bergerak setelah loading selesai.
  startGame(count, mode);
  state.running = false;
  textEl.textContent = 'Merender asset…';
  // 3) Warm-up: render beberapa frame agar shader & tekstur ter-compile
  for (let i = 0; i < 3; i++) {
    updateCamera(); renderFrame();
    await new Promise(r => requestAnimationFrame(r));
    setLoadingProgress(0.95 + (i + 1) * 0.0167);
  }
  hideOverlay('loadingScreen');
  state.running = true; // loading selesai -> game (dan bot) mulai berjalan
}
document.getElementById('btnStart').addEventListener('click', handleStartClick);
document.getElementById('btnRestart').addEventListener('click', handleStartClick);
setupInput(); requestAnimationFrame(gameLoop);
// Mulai preload model di background sejak halaman dibuka (klik START jadi instan)
if (typeof THREE !== 'undefined') preloadModel().catch(err => console.warn('Preload model (background) gagal:', err));
if (typeof module !== 'undefined') module.exports = { CFG, WEAPONS, state, startGame, updateZone, updatePhysics, updateAI, updateBullets, canSee };






