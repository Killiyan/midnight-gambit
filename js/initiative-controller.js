// systems/midnight-gambit/js/initiative-controller.js
// Single source of truth + replicated signals for MG initiative.
// Logic-only: no DOM, no animations, no UI.

const MG_NS = "midnight-gambit";
const SOCKET_CHANNEL = "system.midnight-gambit";

function mgGet(obj, path) {
  return foundry.utils.getProperty(obj, path);
}

function mgNewSyncId() {
  return foundry.utils.randomID?.()
    ?? globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random()}`;
}

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
   * Bar/sidebar should listen here and render from payloads.
   */
  subscribe(fn) {
    if (typeof fn !== "function") return () => {};
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  }

  activate() {
    if (this._wired) return;
    this._wired = true;

    Hooks.on("updateActor", (actor, changed) => {
      const crew = this.resolveCrewActor();
      if (!crew || actor.id !== crew.id) return;

      const progress = mgGet(changed, `flags.${MG_NS}.initiativeProgress`);
      if (progress && typeof progress === "object") {
        const { syncId } = progress;
        if (syncId && this._lastSyncId === syncId) return;
        if (syncId) this._lastSyncId = syncId;

        this._emit({ type: "progress", payload: progress });
        return;
      }

      const resetSig = mgGet(changed, `flags.${MG_NS}.initiativeReset`);
      if (resetSig && typeof resetSig === "object") {
        const { syncId } = resetSig;
        if (syncId && this._lastSyncId === syncId) return;
        if (syncId) this._lastSyncId = syncId;

        this._emit({ type: "reset", payload: resetSig });
        return;
      }

      const touchedFlag = mgGet(changed, `flags.${MG_NS}.initiativeOrder`);
      const touchedSystem = mgGet(changed, "system.initiative.order");
      const touchedHidden = mgGet(changed, "system.initiative.hidden");

      if (touchedFlag || touchedSystem || touchedHidden) {
        const ids = this.getOrderActorIds();
        const activeIndex = this.getActiveIndex(ids);

        this._emit({
          type: "order",
          payload: {
            ids,
            activeIndex,
            syncId: mgNewSyncId(),
            at: Date.now()
          }
        });
      }
    });

    // GM relay: non-GMs request writes here.
    if (game.socket) {
      game.socket.on(SOCKET_CHANNEL, async (msg) => {
        if (!game.user?.isGM) return;
        if (!msg || !msg.type) return;

        try {
          if (msg.type === "iniAdvanceRequest") {
            await this.advance({ fromRelay: true });
          }

          if (msg.type === "iniResetRequest") {
            await this.reset({ fromRelay: true });
          }
        } catch (e) {
          console.error("MG | GM initiative relay failed:", e);
        }
      });
    }
  }

  _emit(evt) {
    for (const fn of this._subs) {
      try {
        fn(evt);
      } catch (e) {
        console.error("MG | Initiative subscriber error:", e);
      }
    }
  }

  // ------------------------------------------------------------------
  // Source-of-truth helpers
  // ------------------------------------------------------------------

  resolveCrewActor() {
    let crew = null;

    try {
      const id = game.settings.get(MG_NS, "crewActorId");
      if (id) crew = game.actors.get(id) || null;
    } catch (_) {}

    if (!crew) {
      let legacy = null;
      try {
        legacy = game.settings.get(MG_NS, "activeCrewUuid");
      } catch (_) {}

      if (typeof legacy === "string" && legacy.startsWith("Actor.")) {
        const id = legacy.split(".")[1];
        crew = game.actors.get(id) || null;
      }
    }

    if (!crew) crew = game.actors.find(a => a.type === "crew") || null;

    return crew;
  }

  getOrderActorIds() {
    const crew = this.resolveCrewActor();

    const fromFlag = crew?.getFlag(MG_NS, "initiativeOrder");
    if (Array.isArray(fromFlag) && fromFlag.length) {
      return fromFlag.filter(id => !!game.actors.get(id));
    }

    const uuids = crew?.system?.initiative?.order ?? [];
    const hidden = new Set(
      Array.isArray(crew?.system?.initiative?.hidden)
        ? crew.system.initiative.hidden
        : []
    );

    if (Array.isArray(uuids) && uuids.length) {
      const ids = uuids
        .filter(uuid => !hidden.has(uuid))
        .map(uuid => {
          if (typeof uuid !== "string") return null;
          if (uuid.startsWith("Actor.")) return uuid.split(".")[1];
          return null;
        })
        .filter(id => id && game.actors.get(id));

      if (ids.length) return ids;
    }

    return game.actors
      .filter(a =>
        a.type === "character" &&
        (
          a.isOwner ||
          Object.values(a.ownership || {}).some(x => x >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)
        )
      )
      .map(a => a.id);
  }

  getCycleLength(ids = this.getOrderActorIds()) {
    const count = Array.isArray(ids) ? ids.length : 0;
    return Math.max(1, count + 1); // +1 for END
  }

  normalizeIndex(index, ids = this.getOrderActorIds()) {
    const L = this.getCycleLength(ids);
    const n = Number(index ?? 0);
    return ((n % L) + L) % L;
  }

  getActiveIndex(ids = this.getOrderActorIds()) {
    try {
      const st = canvas?.scene?.getFlag?.(MG_NS, "initState");
      return this.normalizeIndex(st?.activeIndex ?? 0, ids);
    } catch (_) {
      return 0;
    }
  }

  getSnapshot() {
    const ids = this.getOrderActorIds();
    const activeIndex = this.getActiveIndex(ids);

    return {
      ids,
      activeIndex,
      syncId: null,
      at: Date.now()
    };
  }

  async _persistSceneState({ ids, activeIndex }) {
    if (!game.user?.isGM) return;

    try {
      await canvas?.scene?.setFlag?.(MG_NS, "initState", {
        orderIds: ids,
        activeIndex: this.normalizeIndex(activeIndex, ids)
      });
    } catch (e) {
      console.warn("MG | Failed to persist initiative scene state:", e);
    }
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  async advance({ fromRelay = false } = {}) {
    const crew = this.resolveCrewActor();

    if (!crew) {
      ui.notifications?.warn("No Crew actor configured.");
      return;
    }

    const ids = this.getOrderActorIds();

    if (!ids.length) {
      ui.notifications?.warn("No actors in Initiative to advance.");
      return;
    }

    // Non-GM asks the GM to perform the canonical write.
    if (!game.user?.isGM && !fromRelay) {
      game.socket?.emit(SOCKET_CHANNEL, { type: "iniAdvanceRequest" });
      return;
    }

    const prev = this.getActiveIndex(ids);
    const next = this.normalizeIndex(prev + 1, ids);

    const payload = {
      ids,
      prev,
      next,
      activeIndex: next,
      syncId: mgNewSyncId(),
      at: Date.now()
    };

    try {
      await this._persistSceneState({ ids, activeIndex: next });
      await crew.setFlag(MG_NS, "initiativeProgress", payload);
    } catch (e) {
      console.error("MG | Failed to advance initiative:", e);
      ui.notifications?.error("Couldn’t advance initiative.");
    }
  }

  async reset({ fromRelay = false } = {}) {
    const crew = this.resolveCrewActor();

    if (!crew) {
      ui.notifications?.warn("No Crew actor configured.");
      return;
    }

    const ids = this.getOrderActorIds();

    if (!ids.length) {
      ui.notifications?.warn("No actors in Initiative to reset.");
      return;
    }

    // Non-GM asks the GM to perform the canonical write.
    if (!game.user?.isGM && !fromRelay) {
      game.socket?.emit(SOCKET_CHANNEL, { type: "iniResetRequest" });
      return;
    }

    const payload = {
      ids,
      prev: this.getActiveIndex(ids),
      next: 0,
      activeIndex: 0,
      syncId: mgNewSyncId(),
      at: Date.now()
    };

    try {
      await this._persistSceneState({ ids, activeIndex: 0 });
      await crew.setFlag(MG_NS, "initiativeReset", payload);
    } catch (e) {
      console.error("MG | Failed to reset initiative:", e);
      ui.notifications?.error("Couldn’t reset initiative.");
    }
  }
}