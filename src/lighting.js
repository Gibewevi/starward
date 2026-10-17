import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

/** Cold laboratory lighting shared by the game and the character studio.
 * follow(position) keeps the shadow frustum and strip lights around the hero. */
export function createLighting(scene, renderer) {
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(environment, 0.025).texture;
  scene.environmentIntensity = 0.43;
  environment.dispose();
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0x8fa9d4, 0x15111b, 1.4));
  const keyLight = new THREE.DirectionalLight(0xdce6ff, 3.5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  Object.assign(keyLight.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 25 });
  keyLight.shadow.bias = -0.0003;
  keyLight.shadow.normalBias = 0.018;
  keyLight.shadow.radius = 1.1;
  scene.add(keyLight, keyLight.target);
  const rimLight = new THREE.DirectionalLight(0x97abe0, 1.65);
  rimLight.position.set(2, 3, -5);
  scene.add(rimLight);
  RectAreaLightUniformsLib.init();
  const whiteStrip = new THREE.RectAreaLight(0xd9dcec, 6, 0.55, 9);
  whiteStrip.rotation.x = -Math.PI / 2;
  const redStrip = new THREE.RectAreaLight(0xf75048, 2, 0.16, 7);
  redStrip.rotation.x = -Math.PI / 2;
  scene.add(whiteStrip, redStrip);

  function follow(position) {
    keyLight.position.set(position.x - 3, 7, position.z + 5);
    keyLight.target.position.copy(position);
    whiteStrip.position.set(position.x - 4, 5, position.z - 1);
    redStrip.position.set(position.x + 5, 4, position.z - 3);
  }
  follow(new THREE.Vector3());
  return { keyLight, rimLight, whiteStrip, redStrip, follow };
}
