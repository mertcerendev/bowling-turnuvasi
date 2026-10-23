import {
  simulate, freshRack, progress, frameScores, frameMarks, countPins, cleanInput,
  LANE_HALF, WALL_X, BALL_R, PIN_R, PIN_H, HEAD_Z, DECK_Z, PIT_Z, NOISE_Z, DT, REC_EVERY,
  MAX_X, MAX_AIM, PIN_SPOTS, UP, OUT,
} from './bowling.js';
import { DEADLINE, WINNERS, isOver } from './config.js';

const $ = (id) => document.getElementById(id);
const FRAME_DT = DT * REC_EVERY;
// Göstergelerin bir uçtan diğer uca gitme süresi (sn). Kısaldıkça oyun zorlaşır.
const AIM_T = 0.8, POWER_T = 0.8, SPIN_T = 0.9;
const CAM_START = -2.4, CAM_END = HEAD_Z - 4.6;
const keyOf = (name) => name.toLocaleLowerCase('tr-TR');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pad = (n) => String(n).padStart(2, '0');

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* gizli sekme vb. */ } },
};

async function api(path, body) {
  let res;
  try {
    res = await fetch('/api/' + path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { cache: 'no-store' });
  } catch {
    throw new Error('İnternet bağlantısı yok gibi görünüyor');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Sunucuya ulaşılamadı'), { status: res.status });
  return data;
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4500);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---------- Ana sayfa ----------

let board = [];
let me = store.get('name') || '';
$('name').value = me;

const deadlineText = new Date(Date.parse(DEADLINE) - 60000).toLocaleString('tr-TR', {
  weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
});

function renderHome() {
  const over = isOver();
  $('startForm').hidden = over;
  $('winners').hidden = !over;
  if (over) {
    const top = board.slice(0, WINNERS).map((p) => `${p.name} (${p.best})`);
    $('winners').textContent = top.length ? `🏆 Kazananlar: ${top.join(' ve ')}` : 'Turnuva bitti.';
  }
  const ol = $('board');
  ol.replaceChildren();
  if (!board.length) ol.append(el('li', 'empty', 'Henüz skor yok. İlk sen ol!'));
  board.forEach((p, i) => {
    const li = el('li', i < WINNERS ? 'win' : '');
    if (me && keyOf(p.name) === keyOf(me)) li.classList.add('me');
    li.append(el('span', 'rk', i < WINNERS && i < 2 ? ['🥇', '🥈'][i] : i + 1), el('span', 'nm', p.name), el('span', 'sc', p.best));
    ol.append(li);
    if (i === WINNERS - 1 && board.length > WINNERS) ol.append(el('li', 'cut', '▲ Kart kazananlar ▲'));
  });
}

async function loadBoard() {
  try {
    board = (await api('leaderboard')).board;
  } catch (err) {
    toast(err.message);
  }
  renderHome();
}

function tick() {
  const left = Math.max(0, Math.floor((Date.parse(DEADLINE) - Date.now()) / 1000));
  if (!left) {
    $('countdown').textContent = 'Turnuva bitti 🏁';
    if (!$('startForm').hidden) renderHome();
    return;
  }
  const d = Math.floor(left / 86400), h = Math.floor(left / 3600) % 24, m = Math.floor(left / 60) % 60;
  $('countdown').textContent = `Son: ${deadlineText} · kalan ${d ? d + ' gün ' : ''}${pad(h)}:${pad(m)}:${pad(left % 60)}`;
}

$('startForm').addEventListener('submit', (e) => {
  e.preventDefault();
  startGame($('name').value);
});
$('refreshBtn').addEventListener('click', loadBoard);

// ---------- Oyun akışı ----------

let game = null; // { id, rolls, rack, x, last }
let phase = 'idle'; // aim → power → spin → roll → result → (aim | over)
let phaseT0 = 0, aimLock = 0, powerLock = 0;
let anim = null; // { frames, dirs, pos, hold, res }

const tri = (t) => { const p = t % 2; return p < 1 ? p : 2 - p; };
const aimAt = (now) => (tri((now - phaseT0) / 1000 / AIM_T + 0.5) * 2 - 1) * MAX_AIM;
const powerAt = (now) => tri((now - phaseT0) / 1000 / POWER_T);
const spinAt = (now) => tri((now - phaseT0) / 1000 / SPIN_T + 0.5) * 2 - 1;

function showScreen(name) {
  $('home').hidden = name !== 'home';
  $('game').hidden = name !== 'game';
  $('over').hidden = true;
  if (name === 'game') {
    resize();
    if (!looping) {
      looping = true;
      lastT = performance.now();
      requestAnimationFrame(loop);
    }
  }
}

async function startGame(name) {
  $('playBtn').disabled = $('againBtn').disabled = true;
  try {
    const res = await api('start', { name });
    me = res.name;
    store.set('name', me);
    game = { id: res.id, rolls: [], rack: freshRack(), x: clamp(Number(store.get('ballX')) || 0, -MAX_X, MAX_X), last: null };
    anim = null;
    showScreen('game');
    document.activeElement?.blur();
    renderFrames();
    setPhase('aim');
  } catch (err) {
    toast(err.message);
  } finally {
    $('playBtn').disabled = $('againBtn').disabled = false;
  }
}

function exitGame(reload = true) {
  game = null;
  anim = null;
  phase = 'idle';
  showScreen('home');
  if (reload) loadBoard();
  else renderHome();
}

function setPhase(p, now = performance.now()) {
  phase = p;
  phaseT0 = now;
  const prog = progress(game.rolls);
  const hints = {
    aim: `${prog.frame + 1}. çerçeve, ${prog.ball + 1}. atış · Sürükle: yer · Dokun: yön`,
    power: 'Gücü seçmek için dokun',
    spin: 'Falsoyu seç — dokununca atış!',
  };
  $('hint').textContent = hints[p] ?? '';
  const aiming = p in hints;
  $('powerMeter').hidden = $('spinMeter').hidden = !aiming;
  $('powerMeter').classList.toggle('active', p === 'power');
  $('spinMeter').classList.toggle('active', p === 'spin');
}

function tap(now) {
  if (phase === 'aim') {
    aimLock = aimAt(now);
    setPhase('power', now);
  } else if (phase === 'power') {
    powerLock = powerAt(now);
    setPhase('spin', now);
  } else if (phase === 'spin') {
    throwBall(cleanInput({ x: game.x, aim: aimLock, power: powerLock, spin: spinAt(now) }));
  }
}

function moveBall(x) {
  game.x = clamp(x, -MAX_X, MAX_X);
  store.set('ballX', game.x.toFixed(3));
}

async function sendThrow(n, input) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api('throw', { id: game.id, n, input });
    } catch (err) {
      if (err.status || attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
}

// Top hemen yuvarlanmaya başlar; sunucunun cevabı (gizli sapma + kesin sonuç) gelince
// aynı atış onunla yeniden hesaplanır. Cevap gecikirse top sapma noktasından önce yavaşlayıp bekler.
async function throwBall(input) {
  const n = game.rolls.length;
  setPhase('roll');
  const prov = simulate(game.rack, input, 0, true);
  const a = (anim = { frames: prov.frames, dirs: prov.dirs, pos: 0, hold: prov.frames.findIndex((f) => f[1] >= NOISE_Z) - 1, res: null });
  try {
    const res = await sendThrow(n, input);
    if (anim !== a) return;
    const real = simulate(res.rack, res.input, res.noise, true);
    Object.assign(a, { frames: real.frames, dirs: real.dirs, res });
  } catch (err) {
    if (anim !== a) return;
    toast(err.message);
    if (err.status) exitGame();
    else {
      anim = null;
      setPhase('aim');
    }
  }
}

function update(dt, now) {
  if (phase === 'roll' && anim) {
    const rate = anim.res ? 1 : clamp((anim.hold - anim.pos) / 40, 0.15, 1);
    anim.pos += (dt / FRAME_DT) * rate;
    if (!anim.res) anim.pos = Math.min(anim.pos, anim.hold);
    else if (anim.pos >= anim.frames.length - 1) finishThrow(now);
  }
  if (phase === 'result' && now - phaseT0 > 1700) nextThrow();
}

function finishThrow(now) {
  const res = anim.res;
  anim.pos = anim.frames.length - 1;
  const before = countPins(res.rack), left = countPins(res.standing), knocked = before - left;
  if (knocked === 10 && before === 10) banner('STRIKE!', true);
  else if (!left) banner('SPARE!', true);
  else if (!knocked) banner(anim.frames.at(-1)[2] ? 'Kanal 😬' : 'Iska');
  else banner(`${knocked} lobut`);
  game.rolls = res.rolls;
  game.rack = progress(res.rolls).fresh ? freshRack() : res.standing;
  game.last = res;
  renderFrames();
  setPhase('result', now);
}

function nextThrow() {
  if (game.last.done) return gameOver(game.last);
  anim = null;
  setPhase('aim');
}

function gameOver(res) {
  phase = 'over';
  board = res.board;
  const i = board.findIndex((p) => keyOf(p.name) === keyOf(me));
  const best = board[i]?.best ?? res.total;
  $('overTitle').textContent = res.record ? 'Yeni rekorun! 🎉' : 'Oyun bitti';
  $('overScore').textContent = res.total;
  let info = `En iyi skorun ${best} · Sıralaman ${i + 1}/${board.length}`;
  if (i < WINNERS) info += ' · Şu an kart bölgesindesin! 🎟️';
  else info += ` · Kart için ${board[WINNERS - 1].best - best + 1} puan daha lazım`;
  $('overInfo').textContent = info;
  $('over').hidden = false;
}

function banner(text, big = false) {
  const b = $('banner');
  b.textContent = text;
  b.className = 'banner';
  void b.offsetWidth; // animasyonu yeniden başlat
  b.className = 'banner show' + (big ? ' big' : '');
}

function renderFrames() {
  const marks = frameMarks(game.rolls), scores = frameScores(game.rolls), prog = progress(game.rolls);
  $('frames').replaceChildren(...marks.map((m, i) => {
    const f = el('div', 'frame' + (i === 9 ? ' tenth' : '') + (!prog.done && i === prog.frame ? ' cur' : ''));
    const rolls = el('div', 'rolls');
    rolls.append(...m.map((s) => el('span', '', s)));
    f.append(rolls, el('div', 'tot', scores[i] ?? ''));
    return f;
  }));
}

$('againBtn').addEventListener('click', () => startGame(me));
$('homeBtn').addEventListener('click', () => exitGame(false));
$('quitBtn').addEventListener('click', () => {
  if (phase === 'over' || confirm('Oyundan çıkılsın mı? Bu oyun kaydedilmez.')) exitGame();
});

// ---------- Kontroller ----------

const stage = $('stage');
let drag = null;

stage.addEventListener('pointerdown', (e) => {
  if (!game) return;
  if (phase === 'aim') {
    drag = { id: e.pointerId, x0: e.clientX, bx: game.x, t: performance.now(), moved: false };
    stage.setPointerCapture(e.pointerId);
  } else tap(performance.now());
});
stage.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x0;
  if (Math.abs(dx) > 8) drag.moved = true;
  if (drag.moved && phase === 'aim') moveBall(drag.bx + dx / (view.F / -CAM_START));
});
stage.addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moved) tap(drag.t);
  drag = null;
});
stage.addEventListener('pointercancel', () => (drag = null));

addEventListener('keydown', (e) => {
  if (!game || $('game').hidden || !$('over').hidden) return;
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    if (!e.repeat) tap(performance.now());
  } else if (phase === 'aim' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
    e.preventDefault();
    moveBall(game.x + (e.code === 'ArrowLeft' ? -0.02 : 0.02));
  }
});

// ---------- Çizim ----------

const canvas = $('lane'), ctx = canvas.getContext('2d');
const powerFill = document.querySelector('#powerMeter .fill');
const spinNeedle = document.querySelector('#spinMeter .needle');
const view = { F: 1, hor: 0, camZ: CAM_START, camH: 1.25, h0: 1.25 };
let W = 0, H = 0, dpr = 1, looping = false, lastT = 0;

function resize() {
  const r = canvas.getBoundingClientRect();
  if (!r.width) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = r.width;
  H = r.height;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  // Pist genişliği ekrana sığsın; uzun (telefon) ekranlarda kamera yükselir ki pist dikeyde de ekranı doldursun.
  const d0 = -CAM_START, fw = (W * 0.84 * d0) / (2 * LANE_HALF);
  view.h0 = clamp((H * 0.72) / (fw * (1 / d0 - 1 / (BACK_Z - CAM_START))), 1.25, 3);
  view.F = Math.min(fw, (H * 0.72 * d0) / view.h0);
  view.hor = H * 0.84 - (view.F * view.h0) / d0;
}
new ResizeObserver(resize).observe(canvas);

function setCamera(z) {
  view.camZ = z;
  view.camH = view.h0 * (1 - 0.32 * clamp((z - CAM_START) / (CAM_END - CAM_START), 0, 1));
}

// Dünya koordinatı (m) → ekran pikseli. Kamera faul çizgisinin arkasından pist boyunca bakar.
function P(x, y, z) {
  const s = view.F / Math.max(0.05, z - view.camZ);
  return [W / 2 + x * s, view.hor + (view.camH - y) * s, s];
}

function poly(pts, fill) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

const near = (z) => Math.max(z, view.camZ + 0.3);

function floor(x0, x1, z0, z1, fill) {
  z0 = near(z0);
  if (z1 > z0) poly([P(x0, 0, z0), P(x1, 0, z0), P(x1, 0, z1), P(x0, 0, z1)], fill);
}

function sideWall(x, z0, z1, y0, y1, fill) {
  z0 = near(z0);
  if (z1 > z0) poly([P(x, y0, z0), P(x, y0, z1), P(x, y1, z1), P(x, y1, z0)], fill);
}

function line3d(a, b, color, width) {
  const p = P(...a), q = P(...b);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  ctx.lineTo(q[0], q[1]);
  ctx.stroke();
}

const BACK_Z = PIT_Z + 0.9;
const BOARD = (2 * LANE_HALF) / 39;

function drawAlley() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1d0f45');
  bg.addColorStop(1, '#05030f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const zn = near(-6);
  floor(-9, 9, zn, BACK_Z, '#0e0a24');
  for (const s of [-1, 1]) {
    line3d([s * 1.15, 0, zn], [s * 1.15, 0, BACK_Z], 'rgba(255,61,139,0.7)', 2);
    line3d([s * 1.7, 1.0, zn], [s * 1.7, 1.0, BACK_Z], 'rgba(51,225,255,0.55)', 2);
  }

  // Kanallar ve pist
  floor(-WALL_X, -LANE_HALF, zn, PIT_Z, '#29234a');
  floor(LANE_HALF, WALL_X, zn, PIT_Z, '#29234a');
  const yFar = P(0, 0, PIT_Z)[1], yNear = Math.max(P(0, 0, zn)[1], yFar + 1);
  const wood = ctx.createLinearGradient(0, yFar, 0, yNear);
  wood.addColorStop(0, '#a86f3e');
  wood.addColorStop(1, '#ecc088');
  floor(-LANE_HALF, LANE_HALF, zn, PIT_Z, wood);
  floor(-LANE_HALF, LANE_HALF, zn, 0, 'rgba(255,245,225,0.22)');

  ctx.strokeStyle = 'rgba(95,45,12,0.17)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 39; i++) {
    const x = -LANE_HALF + i * BOARD, a = P(x, 0, near(0)), b = P(x, 0, DECK_Z);
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  }
  ctx.stroke();

  floor(-LANE_HALF, LANE_HALF, -0.015, 0.015, '#3b1c0a');
  for (let b = 5; b <= 35; b += 5) {
    const x = -LANE_HALF + (b - 0.5) * BOARD;
    if (4.4 > view.camZ + 0.3) poly([P(x - 0.022, 0, 4.4), P(x + 0.022, 0, 4.4), P(x, 0, 4.8)], '#5a2a10');
  }

  // Lobut alanı, çukur, yan duvarlar ve arka panel
  floor(-LANE_HALF, LANE_HALF, DECK_Z, PIT_Z, '#f2dbb2');
  floor(-WALL_X, WALL_X, PIT_Z, BACK_Z, '#030207');
  for (const s of [-1, 1]) sideWall(s * WALL_X, DECK_Z - 0.6, BACK_Z, 0, 0.62, '#2c2160');
  const bl = P(-WALL_X - 0.4, 0, BACK_Z), tr = P(WALL_X + 0.4, 1.35, BACK_Z), mid = P(0, 0.62, BACK_Z);
  ctx.fillStyle = '#020104';
  ctx.fillRect(bl[0], mid[1], tr[0] - bl[0], bl[1] - mid[1]);
  const mask = ctx.createLinearGradient(bl[0], 0, tr[0], 0);
  mask.addColorStop(0, '#ff3d8b');
  mask.addColorStop(0.5, '#6a2cff');
  mask.addColorStop(1, '#33e1ff');
  ctx.fillStyle = mask;
  ctx.fillRect(bl[0], tr[1], tr[0] - bl[0], mid[1] - tr[1]);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = `${Math.max(8, (mid[1] - tr[1]) * 0.42)}px Bungee, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('STRIKE ZONE', mid[0], (mid[1] + tr[1]) / 2);
}

// Lobut silüeti: [yükseklik oranı, yarıçap oranı]
const PROFILE = [[0, 0.42], [0.07, 0.68], [0.17, 0.92], [0.3, 1], [0.43, 0.92], [0.53, 0.68], [0.62, 0.44], [0.67, 0.38], [0.73, 0.45], [0.83, 0.54], [0.92, 0.46], [0.97, 0.28], [1, 0]];
const PIN_PATH = (() => {
  const pts = [...PROFILE.map(([v, u]) => [u, v]), ...PROFILE.slice(0, -1).reverse().map(([v, u]) => [-u, v])];
  const p = new Path2D();
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    p.quadraticCurveTo(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2);
  }
  p.lineTo(pts.at(-1)[0], pts.at(-1)[1]);
  p.closePath();
  return p;
})();
const PIN_GRAD = ctx.createLinearGradient(-1, 0, 1, 0);
PIN_GRAD.addColorStop(0, '#bdb6cf');
PIN_GRAD.addColorStop(0.4, '#ffffff');
PIN_GRAD.addColorStop(1, '#9b93b3');

function drawPin(x, z, fallen, ph, dir, alpha) {
  const th = fallen ? (ph * Math.PI) / 2 : 0, sn = Math.sin(th), cs = Math.cos(th);
  const lift = PIN_R * 0.9 * sn;
  const [bx, by, s] = P(x, lift, z);
  const [tx, ty] = P(x + dir[0] * PIN_H * sn, lift + PIN_H * cs, z + dir[1] * PIN_H * sn);
  const ax = tx - bx, ay = ty - by, len = Math.hypot(ax, ay) || 1, w = PIN_R * s;
  ctx.globalAlpha = alpha;
  if (!fallen) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(bx + w * 0.4, by, w * 1.4, w * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.setTransform((dpr * -ay * w) / len, (dpr * ax * w) / len, dpr * ax, dpr * ay, dpr * bx, dpr * by);
  ctx.fillStyle = PIN_GRAD;
  ctx.fill(PIN_PATH);
  ctx.save();
  ctx.clip(PIN_PATH);
  ctx.fillStyle = '#e3203a';
  ctx.fillRect(-1.2, 0.6, 2.4, 0.035);
  ctx.fillRect(-1.2, 0.675, 2.4, 0.035);
  ctx.restore();
}

function drawBall(x, z, gutter) {
  const [sx, sy, s] = P(x, gutter ? BALL_R - 0.07 : BALL_R, z), r = BALL_R * s, g = P(x, 0, z);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(g[0], g[1], r * 1.05, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  const grad = ctx.createRadialGradient(sx - r * 0.35, sy - r * 0.4, r * 0.1, sx, sy, r);
  grad.addColorStop(0, '#a8f7ff');
  grad.addColorStop(0.35, '#3a7bff');
  grad.addColorStop(1, '#170d4a');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fill();
  // Parmak delikleri top yuvarlandıkça döner.
  ctx.fillStyle = 'rgba(6,3,22,0.85)';
  for (const [u, off] of [[-0.22, 0.35], [0.22, 0.35], [0, -0.45]]) {
    const a = z / BALL_R + off, c = Math.cos(a);
    if (c < 0.15) continue;
    ctx.beginPath();
    ctx.ellipse(sx + u * r, sy - Math.sin(a) * r * 0.75, r * 0.11, r * 0.11 * c, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawAim(x, aim, active) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = active ? 1 : 0.45;
  ctx.shadowColor = '#33e1ff';
  ctx.shadowBlur = 8;
  for (let z = 0.8; z <= 6.4; z += 0.7) {
    const c = x + aim * z;
    poly([P(c - 0.05, 0, z - 0.1), P(c, 0, z + 0.06), P(c + 0.05, 0, z - 0.1), P(c, 0, z - 0.03)], '#33e1ff');
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

function drawDragHint(x) {
  const [sx, sy, s] = P(x, BALL_R, 0), r = BALL_R * s;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const d of [-1, 1]) {
    const cx = sx + d * (r + 14);
    poly([[cx + d * 8, sy], [cx - d * 2, sy - 8], [cx - d * 2, sy + 8]], 'rgba(255,255,255,0.75)');
  }
}

// Sol üstteki küçük lobut haritası (yedek atışlarda hangi lobutların kaldığını görmek için).
function drawRack(up) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const K = 44, x0 = 14, y0 = 52, w = 0.92 * K + 16, h = 0.8 * K + 16;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.roundRect(x0, y0, w, h, 8);
  ctx.fill();
  PIN_SPOTS.forEach(([x, z], i) => {
    ctx.fillStyle = up[i] ? '#ffffff' : 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.arc(x0 + w / 2 + x * K, y0 + 8 + (0.8 - (z - HEAD_Z)) * K, 4.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function frameAt(pos) {
  const fr = anim.frames, i = Math.min(fr.length - 1, Math.floor(pos)), j = Math.min(fr.length - 1, i + 1), t = pos - i;
  const A = fr[i], B = fr[j], L = (k) => A[k] + (B[k] - A[k]) * t;
  const pins = [];
  for (let k = 0; k < 10; k++) {
    const o = 4 + k * 4;
    pins.push({ x: L(o), z: L(o + 1), st: A[o + 2], ph: L(o + 3) });
  }
  return { bx: L(0), bz: L(1), gutter: A[2], gone: A[3], pins };
}

function draw(now, dt) {
  if (!W) return;
  const f = anim && frameAt(anim.pos);
  const target = f ? clamp(f.bz - 3, CAM_START, CAM_END) : CAM_START;
  if (phase === 'roll' || phase === 'result' || phase === 'over') setCamera(target);
  else setCamera(view.camZ + (target - view.camZ) * Math.min(1, dt * 4));

  drawAlley();
  const aiming = phase === 'aim' || phase === 'power' || phase === 'spin';
  if (game && aiming) drawAim(game.x, phase === 'aim' ? aimAt(now) : aimLock, phase === 'aim');

  const items = [];
  let up;
  if (f) {
    const fade = phase === 'result' || phase === 'over' ? clamp(1 - (now - phaseT0 - 700) / 500, 0, 1) : 1;
    f.pins.forEach((p, i) => {
      if (p.st === OUT) return;
      const fallen = p.st !== UP, dir = anim.dirs[i];
      if (fallen && !fade) return;
      items.push({ z: p.z + (fallen ? dir[1] * 0.15 : 0), draw: () => drawPin(p.x, p.z, fallen, p.ph, dir, fallen ? fade : 1) });
    });
    if (!f.gone) items.push({ z: f.bz, draw: () => drawBall(f.bx, f.bz, f.gutter) });
    up = f.pins.map((p) => p.st === UP);
  } else if (game) {
    game.rack.forEach((p) => p && items.push({ z: p[1], draw: () => drawPin(p[0], p[1], false, 0, [0, 1], 1) }));
    items.push({ z: 0, draw: () => drawBall(game.x, 0, 0) });
    up = game.rack.map(Boolean);
  }
  items.sort((a, b) => b.z - a.z).forEach((it) => it.draw());
  ctx.globalAlpha = 1;
  if (game && phase === 'aim') drawDragHint(game.x);
  if (up) drawRack(up);

  powerFill.style.height = (phase === 'power' ? powerAt(now) : phase === 'spin' ? powerLock : 0) * 100 + '%';
  spinNeedle.style.left = ((phase === 'spin' ? spinAt(now) : 0) + 1) * 50 + '%';
}

function loop(now) {
  if ($('game').hidden) {
    looping = false;
    return;
  }
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (game) update(dt, now);
  draw(now, dt);
  requestAnimationFrame(loop);
}

setInterval(tick, 1000);
tick();
loadBoard();
