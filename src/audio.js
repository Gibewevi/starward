/**
 * The sound of the fight, synthesised in Web Audio (no samples).
 *
 * Everything goes through one mix: a glue compressor and a limiter (a
 * dozen shots at once never clip), a short metallic room reverb fed by
 * every sound (more for distant ones), and a low-pass "muffle" that a blast
 * close by drops to a dull thud before the hearing comes back. Sounds in the
 * room are placed: panned left or right by where they are on screen, fainter
 * and duller further from the hero.
 *
 * Continuous layers: the blade's hum (two beating saws through a resonant
 * filter, its pitch and brightness rising with the swing — the Doppler of a
 * lightsaber), the swoosh of the blade cutting the air, a burning crackle
 * while it is inside something (a wall, a man run through), the Force's
 * rumble while it holds a man up, the room's tone (ventilation, mains hum),
 * and a low tension bed that swells while the squad fights.
 *
 * One-shots: ignition and retraction, blows (an electric crackle, a burn and
 * a thump), the clash of a deflection (a ring — a bright chime for a perfect
 * parry), blaster shots (a falling chirp, high partials first), bolts bursting
 * and whizzing past, footsteps on the deck (the hero's and the troopers'),
 * armour clattering, bodies falling, the Force's push and pull, the dash,
 * grenades bouncing and beeping, explosions (crack, body, sub-bass, debris
 * raining down, a ringing in the ears when close), the door and its klaxon,
 * and the squad's radio chatter — clipped bursts of filtered "speech" whose
 * rhythm tells a call-out from an order.
 *
 * createAudio({ context }) — a context may be given (an OfflineAudioContext
 * for checks); otherwise one is made on the first start().
 */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createAudio({ context = null } = {}) {
  let ctx = null, ready = false;
  let master, muffle, dry, send, white, crackle, pink;
  let hum, humFilter, humGain, swingGain, swingFilter, burnGain, burnFilter, holdGain, holdOsc, tensionGain, roomGain, musicGain;
  let surgeGain, surgeOsc, surgeFilter, surgeCrackle;
  let volume = 0.8;
  const listener = { x: 0, z: 0, rx: 1, rz: 0 };
  const voices = { shots: [], steps: [] };
  const lastRadio = new WeakMap();
  const radioBuffers = new Map();
  let clock = 0, lastAnyRadio = -Infinity, tension = 0;

  // ---- The mix ---------------------------------------------------------------
  function build() {
    ctx = context ?? new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = volume;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.09;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20; glue.knee.value = 12; glue.ratio.value = 3.2; glue.attack.value = 0.005; glue.release.value = 0.24;
    muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass'; muffle.frequency.value = 20000; muffle.Q.value = 0.6;
    muffle.connect(glue); glue.connect(limiter); limiter.connect(master); master.connect(ctx.destination);
    dry = ctx.createGain();
    dry.connect(muffle);
    // The score (music.js) has its own way in, muffled by a blast like the rest.
    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(muffle);
    const reverb = ctx.createConvolver();
    reverb.buffer = roomImpulse();
    const back = ctx.createGain();
    back.gain.value = 0.32;
    reverb.connect(back); back.connect(muffle);
    send = ctx.createGain();
    send.connect(reverb);
    white = noiseBuffer(2, () => Math.random() * 2 - 1);
    pink = pinkBuffer(2);
    crackle = crackleBuffer(1.5);
    layers();
    ready = true;
  }
  /** A metal hall: a few early reflections off the walls, then a dense tail that dulls as it dies (1.4 s). */
  function roomImpulse() {
    const rate = ctx.sampleRate, length = Math.floor(rate * 1.6), buffer = ctx.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let low = 0;
      for (let i = 0; i < length; i++) {
        const t = i / rate;
        // The tail loses its highs as it decays: a one-pole filter closing over time.
        const k = 0.65 - 0.55 * Math.min(1, t / 1.2);
        low += ((Math.random() * 2 - 1) - low) * k;
        data[i] = low * Math.exp(-t / 0.32) * Math.min(1, t / 0.008) * 0.6;
      }
      for (const [delay, gain] of [[0.011, 0.55], [0.019, 0.42], [0.027, 0.35], [0.041, 0.28], [0.057, 0.2]]) {
        const at = Math.floor((delay + channel * 0.0023 * Math.random()) * rate);
        data[at] += gain * (channel ? -1 : 1);
      }
    }
    return buffer;
  }
  function noiseBuffer(seconds, sample) {
    const length = Math.floor(ctx.sampleRate * seconds), buffer = ctx.createBuffer(1, length, ctx.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = sample(i);
    return buffer;
  }
  function pinkBuffer(seconds) {
    let b0 = 0, b1 = 0, b2 = 0;
    return noiseBuffer(seconds, () => {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
      return (b0 + b1 + b2 + w * 0.1848) * 0.2;
    });
  }
  /** Electric crackle: sparse sharp clicks of random strength over a faint hiss. */
  function crackleBuffer(seconds) {
    let spike = 0;
    return noiseBuffer(seconds, () => {
      if (Math.random() < 0.006) spike = (Math.random() * 2 - 1) * (0.4 + Math.random() * 0.6);
      spike *= 0.82;
      return spike + (Math.random() * 2 - 1) * 0.06;
    });
  }

  /** Where a sound sits: panned by its place across the screen, fainter and duller far off. */
  function voice(at = null, { gain = 1, reverb = 0.2, spread = 8 } = {}) {
    const input = ctx.createGain(), filter = ctx.createBiquadFilter(), panner = ctx.createStereoPanner(), wet = ctx.createGain();
    let level = gain, pan = 0, cutoff = 20000, distance = 0;
    if (at) {
      const dx = at.x - listener.x, dz = at.z - listener.z;
      distance = Math.hypot(dx, dz);
      level *= 1 / (1 + (distance / 7) ** 1.5);
      pan = clamp((dx * listener.rx + dz * listener.rz) / spread, -1, 1) * 0.85;
      cutoff = 19000 / (1 + distance / 6);
    }
    input.gain.value = level;
    filter.type = 'lowpass'; filter.frequency.value = cutoff; filter.Q.value = 0.4;
    panner.pan.value = pan;
    wet.gain.value = reverb * (1 + distance / 9);
    input.connect(filter); filter.connect(panner); panner.connect(dry); panner.connect(wet); wet.connect(send);
    return { input, panner, distance };
  }

  // ---- Building blocks ------------------------------------------------------------
  /** A tone sweeping from → to over its length, with a quick attack and an exponential fall. */
  function tone(dest, { type = 'sine', from = 440, to = from, duration = 0.2, gain = 0.1, delay = 0, attack = 0.004, detune = 0 } = {}) {
    const now = ctx.currentTime + delay, osc = ctx.createOscillator(), level = ctx.createGain();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(Math.max(1, from), now);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), now + duration);
    level.gain.setValueAtTime(0.0001, now);
    level.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + attack);
    level.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(level); level.connect(dest);
    osc.start(now); osc.stop(now + duration + 0.05);
    return osc;
  }
  /** A burst of noise through a filter (whose centre may sweep), shaped by an attack and a decay. */
  function hiss(dest, { buffer = white, type = 'bandpass', frequency = 2000, to = frequency, q = 0.8, duration = 0.2, gain = 0.1, delay = 0, attack = 0.003, rate = 1 } = {}) {
    const now = ctx.currentTime + delay, source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), level = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    filter.type = type; filter.Q.value = q;
    filter.frequency.setValueAtTime(frequency, now);
    if (to !== frequency) filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + duration);
    level.gain.setValueAtTime(0.0001, now);
    level.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + attack);
    level.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter); filter.connect(level); level.connect(dest);
    const offset = Math.random() * Math.max(0, buffer.duration - duration - 0.05);
    source.start(now, offset, duration + 0.05);
    return source;
  }
  /** A struck metal plate: a few inharmonic partials ringing down. */
  function ring(dest, { base = 900, partials = [1, 2.76, 5.4], duration = 0.3, gain = 0.05, delay = 0 } = {}) {
    partials.forEach((ratio, index) => tone(dest, { from: base * ratio, to: base * ratio * 0.985, duration: duration / (1 + index * 0.6), gain: gain / (1 + index * 0.8), delay }));
  }

  // ---- Continuous layers ---------------------------------------------------------
  function layers() {
    // The blade's hum: two saws beating a little, a resonant low-pass; brighter and higher with the swing.
    humGain = ctx.createGain(); humGain.gain.value = 0;
    humFilter = ctx.createBiquadFilter(); humFilter.type = 'lowpass'; humFilter.frequency.value = 420; humFilter.Q.value = 5;
    hum = [90, 90.8, 180.4].map((frequency, index) => {
      const osc = ctx.createOscillator(), level = ctx.createGain();
      osc.type = index === 2 ? 'triangle' : 'sawtooth';
      osc.frequency.value = frequency;
      level.gain.value = index === 2 ? 0.35 : 0.5;
      osc.connect(level); level.connect(humFilter);
      osc.start();
      return osc;
    });
    // A faint electric whine on top.
    const whine = ctx.createOscillator(), whineLevel = ctx.createGain();
    whine.frequency.value = 2310; whineLevel.gain.value = 0.012;
    whine.connect(whineLevel); whineLevel.connect(humGain);
    whine.start();
    humFilter.connect(humGain);
    humGain.connect(dry);
    const humWet = ctx.createGain(); humWet.gain.value = 0.15; humGain.connect(humWet); humWet.connect(send);
    // The swoosh: band-passed noise that opens with the blade's speed.
    ({ gain: swingGain, filter: swingFilter } = loop(pink, { type: 'bandpass', frequency: 700, q: 1.3, reverb: 0.25 }));
    // Burning: the crackle looped, while the blade is in something.
    ({ gain: burnGain, filter: burnFilter } = loop(crackle, { type: 'bandpass', frequency: 3000, q: 0.7, reverb: 0.2 }));
    // The Force holding a man up: a deep, trembling rumble.
    holdGain = ctx.createGain(); holdGain.gain.value = 0;
    holdOsc = ctx.createOscillator(); holdOsc.type = 'sawtooth'; holdOsc.frequency.value = 46;
    const holdFilter = ctx.createBiquadFilter(); holdFilter.type = 'lowpass'; holdFilter.frequency.value = 170; holdFilter.Q.value = 3;
    const tremolo = ctx.createOscillator(), depth = ctx.createGain();
    tremolo.frequency.value = 7.5; depth.gain.value = 0.35;
    const holdLevel = ctx.createGain(); holdLevel.gain.value = 0.65;
    tremolo.connect(depth); depth.connect(holdLevel.gain);
    holdOsc.connect(holdFilter); holdFilter.connect(holdLevel); holdLevel.connect(holdGain); holdGain.connect(dry);
    holdOsc.start(); tremolo.start();
    const holdAir = loop(pink, { type: 'bandpass', frequency: 420, q: 2, reverb: 0.3 });
    holdAir.gain.connect(holdGain);
    holdAir.gain.disconnect(dry);
    holdAir.gain.gain.value = 0.5;
    // The room: ventilation, a mains hum, the deep tone of a station.
    roomGain = ctx.createGain(); roomGain.gain.value = 0;
    roomGain.connect(dry);
    const vent = loop(pink, { type: 'bandpass', frequency: 1800, q: 0.4, reverb: 0 });
    vent.gain.gain.value = 0.006; vent.gain.disconnect(dry); vent.gain.connect(roomGain);
    const rumble = loop(pink, { type: 'lowpass', frequency: 110, q: 0.7, reverb: 0 });
    rumble.gain.gain.value = 0.018; rumble.gain.disconnect(dry); rumble.gain.connect(roomGain);
    for (const [frequency, level] of [[50, 0.004], [100, 0.002], [150, 0.001]]) {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.frequency.value = frequency; g.gain.value = level;
      osc.connect(g); g.connect(roomGain); osc.start();
    }
    // A transformer overloading: a whine climbing through a narrowing band, crackle over it.
    surgeGain = ctx.createGain(); surgeGain.gain.value = 0;
    surgeFilter = ctx.createBiquadFilter(); surgeFilter.type = 'bandpass'; surgeFilter.frequency.value = 300; surgeFilter.Q.value = 6;
    surgeOsc = [0, 7].map(detune => { const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 100; osc.detune.value = detune * 10; osc.connect(surgeFilter); osc.start(); return osc; });
    surgeFilter.connect(surgeGain);
    surgeCrackle = loop(crackle, { type: 'highpass', frequency: 1800, q: 0.5, reverb: 0 });
    surgeCrackle.gain.disconnect(dry); surgeCrackle.gain.connect(surgeGain); surgeCrackle.gain.gain.value = 1.4;
    surgeGain.connect(dry);
    const surgeWet = ctx.createGain(); surgeWet.gain.value = 0.35; surgeGain.connect(surgeWet); surgeWet.connect(send);
    // Tension: a low pulsing bed, while the squad fights.
    tensionGain = ctx.createGain(); tensionGain.gain.value = 0;
    const tensionFilter = ctx.createBiquadFilter(); tensionFilter.type = 'lowpass'; tensionFilter.frequency.value = 150; tensionFilter.Q.value = 2;
    const pulse = ctx.createOscillator(), pulseDepth = ctx.createGain(), pulsed = ctx.createGain();
    pulse.frequency.value = 1.1; pulseDepth.gain.value = 0.45; pulsed.gain.value = 0.55;
    pulse.connect(pulseDepth); pulseDepth.connect(pulsed.gain);
    for (const frequency of [41.2, 41.5, 61.7]) {
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = frequency; osc.connect(tensionFilter); osc.start();
    }
    tensionFilter.connect(pulsed); pulsed.connect(tensionGain); tensionGain.connect(dry);
    const tensionWet = ctx.createGain(); tensionWet.gain.value = 0.4; tensionGain.connect(tensionWet); tensionWet.connect(send);
    pulse.start();
  }
  /** A looped noise through a filter, silent until its gain is raised. */
  function loop(buffer, { type, frequency, q, reverb }) {
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = buffer; source.loop = true;
    filter.type = type; filter.frequency.value = frequency; filter.Q.value = q;
    gain.gain.value = 0;
    source.connect(filter); filter.connect(gain); gain.connect(dry);
    if (reverb) { const wet = ctx.createGain(); wet.gain.value = reverb; gain.connect(wet); wet.connect(send); }
    source.start(0, Math.random() * buffer.duration);
    return { gain, filter };
  }

  const api = {
    enabled: false,
    /** 0 → 1: how fast the blade cuts the air this frame. */
    swing: 0,
    /** The audio may only start on a gesture (a key, a button, a click). */
    start() {
      if (!ctx) build();
      ctx.resume?.().catch(() => {});
    },
    get context() { return ctx; },
    /** Where the score plays into the mix (null before the first start()). */
    get music() { return musicGain ?? null; },
    set volume(value) { volume = value; if (master) master.gain.setTargetAtTime(value, ctx.currentTime, 0.05); },
    get volume() { return volume; },
    /** Where the hero stands and which way is screen-right on the floor: sounds are placed from there. */
    listen(position, right) { listener.x = position.x; listener.z = position.z; listener.rx = right.x; listener.rz = right.z; },
    /**
     * Each frame: saber (0 → 1, lit), the hero's speed, his turn rate, burn
     * (0 → 1: the blade inside something), hold (0 → 1: a man held up by the
     * Force), fight (0 → 1: the squad's alarm).
     */
    update(saber, speed, turn, { burn = 0, hold = 0, fight = 0, dt = 1 / 60, surge = 0, power = 1, dark = 0 } = {}) {
      if (!ready) return;
      const now = ctx.currentTime, on = this.enabled ? 1 : 0, swing = clamp(this.swing, 0, 1);
      humGain.gain.setTargetAtTime(on * saber * (0.035 + swing * 0.05), now, 0.03);
      humFilter.frequency.setTargetAtTime(420 + swing * 1500 + speed * 25, now, 0.03);
      hum.forEach((osc, index) => osc.frequency.setTargetAtTime([90, 90.8, 180.4][index] * (1 + swing * 0.32 + speed * 0.012) + Math.abs(turn) * 0.8, now, 0.03));
      swingGain.gain.setTargetAtTime(on * saber * swing ** 1.6 * 0.3, now, 0.025);
      swingFilter.frequency.setTargetAtTime(500 + swing * 1100, now, 0.03);
      burnGain.gain.setTargetAtTime(on * burn * 0.17, now, burn > 0 ? 0.02 : 0.08);
      burnFilter.frequency.setTargetAtTime(2200 + burn * 1600, now, 0.05);
      holdGain.gain.setTargetAtTime(on * hold * 0.035, now, hold > 0 ? 0.08 : 0.2);
      holdOsc.frequency.setTargetAtTime(44 + hold * 6, now, 0.2);
      // The room's hum dies with its power (a trace of wind left in the vents).
      roomGain.gain.setTargetAtTime(on * (0.25 + 0.75 * power), now, power < 0.5 ? 0.12 : 0.5);
      musicGain.gain.setTargetAtTime(on, now, 0.1);
      surgeGain.gain.setTargetAtTime(on * surge ** 1.5 * 0.09, now, surge > 0 ? 0.03 : 0.06);
      for (const osc of surgeOsc) osc.frequency.setTargetAtTime(90 + surge * surge * 820, now, 0.05);
      surgeFilter.frequency.setTargetAtTime(220 + surge * 2600, now, 0.05);
      tension += (fight - tension) * (1 - Math.exp(-dt / (fight > tension ? 1.5 : 5)));
      // In the dark the bed is there even before the fight, and thicker.
      tensionGain.gain.setTargetAtTime(on * Math.max(tension, dark * 0.75) * (0.018 + dark * 0.012), now, 0.3);
      clock += dt;
    },

    // ---- The blade ----------------------------------------------------------------
    /** The snap-hiss: a crack of static, then the hum rising into being. */
    ignite() {
      if (!this.enabled || !ready) return;
      const v = voice(null, { gain: 1, reverb: 0.3 });
      hiss(v.input, { type: 'highpass', frequency: 1800, duration: 0.14, gain: 0.16, attack: 0.002 });
      hiss(v.input, { buffer: crackle, type: 'bandpass', frequency: 3200, q: 0.6, duration: 0.3, gain: 0.22 });
      const body = ctx.createBiquadFilter();
      body.type = 'lowpass'; body.Q.value = 6;
      body.frequency.setValueAtTime(160, ctx.currentTime);
      body.frequency.exponentialRampToValueAtTime(1300, ctx.currentTime + 0.18);
      body.frequency.exponentialRampToValueAtTime(420, ctx.currentTime + 0.5);
      body.connect(v.input);
      tone(body, { type: 'sawtooth', from: 38, to: 96, duration: 0.55, gain: 0.32, attack: 0.02 });
      tone(body, { type: 'sawtooth', from: 39, to: 97, duration: 0.5, gain: 0.22, attack: 0.02 });
    },
    /** Switched off: the hum sinks and sputters out. */
    retract() {
      if (!this.enabled || !ready) return;
      const v = voice(null, { gain: 1, reverb: 0.3 });
      const body = ctx.createBiquadFilter();
      body.type = 'lowpass'; body.Q.value = 5;
      body.frequency.setValueAtTime(900, ctx.currentTime);
      body.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.4);
      body.connect(v.input);
      tone(body, { type: 'sawtooth', from: 98, to: 34, duration: 0.42, gain: 0.26, attack: 0.01 });
      hiss(v.input, { buffer: crackle, type: 'bandpass', frequency: 2400, q: 0.6, duration: 0.25, gain: 0.1, delay: 0.05 });
    },
    /** The blade bites: crackle, a burn and a thump; heavier, a deeper boom and a longer burn. */
    impact(strength = 1, at = null) {
      if (!this.enabled || !ready) return;
      const v = voice(at, { gain: (0.6 + strength * 0.5) * 2.2, reverb: 0.25 });
      hiss(v.input, { buffer: crackle, type: 'bandpass', frequency: 2600 + Math.random() * 900, q: 0.5, duration: 0.18 + strength * 0.22, gain: 0.5 });
      hiss(v.input, { type: 'highpass', frequency: 4500, duration: 0.03, gain: 0.12 * strength });
      tone(v.input, { type: 'sawtooth', from: 320 + Math.random() * 60, to: 110, duration: 0.16 + strength * 0.12, gain: 0.05 * strength });
      tone(v.input, { from: 125, to: 46, duration: 0.2, gain: 0.3 * strength });
      if (strength > 0.8) {
        tone(v.input, { from: 70, to: 32, duration: 0.42, gain: 0.32, attack: 0.006 });
        hiss(v.input, { buffer: pink, type: 'lowpass', frequency: 600, to: 180, duration: 0.35, gain: 0.2 });
      }
    },
    /** A bolt on the blade: crack and ring. A perfect parry rings out bright and clear, a chime over it. */
    deflect(perfect = false, at = null) {
      if (!this.enabled || !ready) return;
      const v = voice(at, { gain: perfect ? 3.4 : 6, reverb: perfect ? 0.5 : 0.3 });
      const pitch = 1 + (Math.random() - 0.5) * 0.12;
      hiss(v.input, { buffer: crackle, type: 'highpass', frequency: 2000, duration: 0.09, gain: 0.45 });
      tone(v.input, { from: 3100 * pitch, to: 2150 * pitch, duration: 0.28, gain: 0.05 });
      tone(v.input, { from: 4550 * pitch, to: 3500 * pitch, duration: 0.2, gain: 0.03 });
      tone(v.input, { type: 'triangle', from: 700, to: 230, duration: 0.12, gain: 0.08 });
      if (perfect) {
        // A chime (G6 and D7, slightly beating) and an airy swell going away.
        for (const [frequency, gain] of [[1568, 0.06], [2349, 0.045], [3136, 0.02]]) tone(v.input, { from: frequency, duration: 0.9, gain, attack: 0.003, detune: Math.random() * 6 });
        hiss(v.input, { buffer: pink, type: 'bandpass', frequency: 900, to: 3800, q: 1.1, duration: 0.35, gain: 0.18, attack: 0.04 });
      }
    },
    /** The blade dragged along a wall or the floor: a hiss of molten metal (the burn layer does the rest). */
    sizzle(at = null) {
      if (!this.enabled || !ready) return;
      const v = voice(at, { gain: 0.8, reverb: 0.2 });
      hiss(v.input, { buffer: crackle, type: 'highpass', frequency: 3000, duration: 0.3, gain: 0.3 });
    },

    // ---- Blasters -------------------------------------------------------------------
    /** A shot: the falling chirp of a blaster — the highs first, then the body — with a pop at the muzzle. */
    shot(at = null) {
      if (!this.enabled || !ready) return;
      // No more than a few shots at once: the oldest is not cut, the newest is softer.
      const now = ctx.currentTime;
      voices.shots = voices.shots.filter(time => now - time < 0.12);
      const crowd = voices.shots.length;
      voices.shots.push(now);
      const v = voice(at, { gain: 6 / (1 + crowd * 0.4), reverb: 0.3, spread: 9 });
      const p = 1 + (Math.random() - 0.5) * 0.16;
      tone(v.input, { type: 'sawtooth', from: 2300 * p, to: 160 * p, duration: 0.19, gain: 0.05 });
      tone(v.input, { type: 'square', from: 1600 * p, to: 120 * p, duration: 0.15, gain: 0.025 });
      tone(v.input, { from: 3600 * p, to: 500 * p, duration: 0.09, gain: 0.04 });
      tone(v.input, { from: 180, to: 70, duration: 0.07, gain: 0.12 });
      hiss(v.input, { type: 'bandpass', frequency: 3500, q: 0.9, duration: 0.04, gain: 0.12 });
    },
    /** A bolt bursting on a crate or the floor. */
    boltImpact(at = null) {
      if (!this.enabled || !ready) return;
      const v = voice(at, { gain: 4.5, reverb: 0.3 });
      hiss(v.input, { type: 'lowpass', frequency: 2400, to: 500, duration: 0.14, gain: 0.25 });
      hiss(v.input, { buffer: crackle, type: 'bandpass', frequency: 2600, q: 0.7, duration: 0.12, gain: 0.25 });
      tone(v.input, { from: 240, to: 70, duration: 0.11, gain: 0.12 });
    },
    /** A bolt passing close: a whizz that sweeps from one ear to the other. */
    flyby(at, velocity) {
      if (!this.enabled || !ready) return;
      const v = voice(at, { gain: 2.8, reverb: 0.15 });
      const side = clamp(velocity.x * listener.rx + velocity.z * listener.rz, -1, 1);
      v.panner.pan.setValueAtTime(-side * 0.7, ctx.currentTime);
      v.panner.pan.linearRampToValueAtTime(side * 0.8, ctx.currentTime + 0.22);
      tone(v.input, { type: 'sawtooth', from: 1250, to: 520, duration: 0.24, gain: 0.025, attack: 0.03 });
      hiss(v.input, { type: 'bandpass', frequency: 2600, to: 900, q: 2, duration: 0.24, gain: 0.12, attack: 0.04 });
    },
    /** A bolt burning the hero's robe. */
    burn(at = null) {
      if (!this.enabled || !ready) return;
      const v = voice(at, { gain: 2.7, reverb: 0.15 });
      hiss(v.input, { buffer: crackle, type: 'highpass', frequency: 2600, duration: 0.32, gain: 0.4 });
      tone(v.input, { from: 150, to: 60, duration: 0.14, gain: 0.25 });
      tone(v.input, { type: 'sawtooth', from: 520, to: 260, duration: 0.18, gain: 0.03 });
    },

    // ---- Bodies -----------------------------------------------------------------------
    /** A footstep on the deck: a dull tap with a little metallic ring; the troopers' armour clacks. */
    step(at = null, { pace = 0.5, armour = false } = {}) {
      if (!this.enabled || !ready) return;
      const now = ctx.currentTime;
      voices.steps = voices.steps.filter(time => now - time < 0.05);
      if (voices.steps.length > 3) return;
      voices.steps.push(now);
      const v = voice(at, { gain: (0.25 + pace * 0.55) * (armour ? 0.6 : 1) * 2.2, reverb: 0.18 });
      const p = 1 + (Math.random() - 0.5) * 0.2;
      tone(v.input, { from: 140 * p, to: 70, duration: 0.07, gain: 0.22 });
      hiss(v.input, { type: 'bandpass', frequency: 1900 * p, q: 1.2, duration: 0.035, gain: 0.08 + pace * 0.06 });
      tone(v.input, { from: 1180 * p, to: 1160 * p, duration: 0.08, gain: 0.008 });
      if (armour) hiss(v.input, { type: 'bandpass', frequency: 3200 * p, q: 3, duration: 0.025, gain: 0.08, delay: 0.012 });
    },
    /** A body on the floor: a thump and the armour's clatter. */
    thud(strength = 1, at = null) {
      if (!this.enabled || !ready) return;
      const v = voice(at, { gain: (0.5 + strength * 0.6) * 1.9, reverb: 0.25 });
      tone(v.input, { from: 95, to: 38, duration: 0.24, gain: 0.35 });
      hiss(v.input, { buffer: pink, type: 'lowpass', frequency: 500, duration: 0.18, gain: 0.25 });
      for (let i = 0; i < 2 + Math.round(strength * 3); i++) hiss(v.input, { type: 'bandpass', frequency: 2200 + Math.random() * 1800, q: 4, duration: 0.03, gain: 0.07, delay: 0.02 + Math.random() * 0.18 });
    },
    /** Armour clattering off: a hollow plastic clack. */
    clank(at = null) {
      if (!this.enabled || !ready) return;
      const v = voice(at, { gain: 2.4, reverb: 0.25 });
      hiss(v.input, { type: 'bandpass', frequency: 1700 + Math.random() * 600, q: 5, duration: 0.05, gain: 0.2 });
      ring(v.input, { base: 760 + Math.random() * 200, partials: [1, 2.4], duration: 0.12, gain: 0.03 });
      hiss(v.input, { type: 'bandpass', frequency: 2600, q: 5, duration: 0.03, gain: 0.1, delay: 0.09 + Math.random() * 0.05 });
    },

    // ---- The Force and the dash ---------------------------------------------------------
    /** A push rushes out (a rising roar, a deep wom); a pull draws in (falling, then a snap). */
    force(kind) {
      if (!this.enabled || !ready) return;
      const v = voice(null, { gain: kind === 'push' ? 1.3 : 0.6, reverb: 0.45 });
      if (kind === 'push') {
        hiss(v.input, { buffer: pink, frequency: 220, to: 1600, q: 1.2, duration: 0.5, gain: 0.5, attack: 0.03 });
        tone(v.input, { from: 70, to: 34, duration: 0.55, gain: 0.4, attack: 0.02 });
        tone(v.input, { type: 'triangle', from: 140, to: 60, duration: 0.3, gain: 0.12 });
      } else {
        hiss(v.input, { buffer: pink, frequency: 1700, to: 260, q: 1.4, duration: 0.45, gain: 0.45, attack: 0.15 });
        tone(v.input, { from: 40, to: 75, duration: 0.42, gain: 0.3, attack: 0.15 });
        hiss(v.input, { type: 'highpass', frequency: 2500, duration: 0.05, gain: 0.1, delay: 0.4 });
      }
    },
    /** The dash: a crack of air and a short electric tear. */
    dash() {
      if (!this.enabled || !ready) return;
      const v = voice(null, { gain: 3.5, reverb: 0.3 });
      hiss(v.input, { buffer: pink, frequency: 2400, to: 500, q: 1, duration: 0.24, gain: 0.55, attack: 0.008 });
      hiss(v.input, { buffer: crackle, type: 'bandpass', frequency: 4200, q: 0.8, duration: 0.14, gain: 0.25 });
      tone(v.input, { from: 110, to: 50, duration: 0.14, gain: 0.18 });
    },
    /** A strike's whoosh as it starts (the swing layer carries the rest). */
    whoosh(strength = 1) {
      if (!this.enabled || !ready) return;
      const v = voice(null, { gain: (0.6 + strength * 0.4) * 2.4, reverb: 0.2 });
      hiss(v.input, { buffer: pink, frequency: 500, to: 1500, q: 1.4, duration: 0.2, gain: 0.25, attack: 0.05 });
    },

    // ---- Grenades and explosions ------------------------------------------------------
    /** Thrown: a flick of air. */
    toss(at = null) {
      if (!this.enabled || !ready) return;
      const v = voice(at, { gain: 2, reverb: 0.2 });
      hiss(v.input, { buffer: pink, frequency: 700, to: 1300, q: 1.5, duration: 0.18, gain: 0.25, attack: 0.04 });
    },
    /** A grenade bouncing on the deck: a small metal clink. */
    clink(at = null, strength = 1) {
      if (!this.enabled || !ready) return;
      const v = voice(at, { gain: (0.4 + strength * 0.5) * 3.9, reverb: 0.3 });
      ring(v.input, { base: 2100 + Math.random() * 300, partials: [1, 2.3, 3.9], duration: 0.18, gain: 0.04 });
      tone(v.input, { from: 220, to: 120, duration: 0.04, gain: 0.08 });
    },
    /** The countdown: a short beep, higher as time runs out. */
    beep(progress = 0, at = null) {
      if (!this.enabled || !ready) return;
      const v = voice(at, { gain: 4.2, reverb: 0.2 });
      const pitch = 1700 + progress * 900;
      tone(v.input, { type: 'square', from: pitch, to: pitch * 0.98, duration: 0.05, gain: 0.03 });
    },
    /**
     * A blast: a crack, a heavy body, a sub-bass drop, debris raining down.
     * Close by (closeness → 1) the hearing goes: everything dulls and a ring
     * in the ears fades as it comes back.
     */
    boom(at = null, closeness = 0) {
      if (!this.enabled || !ready) return;
      const v = voice(at, { gain: 1.3, reverb: 0.55, spread: 12 });
      hiss(v.input, { type: 'highpass', frequency: 1200, duration: 0.12, gain: 0.6, attack: 0.001 });
      hiss(v.input, { buffer: crackle, type: 'bandpass', frequency: 1800, q: 0.5, duration: 0.45, gain: 0.5 });
      hiss(v.input, { buffer: pink, type: 'lowpass', frequency: 900, to: 160, q: 0.5, duration: 2.4, gain: 1.1, attack: 0.004 });
      tone(v.input, { from: 62, to: 26, duration: 1.4, gain: 0.85, attack: 0.004 });
      tone(v.input, { type: 'triangle', from: 130, to: 42, duration: 0.6, gain: 0.3 });
      for (let i = 0; i < 12; i++) {
        const delay = 0.25 + Math.random() ** 1.6 * 1.6;
        hiss(v.input, { type: 'bandpass', frequency: 1800 + Math.random() * 3000, q: 5, duration: 0.03, gain: 0.05 + Math.random() * 0.07, delay });
      }
      if (closeness > 0.05) {
        const now = ctx.currentTime;
        muffle.frequency.cancelScheduledValues(now);
        muffle.frequency.setValueAtTime(muffle.frequency.value, now);
        muffle.frequency.exponentialRampToValueAtTime(20000 - closeness * 19400, now + 0.04);
        muffle.frequency.setTargetAtTime(20000, now + 0.3 + closeness * 0.5, 0.35 + closeness * 0.5);
        const ears = ctx.createGain();
        ears.gain.value = closeness;
        ears.connect(master);
        tone(ears, { from: 3800, to: 3700, duration: 1.4 + closeness * 1.6, gain: 0.025, attack: 0.08 });
      }
    },

    /**
     * The hero dies: a heavy dull hit, the room sinking under water, a ringing
     * in the ears and two slow heartbeats — then the sound comes back.
     */
    death() {
      if (!this.enabled || !ready) return;
      const v = voice(null, { gain: 1.4, reverb: 0.5 });
      tone(v.input, { from: 90, to: 32, duration: 0.7, gain: 0.8, attack: 0.002 });
      hiss(v.input, { buffer: pink, type: 'lowpass', frequency: 500, to: 120, duration: 0.9, gain: 0.6, attack: 0.003 });
      for (const delay of [0.55, 1.45]) {
        tone(v.input, { from: 58, to: 40, duration: 0.16, gain: 0.55, delay });
        tone(v.input, { from: 52, to: 36, duration: 0.18, gain: 0.4, delay: delay + 0.2 });
      }
      const now = ctx.currentTime;
      muffle.frequency.cancelScheduledValues(now);
      muffle.frequency.setValueAtTime(muffle.frequency.value, now);
      muffle.frequency.exponentialRampToValueAtTime(420, now + 0.08);
      muffle.frequency.setTargetAtTime(20000, now + 1.6, 0.7);
      const ears = ctx.createGain();
      ears.gain.value = 1;
      ears.connect(master);
      tone(ears, { from: 3900, to: 3850, duration: 2.6, gain: 0.03, attack: 0.1 });
    },

    // ---- The transformer and the blackout ------------------------------------------------
    /** Electricity biting: a tearing crackle, a few bright chirps, a dull thump. */
    zap(at = null, strength = 1) {
      if (!this.enabled || !ready) return;
      const v = voice(at, { gain: 1.6 * strength, reverb: 0.35 });
      hiss(v.input, { buffer: crackle, type: 'highpass', frequency: 1500, duration: 0.25 + 0.2 * strength, gain: 0.7 });
      for (let i = 0; i < 3; i++) tone(v.input, { type: 'square', from: 2400 + Math.random() * 2000, to: 600 + Math.random() * 400, duration: 0.05 + Math.random() * 0.06, gain: 0.025, delay: Math.random() * 0.12 });
      tone(v.input, { from: 140, to: 50, duration: 0.18, gain: 0.25 * strength });
    },
    /** The transformer blowing: a crack of discharge, a heavy bang, a metal ring, a hiss of things burning. */
    bang(at = null) {
      if (!this.enabled || !ready) return;
      const v = voice(at, { gain: 2.2, reverb: 0.7, spread: 14 });
      hiss(v.input, { type: 'highpass', frequency: 900, duration: 0.1, gain: 0.8, attack: 0.001 });
      hiss(v.input, { buffer: crackle, type: 'bandpass', frequency: 2600, q: 0.5, duration: 0.9, gain: 0.9 });
      tone(v.input, { from: 75, to: 24, duration: 1.1, gain: 0.8, attack: 0.002 });
      tone(v.input, { type: 'square', from: 3200, to: 300, duration: 0.25, gain: 0.05 });
      ring(v.input, { base: 340, partials: [1, 2.7, 5.1], duration: 1.4, gain: 0.05, delay: 0.02 });
      hiss(v.input, { buffer: pink, type: 'lowpass', frequency: 700, to: 150, duration: 1.8, gain: 0.5, attack: 0.01 });
    },
    /** The room's power dying: the mains hum sinking and stopping, relays clunking off one after another. */
    powerDown() {
      if (!this.enabled || !ready) return;
      const v = voice(null, { gain: 1.4, reverb: 0.6 });
      const body = ctx.createBiquadFilter();
      body.type = 'lowpass'; body.frequency.value = 500; body.Q.value = 3;
      body.connect(v.input);
      tone(body, { type: 'sawtooth', from: 120, to: 28, duration: 2.2, gain: 0.35, attack: 0.01 });
      tone(body, { type: 'sawtooth', from: 60, to: 18, duration: 2.6, gain: 0.3, attack: 0.01 });
      for (let i = 0; i < 4; i++) tone(v.input, { type: 'square', from: 110 - i * 12, to: 55, duration: 0.09, gain: 0.07, delay: 0.15 + i * 0.22 + Math.random() * 0.1 });
      hiss(v.input, { buffer: pink, type: 'lowpass', frequency: 220, duration: 2.5, gain: 0.25, attack: 0.05 });
    },
    /** A light fitting dying: a little pop and a tinkle. */
    pop(at = null) {
      if (!this.enabled || !ready) return;
      const v = voice(at, { gain: 1.4, reverb: 0.4 });
      hiss(v.input, { buffer: crackle, type: 'highpass', frequency: 2500, duration: 0.09, gain: 0.5 });
      ring(v.input, { base: 2800 + Math.random() * 800, partials: [1, 1.9], duration: 0.12, gain: 0.02, delay: 0.02 });
    },
    /** A rifle lamp switched on: a hard little click. */
    click(at = null) {
      if (!this.enabled || !ready) return;
      const v = voice(at, { gain: 2, reverb: 0.3 });
      tone(v.input, { type: 'square', from: 2600, to: 2400, duration: 0.012, gain: 0.05 });
      hiss(v.input, { type: 'bandpass', frequency: 4200, q: 3, duration: 0.02, gain: 0.12, delay: 0.004 });
    },

    // ---- The room and the squad ---------------------------------------------------------
    /** The door's klaxon: two falling tones, twice, echoing in the hall. */
    alarm(at = null) {
      if (!this.enabled || !ready) return;
      const v = voice(at, { gain: 3, reverb: 0.6, spread: 14 });
      for (let k = 0; k < 2; k++) {
        tone(v.input, { type: 'sawtooth', from: 540, to: 520, duration: 0.34, gain: 0.03, delay: k * 0.75, attack: 0.02 });
        tone(v.input, { type: 'sawtooth', from: 410, to: 395, duration: 0.34, gain: 0.03, delay: k * 0.75 + 0.37, attack: 0.02 });
      }
    },
    /** The door's leaves: a hiss of hydraulics, a heavy rumble, a clunk as they stop. */
    door(at = null) {
      if (!this.enabled || !ready) return;
      const v = voice(at, { gain: 1, reverb: 0.5, spread: 14 });
      hiss(v.input, { type: 'highpass', frequency: 3000, duration: 0.5, gain: 0.08, attack: 0.02 });
      hiss(v.input, { buffer: pink, type: 'lowpass', frequency: 260, duration: 1.3, gain: 0.35, attack: 0.15 });
      tone(v.input, { type: 'square', from: 95, to: 58, duration: 0.16, gain: 0.08, delay: 1.25 });
      ring(v.input, { base: 310, partials: [1, 2.7], duration: 0.4, gain: 0.03, delay: 1.25 });
    },
    /** "?" — a wondering rise; "!" — the alert's sharp double sting (quiet: the radio says the rest). */
    alert(kind, at = null) {
      if (!this.enabled || !ready) return;
      const v = voice(at, { gain: 0.8, reverb: 0.2 });
      if (kind === '!') {
        tone(v.input, { type: 'square', from: 1320, to: 1300, duration: 0.06, gain: 0.025 });
        tone(v.input, { type: 'square', from: 1760, to: 1740, duration: 0.13, gain: 0.025, delay: 0.06 });
      } else tone(v.input, { type: 'triangle', from: 480, to: 760, duration: 0.2, gain: 0.04 });
    },
    /**
     * A trooper on the squad radio: a click, a few clipped syllables of
     * band-limited "speech" (their count and contour set by what he says),
     * a click and a crackle. Never two at once; each man not too often.
     * kind: 'contact' (spotted him), 'move' (moving up), 'cover' (covering
     * fire), 'flank', 'down' (a man down), 'grenade', 'lost' (lost sight).
     */
    /** A French line behind a push-to-talk click, a clear narrow radio band and light carrier noise. */
    radioClip(path, { rate = 1, onStart, onEnd, onError } = {}) {
      if (!this.enabled || !ready) return null;
      let cancelled = false, source = null;
      const handle = {
        stop() {
          cancelled = true;
          try { source?.stop(); } catch { /* already stopped */ }
        },
      };
      let request = radioBuffers.get(path);
      if (!request) {
        request = fetch(path).then(response => {
          if (!response.ok) throw new Error(`Radio voice ${response.status}`);
          return response.arrayBuffer();
        }).then(bytes => ctx.decodeAudioData(bytes));
        radioBuffers.set(path, request);
        request.catch(() => radioBuffers.delete(path));
      }
      request.then(buffer => {
        if (cancelled || !this.enabled) return;
        source = ctx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = rate;
        const high = ctx.createBiquadFilter(), low = ctx.createBiquadFilter(), presence = ctx.createBiquadFilter();
        const shaper = ctx.createWaveShaper(), compressor = ctx.createDynamicsCompressor(), level = ctx.createGain();
        high.type = 'highpass'; high.frequency.value = 280;
        low.type = 'lowpass'; low.frequency.value = 2950;
        presence.type = 'peaking'; presence.frequency.value = 1550; presence.Q.value = 0.9; presence.gain.value = 3;
        const curve = new Float32Array(256);
        for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i / 128 - 1) * 1.65) * 0.82;
        shaper.curve = curve;
        compressor.threshold.value = -27; compressor.knee.value = 8; compressor.ratio.value = 2.7;
        compressor.attack.value = 0.004; compressor.release.value = 0.12;
        level.gain.value = 1.06;
        source.connect(high); high.connect(low); low.connect(presence); presence.connect(shaper);
        shaper.connect(compressor); compressor.connect(level); level.connect(dry);
        source.onended = () => { if (!cancelled) onEnd?.(); };
        const pushToTalk = 0.11;
        source.start(ctx.currentTime + pushToTalk);
        onStart?.(pushToTalk + buffer.duration / rate);
      }).catch(error => { if (!cancelled) onError?.(error); });
      return handle;
    },
    /** Click opens the channel before speech; faint static and irregular crackle sit underneath it. */
    radioCarrier(duration = 3) {
      if (!this.enabled || !ready) return;
      const v = voice(null, { gain: 0.5, reverb: 0 });
      const gate = ctx.createGain();
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass'; band.frequency.value = 1700; band.Q.value = 0.7;
      band.connect(gate); gate.connect(v.input);
      const start = ctx.currentTime;
      const staticBed = ctx.createBufferSource(), staticLevel = ctx.createGain();
      staticBed.buffer = pink; staticBed.loop = true;
      staticLevel.gain.setValueAtTime(0.0001, start);
      staticLevel.gain.linearRampToValueAtTime(0.07, start + 0.08);
      staticLevel.gain.setValueAtTime(0.07, start + Math.max(0.09, duration - 0.1));
      staticLevel.gain.linearRampToValueAtTime(0.0001, start + duration);
      staticBed.connect(staticLevel); staticLevel.connect(band);
      staticBed.start(start); staticBed.stop(start + duration + 0.02);
      // The opening squelch ends just before the first phoneme.
      tone(band, { type: 'square', from: 1700, to: 760, duration: 0.035, gain: 0.16 });
      hiss(band, { buffer: crackle, type: 'bandpass', frequency: 2250, duration: 0.095, gain: 0.36 });
      for (let at = 0.35; at < duration - 0.16; at += 0.34 + Math.random() * 0.19) {
        if (Math.random() < 0.72) hiss(band, { buffer: crackle, type: 'bandpass', frequency: 1400 + Math.random() * 1100, duration: 0.025, gain: 0.075, delay: at });
      }
      tone(band, { type: 'square', from: 1100, to: 600, duration: 0.028, gain: 0.1, delay: Math.max(0.25, duration - 0.055) });
      return { stop() {
        gate.gain.setTargetAtTime(0, ctx.currentTime, 0.012);
        try { staticBed.stop(ctx.currentTime + 0.04); } catch { /* already ended */ }
      } };
    },
    /** The last syllable is severed by a short broken-carrier snap. */
    radioDrop() {
      if (!this.enabled || !ready) return;
      const v = voice(null, { gain: 0.35, reverb: 0 });
      hiss(v.input, { buffer: crackle, type: 'bandpass', frequency: 1450, duration: 0.13, gain: 0.28 });
      tone(v.input, { type: 'square', from: 1550, to: 420, duration: 0.065, gain: 0.12 });
    },
    radio(at, kind, speaker = null) {
      if (!this.enabled || !ready) return false;
      if (clock - lastAnyRadio < 0.7) return false;
      if (speaker && clock - (lastRadio.get(speaker) ?? -Infinity) < 2.2) return false;
      lastAnyRadio = clock;
      if (speaker) lastRadio.set(speaker, clock);
      const shape = {
        contact: { syllables: 3, base: 1300, rise: 0.25, fast: true },
        move: { syllables: 2, base: 1050, rise: -0.1, fast: false },
        cover: { syllables: 3, base: 1150, rise: 0, fast: true },
        flank: { syllables: 4, base: 1000, rise: 0.1, fast: false },
        down: { syllables: 4, base: 950, rise: -0.3, fast: false },
        grenade: { syllables: 3, base: 1450, rise: 0.15, fast: true },
        lost: { syllables: 4, base: 900, rise: -0.15, fast: false },
      }[kind] ?? { syllables: 3, base: 1100, rise: 0, fast: false };
      const v = voice(at, { gain: 0.24, reverb: 0.15, spread: 10 });
      // The radio's grit: band-limited, a little overdriven.
      const band = ctx.createBiquadFilter(), shaper = ctx.createWaveShaper(), low = ctx.createBiquadFilter();
      band.type = 'highpass'; band.frequency.value = 480;
      low.type = 'lowpass'; low.frequency.value = 3200;
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 3.2) * 0.8; }
      shaper.curve = curve;
      band.connect(shaper); shaper.connect(low); low.connect(v.input);
      // Click on.
      tone(low, { type: 'square', from: 2100, to: 2050, duration: 0.018, gain: 0.05 });
      let t = 0.05;
      for (let i = 0; i < shape.syllables; i++) {
        const length = (shape.fast ? 0.06 : 0.09) + Math.random() * 0.07;
        const progress = i / Math.max(1, shape.syllables - 1);
        const formant = shape.base * (1 + shape.rise * progress) * (0.85 + Math.random() * 0.3);
        hiss(band, { type: 'bandpass', frequency: formant, to: formant * (0.8 + Math.random() * 0.4), q: 3.5, duration: length, gain: 0.55, delay: t, attack: 0.012 });
        tone(band, { type: 'sawtooth', from: 125 * (1 + shape.rise * progress * 0.4), to: 115, duration: length, gain: 0.05, delay: t, attack: 0.012 });
        t += length + (shape.fast ? 0.025 : 0.045) + Math.random() * 0.03;
      }
      // Click off, a tail of static.
      tone(low, { type: 'square', from: 1800, to: 1750, duration: 0.015, gain: 0.04, delay: t });
      hiss(low, { type: 'highpass', frequency: 1500, duration: 0.12, gain: 0.08, delay: t + 0.01 });
      return true;
    },
  };
  return api;
}
