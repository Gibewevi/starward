// Signed distance helpers and a welded marching-tetrahedra polygoniser.
// The output is one closed surface per connected volume: neighbouring cubes
// share edge vertices, so seams are real topology instead of touching islands.

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const smooth = (a, b, value) => {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const union = (a, b, radius) => {
  const h = Math.max(radius - Math.abs(a - b), 0) / radius;
  return Math.min(a, b) - h * h * radius * 0.25;
};
export const subtract = (a, b, radius) => -union(-a, b, radius);
export function ellipsoid(x, y, z, cx, cy, cz, rx, ry, rz) {
  x -= cx; y -= cy; z -= cz;
  const a = Math.hypot(x / rx, y / ry, z / rz);
  const b = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return b < 1e-9 ? -Math.min(rx, ry, rz) : a * (a - 1) / b;
}
export function roundedBox(x, y, z, cx, cy, cz, hx, hy, hz, radius) {
  const qx = Math.abs(x - cx) - hx + radius;
  const qy = Math.abs(y - cy) - hy + radius;
  const qz = Math.abs(z - cz) - hz + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - radius;
}
/** Tapered capsule between a and b ({x, y, z}); depth squashes it along Z. */
export function capsule(x, y, z, a, b, ra, rb = ra, depth = 1) {
  const ax = x - a.x, ay = y - a.y, az = (z - a.z) / depth;
  const bx = b.x - a.x, by = b.y - a.y, bz = (b.z - a.z) / depth;
  const t = clamp((ax * bx + ay * by + az * bz) / (bx * bx + by * by + bz * bz), 0, 1);
  return Math.hypot(ax - bx * t, ay - by * t, az - bz * t) - (ra + (rb - ra) * t);
}
/** Parameter of the closest point on segment ab, without clamping. */
export function along(x, y, z, a, b) {
  const bx = b.x - a.x, by = b.y - a.y, bz = b.z - a.z;
  return ((x - a.x) * bx + (y - a.y) * by + (z - a.z) * bz) / (bx * bx + by * by + bz * bz);
}

/**
 * Polygonises field(x, y, z) < 0 inside bounds with a uniform step.
 * Returns flat positions, triangle indices and gradient normals.
 */
export function polygonize(field, bounds, step) {
  const positions = [], triangles = [];
  const edgeVertices = new Map(), weldedVertices = new Map();
  const nx = Math.ceil((bounds.maxX - bounds.minX) / step) + 1;
  const ny = Math.ceil((bounds.maxY - bounds.minY) / step) + 1;
  const nz = Math.ceil((bounds.maxZ - bounds.minZ) / step) + 1;
  const grid = new Float32Array(nx * ny * nz);
  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        let value = field(bounds.minX + ix * step, bounds.minY + iy * step, bounds.minZ + iz * step);
        // The bounding faces are always outside, which keeps the surface closed.
        if (ix === 0 || iy === 0 || iz === 0 || ix === nx - 1 || iy === ny - 1 || iz === nz - 1) value = Math.max(value, 1e-4);
        // Exact zeros would create degenerate, coincident vertices.
        grid[ix + nx * (iy + ny * iz)] = value === 0 ? 1e-7 : value;
      }
    }
  }
  const gridPoint = index => {
    const iz = Math.floor(index / (nx * ny));
    const rest = index - iz * nx * ny;
    const iy = Math.floor(rest / nx);
    return [bounds.minX + (rest - iy * nx) * step, bounds.minY + iy * step, bounds.minZ + iz * step];
  };
  function edgeVertex(a, b) {
    const edgeKey = a < b ? `${a}:${b}` : `${b}:${a}`;
    const found = edgeVertices.get(edgeKey);
    if (found !== undefined) return found;
    const p = gridPoint(a), q = gridPoint(b);
    const t = grid[a] / (grid[a] - grid[b]);
    const x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t, z = p[2] + (q[2] - p[2]) * t;
    const vertexKey = `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`;
    let index = weldedVertices.get(vertexKey);
    if (index === undefined) {
      index = positions.length / 3;
      weldedVertices.set(vertexKey, index);
      positions.push(x, Math.abs(y) < 1e-6 ? 0 : y, z);
    }
    edgeVertices.set(edgeKey, index);
    return index;
  }
  function triangle(a, b, c, outward) {
    if (a === b || b === c || c === a) return;
    const ai = a * 3, bi = b * 3, ci = c * 3;
    const abx = positions[bi] - positions[ai], aby = positions[bi + 1] - positions[ai + 1], abz = positions[bi + 2] - positions[ai + 2];
    const acx = positions[ci] - positions[ai], acy = positions[ci + 1] - positions[ai + 1], acz = positions[ci + 2] - positions[ai + 2];
    const normalX = aby * acz - abz * acy, normalY = abz * acx - abx * acz, normalZ = abx * acy - aby * acx;
    if (normalX * outward[0] + normalY * outward[1] + normalZ * outward[2] < 0) triangles.push(a, c, b);
    else triangles.push(a, b, c);
  }
  const tetrahedra = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]];
  for (let iz = 0; iz < nz - 1; iz++) {
    for (let iy = 0; iy < ny - 1; iy++) {
      for (let ix = 0; ix < nx - 1; ix++) {
        const p = ix + nx * (iy + ny * iz);
        const cube = [p, p + 1, p + 1 + nx, p + nx, p + nx * ny, p + 1 + nx * ny, p + 1 + nx + nx * ny, p + nx + nx * ny];
        let insideCount = 0;
        for (const index of cube) if (grid[index] < 0) insideCount++;
        if (insideCount === 0 || insideCount === 8) continue;
        for (const tetrahedron of tetrahedra) {
          const inside = [], outside = [];
          for (const corner of tetrahedron) (grid[cube[corner]] < 0 ? inside : outside).push(cube[corner]);
          if (!inside.length || !outside.length) continue;
          const inCenter = [0, 0, 0], outCenter = [0, 0, 0];
          for (const index of inside) { const q = gridPoint(index); for (let k = 0; k < 3; k++) inCenter[k] += q[k] / inside.length; }
          for (const index of outside) { const q = gridPoint(index); for (let k = 0; k < 3; k++) outCenter[k] += q[k] / outside.length; }
          const outward = outCenter.map((value, k) => value - inCenter[k]);
          if (inside.length === 1) triangle(...outside.map(index => edgeVertex(inside[0], index)), outward);
          else if (inside.length === 3) triangle(...inside.map(index => edgeVertex(index, outside[0])), outward);
          else {
            const ac = edgeVertex(inside[0], outside[0]), ad = edgeVertex(inside[0], outside[1]);
            const bc = edgeVertex(inside[1], outside[0]), bd = edgeVertex(inside[1], outside[1]);
            triangle(ac, bc, ad, outward);
            triangle(bc, bd, ad, outward);
          }
        }
      }
    }
  }
  const normals = new Float32Array(positions.length);
  const h = step * 0.05;
  for (let offset = 0; offset < positions.length; offset += 3) {
    const x = positions[offset], y = positions[offset + 1], z = positions[offset + 2];
    const gx = field(x + h, y, z) - field(x - h, y, z);
    const gy = field(x, y + h, z) - field(x, y - h, z);
    const gz = field(x, y, z + h) - field(x, y, z - h);
    const length = Math.hypot(gx, gy, gz) || 1;
    normals[offset] = gx / length; normals[offset + 1] = gy / length; normals[offset + 2] = gz / length;
  }
  return { positions: new Float32Array(positions), indices: triangles, normals };
}
