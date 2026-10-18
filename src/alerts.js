import * as THREE from 'three';
import { ease } from './tween.js';

/**
 * What the enemies feel, drawn above their heads in pixel art: a yellow "?"
 * when one hears or glimpses something, a red "!" when he spots the hero,
 * and little sound marks beside the helmet, on the side a noise came from.
 * Every icon pops: it bursts in white-hot and oversized, overshoots, and
 * settles to its size with a spring (the "?" tilts as it lands, puzzled);
 * it leaves by shrinking away. Always drawn on top, so it reads at a glance.
 */
const GLYPHS = {
  // . empty, o outline, # fill, + highlight
  '!': [
    '..ooo..',
    '.o+##o.',
    '.o+##o.',
    '.o+##o.',
    '.o+##o.',
    '.o+##o.',
    '..o#o..',
    '..o#o..',
    '...o...',
    '..ooo..',
    '.o+##o.',
    '.o###o.',
    '..ooo..',
  ],
  '?': [
    '..ooooo..',
    '.o+####o.',
    'o+##oo##o',
    'o##o..o#o',
    '.oo..o##o',
    '....o##o.',
    '...o##o..',
    '...o#o...',
    '....o....',
    '...ooo...',
    '..o+#o...',
    '..o##o...',
    '...oo....',
  ],
  sound: [
    '.#...#..',
    '..#...#.',
    '..#...#.',
    '..#...#.',
    '.#...#..',
  ],
};
const PALETTE = {
  '!': { '#': [235, 48, 40], '+': [255, 150, 120], o: [32, 6, 8] },
  '?': { '#': [255, 214, 74], '+': [255, 246, 190], o: [44, 30, 4] },
  sound: { '#': [236, 236, 230], '+': [255, 255, 255], o: [30, 30, 30] },
};

function glyphTexture(name, flash = false) {
  const rows = GLYPHS[name], height = rows.length, width = rows[0].length;
  const data = new Uint8Array(width * height * 4);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      // The flash frame: the glyph all white inside its outline.
      const color = flash && row[x] !== 'o' && row[x] !== '.' ? [255, 255, 255] : PALETTE[name][row[x]];
      if (!color) continue;
      // DataTexture rows run bottom-up.
      data.set([...color, 255], ((height - 1 - y) * width + x) * 4);
    }
  });
  const texture = new THREE.DataTexture(data, width, height);
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return { texture, width, height };
}

// Render pixels per metre at the default zoom: icons are drawn about 1:1.
const PIXEL = 1 / 30;

export function createAlerts(scene) {
  const textures = Object.fromEntries(Object.keys(GLYPHS).map(name => [name, glyphTexture(name)]));
  const flashes = { '!': glyphTexture('!', true), '?': glyphTexture('?', true) };
  const entries = new Map();
  const bright = new THREE.Color(1.6, 1.6, 1.6), plain = new THREE.Color(1, 1, 1);
  const sprite = name => {
    const material = new THREE.SpriteMaterial({ map: textures[name].texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    const object = new THREE.Sprite(material);
    object.name = `Alert ${name}`;
    object.renderOrder = 20;
    object.visible = false;
    scene.add(object);
    return object;
  };
  function entry(owner) {
    if (!entries.has(owner)) entries.set(owner, { icon: sprite('!'), marks: sprite('sound'), kind: null, age: 0, leaving: -1, hold: Infinity, mark: { age: Infinity, side: 1 } });
    return entries.get(owner);
  }
  /** Pops a "?" or a "!" over him (a "!" replaces a "?"); it stays for `hold` seconds, or until hidden. */
  function show(owner, kind, { hold = Infinity } = {}) {
    const e = entry(owner);
    if (e.kind === kind && e.leaving < 0) { e.hold = Math.max(e.hold, e.age + hold); return false; }
    e.kind = kind;
    e.icon.material.map = textures[kind].texture;
    e.icon.material.needsUpdate = true;
    Object.assign(e, { age: 0, leaving: -1, hold });
    e.icon.visible = true;
    return true;
  }
  function hide(owner) {
    const e = entries.get(owner);
    if (e?.kind && e.leaving < 0) e.leaving = 0;
  }
  /** Sound marks beside his helmet, on the side the noise came from (side: 1 his left of screen, -1 right). */
  function sound(owner, side = 1) {
    const e = entry(owner);
    Object.assign(e.mark, { age: 0, side: side >= 0 ? 1 : -1 });
    e.marks.visible = true;
  }
  const kindOf = owner => entries.get(owner)?.kind ?? null;

  const right = new THREE.Vector3();
  /** head(owner) gives the top of his head; cameraRight: the screen's right on the floor. */
  function update(dt, head, cameraRight = right.set(1, 0, 0)) {
    for (const [owner, e] of entries) {
      const top = head(owner);
      if (!top) { e.icon.visible = e.marks.visible = false; continue; }
      if (e.kind) {
        e.age += dt;
        if (e.leaving < 0 && e.age > e.hold) e.leaving = 0;
        const { width, height } = textures[e.kind];
        const big = e.kind === '!';
        // Pop: burst in oversized, overshoot, settle — then a gentle bob.
        let scale;
        if (e.age < 0.09) scale = (big ? 1.5 : 1.3) * ease.outQuart(e.age / 0.09);
        else if (e.age < 0.34) scale = 1 + (big ? 0.5 : 0.3) * Math.cos((e.age - 0.09) / 0.25 * Math.PI * 1.5) * (1 - ease.outCubic((e.age - 0.09) / 0.25));
        else scale = 1;
        let lift = big ? 0.12 * Math.sin(Math.min(1, e.age / 0.3) * Math.PI) * (1 - Math.min(1, e.age / 0.3)) : 0;
        lift += Math.sin(e.age * 3.2) * 0.012;
        if (e.leaving >= 0) {
          e.leaving += dt;
          const out = Math.min(1, e.leaving / 0.2);
          scale *= 1 - ease.inCubic(out) * 1.1 + 0.1 * Math.sin(out * Math.PI);
          if (out >= 1) { e.kind = null; e.icon.visible = false; continue; }
        }
        e.icon.scale.set(width * PIXEL * Math.max(0, scale), height * PIXEL * Math.max(0, scale), 1);
        e.icon.position.copy(top).y += 0.34 + lift;
        // A white flash frame, then its own colour, bright at first.
        const map = e.age < 0.06 ? flashes[e.kind].texture : textures[e.kind].texture;
        if (e.icon.material.map !== map) { e.icon.material.map = map; e.icon.material.needsUpdate = true; }
        e.icon.material.color.copy(bright).lerp(plain, ease.outQuad(Math.min(1, e.age / 0.2)));
        // A "?" lands tilted and rights itself.
        e.icon.material.rotation = e.kind === '?' ? 0.35 * Math.exp(-e.age * 7) * Math.cos(e.age * 22) : 0;
      }
      const m = e.mark;
      if (m.age < 0.75) {
        m.age += dt;
        const p = Math.min(1, m.age / 0.75), { width, height } = textures.sound;
        const s = ease.outBack(Math.min(1, m.age / 0.14)) * (1 - ease.inQuad(Math.max(0, (p - 0.55) / 0.45)));
        e.marks.scale.set(width * PIXEL * s * m.side, height * PIXEL * s, 1);
        e.marks.position.copy(top).addScaledVector(cameraRight, m.side * (0.2 + 0.08 * ease.outCubic(p)));
        e.marks.position.y -= 0.08;
        e.marks.visible = s > 0.01;
      } else e.marks.visible = false;
    }
  }
  function clear() {
    for (const e of entries.values()) { e.kind = null; e.icon.visible = e.marks.visible = false; e.mark.age = Infinity; }
  }
  return { show, hide, sound, update, clear, kindOf, entries };
}
