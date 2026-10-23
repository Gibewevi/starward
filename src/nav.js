import * as THREE from 'three';

/**
 * Finding the way round the room. The deck is a grid of cells (0.4 m); a cell
 * is walkable when a trooper standing there stays clear of every obstacle
 * (its footprint grown by his girth) and inside the room. path(from, to) runs
 * A* over the grid (8 directions, no cutting corners) and straightens the
 * result: only the waypoints where the way really turns are kept.
 * lineFree(a, b) says whether a man can walk straight from a to b.
 * `cost(point)` (≥ 1) makes some ground slower to cross — the marsh's water:
 * the way found goes round it when it can (the walkways), and is not
 * straightened across it.
 */
export function createNav(lab, bounds, { cell = 0.4, clearance = 0.33, margin = 0.35, cost = null } = {}) {
  const minX = bounds.minX + margin, minZ = bounds.minZ + margin;
  const cols = Math.max(1, Math.ceil((bounds.maxX - margin - minX) / cell)), rows = Math.max(1, Math.ceil((bounds.maxZ - margin - minZ) / cell));
  const blocked = new Uint8Array(cols * rows), weight = new Float32Array(cols * rows).fill(1);
  const centre = (i, j, out = new THREE.Vector3()) => out.set(minX + (i + 0.5) * cell, 0, minZ + (j + 0.5) * cell);
  function rebuild() {
    const point = new THREE.Vector3();
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      centre(i, j, point);
      blocked[j * cols + i] = lab.obstacles.some(box => box.min.y < 1.2
        && point.x > box.min.x - clearance && point.x < box.max.x + clearance && point.z > box.min.z - clearance && point.z < box.max.z + clearance) ? 1 : 0;
      if (cost) weight[j * cols + i] = Math.max(1, cost(point));
    }
  }
  rebuild();
  const inside = (i, j) => i >= 0 && j >= 0 && i < cols && j < rows;
  const free = (i, j) => inside(i, j) && !blocked[j * cols + i];
  const cellOf = point => [Math.floor((point.x - minX) / cell), Math.floor((point.z - minZ) / cell)];
  /** The nearest walkable cell to a point (searching rings outwards), or null. */
  function nearestFree(point) {
    const [ci, cj] = cellOf(point);
    if (free(ci, cj)) return [ci, cj];
    for (let r = 1; r < 8; r++) {
      let best = null, bestD = Infinity;
      for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || !free(i, j)) continue;
        const d = centre(i, j).distanceToSquared(point);
        if (d < bestD) { bestD = d; best = [i, j]; }
      }
      if (best) return best;
    }
    return null;
  }
  /** Can he walk straight from a to b? (`cheap`: and without crossing slower ground than either end's.) */
  function lineFree(a, b, cheap = false) {
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz), steps = Math.max(1, Math.ceil(length / (cell * 0.5)));
    const [ai, aj] = cellOf(a), [bi, bj] = cellOf(b);
    const most = cheap ? Math.max(inside(ai, aj) ? weight[aj * cols + ai] : 1, inside(bi, bj) ? weight[bj * cols + bi] : 1) : Infinity;
    for (let k = 0; k <= steps; k++) {
      const [i, j] = cellOf({ x: a.x + dx * k / steps, z: a.z + dz * k / steps });
      if (!free(i, j) || weight[j * cols + i] > most) return false;
    }
    return true;
  }
  const g = new Float32Array(cols * rows), from = new Int32Array(cols * rows), stamp = new Uint32Array(cols * rows), closed = new Uint32Array(cols * rows);
  let search = 0;
  const NEIGHBOURS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  /** Waypoints from `start` to `goal` (the last is the goal itself, or the nearest reachable point to it); null if there is no way. */
  function path(start, goal) {
    const a = nearestFree(start), b = nearestFree(goal);
    if (!a || !b) return null;
    const end = free(...cellOf(goal)) ? goal.clone().setY(0) : centre(...b);
    if (lineFree(start, end, true)) return [end];
    search++;
    const startIndex = a[1] * cols + a[0], goalIndex = b[1] * cols + b[0];
    const heap = new MinHeap();
    const h = index => { const i = index % cols, j = Math.floor(index / cols), dx = Math.abs(i - b[0]), dz = Math.abs(j - b[1]); return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz); };
    g[startIndex] = 0; from[startIndex] = -1; stamp[startIndex] = search;
    heap.push(startIndex, h(startIndex));
    let found = false;
    while (heap.size) {
      const index = heap.pop();
      if (closed[index] === search) continue;
      closed[index] = search;
      if (index === goalIndex) { found = true; break; }
      const i = index % cols, j = Math.floor(index / cols);
      for (const [di, dj, cost] of NEIGHBOURS) {
        const ni = i + di, nj = j + dj;
        if (!free(ni, nj)) continue;
        // No cutting a corner diagonally.
        if (di && dj && (!free(i + di, j) || !free(i, j + dj))) continue;
        const next = nj * cols + ni, score = g[index] + cost * (weight[index] + weight[next]) / 2;
        if (stamp[next] === search && score >= g[next]) continue;
        stamp[next] = search; g[next] = score; from[next] = index;
        heap.push(next, score + h(next));
      }
    }
    if (!found) return null;
    const cells = [];
    for (let index = goalIndex; index !== -1; index = from[index]) cells.push(centre(index % cols, Math.floor(index / cols)));
    cells.reverse();
    cells[cells.length - 1] = end;
    // Straighten: from each kept point, jump to the furthest one in plain view.
    const way = [];
    let here = start.clone().setY(0), k = 0;
    while (k < cells.length) {
      let far = k;
      for (let m = cells.length - 1; m > k; m--) if (lineFree(here, cells[m], true)) { far = m; break; }
      way.push(cells[far]);
      here = cells[far];
      k = far + 1;
    }
    return way;
  }
  return {
    path, lineFree, rebuild, cols, rows, cell,
    walkable: point => free(...cellOf(point)),
    /** The nearest walkable spot to a point (the point itself if it is walkable), or null. */
    nearest(point) {
      if (free(...cellOf(point))) return point.clone().setY(0);
      const cellAt = nearestFree(point);
      return cellAt ? centre(...cellAt) : null;
    },
  };
}

class MinHeap {
  constructor() { this.items = []; this.keys = []; }
  get size() { return this.items.length; }
  push(item, key) {
    const { items, keys } = this;
    let n = items.length;
    items.push(item); keys.push(key);
    while (n > 0) {
      const parent = (n - 1) >> 1;
      if (keys[parent] <= key) break;
      items[n] = items[parent]; keys[n] = keys[parent];
      n = parent;
    }
    items[n] = item; keys[n] = key;
  }
  pop() {
    const { items, keys } = this;
    const top = items[0], lastItem = items.pop(), lastKey = keys.pop();
    if (items.length) {
      let n = 0;
      const length = items.length;
      for (;;) {
        let child = 2 * n + 1;
        if (child >= length) break;
        if (child + 1 < length && keys[child + 1] < keys[child]) child++;
        if (keys[child] >= lastKey) break;
        items[n] = items[child]; keys[n] = keys[child];
        n = child;
      }
      items[n] = lastItem; keys[n] = lastKey;
    }
    return top;
  }
}
