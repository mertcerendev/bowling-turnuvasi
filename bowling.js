// Ortak bowling kodu: fizik simülasyonu + skor hesabı.
// Hem tarayıcı (game.js) hem sunucu (api/throw.js) bu dosyayı kullanır; skoru her zaman sunucu hesaplar.
// Simülasyonda sadece + - * / ve Math.sqrt var, böylece iki tarafta da birebir aynı sonuç çıkar.

// Ölçüler metre. x: sağ (+) / sol (-), z: faul çizgisinden lobutlara doğru.
export const LANE_HALF = 0.5334;
export const GUTTER_W = 0.235;
export const WALL_X = LANE_HALF + GUTTER_W;
export const BALL_R = 0.108;
export const PIN_R = 0.06;
export const PIN_H = 0.381;
export const HEAD_Z = 18.288;
const ROW = 0.26396;
export const DECK_Z = HEAD_Z - 0.35;
export const PIT_Z = HEAD_Z + 3 * ROW + 0.22;
export const OIL_Z = 12; // yağlı bölüm burada biter, top falsoyla kavis yapmaya başlar
export const NOISE_Z = 10; // sunucunun gizli küçük sapması topa bu noktada eklenir
export const DT = 1 / 240;
export const REC_EVERY = 2; // her 2 adımda bir animasyon karesi kaydedilir
export const MAX_X = LANE_HALF - BALL_R;
export const MAX_AIM = 0.03;

const BALL_M = 7;
const PIN_M = 1.5;
const E_BALL = 0.75;
const E_PIN = 0.5;
const HOOK = 1.0;
const OIL_HOOK = 0.1;
const PIN_DECEL = 1.6;
const FALL_T = 0.3;
const CAP_R = 0.07;
const FALL_R = 0.085;
const KNOCK_V = 0.4;
const MAX_STEPS = 240 * 9;

export const UP = 0;
export const DOWN = 1;
export const OUT = 2;

export const PIN_SPOTS = [
  [0, HEAD_Z],
  [-0.1524, HEAD_Z + ROW], [0.1524, HEAD_Z + ROW],
  [-0.3048, HEAD_Z + 2 * ROW], [0, HEAD_Z + 2 * ROW], [0.3048, HEAD_Z + 2 * ROW],
  [-0.4572, HEAD_Z + 3 * ROW], [-0.1524, HEAD_Z + 3 * ROW], [0.1524, HEAD_Z + 3 * ROW], [0.4572, HEAD_Z + 3 * ROW],
];

export function freshRack(jitter = 0, rand = Math.random) {
  return PIN_SPOTS.map(([x, z]) => [x + jitter * (rand() * 2 - 1), z + jitter * (rand() * 2 - 1)]);
}

export const countPins = (rack) => rack.filter(Boolean).length;

const clamp = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);

export function cleanInput(i) {
  return {
    x: clamp(i?.x, -MAX_X, MAX_X),
    aim: clamp(i?.aim, -MAX_AIM, MAX_AIM),
    power: clamp(i?.power, 0, 1),
    spin: clamp(i?.spin, -1, 1),
  };
}

export const speedOf = (power) => 5.5 + 3.5 * power;

function knock(p) {
  p.st = DOWN;
  p.ph = 0;
  const s = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
  if (s > 1e-9) {
    p.dx = p.vx / s;
    p.dz = p.vz / s;
  }
}

function hitBall(ball, p) {
  const dx = p.x - ball.x, dz = p.z - ball.z, rr = BALL_R + PIN_R;
  const d2 = dx * dx + dz * dz;
  if (d2 >= rr * rr || d2 === 0) return;
  const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
  const rel = (ball.vx - p.vx) * nx + (ball.vz - p.vz) * nz;
  if (rel > 0) {
    const j = ((1 + E_BALL) * rel) / (1 / BALL_M + 1 / PIN_M);
    ball.vx -= (j / BALL_M) * nx;
    ball.vz -= (j / BALL_M) * nz;
    p.vx += (j / PIN_M) * nx;
    p.vz += (j / PIN_M) * nz;
  }
  p.x += nx * (rr - d);
  p.z += nz * (rr - d);
  if (p.st === UP) knock(p);
}

// İki devrilmiş lobut: tabanları çarpışır.
function hitPins(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, rr = 2 * FALL_R;
  const d2 = dx * dx + dz * dz;
  if (d2 >= rr * rr || d2 === 0) return;
  const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
  const rel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
  if (rel > 0) {
    const j = ((1 + E_PIN) * rel) / 2;
    a.vx -= j * nx; a.vz -= j * nz;
    b.vx += j * nx; b.vz += j * nz;
  }
  const push = (rr - d) / 2;
  a.x -= nx * push; a.z -= nz * push;
  b.x += nx * push; b.z += nz * push;
}

// Devrilen lobut (tabandan başına uzanan bir çubuk gibi) ayaktaki lobuta değerse onu da devirir.
function hitStanding(f, s) {
  const ext = PIN_H * f.ph, ex = f.dx * ext, ez = f.dz * ext;
  let t = 0;
  if (ext > 0) {
    t = ((s.x - f.x) * ex + (s.z - f.z) * ez) / (ext * ext);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  const cx = f.x + ex * t, cz = f.z + ez * t;
  const dx = s.x - cx, dz = s.z - cz, rr = PIN_R + FALL_R + (CAP_R - FALL_R) * t;
  const d2 = dx * dx + dz * dz;
  if (d2 >= rr * rr || d2 === 0) return;
  const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
  const topple = f.ph < 1 ? (PIN_H / FALL_T) * t : 0;
  const vn = (f.vx + f.dx * topple) * nx + (f.vz + f.dz * topple) * nz;
  const bn = f.vx * nx + f.vz * nz;
  if (vn > KNOCK_V) {
    s.vx = nx * vn * 0.9;
    s.vz = nz * vn * 0.9;
    knock(s);
    if (bn > 0) { f.vx -= bn * nx * 0.6; f.vz -= bn * nz * 0.6; }
  } else {
    if (bn > 0) { f.vx -= (1 + E_PIN) * bn * nx; f.vz -= (1 + E_PIN) * bn * nz; }
    if (t === 0) { f.x -= nx * (rr - d); f.z -= nz * (rr - d); }
  }
}

function movePin(p) {
  p.x += p.vx * DT;
  p.z += p.vz * DT;
  const s2 = p.vx * p.vx + p.vz * p.vz;
  if (s2 > 0) {
    const s = Math.sqrt(s2), dec = PIN_DECEL * DT;
    const k = s <= dec ? 0 : (s - dec) / s;
    p.vx *= k;
    p.vz *= k;
  }
  if (p.ph < 1) p.ph = Math.min(1, p.ph + DT / FALL_T);
  if (p.z > DECK_Z) {
    // Lobut alanının yan duvarları: lobutlar sekip geri gelebilir.
    if (p.x > WALL_X - PIN_R) { p.x = WALL_X - PIN_R; if (p.vx > 0) p.vx *= -0.5; }
    if (p.x < PIN_R - WALL_X) { p.x = PIN_R - WALL_X; if (p.vx < 0) p.vx *= -0.5; }
    if (p.z > PIT_Z) p.st = OUT;
  } else if (p.x > LANE_HALF || p.x < -LANE_HALF || p.z < DECK_Z - 2) {
    p.st = OUT;
  }
}

// rack: 10 elemanlı dizi, ayaktaki lobut için [x, z], devrilmiş için null.
// noise: sunucunun belirlediği küçük yan sapma (m/s). record: animasyon kareleri kaydedilsin mi.
export function simulate(rack, input, noise, record = false) {
  const { x, aim, power, spin } = cleanInput(input);
  const v = speedOf(power), k = Math.sqrt(1 + aim * aim);
  const ball = { x, z: 0, vx: (v * aim) / k, vz: v / k, gutter: 0, gone: false };
  const pins = rack.map((p) => (p ? { x: p[0], z: p[1], vx: 0, vz: 0, st: UP, ph: 0, dx: 0, dz: 1 } : null));
  const frames = [];
  let noised = false, quiet = 0;

  for (let step = 0; step < MAX_STEPS; step++) {
    if (!ball.gone) {
      if (!ball.gutter) ball.vx += spin * (ball.z < OIL_Z ? OIL_HOOK : HOOK) * DT;
      if (!noised && ball.z >= NOISE_Z) { ball.vx += noise; noised = true; }
      ball.x += ball.vx * DT;
      ball.z += ball.vz * DT;
      if (!ball.gutter && (ball.x > LANE_HALF || ball.x < -LANE_HALF)) ball.gutter = ball.x > 0 ? 1 : -1;
      if (ball.gutter) {
        const gx = ball.gutter * (LANE_HALF + GUTTER_W / 2);
        if ((ball.x - gx) * ball.gutter >= 0) { ball.x = gx; ball.vx = 0; }
        else ball.vx = ball.gutter * Math.max(Math.abs(ball.vx), 0.8);
      }
      if (ball.z > PIT_Z + BALL_R) ball.gone = true;
      if (!ball.gutter) for (const p of pins) if (p && p.st !== OUT) hitBall(ball, p);
    }
    for (const p of pins) if (p && p.st === DOWN) movePin(p);
    for (let i = 0; i < 10; i++) {
      for (let j = i + 1; j < 10; j++) {
        const a = pins[i], b = pins[j];
        if (!a || !b || a.st === OUT || b.st === OUT || (a.st === UP && b.st === UP)) continue;
        if (a.st === DOWN && b.st === DOWN) hitPins(a, b);
        else if (a.st === DOWN) hitStanding(a, b);
        else hitStanding(b, a);
      }
    }
    if (record && step % REC_EVERY === 0) {
      const f = new Float32Array(44);
      f[0] = ball.x; f[1] = ball.z; f[2] = ball.gutter; f[3] = ball.gone ? 1 : 0;
      pins.forEach((p, i) => {
        const o = 4 + i * 4;
        if (p) { f[o] = p.x; f[o + 1] = p.z; f[o + 2] = p.st; f[o + 3] = p.ph; } else f[o + 2] = OUT;
      });
      frames.push(f);
    }
    if (ball.gone) {
      const moving = pins.some((p) => p && p.st === DOWN && (p.ph < 1 || p.vx * p.vx + p.vz * p.vz > 0.0025));
      quiet = moving ? 0 : quiet + 1;
      if (quiet > 0.4 / DT) break;
    }
  }

  return {
    standing: pins.map((p) => (p && p.st === UP ? [p.x, p.z] : null)),
    frames,
    dirs: pins.map((p) => (p ? [p.dx, p.dz] : [0, 1])),
  };
}

// ---------- Skor ----------

// Sıradaki atış hangi çerçevede, lobutlar yeniden mi dizilecek, oyun bitti mi?
export function progress(rolls) {
  let i = 0;
  for (let f = 0; f < 9; f++) {
    if (i >= rolls.length) return { frame: f, ball: 0, fresh: true, done: false };
    if (rolls[i] === 10) { i += 1; continue; }
    if (i + 1 >= rolls.length) return { frame: f, ball: 1, fresh: false, done: false };
    i += 2;
  }
  const [a, b] = rolls.slice(i), n = rolls.length - i;
  if (n === 0) return { frame: 9, ball: 0, fresh: true, done: false };
  if (n === 1) return { frame: 9, ball: 1, fresh: a === 10, done: false };
  if (n === 2 && (a === 10 || a + b === 10)) return { frame: 9, ball: 2, fresh: a === 10 ? b === 10 : true, done: false };
  return { frame: 9, ball: n, fresh: true, done: true };
}

// Her çerçevenin kümülatif skoru (henüz belli değilse null).
export function frameScores(rolls) {
  const out = [];
  let i = 0, total = 0;
  for (let f = 0; f < 10; f++) {
    const a = rolls[i], b = rolls[i + 1], c = rolls[i + 2];
    let pts, used;
    if (f === 9) { pts = progress(rolls).done ? a + b + (c ?? 0) : NaN; used = 3; }
    else if (a === 10) { pts = 10 + b + c; used = 1; }
    else if (a + b === 10) { pts = 10 + c; used = 2; }
    else { pts = a + b; used = 2; }
    if (Number.isNaN(pts)) break;
    total += pts;
    out.push(total);
    i += used;
  }
  while (out.length < 10) out.push(null);
  return out;
}

const mark = (n) => (n === 0 ? '-' : String(n));
const markX = (n) => (n === 10 ? 'X' : mark(n));

// Skor tablosunda gösterilecek işaretler (X, /, -).
export function frameMarks(rolls) {
  const out = [];
  let i = 0;
  for (let f = 0; f < 9; f++) {
    const a = rolls[i], b = rolls[i + 1];
    if (a === 10) { out.push(['', 'X']); i += 1; continue; }
    out.push([a === undefined ? '' : mark(a), b === undefined ? '' : a + b === 10 ? '/' : mark(b)]);
    i += 2;
  }
  const [a, b, c] = rolls.slice(i);
  out.push([
    a === undefined ? '' : markX(a),
    b === undefined ? '' : a === 10 ? markX(b) : a + b === 10 ? '/' : mark(b),
    c === undefined ? '' : a === 10 && b !== 10 ? (b + c === 10 ? '/' : mark(c)) : markX(c),
  ]);
  return out;
}
