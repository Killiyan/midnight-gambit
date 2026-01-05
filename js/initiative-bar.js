import { MGInitiativeController } from "./initiative-controller.js";
// systems/midnight-gambit/initiative-bar.js
// Frameless Initiative overlay for Midnight Gambit.

const MAX_VISIBLE = 5;
// Virtual "actor" used for the END slot
const END_ID = "__MG_END__";
// how far a leaving card slides left
const LEAVE_PX = 140;
// --- Draggable position storage
const DRAG_STORE_NAMESPACE = "midnight-gambit";
const DRAG_STORE_KEY = "initiativeBarPos";
const DRAG_MARGIN_PX = 16;
const MG_KEY = "initiativeProgress";
const MG_NS = "midnight-gambit";

export class MGInitiativeBar extends Application {
  static #instance;
  static get instance() {
    if (!this.#instance) this.#instance = new MGInitiativeBar();
    return this.#instance;
  }

  static get SELECTORS() {
  return {
    activeName: "[data-next-name]"
  };
}


  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "mg-initiative",
      popOut: false,
      resizable: false
    });
  }

  /** Public helpers (frameless) */
  async showBar() {
    this._ensureAttached();

    // GM: broadcast open to all clients
    if (game.user.isGM && game.socket) {
      game.socket.emit("system.midnight-gambit", {
        type: "iniOpen",
        sender: game.user.id
      });
    }

    MGInitiativeController.instance.activate();
    this._wireInitiativeController();
    // keep the foil hidden until we finish layout/hydration
    this._foilFadeOut(0)?.catch(() => {});
    this._foilDefer = true;

    try {
      const wasCollapsed = await game.user?.getFlag?.("midnight-gambit", "initiativeCollapsed");
      if (wasCollapsed === true) await this._setCollapsed(true, { animate: false });
    } catch (_) {}

    // Base order
    this._ids = this.getOrderActorIds();

    // Hydrate from durable scene/per-user state before first layout
    await this._syncUIFromSharedState();

    const stage = this._root.querySelector(".mg-ini-diag-stage");
    this._ensureSlices(stage, [...this._ids, END_ID]); // make sure END is present too

    // First layout uses the hydrated _vOffset
    this._layoutDiagonal(this._ids);
    this._autosizeFrame();
    this._renderActiveName();

    // Snap the overlay to the final featured slice and bring it in
    {
      const stage = this._root?.querySelector(".mg-ini-diag-stage");
      const feat  = stage?.querySelector('.mg-ini-slice[data-slot="0"]');

      // If END is featured (or nothing yet), keep the overlay hidden
      if (!feat || feat.dataset.actorId === END_ID) {
        this._syncFoilToSlice(null, false);
      } else {
        await this._afterTransition(feat);
        this._syncFoilToSlice(feat, true);  // mirror final transform (e.g., --x:60, --y:120)
        this._resetFoilStroke();            // start lap at origin
        await this._foilFadeIn().catch(() => {}); // uses _foilFadeInMs (700)
      }
    }

    this._foilDefer = false;

    // Remember it's open (client-scoped; no GM perms needed)
    game.settings.set("midnight-gambit", "initiativeOpen", true).catch(() => {});
  }



  /** Internal state */
  _attached = false;
  _attached = false;
  _root = null;
  _ids = [];
  _sizeLocked = false;
  _vOffset = 0;
  _drag = { active: false, dx: 0, dy: 0 };
  _lastSyncId = null;
  _foilDefer = false;
  _foilFadeInMs = 700; // ms — global fade-in duration for the wisp (all cases)
  _collapsed = false;          // current collapsed state
  _collapseReleasePosition = false; // set to true if you want to drop fixed pos in collapsed mode



  // Null-safe: find the current Crew actor
  _resolveCrewActor() {
    let crew = null;

    // Preferred: world setting by Actor ID
    try {
      const id = game.settings.get("midnight-gambit", "crewActorId");
      if (id) crew = game.actors.get(id) || null;
    } catch (_) {}

    // Legacy: world setting by Actor UUID string (e.g., "Actor.ABC123")
    if (!crew) {
      let legacy = null;
      try { legacy = game.settings.get("midnight-gambit", "activeCrewUuid"); } catch (_) {}
      if (typeof legacy === "string" && legacy.indexOf("Actor.") === 0) {
        const id = legacy.split(".")[1];
        crew = game.actors.get(id) || null;
      }
    }

    // Fallback: any crew actor (if you only ever have one, this covers it)
    if (!crew) {
      crew = game.actors.find(a => a.type === "crew") || null;
    }
    return crew;
  }

  /** Try Crew flag first, else fallback to player characters (hidden-aware). */
  getOrderActorIds() {
    // 1) Resolve Crew actor
    const crew = this._resolveCrewActor();

    // 2) Prefer Crew flag: array of Actor IDs (already filtered by the Crew sheet)
    const fromFlag = crew?.getFlag("midnight-gambit", "initiativeOrder");
    if (Array.isArray(fromFlag) && fromFlag.length) {
      return fromFlag.filter(id => !!game.actors.get(id));
    }

    // 3) Fallback: Crew system initiative (UUIDs) -> Actor IDs, minus hidden
    const uuids = crew?.system?.initiative?.order ?? [];
    const hidden = new Set(Array.isArray(crew?.system?.initiative?.hidden) ? crew.system.initiative.hidden : []);

    if (Array.isArray(uuids) && uuids.length) {
      const ids = uuids
        .filter(u => !hidden.has(u)) // ignore hidden UUIDs
        .map(u => (typeof u === "string" && u.indexOf("Actor.") === 0) ? u.split(".")[1] : null)
        .filter(id => id && game.actors.get(id));

      if (ids.length) return ids;
    }

    // 4) Final fallback: owned player characters
    return game.actors
      .filter(a =>
        a.type === "character" &&
        (a.isOwner || Object.values(a.ownership || {}).some(x => x >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER))
      )
      .map(a => a.id);
  }

  // Build minimal HTML (no template needed) — robust & mounts END up front
  _buildHTML() {
    // Gather current ids and remember locally for layout
    const ids = this.getOrderActorIds();
    this._ids = Array.isArray(ids) ? [...ids] : [];
    const activeId = this._getActiveId(this._ids);

    // Root container
    const wrap = document.createElement("div");
    wrap.className = "mg-initiative mg-ini--diag";
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Initiative Order");

    // Header + stage container markup (keep your existing classes)
    const activeName =
      game.actors.get(activeId ?? "")?.name ??
      game.actors.get(this._ids[0] ?? "")?.name ??
      "—";

      // Replace the stage container markup in _buildHTML() with this:
      wrap.innerHTML = `
      <div class="mg-ini-header" data-drag-handle>
        <div class="mg-ini-headline">
          <div class="up-next">The spotlight's on</div>
          <div class="next-name" data-next-name>${activeName}</div>
        </div>
        <div class="mg-ini-actions">
          <button type="button" class="mg-ini-btn mg-ini-next" title="End Turn (advance)">
            <i class="fa-solid fa-forward-step"></i>
          </button>
          <button type="button" class="mg-ini-btn mg-ini-reset" title="Reset to start">
            <i class="fa-solid fa-rotate-left"></i>
          </button>
          <button type="button" class="mg-ini-btn mg-ini-close" title="Close">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>

      <div class="mg-ini-stage">
        <div class="mg-ini-diag-stage"></div>
        <div class="mg-ini-watermark">INITIATIVE</div>
      </div>
      `;

    // Attach to DOM *before* querying children
    document.body.appendChild(wrap);
    this._root = wrap;

    // --- Guarantee a stage node exists and get a reference safely ---
    let stage =
      this._root.querySelector(".mg-ini-diag-stage") ||
      this._root.querySelector(".mg-ini-stage .mg-ini-diag-stage");

    if (!stage) {
      const stageWrap =
        this._root.querySelector(".mg-ini-diag-wrap") ||
        this._root.querySelector(".mg-ini-stage") ||
        this._root;
      stage = document.createElement("div");
      stage.className = "mg-ini-diag-stage";
      stageWrap.appendChild(stage);
    }

    // Create ALL slices up front, including END, so it’s in the DOM from frame 1
    const initialSeq = [...this._ids, END_ID];
    this._ensureSlices(stage, initialSeq);

    // First layout + size lock
    this._layoutDiagonal(this._ids);
    this._autosizeFrame();
  }

  // Ensure the stage has slices (buttons) for every id in ids.
  // Handles both real actors AND the END_ID. New elements start hidden.
  _ensureSlices(stage, ids) {
    if (!stage) return;

    const have = new Set(
      [...stage.querySelectorAll(".mg-ini-slice")].map(n => n.dataset.actorId)
    );

    for (const id of ids) {
      if (have.has(id)) continue;

      if (id === END_ID) {
        const end = document.createElement("button");
        end.type = "button";
        end.className = "mg-ini-slice is-end mg-ini-endcap";
        end.dataset.actorId = END_ID;
        end.title = "End of Round";
        end.innerHTML = `
          <div class="mg-ini-image"></div>
          <div class="label">END</div>
        `;
        // start hidden; layout will reveal when in window
        end.style.visibility = "hidden";
        stage.appendChild(end);
        continue;
      }

      const a = game.actors.get(id);
      if (!a) continue;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mg-ini-slice";
      btn.dataset.actorId = id;
      btn.title = a.name;
      const img = a.img || a.prototypeToken?.texture?.src || "icons/svg/mystery-man.svg";
      btn.innerHTML = `<div class="mg-ini-image" style="background-image: url('${img}');"></div>`;
      // start hidden; layout will reveal when in window
      btn.style.visibility = "hidden";
      stage.appendChild(btn);
    }
  }

  /** Ensure ONLY the real END slice has .is-end / .mg-ini-endcap */
  _normalizeEndSlices(stage) {
    if (!stage) return;

    stage.querySelectorAll(".mg-ini-slice").forEach((el) => {
      const isEnd = el.dataset.actorId === END_ID;

      el.classList.toggle("is-end", isEnd);
      el.classList.toggle("mg-ini-endcap", isEnd);

      // Optional: guarantee END markup is label-only (no image)
      if (isEnd) {
        // Keep it simple: just the text label
        el.innerHTML = `<div class="label">END</div>`;
        el.title = "End of Round";
      } else {
        // If you want to be extra-safe: remove any stray END label node
        // (won't touch your normal image div)
        const lbl = el.querySelector(":scope > .label");
        if (lbl && !el.querySelector(":scope > .mg-ini-image")) lbl.remove();
      }
    });
  }


  // Style A slot geometry — smaller/taller slices + tighter columns
  _diagPositions(count) {
    // Angle + shear factor for skewX
    const sk = -22;
    const t  = Math.tan(sk * Math.PI / 180);

    // TWEAK ME: sizes
    const FEAT_W = 120, FEAT_H = 180;    // featured left slice size
    const SLICE_W = 75, SLICE_H = 180;  // all other slices size (was ~190x260)

    // TWEAK ME: horizontal column positions (reduce to tighten)
    const COL_X_LEFT  = 60;
    const COL_X_MID   = 240;             // was ~360–380 (closer now)
    const COL_X_RIGHT = 324;             // was ~640 (much tighter)

    // TWEAK ME: vertical tops for each column
    const Y_FEATURED = 120;
    const Y_MID_TOP  = 28;
    const Y_RIGHT_TOP= 60;

    // TWEAK ME: vertical gap inside a column pair
    const GAP_Y  = 20;

    // Tiny nudge to kiss the slanted edge just right
    const EDGE_X = 2;

    // Base tops
    const featured = { x: COL_X_LEFT,  y: Y_FEATURED, w: FEAT_W,  h: FEAT_H };
    const midTop   = { x: COL_X_MID,   y: Y_MID_TOP,  w: SLICE_W, h: SLICE_H };
    const rightTop = { x: COL_X_RIGHT, y: Y_RIGHT_TOP,w: SLICE_W, h: SLICE_H };

    // Place a slice directly below another with right edges aligned
    // y_low = y_top + h_top + GAP_Y
    // x_low = x_top + (w_top - w_low) + t * (h_top + GAP_Y) + EDGE_X
    const belowAligned = (above, w, h) => {
      const y = above.y + above.h + GAP_Y;
      const x = above.x + (above.w - w) + t * (above.h + GAP_Y) + EDGE_X;
      return { x, y, w, h };
    };

    const slots = [];
    if (count > 0) slots.push({ ...featured, sk });
    if (count > 1) slots.push({ ...midTop,   sk });
    if (count > 2) slots.push({ ...belowAligned(midTop,   SLICE_W, SLICE_H), sk });
    if (count > 3) slots.push({ ...rightTop, sk });
    if (count > 4) slots.push({ ...belowAligned(rightTop, SLICE_W, SLICE_H), sk });

    // Extras: keep stacking under the last one on the right
    let prev = (count > 4) ? slots[slots.length - 1] : rightTop;
    for (let i = 5; i < count; i++) {
      const nxt = belowAligned(prev, SLICE_W, SLICE_H);
      slots.push({ ...nxt, sk });
      prev = nxt;
    }
    return slots;
  }

  _layoutEndcap() {
    const stage = this._stageEl || this._root?.querySelector(".mg-ini-diag-stage");
    const cap   = this._endcapEl;
    if (!stage || !cap) return;

    const slices = stage.querySelectorAll(".mg-ini-slice");
    if (!slices.length) {
      // Hide when no slices; keeps it mounted but out of sight
      cap.style.opacity = "0";
      return;
    } else {
      cap.style.opacity = "1";
    }

    // Use the last slice as the reference; derive the spacing from the last pair.
    const last = slices[slices.length - 1];
    const prev = slices.length > 1 ? slices[slices.length - 2] : null;

    const cLast = getComputedStyle(last);
    const getNum = (cs, v, fallback=0) => {
      const raw = cs.getPropertyValue(v).trim();
      const n = parseFloat(raw);
      return Number.isFinite(n) ? n : fallback;
    };

    const xLast = getNum(cLast, "--x", 0);
    const yLast = getNum(cLast, "--y", 0);
    const w     = getNum(cLast, "--w", 160);
    const h     = getNum(cLast, "--h", 220);
    const skX   = (cLast.getPropertyValue("--skX") || "-22deg").trim();
    const bleed = (cLast.getPropertyValue("--bleedL") || "0px").trim();

    // Derive delta slot: how far each card steps vs the previous one.
    let dx = w * 0.8; // safe fallback if only one slice exists
    let dy = 0;
    if (prev) {
      const cPrev = getComputedStyle(prev);
      const xPrev = getNum(cPrev, "--x", xLast - dx);
      const yPrev = getNum(cPrev, "--y", yLast);
      dx = xLast - xPrev || dx;
      dy = yLast - yPrev || dy;
    }

    // Place the endcap into the "next" slot after the last slice
    const xCap = xLast + dx;
    const yCap = yLast + dy;

    cap.style.setProperty("--x", `${xCap}px`);
    cap.style.setProperty("--y", `${yCap}px`);
    cap.style.setProperty("--w", `${w}px`);
    cap.style.setProperty("--h", `${h}px`);
    cap.style.setProperty("--skX", skX);
    cap.style.setProperty("--bleedL", bleed);
  }

  // Compute and apply positions for the visible window. Hide everything else.
  _layoutDiagonal(actorIds) {
    const stage = this._root?.querySelector(".mg-ini-diag-stage");
    if (!stage) return;

    // Full sequence = actors + END
    const seq = [...actorIds, END_ID];

    // Make sure all nodes exist (including END) before we position/hide
    this._ensureSlices(stage, seq);
    this._normalizeEndSlices(stage);

    const L = seq.length;
    if (!L) return;

    const winCount = Math.min(MAX_VISIBLE, L);

    // Normalize offset and build the current window of ids
    this._vOffset = ((this._vOffset % L) + L) % L;
    const windowIds = [];
    for (let j = 0; j < winCount; j++) {
      windowIds.push(seq[(this._vOffset + j) % L]);
    }

    // Slot positions for the visible window
    const slots = this._diagPositions(winCount);

    // Position and reveal visible items
    windowIds.forEach((id, j) => {
      const el = stage.querySelector(`.mg-ini-slice[data-actor-id="${id}"]`);
      if (!el) return;

      const p = slots[j];
      this._applySlicePos(el, p, j === 0 && id !== END_ID);

      // Tag slot index for CSS theming (0 = featured, then 1..)
      el.setAttribute("data-slot", String(j));

      // Inline safety: make sure END will transition transforms/opacity like others
      if (id === END_ID) {
        el.style.transitionProperty = el.style.transitionProperty || "transform, opacity";
        el.style.transitionDuration = el.style.transitionDuration || "280ms";
        el.style.transitionTimingFunction = el.style.transitionTimingFunction || "ease";
      }

      el.style.visibility = ""; // show
      // Mirror the floating foil to the featured slice (slot 0), but never to END
      if (!this._foilDefer && j === 0 && id !== END_ID) this._syncFoilToSlice(el, true);
    });

    // Hide everything not in the current window (END included)
    const visSet = new Set(windowIds);
    for (const id of seq) {
      if (visSet.has(id)) continue;
      const el = stage.querySelector(`.mg-ini-slice[data-actor-id="${id}"]`);
      if (el) {
        el.style.visibility = "hidden";
        el.removeAttribute("data-slot");
      }
    }

    // If END is in slot 0 (or nothing visible), hide the foil overlay
    if (!windowIds.length || windowIds[0] === END_ID) this._syncFoilToSlice(null, false);

    // Size the container to content after positions apply
    if (typeof this._autosizeFrame === "function") this._autosizeFrame();
  }

  /** Set inline transform/size for a slice, with skew container and unscrew inner image */
  _applySlicePos(el, p, featured, opts = {}) {
    el.style.setProperty("--w", `${p.w}px`);
    el.style.setProperty("--h", `${p.h}px`);
    el.style.setProperty("--x", `${p.x}px`);
    el.style.setProperty("--y", `${p.y}px`);
    el.style.setProperty("--skX", `${p.sk}deg`);

    // Extra left bleed to fully cover the skew wedge: tan(|sk|) * height + small fudge for borders
    const bleedL = Math.abs(Math.tan(p.sk * Math.PI / 180) * p.h) + 12; // px
    el.style.setProperty("--bleedL", `${Math.ceil(bleedL)}px`);

    el.classList.toggle("is-featured", !!featured);
  }

  /** Save current initiative progress so reopen resumes from here */
  async _persistIniState() {
    try {
      const payload = {
        vOffset: Number(this._vOffset ?? 0),
        // include anything else you were keeping locally:
        pos: this._pos ?? null
      };
      await game.user.setFlag("midnight-gambit", "initiativeUi", payload);
    } catch (e) {
      console.warn("MG | Persist initiative UI failed:", e);
    }
  }

  /** Emit a replicated "advance once" signal on the Crew actor flag. */
  async _emitNextStep() {
    const crew = this._resolveCrewActor();
    if (!crew) {
      ui.notifications?.warn("No Crew actor configured.");
      return;
    }

    // Use current order or re-pull it if missing
    const ids = (Array.isArray(this._ids) && this._ids.length)
      ? this._ids.slice()
      : this.getOrderActorIds();

    if (!Array.isArray(ids) || !ids.length) {
      ui.notifications?.warn("No actors in Initiative to advance.");
      return;
    }

    // Compute the BEFORE index modulo (ids.length + END)
    const L = ids.length + 1; // + END
    const prev = ((this._vOffset ?? 0) % L + L) % L;

    const payload = {
      ids,
      prev,
      syncId: foundry.utils.randomID?.() ?? crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      at: Date.now()
    };

    // This is the single replicated write that all clients will hear
    try {
      await crew.setFlag("midnight-gambit", "initiativeProgress", payload);
    } catch (e) {
      // If not allowed to write, ask the GM to do it
      if (!game.user.isGM && game.socket) {
        game.socket.emit("system.midnight-gambit", { type: "iniProgress", payload });
        ui.notifications?.info("Requested GM to advance initiative.");
        return;
      }
      console.error("MG | Failed to emit initiative progress:", e);
      ui.notifications?.error("Couldn’t advance initiative (no permission).");
    }

  }

  /** Emit a replicated "reset initiative" signal on the Crew actor flag. */
  async _emitReset() {
    const crew = this._resolveCrewActor();
    if (!crew) {
      ui.notifications?.warn("No Crew actor configured.");
      return;
    }

    // Adopt current order or pull fresh
    const ids = (Array.isArray(this._ids) && this._ids.length)
      ? this._ids.slice()
      : this.getOrderActorIds();

    if (!Array.isArray(ids) || !ids.length) {
      ui.notifications?.warn("No actors in Initiative to reset.");
      return;
    }

    const payload = {
      ids,
      syncId: foundry.utils.randomID?.() ?? crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      at: Date.now()
    };

    try {
      await crew.setFlag("midnight-gambit", "initiativeReset", payload);
    } catch (e) {
      // Non-GM relay fallback
      if (!game.user.isGM && game.socket) {
        game.socket.emit("system.midnight-gambit", { type: "iniReset", payload });
        ui.notifications?.info("Requested GM to reset initiative.");
        return;
      }
      console.error("MG | Failed to emit initiative reset:", e);
      ui.notifications?.error("Couldn’t reset initiative (no permission).");
    }
  }

  /** Normalize the cycle length (ids + END slot). */
  _cycleLen() {
    const n = Array.isArray(this._ids) ? this._ids.length : 0;
    return Math.max(1, n + 1); // +1 for END slot
  }

  /** Compute current active index from _vOffset. Returns 0..len-1 where len = ids.length+1 (END). */
  _activeIndex() {
    const L = this._cycleLen();
    let k = Number(this._vOffset ?? 0);
    // normalize into [0, L)
    k = ((k % L) + L) % L;
    return k;
  }

  /** Persist durable initiative state so reopen/refresh shows correct active. (GM-only) */
  async _persistDurableInitState() {
    try {
      if (!game.user.isGM) return; // only GM writes the scene flag

      const ids = Array.isArray(this._ids) ? this._ids.filter(id => !!game.actors.get(id)) : [];
      const n = ids.length;
      const L = Math.max(1, n + 1); // +1 for END
      const raw = Number(this._vOffset ?? 0);
      const activeIndex = ((raw % L) + L) % L; // normalize [0, L)

      if (canvas?.scene?.setFlag) {
        await canvas.scene.setFlag("midnight-gambit", "initState", {
          orderIds: ids,
          activeIndex
        });
      }
    } catch (e) {
      console.warn("MG | Persist durable init state failed:", e);
    }
  }

  /** Resolve the active actor (or null if the END slot is active). */
  _activeActor() {
    const idx = this._activeIndex();
    const ids = Array.isArray(this._ids) ? this._ids : [];
    if (idx < ids.length) {
      const aid = ids[idx];
      return game.actors.get(aid) ?? null;
    }
    return null; // END slot
  }

  /** Update the visible "active" name label in the header */
  _renderActiveName() {
    if (!this._root) return;
    const label = this._root.querySelector("[data-next-name]");
    if (!label) return;

    const ids = Array.isArray(this._ids) ? this._ids : [];
    const L = Math.max(1, ids.length + 1);                 // +1 for END slot
    const idx = ((Number(this._vOffset ?? 0) % L) + L) % L; // normalize [0,L)

    if (idx < ids.length) {
      const actor = game.actors.get(ids[idx]);
      label.textContent = actor?.name ?? "—";
    } else {
      label.textContent = "End of Round";
    }
  }

  /** Make every initiative card/slice visible (used on full reset). */
  _revealAllCards() {
    const root = this._root;
    if (!root) return;

    // Cover both card and slice nodes (depending on your naming)
    const nodes = root.querySelectorAll(".mg-ini-card, .mg-ini-slice, .mg-ini-slot, .mg-ini-node");

    nodes.forEach((el) => {
      // Generic hidden flags
      el.removeAttribute("aria-hidden");
      el.style.opacity = "";
      el.style.transform = "";

      // Classes we’ve used at various times for hiding/offstage/animations
      el.classList.remove(
        "mg-invisible",
        "mg-offstage",
        "mg-ini-offstage",
        "mg-ini-hidden",
        "is-hidden",
        "is-off",
        "is-ghost",
        "is-collapsed",
        "is-entering",
        "is-leaving"
      );
    });
  }

  /** Clear saved progress (used by Reset and Apply-from-Crew) */
  async _clearIniState() {
    try { await game.settings.set(MG_NS, MG_KEY, ""); } catch (e) { /* ignore */ }
  }

  /** Restore initiative UI state (per-user) */
  async _restoreIniStateIfAny() {
    try {
      const saved = await game.user.getFlag("midnight-gambit", "initiativeUi");
      if (!saved) return;
      if (Number.isFinite(saved.vOffset)) this._vOffset = Number(saved.vOffset);
      if (saved.pos && typeof saved.pos === "object") this._applySavedPosition?.(saved.pos);
    } catch (e) {
      console.warn("MG | Restore initiative UI failed:", e);
    }
  }

  async _endTurn() {
    const stage = this._root?.querySelector(".mg-ini-diag-stage");
    if (!stage) return;
  
    if (!this._ids || !this._ids.length) this._ids = this.getOrderActorIds();
    const actors = this._ids.slice();
    if (!actors.length) { ui.notifications?.warn("No actors in Initiative to advance."); return; }
  
    const seq = [...actors, END_ID];
    const L = seq.length;
    const winCount = Math.min(MAX_VISIBLE, L);
  
    // BEFORE/AFTER windows
    this._vOffset = ((this._vOffset % L) + L) % L;
    const windowBefore = Array.from({ length: winCount }, (_, j) => seq[(this._vOffset + j) % L]);
    const vOffsetAfter = (this._vOffset + 1) % L;
    const windowAfter  = Array.from({ length: winCount }, (_, j) => seq[(vOffsetAfter + j) % L]);
  
    // Ensure nodes exist
    this._ensureSlices(stage, seq);
  
    const leavingId = windowBefore[0];
    const entrantId = windowAfter[winCount - 1];
    const leavingEl = stage.querySelector(`.mg-ini-slice[data-actor-id="${leavingId}"]`);
    const entrantEl = stage.querySelector(`.mg-ini-slice[data-actor-id="${entrantId}"]`);
    if (!leavingEl) return;
  
    const entrantIsLeaver = (leavingId === entrantId);
  
    // AFTER slot geometry for visible window
    const slotsAfter = this._diagPositions(winCount);
  
    // --- ENTRANT PREP (only if different element) ---
    if (!entrantIsLeaver && entrantEl) {
      const lastPos = slotsAfter[winCount - 1];
      this._applySlicePos(entrantEl, lastPos, false);
      entrantEl.style.visibility = "";
      entrantEl.style.transition = "none";
      entrantEl.style.transform  = `translate(var(--x), calc(var(--y) + 36px)) skewX(var(--skX))`;
      entrantEl.style.opacity    = "0";
    }
  
    // --- SHIFTERS (middle cards) ---
    for (let j = 1; j < windowBefore.length; j++) {
      const id = windowBefore[j];
      const el = stage.querySelector(`.mg-ini-slice[data-actor-id="${id}"]`);
      if (!el) continue;
      const p = slotsAfter[j - 1];
      this._applySlicePos(el, p, (j - 1 === 0) && id !== END_ID);
      el.style.visibility = "";
    }
  
    // hide the border wisp during the move so it doesn't float
    this._foilFadeOut().catch(() => {});

    // Animate the header name (inverse of card leave)
    const nextId = windowAfter[0];
    const nm = game.actors.get(nextId ?? "")?.name ?? (nextId === END_ID ? "End of Round" : "—");
    const nameDone = this._animateActiveNameChange(nm).catch(() => {});

    // Sync flip for the card animation pipeline
    await this._nextFrame();
  
    // --- LEAVE ANIMATION (always slide-left + fade) ---
    const leaveDone = (async () => {
      leavingEl.style.transition = "transform 260ms cubic-bezier(.2,.8,.2,1), opacity 260ms cubic-bezier(.2,.8,.2,1)";
      leavingEl.style.transform  = `translate(calc(var(--x) - ${LEAVE_PX}px), var(--y)) skewX(var(--skX))`;
      leavingEl.style.opacity    = "0";
      await this._afterTransition(leavingEl);
    })();
  
    // --- ENTRANT RISE (if different element, run concurrently) ---
    let reenterDone = Promise.resolve();
    if (!entrantIsLeaver && entrantEl) {
      void entrantEl.offsetWidth; // reflow
      entrantEl.style.transition = "transform 260ms cubic-bezier(.2,.8,.2,1), opacity 260ms cubic-bezier(.2,.8,.2,1)";
      entrantEl.style.transform  = `translate(var(--x), var(--y)) skewX(var(--skX))`;
      entrantEl.style.opacity    = "1";
      reenterDone = this._afterTransition(entrantEl);
    }
  
    // If the entrant is the same node (common when there are <6 cards), do it sequentially:
    if (entrantIsLeaver) {
      await leaveDone;
  
      const lastPos = slotsAfter[winCount - 1];
      this._applySlicePos(leavingEl, lastPos, false);
      leavingEl.style.transition = "none";
      leavingEl.style.transform  = `translate(var(--x), calc(var(--y) + 36px)) skewX(var(--skX))`;
      leavingEl.style.opacity    = "0";
      void leavingEl.offsetWidth;
  
      leavingEl.style.transition = "transform 260ms cubic-bezier(.2,.8,.2,1), opacity 260ms cubic-bezier(.2,.8,.2,1)";
      leavingEl.style.transform  = `translate(var(--x), var(--y)) skewX(var(--skX))`;
      leavingEl.style.opacity    = "1";
      await this._afterTransition(leavingEl);
      await nameDone;
    } else {
      await Promise.all([leaveDone, reenterDone, nameDone]);
    }
  
    // Cleanup small inline bits
    if (!entrantIsLeaver && entrantEl) {
      entrantEl.style.removeProperty("opacity");
      entrantEl.style.removeProperty("transform");
      entrantEl.style.removeProperty("transition");
    }
    leavingEl.style.removeProperty("transition");
  
    // Commit offset & reconcile layout
    this._vOffset = vOffsetAfter;
    this._layoutDiagonal(this._ids);
    if (typeof this._autosizeFrame === "function") this._autosizeFrame();

    // After relayout, re-sync foil to the new featured slice
    {
      const stage = this._root?.querySelector(".mg-ini-diag-stage");
      const feat = stage?.querySelector('.mg-ini-slice[data-slot="0"]');
      this._syncFoilToSlice(feat, !!feat);
    }

    // Restart the wisp so the orbit begins fresh on the new feature
    this._resetFoilStroke();

    await this._foilFadeIn();

    // Save progress so a close/reopen resumes correctly
    await this._persistIniState();
  }
  

  /** Bind all UI events via delegation on the root node */
  _bindRootEvents() {
    if (!this._root) return;

    // Keep clicks inside the overlay from hitting the canvas
    this._root.addEventListener("click", (ev) => ev.stopPropagation());
    this._root.addEventListener("contextmenu", (ev) => ev.stopPropagation());

    // Header buttons (Close / Reset / Next)
    this._root.addEventListener("click", (ev) => {
      const tgt = ev.target;

      if (tgt.closest(".mg-ini-close")) {
        ev.preventDefault();
        this.hideBar();
        return;
      }

      if (tgt.closest(".mg-ini-reset")) {
        ev.preventDefault();

        // Broadcast a reset to all clients; listener will rebuild/realign.
        MGInitiativeController.instance.reset().catch(console.error);
        return;
      }

      if (tgt.closest(".mg-ini-next")) {
        ev.preventDefault();

        // Emit a replicated progress tick; the updateActor listener will animate for everyone.
        MGInitiativeController.instance.advance().catch(console.error);
        return;
      }
    });

    // Click a slice -> select its token (ignore END)
    this._root.addEventListener("click", (ev) => {
      const slot = ev.target.closest(".mg-ini-slice");
      if (!slot) return;
      if (slot.classList.contains("is-end") || slot.dataset.actorId === END_ID) return;
      const actor = game.actors.get(slot.dataset.actorId);
      const token = canvas.tokens.placeables.find(t => t.actor?.id === actor?.id);
      if (token) token.control({ releaseOthers: true });
    });

    // Double-click header (outside of action buttons) -> toggle collapse
    const header = this._root.querySelector(".mg-ini-header");
    if (header && !header._mgCollapseBound) {
      header._mgCollapseBound = true;
      header.addEventListener("dblclick", (ev) => {
        // ignore dblclicks on the control buttons
        if (ev.target.closest(".mg-ini-actions")) return;
        ev.preventDefault();
        ev.stopPropagation();
        this._toggleCollapsed().catch(console.error);
      }, { passive: true });
    }
  }

  /** Active is simply the first element in the order array */
  _getActiveId(ids) { return ids[0] || null; }

  // Small helper to await the end of the CSS transition
  _afterTransition(el) {
    return new Promise((res) => {
      const onEnd = () => { el.removeEventListener("transitionend", onEnd); res(); };
      el.addEventListener("transitionend", onEnd, { once: true });
      // Safety timer in case transition doesn't fire
      setTimeout(res, 430);
    });
  }

  // Schedule the next animation frame (used to line up all transitions in one paint)
  _nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  // Wait for any of the given elements to finish a transform/opacity transition.
  // We resolve on the first relevant transitionend or after a safety timeout.
  _afterAllTransitions(els, timeout = 450) {
    return new Promise((resolve) => {
      let resolved = false;
      const onEnd = (ev) => {
        if (ev && ev.propertyName && ev.propertyName !== "transform" && ev.propertyName !== "opacity") return;
        if (resolved) return;
        resolved = true;
        els.forEach((el) => el.removeEventListener("transitionend", onEnd));
        resolve();
      };
      els.forEach((el) => el.addEventListener("transitionend", onEnd, { once: true }));
      setTimeout(() => { if (!resolved) onEnd({}); }, timeout);
    });
  }


  /** Save the current actor-id order (rotated so slot 0’s actor is first) */
  async _persistCurrentOrder() {
    let crew = null;
    try {
      const crewId = game.settings.get("midnight-gambit", "crewActorId");
      if (crewId) crew = game.actors.get(crewId) || null;
    } catch (_) {}
    if (!crew) return;

    const ids = Array.isArray(this._ids) ? this._ids : [];
    const n = ids.length;
    if (!n) return;

    // Rotate ids by current window offset (END lives outside ids)
    // If the window starts on END, the "next" actor is index 0.
    const L = n + 1;
    const off = ((this._vOffset % L) + L) % L;
    const start = (off === n) ? 0 : off; // if pointing at END, start from 0
    const rotated = [...ids.slice(start), ...ids.slice(0, start)];

    await crew.setFlag("midnight-gambit", "initiativeOrder", rotated);
  }

  // --- tiny helper: nuke stale inline anim styles on a slice ---
  _wipeSliceInline(el) {
    if (!el) return;
    // Stop any current transition so we can instantly snap to "clean"
    el.style.transition = "none";
    // Clear the things that keep cards ghosted/offstage
    el.style.removeProperty("opacity");
    el.style.removeProperty("visibility");
    el.style.removeProperty("transform");
    // If you ever set aria-hidden during anims, clear it
    if (el.getAttribute("aria-hidden") === "true") el.removeAttribute("aria-hidden");
  }

  /** Apply initial position: bottom-right by default, or the last saved per-user flag */
  async _applyInitialPosition() {
    const root = this._root;
    if (!root) return;

    // Ensure fixed positioning so left/top behave
    root.style.position = "fixed";
    root.style.zIndex = root.style.zIndex || "9999";

    // Load per-user position from flags (persists across reload for this player)
    let saved = null;
    try {
      saved = await game.user?.getFlag?.("midnight-gambit", "initiativeBarPos");
    } catch (_) { /* ignore */ }

    if (saved && typeof saved.x === "number" && typeof saved.y === "number") {
      const { innerWidth: W, innerHeight: H } = window;
      const rect = root.getBoundingClientRect();
      const maxX = Math.max(0, W - rect.width  - 16);
      const maxY = Math.max(0, H - rect.height - 16);
      const x = Math.min(Math.max(saved.x, 16), maxX);
      const y = Math.min(Math.max(saved.y, 16), maxY);
      root.style.left = `${x}px`;
      root.style.top  = `${y}px`;
      root.style.right = "";
      root.style.bottom = "";
      return;
    }

    // Default: park next to chat/sidebar (left of it), otherwise bottom-right
    const rect = root.getBoundingClientRect();

    // Try to find the sidebar/chat column (Foundry sidebar has id="sidebar")
    const sidebar =
      document.getElementById("sidebar") ||
      document.querySelector("#sidebar, .sidebar, #ui-right");

    if (sidebar) {
      const s = sidebar.getBoundingClientRect();
      // place to the LEFT of sidebar with a small gap, and align to bottom
      let x = s.left - rect.width - 16;
      let y = window.innerHeight - rect.height - 16;

      // clamp into viewport just in case
      const maxX = Math.max(0, window.innerWidth  - rect.width  - 16);
      const maxY = Math.max(0, window.innerHeight - rect.height - 16);
      x = Math.min(Math.max(x, 16), maxX);
      y = Math.min(Math.max(y, 16), maxY);

      root.style.left = `${x}px`;
      root.style.top  = `${y}px`;
      root.style.right = "";
      root.style.bottom = "";
    } else {
      // fallback: bottom-right
      const x = Math.max(16, window.innerWidth  - rect.width  - 16);
      const y = Math.max(16, window.innerHeight - rect.height - 16);
      root.style.left = `${x}px`;
      root.style.top  = `${y}px`;
      root.style.right = "";
      root.style.bottom = "";
    }
  }

  /** Persist current left/top so it restores for THIS player on refresh */
  async _saveBarPosition() {
    const root = this._root;
    if (!root) return;
    const x = parseFloat(root.style.left || "0");
    const y = parseFloat(root.style.top  || "0");
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    try {
      await game.user?.setFlag?.("midnight-gambit", "initiativeBarPos", { x, y });
    } catch (_) {
      // (optional) swallow; no need to hard-fail if flags unavailable
    }
  }

  /** Enable dragging by the header without killing header button clicks */
  _enableDrag() {
    const root = this._root;
    if (!root) return;

    // Drag handle = header bar; change selector if your header class differs
    const handle = root.querySelector(".mg-ini-header") || root;
    if (!handle || handle._mgDragBound) return;
    handle._mgDragBound = true;

    let dragging = false;
    let pressX = 0, pressY = 0;
    let startLeft = 0, startTop = 0;
    const THRESH = 4; // px before we commit to a drag

    const onPointerDown = (ev) => {
      // Only primary button
      if (ev.button !== 0) return;

      // IMPORTANT: if the pointer started on a header button, DO NOT drag
      if (ev.target.closest(".mg-ini-btn")) return;

      // Record press point; do not stop propagation yet—allow clicks unless we *start* dragging
      const rect = root.getBoundingClientRect();
      root.style.position = "fixed";
      root.style.left = `${rect.left}px`;
      root.style.top  = `${rect.top}px`;
      root.style.right = "";
      root.style.bottom = "";

      pressX = ev.clientX;
      pressY = ev.clientY;
      startLeft = rect.left;
      startTop  = rect.top;

      handle.setPointerCapture?.(ev.pointerId);
      window.addEventListener("pointermove", onPointerMove, { passive: false });
      window.addEventListener("pointerup", onPointerUp,   { passive: false });
    };

    const onPointerMove = (ev) => {
      const dx = ev.clientX - pressX;
      const dy = ev.clientY - pressY;

      if (!dragging) {
        // commit to drag only after threshold — then we suppress click behavior
        if (Math.abs(dx) < THRESH && Math.abs(dy) < THRESH) return;
        dragging = true;
        ev.preventDefault();
        ev.stopPropagation();
      } else {
        ev.preventDefault();
        ev.stopPropagation();
      }

      const { innerWidth: W, innerHeight: H } = window;
      const rect = root.getBoundingClientRect();
      const width  = rect.width;
      const height = rect.height;

      let x = startLeft + dx;
      let y = startTop  + dy;

      const M = 16; // margin
      const minX = M, minY = M;
      const maxX = Math.max(M, W - width  - M);
      const maxY = Math.max(M, H - height - M);
      x = Math.min(Math.max(x, minX), maxX);
      y = Math.min(Math.max(y, minY), maxY);

      root.style.left = `${x}px`;
      root.style.top  = `${y}px`;
    };

    const onPointerUp = async (ev) => {
      if (dragging) {
        ev.preventDefault();
        ev.stopPropagation();
        dragging = false;
        await this._saveBarPosition?.(); // harmless if not defined yet
      }
      handle.releasePointerCapture?.(ev.pointerId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    handle.style.cursor = "move";
    handle.addEventListener("pointerdown", onPointerDown, { passive: true });
  }

  /** Slide-in animation for the active name (inverse of card leave). */
  async _animateActiveNameChange(newName) {
    const label = this._root?.querySelector(this.constructor.SELECTORS.activeName || "[data-next-name]");
    if (!label) return;

    // Start off-canvas to the RIGHT (inverse of card sliding left) and invisible
    label.style.willChange = "transform, opacity";
    label.style.transition = "none";
    label.style.transform  = `translateX(${LEAVE_PX}px)`;
    label.style.opacity    = "0";
    // Ensure the initial state is committed before we change text + animate
    void label.offsetWidth;

    // Swap the text, then animate it into place
    label.textContent      = newName;
    label.style.transition = "transform 260ms cubic-bezier(.2,.8,.2,1), opacity 260ms cubic-bezier(.2,.8,.2,1)";
    label.style.transform  = "translateX(0)";
    label.style.opacity    = "1";

    try {
      await this._afterTransition(label);
    } finally {
      // Clean up inline styles so future layout is clean
      label.style.removeProperty("transition");
      label.style.removeProperty("transform");
      label.style.removeProperty("opacity");
      label.style.willChange = "";
    }
  }

  /** Ensures a single floating foil layer exists and contains the SVG ring. */
  _ensureFoilLayer() {
    this._ensureFoilCSS();
    if (this._foilEl && this._foilEl.isConnected) return this._foilEl;

    const stage = this._root?.querySelector(".mg-ini-diag-stage");
    if (!stage) return null;

    const el = document.createElement("div");
    el.className = "mg-ini-foil";

    // start hidden; we'll reveal after first layout sync
    el.style.display = "none";
    el.style.opacity = "0";

    // Provide the SVG child that _syncFoilToSlice() sizes/animates
    el.innerHTML = `
      <svg class="mg-ini-foil-svg" xmlns="http://www.w3.org/2000/svg">
        <rect class="mg-ini-foil__ring" x="0.5" y="0.5" width="1" height="1" rx="0" ry="0"/>
      </svg>
    `;

    stage.appendChild(el);
    this._foilEl = el;
    return el;
  }

  /**
   * Sync the floating foil to the given slice (or hide if none).
   * - Positions and sizes the SVG ring to match the slice’s box and radius.
   * - Computes perimeter so the dash animates one clean lap.
   */
  _syncFoilToSlice(sliceEl, isFeatured) {
    const stage = this._root?.querySelector(".mg-ini-diag-stage");
    if (!stage) return;
    const foil = this._ensureFoilLayer();
    if (!foil) return;

    if (!sliceEl || !isFeatured) {
      foil.style.display = "none";
      return;
    }
    foil.style.display = "";

    // Size overlay to slice box
    const w = sliceEl.offsetWidth;
    const h = sliceEl.offsetHeight;
    foil.style.width  = `${w}px`;
    foil.style.height = `${h}px`;

    // Mirror transform so it rides the same path
    const comp = getComputedStyle(sliceEl);
    foil.style.transform = comp.transform;
    foil.style.transformOrigin = comp.transformOrigin;

    // Border radius from the slice (fallback to 12px)
    // Note: borderRadius can be "12px" or a 4-corner string; take the first length.
    const brRaw = (comp.borderRadius || "12px").trim().split(" ")[0];
    const rPx = Math.max(0, parseFloat(brRaw) || 12);

    // Keep radius sane (cannot exceed half the side)
    const r = Math.min(rPx, w * 0.5, h * 0.5);

    // Update SVG rect geometry
    const svg  = foil.querySelector(".mg-ini-foil-svg");
    const ring = foil.querySelector(".mg-ini-foil__ring");
    if (!svg || !ring) return;

    svg.setAttribute("width",  String(w));
    svg.setAttribute("height", String(h));

    // Tight inset so stroke sits right on the edge
    const sw =  Math.max(2, parseFloat(getComputedStyle(ring).strokeWidth) || 3);
    const inset = sw / 2;

    ring.setAttribute("x", String(inset));
    ring.setAttribute("y", String(inset));
    ring.setAttribute("width",  String(Math.max(0, w - sw)));
    ring.setAttribute("height", String(Math.max(0, h - sw)));
    ring.setAttribute("rx", String(Math.max(0)));
    ring.setAttribute("ry", String(Math.max(0)));

    // Derive the perimeter of a rounded rectangle:
    // P = 2*(w'+h' - 2r') + 2πr'
    const wPrime = Math.max(0, w - sw);
    const hPrime = Math.max(0, h - sw);
    const rPrime = Math.max(0, Math.min(r - inset, wPrime * 0.5, hPrime * 0.5));
    const perimeter = 2 * (wPrime + hPrime - 2 * rPrime) + 2 * Math.PI * rPrime;

    // One short wisp + big gap
    const wispLen = Math.max(48, perimeter * 0.18);
    const gapLen  = Math.max(1, perimeter - wispLen);

    foil.style.setProperty("--mg-perimeter", `${perimeter.toFixed(2)}px`);
    foil.style.setProperty("--mg-dash-on",   `${wispLen.toFixed(2)}px`);
    foil.style.setProperty("--mg-dash-off",  `${gapLen.toFixed(2)}px`);

    // Match border rounding + brand stroke color on the halo & wisp
    foil.style.setProperty("--mg-foil-radius", `0px`);
    const slotStroke = comp.getPropertyValue("--slot-stroke")?.trim();
    if (slotStroke) {
      foil.style.setProperty("--slot-stroke", slotStroke);
    }

    // (Optional) speed/width knobs per theme (fallbacks already defined in CSS)
    // foil.style.setProperty("--mg-foil-speed", "4200ms");
    // foil.style.setProperty("--mg-foil-stroke", "3px");
  }

  /** Inject foil CSS once: SVG wisp around the border + soft halo (no spinning box). */
  _ensureFoilCSS() {
    if (document.getElementById("mg-foil-css")) return;
    const css = `
    .mg-ini-foil {
      position: absolute;
      left: 0; top: 0;
      width: 0; height: 0;
      pointer-events: none;
      z-index: 50; /* above slices, below header */
      opacity: 1;
      transition: opacity 180ms cubic-bezier(.2,.8,.2,1);
    }

    /* Soft halo hugging the border ring (keeps that subtle glow) */
    .mg-ini-foil::after{
      content:"";
      position:absolute;
      inset:0;
      pointer-events:none;
      border-radius: var(--mg-foil-radius, 12px);

      /* show only in the border ring */
      padding: var(--mg-foil-width, 3px);
      -webkit-mask:
        linear-gradient(#000 0 0) content-box,
        linear-gradient(#000 0 0);
      -webkit-mask-composite: xor;
              mask:
        linear-gradient(#000 0 0) content-box,
        linear-gradient(#000 0 0);
              mask-composite: exclude;

        background: color-mix(in oklab, var(--mg-halo-color, var(--slot-stroke, #4173BE)) 85%, white 20%);
        filter: blur(var(--mg-halo-blur, 12px));
        opacity: var(--mg-halo-opacity, 0.45);
    }

    /* The SVG layer that hosts the moving wisp */
    .mg-ini-foil-svg {
      position:absolute;
      inset:0;
      width:100%;
      height:100%;
      overflow:visible;
    }

    /* The glowing wisp: one rounded-rect stroke segment that travels the border */
    .mg-ini-foil__ring {
      fill: none;
      stroke: var(--slot-stroke, #A2D729);
      stroke-width: var(--mg-foil-stroke, 3px);
      stroke-linecap: butt;
      stroke-linejoin: miter;
      vector-effect: non-scaling-stroke;
      /* one dash + big gap, we animate dashoffset to orbit */
      stroke-dasharray: var(--mg-dash-on, 80px) var(--mg-dash-off, 4000px);
      stroke-dashoffset: 0;
      /* gentle glow */
      filter:
        drop-shadow(0 0 var(--mg-glow1, 8px)  color-mix(in oklab, var(--mg-glow-color, var(--slot-stroke, #A2D729)) 90%, transparent))
        drop-shadow(0 0 var(--mg-glow2, 16px) color-mix(in oklab, var(--mg-glow-color, var(--slot-stroke, #A2D729)) 65%, transparent))
        drop-shadow(0 0 var(--mg-glow3, 28px) color-mix(in oklab, var(--mg-glow-color, var(--slot-stroke, #A2D729)) 45%, transparent));
      animation: mg-foil-dash var(--mg-foil-speed, 3800ms) linear infinite;
    }

    @keyframes mg-foil-dash {
      to { stroke-dashoffset: calc(-1 * var(--mg-perimeter, 1000px)); }
    }
    `;
    const tag = document.createElement("style");
    tag.id = "mg-foil-css";
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  /** Inject minimal collapse CSS (hide stage + actions when collapsed) */
  _ensureCollapseCSS() {
    if (document.getElementById("mg-ini-collapse-css")) return;
    const css = `
      .mg-initiative.is-collapsed .mg-ini-stage { display: none !important; }
      .mg-initiative.is-collapsed .mg-ini-actions { display: none !important; }
      .mg-initiative.is-collapsed .mg-ini-header { cursor: pointer; }
    `;
    const tag = document.createElement("style");
    tag.id = "mg-ini-collapse-css";
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  /** Apply collapsed/expanded state. Persists per-user. */
  async _setCollapsed(next = false, { animate = true } = {}) {
    next = !!next;
    if (!this._root || next === this._collapsed) return;
    this._ensureCollapseCSS();
    this._collapsed = next;

    // Persist for THIS user so reload remembers
    try { await game.user?.setFlag?.("midnight-gambit", "initiativeCollapsed", next); } catch (_) {}

    // Collapse → hide foil and optionally release fixed positioning
    if (next) {
      // hide the wisp immediately so nothing floats
      await this._foilFadeOut(animate ? 180 : 0).catch(() => {});
      this._root.classList.add("is-collapsed");

      if (this._collapseReleasePosition) {
        // Save current pos so we can restore when expanded
        const rect = this._root.getBoundingClientRect();
        this._preCollapsePos = { left: rect.left, top: rect.top };
        // Let the container flow if you want (optional)
        Object.assign(this._root.style, {
          position: "",
          left: "", right: "", top: "", bottom: ""
        });
      }
      return;
    }

    // Expand → reapply fixed pos if we released it, resync foil to featured, fade back in
    this._root.classList.remove("is-collapsed");

    if (this._collapseReleasePosition && this._preCollapsePos) {
      // Restore fixed placement roughly where it was
      Object.assign(this._root.style, {
        position: "fixed",
        left: `${this._preCollapsePos.left}px`,
        top: `${this._preCollapsePos.top}px`,
        right: "", bottom: ""
      });
    }

    // Ensure layout is current, then snap foil to featured and fade in
    const stage = this._root?.querySelector(".mg-ini-diag-stage");
    const feat  = stage?.querySelector('.mg-ini-slice[data-slot="0"]') || null;

    if (feat && feat.dataset.actorId !== "__MG_END__") {
      // wait one paint so DOM toggles are committed
      await this._nextFrame();
      this._syncFoilToSlice(feat, true);
      this._resetFoilStroke();
      await this._foilFadeIn(animate ? undefined : 0).catch(() => {});
    } else {
      // nothing featured -> keep foil hidden
      this._syncFoilToSlice(null, false);
    }
  }

  /** Convenience toggle bound to header dblclick */
  async _toggleCollapsed() {
    return this._setCollapsed(!this._collapsed, { animate: true });
  }


  /** Restart the foil wisp animation from the start of the border path. */
  _resetFoilStroke() {
    const ring = this._foilEl?.querySelector(".mg-ini-foil__ring");
    if (!ring) return;

    // Zero the offset so the wisp begins at the path origin (top-left of the rect)
    ring.style.strokeDashoffset = "0px";

    // Restart the CSS animation cleanly (works for SVG across browsers)
    const prev = ring.style.animation;
    ring.style.animation = "none";
    // Force a reflow (SVG-friendly): either getBBox or getBoundingClientRect
    if (typeof ring.getBBox === "function") void ring.getBBox();
    else void ring.getBoundingClientRect();
    // Restore to stylesheet animation
    if (prev) ring.style.animation = prev; else ring.style.removeProperty("animation");
  }

  /** Fade the floating foil out, then hide it (no mid-air during moves). */
  async _foilFadeOut(ms = 180) {
    const foil = this._foilEl ?? this._ensureFoilLayer();
    if (!foil) return;

    // Instant path for ms <= 0 to avoid the 300ms _afterTransition safety timeout
    if (ms <= 0) {
      foil.style.transition = "none";
      foil.style.opacity = "0";
      foil.style.display = "none";
      return; // no await, no race
    }

    foil.style.transition = `opacity ${ms}ms cubic-bezier(.2,.8,.2,1)`;
    foil.style.display = "";
    void foil.offsetWidth;                 // commit base
    foil.style.opacity = "0";
    await this._afterTransition(foil);
    foil.style.display = "none";
  }


  /** Show the foil and fade it back in (after layout + resync). */
  async _foilFadeIn(ms) {
    const foil = this._foilEl ?? this._ensureFoilLayer();
    if (!foil) return;
    const dur = (ms ?? this._foilFadeInMs ?? 700);

    foil.style.transition = "none";
    foil.style.display = "";
    foil.style.opacity = "0";
    void foil.offsetWidth; // commit base

    foil.style.transition = `opacity ${dur}ms cubic-bezier(.2,.8,.2,1)`;
    foil.style.opacity = "1";
    await this._afterTransition(foil);
    foil.style.removeProperty("transition");
  }

  /** Reset to Crew order and relayout without closing */
  async _resetInitiative() {
    const root  = this._getRoot();
    const stage = root.querySelector(".mg-ini-diag-stage");
    if (!stage) return;
  
    // Make sure we have a stable actor list
    if (!this._ids || !this._ids.length) this._ids = this.getOrderActorIds();
    const seq = [...this._ids, END_ID];
    const L   = seq.length;
    const win = Math.min(MAX_VISIBLE, L);
  
    // 0) Clear any stale inline styles so hidden cards don't stay invisible
    stage.querySelectorAll(".mg-ini-slice").forEach((el) => {
      el.style.transition = "none";
      el.classList.remove("is-leaving", "mg-enter-up", "mg-enter-up-active", "mg-flip-run");
      el.style.removeProperty("opacity");
      el.style.removeProperty("visibility");
      el.style.removeProperty("transform");
      if (el.getAttribute("aria-hidden") === "true") el.removeAttribute("aria-hidden");
    });
    // Commit the style reset for this frame
    void stage.offsetWidth;
  
    // 1) Reset offset and ensure all slices exist
    this._vOffset = 0;
    this._ensureSlices(stage, seq);
  
    // 2) Position visible window
    const slots = this._diagPositions(win);
    for (let j = 0; j < win; j++) {
      const id = seq[j];
      const el = stage.querySelector(`.mg-ini-slice[data-actor-id="${id}"]`);
      if (!el) continue;
      this._applySlicePos(el, slots[j], j === 0 && id !== END_ID);
      el.style.visibility = ""; // visible
      el.style.opacity = "";    // visible
    }
  
    // 3) Park non-visible slices hidden (no transforms lingering)
    for (let k = win; k < L; k++) {
      const id = seq[k];
      const el = stage.querySelector(`.mg-ini-slice[data-actor-id="${id}"]`);
      if (!el) continue;
      this._applySlicePos(el, slots[win - 1], false);
      el.style.visibility = "hidden";
      el.style.opacity = "0";
      el.style.removeProperty("transform");
    }
  
    // 4) Re-enable transitions for future animations
    stage.querySelectorAll(".mg-ini-slice").forEach((el) => el.style.removeProperty("transition"));
  
    // 5) Refresh the spotlight label to the NEW first entry
    {
      const firstId = seq[0];
      const name =
        game.actors.get(firstId ?? "")?.name ??
        (firstId === END_ID ? "End of Round" : "—");
  
      const label = root.querySelector("[data-next-name]");
      if (label) label.textContent = name;
    }
  
    // 6) Recompute container sizing if you use autosize
    this._layoutDiagonal(this._ids);
    if (typeof this._autosizeFrame === "function") this._autosizeFrame();

    // Reset should wipe the saved progress so a fresh open starts at 0 again
    await this._clearIniState();
  }

  // Smoothly hide/close the initiative bar (public API used by your click handler)
  async hideBar(options = { animate: true }) {
    // GM: broadcast close to all clients
    if (game.user.isGM && game.socket) {
      game.socket.emit("system.midnight-gambit", {
        type: "iniClose",
        sender: game.user.id
      });
    }

    const root =
      this._root ||
      this.element?.[0] ||
      document.querySelector(".mg-ini-root") ||
      null;

    if (!root) return false;
    // Persist progress so reopen resumes at the same point
    await this._persistIniState();
    


    // Try to close the hosting Foundry window first (most reliable)
    const winEl = root.closest?.(".window-app");
    const appId = winEl?.dataset?.appid;
    const app   = appId != null ? ui.windows?.[Number(appId)] : null;
    if (app && typeof app.close === "function") {
      await app.close();   // Foundry will handle teardown & DOM removal
      return true;
    }

    // Optional fade-out (keeps behavior consistent with your other async actions)
    if (options.animate) {
      // Use inline transition so we don't depend on CSS classes that might be missing
      root.style.transition = root.style.transition || "opacity 180ms cubic-bezier(.2,.8,.2,1)";
      // force reflow so the transition applies
      void root.offsetWidth;
      root.style.opacity = "0";
      await new Promise((res) => {
        const done = () => (root.removeEventListener("transitionend", done), res());
        // If transition is instantly removed or not present, resolve next tick
        const dur = parseFloat(getComputedStyle(root).transitionDuration || "0");
        if (!dur) return queueMicrotask(res);
        root.addEventListener("transitionend", done, { once: true });
      });
    }

    // Fallback hard-remove (if not inside a Foundry window)
    if (root.parentNode) root.parentNode.removeChild(root);

    // Call your internal teardown if you have one
    if (typeof this._teardown === "function") {
      try { await this._teardown(); } catch (_) {}
    }

    // FINAL: only on manual close do we flip the “is open” flag off
    await game.settings.set(MG_NS, "initiativeOpen", false);
    return true;
  }

  // === Shared-state readers (scene flag preferred) ===
  async _readSharedInitiativeState() {
    // Prefer scene flag
    const scene = game.scenes?.current;
    if (scene?.getFlag) {
      const state = await scene.getFlag("midnight-gambit", "initState");
      if (state && typeof state === "object") return state;
    }
    // Fallback in case you still have a world setting around
    if (game.settings?.get) {
      try {
        const state = game.settings.get("midnight-gambit", "initState");
        if (state && typeof state === "object") return state;
      } catch (_) {}
    }
    return null;
  }

  /** Reorder the card DOM to match a list of ids */
  _reorderCardsByIds(orderIds = []) {
    if (!this._root) return;
    const list = this._root.querySelector(".mg-init-list"); // adjust if your container differs
    if (!list) return;

    // Build a map from id -> card element (expects data-id on each card)
    const byId = {};
    list.querySelectorAll(".mg-init-card").forEach(el => {
      byId[el.dataset.id] = el;
    });

    // Append in the desired order first
    orderIds.forEach(id => {
      const el = byId[id];
      if (el) list.appendChild(el);
    });

    // Then append any strays not in orderIds (safety)
    list.querySelectorAll(".mg-init-card").forEach(el => {
      if (!orderIds.includes(el.dataset.id)) list.appendChild(el);
    });
  }

  /** Make a given index the active card (class toggle only) */
  _setActiveIndex(idx = 0) {
    this._activeIndex = Math.max(0, idx);
    const cards = this._root?.querySelectorAll(".mg-init-card") ?? [];
    cards.forEach((el, i) => el.classList.toggle("active", i === this._activeIndex));
  }

  /** One-shot hydrate on mount: read durable scene state (fallback to per-user) */
  async _syncUIFromSharedState() {
    // 1) Durable scene state (GM updates this after Next/Reset)
    let orderIds = null;
    let activeIndex = 0;

    try {
      const scene = canvas?.scene;
      if (scene?.getFlag) {
        const state = await scene.getFlag("midnight-gambit", "initState");
        if (state && typeof state === "object") {
          if (Array.isArray(state.orderIds) && state.orderIds.length) {
            orderIds = state.orderIds.filter(id => !!game.actors.get(id));
          }
          if (Number.isFinite(state.activeIndex)) {
            activeIndex = Number(state.activeIndex);
          }
        }
      }
    } catch (_) { /* ignore */ }

    // 2) If no scene state, fall back to per-user vOffset
    if (!orderIds) {
      orderIds = this.getOrderActorIds();
      try {
        const saved = await game.user.getFlag("midnight-gambit", "initiativeUi");
        if (saved && Number.isFinite(saved.vOffset)) {
          activeIndex = Number(saved.vOffset);
        }
      } catch (_) { /* ignore */ }
    }

    // Normalize and apply
    this._ids = Array.isArray(orderIds) ? orderIds : [];
    const L = Math.max(1, this._ids.length + 1); // +1 for END slot
    this._vOffset = ((activeIndex % L) + L) % L;
    this._renderActiveName();
  }


  /** Mount / Unmount */
  _ensureAttached() {
    // If already attached, we're good
    if (this._root && this._root.isConnected) return;
  
    // If _root somehow became a string or something weird, reset it
    if (!(this._root instanceof HTMLElement)) this._root = null;
  
    // Build fresh DOM (buildHTML is the only place that appends to document.body)
    this._attached = false;
    this._buildHTML();
    this._bindRootEvents();
    this._applyInitialPosition(); // 1) place bottom-right (or restore)
    this._enableDrag();           // 2) make header draggable and persist position
    this._attached = true;
    this._syncUIFromSharedState();
  }

  _detach() {
    if (!this._attached) return;
    this._foilEl?.remove();
    this._foilEl = null;
    this._root?.remove();
    this._root = null;
    this._attached = false;
  }

  // Reliable root resolver for this widget (works whether _root/element is set)
  _getRoot() {
    return this._root || this.element || document;
  }

  _rerender() {
    if (!this._attached) return;
    const pos = { left: this._root.style.left, right: this._root.style.right, top: this._root.style.top };
    this._detach();
    this._ensureAttached();
    // restore pos
    Object.assign(this._root.style, pos);
  }

  /** Live sync: when Crew changes its initiative flag/system, refresh in place */
  _wireLiveRefresh() {
    if (this._wired) return;
    this._wired = true;

    Hooks.on("updateActor", (actor, changed) => {
      const crew = this._resolveCrewActor();
      if (!crew || actor.id !== crew.id) return;

      // --- A) Progress tick (advance one) ---
      const progress = getProperty(changed, "flags.midnight-gambit.initiativeProgress");
      if (progress && typeof progress === "object") {
        const { ids, prev, syncId } = progress;

        if (syncId && this._lastSyncId === syncId) return;
        if (syncId) this._lastSyncId = syncId;

        if (Array.isArray(ids) && ids.length) {
          this._ids = ids.filter((id) => !!game.actors.get(id));
        } else if (!Array.isArray(this._ids) || !this._ids.length) {
          this._ids = this.getOrderActorIds();
        }

        const n = Array.isArray(this._ids) ? this._ids.length : 0;
        const L = (n > 0 ? n + 1 : 1);
        const clampedPrev = Number.isFinite(prev) ? ((prev % L) + L) % L : 0;
        this._vOffset = clampedPrev;

        if (this._attached) {
          this._endTurn()
            .then(() => {
              this._renderActiveName();
              return this._persistDurableInitState();
            })
            .catch(console.error);
        } else {
          // closed: still save durable state so reopen shows correct active
          this._persistIniState().catch(() => {});
          this._persistDurableInitState().catch(() => {});
        }
        return;
      }

      // --- B) Reset signal (go to start) ---
      const resetSig = getProperty(changed, "flags.midnight-gambit.initiativeReset");
      if (resetSig && typeof resetSig === "object") {
        const { ids, syncId } = resetSig;

        if (syncId && this._lastSyncId === syncId) return;
        if (syncId) this._lastSyncId = syncId;

        if (Array.isArray(ids) && ids.length) {
          this._ids = ids.filter((id) => !!game.actors.get(id));
        } else {
          this._ids = this.getOrderActorIds();
        }

        this._vOffset = 0;

        if (this._attached) {
          // run the longer reset timing without making the whole hook async
          (async () => {
            const RESET_FADE_MS = 320;
            this._foilDefer = true;

            // 1) hide the wisp so it doesn't float during the shuffle
            await this._foilFadeOut(RESET_FADE_MS).catch(() => {});

            // 2) rebuild + relayout
            const stage = this._root?.querySelector(".mg-ini-diag-stage");
            if (stage) {
              // Remove any stale slices that aren't part of the new set
              const want = new Set([...this._ids, END_ID]);
              stage.querySelectorAll(".mg-ini-slice").forEach(node => {
                const id = node.getAttribute("data-actor-id");
                if (!want.has(id)) node.remove();
              });

              // Ensure all needed slices exist (adds any missing)
              this._ensureSlices(stage, [...this._ids, END_ID]);
              this._normalizeEndSlices(stage);

              // Make sure nothing is visually stuck hidden after the rebuild
              this._revealAllCards?.();
            }

            this._layoutDiagonal(this._ids);
            if (typeof this._autosizeFrame === "function") this._autosizeFrame();

            // 3) animate the header name and wait for the featured slice's transform to finish
            const firstId = this._ids[0] ?? null;
            const resetName = firstId ? (game.actors.get(firstId)?.name ?? "—") : "End of Round";
            const feat = this._root?.querySelector('.mg-ini-diag-stage .mg-ini-slice[data-slot="0"]');

            await Promise.all([
              this._animateActiveNameChange(resetName).catch(() => {}),
              feat ? this._afterTransition(feat) : Promise.resolve()
            ]);

            {
              const featNow = this._root?.querySelector('.mg-ini-diag-stage .mg-ini-slice[data-slot="0"]');
              this._syncFoilToSlice(featNow, !!featNow);
            }

            // 4) reset the wisp lap, then fade it back in a hair slower for reset
            this._resetFoilStroke();

            // extra hold before showing the wisp again
            const HOLD_AFTER_MS = 210;   // tweak to taste
            await new Promise(r => setTimeout(r, HOLD_AFTER_MS));

            this._foilDefer = true;

            await this._foilFadeIn().catch(() => {}); // same slow fade as everything else

            // 5) persist durable state for reopen/refresh
            this._persistDurableInitState().catch(() => {});
          })();
        } else {
          this._persistIniState().catch(() => {});
          this._persistDurableInitState().catch(() => {});
        }
        return;
      }

      // --- C) Order changed (existing behavior) ---
      const touchedFlag   = getProperty(changed, "flags.midnight-gambit.initiativeOrder");
      const touchedSystem = getProperty(changed, "system.initiative.order");
      if (touchedFlag || touchedSystem) {
        this._ids = this.getOrderActorIds();
        if (!this._attached) return;

        const stage = this._root?.querySelector(".mg-ini-diag-stage");
        if (stage) this._ensureSlices(stage, [...this._ids, END_ID]);
        this._layoutDiagonal(this._ids);
        if (typeof this._autosizeFrame === "function") this._autosizeFrame();
        this._renderActiveName();
      }
    });

  }

  _iniUnsub = null;

  _wireInitiativeController() {
    if (this._iniUnsub) return;

    const ctl = MGInitiativeController.instance;
    this._iniUnsub = ctl.subscribe((evt) => this._onInitiativeEvent(evt));
  }

  async _onInitiativeEvent(evt) {
    if (!evt || !evt.type) return;

    // --- A) Progress tick (advance one) ---
    if (evt.type === "progress") {
      const { ids, prev } = evt.payload ?? {};

      if (Array.isArray(ids) && ids.length) {
        this._ids = ids.filter(id => !!game.actors.get(id));
      } else if (!Array.isArray(this._ids) || !this._ids.length) {
        this._ids = this.getOrderActorIds();
      }

      const n = Array.isArray(this._ids) ? this._ids.length : 0;
      const L = (n > 0 ? n + 1 : 1);
      const clampedPrev = Number.isFinite(prev) ? ((prev % L) + L) % L : 0;
      this._vOffset = clampedPrev;

      if (this._attached) {
        this._endTurn()
          .then(() => {
            this._renderActiveName();
            return this._persistDurableInitState();
          })
          .catch(console.error);
      } else {
        this._persistIniState().catch(() => {});
        this._persistDurableInitState().catch(() => {});
      }
      return;
    }

    // --- B) Reset signal (go to start) ---
    if (evt.type === "reset") {
      const { ids } = evt.payload ?? {};

      if (Array.isArray(ids) && ids.length) {
        this._ids = ids.filter(id => !!game.actors.get(id));
      } else {
        this._ids = this.getOrderActorIds();
      }

      this._vOffset = 0;

      if (this._attached) {
        (async () => {
          const RESET_FADE_MS = 320;
          this._foilDefer = true;

          await this._foilFadeOut(RESET_FADE_MS).catch(() => {});

          const stage = this._root?.querySelector(".mg-ini-diag-stage");
          if (stage) {
            const want = new Set([...this._ids, END_ID]);
            stage.querySelectorAll(".mg-ini-slice").forEach(node => {
              const id = node.getAttribute("data-actor-id");
              if (!want.has(id)) node.remove();
            });

            this._ensureSlices(stage, [...this._ids, END_ID]);
            this._revealAllCards?.();
          }

          this._layoutDiagonal(this._ids);
          if (typeof this._autosizeFrame === "function") this._autosizeFrame();

          const firstId = this._ids[0] ?? null;
          const resetName = firstId ? (game.actors.get(firstId)?.name ?? "—") : "End of Round";
          const feat = this._root?.querySelector('.mg-ini-diag-stage .mg-ini-slice[data-slot="0"]');

          await Promise.all([
            this._animateActiveNameChange(resetName).catch(() => {}),
            feat ? this._afterTransition(feat) : Promise.resolve()
          ]);

          const featNow = this._root?.querySelector('.mg-ini-diag-stage .mg-ini-slice[data-slot="0"]');
          this._syncFoilToSlice(featNow, !!featNow);

          this._resetFoilStroke();

          const HOLD_AFTER_MS = 210;
          await new Promise(r => setTimeout(r, HOLD_AFTER_MS));

          this._foilDefer = true;
          await this._foilFadeIn().catch(() => {});

          this._persistDurableInitState().catch(() => {});
        })();
      } else {
        this._persistIniState().catch(() => {});
        this._persistDurableInitState().catch(() => {});
      }
      return;
    }

    // --- C) Order changed ---
    if (evt.type === "order") {
      this._ids = this.getOrderActorIds();
      if (!this._attached) return;

      const stage = this._root?.querySelector(".mg-ini-diag-stage");
      if (stage) this._ensureSlices(stage, [...this._ids, END_ID]);
      this._layoutDiagonal(this._ids);
      if (typeof this._autosizeFrame === "function") this._autosizeFrame();
      this._renderActiveName();
    }
  }

  _onAnyUpdate() {
    // throttle a tick to avoid spam
    clearTimeout(this._rt);
    this._rt = setTimeout(() => this._rerender(), 50);
  }

  /** Simple drag (no popOut frame) */
  _onDragStart(ev, el) {
    ev.preventDefault();
    el.setPointerCapture(ev.pointerId);
    const rect = el.getBoundingClientRect();
    const start = { x: ev.clientX, y: ev.clientY, left: rect.left, top: rect.top };
    const onMove = (mv) => {
      const dx = mv.clientX - start.x;
      const dy = mv.clientY - start.y;
      el.style.left = `${start.left + dx}px`;
      el.style.right = "unset";
      el.style.top = `${start.top + dy}px`;
    };
    const onUp = (up) => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp, true);
      try { el.releasePointerCapture(ev.pointerId); } catch(_) {}
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp, true);
  }

  /** Dynamically size the stage so cards aren't clipped or squished (width + height) */
  _autosizeFrame() {
    if (!this._root) return;

    // Your SCSS uses .mg-ini-stage around .mg-ini-diag-stage
    const wrap =
      this._root.querySelector(".mg-ini-stage") ||
      this._root.querySelector(".mg-ini-diag-wrap"); // safety fallback

    const stage = this._root.querySelector(".mg-ini-diag-stage");
    if (!wrap || !stage) return;

    const nodes = stage.querySelectorAll(".mg-ini-slice, .mg-ini-endcap");
    if (!nodes.length) {
      wrap.style.width = "";
      wrap.style.height = "";
      stage.style.width = "";
      stage.style.height = "";
      return;
    }

    let maxRight = 0;
    let maxBottom = 0;

    for (const el of nodes) {
      const cs = getComputedStyle(el);

      // Skip fully hidden (off-window) items; include if you prefer full sequence bounds
      if (cs.visibility === "hidden" || cs.display === "none") continue;

      const x = parseFloat(cs.getPropertyValue("--x")) || 0;
      const y = parseFloat(cs.getPropertyValue("--y")) || 0;
      const w = parseFloat(cs.getPropertyValue("--w")) || el.getBoundingClientRect().width || 0;
      const h = parseFloat(cs.getPropertyValue("--h")) || el.getBoundingClientRect().height || 0;

      maxRight  = Math.max(maxRight,  x + w);
      maxBottom = Math.max(maxBottom, y + h);
    }

    // Account for wrapper padding (your SCSS sets padding on .mg-ini-stage)
    const cw = getComputedStyle(wrap);
    const padL = parseFloat(cw.paddingLeft)   || 0;
    const padR = parseFloat(cw.paddingRight)  || 0;
    const padT = parseFloat(cw.paddingTop)    || 0;
    const padB = parseFloat(cw.paddingBottom) || 0;

    // Small cushion so borders/shadows don’t clip
    const cushion = 8;

    // Size the inner stage to the content bounds
    stage.style.width  = `${Math.ceil(maxRight)}px`;
    stage.style.height = `${Math.ceil(maxBottom)}px`;

    // Size the wrapper to content + padding (wrapper is box-sizing: border-box)
    wrap.style.width  = `${Math.ceil(maxRight + padL + padR + cushion)}px`;
    wrap.style.height = `${Math.ceil(maxBottom + padT + padB + cushion)}px`;
  }

}

// ---- System setting for Crew Actor selection (optional UI in core settings) ----
Hooks.once("init", () => {
  game.settings.register("midnight-gambit", "crewActorId", {
    name: "Crew Actor (Initiative Source)",
    hint: "Select the Crew Actor whose Initiative tab determines order. If unset, the bar uses player characters.",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });
});


// Auto-reopen Initiative Bar after reload if it was open before
Hooks.once("ready", async () => {
  try {
    const shouldReopen = await game.settings.get(MG_NS, "initiativeOpen");
    if (!shouldReopen) return;

    // Reuse an existing instance if you keep one; otherwise create one
    // If you already have a singleton, keep using it — this is safe either way.
    if (!window.mgInitiativeBar || !(window.mgInitiativeBar instanceof MGInitiativeBar)) {
      window.mgInitiativeBar = new MGInitiativeBar();
    }

    await window.mgInitiativeBar.showBar();
  } catch (e) {
    console.warn("MG | Failed to auto-reopen Initiative Bar:", e);
  }
});

function registerMGInitiativeSocket() {
  // Singleton access
  game.mgInitiative = MGInitiativeBar.instance;

  if (!game.socket) return;

  // Avoid double-binding if this runs twice
  if (game.mgInitiative?._socketBound) return;
  game.mgInitiative._socketBound = true;

  game.socket.on("system.midnight-gambit", async (msg) => {
    if (!msg) return;

    console.log("MG SOCKET RECEIVED:", msg, "isGM?", game.user.isGM, "user:", game.user.id);

    // Everyone handles open/close (UI sync)
    if (msg.type === "iniOpen") {
      if (msg.sender === game.user.id) return;
      await MGInitiativeBar.instance.showBar();
      return;
    }

    if (msg.type === "iniClose") {
      if (msg.sender === game.user.id) return;
      await MGInitiativeBar.instance.hideBar({ animate: false });
      return;
    }

    // GM-only relay for shared state writes
    if (!game.user.isGM) return;

    try {
      const inst = game.mgInitiative;
      const crew = inst?._resolveCrewActor?.();
      if (!crew) return;

      if (msg.type === "iniProgress") {
        await crew.setFlag("midnight-gambit", "initiativeProgress", msg.payload);
      }

      if (msg.type === "iniReset") {
        await crew.setFlag("midnight-gambit", "initiativeReset", msg.payload);
      }
    } catch (e) {
      console.error("MG | GM relay failed:", e);
    }
  });
}

// Register on ready (normal path)
Hooks.once("ready", registerMGInitiativeSocket);

// ALSO register immediately if this file loads late (post-ready)
if (game?.ready) registerMGInitiativeSocket();

