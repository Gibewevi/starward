import * as THREE from 'three';

/**
 * Warnings the player can read before the danger arrives.
 *
 * In the room: a trooper about to open fire shows it — a red glint swells at
 * his muzzle for the moment he takes aim, pulsing faster as the trigger
 * comes, gone with the first shot.
 *
 * At the edges of the screen: a small chevron points to each trooper in the
 * fight who stands out of view (red, brighter and pulsing while he takes aim
 * at the hero), and to a live grenade out of view (amber).
 */
function glintTexture() {
  const n = 32, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n * 2 - 1, dy = (y + 0.5) / n * 2 - 1, d = Math.min(1, Math.hypot(dx, dy));
      // A soft core and four thin rays.
      const rays = Math.max(0, 1 - Math.min(Math.abs(dx), Math.abs(dy)) * 14) * (1 - d) ** 1.5;
      data.set([255, 255, 255, Math.round(Math.min(1, (1 - d) ** 3 + rays) * 255)], (y * n + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, n, n);
  texture.needsUpdate = true;
  return texture;
}

export function createTelegraph(scene, { slots = 8, overlay = null } = {}) {
  const map = glintTexture();
  const glints = Array.from({ length: slots }, () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, color: new THREE.Color(1.6, 0.08, 0.05), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    sprite.visible = false;
    sprite.renderOrder = 5;
    sprite.name = 'Aim glint';
    scene.add(sprite);
    return sprite;
  });
  let clock = 0;
  /** aiming: [{ position (the muzzle), amount 0 → 1 (the shot comes at 1) }]. */
  function update(dt, aiming) {
    clock += dt;
    glints.forEach((sprite, index) => {
      const entry = aiming[index];
      if (!entry) { sprite.visible = false; return; }
      const k = THREE.MathUtils.clamp(entry.amount, 0, 1);
      // It swells as he settles his aim, and flickers quicker as the trigger comes.
      const pulse = 0.78 + 0.22 * Math.sin(clock * (14 + 26 * k));
      sprite.position.copy(entry.position);
      sprite.scale.setScalar((0.16 + 0.5 * k ** 0.7) * pulse);
      sprite.material.opacity = Math.min(1, 0.25 + k) * pulse;
      sprite.material.rotation = clock * 0.8;
      sprite.visible = true;
    });
  }

  // The chevrons at the screen's edges (HTML, over the canvas).
  const arrows = [];
  const point = new THREE.Vector3();
  function arrow(index) {
    if (!arrows[index]) {
      const element = document.createElement('div');
      element.className = 'threat';
      overlay.appendChild(element);
      arrows[index] = element;
    }
    return arrows[index];
  }
  /** threats: [{ position, kind: 'shooter' | 'aiming' | 'grenade' }] — only those out of view get a chevron. */
  function edges(camera, threats, width, height) {
    if (!overlay) return;
    let used = 0;
    const margin = 26, inset = 0.035;
    for (const threat of threats) {
      point.copy(threat.position).project(camera);
      // In view (with a little room): no need.
      if (Math.abs(point.x) < 1 - inset && Math.abs(point.y) < 1 - inset) continue;
      const element = arrow(used++);
      // From the centre of the screen towards him, clamped to a frame inside the edges.
      const dx = point.x * width / 2, dy = -point.y * height / 2;
      const scale = Math.min((width / 2 - margin) / Math.max(Math.abs(dx), 1e-3), (height / 2 - margin) / Math.max(Math.abs(dy), 1e-3));
      const x = width / 2 + dx * scale, y = height / 2 + dy * scale;
      element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${Math.atan2(dy, dx).toFixed(3)}rad)`;
      element.dataset.kind = threat.kind;
      element.hidden = false;
    }
    for (let i = used; i < arrows.length; i++) arrows[i].hidden = true;
  }
  function clear() {
    for (const sprite of glints) sprite.visible = false;
    for (const element of arrows) element.hidden = true;
  }
  return { update, edges, clear, glints };
}
