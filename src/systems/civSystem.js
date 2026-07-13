// evolve — civilization system
import { CONFIG } from '../config.js';

let _civIdCounter = 0;

const PREFIXES  = ['Ar','El','Val','Kor','Zan','Sol','Vel','Mor','Tem','Eld','Ith','Dur','Bel','Rath','Vor','Kas','Nym','Tar','Ush','Wyl'];
const SUFFIXES  = ['ath','ion','ur','ith','era','an','um','dor','sha','mos','vel','kar','eth','ain','os','en','ara','is','ok','el'];
const BASE_HUES = [0, 30, 60, 120, 180, 210, 270, 300, 340, 150, 50, 260];

export class CivSystem {
  constructor(world, agentSystem, rng) {
    this.world       = world;
    this.agentSystem = agentSystem;
    this.rng         = rng;

    /** @type {Map<string, object>} */
    this.civs = new Map();
    this.log  = [];
    this._hueIndex = 0;
  }

  // ── Public API ───────────────────────────────────────────

  getCount()        { return [...this.civs.values()].filter(c => c.isAlive).length; }
  getActiveCivs()   { return [...this.civs.values()].filter(c => c.isAlive); }
  getCivById(id)    { return this.civs.get(id) ?? null; }
  getCivAt(x, y) {
    const tile = this.world.getTile(x, y);
    if (!tile?.civId) return null;
    return this.civs.get(tile.civId) ?? null;
  }

  // ── Main tick ────────────────────────────────────────────

  update(tick) {
    // Formation check
    if (tick % CONFIG.CIV_CHECK_INTERVAL === 0) {
      this._checkFormation(tick);
    }

    // Per-civ update
    for (const civ of this.civs.values()) {
      if (!civ.isAlive) continue;
      this._updateCiv(civ, tick);
    }

    // Diplomacy (every 300 ticks)
    if (tick % 300 === 0 && this.civs.size > 1) {
      this._updateDiplomacy(tick);
    }
  }

  disbandCiv(civId, tick = 0) {
    const civ = this.civs.get(civId);
    if (!civ) return;
    civ.isAlive = false;

    // Clear territory
    for (const key of civ.territory) {
      const { x, y } = this.world.fromKey(key);
      const tile = this.world.getTile(x, y);
      if (tile?.civId === civId) this.world.setTileProps(x, y, { civId: null });
    }

    // Release agents
    for (const id of civ.agentIds) {
      const a = this.agentSystem.agents.get(id);
      if (a) { a.civId = null; a._updateColor(); }
    }

    this._addLog(`[T${tick}] ${civ.name} has collapsed`);
  }

  // ── Formation ────────────────────────────────────────────

  _checkFormation(tick) {
    const eligible = [];
    for (const a of this.agentSystem.agents.values()) {
      if (a.isAlive && !a.civId && a.socialTendency > 0.5) eligible.push(a);
    }
    if (eligible.length < CONFIG.CIV_FORM_MIN_AGENTS) return;

    const assigned = new Set();

    for (const a of eligible) {
      if (assigned.has(a.id)) continue;
      const R = CONFIG.CIV_FORM_RADIUS;
      const cluster = eligible.filter(o =>
        !assigned.has(o.id) &&
        Math.abs(o.x - a.x) <= R &&
        Math.abs(o.y - a.y) <= R
      );
      if (cluster.length >= CONFIG.CIV_FORM_MIN_AGENTS) {
        this._foundCiv(cluster, tick);
        for (const o of cluster) assigned.add(o.id);
      }
    }
  }

  _foundCiv(members, tick) {
    const id = `civ_${++_civIdCounter}`;

    // Center
    const cx = Math.round(members.reduce((s, a) => s + a.x, 0) / members.length);
    const cy = Math.round(members.reduce((s, a) => s + a.y, 0) / members.length);

    // Color
    const hue  = (BASE_HUES[this._hueIndex % BASE_HUES.length] + Math.round((this.rng() * 30) - 15) + 360) % 360;
    this._hueIndex++;
    const color = `hsl(${hue},70%,55%)`;

    // Name
    const name = PREFIXES[Math.floor(this.rng() * PREFIXES.length)]
               + SUFFIXES[Math.floor(this.rng() * SUFFIXES.length)];

    const civ = {
      id, name, color, hue,
      centerX: cx, centerY: cy,
      agentIds       : new Set(members.map(a => a.id)),
      territory      : new Set(),
      resources      : { food: 50, wood: 30, stone: 10, water: 20, metal: 0 },
      relations      : new Map(),
      age            : 0,
      isAlive        : true,
      foundedAt      : tick,
      militaryStrength: 0,
      expansionTimer : 0,
      warCount       : 0,
      totalBorn      : members.length,
      totalKills     : 0,
      peakPopulation : members.length,
    };

    // Claim territory
    const R = CONFIG.CIV_TERRITORY_RADIUS;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const tx = cx + dx, ty = cy + dy;
        if (!this.world.isInBounds(tx, ty)) continue;
        const tile = this.world.getTile(tx, ty);
        if (!tile || !tile.walkable || tile.civId) continue;
        tile.civId = id;
        civ.territory.add(this.world.tileKey(tx, ty));
      }
    }

    // Assign agents
    for (const a of members) {
      a.civId = id;
      a.color = `hsl(${hue + Math.round(this.rng() * 20 - 10)},70%,55%)`;
    }

    this.civs.set(id, civ);
    this._addLog(`[T${tick}] ${name} founded at (${cx},${cy})`);
    return civ;
  }

  // ── Per-civ update ────────────────────────────────────────

  _updateCiv(civ, tick) {
    civ.age++;

    // Prune dead agents
    for (const id of [...civ.agentIds]) {
      const a = this.agentSystem.agents.get(id);
      if (!a?.isAlive) civ.agentIds.delete(id);
    }

    // Disband if too small
    if (civ.agentIds.size < 2) {
      this.disbandCiv(civ.id, tick);
      return;
    }

    civ.peakPopulation = Math.max(civ.peakPopulation, civ.agentIds.size);

    // Recenter on population centroid (for map marker / inspector)
    if (civ.agentIds.size > 0 && tick % 100 === 0) {
      let sx = 0, sy = 0, n = 0;
      for (const id of civ.agentIds) {
        const ag = this.agentSystem.agents.get(id);
        if (ag?.isAlive) {
          sx += ag.x;
          sy += ag.y;
          n++;
        }
      }
      if (n > 0) {
        civ.centerX = Math.round(sx / n);
        civ.centerY = Math.round(sy / n);
      }
    }

    // Feed hungry agents from civ stores
    if (civ.resources.food > 10) {
      for (const id of civ.agentIds) {
        const a = this.agentSystem.agents.get(id);
        if (a?.isAlive && a.hunger > 65 && civ.resources.food >= 5) {
          a.hunger = Math.max(0, a.hunger - 10);
          civ.resources.food -= 5;
        }
      }
    }

    // Military strength
    let ms = 0, n = 0;
    for (const id of civ.agentIds) {
      const a = this.agentSystem.agents.get(id);
      if (a) { ms += a.strength * a.aggression; n++; }
    }
    civ.militaryStrength = n > 0 ? ms / n : 0;

    // Slow resource decay
    for (const t of ['food','wood','stone','water','metal']) {
      civ.resources[t] *= 0.999;
      if (civ.resources[t] < 0) civ.resources[t] = 0;
    }

    // Expand territory
    civ.expansionTimer++;
    if (civ.expansionTimer >= CONFIG.CIV_EXPAND_INTERVAL &&
        civ.agentIds.size > 8 &&
        civ.territory.size < CONFIG.CIV_MAX_TERRITORY) {
      this._expandTerritory(civ);
      civ.expansionTimer = 0;
    }
  }

  _expandTerritory(civ) {
    const seen = new Set();
    const edge = [];
    for (const key of civ.territory) {
      const { x, y } = this.world.fromKey(key);
      const neighbors = this.world.getNeighborTiles(x, y, 1);
      for (const nb of neighbors) {
        if (!nb.tile.civId && nb.tile.walkable) {
          const nk = this.world.tileKey(nb.x, nb.y);
          if (seen.has(nk)) continue;
          seen.add(nk);
          edge.push({ x: nb.x, y: nb.y, tile: nb.tile });
        }
      }
    }
    if (edge.length === 0) return;

    // Pick up to 8 tiles with best resource potential
    edge.sort((a, b) => {
      const ra = a.tile.resources.food + a.tile.resources.wood;
      const rb = b.tile.resources.food + b.tile.resources.wood;
      return rb - ra;
    });

    const take = Math.min(8, edge.length, CONFIG.CIV_MAX_TERRITORY - civ.territory.size);
    for (let i = 0; i < take; i++) {
      const { x, y } = edge[i];
      this.world.setTileProps(x, y, { civId: civ.id });
      civ.territory.add(this.world.tileKey(x, y));
    }
  }

  // ── Diplomacy ─────────────────────────────────────────────

  _updateDiplomacy(tick) {
    const civList = this.getActiveCivs();
    for (let i = 0; i < civList.length; i++) {
      for (let j = i + 1; j < civList.length; j++) {
        const a = civList[i], b = civList[j];
        this._checkRelation(a, b, tick);
      }
    }
  }

  _checkRelation(a, b, tick) {
    const current = a.relations.get(b.id) ?? 'NEUTRAL';

    // Check territorial proximity
    let close = false;
    for (const key of a.territory) {
      const { x, y } = this.world.fromKey(key);
      for (const key2 of b.territory) {
        const { x: x2, y: y2 } = this.world.fromKey(key2);
        if (Math.abs(x-x2) <= 4 && Math.abs(y-y2) <= 4) { close = true; break; }
      }
      if (close) break;
    }

    if (!close) return;

    const aAgg  = a.militaryStrength;
    const bAgg  = b.militaryStrength;
    const aSoc  = this._avgTrait(a, 'socialTendency');
    const bSoc  = this._avgTrait(b, 'socialTendency');
    const r     = this.rng();

    if (current === 'NEUTRAL') {
      if (aAgg > 0.5 && bAgg > 0.5 && r < 0.2) {
        this._setRelation(a, b, 'WAR', tick);
      } else if (aSoc > 0.55 && bSoc > 0.55 && r < 0.15) {
        this._setRelation(a, b, 'ALLIED', tick);
      } else if (r < 0.3) {
        this._setRelation(a, b, 'PEACE', tick);
      }
    } else if (current === 'WAR') {
      // Small chance war ends
      if (r < 0.03) {
        this._setRelation(a, b, 'NEUTRAL', tick);
      }
      // War attrition (handled by combatSystem directing agents)
    } else if (current === 'ALLIED') {
      // Alliance can break
      if (r < 0.01) this._setRelation(a, b, 'NEUTRAL', tick);
    }
  }

  _setRelation(a, b, rel, tick) {
    a.relations.set(b.id, rel);
    b.relations.set(a.id, rel);
    const label = rel === 'WAR' ? '⚔ WAR' : rel === 'ALLIED' ? '✦ ALLIED' : '◇ ' + rel;
    this._addLog(`[T${tick}] ${a.name} & ${b.name}: ${label}`);
    if (rel === 'WAR') { a.warCount++; b.warCount++; }
  }

  _avgTrait(civ, trait) {
    let s = 0, n = 0;
    for (const id of civ.agentIds) {
      const a = this.agentSystem.agents.get(id);
      if (a) { s += a[trait]; n++; }
    }
    return n > 0 ? s / n : 0;
  }

  _addLog(msg) {
    this.log.unshift(msg);
    if (this.log.length > 30) this.log.length = 30;
  }
}
