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

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "mg-initiative",
      popOut: false,
      resizable: false
    });
  }

  /** Public helpers (frameless) */
  showBar() {
    this._ensureAttached();
    this._wireLiveRefresh();
    if (!this._ids || !this._ids.length) this._ids = this.getOrderActorIds();

    // Try to restore previous offset if it matches this actor order; else start at 0
    this._vOffset = 0;
    this._restoreIniStateIfAny()
      .then((ok) => {
        if (ok) {
          // Re-layout once the offset is restored
          this._layoutDiagonal(this._ids);
        }
      })
      .catch(() => { /* ignore */ });

    const stage = this._root.querySelector(".mg-ini-diag-stage");
    this._ensureSlices(stage, this._ids);   // create ALL actor nodes

    // Initial layout uses current _vOffset (it will re-run above if restore succeeds)
    this._layoutDiagonal(this._ids);
    this._autosizeFrame();                  // lock size to window (no jiggle)
    // Persist "is open" so a refresh re-opens it (no-await version)
    game.settings.set(MG_NS, "initiativeOpen", true).catch(() => {});
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

  /** Try Crew flag first, else fallback to player characters */
  getOrderActorIds() {
    // 1) Resolve Crew actor
    const crew = this._resolveCrewActor();

    // 2) Prefer Crew flag: array of Actor IDs
    const fromFlag = crew?.getFlag("midnight-gambit", "initiativeOrder");
    if (Array.isArray(fromFlag) && fromFlag.length) {
      return fromFlag.filter(id => !!game.actors.get(id));
    }

    // 3) Fallback: Crew system initiative (UUIDs) -> Actor IDs
    const uuids = crew?.system?.initiative?.order ?? [];
    if (Array.isArray(uuids) && uuids.length) {
      const ids = uuids
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

      <!-- IMPORTANT: your SCSS expects .mg-ini-stage, not .mg-ini-diag-wrap -->
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

  // Style A slot geometry — smaller/taller slices + tighter columns
  _diagPositions(count) {
    // Angle + shear factor for skewX
    const sk = -22;
    const t  = Math.tan(sk * Math.PI / 180);

    // 🔧 TWEAK ME: sizes
    const FEAT_W = 120, FEAT_H = 180;    // featured left slice size
    const SLICE_W = 75, SLICE_H = 180;  // all other slices size (was ~190x260)

    // 🔧 TWEAK ME: horizontal column positions (reduce to tighten)
    const COL_X_LEFT  = 60;
    const COL_X_MID   = 240;             // was ~360–380 (closer now)
    const COL_X_RIGHT = 324;             // was ~640 (much tighter)

    // 🔧 TWEAK ME: vertical tops for each column
    const Y_FEATURED = 120;
    const Y_MID_TOP  = 28;
    const Y_RIGHT_TOP= 60;

    // 🔧 TWEAK ME: vertical gap inside a column pair
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
    this._layoutEndcap();
  }

  // Compute and apply positions for the visible window. Hide everything else.
  _layoutDiagonal(actorIds) {
    const stage = this._root?.querySelector(".mg-ini-diag-stage");
    if (!stage) return;

    // Full sequence = actors + END
    const seq = [...actorIds, END_ID];

    // Make sure all nodes exist (including END) before we position/hide
    this._ensureSlices(stage, seq);

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

      // Inline safety: make sure END will transition transforms/opacity like others
      if (id === END_ID) {
        el.style.transitionProperty = el.style.transitionProperty || "transform, opacity";
        el.style.transitionDuration = el.style.transitionDuration || "280ms";
        el.style.transitionTimingFunction = el.style.transitionTimingFunction || "ease";
      }

      el.style.visibility = ""; // show
    });

    // Hide everything not in the current window (END included)
    const visSet = new Set(windowIds);
    for (const id of seq) {
      if (visSet.has(id)) continue;
      const el = stage.querySelector(`.mg-ini-slice[data-actor-id="${id}"]`);
      if (el) el.style.visibility = "hidden";
    }

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
  
    // Update header immediately
    const nextId = windowAfter[0];
    const nm = game.actors.get(nextId ?? "")?.name ?? (nextId === END_ID ? "End of Round" : "—");
    const tgt = this._root?.querySelector("[data-next-name]");
    if (tgt) tgt.textContent = nm;
  
    // Sync flip
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
    } else {
      await Promise.all([leaveDone, reenterDone]);
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
        this._emitReset().catch(console.error);
        return;
      }

      if (tgt.closest(".mg-ini-next")) {
        ev.preventDefault();

        // Emit a replicated progress tick; the updateActor listener will animate for everyone.
        this._emitNextStep().catch(console.error);
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
  }

  /** Active is simply the first element in the order array */
  _getActiveId(ids) { return ids[0] || null; }

  // Small helper to await the end of the CSS transition
  _afterTransition(el) {
    return new Promise((res) => {
      const onEnd = () => { el.removeEventListener("transitionend", onEnd); res(); };
      el.addEventListener("transitionend", onEnd, { once: true });
      // Safety timer in case transition doesn't fire
      setTimeout(res, 300);
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

      // 🔒 IMPORTANT: if the pointer started on a header button, DO NOT drag
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
  }

  _detach() {
    if (!this._attached) return;
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
          this._endTurn().catch(console.error);
        } else {
          this._persistIniState().catch(() => {});
        }
        return;
      }

      // --- B) Reset signal (go to start) ---
      const resetSig = getProperty(changed, "flags.midnight-gambit.initiativeReset");
      if (resetSig && typeof resetSig === "object") {
        const { ids, syncId } = resetSig;

        if (syncId && this._lastSyncId === syncId) return;
        if (syncId) this._lastSyncId = syncId;

        // Align IDs if provided, otherwise re-pull
        if (Array.isArray(ids) && ids.length) {
          this._ids = ids.filter((id) => !!game.actors.get(id));
        } else {
          this._ids = this.getOrderActorIds();
        }

        // Reset offset to the first slot (0)
        this._vOffset = 0;

        if (this._attached) {
          const stage = this._root?.querySelector(".mg-ini-diag-stage");
          if (stage) {
            // Rebuild stage nodes for the current IDs (+ END)
            this._ensureSlices(stage, [...this._ids, END_ID]);

            // Blow away any lingering invisibility/offstage styles
            this._revealAllCards();
          }

          // Re-layout fresh and autosize
          this._layoutDiagonal(this._ids);
          if (typeof this._autosizeFrame === "function") this._autosizeFrame();
        }

        // Persist so reopening restores correctly
        this._persistIniState().catch(() => {});
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
      }
    });

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

Hooks.once("ready", () => {
  // Singleton access
  game.mgInitiative = MGInitiativeBar.instance;

  if (game.socket) {
    game.socket.on("system.midnight-gambit", async (msg) => {
      if (!game.user.isGM) return;
      if (!msg || msg.type !== "iniProgress") return;

      try {
        const inst = game.mgInitiative;
        const crew = inst?._resolveCrewActor?.();
        if (!crew) return;
        await crew.setFlag("midnight-gambit", "initiativeProgress", msg.payload);
      } catch (e) {
        console.error("MG | GM relay failed:", e);
      }
    });
  }

  if (game.socket) {
    game.socket.on("system.midnight-gambit", async (msg) => {
      if (!game.user.isGM) return;
      if (!msg) return;

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

});
