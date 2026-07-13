// evolve — seeded pseudo-random number generator
// Mulberry32 algorithm by Tommy Ettinger.
// All functions are pure and stateless — state lives in the
// closure returned by createRNG.

// ── Internal PRNG factory ─────────────────────────────────────
/**
 * Mulberry32 — a fast, high-quality 32-bit PRNG.
 * @param {number} seed  32-bit integer seed.
 * @returns {() => number}  Closure returning floats in [0, 1).
 */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════

/**
 * Create a seeded RNG using the Mulberry32 algorithm.
 * The seed is coerced to a 32-bit unsigned integer for
 * consistent cross-platform behaviour.
 *
 * @param {number} seed
 * @returns {() => number}  Function that returns floats in [0, 1).
 *
 * @example
 * const rng = createRNG(42);
 * rng(); // deterministic float in [0, 1)
 */
export function createRNG(seed) {
  return mulberry32(seed >>> 0);
}

// ──────────────────────────────────────────────────────────────
/**
 * Fisher-Yates in-place shuffle using a seeded RNG.
 * Modifies the array in place and also returns it for chaining.
 *
 * @template T
 * @param {T[]}          arr  Array to shuffle.
 * @param {() => number} rng  A seeded RNG from {@link createRNG}.
 * @returns {T[]}  The same array reference, now shuffled.
 */
export function seededShuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j   = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i]    = arr[j];
    arr[j]    = tmp;
  }
  return arr;
}

// ──────────────────────────────────────────────────────────────
/**
 * Pick a uniformly random element from a non-empty array.
 *
 * @template T
 * @param {T[]}          arr  Source array (must have length >= 1).
 * @param {() => number} rng
 * @returns {T}
 */
export function seededChoice(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

// ──────────────────────────────────────────────────────────────
/**
 * Return a random integer in the inclusive range [min, max].
 *
 * @param {number}       min  Lower bound (integer).
 * @param {number}       max  Upper bound (integer, inclusive).
 * @param {() => number} rng
 * @returns {number}  Integer in [min, max].
 */
export function seededInt(min, max, rng) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// ──────────────────────────────────────────────────────────────
/**
 * Return a random float in the half-open range [min, max).
 *
 * @param {number}       min
 * @param {number}       max  Exclusive upper bound.
 * @param {() => number} rng
 * @returns {number}  Float in [min, max).
 */
export function seededFloat(min, max, rng) {
  return min + rng() * (max - min);
}
