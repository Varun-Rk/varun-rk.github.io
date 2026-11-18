(() => {
  'use strict';

  const Space = window.VMSpace;
  const Audio = window.VMAudio;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  // Per-frame smoothing rates are tuned at 60fps; this keeps them the same at any frame rate.
  const follow = (rate, dt) => 1 - Math.pow(1 - rate, dt / 16.67);
  const easeInOut = t => -(Math.cos(Math.PI * t) - 1) / 2;
  const easeOut = t => 1 - (1 - t) ** 3;
  const easeBack = t => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;
  const $ = s => document.querySelector(s);

  const IMPACT = Space.IMPACT;
  const TIMING = {
    cockpit: { in0: 0, in1: 0, r0: 0, r1: 0.63, out: 0.86 },
    meteor: { in0: IMPACT + 0.01, in1: IMPACT + 0.09, r0: IMPACT + 0.1, r1: 0.85, out: 0.87 },
    panel: { in0: 0.04, in1: 0.18, r0: 0.2, r1: 0.84, out: 0.87 },
    sun: { in0: 0.38, in1: 0.54, r0: 0.56, r1: 0.95, out: 0 }
  };
  const timing = type => TIMING[type] || TIMING.panel;

  let meteorCount = 0;
  const stages = [...document.querySelectorAll('.stage')].map((el, i) => {
    const type = el.dataset.type;
    const st = {
      el, i, type,
      id: el.id,
      label: el.dataset.label,
      len: Number(el.dataset.len) || 240,
      frame: el.querySelector('.frame'),
      triggers: [...el.querySelectorAll('[data-at]')].map(n => ({
        n,
        base: Number(n.dataset.at),
        at: Number(n.dataset.at),
        until: n.dataset.until ? Number(n.dataset.until) : Infinity,
        sound: n.dataset.sound,
        on: false
      })),
      tilt: i % 2 ? 0.6 : -0.6,
      side: i % 2 ? 1 : -1,
      top: 0, h: 0, p: -1, prev: -1, overflow: 0, R: 0,
      key: '', live: false
    };
    if (type === 'meteor') {
      st.idx = meteorCount++;
      st.code = String(st.idx + 1).padStart(2, '0');
      st.arrival = el.dataset.arrival || 'meteor';
    }
    return st;
  });
  const last = stages[stages.length - 1];

  const state = {
    time: 0, dt: 16, speed: 0.8, slowmo: 0, warp: 0, shake: 0, flash: 0, focus: 0, progress: 0,
    pointer: { x: 0, y: 0 },
    stages: stages.map(st => ({
      type: st.type, p: -1, R: 0, side: st.side, idx: st.idx, arrival: st.arrival,
      label: st.code && st.label.toUpperCase(), num: st.code && 'Mission ' + st.code
    }))
  };

  let vh = window.innerHeight;
  let maxScroll = 1;
  // Everything on screen is pinned and driven from this eased copy of scrollY, so uneven wheel and
  // trackpad deltas turn into steady motion.
  const SCROLL_EASE_MS = 110;
  let smoothY = window.scrollY;
  let snap = true;
  let lastY = window.scrollY;
  let vel = 0;
  let lastT = 0;
  let current = null;
  const pointerTarget = { x: 0, y: 0 };

  /* ---------- layout ---------- */

  function layout() {
    vh = window.innerHeight;
    const css = getComputedStyle(document.documentElement);
    const avail = vh - parseFloat(css.getPropertyValue('--top')) - parseFloat(css.getPropertyValue('--bottom'));
    for (const st of stages) {
      const fh = st.frame.offsetHeight, fw = st.frame.offsetWidth;
      st.overflow = Math.max(0, fh - avail);
      st.R = 0.58 * Math.max(fw, Math.min(fh, avail));
      st.h = Math.round((st.len / 100) * vh + st.overflow * 1.6);
      if (st === last) st.h += vh;
      st.el.style.height = st.h + 'px';
    }
    for (const st of stages) {
      st.top = st.el.offsetTop;
      st.key = '';
      const T = timing(st.type);
      for (const tr of st.triggers) {
        tr.at = tr.base;
        if (!st.overflow || !st.frame.contains(tr.n)) continue;
        // On a panel taller than the screen, wait until the element has panned into view.
        let off = 0;
        for (let n = tr.n; n && n !== st.frame; n = n.offsetParent) off += n.offsetTop;
        tr.at = Math.max(tr.base, T.r0 + (T.r1 - T.r0) * clamp((off - avail * 0.92) / st.overflow));
      }
    }
    maxScroll = Math.max(1, document.documentElement.scrollHeight - vh);
    if (flight) flight.layout();
  }

  /* ---------- ports of call flight path ---------- */

  const flight = (() => {
    const root = $('.flight');
    if (!root) return null;
    const st = stages.find(o => o.frame.contains(root));
    const svg = root.querySelector('.flight-path');
    const roads = [...svg.querySelectorAll('path')];
    const todo = svg.querySelector('.fp-todo');
    const done = svg.querySelector('.fp-done');
    const ship = root.querySelector('.flight-ship');
    const start = root.querySelector('.stop-launch');
    const legs = [...root.querySelectorAll('.leg')].map(el => ({ el, stop: el.querySelector('.stop'), L: 0, on: false }));
    let total = 1, cur = 0, yA = 0, yB = 1, lastP = null, heading = null;
    // getPointAtLength forces a layout, so the path is sampled once per layout and read from here.
    let samples = [[0, 0], [0, 0]];

    const centre = el => {
      let x = el.offsetWidth / 2, y = el.offsetHeight / 2;
      for (let n = el; n && n !== root; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
      return [x, y];
    };

    function pointAt(L) {
      const f = clamp(L / total) * (samples.length - 1);
      const i = Math.min(samples.length - 2, Math.floor(f)), t = f - i;
      return [lerp(samples[i][0], samples[i + 1][0], t), lerp(samples[i][1], samples[i + 1][1], t)];
    }

    // Every segment runs downward, so the path is monotonic in y and can be searched by it.
    function lengthAtY(y) {
      let lo = 0, hi = samples.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (samples[mid][1] < y) lo = mid; else hi = mid;
      }
      const y0 = samples[lo][1], y1 = samples[hi][1];
      const t = y1 > y0 ? clamp((y - y0) / (y1 - y0)) : 0;
      return ((lo + t) / (samples.length - 1)) * total;
    }

    function layout() {
      const pts = [start, ...legs.map(l => l.stop)].map(centre);
      const wide = root.offsetWidth > 700;
      const mid = wide ? root.offsetWidth / 2 : pts[0][0];
      const half = wide ? 100 : 18;
      let d = `M${pts[0][0]} ${pts[0][1]}`;
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        const n = Math.max(2, Math.round((y1 - y0) / 85));
        for (let k = 1; k < n; k++) {
          const t = k / n;
          const x = clamp(lerp(x0, x1, t) + (k % 2 ? 1 : -1) * half * 0.9, mid - half, mid + half);
          d += ` L${x.toFixed(1)} ${lerp(y0, y1, t).toFixed(1)}`;
        }
        d += ` L${x1} ${y1}`;
      }
      svg.setAttribute('width', root.offsetWidth);
      svg.setAttribute('height', root.offsetHeight);
      for (const r of roads) r.setAttribute('d', d);
      total = todo.getTotalLength() || 1;
      const n = Math.max(2, Math.ceil(total / 3));
      samples = [];
      for (let i = 0; i <= n; i++) {
        const q = todo.getPointAtLength((i / n) * total);
        samples.push([q.x, q.y]);
      }
      yA = pts[0][1];
      yB = pts[pts.length - 1][1];
      for (const l of legs) l.L = lengthAtY(centre(l.stop)[1]);
      lastP = null;
    }

    function angleAt(L) {
      const a = pointAt(L), b = pointAt(Math.min(total, L + 3));
      return Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI + 90;
    }

    function update(dt) {
      if (st.p < -0.2 || st.p > 1.2) return;
      const target = lengthAtY(lerp(yA, yB, clamp((st.p - 0.12) / 0.66)));
      if (lastP === st.p && Math.abs(target - cur) < 0.5 && Math.abs((((heading - angleAt(cur)) % 360) + 540) % 360 - 180) < 0.5) return;
      const forward = target > cur;
      lastP = st.p;
      cur = reduce ? target : lerp(cur, target, follow(0.2, dt));
      const [ax, ay] = pointAt(cur);
      const angle = angleAt(cur);
      if (heading === null || reduce) heading = angle;
      else heading += (((angle - heading + 540) % 360) - 180) * follow(0.25, dt);
      ship.style.transform = `translate(${ax.toFixed(1)}px, ${ay.toFixed(1)}px) rotate(${heading.toFixed(1)}deg)`;
      done.style.strokeDasharray = `${cur.toFixed(1)} ${total}`;
      for (const l of legs) {
        const on = cur >= l.L - 24;
        if (on === l.on) continue;
        l.on = on;
        l.el.classList.toggle('on', on);
        if (on && forward) Audio.click();
      }
    }

    return { layout, update };
  })();

  /* ---------- flight hours: GitHub contributions, fetched daily at deploy ---------- */

  const MOBILE_WEEKS = 26;

  function drawHours(root, { total, start, counts, levels }) {
    const first = new Date(start + 'T00:00:00Z');
    const pad = first.getUTCDay();
    const weeks = Math.ceil((pad + counts.length) / 7);
    const old = w => (w < weeks - MOBILE_WEEKS ? ' old' : '');
    const cells = [];
    for (let i = 0; i < pad; i++) cells.push(`<i class="pad${old(0)}"></i>`);
    counts.forEach((n, d) => {
      const w = Math.floor((pad + d) / 7);
      const day = new Date(first.getTime() + d * 864e5).toISOString().slice(0, 10);
      cells.push(`<i class="l${levels[d]}${old(w)}" title="${n} on ${day}"></i>`);
    });
    const grid = root.querySelector('.hours-grid');
    grid.innerHTML = cells.join('');
    grid.setAttribute('aria-label', `${total} GitHub contributions in the last year`);
    root.querySelector('.hours-total').textContent = total.toLocaleString('en-IN');
    root.hidden = false;
  }

  const hours = $('.hours');
  if (hours) {
    fetch('assets/data/contributions.json')
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(data => { drawHours(hours, data); layout(); })
      .catch(() => {});
  }

  /* ---------- per-stage choreography ---------- */

  function progressOf(st, y) {
    const span = st === last ? Math.max(1, st.h - vh) : st.h;
    return clamp((y - st.top) / span, -1, 2);
  }

  const ENTER = {
    meteor: t => ({ scale: 0.8 + 0.2 * easeBack(t) }),
    probe: t => ({
      extra: ` perspective(1600px) rotateX(${(-82 * (1 - easeOut(t))).toFixed(2)}deg)`,
      origin: t < 1 ? '50% 0' : ''
    }),
    signal: t => {
      const w = easeOut(clamp(t / 0.35)), h = easeOut(clamp((t - 0.35) / 0.65));
      return { extra: ` scale(${lerp(0.04, 1, w).toFixed(4)}, ${lerp(0.012, 1, h).toFixed(4)})`, flicker: t > 0 && t < 1 };
    },
    star: (t, st) => {
      const e = easeOut(t);
      return {
        tx: st.side * window.innerWidth * 0.6 * (1 - e),
        extra: ` skewX(${(-st.side * 16 * (1 - e)).toFixed(2)}deg)`,
        filter: t < 1 ? `brightness(${(1 + 2.2 * (1 - e)).toFixed(2)}) saturate(${(2 - e).toFixed(2)})` : ''
      };
    },
    plug: t => ({ scale: lerp(0.05, 1, easeOut(t)), origin: t < 1 ? '50% -20%' : '' }),
    scan: t => {
      const e = easeOut(t);
      return { scale: 1.07 - 0.07 * e, filter: t < 1 ? `blur(${(14 * (1 - e)).toFixed(1)}px)` : '' };
    },
    moons: t => {
      if (t >= 1) return {};
      const h = [0, 1, 2].map(i => (easeOut(clamp(t * 1.5 - i * 0.25)) * 100).toFixed(1) + '%');
      return { clip: `polygon(0 0, 100% 0, 100% ${h[2]}, 66.7% ${h[2]}, 66.7% ${h[1]}, 33.3% ${h[1]}, 33.3% ${h[0]}, 0 ${h[0]})` };
    },
    station: t => {
      const gap = (50 * (1 - easeInOut(t))).toFixed(2);
      return { clip: t < 1 ? `inset(-20px ${gap}% -20px ${gap}%)` : '' };
    }
  };

  // DOM writes wait until the canvas has drawn: canvas text reads computed style, and a pending
  // write would force a full style recalc in the middle of the frame.
  const writes = [];
  const write = fn => writes.push(fn);
  function flushWrites() {
    for (const fn of writes) fn();
    writes.length = 0;
  }

  function crawl(st) {
    const p = st.p;
    let op = p <= 0 || p >= 1 ? 0 : clamp(p / 0.06) * clamp((1 - p) / 0.1);
    if (op < 0.01) op = 0;
    const key = op ? `${op.toFixed(3)}|${p.toFixed(4)}` : '0';
    if (key !== st.key) {
      st.key = key;
      const t = reduce ? 0 : clamp(p).toFixed(4);
      write(() => {
        st.frame.style.opacity = op;
        st.frame.style.setProperty('--t', t);
      });
    }
    return op;
  }

  function apply(st, shakeX, shakeY) {
    if (st.type === 'chapter') return crawl(st);
    const T = timing(st.type);
    const p = st.p;
    let inT = T.in1 > T.in0 ? clamp((p - T.in0) / (T.in1 - T.in0)) : p >= T.in0 ? 1 : 0;
    if (p < 0) inT = 0;
    const outT = T.out ? clamp((p - T.out) / (1 - T.out)) : 0;
    const readT = clamp((p - T.r0) / (T.r1 - T.r0));
    let op = inT * (1 - outT);
    if (st === last && p >= 1) op = 1;
    if (op < 0.01) op = 0;

    let scale = 1, ty = st.overflow ? st.overflow / 2 - st.overflow * readT : 0, tx = 0;
    let extra = '', origin = '', filter = '', clip = '';
    if (!reduce) {
      if (st.type === 'meteor') {
        let flicker;
        ({ scale = 1, tx = 0, extra = '', origin = '', filter = '', clip = '', flicker } = ENTER[st.arrival](inT, st));
        if (flicker && op) op *= 0.45 + 0.55 * Math.random();
      } else {
        scale = 0.55 + 0.45 * easeOut(inT);
        ty += (1 - easeOut(inT)) * -vh * 0.12;
      }
      scale *= 1 + 1.9 * outT * outT;
      if (op > 0) { tx += shakeX; ty += shakeY; }
    }
    const key = op ? `${op.toFixed(3)}|${scale.toFixed(4)}|${tx.toFixed(1)}|${ty.toFixed(1)}|${extra}|${filter}|${clip}` : '0';
    if (key !== st.key) {
      st.key = key;
      const transform = op
        ? `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) scale(${scale.toFixed(4)}) rotate(${st.tilt}deg)${extra}`
        : 'translate3d(0, 0, 0) scale(.5)';
      write(() => {
        const s = st.frame.style;
        s.opacity = op;
        s.transformOrigin = origin;
        s.filter = op ? filter : '';
        s.clipPath = op ? clip : '';
        s.transform = transform;
      });
    }
    const live = op > 0.6;
    if (live !== st.live) {
      st.live = live;
      write(() => st.el.classList.toggle('live', live));
    }

    const forward = st.p > st.prev;
    for (const tr of st.triggers) {
      const on = p >= tr.at && p < tr.until && p > -0.5 && (p < 1 || st === last);
      if (on === tr.on) continue;
      tr.on = on;
      write(() => tr.n.classList.toggle('on', on));
      if (!on || !forward || !tr.sound) continue;
      if (tr.sound === 'talk') Audio.talk(tr.n.textContent.length);
      else if (Audio[tr.sound]) Audio[tr.sound](...(tr.n.dataset.count ? [Number(tr.n.dataset.count)] : []));
    }
    return op;
  }

  function events(st) {
    const a = st.prev, b = st.p;
    if (b <= a) return;
    const crossed = x => a < x && b >= x && b < x + 0.35;
    if (st.type === 'meteor') {
      if (crossed(0.04) && st.arrival === 'meteor') hint();
      if (crossed(IMPACT) && !state.stages[st.i].blast) arrive(st.arrival);
      if (crossed(IMPACT + 0.03)) Audio.reveal();
    } else if (st.type === 'cockpit') {
      if (crossed(0.86)) { Audio.whoosh(1.2); state.warp = 1; }
    } else if (st.type === 'sun') {
      if (crossed(0.4)) Audio.reveal();
    } else if (crossed(0.06)) {
      Audio.whoosh(0.5);
    }
  }

  const ARRIVE = {
    meteor: { sound: 'impact', shake: 1, flash: 1 },
    probe: { sound: 'dock', shake: 0.35, flash: 0.25 },
    signal: { sound: 'signal', shake: 0.15, flash: 0.2 },
    star: { sound: 'flare', shake: 0.3, flash: 0.9 },
    plug: { sound: 'plug', shake: 0.2, flash: 0.3 },
    scan: { sound: 'shutter', shake: 0.1, flash: 1 },
    moons: { sound: 'chimes', shake: 0.15, flash: 0.25 },
    station: { sound: 'airlock', shake: 0.7, flash: 0.5 }
  };
  function arrive(kind) {
    const a = ARRIVE[kind] || ARRIVE.meteor;
    Audio[a.sound]();
    state.shake = Math.max(state.shake, a.shake);
    state.flash = Math.max(state.flash, a.flash);
  }

  function slowmoOf(st) {
    const p = st.p;
    if (p < 0 || p > 1) return 0;
    if (st.type === 'meteor') return p > IMPACT - 0.03 && p < 0.87 ? 1 : 0;
    if (st.type === 'cockpit') return p < 0.84 ? 0.9 : 0;
    if (st.type === 'sun') return p > 0.3 ? 0.9 : 0;
    return p > 0.15 && p < 0.86 ? 0.55 : 0;
  }

  /* ---------- HUD ---------- */

  const route = $('#route');
  const nowEl = $('#now');
  const odoFill = $('#odo-fill');
  const odoAu = $('#odo-au');
  let lastFill, lastDistance;

  stages.forEach(st => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#' + st.id;
    a.innerHTML = `<span></span><i aria-hidden="true"></i>`;
    a.querySelector('span').textContent = st.code ? `${st.code} · ${st.label}` : st.label;
    const mark = a.querySelector('i');
    if (st.type === 'chapter') {
      li.className = 'route-ch';
    } else if (st.code) {
      li.className = 'route-mission';
      mark.textContent = st.code;
      a.style.setProperty('--acc', st.el.style.getPropertyValue('--acc'));
    }
    if (st.type === 'sun') a.classList.add('is-sun');
    li.append(a);
    route.append(li);
    st.link = a;
  });

  const menu = $('#menu');
  const menuGroups = $('#menu-groups');
  let group = null;
  for (const st of stages) {
    if (st.type === 'chapter') {
      group = null;
      continue;
    }
    if (!st.code) continue;
    if (!group) {
      const chapter = stages.slice(0, st.i).reverse().find(o => o.type === 'chapter');
      const section = document.createElement('section');
      section.className = 'menu-group';
      section.innerHTML = '<h3></h3><ol class="menu-grid"></ol>';
      section.querySelector('h3').textContent = chapter ? chapter.label : 'Missions';
      menuGroups.append(section);
      group = section.querySelector('ol');
    }
    const result = st.el.querySelector('.c-result');
    const li = document.createElement('li');
    li.innerHTML = `<a class="menu-card" href="#${st.id}"><span class="menu-num"></span><b class="menu-name"></b><span class="menu-pow"></span><span class="menu-res"></span></a>`;
    li.querySelector('a').style.setProperty('--acc', st.el.style.getPropertyValue('--acc'));
    li.querySelector('.menu-num').textContent = `Mission ${st.code}`;
    li.querySelector('.menu-name').textContent = st.el.querySelector('.m-title').textContent;
    li.querySelector('.menu-pow').textContent = result.querySelector('.pow').textContent;
    li.querySelector('.menu-res').textContent = result.querySelector('.pow + p').textContent;
    group.append(li);
  }
  $('#missions').addEventListener('click', () => {
    menu.showModal();
    Audio.click();
  });
  menu.addEventListener('click', e => {
    if (e.target === menu || e.target.closest('.menu-close, .menu-card')) menu.close();
  });

  function paintRouteFill() {
    if (!current) return;
    const items = route.children;
    const centre = li => li.offsetTop + li.offsetHeight / 2;
    const top = centre(items[0]);
    route.style.setProperty('--line-top', top + 'px');
    route.style.setProperty('--line-h', centre(items[items.length - 1]) - top + 'px');
    route.style.setProperty('--fill', centre(current.link.parentElement) - top + 'px');
  }

  function setCurrent(st) {
    if (st === current) return;
    current = st;
    document.body.style.setProperty('--mission-glow', st.el.style.getPropertyValue('--acc') || 'transparent');
    nowEl.textContent = st.code ? `Mission ${st.code}: ${st.label}` : st.label;
    stages.forEach(o => {
      o.link.classList.toggle('passed', o.i < st.i);
      if (o === st) o.link.setAttribute('aria-current', 'step');
      else o.link.removeAttribute('aria-current');
    });
    paintRouteFill();
    const hash = st.i === 0 ? location.pathname + location.search : '#' + st.id;
    if (history.replaceState) history.replaceState(null, '', hash);
  }

  function readPoint(st) {
    if (st.i === 0) return 0;
    if (st === last) return maxScroll;
    return st.top + st.h * (timing(st.type).r0 + 0.02);
  }

  function jumpTo(st, quiet) {
    if (!quiet) Audio.whoosh(0.9);
    state.warp = 1;
    snap = true;
    window.scrollTo({ top: readPoint(st), behavior: 'instant' });
  }

  const byId = id => stages.find(st => st.id === id);

  // Hovering a tool lights up the missions on the route that used it.
  for (const round of document.querySelectorAll('.rounds li[data-missions]')) {
    const links = round.dataset.missions.split(' ').map(id => byId(id)?.link).filter(Boolean);
    round.addEventListener('mouseenter', () => links.forEach(a => a.classList.add('hint')));
    round.addEventListener('mouseleave', () => links.forEach(a => a.classList.remove('hint')));
  }

  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const st = byId(a.getAttribute('href').slice(1));
    if (!st) return;
    e.preventDefault();
    jumpTo(st);
  });

  document.addEventListener('focusin', e => {
    const host = e.target.closest('.stage');
    if (!host) return;
    const st = stages.find(o => o.el === host);
    if (st && !st.live) jumpTo(st, true);
  });

  /* ---------- sound + small controls ---------- */

  const snd = $('#snd');
  let muted = false;
  try { muted = localStorage.getItem('muted') === '1'; } catch (e) {}
  const soundCue = $('#sound-cue');
  function paintSound() {
    snd.textContent = muted ? 'Unmute' : 'Mute';
    soundCue.classList.toggle('done', Audio.on);
  }
  paintSound();
  function setMuted(on) {
    muted = on;
    try { localStorage.setItem('muted', on ? '1' : '0'); } catch (e) {}
    if (on) Audio.disable();
    else Audio.enable().then(paintSound);
    paintSound();
  }
  snd.addEventListener('click', () => {
    setMuted(!muted);
    if (!muted) Audio.click();
  });
  soundCue.addEventListener('click', () => {
    setMuted(false);
    Audio.whoosh(0.8);
  });

  // Browsers only start audio after a click, tap or key press; scrolling does not count, and a touch
  // only counts once the finger lifts.
  const unlockOn = ['pointerdown', 'pointerup', 'keydown', 'touchend'];
  const isGesture = e => e.type === 'keydown' || e.type === 'touchend' ||
    (e.type === 'pointerdown') === (e.pointerType === 'mouse');
  async function unlock(e) {
    if (muted || e.target.closest?.('#snd, #sound-cue') || !isGesture(e)) return;
    if (!(await Audio.enable())) return;
    paintSound();
    for (const type of unlockOn) window.removeEventListener(type, unlock, true);
  }
  for (const type of unlockOn) window.addEventListener(type, unlock, true);

  const toast = $('#toast');
  let toastTimer;
  function say(msg, ms = 1800) {
    toast.textContent = msg;
    toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('on'), ms);
  }

  /* ---------- missiles ---------- */

  const touch = matchMedia('(pointer: coarse)').matches;
  let hinted = false, fired = false;
  function hint() {
    if (hinted || fired || reduce) return;
    hinted = true;
    say(touch ? 'Tap the meteor to blast it!' : 'Click the meteor to blast it!', 3200);
  }

  document.addEventListener('click', e => {
    if (reduce || e.button !== 0) return;
    if (e.target.closest('a, button, input, label, .page, .panel, .bubble, .cover > *, .caption, .hud, .route, .odo, .toast, .menu')) return;
    fired = true;
    Space.fire(e.clientX, e.clientY, performance.now());
    Audio.fire();
  });

  Space.onPop = () => Audio.pop();
  Space.onBlast = target => {
    const st = stages[state.stages.indexOf(target)];
    Audio.impact();
    state.shake = 0.6;
    state.flash = 0.7;
    setTimeout(() => {
      const y = readPoint(st);
      if (window.scrollY < y) window.scrollTo({ top: y, behavior: 'smooth' });
    }, 650);
  };
  $('#copy-email').addEventListener('click', e => {
    const value = e.currentTarget.dataset.copy;
    const done = () => { say('Copied!'); Audio.click(); };
    if (navigator.clipboard) navigator.clipboard.writeText(value).then(done, () => say(value));
    else say(value);
  });
  $('#year').textContent = new Date().getFullYear();

  document.addEventListener('visibilitychange', () => Audio.pause(document.hidden));

  window.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    pointerTarget.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointerTarget.y = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const ratio = window.scrollY / maxScroll;
      Space.resize();
      layout();
      paintRouteFill();
      window.scrollTo(0, ratio * maxScroll);
      snap = true;
    }, 150);
  });

  /* ---------- loop ---------- */

  function tick(now) {
    const dt = Math.min(64, lastT ? now - lastT : 16);
    lastT = now;
    const scrollY = window.scrollY;
    // A jump of several screens snaps instead of sweeping, so it doesn't fire every encounter on the way.
    if (snap || reduce || Math.abs(scrollY - smoothY) > vh * 3) {
      smoothY = scrollY;
      snap = false;
    } else {
      smoothY += (scrollY - smoothY) * (1 - Math.exp(-dt / SCROLL_EASE_MS));
      if (Math.abs(scrollY - smoothY) < 0.05) smoothY = scrollY;
    }
    const y = smoothY;
    const rawV = (y - lastY) / dt;
    lastY = y;
    vel = lerp(vel, clamp(rawV, -12, 12), follow(0.15, dt));

    state.time = now;
    state.dt = dt;
    state.progress = clamp(y / maxScroll);
    state.pointer.x = lerp(state.pointer.x, pointerTarget.x, follow(0.05, dt));
    state.pointer.y = lerp(state.pointer.y, pointerTarget.y, follow(0.05, dt));
    state.shake *= Math.pow(0.0025, dt / 1000);
    state.flash *= Math.pow(0.0005, dt / 1000);
    state.warp *= Math.pow(0.08, dt / 1000);

    const sx = (Math.random() - 0.5) * 16 * state.shake;
    const sy = (Math.random() - 0.5) * 16 * state.shake;

    let slow = 0, focus = 0, active = null;
    for (const st of stages) {
      st.prev = st.p;
      st.p = progressOf(st, y);
      events(st);
      if (st.p > -0.2 && st.p < 1.2) focus = Math.max(focus, apply(st, sx, sy));
      else if (st.key !== '0') apply(st, 0, 0);
      slow = Math.max(slow, slowmoOf(st));
      if (!active && st.p >= 0 && (st.p < 1 || st === last)) active = st;
      const s = state.stages[st.i];
      s.p = st.p;
      s.R = st.R;
    }

    state.slowmo = lerp(state.slowmo, slow, follow(0.06, dt));
    state.focus = lerp(state.focus, focus, follow(0.08, dt));
    const cruise = 1.1 * (1 - state.slowmo * 0.92);
    state.speed = reduce ? 0 : clamp(cruise + vel * 3.2 * (1 - state.slowmo * 0.6) + state.warp * 6, -5, 9);

    Space.render(state);
    flushWrites();
    if (active) setCurrent(active);

    const fill = state.progress.toFixed(4);
    const distance = (1 - state.progress).toFixed(2);
    if (fill !== lastFill) {
      odoFill.style.transform = `scaleX(${fill})`;
      lastFill = fill;
    }
    if (distance !== lastDistance) {
      odoAu.textContent = distance + ' AU';
      lastDistance = distance;
    }

    Audio.flight(state.speed, state.slowmo);
    Audio.sun(last.type === 'sun' ? clamp(last.p / 0.6) : 0);

    if (flight) flight.update(dt);
    requestAnimationFrame(tick);
  }

  function start() {
    layout();
    const target = byId(decodeURIComponent(location.hash.slice(1)));
    if (target && target.i > 0) window.scrollTo(0, readPoint(target));
    lastY = smoothY = window.scrollY;
    for (const st of stages) st.p = st.prev = progressOf(st, lastY);
    requestAnimationFrame(tick);
  }

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.race([ready, new Promise(r => setTimeout(r, 1500))]).then(start);
  window.addEventListener('load', () => { layout(); });
})();
