import * as THREE from 'three';
import { lineGlowTexture } from './kit.js';

/**
 * The blade's marks on the room. Wherever the lit blade goes into a case, a
 * wall, a barrel or the floor, the line where it meets the surface melts: a
 * molten trail is drawn along the surface as the blade moves — white-hot,
 * then orange, then red, dimming out over about five seconds — and the cut
 * (a black groove, heat-tinted lips) stays there for good (the oldest are
 * recycled after a few thousand).
 *
 * Each frame cut(base, tip, time) clips the blade against every obstacle (a
 * barrel as a cylinder) and the floor: the points where it enters and leaves
 * a surface, joined to where they were the frame before on the same face,
 * are the strokes. update(dt) cools the trails. Contacts are reported back
 * (sparks and sizzle are the game's business).
 */
export function createSaberScars(scene, { lab = null, floor = 0, bounds = null, limits = {} } = {}) {
  const { scars: scarMax = 3000, glows: glowMax = 700 } = limits;
  const quad = new THREE.PlaneGeometry(1, 1);
  // A cut reads on dark steel as a black groove with heat-tinted lips.
  const scarMesh = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({
    map: scarTexture(), transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  }), scarMax);
  scarMesh.name = 'Saber cuts';
  const glowMesh = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({
    map: lineGlowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  }), glowMax);
  glowMesh.name = 'Molten saber trails';
  glowMesh.setColorAt(0, new THREE.Color());
  for (const mesh of [scarMesh, glowMesh]) { mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 2; scene.add(mesh); }
  let nextScar = 0, nextGlow = 0;
  const glows = Array.from({ length: glowMax }, () => ({ age: Infinity, matrix: new THREE.Matrix4() }));

  const matrix = new THREE.Matrix4(), across = new THREE.Vector3(), along = new THREE.Vector3(), centre = new THREE.Vector3(), color = new THREE.Color();
  /** A stroke from a to b on a surface of normal `normal`. */
  function stroke(a, b, normal, time) {
    along.subVectors(b, a);
    let length = along.length();
    if (length < 1e-4) { along.crossVectors(normal, Math.abs(normal.y) < 0.9 ? UP : X).normalize(); length = 0; }
    else along.divideScalar(length);
    across.crossVectors(along, normal).normalize();
    centre.addVectors(a, b).multiplyScalar(0.5).addScaledVector(normal, 0.005);
    // The cut: thin and dark, a little longer than the stroke so strokes join.
    matrix.makeBasis(across.clone().multiplyScalar(0.07), along.clone().multiplyScalar(length + 0.04), normal).setPosition(centre);
    scarMesh.setMatrixAt(nextScar, matrix);
    nextScar = (nextScar + 1) % scarMax;
    scarMesh.count = Math.min(scarMax, scarMesh.count + 1);
    scarMesh.instanceMatrix.needsUpdate = true;
    // The molten trail over it, wider and soft, cooling from now.
    const glow = glows[nextGlow];
    glow.age = 0;
    glow.matrix.makeBasis(across.clone().multiplyScalar(0.13), along.clone().multiplyScalar(length + 0.1), normal).setPosition(centre.addScaledVector(normal, 0.002));
    glowMesh.setMatrixAt(nextGlow, glow.matrix);
    nextGlow = (nextGlow + 1) % glowMax;
    glowMesh.count = Math.min(glowMax, glowMesh.count + 1);
    glowMesh.instanceMatrix.needsUpdate = true;
  }

  // Where each contact was last frame: key → point.
  let previous = new Map(), current = new Map();
  const contacts = [];
  const a = new THREE.Vector3(), d = new THREE.Vector3();
  function touch(key, point, normal, time) {
    const before = previous.get(key);
    current.set(key, point.clone());
    if (before && before.distanceTo(point) < 0.5) stroke(before, point, normal, time);
    else stroke(point, point, normal, time);
    contacts.push({ point: point.clone(), normal: normal.clone(), fresh: !before });
  }
  /**
   * The lit blade from base to tip this frame: marks where it goes into
   * things; the floor only when `floor` (a strike, not the blade held low
   * while walking). Returns the contacts.
   */
  function cut(base, tip, time = 0, { floor: onFloor = true } = {}) {
    contacts.length = 0;
    current = new Map();
    a.copy(base);
    d.subVectors(tip, base);
    for (const [index, box] of (lab?.obstacles ?? []).entries()) {
      if (box.kind === 'rail') continue;
      if (box.kind === 'barrel') { barrel(index, box, time); continue; }
      // Slab clip of the blade against the box: where it enters and leaves.
      let enter = 0, exit = 1, enterAxis = -1, enterSign = 0, exitAxis = -1, exitSign = 0, inside = true;
      for (let axis = 0; axis < 3; axis++) {
        const o = a.getComponent(axis), v = d.getComponent(axis), lo = box.min.getComponent(axis), hi = box.max.getComponent(axis);
        if (Math.abs(v) < 1e-9) { if (o < lo || o > hi) { inside = false; break; } continue; }
        let t0 = (lo - o) / v, t1 = (hi - o) / v, s0 = -1, s1 = 1;
        if (t0 > t1) { [t0, t1] = [t1, t0]; s0 = 1; s1 = -1; }
        if (t0 > enter) { enter = t0; enterAxis = axis; enterSign = s0; }
        if (t1 < exit) { exit = t1; exitAxis = axis; exitSign = s1; }
        if (enter > exit) { inside = false; break; }
      }
      if (!inside) continue;
      if (enterAxis >= 0 && enter > 0) touch(`${index}:in:${enterAxis}${enterSign}`, a.clone().addScaledVector(d, enter), new THREE.Vector3().setComponent(enterAxis, enterSign), time);
      if (exitAxis >= 0 && exit < 1) touch(`${index}:out:${exitAxis}${exitSign}`, a.clone().addScaledVector(d, exit), new THREE.Vector3().setComponent(exitAxis, exitSign), time);
    }
    // The floor.
    if (onFloor && (a.y - floor) * (a.y + d.y - floor) < 0) {
      const t = (a.y - floor) / -d.y, point = a.clone().addScaledVector(d, t);
      if (!bounds || (point.x > bounds.minX && point.x < bounds.maxX && point.z > bounds.minZ && point.z < bounds.maxZ)) touch('floor', point, UP, time);
    }
    previous = current;
    return contacts;
  }
  /** A barrel is round: the blade meets its curved side (or its lid). */
  function barrel(index, box, time) {
    const r = (box.max.x - box.min.x) / 2, cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const ox = a.x - cx, oz = a.z - cz, qa = d.x * d.x + d.z * d.z, qb = 2 * (ox * d.x + oz * d.z), qc = ox * ox + oz * oz - r * r;
    const hits = [];
    if (qa > 1e-9) {
      const disc = qb * qb - 4 * qa * qc;
      if (disc >= 0) for (const t of [(-qb - Math.sqrt(disc)) / (2 * qa), (-qb + Math.sqrt(disc)) / (2 * qa)]) {
        if (t <= 0 || t >= 1) continue;
        const p = a.clone().addScaledVector(d, t);
        if (p.y < box.min.y || p.y > box.max.y) continue;
        hits.push([t, p, new THREE.Vector3(p.x - cx, 0, p.z - cz).normalize()]);
      }
    }
    // Through the lid.
    if (Math.abs(d.y) > 1e-9) {
      const t = (box.max.y - a.y) / d.y, p = a.clone().addScaledVector(d, t);
      if (t > 0 && t < 1 && (p.x - cx) ** 2 + (p.z - cz) ** 2 < r * r) hits.push([t, p, UP.clone()]);
    }
    hits.forEach(([, p, n], k) => touch(`${index}:barrel:${k}`, p, n, time));
  }

  function update(dt) {
    let live = false;
    for (let i = 0; i < glowMesh.count; i++) {
      const glow = glows[i];
      if (glow.age === Infinity) continue;
      glow.age += dt;
      // White-hot, orange, red, out.
      const t = glow.age;
      if (t > 5) { glow.age = Infinity; glowMesh.setColorAt(i, color.setRGB(0, 0, 0)); live = true; continue; }
      if (t < 0.12) color.setRGB(3.2, 2.0, 1.1).lerp(HOT, t / 0.12);
      else if (t < 1.1) color.copy(HOT).lerp(RED_HOT, (t - 0.12) / 0.98);
      else color.copy(RED_HOT).multiplyScalar((1 - THREE.MathUtils.smoothstep(t, 1.1, 5)) ** 1.3);
      glowMesh.setColorAt(i, color);
      live = true;
    }
    if (live && glowMesh.instanceColor) glowMesh.instanceColor.needsUpdate = true;
  }
  function clear() {
    scarMesh.count = glowMesh.count = 0;
    nextScar = nextGlow = 0;
    for (const glow of glows) glow.age = Infinity;
    previous = new Map();
  }
  return {
    cut, update, clear, contacts,
    get scars() { return scarMesh.count; },
    get glowing() { return glows.filter(glow => glow.age < 5).length; },
    meshes: { scars: scarMesh, glows: glowMesh },
  };
}

const UP = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);

let scar = null;
/** Across the cut: a black groove, lips of heat-tinted steel (bronze to blue-grey), soft edges; ends fade. */
function scarTexture() {
  if (scar) return scar;
  const w = 32, h = 32, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const across = Math.abs((x + 0.5) / w * 2 - 1), along = (y + 0.5) / h;
    const ends = THREE.MathUtils.smoothstep(along, 0, 0.12) * THREE.MathUtils.smoothstep(1 - along, 0, 0.12);
    const groove = across < 0.28, lip = across < 0.7;
    const rgb = groove ? [6, 5, 5] : lip ? [Math.round(128 - across * 70), Math.round(92 - across * 36), Math.round(62 + across * 14)] : [0, 0, 0];
    const alpha = groove ? 245 : lip ? Math.round(175 * (1 - (across - 0.28) / 0.42)) : 0;
    data.set([...rgb, Math.round(alpha * ends)], (y * w + x) * 4);
  }
  scar = new THREE.DataTexture(data, w, h);
  scar.colorSpace = THREE.SRGBColorSpace;
  scar.magFilter = scar.minFilter = THREE.LinearFilter;
  scar.needsUpdate = true;
  return scar;
}
const HOT = new THREE.Color(2.6, 0.75, 0.12), RED_HOT = new THREE.Color(0.8, 0.06, 0.012);
