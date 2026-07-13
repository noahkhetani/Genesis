// evolve — event system  (droughts, wildfires, plagues, …)
import { CONFIG, EVENT_TYPES } from '../config.js';

let _evtId = 0;

export class EventSystem {
  constructor(world, systems, rng) {
    this.world   = world;
    this.systems = systems;   // { resource, agent, civ }
    this.rng     = rng;

    this.log            = [];   // last 30 messages
    this._active        = [];   // WorldEvent[]
    this._floodTiles    = new Map(); // evtId → [{x,y,wasWalkable}]
    this._onTerrainChange = null;
  }

  setTerrainChangeHandler(fn) {
    this._onTerrainChange = fn;
  }

  _notifyTerrainChange() {
    this._onTerrainChange?.();
  }

  getActiveEvents() { return [...this._active]; }

  // ── Main tick ────────────────────────────────────────────

  update(tick) {
    // Spawn check
    if (tick > 0 && tick % CONFIG.EVENT_CHECK_INTERVAL === 0) {
      if (this.rng() < CONFIG.EVENT_CHANCE) {
        this._spawnRandom(tick);
      }
    }

    // Update active events
    for (let i = this._active.length - 1; i >= 0; i--) {
      const e = this._active[i];
      e.remainingDuration--;

      this._applyOngoing(e, tick);

      if (e.remainingDuration <= 0) {
        this._onEnd(e, tick);
        this._active.splice(i, 1);
      }
    }
  }

  // ── Spawn ─────────────────────────────────────────────────

  _spawnRandom(tick) {
    // Find random walkable land tile
    let ex = Math.floor(this.rng() * this.world.width);
    let ey = Math.floor(this.rng() * this.world.height);
    for (let att = 0; att < 100; att++) {
      const tx = Math.floor(this.rng() * this.world.width);
      const ty = Math.floor(this.rng() * this.world.height);
      const t  = this.world.getTile(tx, ty);
      if (t?.walkable) { ex = tx; ey = ty; break; }
    }

    const types = Object.values(EVENT_TYPES);
    const type  = types[Math.floor(this.rng() * types.length)];
    this._spawnEvent(type, ex, ey, tick);
  }

  _spawnEvent(type, x, y, tick) {
    const rng = this.rng;
    let evt;

    if (type === EVENT_TYPES.DROUGHT) {
      evt = {
        id: `evt_${++_evtId}`, type, x, y,
        radius   : 15 + Math.floor(rng() * 11),
        duration : 800 + Math.floor(rng() * 701),
        intensity: 0.6 + rng() * 0.3,
        name     : 'Drought',
        description: 'A severe drought grips the region',
        color    : '#cc6600',
        startTick: tick,
      };
      evt.remainingDuration = evt.duration;
      this.systems.resource.applyDrought(x, y, evt.radius, 1 - evt.intensity);
    }
    else if (type === EVENT_TYPES.WILDFIRE) {
      evt = {
        id: `evt_${++_evtId}`, type, x, y,
        radius   : 5 + Math.floor(rng() * 8),
        duration : 150 + Math.floor(rng() * 151),
        intensity: 0.8 + rng() * 0.2,
        name     : 'Wildfire',
        description: 'A wildfire tears through the forest',
        color    : '#ff4400',
        startTick: tick,
      };
      evt.remainingDuration = evt.duration;
      // Convert forest tiles & destroy wood
      const r2 = evt.radius * evt.radius;
      this.world.forEach((tile, tx, ty) => {
        const dx = tx - x, dy = ty - y;
        if (dx*dx + dy*dy > r2) return;
        if (tile.type === 'FOREST' || tile.type === 'TAIGA') {
          tile.type = 'GRASSLAND';
          tile.walkable = true;
        }
        tile.resources.wood *= (1 - evt.intensity * 0.8);
      });
      this.systems.resource.refreshBiomeInRadius(x, y, evt.radius);
      this._notifyTerrainChange();
    }
    else if (type === EVENT_TYPES.PLAGUE) {
      evt = {
        id: `evt_${++_evtId}`, type, x, y,
        radius   : 10 + Math.floor(rng() * 11),
        duration : 400 + Math.floor(rng() * 401),
        intensity: 0.3 + rng() * 0.4,
        name     : 'Plague',
        description: 'A plague spreads across the land',
        color    : '#8800cc',
        startTick: tick,
      };
      evt.remainingDuration = evt.duration;
    }
    else if (type === EVENT_TYPES.FLOOD) {
      evt = {
        id: `evt_${++_evtId}`, type, x, y,
        radius   : 8 + Math.floor(rng() * 8),
        duration : 200 + Math.floor(rng() * 201),
        intensity: 0.5 + rng() * 0.5,
        name     : 'Flood',
        description: 'Floodwaters surge across the lowlands',
        color    : '#0044ff',
        startTick: tick,
      };
      evt.remainingDuration = evt.duration;
      // Make low-lying tiles temporarily unwalkable
      const affectedTiles = [];
      const r2 = evt.radius * evt.radius;
      this.world.forEach((tile, tx, ty) => {
        const dx = tx - x, dy = ty - y;
        if (dx*dx + dy*dy > r2) return;
        if (tile.type === 'BEACH' || tile.type === 'COAST' || tile.height < 0.52) {
          affectedTiles.push({ x: tx, y: ty, wasWalkable: tile.walkable });
          tile.walkable = false;
        }
      });
      this._floodTiles.set(evt.id, affectedTiles);
      this._ejectAgentsFromFloodedTiles();
    }
    else if (type === EVENT_TYPES.RESOURCE_BOOM) {
      evt = {
        id: `evt_${++_evtId}`, type, x, y,
        radius   : 15 + Math.floor(rng() * 11),
        duration : 600 + Math.floor(rng() * 401),
        intensity: 2.0 + rng() * 1.0,
        name     : 'Resource Boom',
        description: 'Resources flourish across the region',
        color    : '#00cc44',
        startTick: tick,
      };
      evt.remainingDuration = evt.duration;
      this.systems.resource.applyResourceBoom(x, y, evt.radius, evt.intensity);
    }

    if (evt) {
      this._active.push(evt);
      this._addLog(`[T${tick}] ⚡ ${evt.name}: ${evt.description}`);
    }
  }

  // ── Ongoing effects ──────────────────────────────────────

  _applyOngoing(e, tick) {
    if (e.type === EVENT_TYPES.FLOOD && tick % 10 === 0) {
      this._ejectAgentsFromFloodedTiles();
    }

    if (e.type === EVENT_TYPES.WILDFIRE || e.type === EVENT_TYPES.PLAGUE || e.type === EVENT_TYPES.FLOOD) {
      if (tick % 5 !== 0) return; // apply every 5 ticks for performance
      const damagePerTick = e.type === EVENT_TYPES.WILDFIRE ? 3 * e.intensity
                          : e.type === EVENT_TYPES.PLAGUE   ? e.intensity * 0.4
                          : 2; // flood
      const r2 = e.radius * e.radius;
      const agentSys = this.systems.agent;
      for (const a of agentSys.agents.values()) {
        if (!a.isAlive) continue;
        const dx = a.x - e.x, dy = a.y - e.y;
        if (dx*dx + dy*dy <= r2) {
          agentSys.damage(a, damagePerTick);
        }
      }
    }
  }

  _ejectAgentsFromFloodedTiles() {
    const agentSys = this.systems.agent;
    for (const a of agentSys.agents.values()) {
      if (!a.isAlive) continue;
      if (!this.world.isWalkable(a.x, a.y)) {
        if (!agentSys.ejectFromTile(a)) {
          agentSys.damage(a, 25);
        }
      }
    }
  }

  // ── Cleanup on expiry ─────────────────────────────────────

  _onEnd(e, tick) {
    if (e.type === EVENT_TYPES.DROUGHT) {
      this.systems.resource.applyDrought(e.x, e.y, e.radius, 1.0);
    } else if (e.type === EVENT_TYPES.RESOURCE_BOOM) {
      this.systems.resource.applyResourceBoom(e.x, e.y, e.radius, 1.0);
    } else if (e.type === EVENT_TYPES.FLOOD) {
      const tiles = this._floodTiles.get(e.id) ?? [];
      for (const { x, y, wasWalkable } of tiles) {
        this.world.setTileProps(x, y, { walkable: wasWalkable });
      }
      this._floodTiles.delete(e.id);
    }
    this._addLog(`[T${tick}] ${e.name} at (${e.x},${e.y}) has ended`);
  }

  // ── Helpers ──────────────────────────────────────────────

  _addLog(msg) {
    this.log.unshift(msg);
    if (this.log.length > 30) this.log.length = 30;
  }
}
