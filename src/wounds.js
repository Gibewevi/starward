import * as THREE from 'three';
import { FEEL, pick } from './feel.js';
import { stainUniforms, STAIN_LIGHT } from './stain-light.js';

/**
 * Wounds on the hero: where a bolt went in (a charred black core in a ring
 * of red), where a blast tore him (red spattered over the side that faced
 * it). Each is a small cluster of specks stuck to the part of him nearest
 * the hit, so it goes where he goes as he falls. Drawn like the red drops —
 * round, unlit, red-black in the dark — they stay until the next try.
 *
 * strike(bones, point, facing, kind): a wound on the part nearest `point`,
 * on the side `facing` looks out of. riddle(bones, facing, count): wounds
 * over the side of him a blast came from. spill(at): once he lies still, a
 * dark pool spreading out from under him over a few seconds (update(dt)
 * grows it). clear() for the next try.
 */
const BODY = { Hips: 0.14, Spine1: 0.14, Spine2: 0.15, Neck: 0.06, Head: 0.11, LeftArm: 0.06, LeftForeArm: 0.05, RightArm: 0.06, RightForeArm: 0.05, LeftUpLeg: 0.08, LeftLeg: 0.06, RightUpLeg: 0.08, RightLeg: 0.06 };

export function createWounds({ random = Math.random } = {}) {
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: stainUniforms,
    vertexShader: /* glsl */`
      ${STAIN_LIGHT}
      attribute vec4 tint; attribute float size; varying vec4 vTint;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vTint = vec4(tint.rgb * stainLight(world.xyz), tint.a);
        gl_Position = projectionMatrix * viewMatrix * world;
        gl_PointSize = size;
      }`,
    fragmentShader: /* glsl */`
      varying vec4 vTint;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c) * 4.0;
        if (d > 1.0) discard;
        gl_FragColor = vec4(vTint.rgb * (1.1 - d * 0.3), vTint.a);
      }`,
  });
  const wounds = [], pools = [];
  // The pool: an uneven disc on the floor, darker at its heart, its edge soft.
  const poolMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { ...stainUniforms, tint: { value: new THREE.Color(0.36, 0.014, 0.011) } },
    vertexShader: /* glsl */`
      ${STAIN_LIGHT}
      attribute float rim; varying float vRim; varying vec3 vLight;
      void main() {
        vRim = rim;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vLight = stainLight(world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 tint; varying float vRim; varying vec3 vLight;
      void main() { gl_FragColor = vec4(tint * (0.75 + 0.35 * vRim) * vLight, 0.92 * smoothstep(1.0, 0.82, vRim)); }`,
  });
  const at = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(), point = new THREE.Vector3();

  /** A cluster of specks on `bone` round `place` (world), spread across the surface `facing` looks out of. */
  function add(bone, place, facing, kind) {
    const W = FEEL.death.wound[kind];
    const count = Math.round(pick(W.specks, random));
    const positions = new Float32Array(count * 3), tints = new Float32Array(count * 4), sizes = new Float32Array(count);
    side.set(0, 1, 0).cross(facing);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    up.crossVectors(facing, side).normalize();
    bone.updateWorldMatrix(true, false);
    for (let i = 0; i < count; i++) {
      // The core first (charred, for a bolt), red round it; a little run downwards.
      const core = i < count * W.char, reach = W.spread * (core ? 0.35 : 0.5 + random() * 0.8), turn = random() * Math.PI * 2;
      point.copy(place).addScaledVector(side, Math.cos(turn) * reach).addScaledVector(up, Math.sin(turn) * reach);
      if (!core && random() < 0.3) point.y -= W.spread * random() * 1.5;
      bone.worldToLocal(point).toArray(positions, i * 3);
      const shade = 0.75 + random() * 0.35;
      tints.set(core ? [0.05, 0.018, 0.012, 1] : [0.58 * shade, 0.028 * shade, 0.02 * shade, 1], i * 4);
      sizes[i] = pick(W.size, random) * (core ? 0.85 : 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('tint', new THREE.BufferAttribute(tints, 4));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    const specks = new THREE.Points(geometry, material);
    specks.name = `Wound (${kind})`;
    specks.frustumCulled = false;
    specks.renderOrder = 2;
    bone.add(specks);
    wounds.push(specks);
    return specks;
  }
  /** On the part of him nearest `point`, on its surface towards `facing`. */
  function strike(bones, hit, facing, kind) {
    let best = null, bestDistance = Infinity;
    for (const name of Object.keys(BODY)) {
      const bone = bones[name];
      if (!bone) continue;
      const distance = bone.getWorldPosition(at).distanceTo(hit);
      if (distance < bestDistance) { bestDistance = distance; best = name; }
    }
    if (!best) return null;
    return add(bones[best], bones[best].getWorldPosition(at).addScaledVector(facing, BODY[best]).clone(), facing, kind);
  }
  /** Torn by a blast: wounds here and there over the side of him that faced it. */
  function riddle(bones, facing, count) {
    const names = Object.keys(BODY).filter(name => bones[name]), towards = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const name = names[Math.floor(random() * names.length)];
      towards.copy(facing).add(side.set(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(1.2)).normalize();
      add(bones[name], bones[name].getWorldPosition(at).addScaledVector(towards, BODY[name]).clone(), towards.clone(), 'blast');
    }
  }
  /** Under him, where he lies still: the pool starts and spreads. */
  function spill(where) {
    const P = FEEL.death.pool, sides = 28;
    const positions = new Float32Array((sides + 1) * 3), rims = new Float32Array(sides + 1), index = [];
    // Its edge: a few lobes, never a circle.
    const lobes = [random() * 6, random() * 6, random() * 6];
    for (let i = 0; i < sides; i++) {
      const turn = i / sides * Math.PI * 2;
      const r = 1 + 0.16 * Math.sin(turn * 2 + lobes[0]) + 0.1 * Math.sin(turn * 3 + lobes[1]) + 0.07 * Math.sin(turn * 5 + lobes[2]);
      positions.set([Math.cos(turn) * r, 0, Math.sin(turn) * r], (i + 1) * 3);
      rims[i + 1] = 1;
      index.push(0, (i + 1) % sides + 1, i + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('rim', new THREE.BufferAttribute(rims, 1));
    geometry.setIndex(index);
    const mesh = new THREE.Mesh(geometry, poolMaterial);
    mesh.name = 'Pool';
    mesh.position.set(where.x, 0.005, where.z);
    mesh.rotation.y = random() * Math.PI * 2;
    mesh.scale.setScalar(1e-3);
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    mesh.userData = { age: 0, size: pick(P.size, random), duration: pick(P.spread, random), stretch: 0.75 + random() * 0.4 };
    poolParent.add(mesh);
    pools.push(mesh);
    return mesh;
  }
  let poolParent = null;
  /** Each frame: the pools spread, fast then slower and slower. */
  function update(dt) {
    for (const mesh of pools) {
      const data = mesh.userData;
      data.age += dt;
      const grown = 1 - (1 - Math.min(1, data.age / data.duration)) ** 2.4;
      mesh.scale.set(data.size * grown, 1, data.size * grown * data.stretch);
    }
  }
  function clear() {
    for (const specks of wounds) { specks.removeFromParent(); specks.geometry.dispose(); }
    wounds.length = 0;
    for (const mesh of pools) { mesh.removeFromParent(); mesh.geometry.dispose(); }
    pools.length = 0;
  }
  return {
    strike, riddle, spill, update, clear,
    /** Where the pools go (the scene). */
    set scene(value) { poolParent = value; },
    get count() { return wounds.length; }, get pools() { return pools.length; }, wounds,
  };
}
