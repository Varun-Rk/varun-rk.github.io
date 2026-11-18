(() => {
  'use strict';

  let ac = null;
  let master, verb, noise, windFilter, windGain, engineFilter, sunGain;
  let enabled = false;

  function noiseBuffer(seconds) {
    const buf = ac.createBuffer(1, ac.sampleRate * seconds, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function prepareReverb() {
    const len = Math.round(ac.sampleRate * 3.4);
    const buf = ac.createBuffer(2, len, ac.sampleRate);
    const left = buf.getChannelData(0), right = buf.getChannelData(1);
    let i = 0;
    function fillChunk() {
      const end = Math.min(i + 8192, len);
      for (; i < end; i++) {
        const gain = (1 - i / len) ** 2.6;
        left[i] = (Math.random() * 2 - 1) * gain;
        right[i] = (Math.random() * 2 - 1) * gain;
      }
      if (i < len) setTimeout(fillChunk, 0);
      else verb.buffer = buf;
    }
    fillChunk();
  }

  function build() {
    ac = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    master = ac.createGain();
    master.gain.value = 0;
    master.connect(ac.destination);

    verb = ac.createConvolver();
    setTimeout(prepareReverb, 0);
    const verbOut = ac.createGain();
    verbOut.gain.value = 0.5;
    verb.connect(verbOut).connect(master);

    engineFilter = ac.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 150;
    engineFilter.Q.value = 6;
    const engineGain = ac.createGain();
    engineGain.gain.value = 0.07;
    engineFilter.connect(engineGain).connect(master);
    [41.2, 55, 55.4].forEach((f, i) => {
      const o = ac.createOscillator();
      o.type = i ? 'sawtooth' : 'sine';
      o.frequency.value = f;
      o.connect(engineFilter);
      o.start();
    });
    const lfo = ac.createOscillator();
    const lfoGain = ac.createGain();
    lfo.frequency.value = 0.18;
    lfoGain.gain.value = 40;
    lfo.connect(lfoGain).connect(engineFilter.frequency);
    lfo.start();

    const wind = ac.createBufferSource();
    noise = noiseBuffer(3);
    wind.buffer = noise;
    wind.loop = true;
    windFilter = ac.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 400;
    windFilter.Q.value = 0.9;
    windGain = ac.createGain();
    windGain.gain.value = 0;
    wind.connect(windFilter).connect(windGain).connect(master);
    windGain.connect(verb);
    wind.start();

    sunGain = ac.createGain();
    sunGain.gain.value = 0;
    const sunFilter = ac.createBiquadFilter();
    sunFilter.type = 'lowpass';
    sunFilter.frequency.value = 1100;
    sunGain.connect(sunFilter).connect(master);
    sunFilter.connect(verb);
    [110, 164.8, 220.4, 277.2].forEach((f, i) => {
      const o = ac.createOscillator();
      o.type = i % 2 ? 'triangle' : 'sine';
      o.frequency.value = f;
      o.detune.value = (i - 1.5) * 6;
      const g = ac.createGain();
      g.gain.value = 0.25 / (i + 1);
      o.connect(g).connect(sunGain);
      o.start();
    });
  }

  function now() { return ac.currentTime; }

  function env(gainNode, t, peak, attack, release) {
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(peak, t + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  }

  function send(g, wet) {
    g.connect(master);
    if (!wet) return;
    const w = ac.createGain();
    w.gain.value = wet;
    g.connect(w).connect(verb);
  }

  function noiseShot(t, { from, to, type = 'lowpass', peak, attack, release, wet = 0 }) {
    const src = ac.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + attack + release);
    const g = ac.createGain();
    env(g, t, peak, attack, release);
    src.connect(f).connect(g);
    send(g, wet);
    src.start(t, Math.random() * noise.duration);
    src.stop(t + attack + release + 0.1);
  }

  function tone(t, { type = 'sine', from, to = from, peak, attack, release, wet = 0 }) {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(to, t + attack + release);
    const g = ac.createGain();
    env(g, t, peak, attack, release);
    o.connect(g);
    send(g, wet);
    o.start(t);
    o.stop(t + attack + release + 0.05);
  }

  // While the context is starting up, sounds are still scheduled: the clock is frozen, so they play
  // the moment it runs instead of being dropped. The first click's sound would otherwise be lost.
  let starting = false;
  const live = () => enabled && ac && (ac.state === 'running' || starting);

  const VMAudio = {
    get on() { return live(); },

    async enable() {
      try {
        if (!ac) build();
        enabled = true;
        master.gain.cancelScheduledValues(now());
        master.gain.setTargetAtTime(0.75, now(), 0.025);
        if (ac.state !== 'running') {
          starting = true;
          await Promise.race([ac.resume(), new Promise(r => setTimeout(r, 1000))]);
        }
      } catch (e) {
        enabled = false;
      } finally {
        starting = false;
      }
      return live();
    },

    disable() {
      enabled = false;
      if (!ac) return;
      master.gain.cancelScheduledValues(now());
      master.gain.setTargetAtTime(0, now(), 0.15);
    },

    pause(hidden) {
      if (!ac) return;
      if (hidden) ac.suspend();
      else if (enabled) ac.resume();
    },

    flight(speed, slowmo) {
      if (!live()) return;
      const s = Math.min(1, Math.abs(speed) / 6);
      const t = now();
      windGain.gain.setTargetAtTime(0.03 + s * 0.32 * (1 - slowmo * 0.7), t, 0.12);
      windFilter.frequency.setTargetAtTime(260 + s * 2600, t, 0.15);
      engineFilter.frequency.setTargetAtTime(120 + s * 260 - slowmo * 50, t, 0.3);
    },

    sun(level) {
      if (!live()) return;
      sunGain.gain.setTargetAtTime(level * 0.3, now(), 0.5);
    }
  };

  // One-shot effects: each receives the start time, then its own arguments.
  const EFFECTS = {
    impact(t) {
      tone(t, { from: 130, to: 26, peak: 0.9, attack: 0.012, release: 2.4, wet: 0.4 });
      tone(t, { type: 'triangle', from: 70, to: 30, peak: 0.35, attack: 0.02, release: 1.8 });
      noiseShot(t, { from: 4200, to: 120, peak: 0.55, attack: 0.01, release: 2.6, wet: 0.8 });
      for (let i = 0; i < 6; i++) {
        noiseShot(t + 0.18 + i * 0.13 + Math.random() * 0.08, { from: 3800, to: 1200, type: 'highpass', peak: 0.12, attack: 0.004, release: 0.09, wet: 0.5 });
      }
    },

    reveal(t) {
      t += 0.25;
      [523.25, 783.99, 1046.5].forEach((f, i) => tone(t + i * 0.09, { type: 'triangle', from: f, peak: 0.07, attack: 0.01, release: 1.4, wet: 0.9 }));
    },

    whoosh(t, strength = 1) {
      noiseShot(t, { from: 180, to: 3200, type: 'bandpass', peak: 0.35 * strength, attack: 0.5, release: 1.1, wet: 0.6 });
      tone(t, { type: 'sawtooth', from: 60, to: 420, peak: 0.05 * strength, attack: 0.6, release: 0.7 });
    },

    talk(t, chars) {
      const n = Math.min(14, Math.max(4, Math.round(chars / 7)));
      for (let i = 0; i < n; i++) {
        tone(t + i * 0.055, { type: 'square', from: 380 + Math.random() * 300, peak: 0.035, attack: 0.005, release: 0.04 });
      }
    },

    fire(t) {
      noiseShot(t, { from: 900, to: 5200, type: 'bandpass', peak: 0.3, attack: 0.02, release: 0.45, wet: 0.3 });
      tone(t, { type: 'sawtooth', from: 220, to: 900, peak: 0.06, attack: 0.01, release: 0.3 });
    },

    pop(t) {
      tone(t, { from: 160, to: 45, peak: 0.45, attack: 0.008, release: 0.6, wet: 0.3 });
      noiseShot(t, { from: 3000, to: 200, peak: 0.3, attack: 0.005, release: 0.55, wet: 0.5 });
    },

    reload(t, rounds = 0) {
      noiseShot(t, { from: 2600, to: 900, type: 'bandpass', peak: 0.28, attack: 0.003, release: 0.06 });
      tone(t + 0.02, { type: 'square', from: 220, to: 140, peak: 0.05, attack: 0.003, release: 0.05 });
      noiseShot(t + 0.16, { from: 3400, to: 1400, type: 'bandpass', peak: 0.34, attack: 0.003, release: 0.08, wet: 0.2 });
      tone(t + 0.17, { type: 'square', from: 300, to: 180, peak: 0.06, attack: 0.003, release: 0.06 });
      for (let i = 0; i < rounds; i++) tone(t + 0.3 + i * 0.045, { type: 'square', from: 2300, to: 1900, peak: 0.018, attack: 0.002, release: 0.02 });
    },

    dock(t) {
      tone(t, { from: 90, to: 40, peak: 0.6, attack: 0.008, release: 0.5, wet: 0.3 });
      tone(t + 0.01, { type: 'square', from: 520, to: 330, peak: 0.06, attack: 0.003, release: 0.12, wet: 0.4 });
      noiseShot(t, { from: 2400, to: 700, type: 'bandpass', peak: 0.3, attack: 0.003, release: 0.12 });
      noiseShot(t + 0.22, { from: 5000, to: 1500, type: 'highpass', peak: 0.12, attack: 0.05, release: 0.9, wet: 0.3 });
    },

    signal(t) {
      noiseShot(t, { from: 2600, to: 1800, type: 'bandpass', peak: 0.22, attack: 0.01, release: 0.5 });
      [0.12, 0.26, 0.4].forEach((d, i) => tone(t + d, { from: i === 2 ? 1560 : 1170, peak: 0.08, attack: 0.004, release: 0.09, wet: 0.5 }));
      tone(t + 0.55, { type: 'sawtooth', from: 300, to: 1400, peak: 0.04, attack: 0.02, release: 0.35, wet: 0.5 });
    },

    flare(t) {
      noiseShot(t, { from: 300, to: 5000, type: 'bandpass', peak: 0.3, attack: 0.08, release: 0.5, wet: 0.8 });
      tone(t + 0.1, { type: 'triangle', from: 330, to: 55, peak: 0.18, attack: 0.05, release: 2.6, wet: 0.9 });
      tone(t + 0.1, { from: 165, to: 30, peak: 0.25, attack: 0.05, release: 2.8, wet: 0.6 });
    },

    plug(t) {
      tone(t, { type: 'sawtooth', from: 180, to: 700, peak: 0.04, attack: 0.05, release: 0.25 });
      noiseShot(t + 0.3, { from: 4000, to: 1500, type: 'bandpass', peak: 0.3, attack: 0.002, release: 0.05 });
      noiseShot(t + 0.32, { from: 6000, to: 3000, type: 'highpass', peak: 0.14, attack: 0.002, release: 0.18, wet: 0.3 });
      tone(t + 0.42, { type: 'square', from: 660, peak: 0.05, attack: 0.004, release: 0.08 });
      tone(t + 0.52, { type: 'square', from: 990, peak: 0.05, attack: 0.004, release: 0.12, wet: 0.3 });
    },

    shutter(t) {
      tone(t, { from: 500, to: 1800, peak: 0.05, attack: 0.25, release: 0.1 });
      noiseShot(t + 0.36, { from: 5000, to: 2000, type: 'bandpass', peak: 0.35, attack: 0.002, release: 0.04 });
      noiseShot(t + 0.44, { from: 3500, to: 1500, type: 'bandpass', peak: 0.28, attack: 0.002, release: 0.06, wet: 0.2 });
    },

    chimes(t) {
      [659.25, 783.99, 987.77].forEach((f, i) => {
        tone(t + i * 0.09, { type: 'triangle', from: f, peak: 0.1, attack: 0.004, release: 1.2, wet: 0.8 });
        tone(t + i * 0.09, { from: f * 2.01, peak: 0.025, attack: 0.004, release: 0.6, wet: 0.6 });
      });
      noiseShot(t + 0.28, { from: 6000, to: 2500, type: 'highpass', peak: 0.1, attack: 0.002, release: 0.25 });
    },

    airlock(t) {
      tone(t, { from: 70, to: 32, peak: 0.6, attack: 0.02, release: 1.4, wet: 0.5 });
      noiseShot(t, { from: 900, to: 200, peak: 0.35, attack: 0.01, release: 0.5, wet: 0.5 });
      noiseShot(t + 0.25, { from: 7000, to: 2500, type: 'highpass', peak: 0.16, attack: 0.08, release: 1.1, wet: 0.4 });
      tone(t + 0.05, { type: 'square', from: 140, to: 90, peak: 0.05, attack: 0.004, release: 0.2 });
    },

    odo(t) {
      for (let i = 0; i < 4; i++) tone(t + 0.15 + i * 0.24, { type: 'square', from: 1500, to: 1100, peak: 0.035, attack: 0.002, release: 0.04 });
    },

    click(t) {
      tone(t, { type: 'square', from: 880, to: 1320, peak: 0.04, attack: 0.004, release: 0.07 });
    }
  };

  for (const [name, play] of Object.entries(EFFECTS)) {
    VMAudio[name] = (...args) => { if (live()) play(now(), ...args); };
  }

  window.VMAudio = VMAudio;
})();
