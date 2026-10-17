import * as THREE from 'three';

/**
 * Verlet ragdoll. Every limb is a rigid triangle of particles; neighbouring
 * limbs share the particle at their joint, which acts as a ball joint, and
 * soft range constraints keep joints within plausible angles. Particles can
 * be kinematic — placed by the animated pose every frame, keeping their
 * velocity — or simulated. Severing a joint gives the child side its own copy
 * of the shared particle, so a limb comes free with the velocity it had.
 * Simulated particles fall, collide with the floor and with other limbs.
 * A body drives its mesh from the frame of its three particles.
 */
const STEP = 1 / 120;
// Contact pushes up to this size (m) become velocity as usual, which keeps
// resting contacts calm; the excess of a deep overlap is removed without
// adding speed, so freshly cut, overlapping parts are not launched.
const SLIP = 0.002;

export class Ragdoll {
  constructor({ gravity = -11, damping = 0.996, friction = 0.18, bounce = 0.15 } = {}) {
    Object.assign(this, { gravity, damping, friction, bounce });
    this.particles = [];
    this.bodies = [];
    this.constraints = [];
    this.adjacent = new Set();
    this.frameMatrix = new THREE.Matrix4();
    // Muscles: callbacks run every step after integration (an active ragdoll).
    this.drivers = [];
  }
  addParticle({ position, radius = 0.05, mass = 1, name = '' }) {
    const particle = { name, position: position.clone(), previous: position.clone(), radius, inverseMass: 1 / mass, kinematic: true, bodies: [] };
    this.particles.push(particle);
    return this.particles.length - 1;
  }
  addBody({ name, indices, object = null }) {
    const body = { name, indices: [...indices], object, offset: new THREE.Matrix4(), dynamic: false, index: this.bodies.length };
    this.bodies.push(body);
    for (const index of indices) this.particles[index].bodies.push(body);
    // Rigid: every pair of the body's particles keeps its distance.
    for (let i = 0; i < indices.length; i++) {
      for (let j = i + 1; j < indices.length; j++) this.addConstraint(indices[i], indices[j], { body });
    }
    return body;
  }
  addConstraint(a, b, { body = null, min, max, tag = null } = {}) {
    const length = this.particles[a].position.distanceTo(this.particles[b].position);
    this.constraints.push({ a, b, min: min ?? length, max: max ?? length, body, tag });
  }
  /** Joint range: the two particles stay between min and max apart. */
  addLimit(a, b, min, max = Infinity, tag = null) { this.addConstraint(a, b, { min, max, tag }); }
  connect(bodyA, bodyB) { this.adjacent.add(`${bodyA.index}:${bodyB.index}`); this.adjacent.add(`${bodyB.index}:${bodyA.index}`); }

  frame(body, out = this.frameMatrix) {
    const [p0, p1, p2] = body.indices.map(index => this.particles[index].position);
    const x = new THREE.Vector3().subVectors(p1, p0).normalize();
    const z = new THREE.Vector3().subVectors(p2, p0).cross(x).normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    return out.makeBasis(x, y, z).setPosition(p0);
  }
  /** Records how the body's mesh sits in its particle frame. */
  bind(body, objectWorldMatrix) {
    body.offset.copy(this.frame(body, new THREE.Matrix4()).invert().multiply(objectWorldMatrix));
  }
  objectMatrix(body, out) { return out.multiplyMatrices(this.frame(body, new THREE.Matrix4()), body.offset); }

  /** Places a kinematic particle; its last position becomes the previous one. */
  place(index, position, dt) {
    const particle = this.particles[index];
    particle.previous.copy(particle.position);
    particle.position.copy(position);
    particle.placedOver = dt;
  }
  release(bodies) {
    for (const body of bodies) body.dynamic = true;
    for (const body of bodies) {
      for (const index of body.indices) {
        const particle = this.particles[index];
        if (!particle.kinematic || !particle.bodies.every(owner => owner.dynamic)) continue;
        particle.kinematic = false;
        // The pose moved it over a whole frame; Verlet steps are shorter.
        const ratio = particle.placedOver > 0 ? Math.min(1, (1 / 120) / particle.placedOver) : 0;
        particle.previous.lerpVectors(particle.position, particle.previous, ratio);
      }
    }
  }
  /** Splits the joint particle so the given bodies get their own copy. */
  sever(index, childBodies, tag = null) {
    const original = this.particles[index];
    const copy = { ...original, position: original.position.clone(), previous: original.previous.clone(), bodies: [] };
    this.particles.push(copy);
    const copyIndex = this.particles.length - 1;
    const children = new Set(childBodies);
    for (const body of childBodies) {
      if (!body.indices.includes(index)) continue;
      body.indices = body.indices.map(i => (i === index ? copyIndex : i));
      copy.bodies.push(body);
    }
    original.bodies = original.bodies.filter(body => !children.has(body));
    for (const constraint of this.constraints) {
      if (constraint.body && children.has(constraint.body)) {
        if (constraint.a === index) constraint.a = copyIndex;
        if (constraint.b === index) constraint.b = copyIndex;
      }
    }
    if (tag) this.constraints = this.constraints.filter(constraint => constraint.tag !== tag);
    // The two sides stay 'adjacent': their overlapping joint ends must not
    // shove each other apart the instant they are cut.
    return copyIndex;
  }
  /** Adds a velocity (m/s) to the given particles. */
  push(indices, velocity, step = 1 / 120) {
    for (const index of indices) {
      const particle = this.particles[index];
      if (!particle.kinematic) particle.previous.addScaledVector(velocity, -step);
    }
  }
  velocity(index, out = new THREE.Vector3(), step = 1 / 120) {
    const particle = this.particles[index];
    return out.subVectors(particle.position, particle.previous).divideScalar(step);
  }

  /**
   * Fixed 1/120 s steps from an accumulator. Variable steps would read the
   * position corrections of a slowed-down frame (a hit stop) as huge speeds.
   */
  step(dt) {
    this.accumulator = Math.min((this.accumulator ?? 0) + Math.max(0, dt), 0.1);
    while (this.accumulator >= STEP) {
      this.substep(STEP);
      this.accumulator -= STEP;
    }
  }
  substep(h) {
    const scale = 1;
    for (const particle of this.particles) {
      if (particle.kinematic) continue;
      const { position, previous } = particle;
      const vx = (position.x - previous.x) * this.damping * scale;
      const vy = (position.y - previous.y) * this.damping * scale;
      const vz = (position.z - previous.z) * this.damping * scale;
      previous.copy(position);
      position.x += vx; position.y += vy + this.gravity * h * h; position.z += vz;
    }
    for (const driver of this.drivers) driver(h);
    for (let iteration = 0; iteration < 10; iteration++) {
      for (const constraint of this.constraints) this.solve(constraint);
      this.collideFloor();
      if (iteration % 3 === 2) this.collideBodies();
    }
  }
  solve({ a, b, min, max }) {
    const pa = this.particles[a], pb = this.particles[b];
    const wa = pa.kinematic ? 0 : pa.inverseMass, wb = pb.kinematic ? 0 : pb.inverseMass;
    if (wa + wb === 0) return;
    const dx = pb.position.x - pa.position.x, dy = pb.position.y - pa.position.y, dz = pb.position.z - pa.position.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance < 1e-6) return;
    const target = distance < min ? min : distance > max ? max : distance;
    if (target === distance) return;
    const k = (distance - target) / distance / (wa + wb);
    pa.position.x += dx * k * wa; pa.position.y += dy * k * wa; pa.position.z += dz * k * wa;
    pb.position.x -= dx * k * wb; pb.position.y -= dy * k * wb; pb.position.z -= dz * k * wb;
  }
  collideFloor() {
    for (const particle of this.particles) {
      if (particle.kinematic || particle.position.y >= particle.radius) continue;
      const { position, previous } = particle;
      position.y = particle.radius;
      // Contact friction and a little bounce.
      previous.x = position.x - (position.x - previous.x) * (1 - this.friction);
      previous.z = position.z - (position.z - previous.z) * (1 - this.friction);
      // Only a particle moving into the floor bounces; one already rising keeps its speed.
      if (previous.y > position.y) previous.y = position.y + (position.y - previous.y) * this.bounce;
    }
  }
  collideBodies() {
    const list = this.particles;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (a.kinematic && b.kinematic) continue;
        const reach = a.radius + b.radius;
        const dx = b.position.x - a.position.x, dy = b.position.y - a.position.y, dz = b.position.z - a.position.z;
        const squared = dx * dx + dy * dy + dz * dz;
        if (squared >= reach * reach || squared < 1e-10) continue;
        if (this.related(a, b)) continue;
        const distance = Math.sqrt(squared);
        const wa = a.kinematic ? 0 : a.inverseMass, wb = b.kinematic ? 0 : b.inverseMass;
        const k = (distance - reach) / distance / (wa + wb) * 0.5;
        for (const [particle, scale] of [[a, k * wa], [b, -k * wb]]) {
          const push = Math.abs(scale) * distance, still = push > SLIP ? 1 - SLIP / push : 0;
          particle.position.x += dx * scale; particle.position.y += dy * scale; particle.position.z += dz * scale;
          particle.previous.x += dx * scale * still; particle.previous.y += dy * scale * still; particle.previous.z += dz * scale * still;
        }
      }
    }
  }
  related(a, b) {
    for (const bodyA of a.bodies) {
      for (const bodyB of b.bodies) if (bodyA === bodyB || this.adjacent.has(`${bodyA.index}:${bodyB.index}`)) return true;
    }
    return false;
  }
}
