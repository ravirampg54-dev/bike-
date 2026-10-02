'use strict';
/* HIGHWAY RUSH — 2.5D arcade motorcycle racer. Vanilla JS + Canvas + WebAudio. */

/* ---------- Config & helpers ---------- */
const CFG = { segLen: 200, roadW: 800, camH: 1000, fov: 100, draw: 110, N: 900, unit: 28 };
CFG.D = 1 / Math.tan(CFG.fov / 2 * Math.PI / 180);
CFG.playerZ = CFG.camH * CFG.D;           // camera-to-player distance
const LANES = [-0.75, -0.25, 0.25, 0.75]; // lane centres, road half-width = 1
const FONT = '"Bahnschrift","Segoe UI","Arial Narrow",sans-serif';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.random() * a.length | 0];
const rgb = a => `rgb(${a[0] | 0},${a[1] | 0},${a[2] | 0})`;
const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const fmt = n => Math.floor(n).toLocaleString('en-US');
const $ = id => document.getElementById(id);
function rr(c, x, y, w, h, r) { c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h); }

/* ---------- Storage ---------- */
const Storage = {
  key: 'highwayRush.v1', data: null,
  defaults() {
    return { cash: 0, bike: 0, unlocked: [true, false, false], upg: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
      bestDist: 0, bestSpeed: 0, sound: true, music: true,
      missions: { dist: 0, near: 0, speed: 0, nitro: 0, pass: 0, done: {} } };
  },
  load() {
    const d = this.defaults();
    try { const s = JSON.parse(localStorage.getItem(this.key)); if (s) { Object.assign(d, s); d.missions = Object.assign(this.defaults().missions, s.missions); } } catch (e) {}
    this.data = d; return d;
  },
  save() { try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {} },
  reset() { try { localStorage.removeItem(this.key); } catch (e) {} this.load(); }
};

/* ---------- Bikes & upgrades ---------- */
const BIKES = [
  { name: 'Street Viper', price: 0, speed: 210, handling: 65, accel: 70, nitro: 60, color: '#ff3b5c' },
  { name: 'Cyber Phantom', price: 4000, speed: 240, handling: 72, accel: 82, nitro: 80, color: '#22e1ff' },
  { name: 'Thunder X', price: 12000, speed: 270, handling: 85, accel: 90, nitro: 95, color: '#ffb02e' }
];
const UPG_NAMES = ['Engine', 'Acceleration', 'Handling', 'Nitro'], MAX_LV = 5;
const upgCost = lv => Math.round(300 * Math.pow(lv + 1, 1.5) / 50) * 50;
// Effective gameplay numbers derived from bike + upgrades
function bikeStats(i = Storage.data.bike) {
  const b = BIKES[i], u = Storage.data.upg[i];
  return { maxSpeed: Math.min(b.speed + u[0] * 7, 300), accel: 16 + b.accel * 0.45 + u[1] * 3.5,
    turn: 5 + b.handling * 0.07 + u[2] * 0.9, nitroDur: 3 + b.nitro * 0.03 + u[3] * 0.5 };
}

/* ---------- Environment (day / sunset / night, smoothly blended) ---------- */
const PAL = [
  { top: [64, 148, 236], bot: [196, 228, 255], g1: [56, 150, 66], g2: [48, 138, 58], r1: [84, 86, 94], r2: [78, 80, 88], ru1: [214, 48, 48], ru2: [240, 240, 240], m1: [96, 124, 166], m2: [66, 96, 134], bld: [92, 106, 134], tree: [30, 120, 50], dark: 0 },
  { top: [52, 40, 120], bot: [255, 150, 84], g1: [72, 92, 64], g2: [62, 82, 56], r1: [88, 72, 86], r2: [82, 66, 80], ru1: [200, 60, 60], ru2: [230, 200, 190], m1: [120, 70, 110], m2: [86, 48, 90], bld: [70, 56, 92], tree: [40, 84, 52], dark: 0.5 },
  { top: [4, 6, 26], bot: [44, 30, 96], g1: [14, 30, 26], g2: [10, 24, 22], r1: [34, 36, 48], r2: [30, 32, 44], ru1: [130, 30, 40], ru2: [150, 150, 170], m1: [22, 26, 56], m2: [14, 16, 40], bld: [20, 24, 52], tree: [10, 40, 32], dark: 1 }
];
const Env = {
  t: 0, dark: 0, s: {},
  update(dt) {
    this.t += dt / 36;
    const p = this.t % 3, i = Math.floor(p), f = p - i, k = clamp((f - 0.65) / 0.35, 0, 1), sm = k * k * (3 - 2 * k);
    const a = PAL[i], b = PAL[(i + 1) % 3];
    for (const key in a) {
      if (key === 'dark') this.dark = lerp(a.dark, b.dark, sm);
      else this.s[key] = rgb(mixc(a[key], b[key], sm));
    }
  }
};

/* ---------- Sound (Web Audio) ---------- */
const Sound = {
  ctx: null, step: 0, timer: 0,
  init() {
    if (this.ctx) return;
    try {
      const c = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = c.createGain(); this.master.connect(c.destination);
      this.eng = c.createOscillator(); this.eng.type = 'sawtooth';
      this.engF = c.createBiquadFilter(); this.engF.type = 'lowpass';
      this.engG = c.createGain(); this.engG.gain.value = 0;
      this.eng.connect(this.engF); this.engF.connect(this.engG); this.engG.connect(this.master); this.eng.start();
      const len = c.sampleRate * 0.6, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    } catch (e) { this.ctx = null; }
  },
  resume() { this.init(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); this.syncMusic(); },
  engine(pct, nitro, on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.eng.frequency.setTargetAtTime(45 + pct * 120 + (nitro ? 45 : 0), t, 0.05);
    this.engF.frequency.setTargetAtTime(260 + pct * 900, t, 0.05);
    this.engG.gain.setTargetAtTime(on && Storage.data.sound ? 0.035 + pct * 0.05 : 0, t, 0.08);
  },
  tone(f, dur, type = 'square', vol = 0.12, slide = 0, delay = 0) {
    if (!this.ctx || !Storage.data.sound) return;
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol, freq) {
    if (!this.ctx || !Storage.data.sound) return;
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; f.type = 'lowpass'; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(); s.stop(c.currentTime + dur);
  },
  play(n) {
    switch (n) {
      case 'click': this.tone(520, 0.07, 'square', 0.07); break;
      case 'select': this.tone(520, 0.08, 'triangle', 0.12); this.tone(780, 0.12, 'triangle', 0.12, 0, 0.08); break;
      case 'upgrade': [440, 554, 659, 880].forEach((f, i) => this.tone(f, 0.14, 'triangle', 0.12, 0, i * 0.07)); break;
      case 'cash': this.tone(988, 0.08, 'square', 0.07); this.tone(1319, 0.2, 'square', 0.07, 0, 0.07); break;
      case 'near': this.tone(300, 0.25, 'sawtooth', 0.09, 900); break;
      case 'crash': this.noise(0.6, 0.5, 1400); this.tone(110, 0.4, 'sawtooth', 0.2, -70); break;
      case 'nitro': this.noise(0.5, 0.25, 4000); this.tone(200, 0.5, 'sawtooth', 0.1, 600); break;
      case 'brake': this.noise(0.25, 0.12, 5000); break;
      case 'deny': this.tone(160, 0.2, 'square', 0.1); break;
    }
  },
  syncMusic() {
    clearInterval(this.timer);
    if (!this.ctx || !Storage.data.music) return;
    const bass = [55, 55, 82.4, 55, 65.4, 65.4, 98, 65.4], arp = [220, 277, 330, 440, 330, 277, 392, 494];
    this.timer = setInterval(() => {
      if (!Storage.data.music || this.ctx.state !== 'running') return;
      const i = this.step++ % 8;
      this.tone(bass[i], 0.2, 'sawtooth', 0.045);
      if (i % 2 === 0) this.tone(arp[(this.step >> 1) % 8], 0.16, 'triangle', 0.035);
    }, 230);
  }
};

/* ---------- Input (keyboard, mouse, touch, swipe) ---------- */
const Input = {
  k: {}, rep: 0, sx: 0, sy: 0,
  get gas() { return this.k.KeyW || this.k.ArrowUp || this.auto; },
  get brake() { return this.k.KeyS || this.k.ArrowDown || this.k.TB; },
  get nitro() { return this.k.Space || this.k.TN; },
  auto: false,
  init() {
    this.auto = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
    addEventListener('keydown', e => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (this.k[e.code]) return;
      this.k[e.code] = true; this.press(e.code);
    });
    addEventListener('keyup', e => { this.k[e.code] = false; });
    addEventListener('blur', () => { this.k = {}; });
    document.querySelectorAll('.tbtn').forEach(b => {
      const key = b.dataset.key;
      const on = e => { e.preventDefault(); this.k[key] = true; b.classList.add('press'); Sound.resume(); this.press(key); };
      const off = e => { e.preventDefault(); this.k[key] = false; b.classList.remove('press'); };
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off);
      b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
      b.addEventListener('contextmenu', e => e.preventDefault());
    });
    const cv = Game.cv;
    cv.addEventListener('pointerdown', e => { this.sx = e.clientX; this.sy = e.clientY; });
    cv.addEventListener('pointerup', e => {
      if (Game.state !== 'play') return;
      const dx = e.clientX - this.sx;
      if (Math.abs(dx) > 40) Game.player.shift(dx > 0 ? 1 : -1);
      else if (e.pointerType === 'mouse') { const f = e.clientX / Game.W; if (f < 0.33) Game.player.shift(-1); else if (f > 0.67) Game.player.shift(1); }
    });
    cv.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  },
  press(code) {
    if (code === 'KeyP' || code === 'Escape') { Game.state === 'play' ? Game.pause() : Game.state === 'pause' ? Game.resume() : 0; return; }
    if (Game.state !== 'play') return;
    if (code === 'KeyA' || code === 'ArrowLeft' || code === 'TL') { Game.player.shift(-1); this.rep = 0.28; }
    if (code === 'KeyD' || code === 'ArrowRight' || code === 'TR') { Game.player.shift(1); this.rep = 0.28; }
    if (code === 'KeyS' || code === 'ArrowDown' || code === 'TB') if (Game.player.speed > 60) Sound.play('brake');
  },
  update(dt) { // key-hold lane repeat
    const dir = (this.k.KeyA || this.k.ArrowLeft || this.k.TL ? -1 : 0) + (this.k.KeyD || this.k.ArrowRight || this.k.TR ? 1 : 0);
    if (dir && (this.rep -= dt) <= 0) { Game.player.shift(dir); this.rep = 0.17; }
  }
};

/* ---------- Native (Android / Capacitor) hooks ---------- */
const Native = {
  cap: null,
  init() {
    const cap = this.cap = window.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;
    const App = cap.Plugins && cap.Plugins.App;
    if (!App) return;
    document.addEventListener('resume', () => { if (Game.state === 'play') Sound.resume(); });
    // hardware back: race -> pause, pause -> resume, sub-screen -> menu, menu -> exit
    App.addListener('backButton', () => {
      if (Game.state === 'play') Game.pause();
      else if (Game.state === 'pause') Game.resume();
      else if (Game.state !== 'menu') UI.act('menu');
      else App.exitApp();
    });
  }
};

/* ---------- Particles (pooled) ---------- */
const Particles = {
  list: [],
  init() { for (let i = 0; i < 380; i++) this.list.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 2, color: '#fff', glow: false, g: 0 }); },
  emit(x, y, vx, vy, life, size, color, glow, g) {
    for (const p of this.list) if (!p.on) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = p.max = life; p.size = size; p.color = color; p.glow = !!glow; p.g = g || 0; return; }
  },
  burst(x, y, n, spd, life, size, color, glow, g) {
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, s = rnd(0.3, 1) * spd; this.emit(x, y, Math.cos(a) * s, Math.sin(a) * s, rnd(0.5, 1) * life, size, color, glow, g); }
  },
  clear() { for (const p of this.list) p.on = false; },
  update(dt) {
    for (const p of this.list) if (p.on) { p.life -= dt; if (p.life <= 0) { p.on = false; continue; } p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  },
  draw(c) {
    for (let pass = 0; pass < 2; pass++) {
      c.globalCompositeOperation = pass ? 'lighter' : 'source-over';
      for (const p of this.list) if (p.on && p.glow === !!pass) {
        const a = p.life / p.max, s = p.size * (pass ? 0.6 + a : 1);
        c.globalAlpha = a; c.fillStyle = p.color; c.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }
};

/* ---------- Drawing: bike & traffic vehicles (rear view, unit-based) ---------- */
/* Optional photo-real sprites: drop assets/bike0.png, bike1.png, bike2.png (rear view, transparent PNG) and they replace the drawn bike. */
const BikeImg = BIKES.map((b, i) => { const im = new Image(); im.src = `assets/bike${i}.png`; return im; });
function shade(hex, f) { const n = parseInt(hex.slice(1), 16); return `rgb(${clamp((n >> 16) * f, 0, 255) | 0},${clamp((n >> 8 & 255) * f, 0, 255) | 0},${clamp((n & 255) * f, 0, 255) | 0})`; }
function drawBike(c, x, y, s, o) {
  c.save(); c.translate(x, y); c.scale(s, s);
  let g = c.createRadialGradient(0, 0, 0.02, 0, 0, 0.6); g.addColorStop(0, 'rgba(0,0,0,.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.save(); c.scale(1, 0.18); c.fillStyle = g; c.beginPath(); c.arc(0, 0, 0.6, 0, 7); c.fill(); c.restore();
  c.rotate(o.lean || 0);
  const br = o.brake || 0, col = o.color, im = o.img;
  if (im && im.complete && im.naturalWidth) {
    const w = 1.1, h = w * im.naturalHeight / im.naturalWidth; c.drawImage(im, -w / 2, -h, w, h);
  } else {
    // rear tyre with tread + sidewall sheen
    g = c.createLinearGradient(-0.09, 0, 0.09, 0); g.addColorStop(0, '#050507'); g.addColorStop(0.5, '#30333f'); g.addColorStop(1, '#050507');
    c.fillStyle = g; rr(c, -0.09, -0.66, 0.18, 0.66, 0.07); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.08)'; c.lineWidth = 0.012; c.beginPath();
    for (let i = 0; i < 12; i++) { const yy = -0.04 - i * 0.05; c.moveTo(-0.08, yy); c.lineTo(0.08, yy + 0.02); } c.stroke();
    // swingarm, brake caliper, underbelly
    for (const sx of [-1, 1]) { g = c.createLinearGradient(sx * 0.115 - 0.025, 0, sx * 0.115 + 0.025, 0); g.addColorStop(0, '#454b59'); g.addColorStop(0.5, '#b9c0cf'); g.addColorStop(1, '#3a404d'); c.fillStyle = g; rr(c, sx * 0.115 - 0.024, -0.52, 0.048, 0.36, 0.02); c.fill(); }
    c.fillStyle = '#c92a2a'; rr(c, -0.17, -0.36, 0.045, 0.11, 0.012); c.fill();
    c.fillStyle = '#0b0c12'; c.fillRect(-0.15, -0.64, 0.3, 0.1);
    // titanium silencer with heat-blue tip
    g = c.createLinearGradient(0.16, 0, 0.27, 0); g.addColorStop(0, '#565d6e'); g.addColorStop(0.45, '#eef2fb'); g.addColorStop(1, '#434a5a');
    c.fillStyle = g; rr(c, 0.16, -0.6, 0.11, 0.42, 0.05); c.fill();
    c.fillStyle = 'rgba(70,110,255,.5)'; rr(c, 0.16, -0.26, 0.11, 0.1, 0.04); c.fill();
    c.fillStyle = '#08080c'; c.beginPath(); c.ellipse(0.215, -0.19, 0.045, 0.026, 0, 0, 7); c.fill();
    // tail section (curved, lit)
    g = c.createLinearGradient(-0.22, 0, 0.22, 0); g.addColorStop(0, shade(col, 0.5)); g.addColorStop(0.3, shade(col, 1.25)); g.addColorStop(0.7, shade(col, 0.85)); g.addColorStop(1, shade(col, 0.4));
    c.fillStyle = g; c.beginPath(); c.moveTo(-0.2, -0.55); c.quadraticCurveTo(-0.25, -0.78, -0.15, -0.97); c.lineTo(0.15, -0.97); c.quadraticCurveTo(0.25, -0.78, 0.2, -0.55); c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,255,255,.3)'; rr(c, -0.12, -0.92, 0.024, 0.3, 0.012); c.fill();
    c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(0.01, -0.95, 0.002, 0.38);
    c.fillStyle = '#2a0508'; rr(c, -0.14, -0.72, 0.28, 0.075, 0.03); c.fill();         // LED housing
    c.fillStyle = br > 0.2 ? '#ff5040' : '#c41a2c'; rr(c, -0.125, -0.705, 0.25, 0.045, 0.02); c.fill();
    c.fillStyle = '#eceff3'; rr(c, -0.075, -0.6, 0.15, 0.07, 0.01); c.fill();           // plate
    c.fillStyle = '#3a3f4c'; c.fillRect(-0.055, -0.575, 0.11, 0.02);
    // rider: leather suit, hump, sliders, gloves, helmet
    g = c.createLinearGradient(-0.25, 0, 0.25, 0); g.addColorStop(0, '#0c0e15'); g.addColorStop(0.5, '#262b3a'); g.addColorStop(1, '#0c0e15');
    c.fillStyle = g; c.beginPath(); c.moveTo(-0.24, -0.92); c.quadraticCurveTo(-0.29, -1.02, -0.2, -1.1); c.lineTo(0.2, -1.1); c.quadraticCurveTo(0.29, -1.02, 0.24, -0.92); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(-0.17, -1.05); c.lineTo(0.17, -1.05); c.lineTo(0.26, -1.38); c.quadraticCurveTo(0, -1.45, -0.26, -1.38); c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,255,255,.07)'; c.beginPath(); c.ellipse(0, -1.22, 0.12, 0.1, 0, 0, 7); c.fill();
    c.fillStyle = col; c.fillRect(-0.02, -1.4, 0.04, 0.32); c.fillRect(-0.27, -0.97, 0.03, 0.07); c.fillRect(0.24, -0.97, 0.03, 0.07);
    c.strokeStyle = '#1b2030'; c.lineWidth = 0.075; c.lineCap = 'round'; c.lineJoin = 'round';
    for (const sx of [-1, 1]) { c.beginPath(); c.moveTo(sx * 0.26, -1.33); c.lineTo(sx * 0.4, -1.2); c.lineTo(sx * 0.35, -1.04); c.stroke();
      c.fillStyle = '#08090e'; c.beginPath(); c.arc(sx * 0.35, -1.03, 0.045, 0, 7); c.fill();
      c.strokeStyle = '#555c6e'; c.lineWidth = 0.014; c.beginPath(); c.moveTo(sx * 0.34, -1.06); c.lineTo(sx * 0.42, -1.19); c.stroke(); c.strokeStyle = '#1b2030'; c.lineWidth = 0.075;
      c.fillStyle = '#12151f'; c.beginPath(); c.ellipse(sx * 0.43, -1.21, 0.045, 0.03, 0, 0, 7); c.fill(); c.fillStyle = 'rgba(160,200,255,.35)'; c.fillRect(sx * 0.43 - 0.02, -1.225, 0.03, 0.01); }
    g = c.createRadialGradient(-0.05, -1.53, 0.02, 0, -1.48, 0.19); g.addColorStop(0, '#ffffff'); g.addColorStop(0.6, '#c6cddb'); g.addColorStop(1, '#6f7890');
    c.fillStyle = '#141824'; c.fillRect(-0.06, -1.37, 0.12, 0.08);
    c.fillStyle = g; c.beginPath(); c.arc(0, -1.48, 0.16, 0, 7); c.fill();
    c.fillStyle = col; c.fillRect(-0.025, -1.64, 0.05, 0.16); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(-0.1, -1.39, 0.2, 0.03);
  }
  if (br > 0.2 || o.dark > 0.3 || o.flame) {
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = `rgba(255,40,40,${0.22 + br * 0.45})`; c.beginPath(); c.arc(0, -0.68, 0.22 + br * 0.08, 0, 7); c.fill();
    if (o.flame) for (const sx of [-1, 1]) {
      c.fillStyle = o.nitro ? 'rgba(70,170,255,.85)' : 'rgba(255,160,50,.6)'; c.beginPath(); c.arc(sx * 0.17 + (sx > 0 ? 0.045 : 0), -0.16, 0.05 + o.flame * 0.08, 0, 7); c.fill();
    }
    c.globalCompositeOperation = 'source-over';
  }
  c.restore();
}
const TYPES = [
  { k: 'car', w: 0.3, h: 0.55, len: 260, s: [0.3, 0.5], wt: 30 }, { k: 'suv', w: 0.32, h: 0.72, len: 280, s: [0.3, 0.45], wt: 18 },
  { k: 'truck', w: 0.36, h: 1.15, len: 560, s: [0.2, 0.32], wt: 10 }, { k: 'bus', w: 0.36, h: 1.25, len: 620, s: [0.22, 0.34], wt: 8 },
  { k: 'sport', w: 0.3, h: 0.45, len: 240, s: [0.45, 0.62], wt: 14 }, { k: 'bike', w: 0.14, h: 0.7, len: 160, s: [0.4, 0.6], wt: 12 }
];
const CAR_COLORS = ['#d93a4a', '#2f6fe0', '#e8e8ee', '#262c3a', '#f0b429', '#2fbf71', '#8e4de0', '#ff7a2f'];
function drawVehicle(c, car, x, y, w, dark) {
  const t = car.type, h = t.h;
  if (t.k === 'bike') { drawBike(c, x, y, w * 1.9, { color: car.color, brake: 0.3, dark }); return; }
  c.save(); c.translate(x, y); c.scale(w, w);
  c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(0, 0, 0.6, 0.07, 0, 0, 7); c.fill();
  c.fillStyle = '#0d0e14'; c.fillRect(-0.46, -0.13, 0.16, 0.13); c.fillRect(0.3, -0.13, 0.16, 0.13); // tyres
  let ly;
  if (t.k === 'truck' || t.k === 'bus') {
    const bus = t.k === 'bus';
    c.fillStyle = bus ? car.color : '#d6dbe4'; rr(c, -0.5, -h - 0.1, 1, h, 0.04); c.fill();
    if (bus) { c.fillStyle = '#16212e'; rr(c, -0.45, -h + 0.05, 0.9, 0.3, 0.03); c.fill(); }
    else { c.fillStyle = 'rgba(0,0,0,.12)'; for (let i = 1; i < 5; i++) c.fillRect(-0.5 + i * 0.2, -h - 0.1, 0.02, h); c.fillStyle = car.color; c.fillRect(-0.5, -0.45, 1, 0.1); }
    ly = -0.32;
  } else {
    const bh = h * 0.5;
    c.fillStyle = car.color; rr(c, -0.5, -bh - 0.1, 1, bh, 0.08); c.fill();
    c.beginPath(); c.moveTo(-0.42, -bh - 0.1); c.lineTo(-0.32, -h - 0.1); c.lineTo(0.32, -h - 0.1); c.lineTo(0.42, -bh - 0.1); c.fill();
    c.fillStyle = '#121a26'; c.beginPath(); c.moveTo(-0.36, -bh - 0.12); c.lineTo(-0.28, -h - 0.04); c.lineTo(0.28, -h - 0.04); c.lineTo(0.36, -bh - 0.12); c.fill();
    c.fillStyle = 'rgba(255,255,255,.16)'; c.fillRect(-0.5, -bh - 0.1, 1, bh * 0.35);
    c.fillStyle = '#0d0e14'; c.fillRect(-0.5, -0.17, 1, 0.07);
    ly = -bh * 0.75 - 0.1;
  }
  c.fillStyle = '#d02828'; c.fillRect(-0.47, ly, 0.17, 0.06); c.fillRect(0.3, ly, 0.17, 0.06);
  c.fillStyle = '#e8e8d8'; c.fillRect(-0.09, ly + 0.04, 0.18, 0.06);
  if (dark > 0.25) {
    c.globalCompositeOperation = 'lighter'; c.fillStyle = `rgba(255,40,40,${0.3 * dark})`;
    c.beginPath(); c.arc(-0.38, ly + 0.03, 0.2, 0, 7); c.arc(0.38, ly + 0.03, 0.2, 0, 7); c.fill();
    c.globalCompositeOperation = 'source-over';
  }
  c.restore();
}

/* ---------- Road (pseudo-3D segment renderer) ---------- */
const Road = {
  segs: [],
  build() {
    const N = CFG.N; this.segs = [];
    for (let i = 0; i < N;) {
      const len = Math.min(N - i, rnd(40, 90) | 0), c = Math.random() < 0.35 ? 0 : (Math.random() < 0.5 ? -1 : 1) * rnd(0.8, 2.2);
      for (let j = 0; j < len; j++) this.segs.push({ curve: c * Math.sin(Math.PI * j / len), objs: [], cars: [] });
      i += len;
    }
    for (let i = 0; i < N; i++) {
      const s = this.segs[i];
      if (i % 18 === 0) s.objs.push({ t: 'lamp', side: -1, off: 1.2 }, { t: 'lamp', side: 1, off: 1.2 });
      else if (i % 60 === 30) s.objs.push({ t: 'sign', side: 1, off: 1.35 });
      else if (i % 3 === 0 && Math.random() < 0.7) s.objs.push({ t: 'tree', side: Math.random() < 0.5 ? -1 : 1, off: rnd(1.5, 3.2), v: Math.random() });
      if (i % 9 === 4 && Math.random() < 0.8) s.objs.push({ t: 'bld', side: Math.random() < 0.5 ? -1 : 1, off: rnd(3.6, 6.2), v: Math.random(), id: i });
    }
  },
  curveAt(z) { return this.segs[Math.floor(z / CFG.segLen) % CFG.N].curve; },
  quad(c, x1, y1, w1, x2, y2, w2, col) {
    c.fillStyle = col; c.beginPath(); c.moveTo(x1 - w1, y1); c.lineTo(x1 + w1, y1); c.lineTo(x2 + w2, y2); c.lineTo(x2 - w2, y2); c.fill();
  },
  render(c, W, H, camZ, playerX, cs, pct, cars) {
    const E = Env.s, dark = Env.dark, half = W / 2, hor = H * 0.4, L = CFG.segLen, N = CFG.N;
    const base = Math.floor(camZ / L), frac = (camZ % L) / L, camX = playerX * CFG.roadW;
    for (const s of this.segs) s.cars.length = 0;
    for (const car of cars) { const i = Math.floor(car.z / L); if (i >= base && i < base + CFG.draw) this.segs[i % N].cars.push(car); }
    let x = 0, dx = -this.segs[base % N].curve * cs * frac;
    const P = [];
    for (let n = 0; n < CFG.draw; n++) {            // projection pass (near -> far)
      const seg = this.segs[(base + n) % N], z1 = (n - frac) * L, z2 = z1 + L;
      const s1 = CFG.D / Math.max(z1, 1), s2 = CFG.D / z2;
      P.push({ seg, ok: z1 > CFG.D * 2, s1, s2, x1: half + s1 * (-camX - x) * half, x2: half + s2 * (-camX - x - dx) * half,
        y1: hor + s1 * CFG.camH * H / 2, y2: hor + s2 * CFG.camH * H / 2, z1 });
      x += dx; dx += seg.curve * cs;
    }
    const streak = pct > 0.8, rw = CFG.roadW;
    for (let n = CFG.draw - 1; n >= 0; n--) {       // paint far -> near
      const p = P[n], seg = p.seg; if (!p.ok) continue;
      const band = ((base + n) >> 2) & 1, w1 = p.s1 * rw * half, w2 = p.s2 * rw * half, px1 = p.s1 * half, px2 = p.s2 * half;
      c.fillStyle = band ? E.g1 : E.g2; c.fillRect(0, p.y2, W, p.y1 - p.y2 + 1);
      this.quad(c, p.x1, p.y1, w1 * 1.1, p.x2, p.y2, w2 * 1.1, band ? E.ru1 : E.ru2);
      this.quad(c, p.x1, p.y1, w1, p.x2, p.y2, w2, band ? E.r1 : E.r2);
      const lw1 = w1 * 0.012, lw2 = w2 * 0.012;
      for (const e of [-0.94, 0.94]) this.quad(c, p.x1 + e * w1, p.y1, lw1 * 1.4, p.x2 + e * w2, p.y2, lw2 * 1.4, '#e8ecf5');
      if (!band || streak) for (const e of [-0.5, 0, 0.5]) this.quad(c, p.x1 + e * w1, p.y1, lw1, p.x2 + e * w2, p.y2, lw2, e === 0 ? '#ffd23c' : '#f2f5fa');
      // left guard rail
      c.fillStyle = '#a4adbd'; const gl = -1.12 * rw;
      c.beginPath(); c.moveTo(p.x1 + gl * px1, p.y1); c.lineTo(p.x2 + gl * px2, p.y2); c.lineTo(p.x2 + gl * px2, p.y2 - 90 * px2); c.lineTo(p.x1 + gl * px1, p.y1 - 90 * px1); c.fill();
      if ((base + n) % 3 === 0) { c.fillStyle = '#5b6372'; c.fillRect(p.x1 + gl * px1 - 6 * px1, p.y1 - 90 * px1, 12 * px1, 90 * px1); }
      // right concrete barrier
      const gr = 1.12 * rw; c.fillStyle = band ? '#cfd3db' : '#e7852a';
      c.beginPath(); c.moveTo(p.x1 + gr * px1, p.y1); c.lineTo(p.x2 + gr * px2, p.y2); c.lineTo(p.x2 + gr * px2, p.y2 - 120 * px2); c.lineTo(p.x1 + gr * px1, p.y1 - 120 * px1); c.fill();
      for (const o of seg.objs) this.object(c, o, p, px1, dark, E);
      for (const car of seg.cars) {
        const f = (car.z % L) / L, sc = lerp(p.s1, p.s2, f), cx = lerp(p.x1, p.x2, f) + car.x * rw * sc * half, cy = lerp(p.y1, p.y2, f);
        const w = car.w * rw * sc * half; if (w < 2) continue;
        c.globalAlpha = car.fade; drawVehicle(c, car, cx, cy, w, dark); c.globalAlpha = 1;
      }
    }
  },
  object(c, o, p, px, dark, E) {
    const x = p.x1 + o.side * o.off * CFG.roadW * px, y = p.y1;
    if (px * 400 < 1.5 || p.z1 < 250) return;
    if (o.t === 'tree') {
      const hgt = 500 + o.v * 450;
      c.fillStyle = '#4a3322'; c.fillRect(x - 25 * px, y - hgt * 0.5 * px, 50 * px, hgt * 0.5 * px);
      c.fillStyle = E.tree; c.beginPath(); c.arc(x, y - hgt * 0.75 * px, (200 + o.v * 120) * px, 0, 7); c.arc(x + 90 * px, y - hgt * 0.55 * px, 150 * px, 0, 7); c.arc(x - 90 * px, y - hgt * 0.55 * px, 150 * px, 0, 7); c.fill();
    } else if (o.t === 'lamp') {
      const top = y - 1100 * px, hx = x - o.side * 260 * px;
      c.fillStyle = '#8791a5'; c.fillRect(x - 9 * px, top, 18 * px, 1100 * px);
      c.fillRect(Math.min(x, hx), top - 8 * px, Math.abs(x - hx), 16 * px);
      c.fillStyle = dark > 0.2 ? '#fff4c8' : '#c9ced9'; c.fillRect(hx - 40 * px, top - 10 * px, 80 * px, 24 * px);
      if (dark > 0.2) {
        c.globalCompositeOperation = 'lighter'; const g = c.createRadialGradient(hx, top, 0, hx, top, 380 * px);
        g.addColorStop(0, `rgba(255,230,160,${0.55 * dark})`); g.addColorStop(1, 'rgba(255,230,160,0)');
        c.fillStyle = g; c.fillRect(hx - 380 * px, top - 380 * px, 760 * px, 760 * px);
        c.fillStyle = `rgba(255,220,150,${0.14 * dark})`; c.fillRect(hx - 30 * px, y - 200 * px, 60 * px, 200 * px); // road reflection
        c.globalCompositeOperation = 'source-over';
      }
    } else if (o.t === 'sign') {
      c.fillStyle = '#6b7385'; c.fillRect(x - 160 * px, y - 800 * px, 22 * px, 800 * px); c.fillRect(x + 140 * px, y - 800 * px, 22 * px, 800 * px);
      c.fillStyle = '#0c6b3c'; c.fillRect(x - 230 * px, y - 1100 * px, 460 * px, 300 * px);
      c.fillStyle = '#f4f7fb'; c.fillRect(x - 200 * px, y - 1040 * px, 400 * px, 40 * px); c.fillRect(x - 200 * px, y - 960 * px, 260 * px, 30 * px);
    } else if (o.t === 'bld') {
      const bw = 600 + o.v * 700, bh = 1400 + o.v * 3000;
      c.fillStyle = E.bld; c.fillRect(x - bw / 2 * px, y - bh * px, bw * px, bh * px);
      c.fillStyle = dark > 0.3 ? `rgba(255,214,120,${0.25 + dark * 0.5})` : 'rgba(200,230,255,.28)';
      for (let r = 0; r < 6; r++) for (let q = 0; q < 3; q++) if (((o.id * 7 + r * 3 + q) % 5) > 1)
        c.fillRect(x + (-bw / 2 + 70 + q * (bw / 3.1)) * px, y - (bh - 120 - r * (bh / 6.4)) * px, 110 * px, 170 * px);
    }
  }
};

/* ---------- Scene: sky, mountains, skyline, speed effects ---------- */
const Scene = {
  sky(c, W, H, hor, bg) {
    const E = Env.s, d = Env.dark, g = c.createLinearGradient(0, 0, 0, hor);
    g.addColorStop(0, E.top); g.addColorStop(1, E.bot); c.fillStyle = g; c.fillRect(0, 0, W, hor + 2);
    if (d > 0.4) { c.fillStyle = `rgba(255,255,255,${(d - 0.4) * 0.9})`; for (let i = 0; i < 60; i++) c.fillRect((i * 97.3 + bg * 0.05) % W, (i * 53.7) % (hor * 0.8), 1.6, 1.6); }
    const sunY = hor - hor * 0.1 - (1 - Math.abs(d - 0.5) * 2) * hor * 0.0;
    if (d < 0.95) { c.fillStyle = d > 0.2 ? 'rgba(255,170,90,.9)' : 'rgba(255,248,214,.95)'; c.beginPath(); c.arc(W * 0.7, sunY - (1 - d) * hor * 0.35, hor * 0.11, 0, 7); c.fill(); }
    const layer = (amp, f, speed, col, yOff) => {
      c.fillStyle = col; c.beginPath(); c.moveTo(0, hor + 1);
      for (let x = 0; x <= W + 12; x += 12) { const u = (x + bg * speed) * f; c.lineTo(x, hor - yOff - amp * (0.55 + 0.3 * Math.sin(u) + 0.15 * Math.sin(u * 2.7 + 1))); }
      c.lineTo(W, hor + 1); c.fill();
    };
    layer(hor * 0.38, 0.004, 0.2, E.m1, 0); layer(hor * 0.2, 0.007, 0.5, E.m2, 0);
    c.fillStyle = E.bld;                                      // distant skyline
    for (let i = 0; i < 40; i++) { const x = ((i * 83 + bg * 0.9) % (W + 200) + W + 200) % (W + 200) - 100, bw = 18 + (i * 37 % 26), bh = 14 + (i * 53 % 50); c.fillRect(x, hor - bh, bw, bh + 1); }
    const f = c.createLinearGradient(0, hor - 8, 0, hor + H * 0.1);   // horizon haze hides pop-in
    f.addColorStop(0, E.bot); f.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = f; c.globalAlpha = 0.85; c.fillRect(0, hor - 8, W, H * 0.1); c.globalAlpha = 1;
  },
  speedFx(c, W, H, hor, pct, nitro, t) {
    const a = clamp((pct - 0.45) / 0.55, 0, 1) + (nitro ? 0.4 : 0); if (a < 0.05) return;
    const cx = W / 2, cy = hor + H * 0.1, R = Math.hypot(W, H);
    c.strokeStyle = nitro ? 'rgba(130,200,255,.5)' : 'rgba(255,255,255,.28)'; c.lineWidth = 1.5; c.beginPath();
    for (let i = 0; i < 34; i++) {
      const ang = i * 2.399 + 0.3, r = (i * 0.137 + t * (1 + a * 2.5)) % 1, r0 = (0.25 + r * 0.7) * R * 0.6, r1 = r0 + R * 0.1 * a * (0.4 + r);
      c.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0 * 0.8); c.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1 * 0.8);
    }
    c.globalAlpha = Math.min(1, a); c.stroke(); c.globalAlpha = 1;
  }
};

/* ---------- Player ---------- */
class Player {
  constructor() {
    this.stats = bikeStats(); this.z0 = this.z = 5000; this.lane = 1; this.x = LANES[1];
    this.speed = 80; this.nitro = 35; this.nitroOn = false; this.wasNitro = false; this.crash = 0; this.inv = 0;
    this.lean = 0; this.lives = 3; this.top = 0; this.near = 0; this.passes = 0; this.cashAcc = 0; this.braking = false; this.wreck = 0;
  }
  get dist() { return (this.z - this.z0) / 100; }
  shift(d) { this.lane = clamp(this.lane + d, 0, 3); }
  update(dt) {
    const s = this.stats, gas = Input.gas && this.crash <= 0, br = !!Input.brake;
    this.braking = br;
    this.nitroOn = !!Input.nitro && this.nitro > 1 && this.crash <= 0 && this.speed > 20 && this.lives > 0;
    if (this.nitroOn) {
      this.nitro = Math.max(0, this.nitro - 100 / s.nitroDur * dt);
      if (!this.wasNitro) { Sound.play('nitro'); Missions.add('nitro', 1); }
    }
    this.wasNitro = this.nitroOn;
    const cap = s.maxSpeed + (this.nitroOn ? 45 : 0);
    if (br) this.speed -= 85 * dt;
    else if (this.nitroOn) this.speed += s.accel * 3 * dt;
    else if (gas) this.speed += s.accel * (1 - this.speed / (s.maxSpeed * 1.1) * 0.55) * dt;
    else this.speed -= 12 * dt;
    if (this.speed > cap) this.speed = Math.max(cap, this.speed - 60 * dt);
    this.speed = Math.max(0, this.speed);
    this.crash = Math.max(0, this.crash - dt); this.inv = Math.max(0, this.inv - dt);
    if (this.lives <= 0) this.speed = Math.max(0, this.speed - 90 * dt);
    this.nitro = Math.min(100, this.nitro + dt * (1.0 + (this.speed > s.maxSpeed * 0.85 ? 2.2 : 0)));  // passive charge: distance + high speed
    const tx = LANES[this.lane];
    this.x += (tx - this.x) * Math.min(1, s.turn * dt);
    const curve = Road.curveAt(this.z);
    this.lean = lerp(this.lean, clamp((tx - this.x) * 1.3 + curve * 0.02 * (this.speed / 200), -0.45, 0.45), Math.min(1, 10 * dt));
    this.z += this.speed * CFG.unit * dt;
    this.top = Math.max(this.top, this.speed);
  }
}

/* ---------- Traffic & collisions ---------- */
const Traffic = {
  cars: [], timer: 0,
  clear() { this.cars.length = 0; this.timer = 0; },
  spawn(zMin, zMax) {
    let r = Math.random() * 92, T = TYPES[0];
    for (const t of TYPES) { if ((r -= t.wt) <= 0) { T = t; break; } }
    const lane = Math.random() * 4 | 0, z = rnd(zMin, zMax), lanes = new Set([lane]);
    for (const c of this.cars) {
      const d = Math.abs(c.z - z);
      if (c.lane === lane && d < (c.type.len + T.len) / 2 + 1000) return;
      if (d < 1800) lanes.add(c.lane);
    }
    if (lanes.size > 3) return;                    // never wall off all four lanes
    this.cars.push({ type: T, w: T.w, len: T.len, lane, x: LANES[lane], z, speed: rnd(T.s[0], T.s[1]) * 290,
      color: pick(CAR_COLORS), hit: false, passed: false, minGap: 9, prevDz: 1, fade: 1 });
  },
  update(dt, p, diff) {
    const target = Math.round(8 + diff * 12);
    this.timer -= dt;
    if (this.timer <= 0 && this.cars.length < target) { this.spawn(p.z + (CFG.draw - 8) * CFG.segLen, p.z + (CFG.draw - 2) * CFG.segLen); this.timer = lerp(0.55, 0.25, diff); }
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (c.hit) { c.fade -= dt * 1.2; c.x += c.drift * dt; if (c.fade <= 0) { this.cars.splice(i, 1); continue; } }
      else for (const o of this.cars) if (o !== c && o.lane === c.lane && !o.hit && o.z > c.z && o.z - c.z < 1500 && c.speed > o.speed) c.speed = o.speed; // AI: follow the car ahead
      c.z += c.speed * CFG.unit * dt;
      if (c.z < p.z - 4000 || c.z > p.z + (CFG.draw + 20) * CFG.segLen) this.cars.splice(i, 1);
    }
  },
  collide(g, p) {
    for (const c of this.cars) {
      if (c.hit) continue;
      const dz = c.z - p.z, ex = c.len / 2 + 100, gap = Math.abs(c.x - p.x) - (c.w / 2 + 0.06);
      if (Math.abs(dz) < ex) {
        if (gap < 0 && p.inv <= 0 && p.lives > 0) { g.crash(c); continue; }
        c.minGap = Math.min(c.minGap, gap);
      }
      if (c.prevDz > 0 && dz <= 0 && !c.passed) {          // we just passed this vehicle
        c.passed = true; p.passes++; Missions.add('pass', 1);
        if (p.lives > 0 && c.minGap > 0 && c.minGap < 0.17) g.nearMiss(c.minGap, c);
        else g.earn(5);
      }
      c.prevDz = dz;
    }
  }
};

/* ---------- Missions ---------- */
const MISSIONS = [
  { id: 'dist', t: 'Travel 2,000 meters', goal: 2000, reward: 500 }, { id: 'near', t: 'Perform 10 near misses', goal: 10, reward: 750 },
  { id: 'speed', t: 'Reach 250 KM/H', goal: 250, reward: 1000, max: true }, { id: 'nitro', t: 'Use nitro 10 times', goal: 10, reward: 500 },
  { id: 'pass', t: 'Overtake 50 vehicles', goal: 50, reward: 600 }
];
const Missions = {
  add(id, v) { Storage.data.missions[id] += v; this.check(); },
  best(id, v) { const m = Storage.data.missions; if (v > m[id]) { m[id] = v; this.check(); } },
  check() {
    const m = Storage.data.missions;
    for (const d of MISSIONS) if (!m.done[d.id] && m[d.id] >= d.goal) {         // reward paid exactly once
      m.done[d.id] = true; Storage.data.cash += d.reward;
      if (Game.run) Game.run.cash += d.reward;
      Game.text('MISSION COMPLETE', '#7dff9b', 26, 0); Game.text('+$' + fmt(d.reward), '#7dff9b', 24, 1); Sound.play('cash'); Storage.save();
    }
  }
};

/* ---------- UI (menus, garage, settings) ---------- */
const UI = {
  gi: 0,
  show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('show', s.id === id)); },
  hud(on) { $('btnPause').classList.toggle('hidden', !on); $('touch').classList.toggle('hidden', !(on && Input.auto)); },
  menu() { const d = Storage.data; $('mCash').textContent = '$' + fmt(d.cash); $('mBest').textContent = fmt(d.bestDist) + ' m'; this.show('menu'); },
  settings() { const d = Storage.data; $('setSound').textContent = 'SOUND: ' + (d.sound ? 'ON' : 'OFF'); $('setMusic').textContent = 'MUSIC: ' + (d.music ? 'ON' : 'OFF'); this.show('settings'); },
  missions() {
    const m = Storage.data.missions;
    $('mList').innerHTML = MISSIONS.map(d => {
      const v = Math.min(m[d.id], d.goal), done = m.done[d.id];
      return `<div class="mission ${done ? 'done' : ''}"><div><span>${d.t}</span><b>${done ? 'COMPLETE' : '$' + fmt(d.reward)}</b></div><div class="bar"><i style="width:${v / d.goal * 100}%"></i></div></div>`;
    }).join(''); this.show('missions');
  },
  garage(first) {
    if (first) this.gi = Storage.data.bike;
    const d = Storage.data, b = BIKES[this.gi], u = d.upg[this.gi], own = d.unlocked[this.gi], st = bikeStats(this.gi);
    $('gCash').textContent = '$' + fmt(d.cash); $('gName').textContent = b.name;
    const stats = [['Speed', st.maxSpeed, 300, st.maxSpeed.toFixed(0)], ['Handling', b.handling + u[2] * 3, 100], ['Acceleration', b.accel + u[1] * 3, 100], ['Nitro', b.nitro + u[3] * 4, 100]];
    $('gStats').innerHTML = stats.map(s => `<div class="stat"><span>${s[0]}</span><div class="bar"><i style="width:${Math.min(100, s[1] / s[2] * 100)}%"></i></div><b>${Math.round(s[1])}</b></div>`).join('');
    const a = $('gAction');
    a.textContent = own ? (d.bike === this.gi ? 'SELECTED' : 'SELECT BIKE') : 'UNLOCK  $' + fmt(b.price);
    a.classList.toggle('off', own && d.bike === this.gi);
    $('gUpg').innerHTML = UPG_NAMES.map((n, i) => {
      const lv = u[i], max = lv >= MAX_LV, cost = upgCost(lv);
      return `<button class="btn upg ${!own || max || d.cash < cost ? 'off' : ''}" data-act="upg${i}"><span>${n} <span class="pips">${'■'.repeat(lv)}${'□'.repeat(MAX_LV - lv)}</span></span><span>${!own ? 'LOCKED' : max ? 'MAX' : '$' + fmt(cost)}</span></button>`;
    }).join(''); this.show('garage');
  },
  drawGarage(t) {
    const cv = $('garageCanvas'); if (!cv.offsetParent) return;
    const dpr = Math.min(devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const b = BIKES[this.gi], g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#0a0e26'); g.addColorStop(1, '#1b1040'); c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(34,225,255,.25)'; c.lineWidth = 1; c.beginPath();
    for (let i = -8; i <= 8; i++) { c.moveTo(w / 2 + i * 8, h * 0.62); c.lineTo(w / 2 + i * 70, h); }
    for (let i = 0; i < 6; i++) { const y = h * 0.62 + Math.pow(i / 5, 2) * h * 0.38; c.moveTo(0, y); c.lineTo(w, y); } c.stroke();
    const glow = c.createRadialGradient(w / 2, h * 0.88, 0, w / 2, h * 0.88, w * 0.35); glow.addColorStop(0, b.color + '88'); glow.addColorStop(1, 'transparent');
    c.fillStyle = glow; c.fillRect(0, 0, w, h);
    if (!Storage.data.unlocked[this.gi]) c.globalAlpha = 0.55;
    drawBike(c, w / 2, h * 0.88, h * 0.5, { img: BikeImg[this.gi], color: b.color, lean: Math.sin(t / 700) * 0.12, brake: 0.5, dark: 1, flame: 0.4 + 0.2 * Math.sin(t / 90) });
    c.globalAlpha = 1;
  },
  act(a) {
    const d = Storage.data;
    Sound.resume(); Sound.play('click');
    if (a.startsWith('upg')) {
      const i = +a[3], u = d.upg[this.gi], cost = upgCost(u[i]);
      if (!d.unlocked[this.gi] || u[i] >= MAX_LV || d.cash < cost) return Sound.play('deny');
      d.cash -= cost; u[i]++; Storage.save(); Sound.play('upgrade'); return this.garage();
    }
    switch (a) {
      case 'play': case 'restart': Game.start(); break;
      case 'menu': Game.state = 'menu'; this.hud(false); this.menu(); break;
      case 'garage': Game.state = 'menu'; this.hud(false); this.garage(true); break;
      case 'missions': this.missions(); break;
      case 'settings': this.settings(); break;
      case 'pause': if (Game.state === 'play') Game.pause(); break;
      case 'resume': Game.resume(); break;
      case 'prevBike': this.gi = (this.gi + 2) % 3; this.garage(); break;
      case 'nextBike': this.gi = (this.gi + 1) % 3; this.garage(); break;
      case 'bikeAction': {
        const b = BIKES[this.gi];
        if (d.unlocked[this.gi]) { d.bike = this.gi; Sound.play('select'); }
        else if (d.cash >= b.price) { d.cash -= b.price; d.unlocked[this.gi] = true; d.bike = this.gi; Sound.play('upgrade'); }
        else Sound.play('deny');
        Storage.save(); this.garage(); break;
      }
      case 'toggleSound': d.sound = !d.sound; Storage.save(); this.settings(); break;
      case 'toggleMusic': d.music = !d.music; Storage.save(); Sound.syncMusic(); this.settings(); break;
      case 'reset': this.show('confirm'); break;
      case 'confirmReset': Storage.reset(); Game.player = new Player(); this.menu(); break;
    }
  }
};

/* ---------- Game (state, loop, rendering, HUD) ---------- */
const Game = {
  cv: null, ctx: null, W: 0, H: 0, dpr: 1, state: 'menu', player: null, run: null, texts: [], shake: 0, flash: 0, zoom: 0, bg: 0, last: 0, t: 0, endTimer: 0, saveT: 0, ambient: 0,
  init() {
    this.cv = $('game'); this.ctx = this.cv.getContext('2d', { alpha: false });
    Storage.load(); Particles.init(); Road.build(); Input.init(); Native.init();
    this.player = new Player();
    addEventListener('resize', () => this.resize()); this.resize();
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'play') this.pause(); Storage.save(); });
    addEventListener('beforeunload', () => Storage.save());
    $('ui').addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) UI.act(b.dataset.act); });
    UI.menu(); requestAnimationFrame(n => { this.last = n; this.loop(n); });
  },
  resize() {
    this.dpr = Math.min(devicePixelRatio || 1, 2); this.W = innerWidth; this.H = innerHeight;
    this.cv.width = this.W * this.dpr; this.cv.height = this.H * this.dpr;
  },
  start() {
    this.player = new Player(); Traffic.clear(); Particles.clear(); this.texts.length = 0; this.run = { cash: 0 };
    this.shake = this.flash = this.endTimer = 0;
    for (let i = 0; i < 9; i++) Traffic.spawn(this.player.z + 3500, this.player.z + 20000);
    this.state = 'play'; UI.show(null); UI.hud(true);
  },
  pause() { this.state = 'pause'; Sound.engine(0, false, false); UI.show('pause'); },
  resume() { this.state = 'play'; UI.show(null); },
  text(s, color, size, row) { this.texts.push({ s, color, size, life: 1.4, row: row || 0, y: 0 }); if (this.texts.length > 8) this.texts.shift(); },
  earn(n) { Storage.data.cash += n; this.run.cash += n; },
  crash(car) {
    const p = this.player; Sound.play('crash');
    p.speed *= 0.35; p.crash = 1.2; p.inv = 1.8; p.lives--; this.shake = 1; this.flash = 1;
    car.hit = true; car.drift = (car.x >= p.x ? 1 : -1) * 0.9; car.speed *= 0.5;
    Particles.burst(this.W / 2, this.H * 0.82, 40, 380, 0.9, 5, '#ffb347', true, 500);
    Particles.burst(this.W / 2, this.H * 0.82, 14, 200, 0.7, 6, '#888', false, 200);
    this.text(p.lives > 0 ? 'CRASH!' : 'WRECKED', '#ff5566', 34, 0);
    if (p.lives <= 0) this.endTimer = 1.4;
  },
  nearMiss(gap, car) {
    const p = this.player, tier = gap < 0.04 ? 2 : gap < 0.09 ? 1 : 0, cash = [25, 50, 100][tier], nit = [12, 22, 35][tier];
    p.near++; Missions.add('near', 1); this.earn(cash); p.nitro = Math.min(100, p.nitro + nit);
    this.shake = Math.max(this.shake, 0.25 + tier * 0.15);
    this.text(['NEAR MISS!', 'CLOSE CALL!', 'EXTREME NEAR MISS!'][tier], '#ffe14a', 28, 0); this.text('+$' + cash + '  + NITRO', '#7dff9b', 20, 1);
    Sound.play('near'); Sound.play('cash');
    Particles.burst(this.W / 2 + (car.x > p.x ? 1 : -1) * this.W * 0.1, this.H * 0.75, 18 + tier * 8, 260, 0.6, 4, '#ffe14a', true, 0);
  },
  loop(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now; this.t += dt;
    if (this.state === 'play') this.update(dt); else if (this.state === 'menu') this.attract(dt);
    this.render(dt);
    if (this.state === 'menu') UI.drawGarage(now);
    requestAnimationFrame(n => this.loop(n));
  },
  attract(dt) {   // idle scenery behind menus
    const p = this.player; Env.update(dt); p.speed = 130; p.z += p.speed * CFG.unit * dt; p.lean = Math.sin(this.t * 0.6) * 0.08; p.x = Math.sin(this.t * 0.4) * 0.15;
    this.bg -= Road.curveAt(p.z) * dt * 40; Sound.engine(0.2, false, false); Traffic.cars.length = 0;
  },
  update(dt) {
    const p = this.player, d = Storage.data;
    Input.update(dt); Env.update(dt); p.update(dt);
    const diff = clamp(p.dist / 8000, 0, 1);
    Traffic.update(dt, p, diff); Traffic.collide(this, p);
    // rewards: distance, high-speed driving
    p.cashAcc += (p.speed * CFG.unit * dt / 100) * 0.05 + (p.speed > p.stats.maxSpeed * 0.85 ? dt * 2 : 0);
    if (p.cashAcc >= 1) { const n = Math.floor(p.cashAcc); p.cashAcc -= n; this.earn(n); }
    Missions.add('dist', p.speed * CFG.unit * dt / 100); Missions.best('speed', Math.floor(p.top));
    this.bg -= Road.curveAt(p.z) * (0.8 + diff) * (p.speed / 290) * dt * 60;
    // particles: exhaust, nitro flames, road dust
    const W = this.W, H = this.H, bx = W / 2, by = H * 0.9, u = Math.max(W * 0.095, 24);
    if (p.nitroOn) for (let i = 0; i < 3; i++) Particles.emit(bx + (Math.random() < 0.5 ? -1 : 1) * 0.17 * u, by - 0.15 * u, rnd(-40, 40), rnd(120, 320), 0.35, rnd(4, 9), Math.random() < 0.5 ? '#5ab4ff' : '#c8f0ff', true);
    else if (Input.gas && p.speed < p.stats.maxSpeed * 0.9 && Math.random() < 0.5) Particles.emit(bx + (Math.random() < 0.5 ? -1 : 1) * 0.17 * u, by - 0.15 * u, rnd(-20, 20), rnd(60, 140), 0.25, rnd(2, 4), '#ffb04a', true);
    if (p.braking && p.speed > 40 && Math.random() < 0.6) Particles.emit(bx + rnd(-0.1, 0.1) * u, by, rnd(-60, 60), rnd(-30, 20), 0.5, rnd(4, 8), 'rgba(200,200,200,.5)', false);
    if (p.speed > 100 && Math.random() < 0.3) Particles.emit(bx + rnd(-0.6, 0.6) * W * 0.4, H * 0.55, 0, rnd(200, 500), 0.4, 2, 'rgba(255,255,255,.35)', false);
    Particles.update(dt);
    Sound.engine(p.speed / 300, p.nitroOn, true);
    this.shake = Math.max(0, this.shake - dt * 2.2) + (p.nitroOn ? 0.0 : 0); if (p.nitroOn) this.shake = Math.max(this.shake, 0.18);
    if (p.speed > p.stats.maxSpeed * 0.95) this.shake = Math.max(this.shake, 0.08);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    for (const t of this.texts) t.life -= dt; this.texts = this.texts.filter(t => t.life > 0);
    if ((this.saveT += dt) > 5) { this.saveT = 0; Storage.save(); }
    if (this.endTimer > 0 && (this.endTimer -= dt) <= 0) this.finish();
  },
  finish() {
    const p = this.player, d = Storage.data; this.state = 'over';
    d.bestDist = Math.max(d.bestDist, Math.floor(p.dist)); d.bestSpeed = Math.max(d.bestSpeed, Math.floor(p.top)); Storage.save();
    Sound.engine(0, false, false); UI.hud(false);
    $('rDist').textContent = fmt(p.dist) + ' m'; $('rTop').textContent = Math.floor(p.top) + ' KM/H'; $('rNear').textContent = p.near;
    $('rCash').textContent = '+$' + fmt(this.run.cash); $('rTotal').textContent = '$' + fmt(d.cash); UI.show('results');
  },
  render(dt) {
    const c = this.ctx, W = this.W, H = this.H, p = this.player, pct = clamp(p.speed / 300, 0, 1), hor = H * 0.4, playing = this.state !== 'menu';
    if (!Env.s.top) Env.update(0);
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.save();
    const sh = this.shake * W * 0.012; if (sh > 0.1) c.translate((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh);
    this.zoom = lerp(this.zoom, p.nitroOn ? 1 : 0, 0.12);
    if (this.zoom > 0.01) { const z = 1 + 0.045 * this.zoom; c.translate(W / 2, H / 2); c.scale(z, z); c.translate(-W / 2, -H / 2); }
    Scene.sky(c, W, H, hor, this.bg);
    const cs = 0.9 + clamp(p.dist / 8000, 0, 1) * 1.1;
    Road.render(c, W, H, p.z - CFG.playerZ, p.x, cs, pct, playing ? Traffic.cars : []);
    if (Env.dark > 0.25) {   // headlight beam
      const g = c.createLinearGradient(0, H * 0.9, 0, hor + H * 0.1); g.addColorStop(0, `rgba(255,244,200,${0.3 * Env.dark})`); g.addColorStop(1, 'rgba(255,244,200,0)');
      c.fillStyle = g; c.beginPath(); c.moveTo(W / 2 - W * 0.02, H * 0.78); c.lineTo(W / 2 + W * 0.02, H * 0.78); c.lineTo(W / 2 + W * 0.1, hor + H * 0.1); c.lineTo(W / 2 - W * 0.1, hor + H * 0.1); c.fill();
    }
    Scene.speedFx(c, W, H, hor, pct, p.nitroOn, this.t);
    const u = Math.max(W * 0.095, 24), blink = p.inv > 0 && ((this.t * 14) | 0) % 2;
    if (!blink || this.state === 'pause') drawBike(c, W / 2, H * 0.9, u, { img: BikeImg[Storage.data.bike], color: BIKES[Storage.data.bike].color, lean: p.lean, brake: p.braking ? 1 : 0, dark: Env.dark,
      flame: p.nitroOn ? 1 : (Input.gas && this.state === 'play' ? 0.4 : 0), nitro: p.nitroOn });
    Particles.draw(c);
    c.restore();
    // screen overlays
    if (pct > 0.5 || this.flash > 0 || p.nitroOn) {
      const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) / 2);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, this.flash > 0 ? `rgba(255,30,50,${0.55 * this.flash})` : p.nitroOn ? 'rgba(20,90,200,.45)' : `rgba(0,0,10,${(pct - 0.5) * 0.7})`);
      c.fillStyle = g; c.fillRect(0, 0, W, H);
    }
    if (this.state === 'play' || this.state === 'pause' || this.state === 'over') this.hud(c, W, H, p);
  },
  panel(c, x, y, w, h) { rr(c, x, y, w, h, 12); c.fillStyle = 'rgba(10,14,34,.58)'; c.fill(); c.strokeStyle = 'rgba(120,200,255,.35)'; c.lineWidth = 1; c.stroke(); },
  hud(c, W, H, p) {
    const u = clamp(Math.min(W / 420, H / 520), 0.85, 1.7), m = 10 * u, pw = 124 * u, d = Storage.data;
    c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    const top = Math.max(m, 8);
    this.panel(c, m, top, pw, 66 * u);                                   // distance + cash
    c.fillStyle = '#9fb4d6'; c.font = `700 ${10 * u}px ${FONT}`; c.fillText('DISTANCE', m + 10 * u, top + 16 * u);
    c.fillStyle = '#fff'; c.font = `italic 800 ${17 * u}px ${FONT}`; c.fillText(fmt(p.dist) + ' m', m + 10 * u, top + 34 * u);
    c.fillStyle = '#9fb4d6'; c.font = `700 ${10 * u}px ${FONT}`; c.fillText('CASH', m + 10 * u, top + 48 * u);
    c.fillStyle = '#7dff9b'; c.font = `italic 800 ${15 * u}px ${FONT}`; c.fillText('$' + fmt(d.cash), m + 10 * u, top + 62 * u);
    this.panel(c, m, top + 72 * u, pw, 30 * u);                           // nitro bar
    c.fillStyle = p.nitroOn ? '#7fd0ff' : '#22e1ff'; c.font = `700 ${10 * u}px ${FONT}`; c.fillText('NITRO', m + 8 * u, top + 91 * u);
    const bx = m + 46 * u, bw = pw - 54 * u, segs = 10;
    for (let i = 0; i < segs; i++) { c.fillStyle = p.nitro / 10 > i + 0.5 ? (p.nitroOn ? '#9be0ff' : '#22e1ff') : 'rgba(255,255,255,.14)'; c.fillRect(bx + i * bw / segs, top + 80 * u, bw / segs - 2 * u, 14 * u); }
    // speedometer (animated arc)
    const cx = W / 2, cy = top + 46 * u, r = 42 * u, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, f = clamp(p.speed / 320, 0, 1);
    c.beginPath(); c.arc(cx, cy, r + 8 * u, 0, 7); c.fillStyle = 'rgba(10,14,34,.55)'; c.fill();
    c.lineCap = 'round'; c.lineWidth = 7 * u; c.strokeStyle = 'rgba(255,255,255,.14)'; c.beginPath(); c.arc(cx, cy, r, a0, a1); c.stroke();
    const g = c.createLinearGradient(cx - r, cy, cx + r, cy); g.addColorStop(0, '#22e1ff'); g.addColorStop(1, p.nitroOn ? '#9be0ff' : '#ff3b8d');
    c.strokeStyle = g; c.beginPath(); c.arc(cx, cy, r, a0, a0 + (a1 - a0) * f); c.stroke();
    c.textAlign = 'center'; c.fillStyle = '#fff'; c.font = `italic 800 ${22 * u}px ${FONT}`; c.fillText(Math.round(p.speed), cx, cy + 6 * u);
    c.fillStyle = '#9fb4d6'; c.font = `700 ${9 * u}px ${FONT}`; c.fillText('KM/H', cx, cy + 20 * u);
    for (let i = 0; i < 3; i++) { c.fillStyle = i < p.lives ? '#ff3b6b' : 'rgba(255,255,255,.2)'; c.beginPath(); c.arc(cx + (i - 1) * 14 * u, cy + r + 18 * u, 4.5 * u, 0, 7); c.fill(); }
    // floating texts
    c.textAlign = 'center';
    for (const t of this.texts) {
      const a = clamp(t.life / 0.5, 0, 1), y = H * 0.5 + t.row * 36 * u - (1.4 - t.life) * 30;
      c.globalAlpha = a; c.font = `italic 800 ${t.size * u * 0.9}px ${FONT}`; c.lineWidth = 4; c.strokeStyle = 'rgba(0,0,0,.6)'; c.strokeText(t.s, W / 2, y); c.fillStyle = t.color; c.fillText(t.s, W / 2, y);
    }
    c.globalAlpha = 1; c.textAlign = 'left';
  }
};

Game.init();
