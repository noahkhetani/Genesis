// evolve — camera  (pan + zoom, keyboard + mouse)
import { CONFIG } from "../config.js";

export class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    this.x = 0; // world-pixel position of canvas centre
    this.y = 0;
    this.zoom = 1;

    this._keys = {};
    this._dragging = false;
    this._dragStart = { x: 0, y: 0, camX: 0, camY: 0 };

    // Smooth-pan target (null = no pending pan)
    this._panTarget = null;

    this._bindEvents();
  }

  // ── Public helpers ────────────────────────────────────────

  getTileSize() {
    return CONFIG.TILE_SIZE * this.zoom;
  }
  get width() {
    return this.canvas.width;
  }
  get height() {
    return this.canvas.height;
  }

  /** World tile coords → canvas pixel coords (top-left of tile). */
  worldToScreen(wx, wy) {
    const ts = this.getTileSize();
    return {
      x: wx * ts - this.x + this.canvas.width * 0.5,
      y: wy * ts - this.y + this.canvas.height * 0.5,
    };
  }

  /** Canvas pixel coords → world tile coords. */
  screenToWorld(sx, sy) {
    const ts = this.getTileSize();
    return {
      x: (sx - this.canvas.width * 0.5 + this.x) / ts,
      y: (sy - this.canvas.height * 0.5 + this.y) / ts,
    };
  }

  /** Tile index range visible on screen (with 1-tile margin). */
  getVisibleTileBounds() {
    const ts = this.getTileSize();
    const hw = this.canvas.width * 0.5;
    const hh = this.canvas.height * 0.5;
    return {
      minX: Math.max(0, Math.floor((this.x - hw) / ts) - 1),
      minY: Math.max(0, Math.floor((this.y - hh) / ts) - 1),
      maxX: Math.min(CONFIG.WORLD_WIDTH - 1, Math.ceil((this.x + hw) / ts) + 1),
      maxY: Math.min(
        CONFIG.WORLD_HEIGHT - 1,
        Math.ceil((this.y + hh) / ts) + 1,
      ),
    };
  }

  panTo(wx, wy) {
    const ts = this.getTileSize();
    this.x = wx * ts;
    this.y = wy * ts;
    this.clampToWorld();
  }

  smoothPanTo(wx, wy) {
    this._panTarget = { x: wx, y: wy };
  }

  clampToWorld() {
    const ts = this.getTileSize();
    const worldW = CONFIG.WORLD_WIDTH * ts;
    const worldH = CONFIG.WORLD_HEIGHT * ts;
    const hw = this.canvas.width * 0.5;
    const hh = this.canvas.height * 0.5;

    // When the world is narrower/shorter than the viewport, lock to centre
    if (worldW <= this.canvas.width) {
      this.x = worldW * 0.5;
    } else {
      this.x = Math.max(hw, Math.min(worldW - hw, this.x));
    }

    if (worldH <= this.canvas.height) {
      this.y = worldH * 0.5;
    } else {
      this.y = Math.max(hh, Math.min(worldH - hh, this.y));
    }
  }

  /** Set zoom so the whole world fits within the viewport. */
  fitWorld() {
    const zw = this.canvas.width / (CONFIG.WORLD_WIDTH * CONFIG.TILE_SIZE);
    const zh = this.canvas.height / (CONFIG.WORLD_HEIGHT * CONFIG.TILE_SIZE);
    this.zoom = Math.max(
      CONFIG.ZOOM_MIN,
      Math.min(CONFIG.ZOOM_MAX, Math.min(zw, zh) * 0.95),
    );
    this.panTo(CONFIG.WORLD_WIDTH * 0.5, CONFIG.WORLD_HEIGHT * 0.5);
  }

  // ── Per-frame update ──────────────────────────────────────

  update(dt) {
    const spd = (CONFIG.PAN_SPEED * dt) / 1000;

    if (this._keys["ArrowLeft"] || this._keys["a"] || this._keys["A"])
      this.x -= spd;
    if (this._keys["ArrowRight"] || this._keys["d"] || this._keys["D"])
      this.x += spd;
    if (this._keys["ArrowUp"] || this._keys["w"] || this._keys["W"])
      this.y -= spd;
    if (this._keys["ArrowDown"] || this._keys["s"] || this._keys["S"])
      this.y += spd;

    // Smooth pan
    if (this._panTarget) {
      const ts = this.getTileSize();
      const tx = this._panTarget.x * ts;
      const ty = this._panTarget.y * ts;
      this.x += (tx - this.x) * 0.1;
      this.y += (ty - this.y) * 0.1;
      if (Math.abs(this.x - tx) < 1 && Math.abs(this.y - ty) < 1) {
        this.x = tx;
        this.y = ty;
        this._panTarget = null;
      }
    }

    if (!this._dragging) this.clampToWorld();
  }

  // ── Event binding ─────────────────────────────────────────

  _bindEvents() {
    const c = this.canvas;

    c.addEventListener("wheel", (e) => this.handleWheel(e), { passive: false });
    c.addEventListener("mousedown", (e) => this.handleMouseDown(e));
    c.addEventListener("mousemove", (e) => this.handleMouseMove(e));
    c.addEventListener("mouseup", (e) => this.handleMouseUp(e));
    c.addEventListener("mouseleave", (e) => this.handleMouseUp(e));

    window.addEventListener("keydown", (e) => {
      this._keys[e.key] = true;
    });
    window.addEventListener("keyup", (e) => {
      this._keys[e.key] = false;
    });
  }

  handleWheel(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const world = this.screenToWorld(mx, my);

    const delta = e.deltaY > 0 ? -CONFIG.ZOOM_STEP : CONFIG.ZOOM_STEP;
    const newZoom = Math.max(
      CONFIG.ZOOM_MIN,
      Math.min(CONFIG.ZOOM_MAX, this.zoom + delta),
    );

    if (newZoom === this.zoom) return;

    // Zoom toward mouse cursor
    const ts0 = this.getTileSize();
    this.zoom = newZoom;
    const ts1 = this.getTileSize();
    this.x += world.x * (ts1 - ts0);
    this.y += world.y * (ts1 - ts0);

    this.clampToWorld();
  }

  handleMouseDown(e) {
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
      this._dragging = true;
      this._dragStart = {
        x: e.clientX,
        y: e.clientY,
        camX: this.x,
        camY: this.y,
      };
      this.canvas.style.cursor = "grabbing";
    }
  }

  handleMouseMove(e) {
    if (!this._dragging) return;
    this.x = this._dragStart.camX - (e.clientX - this._dragStart.x);
    this.y = this._dragStart.camY - (e.clientY - this._dragStart.y);
    this.clampToWorld();
  }

  handleMouseUp(_e) {
    this._dragging = false;
    this.canvas.style.cursor = "crosshair";
  }
}
