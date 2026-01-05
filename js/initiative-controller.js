// systems/midnight-gambit/js/initiative-controller.js
// Single source of truth + replicated signals for MG initiative.
// Logic-only: no DOM, no animations, no UI.

const MG_NS = "midnight-gambit";
const SOCKET_CHANNEL = "system.midnight-gambit";

export class MGInitiativeController {
  static #instance;

  static get instance() {
    if (!this.#instance) this.#instance = new MGInitiativeController();
    return this.#instance;
  }

  constructor() {
    this._subs = new Set();
    this._wired = false;
    this._lastSyncId = null;
  }

  /**
   * Subscribe to replicated initiative events.
   * @param {(evt: {type: "progress"|"reset"|"order", payload: any}) => void} fn
   * @returns {() => void} unsubscribe
   */
  subscribe(fn) {
    if (typeof fn !== "function") return () => {};
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  }

  /** Turn on hooks + GM relay once. Safe to call multiple times. */
  activate() {
    if (this._wired) return;
    this._wired = true;

    // Replicated updates: listen to Crew actor flag changes
    Hooks.on("updateActor", (actor, changed) => {
      const crew = this.resolveCrewActor();
      if (!crew || actor.id !== crew.id) return;

      const progress = getProperty(changed, `flags.${MG_NS}.initiativeProgress`);
      if (progress && typeof progress === "object") {
        const { syncId } = progress;
        if (syncId && this._lastSyncId === syncId) return;
        if (syncId) this._lastSyncId = syncId;

        this._emit({ type: "progress", payload: progress });
        return;
      }

      const resetSig = getProperty(changed, `flags.${MG_NS}.initiativeReset`);
      if (resetSig && typeof resetSig === "object") {
        const { syncId } = resetSig;
        if (syncId && this._lastSyncId === syncId) return;
        if (syncId) this._lastSyncId = syncId;

        this._emit({ type: "reset", payload: resetSig });
        return;
      }

      // Order changed (flag or system path)
      const touchedFlag = getProperty(changed, `flags.${MG_NS}.initiativeOrder`);
      const touchedSystem = getProperty(changed, "system.initiative.order");
      if (touchedFlag || touchedSystem) {
        this._emit({ type: "order", payload: { ids: this.getOrderActorIds() } });
      }
    });

    // GM relay: non-GMs request writes via socket if needed
    if (game.socket) {
      game.socket.on(SOCKET_CHANNEL, async (msg) => {
        if (!game.user?.isGM) return;
        if (!msg || !msg.type) return;

        const crew = this.resolveCrewActor();
        if (!crew) return;

        try {
          if (msg.type === "iniProgress") {
            await crew.setFlag(MG_NS, "initiativeProgress", msg.payload);
          } else if (msg.type === "iniReset") {
            await crew.setFlag(MG_NS, "initiativeReset", msg.payload);
          }
        } catch (e) {
          console.error("MG | GM initiative relay failed:", e);
        }
      });
    }
  }

  _emit(evt) {
    for (const fn of this._subs) {
      try { fn(evt); } catch (e) { console.error("MG | Initiative subscriber error:", e); }
    }
  }

  // ----------------------------
  // Source-of-truth helpers
  // ----------------------------

  /** Null-safe: find the current Crew actor (mirrors your initiative-bar logic). */
  resolveCrewActor() {
    let crew = null;

    // Preferred: world setting by Actor ID
    try {
      const id = game.settings.get(MG_NS, "crewActorId");
      if (id) crew = game.actors.get(id) || null;
    } catch (_) {}

    // Legacy: world setting by Actor UUID string (e.g., "Actor.ABC123")
    if (!crew) {
      let legacy = null;
      try { legacy = game.settings.get(MG_NS, "activeCrewUuid"); } catch (_) {}
      if (typeof legacy === "string" && legacy.startsWith("Actor.")) {
        const id = legacy.split(".")[1];
        crew = game.actors.get(id) || null;
      }
    }

    // Fallback: any crew actor
    if (!crew) crew = game.actors.find(a => a.type === "crew") || null;

    return crew;
  }

  /** Prefer Crew flag -> fallback to crew.system initiative -> fallback to owned PCs. */
  getOrderActorIds() {
    const crew = this.resolveCrewActor();

    const fromFlag = crew?.getFlag(MG_NS, "initiativeOrder");
    if (Array.isArray(fromFlag) && fromFlag.length) {
      return fromFlag.filter(id => !!game.actors.get(id));
    }

    const uuids = crew?.system?.initiative?.order ?? [];
    const hidden = new Set(Array.isArray(crew?.system?.initiative?.hidden) ? crew.system.initiative.hidden : []);

    if (Array.isArray(uuids) && uuids.length) {
      const ids = uuids
        .filter(u => !hidden.has(u))
        .map(u => (typeof u === "string" && u.startsWith("Actor.")) ? u.split(".")[1] : null)
        .filter(id => id && game.actors.get(id));
      if (ids.length) return ids;
    }

    return game.actors
      .filter(a =>
        a.type === "character" &&
        (a.isOwner || Object.values(a.ownership || {}).some(x => x >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER))
      )
      .map(a => a.id);
  }

  /** Read durable activeIndex from Scene flag (written by your UI), else 0. */
  getActiveIndex(ids) {
    try {
      const st = canvas?.scene?.getFlag?.(MG_NS, "initState");
      const ai = Number(st?.activeIndex ?? 0);
      const n = Array.isArray(ids) ? ids.length : 0;
      const L = Math.max(1, n + 1); // + END
      return ((ai % L) + L) % L;
    } catch (_) {
      return 0;
    }
  }

  // ----------------------------
  // Actions (replicated writes)
  // ----------------------------

  async advance() {
    const crew = this.resolveCrewActor();
    if (!crew) return ui.notifications?.warn("No Crew actor configured.");

    const ids = this.getOrderActorIds();
    if (!ids.length) return ui.notifications?.warn("No actors in Initiative to advance.");

    const prev = this.getActiveIndex(ids);

    const payload = {
      ids,
      prev,
      syncId: foundry.utils.randomID?.() ?? (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`),
      at: Date.now()
    };

    try {
      await crew.setFlag(MG_NS, "initiativeProgress", payload);
    } catch (e) {
      if (!game.user?.isGM && game.socket) {
        game.socket.emit(SOCKET_CHANNEL, { type: "iniProgress", payload });
        ui.notifications?.info("Requested GM to advance initiative.");
        return;
      }
      console.error("MG | Failed to emit initiative progress:", e);
      ui.notifications?.error("Couldn’t advance initiative (no permission).");
    }
  }

  async reset() {
    const crew = this.resolveCrewActor();
    if (!crew) return ui.notifications?.warn("No Crew actor configured.");

    const ids = this.getOrderActorIds();
    if (!ids.length) return ui.notifications?.warn("No actors in Initiative to reset.");

    const payload = {
      ids,
      syncId: foundry.utils.randomID?.() ?? (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`),
      at: Date.now()
    };

    try {
      await crew.setFlag(MG_NS, "initiativeReset", payload);
    } catch (e) {
      if (!game.user?.isGM && game.socket) {
        game.socket.emit(SOCKET_CHANNEL, { type: "iniReset", payload });
        ui.notifications?.info("Requested GM to reset initiative.");
        return;
      }
      console.error("MG | Failed to emit initiative reset:", e);
      ui.notifications?.error("Couldn’t reset initiative (no permission).");
    }
  }
}
