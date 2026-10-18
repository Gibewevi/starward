import * as THREE from 'three';
import { ease } from './tween.js';

/**
 * Blaster bolts: long red streaks of light with a white-hot core, flying
 * straight and fast enough to sting, slow enough to see and to deflect. A
 * muzzle flash marks each shot; two red lights ride with the bolts and wash
 * over whatever they pass. A bolt that meets a crate, a barrel or the floor
 * bursts in sparks and leaves a scorch that glows, then cools.
 *
 * fire(from, direction) launches one; update(dt, interact) moves them all:
 * interact(bolt, a, b) is asked first about the stretch a → b (the blade,
 * the hero, the troopers) and answers 'deflected', 'spent' or nothing; the
 * crates and the floor come next. update returns what happened this frame.
 */
const UP = new THREE.Vector3(0, 1, 0);
const LENGTH = 0.85;

export function createBlasters(scene, { effects = null, lab = null, random = Math.random } = {}) {
  const coreGeometry = new THREE.CylinderGeometry(0.016, 0.016, LENGTH, 6, 1);
  const glowGeometry = new THREE.CylinderGeometry(0.042, 0.042, LENGTH + 0.08, 8, 1);
  // White-hot core, deep red sheath (brighter red turns orange under the ACES tone mapping).
  const coreColor = new THREE.Color(3, 1.1, 1), glowColor = new THREE.Color(0.75, 0.004, 0.004);
  const pool = Array.from({ length: 48 }, () => {
    const group = new THREE.Group();
    group.name = 'Blaster bolt';
    const core = new THREE.Mesh(coreGeometry, new THREE.MeshBasicMaterial({ color: coreColor, toneMapped: false }));
    const glow = new THREE.Mesh(glowGeometry, new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    // The streak trails behind its head.
    core.position.y = glow.position.y = -LENGTH / 2;
    group.add(glow, core);
    group.visible = false;
    scene.add(group);
    return { group, core, glow, live: false, position: new THREE.Vector3(), velocity: new THREE.Vector3(), age: 0, life: 0, owner: null, deflected: false, stretch: 0 };
  });
  const lights = [0, 1].map(() => {
    const light = new THREE.PointLight(0xff2a1a, 0, 3, 1.6);
    scene.add(light);
    return light;
  });
  // Muzzle flashes: a hot star that blooms and is gone.
  const flashTexture = (() => {
    const n = 32, data = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const dx = (x + 0.5) / n * 2 - 1, dy = (y + 0.5) / n * 2 - 1, d = Math.min(1, Math.hypot(dx, dy));
        const star = Math.max(0, 1 - Math.min(Math.abs(dx), Math.abs(dy)) * 9) * (1 - d);
        data.set([255, 255, 255, Math.round(Math.min(1, (1 - d) ** 2.4 + star) * 255)], (y * n + x) * 4);
      }
    }
    const texture = new THREE.DataTexture(data, n, n);
    texture.needsUpdate = true;
    return texture;
  })();
  const muzzles = Array.from({ length: 8 }, () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    sprite.name = 'Muzzle flash';
    sprite.visible = false;
    scene.add(sprite);
    return { sprite, age: Infinity };
  });
  let nextMuzzle = 0;
  // Scorches on crates and on the floor.
  const scorchGeometry = new THREE.CircleGeometry(0.06, 8);
  const scorches = Array.from({ length: 36 }, () => {
    const mesh = new THREE.Mesh(scorchGeometry, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    mesh.name = 'Bolt scorch';
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, age: Infinity };
  });
  let nextScorch = 0;
  const live = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), direction = new THREE.Vector3(), normal = new THREE.Vector3();
  const muzzleHot = new THREE.Color(3, 2, 1.9), muzzleRed = new THREE.Color(0.8, 0.01, 0.01), lightRed = new THREE.Color(1, 0.06, 0.04);

  function fire(from, aim, { owner = null, speed = 12 } = {}) {
    const bolt = pool.find(entry => !entry.live) ?? live[0];
    if (bolt.live) remove(bolt);
    Object.assign(bolt, { live: true, age: 0, life: 3, owner, deflected: false, stretch: 0 });
    bolt.position.copy(from);
    bolt.velocity.copy(aim).normalize().multiplyScalar(speed);
    bolt.core.material.color.copy(coreColor);
    bolt.glow.material.color.copy(glowColor);
    bolt.group.visible = true;
    place(bolt);
    live.push(bolt);
    const muzzle = muzzles[nextMuzzle];
    nextMuzzle = (nextMuzzle + 1) % muzzles.length;
    muzzle.age = 0;
    muzzle.sprite.position.copy(from);
    muzzle.sprite.material.rotation = random() * Math.PI;
    muzzle.sprite.visible = true;
    return bolt;
  }
  /** Sent back by the blade from `at`, along `aim`. */
  function deflect(bolt, at, aim, speed) {
    bolt.position.copy(at);
    bolt.velocity.copy(aim).normalize().multiplyScalar(speed);
    Object.assign(bolt, { deflected: true, owner: 'hero', age: 0, life: 2.5, stretch: 0 });
    // White-hot for an instant as it leaves the blade.
    bolt.core.material.color.setRGB(4, 3.2, 3);
    place(bolt);
  }
  function remove(bolt) {
    bolt.live = false;
    bolt.group.visible = false;
    const index = live.indexOf(bolt);
    if (index >= 0) live.splice(index, 1);
  }
  function place(bolt) {
    bolt.group.position.copy(bolt.position);
    direction.copy(bolt.velocity).normalize();
    bolt.group.quaternion.setFromUnitVectors(UP, direction);
    // Fresh out of the muzzle the streak grows to its length.
    bolt.group.scale.set(1, Math.min(1, 0.15 + bolt.stretch), 1);
  }
  function scorch(at, facing) {
    const entry = scorches[nextScorch];
    nextScorch = (nextScorch + 1) % scorches.length;
    entry.age = 0;
    entry.mesh.position.copy(at).addScaledVector(facing, 0.004);
    entry.mesh.quaternion.setFromUnitVectors(normal.set(0, 0, 1), facing);
    entry.mesh.scale.setScalar(0.7 + random() * 0.6);
    entry.mesh.material.opacity = 1;
    entry.mesh.visible = true;
    effects?.glow(entry.mesh.material, 2.2);
  }
  function burst(at, facing, along) {
    effects?.sparks(at, facing.clone().addScaledVector(along, -0.3).normalize(), along, { count: 14 + Math.round(random() * 16), speed: 2.6 });
    effects?.flash(at, 0.7, { color: lightRed });
    effects?.burst(at, { normal: facing, power: 0.35, tint: 'red' });
    scorch(at, facing);
  }

  function update(dt, interact = null) {
    const events = [];
    for (const bolt of [...live]) {
      bolt.age += dt;
      bolt.stretch += dt * 9;
      if (bolt.age > bolt.life) { remove(bolt); continue; }
      a.copy(bolt.position);
      b.copy(bolt.position).addScaledVector(bolt.velocity, dt);
      const answer = interact?.(bolt, a, b);
      if (answer === 'spent') { remove(bolt); continue; }
      if (answer === 'deflected') { place(bolt); events.push({ type: 'deflected', bolt, point: bolt.position.clone() }); continue; }
      // Crates and barrels, then the floor.
      const hit = lab?.segmentHit(a, b);
      let t = hit ? hit.t : Infinity, facing = hit?.normal ?? null;
      if (b.y < 0 && a.y >= 0) {
        const floor = a.y / Math.max(1e-6, a.y - b.y);
        if (floor < t) { t = floor; facing = UP.clone(); }
      }
      if (t <= 1) {
        const at = a.clone().lerp(b, t);
        burst(at, facing, direction.copy(bolt.velocity).normalize());
        events.push({ type: 'impact', point: at, bolt });
        remove(bolt);
        continue;
      }
      bolt.position.copy(b);
      if (bolt.core.material.color.r > coreColor.r) bolt.core.material.color.lerp(coreColor, 1 - Math.exp(-10 * dt));
      place(bolt);
      if (Math.abs(bolt.position.x) > 60 || Math.abs(bolt.position.z) > 60 || bolt.position.y > 20) remove(bolt);
    }
    // The two lights follow the two youngest bolts.
    const youngest = [...live].sort((p, q) => p.age - q.age);
    lights.forEach((light, index) => {
      const bolt = youngest[index];
      light.intensity = bolt ? 2.2 : 0;
      if (bolt) light.position.copy(bolt.position);
    });
    for (const muzzle of muzzles) {
      if (!muzzle.sprite.visible) continue;
      muzzle.age += dt;
      const p = Math.min(1, muzzle.age / 0.07);
      muzzle.sprite.scale.setScalar(0.12 + 0.2 * ease.outCubic(p));
      muzzle.sprite.material.color.copy(muzzleHot).lerp(muzzleRed, p);
      muzzle.sprite.material.opacity = 1 - p;
      if (p >= 1) muzzle.sprite.visible = false;
    }
    for (const entry of scorches) {
      if (!entry.mesh.visible) continue;
      entry.age += dt;
      if (entry.age > 9) entry.mesh.material.opacity = Math.max(0, 1 - (entry.age - 9) / 3);
      if (entry.age > 12) entry.mesh.visible = false;
    }
    return events;
  }
  function clear() {
    for (const bolt of [...live]) remove(bolt);
    for (const entry of scorches) entry.mesh.visible = false;
    for (const light of lights) light.intensity = 0;
  }
  return { fire, deflect, remove, update, clear, live, burst };
}

/** Closest points between segments p1q1 and p2q2 (Ericson): { s, t, c1, c2, distance }. */
export function closestSegments(p1, q1, p2, q2) {
  const d1 = new THREE.Vector3().subVectors(q1, p1), d2 = new THREE.Vector3().subVectors(q2, p2), r = new THREE.Vector3().subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) { s = t = 0; }
  else if (a <= 1e-9) { s = 0; t = THREE.MathUtils.clamp(f / e, 0, 1); }
  else {
    const c = d1.dot(r);
    if (e <= 1e-9) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
    else {
      const b = d1.dot(d2), denominator = a * e - b * b;
      s = denominator > 1e-9 ? THREE.MathUtils.clamp((b * f - c * e) / denominator, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
    }
  }
  const c1 = p1.clone().addScaledVector(d1, s), c2 = p2.clone().addScaledVector(d2, t);
  return { s, t, c1, c2, distance: c1.distanceTo(c2) };
}
