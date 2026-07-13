// evolve — entry point & game loop
import { CONFIG } from "./config.js";
import { createRNG } from "./utils/seededRandom.js";
import { WorldGen } from "./world/worldGen.js";
import { AgentSystem } from "./systems/agentSystem.js";
import { ResourceSystem } from "./systems/resourceSystem.js";
import { CivSystem } from "./systems/civSystem.js";
import { CombatSystem } from "./systems/combatSystem.js";
import { EvolutionSystem } from "./systems/evolutionSystem.js";
import { EventSystem } from "./systems/eventSystem.js";
import { Camera } from "./rendering/camera.js";
import { Renderer } from "./rendering/renderer.js";
import { UI } from "./rendering/ui.js";

// ── Global game state ─────────────────────────────────────

/** True once the render loop has started (persists across restarts). */
let _loopStarted = false;
let _initInProgress = false;
let _uiFrameCounter = 0;

const game = {
  world: null,
  camera: null,
  systems: null,
  renderer: null,
  ui: null,
  running: true,
  speed: 1,
  tick: 0,
  seed: Date.now(),

  // Loop timing
  _lastTimestamp: 0,
  _accumulated: 0,
  _fps: 60,
  _fpsFrames: [],

  restart() {
    if (_initInProgress) return;
    game.seed = Date.now();
    _init(game.seed);
  },
};

// ── Initialisation ────────────────────────────────────────

async function _init(seed) {
  if (_initInProgress) return;
  _initInProgress = true;

  game.running = false;
  game.systems = null;

  _setLoading(true);
  _setLoadingStatus("Generating terrain…", 15);
  await _frame();

  const gen = new WorldGen(seed);
  const world = gen.generate();
  game.world = world;

  _setLoadingStatus("Initialising resources…", 40);
  await _frame();

  const resource = new ResourceSystem(world);

  _setLoadingStatus("Spawning agents…", 55);
  await _frame();

  const agent = new AgentSystem(world, resource, createRNG(seed + 1));
  const civ = new CivSystem(world, agent, createRNG(seed + 2));
  const combat = new CombatSystem(
    world,
    agent,
    civ,
    createRNG(seed + 4),
  );
  const evolution = new EvolutionSystem(agent);
  const eventSys = new EventSystem(
    world,
    { resource, agent, civ },
    createRNG(seed + 3),
  );

  agent.civSystem = civ;

  const systems = { resource, agent, civ, combat, evolution, event: eventSys };
  game.systems = systems;

  _setLoadingStatus("Placing agents…", 70);
  await _frame();

  agent.spawnInitial(CONFIG.INITIAL_AGENTS);

  _setLoadingStatus("Building camera…", 80);
  await _frame();

  const canvas = document.getElementById("world-canvas");
  if (!canvas) {
    _initInProgress = false;
    return;
  }
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  if (!game.camera) {
    game.camera = new Camera(canvas);
  }
  const camera = game.camera;
  camera.fitWorld();

  _setLoadingStatus("Initialising renderer…", 88);
  await _frame();

  const renderer = new Renderer(canvas, world, camera, systems);
  game.renderer = renderer;
  eventSys.setTerrainChangeHandler(() => renderer.invalidateTerrain());

  _setLoadingStatus("Building UI…", 95);
  await _frame();

  if (!game.ui) {
    game.ui = new UI(game, systems, renderer);
  } else {
    game.ui.rebind(systems, renderer);
  }

  game.tick = 0;
  game.speed = 1;
  game.running = true;
  game._accumulated = 0;
  game._lastTimestamp = performance.now();
  _uiFrameCounter = 0;

  _setLoadingStatus("Ready!", 100);
  await _frame();

  _setLoading(false);
  _resetLogCounters();

  _bridgeLogs(game);
  game.ui?.addEventLog("New world generated — simulation running.", "new");

  _initInProgress = false;

  if (!_loopStarted) {
    _loopStarted = true;
    requestAnimationFrame(_loop);
  }
}

// ── Game loop ─────────────────────────────────────────────

function _loop(timestamp) {
  requestAnimationFrame(_loop);

  if (game._lastTimestamp === 0) game._lastTimestamp = timestamp;
  const dt = Math.min(timestamp - game._lastTimestamp, 200);
  game._lastTimestamp = timestamp;

  game._fpsFrames.push(timestamp);
  if (game._fpsFrames.length > 60) game._fpsFrames.shift();
  if (game._fpsFrames.length > 1) {
    const span =
      game._fpsFrames[game._fpsFrames.length - 1] - game._fpsFrames[0];
    game._fps = (game._fpsFrames.length - 1) / (span / 1000);
  }

  if (game.running && game.systems) {
    game._accumulated += dt * game.speed;
    const maxCatchUp = CONFIG.TICK_MS * 10;
    if (game._accumulated > maxCatchUp) game._accumulated = maxCatchUp;

    while (game._accumulated >= CONFIG.TICK_MS) {
      _simulationTick();
      game._accumulated -= CONFIG.TICK_MS;
    }
  }

  game.camera?.update(dt);
  game.renderer?.render(timestamp);

  _uiFrameCounter++;
  if (_uiFrameCounter % 5 === 0) {
    game.ui?.update(game.tick, game._fps);
    _bridgeLogs(game);
  }
}

function _simulationTick() {
  const tick = ++game.tick;
  const systems = game.systems;
  if (!systems) return;

  systems.resource.update(tick);
  systems.agent.update(tick);
  systems.civ.update(tick);
  systems.combat.update(tick);
  systems.evolution.update(tick);
  systems.event.update(tick);
}

// ── Log bridging (civ + event + combat → UI event log) ──

let _lastCivLogLen = 0;
let _lastEventLogLen = 0;
let _lastCombatLogLen = 0;

function _resetLogCounters() {
  _lastCivLogLen = 0;
  _lastEventLogLen = 0;
  _lastCombatLogLen = 0;
}

function _bridgeLogs(game) {
  if (!game.ui || !game.systems) return;
  const { civ, event, combat } = game.systems;

  _bridgeLogSource(game.ui, civ.log, _lastCivLogLen, (len) => {
    _lastCivLogLen = len;
  }, (msg) => (msg.includes("WAR") ? "war" : "civ"));

  _bridgeLogSource(game.ui, event.log, _lastEventLogLen, (len) => {
    _lastEventLogLen = len;
  }, (msg) => {
    const lower = msg.toLowerCase();
    if (lower.includes("drought")) return "drought";
    if (lower.includes("plague")) return "plague";
    if (lower.includes("wildfire")) return "wildfire";
    if (lower.includes("flood")) return "flood";
    if (lower.includes("boom")) return "boom";
    return "new";
  });

  _bridgeLogSource(game.ui, combat.log, _lastCombatLogLen, (len) => {
    _lastCombatLogLen = len;
  }, (msg) => (msg.toLowerCase().includes("war") ? "war" : "civ"));
}

function _bridgeLogSource(ui, log, lastLen, setLen, getType) {
  if (!ui || log.length <= lastLen) return;
  const newEntries = log.slice(0, log.length - lastLen);
  setLen(log.length);
  for (const msg of newEntries.reverse()) {
    ui.addEventLog(msg, getType(msg));
  }
}

// ── Loading screen helpers ────────────────────────────────

function _setLoading(show) {
  document.getElementById("loading-screen")?.classList.toggle("hidden", !show);
  document.getElementById("simulation")?.classList.toggle("hidden", show);
}

function _setLoadingStatus(msg, pct) {
  const bar = document.getElementById("loading-bar");
  const status = document.getElementById("loading-status");
  if (bar) bar.style.width = pct + "%";
  if (status) status.textContent = msg;
}

function _frame() {
  return new Promise((r) => requestAnimationFrame(r));
}

// ── Window resize ─────────────────────────────────────────

window.addEventListener("resize", () => {
  const canvas = document.getElementById("world-canvas");
  if (canvas) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
});

// ── Boot ─────────────────────────────────────────────────

_init(game.seed);
