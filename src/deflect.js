import * as THREE from 'three';
import { FEEL, pick } from './feel.js';

/**
 * Where a bolt goes once the blade has met it. With probability `precision`
 * it is sent at an enemy — roughly back where it came from, its shooter
 * first — with an aim error that shrinks as precision grows. Otherwise it is
 * left to chance: back out, thrown off to one side by a random angle and a
 * little up, never aimed at anyone (it may still find someone by luck).
 *
 * enemies: [{ point, shooter, down }] — where each could be hit.
 * Returns { aim (unit vector), target (the enemy aimed at, or null) }.
 */
const UP = new THREE.Vector3(0, 1, 0);
export function returnDirection({ at, incoming, precision = 0, enemies = [], random = Math.random }) {
  const back = incoming.clone().normalize().negate();
  if (random() < precision) {
    let best = null, score = Infinity;
    for (const enemy of enemies) {
      const to = enemy.point.clone().sub(at), distance = to.length();
      if (distance > 16 || distance < 0.5) continue;
      const angle = to.divideScalar(distance).angleTo(back);
      if (angle > 1.3) continue;
      const value = angle + distance * 0.03 - (enemy.shooter ? 0.5 : 0) + (enemy.down ? 0.6 : 0);
      if (value < score) { score = value; best = enemy; }
    }
    if (best) {
      const error = FEEL.deflect.error * (1 - precision);
      const aim = best.point.clone().sub(at).normalize();
      aim.x += (random() - 0.5) * error * 2;
      aim.y += (random() - 0.5) * error;
      aim.z += (random() - 0.5) * error * 2;
      return { aim: aim.normalize(), target: best };
    }
  }
  const aim = back.clone().setY(0);
  if (aim.lengthSq() < 1e-6) aim.set(1, 0, 0);
  aim.normalize().applyAxisAngle(UP, (random() < 0.5 ? -1 : 1) * pick(FEEL.deflect.yaw, random));
  aim.y = Math.tan(pick(FEEL.deflect.lift, random));
  return { aim: aim.normalize(), target: null };
}
