// evolve — ui manager
import { BIOME_COLORS } from "../config.js";

const SPEEDS = [0.25, 0.5, 1, 2, 5, 10, 20];

export class UI {
  constructor(game, systems, renderer) {
    this.game = game;
    this.systems = systems;
    this.renderer = renderer;

    this._speedIdx = 2; // index into SPEEDS (default 1x)
    this._logEntries = [];
    this._inspected = null;
    this._lastFpsTimes = [];

    this._buildLegend();
    this._bindControls();
    this._bindCanvasClicks();
  }

  // ── Public API ────────────────────────────────────────────

  /**
   * Update system + renderer references after a world restart.
   * Does NOT re-register DOM event listeners (avoids duplicates).
   */
  rebind(systems, renderer) {
    this.systems = systems;
    this.renderer = renderer;
    this._inspected = null;
    this._logEntries = [];
    this._speedIdx = 2; // reset to 1×
    document.getElementById("inspector-panel").style.display = "none";
  }

  update(tick, fps) {
    this._updateTopBar(tick, fps);
    this._updateStatsPanel();
    if (this._inspected) this._updateInspector();
    this._flushEventLogs();
  }

  addEventLog(msg, type = "new") {
    this._logEntries.push({ msg, type });
  }

  showInspector(entity) {
    this._inspected = entity;
    document.getElementById("inspector-panel").style.display = "block";
    this._updateInspector();
  }

  hideInspector() {
    this._inspected = null;
    document.getElementById("inspector-panel").style.display = "none";
    this.renderer.setSelected(null);
  }

  getSelectedAgent() {
    return this._inspected?.id?.startsWith("a") ? this._inspected : null;
  }

  getSelectedCiv() {
    return this._inspected?.id?.startsWith("civ") ? this._inspected : null;
  }

  // ── Top bar ───────────────────────────────────────────────

  _updateTopBar(tick, fps) {
    _set("tick-display", tick.toLocaleString());
    _set("agent-count", this.systems.agent.getCount().toLocaleString());
    _set("civ-count", this.systems.civ.getCount());
    _set("dead-count", this.systems.agent.deadCount.toLocaleString());
    _set("fps-display", Math.round(fps));
    _set("speed-display", SPEEDS[this._speedIdx] + "×");
  }

  // ── Stats panel ───────────────────────────────────────────

  _updateStatsPanel() {
    const panel = document.getElementById("detailed-stats");
    if (!panel) return;

    const ev = this.systems.evolution.getStats();
    const evs = this.systems.event.getActiveEvents();

    let html = "";

    // Population line
    html += `<div class="ds-row"><span class="ds-label">ALIVE</span><span class="ds-value">${this.systems.agent.getCount()}</span></div>`;
    html += `<div class="ds-row"><span class="ds-label">DEAD TOTAL</span><span class="ds-value">${this.systems.agent.deadCount}</span></div>`;
    html += `<div class="ds-row"><span class="ds-label">CIVILIZATIONS</span><span class="ds-value">${this.systems.civ.getCount()}</span></div>`;

    if (ev.total > 0) {
      html += `<div class="ds-row" style="margin-top:6px"><span class="ds-label">GEN AVG</span><span class="ds-value">${ev.avgGeneration.toFixed(1)}</span></div>`;
      const traits = [
        "intelligence",
        "aggression",
        "socialTendency",
        "speed",
        "strength",
      ];
      const labels = ["INTEL", "AGGR", "SOCIAL", "SPEED", "STR"];
      html += `<div style="margin-top:6px">`;
      for (let i = 0; i < traits.length; i++) {
        const v = ev[traits[i]] ?? 0;
        const isDom = traits[i] === ev.dominantTrait;
        html += `<div class="trait-bar-row">
          <span class="trait-bar-label" style="color:${isDom ? "#00ff88" : ""}">${labels[i]}</span>
          <div class="trait-bar-bg"><div class="trait-bar-fill" style="width:${Math.round(v * 100)}%;background:${isDom ? "#00ff88" : "#aa55ff"}"></div></div>
          <span style="font-family:monospace;font-size:9px;color:#7a9aaa;margin-left:4px">${(v * 100).toFixed(0)}%</span>
        </div>`;
      }
      html += `</div>`;
    }

    // Active events
    if (evs.length > 0) {
      html += `<div class="ds-row" style="margin-top:8px;border-top:1px solid rgba(0,212,255,0.18);padding-top:6px">
        <span class="ds-label">ACTIVE EVENTS</span></div>`;
      for (const e of evs) {
        const pct = Math.round((e.remainingDuration / e.duration) * 100);
        html += `<div class="ds-row"><span class="ds-label" style="color:${e.color}">${e.name.toUpperCase()}</span>
          <span class="ds-value" style="color:${e.color}">${pct}%</span></div>`;
      }
    }

    panel.innerHTML = html;
  }

  // ── Inspector ─────────────────────────────────────────────

  _updateInspector() {
    const panel = document.getElementById("inspector-content");
    if (!panel || !this._inspected) return;

    const e = this._inspected;

    if (e.id?.startsWith("a")) {
      if (!e.isAlive) {
        this.hideInspector();
        return;
      }
      // Agent inspector
      const civ = e.civId ? this.systems.civ.getCivById(e.civId) : null;
      const bar = (v, cls) =>
        `<div class="stat-bar-bg"><div class="stat-bar-fill ${cls}" style="width:${Math.round(v)}%"></div></div>`;
      const tbar = (v) =>
        `<div class="trait-bar-bg"><div class="trait-bar-fill trait" style="width:${Math.round(v * 100)}%"></div></div>`;

      panel.innerHTML = `
        <div class="insp-name" style="color:${e.color}">#${e.id.padStart(6, "0")}</div>
        <div class="insp-role">${e.getRole()} · Gen ${e.generation}</div>
        ${civ ? `<div class="insp-civ">◆ ${civ.name}</div>` : '<div class="insp-role">◇ Wanderer</div>'}

        <div class="stat-bar-row"><span class="stat-bar-label">Health</span>${bar(e.health, "health")}</div>
        <div class="stat-bar-row"><span class="stat-bar-label">Hunger</span>${bar(e.hunger, "hunger")}</div>
        <div class="stat-bar-row"><span class="stat-bar-label">Stamina</span>${bar(e.stamina, "stamina")}</div>

        <div class="insp-section">
          <div class="insp-section-title">TRAITS</div>
          <div class="stat-bar-row"><span class="stat-bar-label">Intel</span>${tbar(e.intelligence)}</div>
          <div class="stat-bar-row"><span class="stat-bar-label">Aggr</span>${tbar(e.aggression)}</div>
          <div class="stat-bar-row"><span class="stat-bar-label">Social</span>${tbar(e.socialTendency)}</div>
          <div class="stat-bar-row"><span class="stat-bar-label">Speed</span>${tbar(e.speed)}</div>
          <div class="stat-bar-row"><span class="stat-bar-label">Strength</span>${tbar(e.strength)}</div>
        </div>

        <div class="insp-section">
          <div class="insp-meta">
            Age: ${e.age} / ${Math.round(e.maxAge)}<br>
            Children: ${e.children} · Kills: ${e.kills}<br>
            Pos: (${e.x}, ${e.y})
          </div>
          <div class="insp-state">STATE: ${e.state}</div>
        </div>
      `;
    } else {
      const civ = e;
      if (!civ.isAlive) {
        this.hideInspector();
        return;
      }
      const pop = civ.agentIds.size;
      const res = civ.resources;

      let relHtml = "";
      for (const [otherId, rel] of civ.relations) {
        const other = this.systems.civ.getCivById(otherId);
        if (!other?.isAlive) continue;
        const cls =
          rel === "WAR"
            ? "rel-war"
            : rel === "ALLIED"
              ? "rel-allied"
              : rel === "PEACE"
                ? "rel-peace"
                : "rel-neutral";
        relHtml += `<div class="relation-item"><span style="color:${other.color}">${other.name}</span><span class="${cls}">${rel}</span></div>`;
      }

      panel.innerHTML = `
        <div class="insp-name" style="color:${civ.color}">${civ.name}</div>
        <div class="insp-role">Age ${civ.age} · Founded tick ${civ.foundedAt}</div>
        <div class="insp-meta" style="margin-top:8px">
          Population: <b>${pop}</b> (peak: ${civ.peakPopulation})<br>
          Territory: ${civ.territory.size} tiles<br>
          Wars: ${civ.warCount} · Kills: ${civ.totalKills}
        </div>

        <div class="insp-section">
          <div class="insp-section-title">RESOURCES</div>
          <div class="res-grid">
            ${["food", "wood", "stone", "water", "metal"]
              .map(
                (t) =>
                  `<div class="res-cell"><div class="res-label">${t.toUpperCase()}</div><div class="res-val">${Math.round(res[t])}</div></div>`,
              )
              .join("")}
          </div>
        </div>

        ${
          relHtml
            ? `<div class="insp-section"><div class="insp-section-title">RELATIONS</div>
          <div class="relations-list">${relHtml}</div></div>`
            : ""
        }
      `;
    }
  }

  // ── Event log ─────────────────────────────────────────────

  _flushEventLogs() {
    if (!this._logEntries.length) return;
    const container = document.getElementById("event-messages");
    if (!container) return;

    for (const { msg, type } of this._logEntries) {
      const el = document.createElement("div");
      el.className = `event-msg ${type}`;
      el.textContent = msg;
      container.insertBefore(el, container.firstChild);
      // Keep last 20 entries
      while (container.children.length > 20) {
        container.removeChild(container.lastChild);
      }
    }
    this._logEntries = [];
  }

  // ── Controls ──────────────────────────────────────────────

  _bindControls() {
    document.getElementById("btn-pause")?.addEventListener("click", () => {
      this.game.running = !this.game.running;
      const btn = document.getElementById("btn-pause");
      if (btn) btn.textContent = this.game.running ? "⏸" : "▶";
    });

    document.getElementById("btn-faster")?.addEventListener("click", () => {
      this._speedIdx = Math.min(SPEEDS.length - 1, this._speedIdx + 1);
      this.game.speed = SPEEDS[this._speedIdx];
    });

    document.getElementById("btn-slower")?.addEventListener("click", () => {
      this._speedIdx = Math.max(0, this._speedIdx - 1);
      this.game.speed = SPEEDS[this._speedIdx];
    });

    document.getElementById("btn-reset")?.addEventListener("click", () => {
      this.game.restart();
    });

    document
      .getElementById("inspector-close")
      ?.addEventListener("click", () => {
        this.hideInspector();
      });

    // Minimap click → pan camera
    document
      .getElementById("minimap-container")
      ?.addEventListener("click", (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const mcW = document.getElementById("minimap-canvas")?.width ?? 160;
        const mcH = document.getElementById("minimap-canvas")?.height ?? 125;
        const px = ((e.clientX - rect.left) / rect.width) * mcW;
        const py = ((e.clientY - rect.top) / rect.height) * mcH;
        const wx = Math.round((px / mcW) * (this.game.world?.width ?? 256));
        const wy = Math.round((py / mcH) * (this.game.world?.height ?? 200));
        this.game.camera?.smoothPanTo(wx, wy);
      });
  }

  _bindCanvasClicks() {
    const canvas = document.getElementById("world-canvas");
    if (!canvas) return;

    canvas.addEventListener("click", (e) => {
      if (e.altKey) return; // alt+click = pan, ignore
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      // Try agent first, then civ
      const agent = this.renderer.getAgentAtScreen(sx, sy);
      if (agent) {
        this.renderer.setSelected(agent);
        this.showInspector(agent);
        return;
      }

      const civ = this.renderer.getCivAtScreen(sx, sy);
      if (civ) {
        this.renderer.setSelected(civ);
        this.showInspector(civ);
        return;
      }

      // Click on empty space — deselect
      this.hideInspector();
    });

    canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.hideInspector();
    });
  }

  // ── Legend ────────────────────────────────────────────────

  _buildLegend() {
    const container = document.getElementById("legend-items");
    if (!container) return;

    const show = [
      "DEEP_OCEAN",
      "OCEAN",
      "COAST",
      "BEACH",
      "GRASSLAND",
      "FOREST",
      "SWAMP",
      "DESERT",
      "SAVANNA",
      "TAIGA",
      "TUNDRA",
      "MOUNTAIN",
      "SNOW_PEAK",
    ];
    const labels = {
      DEEP_OCEAN: "Deep Ocean",
      OCEAN: "Ocean",
      COAST: "Coast",
      BEACH: "Beach",
      GRASSLAND: "Grassland",
      FOREST: "Forest",
      SWAMP: "Swamp",
      DESERT: "Desert",
      SAVANNA: "Savanna",
      TAIGA: "Taiga",
      TUNDRA: "Tundra",
      MOUNTAIN: "Mountain",
      SNOW_PEAK: "Snow Peak",
    };

    container.innerHTML = show
      .map(
        (type) => `
      <div class="legend-item">
        <div class="legend-swatch" style="background:${BIOME_COLORS[type]}"></div>
        <span>${labels[type]}</span>
      </div>
    `,
      )
      .join("");
  }
}

function _set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
