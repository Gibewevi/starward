import * as THREE from 'three';

/**
 * Glowing arc left by the blade during a strike, like the swooshes of the
 * reference sheet. A ribbon in world space joins recent blade positions;
 * between frames the blade is swept around its hilt, so fast cuts draw round
 * arcs rather than straight chords. update(dt, base, tip, intensity 0..1).
 */
export function createBladeTrail(scene, { lifetime = 0.16, subdivisions = 4, color = 'blue' } = {}) {
  const MAX = 48;
  const samples = [];
  const positions = new Float32Array(MAX * 2 * 3), colors = new Float32Array(MAX * 2 * 3);
  const indices = [];
  for (let i = 0; i < MAX - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    indices.push(a, b, c, b, d, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0, 0);
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Blade trail';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  scene.add(mesh);

  const glow = color === 'red' ? new THREE.Color(1.9, 0.1, 0.08) : new THREE.Color(0.1, 0.42, 1.9);
  const core = color === 'red' ? new THREE.Color(2.9, 0.46, 0.32) : new THREE.Color(0.42, 1.05, 2.9);
  const lastBase = new THREE.Vector3(), lastDirection = new THREE.Vector3(), direction = new THREE.Vector3();
  const from = new THREE.Quaternion(), turn = new THREE.Quaternion(), step = new THREE.Vector3();
  const inner = new THREE.Vector3(), outer = new THREE.Vector3();
  let length = 0, hasLast = false;

  function push(base, dir, strength) {
    samples.unshift({ base: base.clone(), dir: dir.clone(), age: 0, strength });
    if (samples.length > MAX) samples.pop();
  }
  function update(dt, base, tip, intensity) {
    for (const sample of samples) sample.age += dt;
    while (samples.length && samples.at(-1).age > lifetime) samples.pop();
    direction.subVectors(tip, base);
    length = direction.length();
    direction.normalize();
    if (intensity > 0.01 && length > 0.05) {
      if (hasLast) {
        // Sweep the blade around its hilt between the two frames.
        turn.setFromUnitVectors(lastDirection, direction);
        for (let i = 1; i < subdivisions; i++) {
          const s = i / subdivisions;
          from.identity().slerp(turn, s);
          step.copy(lastDirection).applyQuaternion(from);
          push(new THREE.Vector3().lerpVectors(lastBase, base, s), step, intensity);
          samples[0].age = dt * (1 - s);
        }
      }
      push(base, direction, intensity);
      lastBase.copy(base); lastDirection.copy(direction); hasLast = true;
    } else {
      hasLast = false;
    }
    const count = samples.length;
    for (let i = 0; i < count; i++) {
      const sample = samples[i];
      const fade = Math.pow(Math.max(0, 1 - sample.age / lifetime), 1.6) * sample.strength;
      // The arc is brightest along the outer half of the blade.
      inner.copy(sample.base).addScaledVector(sample.dir, length * 0.22);
      outer.copy(sample.base).addScaledVector(sample.dir, length);
      inner.toArray(positions, i * 6);
      outer.toArray(positions, i * 6 + 3);
      colors.set([glow.r * fade * 0.25, glow.g * fade * 0.25, glow.b * fade * 0.25], i * 6);
      colors.set([core.r * fade, core.g * fade, core.b * fade], i * 6 + 3);
    }
    geometry.setDrawRange(0, Math.max(0, count - 1) * 6);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    mesh.visible = count > 1;
  }
  function clear() { samples.length = 0; hasLast = false; mesh.visible = false; }
  return { mesh, update, clear, get samples() { return samples.length; } };
}
