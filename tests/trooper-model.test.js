import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildTrooperParts } from '../src/trooper-model.js';

test('armour geometry has finite surfaces and a bounded cost for a full squad', () => {
  const materials = Object.fromEntries(['armor', 'shade', 'black', 'lens'].map(name => [name, new THREE.MeshStandardMaterial()]));
  const { parts, pieces } = buildTrooperParts(materials);
  let triangles = 0;
  try {
    assert.equal(Object.keys(parts).length, 16, 'all original ragdoll bodies exist');
    assert.equal(Object.keys(pieces).length, 19, 'all detachable plates retain their mounts');
    for (const [name, part] of Object.entries(parts)) {
      const bounds = new THREE.Box3().setFromObject(part);
      assert.ok(!bounds.isEmpty(), name);
      assert.ok(bounds.getSize(new THREE.Vector3()).length() < 0.85, `${name}: no stray bevel vertices`);
      part.traverse(object => {
        if (!object.isMesh) return;
        const geometry = object.geometry;
        triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
        for (const attribute of ['position', 'normal']) {
          assert.ok(geometry.attributes[attribute].array.every(Number.isFinite), `${name}: finite ${attribute}`);
        }
        if (geometry.index) assert.ok(geometry.index.array.every(index => index < geometry.attributes.position.count));
      });
    }
    assert.ok(triangles < 12000, `geometry budget for five troopers: ${triangles} triangles per model`);
    const helmet = new THREE.Box3().setFromObject(pieces.helmet);
    assert.ok(helmet.max.y < 0.35 && helmet.min.y > 0.035, 'helmet fits the existing head collision frame');
    for (const piece of Object.values(pieces)) {
      assert.ok(piece.userData.armour && Object.values(parts).includes(piece.parent), piece.name);
    }
    // The concave chest is a closed physical plate, including its narrow bevel
    // and inner return: it must also render correctly after being knocked off.
    const chest = pieces.chestPlate.getObjectByName('Sculpted breastplate').geometry;
    const p = chest.attributes.position, n = chest.attributes.normal, edges = new Map();
    const vector = i => new THREE.Vector3().fromBufferAttribute(p, i);
    const key = v => v.toArray().map(value => Math.round(value * 1e7)).join(',');
    for (let i = 0; i < p.count; i += 3) {
      const triangle = [vector(i), vector(i + 1), vector(i + 2)];
      const normal = new THREE.Vector3().crossVectors(triangle[1].clone().sub(triangle[0]), triangle[2].clone().sub(triangle[0]));
      assert.ok(normal.lengthSq() > 1e-14, 'no degenerate chest triangles');
      assert.ok(normal.normalize().dot(new THREE.Vector3().fromBufferAttribute(n, i)) > 0.8, 'stored normals face out of each surface');
      for (let j = 0; j < 3; j++) {
        const a = key(triangle[j]), b = key(triangle[(j + 1) % 3]);
        const id = [a, b].sort().join('|');
        const edge = edges.get(id) ?? { count: 0, winding: 0 };
        edge.count++; edge.winding += a < b ? 1 : -1; edges.set(id, edge);
      }
    }
    for (const edge of edges.values()) {
      assert.equal(edge.count, 2, 'every chest edge has two adjacent faces');
      assert.equal(edge.winding, 0, 'adjacent chest faces agree on the inside and outside');
    }
  } finally {
    for (const part of Object.values(parts)) part.traverse(object => object.geometry?.dispose());
    for (const material of Object.values(materials)) material.dispose();
  }
});
