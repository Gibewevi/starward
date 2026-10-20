import * as THREE from 'three';

/**
 * Thermal detonators. Thrown on a ballistic arc, a grenade bounces on the
 * floor and off crates, rolls, and goes off when its fuse runs out. Before
 * it does, it warns: its red light blinks faster and faster (each blink a
 * beep, through onBeep), and a red circle on the floor shows the blast's
 * reach, a second ring closing in on it as the time runs out. The Force
 * can push it away.
 *
 * throw(from, target) launches one that lands about on the target;
 * update(dt) moves them and returns the blasts that happened.
 */
const GRAVITY = 9.8, RADIUS = 0.065;

export function createGrenades(scene, { lab = null, random = Math.random, reach = 3.4, onBeep = null, onBounce = null } = {}) {
  const glow = (() => {
    const n = 16, data = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const d = Math.min(1, Math.hypot((x + 0.5) / n * 2 - 1, (y + 0.5) / n * 2 - 1));
      data.set([255, 255, 255, Math.round((1 - d) ** 2 * 255)], (y * n + x) * 4);
    }
    const texture = new THREE.DataTexture(data, n, n);
    texture.needsUpdate = true;
    return texture;
  })();
  const body = new THREE.SphereGeometry(RADIUS, 10, 8);
  const band = new THREE.CylinderGeometry(RADIUS * 1.04, RADIUS * 1.04, 0.025, 12);
  const pool = Array.from({ length: 4 }, () => {
    const group = new THREE.Group();
    group.name = 'Grenade';
    const shell = new THREE.Mesh(body, new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.35, metalness: 0.8 }));
    shell.castShadow = true;
    const strip = new THREE.Mesh(band, new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.3, metalness: 0.9 }));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.01, 0.01), toneMapped: false }));
    lamp.position.set(0, RADIUS * 0.85, 0.025);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(0.9, 0.02, 0.02), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    halo.scale.setScalar(0.32);
    group.add(shell, strip, lamp, halo);
    group.visible = false;
    // Danger: the blast's reach on the floor, and a ring closing in with the fuse.
    const zone = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 56), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.85, 0.02, 0.02), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
    zone.rotation.x = -Math.PI / 2;
    zone.visible = false;
    const closing = zone.clone();
    closing.material = zone.material.clone();
    scene.add(group, zone, closing);
    return { group, lamp, halo, zone, closing, live: false, position: new THREE.Vector3(), velocity: new THREE.Vector3(), spin: new THREE.Vector3(), fuse: 0, time: 0, lit: false, rolling: false };
  });
  const temp = new THREE.Vector3(), axis = new THREE.Vector3(), turn = new THREE.Quaternion();

  /** A velocity that carries it from `from` to `target` in about `time` seconds. */
  function aim(from, target, time) {
    return new THREE.Vector3((target.x - from.x) / time, (target.y - from.y) / time + 0.5 * GRAVITY * time, (target.z - from.z) / time);
  }
  function launch(from, velocity, fuse) {
    const grenade = pool.find(entry => !entry.live) ?? pool[0];
    Object.assign(grenade, { live: true, fuse, time: 0, lit: false, rolling: false });
    grenade.position.copy(from);
    grenade.velocity.copy(velocity);
    grenade.spin.set(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(14);
    grenade.group.visible = grenade.zone.visible = grenade.closing.visible = true;
    grenade.group.position.copy(from);
    return grenade;
  }
  /** Thrown from `from` to land near `target`. */
  function throwAt(from, target, { fuse = 2.1 + random() * 0.4 } = {}) {
    const distance = Math.hypot(target.x - from.x, target.z - from.z);
    const time = THREE.MathUtils.clamp(distance / 6.5, 0.6, 1.15);
    return launch(from, aim(from, temp.copy(target).setY(RADIUS), time), fuse);
  }
  /** Dropped where it is (the thrower was knocked over mid-throw). */
  function drop(from, { fuse = 1.6 } = {}) {
    return launch(from, new THREE.Vector3((random() - 0.5) * 1.2, 0.5, (random() - 0.5) * 1.2), fuse);
  }
  /** The Force pushes grenades in a cone in front of `from`. */
  function push(from, direction, { range = 6, cone = 0.95, speed = 9 } = {}) {
    let pushed = 0;
    for (const grenade of pool) {
      if (!grenade.live) continue;
      const offset = temp.subVectors(grenade.position, from).setY(0), distance = offset.length();
      if (distance > range || (distance > 0.3 && offset.angleTo(direction) > cone)) continue;
      const falloff = 1 - 0.5 * distance / range;
      grenade.velocity.copy(offset.normalize().add(direction).normalize().multiplyScalar(speed * falloff)).setY(3.2 * falloff);
      grenade.rolling = false;
      pushed++;
    }
    return pushed;
  }

  function step(grenade, h) {
    const p = grenade.position, v = grenade.velocity;
    v.y -= GRAVITY * h;
    p.addScaledVector(v, h);
    // Floor: it bounces, then rolls to a stop.
    if (p.y < RADIUS) {
      p.y = RADIUS;
      if (v.y < -1.2) {
        onBounce?.(grenade, -v.y);
        v.y *= -0.38;
        v.x *= 0.72; v.z *= 0.72;
        grenade.spin.multiplyScalar(0.6).add(temp.set(v.z, 0, -v.x).multiplyScalar(1 / RADIUS * 0.4));
      } else {
        v.y = 0;
        grenade.rolling = true;
        const roll = Math.exp(-2.4 * h);
        v.x *= roll; v.z *= roll;
        grenade.spin.set(v.z, 0, -v.x).divideScalar(RADIUS);
      }
    }
    // Crates and barrels: it bounces off.
    if (lab) {
      for (const box of lab.obstacles) {
        const cx = Math.max(box.min.x, Math.min(p.x, box.max.x)), cy = Math.max(box.min.y, Math.min(p.y, box.max.y)), cz = Math.max(box.min.z, Math.min(p.z, box.max.z));
        const n = temp.set(p.x - cx, p.y - cy, p.z - cz), distance = n.length();
        if (distance >= RADIUS) continue;
        if (distance < 1e-6) n.set(0, 1, 0); else n.divideScalar(distance);
        p.addScaledVector(n, RADIUS - distance);
        const into = v.dot(n);
        if (into < 0) { if (into < -1.2) onBounce?.(grenade, -into); v.addScaledVector(n, -into * 1.45); v.multiplyScalar(0.8); }
        if (n.y > 0.7 && Math.abs(v.y) < 1.2) { v.y = Math.max(0, v.y); grenade.rolling = true; v.x *= Math.exp(-2.4 * h); v.z *= Math.exp(-2.4 * h); }
      }
    }
  }

  function update(dt) {
    const blasts = [];
    for (const grenade of pool) {
      if (!grenade.live) continue;
      for (let left = dt; left > 1e-6; left -= 1 / 240) step(grenade, Math.min(left, 1 / 240));
      grenade.group.position.copy(grenade.position);
      const angle = grenade.spin.length() * dt;
      if (angle > 1e-6) grenade.group.quaternion.premultiply(turn.setFromAxisAngle(axis.copy(grenade.spin).normalize(), angle));
      grenade.time += dt;
      // The countdown: blinking (and beeping) faster and faster.
      const left = grenade.fuse - grenade.time, progress = Math.min(1, grenade.time / grenade.fuse);
      const rate = 2.2 + 14 * progress ** 2.2;
      grenade.phase = (grenade.phase ?? 0) + rate * dt;
      const lit = grenade.phase % 1 < 0.45;
      if (lit && !grenade.lit) onBeep?.(grenade, progress);
      grenade.lit = lit;
      grenade.lamp.material.color.setRGB(lit ? 2.6 : 0.25, lit ? 0.1 : 0.01, lit ? 0.06 : 0.01);
      grenade.halo.visible = lit;
      grenade.halo.material.opacity = 0.8;
      for (const ring of [grenade.zone, grenade.closing]) ring.position.set(grenade.position.x, 0.02, grenade.position.z);
      grenade.zone.scale.setScalar(reach);
      grenade.zone.material.opacity = (lit ? 0.5 : 0.18) * Math.min(1, grenade.time / 0.25);
      grenade.closing.scale.setScalar(reach * (1 - progress) + 0.2);
      grenade.closing.material.opacity = 0.35 * Math.min(1, grenade.time / 0.25);
      if (left <= 0) {
        grenade.live = false;
        grenade.group.visible = grenade.zone.visible = grenade.closing.visible = false;
        blasts.push(grenade.position.clone().setY(0));
      }
    }
    return blasts;
  }
  function clear() {
    for (const grenade of pool) { grenade.live = false; grenade.group.visible = grenade.zone.visible = grenade.closing.visible = false; }
  }
  return {
    throwAt, drop, push, update, clear, pool, aim,
    get live() { return pool.filter(grenade => grenade.live); },
  };
}
