// Converts Mixamo motion capture stored in a glTF binary into compact clips for
// the Jedi rig (src/mocap-clips.js). Source used by the prototype, from the
// three.js examples: https://threejs.org/examples/models/gltf/Xbot.glb
//   node scripts/extract-mocap.mjs path/to/Xbot.glb
// convert() also accepts other Mixamo rigs; pass facing: Math.PI for a -Z one.
// Each clip is resampled at 30 fps. Rotations are expressed for a +Z facing
// T-pose whose rest rotations are all identity: the Jedi skeleton uses the same
// convention, so different bone lengths can replay the captured motion.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

export const MOCAP_BONES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
];
const PARENTS = {
  Spine: 'Hips', Spine1: 'Spine', Spine2: 'Spine1', Neck: 'Spine2', Head: 'Neck',
  LeftShoulder: 'Spine2', LeftArm: 'LeftShoulder', LeftForeArm: 'LeftArm', LeftHand: 'LeftForeArm',
  RightShoulder: 'Spine2', RightArm: 'RightShoulder', RightForeArm: 'RightArm', RightHand: 'RightForeArm',
  LeftUpLeg: 'Hips', LeftLeg: 'LeftUpLeg', LeftFoot: 'LeftLeg', LeftToeBase: 'LeftFoot',
  RightUpLeg: 'Hips', RightLeg: 'RightUpLeg', RightFoot: 'RightLeg', RightToeBase: 'RightFoot',
};
const FPS = 30;

function readGlb(file) {
  const buffer = readFileSync(file);
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  const bin = buffer.subarray(20 + jsonLength + 8);
  const sizes = { SCALAR: 1, VEC3: 3, VEC4: 4 };
  const accessor = index => {
    const info = json.accessors[index], view = json.bufferViews[info.bufferView];
    const n = sizes[info.type], stride = view.byteStride || n * 4;
    const offset = (view.byteOffset || 0) + (info.byteOffset || 0);
    if (info.componentType !== 5126) throw new Error(`Unsupported accessor type ${info.componentType}`);
    const out = new Float32Array(info.count * n);
    for (let i = 0; i < info.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = bin.readFloatLE(offset + i * stride + k * 4);
    return out;
  };
  return { json, accessor };
}

function loadRig(file) {
  const { json, accessor } = readGlb(file);
  const nodes = json.nodes.map(node => {
    const object = new THREE.Object3D();
    object.name = node.name.replace('mixamorig:', '');
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
    object.userData.rest = [object.position.clone(), object.quaternion.clone(), object.scale.clone()];
    return object;
  });
  const root = new THREE.Object3D(), children = new Set();
  json.nodes.forEach((node, i) => (node.children || []).forEach(child => { nodes[i].add(nodes[child]); children.add(child); }));
  nodes.forEach((node, i) => { if (!children.has(i)) root.add(node); });
  const bones = Object.fromEntries(nodes.map(node => [node.name, node]));
  const clips = (json.animations || []).map(animation => ({
    name: animation.name,
    tracks: animation.channels.map(channel => {
      const sampler = animation.samplers[channel.sampler];
      return { node: nodes[channel.target.node], path: channel.target.path, times: accessor(sampler.input), values: accessor(sampler.output) };
    }),
  }));
  for (const clip of clips) clip.duration = Math.max(...clip.tracks.map(track => track.times.at(-1)));
  const a = new THREE.Quaternion(), b = new THREE.Quaternion();
  return {
    root, bones, clips,
    rest() {
      for (const node of nodes) { node.position.copy(node.userData.rest[0]); node.quaternion.copy(node.userData.rest[1]); node.scale.copy(node.userData.rest[2]); }
      root.updateMatrixWorld(true);
    },
    pose(clip, time) {
      this.rest();
      for (const { node, path, times, values } of clip.tracks) {
        if (path === 'scale') continue;
        let i = 0;
        while (i < times.length - 2 && times[i + 1] <= time) i++;
        const j = Math.min(i + 1, times.length - 1);
        const f = times[j] > times[i] ? THREE.MathUtils.clamp((time - times[i]) / (times[j] - times[i]), 0, 1) : 0;
        if (path === 'rotation') node.quaternion.copy(a.fromArray(values, i * 4)).slerp(b.fromArray(values, j * 4), f);
        else node.position.set(...[0, 1, 2].map(k => values[i * 3 + k] + (values[j * 3 + k] - values[i * 3 + k]) * f));
      }
      root.updateMatrixWorld(true);
    },
  };
}

function convert(rig, clip, { name, facing = 0, cycle = false }) {
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), facing);
  const unturn = turn.clone().invert();
  rig.rest();
  const restWorld = {}, restPosition = {};
  for (const bone of [...MOCAP_BONES, 'LeftToeBase', 'RightToeBase']) {
    restWorld[bone] = rig.bones[bone].getWorldQuaternion(new THREE.Quaternion());
    restPosition[bone] = rig.bones[bone].getWorldPosition(new THREE.Vector3()).applyQuaternion(turn);
  }
  const frames = Math.max(1, Math.round(clip.duration * FPS));
  const rotations = [], hips = [], ground = [], leftFoot = [], rightFoot = [];
  const delta = {}, world = new THREE.Quaternion(), local = new THREE.Quaternion(), p = new THREE.Vector3();
  for (let frame = 0; frame < frames; frame++) {
    rig.pose(clip, frame / FPS);
    const row = [];
    for (const bone of MOCAP_BONES) {
      rig.bones[bone].getWorldQuaternion(world);
      // World-space change from the source T-pose, turned to face +Z.
      delta[bone] = turn.clone().multiply(world.multiply(restWorld[bone].clone().invert())).multiply(unturn);
      local.copy(delta[bone]);
      if (PARENTS[bone]) local.premultiply(delta[PARENTS[bone]].clone().invert());
      row.push(local.x, local.y, local.z, local.w);
    }
    rotations.push(row);
    rig.bones.Hips.getWorldPosition(p).applyQuaternion(turn).sub(restPosition.Hips);
    hips.push([p.x, p.y, p.z]);
    const lift = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'].map(bone => rig.bones[bone].getWorldPosition(new THREE.Vector3()).applyQuaternion(turn).y - restPosition[bone].y);
    ground.push(Math.max(0, Math.min(...lift)));
    const hipsWorld = rig.bones.Hips.getWorldPosition(new THREE.Vector3()).applyQuaternion(turn);
    leftFoot.push(rig.bones.LeftFoot.getWorldPosition(new THREE.Vector3()).applyQuaternion(turn).sub(hipsWorld));
    rightFoot.push(rig.bones.RightFoot.getWorldPosition(new THREE.Vector3()).applyQuaternion(turn).sub(hipsWorld));
  }
  // Keep neighbouring quaternions in the same hemisphere for clean slerps.
  for (let frame = 1; frame < frames; frame++) {
    for (let k = 0; k < MOCAP_BONES.length * 4; k += 4) {
      const dot = [0, 1, 2, 3].reduce((sum, i) => sum + rotations[frame][k + i] * rotations[frame - 1][k + i], 0);
      if (dot < 0) for (let i = 0; i < 4; i++) rotations[frame][k + i] *= -1;
    }
  }
  let offset = 0, speed = 0;
  if (cycle) {
    // Phase zero is the left foot's forward-most reach, shared by every gait.
    offset = leftFoot.reduce((best, foot, frame) => foot.z > leftFoot[best].z ? frame : best, 0);
    // Captured ground speed: backwards travel of whichever foot supports the body.
    let travel = 0, time = 0;
    for (let frame = 0; frame < frames; frame++) {
      const next = (frame + 1) % frames;
      const planted = leftFoot[frame].y < rightFoot[frame].y ? leftFoot : rightFoot;
      const step = planted[frame].z - planted[next].z;
      if (step > 0 && ground[frame] < 0.02) { travel += step; time += 1 / FPS; }
    }
    speed = time ? travel / time : 0;
    const mean = hips.reduce((sum, h) => [sum[0] + h[0] / frames, sum[1], sum[2] + h[2] / frames], [0, 0, 0]);
    for (const h of hips) { h[0] -= mean[0]; h[2] -= mean[2]; }
  }
  const order = Array.from({ length: frames }, (_, i) => (i + offset) % frames);
  const round = value => Math.round(value * 10000) / 10000;
  return {
    name, fps: FPS, frames, loop: true, speed: round(speed),
    legLength: round(restPosition.LeftUpLeg.y - restPosition.LeftFoot.y),
    ankleHeight: round(restPosition.LeftFoot.y),
    rotations: order.map(frame => rotations[frame].map(round)),
    hips: order.map(frame => hips[frame].map(round)),
    ground: order.map(frame => round(ground[frame])),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [xbotFile] = process.argv.slice(2);
  if (!xbotFile) throw new Error('Usage: node scripts/extract-mocap.mjs Xbot.glb');
  const xbot = loadRig(xbotFile);
  const clip = (rig, name) => rig.clips.find(entry => entry.name === name);
  const clips = {
    idle: convert(xbot, clip(xbot, 'idle'), { name: 'idle' }),
    walk: convert(xbot, clip(xbot, 'walk'), { name: 'walk', cycle: true }),
    run: convert(xbot, clip(xbot, 'run'), { name: 'run', cycle: true }),
  };
  const source = `// Generated by scripts/extract-mocap.mjs — do not edit by hand.
// Motion capture: Mixamo animations distributed with the three.js examples
// (Xbot.glb). Local quaternions [x, y, z, w] per bone, in the
// order of MOCAP_BONES, relative to a +Z facing identity T-pose. Hip offsets
// and ground clearance are in source metres and are scaled to the rig at runtime.
export const MOCAP_BONES = ${JSON.stringify(MOCAP_BONES)};
export const MOCAP_CLIPS = ${JSON.stringify(clips)};
`;
  const target = fileURLToPath(new URL('../src/mocap-clips.js', import.meta.url));
  writeFileSync(target, source);
  for (const entry of Object.values(clips)) console.log(`${entry.name}: ${entry.frames} frames, ${entry.speed} m/s, leg ${entry.legLength} m`);
  console.log(`Wrote ${target} (${(source.length / 1024).toFixed(0)} kB)`);
}
