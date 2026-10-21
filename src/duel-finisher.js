import * as THREE from 'three';
import { Ragdoll } from './ragdoll.js';
import { createHeroRagdoll } from './hero-ragdoll.js';
import { FEEL } from './feel.js';

const UP = new THREE.Vector3(0, 1, 0);
// The bone a cut takes off (with all below it); through the waist the whole posed body splits in two.
const SEVER = { head: 'Head', arm: 'RightArm' };
// How light a severed piece is thrown (the trooper's head ≈ 0.9): it flies further, spins faster.
const LIGHTNESS = { head: 0.9, arm: 0.75, torso: 0.3 };

/**
 * The duel's finishing cut, as the troopers' (stormtrooper.js cut()/launch()).
 * A head or an arm comes off: the piece is the posed mesh frozen, thrown by the
 * blade's sweep — out along it in an arc, spinning about the cut — and tumbles
 * on the deck. The body left behind stays the living skinned body on a limp
 * ragdoll (hero-ragdoll.js): it collapses where it stood, the coat with it,
 * the arms jerk and it twitches for a few seconds. Both sides of the cut glow
 * and smoulder, the struck parts flash white, blood is thrown with the blade
 * and drips from the stump. Through the waist ('torso') the posed body splits
 * in two rigid halves. The hilt drops apart and clatters, its blade retracting.
 *
 * direction: the blade's sweep at the cut, m/s (a unit vector reads as a brisk cut).
 * update(dt, real = dt): real seconds time the white flash — a few frames, even through a hit stop or slow motion.
 */
export function createFinisher(scene, fighter, kind = 'head', direction = new THREE.Vector3(1, 0, 0), effects = null, { random = Math.random } = {}) {
  const { character, coat, saber } = fighter;
  const body = character.body, bones = character.rig.bones;
  character.root.updateMatrixWorld(true);
  body.skeleton.update();
  coat.mesh.updateWorldMatrix(true, false);
  saber.group.updateWorldMatrix(true, true);
  const pick = ([a, b]) => a + (b - a) * random();
  const temp = new THREE.Vector3(), temp2 = new THREE.Vector3();

  // The sweep: how fast, and which way, the blade went through.
  const sweep = direction.clone();
  if (sweep.lengthSq() < 1e-6) sweep.set(1, 0, 0);
  if (sweep.length() < 2) sweep.setLength(7);
  const speed = sweep.length(), along = sweep.clone().normalize();

  const severed = SEVER[kind] ?? null;
  const cutBone = severed ? bones[severed] : bones.Hips;
  const cutAt = cutBone.getWorldPosition(new THREE.Vector3());
  if (!severed) cutAt.y += 0.045;
  const cutNormal = severed ? cutAt.clone().sub(cutBone.parent.getWorldPosition(new THREE.Vector3())).normalize() : UP.clone();
  const hipsAt = bones.Hips.getWorldPosition(new THREE.Vector3());

  // The posed mesh, and how much of each vertex belongs to the severed part.
  const cutOff = new Set();
  if (severed) cutBone.traverse(object => { if (object.isBone) cutOff.add(object.name); });
  const source = body.geometry, positions = source.getAttribute('position'), colors = source.getAttribute('color');
  const skinIndex = source.getAttribute('skinIndex'), skinWeight = source.getAttribute('skinWeight');
  const indices = source.getIndex(), count = indices ? indices.count : positions.count;
  const posed = new Float32Array(positions.count * 3), share = new Float32Array(positions.count);
  for (let vertex = 0; vertex < positions.count; vertex++) {
    temp.fromBufferAttribute(positions, vertex);
    body.applyBoneTransform(vertex, temp);
    body.localToWorld(temp);
    temp.toArray(posed, vertex * 3);
    for (let slot = 0; slot < 4; slot++)
      if (cutOff.has(body.skeleton.bones[skinIndex.getComponent(vertex, slot)]?.name)) share[vertex] += skinWeight.getComponent(vertex, slot);
  }
  const points = [[], []], shades = [[], []];
  for (let index = 0; index < count; index += 3) {
    const face = [0, 1, 2].map(offset => indices ? indices.getX(index + offset) : index + offset);
    const detached = severed
      ? face.reduce((sum, vertex) => sum + share[vertex], 0) / 3 > 0.5
      : face.reduce((sum, vertex) => sum + posed[vertex * 3 + 1], 0) / 3 > cutAt.y;
    const part = detached ? 1 : 0;
    for (const vertex of face) {
      const offset = vertex * 3;
      points[part].push(posed[offset], posed[offset + 1], posed[offset + 2]);
      shades[part].push(colors.getX(vertex), colors.getY(vertex), colors.getZ(vertex));
    }
  }

  const ragdoll = new Ragdoll({ gravity: -11, damping: 0.994, friction: 0.26, bounce: 0.19 });
  const allocations = [], fragments = [], flashing = [];
  // The frozen parts take the body's colours on their own material: they flash white as the blade goes through.
  const pieceMaterial = body.material.clone();
  allocations.push(pieceMaterial);
  const flash = material => flashing.push({ material, base: material.emissive.clone() });
  flash(pieceMaterial);
  // Cut off, only the piece is frozen; through the waist, both halves.
  for (const part of severed ? [1] : [0, 1]) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points[part], 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(shades[part], 3));
    geometry.computeBoundingBox();
    const centre = geometry.boundingBox.isEmpty() ? cutAt.clone() : geometry.boundingBox.getCenter(new THREE.Vector3());
    geometry.translate(-centre.x, -centre.y, -centre.z);
    geometry.computeVertexNormals();
    const root = new THREE.Group();
    root.name = part ? `Jedi severed ${kind}` : 'Jedi fallen body';
    root.position.copy(centre);
    const mesh = new THREE.Mesh(geometry, pieceMaterial);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    scene.add(root);
    allocations.push(geometry);
    fragments.push({ root, centre, part, physics: null });
  }
  const piece = fragments.find(fragment => fragment.part === 1), lower = fragments.find(fragment => fragment.part === 0);

  function attachClone(original, fragment) {
    original.updateWorldMatrix(true, true);
    const clone = original.clone(true), destination = fragment.root;
    destination.updateWorldMatrix(true, false);
    destination.matrixWorld.clone().invert().multiply(original.matrixWorld).decompose(clone.position, clone.quaternion, clone.scale);
    // Its own materials, so that it flashes alone.
    clone.traverse(child => {
      if (!child.isMesh) return;
      child.material = child.material.clone();
      allocations.push(child.material);
      if (child.material.emissive) flash(child.material);
    });
    destination.add(clone);
    return clone;
  }
  const head = bones.Head.children.find(child => child.name === 'Jedi head');
  if (head && (kind === 'head' || kind === 'torso')) attachClone(head, piece);
  if (lower) {
    // Through the waist the coat's drape solidifies with the fallen hips.
    const cloth = coat.mesh.geometry.clone();
    cloth.applyMatrix4(coat.mesh.matrixWorld);
    cloth.translate(-lower.centre.x, -lower.centre.y, -lower.centre.z);
    const clothMesh = new THREE.Mesh(cloth, coat.mesh.material);
    clothMesh.castShadow = clothMesh.receiveShadow = true;
    lower.root.add(clothMesh);
    allocations.push(cloth);
    for (const accessory of bones.Hips.children) if (accessory.isMesh) attachClone(accessory, lower);
  }

  // The hilt is a separate rigid piece: it leaves the hand and clatters on its own.
  const hiltBox = new THREE.Box3().makeEmpty();
  for (const mesh of saber.group.children) {
    if (!mesh.isMesh) continue; // The illuminated blade has no solid collision.
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    hiltBox.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
  }
  const weaponRoot = new THREE.Group();
  weaponRoot.name = 'Fallen lightsaber';
  weaponRoot.position.copy(hiltBox.getCenter(new THREE.Vector3()));
  scene.add(weaponRoot);
  weaponRoot.updateWorldMatrix(true, false);
  const fallenSaber = saber.group.clone(true);
  weaponRoot.matrixWorld.clone().invert().multiply(saber.group.matrixWorld)
    .decompose(fallenSaber.position, fallenSaber.quaternion, fallenSaber.scale);
  weaponRoot.add(fallenSaber);

  // Eight contact particles round each rigid piece keep it above the deck as it tumbles.
  function makeRigid(root, box, mass, radius) {
    const particleIds = [];
    for (const [x, y, z] of [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1], [0, 1, 0], [1, 1, 0], [0, 1, 1], [1, 1, 1]]) {
      const point = new THREE.Vector3(x ? box.max.x : box.min.x, y ? box.max.y : box.min.y, z ? box.max.z : box.min.z);
      particleIds.push(ragdoll.addParticle({ position: point, radius, mass }));
    }
    const physics = ragdoll.addBody({ name: root.name, indices: particleIds, object: root });
    ragdoll.bind(physics, root.matrixWorld);
    ragdoll.release([physics]);
    return physics;
  }
  for (const fragment of fragments) {
    fragment.root.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(fragment.root);
    fragment.physics = makeRigid(fragment.root, box, fragment.part ? kind === 'torso' ? 1.6 : 0.65 : 2.4, fragment.part ? 0.035 : 0.045);
  }
  const weaponPhysics = makeRigid(weaponRoot, hiltBox, 0.24, 0.022);

  // The cut: a dark section in a ring that glows, smoulders and drips — on the piece, and on the stump.
  const cutMaterial = new THREE.MeshBasicMaterial({ color: 0x100d10, side: THREE.DoubleSide });
  const radius = kind === 'head' ? 0.068 : kind === 'arm' ? 0.085 : 0.17;
  const bleeding = FEEL.severed.parts[kind === 'head' ? 'neck' : kind === 'arm' ? 'shoulder' : 'waist'];
  const caps = [], stumps = [];
  function addCap(parent, position, normal, name) {
    const cap = new THREE.Group();
    cap.name = name;
    cap.position.copy(position);
    cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    const disk = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.73, 16), cutMaterial);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x100d10, toneMapped: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.62, radius * 1.08, 16), ringMaterial);
    cap.add(disk, ring);
    parent.add(cap);
    allocations.push(disk.geometry, ring.geometry, ringMaterial);
    caps.push(cap);
    effects?.glow(ringMaterial, 4.5);
    effects?.smoulder(cap);
    effects?.drip(cap, undefined, bleeding);
    return cap;
  }
  for (const fragment of fragments) addCap(fragment.root, cutAt.clone().sub(fragment.centre), fragment.part ? cutNormal.clone().negate() : cutNormal, `Cut ${kind} ${fragment.part}`);

  // The body left behind: limp, on its ragdoll, the severed bone folded away under the stump's cap.
  let corpse = null;
  const emissive = body.material.emissive?.clone();
  if (severed) {
    corpse = createHeroRagdoll(character, { random });
    const push = new THREE.Vector3(along.x, 0, along.z).multiplyScalar(0.3 + random() * 0.35).add(temp.set(0, 0.25, 0));
    corpse.knock(push, { dead: true, severed, spin: 0.9 + random() * 1.3, twitch: kind === 'head' ? 3.8 : 2.4 });
    stumps.push(addCap(cutBone.parent, cutBone.position, cutBone.position.clone().normalize(), `Stump ${kind}`));
    cutBone.scale.setScalar(1e-4);
    if (emissive) flash(body.material);
  } else {
    body.visible = false;
    character.root.visible = false;
    coat.mesh.visible = false;
  }

  // Thrown with the blade's momentum, as the troopers' limbs: along the sweep and up into an arc, spinning about the cut.
  const vary = (amount = 0.15) => 1 + (random() - 0.5) * 2 * amount;
  function launch({ physics }, lightness) {
    // About its own centre of mass: the spin alone must not carry it anywhere.
    const centre = physics.indices.reduce((sum, index) => sum.add(ragdoll.particles[index].position), new THREE.Vector3()).divideScalar(physics.indices.length);
    const throwSpeed = THREE.MathUtils.clamp(speed * 0.3, 0.5, 2.6) * lightness * vary();
    const velocity = new THREE.Vector3(along.x, 0, along.z).multiplyScalar(throwSpeed);
    const away = centre.clone().sub(hipsAt).setY(0);
    if (away.lengthSq() > 1e-6) velocity.addScaledVector(away.normalize(), 0.5 * lightness);
    if (velocity.length() < 0.8 * lightness) velocity.setLength(0.8 * lightness);
    velocity.applyAxisAngle(UP, (random() - 0.5) * 0.4);
    velocity.y += THREE.MathUtils.clamp(2.6 + along.y * 1.6, 1.2, 4.2) * (0.55 + 0.45 * lightness) * THREE.MathUtils.clamp(0.6 + speed * 0.08, 0.7, 1.2) * vary();
    const lever = cutAt.clone().sub(centre), spin = new THREE.Vector3();
    if (lever.lengthSq() > 1e-4) {
      spin.crossVectors(lever, along).multiplyScalar(THREE.MathUtils.clamp(speed * 0.45, 1.5, 6) * vary(0.25) / lever.lengthSq());
      const rate = THREE.MathUtils.clamp(spin.length(), 3, 15) * (0.6 + 0.4 * lightness);
      if (spin.lengthSq() > 1e-8) spin.setLength(rate);
      spin.addScaledVector(lever.normalize(), (random() - 0.5) * 6);
    }
    for (const index of physics.indices) ragdoll.push([index], temp.crossVectors(spin, temp2.subVectors(ragdoll.particles[index].position, centre)).add(velocity));
  }
  launch(piece, LIGHTNESS[kind] ?? 0.6);
  if (lower) ragdoll.push(lower.physics.indices, along.clone().setY(0).multiplyScalar(-0.35).add(temp.set(0, 0.55, 0)));
  ragdoll.push(weaponPhysics.indices, along.clone().setY(0).normalize().multiplyScalar(2.4 + Math.min(speed, 12) * 0.1).add(temp.set(0, 2.6, 0)));
  ragdoll.push([weaponPhysics.indices[0]], temp.set(0, 1.2, 1.4));
  ragdoll.push([weaponPhysics.indices[1]], temp.set(0, -0.4, -1.2));

  // The blade going through: a flash, a burst, fewer sparks than a plain cut, and red drops thrown with it — as many as the part is big.
  if (effects) {
    const spray = pick(FEEL.sparks.cut) * THREE.MathUtils.clamp(0.5 + speed / 12, 0.6, 1.2) * FEEL.severed.sparks;
    effects.flash(cutAt, Math.min(1.2, speed / 5) + 0.8, { color: new THREE.Color(1, 0.55, 0.42) });
    effects.burst(cutAt, { normal: cutNormal, power: 0.5 + Math.min(speed, 10) / 10 });
    effects.sparks(cutAt, along, cutNormal, { count: Math.round(spray), speed: 2 + Math.min(speed, 8) * 0.5 });
    effects.bleed(cutAt, along, cutNormal, { speed: 2 + Math.min(speed, 8) * 0.5, amount: bleeding });
  }

  saber.group.visible = false;
  for (const light of saber.lights) light.intensity = 0;
  let age = 0, shown = 0;
  return {
    kind, pieces: fragments.map(fragment => fragment.root), caps, corpse,
    update(dt, real = dt) {
      age += dt;
      shown += real;
      ragdoll.step(dt);
      for (const { root, physics } of fragments) {
        ragdoll.objectMatrix(physics, root.matrix);
        root.matrixAutoUpdate = false;
        root.matrixWorldNeedsUpdate = true;
      }
      ragdoll.objectMatrix(weaponPhysics, weaponRoot.matrix);
      weaponRoot.matrixAutoUpdate = false;
      weaponRoot.matrixWorldNeedsUpdate = true;
      const fallenBlade = fallenSaber.children.find(child => child.isGroup);
      if (fallenBlade && age > 0.45) fallenBlade.scale.y = Math.max(0.0001, 1 - (age - 0.45) * 2.8);
      if (corpse) {
        corpse.update(dt, age);
        coat.update({ dt, time: age, velocity: corpse.velocity });
      }
      // The struck parts flash white for a few frames, then fade back.
      const white = Math.max(0, 1 - shown / 0.11) ** 2;
      for (const { material, base } of flashing) material.emissive.setRGB(base.r + white * 1.3, base.g + white * 1.22, base.b + white * 1.15);
    },
    dispose() {
      for (const { root } of fragments) scene.remove(root);
      for (const stump of stumps) stump.parent?.remove(stump);
      scene.remove(weaponRoot);
      for (const resource of allocations) resource.dispose();
      cutMaterial.dispose();
      corpse?.stop();
      cutBone.scale.setScalar(1);
      if (emissive) body.material.emissive.copy(emissive);
      body.visible = true;
      character.root.visible = true;
      coat.mesh.visible = true;
      saber.group.visible = true;
    },
  };
}
