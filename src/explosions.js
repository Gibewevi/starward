import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ease } from './tween.js';

/**
 * Explosions. The fireball and its smoke are a flipbook pre-computed in
 * Blender (scripts/explosion-blender.py: a Mantaflow fire and smoke
 * simulation rendered with Cycles from the game's own isometric camera), laid
 * over the scene as a camera-facing quad of the same size, so it matches the
 * view pixel for pixel. It plays fast at first and slower as the smoke
 * spreads, cross-fading between frames; its hottest parts are pushed above
 * white so they bloom.
 *
 * Greasy clouds burst out of the blaze, live and in 3D: clusters of dark,
 * sooty puffs — the cauliflower smoke of the reference — that glow with the
 * fire at first, blacken, drift out and up, swell, and thin away puff by puff.
 * Being real geometry, the blast's own light paints their undersides orange.
 *
 * Around it, all live: a blinding flash that lights the room and fades from
 * white to orange, a flare, a shockwave racing over the floor, a slower ring
 * of dust, a scorch left on the floor, and the fire reflected in the wet
 * metal floor by a shader that traces the mirror ray up to the flipbook.
 * Sparks, embers and debris come from their own systems (see main.js).
 */
const DEFAULTS = { frames: 56, columns: 8, rows: 7, width: 6.6, centre: 1.7 };
const FRAME_GLSL = /* glsl */`
  uniform sampler2D map; uniform float frameA, frameB, blend, columns, rows;
  vec4 frameAt(float index, vec2 uv) {
    float column = mod(index, columns), row = floor(index / columns);
    vec2 cell = vec2((column + uv.x) / columns, 1.0 - (row + 1.0 - uv.y) / rows);
    return texture2D(map, cell);
  }
  vec4 flipbook(vec2 uv) {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
    return mix(frameAt(frameA, uv), frameAt(frameB, uv), blend);
  }
  // Fire: orange to yellow and bright; smoke: greyish. 0..1.
  float heatOf(vec4 c) { return clamp((c.r - c.b) * 1.5 - 0.1, 0.0, 1.0) * smoothstep(0.35, 0.9, max(c.r, c.g)); }
`;

export function createExplosions(scene, { random = Math.random, slots = 2 } = {}) {
  let meta = { ...DEFAULTS }, map = null;
  const uniformsFor = () => ({
    map: { value: null }, frameA: { value: 0 }, frameB: { value: 0 }, blend: { value: 0 }, columns: { value: meta.columns }, rows: { value: meta.rows },
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
  const pool = Array.from({ length: slots }, () => {
    // The flipbook: on its own layer, so the planar floor mirror does not
    // reflect a camera-facing quad — the reflection shader below does it right.
    const billboard = new THREE.Mesh(quad, new THREE.ShaderMaterial({
      uniforms: { ...uniformsFor(), glow: { value: 1.25 }, opacity: { value: 1 } },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`${FRAME_GLSL}
        uniform float glow, opacity; varying vec2 vUv;
        void main() {
          vec4 c = flipbook(vUv);
          if (c.a < 0.004) discard;
          gl_FragColor = vec4(c.rgb * (1.0 + heatOf(c) * glow), c.a * opacity);
        }`,
      transparent: true, depthWrite: false,
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
          float t = dot(centre - vWorld, -view) / dot(mirrored, -view);
          vec3 hit = vWorld + mirrored * t - centre;
          vec2 uv = vec2(dot(hit, right), dot(hit, up)) / width + 0.5;
          // Brushed, wet metal: the reflection wavers and streaks.
          vec2 ripple = vec2(noise(vWorld.xz * 2.6 + time * 0.3), noise(vWorld.xz * 2.6 + 17.0 - time * 0.2)) - 0.5;
          uv += ripple * vec2(0.012, 0.035);
          vec4 c = flipbook(uv);
          float heat = heatOf(c);
          vec3 mirror = c.rgb * c.a * (0.08 + heat * 1.7);
          float reach = length(vWorld.xz - centre.xz);
          float fade = smoothstep(width * 0.62, width * 0.1, reach);
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
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending, side: THREE.DoubleSide, toneMapped: blending !== THREE.AdditiveBlending }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      return mesh;
    };
    const shock = ring(new THREE.Color(1.3, 0.85, 0.5), 1, THREE.AdditiveBlending);
    shock.geometry = new THREE.RingGeometry(0.95, 1, 64);
    shock.name = 'Shockwave';
    const dust = ring(new THREE.Color(0.2, 0.17, 0.14), 0.5, THREE.NormalBlending);
    dust.name = 'Dust ring';
    dust.geometry = new THREE.RingGeometry(0.8, 1, 48);
    const scorch = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: 0x050403, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
    scorch.name = 'Blast scorch';
    scorch.rotation.x = -Math.PI / 2;
    scorch.visible = false;
    const light = new THREE.PointLight(0xffd8a0, 0, 14, 1.4);
    scene.add(billboard, reflection, flare, shock, dust, scorch, light);
    return { billboard, reflection, flare, shock, dust, scorch, light, at: new THREE.Vector3(), age: Infinity, power: 1, live: false, scorchAge: Infinity };
  });
  let next = 0;
  const white = new THREE.Color(1, 0.95, 0.85), orange = new THREE.Color(1, 0.45, 0.12);
  // The greasy clouds: every puff of every cloud is one instance.
  const PUFFS = 240;
  // A lumpy ball: the same bumps wherever it is drawn, smooth-shaded.
  const lumpy = (() => {
    const geometry = mergeVertices(new THREE.IcosahedronGeometry(1, 2));
    const p = geometry.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const bump = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719) * 43758.5453;
      v.multiplyScalar(0.84 + 0.3 * (bump - Math.floor(bump)));
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geometry.computeVertexNormals();
    return geometry;
  })();
  const puffMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  // A puff glows by itself while its colour is still fire-orange (red well above blue).
  puffMaterial.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      #ifdef USE_INSTANCING_COLOR
        totalEmissiveRadiance += vColor.rgb * max(0.0, vColor.r - vColor.b - 0.12) * 3.0;
      #endif`);
  };
  const puffs = new THREE.InstancedMesh(lumpy, puffMaterial, PUFFS);
  puffs.name = 'Explosion clouds';
  puffs.castShadow = true;
  puffs.receiveShadow = true;
  puffs.frustumCulled = false;
  puffs.count = 0;
  puffs.setColorAt(0, new THREE.Color());
  scene.add(puffs);
  const clouds = [];
  const glowing = new THREE.Color(1, 0.4, 0.08), soot = new THREE.Color(0.03, 0.027, 0.025), thin = new THREE.Color(0.075, 0.07, 0.066);
  function burstClouds(at, count = 6 + Math.floor(random() * 3)) {
    for (let i = 0; i < count; i++) {
      // Most burst out round the blaze; one or two crown it.
      const crown = i < 2, angle = i / count * Math.PI * 2 + (random() - 0.5) * 1.1, out = crown ? random() * 0.3 : 0.3 + random() * 0.55;
      const cloud = {
        position: new THREE.Vector3(at.x + Math.cos(angle) * out, crown ? 1.1 + random() * 0.4 : 0.45 + random() * 0.8, at.z + Math.sin(angle) * out),
        velocity: new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(1.4 + random() * 2.2).setY(1 + random() * 2.2),
        age: 0, life: 2 + random() * 1.3, delay: random() * 0.12, puffs: [],
      };
      // Cauliflower: many lumps of every size, packed together.
      const lumps = 8 + Math.floor(random() * 6);
      for (let j = 0; j < lumps; j++) {
        const offset = new THREE.Vector3(random() - 0.5, (random() - 0.35) * 0.75, random() - 0.5).multiplyScalar(0.55);
        cloud.puffs.push({ offset, size: 0.12 + random() ** 1.5 * 0.24, delay: random() * 0.14, fade: 0.45 + random() * 0.48, turn: new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * 6, random() * 6, random() * 6)) });
      }
      clouds.push(cloud);
    }
    while (clouds.reduce((sum, cloud) => sum + cloud.puffs.length, 0) > PUFFS) clouds.shift();
  }
  const matrix = new THREE.Matrix4(), scale = new THREE.Vector3(), puffAt = new THREE.Vector3(), puffColor = new THREE.Color();
  function updateClouds(dt) {
    let index = 0;
    for (let i = clouds.length - 1; i >= 0; i--) if (clouds[i].age > clouds[i].life + clouds[i].delay) clouds.splice(i, 1);
    for (const cloud of clouds) {
      cloud.age += dt;
      const t = cloud.age - cloud.delay;
      if (t < 0) continue;
      // Thrown out of the blaze, braked by the air, then lifted by the heat.
      cloud.velocity.x *= Math.exp(-2.6 * dt); cloud.velocity.z *= Math.exp(-2.6 * dt);
      cloud.velocity.y = cloud.velocity.y * Math.exp(-2.2 * dt) + 0.35 * dt;
      cloud.position.addScaledVector(cloud.velocity, dt);
      const p = t / cloud.life, swell = 1 + 0.55 * ease.outCubic(Math.min(1, p * 1.4));
      // Glowing with the fire at first, then black soot, thinning to grey.
      puffColor.copy(glowing).lerp(soot, ease.outQuad(Math.min(1, t / 0.45))).lerp(thin, Math.max(0, (p - 0.4) / 0.6) * 0.7);
      for (const puff of cloud.puffs) {
        const grow = ease.outBack(Math.min(1, Math.max(0, t - puff.delay) / 0.28));
        const fade = p < puff.fade ? 1 : 1 - ease.inCubic(Math.min(1, (p - puff.fade) / Math.max(0.05, 1 - puff.fade)));
        const size = puff.size * grow * swell * fade;
        if (size < 0.004) continue;
        puffAt.copy(cloud.position).addScaledVector(puff.offset, swell);
        matrix.compose(puffAt, puff.turn, scale.setScalar(size));
        puffs.setMatrixAt(index, matrix);
        puffs.setColorAt(index, puffColor);
        if (++index >= PUFFS) break;
      }
    }
    puffs.count = index;
    puffs.instanceMatrix.needsUpdate = true;
    if (puffs.instanceColor) puffs.instanceColor.needsUpdate = true;
  }
  const hot = new THREE.Color(3, 2.6, 2.1), warm = new THREE.Color(2.4, 0.9, 0.25);

  /** Uses the Blender flipbook (texture + its metadata). */
  function configure({ texture = null, data = null } = {}) {
    if (data) meta = { ...DEFAULTS, ...data };
    map = texture;
    for (const slot of pool) {
      for (const mesh of [slot.billboard, slot.reflection]) {
        Object.assign(mesh.material.uniforms.columns, { value: meta.columns });
        Object.assign(mesh.material.uniforms.rows, { value: meta.rows });
        mesh.material.uniforms.map.value = texture;
      }
      slot.reflection.material.uniforms.width.value = meta.width;
    }
  }
  const DURATION = 2.3;
  /** A blast at `at` (on the floor). */
  function spawn(at, { power = 1 } = {}) {
    const slot = pool[next];
    next = (next + 1) % pool.length;
    // A compact, dense blaze.
    Object.assign(slot, { age: 0, power, live: true, scorchAge: 0, spin: random() < 0.5 ? 1 : -1, size: 0.92 + random() * 0.12 });
    slot.at.copy(at).setY(0);
    slot.billboard.visible = Boolean(map);
    slot.reflection.visible = Boolean(map);
    slot.flare.visible = slot.shock.visible = slot.dust.visible = slot.scorch.visible = true;
    slot.scorch.position.copy(slot.at).setY(0.004);
    slot.scorch.scale.setScalar(1.1 + random() * 0.4);
    slot.scorch.rotation.z = random() * Math.PI;
    burstClouds(slot.at);
    return slot;
  }
  const toCamera = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), view = new THREE.Vector3();
  function update(dt, camera = null) {
    updateClouds(dt);
    if (camera) {
      camera.getWorldDirection(view);
      right.set(1, 0, 0).applyQuaternion(camera.quaternion);
      up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    }
    for (const slot of pool) {
      if (slot.scorch.visible) {
        slot.scorchAge += dt;
        slot.scorch.material.opacity = 0.62 * Math.min(1, slot.scorchAge / 0.15) * (1 - THREE.MathUtils.smoothstep(slot.scorchAge, 9, 14));
        if (slot.scorchAge > 14) slot.scorch.visible = false;
      }
      if (!slot.live) continue;
      slot.age += dt;
      const t = slot.age, p = Math.min(1, t / DURATION), power = slot.power;
      // The flipbook: very fast at first, slower as the smoke spreads.
      const frame = (meta.frames - 1) * (1 - (1 - p) ** 1.75);
      const a = Math.floor(frame), b = Math.min(meta.frames - 1, a + 1);
      for (const mesh of [slot.billboard, slot.reflection]) {
        const u = mesh.material.uniforms;
        u.frameA.value = a; u.frameB.value = b; u.blend.value = frame - a;
      }
      if (camera) {
        // Same size and centre as the Blender camera's frame, a little nearer
        // the camera so the floor in front of the blast does not cut it.
        const width = meta.width * slot.size * (0.9 + 0.1 * power);
        slot.billboard.quaternion.copy(camera.quaternion);
        slot.billboard.scale.set(width, width, 1);
        slot.billboard.position.copy(slot.at).setY(meta.centre).addScaledVector(view, -1.6);
        slot.billboard.material.uniforms.opacity.value = 1 - THREE.MathUtils.smoothstep(p, 0.82, 1);
        const r = slot.reflection.material.uniforms;
        r.centre.value.copy(slot.at).setY(meta.centre);
        r.right.value.copy(right);
        r.up.value.copy(up);
        r.view.value.copy(view);
        r.width.value = width;
        r.time.value += dt;
        slot.reflection.position.copy(slot.at).setY(0.012);
        slot.reflection.scale.set(width * 1.3, width * 1.3, 1);
      }
      // The flash: blinding at once, white cooling to orange, gone in half a second.
      const flash = Math.max(0, 1 - ease.outCubic(Math.min(1, t / 0.55))) * (t < 0.04 ? t / 0.04 : 1);
      slot.light.position.copy(slot.at).setY(1.1);
      // The blaze keeps the room lit orange while it burns.
      const burning = Math.max(0, 1 - t / 1.7) ** 1.3;
      slot.light.intensity = 30 * power * flash + 11 * power * burning;
      slot.light.color.copy(white).lerp(orange, Math.min(1, t / 0.2));
      slot.reflection.material.uniforms.flash.value = flash * 0.55 + 0.42 * burning;
      slot.flare.position.copy(slot.at).setY(0.9);
      const flareP = Math.min(1, t / 0.28);
      slot.flare.scale.setScalar((0.8 + 2.1 * ease.outExpo(flareP)) * power);
      slot.flare.material.color.copy(hot).lerp(warm, flareP);
      slot.flare.material.opacity = 0.85 * (1 - ease.outQuad(flareP));
      slot.flare.visible = flareP < 1;
      // The shockwave races out over the floor; the dust follows, slower.
      const shockP = Math.min(1, t / 0.32);
      slot.shock.position.copy(slot.at).setY(0.03);
      slot.shock.scale.setScalar(0.3 + 3.6 * ease.outCubic(shockP) * power);
      slot.shock.material.opacity = 0.7 * (1 - shockP) ** 2;
      slot.shock.visible = shockP < 1;
      const dustP = Math.min(1, t / 1.3);
      slot.dust.position.copy(slot.at).setY(0.02);
      slot.dust.scale.setScalar(0.4 + 3.8 * ease.outExpo(dustP) * power);
      slot.dust.material.opacity = 0.28 * Math.sin(Math.PI * Math.min(1, dustP * 1.6)) * (1 - dustP);
      slot.dust.visible = dustP < 1;
      if (p >= 1) {
        slot.live = false;
        slot.billboard.visible = slot.reflection.visible = false;
        slot.light.intensity = 0;
      }
    }
  }
  function clear() {
    clouds.length = 0;
    updateClouds(0);
    for (const slot of pool) {
      slot.live = false;
      for (const object of [slot.billboard, slot.reflection, slot.flare, slot.shock, slot.dust, slot.scorch]) object.visible = false;
      slot.light.intensity = 0;
    }
  }
  return {
    spawn, update, configure, clear, pool, clouds,
    get active() { return pool.filter(slot => slot.live).length; },
    get duration() { return DURATION; },
  };
}
