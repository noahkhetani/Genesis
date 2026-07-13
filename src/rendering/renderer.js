// evolve — canvas 2d renderer
import { CONFIG, BIOME_COLORS } from "../config.js";

export class Renderer {
  constructor(canvas, world, camera, systems) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.world = world;
    this.camera = camera;
    this.systems = systems; // { agent, civ, resource, event, evolution }

    // Offscreen canvas for terrain (pre-rendered at 1px/tile, then scaled)
    this._terrainCanvas = document.createElement("canvas");
    this._terrainCanvas.width = world.width;
    this._terrainCanvas.height = world.height;
    this._terrainCtx = this._terrainCanvas.getContext("2d");
    this._terrainDirty = true;
    this._terrainBakeAt = 0; // timestamp of last bake

    // Minimap canvas
    this._minimapCanvas = document.getElementById("minimap-canvas");
    this._minimapCtx = this._minimapCanvas?.getContext("2d") ?? null;
    this._minimapDirty = true;
    this._minimapTick = 0;
    this._minimapTerrainCache = null; // ImageData cache so we can clear agents each frame

    this._selected = null; // selected Agent or Civ object
  }

  // ── Public ────────────────────────────────────────────────

  setSelected(entity) {
    this._selected = entity;
  }
  getSelected() {
    return this._selected;
  }

  invalidateTerrain() {
    this._terrainDirty = true;
    this._minimapDirty = true;
  }

  render(timestamp) {
    if (!this.ctx) return;
    this._resize();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Background
    ctx.fillStyle = "#060a10";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this._renderTerrain();
    this._renderTerritories();
    this._renderEvents(timestamp);
    if (this.camera.zoom > 1.2) this._renderResources();
    this._renderAgents(timestamp);
    this._renderSelectedHighlight();
    this._renderMinimap(timestamp);
  }

  // ── Entity picking ────────────────────────────────────────

  getAgentAtScreen(sx, sy) {
    const wc = this.camera.screenToWorld(sx, sy);
    const wx = Math.floor(wc.x),
      wy = Math.floor(wc.y);
    const ts = this.camera.getTileSize();
    const pickR = Math.max(1, Math.ceil(4 / ts));

    let best = null,
      bestDist = Infinity;
    const agents = this.systems.agent.getAgentsNear(wx, wy, pickR + 1);
    for (const a of agents) {
      if (!a.isAlive) continue;
      const sc = this.camera.worldToScreen(a.x + 0.5, a.y + 0.5);
      const dx = sc.x - sx,
        dy = sc.y - sy;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        best = a;
      }
    }
    return bestDist < (ts * 0.8) ** 2 ? best : null;
  }

  getCivAtScreen(sx, sy) {
    const wc = this.camera.screenToWorld(sx, sy);
    return this.systems.civ.getCivAt(Math.floor(wc.x), Math.floor(wc.y));
  }

  getTileAtScreen(sx, sy) {
    const wc = this.camera.screenToWorld(sx, sy);
    const x = Math.floor(wc.x),
      y = Math.floor(wc.y);
    return { x, y, tile: this.world.getTile(x, y) };
  }

  // ── Resize ────────────────────────────────────────────────

  _resize() {
    const w = window.innerWidth,
      h = window.innerHeight;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  // ── Terrain ───────────────────────────────────────────────

  _renderTerrain() {
    // Re-bake terrain on demand OR every 5 s to capture live changes (e.g., wildfires)
    const now = Date.now();
    if (this._terrainDirty || now - this._terrainBakeAt > 5000) {
      this._bakeTerrainTexture();
      this._terrainDirty = false;
      this._terrainBakeAt = now;
    }

    const ts = this.camera.getTileSize();
    const b = this.camera.getVisibleTileBounds();
    const ctx = this.ctx;

    // Draw only the visible rectangle from the offscreen canvas, scaled
    const srcX = b.minX;
    const srcY = b.minY;
    const srcW = b.maxX - b.minX + 1;
    const srcH = b.maxY - b.minY + 1;
    const dstSC = this.camera.worldToScreen(b.minX, b.minY);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      this._terrainCanvas,
      srcX,
      srcY,
      srcW,
      srcH,
      dstSC.x,
      dstSC.y,
      srcW * ts,
      srcH * ts,
    );
  }

  _bakeTerrainTexture() {
    const ctx = this._terrainCtx;
    const img = ctx.createImageData(this.world.width, this.world.height);
    const data = img.data;

    for (let y = 0; y < this.world.height; y++) {
      for (let x = 0; x < this.world.width; x++) {
        const tile = this.world.tiles[y][x];
        const base = BIOME_COLORS[tile.type] ?? "#333333";
        let [r, g, b] = _hexToRgb(base);

        // Height shading
        const hf = (tile.height - 0.5) * 0.4;
        r = Math.max(0, Math.min(255, r + hf * 80));
        g = Math.max(0, Math.min(255, g + hf * 80));
        b = Math.max(0, Math.min(255, b + hf * 80));

        // River tint
        if (tile.river) {
          r = r * 0.6 + 40;
          g = g * 0.6 + 80;
          b = b * 0.6 + 160;
        }

        const idx = (y * this.world.width + x) * 4;
        data[idx] = Math.round(r);
        data[idx + 1] = Math.round(g);
        data[idx + 2] = Math.round(b);
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ── Territories ───────────────────────────────────────────

  _renderTerritories() {
    const ctx = this.ctx;
    const ts = this.camera.getTileSize();
    const civs = this.systems.civ.getActiveCivs();
    if (!civs.length) return;

    const b = this.camera.getVisibleTileBounds();

    ctx.save();
    for (const civ of civs) {
      // Use hue-based hsla (works with hsl-format civ colors)
      ctx.fillStyle = `hsla(${civ.hue},70%,55%,0.18)`;
      ctx.strokeStyle = `hsla(${civ.hue},70%,55%,0.70)`;
      ctx.lineWidth = 1;

      for (const key of civ.territory) {
        const { x, y } = this.world.fromKey(key);
        if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
        const sc = this.camera.worldToScreen(x, y);
        ctx.fillRect(sc.x, sc.y, ts, ts);

        // Border: check adjacent tiles for edges
        if (ts >= 3) {
          const N = this.world.getTile(x, y - 1)?.civId !== civ.id;
          const S = this.world.getTile(x, y + 1)?.civId !== civ.id;
          const W = this.world.getTile(x - 1, y)?.civId !== civ.id;
          const E = this.world.getTile(x + 1, y)?.civId !== civ.id;
          ctx.beginPath();
          if (N) {
            ctx.moveTo(sc.x, sc.y);
            ctx.lineTo(sc.x + ts, sc.y);
          }
          if (S) {
            ctx.moveTo(sc.x, sc.y + ts);
            ctx.lineTo(sc.x + ts, sc.y + ts);
          }
          if (W) {
            ctx.moveTo(sc.x, sc.y);
            ctx.lineTo(sc.x, sc.y + ts);
          }
          if (E) {
            ctx.moveTo(sc.x + ts, sc.y);
            ctx.lineTo(sc.x + ts, sc.y + ts);
          }
          ctx.stroke();
        }
      }

      // Civ center marker
      if (ts >= 4) {
        const sc = this.camera.worldToScreen(
          civ.centerX + 0.5,
          civ.centerY + 0.5,
        );
        ctx.fillStyle = civ.color;
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, Math.min(6, ts * 0.5), 0, Math.PI * 2);
        ctx.fill();
        if (ts > 8) {
          ctx.fillStyle = "#ffffff";
          ctx.font = `bold ${Math.min(10, ts * 0.6)}px monospace`;
          ctx.textAlign = "center";
          ctx.fillText(civ.name, sc.x, sc.y - ts * 0.6);
        }
      }
    }
    ctx.restore();
  }

  // ── Resources ─────────────────────────────────────────────

  _renderResources() {
    const ctx = this.ctx;
    const ts = this.camera.getTileSize();
    const b = this.camera.getVisibleTileBounds();

    const dotR = Math.max(1, ts * 0.15);
    const COLORS = {
      food: "#88ff44",
      wood: "#885522",
      stone: "#aaaaaa",
      water: "#4488ff",
      metal: "#ffcc00",
    };

    for (let y = b.minY; y <= b.maxY; y++) {
      for (let x = b.minX; x <= b.maxX; x++) {
        const tile = this.world.tiles[y][x];
        if (!tile.walkable) continue;
        const res = tile.resources;
        const sc = this.camera.worldToScreen(x, y);
        let xi = 0;
        for (const [type, col] of Object.entries(COLORS)) {
          if (res[type] > 5) {
            ctx.fillStyle = col + "bb";
            ctx.beginPath();
            ctx.arc(
              sc.x + ts * 0.25 + xi * dotR * 2.5,
              sc.y + ts * 0.75,
              dotR,
              0,
              Math.PI * 2,
            );
            ctx.fill();
            xi++;
          }
        }
      }
    }
  }

  // ── Events ────────────────────────────────────────────────

  _renderEvents(timestamp) {
    const ctx = this.ctx;
    const events = this.systems.event.getActiveEvents();
    if (!events.length) return;

    for (const e of events) {
      const sc = this.camera.worldToScreen(e.x, e.y);
      const r = e.radius * this.camera.getTileSize();
      const pulse = 0.12 + Math.sin(timestamp * 0.002) * 0.05;

      const grad = ctx.createRadialGradient(sc.x, sc.y, 0, sc.x, sc.y, r);
      grad.addColorStop(
        0,
        e.color +
          Math.round(pulse * 2.5 * 255)
            .toString(16)
            .padStart(2, "0"),
      );
      grad.addColorStop(
        0.6,
        e.color +
          Math.round(pulse * 255)
            .toString(16)
            .padStart(2, "0"),
      );
      grad.addColorStop(1, e.color + "00");

      ctx.save();
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Label
      const ts = this.camera.getTileSize();
      if (ts > 3) {
        ctx.save();
        ctx.fillStyle = e.color;
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        ctx.fillText(e.name.toUpperCase(), sc.x, sc.y - 4);
        ctx.restore();
      }
    }
  }

  // ── Agents ────────────────────────────────────────────────

  _renderAgents(timestamp) {
    const ctx = this.ctx;
    const ts = this.camera.getTileSize();
    const b = this.camera.getVisibleTileBounds();
    const agents = this.systems.agent.agents;

    const radius = Math.max(1.5, ts * 0.38);
    const showDetail = ts >= 5;

    for (const a of agents.values()) {
      if (!a.isAlive) continue;
      if (a.x < b.minX - 1 || a.x > b.maxX + 1) continue;
      if (a.y < b.minY - 1 || a.y > b.maxY + 1) continue;

      const sc = this.camera.worldToScreen(a.x + 0.5, a.y + 0.5);

      // Agent circle
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = a.color;
      ctx.fill();

      if (showDetail) {
        // Health indicator (small arc)
        if (a.health < 60) {
          ctx.beginPath();
          ctx.arc(
            sc.x,
            sc.y,
            radius + 1.5,
            -Math.PI * 0.5,
            -Math.PI * 0.5 + (a.health / 100) * Math.PI * 2,
          );
          ctx.strokeStyle = a.health < 30 ? "#ff3344" : "#ffaa00";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // State icon at high zoom
        if (ts >= 10) {
          const icons = {
            ATTACK: "⚔",
            FLEE: "↗",
            EAT: "●",
            REPRODUCE: "♥",
            REST: "z",
            GATHER: "↑",
          };
          const icon = icons[a.state];
          if (icon) {
            ctx.font = `${Math.min(8, ts * 0.5)}px sans-serif`;
            ctx.fillStyle = "#ffffff88";
            ctx.textAlign = "center";
            ctx.fillText(icon, sc.x, sc.y - radius - 2);
          }
        }
      }
    }
  }

  // ── Selection highlight ───────────────────────────────────

  _renderSelectedHighlight() {
    if (!this._selected) return;
    const ctx = this.ctx;
    const ts = this.camera.getTileSize();

    if (this._selected.id?.startsWith("a")) {
      // Agent
      const a = this._selected;
      if (!a.isAlive) {
        this._selected = null;
        return;
      }
      const sc = this.camera.worldToScreen(a.x + 0.5, a.y + 0.5);
      const r = Math.max(3, ts * 0.5);
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, r + 3, 0, Math.PI * 2);
      ctx.strokeStyle = "#00d4ff";
      ctx.lineWidth = 2;
      ctx.stroke();
      // Target line
      if (a.targetX !== null && a.targetY !== null && ts >= 4) {
        const tsc = this.camera.worldToScreen(a.targetX + 0.5, a.targetY + 0.5);
        ctx.beginPath();
        ctx.moveTo(sc.x, sc.y);
        ctx.lineTo(tsc.x, tsc.y);
        ctx.strokeStyle = "#00d4ff44";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else {
      // Civ center
      const civ = this._selected;
      if (!civ.isAlive) {
        this._selected = null;
        return;
      }
      const sc = this.camera.worldToScreen(
        civ.centerX + 0.5,
        civ.centerY + 0.5,
      );
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, Math.max(5, ts * 0.8), 0, Math.PI * 2);
      ctx.strokeStyle = civ.color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // ── Minimap ───────────────────────────────────────────────

  _renderMinimap(_timestamp) {
    if (!this._minimapCtx) return;
    const mc = this._minimapCtx;
    const mw = this._minimapCanvas.width;
    const mh = this._minimapCanvas.height;

    // Rebuild terrain cache every 2 s (captures territory changes + wildfires)
    const now = Date.now();
    if (this._minimapDirty || now - this._minimapTick > 2000) {
      this._minimapTerrainCache = this._buildMinimapTerrainImage(mw, mh);
      this._minimapTick = now;
      this._minimapDirty = false;
    }

    // Step 1: restore cached terrain (clears previous agent dots)
    if (this._minimapTerrainCache) {
      mc.putImageData(this._minimapTerrainCache, 0, 0);
    }

    // Step 2: draw alive agents as single pixels
    for (const a of this.systems.agent.agents.values()) {
      if (!a.isAlive) continue;
      const mx = Math.floor((a.x / this.world.width) * mw);
      const my = Math.floor((a.y / this.world.height) * mh);
      mc.fillStyle = a.color;
      mc.fillRect(mx, my, 1, 1);
    }

    // Step 3: viewport rectangle
    const b = this.camera.getVisibleTileBounds();
    const rx = (b.minX / this.world.width) * mw;
    const ry = (b.minY / this.world.height) * mh;
    const rw = ((b.maxX - b.minX) / this.world.width) * mw;
    const rh = ((b.maxY - b.minY) / this.world.height) * mh;
    mc.strokeStyle = "#00d4ff";
    mc.lineWidth = 1;
    mc.strokeRect(rx, ry, rw, rh);
  }

  /** Build (but don't draw) a terrain ImageData for the minimap. */
  _buildMinimapTerrainImage(mw, mh) {
    const img = this._minimapCtx.createImageData(mw, mh);
    const data = img.data;
    for (let py = 0; py < mh; py++) {
      for (let px = 0; px < mw; px++) {
        const tx = Math.floor((px / mw) * this.world.width);
        const ty = Math.floor((py / mh) * this.world.height);
        const tile = this.world.tiles[ty]?.[tx];
        if (!tile) continue;
        const col = BIOME_COLORS[tile.type] ?? "#000";
        let [r, g, b] = _hexToRgb(col);
        // Territory tint
        if (tile.civId) {
          const civ = this.systems.civ.getCivById(tile.civId);
          if (civ) {
            const [cr, cg, cb] = _hslToRgb(civ.hue ?? 120, 0.7, 0.55);
            r = (r + cr) >> 1;
            g = (g + cg) >> 1;
            b = (b + cb) >> 1;
          }
        }
        const idx = (py * mw + px) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }
    return img;
  }
}

// ── Utilities ──────────────────────────────────────────────

const _rgbCache = new Map();

/** HSL (h:0-360, s:0-1, l:0-1) → [r,g,b] 0-255 */
function _hslToRgb(h, s, l) {
  const hn = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(_hue2rgb(p, q, hn + 1 / 3) * 255),
    Math.round(_hue2rgb(p, q, hn) * 255),
    Math.round(_hue2rgb(p, q, hn - 1 / 3) * 255),
  ];
}

function _hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function _hexToRgb(hex) {
  if (_rgbCache.has(hex)) return _rgbCache.get(hex);
  const clean = hex.replace("#", "");
  let n;
  if (clean.length === 3) {
    n = parseInt(
      clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2],
      16,
    );
  } else if (clean.length === 6) {
    n = parseInt(clean, 16);
  } else {
    // HSL fallback – approximate
    return [128, 128, 128];
  }
  const r = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  _rgbCache.set(hex, r);
  return r;
}
