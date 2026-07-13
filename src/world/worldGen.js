// evolve — procedural world generator
// Seven deterministic steps, all driven by a single integer seed.
import { SimplexNoise }                   from '../utils/noise.js';
import { createRNG, seededInt, seededFloat } from '../utils/seededRandom.js';
import { World }                           from './world.js';
import { TERRAIN, BIOME_WALKABLE, CONFIG } from '../config.js';
import { getInitialResources }             from '../entities/resource.js';

// ════════════════════════════════════════════════════════════
export class WorldGen {
  /**
   * @param {number} seed  Integer — drives every RNG in the pipeline.
   *                       The same seed always produces an identical world.
   */
  constructor(seed) {
    this.seed = seed >>> 0;   // coerce to uint32 for consistent noise
  }

  // ──────────────────────────────────────────────────────────
  // Public entry point
  // ──────────────────────────────────────────────────────────

  /**
   * Run all seven generation steps in sequence and return a fully
   * populated {@link World} instance ready for simulation.
   * @returns {World}
   */
  generate() {
    const world  = new World(CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT);
    world.seed   = this.seed;

    const W   = world.width;
    const H   = world.height;
    const rng = createRNG(this.seed);

    // ── Step 1 ──────────────────────────────────────────────
    const heightMap   = this._buildHeightMap(W, H);

    // ── Step 2 ──────────────────────────────────────────────
    const tempMap     = this._buildTempMap(W, H, heightMap);

    // ── Step 3 ──────────────────────────────────────────────
    const moistureMap = this._buildMoistureMap(W, H);

    // ── Step 4 ──────────────────────────────────────────────
    this._assignBiomes(world, W, H, heightMap, tempMap, moistureMap);

    // ── Step 5 ──────────────────────────────────────────────
    this._generateRivers(world, rng);

    // ── Step 6 ──────────────────────────────────────────────
    this._placeResources(world, rng);

    // ── Step 7 ──────────────────────────────────────────────
    this._finalPass(world);

    return world;
  }

  // ══════════════════════════════════════════════════════════
  // Step 1 — Height Map
  // ══════════════════════════════════════════════════════════

  /**
   * Sample 8-octave FBM, apply a radial island gradient to push
   * the edges toward ocean, then normalise the whole map to [0, 1].
   * @returns {Float64Array}  Flat array, index = y * W + x.
   */
  _buildHeightMap(W, H) {
    const noise   = new SimplexNoise(this.seed);
    const heightMap = new Float64Array(W * H);

    const cx      = W / 2;
    const cy      = H / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);

    // ── First pass: FBM + island gradient ───────────────────
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // 8-octave FBM in [-1, 1]
        const raw = noise.fbm(x * 0.006, y * 0.006, 8, 0.5, 2.0);

        // Radial distance from world centre (0 = centre, ~1 = corner)
        const dx       = x - cx;
        const dy       = y - cy;
        const dist     = Math.sqrt(dx * dx + dy * dy) / maxDist;
        const gradient = Math.min(1, dist * 0.8);   // clamp to [0, 1]

        // Normalise FBM to [0,1], then crush edges toward sea level
        const h = ((raw + 1) * 0.5) * (1 - gradient * 0.75);

        heightMap[y * W + x] = h;
      }
    }

    // ── Second pass: min/max normalise to exactly [0, 1] ────
    let minH =  Infinity;
    let maxH = -Infinity;
    for (let i = 0; i < W * H; i++) {
      if (heightMap[i] < minH) minH = heightMap[i];
      if (heightMap[i] > maxH) maxH = heightMap[i];
    }
    const hRange = (maxH - minH) || 1;   // guard against a perfectly flat map
    for (let i = 0; i < W * H; i++) {
      heightMap[i] = (heightMap[i] - minH) / hRange;
    }

    return heightMap;
  }

  // ══════════════════════════════════════════════════════════
  // Step 2 — Temperature Map
  // ══════════════════════════════════════════════════════════

  /**
   * Temperature is driven by three factors:
   *   1. Latitude gradient (y=0 = cold poles, y=H = warm equator)
   *   2. Altitude cooling above the mid-height threshold
   *   3. A low-frequency noise field for regional climate variation
   *
   * Result is clamped to [0, 1].
   * @returns {Float64Array}
   */
  _buildTempMap(W, H, heightMap) {
    const noise   = new SimplexNoise(this.seed + 1);
    const tempMap = new Float64Array(W * H);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const h = heightMap[y * W + x];

        // Latitude: y=0 → cold (0.1), y=H → warm (0.9)
        let temp = 0.1 + (y / H) * 0.8;

        // Altitude cooling — every unit above 0.5 drops temp by 0.5
        if (h > 0.5) temp -= (h - 0.5) * 0.5;

        // Regional noise variation (scale 0.01, amplitude ±0.15)
        temp += noise.noise2D(x * 0.01, y * 0.01) * 0.15;

        tempMap[y * W + x] = Math.max(0, Math.min(1, temp));
      }
    }

    return tempMap;
  }

  // ══════════════════════════════════════════════════════════
  // Step 3 — Moisture Map
  // ══════════════════════════════════════════════════════════

  /**
   * 5-octave FBM (distinct seed from height) normalised to [0, 1].
   * Rivers will add extra moisture to adjacent tiles in Step 5.
   * @returns {Float64Array}
   */
  _buildMoistureMap(W, H) {
    const noise       = new SimplexNoise(this.seed + 2);
    const moistureMap = new Float64Array(W * H);

    let minM =  Infinity;
    let maxM = -Infinity;

    // ── First pass: raw FBM ──────────────────────────────────
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const raw = noise.fbm(x * 0.012, y * 0.012, 5, 0.5, 2.0);
        moistureMap[y * W + x] = raw;
        if (raw < minM) minM = raw;
        if (raw > maxM) maxM = raw;
      }
    }

    // ── Second pass: normalise to [0, 1] ────────────────────
    const mRange = (maxM - minM) || 1;
    for (let i = 0; i < W * H; i++) {
      moistureMap[i] = (moistureMap[i] - minM) / mRange;
    }

    return moistureMap;
  }

  // ══════════════════════════════════════════════════════════
  // Step 4 — Biome Assignment
  // ══════════════════════════════════════════════════════════

  /**
   * Classify each tile using the (height, temperature, moisture) triple,
   * then write all computed properties into the world's tile objects.
   */
  _assignBiomes(world, W, H, heightMap, tempMap, moistureMap) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        const h   = heightMap  [idx];
        const t   = tempMap    [idx];
        const m   = moistureMap[idx];

        const type = _classifyBiome(h, t, m);

        // Fertility peaks at moderate temperature + high moisture.
        //   term1: moisture contribution (0→0, 1→0.5)
        //   term2: temperature penalty  (0.5→0.5, 0 or 1→0)
        const fertility = Math.max(0, Math.min(1,
          m * 0.5 + (1 - Math.abs(t - 0.5) * 2) * 0.5,
        ));

        world.setTileProps(x, y, {
          type,
          height      : h,
          temperature : t,
          moisture    : m,
          walkable    : BIOME_WALKABLE[type],
          fertility,
        });
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // Step 5 — River Generation
  // ══════════════════════════════════════════════════════════

  /**
   * Generate 15–25 rivers that flow downhill from mountain sources
   * to the coast.  After all rivers are traced, apply moisture boosts:
   *   • River tile itself: moisture + 0.1
   *   • All immediate (radius-1) neighbours: moisture + 0.3
   */
  _generateRivers(world, rng) {
    const candidates = _findRiverSources(world);
    const numRivers  = seededInt(15, 25, rng);

    for (let r = 0; r < numRivers; r++) {
      if (candidates.length === 0) break;

      // Pick a random mountain source (non-destructive — multiple rivers
      // may share a source and diverge based on local topology).
      const srcIdx = Math.floor(rng() * candidates.length);
      _traceRiver(world, candidates[srcIdx].x, candidates[srcIdx].y);
    }

    // ── Post-river moisture boost ────────────────────────────
    // Collect river coords first to avoid modifying moisture mid-loop.
    const riverCoords = [];
    world.forEach((tile, x, y) => {
      if (tile.river) riverCoords.push({ x, y });
    });

    for (const { x, y } of riverCoords) {
      const tile = world.getTile(x, y);

      // The river tile itself gains extra moisture (+0.1).
      world.setTileProps(x, y, {
        moisture: Math.min(1, tile.moisture + 0.1),
      });

      // Adjacent land tiles gain +0.3 moisture from proximity to water.
      const neighbours = world.getNeighborTiles(x, y, 1);
      for (const n of neighbours) {
        world.setTileProps(n.x, n.y, {
          moisture: Math.min(1, n.tile.moisture + 0.3),
        });
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // Step 6 — Initial Resources
  // ══════════════════════════════════════════════════════════

  /**
   * Seed each tile with its biome's initial resource quantities,
   * applying a ±20 % random variation so the world doesn't feel uniform.
   * River tiles receive an additional +30 fresh water on top.
   */
  _placeResources(world, rng) {
    world.forEach((tile, x, y) => {
      const base = getInitialResources(tile.type);

      // ±20 % variation: multiplier ∈ [0.8, 1.2)
      const resources = {
        food  : Math.floor(base.food   * seededFloat(0.8, 1.2, rng)),
        wood  : Math.floor(base.wood   * seededFloat(0.8, 1.2, rng)),
        stone : Math.floor(base.stone  * seededFloat(0.8, 1.2, rng)),
        water : Math.floor(base.water  * seededFloat(0.8, 1.2, rng)),
        metal : Math.floor(base.metal  * seededFloat(0.8, 1.2, rng)),
      };

      // River tiles carry a guaranteed fresh-water bonus.
      if (tile.river) {
        resources.water = Math.min(300, resources.water + 30);
      }

      world.setTileProps(x, y, { resources });
    });
  }

  // ══════════════════════════════════════════════════════════
  // Step 7 — Final Pass
  // ══════════════════════════════════════════════════════════

  /**
   * Consistency sweep: re-derive `walkable` from the current tile type
   * to ensure no flags drifted out of sync during river processing.
   */
  _finalPass(world) {
    world.forEach((tile, x, y) => {
      const expected = BIOME_WALKABLE[tile.type] ?? false;
      if (tile.walkable !== expected) {
        world.setTileProps(x, y, { walkable: expected });
      }
    });
  }
}

// ════════════════════════════════════════════════════════════
// Module-private helpers
// ════════════════════════════════════════════════════════════

/**
 * Classify a single tile into a TERRAIN type based on its
 * (height, temperature, moisture) triple.
 *
 * Conditions are tested from most-specific (ocean floor, peaks)
 * to least-specific (grassland fallback).
 *
 * @param {number} h  Height      [0, 1]
 * @param {number} t  Temperature [0, 1]
 * @param {number} m  Moisture    [0, 1]
 * @returns {string}  One of the TERRAIN constant strings.
 */
function _classifyBiome(h, t, m) {
  // ── Water / low-lying land ───────────────────────────────
  if      (h < 0.35)                       return TERRAIN.DEEP_OCEAN;
  else if (h < 0.44)                       return TERRAIN.OCEAN;
  else if (h < 0.47)                       return TERRAIN.COAST;
  else if (h < 0.50)                       return TERRAIN.BEACH;

  // ── High elevation (checked before anything else) ────────
  // Very high peaks: cold → snow, warm → bare mountain
  else if (h > 0.88)                       return t < 0.3 ? TERRAIN.SNOW_PEAK : TERRAIN.MOUNTAIN;
  // Moderate high: always mountain regardless of climate
  else if (h > 0.75)                       return TERRAIN.MOUNTAIN;

  // ── Cold climate (h = 0.50 – 0.75) ───────────────────────
  else if (t < 0.2)                        return TERRAIN.TUNDRA;
  else if (t < 0.35)                       return m > 0.4 ? TERRAIN.TAIGA : TERRAIN.TUNDRA;

  // ── Hot / dry climate ─────────────────────────────────────
  else if (t >= 0.70 && m < 0.20)          return TERRAIN.DESERT;
  else if (t >= 0.60 && m < 0.35)          return TERRAIN.SAVANNA;

  // ── Hot / wet climate ────────────────────────────────────
  else if (t >= 0.55 && m > 0.65)          return TERRAIN.SWAMP;

  // ── Temperate ─────────────────────────────────────────────
  else if (m > 0.55)                       return TERRAIN.FOREST;
  else                                     return TERRAIN.GRASSLAND;
}

// ──────────────────────────────────────────────────────────────
/**
 * Collect mountain / snow-peak tiles that are not immediately
 * adjacent to ocean (Chebyshev radius 5).  Interior sources produce
 * longer, more interesting rivers.
 *
 * Falls back to ANY mountain tile if none are far enough from ocean
 * (can happen on very small or low-variance seeds).
 *
 * @param {World} world
 * @returns {{ x: number, y: number }[]}
 */
function _findRiverSources(world) {
  const _isMountain = (type) =>
    type === TERRAIN.MOUNTAIN || type === TERRAIN.SNOW_PEAK;

  const _isOcean = (type) =>
    type === TERRAIN.DEEP_OCEAN || type === TERRAIN.OCEAN;

  const primary   = [];   // inland mountain tiles (preferred)
  const secondary = [];   // any mountain tile (fallback)

  world.forEach((tile, x, y) => {
    if (!_isMountain(tile.type)) return;

    secondary.push({ x, y });

    // Accept as a river source only if no ocean lies within 5 tiles.
    const nearOcean = world
      .getNeighborTiles(x, y, 5)
      .some(n => _isOcean(n.tile.type));

    if (!nearOcean) primary.push({ x, y });
  });

  return primary.length > 0 ? primary : secondary;
}

// ──────────────────────────────────────────────────────────────
/**
 * Trace a single river from (sx, sy) toward the sea by always
 * stepping to the lowest unvisited neighbour.
 *
 * Stopping conditions (whichever comes first):
 *   • The current tile is ocean or coast
 *   • The path exceeds 80 tiles
 *   • There is no unvisited lower-height neighbour (local minimum)
 *   • A cycle is detected via the visited set
 *
 * Every valid land tile along the path is marked `river: true`.
 *
 * @param {World}  world
 * @param {number} sx    Source tile X
 * @param {number} sy    Source tile Y
 */
function _traceRiver(world, sx, sy) {
  const OCEAN_TYPES = new Set([
    TERRAIN.DEEP_OCEAN,
    TERRAIN.OCEAN,
    TERRAIN.COAST,
  ]);
  const MAX_PATH = 80;

  let x = sx;
  let y = sy;
  const visited = new Set();   // per-river cycle guard

  for (let step = 0; step < MAX_PATH; step++) {
    const key = world.tileKey(x, y);
    if (visited.has(key)) break;   // cycle detected
    visited.add(key);

    const tile = world.getTile(x, y);
    if (!tile) break;

    // Stop when we reach a water tile (river has reached the sea).
    if (OCEAN_TYPES.has(tile.type)) break;

    // Mark this tile as carrying a river.
    world.setTileProps(x, y, { river: true });

    // ── Downhill flow: find the lowest unvisited neighbour ──
    // getNeighborTiles(r=1) returns all 8 immediate neighbours.
    const neighbours = world.getNeighborTiles(x, y, 1);

    let nextX   = -1;
    let nextY   = -1;
    let lowestH = tile.height;   // must beat current height to flow

    for (const n of neighbours) {
      if (visited.has(world.tileKey(n.x, n.y))) continue;
      if (n.tile.height < lowestH) {
        lowestH = n.tile.height;
        nextX   = n.x;
        nextY   = n.y;
      }
    }

    // No downhill exit found — river terminates at a local minimum.
    if (nextX === -1) break;

    x = nextX;
    y = nextY;
  }
}
