import * as THREE from 'three';
import { gradeCharacterMaterial } from './character-shading.js';

/**
 * Long coat skirt, simulated in world space. The cloth wraps around the back
 * and sides from the belt to mid-calf and stays open at the front, like the
 * reference robe. Its waist row follows the captured pelvis; legs push the
 * front panels, air and inertia make the tails trail behind a run, and a soft
 * memory of the tailored shape keeps the A-line silhouette without stiffness.
 * update({ dt, time, velocity: Vector3, turnRate }) after the character pose.
 */
export const COAT_COLOR = '#5a3b2e';

export function createCoat({ scene, character }) {
  const { bones } = character.rig;
  const ROWS = 12, COLUMNS = 27, COUNT = ROWS * COLUMNS;
  const TOP = 0.80, HEM = 0.24;
  const hipsHeight = 0.765;
  const positions = new Float32Array(COUNT * 3), previous = new Float32Array(COUNT * 3);
  const targets = new Float32Array(COUNT * 3), lastTargets = new Float32Array(COUNT * 3), local = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3), memory = new Float32Array(ROWS), facing = new Float32Array(COLUMNS);
  const constraints = [], indices = [];
  const smooth = (a, b, value) => THREE.MathUtils.smoothstep(value, a, b);

  // Tailored rest shape in the pelvis frame: an A-line wrap open at the front.
  const base = new THREE.Color(COAT_COLOR), fold = new THREE.Color('#432c23'), hem = new THREE.Color('#6a4a3c');
  const color = new THREE.Color();
  for (let row = 0; row < ROWS; row++) {
    const t = row / (ROWS - 1), flare = Math.pow(t, 0.85);
    const gap = THREE.MathUtils.lerp(0.12, 0.3, smooth(0, 1, t));
    const rx = THREE.MathUtils.lerp(0.167, 0.32, flare), rz = THREE.MathUtils.lerp(0.123, 0.24, flare);
    // Spring towards the tailored shape (1/s²): firm at the belt, loose at the hem.
    memory[row] = row === 0 ? 0 : 60 + 1500 * Math.pow(1 - t, 2.4);
    for (let column = 0; column < COLUMNS; column++) {
      const u = column / (COLUMNS - 1);
      // Interfaced front edges keep the opening, as on a tailored robe.
      facing[column] = 1 + 2.5 * Math.max(0, 1 - Math.min(u, 1 - u) * 9);
      const angle = gap + u * (Math.PI * 2 - gap * 2);
      const index = row * COLUMNS + column, offset = index * 3;
      const front = Math.cos(angle);
      // Front panels hang straighter over the thighs than the flared back.
      const x = Math.sin(angle) * rx * (1 - 0.12 * Math.max(0, front) * t);
      const z = 0.004 + front * rz * (1 - 0.25 * Math.max(0, front) * t);
      const y = TOP + (HEM - TOP) * t + (t === 1 ? Math.sin(u * 23) * 0.008 + front * 0.01 : 0);
      local.set([x, y - hipsHeight, z], offset);
      const pleat = Math.cos(angle * 9 + 0.4);
      color.copy(base).lerp(fold, Math.max(0, pleat) * 0.35 * smooth(0.1, 0.6, t));
      color.lerp(hem, smooth(0.86, 1, t) * 0.45);
      colors.set([color.r, color.g, color.b], offset);
      if (row < ROWS - 1 && column < COLUMNS - 1) {
        const a = index, b = a + 1, c = a + COLUMNS, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // The inside of the coat is a darker lining.
  const material = gradeCharacterMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide }), { inside: [0.5, 0.46, 0.5] });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Simulated long coat skirt';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);

  const hipsMatrix = new THREE.Matrix4(), inverseHips = new THREE.Matrix4();
  const point = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  const wind = new THREE.Vector3(), gust = new THREE.Vector3(), goal = new Float32Array(COUNT * 3);
  const rootPosition = new THREE.Vector3(), lastRoot = new THREE.Vector3();
  const segments = [
    ['LeftUpLeg', 'LeftLeg', 0.1], ['LeftLeg', 'LeftFoot', 0.08], ['LeftFoot', 'LeftToeBase', 0.07],
    ['RightUpLeg', 'RightLeg', 0.1], ['RightLeg', 'RightFoot', 0.08], ['RightFoot', 'RightToeBase', 0.07],
  ].map(([from, to, radius]) => ({ from: bones[from], to: bones[to], radius, a: new THREE.Vector3(), b: new THREE.Vector3() }));
  let previousStep = 1 / 120, accumulator = 0, disposed = false;

  function readFrame() {
    character.root.updateMatrixWorld(true);
    hipsMatrix.copy(bones.Hips.matrixWorld);
    inverseHips.copy(hipsMatrix).invert();
    for (let i = 0; i < COUNT; i++) {
      point.fromArray(local, i * 3).applyMatrix4(hipsMatrix);
      point.toArray(targets, i * 3);
    }
    for (const segment of segments) {
      segment.from.getWorldPosition(segment.a);
      segment.to.getWorldPosition(segment.b);
    }
    character.root.getWorldPosition(rootPosition);
  }

  function connect(i, j, stiffness) {
    a.fromArray(targets, i * 3);
    constraints.push({ i, j, length: a.distanceTo(b.fromArray(targets, j * 3)), stiffness });
  }
  function reset() {
    if (disposed) return;
    readFrame();
    positions.set(targets);
    previous.set(targets);
    lastTargets.set(targets);
    lastRoot.copy(rootPosition);
    previousStep = 1 / 120;
    constraints.length = 0;
    for (let row = 0; row < ROWS; row++) {
      for (let column = 0; column < COLUMNS; column++) {
        const p = row * COLUMNS + column;
        if (column + 1 < COLUMNS) connect(p, p + 1, 1);
        if (row + 1 < ROWS) connect(p, p + COLUMNS, 1);
        if (column + 1 < COLUMNS && row + 1 < ROWS) { connect(p, p + COLUMNS + 1, 0.5); connect(p + 1, p + COLUMNS, 0.5); }
        if (column + 2 < COLUMNS) connect(p, p + 2, 0.3);
        if (row + 2 < ROWS) connect(p, p + COLUMNS * 2, 0.35);
      }
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  function solve() {
    for (const { i, j, length, stiffness } of constraints) {
      const wi = i < COLUMNS ? 0 : 1, wj = j < COLUMNS ? 0 : 1;
      if (wi + wj === 0) continue;
      const ii = i * 3, jj = j * 3;
      const dx = positions[jj] - positions[ii], dy = positions[jj + 1] - positions[ii + 1], dz = positions[jj + 2] - positions[ii + 2];
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance < 1e-6) continue;
      const k = (distance - length) / distance * stiffness / (wi + wj);
      positions[ii] += dx * k * wi; positions[ii + 1] += dy * k * wi; positions[ii + 2] += dz * k * wi;
      positions[jj] -= dx * k * wj; positions[jj + 1] -= dy * k * wj; positions[jj + 2] -= dz * k * wj;
    }
  }

  function collide() {
    for (let i = COLUMNS; i < COUNT; i++) {
      const offset = i * 3;
      point.fromArray(positions, offset);
      let moved = false;
      // Pelvis: an elliptical column in the hips' frame.
      a.copy(point).applyMatrix4(inverseHips);
      if (a.y < 0.08 && a.y > -0.2) {
        const nx = a.x / 0.168, nz = (a.z - 0.004) / 0.124, r = Math.hypot(nx, nz);
        if (r < 1 && r > 1e-5) { a.x = nx / r * 0.168; a.z = 0.004 + nz / r * 0.124; point.copy(a.applyMatrix4(hipsMatrix)); moved = true; }
      }
      for (const segment of segments) {
        const abx = segment.b.x - segment.a.x, aby = segment.b.y - segment.a.y, abz = segment.b.z - segment.a.z;
        const t = THREE.MathUtils.clamp(((point.x - segment.a.x) * abx + (point.y - segment.a.y) * aby + (point.z - segment.a.z) * abz) / (abx * abx + aby * aby + abz * abz), 0, 1);
        const cx = segment.a.x + abx * t, cy = segment.a.y + aby * t, cz = segment.a.z + abz * t;
        const dx = point.x - cx, dy = point.y - cy, dz = point.z - cz;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (distance < segment.radius && distance > 1e-5) {
          const push = segment.radius / distance;
          point.set(cx + dx * push, cy + dy * push, cz + dz * push);
          moved = true;
        }
      }
      if (point.y < 0.03) { point.y = 0.03; moved = true; }
      if (moved) {
        // Contacts carry the cloth along instead of injecting energy.
        previous[offset] += (point.x - positions[offset]) * 0.8;
        previous[offset + 1] += (point.y - positions[offset + 1]) * 0.8;
        previous[offset + 2] += (point.z - positions[offset + 2]) * 0.8;
        point.toArray(positions, offset);
      }
    }
  }

  function update({ dt = 1 / 60, time = 0, velocity = { x: 0, z: 0 } } = {}) {
    if (disposed) return;
    readFrame();
    if (!Number.isFinite(dt) || dt > 0.2 || rootPosition.distanceToSquared(lastRoot) > 1) { reset(); return; }
    if (dt <= 0) return;
    dt = Math.min(dt, 0.05);
    // Fixed steps: a slowed-down frame (hit stop) must not turn the solver's
    // corrections into speeds once time runs normally again.
    const h = 1 / 120;
    accumulator = Math.min(accumulator + dt, 0.1);
    const steps = Math.floor(accumulator / h);
    accumulator -= steps * h;
    if (!steps) return;
    const speed = Math.min(7, Math.hypot(velocity.x || 0, velocity.z || 0));
    // Relative airflow pushes the tails back; it gusts slightly with the stride.
    wind.set(-(velocity.x || 0), 0, -(velocity.z || 0)).multiplyScalar(1.4 + speed * 0.3);
    gust.copy(wind).normalize();
    // Tailoring gives way to the airflow of a sprint, so the tails can fly.
    const hold = 1 / (1 + 0.08 * speed * speed);
    const damping = Math.exp(-2.4 * h);
    for (let step = 0; step < steps; step++) {
      const timeScale = 1;
      // The waist and the tailored shape move smoothly across sub-steps.
      const fraction = (step + 1) / steps;
      for (let i = 0; i < COUNT * 3; i++) goal[i] = lastTargets[i] + (targets[i] - lastTargets[i]) * fraction;
      for (let i = COLUMNS; i < COUNT; i++) {
        const offset = i * 3, row = Math.floor(i / COLUMNS), t = row / (ROWS - 1);
        const x = positions[offset], y = positions[offset + 1], z = positions[offset + 2];
        const spring = memory[row] * hold * facing[i % COLUMNS];
        const flutter = Math.sin(time * (3.1 + speed * 0.5) + (i % COLUMNS) * 0.5 + t * 3) * speed * 0.6 * t;
        const ax = (wind.x + gust.x * flutter) * t + (goal[offset] - x) * spring;
        const ay = -5.9 + (goal[offset + 1] - y) * spring;
        const az = (wind.z + gust.z * flutter) * t + (goal[offset + 2] - z) * spring;
        positions[offset] += (x - previous[offset]) * damping * timeScale + ax * h * h;
        positions[offset + 1] += (y - previous[offset + 1]) * damping * timeScale + ay * h * h;
        positions[offset + 2] += (z - previous[offset + 2]) * damping * timeScale + az * h * h;
        previous[offset] = x; previous[offset + 1] = y; previous[offset + 2] = z;
      }
      for (let i = 0; i < COLUMNS * 3; i++) positions[i] = goal[i];
      for (let iteration = 0; iteration < 5; iteration++) { solve(); collide(); }
      previousStep = h;
    }
    lastTargets.set(targets);
    lastRoot.copy(rootPosition);
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  function dispose() {
    disposed = true;
    mesh.removeFromParent();
    geometry.dispose();
    material.dispose();
  }

  reset();
  return { mesh, update, reset, dispose, rows: ROWS, columns: COLUMNS };
}
