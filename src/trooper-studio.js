import * as THREE from 'three';
import { createStormtrooper } from './stormtrooper.js';
import { createLighting } from './lighting.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1522);
const model = createStormtrooper({ scene, heading: 0, random: () => 0.35 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: 0x101a28, roughness: 0.83 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.position.y = -0.012; scene.add(floor);
const views = [['front', 0.10], ['side', 1.42], ['back', Math.PI + 0.12]].map(([id, azimuth]) => {
  const canvas = document.getElementById(id);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1); renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2; renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const camera = new THREE.OrthographicCamera(-0.66, 0.66, 0.99, -0.99, 0.1, 30);
  return { canvas, renderer, camera, offset: new THREE.Vector3(Math.sin(azimuth) * 8, 1.7, Math.cos(azimuth) * 8) };
});
const lighting = createLighting(scene, views[0].renderer);
lighting.whiteStrip.intensity = 1.5; lighting.redStrip.intensity = 0;
const pose = document.getElementById('pose'), pixel = document.getElementById('pixel'), closeup = document.getElementById('closeup');
let frozen = false, time = 0, last = performance.now();
function resize() {
  for (const view of views) {
    const width = Math.max(120, view.canvas.clientWidth), height = width * 1.5;
    const scale = pixel.checked ? 4 : 1;
    view.renderer.setSize(Math.floor(width / scale), Math.floor(height / scale), false);
    view.canvas.style.imageRendering = pixel.checked ? 'pixelated' : 'auto';
    view.camera.zoom = closeup.checked ? 1.9 : 1;
    view.camera.updateProjectionMatrix();
  }
}
window.addEventListener('resize', resize); pixel.addEventListener('change', resize); closeup.addEventListener('change', resize); resize();
document.getElementById('freeze').addEventListener('click', event => { frozen = !frozen; event.target.textContent = frozen ? 'Reprendre l’animation' : 'Figer l’animation'; });
pose.addEventListener('change', () => { model.reset(); time = 0; });
const focus = new THREE.Vector3(), target = new THREE.Vector3();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000); last = now;
  if (!frozen) {
    time += dt;
    model.order.velocity.set(0, 0, pose.value === 'run' ? 3.7 : pose.value === 'walk' ? 1.35 : 0);
    model.order.aim = pose.value === 'aim';
    model.order.aimAt = pose.value === 'aim' ? target.copy(model.root.position).add(new THREE.Vector3(0, 1.2, 5)) : null;
    model.update(dt, time);
    if (pose.value === 'inspect') {
      model.parts.blaster.visible = false;
      for (const [side, sign] of [['L', 1], ['R', -1]]) {
        model.joints[`shoulder${side}`].rotation.set(0, 0, sign * 0.14);
        model.joints[`elbow${side}`].rotation.set(-0.08, 0, 0);
        model.joints[`wrist${side}`].rotation.set(0, 0, 0);
      }
      model.joints.neck.rotation.set(0, 0, 0);
      model.root.updateMatrixWorld(true);
    }
  }
  focus.copy(model.root.position).add(new THREE.Vector3(0, closeup.checked ? 1.14 : 0.80, 0));
  lighting.follow(model.root.position);
  for (const view of views) {
    view.camera.position.copy(focus).add(view.offset); view.camera.lookAt(focus);
    view.renderer.render(scene, view.camera);
  }
  requestAnimationFrame(frame);
}
document.getElementById('status').textContent = 'Modèle du jeu · animation en temps réel';
requestAnimationFrame(frame);
