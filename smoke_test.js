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
console.log('typeof startGame:', typeof startGame);
console.log('typeof hideOverlay:', typeof hideOverlay);
console.log('typeof showOverlay:', typeof showOverlay);
`);

