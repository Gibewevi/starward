import * as THREE from 'three';
import { FEEL, pick } from './feel.js';
import { stainUniforms, STAIN_LIGHT } from './stain-light.js';

/**
 * Red footprints. A foot that came down in red drops prints its sole on the
 * next steps — strong at first, fainter each step — so the hero's tracks and
 * the troopers' can be followed across the deck. Every print is one instance
 * of a single mesh (one draw call for all of them): a boot sole painted in a
 * small texture (tread, a gap, the heel), mirrored for the left foot, laid on
 * the floor along the foot, dark red, fading after half a minute. In the
 * dark they go red-black, but for where a lamp or the blade lights them.
 *
 * stamp(at, along, side, strength, [length, width]) — `along`: heel to toe on
 * the floor; side 'L' or 'R'; strength 0 → 1. Then update(dt).
 */
function soleTexture() {
  const w = 32, h = 64, data = new Uint8Array(w * h * 4);
  // A deterministic grain for the tread, so every print is the same boot.
  let seed = 7;
  const grain = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const noise = Array.from({ length: w * h }, grain);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w * 2 - 1, v = (y + 0.5) / h; // u: across (-1 → 1), v: heel (0) → toe (1)
      // The sole: wider at the ball, narrower at the waist, round at both ends; the heel apart.
      let inside = 0;
      if (v > 0.38) {
        const t = (v - 0.38) / 0.62, half = 0.72 + 0.22 * Math.sin(Math.PI * Math.min(1, t * 1.25)) - 0.1 * t;
        const tip = v > 0.86 ? Math.sqrt(Math.max(0, 1 - ((v - 0.86) / 0.14) ** 2)) : 1;
        inside = Math.abs(u + 0.06 * t) < half * tip ? 1 : 0;
      } else if (v > 0.04 && v < 0.3) {
        const t = (v - 0.04) / 0.26, round = v < 0.1 ? Math.sqrt(Math.max(0, 1 - ((0.1 - v) / 0.06) ** 2)) : 1;
        inside = Math.abs(u) < 0.66 * round ? 1 : 0;
        void t;
      }
      // Tread: crossbars and a speckle where the sole pressed less.
      const bar = Math.abs(Math.sin(v * 46)) > 0.82 ? 0.45 : 1;
      const speck = noise[y * w + x] < 0.18 ? 0.5 : 1;
      const edge = inside ? 1 : 0;
      data.set([255, 255, 255, Math.round(255 * edge * bar * speck)], (y * w + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, w, h);
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createFootprints(scene, { max = 360, random = Math.random } = {}) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  // Heel at -Z, toe at +Z (the texture's v runs heel → toe).
  geometry.rotateY(Math.PI);
  const fade = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('fade', fade);
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    uniforms: { map: { value: soleTexture() }, tint: { value: new THREE.Color(0.5, 0.024, 0.017) }, ...stainUniforms },
    vertexShader: /* glsl */`
      ${STAIN_LIGHT}
      attribute float fade; varying float vFade; varying vec2 vUv; varying vec3 vLight;
      void main() {
        vFade = fade; vUv = uv;
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vLight = stainLight(world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map; uniform vec3 tint; varying float vFade; varying vec2 vUv; varying vec3 vLight;
      void main() {
        float a = texture2D(map, vUv).a * vFade;
        if (a < 0.02) discard;
        gl_FragColor = vec4(tint * vLight, a);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, max);
  mesh.name = 'Red footprints';
  mesh.frustumCulled = false;
  mesh.count = 0;
  scene.add(mesh);
  const age = new Float32Array(max), life = new Float32Array(max), strength = new Float32Array(max);
  let next = 0, used = 0;
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), place = new THREE.Vector3(), scale = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

  function stamp(at, along, side, amount, [length, width] = FEEL.prints.hero) {
    const i = next;
    next = (next + 1) % max;
    used = Math.max(used, next === 0 ? max : next);
    mesh.count = used;
    place.set(at.x, 0.004, at.z);
    rotation.setFromAxisAngle(up, Math.atan2(along.x, along.z));
    // The left sole is the right one mirrored; a print is never quite the same size twice.
    const jitter = 0.94 + random() * 0.12;
    scale.set(width * jitter * (side === 'L' ? -1 : 1), 1, length * jitter);
    mesh.setMatrixAt(i, matrix.compose(place, rotation, scale));
    mesh.instanceMatrix.needsUpdate = true;
    age[i] = 0;
    life[i] = pick(FEEL.prints.linger, random);
    strength[i] = Math.min(1, amount);
    return i;
  }
  function update(dt) {
    const { fade: out } = FEEL.prints;
    let changed = false;
    for (let i = 0; i < used; i++) {
      if (strength[i] <= 0) { if (fade.array[i] !== 0) { fade.array[i] = 0; changed = true; } continue; }
      age[i] += dt;
      const left = Math.min(1, Math.max(0, (life[i] + out - age[i]) / out));
      if (left <= 0) strength[i] = 0;
      // A sole half dry still prints clearly; a nearly dry one only faintly.
      fade.array[i] = Math.min(1, 0.35 + strength[i]) * left;
      changed = true;
    }
    if (changed) fade.needsUpdate = true;
  }
  function clear() {
    age.fill(0); life.fill(0); strength.fill(0); fade.array.fill(0);
    fade.needsUpdate = true;
    next = used = 0;
    mesh.count = 0;
  }
  return {
    mesh, stamp, update, clear,
    /** Prints still showing. */
    get count() { let n = 0; for (let i = 0; i < used; i++) n += strength[i] > 0; return n; },
  };
}
