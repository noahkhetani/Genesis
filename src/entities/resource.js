// evolve — resource data tables (biome → initial / max / regen)
import { CONFIG } from '../config.js';

const F  = CONFIG.RESOURCE_FOOD_MAX;
const W  = CONFIG.RESOURCE_WOOD_MAX;
const S  = CONFIG.RESOURCE_STONE_MAX;
const Wt = CONFIG.RESOURCE_WATER_MAX;
const M  = CONFIG.RESOURCE_METAL_MAX;

/**
 * Per-biome resource definition.
 * Each entry is { init, max, regen } – resources not listed default to 0.
 */
const BIOME_RESOURCE_DEF = {
  DEEP_OCEAN : {
    food  : { init: 20,  max: F * 0.3, regen: 0.05 },
    water : { init: 300, max: Wt,      regen: 1.0  },
  },
  OCEAN : {
    food  : { init: 30,  max: F * 0.5, regen: 0.10 },
    water : { init: 300, max: Wt,      regen: 1.0  },
  },
  COAST : {
    food  : { init: 40,  max: F * 0.6, regen: 0.15 },
    water : { init: 200, max: Wt,      regen: 0.80 },
  },
  BEACH : {
    food  : { init: 20,  max: F * 0.3, regen: 0.08 },
    water : { init: 50,  max: 100,     regen: 0.10 },
    stone : { init: 30,  max: S * 0.4, regen: 0.001},
  },
  GRASSLAND : {
    food  : { init: 60,  max: F,       regen: 0.30 },
    water : { init: 20,  max: 80,      regen: 0.05 },
    wood  : { init: 20,  max: 50,      regen: 0.02 },
  },
  FOREST : {
    food  : { init: 40,  max: F * 0.7, regen: 0.20 },
    wood  : { init: 150, max: W,       regen: 0.10 },
    water : { init: 30,  max: 100,     regen: 0.05 },
  },
  SWAMP : {
    food  : { init: 30,  max: F * 0.5, regen: 0.15 },
    water : { init: 200, max: Wt * 0.8,regen: 0.50 },
    wood  : { init: 40,  max: 100,     regen: 0.03 },
  },
  DESERT : {
    food  : { init: 5,   max: 20,      regen: 0.01 },
    stone : { init: 80,  max: S,       regen: 0.001},
    metal : { init: 40,  max: M * 0.6, regen: 0.0005},
  },
  SAVANNA : {
    food  : { init: 40,  max: F * 0.7, regen: 0.20 },
    wood  : { init: 30,  max: 80,      regen: 0.03 },
    water : { init: 10,  max: 40,      regen: 0.02 },
  },
  TAIGA : {
    food  : { init: 20,  max: F * 0.4, regen: 0.10 },
    wood  : { init: 120, max: W * 0.8, regen: 0.07 },
    stone : { init: 40,  max: S * 0.5, regen: 0.001},
    water : { init: 20,  max: 80,      regen: 0.04 },
  },
  TUNDRA : {
    food  : { init: 10,  max: 30,      regen: 0.03 },
    stone : { init: 60,  max: S * 0.7, regen: 0.001},
    water : { init: 15,  max: 60,      regen: 0.02 },
  },
  MOUNTAIN : {
    food  : { init: 5,   max: 20,      regen: 0.02 },
    stone : { init: 120, max: S,       regen: 0.002},
    metal : { init: 60,  max: M,       regen: 0.001},
  },
  SNOW_PEAK : {
    stone : { init: 40,  max: 80,      regen: 0.001},
    water : { init: 50,  max: 100,     regen: 0.10 },
  },
};

const TYPES = ['food', 'wood', 'stone', 'water', 'metal'];

function _make(biome, field) {
  const def = BIOME_RESOURCE_DEF[biome] ?? {};
  const out  = { food: 0, wood: 0, stone: 0, water: 0, metal: 0 };
  for (const t of TYPES) {
    out[t] = def[t]?.[field] ?? 0;
  }
  return out;
}

/** Starting resource quantities for a biome. */
export function getInitialResources(biome) { return _make(biome, 'init');  }

/** Maximum resource quantities for a biome. */
export function getMaxResources(biome)     { return _make(biome, 'max');   }

/** Per-tick resource regeneration rates for a biome. */
export function getRegenRates(biome)       { return _make(biome, 'regen'); }
