import * as THREE from 'three';

/**
 * Loose objects on the lab floor — small crates, metal plates, canisters,
 * pipes, odd components — and the dark fragments an explosion throws out.
 * Each is a small rigid body (a box): it flies and spins, lands on a corner
 * or an edge, bounces, tips over, slides and comes to rest; it knocks against
 * the crates and can land on them. Feet kick the small ones about. All of
 * them are drawn as instances: one draw call per kind.
 *
 * blast(at) throws everything nearby, the closer the harder; fragments(at)
 * adds burning chunks; kick(at, velocity) is a foot walking through.
 */
const KINDS = {
  crate: { size: [0.26, 0.24, 0.26], color: 0x2b3038, mass: 2.4 },
  plate: { size: [0.3, 0.024, 0.2], color: 0x474c55, mass: 0.7 },
  canister: { size: [0.1, 0.24, 0.1], color: 0x5a5f68, mass: 0.9, round: true },
  pipe: { size: [0.05, 0.05, 0.42], color: 0x4b5059, mass: 0.6, round: true },
  part: { size: [0.12, 0.07, 0.1], color: 0x3b4048, mass: 0.5 },
  chunk: { size: [0.15, 0.12, 0.14], color: 0x131519, mass: 0.8 },
};
const STEP = 1 / 120, GRAVITY = 9.8;
const CORNERS = [[-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1], [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]].map(c => new THREE.Vector3(...c));

export function createDebris(scene, { lab = null, random = Math.random, capacity = 70 } = {}) {
  const meshes = {}, bodies = [];
  for (const [name, kind] of Object.entries(KINDS)) {
    const [x, y, z] = kind.size;
    const geometry = name === 'chunk' ? new THREE.IcosahedronGeometry(0.59, 0)
      : kind.round ? new THREE.CylinderGeometry(0.5, 0.5, 1, 8) : new THREE.BoxGeometry(1, 1, 1);
    if (name === 'chunk') {
      // A torn, angular silhouette instead of an identical little cube.
      // The distortion is deterministic and does not consume the simulation RNG.
      const points = geometry.attributes.position;
      for (let i = 0; i < points.count; i++) {
        const x = points.getX(i), y = points.getY(i), z = points.getZ(i);
        const dent = 0.78 + 0.22 * Math.sin(x * 13.1 + y * 8.7 + z * 17.3) ** 2;
        points.setXYZ(i, x * dent, y * (0.82 + dent * 0.18), z * dent);
      }
      geometry.computeVertexNormals();
    }
    if (kind.round && name === 'pipe') geometry.rotateX(Math.PI / 2);
    // Fragments take their colour per instance: they cool from orange to black.
    const material = new THREE.MeshStandardMaterial({ color: name === 'chunk' ? 0xffffff : kind.color, roughness: name === 'chunk' ? 0.84 : 0.55, metalness: name === 'chunk' ? 0.12 : 0.5 });
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = `Debris ${name}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.count = 0;
    mesh.frustumCulled = false;
    scene.add(mesh);
    meshes[name] = { mesh, scale: new THREE.Vector3(x, y, z), list: [] };
  }
  // Burning fragments glow for a moment as they fly.
  const chunkGlow = new THREE.Color(), hot = new THREE.Color(1.8, 0.5, 0.08);

  function add(name, position, { quaternion = null, velocity = null, spin = null, life = Infinity, scale = null, temperature = null } = {}) {
    const kind = KINDS[name], entry = meshes[name];
    if (entry.list.length >= capacity) {
      // Recycle the oldest fragment of that kind.
      const old = entry.list.shift();
      bodies.splice(bodies.indexOf(old), 1);
    }
    const half = new THREE.Vector3(...kind.size).multiplyScalar(0.5 * (0.85 + random() * 0.3));
    if (scale) half.multiply(scale);
    const [a, b, c] = [half.x * 2, half.y * 2, half.z * 2];
    const mass = scale ? Math.max(0.06, kind.mass * scale.x * scale.y * scale.z) : kind.mass;
    const inertia = mass * (a * a + b * b + c * c) / 18;
    const body = {
      name, half, mass, invMass: 1 / mass, invInertia: 1 / inertia,
      position: position.clone(), velocity: velocity?.clone() ?? new THREE.Vector3(), angular: spin?.clone() ?? new THREE.Vector3(),
      quaternion: quaternion?.clone() ?? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI * 2),
      sleeping: !velocity, still: 0, age: 0, life, heat: name === 'chunk' ? (temperature ?? 1) : 0, radius: Math.min(half.x, half.y, half.z) * 1.1 + 0.02,
    };
    bodies.push(body);
    entry.list.push(body);
    return body;
  }

  /** Small objects strewn about the lab, mostly by the crates, never on the hero's start. */
  function scatter(count = 46) {
    const names = ['crate', 'plate', 'plate', 'canister', 'canister', 'pipe', 'part', 'part', 'part'];
    const boxes = lab?.obstacles.filter(box => box.min.y < 0.1 && box.kind !== 'wall' && box.kind !== 'rail') ?? [];
    for (let i = 0; i < count; i++) {
      const name = names[Math.floor(random() * names.length)];
      let at = null;
      for (let attempt = 0; attempt < 20 && !at; attempt++) {
        const near = boxes.length && random() < 0.7 ? boxes[Math.floor(random() * boxes.length)] : null;
        const point = near
          ? new THREE.Vector3(THREE.MathUtils.lerp(near.min.x - 0.6, near.max.x + 0.6, random()), 0, THREE.MathUtils.lerp(near.min.z - 0.6, near.max.z + 0.6, random()))
          : new THREE.Vector3((random() - 0.5) * 16 - 2, 0, (random() - 0.5) * 14 - 3);
        if (point.length() < 1.6) continue;
        if (lab && point.distanceTo(lab.pushOut(point.clone(), 0.22)) > 1e-3) continue;
        at = point;
      }
      if (!at) continue;
      const body = add(name, at);
      // Lying as it fell: a pipe or a canister may be on its side.
      if ((name === 'canister' && random() < 0.4) || name === 'pipe') body.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), name === 'pipe' ? 0 : Math.PI / 2));
      settle(body);
    }
    render();
  }
  /** Puts a body down on the floor, resting on its lowest corner. */
  function settle(body) {
    let lowest = Infinity;
    for (const corner of CORNERS) lowest = Math.min(lowest, temp.copy(corner).multiply(body.half).applyQuaternion(body.quaternion).y);
    body.position.y = -lowest + 0.001;
  }

  /** Everything near a blast is thrown: outwards and up, spinning, the closer the harder. */
  function blast(at, { radius = 5.5, strength = 1 } = {}) {
    for (const body of bodies) {
      const offset = temp.subVectors(body.position, at), distance = offset.length();
      if (distance > radius) continue;
      const falloff = (1 - distance / radius) ** 1.5 * strength;
      offset.y = Math.max(offset.y, 0) + 0.25 + random() * 0.5;
      offset.normalize();
      body.velocity.addScaledVector(offset, (6.5 + random() * 4.5) * falloff / Math.sqrt(body.mass));
      body.angular.add(temp2.set(random() - 0.5, random() - 0.5, random() - 0.5).normalize().multiplyScalar((14 + random() * 16) * falloff));
      body.sleeping = false;
      body.still = 0;
    }
  }
  /** Dark torn fragments fly mostly outwards, with a few short rising arcs. */
  function fragments(at, count = 14) {
    const lobeCount = Math.max(3, Math.min(6, Math.round(count / 4))), orientation = random() * Math.PI * 2;
    // Jittered sectors keep the impulse broad, including the near side of the
    // camera, without the perfectly equal spokes of a firework.
    const lobes = Array.from({ length: lobeCount }, (_, index) => ({
      theta: orientation + index / lobeCount * Math.PI * 2 + (random() - 0.5) * 0.35,
      rise: 0.12 + random() ** 1.4 * 0.28,
    }));
    for (let i = 0; i < count; i++) {
      const lobe = lobes[i % lobes.length];
      const theta = lobe.theta + (random() - 0.5) * 0.45, rise = Math.max(0.08, lobe.rise + (random() - 0.5) * 0.12);
      const large = i % 7 === 0, extent = large ? 1.65 + random() * 0.65 : 0.45 + random() ** 1.5 * 0.85;
      const speed = (large ? 3.8 : 4.4) + random() ** 1.2 * (large ? 3.5 : 5.5);
      const velocity = new THREE.Vector3(Math.cos(theta) * (1 - rise * 0.6), rise, Math.sin(theta) * (1 - rise * 0.6)).normalize().multiplyScalar(speed);
      const spin = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(30);
      const name = i % 4 === 3 ? 'part' : 'chunk';
      add(name, at.clone().add(temp.set((random() - 0.5) * 0.4, 0.22 + random() * 0.23, (random() - 0.5) * 0.4)), {
        velocity, spin, life: 12 + random() * 6,
        scale: new THREE.Vector3(extent * (0.7 + random() * 0.6), extent * (0.6 + random() * 0.7), extent * (0.8 + random() * 0.5)),
        temperature: random() < 0.22 ? 0.65 + random() * 0.25 : 0.04 + random() * 0.2,
        quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * 6, random() * 6, random() * 6)),
      });
    }
  }
  /** A foot (or a body) going through at `at` with `velocity` nudges what lies there. */
  function kick(at, velocity, radius = 0.32) {
    const speed = Math.hypot(velocity.x, velocity.z);
    if (speed < 0.6) return;
    for (const body of bodies) {
      if (body.mass > 1.5 || body.position.y > 0.4) continue;
      const dx = body.position.x - at.x, dz = body.position.z - at.z, distance = Math.hypot(dx, dz);
      if (distance > radius + body.radius) continue;
      body.velocity.x += (velocity.x * 0.8 + dx / Math.max(distance, 0.05) * 0.6) / body.mass;
      body.velocity.z += (velocity.z * 0.8 + dz / Math.max(distance, 0.05) * 0.6) / body.mass;
      body.velocity.y += 0.8 + speed * 0.2;
      body.angular.add(temp2.set(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(8));
      body.sleeping = false;
      body.still = 0;
    }
  }

  const temp = new THREE.Vector3(), temp2 = new THREE.Vector3(), r = new THREE.Vector3(), vc = new THREE.Vector3(), spinQ = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0), contacts = [];
  function substep(body, h) {
    body.velocity.y -= GRAVITY * h;
    body.velocity.multiplyScalar(Math.exp(-0.08 * h));
    body.angular.multiplyScalar(Math.exp(-0.4 * h));
    body.position.addScaledVector(body.velocity, h);
    const w = body.angular, angle = w.length() * h;
    if (angle > 1e-7) body.quaternion.premultiply(spinQ.setFromAxisAngle(temp.copy(w).normalize(), angle)).normalize();
    // The floor, at the box's corners: lands on an edge, tips over, slides.
    contacts.length = 0;
    let deepest = 0;
    for (const corner of CORNERS) {
      const point = temp.copy(corner).multiply(body.half).applyQuaternion(body.quaternion).add(body.position);
      if (point.y < 0) { contacts.push(point.clone()); deepest = Math.max(deepest, -point.y); }
    }
    if (contacts.length) {
      body.position.y += deepest;
      // Scraping along the floor wastes energy.
      body.velocity.x *= Math.exp(-1.6 * h); body.velocity.z *= Math.exp(-1.6 * h);
      body.angular.multiplyScalar(Math.exp(-2.5 * h));
      for (const point of contacts) {
        point.y += deepest;
        r.subVectors(point, body.position);
        vc.crossVectors(body.angular, r).add(body.velocity);
        const vn = vc.y;
        if (vn >= 0) continue;
        const rn = temp2.crossVectors(r, UP);
        const k = body.invMass + body.invInertia * rn.lengthSq();
        const bounce = vn < -1.4 ? 0.32 : 0;
        const j = -(1 + bounce) * vn / k / contacts.length;
        body.velocity.y += j * body.invMass;
        body.angular.addScaledVector(rn, j * body.invInertia);
        // Friction against the floor, at most proportional to the push.
        vc.y = 0;
        const slip = vc.length();
        if (slip > 1e-5) {
          const tangent = vc.divideScalar(slip);
          const rt = temp2.crossVectors(r, tangent);
          const kt = body.invMass + body.invInertia * rt.lengthSq();
          const jt = Math.min(slip / kt / contacts.length, 0.8 * j);
          body.velocity.addScaledVector(tangent, -jt * body.invMass);
          body.angular.addScaledVector(rt, -jt * body.invInertia);
        }
      }
      // Lying on two corners or more, it does not sink.
      if (contacts.length >= 2 && body.velocity.y < 0) body.velocity.y = 0;
    }
    // Crates and barriers: it hits their faces and can land on top.
    if (lab) {
      for (const box of lab.obstacles) {
        const p = body.position, radius = body.radius;
        const cx = Math.max(box.min.x, Math.min(p.x, box.max.x)), cy = Math.max(box.min.y, Math.min(p.y, box.max.y)), cz = Math.max(box.min.z, Math.min(p.z, box.max.z));
        const n = temp.set(p.x - cx, p.y - cy, p.z - cz), distance = n.length();
        if (distance >= radius) continue;
        if (distance < 1e-6) n.set(0, 1, 0); else n.divideScalar(distance);
        p.addScaledVector(n, radius - distance);
        const into = body.velocity.dot(n);
        if (into < 0) {
          body.velocity.addScaledVector(n, -into * 1.3);
          const tangent = temp2.copy(body.velocity).addScaledVector(n, -body.velocity.dot(n));
          body.velocity.addScaledVector(tangent, -0.25);
          body.angular.multiplyScalar(0.85);
        }
      }
    }
  }
  let accumulator = 0;
  function update(dt) {
    accumulator = Math.min(accumulator + Math.max(0, dt), 0.1);
    for (const body of bodies) {
      if (body.sleeping) continue;
      body.lastPosition ??= body.position.clone();
      body.lastQuaternion ??= body.quaternion.clone();
    }
    while (accumulator >= STEP) {
      for (const body of bodies) if (!body.sleeping) substep(body, STEP);
      accumulator -= STEP;
    }
    // Asleep once it has hardly moved for half a second (resting contacts jitter a little).
    for (const body of bodies) {
      if (body.sleeping || !(dt > 0)) continue;
      const moved = body.position.distanceTo(body.lastPosition) / dt, turned = body.quaternion.angleTo(body.lastQuaternion) / dt;
      body.still = moved < 0.06 && turned < 0.25 && body.position.y < 0.6 ? body.still + dt : 0;
      body.lastPosition.copy(body.position);
      body.lastQuaternion.copy(body.quaternion);
      if (body.still > 0.5) { body.sleeping = true; body.velocity.set(0, 0, 0); body.angular.set(0, 0, 0); body.lastPosition = body.lastQuaternion = undefined; }
    }
    for (const body of bodies) {
      body.age += dt;
      if (body.heat > 0) body.heat = Math.max(0, body.heat - dt * 0.5);
    }
    // Spent fragments sink away.
    for (let i = bodies.length - 1; i >= 0; i--) {
      const body = bodies[i];
      if (body.age < body.life + 1) continue;
      bodies.splice(i, 1);
      const list = meshes[body.name].list;
      list.splice(list.indexOf(body), 1);
    }
    render();
  }
  const matrix = new THREE.Matrix4(), scale = new THREE.Vector3(), color = new THREE.Color();
  function render() {
    for (const [name, entry] of Object.entries(meshes)) {
      entry.list.forEach((body, index) => {
        const fade = Number.isFinite(body.life) ? 1 - THREE.MathUtils.smoothstep(body.age, body.life, body.life + 1) : 1;
        scale.copy(body.half).multiplyScalar(2 * fade);
        matrix.compose(body.position, body.quaternion, scale);
        entry.mesh.setMatrixAt(index, matrix);
        if (name === 'chunk') entry.mesh.setColorAt(index, color.set(KINDS.chunk.color).lerp(chunkGlow.copy(hot), body.heat ** 2));
      });
      entry.mesh.count = entry.list.length;
      entry.mesh.instanceMatrix.needsUpdate = true;
      if (entry.mesh.instanceColor) entry.mesh.instanceColor.needsUpdate = true;
    }
  }
  function clear() {
    bodies.length = 0;
    accumulator = 0;
    for (const entry of Object.values(meshes)) entry.list.length = 0;
    render();
  }
  return {
    add, scatter, blast, fragments, kick, update, clear, bodies, meshes,
    get awake() { return bodies.filter(body => !body.sleeping).length; },
  };
}
