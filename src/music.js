/**
 * The score of the Jedi's coming, synthesised like every other sound (Web
 * Audio, no samples) and played through the game's mix (audio.music).
 *
 * - entrance(): the door opens on a low drone (D, beating saws over a sub),
 *   a dark choir rising over it — D minor leaning on its Phrygian E flat —
 *   and a high string tremolo swelling. Each of his steps is a timpani
 *   stroke (step(), called from his walk), louder as he comes.
 * - ignite(): his blade lit — a brass stab over timpani, a sub drop and a
 *   crash; the choir cut off, the drone dying away.
 * - fight(): 132 BPM — war drums, a driving low-string ostinato, the choir's
 *   chords (D minor, B flat, G minor, A), a brass motif every four bars.
 *   intensity(0 → 1) thickens it (blades locked, a guard broken).
 * - victory(): the loop stops; a D major chord rises and fades.
 *   defeat(): a low minor chord sinks into silence. stop(): all fades now.
 *
 * update() schedules the next notes a little ahead on the audio clock; call
 * it every frame.
 */
const TEMPO = 132, SIXTEENTH = 60 / TEMPO / 4, AHEAD = 0.18;
const hz = midi => 440 * 2 ** ((midi - 69) / 12);
// The fight's harmony, two bars each: roots for the ostinato, voicings for the choir.
const CHORDS = [
  { root: 38, voices: [50, 53, 57, 62], bite: 39 }, // D minor (the E flat bites)
  { root: 34, voices: [50, 53, 58, 62], bite: 36 }, // B flat
  { root: 43, voices: [50, 55, 58, 62], bite: 44 }, // G minor
  { root: 45, voices: [49, 52, 57, 61], bite: 46 }, // A major: the pull back home
];
// The entrance's choir, a chord every few seconds: D minor, E flat, D minor, B flat minor.
const DREAD = [[50, 53, 57], [51, 55, 58], [50, 53, 57], [46, 49, 53]];
// The brass motif (half notes), then its answer.
const MOTIF = [[62, 57, 58, 57], [62, 65, 64, 61]];

export function createMusic(audio) {
  let ctx = null, out = null, noise = null;
  let mode = 'silent', level = 0.6, step = 0, next = 0, dreadAt = 0, dread = 0, steps = 0;
  const held = [];

  function ready() {
    if (out) return true;
    ctx = audio.context;
    if (!ctx || !audio.music) return false;
    out = ctx.createGain();
    out.gain.value = 0.5;
    out.connect(audio.music);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return true;
  }
  /** An envelope on a gain: attack, hold, release (s); returns when it ends. */
  function envelope(param, t, { peak, attack = 0.01, hold = 0, release = 0.3 }) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.setValueAtTime(peak, t + attack + hold);
    param.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    return t + attack + hold + release;
  }
  /** Detuned oscillators through a low-pass that can sweep: strings, brass, drones, choir. */
  function voice(midi, t, { type = 'sawtooth', detune = [-8, 8], gain = 0.05, attack = 0.02, hold = 0.2, release = 0.3, cutoff = 1200, to = cutoff, sweep = 0.2, q = 0.7, vibrato = 0, sustain = false } = {}) {
    const amp = ctx.createGain(), filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.Q.value = q;
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + sweep);
    filter.connect(amp); amp.connect(out);
    const end = sustain ? Infinity : envelope(amp.gain, t, { peak: gain, attack, hold, release });
    if (sustain) { amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(gain, t + attack); }
    const oscillators = detune.map(cents => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = hz(midi);
      osc.detune.value = cents;
      osc.connect(filter);
      osc.start(t);
      if (end < Infinity) osc.stop(end + 0.05);
      return osc;
    });
    if (vibrato) {
      const lfo = ctx.createOscillator(), depth = ctx.createGain();
      lfo.frequency.value = 4.6 + Math.random() * 0.8; depth.gain.value = vibrato;
      lfo.connect(depth);
      for (const osc of oscillators) depth.connect(osc.detune);
      lfo.start(t);
      if (end < Infinity) lfo.stop(end + 0.05);
      oscillators.push(lfo);
    }
    const layer = { amp, oscillators, filter };
    if (sustain) held.push(layer);
    return layer;
  }
  /** A held layer let go: it fades over `fade` s, then stops. */
  function release(layer, t, fade = 0.6) {
    layer.amp.gain.cancelScheduledValues(t);
    layer.amp.gain.setValueAtTime(Math.max(0.0001, layer.amp.gain.value), t);
    layer.amp.gain.exponentialRampToValueAtTime(0.0001, t + fade);
    for (const osc of layer.oscillators) osc.stop(t + fade + 0.05);
    held.splice(held.indexOf(layer), 1);
  }
  function releaseAll(t, fade) { for (const layer of [...held]) release(layer, t, fade); }
  /** A voice choir: detuned saws through two vowel formants ("ah"), slow to swell. */
  function choir(midis, t, duration, gain = 0.03, { sustain = false, attack = 1.2 } = {}) {
    return midis.map(midi => {
      const layer = voice(midi, t, { detune: [-11, 0, 12], gain, attack, hold: duration, release: 1.6, cutoff: 900, to: 1500, sweep: attack, q: 0.4, vibrato: 9, sustain });
      // The vowel: two formant peaks in parallel with the low-passed body.
      for (const [frequency, amount] of [[700, 0.9], [1150, 0.5]]) {
        const formant = ctx.createBiquadFilter();
        formant.type = 'bandpass'; formant.frequency.value = frequency; formant.Q.value = 6;
        const boost = ctx.createGain();
        boost.gain.value = amount;
        layer.oscillators.forEach(osc => osc.type === 'sawtooth' && osc.connect(formant));
        formant.connect(boost); boost.connect(layer.amp);
      }
      return layer;
    });
  }
  /** A timpani stroke: a pitched membrane falling onto its note, the mallet's thud. */
  function timpani(midi, t, gain = 0.25) {
    const amp = ctx.createGain(), osc = ctx.createOscillator(), overtone = ctx.createOscillator();
    osc.type = 'sine'; overtone.type = 'triangle';
    osc.frequency.setValueAtTime(hz(midi) * 1.5, t);
    osc.frequency.exponentialRampToValueAtTime(hz(midi), t + 0.08);
    overtone.frequency.setValueAtTime(hz(midi) * 2.4, t);
    overtone.frequency.exponentialRampToValueAtTime(hz(midi) * 1.5, t + 0.1);
    const toneGain = ctx.createGain();
    toneGain.gain.value = 0.35;
    osc.connect(amp); overtone.connect(toneGain); toneGain.connect(amp); amp.connect(out);
    const end = envelope(amp.gain, t, { peak: gain, attack: 0.004, hold: 0.04, release: 1.3 });
    osc.start(t); overtone.start(t); osc.stop(end); overtone.stop(end);
    thud(t, gain * 0.6, 260);
  }
  /** Noise through a filter: a mallet's thud, a crash, a swell. */
  function thud(t, gain, cutoff, { type = 'lowpass', duration = 0.12, attack = 0.002, to = cutoff } = {}) {
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), amp = ctx.createGain();
    source.buffer = noise;
    source.loop = true;
    filter.type = type; filter.frequency.setValueAtTime(cutoff, t); filter.frequency.exponentialRampToValueAtTime(to, t + duration);
    source.connect(filter); filter.connect(amp); amp.connect(out);
    const end = envelope(amp.gain, t, { peak: gain, attack, hold: 0, release: duration });
    source.start(t, Math.random()); source.stop(end + 0.05);
  }
  /** A war drum: a deep skin falling in pitch and a slap of noise. */
  function drum(t, gain = 0.3, pitch = 1) {
    const amp = ctx.createGain(), osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(95 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(42 * pitch, t + 0.16);
    osc.connect(amp); amp.connect(out);
    const end = envelope(amp.gain, t, { peak: gain, attack: 0.003, hold: 0.02, release: 0.42 });
    osc.start(t); osc.stop(end);
    thud(t, gain * 0.45, 900, { duration: 0.07, to: 200 });
  }
  /** A sub drop: the floor falling away under a hit. */
  function boom(t, gain = 0.4) {
    const amp = ctx.createGain(), osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 1.2);
    osc.connect(amp); amp.connect(out);
    const end = envelope(amp.gain, t, { peak: gain, attack: 0.005, hold: 0.1, release: 1.6 });
    osc.start(t); osc.stop(end);
  }

  // ---- The fight's loop -------------------------------------------------------------
  function sixteenth(t) {
    const bar = Math.floor(step / 16), beat = step % 16, chord = CHORDS[Math.floor(bar / 2) % 4];
    const hard = level > 0.75;
    // Drums: the downbeats, a pushed one before the third, more as it heats up.
    if ([0, 6, 8].includes(beat) || (beat === 14 && level > 0.4) || (hard && [3, 11].includes(beat))) drum(t, beat === 0 ? 0.48 : 0.34, beat === 0 ? 1 : 1.12);
    if (hard && beat % 4 === 2) thud(t, 0.05, 6000, { type: 'highpass', duration: 0.05 });
    // The ostinato on eighths: the root, its octave, the bite.
    if (beat % 2 === 0) {
      const pattern = [0, 0, 12, 0, chord.bite - chord.root, 0, 7, 0];
      voice(chord.root + pattern[beat / 2], t, { gain: 0.075 + level * 0.035, attack: 0.004, hold: SIXTEENTH * 0.9, release: 0.09, cutoff: 1700 + level * 900, to: 380, sweep: 0.12, q: 1.4 });
    }
    // The choir: a chord every two bars.
    if (beat === 0 && bar % 2 === 0) choir(chord.voices, t, SIXTEENTH * 30, 0.016 + level * 0.01, { attack: 0.5 });
    // The brass motif: four half notes over two bars, every eight bars (the answer every other time).
    if (level > 0.45 && beat % 8 === 0 && bar % 8 < 2) {
      const note = MOTIF[Math.floor(bar / 8) % 2][(bar % 8) * 2 + beat / 8];
      voice(note, t, { detune: [-6, 5], gain: 0.03 + level * 0.02, attack: 0.08, hold: SIXTEENTH * 6, release: 0.5, cutoff: 500, to: 2600, sweep: 0.25, q: 0.9, vibrato: 7 });
    }
    // Blades locked, a guard broken: a high string tremolo over it all.
    if (hard && beat % 4 === 0) voice(chord.voices[3] + 12, t, { detune: [-4, 4], gain: 0.012, attack: 0.02, hold: SIXTEENTH * 3, release: 0.1, cutoff: 3000, q: 0.5 });
  }

  return {
    get mode() { return mode; },
    /** The door opens on him: the drone, the choir, the tremolo. */
    entrance() {
      if (!ready()) { mode = 'entrance'; return; }
      const t = ctx.currentTime + 0.05;
      releaseAll(t, 0.3);
      mode = 'entrance'; dread = 0; dreadAt = t + 1.2; steps = 0;
      voice(26, t, { detune: [-9, 0, 7], gain: 0.07, attack: 3, cutoff: 160, to: 520, sweep: 9, q: 1.8, sustain: true });
      voice(38, t + 0.5, { detune: [-5, 6], gain: 0.03, attack: 3, cutoff: 240, to: 700, sweep: 9, q: 1.2, sustain: true });
      voice(26, t, { type: 'sine', detune: [0], gain: 0.085, attack: 2.5, cutoff: 200, sustain: true });
      voice(69, t + 3, { detune: [-6, 6], gain: 0.006, attack: 6, cutoff: 3000, q: 0.5, vibrato: 30, sustain: true });
      thud(t, 0.05, 2000, { type: 'highpass', duration: 5, attack: 4.5, to: 9000 });
    },
    /** One of his steps: a timpani stroke, a little louder each time. */
    step() {
      if (!ready() || mode !== 'entrance') return;
      steps++;
      timpani(steps % 4 === 3 ? 33 : 38, ctx.currentTime + 0.01, Math.min(0.32, 0.12 + steps * 0.02));
    },
    /** His blade lit: the stab, the drop, the crash. */
    ignite() {
      if (!ready()) return;
      const t = ctx.currentTime + 0.02;
      releaseAll(t, 0.12);
      mode = 'held';
      for (const midi of [38, 45, 50, 53, 57]) voice(midi, t, { detune: [-9, -2, 7], gain: 0.045, attack: 0.012, hold: 0.35, release: 1.4, cutoff: 3400, to: 700, sweep: 0.8, q: 0.8, vibrato: 6 });
      timpani(38, t, 0.4); timpani(26, t + 0.01, 0.3);
      boom(t, 0.45);
      thud(t, 0.18, 7000, { type: 'highpass', duration: 1.6, to: 3000 });
      voice(26, t + 0.3, { detune: [-9, 7], gain: 0.05, attack: 0.2, hold: 0.6, release: 2.2, cutoff: 300, to: 120, sweep: 2 });
    },
    /** The fight begins (or begins again): the loop, from its first bar. */
    fight() {
      if (!ready()) { mode = 'fight'; return; }
      releaseAll(ctx.currentTime, 0.3);
      mode = 'fight'; step = 0; next = ctx.currentTime + 0.08;
    },
    /** 0 → 1: how hard the fight is going. */
    intensity(value) { level = Math.max(0, Math.min(1, value)); },
    victory() {
      if (!ready()) { mode = 'silent'; return; }
      const t = ctx.currentTime + 0.05;
      releaseAll(t, 0.4);
      mode = 'silent';
      timpani(38, t, 0.3);
      choir([50, 54, 57, 62], t + 0.1, 3.2, 0.02, { attack: 1.4 });
      for (const midi of [50, 57, 62]) voice(midi, t + 0.6, { detune: [-5, 6], gain: 0.025, attack: 1.2, hold: 2, release: 2.6, cutoff: 600, to: 1800, sweep: 1.6, vibrato: 5 });
    },
    defeat() {
      if (!ready()) { mode = 'silent'; return; }
      const t = ctx.currentTime + 0.05;
      releaseAll(t, 0.5);
      mode = 'silent';
      choir([38, 41, 45], t, 1.6, 0.02, { attack: 0.8 });
      voice(26, t, { detune: [-9, 7], gain: 0.06, attack: 0.4, hold: 1.5, release: 3, cutoff: 260, to: 90, sweep: 4 });
    },
    stop() {
      mode = 'silent';
      if (ctx && out) releaseAll(ctx.currentTime, 0.5);
    },
    /** Each frame: the next notes, scheduled a little ahead. */
    update() {
      if (!out && (mode === 'silent' || !ready())) return;
      const now = ctx.currentTime;
      if (mode === 'fight') {
        if (next < now) next = now + 0.02;
        while (next < now + AHEAD) { sixteenth(next); step++; next += SIXTEENTH; }
      } else if (mode === 'entrance' && now >= dreadAt) {
        choir(DREAD[dread % DREAD.length], dreadAt, 3.2, 0.016 + Math.min(0.012, dread * 0.004), { attack: 1.4 });
        dread++;
        dreadAt += 3.4;
      }
    },
  };
}
