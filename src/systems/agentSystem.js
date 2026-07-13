// evolve — agent system  (ai + movement + lifecycle)
import { CONFIG, AGENT_STATES } from '../config.js';
import { Agent } from '../entities/agent.js';

const CELL = 10; // spatial grid cell size in tiles

export class AgentSystem {
  constructor(world, resourceSystem, rng) {
    this.world          = world;
    this.resourceSystem = resourceSystem;
    this.rng            = rng;

    this.agents    = new Map();   // id → Agent (alive + recently dead)
    this._grid     = new Map();   // cellKey → Set<agentId>
    this._deadCount = 0;
    this._pending  = [];          // children queued for next tick
    this._aliveCount = 0;

    // Expose civSystem reference (set by main after construction)
    this.civSystem = null;
  }

  get deadCount() { return this._deadCount; }

  // ── Public API ───────────────────────────────────────────

  getCount() {
    return this._aliveCount;
  }

  spawn(x, y, traits, civId = null) {
    const a = new Agent(x, y, traits);
    a.civId = civId;
    if (civId) a._updateColor();
    this.agents.set(a.id, a);
    this.world.getTile(x, y)?.agentIds.add(a.id);
    this._gridAdd(a);
    this._aliveCount++;
    return a;
  }

  /** Apply damage; kills the agent immediately when health reaches 0. */
  damage(a, amount, killer = null) {
    if (!a?.isAlive) return;
    a.health -= amount;
    if (a.health <= 0) {
      if (killer?.isAlive && killer.id !== a.id) {
        killer.kills++;
        if (killer.civId && this.civSystem) {
          const civ = this.civSystem.getCivById(killer.civId);
          if (civ) civ.totalKills++;
        }
      }
      this.kill(a.id);
    }
  }

  kill(id) {
    const a = this.agents.get(id);
    if (!a || !a.isAlive) return;
    a.isAlive = false;
    this._aliveCount--;
    this._deadCount++;
    this.world.getTile(a.x, a.y)?.agentIds.delete(id);
    this._gridRemove(a);
    // Remove from civ
    if (a.civId && this.civSystem) {
      const civ = this.civSystem.getCivById(a.civId);
      if (civ) civ.agentIds.delete(id);
    }
  }

  getAgentAt(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const tile = this.world.getTile(xi, yi);
    if (!tile) return null;
    for (const id of tile.agentIds) {
      const a = this.agents.get(id);
      if (a?.isAlive) return a;
    }
    return null;
  }

  getAgentsNear(cx, cy, radius) {
    const result = [];
    const minCX = Math.floor((cx - radius) / CELL);
    const maxCX = Math.floor((cx + radius) / CELL);
    const minCY = Math.floor((cy - radius) / CELL);
    const maxCY = Math.floor((cy + radius) / CELL);
    const r2 = radius * radius;

    for (let gy = minCY; gy <= maxCY; gy++) {
      for (let gx = minCX; gx <= maxCX; gx++) {
        const cell = this._grid.get(`${gx},${gy}`);
        if (!cell) continue;
        for (const id of cell) {
          const a = this.agents.get(id);
          if (!a?.isAlive) continue;
          const dx = a.x - cx, dy = a.y - cy;
          if (dx*dx + dy*dy <= r2) result.push(a);
        }
      }
    }
    return result;
  }

  spawnInitial(count) {
    const w = this.world;
    const rng = this.rng;
    let placed = 0;
    let attempts = 0;
    const maxAttempts = count * 50;

    while (placed < count && attempts < maxAttempts) {
      attempts++;
      let pos = w.randomLandTile(rng);
      if (!pos) {
        // Fallback: any walkable tile
        const x = Math.floor(rng() * w.width);
        const y = Math.floor(rng() * w.height);
        const t = w.getTile(x, y);
        if (t?.walkable) pos = { x, y };
      }
      if (!pos) continue;
      const tile = w.getTile(pos.x, pos.y);
      if (!tile?.walkable || tile.agentIds.size > 0) continue;
      this.spawn(pos.x, pos.y);
      placed++;
    }
  }

  // ── Main tick ────────────────────────────────────────────

  update(tick) {
    // Add any children spawned last tick
    for (const child of this._pending) {
      this.agents.set(child.id, child);
      this.world.getTile(child.x, child.y)?.agentIds.add(child.id);
      this._gridAdd(child);
      this._aliveCount++;
    }
    this._pending = [];

    // Prune dead agents older than 500 ticks
    if (tick % 500 === 0) {
      for (const [id, a] of this.agents) {
        if (!a.isAlive) this.agents.delete(id);
      }
    }

    for (const a of this.agents.values()) {
      if (!a.isAlive) continue;
      this._tickAgent(a, tick);
    }
  }

  // ── Per-agent tick ────────────────────────────────────────

  _tickAgent(a, tick) {
    // Age & vitals
    a.age++;
    a.stateTimer++;
    a.hunger = Math.min(100, a.hunger + CONFIG.AGENT_HUNGER_RATE);

    if (a.hunger >= 100) a.health -= CONFIG.AGENT_STARVATION_DAMAGE;
    if (a.health < 100 && a.hunger < 20) {
      a.health = Math.min(100, a.health + CONFIG.AGENT_HEALTH_REGEN);
    }
    // Passive stamina recovery
    a.stamina = Math.min(100, a.stamina + CONFIG.AGENT_STAMINA_REGEN * 0.3);

    if (a.health <= 0 || a.age >= a.maxAge) { this.kill(a.id); return; }

    // Choose behaviour
    this._chooseBehavior(a, tick);

    // Execute behaviour
    this._executeBehavior(a, tick);
  }

  _chooseBehavior(a, tick) {
    // 1. Starving → SEEK_FOOD (before REST so low-health agents still eat)
    if (a.hunger > 75) { a.setState(AGENT_STATES.SEEK_FOOD); return; }

    // 2. Critical health (not starving) → REST
    if (a.health < 20) { a.setState(AGENT_STATES.REST); return; }

    // 3. Aggressive → ATTACK if enemy nearby
    if (a.aggression > 0.6) {
      const near = this.getAgentsNear(a.x, a.y, CONFIG.AGENT_VISION * 0.5);
      const enemy = near.find(o => this._isEnemy(a, o));
      if (enemy) {
        a.targetX = enemy.x;
        a.targetY = enemy.y;
        a._targetId = enemy.id;
        a.setState(AGENT_STATES.ATTACK);
        return;
      }
    }

    // 4. Flee if threatened
    if (a.health < 50 && a.aggression < 0.5) {
      const near = this.getAgentsNear(a.x, a.y, CONFIG.AGENT_VISION * 0.33);
      const threat = near.find(o => this._isEnemy(a, o));
      if (threat) {
        a.targetX = threat.x;
        a.targetY = threat.y;
        a.setState(AGENT_STATES.FLEE);
        return;
      }
    }

    // 5. Reproduce
    if (
      a.hunger < CONFIG.AGENT_REPRODUCE_HUNGER_MAX &&
      a.age > CONFIG.AGENT_REPRODUCE_MIN_AGE &&
      tick - a.lastReproduced > CONFIG.AGENT_REPRODUCE_COOLDOWN &&
      a.health > CONFIG.AGENT_REPRODUCE_HEALTH_MIN &&
      this.getCount() < CONFIG.MAX_AGENTS
    ) {
      a.setState(AGENT_STATES.REPRODUCE);
      return;
    }

    // 6. Gather for civ when idle (does not interrupt combat / survival)
    if (
      a.civId &&
      (a.state === AGENT_STATES.IDLE || a.state === AGENT_STATES.WANDER) &&
      a.hunger < 70 &&
      a.stateTimer % 40 === 0
    ) {
      a.setState(AGENT_STATES.GATHER);
      return;
    }

    // 7. Wander
    if (a.state === AGENT_STATES.IDLE && a.stateTimer > 10) {
      a.setState(AGENT_STATES.WANDER);
    }
    if (a.state === AGENT_STATES.EAT && a.hunger < 15) {
      a.setState(AGENT_STATES.IDLE);
    }
  }

  _executeBehavior(a, tick) {
    switch (a.state) {

      case AGENT_STATES.REST: {
        if (a.hunger > 75) {
          a.setState(AGENT_STATES.SEEK_FOOD);
          break;
        }
        a.health = Math.min(100, a.health + CONFIG.AGENT_HEALTH_REGEN * 3);
        a.stamina = Math.min(100, a.stamina + CONFIG.AGENT_STAMINA_REGEN);
        if (a.health > 60 || a.stateTimer > 30) a.setState(AGENT_STATES.WANDER);
        break;
      }

      case AGENT_STATES.WANDER: {
        if (!this._hasTarget(a) || a.stateTimer > 15) {
          const dx = Math.floor(this.rng() * 11) - 5;
          const dy = Math.floor(this.rng() * 11) - 5;
          const nx = Math.max(0, Math.min(this.world.width-1,  a.x + dx));
          const ny = Math.max(0, Math.min(this.world.height-1, a.y + dy));
          if (this.world.isWalkable(nx, ny)) {
            a.targetX = nx;
            a.targetY = ny;
            a.stateTimer = 0;
          }
        }
        if (this._hasTarget(a)) this._step(a);
        break;
      }

      case AGENT_STATES.SEEK_FOOD: {
        if (!this._hasTarget(a) || a.stateTimer % 20 === 0) {
          const pos = this.world.findResourceNear(a.x, a.y, 'food', CONFIG.AGENT_VISION, 5);
          if (pos) { a.targetX = pos.x; a.targetY = pos.y; }
          else     { a.setState(AGENT_STATES.WANDER); break; }
        }
        const dist = _chebyshev(a.x, a.y, a.targetX, a.targetY);
        if (dist <= 0) {
          a.setState(AGENT_STATES.EAT);
        } else {
          this._step(a);
        }
        break;
      }

      case AGENT_STATES.EAT: {
        const ate = this.resourceSystem.consume(a.x, a.y, 'food', CONFIG.AGENT_EAT_AMOUNT);
        a.hunger = Math.max(0, a.hunger - ate * 1.5);
        if (a.hunger < 15 || ate === 0) a.setState(AGENT_STATES.IDLE);
        break;
      }

      case AGENT_STATES.FLEE: {
        if (a.targetX !== null) {
          // Move away from the threat
          const dx = a.x - a.targetX;
          const dy = a.y - a.targetY;
          const len = Math.sqrt(dx*dx + dy*dy) || 1;
          const nx  = Math.round(a.x + dx/len * 2);
          const ny  = Math.round(a.y + dy/len * 2);
          const cx  = Math.max(0, Math.min(this.world.width-1,  nx));
          const cy  = Math.max(0, Math.min(this.world.height-1, ny));
          if (this.world.isWalkable(cx, cy)) {
            this._moveTo(a, cx, cy);
          }
        }
        if (a.stateTimer > 15) { a.targetX = null; a.setState(AGENT_STATES.WANDER); }
        break;
      }

      case AGENT_STATES.ATTACK: {
        // Refresh target
        let target = a._targetId ? this.agents.get(a._targetId) : null;
        if (!target?.isAlive) {
          const near = this.getAgentsNear(a.x, a.y, CONFIG.AGENT_VISION * 0.6);
          target = near.find(o => this._isEnemy(a, o)) ?? null;
          if (target) { a._targetId = target.id; a.targetX = target.x; a.targetY = target.y; }
        }
        if (!target) { a.setState(AGENT_STATES.WANDER); break; }

        a.targetX = target.x;
        a.targetY = target.y;
        const dist = _chebyshev(a.x, a.y, target.x, target.y);
        if (dist > 1.5) {
          this._step(a);
        } else if (tick - a.lastAttacked >= CONFIG.AGENT_ATTACK_COOLDOWN) {
          const dmg = Math.max(
            1,
            a.strength * 15 + this.rng() * 10 - target.strength * 5,
          );
          a.stamina = Math.max(0, a.stamina - 8);
          a.lastAttacked = tick;
          this.damage(target, dmg, a);
        }
        // Give up attacking after a while
        if (a.stateTimer > 60) a.setState(AGENT_STATES.WANDER);
        break;
      }

      case AGENT_STATES.REPRODUCE: {
        const near = this.getAgentsNear(a.x, a.y, 3);
        const mate = near.find(o =>
          o.id !== a.id &&
          o.isAlive &&
          (o.civId === a.civId) &&
          o.hunger < CONFIG.AGENT_REPRODUCE_HUNGER_MAX &&
          tick - o.lastReproduced > CONFIG.AGENT_REPRODUCE_COOLDOWN &&
          o.health > CONFIG.AGENT_REPRODUCE_HEALTH_MIN
        );

        if (mate && this.getCount() < CONFIG.MAX_AGENTS) {
          const child = Agent.reproduce(a, mate, tick);
          // Place child near parents
          const pos = this._findEmptyNear(a.x, a.y, 2);
          if (pos) { child.x = pos.x; child.y = pos.y; }
          if (child.civId && this.civSystem) {
            const civ = this.civSystem.getCivById(child.civId);
            if (civ) { civ.agentIds.add(child.id); civ.totalBorn++; }
          }
          this._pending.push(child);
          a.setState(AGENT_STATES.REST);
        } else {
          // No mate found, wander briefly
          if (a.stateTimer > 30) a.setState(AGENT_STATES.WANDER);
          else this._step(a);
        }
        break;
      }

      case AGENT_STATES.GATHER: {
        // Collect food or wood near current position
        const food = this.world.findResourceNear(a.x, a.y, 'food', 6, 10);
        const wood = this.world.findResourceNear(a.x, a.y, 'wood', 6, 10);
        const target = food ?? wood;
        if (target) {
          if (_chebyshev(a.x, a.y, target.x, target.y) <= 1) {
            const type = food ? 'food' : 'wood';
            const amt  = this.resourceSystem.consume(target.x, target.y, type, 10);
            // Deposit into civ
            if (a.civId && this.civSystem) {
              const civ = this.civSystem.getCivById(a.civId);
              if (civ) civ.resources[type] = (civ.resources[type] ?? 0) + amt;
            }
            a.setState(AGENT_STATES.IDLE);
          } else {
            a.targetX = target.x;
            a.targetY = target.y;
            this._step(a);
          }
        } else {
          a.setState(AGENT_STATES.WANDER);
        }
        break;
      }

      case AGENT_STATES.IDLE: {
        a.stamina = Math.min(100, a.stamina + CONFIG.AGENT_STAMINA_REGEN * 0.5);
        if (a.stateTimer > 8) a.setState(AGENT_STATES.WANDER);
        break;
      }

      default:
        a.setState(AGENT_STATES.WANDER);
    }
  }

  // ── Movement ──────────────────────────────────────────────

  _step(a) {
    if (a.targetX === null || a.targetY === null) return;
    const tx = a.targetX, ty = a.targetY;
    if (tx === a.x && ty === a.y) return;

    // Speed gating (low-speed agents skip some ticks)
    const skipMod = a.speed < 0.5 ? Math.round(2 - a.speed * 2) : 1;
    if (a.stateTimer % skipMod !== 0) return;

    this._moveTo(a, tx, ty, true);
  }

  _moveTo(a, tx, ty, respectBlocking = true) {
    const dx = tx - a.x, dy = ty - a.y;
    const sx = Math.sign(dx), sy = Math.sign(dy);

    const candidates = [];
    if (sx !== 0 && sy !== 0) candidates.push([sx, sy], [sx, 0], [0, sy]);
    else if (sx !== 0)         candidates.push([sx, 0], [sx, 1], [sx, -1]);
    else                       candidates.push([0, sy], [1, sy], [-1, sy]);
    candidates.push([-sy, sx], [sy, -sx]); // perpendicular fallback

    for (const [mx, my] of candidates) {
      const nx = a.x + mx, ny = a.y + my;
      if (!this.world.isInBounds(nx, ny)) continue;
      if (!this.world.isWalkable(nx, ny)) continue;
      if (respectBlocking && this.getAgentAt(nx, ny)) continue;

      this.world.getTile(a.x, a.y)?.agentIds.delete(a.id);
      this._gridUpdate(a, nx, ny);
      a.x = nx; a.y = ny;
      this.world.getTile(nx, ny)?.agentIds.add(a.id);
      a.stamina = Math.max(0, a.stamina - CONFIG.AGENT_STAMINA_DRAIN);
      return true;
    }
    return false;
  }

  _hasTarget(a) {
    return a.targetX !== null && a.targetY !== null &&
           !(a.x === a.targetX && a.y === a.targetY);
  }

  /** Move agent off an unwalkable tile (e.g. flood); returns true if relocated. */
  ejectFromTile(a) {
    if (this.world.isWalkable(a.x, a.y)) return false;
    const pos = this._findEmptyNear(a.x, a.y, 8);
    if (!pos) return false;
    this.world.getTile(a.x, a.y)?.agentIds.delete(a.id);
    this._gridUpdate(a, pos.x, pos.y);
    a.x = pos.x;
    a.y = pos.y;
    this.world.getTile(pos.x, pos.y)?.agentIds.add(a.id);
    return true;
  }

  _findEmptyNear(x, y, radius) {
    for (let r = 0; r <= radius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          if (this.world.isWalkable(nx, ny) && !this.getAgentAt(nx, ny)) {
            return { x: nx, y: ny };
          }
        }
      }
    }
    return null;
  }

  // ── Enemy check ──────────────────────────────────────────

  _isEnemy(a, other) {
    if (!other.isAlive || other.id === a.id) return false;
    if (a.civId && other.civId) {
      if (a.civId === other.civId) return false;
      // Check if at war
      if (this.civSystem) {
        const civ = this.civSystem.getCivById(a.civId);
        return civ?.relations.get(other.civId) === 'WAR';
      }
      return true; // different civs = enemies by default
    }
    if (a.civId && !other.civId) return true;  // civ vs wild
    if (!a.civId && other.civId) return true;  // wild vs civ
    // Both wild: only enemies if both very aggressive
    return a.aggression > 0.75 && other.aggression > 0.75;
  }

  // ── Spatial grid ─────────────────────────────────────────

  _gridKey(x, y) {
    return `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
  }

  _gridAdd(a) {
    const key = this._gridKey(a.x, a.y);
    if (!this._grid.has(key)) this._grid.set(key, new Set());
    this._grid.get(key).add(a.id);
  }

  _gridRemove(a) {
    const key = this._gridKey(a.x, a.y);
    this._grid.get(key)?.delete(a.id);
  }

  _gridUpdate(a, nx, ny) {
    const oldKey = this._gridKey(a.x, a.y);
    const newKey = this._gridKey(nx, ny);
    if (oldKey !== newKey) {
      this._grid.get(oldKey)?.delete(a.id);
      if (!this._grid.has(newKey)) this._grid.set(newKey, new Set());
      this._grid.get(newKey).add(a.id);
    }
  }
}

function _chebyshev(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}
