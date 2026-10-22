import * as THREE from 'three';

/**
 * Shallow jungle water: clear turquoise over the sand, deeper teal where it
 * is deep, a line of foam along the edge.
 *
 * Its surface is a real wave simulation on a fine grid (the wave equation,
 * damped): anything that disturbs it — a step, someone wading through, a body
 * falling in, a bolt, an explosion — pushes the water there, and the rings
 * spread, cross, bounce off the banks and die away. The heights are read by
 * the surface's shader for its slopes: the ripples catch the moon and the
 * lamps of the ruins as moving glints, and bend what is seen below. Lily pads
 * ride the waves. A splash throws drops that fall back into it (rings of their
 * own where they land).
 *
 * createWater(scene, { rect, depthAt }) — depthAt(x, z): 0 dry, up to 1 at the
 * deepest. disturb(x, z, radius, amount); splash(at, strength, along);
 * depth(x, z); update(dt, { waders, camera }); setGlints(lights).
 */
const GLINTS = 6;

export function createWater(scene, { rect, depthAt, cell = 0.08, level = 0.035, random = Math.random } = {}) {
  const width = rect.maxX - rect.minX, length = rect.maxZ - rect.minZ;
  const W = Math.ceil(width / cell), H = Math.ceil(length / cell);
  const mask = new Float32Array(W * H), height = new Float32Array(W * H), speed = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) mask[j * W + i] = Math.max(0, Math.min(1, depthAt(rect.minX + (i + 0.5) * cell, rect.minZ + (j + 0.5) * cell)));
  const heights = new THREE.DataTexture(height, W, H, THREE.RedFormat, THREE.FloatType);
  heights.magFilter = heights.minFilter = THREE.NearestFilter;
  heights.needsUpdate = true;
  const depths = new THREE.DataTexture(mask, W, H, THREE.RedFormat, THREE.FloatType);
  depths.magFilter = depths.minFilter = THREE.NearestFilter;
  depths.needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'Jungle water';
  scene.add(group);
  const geometry = new THREE.PlaneGeometry(width, length);
  geometry.rotateX(-Math.PI / 2);
  const glints = Array.from({ length: GLINTS }, () => ({ position: new THREE.Vector3(), color: new THREE.Color(0, 0, 0) }));
  const uniforms = {
    tHeight: { value: heights }, tDepth: { value: depths }, texel: { value: new THREE.Vector2(1 / W, 1 / H) },
    rectMin: { value: new THREE.Vector2(rect.minX, rect.minZ) }, rectSize: { value: new THREE.Vector2(width, length) },
    time: { value: 0 }, viewDir: { value: new THREE.Vector3(-8, -8.2, -10).normalize() },
    moonDir: { value: new THREE.Vector3(0.4, 0.8, 0.45).normalize() }, moonColor: { value: new THREE.Color(0.55, 0.7, 0.9) },
    shallow: { value: new THREE.Color(0.1, 0.62, 0.6) }, deep: { value: new THREE.Color(0.02, 0.2, 0.26) }, sky: { value: new THREE.Color(0.05, 0.12, 0.16) },
    glintPos: { value: glints.map(g => g.position) }, glintColor: { value: glints.map(g => g.color) },
    fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    name: 'Jungle water',
    transparent: true, depthWrite: false, fog: true,
    uniforms,
    vertexShader: /* glsl */`
      varying vec3 vWorld; varying vec2 vUv; varying float vFogDepth;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz; vUv = uv;
        vec4 view = viewMatrix * world;
        vFogDepth = -view.z;
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tHeight; uniform sampler2D tDepth; uniform vec2 texel; uniform vec2 rectMin; uniform vec2 rectSize;
      uniform float time; uniform vec3 viewDir; uniform vec3 moonDir; uniform vec3 moonColor;
      uniform vec3 shallow; uniform vec3 deep; uniform vec3 sky;
      uniform vec3 glintPos[${GLINTS}]; uniform vec3 glintColor[${GLINTS}];
      uniform vec3 fogColor; uniform float fogDensity;
      varying vec3 vWorld; varying vec2 vUv; varying float vFogDepth;
      float h(vec2 uv) { return texture2D(tHeight, uv).r; }
      void main() {
        vec2 uv = (vWorld.xz - rectMin) / rectSize;
        float depth = texture2D(tDepth, uv).r;
        if (depth < 0.02) discard;
        // The slopes: the simulated ripples, and a fine shiver of the wind on top.
        float dx = h(uv + vec2(texel.x, 0.0)) - h(uv - vec2(texel.x, 0.0));
        float dz = h(uv + vec2(0.0, texel.y)) - h(uv - vec2(0.0, texel.y));
        vec2 wind = vec2(sin(vWorld.x * 3.1 + time * 1.7 + sin(vWorld.z * 2.3 + time)), cos(vWorld.z * 2.7 - time * 1.4 + sin(vWorld.x * 1.9))) * 0.035;
        vec3 n = normalize(vec3(-dx * 9.0 + wind.x, 1.0, -dz * 9.0 + wind.y));
        vec3 eye = -viewDir;
        float fresnel = pow(1.0 - max(dot(n, eye), 0.0), 3.0);
        // Clear turquoise over the sand, darker teal where deep; the ripples bend the light below.
        float bands = 0.5 + 0.5 * sin((vWorld.x + vWorld.z) * 6.0 + (dx + dz) * 60.0 + time * 0.6);
        vec3 water = mix(shallow, deep, smoothstep(0.1, 0.9, depth)) * (0.85 + 0.25 * bands * (1.0 - depth));
        vec3 colour = mix(water, sky, fresnel * 0.6);
        // The moon, and the lamps of the ruins, glinting on the ripples.
        vec3 r = reflect(-eye, n);
        colour += moonColor * pow(max(dot(r, moonDir), 0.0), 40.0) * 0.9;
        for (int i = 0; i < ${GLINTS}; i++) {
          vec3 toLight = glintPos[i] - vWorld; float far = length(toLight);
          float s = pow(max(dot(r, toLight / far), 0.0), 22.0) / (1.0 + far * far * 0.08);
          colour += glintColor[i] * s * 2.2;
        }
        // Foam along the edge, and where the water is churned.
        float churn = clamp(abs(dx) * 18.0 + abs(dz) * 18.0, 0.0, 1.0);
        float foam = smoothstep(0.2, 0.04, depth) * (0.55 + 0.45 * sin(vWorld.x * 23.0 + time * 2.0) * sin(vWorld.z * 19.0 - time * 1.7)) + churn * 0.35;
        colour = mix(colour, vec3(0.6, 0.82, 0.8), clamp(foam, 0.0, 0.6));
        float alpha = mix(0.5, 0.88, smoothstep(0.05, 0.8, depth)) + fresnel * 0.1 + foam * 0.2;
        float fog = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
        gl_FragColor = vec4(mix(colour, fogColor, fog), clamp(alpha, 0.0, 1.0));
        #include <colorspace_fragment>
      }`,
  });
  const surface = new THREE.Mesh(geometry, material);
  surface.position.set(rect.minX + width / 2, level, rect.minZ + length / 2);
  surface.renderOrder = 2;
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
  const padMesh = new THREE.InstancedMesh(padShape, new THREE.MeshLambertMaterial({ color: 0x2f6b2a, side: THREE.DoubleSide }), Math.max(1, pads.length));
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
  let accumulator = 0;
  function simulate() {
    for (let j = 1; j < H - 1; j++) {
      for (let i = 1; i < W - 1; i++) {
        const k = j * W + i;
        if (mask[k] <= 0) continue;
        // Dry neighbours are the bank: the wave bounces off them.
        const c = height[k];
        const l = mask[k - 1] > 0 ? height[k - 1] : c, r = mask[k + 1] > 0 ? height[k + 1] : c;
        const u = mask[k - W] > 0 ? height[k - W] : c, d = mask[k + W] > 0 ? height[k + W] : c;
        speed[k] = (speed[k] + (l + r + u + d - 4 * c) * k2) * damping;
      }
    }
    // The level comes back slowly: no water is lost to the pushes.
    for (let k = 0; k < height.length; k++) height[k] = (height[k] + speed[k]) * 0.99;
  }

  // ---- Drops ------------------------------------------------------------------------
  const DROPS = 400;
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
  /** A splash: the water pushed down, drops thrown up and out (along `along`, if given). */
  function splash(at, strength = 1, along = null) {
    if (depth(at.x, at.z) <= 0.02) return false;
    disturb(at.x, at.z, 0.18 + 0.25 * strength, 0.05 + 0.08 * strength);
    const count = Math.round(6 + 26 * strength);
    for (let n = 0; n < count; n++) {
      const d = drop[nextDrop];
      nextDrop = (nextDrop + 1) % DROPS;
      const angle = random() * Math.PI * 2, out = (0.4 + random() * 1.4) * (0.6 + strength * 0.6);
      d.alive = true; d.age = 0;
      d.p.set(at.x + Math.cos(angle) * 0.08, level + 0.02, at.z + Math.sin(angle) * 0.08);
      d.v.set(Math.cos(angle) * out, 1.2 + random() * 2.2 * (0.5 + strength * 0.7), Math.sin(angle) * out);
      if (along) d.v.addScaledVector(along, 0.8 * strength * random());
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
  function update(dt, { waders = [], time = 0, fog = null } = {}) {
    for (const wader of waders) {
      if (wader.speed < 0.2 || depth(wader.x, wader.z) <= 0.02) continue;
      // Wading: the water is pushed ahead and closes behind, a wake.
      disturb(wader.x, wader.z, 0.22, Math.min(0.004, wader.speed * 0.0015) * dt * 60);
    }
    accumulator = Math.min(accumulator + dt, 0.1);
    while (accumulator >= 1 / 60) { simulate(); accumulator -= 1 / 60; }
    heights.needsUpdate = true;
    updateDrops(dt);
    uniforms.time.value = time;
    if (fog) { uniforms.fogColor.value.copy(fog.color); uniforms.fogDensity.value = fog.density; }
    pads.forEach((pad, n) => {
      const k = index(pad.x, pad.z), hx = k < 0 ? 0 : height[k + 1] - height[k - 1], hz = k < 0 ? 0 : height[k + W] - height[k - W];
      euler.set(hz * 6, pad.yaw + Math.sin(time * 0.3 + n) * 0.05, -hx * 6);
      place.set(pad.x, level + 0.005 + (k < 0 ? 0 : height[k]) * 0.6, pad.z);
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
  function reset() { height.fill(0); speed.fill(0); for (const d of drop) d.alive = false; }
  return {
    group, surface, level, rect, depthTexture: depths, disturb, splash, depth, update, setGlints, reset,
    /** How much the water moves now (the sum of the waves' heights). */
    get energy() { let sum = 0; for (let k = 0; k < height.length; k++) sum += Math.abs(height[k]); return sum; },
    get drops() { return drop.filter(d => d.alive).length; },
  };
}
