import * as THREE from 'three';

/**
 * Lightsaber impact effects, stylised and without gore: bursts of sparks
 * that bounce on the floor, an orange flash of light, embers drifting up
 * from cauterised cuts, and glowing materials that cool from white-hot
 * orange to scorched black. sparks()/flash()/smoulder()/glow(), then update(dt).
 */
export function createImpactEffects(scene, { random = Math.random } = {}) {
  const MAX = 900;
  const positions = new Float32Array(MAX * 3), colors = new Float32Array(MAX * 3);
  const velocities = new Float32Array(MAX * 3), ages = new Float32Array(MAX).fill(Infinity), lives = new Float32Array(MAX), kinds = new Uint8Array(MAX);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const points = new THREE.Points(geometry, material);
  points.name = 'Impact sparks';
  points.frustumCulled = false;
  scene.add(points);

  const lights = [0, 1].map(() => {
    const light = new THREE.PointLight(0xff8a3a, 0, 3.2, 1.8);
    scene.add(light);
    return { light, age: Infinity, power: 0 };
  });
  let nextLight = 0, cursor = 0;
  const smoulders = [], glows = [];
  const hot = new THREE.Color(3.2, 1.35, 0.4), cold = new THREE.Color(0.055, 0.05, 0.05), color = new THREE.Color(), orange = new THREE.Color(2.4, 0.7, 0.12);
  const point = new THREE.Vector3();

  function emit(position, velocity, life, kind) {
    const i = cursor;
    cursor = (cursor + 1) % MAX;
    position.toArray(positions, i * 3);
    velocity.toArray(velocities, i * 3);
    ages[i] = 0; lives[i] = life; kinds[i] = kind;
  }
  /** A burst along the blade's motion, fanned across the cut plane. */
  function sparks(position, direction, normal, { count = 40, speed = 4 } = {}) {
    const velocity = new THREE.Vector3(), side = new THREE.Vector3().crossVectors(direction, normal);
    for (let i = 0; i < count; i++) {
      velocity.copy(direction).multiplyScalar(speed * (0.25 + random() * 0.85))
        .addScaledVector(side, (random() - 0.5) * speed * 0.9)
        .addScaledVector(normal, (random() - 0.5) * speed * 0.5);
      velocity.y += 0.6 + random() * 1.6;
      emit(position, velocity, 0.22 + random() * 0.55, 0);
    }
  }
  function flash(position, power = 1) {
    const slot = lights[nextLight];
    nextLight = (nextLight + 1) % lights.length;
    slot.light.position.copy(position);
    slot.age = 0;
    slot.power = power;
  }
  /** Embers rising from an object (a cut) for a few seconds. */
  function smoulder(object, duration = 2.4) { smoulders.push({ object, age: 0, duration, debt: 0 }); }
  /** A material that cools from white-hot to scorched over a few seconds. */
  function glow(material, duration = 4.5) {
    glows.push({ material, age: 0, duration });
    material.color.copy(hot);
  }

  function update(dt) {
    for (const slot of lights) {
      slot.age += dt;
      slot.light.intensity = slot.age < 0.16 ? slot.power * 5 * (1 - slot.age / 0.16) ** 2 : 0;
    }
    for (const entry of smoulders) {
      entry.age += dt;
      entry.debt += dt * 14 * (1 - entry.age / entry.duration);
      while (entry.debt > 1) {
        entry.debt -= 1;
        entry.object.getWorldPosition(point);
        emit(point, new THREE.Vector3((random() - 0.5) * 0.25, 0.25 + random() * 0.4, (random() - 0.5) * 0.25), 0.6 + random() * 0.8, 1);
      }
    }
    for (let i = smoulders.length - 1; i >= 0; i--) if (smoulders[i].age >= smoulders[i].duration) smoulders.splice(i, 1);
    for (const entry of glows) {
      entry.age += dt;
      const t = Math.min(1, entry.age / entry.duration);
      entry.material.color.copy(hot).lerp(cold, 1 - (1 - t) ** 2.2);
    }
    for (let i = glows.length - 1; i >= 0; i--) if (glows[i].age >= glows[i].duration) glows.splice(i, 1);

    for (let i = 0; i < MAX; i++) {
      if (ages[i] >= lives[i]) { colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = 0; continue; }
      ages[i] += dt;
      const o = i * 3;
      const ember = kinds[i] === 1;
      if (!ember) velocities[o + 1] -= 9.8 * dt;
      positions[o] += velocities[o] * dt; positions[o + 1] += velocities[o + 1] * dt; positions[o + 2] += velocities[o + 2] * dt;
      if (positions[o + 1] < 0.005) {
        positions[o + 1] = 0.005;
        velocities[o + 1] *= -0.35; velocities[o] *= 0.6; velocities[o + 2] *= 0.6;
      }
      // Clamped: a spark that outlives the frame must not raise a negative to a power (NaN).
      const t = Math.min(1, ages[i] / lives[i]);
      // Sparks: white-hot, then orange, then out. Embers glow a dim orange.
      if (ember) color.setRGB(1.6, 0.5, 0.1).multiplyScalar(Math.sin(Math.PI * t) * 0.9);
      else color.setRGB(4, 3, 1.6).lerp(orange, Math.min(1, t * 2)).multiplyScalar((1 - t) ** 1.4);
      colors[o] = color.r; colors[o + 1] = color.g; colors[o + 2] = color.b;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }
  function clear() {
    ages.fill(Infinity);
    smoulders.length = 0;
    glows.length = 0;
    for (const slot of lights) { slot.age = Infinity; slot.light.intensity = 0; }
    update(0);
  }
  const live = () => { let count = 0; for (let i = 0; i < MAX; i++) if (ages[i] < lives[i]) count++; return count; };
  return { points, sparks, flash, smoulder, glow, update, clear, get live() { return live(); }, hot, cold };
}
