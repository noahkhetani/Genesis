// evolve — evolution system
// Tracks population trait averages over time.

const TRAITS = ['intelligence', 'aggression', 'socialTendency', 'speed', 'strength'];

export class EvolutionSystem {
  constructor(agentSystem) {
    this._agents  = agentSystem;
    this._history = [];           // last 100 snapshots
    this._current = _emptySnap(0);
  }

  /** Call each simulation tick; snapshots are recorded every 500 ticks. */
  update(tick) {
    if (tick % 500 !== 0) return;

    const agents = [...this._agents.agents.values()].filter(a => a.isAlive);
    const n = agents.length;
    if (n === 0) return;

    const snap = _emptySnap(tick);
    snap.total = n;

    for (const a of agents) {
      for (const t of TRAITS) snap[t] += a[t];
      snap.avgGeneration += a.generation;
    }
    for (const t of TRAITS) snap[t] /= n;
    snap.avgGeneration /= n;

    // Find dominant trait
    let best = TRAITS[0], bestVal = snap[TRAITS[0]];
    for (const t of TRAITS) {
      if (snap[t] > bestVal) { bestVal = snap[t]; best = t; }
    }
    snap.dominantTrait = best;

    this._current = snap;
    this._history.push(snap);
    if (this._history.length > 100) this._history.shift();
  }

  /** Current population averages. */
  getStats() {
    return { ...this._current };
  }

  /** Last ≤100 snapshots (oldest first). */
  getTraitHistory() {
    return [...this._history];
  }
}

function _emptySnap(tick) {
  return {
    tick, total: 0, avgGeneration: 0, dominantTrait: 'intelligence',
    intelligence: 0, aggression: 0, socialTendency: 0, speed: 0, strength: 0,
  };
}
