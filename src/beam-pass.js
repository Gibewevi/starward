import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FEEL } from './feel.js';

/**
 * The rifle lamps' beams as light caught in the dusty air, worked out for
 * every pixel each frame rather than drawn as a shape. Along its line of
 * sight a pixel is stepped through each beam it crosses, up to whatever
 * stands there (the floor, a crate, a man): the light of every step is
 * added up — strongest near the lamp and on the axis, soft at the edges,
 * thickened and thinned by a slow haze. A beam pointed at the floor stops on
 * the floor (the lamp's own light makes the pool there). Where the lamp is
 * one of the real lights, its shadow map is read at each step: a crate or a
 * man in the way cuts a shaft of shadow out of the beam.
 *
 * After the scene, before the bloom: it reads the scene's colour and depth
 * (the composer's targets carry a depth texture) and adds the light. The
 * steps start a little further on from one pixel to the next (a 4×4 Bayer
 * pattern), so the few steps it takes read as a fine pixel grain, not bands.
 *
 * `beams()` gives this frame's beams: { lens, forward, length, on, light }.
 */
const MAX = 16;
const SHADOWED = FEEL.blackout.shadows;
const STEPS = 16;

export class BeamPass extends Pass {
  constructor(camera, beams) {
    super();
    this.camera = camera;
    this.beams = beams;
    const B = FEEL.blackout.beam;
    const slots = () => Array.from({ length: MAX }, () => new THREE.Vector4());
    // Until a lamp has a shadow map: fully lit.
    const open = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    open.needsUpdate = true;
    const shadows = Array.from({ length: SHADOWED }, (_, i) => `if (slot < ${i}.5) return litIn(shadowMap[${i}], shadowMatrix[${i}], shadowBias[${i}], p);`).join('\n        ');
    this.material = new THREE.ShaderMaterial({
      name: 'Lamp beams',
      uniforms: {
        tColor: { value: null }, tDepth: { value: null },
        projectionInverse: { value: new THREE.Matrix4() }, cameraWorld: { value: new THREE.Matrix4() },
        count: { value: 0 }, beamA: { value: slots() }, beamB: { value: slots() }, beamShadow: { value: new Float32Array(MAX).fill(-1) },
        shadowMap: { value: Array(SHADOWED).fill(open) },
        shadowMatrix: { value: Array.from({ length: SHADOWED }, () => new THREE.Matrix4()) },
        shadowBias: { value: new Float32Array(SHADOWED) },
        tint: { value: new THREE.Color(FEEL.blackout.lamp.color) },
        level: { value: B.level }, spread: { value: B.radius / B.length }, full: { value: B.length }, haze: { value: B.haze }, time: { value: 0 },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        #include <packing>
        #define MAX ${MAX}
        #define STEPS ${STEPS}
        uniform sampler2D tColor; uniform sampler2D tDepth;
        uniform mat4 projectionInverse; uniform mat4 cameraWorld;
        uniform int count; uniform vec4 beamA[MAX]; uniform vec4 beamB[MAX]; uniform float beamShadow[MAX];
        uniform sampler2D shadowMap[${SHADOWED}]; uniform mat4 shadowMatrix[${SHADOWED}]; uniform float shadowBias[${SHADOWED}];
        uniform vec3 tint; uniform float level; uniform float spread; uniform float full; uniform float haze; uniform float time;
        varying vec2 vUv;

        vec3 worldAt(float depth) {
          vec4 view = projectionInverse * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
          return (cameraWorld * vec4(view.xyz / view.w, 1.0)).xyz;
        }
        // Is p in the lamp's light, or in the shadow of something between?
        float litIn(sampler2D map, mat4 matrix, float bias, vec3 p) {
          vec4 at = matrix * vec4(p, 1.0);
          if (at.w <= 0.0) return 1.0;
          at.xyz /= at.w;
          if (at.x < 0.0 || at.x > 1.0 || at.y < 0.0 || at.y > 1.0 || at.z > 1.0) return 1.0;
          return step(at.z + bias, unpackRGBAToDepth(texture2D(map, at.xy)));
        }
        float lit(float slot, vec3 p) {
          if (slot < -0.5) return 1.0;
          ${shadows}
          return 1.0;
        }
        float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
        float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
        float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float noise(vec3 x) {
          vec3 i = floor(x), f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }

        void main() {
          vec4 colour = texture2D(tColor, vUv);
          if (count == 0) { gl_FragColor = colour; return; }
          vec3 from = worldAt(0.0), to = worldAt(texture2D(tDepth, vUv).x);
          float far = length(to - from);
          vec3 ray = (to - from) / far;
          float jitter = bayer4(gl_FragCoord.xy);
          vec3 drift = vec3(time * 0.07, time * 0.03, -time * 0.05);
          float glow = 0.0;
          for (int i = 0; i < MAX; i++) {
            if (i >= count) break;
            vec3 lens = beamA[i].xyz, axis = beamB[i].xyz;
            float len = beamA[i].w;
            // Only the stretch of the ray inside the sphere round the beam, and before what stands there.
            vec3 centre = lens + axis * len * 0.5;
            float bound = 0.25 * len * len + spread * spread * len * len;
            vec3 oc = from - centre;
            float b = dot(oc, ray), h = b * b - dot(oc, oc) + bound;
            if (h <= 0.0) continue;
            h = sqrt(h);
            float t0 = max(-b - h, 0.0), t1 = min(-b + h, far);
            if (t1 <= t0) continue;
            float stepLength = (t1 - t0) / float(STEPS), sum = 0.0;
            for (int k = 0; k < STEPS; k++) {
              vec3 p = from + ray * (t0 + (float(k) + jitter) * stepLength), local = p - lens;
              float along = dot(local, axis);
              if (along <= 0.0 || along >= len) continue;
              float radius = spread * along, edge = length(local - axis * along) / radius;
              if (edge >= 1.0) continue;
              float share = along / full, soft = 1.0 - edge * edge;
              // Light spread over the beam's width: about as bright across it all along, fading out to its end.
              float fade = (1.0 - share) * (1.0 - share) * smoothstep(0.0, 0.06, share);
              float air = mix(1.0, 0.35 + 1.3 * noise(p * 1.8 + drift), haze);
              sum += soft * soft * fade * air * lit(beamShadow[i], p) / max(radius, 0.12);
            }
            glow += sum * stepLength * beamB[i].w;
          }
          gl_FragColor = vec4(colour.rgb + tint * glow * level, colour.a);
        }`,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }
  /** This frame's beams into the shader: the nearest first, the real lights' shadows with them. */
  pack(beams) {
    const u = this.material.uniforms;
    let n = 0, slot = 0;
    for (const beam of beams) {
      if (n >= MAX) break;
      u.beamA.value[n].set(beam.lens.x, beam.lens.y, beam.lens.z, beam.length);
      u.beamB.value[n].set(beam.forward.x, beam.forward.y, beam.forward.z, beam.on);
      const map = beam.light?.castShadow ? beam.light.shadow.map : null;
      if (map && slot < SHADOWED) {
        u.shadowMap.value[slot] = map.texture;
        u.shadowMatrix.value[slot].copy(beam.light.shadow.matrix);
        u.shadowBias.value[slot] = beam.light.shadow.bias;
        u.beamShadow.value[n] = slot++;
      } else u.beamShadow.value[n] = -1;
      n++;
    }
    u.count.value = n;
    return n;
  }
  render(renderer, writeBuffer, readBuffer, deltaTime) {
    const u = this.material.uniforms;
    u.tColor.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    u.projectionInverse.value.copy(this.camera.projectionMatrixInverse);
    u.cameraWorld.value.copy(this.camera.matrixWorld);
    u.time.value += deltaTime ?? 0;
    this.pack(this.beams());
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }
  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
