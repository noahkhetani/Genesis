// evolve — resource system
import { RESOURCE_TYPES } from '../config.js';
import { getMaxResources, getRegenRates } from '../entities/resource.js';

export class ResourceSystem {
  constructor(world) {
    this.world = world;

    // Precompute per-tile base regen rates and max values
    const W = world.width, H = world.height;
    this._regen    = [];   // [y][x] = {food,wood,stone,water,metal}
    this._max      = [];
    this._modifier = [];   // multiplier for each resource type

    for (let y = 0; y < H; y++) {
      this._regen[y]    = [];
      this._max[y]      = [];
      this._modifier[y] = [];
      for (let x = 0; x < W; x++) {
        const type = world.tiles[y][x].type;
        this._regen[y][x]    = getRegenRates(type);
        this._max[y][x]      = getMaxResources(type);
        this._modifier[y][x] = { food:1, wood:1, stone:1, water:1, metal:1 };
      }
    }
  }

  update(_tick) {
    const W = this.world.width, H = this.world.height;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const res = this.world.tiles[y][x].resources;
        const regen = this._regen[y][x];
        const max   = this._max[y][x];
        const mod   = this._modifier[y][x];
        for (const t of RESOURCE_TYPES) {
          if (regen[t] > 0) {
            res[t] = Math.min(res[t] + regen[t] * mod[t], max[t]);
          }
        }
      }
    }
  }

  /** Consume up to `amount` of `type` at tile (x,y). Returns amount consumed. */
  consume(x, y, type, amount) {
    const tile = this.world.getTile(x, y);
    if (!tile) return 0;
    const actual = Math.min(tile.resources[type], amount);
    tile.resources[type] -= actual;
    return actual;
  }

  getAt(x, y, type) {
    return this.world.getTile(x, y)?.resources[type] ?? 0;
  }

  add(x, y, type, amount) {
    const tile = this.world.getTile(x, y);
    if (!tile) return;
    const max = this._max[Math.floor(y)][Math.floor(x)][type];
    tile.resources[type] = Math.min(tile.resources[type] + amount, max);
  }

  /** Set food regen multiplier for all tiles within radius. */
  applyDrought(cx, cy, radius, factor) {
    this._applyModifier(cx, cy, radius, 'food', factor);
  }

  /** Set all-resource regen multiplier for tiles within radius. */
  applyResourceBoom(cx, cy, radius, factor) {
    for (const t of RESOURCE_TYPES) {
      this._applyModifier(cx, cy, radius, t, factor);
    }
  }

  /** Recompute regen/max for one tile after biome changes (e.g. wildfire). */
  refreshTile(x, y) {
    if (!this.world.isInBounds(x, y)) return;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const type = this.world.tiles[yi][xi].type;
    this._regen[yi][xi] = getRegenRates(type);
    this._max[yi][xi] = getMaxResources(type);
  }

  /** Refresh all tiles within a circular radius (used after wildfires). */
  refreshBiomeInRadius(cx, cy, radius) {
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(this.world.width - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(this.world.height - 1, Math.ceil(cy + radius));
    const r2 = radius * radius;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) this.refreshTile(x, y);
      }
    }
  }

  _applyModifier(cx, cy, radius, type, factor) {
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(this.world.width  - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(this.world.height - 1, Math.ceil(cy + radius));
    const r2   = radius * radius;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx*dx + dy*dy <= r2) {
          this._modifier[y][x][type] = factor;
        }
      }
    }
  }
}
