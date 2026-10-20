import * as THREE from 'three';
import { FEEL } from './feel.js';

/**
 * The room's power. Everything that shines in the room — the light bars and
 * floor strips (unlit materials drawn bright), their glow pools, the lamps
 * (point lights), the studio lights over the deck and the room's ambient
 * light — follows one `level`, 1 (on) to 0 (cut). At 0 the room keeps only a
 * cold trace of light (`FEEL.blackout.night`), enough to read shapes.
 *
 * Lights are never removed or hidden, only dimmed: the number of lights the
 * shaders were built for never changes, so cutting the power costs nothing.
 * Animated lights (a blinking lamp, a breathing panel) are recognised by
 * their colour changing between frames and dimmed on top of their own
 * animation; still ones are set from the colour they had at the start.
 *
 * `fixtures`: points on the light fittings (where sparks fly when the power
 * dies), nearest first from any point with fixturesFrom(point).
 */
export function createPower({ scene, roots = [], lighting = null }) {
  const emitters = [], lamps = [], fixtures = [];
  const seen = new Set();
  const point = new THREE.Vector3(), matrix = new THREE.Matrix4();
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverse(object => {
      if (object.isPointLight || object.isSpotLight) { lamps.push({ light: object, base: object.intensity, last: object.intensity }); return; }
      if (!(object.isMesh || object.isSprite) || !object.material || Array.isArray(object.material)) return;
      const material = object.material;
      // What shines: drawn bright and unlit (not tone mapped), or added as light.
      const shines = material.toneMapped === false || material.blending === THREE.AdditiveBlending;
      if (!shines || !material.color) return;
      if (!seen.has(material)) {
        seen.add(material);
        emitters.push({ material, base: material.color.clone(), last: material.color.clone() });
      }
      // Where the fittings are: each instance of an instanced light, a few points of a merged one.
      if (material.blending === THREE.AdditiveBlending) return;
      if (object.isInstancedMesh) {
        for (let i = 0; i < object.count; i++) { object.getMatrixAt(i, matrix); fixtures.push(point.setFromMatrixPosition(matrix).applyMatrix4(object.matrixWorld).clone()); }
      } else if (object.geometry?.attributes.position) {
        const positions = object.geometry.attributes.position, step = Math.max(1, Math.floor(positions.count / 60));
        for (let i = 0; i < positions.count; i += step) fixtures.push(point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld).clone());
      }
    });
  }
  // Fittings closer than half a metre are one fitting.
  const fittings = [];
  for (const candidate of fixtures) if (!fittings.some(other => other.distanceToSquared(candidate) < 0.25)) fittings.push(candidate);

  // The room's own lights: sky, key, rim, the strips over the deck, the reflected room.
  let hemisphere = null;
  scene.traverse(object => { if (object.isHemisphereLight) hemisphere ??= object; });
  const day = {
    hemisphere: hemisphere?.intensity ?? 0, hemisphereColor: hemisphere?.color.clone(), groundColor: hemisphere?.groundColor.clone(),
    key: lighting?.keyLight.intensity ?? 0, rim: lighting?.rimLight.intensity ?? 0,
    white: lighting?.whiteStrip.intensity ?? 0, red: lighting?.redStrip.intensity ?? 0,
    environment: scene.environmentIntensity ?? 1,
    background: scene.background?.isColor ? scene.background.clone() : null,
    fog: scene.fog?.color.clone() ?? null,
  };
  const nightColor = new THREE.Color(), mix = new THREE.Color();
  let level = 1;

  /** Each frame, after the room's own animations: everything set to the level. */
  function apply() {
    const night = FEEL.blackout.night, k = level;
    for (const entry of emitters) {
      const { material, base, last } = entry;
      // Still since we last set it: from its base. Animated (it changed): dimmed on top of its animation.
      if (material.color.equals(last)) material.color.copy(base).multiplyScalar(k);
      else material.color.multiplyScalar(k);
      last.copy(material.color);
    }
    for (const entry of lamps) {
      const { light } = entry;
      light.intensity = light.intensity === entry.last ? entry.base * k : light.intensity * k;
      entry.last = light.intensity;
    }
    if (hemisphere) {
      hemisphere.intensity = THREE.MathUtils.lerp(night.hemisphere, day.hemisphere, k);
      hemisphere.color.copy(nightColor.set(night.sky)).lerp(day.hemisphereColor, k);
      hemisphere.groundColor.copy(nightColor.set(night.ground)).lerp(day.groundColor, k);
    }
    if (lighting) {
      lighting.keyLight.intensity = day.key * k;
      lighting.rimLight.intensity = THREE.MathUtils.lerp(night.rim, day.rim, k);
      lighting.whiteStrip.intensity = day.white * k;
      lighting.redStrip.intensity = day.red * k;
    }
    scene.environmentIntensity = THREE.MathUtils.lerp(night.environment, day.environment, k);
    if (day.background) scene.background.copy(mix.set(night.background)).lerp(day.background, k);
    if (day.fog && scene.fog) scene.fog.color.copy(mix.set(night.background)).lerp(day.fog, k);
  }
  return {
    apply,
    get level() { return level; },
    set level(value) { level = THREE.MathUtils.clamp(value, 0, 1); },
    /** The fittings, nearest to `from` first. */
    fixturesFrom: from => [...fittings].sort((a, b) => a.distanceToSquared(from) - b.distanceToSquared(from)),
    fixtures: fittings,
    emitters, lamps,
  };
}
