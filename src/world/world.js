// evolve — world data structure
// (BIOME_WALKABLE is used by worldGen, not directly here)

export class World {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.tiles = []; // tiles[y][x]
    this.seed = 0;

    for (let y = 0; y < height; y++) {
      this.tiles[y] = [];
      for (let x = 0; x < width; x++) {
        this.tiles[y][x] = this._emptyTile();
      }
    }
  }

  _emptyTile() {
    return {
      type: "GRASSLAND",
      height: 0.5,
      temperature: 0.5,
      moisture: 0.5,
      walkable: true,
      river: false,
      fertility: 0.5,
      resources: { food: 0, wood: 0, stone: 0, water: 0, metal: 0 },
      agentIds: new Set(),
      civId: null,
    };
  }

  // ── Accessors ────────────────────────────────────────────

  getTile(x, y) {
    if (!this.isInBounds(x, y)) return null;
    return this.tiles[Math.floor(y)][Math.floor(x)];
  }

  setTileProps(x, y, props) {
    if (!this.isInBounds(x, y)) return;
    Object.assign(this.tiles[Math.floor(y)][Math.floor(x)], props);
  }

  isWalkable(x, y) {
    const t = this.getTile(x, y);
    return t ? t.walkable : false;
  }

  isInBounds(x, y) {
    const xi = Math.floor(x),
      yi = Math.floor(y);
    return xi >= 0 && xi < this.width && yi >= 0 && yi < this.height;
  }

  tileKey(x, y) {
    return `${Math.floor(x)},${Math.floor(y)}`;
  }

  fromKey(key) {
    const [x, y] = key.split(",").map(Number);
    return { x, y };
  }

  // ── Neighbour queries ────────────────────────────────────

  /** All tiles within a Chebyshev-distance radius (square neighbourhood). */
  getNeighborTiles(x, y, radius) {
    const result = [];
    const xi = Math.floor(x),
      yi = Math.floor(y);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = xi + dx,
          ny = yi + dy;
        if (this.isInBounds(nx, ny)) {
          result.push({ x: nx, y: ny, tile: this.tiles[ny][nx] });
        }
      }
    }
    return result;
  }

  /** Immediate walkable 4+4-direction neighbours. */
  getWalkableNeighbors(x, y) {
    const xi = Math.floor(x),
      yi = Math.floor(y);
    const dirs = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ];
    return dirs
      .map(([dx, dy]) => ({ x: xi + dx, y: yi + dy }))
      .filter((pos) => this.isWalkable(pos.x, pos.y));
  }

  /**
   * Find the nearest tile within `radius` that has `resource[type] >= threshold`.
   * Returns { x, y } or null.
   */
  findResourceNear(x, y, type, radius, threshold = 1) {
    const xi = Math.floor(x),
      yi = Math.floor(y);
    let best = null,
      bestDist = Infinity;

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = xi + dx,
          ny = yi + dy;
        if (!this.isInBounds(nx, ny)) continue;
        const t = this.tiles[ny][nx];
        if (t.resources[type] >= threshold) {
          const dist = Math.abs(dx) + Math.abs(dy);
          if (dist < bestDist) {
            bestDist = dist;
            best = { x: nx, y: ny };
          }
        }
      }
    }
    return best;
  }

  /** Iterate every tile with callback(tile, x, y). */
  forEach(cb) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        cb(this.tiles[y][x], x, y);
      }
    }
  }

  /** Find random walkable, non-ocean tile. Returns { x, y } or null. */
  randomLandTile(rng) {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const x = Math.floor(rng() * this.width);
      const y = Math.floor(rng() * this.height);
      const t = this.tiles[y][x];
      if (t.walkable && t.type !== "COAST" && t.type !== "BEACH") {
        return { x, y };
      }
    }
    return null;
  }
}
