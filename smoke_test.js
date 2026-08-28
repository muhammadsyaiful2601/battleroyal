// Headless smoke test (diabaikan saat production — hanya untuk verifikasi Node)
const stubEl = { style: {}, classList: { add(){}, remove(){} }, textContent: '', addEventListener(){}, appendChild(){}, prepend(){}, remove(){} };
const ctxStub = new Proxy({}, { get: (t, k) => (typeof k === 'string' ? () => {} : undefined), set: () => true });
global.document = {
  getElementById: (id) => (id === 'gameCanvas'
    ? { getContext: () => ctxStub, width: 800, height: 600, style: {}, addEventListener(){} }
    : stubEl),
  createElement: () => stubEl,
  addEventListener() {},
  pointerLockElement: null,
};
global.window = { innerWidth: 800, innerHeight: 600, addEventListener(){} };
global.navigator = { maxTouchPoints: 0 };
global.requestAnimationFrame = () => {};

// Sisipkan seluruh game.js lalu jalankan skenario uji
const fs = require('fs');
const gameCode = fs.readFileSync('./game.js', 'utf8').replace("'use strict';", '');
const scenario = `
startGame(15);
for (let i = 0; i < 1200; i++) { updateZone(); updatePhysics(); updateAI(); updateBullets(); }
console.log('bots:', state.bots.length, 'alive:', state.aliveCount, 'loots:', state.loots.length);
console.log('AI states:', [...new Set(state.bots.filter(b => b.alive).map(b => b.aiState))].join(','));
console.log('armed bots:', state.bots.filter(b => b.alive && b.weapon).length, '/', state.bots.filter(b => b.alive).length);
console.log('bullets in flight:', state.bullets.length, '| obstacles:', state.obstacles.length);
console.log('zone r:', Math.round(state.zone.r));
`;
eval(gameCode + scenario + `
// --- Uji fitur baru ---
startGame(3);
const p = state.player;
giveWeapon(p, 'ak47'); giveWeapon(p, 'shotgun');
console.log('slots:', p.slots.map(s => s.key).join(','), '| active:', p.weapon.name);
const before = p.ammoInMag; p.ammoInMag = 1; saveActiveSlot(p); switchSlot(p, 0);
console.log('switch 1-2-3 OK, slot0 ammo preserved:', p.slots[0].mag, 'active:', p.weapon.name, 'mag:', p.ammoInMag);
input.keys[' '] = true; updatePhysics();
console.log('jump started, vJump:', p.vJump > 0, '| y naik:', (() => { const y0 = p.jumpY; for (let i=0;i<10;i++) updatePhysics(); return p.jumpY > 0; })());
input.keys[' '] = false;
for (let i = 0; i < 200; i++) updatePhysics();
console.log('mendarat kembali, jumpY =', p.jumpY);
input.pitch = 0.08; const n0 = state.bullets.length; tryShoot(p);
console.log('tembak ke ATAS, vy > 0:', state.bullets[state.bullets.length - 1].vy > 0);
input.pitch = 1.0; p.fireCooldown = 0; tryShoot(p);
console.log('tembak ke BAWAH, vy < 0:', state.bullets[state.bullets.length - 1].vy < 0);
console.log('typeof startGame:', typeof startGame);
console.log('typeof hideOverlay:', typeof hideOverlay);
console.log('typeof showOverlay:', typeof showOverlay);
`);

