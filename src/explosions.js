import * as THREE from 'three';
import { ease } from './tween.js';
import { emberTexture } from './scorch-marks.js';

/**
 * Blender-rendered volumetric fire and smoke, viewed from the game camera.
 * The atlas carries straight-alpha colour and a separate linear heat mask;
 * only incandescent regions become HDR light, leaving soot dark. Coverage
 * is interpolated in premultiplied space between the authored frames.
 *
 * Around it, all live: a blinding flash that lights the room and fades from
 * white to orange, a flare, a shockwave racing over the floor, a slower ring
 * of broken ground dust, the floor glowing where it burst (it cools in a few seconds), a
 * burn left for good on the floor and on the crates around (scorch-marks.js),
 * and the fire reflected in the wet metal floor by a shader that traces the
 * mirror ray up to the flipbook.
 * Sparks, embers and debris come from their own systems (see main.js).
 */
const DEFAULTS = { frames: 56, columns: 8, rows: 7, size: 192, width: 6.6, centre: 1.7, duration: 2.3 };

// More samples during the initial pressure burst, fewer during slow cooling.
// Both the fire and its reflection must use the original render timestamps.
function frameAtTime(meta, time, progress) {
  const times = meta.frameTimes;
  if (!Array.isArray(times) || times.length !== meta.frames) {
    return (meta.frames - 1) * (meta.playback === 'linear' ? progress : 1 - (1 - progress) ** 1.75);
  }
  if (time <= times[0]) return 0;
  if (time >= times.at(-1)) return times.length - 1;
  let lo = 0, hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= time) lo = mid; else hi = mid;
  }
  return lo + (time - times[lo]) / (times[hi] - times[lo]);
}
const FRAME_GLSL = /* glsl */`
  uniform sampler2D map, heatMap;
  uniform float frameA, frameB, blend, columns, rows, cellSize, hasHeat;
  vec2 frameUV(float index, vec2 uv) {
    float column = mod(index, columns), row = floor(index / columns);
    // Never filter across a neighbouring atlas cell, including its empty edge.
    uv = clamp(uv, vec2(0.5 / cellSize), vec2(1.0 - 0.5 / cellSize));
    return vec2((column + uv.x) / columns, 1.0 - (row + 1.0 - uv.y) / rows);
  }
  vec4 flipbook(vec2 uv) {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
    vec4 a = texture2D(map, frameUV(frameA, uv));
    vec4 b = texture2D(map, frameUV(frameB, uv));
    // Interpolate coverage, not the arbitrary colour of transparent pixels.
    float alpha = mix(a.a, b.a, blend);
    return vec4(mix(a.rgb * a.a, b.rgb * b.a, blend) / max(alpha, 0.00001), alpha);
  }
  float heatOf(vec4 c, vec2 uv) {
    float warm = clamp((c.r - c.b) * 2.0, 0.0, 1.0) * smoothstep(0.25, 0.8, c.r);
    float fallback = max(warm, smoothstep(0.75, 0.98, min(c.r, min(c.g, c.b))));
    float heat = mix(texture2D(heatMap, frameUV(frameA, uv)).r, texture2D(heatMap, frameUV(frameB, uv)).r, blend);
    return mix(fallback, heat, hasHeat);
  }
`;

/** Shared by the game and effects studio: metadata selects the matching atlases. */
export async function loadExplosionAssets(explosions, base = 'fx/') {
  const root = base.endsWith('/') ? base : `${base}/`;
  const response = await fetch(`${root}explosion.json`);
  if (!response.ok) throw new Error(`Explosion metadata: HTTP ${response.status}`);
  const data = await response.json();
  const loader = new THREE.TextureLoader();
  const [texture, heatTexture] = await Promise.all([
    loader.loadAsync(`${root}${data.image || 'explosion.png'}`),
    data.heatImage ? loader.loadAsync(`${root}${data.heatImage}`) : Promise.resolve(null),
  ]);
  for (const atlas of [texture, heatTexture]) if (atlas) {
    atlas.colorSpace = atlas === texture ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    atlas.minFilter = atlas.magFilter = THREE.NearestFilter;
    atlas.generateMipmaps = false;
  }
  explosions.configure({ texture, heatTexture, data });
  return data;
}

export function createExplosions(scene, { random = Math.random, slots = 2, marks = null } = {}) {
  let meta = { ...DEFAULTS }, map = null;
  const uniformsFor = () => ({
    map: { value: null }, heatMap: { value: null }, hasHeat: { value: 0 }, cellSize: { value: meta.size },
    frameA: { value: 0 }, frameB: { value: 0 }, blend: { value: 0 }, columns: { value: meta.columns }, rows: { value: meta.rows },
  });
  const quad = new THREE.PlaneGeometry(1, 1);
  const glowTexture = (() => {
    const n = 32, data = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const d = Math.min(1, Math.hypot((x + 0.5) / n * 2 - 1, (y + 0.5) / n * 2 - 1));
      data.set([255, 255, 255, Math.round((1 - d) ** 2 * 255)], (y * n + x) * 4);
    }
    const texture = new THREE.DataTexture(data, n, n);
    texture.needsUpdate = true;
    return texture;
  })();
  const embers = emberTexture();
  const pool = Array.from({ length: slots }, () => {
    // The flipbook: on its own layer, so the planar floor mirror does not
    // reflect a camera-facing quad — the reflection shader below does it right.
    const billboard = new THREE.Mesh(quad, new THREE.ShaderMaterial({
      uniforms: { ...uniformsFor(), glow: { value: 1.8 }, opacity: { value: 1 } },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`${FRAME_GLSL}
        uniform float glow, opacity; varying vec2 vUv;
        void main() {
          vec4 c = flipbook(vUv);
          if (c.a < 0.004) discard;
          float alpha = c.a * opacity;
          float heat = heatOf(c, vUv);
          gl_FragColor = vec4(c.rgb * (1.0 + heat * heat * glow) * alpha, alpha);
        }`,
      transparent: true, depthWrite: false, premultipliedAlpha: true,
    }));
    billboard.name = 'Explosion';
    billboard.layers.set(1);
    billboard.renderOrder = 5;
    billboard.visible = false;
    // The fire mirrored in the wet floor, plus the pool of light it throws.
    const reflection = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      uniforms: {
        ...uniformsFor(), centre: { value: new THREE.Vector3() }, width: { value: meta.width }, right: { value: new THREE.Vector3(1, 0, 0) }, up: { value: new THREE.Vector3(0, 1, 0) },
        view: { value: new THREE.Vector3(0, -1, 0) }, strength: { value: 1 }, flash: { value: 0 }, light: { value: new THREE.Color(1, 0.5, 0.18) }, time: { value: 0 },
      },
      vertexShader: /* glsl */`varying vec3 vWorld; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`${FRAME_GLSL}
        uniform vec3 centre, right, up, view, light; uniform float width, strength, flash, time; varying vec3 vWorld;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          // The mirror ray from this floor point, up to the flipbook's plane.
          vec3 mirrored = vec3(view.x, -view.y, view.z);
          float denominator = dot(mirrored, -view);
          if (abs(denominator) < 0.001) discard;
          float t = dot(centre - vWorld, -view) / denominator;
          vec3 hit = vWorld + mirrored * t - centre;
          vec2 uv = vec2(dot(hit, right), dot(hit, up)) / width + 0.5;
          // Brushed, wet metal: the reflection wavers and streaks.
          vec2 ripple = vec2(noise(vWorld.xz * 2.6 + time * 0.3), noise(vWorld.xz * 2.6 + 17.0 - time * 0.2)) - 0.5;
          uv += ripple * vec2(0.012, 0.035);
          vec4 c = t > 0.0 ? flipbook(uv) : vec4(0.0);
          float heat = heatOf(c, uv);
          float grain = 0.7 + 0.3 * noise(vWorld.xz * vec2(23.0, 3.0));
          vec3 mirror = c.rgb * vec3(1.0, 0.62, 0.25) * c.a * (0.025 + heat * 1.8) * grain;
          float reach = length(vWorld.xz - centre.xz);
          float fade = 1.0 - smoothstep(width * 0.1, width * 0.7, reach);
          // The light pool: the flash lights the floor around the blast.
          vec3 pool = light * flash * exp(-reach * reach / (width * width * 0.06));
          gl_FragColor = vec4((mirror * fade + pool) * strength, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    reflection.name = 'Explosion reflection';
    reflection.rotation.x = -Math.PI / 2;
    reflection.renderOrder = 2;
    reflection.visible = false;
    const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    flare.name = 'Explosion flare';
    flare.visible = false;
    const ring = (color, opacity, blending) => {
      const mesh = new THREE.Mesh(quad, new THREE.ShaderMaterial({
        uniforms: { color: { value: color }, opacity: { value: opacity }, phase: { value: 0 }, seed: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */`
          uniform vec3 color; uniform float opacity, phase, seed; varying vec2 vUv;
          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
          void main() {
            vec2 p = (vUv - 0.5) * 2.0;
            float n = noise(p * 6.0 + seed + phase * 0.7);
            float r = length(p) + (n - 0.5) * 0.24;
            float band = smoothstep(0.32, 0.65, r) * (1.0 - smoothstep(0.69, 0.94, r));
            float cloud = smoothstep(0.2, 0.7, noise(p * 13.0 - seed));
            gl_FragColor = vec4(color, band * cloud * opacity);
          }`,
        transparent: true, depthWrite: false, blending, side: THREE.DoubleSide,
      }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      return mesh;
    };
    const shock = ring(new THREE.Color(1.3, 0.85, 0.5), 1, THREE.AdditiveBlending);
    shock.name = 'Shockwave';
    const dust = ring(new THREE.Color(0.2, 0.17, 0.14), 0.5, THREE.NormalBlending);
    dust.name = 'Ground dust';
    // Where it burst the floor glows, blotchy and ember-specked, then cools.
    const heat = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({ map: embers, color: 0x000000, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }));
    heat.name = 'Blast heat';
    heat.rotation.x = -Math.PI / 2;
    heat.visible = false;
    const light = new THREE.PointLight(0xffd8a0, 0, 14, 1.4);
    scene.add(billboard, reflection, flare, shock, dust, heat, light);
    return { billboard, reflection, flare, shock, dust, heat, light, at: new THREE.Vector3(), age: Infinity, power: 1, live: false, heatAge: Infinity };
  });
  let next = 0;
  const white = new THREE.Color(1, 0.95, 0.85), orange = new THREE.Color(1, 0.45, 0.12);
  const hot = new THREE.Color(3, 2.6, 2.1), warm = new THREE.Color(2.4, 0.9, 0.25);

  /** Uses the Blender flipbook (texture + its metadata). */
  function configure({ texture = null, heatTexture = null, data = null } = {}) {
    if (data) meta = { ...DEFAULTS, ...data };
    map = texture;
    for (const slot of pool) {
      for (const mesh of [slot.billboard, slot.reflection]) {
        Object.assign(mesh.material.uniforms.columns, { value: meta.columns });
        Object.assign(mesh.material.uniforms.rows, { value: meta.rows });
        mesh.material.uniforms.map.value = texture;
        mesh.material.uniforms.heatMap.value = heatTexture || texture;
        mesh.material.uniforms.hasHeat.value = heatTexture ? 1 : 0;
        mesh.material.uniforms.cellSize.value = meta.size;
      }
      slot.billboard.material.uniforms.glow.value = meta.glow ?? 1.8;
      slot.reflection.material.uniforms.width.value = meta.width;
      // A grenade can detonate before the first network/decode completes.
      // Its clock already runs; reveal the current frame as soon as it loads.
      slot.billboard.visible = slot.reflection.visible = slot.live && Boolean(texture);
    }
  }
  /** A blast at `at` (on the floor). */
  function spawn(at, { power = 1 } = {}) {
    const slot = pool[next];
    next = (next + 1) % pool.length;
    // A grenade-sized blast.
    Object.assign(slot, { age: 0, power, live: true, heatAge: 0, spin: random() < 0.5 ? 1 : -1, size: 0.75 + random() * 0.08 });
    slot.at.copy(at).setY(0);
    slot.billboard.visible = Boolean(map);
    slot.reflection.visible = Boolean(map);
    slot.flare.visible = slot.shock.visible = slot.dust.visible = slot.heat.visible = true;
    slot.heat.position.copy(slot.at).setY(0.006);
    slot.heat.scale.setScalar((1.1 + random() * 0.3) * power);
    slot.heat.rotation.z = random() * Math.PI * 2;
    for (const mesh of [slot.shock, slot.dust]) mesh.material.uniforms.seed.value = random() * 100;
    slot.reflection.material.uniforms.time.value = 0;
    marks?.blast(slot.at, power);
    return slot;
  }
  const right = new THREE.Vector3(), up = new THREE.Vector3(), view = new THREE.Vector3();
  function update(dt, camera = null) {
    if (camera) {
      camera.getWorldDirection(view);
      right.set(1, 0, 0).applyQuaternion(camera.quaternion);
      up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    }
    for (const slot of pool) {
      if (slot.heat.visible) {
        // White-orange, then deep red, then out; the embers flicker as they go.
        const age = (slot.heatAge += dt);
        const glow = Math.min(1, age / 0.12) * (1 - THREE.MathUtils.smoothstep(age, 0.4, 6)) * (0.9 + 0.1 * Math.sin(age * 23 + slot.spin));
        slot.heat.material.color.setRGB(2.6 * glow, 1.05 * glow ** 1.6, 0.3 * glow ** 3);
        if (age > 6) slot.heat.visible = false;
      }
      if (!slot.live) continue;
      slot.age += dt;
      const t = slot.age, p = Math.min(1, t / meta.duration), power = slot.power;
      const frame = frameAtTime(meta, t, p);
      const a = Math.floor(frame), b = Math.min(meta.frames - 1, a + 1);
      for (const mesh of [slot.billboard, slot.reflection]) {
        const u = mesh.material.uniforms;
        u.frameA.value = a; u.frameB.value = b; u.blend.value = frame - a;
      }
      if (camera) {
        // Same size and centre as the Blender camera's frame, a little nearer
        // the camera so the floor in front of the blast does not cut it.
        const scale = slot.size * (0.9 + 0.1 * power);
        const width = meta.width * scale;
        slot.billboard.quaternion.copy(camera.quaternion);
        slot.billboard.scale.set(width, width, 1);
        slot.billboard.position.copy(slot.at).setY(meta.centre * scale).addScaledVector(view, -(meta.depthBias ?? 1.1));
        slot.billboard.material.uniforms.opacity.value = meta.dissipation === 'erosion' ? 1 : 1 - THREE.MathUtils.smoothstep(p, 0.82, 1);
        const r = slot.reflection.material.uniforms;
        r.centre.value.copy(slot.at).setY(meta.centre * scale);
        r.right.value.copy(right);
        r.up.value.copy(up);
        r.view.value.copy(view);
        r.width.value = width;
        r.time.value += dt;
        slot.reflection.position.copy(slot.at).setY(0.012);
        slot.reflection.scale.set(width * 1.3, width * 1.3, 1);
      }
      // The flash: blinding at once, white cooling to orange, gone in half a second.
      const flash = Math.exp(-t * 18) * Math.min(1, t / 0.016);
      const fire = (1 - Math.exp(-t * 36)) * Math.exp(-t * 2.8);
      slot.light.position.copy(slot.at).setY(0.6);
      slot.light.intensity = power * (70 * flash + 22 * fire);
      slot.light.color.copy(white).lerp(orange, Math.min(1, t / 0.09));
      slot.reflection.material.uniforms.flash.value = flash * 0.4 + fire * 0.24;
      slot.reflection.material.uniforms.light.value.copy(slot.light.color);
      slot.flare.position.copy(slot.at).setY(0.35);
      const flareP = Math.min(1, t / 0.16);
      const flareWidth = (0.4 + 1.2 * ease.outExpo(flareP)) * power;
      slot.flare.scale.set(flareWidth, flareWidth * 0.7, 1);
      slot.flare.material.color.copy(hot).lerp(warm, flareP);
      slot.flare.material.opacity = 0.65 * (1 - ease.outQuad(flareP));
      slot.flare.visible = flareP < 1;
      // The shockwave races out over the floor; the dust follows, slower.
      const shockP = Math.min(1, t / 0.18);
      slot.shock.position.copy(slot.at).setY(0.03);
      slot.shock.scale.setScalar(0.5 + 6.8 * ease.outCubic(shockP) * power);
      slot.shock.material.uniforms.opacity.value = 0.34 * (1 - shockP) ** 2;
      slot.shock.material.uniforms.phase.value = shockP;
      slot.shock.visible = shockP < 1;
      const dustP = Math.min(1, t / 1.3);
      slot.dust.position.copy(slot.at).setY(0.02);
      slot.dust.scale.setScalar(0.6 + 5.0 * ease.outExpo(dustP) * power);
      slot.dust.material.uniforms.opacity.value = 0.24 * Math.sin(Math.PI * Math.min(1, dustP * 1.6)) * (1 - dustP);
      slot.dust.material.uniforms.phase.value = dustP;
      slot.dust.visible = dustP < 1;
      if (p >= 1) {
        slot.live = false;
        slot.billboard.visible = slot.reflection.visible = false;
        slot.light.intensity = 0;
      }
    }
  }
  function clear() {
    for (const slot of pool) {
      slot.live = false;
      for (const object of [slot.billboard, slot.reflection, slot.flare, slot.shock, slot.dust, slot.heat]) object.visible = false;
      slot.light.intensity = 0;
    }
  }
  return {
    spawn, update, configure, clear, pool,
    get active() { return pool.filter(slot => slot.live).length; },
    get duration() { return meta.duration; },
  };
}
