import * as THREE from 'three';

/**
 * The jungle's air: moonlight falling through the gaps in the canopy as
 * shafts in the damp air (drawn by a beam pass, like the troopers' lamps in
 * the dark room), dust and pollen drifting in them — seen only where a shaft
 * or a lamp of the ruins lights them, whirled aside by whoever goes through —
 * and fireflies wandering low over the plants, blinking.
 *
 * On a black night (`night`) the moon barely comes through: the dust hangs
 * thick before the lamps of the ruins instead, warm in their light.
 *
 * createJungleAir(scene, { bounds, shafts, lamps, night }) — shafts: [{ at, forward,
 * length }]; lamps: point lights. `beams` for the beam pass; update(dt, { time, stirs }).
 */
export function createJungleAir(scene, { bounds, shafts = [], lamps = [], night = false, random = Math.random } = {}) {
  const group = new THREE.Group();
  group.name = 'Jungle air';
  scene.add(group);
  const beams = shafts.map(shaft => ({ lens: shaft.at.clone(), forward: shaft.forward.clone().normalize(), length: shaft.length, on: (shaft.strength ?? 1) * (night ? 0.25 : 1), light: null }));
  // Where the dust hangs: in the shafts, before the lamps, anywhere (shares).
  const [inShafts, byLamps] = night ? [0.15, 0.85] : [0.65, 0.85];
  const lampReach = night ? 3.2 : 2.6, lampGlow = night ? 1.25 : 0.9;

  // ---- Motes ----------------------------------------------------------------------
  const MOTES = 1400;
  const home = new Float32Array(MOTES * 3), phase = new Float32Array(MOTES), push = new Float32Array(MOTES * 3);
  const positions = new Float32Array(MOTES * 3), glow = new Float32Array(MOTES), tint = new Float32Array(MOTES * 3);
  for (let i = 0; i < MOTES; i++) {
    // Most hang in the shafts, the rest round the lamps and anywhere.
    let x, y, z;
    const pick = random();
    if (pick < inShafts && beams.length) {
      const beam = beams[i % beams.length], along = random() * beam.length * 0.95, radius = 0.12 * along * random();
      const side = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize().multiplyScalar(radius);
      const p = beam.lens.clone().addScaledVector(beam.forward, along).add(side);
      x = p.x; y = Math.max(0.15, p.y); z = p.z;
    } else if (pick < byLamps && lamps.length) {
      const lamp = lamps[i % lamps.length].position;
      x = lamp.x + (random() - 0.5) * 3; y = 0.2 + random() * 2.6; z = lamp.z + (random() - 0.5) * 3;
    } else {
      x = bounds.minX + random() * (bounds.maxX - bounds.minX); y = 0.2 + random() * 3; z = bounds.minZ + random() * (bounds.maxZ - bounds.minZ);
    }
    home.set([x, y, z], i * 3);
    phase[i] = random() * 100;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('glow', new THREE.BufferAttribute(glow, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('tint', new THREE.BufferAttribute(tint, 3).setUsage(THREE.DynamicDrawUsage));
  const points = new THREE.Points(geometry, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'attribute float glow; attribute vec3 tint; varying float vGlow; varying vec3 vTint; void main(){ vGlow = glow; vTint = tint; gl_PointSize = 1.0 + step(0.6, glow); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying float vGlow; varying vec3 vTint; void main(){ if (vGlow < 0.02) discard; gl_FragColor = vec4(vTint * vGlow, 1.0); }',
  }));
  points.name = 'Motes';
  points.frustumCulled = false;
  group.add(points);

  // ---- Fireflies ----------------------------------------------------------------
  // As many as the ground is big (46 to a clearing of 24 by 18 m).
  const FLIES = Math.round(46 * (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ) / 432);
  const flies = Array.from({ length: FLIES }, () => ({
    at: new THREE.Vector3(bounds.minX + random() * (bounds.maxX - bounds.minX), 0.3 + random() * 1.2, bounds.minZ + random() * (bounds.maxZ - bounds.minZ)),
    velocity: new THREE.Vector3(), blink: random() * 6, rate: 0.25 + random() * 0.4, wander: random() * 100,
  }));
  const flyPositions = new Float32Array(FLIES * 3), flyGlow = new Float32Array(FLIES);
  const flyGeometry = new THREE.BufferGeometry();
  flyGeometry.setAttribute('position', new THREE.BufferAttribute(flyPositions, 3).setUsage(THREE.DynamicDrawUsage));
  flyGeometry.setAttribute('glow', new THREE.BufferAttribute(flyGlow, 1).setUsage(THREE.DynamicDrawUsage));
  const fireflies = new THREE.Points(flyGeometry, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'attribute float glow; varying float vGlow; void main(){ vGlow = glow; gl_PointSize = 2.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying float vGlow; void main(){ if (vGlow < 0.02) discard; gl_FragColor = vec4(vec3(1.4, 2.2, 0.55) * vGlow, 1.0); }',
  }));
  fireflies.name = 'Fireflies';
  fireflies.frustumCulled = false;
  group.add(fireflies);

  const local = new THREE.Vector3(), point = new THREE.Vector3();
  const moon = new THREE.Color(0.62, 0.86, 0.95), warm = new THREE.Color(1.2, 0.78, 0.42);
  /** How lit a point of the air is: by the shafts (moonlight) and the lamps (warm). */
  function lightAt(p, out) {
    out.setRGB(0, 0, 0);
    for (const beam of beams) {
      local.subVectors(p, beam.lens);
      const along = local.dot(beam.forward);
      if (along <= 0 || along >= beam.length) continue;
      const radius = 0.13 * along, off = local.addScaledVector(beam.forward, -along).length();
      if (off >= radius) continue;
      const share = (1 - off / radius) * (1 - along / beam.length * 0.6) * beam.on;
      out.r += moon.r * share; out.g += moon.g * share; out.b += moon.b * share;
    }
    for (const lamp of lamps) {
      const d = lamp.position.distanceTo(p);
      if (d > lampReach) continue;
      // A lamp cut (its intensity down from its base) lights the dust no more.
      const share = (1 - d / lampReach) ** 2 * lampGlow * Math.min(1, lamp.intensity / (lamp.base ?? lamp.intensity ?? 1));
      out.r += warm.r * share; out.g += warm.g * share; out.b += warm.b * share;
    }
    return out;
  }
  const light = new THREE.Color();
  function update(dt, { time = 0, stirs = [] } = {}) {
    for (let i = 0; i < MOTES; i++) {
      const k = i * 3, t = time * 0.35 + phase[i];
      // Pushed aside by whoever passes, settling slowly back.
      for (const stir of stirs) {
        const dx = home[k] + push[k] - stir.at.x, dy = home[k + 1] + push[k + 1] - stir.at.y, dz = home[k + 2] + push[k + 2] - stir.at.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > 0.9 || d < 1e-4) continue;
        const shove = (1 - d / 0.9) * Math.min(stir.speed, 8) * 0.04;
        push[k] += dx / d * shove + dz / d * shove * 0.6; push[k + 1] += dy / d * shove * 0.5 + shove * 0.2; push[k + 2] += dz / d * shove - dx / d * shove * 0.6;
      }
      const settle = Math.exp(-0.6 * dt);
      push[k] *= settle; push[k + 1] *= settle; push[k + 2] *= settle;
      point.set(home[k] + push[k] + Math.sin(t * 1.3) * 0.12, home[k + 1] + push[k + 1] + Math.sin(t * 0.9 + 1) * 0.08, home[k + 2] + push[k + 2] + Math.cos(t * 1.1) * 0.12);
      positions.set([point.x, point.y, point.z], k);
      lightAt(point, light);
      const g = Math.min(1, Math.max(light.r, light.g, light.b));
      glow[i] = g * (0.55 + 0.45 * Math.sin(t * 3 + i));
      tint.set([light.r / Math.max(g, 1e-3), light.g / Math.max(g, 1e-3), light.b / Math.max(g, 1e-3)], k);
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.glow.needsUpdate = true;
    geometry.attributes.tint.needsUpdate = true;
    flies.forEach((fly, i) => {
      fly.wander += dt;
      fly.velocity.add(new THREE.Vector3(Math.sin(fly.wander * 1.7 + i), Math.sin(fly.wander * 2.3 + i * 2) * 0.5, Math.cos(fly.wander * 1.3 + i * 3)).multiplyScalar(dt * 0.9));
      // Startled by whoever comes close.
      for (const stir of stirs) {
        const away = fly.at.clone().sub(stir.at), d = away.length();
        if (d < 1.2 && d > 1e-3) fly.velocity.addScaledVector(away.divideScalar(d), (1.2 - d) * 3 * dt);
      }
      fly.velocity.multiplyScalar(Math.exp(-1.2 * dt));
      fly.at.addScaledVector(fly.velocity, dt);
      fly.at.y = THREE.MathUtils.clamp(fly.at.y, 0.25, 1.9);
      fly.at.x = THREE.MathUtils.clamp(fly.at.x, bounds.minX + 0.5, bounds.maxX - 0.5);
      fly.at.z = THREE.MathUtils.clamp(fly.at.z, bounds.minZ + 0.5, bounds.maxZ - 0.5);
      flyPositions.set([fly.at.x, fly.at.y, fly.at.z], i * 3);
      // A slow pulse: on for a moment, off for longer.
      const pulse = Math.max(0, Math.sin((time + fly.blink) * fly.rate * Math.PI * 2));
      flyGlow[i] = pulse ** 3;
    });
    flyGeometry.attributes.position.needsUpdate = true;
    flyGeometry.attributes.glow.needsUpdate = true;
  }
  return { group, beams, update, get litMotes() { let n = 0; for (let i = 0; i < MOTES; i++) n += glow[i] > 0.1; return n; } };
}
