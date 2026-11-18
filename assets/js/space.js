(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = t => 1 - (1 - t) ** 3;
  const easeInOut = t => -(Math.cos(Math.PI * t) - 1) / 2;
  const easeBack = t => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;
  const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const rng = seed => { let s = (seed * 2654435761) >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; };

  const C = {
    ink: '#0e0a16', paper: '#fbf1dc', yellow: '#ffd23f', orange: '#ff8a2b', red: '#ff4b3e',
    cyan: '#3fd0f0', mint: '#20f4af', violet: '#6c4ad8', lime: '#9be35a',
    rock: '#9a7660', rockDark: '#4d3428', rockLight: '#d9ab80',
    hull: '#e8ecf2', hullShade: '#8b95a8', glass: '#5fd6f2'
  };

  const IMPACT = 0.42;

  const canvas = document.getElementById('space');
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, DPR = 1, U = 1;
  let boil = 0;
  let nebula = null, vignette = null;
  const vp = { x: 0, y: 0 };
  const stars = [];
  const rocks = new Map();
  const sprites = {};
  const ship = { x: 0, y: 0, s: 60 };
  const missiles = [];
  const pops = [];
  let fireSide = 1;
  const api = {};

  /* ---------- drawing helpers ---------- */

  function poly(pts, amp = 0, seed = 0) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      let [x, y] = pts[i];
      if (amp) {
        x += (hash(seed + i * 3.17 + boil * 7.7) - 0.5) * amp;
        y += (hash(seed + i * 5.31 + boil * 3.9) - 0.5) * amp;
      }
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  function ink(width) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = width;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
  }

  function outline(width, color, edge) {
    ctx.lineWidth = width + edge;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  function line(x0, y0, x1, y1, width, color = C.ink) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineCap = 'round';
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  function disc(x, y, r, fill, lw) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = fill;
    ctx.fill();
    if (lw) ink(lw);
  }

  function shape(pts, fill, lw = 0, wob = 0, seed = 0) {
    poly(pts, wob, seed);
    ctx.fillStyle = fill;
    ctx.fill();
    if (lw) ink(lw);
  }

  const mix = (a, b, t) => {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = s => Math.round(lerp((pa >> s) & 255, (pb >> s) & 255, t));
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  };

  const patterns = {};
  function dots(color, spacing, radius, scale = 1) {
    const key = color + spacing + radius;
    if (!patterns[key]) {
      const c = document.createElement('canvas');
      c.width = c.height = spacing;
      const g = c.getContext('2d');
      g.fillStyle = color;
      g.beginPath();
      g.arc(spacing / 2, spacing / 2, radius, 0, TAU);
      g.fill();
      patterns[key] = ctx.createPattern(c, 'repeat');
    }
    const pat = patterns[key];
    if (pat.setTransform) pat.setTransform(new DOMMatrix([1 / scale, 0, 0, 1 / scale, 0, 0]));
    return pat;
  }

  function burst(n, rOut, rIn, seed, jitter = 0.12) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * TAU;
      const r = (i % 2 ? rIn : rOut) * (1 + (hash(seed + i * 1.93 + boil * 0.61) - 0.5) * jitter);
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return pts;
  }

  /* ---------- sprites built once per size ---------- */

  function buildNebula() {
    const w = Math.ceil(W * 1.2), h = Math.ceil(H * 1.2);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const bg = g.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.75);
    bg.addColorStop(0, '#22174a');
    bg.addColorStop(0.55, '#110c26');
    bg.addColorStop(1, '#06050d');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    const big = Math.max(w, h);
    const blobs = [
      { x: 0.2, y: 0.28, r: 0.42, c: 'rgba(37,116,255,0.48)' },
      { x: 0.82, y: 0.66, r: 0.48, c: 'rgba(63,208,240,0.19)' },
      { x: 0.62, y: 0.14, r: 0.3, c: 'rgba(108,74,216,0.55)' },
      { x: 0.1, y: 0.86, r: 0.32, c: 'rgba(255,138,43,0.3)' }
    ];
    const step = Math.max(7, Math.round(big / 190));
    blobs.forEach((b, bi) => {
      g.fillStyle = b.c;
      g.beginPath();
      for (let y = 0, row = 0; y < h; y += step * 0.87, row++) {
        for (let x = (row % 2) * step / 2; x < w; x += step) {
          const dx = (x - b.x * w) / (b.r * big), dy = (y - b.y * h) / (b.r * big);
          const n = 0.55 + 0.45 * Math.sin(x * 0.011 + Math.sin(y * 0.017 + bi) * 2.2) * Math.cos(y * 0.013 - x * 0.005 + bi);
          const v = Math.exp(-(dx * dx + dy * dy) * 2.6) * n;
          if (v < 0.05) continue;
          const r = step * 0.55 * Math.min(1, v * 1.25);
          g.moveTo(x + r, y);
          g.arc(x, y, r, 0, TAU);
        }
      }
      g.fill();
    });
    return c;
  }

  function buildSun() {
    const S = 512, r = 240, c = S / 2;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(c - 50, c - 60, 10, c, c, r);
    grd.addColorStop(0, '#fff6c2');
    grd.addColorStop(0.5, '#ffd23f');
    grd.addColorStop(1, '#ff9a2b');
    g.fillStyle = grd;
    g.beginPath(); g.arc(c, c, r, 0, TAU); g.fill();
    g.save();
    g.clip();
    g.fillStyle = 'rgba(232,74,22,0.75)';
    g.beginPath();
    const step = 15;
    for (let y = 0, row = 0; y < S; y += step * 0.87, row++) {
      for (let x = (row % 2) * step / 2; x < S; x += step) {
        const d = Math.hypot(x - c + 40, y - c + 50) / r;
        const rr = clamp(d * d * 7.5 - 0.6, 0, step * 0.55);
        if (rr < 0.4) continue;
        g.moveTo(x + rr, y);
        g.arc(x, y, rr, 0, TAU);
      }
    }
    g.fill();
    [[c + 70, c + 40, 26], [c - 90, c + 90, 16], [c + 20, c - 110, 12]].forEach(([x, y, s]) => {
      g.fillStyle = '#e0521a';
      g.beginPath(); g.ellipse(x, y, s * 1.3, s, 0.4, 0, TAU); g.fill();
      g.lineWidth = 4; g.strokeStyle = C.ink; g.stroke();
    });
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 10; g.lineCap = 'round';
    g.beginPath(); g.arc(c, c, r * 0.8, Math.PI * 1.05, Math.PI * 1.35); g.stroke();
    return cv;
  }

  const PLANETS = {
    planet: { base: '#7a56e6', bands: ['#9a7cf4', '#5537b8'], ring: C.yellow, shade: '#160d33',
      x0: 0.3, y0: 0.38, x1: -0.3, y1: 0.18, r0: 0.04, r1: 0.8, mirror: false },
    belt: { base: '#ff9a3c', bands: ['#ffd08a', '#d4561c'], ring: null, shade: '#3a1208',
      x0: 0.68, y0: 0.36, x1: 1.3, y1: 0.3, r0: 0.05, r1: 0.95, mirror: true },
    cargo: { base: '#5fd6f2', bands: ['#bdf1ff', '#2c9cc4'], ring: C.mint, shade: '#082436',
      x0: 0.4, y0: 0.52, x1: -0.15, y1: 0.98, r0: 0.03, r1: 0.55, mirror: false }
  };

  function buildPlanet(spec) {
    const S = 840, c = S / 2, r = 200;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    const ring = (front) => {
      if (!spec.ring) return;
      g.save();
      g.translate(c, c);
      g.rotate(-0.32);
      if (front) { g.beginPath(); g.rect(-S, 0, S * 2, S); g.clip(); }
      g.beginPath(); g.ellipse(0, 0, r * 1.85, r * 0.42, 0, 0, TAU);
      g.lineWidth = 46; g.strokeStyle = C.ink; g.stroke();
      g.lineWidth = 34; g.strokeStyle = spec.ring; g.stroke();
      g.beginPath(); g.ellipse(0, 0, r * 1.85, r * 0.42, 0, 0, TAU);
      g.lineWidth = 4; g.strokeStyle = C.ink; g.stroke();
      g.restore();
    };
    ring(false);
    g.save();
    g.beginPath(); g.arc(c, c, r, 0, TAU); g.clip();
    g.fillStyle = spec.base; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 9; i++) {
      const y0 = c - r + i * (2 * r / 9);
      g.fillStyle = spec.bands[i % 2];
      g.beginPath();
      g.moveTo(c - r, y0);
      for (let x = -r; x <= r; x += 20) g.lineTo(c + x, y0 + Math.sin(x * 0.03 + i) * 7);
      for (let x = r; x >= -r; x -= 20) g.lineTo(c + x, y0 + 16 + i % 3 * 6 + Math.sin(x * 0.025 + i * 2) * 6);
      g.closePath();
      g.fill();
    }
    g.beginPath();
    g.rect(0, 0, S, S);
    g.arc(c + r * 0.32, c - r * 0.26, r * 1.02, 0, TAU, true);
    g.fillStyle = spec.shade; g.globalAlpha = 0.55; g.fill('evenodd');
    g.globalAlpha = 1;
    const pc = document.createElement('canvas'); pc.width = pc.height = 12;
    const pg = pc.getContext('2d'); pg.fillStyle = 'rgba(14,10,22,0.55)'; pg.beginPath(); pg.arc(6, 6, 3, 0, TAU); pg.fill();
    g.fillStyle = g.createPattern(pc, 'repeat'); g.fill('evenodd');
    g.restore();
    g.beginPath(); g.arc(c, c, r, 0, TAU);
    g.lineWidth = 9; g.strokeStyle = C.ink; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 9; g.lineCap = 'round';
    g.beginPath(); g.arc(c, c, r * 0.82, -1.25, -0.55); g.stroke();
    ring(true);
    return cv;
  }

  function rockFor(idx) {
    if (rocks.has(idx)) return rocks.get(idx);
    const r = rng(idx * 97 + 13);
    const n = 10 + Math.floor(r() * 3);
    const bite1 = Math.floor(r() * n), bite2 = (bite1 + 3 + Math.floor(r() * (n - 5))) % n;
    const verts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + (r() - 0.5) * 0.36;
      const rad = (i === bite1 || i === bite2 ? 0.5 : 0.78) + r() * 0.26;
      verts.push([Math.cos(a) * rad * 1.08, Math.sin(a) * rad * 0.94]);
    }
    const craters = [];
    for (let i = 0; i < 6; i++) {
      const a = r() * TAU, d = Math.sqrt(r()) * 0.58;
      craters.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: 0.06 + r() * 0.12, t: r() * 3 });
    }
    const core = [(r() - 0.5) * 0.16, (r() - 0.5) * 0.16];
    const shards = [], seams = [];
    for (let i = 0; i < n;) {
      const k = 2 + Math.floor(r() * 2);
      const pts = [core];
      for (let j = 0; j <= k; j++) pts.push(verts[(i + j) % n]);
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      const len = Math.hypot(cx, cy) || 1;
      shards.push({ pts, c: [cx, cy], dir: [cx / len, cy / len], spin: (r() - 0.5) * 1.8, speed: 0.75 + r() * 0.6 });
      seams.push(verts[i]);
      i += k;
    }
    const cracks = seams.map(v => {
      const j1 = [(r() - 0.5) * 0.12, (r() - 0.5) * 0.12], j2 = [(r() - 0.5) * 0.1, (r() - 0.5) * 0.1];
      return [core, [v[0] * 0.35 + j1[0], v[1] * 0.35 + j1[1]], [v[0] * 0.7 + j2[0], v[1] * 0.7 + j2[1]], v];
    });
    const debris = [];
    for (let i = 0; i < 26; i++) debris.push({ a: r() * TAU, sp: 0.5 + r() * 1.5, sz: 0.025 + r() * 0.05, spin: (r() - 0.5) * 8, seed: r() * 100 });
    const rock = { verts, craters, shards, cracks, debris };
    rocks.set(idx, rock);
    return rock;
  }

  /* ---------- stars ---------- */

  const STAR_COLORS = [C.paper, C.cyan, C.mint];
  // Stars are stroked in one path per colour and depth band rather than one stroke each.
  const STAR_BANDS = 12;
  const starPaths = [];

  function newStar(s, z) {
    s.x = (Math.random() * 2 - 1) * 1.1;
    s.y = (Math.random() * 2 - 1) * 1.1;
    s.z = z;
    const k = Math.random();
    s.c = k < 0.82 ? 0 : k < 0.91 ? 1 : 2;
    return s;
  }

  function initStars() {
    stars.length = 0;
    const n = Math.round(clamp((W * H) / 2300, 180, 640));
    for (let i = 0; i < n; i++) stars.push(newStar({}, Math.random()));
  }

  function drawStars(speed, dt) {
    const f = Math.max(W, H) * 0.5;
    const move = reduce ? 0 : speed * dt * 0.00032;
    const tail = reduce ? 0 : clamp(Math.abs(speed) * 0.03, 0, 0.3) * Math.sign(speed);
    starPaths.length = 0;
    for (const s of stars) {
      s.z -= move;
      if (s.z < 0.02) newStar(s, 1);
      else if (s.z > 1.05) newStar(s, 0.04 + Math.random() * 0.1);
      const x = vp.x + (s.x / s.z) * f, y = vp.y + (s.y / s.z) * f;
      if (x < -60 || x > W + 60 || y < -60 || y > H + 60) {
        if (move >= 0) newStar(s, 1);
        continue;
      }
      const near = 1 - s.z;
      if (near <= 0) continue;
      const tz = clamp(s.z + tail, 0.02, 1.3);
      const tx = vp.x + (s.x / tz) * f, ty = vp.y + (s.y / tz) * f;
      const k = s.c * STAR_BANDS + Math.min(STAR_BANDS - 1, Math.floor(near * STAR_BANDS));
      const path = starPaths[k] || (starPaths[k] = new Path2D());
      path.moveTo(tx, ty);
      path.lineTo(x + 0.01, y);
    }
    ctx.lineCap = 'round';
    starPaths.forEach((path, k) => {
      const near = ((k % STAR_BANDS) + 0.5) / STAR_BANDS;
      ctx.globalAlpha = clamp(near * 1.5);
      ctx.strokeStyle = STAR_COLORS[Math.floor(k / STAR_BANDS)];
      ctx.lineWidth = 0.6 + near * 2.4;
      ctx.stroke(path);
    });
    ctx.globalAlpha = 1;
  }

  function drawSpeedLines(amount, toward) {
    if (amount <= 0.01 || reduce) return;
    const big = Math.hypot(W, H);
    const n = 56;
    ctx.fillStyle = C.paper;
    ctx.globalAlpha = clamp(amount) * 0.55;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + (hash(i * 3.3 + boil * 0.37) - 0.5) * 0.12;
      const r0 = big * 0.24 + hash(i * 7.1 + boil) * big * 0.2;
      const r1 = big * 0.75;
      const w = (0.004 + hash(i * 1.7) * 0.009) * (1 + amount);
      ctx.moveTo(toward.x + Math.cos(a) * r0, toward.y + Math.sin(a) * r0);
      ctx.lineTo(toward.x + Math.cos(a - w) * r1, toward.y + Math.sin(a - w) * r1);
      ctx.lineTo(toward.x + Math.cos(a + w) * r1, toward.y + Math.sin(a + w) * r1);
      ctx.closePath();
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /* ---------- sun ---------- */

  function drawSun(x, y, r, near, t) {
    if (!sprites.sun) sprites.sun = buildSun();
    const glowRadius = r * (3 + near * 2);
    const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, glowRadius);
    glow.addColorStop(0, 'rgba(255,190,70,0.55)');
    glow.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - glowRadius, y - glowRadius, 2 * glowRadius, 2 * glowRadius);

    if (near > 0.02) {
      const big = Math.hypot(W, H);
      const rot = reduce ? 0 : t * 0.00004;
      ctx.fillStyle = `rgba(255,170,60,${0.22 * near})`;
      ctx.beginPath();
      for (let i = 0; i < 36; i += 2) {
        const a0 = rot + (i / 36) * TAU, a1 = rot + ((i + 1) / 36) * TAU;
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a0) * big, y + Math.sin(a0) * big);
        ctx.lineTo(x + Math.cos(a1) * big, y + Math.sin(a1) * big);
        ctx.closePath();
      }
      ctx.fill();
    }

    if (r > 10) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(reduce ? 0 : t * 0.00008);
      shape(burst(22, r * 1.24, r * 1.04, 41, 0.22), C.orange, Math.max(2, r * 0.018));
      poly(burst(22, r * 1.12, r * 1.02, 77, 0.18));
      ctx.fillStyle = C.yellow;
      ctx.fill();
      ctx.restore();
    }
    ctx.drawImage(sprites.sun, x - r * 1.067, y - r * 1.067, r * 2.133, r * 2.133);
    if (r > 6) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ink(Math.max(1.5, r * 0.02));
    }
  }

  /* ---------- planets ---------- */

  function drawPlanet(type, p) {
    const spec = PLANETS[type];
    if (!spec || p <= -0.15 || p >= 1) return;
    const t = clamp((p + 0.15) / 1.15);
    const m = t ** 1.7, g = t ** 2.4;
    const x = lerp(spec.x0, spec.x1, m) * W;
    const y = lerp(spec.y0, spec.y1, m) * H;
    const r = lerp(spec.r0, spec.r1, g) * Math.min(W, H);
    if (!sprites[type]) sprites[type] = buildPlanet(spec);
    const size = sprites[type].width * (r / 200);
    ctx.save();
    ctx.translate(x, y);
    if (spec.mirror) ctx.scale(-1, 1);
    ctx.globalAlpha = clamp((p + 0.15) * 8);
    ctx.drawImage(sprites[type], -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  function drawBelt(p) {
    if (p <= 0 || p >= 1 || reduce) return;
    const f = Math.max(W, H) * 0.5;
    for (let i = 0; i < 18; i++) {
      const sx = (hash(i * 4.1) * 2 - 1) * 0.9, sy = (hash(i * 9.7) * 2 - 1) * 0.6;
      const z = 1 - ((hash(i * 2.3) + p * 2.2) % 1);
      if (z < 0.08) continue;
      const x = vp.x + (sx / z) * f, y = vp.y + (sy / z) * f;
      const R = (0.025 / z) * f * (0.6 + hash(i) * 0.8);
      if (x < -R || x > W + R || y < -R || y > H + R) continue;
      ctx.save();
      ctx.globalAlpha = clamp((1 - z) * 3) * clamp(p * 10) * clamp((1 - p) * 10);
      ctx.translate(x, y);
      ctx.rotate(p * 6 * (hash(i * 5) - 0.5) + i);
      paintRock(rockFor(100 + (i % 5)), null, R);
      ctx.restore();
    }
  }

  /* ---------- meteors ---------- */

  // light: unit vector toward the light, in the rock's own frame.
  function paintRock(rock, clipPts, R, light = [-0.65, -0.76], rim = 0) {
    const [lx, ly] = light;
    const pts = clipPts || rock.verts;
    const lw = clamp(R * 0.035, 1.5, 5.5) / R;
    const wob = clamp(R * 0.012, 0.5, 4) / R;
    ctx.save();
    ctx.scale(R, R);
    poly(pts, wob, 3);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = C.rockDark;
    ctx.fillRect(-1.4, -1.4, 2.8, 2.8);
    ctx.fillStyle = dots('rgba(14,10,22,0.6)', 7, 1.9, R);
    ctx.fillRect(-1.4, -1.4, 2.8, 2.8);
    ctx.save();
    ctx.translate(lx * 0.23, ly * 0.26);
    ctx.scale(0.96, 0.96);
    poly(rock.verts);
    ctx.fillStyle = C.rock;
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(lx * 0.52, ly * 0.53);
    ctx.scale(0.55, 0.5);
    poly(rock.verts);
    ctx.fillStyle = C.rockLight;
    ctx.fill();
    ctx.restore();
    for (const cr of rock.craters) {
      ctx.beginPath();
      ctx.ellipse(cr.x, cr.y, cr.r * 1.15, cr.r * 0.85, cr.t, 0, TAU);
      ctx.fillStyle = C.rockDark;
      ctx.fill();
      ctx.lineWidth = lw * 0.6;
      ctx.strokeStyle = C.ink;
      ctx.stroke();
      const lit = Math.atan2(-ly, -lx) - cr.t;
      ctx.beginPath();
      ctx.ellipse(cr.x, cr.y, cr.r * 1.15, cr.r * 0.85, cr.t, lit - 0.85, lit + 0.85);
      ctx.strokeStyle = C.rockLight;
      ctx.lineWidth = lw * 0.9;
      ctx.stroke();
    }
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = lw * 0.45;
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const hx = 0.25 + i * 0.09, hy = 0.15 + i * 0.07;
      ctx.moveTo(hx, hy + 0.25);
      ctx.lineTo(hx + 0.22, hy);
    }
    ctx.stroke();
    if (rim > 0) {
      // Everything inside the rock except a copy pushed away from the light: a crescent on the lit edge.
      for (const [shift, col] of [[0.2, C.orange], [0.09, C.yellow]]) {
        ctx.beginPath();
        ctx.rect(-2, -2, 4, 4);
        rock.verts.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, x - lx * shift * rim, y - ly * shift * rim));
        ctx.closePath();
        ctx.fillStyle = col;
        ctx.fill('evenodd');
      }
    }
    ctx.restore();
    poly(pts, wob, 3);
    ink(lw);
    ctx.restore();
  }

  const inbound = p => clamp(p / IMPACT);
  const outbound = p => clamp((p - IMPACT) / (0.82 - IMPACT));

  // Flies in from beside the vanishing point and reaches (ex, ey), relative to the screen centre, at IMPACT.
  function approach(p, side, ex = 0, ey = 0) {
    const a = inbound(p);
    const k = 1 / lerp(14, 1, 1 - (1 - a) ** 1.5);
    const far = (1 - k) / (1 - 1 / 14);
    return {
      a, k,
      x: lerp(ex, vp.x - W / 2 + side * W * 0.24, far),
      y: lerp(ey, vp.y - H / 2 - H * 0.05, far),
      after: outbound(p)
    };
  }

  // Fire tail pointing back along the flight path, in a frame where +x is "behind the rock".
  function drawTail(R, heat, time) {
    const len = R * (1.8 + 3.4 * heat);
    const tongue = (scaleL, scaleW, seed) => {
      const N = 14, top = [], bottom = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const flick = 1 + (hash(seed + i * 2.3 + boil * 0.9) - 0.5) * 0.35;
        const half = R * 0.78 * scaleW * (1 - t) ** 1.3 * (i % 2 ? 1.14 : 0.9) * flick;
        top.push([R * 0.15 + t * len * scaleL, -half]);
        bottom.unshift([R * 0.15 + t * len * scaleL, half]);
      }
      return top.concat(bottom);
    };
    shape(tongue(1, 1, 3), C.orange, clamp(R * 0.035, 1.5, 4.5));
    shape(tongue(0.72, 0.68, 17), C.yellow);
    shape(tongue(0.4, 0.4, 31), '#fffbe8');
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const phase = (time * 0.0009 + i / 6) % 1;
      const x = R * 0.6 + phase * len * 1.15;
      const y = (hash(i * 9.1) - 0.5) * R * 1.1 * (1 - phase * 0.4);
      const sz = R * (0.025 + hash(i * 4.7) * 0.03) * (1 - phase * 0.5);
      ctx.globalAlpha = 1 - phase;
      line(x, y, x + sz * 5, y, sz * 1.1, C.orange);
      shape([[x - sz, y - sz * 0.7], [x + sz, y - sz * 0.5], [x + sz * 0.3, y + sz], [x - sz * 0.8, y + sz * 0.5]], C.rockDark, Math.max(1, sz * 0.4));
    }
    ctx.globalAlpha = 1;
  }

  function drawTag(st, x, y, R, alpha, { top = `INCOMING · ${st.num.toUpperCase()}`, fill = C.yellow, text = C.ink } = {}) {
    if (!st.label || alpha <= 0) return null;
    const big = clamp(26 * U, 17, 30), small = big * 0.52;
    ctx.font = `${Math.round(big)}px Bangers, Impact, sans-serif`;
    const w = Math.max(ctx.measureText(st.label).width, ctx.measureText(top).width * (small / big) * 1.1) + big * 0.9;
    const h = big * 1.75 + small;
    const dir = -st.side;
    const tx = clamp(x + dir * (R * 0.95 + w * 0.5 + 24 * U), w / 2 + 16, W - w / 2 - 96);
    const ty = clamp(y - R * 0.55 - h * 0.3, 90 + h / 2, H - 110 - h / 2);
    const ax = x + dir * R * 0.7, ay = y - R * 0.35;
    ctx.save();
    ctx.globalAlpha = alpha;
    line(ax, ay, tx - dir * w * 0.42, ty + h * 0.2, Math.max(2.5, 3 * U));
    ctx.beginPath();
    ctx.arc(ax, ay, Math.max(3.5, 5 * U), 0, TAU);
    ctx.fillStyle = C.yellow;
    ctx.fill();
    ink(Math.max(2, 2.5 * U));
    ctx.translate(tx, ty);
    ctx.rotate(dir * -0.035);
    ctx.fillStyle = C.ink;
    ctx.fillRect(-w / 2 + 5, -h / 2 + 5, w, h);
    ctx.beginPath();
    ctx.rect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = fill;
    ctx.fill();
    ink(Math.max(2.5, 3 * U));
    ctx.fillStyle = text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(small)}px Bangers, Impact, sans-serif`;
    ctx.fillText(top, 0, -h / 2 + small * 0.95);
    ctx.font = `${Math.round(big)}px Bangers, Impact, sans-serif`;
    ctx.fillText(st.label, 0, h / 2 - big * 0.75);
    ctx.restore();
    return { x: tx, y: ty, w, h };
  }

  function drawMeteor(st, time) {
    const p = st.p;
    if (p <= 0 || p >= 0.9 || reduce) return;
    const rock = rockFor(st.idx);
    const pose = approach(p, st.side);
    const R = st.R * pose.k;
    if (R < 1.5) return;
    const heat = clamp((pose.a - 0.3) / 0.7);
    const rot = st.side * 1.9 * (1 - pose.a);
    const x = W / 2 + pose.x, y = H / 2 + pose.y;
    // The rock flies in a straight line from its start point to the screen centre, so "behind" is constant.
    const ox = vp.x - W / 2 + st.side * W * 0.24, oy = vp.y - H / 2 - H * 0.05;
    const back = Math.atan2(oy, ox);
    ctx.save();
    ctx.translate(x, y);

    if (pose.after <= 0) {
      const glow = ctx.createRadialGradient(0, 0, R * 0.6, 0, 0, R * (1.4 + heat * 0.6));
      glow.addColorStop(0, `rgba(255,140,50,${0.25 + heat * 0.35})`);
      glow.addColorStop(1, 'rgba(255,90,40,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(-R * 3, -R * 3, R * 6, R * 6);
      if (R > 4) {
        ctx.save();
        ctx.rotate(back);
        drawTail(R, Math.max(0.15, heat), time);
        ctx.restore();
      }
      ctx.rotate(rot);
      const light = [Math.cos(back - rot), Math.sin(back - rot)];
      paintRock(rock, null, R, light, 0.4 + heat * 0.6);
      if (heat > 0.45) {
        ctx.save();
        ctx.scale(R, R);
        ctx.globalAlpha = clamp((heat - 0.45) * 2.5);
        for (const [w, col] of [[0.05, C.ink], [0.035, C.orange], [0.014, C.yellow]]) {
          ctx.beginPath();
          for (const cr of rock.cracks) {
            ctx.moveTo(cr[0][0], cr[0][1]);
            for (let i = 1; i < cr.length; i++) ctx.lineTo(cr[i][0], cr[i][1]);
          }
          ctx.lineWidth = w * (0.6 + heat * 0.6);
          ctx.strokeStyle = col;
          ctx.lineJoin = 'round';
          ctx.stroke();
        }
        ctx.restore();
      }
      if (heat > 0.55) {
        // Heat lines: short wavy strokes on the leading face only.
        ctx.save();
        ctx.rotate(back - rot);
        ctx.globalAlpha = clamp((heat - 0.55) * 2.2) * 0.7;
        ctx.strokeStyle = C.paper;
        ctx.lineWidth = clamp(R * 0.018, 1.2, 3);
        ctx.lineCap = 'round';
        for (let k = 0; k < 4; k++) {
          const a0 = Math.PI + (k - 1.5) * 0.42;
          const rr = R * (1.12 + (k % 2) * 0.1);
          ctx.beginPath();
          for (let j = 0; j <= 8; j++) {
            const a = a0 - 0.2 + j * 0.05;
            const wob = Math.sin(j * 2.2 + boil * 1.7 + k) * R * 0.025;
            const px = Math.cos(a) * (rr + wob), py = Math.sin(a) * (rr + wob);
            if (j) ctx.lineTo(px, py); else ctx.moveTo(px, py);
          }
          ctx.stroke();
        }
        ctx.restore();
      }
    } else {
      drawShatter(rock, R, pose.after);
    }
    ctx.restore();
    if (pose.after <= 0 && R > 10) drawTag(st, x, y, R, clamp((R - 10) / 20) * (1 - clamp((heat - 0.85) / 0.15)));
  }

  function drawLabel(st, R, dy = 0) {
    if (!st.label) return;
    const size = R * 0.2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.font = `${Math.round(size * 0.5)}px Bangers, Impact, sans-serif`;
    ctx.lineWidth = Math.max(2, size * 0.1);
    ctx.strokeStyle = C.ink;
    ctx.fillStyle = C.paper;
    ctx.strokeText(st.num, 0, dy - size * 0.8);
    ctx.fillText(st.num, 0, dy - size * 0.8);
    let fs = size;
    ctx.font = `${Math.round(fs)}px Bangers, Impact, sans-serif`;
    const wdt = ctx.measureText(st.label).width;
    if (wdt > R * 1.5) {
      fs *= (R * 1.5) / wdt;
      ctx.font = `${Math.round(fs)}px Bangers, Impact, sans-serif`;
    }
    ctx.lineWidth = Math.max(2.5, fs * 0.14);
    ctx.fillStyle = C.yellow;
    ctx.strokeText(st.label, 0, dy + size * 0.15);
    ctx.fillText(st.label, 0, dy + size * 0.15);
  }

  function drawShatter(rock, R, c) {
    const e = easeOut(c);
    if (c < 0.55) {
      ctx.save();
      const s = easeBack(clamp(c / 0.12)) * (1 + c * 0.5);
      ctx.globalAlpha = 1 - clamp((c - 0.28) / 0.27);
      ctx.scale(R * s, R * s);
      shape(burst(18, 1.45, 1.0, 5, 0.3), C.yellow, 4 / (R * s));
      poly(burst(18, 1.08, 0.82, 9, 0.25));
      ctx.fillStyle = '#fffbe8';
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1 - clamp((c - 0.72) / 0.28);
    for (const d of rock.debris) {
      const dist = (0.55 + d.sp * 2.8 * e) * R;
      const sz = d.sz * R * (1 + e);
      ctx.save();
      ctx.translate(Math.cos(d.a) * dist, Math.sin(d.a) * dist);
      ctx.rotate(d.spin * e + d.seed);
      shape([[-sz, -sz * 0.6], [sz * 0.9, -sz * 0.4], [sz * 0.2, sz]], C.rockDark, Math.max(1, sz * 0.25));
      ctx.restore();
    }
    for (const sh of rock.shards) {
      const d = (0.08 + 1.7 * e * sh.speed) * R;
      ctx.save();
      ctx.translate(sh.dir[0] * d, sh.dir[1] * d);
      ctx.scale(1 + e * 0.5, 1 + e * 0.5);
      ctx.translate(sh.c[0] * R, sh.c[1] * R);
      ctx.rotate(sh.spin * e);
      ctx.translate(-sh.c[0] * R, -sh.c[1] * R);
      paintRock(rock, sh.pts, R);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- other arrivals ---------- */

  function ring(r, color, lw, alpha) {
    if (alpha <= 0 || r <= 0) return;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    outline(lw, color, 5);
    ctx.globalAlpha = 1;
  }

  function paintProbe(S, lw, blink) {
    for (const sg of [-1, 1]) {
      shape([[sg * 0.3 * S, -0.04 * S], [sg * 0.52 * S, -0.04 * S], [sg * 0.52 * S, 0.04 * S], [sg * 0.3 * S, 0.04 * S]], C.hullShade, lw * 0.8);
      poly([[sg * 0.5 * S, -0.26 * S], [sg * 1.25 * S, -0.26 * S], [sg * 1.25 * S, 0.26 * S], [sg * 0.5 * S, 0.26 * S]], lw * 0.3, sg + 4);
      ctx.fillStyle = C.cyan;
      ctx.fill();
      ctx.fillStyle = dots('rgba(14,10,22,0.35)', 6, 1.4);
      ctx.fill();
      ink(lw);
      ctx.beginPath();
      for (const f of [0.75, 1]) { ctx.moveTo(sg * f * S, -0.26 * S); ctx.lineTo(sg * f * S, 0.26 * S); }
      ctx.moveTo(sg * 0.5 * S, 0);
      ctx.lineTo(sg * 1.25 * S, 0);
      ctx.lineWidth = lw * 0.5;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, -0.34 * S);
    ctx.lineTo(0, -0.58 * S);
    ink(lw);
    ctx.beginPath();
    ctx.ellipse(0, -0.6 * S, 0.24 * S, 0.1 * S, 0, Math.PI, TAU);
    ctx.closePath();
    ctx.fillStyle = C.hull;
    ctx.fill();
    ink(lw);
    const body = [];
    for (let i = 0; i < 8; i++) body.push([Math.cos(i / 8 * TAU + 0.39) * 0.38 * S, Math.sin(i / 8 * TAU + 0.39) * 0.38 * S]);
    shape(body, C.hull, lw, lw * 0.3, 8);
    shape(body.map(([x, y]) => [x * 0.55 + 0.04 * S, y * 0.55 + 0.05 * S]), C.yellow, lw * 0.7);
    disc(0.22 * S, -0.2 * S, 0.06 * S, blink ? C.red : C.rockDark, lw * 0.6);
  }

  function tractorBeam(tx, ty, w, alpha, time) {
    const sx = ship.x, sy = ship.y - ship.s * 0.3;
    ctx.save();
    ctx.globalAlpha = alpha;
    poly([[sx - ship.s * 0.12, sy], [tx - w, ty], [tx + w, ty], [sx + ship.s * 0.12, sy]]);
    ctx.fillStyle = 'rgba(63,208,240,0.22)';
    ctx.fill();
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -time / 25;
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.cyan;
    ctx.beginPath();
    ctx.moveTo(sx - ship.s * 0.12, sy);
    ctx.lineTo(tx - w, ty);
    ctx.moveTo(sx + ship.s * 0.12, sy);
    ctx.lineTo(tx + w, ty);
    ctx.stroke();
    ctx.restore();
  }

  function drawProbe(st, time) {
    const a = inbound(st.p), e = easeOut(a);
    const after = outbound(st.p);
    const x = W / 2 + lerp(st.side * W * 0.62, 0, e);
    const y = H / 2 + lerp(H * 0.02, -H * 0.3, e);
    const S = st.R * 0.3 * lerp(0.35, 1, e);
    const lw = clamp(S * 0.035, 1.2, 4.5);
    const blink = Math.floor(time / 450) % 2 === 0;
    if (!after) {
      if (a > 0.45) tractorBeam(x, y + S * 0.3, S * 0.4, clamp((a - 0.45) / 0.3), time);
      ctx.save();
      ctx.translate(x, y);
      ctx.save();
      ctx.rotate(Math.sin(time * 0.0009) * 0.08 + st.side * 0.5 * (1 - e));
      paintProbe(S, lw, blink);
      ctx.restore();
      if (S > 30) drawLabel(st, S * 1.3, S * 0.75);
      ctx.restore();
      return 0;
    }
    const c = after, ec = easeOut(c);
    ctx.save();
    ctx.translate(x, y);
    ring(S * (0.6 + ec * 3.4), C.cyan, Math.max(2, S * 0.05 * (1 - c)), 1 - c * 1.5);
    ring(S * (0.5 + easeOut(clamp(c * 1.6)) * 2.2), C.yellow, Math.max(2, S * 0.03), 0.9 - c * 2.2);
    if (c < 0.14) {
      ctx.save();
      ctx.scale(S, S);
      poly(burst(10, 0.75, 0.45, 13, 0.3));
      ctx.fillStyle = C.yellow;
      ctx.globalAlpha = 1 - c / 0.14;
      ctx.fill();
      ink(lw / S);
      ctx.restore();
    }
    ctx.globalAlpha = 1 - clamp((c - 0.55) / 0.45);
    ctx.translate(st.side * W * 0.36 * ec, -H * 0.28 * ec);
    ctx.rotate(st.side * ec * 0.6);
    paintProbe(S * (1 - ec * 0.55), lw, blink);
    ctx.globalAlpha = 1;
    ctx.restore();
    return 0;
  }

  function paintBeacon(S, lw, time) {
    ctx.beginPath();
    ctx.moveTo(-0.35 * S, 0.9 * S);
    ctx.lineTo(0, 0.1 * S);
    ctx.lineTo(0.35 * S, 0.9 * S);
    ctx.moveTo(-0.22 * S, 0.55 * S);
    ctx.lineTo(0.22 * S, 0.55 * S);
    ctx.moveTo(0, 0.1 * S);
    ctx.lineTo(0, -0.3 * S);
    outline(lw, C.hullShade, lw * 1.4);
    ctx.beginPath();
    ctx.arc(0, -0.05 * S, 0.42 * S, Math.PI * 1.15, Math.PI * 1.85);
    outline(lw, C.hull, lw * 1.4);
    disc(0, -0.34 * S, 0.13 * S, Math.floor(time / 300) % 2 ? C.cyan : C.paper, lw);
  }

  // The tower never comes close: the threat is the wavefront, timed to reach the ship at IMPACT.
  function drawSignal(st, time) {
    const a = inbound(st.p);
    const after = outbound(st.p);
    const bx = vp.x + st.side * W * 0.14, by = vp.y - H * 0.12;
    const S = clamp(st.R * 0.1 * (1 + a * 0.8), 16, 80);
    const lw = clamp(S * 0.06, 1.2, 4);
    ctx.save();
    ctx.translate(bx, by);
    if (!after) {
      for (let i = 0; i < 4; i++) {
        const ph = (time / 1100 + i / 4) % 1;
        ring(S * (0.6 + ph * 3), i % 2 ? C.mint : C.cyan, Math.max(1.5, S * 0.07), (1 - ph) * 0.8);
      }
      const reach = Math.hypot(ship.x - bx, ship.y - by);
      const front = reach * a ** 1.7;
      if (a > 0.08) {
        ring(front, C.cyan, clamp(4 + a * 10, 4, 14), clamp((a - 0.08) * 5));
        ring(front * 0.86, C.mint, clamp(2 + a * 6, 2, 8), clamp((a - 0.08) * 4) * 0.8);
      }
      ctx.save();
      ctx.rotate(Math.sin(time * 0.0012) * 0.15);
      paintBeacon(S, lw, time);
      ctx.restore();
      const LR = clamp(st.R * 0.32, 80, 170);
      drawLabel(st, LR, -S * 0.9 - LR * 0.12);
      ctx.restore();
      return 0;
    }
    const c = after;
    const reach = Math.hypot(W, H);
    for (let i = 0; i < 3; i++) {
      const ci = clamp(c * 1.8 - i * 0.12);
      ring(reach * easeOut(ci) * 0.9 + S, i % 2 ? C.mint : C.cyan, Math.max(2, 10 * (1 - ci)), 1 - ci);
    }
    ctx.globalAlpha = 1 - clamp(c * 2);
    paintBeacon(S, lw, time);
    ctx.globalAlpha = 1;
    ctx.restore();
    if (c < 0.22) {
      const r = rng(Math.floor(time / 60) + 7);
      ctx.save();
      ctx.globalAlpha = 0.55 * (1 - c / 0.22);
      for (let i = 0; i < 14; i++) {
        const y = r() * H, h = 2 + r() * 14;
        ctx.fillStyle = r() > 0.5 ? C.cyan : C.mint;
        ctx.fillRect((r() - 0.5) * W * 0.2, y, W * (0.4 + r() * 0.8), h);
      }
      ctx.restore();
    }
    return 0;
  }

  function drawDyingStar(st, time) {
    const pose = approach(st.p, st.side, st.side * W * 0.3, -H * 0.16);
    const S = st.R * 0.36 * pose.k;
    if (S < 1.5) return 0;
    const lw = clamp(S * 0.03, 1.2, 4.5);
    const a = pose.a, c = pose.after, e = easeOut(c);
    const t = reduce ? 0 : time;
    const x = W / 2 + pose.x, y = H / 2 + pose.y;
    ctx.save();
    ctx.translate(x, y);
    if (c > 0 && c < 0.3) {
      // Layers pop off one by one, outermost first, instead of fading: translucent orange over space turns to mud.
      ctx.save();
      for (const [grow, base, col, seed, gone] of [[3.4, 1.1, C.orange, 21, 0.2], [2.6, 0.9, C.yellow, 33, 0.25], [1.7, 0.7, '#fffbe8', 47, 0.3]]) {
        if (c >= gone) continue;
        const fs = S * (base + e * grow);
        ctx.save();
        ctx.scale(fs, fs);
        shape(burst(18, 1, 0.7, seed, 0.35), col, 3 / fs);
        ctx.restore();
      }
      ctx.lineCap = 'round';
      for (let i = 0; i < 26 && c < 0.25; i++) {
        const ang = (i / 26) * TAU + hash(i * 1.7) * 0.2;
        const r0 = S * (1.3 + e * 3.6) * (0.9 + hash(i * 2.9) * 0.3), r1 = r0 + S * (0.4 + e * 1.4);
        line(Math.cos(ang) * r0, Math.sin(ang) * r0, Math.cos(ang) * r1, Math.sin(ang) * r1, Math.max(2, S * 0.05), i % 3 ? C.paper : C.yellow);
      }
      ctx.restore();
    }
    if (c > 0) {
      ctx.save();
      ctx.globalAlpha = 0.85 * (1 - clamp((c - 0.5) / 0.5));
      ctx.beginPath();
      ctx.ellipse(0, 0, S * (0.8 + e * 2.6), S * (0.55 + e * 1.7), -0.4, 0, TAU);
      ctx.lineWidth = Math.max(2, S * 0.1 * (1 - c));
      ctx.strokeStyle = C.mint;
      ctx.stroke();
      ctx.restore();
    }
    // Uneven throb that gets stronger as the star nears collapse.
    const pulse = 1 + (0.02 + 0.05 * a) * Math.sin(t * 0.0042 + st.idx) + 0.025 * a * Math.sin(t * 0.0113);
    const r = S * (1 - 0.72 * e) * (c ? 1 : pulse);
    const surface = mix('#ff7a3d', '#b81d3a', a);
    const body = c > 0 ? mix('#b81d3a', '#dff6ff', clamp(c * 1.8)) : surface;
    ctx.globalAlpha = 1 - clamp((c - 0.75) / 0.25);
    ctx.save();
    ctx.scale(r, r);
    ctx.rotate(t * 0.00008);
    shape(burst(14, 1.36 + (c ? 0 : 0.08 * Math.sin(t * 0.003)), 1.06, 3 + st.idx, 0.32), c ? mix('#ff8a2b', '#9fd8ff', clamp(c * 1.8)) : mix('#ff8a2b', '#6e1424', a), lw / r);
    ctx.restore();
    if (!c) {
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const ang = i * 2.1 + 0.6 + st.idx;
        const grow = 0.5 + 0.5 * Math.sin(t * 0.0021 + i * 2.4);
        const h = r * (0.18 + 0.42 * grow * (0.4 + 0.6 * a));
        const p0 = [Math.cos(ang - 0.22) * r * 0.96, Math.sin(ang - 0.22) * r * 0.96];
        const p1 = [Math.cos(ang + 0.22) * r * 0.96, Math.sin(ang + 0.22) * r * 0.96];
        const cp = [Math.cos(ang) * (r + h * 1.9), Math.sin(ang) * (r + h * 1.9)];
        for (const [wd, col] of [[r * 0.06 + lw * 2, C.ink], [r * 0.06, C.orange], [r * 0.022, C.yellow]]) {
          ctx.beginPath();
          ctx.moveTo(p0[0], p0[1]);
          ctx.quadraticCurveTo(cp[0], cp[1], p1[0], p1[1]);
          ctx.lineWidth = Math.max(1, wd);
          ctx.strokeStyle = col;
          ctx.stroke();
        }
      }
    }
    disc(0, 0, r, body, lw);
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.clip();
    ctx.fillStyle = dots(`rgba(14,10,22,${0.25 + a * 0.3})`, 7, 1.8);
    ctx.fillRect(-r, -r, r * 2, r * 2);
    if (!c) {
      for (let i = 0; i < 4; i++) {
        const sa = (i / 4) * TAU + hash(i * 5.3 + st.idx) * 0.9, sd = (0.3 + hash(i * 7.9) * 0.35) * r;
        const sr = r * (0.07 + hash(i * 2.2) * 0.1) * (0.6 + a);
        ctx.beginPath();
        ctx.ellipse(Math.cos(sa) * sd, Math.sin(sa) * sd, sr * 1.3, sr, sa, 0, TAU);
        ctx.fillStyle = `rgba(90,15,31,${0.35 + a * 0.6})`;
        ctx.fill();
        ctx.lineWidth = Math.max(1, lw * 0.5);
        ctx.strokeStyle = C.ink;
        ctx.stroke();
      }
    }
    disc(-r * 0.35, -r * 0.35, r * 0.34, `rgba(255,251,232,${c ? 0.6 : 0.4 * (1 - a)})`);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.restore();
    if (!c && S > 10) {
      const alpha = clamp((S - 10) / 20) * (1 - clamp((a - 0.93) / 0.07));
      const alert = a >= 0.7;
      drawTag(st, x, y, r * 1.4, alpha, alert
        ? { top: `ANOMALY DETECTED · ${st.num.toUpperCase()}`, fill: C.red, text: C.paper }
        : { top: `MONITORING · ${st.num.toUpperCase()}` });
    }
    return -st.side * 1.1 * easeInOut(pose.a) * (1 - clamp(c / 0.35));
  }

  const qpt = (a, c, b, t) => [
    (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
    (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]
  ];

  function paintPhoneSat(S, lw, time) {
    for (const sg of [-1, 1]) {
      shape([[sg * 0.45 * S, -0.3 * S], [sg * 1.05 * S, -0.42 * S], [sg * 1.05 * S, 0.1 * S], [sg * 0.45 * S, 0.12 * S]], C.cyan, lw);
    }
    ctx.beginPath();
    ctx.roundRect(-0.48 * S, -0.82 * S, 0.96 * S, 1.64 * S, 0.16 * S);
    ctx.fillStyle = C.mint;
    ctx.fill();
    ink(lw * 1.2);
    ctx.beginPath();
    ctx.roundRect(-0.38 * S, -0.66 * S, 0.76 * S, 1.2 * S, 0.06 * S);
    ctx.fillStyle = '#151030';
    ctx.fill();
    ink(lw * 0.8);
    ctx.fillStyle = C.lime;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(S * 0.36)}px Bangers, Impact, sans-serif`;
    ctx.fillText('</>', 0, -0.12 * S);
    if (Math.floor(time / 400) % 2) ctx.fillRect(-0.24 * S, 0.22 * S, 0.3 * S, 0.06 * S);
    ctx.fillRect(-0.24 * S, 0.34 * S, 0.44 * S, 0.06 * S);
    ctx.beginPath();
    ctx.roundRect(-0.12 * S, 0.82 * S, 0.24 * S, 0.12 * S, 0.03 * S);
    ctx.fillStyle = C.hullShade;
    ctx.fill();
    ink(lw * 0.8);
  }

  function drawPlug(st, time) {
    const a = inbound(st.p), e = easeOut(a);
    const after = outbound(st.p), ae = easeOut(after);
    const x = W / 2 + lerp(st.side * W * 0.5, st.side * W * 0.16, e) + st.side * W * 0.3 * ae;
    const y = H / 2 + lerp(-H * 0.55, -H * 0.24, e) - H * 0.3 * ae;
    const S = st.R * 0.2 * lerp(0.3, 1, e);
    const lw = clamp(S * 0.04, 1.2, 4);
    const port = [x, y + S * 0.94];
    const nose = [ship.x, ship.y - ship.s * 0.32];
    const reach = after ? clamp(1 - (after - 0.45) / 0.3) : clamp((a - 0.45) / 0.55);
    if (reach > 0) {
      const ctrl = [lerp(nose[0], port[0], 0.5) - st.side * W * 0.12 + Math.sin(time * 0.003) * 14, lerp(nose[1], port[1], 0.5) + H * 0.06];
      const end = qpt(nose, ctrl, port, reach);
      ctx.beginPath();
      ctx.moveTo(nose[0], nose[1]);
      for (let i = 1; i <= 24; i++) {
        const q = qpt(nose, ctrl, port, (i / 24) * reach);
        ctx.lineTo(q[0], q[1]);
      }
      outline(4, C.mint, 5);
      if (after && after < 0.45) {
        for (let i = 0; i < 4; i++) {
          const q = qpt(nose, ctrl, port, 1 - ((time / 700 + i / 4) % 1));
          disc(q[0], q[1], 6, C.yellow, 2.5);
        }
      }
      ctx.save();
      ctx.translate(end[0], end[1]);
      shape([[-8, -4], [8, -4], [8, 10], [-8, 10]], C.hull, 2.5);
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = 1 - clamp((after - 0.6) / 0.4);
    ctx.translate(x, y);
    if (after && after < 0.14) {
      ctx.save();
      ctx.translate(0, S * 0.94);
      ctx.scale(S * 0.7, S * 0.7);
      poly(burst(9, 1, 0.45, 31, 0.35));
      ctx.fillStyle = C.yellow;
      ctx.globalAlpha = 1 - after / 0.14;
      ctx.fill();
      ink(2 / (S * 0.7));
      ctx.restore();
    }
    ctx.save();
    ctx.rotate(Math.sin(time * 0.001) * 0.06 + st.side * 0.3 * (1 - e));
    paintPhoneSat(S, lw, time);
    ctx.restore();
    if (!after && S > 24) drawLabel(st, clamp(S * 1.6, 60, 170), -S * 1.25);
    ctx.restore();
    ctx.globalAlpha = 1;
    return 0;
  }

  function corners(x0, y0, x1, y1, len, color, lw) {
    ctx.beginPath();
    for (const [cx, cy, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      ctx.moveTo(cx + dx * len, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + dy * len);
    }
    outline(lw, color, 4);
  }

  function tag(text, x, y, size, bg) {
    ctx.font = `${Math.round(size)}px Bangers, Impact, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + size * 0.6;
    ctx.fillStyle = bg;
    ctx.fillRect(x, y - size * 0.65, w, size * 1.3);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = C.ink;
    ctx.strokeRect(x, y - size * 0.65, w, size * 1.3);
    ctx.fillStyle = C.ink;
    ctx.fillText(text, x + size * 0.3, y + 1);
  }

  function paintDrone(S, lw, time) {
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(sx * 0.95 * S, sy * 0.5 * S);
      outline(lw * 1.2, C.hullShade, lw * 1.4);
      ctx.beginPath();
      ctx.ellipse(sx * 0.95 * S, sy * 0.5 * S - 0.1 * S, 0.42 * S, 0.1 * S, 0, 0, TAU);
      ctx.fillStyle = 'rgba(232,236,242,0.35)';
      ctx.fill();
      ctx.lineWidth = lw * 0.6;
      ctx.strokeStyle = C.ink;
      ctx.stroke();
      const sp = time * 0.05 * sx;
      ctx.beginPath();
      ctx.moveTo(sx * 0.95 * S + Math.cos(sp) * 0.4 * S, sy * 0.5 * S - 0.1 * S + Math.sin(sp) * 0.08 * S);
      ctx.lineTo(sx * 0.95 * S - Math.cos(sp) * 0.4 * S, sy * 0.5 * S - 0.1 * S - Math.sin(sp) * 0.08 * S);
      ctx.lineWidth = lw;
      ctx.stroke();
    }
    disc(0, 0, 0.58 * S, C.hull, lw * 1.2);
    disc(0, 0.04 * S, 0.36 * S, '#151030', lw);
    ctx.beginPath();
    ctx.arc(0, 0.04 * S, 0.26 * S, 0, TAU);
    ctx.lineWidth = lw;
    ctx.strokeStyle = C.lime;
    ctx.stroke();
    disc(0, 0.04 * S, 0.1 * S, C.red);
    disc(-0.1 * S, -0.06 * S, 0.05 * S, C.paper);
  }

  function drawDrone(st, time) {
    const a = inbound(st.p), e = easeOut(a);
    const after = outbound(st.p), ae = easeOut(after);
    const x = W / 2 + lerp(vp.x - W / 2 - st.side * W * 0.1, st.side * W * 0.12, e) + Math.sin(time * 0.0015) * 10;
    const y = H / 2 + lerp(vp.y - H / 2 - H * 0.1, -H * 0.24, e) - H * 0.5 * ae + Math.sin(time * 0.002) * 6;
    const S = st.R * 0.17 * lerp(0.12, 1, e) * (1 - ae * 0.4);
    const lw = clamp(S * 0.05, 1.2, 4);
    if (!after && a > 0.35) {
      const k = clamp((a - 0.35) / 0.25);
      const bx0 = ship.x - ship.s * 1.25, bx1 = ship.x + ship.s * 1.25;
      const by0 = ship.y - ship.s * 0.75, by1 = ship.y + ship.s * 0.55;
      ctx.save();
      ctx.globalAlpha = k;
      poly([[x - S * 0.2, y], [bx0, by1], [bx1, by1], [x + S * 0.2, y]]);
      ctx.fillStyle = 'rgba(155,227,90,0.14)';
      ctx.fill();
      const sy = lerp(by0, by1, 0.5 + 0.5 * Math.sin(time * 0.006));
      ctx.beginPath();
      ctx.moveTo(bx0, sy);
      ctx.lineTo(bx1, sy);
      ctx.lineWidth = 3;
      ctx.strokeStyle = C.lime;
      ctx.stroke();
      if (a > 0.6) {
        corners(bx0, by0, bx1, by1, ship.s * 0.3, C.lime, 3.5);
        tag('SHIP · 98%', bx0, by0 - 16, 15, C.lime);
      }
      ctx.restore();
    }
    if (after && after < 0.35) {
      const m = 28, k = 1 - after / 0.35;
      ctx.save();
      ctx.globalAlpha = k;
      corners(m, m + 50, W - m, H - m, 60, C.paper, 4);
      if (Math.floor(time / 350) % 2) disc(m + 26, m + 82, 9, C.red, 2.5);
      ctx.font = '22px Bangers, Impact, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = C.paper;
      ctx.fillText('REC', m + 44, m + 83);
      ctx.restore();
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 1 - clamp((after - 0.5) / 0.4);
    ctx.rotate(Math.sin(time * 0.0017) * 0.08);
    paintDrone(S, lw, time);
    ctx.restore();
    ctx.globalAlpha = 1;
    if (!after && S > 20) {
      ctx.save();
      ctx.translate(x, y);
      drawLabel(st, clamp(S * 2, 60, 170), -S * 1.1 - 20);
      ctx.restore();
    }
    return 0;
  }

  const MOON_TINTS = [['#d8cfe8', '#8f84a8'], ['#f2e2c0', '#a8916a'], ['#cfe6e0', '#7fa39a']];

  function paintMoon(r, i, lw) {
    const [lite, dark] = MOON_TINTS[i];
    disc(0, 0, r, dark, 0);
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.clip();
    disc(-r * 0.12, -r * 0.12, r * 0.92, lite);
    ctx.fillStyle = dots('rgba(14,10,22,0.3)', 6, 1.5);
    ctx.fillRect(-r, -r, r * 2, r * 2);
    for (let j = 0; j < 4; j++) {
      const cx = (hash(i * 9 + j) - 0.5) * r * 1.1, cy = (hash(i * 9 + j + 4) - 0.5) * r * 1.1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * (0.12 + 0.1 * hash(j + i)), r * (0.09 + 0.08 * hash(j + i)), 0.3, 0, TAU);
      ctx.fillStyle = dark;
      ctx.fill();
      ctx.lineWidth = lw * 0.6;
      ctx.strokeStyle = C.ink;
      ctx.stroke();
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ink(lw);
  }

  function zap(x0, y0, x1, y1, seed) {
    const n = 7;
    const pts = [[x0, y0]];
    for (let i = 1; i < n; i++) {
      const t = i / n;
      pts.push([lerp(x0, x1, t), lerp(y0, y1, t) + (hash(seed + i + boil * 0.7) - 0.5) * 34]);
    }
    pts.push([x1, y1]);
    for (const [w, col] of [[9, C.ink], [4.5, C.orange], [1.8, C.yellow]]) {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.lineWidth = w;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = col;
      ctx.stroke();
    }
  }

  // Three moons arrive one after another and lock into a row at IMPACT, like three streams syncing.
  function drawMoons(st, time) {
    const after = outbound(st.p), ae = easeOut(after);
    const pos = [];
    for (let i = 0; i < 3; i++) {
      const a = clamp(st.p / (IMPACT * (0.82 + i * 0.09)));
      const e = easeOut(a);
      const r = st.R * 0.13 * lerp(0.1, 1, e) * (1 - ae * 0.3);
      const x = W / 2 + lerp(vp.x - W / 2 + (i - 1) * W * 0.06, (i - 1) * W * 0.27, e) + (i - 1) * W * 0.25 * ae;
      const y = H / 2 + lerp(vp.y - H / 2 - H * 0.08, -H * 0.27, e) - H * 0.25 * ae + Math.sin(time * 0.0012 + i * 2) * 5;
      pos.push([x, y, r, a]);
    }
    const linked = after > 0 && after < 0.6;
    if (linked) {
      ctx.save();
      ctx.globalAlpha = 1 - clamp((after - 0.4) / 0.2);
      for (let i = 0; i < 2; i++) zap(pos[i][0] + pos[i][2], pos[i][1], pos[i + 1][0] - pos[i + 1][2], pos[i + 1][1], i * 13 + 5);
      ctx.restore();
    }
    ctx.globalAlpha = 1 - clamp((after - 0.6) / 0.4);
    pos.forEach(([x, y, r, a], i) => {
      if (r < 1.5) return;
      ctx.save();
      ctx.translate(x, y);
      if (a >= 1 && !after) ring(r * (1.1 + ((time / 900 + i / 3) % 1) * 0.5), C.lime, 3, 1 - ((time / 900 + i / 3) % 1));
      paintMoon(r, i, clamp(r * 0.05, 1.2, 4));
      ctx.restore();
    });
    ctx.globalAlpha = 1;
    const mid = pos[1];
    if (!after && mid[2] > 18) {
      ctx.save();
      ctx.translate(mid[0], mid[1]);
      drawLabel(st, clamp(mid[2] * 2.2, 60, 170), mid[2] * 1.6 + 10);
      ctx.restore();
    }
    return 0;
  }

  // The ship flies through the docking ring: it outgrows the screen at IMPACT.
  function drawStation(st, time) {
    const a = inbound(st.p);
    const after = outbound(st.p);
    if (after > 0.4) return 0;
    const cx = lerp(vp.x, W / 2, a), cy = lerp(vp.y - H * 0.04, H * 0.4, a);
    const r = lerp(st.R * 0.05, Math.hypot(W, H) * 0.95, a ** 5) * (1 + after * 3);
    const inner = r * 0.74;
    const open = easeInOut(clamp((a - 0.72) / 0.22));
    const lw = clamp(r * 0.02, 1.5, 6);
    const t = reduce ? 0 : time;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalAlpha = 1 - clamp(after / 0.4);

    for (const sg of [-1, 1]) {
      line(sg * r * 0.98, 0, sg * r * 1.18, 0, lw * 2.2);
      const x0 = sg * r * 1.16, x1 = sg * r * 2.06;
      shape([[x0, -r * 0.27], [x1, -r * 0.27], [x1, r * 0.27], [x0, r * 0.27]], '#2b4fa0', lw);
      ctx.beginPath();
      for (let k = 1; k < 6; k++) { const gx = lerp(x0, x1, k / 6); ctx.moveTo(gx, -r * 0.27); ctx.lineTo(gx, r * 0.27); }
      ctx.moveTo(x0, 0);
      ctx.lineTo(x1, 0);
      ctx.lineWidth = Math.max(1, lw * 0.5);
      ctx.strokeStyle = 'rgba(63,208,240,0.7)';
      ctx.stroke();
    }
    line(0, -r * 0.98, 0, -r * 1.3, lw * 1.6);
    ctx.beginPath();
    ctx.ellipse(0, -r * 1.3, r * 0.17, r * 0.065, 0, Math.PI, TAU);
    ctx.closePath();
    ctx.fillStyle = C.hull;
    ctx.fill();
    ink(lw);
    disc(0, -r * 1.42, Math.max(2, r * 0.045), Math.floor(t / 450) % 2 ? C.red : '#7a1f1f', lw * 0.7);

    ctx.save();
    ctx.translate(0, r * 0.07);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.arc(0, 0, inner, 0, TAU, true);
    ctx.fillStyle = C.hullShade;
    ctx.fill('evenodd');
    ink(lw * 1.4);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, inner, 0, TAU);
    ctx.clip();
    if (open > 0) {
      // The corridor behind the door: lit rings rushing outward past the ship.
      ctx.fillStyle = '#120d26';
      ctx.fillRect(-inner, -inner, inner * 2, inner * 2);
      const ph = (t * 0.0011 + a * 6 + after * 4) % 1;
      for (let k = 0; k < 10; k++) {
        const d = ((k + ph) % 10) / 10;
        const rr = inner * (0.06 + 1.05 * d ** 2.2);
        ctx.beginPath();
        ctx.arc(0, 0, rr, 0, TAU);
        ctx.lineWidth = Math.max(1.5, lw * 2.6 * d);
        ctx.strokeStyle = C.ink;
        ctx.stroke();
        ctx.lineWidth = Math.max(1, lw * 1.6 * d);
        ctx.strokeStyle = C.hullShade;
        ctx.stroke();
        for (let j = 0; j < 8; j++) {
          const ang = (j / 8) * TAU + k * 0.4;
          disc(Math.cos(ang) * rr, Math.sin(ang) * rr, Math.max(1, lw * 1.1 * d), j % 2 ? C.yellow : C.cyan);
        }
      }
      const exit = ctx.createRadialGradient(0, 0, 0, 0, 0, inner * (0.22 + after * 0.6));
      exit.addColorStop(0, '#fffbe8');
      exit.addColorStop(0.5, C.yellow);
      exit.addColorStop(1, 'rgba(255,210,63,0)');
      ctx.fillStyle = exit;
      ctx.fillRect(-inner, -inner, inner * 2, inner * 2);
    }
    if (open < 1) {
      for (const sg of [-1, 1]) {
        const off = sg * open * inner;
        shape([[off, -inner], [off + sg * inner, -inner], [off + sg * inner, inner], [off, inner]], C.hullShade, lw);
        ctx.beginPath();
        for (let k = -3; k <= 3; k++) {
          ctx.moveTo(off + sg * inner * 0.08, k * inner * 0.22);
          ctx.lineTo(off + sg * inner * 0.3, k * inner * 0.22 + inner * 0.1);
        }
        ctx.lineWidth = lw * 1.4;
        ctx.strokeStyle = C.yellow;
        ctx.stroke();
      }
    }
    ctx.beginPath();
    ctx.rect(-inner, -inner, inner * 2, inner * 2);
    ctx.arc(0, r * 0.07, inner, 0, TAU, true);
    ctx.fillStyle = C.hullShade;
    ctx.fill('evenodd');
    ctx.restore();

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.arc(0, 0, inner, 0, TAU, true);
    ctx.fillStyle = C.hull;
    ctx.fill('evenodd');
    ctx.save();
    ctx.clip('evenodd');
    ctx.fillStyle = dots('rgba(14,10,22,0.28)', 7, 1.7);
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ink(lw * 1.4);
    ctx.beginPath();
    ctx.arc(0, 0, inner, 0, TAU);
    ink(lw * 1.4);
    const spin = t * 0.00025;
    ctx.beginPath();
    for (let k = 0; k < 12; k++) {
      const ang = spin + (k / 12) * TAU;
      ctx.moveTo(Math.cos(ang) * inner, Math.sin(ang) * inner);
      ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
    }
    ctx.lineWidth = lw;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
    for (let k = 0; k < 24; k++) {
      const ang = -spin * 2 + (k / 24) * TAU;
      const on = (k + Math.floor(t / 200)) % 4 === 0;
      disc(Math.cos(ang) * (r + inner) / 2, Math.sin(ang) * (r + inner) / 2, Math.max(2, (r - inner) * 0.09), on ? C.yellow : C.orange, lw * 0.5);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    if (!after && r > 22) {
      const alpha = clamp((r - 22) / 30) * (1 - clamp((r - W * 0.2) / (W * 0.08)));
      if (alpha > 0) drawTag(st, cx, cy, r * 1.45, alpha, { top: `DOCKING · ${st.num.toUpperCase()}` });
    }
    return 0;
  }

  const ARRIVALS = {
    probe: drawProbe, signal: drawSignal, star: drawDyingStar,
    plug: drawPlug, scan: drawDrone, moons: drawMoons, station: drawStation
  };

  /* ---------- ship ---------- */

  // Unit coordinates, seen from behind: x across the wings, y down. Left-side parts are mirrored.
  const WING = [[-0.3, 0.02], [-1.08, 0.2], [-1.13, 0.31], [-0.32, 0.29]];
  const WING_SHADE = [[-0.32, 0.21], [-1.11, 0.26], [-1.13, 0.31], [-0.32, 0.29]];
  const WING_BAND = [[-0.72, 0.13], [-0.8, 0.15], [-0.81, 0.32], [-0.73, 0.32]];
  const FIN = [[-1.02, 0.21], [-1.08, -0.14], [-0.95, 0.19]];
  const FIN_CAP = [[-1.065, -0.05], [-1.08, -0.14], [-1.04, -0.04]];
  const BODY = [[-0.43, 0.04], [-0.3, -0.24], [0.3, -0.24], [0.43, 0.04], [0.33, 0.35], [-0.33, 0.35]];
  const BODY_SHADE = [[-0.43, 0.06], [0.43, 0.06], [0.33, 0.35], [-0.33, 0.35]];
  const STRIPE = [[-0.42, 0.0], [0.42, 0.0], [0.43, 0.07], [-0.43, 0.07]];
  const VENT = [[-0.33, -0.13], [-0.21, -0.13], [-0.21, -0.03], [-0.37, -0.03]];
  const TAIL = [[-0.055, -0.22], [-0.02, -0.6], [0.02, -0.6], [0.055, -0.22]];
  const TAIL_TIP = [[-0.03, -0.58], [0.03, -0.58], [0.025, -0.48], [-0.025, -0.48]];
  const ENGINES = [-0.2, 0.2];
  const ENGINE_Y = 0.2;
  const POD = { x: 0.62, y: 0.36 };
  const METAL = '#2a2833';
  const GLINT = 'rgba(255,255,255,0.8)';
  const mirror = pts => pts.map(([x, y]) => [-x, y]);
  const SIDES = [pts => pts, mirror];

  function jet(x, y, thrust, seed, lw) {
    const flick = reduce ? 0.5 : hash(boil * 1.3 + seed);
    ctx.save();
    ctx.translate(x, y);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.5 * thrust);
    glow.addColorStop(0, 'rgba(255,200,90,0.55)');
    glow.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(-0.6, -0.6, 1.2, 1.2);
    shape([[-0.08, 0], [0, 0.1 + 0.32 * thrust * (0.8 + flick * 0.4)], [0.08, 0]], C.orange, lw * 0.8, 0.03, seed);
    shape(burst(9, 0.13 + 0.06 * thrust * (0.7 + flick * 0.6), 0.085, seed + 10, 0.35), C.orange, lw * 0.8);
    disc(0, 0, 0.075, C.yellow);
    disc(0, 0, 0.04, '#fffbe8');
    ctx.restore();
  }

  function drawShip(x, y, s, bank, thrust, dark, time) {
    const hull = mix(C.hull, '#2a2140', dark);
    const shade = mix(C.hullShade, '#140e22', dark);
    const red = mix(C.red, '#5a2030', dark);
    const lw = clamp(s * 0.035, 2, 4.5) / s;
    const wob = clamp(s * 0.012, 0.4, 1.6) / s;
    const halftone = dots('rgba(14,10,22,0.55)', 6, 1.6, s);
    const lit = phase => reduce || Math.sin(time * 0.006 + phase) > 0.2;
    const ember = i => (reduce ? C.orange : `rgba(255,138,43,${0.55 + 0.45 * hash(boil + i)})`);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(bank);
    ctx.scale(s, s);

    for (const side of [-1, 1]) {
      const px = side * POD.x;
      line(px, POD.y - 0.09, px, POD.y, lw * 1.6);
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + i * Math.PI / 2;
        line(px, POD.y, px + Math.cos(a) * 0.085, POD.y + Math.sin(a) * 0.085, lw * 2.2);
        line(px, POD.y, px + Math.cos(a) * 0.08, POD.y + Math.sin(a) * 0.08, lw * 0.9, C.red);
      }
      disc(px, POD.y, 0.05, hull, lw * 0.8);
      disc(px, POD.y, 0.022, METAL);
    }

    SIDES.forEach((f, i) => {
      const at = (px, py) => f([[px, py]])[0];
      shape(f(FIN), hull, lw, wob, 21 + i);
      shape(f(FIN_CAP), red);

      poly(f(WING), wob, 31 + i);
      ctx.fillStyle = hull;
      ctx.fill();
      ctx.save();
      ctx.clip();
      shape(f(WING_SHADE), shade);
      ctx.fillStyle = halftone;
      ctx.fill();
      line(...at(-0.32, 0.045), ...at(-1.06, 0.215), lw * 0.9, GLINT);
      line(...at(-0.33, 0.15), ...at(-0.98, 0.235), lw * 0.45);
      for (let rx = 0.38; rx < 0.95; rx += 0.08) disc(...at(-rx, 0.125 + (rx - 0.33) * 0.13), 0.008, C.ink);
      for (const fx of [0.5, 0.66]) line(...at(-fx, 0.25), ...at(-fx - 0.01, 0.31), lw * 0.5);
      shape(f(WING_BAND), red);
      ctx.fillStyle = lit(i * 2.1) ? C.cyan : mix(C.cyan, C.ink, 0.55);
      ctx.fillRect(i ? 0.86 : -0.97, 0.13, 0.11, 0.07);
      ctx.restore();
      poly(f(WING), wob, 31 + i);
      ink(lw);
      if (lit(i * 1.5 + 0.8)) disc(...at(-1.08, -0.14), 0.035, i ? C.lime : C.red, lw * 0.7);
    });

    shape(TAIL, hull, lw, wob, 41);
    shape(TAIL_TIP, red);

    poly(BODY, wob, 51);
    ctx.fillStyle = hull;
    ctx.fill();
    ctx.save();
    ctx.clip();
    shape(BODY_SHADE, shade);
    ctx.fillStyle = halftone;
    ctx.fill();
    shape(STRIPE, red);
    line(-0.29, -0.215, 0.29, -0.215, lw * 0.9, GLINT);
    for (let rx = -0.38; rx <= 0.38; rx += 0.076) disc(rx, 0.035, 0.009, C.ink);
    for (const side of [-1, 1]) line(side * 0.37, 0.2, side * 0.33, 0.33, lw * 0.45);
    ctx.restore();
    poly(BODY, wob, 51);
    ink(lw);

    SIDES.forEach((f, i) => {
      shape(f(VENT), METAL, lw * 0.8, wob, 55 + i);
      const [[x0], [x1]] = f([[-0.315, 0], [-0.235, 0]]);
      line(x0, -0.1, x1, -0.1, lw * 0.6, ember(i * 2));
      line(x0, -0.06, x1, -0.06, lw * 0.6, ember(i * 2 + 1));
    });

    const canopy = () => {
      ctx.beginPath();
      ctx.ellipse(0, -0.24, 0.2, 0.13, 0, Math.PI, TAU);
      ctx.closePath();
    };
    canopy();
    ctx.fillStyle = mix(C.glass, '#1d2a44', dark);
    ctx.fill();
    ctx.save();
    ctx.clip();
    disc(0, -0.25, 0.075, mix(C.paper, '#3a3150', dark), lw * 0.7);
    ctx.fillStyle = red;
    ctx.fillRect(-0.017, -0.33, 0.034, 0.09);
    ctx.beginPath();
    ctx.ellipse(-0.11, -0.3, 0.05, 0.022, -0.5, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();
    ctx.restore();
    canopy();
    ink(lw);
    for (const side of [-1, 1]) line(side * 0.1, -0.35, side * 0.07, -0.24, lw * 0.7);

    for (const nx of ENGINES) {
      disc(nx, ENGINE_Y, 0.105, METAL, lw);
      ctx.beginPath();
      ctx.arc(nx, ENGINE_Y, 0.07, 0, TAU);
      ctx.strokeStyle = '#55526a';
      ctx.lineWidth = lw * 0.7;
      ctx.stroke();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU;
        disc(nx + Math.cos(a) * 0.088, ENGINE_Y + Math.sin(a) * 0.088, 0.007, '#8a87a0');
      }
    }
    if (lit(4.2)) disc(0, 0.29, 0.025, C.red, lw * 0.6);
    ENGINES.forEach((nx, i) => jet(nx, ENGINE_Y, thrust, 61 + i, lw));
    ctx.restore();
  }

  /* ---------- missiles ---------- */

  function fire(tx, ty, time) {
    fireSide = -fireSide;
    const x0 = ship.x + fireSide * ship.s * POD.x, y0 = ship.y + ship.s * POD.y;
    const dist = Math.hypot(tx - x0, ty - y0);
    missiles.push({
      x0, y0, tx, ty,
      cx: lerp(x0, tx, 0.2) + fireSide * ship.s * 1.3,
      cy: lerp(y0, ty, 0.3),
      t0: time, dur: 240 + dist * 0.42,
      s: ship.s, x: x0, y: y0, trail: []
    });
  }

  const MISSILE_BODY = [[-0.12, -0.3], [0.12, -0.3], [0.12, 0.4], [-0.12, 0.4]];
  const MISSILE_NOSE = [[-0.12, -0.3], [0, -0.66], [0.12, -0.3]];
  const MISSILE_FIN = [[-0.12, 0.12], [-0.32, 0.5], [-0.12, 0.4]];

  function drawMissile(m, k, angle, age) {
    for (let i = 0; i < m.trail.length; i++) {
      const [px, py, born] = m.trail[i];
      const life = clamp((age - born) / 520);
      if (life >= 1) continue;
      ctx.beginPath();
      ctx.arc(px, py, m.s * k * (0.07 + life * 0.16), 0, TAU);
      ctx.fillStyle = `rgba(251,241,220,${0.85 * (1 - life)})`;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(14,10,22,${0.7 * (1 - life)})`;
      ctx.stroke();
    }
    const size = m.s * 0.42 * k;
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(angle + Math.PI / 2);
    ctx.scale(size, size);
    const lw = 2.2 / size;
    const flick = hash(boil * 2.1 + m.t0);
    poly([[-0.1, 0.4], [0, 0.75 + flick * 0.35], [0.1, 0.4]]);
    ctx.fillStyle = C.orange; ctx.fill(); ink(lw);
    poly([[-0.05, 0.4], [0, 0.6 + flick * 0.15], [0.05, 0.4]]);
    ctx.fillStyle = C.yellow; ctx.fill();
    shape(MISSILE_FIN, C.red, lw);
    shape(mirror(MISSILE_FIN), C.red, lw);
    shape(MISSILE_BODY, C.hull, lw);
    shape(MISSILE_NOSE, C.red, lw);
    ctx.restore();
    if (age < 90) {
      ctx.save();
      ctx.translate(m.x0, m.y0);
      const r = m.s * 0.28 * (1 - age / 90);
      ctx.scale(r, r);
      poly(burst(8, 1, 0.5, m.t0, 0.3));
      ctx.fillStyle = C.yellow; ctx.fill(); ink(2 / r);
      ctx.restore();
    }
  }

  function updateMissiles(time, targets) {
    for (let i = missiles.length - 1; i >= 0; i--) {
      const m = missiles[i];
      const age = time - m.t0;
      const t = clamp(age / m.dur);
      const tt = t * (0.55 + 0.45 * t);
      const u = 1 - tt;
      const px = m.x, py = m.y;
      m.x = u * u * m.x0 + 2 * u * tt * m.cx + tt * tt * m.tx;
      m.y = u * u * m.y0 + 2 * u * tt * m.cy + tt * tt * m.ty;
      if (age > 0 && Math.hypot(m.x - px, m.y - py) > 0.5) m.trail.push([px, py, age]);
      if (m.trail.length > 18) m.trail.shift();

      const hit = targets.find(tg => Math.hypot(m.x - tg.x, m.y - tg.y) < tg.r);
      if (hit) {
        hit.st.blast = { p: hit.st.p, x: hit.x, y: hit.y, R: Math.max(hit.R, 60 * U), t0: time };
        missiles.splice(i, 1);
        if (api.onBlast) api.onBlast(hit.st);
        continue;
      }
      if (t >= 1) {
        pops.push({ x: m.tx, y: m.ty, t0: time, s: m.s * 0.5 });
        missiles.splice(i, 1);
        if (api.onPop) api.onPop();
        continue;
      }
      drawMissile(m, lerp(1, 0.5, tt), Math.atan2(m.y - py, m.x - px), age);
    }
  }

  function drawPops(time) {
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i];
      const c = (time - p.t0) / 420;
      if (c >= 1) { pops.splice(i, 1); continue; }
      const r = p.s * easeBack(clamp(c / 0.3)) * (1 + c * 0.4);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.globalAlpha = 1 - clamp((c - 0.5) / 0.5);
      ctx.scale(r, r);
      poly(burst(10, 1, 0.55, p.t0, 0.35));
      ctx.fillStyle = C.orange; ctx.fill(); ink(3 / r);
      poly(burst(10, 0.62, 0.36, p.t0 + 3, 0.3));
      ctx.fillStyle = C.yellow; ctx.fill();
      ctx.restore();
    }
  }

  function drawBlast(st, time) {
    const c = (time - st.blast.t0) / 1700;
    if (c >= 1) return;
    ctx.save();
    ctx.translate(st.blast.x, st.blast.y);
    drawShatter(rockFor(st.idx), st.blast.R, clamp(c));
    ctx.restore();
  }

  /* ---------- frame ---------- */

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    // Limit the continuously redrawn backdrop to roughly a 1920 × 1200 surface on Retina screens.
    const maxScale = Math.max(1, Math.sqrt((1920 * 1200) / (W * H)));
    DPR = Math.min(2, window.devicePixelRatio || 1, maxScale);
    U = Math.min(W, H) / 900;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    nebula = buildNebula();
    vignette = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    vignette.addColorStop(0, 'rgba(7,6,15,0)');
    vignette.addColorStop(1, 'rgba(7,6,15,0.85)');
    if (!stars.length || Math.abs(stars.length - (W * H) / 2300) > 120) initStars();
  }

  function render(s) {
    boil = reduce ? 0 : Math.floor(s.time / 125);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    vp.x = W / 2 - s.pointer.x * W * 0.035;
    vp.y = H * 0.42 - s.pointer.y * H * 0.03;

    ctx.save();
    if (s.shake > 0.01 && !reduce) {
      ctx.translate((Math.random() - 0.5) * 22 * s.shake, (Math.random() - 0.5) * 22 * s.shake);
    }

    const zoom = 1 + s.progress * 0.08;
    const nw = nebula.width * zoom, nh = nebula.height * zoom;
    ctx.drawImage(nebula, (W - nw) / 2 - s.pointer.x * W * 0.05, (H - nh) / 2 - s.pointer.y * H * 0.04, nw, nh);

    let sunNear = 0;
    let planet = null;
    let sunStage = null;
    for (const st of s.stages) {
      if (st.type === 'sun') sunStage = st;
      if (PLANETS[st.type] && st.p > -0.15 && st.p < 1) planet = st;
    }
    if (sunStage) sunNear = easeInOut(clamp(sunStage.p / 0.55));
    const rFar = (5 + 34 * s.progress ** 2) * U * 1.6;
    const sunR = lerp(rFar, Math.max(W, H) * 0.56, sunNear);
    const sunX = lerp(vp.x, W / 2, sunNear), sunY = lerp(vp.y, H * 0.48, sunNear);
    drawSun(sunX, sunY, sunR, sunNear, s.time);

    drawStars(s.speed, s.dt);

    if (planet) drawPlanet(planet.type, planet.p);
    for (const st of s.stages) if (st.type === 'belt') drawBelt(st.p);

    let dodge = 0;
    const targets = [];
    for (const st of s.stages) {
      if (st.type !== 'meteor') continue;
      if (ARRIVALS[st.arrival]) {
        if (st.p > 0 && st.p < 0.9 && !reduce) dodge += ARRIVALS[st.arrival](st, s.time);
        continue;
      }
      if (st.blast && st.p < st.blast.p - 0.04) st.blast = null;
      if (st.blast) { drawBlast(st, s.time); continue; }
      if (st.p <= 0 || st.p >= 0.9) continue;
      drawMeteor(st, s.time);
      const a = inbound(st.p);
      dodge += -st.side * easeInOut(clamp((a - 0.45) / 0.55)) * (1 - clamp((st.p - IMPACT) / 0.2));
      if (st.p < IMPACT - 0.01 && !reduce) {
        const pose = approach(st.p, st.side);
        const R = st.R * pose.k;
        targets.push({ st, R, x: W / 2 + pose.x, y: H / 2 + pose.y, r: Math.max(R * 1.05, 36) });
      }
    }
    updateMissiles(s.time, targets);
    drawPops(s.time);

    drawSpeedLines(s.warp + clamp((Math.abs(s.speed) - 2.2) / 4), sunNear > 0.5 ? { x: sunX, y: sunY } : vp);

    const shipS = clamp(Math.min(W, H * 1.25) * 0.14, 46, 140) * lerp(1, 0.62, sunNear);
    const bob = reduce ? 0 : Math.sin(s.time * 0.0021) * shipS * 0.04;
    const shipX = W / 2 + s.pointer.x * W * 0.06 + dodge * W * 0.1;
    const shipY = H * lerp(0.79, 0.9, s.focus) + bob + sunNear * H * 0.02;
    const bank = s.pointer.x * 0.16 + dodge * 0.28 + (reduce ? 0 : Math.sin(s.time * 0.0013) * 0.025);
    const thrust = clamp(0.55 + Math.abs(s.speed) * 0.14 + s.warp * 0.6, 0.4, 1.6);
    drawShip(shipX, shipY, shipS, bank, thrust, clamp(sunNear * 1.2), s.time);
    ship.x = shipX; ship.y = shipY; ship.s = shipS;

    ctx.fillStyle = vignette;
    ctx.globalAlpha = 0.55 + s.slowmo * 0.35 - sunNear * 0.4;
    ctx.fillRect(-40, -40, W + 80, H + 80);
    ctx.globalAlpha = 1;

    if (s.flash > 0.01 && !reduce) {
      ctx.fillStyle = `rgba(255,251,232,${s.flash * 0.7})`;
      ctx.fillRect(-40, -40, W + 80, H + 80);
    }
    ctx.restore();
  }

  resize();

  Object.assign(api, { IMPACT, resize, render, fire });
  window.VMSpace = api;
})();
