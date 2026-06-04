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

function mgCanUpdateDocument(doc) {
  if (!doc) return false;
  if (game.user?.isGM) return true;
  if (typeof doc.canUserModify === "function") {
    try {
      if (doc.canUserModify(game.user, "update")) return true;
    } catch (_) {}
  }
  return !!doc.isOwner;
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

          if (msg.type === "iniCrewSourceRequest") {
            const crew = game.actors?.get?.(msg.crewId);
            if (crew?.type !== "crew") return;
            await game.settings.set(MG_NS, "activeCrewUuid", crew.uuid);
            await game.settings.set(MG_NS, "crewActorId", crew.id);
          }

          if (msg.type === "iniApplyOrderRequest") {
            const crew = game.actors?.get?.(msg.crewId);
            await this.applyOrder(crew, msg.uuids, msg.actorIds, { fromRelay: true });
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
    const crew = this.resolveCrewActor();

    try {
      const sceneState = canvas?.scene?.getFlag?.(MG_NS, "initState");
      const progress = crew?.getFlag?.(MG_NS, "initiativeProgress");
      const reset = crew?.getFlag?.(MG_NS, "initiativeReset");
      const flagState = [progress, reset]
        .filter(st => st && typeof st === "object" && Number.isFinite(Number(st.activeIndex)))
        .sort((a, b) => Number(b.at ?? 0) - Number(a.at ?? 0))[0];

      if (flagState && Number(flagState.at ?? 0) >= Number(sceneState?.at ?? 0)) {
        return this.normalizeIndex(flagState.activeIndex, ids);
      }

      return this.normalizeIndex(sceneState?.activeIndex ?? flagState?.activeIndex ?? 0, ids);
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
        activeIndex: this.normalizeIndex(activeIndex, ids),
        at: Date.now()
      });
    } catch (e) {
      console.warn("MG | Failed to persist initiative scene state:", e);
    }
  }

  async setCrewSource(crew) {
    if (!crew) return;

    if (game.user?.isGM) {
      await game.settings.set(MG_NS, "activeCrewUuid", crew.uuid);
      await game.settings.set(MG_NS, "crewActorId", crew.id);
      return;
    }

    game.socket?.emit(SOCKET_CHANNEL, {
      type: "iniCrewSourceRequest",
      crewId: crew.id
    });
  }

  async applyOrder(crew, uuids, actorIds, { fromRelay = false } = {}) {
    if (!crew) return false;

    const nextUuids = Array.isArray(uuids) ? uuids.filter(Boolean) : [];
    const nextActorIds = Array.isArray(actorIds) ? actorIds.filter(id => !!game.actors?.get?.(id)) : [];

    if (!nextUuids.length || !nextActorIds.length) return false;

    if (!fromRelay && !mgCanUpdateDocument(crew)) {
      game.socket?.emit(SOCKET_CHANNEL, {
        type: "iniApplyOrderRequest",
        crewId: crew.id,
        uuids: nextUuids,
        actorIds: nextActorIds
      });
      return true;
    }

    await crew.update({ "system.initiative.order": nextUuids });
    await crew.setFlag(MG_NS, "initiativeOrder", nextActorIds);
    await crew.setFlag(MG_NS, "initiativeReset", {
      ids: nextActorIds,
      activeIndex: 0,
      syncId: `crew-${crew.id}-${Date.now()}`,
      at: Date.now()
    });
    await this.setCrewSource(crew);
    return true;
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

    // Non-owners ask the GM to perform the canonical write.
    if (!fromRelay && !mgCanUpdateDocument(crew)) {
      game.socket?.emit(SOCKET_CHANNEL, { type: "iniAdvanceRequest" });
      if (!game.socket) ui.notifications?.warn("You need Crew owner permission or an active GM to advance initiative.");
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
      throw e;
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

    // Non-owners ask the GM to perform the canonical write.
    if (!fromRelay && !mgCanUpdateDocument(crew)) {
      game.socket?.emit(SOCKET_CHANNEL, { type: "iniResetRequest" });
      if (!game.socket) ui.notifications?.warn("You need Crew owner permission or an active GM to reset initiative.");
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
      throw e;
    }
  }
}
