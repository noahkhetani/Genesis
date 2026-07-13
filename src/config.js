// evolve — global configuration

export const CONFIG = {
  // World
  WORLD_WIDTH: 256,
  WORLD_HEIGHT: 200,
  TILE_SIZE: 6,           // pixels per tile at zoom = 1

  // Simulation
  INITIAL_AGENTS: 400,
  MAX_AGENTS: 3000,
  TICK_MS: 50,            // ms per simulation tick  (= 20 ticks/sec)

  // Agent stats
  AGENT_HUNGER_RATE: 0.1,
  AGENT_STAMINA_DRAIN: 0.15,
  AGENT_STAMINA_REGEN: 0.25,
  AGENT_HEALTH_REGEN: 0.02,
  AGENT_STARVATION_DAMAGE: 0.4,
  AGENT_BASE_MAX_AGE: 2000,
  AGENT_AGE_VARIANCE: 800,
  AGENT_VISION: 10,
  AGENT_EAT_AMOUNT: 25,
  AGENT_REPRODUCE_MIN_AGE: 200,
  AGENT_REPRODUCE_COOLDOWN: 400,
  AGENT_REPRODUCE_HUNGER_MAX: 40,
  AGENT_REPRODUCE_HEALTH_MIN: 50,
  AGENT_ATTACK_RANGE: 1.5,
  AGENT_ATTACK_COOLDOWN: 5,
  MUTATION_RATE: 0.1,

  // Resources
  RESOURCE_FOOD_MAX: 100,
  RESOURCE_WOOD_MAX: 200,
  RESOURCE_STONE_MAX: 150,
  RESOURCE_WATER_MAX: 300,
  RESOURCE_METAL_MAX: 80,

  // Civilization
  CIV_FORM_MIN_AGENTS: 6,
  CIV_FORM_RADIUS: 5,
  CIV_CHECK_INTERVAL: 150,
  CIV_TERRITORY_RADIUS: 8,
  CIV_EXPAND_INTERVAL: 600,
  CIV_MAX_TERRITORY: 500,

  // Camera
  ZOOM_MIN: 0.3,
  ZOOM_MAX: 6,
  ZOOM_STEP: 0.15,
  PAN_SPEED: 300,         // world-pixels per second (keyboard)

  // Events
  EVENT_CHANCE: 0.15,     // probability per EVENT_CHECK_INTERVAL
  EVENT_CHECK_INTERVAL: 2000,
};

// ── Terrain type strings ──────────────────────────────────
export const TERRAIN = {
  DEEP_OCEAN : 'DEEP_OCEAN',
  OCEAN      : 'OCEAN',
  COAST      : 'COAST',
  BEACH      : 'BEACH',
  GRASSLAND  : 'GRASSLAND',
  FOREST     : 'FOREST',
  SWAMP      : 'SWAMP',
  DESERT     : 'DESERT',
  SAVANNA    : 'SAVANNA',
  TAIGA      : 'TAIGA',
  TUNDRA     : 'TUNDRA',
  MOUNTAIN   : 'MOUNTAIN',
  SNOW_PEAK  : 'SNOW_PEAK',
};

// ── Biome base colours ────────────────────────────────────
export const BIOME_COLORS = {
  DEEP_OCEAN : '#0d1b2a',
  OCEAN      : '#1a3a5c',
  COAST      : '#1e4d6e',
  BEACH      : '#c4a96d',
  GRASSLAND  : '#4a7c3f',
  FOREST     : '#2d5a1b',
  SWAMP      : '#3d5a3a',
  DESERT     : '#c4a84e',
  SAVANNA    : '#8f8a3d',
  TAIGA      : '#3d6e50',
  TUNDRA     : '#7a8e7a',
  MOUNTAIN   : '#6e6460',
  SNOW_PEAK  : '#d0d8e0',
};

// ── Whether agents can walk on each biome ────────────────
export const BIOME_WALKABLE = {
  DEEP_OCEAN : false,
  OCEAN      : false,
  COAST      : true,
  BEACH      : true,
  GRASSLAND  : true,
  FOREST     : true,
  SWAMP      : true,
  DESERT     : true,
  SAVANNA    : true,
  TAIGA      : true,
  TUNDRA     : true,
  MOUNTAIN   : true,
  SNOW_PEAK  : false,
};

// ── Agent state enum ──────────────────────────────────────
export const AGENT_STATES = {
  IDLE      : 'IDLE',
  WANDER    : 'WANDER',
  SEEK_FOOD : 'SEEK_FOOD',
  EAT       : 'EAT',
  FLEE      : 'FLEE',
  ATTACK    : 'ATTACK',
  REPRODUCE : 'REPRODUCE',
  GATHER    : 'GATHER',
  MIGRATE   : 'MIGRATE',
  REST      : 'REST',
};

// ── World event type enum ─────────────────────────────────
export const EVENT_TYPES = {
  DROUGHT       : 'DROUGHT',
  WILDFIRE      : 'WILDFIRE',
  PLAGUE        : 'PLAGUE',
  FLOOD         : 'FLOOD',
  RESOURCE_BOOM : 'RESOURCE_BOOM',
};

export const RESOURCE_TYPES = ['food', 'wood', 'stone', 'water', 'metal'];
