// evolve — 2d simplex noise
// Based on Stefan Gustavson's simplex noise algorithm.
// Reference: "Simplex noise demystified" (2005)

// ── Internal Mulberry32 PRNG (used only for permutation seeding) ──
function _mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Gradient table — 12 unit vectors, evenly distributed in 2D/3D space ──
// Only the first two components are used for 2D dot products.
const _GRAD3 = [
  [ 1,  1, 0], [-1,  1, 0], [ 1, -1, 0], [-1, -1, 0],
  [ 1,  0, 1], [-1,  0, 1], [ 1,  0, -1], [-1,  0, -1],
  [ 0,  1, 1], [ 0, -1, 1], [ 0,  1, -1], [ 0, -1, -1],
];

// ── Simplex skewing / unskewing constants for 2D ──────────────
//   F2 skews the (x,y) input into a simplex grid cell.
//   G2 unskews a simplex corner back to (x,y) space.
const _F2 = 0.5 * (Math.sqrt(3) - 1);   // ≈  0.3660254038
const _G2 = (3 - Math.sqrt(3)) / 6;     // ≈  0.2113248654

// ════════════════════════════════════════════════════════════
export class SimplexNoise {
  /**
   * Construct a SimplexNoise instance seeded deterministically.
   * @param {number} seed  Integer seed — same seed always produces the same
   *                       permutation table, and therefore the same noise field.
   */
  constructor(seed) {
    // Build a canonical 0–255 array…
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;

    // …then Fisher-Yates shuffle it with the seeded PRNG.
    const rng = _mulberry32(seed >>> 0); // coerce to uint32 for stability
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }

    // Extend to 512 entries so index arithmetic never wraps manually.
    // perm[i] wraps at 256 via p[i & 255].
    this._perm      = new Uint8Array(512);
    this._permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this._perm[i]      = p[i & 255];
      this._permMod12[i] = this._perm[i] % 12;
    }
  }

  // ──────────────────────────────────────────────────────────
  /**
   * Classic 2D Simplex Noise — returns a value in the range [-1, 1].
   * @param {number} xin
   * @param {number} yin
   * @returns {number}
   */
  noise2D(xin, yin) {
    const perm      = this._perm;
    const permMod12 = this._permMod12;

    // ── 1. Skew input space to identify the simplex cell ──
    const s = (xin + yin) * _F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);

    // ── 2. Unskew cell origin back to (x,y) space ─────────
    const t  = (i + j) * _G2;
    const x0 = xin - (i - t);   // distance from cell origin
    const y0 = yin - (j - t);

    // ── 3. Determine which simplex triangle we're in ───────
    //   Upper triangle (YX order): x0 <= y0
    //   Lower triangle (XY order): x0  > y0
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    // ── 4. Offsets for middle and last corners (unskewed) ──
    const x1 = x0 - i1 + _G2;
    const y1 = y0 - j1 + _G2;
    const x2 = x0 - 1  + 2 * _G2;
    const y2 = y0 - 1  + 2 * _G2;

    // ── 5. Gradient indices via hashed permutation table ──
    const ii  = i & 255;
    const jj  = j & 255;
    const gi0 = permMod12[ii      + perm[jj     ]];
    const gi1 = permMod12[ii + i1 + perm[jj + j1]];
    const gi2 = permMod12[ii + 1  + perm[jj + 1 ]];

    // ── 6. Kernel contributions from each of the 3 corners ─
    //   Each corner contributes a radially symmetric kernel:
    //     max(0, 0.5 - dist²)^4  ×  dot(gradient, offset)
    let n0 = 0, n1 = 0, n2 = 0;

    const t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      const t02 = t0 * t0;
      n0 = t02 * t02 * (_GRAD3[gi0][0] * x0 + _GRAD3[gi0][1] * y0);
    }

    const t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      const t12 = t1 * t1;
      n1 = t12 * t12 * (_GRAD3[gi1][0] * x1 + _GRAD3[gi1][1] * y1);
    }

    const t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      const t22 = t2 * t2;
      n2 = t22 * t22 * (_GRAD3[gi2][0] * x2 + _GRAD3[gi2][1] * y2);
    }

    // ── 7. Sum and scale to [-1, 1] ────────────────────────
    //   The 70.0 scale factor is an empirically derived constant
    //   that brings the result into the [-1, 1] interval.
    return 70.0 * (n0 + n1 + n2);
  }

  // ──────────────────────────────────────────────────────────
  /**
   * Fractal Brownian Motion — sums layered octaves of noise2D and
   * normalises the result so the output stays within [-1, 1].
   *
   * @param {number} x
   * @param {number} y
   * @param {number} [octaves=6]        Number of noise layers to sum.
   * @param {number} [persistence=0.5]  Amplitude multiplier per octave.
   *                                    Lower = smoother terrain.
   * @param {number} [lacunarity=2.0]   Frequency multiplier per octave.
   *                                    Higher = more fine detail.
   * @returns {number}  Value in [-1, 1] (normalised by total amplitude).
   */
  fbm(x, y, octaves = 6, persistence = 0.5, lacunarity = 2.0) {
    let value        = 0;
    let amplitude    = 1;
    let frequency    = 1;
    let maxAmplitude = 0;   // sum of all amplitudes → normalisation divisor

    for (let o = 0; o < octaves; o++) {
      value        += this.noise2D(x * frequency, y * frequency) * amplitude;
      maxAmplitude += amplitude;
      amplitude    *= persistence;
      frequency    *= lacunarity;
    }

    // Divide by max possible amplitude so result is always in [-1, 1].
    return value / maxAmplitude;
  }
}
