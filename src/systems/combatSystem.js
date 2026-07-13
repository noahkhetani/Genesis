// evolve — combat system
import { CONFIG, AGENT_STATES } from '../config.js';

export class CombatSystem {
  constructor(world, agentSystem, civSystem, rng) {
    this.world       = world;
    this.agentSystem = agentSystem;
    this.civSystem   = civSystem;
    this.rng         = rng;
    this.log         = [];
  }

  update(tick) {
    if (tick % 20 === 0) this._handleCivWars(tick);
  }

  _handleCivWars(tick) {
    const civs = this.civSystem.getActiveCivs();
    const engaged = new Set();

    for (const civA of civs) {
      for (const [otherId, rel] of civA.relations) {
        if (rel !== 'WAR') continue;
        const civB = this.civSystem.getCivById(otherId);
        if (!civB?.isAlive) continue;

        const pairKey = [civA.id, civB.id].sort().join(':');
        if (engaged.has(pairKey)) continue;
        engaged.add(pairKey);

        this._engageCivs(civA, civB, tick);

        if (civA.agentIds.size < 2 || civB.agentIds.size < 2) {
          civA.relations.set(otherId, 'NEUTRAL');
          civB.relations.set(civA.id, 'NEUTRAL');
          this._log(`[T${tick}] War between ${civA.name} & ${civB.name} ended`);
        }
      }
    }
  }

  _engageCivs(civA, civB, _tick) {
    // Get some agents from each side and set them to ATTACK mode
    const aAgents = [...civA.agentIds]
      .map(id => this.agentSystem.agents.get(id))
      .filter(a => a?.isAlive && a.aggression > 0.3)
      .slice(0, 5);

    const bAgents = [...civB.agentIds]
      .map(id => this.agentSystem.agents.get(id))
      .filter(a => a?.isAlive && a.aggression > 0.3)
      .slice(0, 5);

    for (const a of aAgents) {
      if (bAgents.length === 0) break;
      const target = bAgents[Math.floor(this.rng() * bAgents.length)];
      if (target) {
        a.setState(AGENT_STATES.ATTACK);
        a.targetX    = target.x;
        a.targetY    = target.y;
        a._targetId  = target.id;
      }
    }

    for (const b of bAgents) {
      if (aAgents.length === 0) break;
      const target = aAgents[Math.floor(this.rng() * aAgents.length)];
      if (target) {
        b.setState(AGENT_STATES.ATTACK);
        b.targetX   = target.x;
        b.targetY   = target.y;
        b._targetId = target.id;
      }
    }
  }

  _log(msg) {
    this.log.unshift(msg);
    if (this.log.length > 50) this.log.length = 50;
  }
}
