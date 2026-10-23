import * as THREE from 'three';

/**
 * Shallow jungle water: clear over the sand, darker where it is deep, a line
 * of foam along the edge.
 *
 * Its surface is a real wave simulation on a fine grid (the wave equation,
 * damped), and the surface is shaped by it: anything that disturbs it — a
 * step, someone wading through, a body falling in, a bolt, an explosion —
 * pushes the water there, and the rings spread, cross, bounce off the banks
 * and die away. The ripples catch the moon and the lamps of the ruins as
 * moving glints. Lily pads ride the waves. A splash throws drops that fall
 * back into it (rings of their own where they land).
 *
 * The Force moves it (`shove`): a push drives a wall of water out across the
 * cone before the hero, a pull draws it towards him. Water heaped up against
 * a bank spills over it: a thin sheet runs out over the mud, foaming at its
 * edge, and soaks away. An explosion in the water blows a hole in it the
 * water rushes back into, meeting in a jet; one on the bank opens a crater
 * the stream pours into (`crater`).
 *
 * createWater(scene, { rect, depthAt }) — depthAt(x, z): 0 dry, up to 1 at the
 * deepest. disturb(x, z, radius, amount); splash(at, strength, along);
 * shove(at, direction, { range, cone, power }) (power < 0 pulls);
 * crater(at, radius); depth(x, z); update(dt, { waders, focus }) (with a focus, only
 * the water within `reach` of it moves); setGlints(lights).
 */
const GLINTS = 6;
/** How far the surface rises and falls for a unit of the simulation's height (m). */
const SHAPE = 0.6;
/** Above this height (simulation units), water against a bank spills over it. */
const SPILL = 0.016;

export function createWater(scene, { rect, depthAt, cell = 0.08, level = 0.035, random = Math.random } = {}) {
  const width = rect.maxX - rect.minX, length = rect.maxZ - rect.minZ;
  const W = Math.ceil(width / cell), H = Math.ceil(length / cell);
  const mask = new Float32Array(W * H), height = new Float32Array(W * H), speed = new Float32Array(W * H);
  // The sheet of water spilt over the banks, and its next state.
  const film = new Float32Array(W * H), filmNext = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) mask[j * W + i] = Math.max(0, Math.min(1, depthAt(rect.minX + (i + 0.5) * cell, rect.minZ + (j + 0.5) * cell)));
  const texture = data => {
    const t = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.FloatType);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  };
  const heights = texture(height), depths = texture(mask), films = texture(film);

  const group = new THREE.Group();
  group.name = 'Jungle water';
  scene.add(group);
  // Fine enough for the surface to take the shape of the waves (a vertex every 16 cm).
  const geometry = new THREE.PlaneGeometry(width, length, Math.round(width / 0.16), Math.round(length / 0.16));
  geometry.rotateX(-Math.PI / 2);
  const glints = Array.from({ length: GLINTS }, () => ({ position: new THREE.Vector3(), color: new THREE.Color(0, 0, 0) }));
  const uniforms = {
    tHeight: { value: heights }, tDepth: { value: depths }, tFilm: { value: films }, texel: { value: new THREE.Vector2(1 / W, 1 / H) },
    rectMin: { value: new THREE.Vector2(rect.minX, rect.minZ) }, rectSize: { value: new THREE.Vector2(width, length) },
    time: { value: 0 }, viewDir: { value: new THREE.Vector3(-8, -8.2, -10).normalize() },
    moonDir: { value: new THREE.Vector3(0.4, 0.8, 0.45).normalize() }, moonColor: { value: new THREE.Color(0.55, 0.7, 0.9) },
    shallow: { value: new THREE.Color(0.018, 0.065, 0.072) }, deep: { value: new THREE.Color(0.006, 0.016, 0.026) }, sky: { value: new THREE.Color(0.02, 0.035, 0.055) },
    glintPos: { value: glints.map(g => g.position) }, glintColor: { value: glints.map(g => g.color) },
    fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    name: 'Jungle water',
    transparent: true, depthWrite: false, fog: true,
    uniforms,
    vertexShader: /* glsl */`
      uniform sampler2D tHeight; uniform vec2 rectMin; uniform vec2 rectSize;
      varying vec3 vWorld; varying vec2 vUv; varying float vFogDepth;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        // The waves shape the surface: a hole where the water was blown away, a wall where it is driven.
        world.y += clamp(texture2D(tHeight, (world.xz - rectMin) / rectSize).r * ${SHAPE.toFixed(2)}, -0.45, 0.16);
        vWorld = world.xyz; vUv = uv;
        vec4 view = viewMatrix * world;
        vFogDepth = -view.z;
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tHeight; uniform sampler2D tDepth; uniform sampler2D tFilm; uniform vec2 texel; uniform vec2 rectMin; uniform vec2 rectSize;
      uniform float time; uniform vec3 viewDir; uniform vec3 moonDir; uniform vec3 moonColor;
      uniform vec3 shallow; uniform vec3 deep; uniform vec3 sky;
      uniform vec3 glintPos[${GLINTS}]; uniform vec3 glintColor[${GLINTS}];
      uniform vec3 fogColor; uniform float fogDensity;
      varying vec3 vWorld; varying vec2 vUv; varying float vFogDepth;
      float h(vec2 uv) { return texture2D(tHeight, uv).r + texture2D(tFilm, uv).r * 2.0; }
      void main() {
        vec2 uv = (vWorld.xz - rectMin) / rectSize;
        float depth = texture2D(tDepth, uv).r, film = texture2D(tFilm, uv).r;
        // Over the bank: only where water spilt, a sheet as thin as it is.
        float sheet = depth < 0.02 ? smoothstep(0.0008, 0.01, film) : 1.0;
        if (sheet <= 0.0) discard;
        // The slopes: the simulated ripples, and a fine shiver of the wind on top.
        float dx = h(uv + vec2(texel.x, 0.0)) - h(uv - vec2(texel.x, 0.0));
        float dz = h(uv + vec2(0.0, texel.y)) - h(uv - vec2(0.0, texel.y));
        vec2 wind = vec2(sin(vWorld.x * 3.1 + time * 1.7 + sin(vWorld.z * 2.3 + time)), cos(vWorld.z * 2.7 - time * 1.4 + sin(vWorld.x * 1.9))) * 0.035;
        vec3 n = normalize(vec3(-dx * 9.0 + wind.x, 1.0, -dz * 9.0 + wind.y));
        vec3 eye = -viewDir;
        float fresnel = pow(1.0 - max(dot(n, eye), 0.0), 3.0);
        // Clear over the sand, darker where deep; the ripples bend the light below.
        float bands = 0.5 + 0.5 * sin((vWorld.x + vWorld.z) * 6.0 + (dx + dz) * 60.0 + time * 0.6);
        vec3 water = mix(shallow, deep, smoothstep(0.1, 0.9, depth)) * (0.85 + 0.25 * bands * (1.0 - depth));
        vec3 colour = mix(water, sky, fresnel * 0.6);
        // The moon, and the lamps of the ruins, glinting on the ripples.
        vec3 r = reflect(-eye, n);
        // Broken pinpoints on the pixel grid, rather than a broad milky disk.
        vec2 pixel = floor(vWorld.xz * 28.0);
        float sparkle = fract(sin(dot(pixel, vec2(127.1, 311.7))) * 43758.5453);
        float broken = smoothstep(0.3, 0.85, sparkle + sin(time * 1.2 + pixel.y * 0.6) * 0.12);
        colour += moonColor * pow(max(dot(r, moonDir), 0.0), 110.0) * 0.45 * broken;
        for (int i = 0; i < ${GLINTS}; i++) {
          vec3 toLight = glintPos[i] - vWorld; float far = length(toLight);
          // Sharp: a lamp makes a bright streak on the ripples, not a sheen over the whole stream.
          float s = pow(max(dot(r, toLight / far), 0.0), 90.0) / (1.0 + far * far * 0.12);
          colour += glintColor[i] * s * 4.0 * (0.2 + broken * 0.8);
        }
        // Foam along the edge, where the water is churned, and at the front of a spilt sheet.
        float churn = clamp(abs(dx) * 18.0 + abs(dz) * 18.0, 0.0, 1.0);
        float lip = depth < 0.02 ? (1.0 - smoothstep(0.002, 0.014, film)) * 2.2 : 0.0;
        float foam = smoothstep(0.2, 0.04, depth) * (0.55 + 0.45 * sin(vWorld.x * 23.0 + time * 2.0) * sin(vWorld.z * 19.0 - time * 1.7)) * step(0.02, depth) + churn * 0.35 + lip;
        colour = mix(colour, vec3(0.13, 0.23, 0.24), clamp(foam * 0.35, 0.0, 0.45));
        // The spilt sheet's running edge: a pale line of froth.
        colour = mix(colour, vec3(0.42, 0.55, 0.55), clamp(lip * sheet * 0.35, 0.0, 0.6));
        // Clear: the bed shows through at the edges, and what the floor below mirrors (main.js).
        float alpha = (mix(0.3, 0.58, smoothstep(0.05, 0.8, depth)) + fresnel * 0.15 + foam * 0.12 + (depth < 0.02 ? 0.25 : 0.0)) * sheet;
        float fog = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
        gl_FragColor = vec4(mix(colour, fogColor, fog), clamp(alpha, 0.0, 1.0));
        #include <colorspace_fragment>
      }`,
  });
  const surface = new THREE.Mesh(geometry, material);
  surface.position.set(rect.minX + width / 2, level, rect.minZ + length / 2);
  surface.renderOrder = 2;
  surface.frustumCulled = false;
  group.add(surface);

  // ---- Lily pads, riding the waves ---------------------------------------------
  const pads = [];
  for (let n = 0; n < 400 && pads.length < 26; n++) {
    const x = rect.minX + random() * width, z = rect.minZ + random() * length;
    if (depthAt(x, z) < 0.35 || pads.some(pad => Math.hypot(pad.x - x, pad.z - z) < 0.5)) continue;
    pads.push({ x, z, size: 0.18 + random() * 0.16, yaw: random() * Math.PI * 2, tilt: new THREE.Vector2() });
  }
  const padShape = new THREE.CircleGeometry(1, 12, 0.35, Math.PI * 2 - 0.7);
  padShape.rotateX(-Math.PI / 2);
  const padMesh = new THREE.InstancedMesh(padShape, new THREE.MeshStandardMaterial({ color: 0x1c4520, roughness: 0.35, side: THREE.DoubleSide }), Math.max(1, pads.length));
  padMesh.name = 'Lily pads';
  padMesh.count = pads.length;
  padMesh.receiveShadow = true;
  group.add(padMesh);

  // ---- The waves ----------------------------------------------------------------
  const index = (x, z) => {
    const i = Math.floor((x - rect.minX) / cell), j = Math.floor((z - rect.minZ) / cell);
    return i < 1 || j < 1 || i >= W - 1 || j >= H - 1 ? -1 : j * W + i;
  };
  /** Pushes the surface down (or up) round (x, z): it springs back as rings. */
  function disturb(x, z, radius = 0.25, amount = 0.04) {
    const r = Math.max(1, Math.round(radius / cell));
    const ci = Math.floor((x - rect.minX) / cell), cj = Math.floor((z - rect.minZ) / cell);
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (i < 1 || j < 1 || i >= W - 1 || j >= H - 1) continue;
      const k = j * W + i;
      if (mask[k] <= 0) continue;
      const d = Math.hypot(i - ci, j - cj) / r;
      if (d > 1) continue;
      height[k] -= amount * (1 - d * d);
    }
  }
  const depth = (x, z) => { const k = index(x, z); return k < 0 ? 0 : mask[k]; };
  const k2 = 0.13, damping = 0.978;
  let accumulator = 0, filmed = false;
  // Where water spilt this step, for the drops thrown over the bank.
  const spills = [];
  // The part of the water that moves: all of it, or (a big map) a window round the view.
  const win = { i0: 1, i1: W - 1, j0: 1, j1: H - 1 };
  function simulate() {
    spills.length = 0;
    for (let j = win.j0; j < win.j1; j++) {
      for (let i = win.i0; i < win.i1; i++) {
        const k = j * W + i;
        if (mask[k] <= 0) continue;
        // Dry neighbours are the bank: the wave bounces off them.
        const c = height[k];
        const wl = mask[k - 1] > 0, wr = mask[k + 1] > 0, wu = mask[k - W] > 0, wd = mask[k + W] > 0;
        const l = wl ? height[k - 1] : c, r = wr ? height[k + 1] : c;
        const u = wu ? height[k - W] : c, d = wd ? height[k + W] : c;
        speed[k] = (speed[k] + (l + r + u + d - 4 * c) * k2) * damping;
        // Heaped against the bank: over it, onto the dry ground beside.
        if (c > SPILL && !(wl && wr && wu && wd)) {
          const over = (c - SPILL) * 0.5, banks = (wl ? 0 : 1) + (wr ? 0 : 1) + (wu ? 0 : 1) + (wd ? 0 : 1);
          height[k] -= over;
          if (!wl) film[k - 1] += over * 3 / banks;
          if (!wr) film[k + 1] += over * 3 / banks;
          if (!wu) film[k - W] += over * 3 / banks;
          if (!wd) film[k + W] += over * 3 / banks;
          filmed = true;
          if (over > 0.004) spills.push(k, over, wl ? (wr ? 0 : 1) : -1, wu ? (wd ? 0 : 1) : -1);
        }
      }
    }
    // The level comes back slowly: no water is lost to the pushes.
    for (let j = win.j0; j < win.j1; j++) for (let k = j * W + win.i0, end = j * W + win.i1; k < end; k++) height[k] = (height[k] + speed[k]) * 0.99;
    if (filmed) spread();
    advanceShoves();
  }
  /** The spilt sheet runs out over the dry ground, thinning, and soaks away. */
  function spread() {
    let left = 0;
    filmNext.set(film);
    for (let j = win.j0; j < win.j1; j++) {
      for (let i = win.i0; i < win.i1; i++) {
        const k = j * W + i, f = film[k];
        if (f < 1e-5 || mask[k] > 0) continue;
        // A share runs to each lower dry neighbour.
        for (const n of [k - 1, k + 1, k - W, k + W]) {
          if (mask[n] > 0 || film[n] >= f) continue;
          const flow = (f - film[n]) * 0.1;
          filmNext[k] -= flow;
          filmNext[n] += flow;
        }
      }
    }
    for (let k = 0; k < film.length; k++) {
      // Soaking away over a few seconds, the thin edges first.
      const f = mask[k] > 0 ? 0 : Math.max(0, filmNext[k] * 0.996 - 0.000006);
      film[k] = f;
      if (f > 1e-5) left++;
    }
    filmed = left > 0;
  }

  // ---- The Force through the water ---------------------------------------------------
  const shoves = [];
  /**
   * A wall of water driven across the cone before `at` along `direction`: out
   * from him (a push, power > 0), or in towards him (a pull). The nearer, the higher.
   */
  function shove(at, direction, { range = 5.8, cone = 0.95, power = 1 } = {}) {
    const dir = new THREE.Vector2(direction.x, direction.z).normalize();
    shoves.push({ x: at.x, z: at.z, dir, range, cos: Math.cos(cone), power, front: power > 0 ? 0.3 : range, speed: 9 / 60 });
  }
  function advanceShoves() {
    for (let s = shoves.length - 1; s >= 0; s--) {
      const shove = shoves[s], push = shove.power > 0, strength = Math.abs(shove.power);
      shove.front += push ? shove.speed : -shove.speed;
      if (push ? shove.front > shove.range : shove.front < 0.4) { shoves.splice(s, 1); continue; }
      // The cells in a band at the front: heaped up on its leading side, drawn down behind it.
      const reach = Math.min(shove.range, shove.front + 0.6);
      const i0 = Math.max(1, Math.floor((shove.x - reach - rect.minX) / cell)), i1 = Math.min(W - 2, Math.ceil((shove.x + reach - rect.minX) / cell));
      const j0 = Math.max(1, Math.floor((shove.z - reach - rect.minZ) / cell)), j1 = Math.min(H - 2, Math.ceil((shove.z + reach - rect.minZ) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * W + i;
        if (mask[k] <= 0) continue;
        const dx = rect.minX + (i + 0.5) * cell - shove.x, dz = rect.minZ + (j + 0.5) * cell - shove.z, l = Math.hypot(dx, dz);
        if (l < 0.05 || l > shove.range || (dx * shove.dir.x + dz * shove.dir.y) / l < shove.cos) continue;
        // Ahead of the front (in the way it goes): heaped; behind: drawn down.
        const ahead = (l - shove.front) * (push ? 1 : -1);
        if (ahead < -0.5 || ahead > 0.3) continue;
        const near = 1 - l / shove.range, ease = near * (2 - near);
        height[k] += (ahead > 0 ? 0.022 : -0.012) * strength * (0.25 + 0.75 * ease);
        // Spray off the crest as it is driven.
        if (ahead > 0 && ahead < 0.1 && random() < 0.05 * ease * strength) {
          const sign = push ? 1 : -1;
          throwDrop(rect.minX + (i + 0.5) * cell, level + 0.04, rect.minZ + (j + 0.5) * cell, dx / l * sign * (1.5 + random() * 2) * ease, 1 + random() * 2.2 * ease, dz / l * sign * (1.5 + random() * 2) * ease);
        }
      }
    }
  }

  // ---- Craters -------------------------------------------------------------------
  const rushes = [];
  /**
   * An explosion opened the ground at `at`: in the water, a hole blown in it
   * that the water rushes back into, meeting in a jet; on the bank, the stream
   * pours into the crater (where it touches the water). Returns 'water',
   * 'flooded' or null.
   */
  function crater(at, radius = 1.2) {
    const r = Math.ceil(radius / cell), ci = Math.floor((at.x - rect.minX) / cell), cj = Math.floor((at.z - rect.minZ) / cell);
    const inside = [];
    let wet = 0;
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (i < 1 || j < 1 || i >= W - 1 || j >= H - 1) continue;
      const d = Math.hypot(i - ci, j - cj) / r;
      if (d > 1) continue;
      const k = j * W + i;
      inside.push({ k, d });
      if (mask[k] > 0) wet++;
    }
    if (!inside.length) return null;
    // The crater's dry cells that the water reaches (touching it, or through other such cells) fill.
    const dry = new Set(inside.filter(cellAt => mask[cellAt.k] <= 0 && cellAt.d < 0.85).map(cellAt => cellAt.k));
    const queue = [...dry].filter(k => mask[k - 1] > 0 || mask[k + 1] > 0 || mask[k - W] > 0 || mask[k + W] > 0);
    const flooded = new Set(queue);
    while (queue.length) {
      const k = queue.pop();
      for (const n of [k - 1, k + 1, k - W, k + W]) if (dry.has(n) && !flooded.has(n)) { flooded.add(n); queue.push(n); }
    }
    for (const { k, d } of inside) {
      if (flooded.has(k)) {
        // Now part of the stream, empty: the water pours in from its edge.
        mask[k] = Math.max(0.25, 0.75 * (1 - d * d));
        height[k] = -0.4 * (1 - d * d);
        speed[k] = 0;
      } else if (mask[k] > 0) {
        // Blown out: a hole in the water.
        height[k] -= 0.55 * (1 - d * d);
        speed[k] = 0;
      }
    }
    if (flooded.size) { depths.needsUpdate = true; for (const k of flooded) film[k] = 0; }
    if (wet > inside.length * 0.25) { rushes.push({ at: at.clone(), wait: 0.42, strength: 1.3 }); return 'water'; }
    if (flooded.size) { rushes.push({ at: at.clone(), wait: 0.6, strength: 0.6 }); return 'flooded'; }
    return null;
  }

  // ---- Drops ------------------------------------------------------------------------
  const DROPS = 500;
  const dropPositions = new Float32Array(DROPS * 3), dropAlpha = new Float32Array(DROPS);
  const dropGeometry = new THREE.BufferGeometry();
  dropGeometry.setAttribute('position', new THREE.BufferAttribute(dropPositions, 3).setUsage(THREE.DynamicDrawUsage));
  dropGeometry.setAttribute('alpha', new THREE.BufferAttribute(dropAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  const drops = new THREE.Points(dropGeometry, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { size: { value: 2 } },
    vertexShader: 'attribute float alpha; varying float vAlpha; uniform float size; void main(){ vAlpha = alpha; gl_PointSize = size; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying float vAlpha; void main(){ if (vAlpha < 0.02) discard; gl_FragColor = vec4(0.78, 0.95, 1.0, vAlpha); }',
  }));
  drops.name = 'Water drops';
  drops.frustumCulled = false;
  group.add(drops);
  const drop = Array.from({ length: DROPS }, () => ({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0 }));
  let nextDrop = 0;
  function throwDrop(x, y, z, vx, vy, vz) {
    const d = drop[nextDrop];
    nextDrop = (nextDrop + 1) % DROPS;
    d.alive = true; d.age = 0;
    d.p.set(x, y, z);
    d.v.set(vx, vy, vz);
  }
  /** A splash: the water pushed down, drops thrown up and out (along `along`, if given). */
  function splash(at, strength = 1, along = null) {
    if (depth(at.x, at.z) <= 0.02) return false;
    disturb(at.x, at.z, 0.18 + 0.25 * strength, 0.05 + 0.08 * strength);
    const count = Math.round(6 + 26 * strength);
    for (let n = 0; n < count; n++) {
      const angle = random() * Math.PI * 2, out = (0.4 + random() * 1.4) * (0.6 + strength * 0.6);
      throwDrop(at.x + Math.cos(angle) * 0.08, level + 0.02, at.z + Math.sin(angle) * 0.08, Math.cos(angle) * out, 1.2 + random() * 2.2 * (0.5 + strength * 0.7), Math.sin(angle) * out);
      if (along) drop[(nextDrop + DROPS - 1) % DROPS].v.addScaledVector(along, 0.8 * strength * random());
    }
    return true;
  }
  function updateDrops(dt) {
    for (let n = 0; n < DROPS; n++) {
      const d = drop[n];
      if (!d.alive) { dropAlpha[n] = 0; continue; }
      d.age += dt;
      d.v.y -= 9.8 * dt;
      d.p.addScaledVector(d.v, dt);
      if (d.p.y < level) {
        d.alive = false;
        // Back into the water: a little ring of its own.
        if (random() < 0.35) disturb(d.p.x, d.p.z, 0.08, 0.012);
        dropAlpha[n] = 0;
        continue;
      }
      dropPositions.set([d.p.x, d.p.y, d.p.z], n * 3);
      dropAlpha[n] = Math.min(1, 1.4 - d.age);
    }
    dropGeometry.attributes.position.needsUpdate = true;
    dropGeometry.attributes.alpha.needsUpdate = true;
  }

  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), euler = new THREE.Euler(), place = new THREE.Vector3(), scale = new THREE.Vector3();
  /** Each frame: waders stir the water round their legs; the waves run; the pads ride them. */
  function update(dt, { waders = [], time = 0, fog = null, focus = null, reach = 20 } = {}) {
    if (focus) {
      win.i0 = Math.max(1, Math.floor((focus.x - reach - rect.minX) / cell)); win.i1 = Math.min(W - 1, Math.ceil((focus.x + reach - rect.minX) / cell));
      win.j0 = Math.max(1, Math.floor((focus.z - reach - rect.minZ) / cell)); win.j1 = Math.min(H - 1, Math.ceil((focus.z + reach - rect.minZ) / cell));
    }
    for (const wader of waders) {
      if (wader.speed < 0.2 || depth(wader.x, wader.z) <= 0.02) continue;
      // Wading: the water is pushed ahead and closes behind, a wake.
      disturb(wader.x, wader.z, 0.22, Math.min(0.004, wader.speed * 0.0015) * dt * 60);
    }
    accumulator = Math.min(accumulator + dt, 0.1);
    let spilt = 0;
    while (accumulator >= 1 / 60) {
      simulate();
      accumulator -= 1 / 60;
      // Over the bank, the spill throws a few drops out across the mud.
      for (let s = 0; s < spills.length && spilt < 14; s += 4) {
        if (random() > 0.3) continue;
        const k = spills[s], over = spills[s + 1], x = rect.minX + ((k % W) + 0.5) * cell, z = rect.minZ + (Math.floor(k / W) + 0.5) * cell;
        throwDrop(x, level + 0.03, z, spills[s + 2] * (0.6 + random()) + (random() - 0.5) * 0.4, 0.8 + random() * 1.6 + over * 40, spills[s + 3] * (0.6 + random()) + (random() - 0.5) * 0.4);
        spilt++;
      }
    }
    // The water closing over a blown hole meets in a jet.
    for (let n = rushes.length - 1; n >= 0; n--) {
      if ((rushes[n].wait -= dt) > 0) continue;
      splash(rushes[n].at, rushes[n].strength);
      for (let m = 0; m < 14 * rushes[n].strength; m++) throwDrop(rushes[n].at.x + (random() - 0.5) * 0.2, level + 0.05, rushes[n].at.z + (random() - 0.5) * 0.2, (random() - 0.5) * 0.8, 3.5 + random() * 2.5, (random() - 0.5) * 0.8);
      rushes.splice(n, 1);
    }
    heights.needsUpdate = true;
    films.needsUpdate = true;
    updateDrops(dt);
    uniforms.time.value = time;
    if (fog) { uniforms.fogColor.value.copy(fog.color); uniforms.fogDensity.value = fog.density; }
    pads.forEach((pad, n) => {
      const k = index(pad.x, pad.z), hx = k < 0 ? 0 : height[k + 1] - height[k - 1], hz = k < 0 ? 0 : height[k + W] - height[k - W];
      euler.set(hz * 6, pad.yaw + Math.sin(time * 0.3 + n) * 0.05, -hx * 6);
      place.set(pad.x, level + 0.005 + THREE.MathUtils.clamp((k < 0 ? 0 : height[k]) * SHAPE, -0.45, 0.16), pad.z);
      padMesh.setMatrixAt(n, matrix.compose(place, quaternion.setFromEuler(euler), scale.setScalar(pad.size)));
    });
    padMesh.instanceMatrix.needsUpdate = true;
  }
  /** The lights whose glints the ripples catch: { position, color } (the nearest first). */
  function setGlints(lights) {
    for (let i = 0; i < GLINTS; i++) {
      const light = lights[i];
      if (light) { glints[i].position.copy(light.position); glints[i].color.copy(light.color).multiplyScalar(light.intensity ?? 1); }
      else glints[i].color.setRGB(0, 0, 0);
    }
  }
  // The stream as it was, for a restart (craters flood it).
  const firstMask = mask.slice();
  function reset() {
    height.fill(0); speed.fill(0); film.fill(0); filmed = false;
    mask.set(firstMask); depths.needsUpdate = true;
    shoves.length = rushes.length = 0;
    for (const d of drop) d.alive = false;
  }
  return {
    group, surface, level, rect, depthTexture: depths, disturb, splash, shove, crater, depth, update, setGlints, reset,
    /** How much the water moves now (the sum of the waves' heights). */
    get energy() { let sum = 0; for (let k = 0; k < height.length; k++) sum += Math.abs(height[k]); return sum; },
    /** How much water lies spilt over the banks. */
    get spilt() { let sum = 0; for (let k = 0; k < film.length; k++) sum += film[k]; return sum; },
    get drops() { return drop.filter(d => d.alive).length; },
  };
}
