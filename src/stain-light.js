import * as THREE from 'three';
import { FEEL } from './feel.js';

/**
 * The light falling on the red stains — the drops (flying, lying, running
 * down a crate) and the footprints. They are drawn unlit in their own
 * colour, which is right in the lit room; in the dark they must go dark
 * too, a red-black, except where a lamp's beam or the blade's glow catches
 * them (in the blade's blue glow, red stays dark, as it would).
 *
 * One set of uniforms shared by every stain material: the room's light (the
 * power level, 1 → the stains as they are) and the lights near them (the
 * rifle lamps, their spills, the blade), each as it is this frame. The
 * shaders call stainLight(world position) for the colour to multiply theirs
 * by.
 */
const MAX = 12;
const slots = () => Array.from({ length: MAX }, () => new THREE.Vector4());

export const stainUniforms = {
  stainRoom: { value: 1 },
  stainFloor: { value: FEEL.blackout.stains.floor },
  stainScale: { value: 1 / FEEL.blackout.stains.full },
  stainA: { value: slots() }, // where the light is, how far it reaches (0: no limit)
  stainB: { value: slots() }, // where it points, the cosine of its edge (−2: all round)
  stainC: { value: slots() }, // its colour × intensity, the cosine where its edge starts to soften
  stainDecay: { value: new Float32Array(MAX) },
};

export const STAIN_LIGHT = /* glsl */`
  uniform float stainRoom; uniform float stainFloor; uniform float stainScale;
  uniform vec4 stainA[${MAX}]; uniform vec4 stainB[${MAX}]; uniform vec4 stainC[${MAX}]; uniform float stainDecay[${MAX}];
  vec3 stainLight(vec3 world) {
    vec3 sum = vec3(0.0);
    for (int i = 0; i < ${MAX}; i++) {
      vec3 to = world - stainA[i].xyz;
      float d = max(length(to), 1e-3);
      float reach = stainA[i].w > 0.0 ? pow(clamp(1.0 - pow(d / stainA[i].w, 4.0), 0.0, 1.0), 2.0) : 1.0;
      float cone = stainB[i].w < -1.5 ? 1.0 : smoothstep(stainB[i].w, stainC[i].w, dot(to / d, stainB[i].xyz));
      sum += stainC[i].rgb * reach * cone / max(pow(d, stainDecay[i]), 0.01);
    }
    // In the dark: a red-black floor, raised where a light falls; lit room: as they are.
    return mix(clamp(sum * stainScale, vec3(stainFloor), vec3(1.2)), vec3(1.0), stainRoom);
  }`;

const at = new THREE.Vector3(), aim = new THREE.Vector3();
/** Each frame: the room's light (0 → 1) and the lights that may fall on the stains. */
export function lightStains(room, lights) {
  const { stainA, stainB, stainC, stainDecay } = stainUniforms;
  stainUniforms.stainRoom.value = room;
  let i = 0;
  for (const light of lights) {
    if (i >= MAX) break;
    if (!(light.intensity > 0)) continue;
    light.getWorldPosition(at);
    stainA.value[i].set(at.x, at.y, at.z, light.distance);
    if (light.isSpotLight) {
      light.target.getWorldPosition(aim).sub(at).normalize();
      stainB.value[i].set(aim.x, aim.y, aim.z, Math.cos(light.angle));
      stainC.value[i].w = Math.cos(light.angle * (1 - light.penumbra));
    } else {
      stainB.value[i].set(0, 0, 0, -2);
      stainC.value[i].w = 1;
    }
    stainC.value[i].x = light.color.r * light.intensity;
    stainC.value[i].y = light.color.g * light.intensity;
    stainC.value[i].z = light.color.b * light.intensity;
    stainDecay.value[i] = light.decay;
    i++;
  }
  for (; i < MAX; i++) stainC.value[i].set(0, 0, 0, 1);
}
