import * as THREE from 'three';

/**
 * The jungle's plants: tufts of grass of every height, ferns, broad-leaved
 * plants and reeds — each kind one instanced mesh (one draw call), its shape
 * built in unit height and scaled per plant.
 *
 * Everything moves, in the vertex shader: the wind sways each plant on its
 * own (a phase of its own, slow waves running across the ground, gusts), the
 * tip more than the base; whoever goes through bends it away (`pushers`: the
 * hero, the troopers, the blade's tip — and it springs back as they pass); an
 * explosion throws everything outward with its front as it runs out, then the
 * plants rock back. A blade going through a plant cuts it at the height it
 * passed (what is left is a stub) and throws bits of leaf along the swing.
 *
 * createVegetation(scene, { place }) — place(kind) returns where that kind
 * grows (a list of { x, z, height, size }); then each frame
 * update(dt, { time, pushers }); blast(at, power); cut(a0, b0, a1, b1, speed).
 */
const PUSHERS = 8, BLASTS = 4;
const KINDS = {
  grass: { radius: 0.12, leaves: 2, color: [0.2, 0.42, 0.12] },
  reed: { radius: 0.12, leaves: 2, color: [0.22, 0.38, 0.14] },
  fern: { radius: 0.4, leaves: 7, color: [0.12, 0.36, 0.1] },
  broadleaf: { radius: 0.45, leaves: 8, color: [0.1, 0.3, 0.12] },
};

// ---- Shapes, in unit height; `bend` says how much each vertex sways (0 at the root) ----
function shape() {
  const positions = [], colors = [], bends = [], indices = [];
  const vertex = (x, y, z, color, bend) => { positions.push(x, y, z); colors.push(...color); bends.push(bend); return positions.length / 3 - 1; };
  return {
    vertex, indices,
    quad(a, b, c, d) { indices.push(a, b, c, a, c, d); },
    build() {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setAttribute('aBend', new THREE.Float32BufferAttribute(bends, 1));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      return geometry;
    },
  };
}
const mix = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);
function seeded(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

/** Blades leaning out from one root, tapering to a point; dark at the root, light at the tip. */
function tuftGeometry({ blades = 6, width = 0.05, lean = [0.12, 0.55], heights = [0.55, 1], tints = [[0.05, 0.12, 0.04], [0.3, 0.52, 0.16]], seed = 3 } = {}) {
  const random = seeded(seed), s = shape(), SEG = 4;
  for (let b = 0; b < blades; b++) {
    const yaw = random() * Math.PI * 2, tilt = lean[0] + random() * (lean[1] - lean[0]), height = heights[0] + random() * (heights[1] - heights[0]);
    const tip = mix(tints[1], [0.48, 0.5, 0.2], random() * 0.35), dir = [Math.sin(yaw), Math.cos(yaw)], side = [Math.cos(yaw), -Math.sin(yaw)];
    let previous = null;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG, out = Math.sin(tilt) * height * t * t * 1.2, y = height * t * (1 - 0.15 * t * tilt), half = width * 0.5 * (1 - t * 0.92);
      const color = mix(tints[0], tip, t);
      const left = s.vertex(dir[0] * out + side[0] * half, y, dir[1] * out + side[1] * half, color, t * t);
      const right = s.vertex(dir[0] * out - side[0] * half, y, dir[1] * out - side[1] * half, color, t * t);
      if (previous) s.quad(previous[0], previous[1], right, left);
      previous = [left, right];
    }
  }
  return s.build();
}
/** Fronds arching out from the root and drooping, leaflets in pairs along them: dark at the heart, bright at the ends. */
function fernGeometry({ fronds = 7, seed = 5 } = {}) {
  const random = seeded(seed), s = shape(), SEG = 8;
  for (let f = 0; f < fronds; f++) {
    const yaw = (f / fronds) * Math.PI * 2 + random() * 0.6, reach = 0.7 + random() * 0.35, rise = 0.5 + random() * 0.4;
    const dir = [Math.sin(yaw), Math.cos(yaw)], side = [Math.cos(yaw), -Math.sin(yaw)];
    const dark = [0.025, 0.09, 0.03], light = mix([0.14, 0.36, 0.08], [0.34, 0.5, 0.12], random() * random());
    const at = t => [dir[0] * reach * t, rise * Math.sin(Math.PI * t * 0.82) + 0.02, dir[1] * reach * t];
    // The stalk: a thin ribbon.
    let previous = null;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG, p = at(t), half = 0.012 * (1 - t);
      const left = s.vertex(p[0] + side[0] * half, p[1], p[2] + side[1] * half, dark, t), right = s.vertex(p[0] - side[0] * half, p[1], p[2] - side[1] * half, dark, t);
      if (previous) s.quad(previous[0], previous[1], right, left);
      previous = [left, right];
    }
    // The leaflets: a pair at each step, swept towards the tip, longest mid-frond, drooping.
    for (let i = 1; i < SEG; i++) {
      const t = i / SEG, length = 0.17 * Math.sin(Math.PI * Math.min(1, t * 1.05)) ** 0.6 + 0.02, step = 0.5 / SEG;
      const a = at(t - step), b = at(t + step), base = at(t);
      const colour = mix(dark, light, Math.min(1, 0.35 + t * 0.8)), tipColour = mix(colour, light, 0.6);
      for (const sign of [-1, 1]) {
        const tip = [base[0] + (side[0] * sign * 0.85 + dir[0] * 0.5) * length, base[1] - length * (0.25 + t * 0.35), base[2] + (side[1] * sign * 0.85 + dir[1] * 0.5) * length];
        s.indices.push(s.vertex(...a, colour, t), s.vertex(...tip, tipColour, t + 0.05), s.vertex(...b, colour, t));
      }
    }
  }
  return s.build();
}
/** A few big oval leaves on stems, tilted out and down: glossy, dark. */
function broadleafGeometry({ leaves = 6, seed = 7 } = {}) {
  const random = seeded(seed), s = shape(), RIM = 8;
  for (let l = 0; l < leaves; l++) {
    const yaw = (l / leaves) * Math.PI * 2 + random() * 0.6, stemHeight = 0.35 + random() * 0.45, out = 0.15 + random() * 0.15;
    const dir = [Math.sin(yaw), Math.cos(yaw)], side = [Math.cos(yaw), -Math.sin(yaw)];
    const stem = [[0.06, 0.16, 0.05], [0.12, 0.3, 0.09]];
    // The stem.
    const a = s.vertex(0.012 * side[0], 0, 0.012 * side[1], stem[0], 0), b = s.vertex(-0.012 * side[0], 0, -0.012 * side[1], stem[0], 0);
    const cx = dir[0] * out, cz = dir[1] * out;
    const c = s.vertex(cx - 0.01 * side[0], stemHeight, cz - 0.01 * side[1], stem[1], 0.7), d = s.vertex(cx + 0.01 * side[0], stemHeight, cz + 0.01 * side[1], stem[1], 0.7);
    s.quad(a, b, c, d);
    // The leaf: an oval fanned round its midrib, from the stem's top outward and down.
    const length = 0.5 + random() * 0.25, width = 0.2 + random() * 0.08, droop = 0.18 + random() * 0.2;
    const leaf = mix([0.03, 0.13, 0.05], [0.09, 0.27, 0.1], random());
    const centre = s.vertex(cx + dir[0] * length * 0.5, stemHeight - droop * 0.35, cz + dir[1] * length * 0.5, leaf, 0.85);
    const rim = [];
    for (let i = 0; i < RIM; i++) {
      const angle = (i / RIM) * Math.PI * 2, along = (Math.cos(angle) * 0.5 + 0.5) * length, across = Math.sin(angle) * width * Math.sin(Math.PI * along / length + 0.15);
      // Folded along the midrib: the edges lower than the middle.
      rim.push(s.vertex(cx + dir[0] * along + side[0] * across, stemHeight - droop * (along / length) ** 2 - Math.abs(across) * 0.45, cz + dir[1] * along + side[1] * across, mix(leaf, [0.16, 0.36, 0.12], along / length * 0.6), 0.7 + 0.3 * along / length));
    }
    for (let i = 0; i < RIM; i++) s.indices.push(centre, rim[i], rim[(i + 1) % RIM]);
  }
  return s.build();
}

/**
 * Plant material: lit like the rest — a little glossy, so the lamps and the
 * blade glint on the leaves — each plant its own shade; swayed and bent in
 * the vertex shader. Its shadow (`depth`) sways with it.
 */
function plantMaterial(uniforms) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.62, metalness: 0, envMapIntensity: 0.3 });
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  material.onBeforeCompile = shader => sway(shader, uniforms);
  depth.onBeforeCompile = shader => sway(shader, uniforms);
  return { material, depth };
}
function sway(shader, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', /* glsl */`#include <common>
      uniform float uTime; uniform vec2 uWind; uniform vec4 uPush[${PUSHERS}]; uniform vec4 uBlast[${BLASTS}];
      attribute float aBend; attribute float aPhase; attribute float aCut;`)
    .replace('#include <begin_vertex>', /* glsl */`
      vec3 transformed = vec3(position);
      // Cut: what was above the blade is gone, a stub stays.
      transformed.y = min(transformed.y, aCut);
      float bend = aBend * clamp(aCut * 1.4, 0.0, 1.0);
      vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      float height = length(instanceMatrix[1].xyz);
      // The wind: slow waves across the ground, each plant its own phase, a quicker flutter on top.
      float wave = sin(uTime * 1.25 + aPhase + root.x * 0.33 + root.z * 0.21) * 0.6 + sin(uTime * 2.9 + aPhase * 2.3 + root.z * 0.5) * 0.25;
      vec2 offset = uWind * (0.45 + wave) + vec2(sin(uTime * 4.7 + aPhase * 5.1), cos(uTime * 4.1 + aPhase * 3.7)) * 0.025;
      // Whoever goes through bends it away.
      for (int i = 0; i < ${PUSHERS}; i++) {
        vec2 d = root.xz - uPush[i].xy; float l = length(d);
        if (uPush[i].z > 0.0 && l < uPush[i].z) offset += d / max(l, 0.05) * (1.0 - l / uPush[i].z) * uPush[i].w;
      }
      // An explosion: the front runs out, everything thrown with it, then rocking back.
      for (int i = 0; i < ${BLASTS}; i++) {
        float age = uTime - uBlast[i].z;
        if (uBlast[i].w <= 0.0 || age < 0.0 || age > 3.5) continue;
        vec2 d = root.xz - uBlast[i].xy; float l = max(length(d), 0.05), front = age * 11.0;
        float hit = exp(-pow((l - front) / 1.4, 2.0)) * uBlast[i].w / (1.0 + l * 0.18);
        float rock = step(l, front) * exp(-age * 1.6) * sin(age * 9.0 - l * 0.6) * 0.45 * uBlast[i].w / (1.0 + l * 0.3);
        offset += d / l * (hit + rock);
      }
      // Metres at the tip, as far as the plant is tall; kept to a sane lean, and the plant shortened as it leans.
      offset = offset * bend * height;
      float lean = length(offset); if (lean > height * 0.9) offset *= height * 0.9 / lean;
      vec3 world = vec3(offset.x, -dot(offset, offset) / max(height, 0.1) * 0.5 * bend, offset.y);
      // Back into the plant's own space: its matrix is a turn and a scale, so a dot with each axis over its length squared.
      mat3 turn = mat3(instanceMatrix);
      transformed += vec3(dot(turn[0], world) / dot(turn[0], turn[0]), dot(turn[1], world) / dot(turn[1], turn[1]), dot(turn[2], world) / dot(turn[2], turn[2]));`);
}

export function createVegetation(scene, { place, random = Math.random } = {}) {
  const group = new THREE.Group();
  group.name = 'Jungle plants';
  scene.add(group);
  const uniforms = {
    uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.12, 0.06) },
    uPush: { value: Array.from({ length: PUSHERS }, () => new THREE.Vector4()) },
    uBlast: { value: Array.from({ length: BLASTS }, () => new THREE.Vector4(0, 0, -99, 0)) },
  };
  const { material, depth } = plantMaterial(uniforms);
  const shapes = {
    grass: tuftGeometry({ blades: 9, width: 0.036, lean: [0.08, 0.6], heights: [0.45, 1], tints: [[0.025, 0.07, 0.025], [0.26, 0.46, 0.12]], seed: 3 }),
    reed: tuftGeometry({ blades: 5, width: 0.045, lean: [0.03, 0.22], heights: [0.7, 1], tints: [[0.05, 0.1, 0.04], [0.36, 0.46, 0.16]], seed: 9 }),
    fern: fernGeometry(),
    broadleaf: broadleafGeometry(),
  };
  // One instanced mesh a kind; what each plant is, kept for the blade.
  const kinds = {};
  for (const [kind, geometry] of Object.entries(shapes)) {
    const plants = place(kind);
    if (!plants.length) continue;
    const mesh = new THREE.InstancedMesh(geometry, material, plants.length);
    mesh.name = `Jungle ${kind}`;
    mesh.receiveShadow = true;
    // The big plants cast their shadows (swaying with them); the grass only takes them.
    mesh.castShadow = kind !== 'grass';
    mesh.customDepthMaterial = depth;
    mesh.frustumCulled = false;
    const phase = new Float32Array(plants.length), cut = new Float32Array(plants.length).fill(1);
    const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), colour = new THREE.Color();
    plants.forEach((plant, i) => {
      phase[i] = random() * Math.PI * 2;
      rotation.setFromAxisAngle(up, random() * Math.PI * 2);
      mesh.setMatrixAt(i, matrix.compose(new THREE.Vector3(plant.x, 0, plant.z), rotation, new THREE.Vector3(plant.size, plant.height, plant.size)));
      // Each its own green: lighter or darker, yellower or bluer; darker still in the thick of the jungle.
      const shade = (0.7 + random() * 0.55) * (plant.shade ?? 1), warm = random() - 0.5;
      mesh.setColorAt(i, colour.setRGB(shade * (1 + warm * 0.35), shade, shade * (1 - warm * 0.3)));
    });
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    const cutAttribute = new THREE.InstancedBufferAttribute(cut, 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aCut', cutAttribute);
    group.add(mesh);
    kinds[kind] = { mesh, plants, cut, cutAttribute, ...KINDS[kind] };
  }
  // A coarse grid of where the plants stand, for the blade.
  const CELL = 1, grid = new Map();
  const key = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  for (const [kind, entry] of Object.entries(kinds)) entry.plants.forEach((plant, index) => {
    const k = key(plant.x, plant.z);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push({ kind, index });
  });

  // ---- Bits of leaf thrown by the blade ----------------------------------------
  const BITS = 320;
  const bitGeometry = new THREE.PlaneGeometry(0.07, 0.035);
  const bits = new THREE.InstancedMesh(bitGeometry, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), BITS);
  bits.name = 'Cut leaves';
  bits.frustumCulled = false;
  bits.count = 0;
  bits.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BITS * 3), 3);
  group.add(bits);
  const bit = Array.from({ length: BITS }, () => ({ alive: false, position: new THREE.Vector3(), velocity: new THREE.Vector3(), spin: new THREE.Vector3(), rotation: new THREE.Euler(), age: 0, life: 0, settled: false }));
  let nextBit = 0;
  const colour = new THREE.Color(), dummy = new THREE.Object3D();
  function throwBits(at, along, speed, count, tint) {
    for (let n = 0; n < count; n++) {
      const index = nextBit, b = bit[index];
      nextBit = (nextBit + 1) % BITS;
      b.alive = true; b.settled = false; b.age = 0; b.life = 6 + random() * 6;
      b.position.copy(at).add(new THREE.Vector3((random() - 0.5) * 0.15, (random() - 0.3) * 0.15, (random() - 0.5) * 0.15));
      b.velocity.copy(along).multiplyScalar(Math.min(speed, 12) * (0.15 + random() * 0.3)).add(new THREE.Vector3((random() - 0.5) * 1.2, 0.8 + random() * 1.6, (random() - 0.5) * 1.2));
      b.spin.set((random() - 0.5) * 18, (random() - 0.5) * 18, (random() - 0.5) * 18);
      colour.setRGB(...tint).offsetHSL((random() - 0.5) * 0.05, 0, (random() - 0.5) * 0.12);
      bits.setColorAt(index, colour);
    }
    bits.count = BITS;
    bits.instanceColor.needsUpdate = true;
  }
  function updateBits(dt) {
    for (let i = 0; i < BITS; i++) {
      const b = bit[i];
      if (!b.alive) { dummy.scale.setScalar(0); dummy.updateMatrix(); bits.setMatrixAt(i, dummy.matrix); continue; }
      b.age += dt;
      if (b.age > b.life) { b.alive = false; continue; }
      if (!b.settled) {
        // Light: the air holds them up, they flutter down.
        b.velocity.y -= 4.2 * dt;
        b.velocity.multiplyScalar(Math.exp(-2.6 * dt));
        b.velocity.x += Math.sin(b.age * 7 + i) * 0.6 * dt;
        b.position.addScaledVector(b.velocity, dt);
        b.rotation.x += b.spin.x * dt; b.rotation.y += b.spin.y * dt; b.rotation.z += b.spin.z * dt;
        if (b.position.y < 0.01) { b.position.y = 0.01; b.settled = true; b.rotation.x = -Math.PI / 2; b.rotation.y = 0; }
      }
      const fade = Math.min(1, (b.life - b.age) / 1.5);
      dummy.position.copy(b.position);
      dummy.rotation.copy(b.rotation);
      dummy.scale.setScalar(fade);
      dummy.updateMatrix();
      bits.setMatrixAt(i, dummy.matrix);
    }
    bits.instanceMatrix.needsUpdate = true;
  }

  // ---- The blade --------------------------------------------------------------
  const blasts = uniforms.uBlast.value;
  let nextBlast = 0;
  const root = new THREE.Vector3(), along = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  /** The blade swept from (a0, b0) to (a1, b1): plants in its way are cut where it passed. Returns how many. */
  function cut(a0, b0, a1, b1, speed) {
    if (speed < 3.5) return 0;
    along.subVectors(b1, b0).setY(0);
    if (along.lengthSq() < 1e-6) along.subVectors(a1, a0).setY(0);
    along.normalize();
    const minX = Math.min(a0.x, b0.x, a1.x, b1.x) - 0.5, maxX = Math.max(a0.x, b0.x, a1.x, b1.x) + 0.5;
    const minZ = Math.min(a0.z, b0.z, a1.z, b1.z) - 0.5, maxZ = Math.max(a0.z, b0.z, a1.z, b1.z) + 0.5;
    // The blade's path, not only where it is now: a fast swing goes further than a stem between frames.
    const steps = Math.min(10, Math.max(1, Math.ceil(Math.max(a0.distanceTo(a1), b0.distanceTo(b1)) / 0.08)));
    let count = 0;
    for (let x = Math.floor(minX / CELL); x <= Math.floor(maxX / CELL); x++) {
      for (let z = Math.floor(minZ / CELL); z <= Math.floor(maxZ / CELL); z++) {
        for (const { kind, index } of grid.get(`${x},${z}`) ?? []) {
          const entry = kinds[kind], plant = entry.plants[index];
          if (entry.cut[index] < 0.12) continue;
          // Where the blade crosses the stem: nearest to it seen from above, at the height it has there.
          const reach = entry.radius * plant.size, standing = plant.height * entry.cut[index];
          let crossing = Infinity;
          for (let step = 1; step <= steps; step++) {
            a.lerpVectors(a0, a1, step / steps); b.lerpVectors(b0, b1, step / steps);
            const dx = b.x - a.x, dz = b.z - a.z, flat = dx * dx + dz * dz;
            const t = flat > 1e-6 ? THREE.MathUtils.clamp(((plant.x - a.x) * dx + (plant.z - a.z) * dz) / flat, 0, 1) : (a.y < b.y ? 0 : 1);
            if (Math.hypot(a.x + dx * t - plant.x, a.z + dz * t - plant.z) > reach) continue;
            crossing = Math.min(crossing, a.y + (b.y - a.y) * t);
          }
          // Not through it, or only grazing what is left of it.
          if (crossing >= standing - 0.05 * plant.height) continue;
          const at = root.set(plant.x, Math.max(0.02, crossing), plant.z);
          const remaining = Math.max(0.06, at.y / plant.height);
          if (remaining >= entry.cut[index] - 0.01) continue;
          entry.cut[index] = remaining;
          entry.cutAttribute.needsUpdate = true;
          throwBits(at, along, speed, entry.leaves, entry.color);
          count++;
        }
      }
    }
    return count;
  }
  /** An explosion at `at`: everything round it thrown outward with its front, then rocking back. */
  function blast(at, power = 1) {
    blasts[nextBlast].set(at.x, at.z, uniforms.uTime.value, power);
    nextBlast = (nextBlast + 1) % BLASTS;
  }
  function update(dt, { time, pushers = [], wind = 1 } = {}) {
    uniforms.uTime.value = time;
    // Gusts: the wind gathers and drops.
    const gust = 0.65 + 0.35 * Math.sin(time * 0.37) * Math.sin(time * 0.13 + 1) + 0.25 * Math.max(0, Math.sin(time * 0.71));
    uniforms.uWind.value.set(0.13, 0.06).multiplyScalar(gust * wind);
    const slots = uniforms.uPush.value;
    for (let i = 0; i < PUSHERS; i++) {
      const p = pushers[i];
      if (p) slots[i].set(p.x, p.z, p.radius, p.strength); else slots[i].set(0, 0, 0, 0);
    }
    updateBits(dt);
  }
  function reset() {
    for (const entry of Object.values(kinds)) { entry.cut.fill(1); entry.cutAttribute.needsUpdate = true; }
    for (const b of bit) b.alive = false;
    for (const slot of blasts) slot.set(0, 0, -99, 0);
  }
  return {
    group, update, cut, blast, reset, uniforms,
    /** How many plants of each kind stand, and how many are cut. */
    get counts() { return Object.fromEntries(Object.entries(kinds).map(([kind, entry]) => [kind, { plants: entry.plants.length, cut: entry.cut.filter(value => value < 1).length }])); },
    get bits() { return bit.filter(b => b.alive).length; },
  };
}
