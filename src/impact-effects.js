import * as THREE from 'three';
import { createTweens, ease } from './tween.js';

/**
 * Lightsaber impact effects, stylised and without gore. A physical particle
 * system: sparks fly as streaks stretched along their velocity, droplets of
 * molten armour fall heavier, and both obey gravity and air drag, bounce on
 * the floor, slide to a stop and lie there as round glowing beads that cool
 * from white-hot to orange, red, then black over a few seconds. Embers drift
 * up from cauterised cuts, an orange flash lights the impact, and glowing
 * materials cool down. A burst marks a clean cut: a flare that blooms and
 * fades, and a ring of light racing out along the cut plane — both tweened.
 * A Force wave is a few pale rings rushing out of the hand (a push) or
 * converging on it (a pull), eased.
 * sparks()/flash()/burst()/wave()/smoulder()/glow(), then update(dt).
 */
const SPARK = 0, DROP = 1, EMBER = 2;

export function createImpactEffects(scene, { random = Math.random } = {}) {
  const MAX = 1800;
  const position = new Float32Array(MAX * 3), velocity = new Float32Array(MAX * 3);
  const heat = new Float32Array(MAX), cooling = new Float32Array(MAX), size = new Float32Array(MAX);
  const kind = new Uint8Array(MAX), alive = new Uint8Array(MAX), resting = new Uint8Array(MAX), seed = new Float32Array(MAX);

  // Round, soft-edged beads (points) and velocity streaks (lines).
  const beadGeometry = new THREE.BufferGeometry();
  const beadPositions = new Float32Array(MAX * 3), beadColors = new Float32Array(MAX * 3), beadSizes = new Float32Array(MAX);
  beadGeometry.setAttribute('position', new THREE.BufferAttribute(beadPositions, 3).setUsage(THREE.DynamicDrawUsage));
  beadGeometry.setAttribute('glow', new THREE.BufferAttribute(beadColors, 3).setUsage(THREE.DynamicDrawUsage));
  beadGeometry.setAttribute('size', new THREE.BufferAttribute(beadSizes, 1).setUsage(THREE.DynamicDrawUsage));
  const beadMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec3 glow; attribute float size; varying vec3 vGlow;
      void main() {
        vGlow = glow;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vGlow;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c) * 4.0;
        if (d > 1.0) discard;
        gl_FragColor = vec4(vGlow * (1.0 - d * 0.7), 1.0);
      }`,
  });
  const beads = new THREE.Points(beadGeometry, beadMaterial);
  beads.name = 'Impact beads';
  beads.frustumCulled = false;
  const streakGeometry = new THREE.BufferGeometry();
  const streakPositions = new Float32Array(MAX * 6), streakColors = new Float32Array(MAX * 6);
  streakGeometry.setAttribute('position', new THREE.BufferAttribute(streakPositions, 3).setUsage(THREE.DynamicDrawUsage));
  streakGeometry.setAttribute('color', new THREE.BufferAttribute(streakColors, 3).setUsage(THREE.DynamicDrawUsage));
  const streaks = new THREE.LineSegments(streakGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  streaks.name = 'Spark streaks';
  streaks.frustumCulled = false;
  scene.add(beads, streaks);

  const lights = [0, 1].map(() => {
    const light = new THREE.PointLight(0xff8a3a, 0, 3.2, 1.8);
    scene.add(light);
    return { light, tween: null };
  });
  let nextLight = 0, cursor = 0;
  const tweens = createTweens();

  // Flares: a soft radial glow, additive, bright enough to bloom.
  const glowTexture = (() => {
    const n = 32, data = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const d = Math.min(1, Math.hypot((x + 0.5) / n * 2 - 1, (y + 0.5) / n * 2 - 1));
        data.set([255, 255, 255, Math.round((1 - d) ** 2.2 * 255)], (y * n + x) * 4);
      }
    }
    const texture = new THREE.DataTexture(data, n, n);
    texture.needsUpdate = true;
    return texture;
  })();
  const flareSlots = Array.from({ length: 6 }, () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    sprite.name = 'Impact flare';
    sprite.visible = false;
    scene.add(sprite);
    return { sprite, tween: null };
  });
  const ringSlots = Array.from({ length: 6 }, () => {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }));
    mesh.name = 'Cut ring';
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, tween: null };
  });
  let nextFlare = 0, nextRing = 0, nextWave = 0;
  // Force waves: wide, faint rings.
  const waveSlots = Array.from({ length: 9 }, () => {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 48), new THREE.MeshBasicMaterial({ color: 0x9fc4ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }));
    mesh.name = 'Force wave';
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, tween: null };
  });
  const whiteHot = new THREE.Color(2.6, 2.5, 2.9), orange = new THREE.Color(2.4, 0.9, 0.25), red = new THREE.Color(0.85, 0.01, 0.01);
  const lightWhite = new THREE.Color(1, 0.93, 0.85), lightOrange = new THREE.Color(1, 0.54, 0.23);
  const facing = new THREE.Vector3(0, 0, 1);
  const smoulders = [], glows = [];
  const hot = new THREE.Color(3.2, 1.35, 0.4), cold = new THREE.Color(0.055, 0.05, 0.05);
  const point = new THREE.Vector3(), start = new THREE.Vector3(), color = new THREE.Color();

  // Black-body-ish ramp: white-hot, yellow, orange, deep red, out.
  function incandescence(t, out) {
    if (t > 0.75) return out.setRGB(2.6, 2.1, 1.4).lerp(color.setRGB(2.4, 1.3, 0.4), (1 - t) / 0.25);
    if (t > 0.45) return out.setRGB(2.4, 1.3, 0.4).lerp(color.setRGB(2.2, 0.55, 0.08), (0.75 - t) / 0.3);
    if (t > 0.15) return out.setRGB(2.2, 0.55, 0.08).lerp(color.setRGB(0.7, 0.08, 0.02), (0.45 - t) / 0.3);
    return out.setRGB(0.7, 0.08, 0.02).multiplyScalar(Math.max(0, t / 0.15));
  }
  const glowColor = new THREE.Color();

  function emit(at, v, type, temperature, rate, pixels) {
    const i = cursor;
    cursor = (cursor + 1) % MAX;
    at.toArray(position, i * 3);
    v.toArray(velocity, i * 3);
    kind[i] = type; heat[i] = temperature; cooling[i] = rate; size[i] = pixels; alive[i] = 1; resting[i] = 0; seed[i] = random() * 100;
  }
  /** A burst along the blade's motion, fanned across the cut plane. */
  function sparks(at, direction, normal, { count = 40, speed = 4 } = {}) {
    const v = new THREE.Vector3(), side = new THREE.Vector3().crossVectors(direction, normal);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    for (let i = 0; i < count; i++) {
      const drop = i % 6 === 5;
      const pace = drop ? 0.25 + random() * 0.45 : 0.35 + random() * 0.9;
      v.copy(direction).multiplyScalar(speed * pace)
        .addScaledVector(side, (random() - 0.5) * speed * (drop ? 0.4 : 1))
        .addScaledVector(normal, (random() - 0.5) * speed * 0.5);
      v.y += drop ? 0.2 + random() * 0.6 : 0.6 + random() * 2;
      // Staggered along their paths, so the burst never piles up in one blinding point.
      start.copy(at).addScaledVector(v, random() * 0.03);
      emit(start, v, drop ? DROP : SPARK, 0.78 + random() * 0.17, drop ? 0.2 + random() * 0.08 : 0.32 + random() * 0.25, drop ? 2.8 + random() * 0.6 : 1.7 + random() * 0.6);
    }
  }
  /** The impact lights its surroundings: white at once, cooling to orange as it fades. */
  function flash(at, power = 1, { color = null } = {}) {
    const slot = lights[nextLight];
    nextLight = (nextLight + 1) % lights.length;
    tweens.cancel(slot.tween);
    slot.light.position.copy(at);
    slot.tween = tweens.add({
      duration: 0.22, curve: ease.outQuad,
      update: (eased, progress) => {
        slot.light.intensity = power * 4 * (1 - eased);
        slot.light.color.copy(lightWhite).lerp(color ?? lightOrange, ease.outCubic(progress));
      },
      complete: () => { slot.light.intensity = 0; },
    });
  }
  /**
   * A clean cut flares: a glow that blooms at the contact and fades, and a
   * thin ring of light that races out along the cut plane (`normal` is the
   * plane's normal), white-hot cooling to orange.
   */
  function burst(at, { normal = null, power = 1, tint = null } = {}) {
    power = Math.min(1.5, Math.max(0.2, power));
    // A blaster's flare cools to red, the blade's to orange.
    const cool = tint === 'red' ? red : orange;
    const flare = flareSlots[nextFlare];
    nextFlare = (nextFlare + 1) % flareSlots.length;
    tweens.cancel(flare.tween);
    flare.sprite.position.copy(at);
    flare.sprite.visible = true;
    const size = 0.18 + 0.2 * power;
    flare.tween = tweens.add({
      duration: 0.2, curve: ease.outExpo,
      update: (eased, progress) => {
        flare.sprite.scale.setScalar(0.06 + (size - 0.06) * eased);
        flare.sprite.material.color.copy(whiteHot).lerp(cool, progress);
        flare.sprite.material.opacity = 1 - ease.outQuad(progress);
      },
      complete: () => { flare.sprite.visible = false; },
    });
    if (!normal || normal.lengthSq() < 1e-6) return;
    const ring = ringSlots[nextRing];
    nextRing = (nextRing + 1) % ringSlots.length;
    tweens.cancel(ring.tween);
    ring.mesh.position.copy(at);
    ring.mesh.quaternion.setFromUnitVectors(facing, normal.clone().normalize());
    ring.mesh.visible = true;
    const reach = 0.12 + 0.14 * power;
    ring.tween = tweens.add({
      duration: 0.18, curve: ease.outCubic,
      update: (eased, progress) => {
        ring.mesh.scale.setScalar(0.04 + (reach - 0.04) * eased);
        ring.mesh.material.color.copy(whiteHot).lerp(cool, ease.outQuad(progress)).multiplyScalar(0.8);
        ring.mesh.material.opacity = (1 - progress) ** 1.6;
      },
      complete: () => { ring.mesh.visible = false; },
    });
  }
  /** Embers rising from an object (a cut) for a few seconds. */
  function smoulder(object, duration = 2.6) { smoulders.push({ object, age: 0, duration, debt: 0 }); }
  /** A material that cools from white-hot to scorched over a few seconds. */
  function glow(material, duration = 4.5) {
    glows.push({ material, age: 0, duration });
    material.color.copy(hot);
  }

  /**
   * A Force wave from `from` along `direction` over `length` metres: a push
   * rushes out and widens; a pull converges on `from` and narrows.
   */
  function wave(from, direction, { kind = 'push', length = 4, power = 1 } = {}) {
    const along = direction.clone().setY(0);
    if (along.lengthSq() < 1e-6) return;
    along.normalize();
    for (let i = 0; i < 3; i++) {
      const slot = waveSlots[nextWave];
      nextWave = (nextWave + 1) % waveSlots.length;
      tweens.cancel(slot.tween);
      const mesh = slot.mesh;
      mesh.quaternion.setFromUnitVectors(facing, along);
      mesh.visible = true;
      const start = from.clone(), travel = length * (0.75 + 0.12 * i);
      slot.tween = tweens.add({
        delay: i * 0.045, duration: 0.34 + i * 0.04, curve: kind === 'push' ? ease.outCubic : ease.inOutCubic,
        update: (eased, progress) => {
          const reach = kind === 'push' ? eased : 1 - eased;
          mesh.position.copy(start).addScaledVector(along, travel * reach);
          mesh.scale.setScalar((kind === 'push' ? 0.15 + 1.25 * eased : 1.3 - 1.15 * eased) * (1 - i * 0.12));
          mesh.material.opacity = 0.55 * power * Math.sin(Math.PI * Math.min(1, progress * 1.15)) * (1 - i * 0.2);
        },
        complete: () => { mesh.visible = false; mesh.material.opacity = 0; },
      });
    }
  }

  function update(dt) {
    tweens.update(dt);
    for (const entry of smoulders) {
      entry.age += dt;
      entry.debt += dt * 12 * (1 - entry.age / entry.duration);
      while (entry.debt > 1) {
        entry.debt -= 1;
        entry.object.getWorldPosition(point);
        emit(point, new THREE.Vector3((random() - 0.5) * 0.2, 0.2 + random() * 0.35, (random() - 0.5) * 0.2), EMBER, 0.55 + random() * 0.2, 0.45 + random() * 0.3, 1.4 + random() * 0.5);
      }
    }
    for (let i = smoulders.length - 1; i >= 0; i--) if (smoulders[i].age >= smoulders[i].duration) smoulders.splice(i, 1);
    for (const entry of glows) {
      entry.age += dt;
      const t = Math.min(1, entry.age / entry.duration);
      entry.material.color.copy(hot).lerp(cold, 1 - (1 - t) ** 2.2);
    }
    for (let i = glows.length - 1; i >= 0; i--) if (glows[i].age >= glows[i].duration) glows.splice(i, 1);

    for (let i = 0; i < MAX; i++) {
      const o = i * 3, l = i * 6;
      if (!alive[i]) {
        beadSizes[i] = 0;
        beadColors[o] = beadColors[o + 1] = beadColors[o + 2] = 0;
        streakColors.fill(0, l, l + 6);
        continue;
      }
      const type = kind[i];
      // Air: drag, and gravity (embers float on the heat instead).
      const drag = Math.exp(-(type === EMBER ? 1.5 : type === DROP ? 0.4 : 1.1) * dt);
      velocity[o] *= drag; velocity[o + 1] *= drag; velocity[o + 2] *= drag;
      if (type === EMBER) {
        velocity[o] += Math.sin(seed[i] + heat[i] * 20) * 0.4 * dt;
        velocity[o + 2] += Math.cos(seed[i] * 1.3 + heat[i] * 17) * 0.4 * dt;
      } else if (!resting[i]) velocity[o + 1] -= 9.8 * dt;
      position[o] += velocity[o] * dt; position[o + 1] += velocity[o + 1] * dt; position[o + 2] += velocity[o + 2] * dt;
      // Floor: bounce with losses, then slide to a stop and lie there.
      if (type !== EMBER && position[o + 1] < 0.006) {
        position[o + 1] = 0.006;
        if (velocity[o + 1] < -0.6) {
          velocity[o + 1] *= -(0.25 + (seed[i] % 1) * 0.25);
          velocity[o] *= 0.62; velocity[o + 2] *= 0.62;
        } else {
          velocity[o + 1] = 0;
          resting[i] = 1;
          const slide = Math.exp(-5 * dt);
          velocity[o] *= slide; velocity[o + 2] *= slide;
        }
      }
      // Cooling: slower once lying on the floor, so they linger.
      heat[i] -= cooling[i] * dt * (resting[i] ? 0.75 : 1);
      if (heat[i] <= 0) { alive[i] = 0; continue; }
      incandescence(heat[i], glowColor);
      const flicker = type === EMBER ? 0.75 + 0.25 * Math.sin(seed[i] * 7 + heat[i] * 60) : 1;
      beadPositions[o] = position[o]; beadPositions[o + 1] = position[o + 1]; beadPositions[o + 2] = position[o + 2];
      beadColors[o] = glowColor.r * flicker; beadColors[o + 1] = glowColor.g * flicker; beadColors[o + 2] = glowColor.b * flicker;
      beadSizes[i] = size[i] * (0.6 + 0.4 * Math.min(1, heat[i] * 2));
      // A fast spark is a streak along its path: bright head, fading tail.
      const speed = Math.hypot(velocity[o], velocity[o + 1], velocity[o + 2]);
      const stretch = type === SPARK && speed > 1.2 ? 0.035 : 0;
      streakPositions[l] = position[o]; streakPositions[l + 1] = position[o + 1]; streakPositions[l + 2] = position[o + 2];
      streakPositions[l + 3] = position[o] - velocity[o] * stretch;
      streakPositions[l + 4] = position[o + 1] - velocity[o + 1] * stretch;
      streakPositions[l + 5] = position[o + 2] - velocity[o + 2] * stretch;
      const strength = stretch ? 1 : 0;
      streakColors[l] = glowColor.r * strength; streakColors[l + 1] = glowColor.g * strength; streakColors[l + 2] = glowColor.b * strength;
      streakColors[l + 3] = glowColor.r * 0.2 * strength; streakColors[l + 4] = glowColor.g * 0.1 * strength; streakColors[l + 5] = glowColor.b * 0.05 * strength;
      if (stretch) beadSizes[i] *= 0.7;
    }
    for (const attribute of [beadGeometry.attributes.position, beadGeometry.attributes.glow, beadGeometry.attributes.size, streakGeometry.attributes.position, streakGeometry.attributes.color]) attribute.needsUpdate = true;
  }
  function clear() {
    alive.fill(0);
    smoulders.length = 0;
    glows.length = 0;
    tweens.clear();
    update(0);
  }
  const live = () => { let count = 0; for (let i = 0; i < MAX; i++) count += alive[i]; return count; };
  const restingCount = () => { let count = 0; for (let i = 0; i < MAX; i++) count += alive[i] && resting[i]; return count; };
  return {
    points: beads, beads, streaks, sparks, flash, burst, wave, smoulder, glow, update, clear, hot, cold,
    get live() { return live(); }, get resting() { return restingCount(); },
    /** Flares and rings currently shown. */
    get bursts() { return flareSlots.filter(slot => slot.sprite.visible).length + ringSlots.filter(slot => slot.mesh.visible).length; },
    get waves() { return waveSlots.filter(slot => slot.mesh.visible).length; },
  };
}
