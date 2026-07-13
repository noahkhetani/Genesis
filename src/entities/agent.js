// evolve — agent entity (data + factory)
import { CONFIG, AGENT_STATES } from '../config.js';

let _idCounter = 0;

export class Agent {
  /**
   * @param {number} x - tile X
   * @param {number} y - tile Y
   * @param {object} [traits={}] - heritable trait overrides (0–1)
   * @param {number} [generation=0]
   */
  constructor(x, y, traits = {}, generation = 0) {
    this.id = `a${++_idCounter}`;
    this.x  = x;
    this.y  = y;

    // ── Vital stats (0–100) ───────────────────────────────
    this.health  = 70 + Math.random() * 30;
    this.hunger  = Math.random() * 40;
    this.stamina = 60 + Math.random() * 40;

    // ── Age ───────────────────────────────────────────────
    this.age    = 0;
    this.maxAge = CONFIG.AGENT_BASE_MAX_AGE
                + (Math.random() * 2 - 1) * CONFIG.AGENT_AGE_VARIANCE;

    // ── Heritable traits (0–1) ────────────────────────────
    this.intelligence   = _clamp(traits.intelligence   ?? 0.3 + Math.random() * 0.4);
    this.aggression     = _clamp(traits.aggression     ?? 0.2 + Math.random() * 0.4);
    this.socialTendency = _clamp(traits.socialTendency ?? 0.3 + Math.random() * 0.4);
    this.speed          = _clamp(traits.speed          ?? 0.4 + Math.random() * 0.4);
    this.strength       = _clamp(traits.strength       ?? 0.3 + Math.random() * 0.4);

    // ── Behaviour state ───────────────────────────────────
    this.state      = AGENT_STATES.WANDER;
    this.prevState  = null;
    this.stateTimer = 0;

    // ── Navigation ────────────────────────────────────────
    this.targetX     = null;
    this.targetY     = null;
    this.path        = [];
    this.moveTimer   = 0;    // ticks until next move step
    this.lastMoved   = 0;

    // ── Social ────────────────────────────────────────────
    this.civId = null;

    // ── Meta ──────────────────────────────────────────────
    this.generation     = generation;
    this.isAlive        = true;
    this.lastReproduced = -9999;
    this.lastAttacked   = -9999;
    this.children       = 0;
    this.kills          = 0;
    this.color          = '#a0a0a0';

    this._updateColor();
  }

  // ── Helpers ──────────────────────────────────────────────

  setState(newState) {
    if (this.state === newState) return;
    this.prevState  = this.state;
    this.state      = newState;
    this.stateTimer = 0;
  }

  _updateColor() {
    if (this.civId) return; // civ system sets this
    const { intelligence: I, aggression: A, socialTendency: S } = this;
    if (A > I && A > S && A > 0.5) {
      this.color = `hsl(${Math.round(0   + A * 20)},80%,60%)`;
    } else if (I > A && I > S && I > 0.5) {
      this.color = `hsl(${Math.round(210 + I * 20)},80%,65%)`;
    } else if (S > A && S > I && S > 0.5) {
      this.color = `hsl(${Math.round(130 + S * 20)},70%,55%)`;
    } else {
      this.color = '#a0a0a0';
    }
  }

  /** Role description for the inspector. */
  getRole() {
    const maxTrait = Math.max(
      this.intelligence, this.aggression,
      this.socialTendency, this.speed, this.strength,
    );
    if (maxTrait === this.intelligence)   return 'Scholar';
    if (maxTrait === this.aggression)     return 'Warrior';
    if (maxTrait === this.socialTendency) return 'Diplomat';
    if (maxTrait === this.speed)          return 'Scout';
    return 'Brute';
  }

  // ── Reproduction factory ──────────────────────────────────

  /**
   * Create a child from two parents with trait mixing + mutation.
   * Updates parents' reproduction timers.
   */
  static reproduce(p1, p2, tick) {
    const m = (v) => _clamp(v + (Math.random() * 2 - 1) * CONFIG.MUTATION_RATE);
    const traits = {
      intelligence   : m((p1.intelligence   + p2.intelligence)   / 2),
      aggression     : m((p1.aggression     + p2.aggression)     / 2),
      socialTendency : m((p1.socialTendency + p2.socialTendency) / 2),
      speed          : m((p1.speed          + p2.speed)          / 2),
      strength       : m((p1.strength       + p2.strength)       / 2),
    };
    const gen   = Math.max(p1.generation, p2.generation) + 1;
    const child = new Agent(p1.x, p1.y, traits, gen);
    child.civId  = p1.civId;
    child.health = 55 + Math.random() * 20;
    child.hunger = 10 + Math.random() * 20;
    child._updateColor();

    p1.lastReproduced = tick;
    p2.lastReproduced = tick;
    p1.children++;
    p2.children++;
    p1.stamina -= 25;
    p2.stamina -= 25;

    return child;
  }
}

function _clamp(v, lo = 0, hi = 1) {
  return v < lo ? lo : v > hi ? hi : v;
}
