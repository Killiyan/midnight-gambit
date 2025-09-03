// systems/midnight-gambit/initiative-bar.js
// Frameless Initiative overlay for Midnight Gambit.
// Reads Crew Sheet initiative order from a flag, falls back to player characters.
// Click a portrait to "End Turn": it slides out, then reappears at the end.

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
    if (!this._ids || !this._ids.length) this._ids = this.getOrderActorIds();
    const stage = this._root.querySelector(".mg-ini-diag-stage");
    this._ensureSlices(stage, this._ids);
    this._layoutDiagonal(this._ids);
    this._autosizeFrame(); // compute & lock size ONCE on first open
  }
  hideBar() {
    this._detach();
    this._sizeLocked = false; // next open can recompute size
  }
  toggleBar() { (this._attached ? this.hideBar() : this.showBar()); }
  async render() { return this; }





  /** Internal state */
  _attached = false;
  _attached = false;
  _root = null;
  _ids = [];
  _sizeLocked = false;
  _drag = { active: false, dx: 0, dy: 0 };

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


  /** Build minimal HTML (no template needed) */
  _buildHTML() {
    const ids = this.getOrderActorIds();
    this._ids = [...ids]; // keep a local order array for layout/animation
    const activeId = this._getActiveId(ids);

    const wrap = document.createElement("div");
    wrap.className = "mg-initiative mg-ini--diag";
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Initiative Order");

    // Header + stage container
    const activeName = game.actors.get(activeId)?.name ?? "";
    wrap.innerHTML = `
      <div class="mg-ini-header" data-drag-handle>
        <div class="mg-ini-headline">
          <div class="up-next">Up next:</div>
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
        <div class="mg-ini-lane" aria-hidden="true"></div>
        <div class="mg-ini-diag-stage"></div>
        <div class="mg-ini-watermark" aria-hidden="true">INITIATIVE</div>
      </div>
    `;

    // Build slices once, then place them
    const stage = wrap.querySelector(".mg-ini-diag-stage");
    this._ensureSlices(stage, this._ids);

    // Drag move (guard so buttons still click)
    wrap.querySelector("[data-drag-handle]").addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      if (ev.target.closest(".mg-ini-actions, .mg-ini-btn, button, a, input, select, textarea")) return;
      this._onDragStart(ev, wrap);
    });

    return wrap;
  }

  /** Create any missing slice buttons for ids; reuse existing by data-actor-id */
  _ensureSlices(stage, ids) {
    const existing = new Map([...stage.querySelectorAll(".mg-ini-slice")]
      .map(el => [el.dataset.actorId, el]));
    for (const id of ids) {
      if (existing.has(id)) continue;
      const a = game.actors.get(id);
      if (!a) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mg-ini-slice";
      btn.dataset.actorId = id;
      btn.title = a.name;
      btn.innerHTML = `
        <div class="mg-ini-image" style="background-image:url('${a.img}')"></div>
      `;
      stage.appendChild(btn);
    }
    // Remove slices for actors no longer present
    [...stage.querySelectorAll(".mg-ini-slice")].forEach(el => {
      if (!ids.includes(el.dataset.actorId)) el.remove();
    });
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

  /** Apply transforms/sizes to each slice according to current order */
  _layoutDiagonal(ids) {
    const stage = this._root?.querySelector(".mg-ini-diag-stage");
    if (!stage) return;
    const positions = this._diagPositions(ids.length);

    // Update headline
    const nextNameEl = this._root.querySelector("[data-next-name]");
    const firstName = game.actors.get(ids[0])?.name ?? "";
    if (nextNameEl) nextNameEl.textContent = firstName;

    ids.forEach((id, i) => {
      const el = stage.querySelector(`.mg-ini-slice[data-actor-id="${id}"]`);
      if (!el) return;
      const p = positions[i];
      this._applySlicePos(el, p, i === 0);
    });
  }

  /** Set inline transform/size for a slice, with skew container and unscrew inner image */
  _applySlicePos(el, p, featured) {
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


  /** Animate advance: first slides left, others shift forward, first re-enters at end from bottom */
  async _endTurn() {
    const stage = this._root?.querySelector(".mg-ini-diag-stage");
    if (!stage) return;

    // Make sure we have ids and slice nodes
    if (!this._ids || !this._ids.length) this._ids = this.getOrderActorIds();
    this._ensureSlices(stage, this._ids);

    if (!this._ids.length) {
      ui.notifications?.warn("No actors in Initiative to advance.");
      return;
    }

    const leavingId = this._ids[0];
    let leavingEl = stage.querySelector(`.mg-ini-slice[data-actor-id="${leavingId}"]`);
    if (!leavingEl) {
      this._ensureSlices(stage, this._ids);
      this._layoutDiagonal(this._ids);
      leavingEl = stage.querySelector(`.mg-ini-slice[data-actor-id="${leavingId}"]`);
      if (!leavingEl) {
        ui.notifications?.warn("No actors in Initiative to advance.");
        return;
      }
    }

    // --- scrub any inline leftovers from prior cycle so .is-leaving works
    leavingEl.classList.remove("is-entering", "is-leaving");
    leavingEl.style.removeProperty("transform");
    leavingEl.style.removeProperty("opacity");
    leavingEl.style.removeProperty("transition");

    // 1) shift others forward (ids[1..] -> positions[0..])
    const shifted = this._ids.slice(1);
    this._layoutDiagonal(shifted); // CSS transitions handle the move

    // 2) leaving: slide out left & fade
    leavingEl.classList.add("is-leaving");
    await this._afterTransition(leavingEl).catch(() => {});

    // 3) move leaving to end; spawn slightly below its final slot, then animate up
    leavingEl.classList.remove("is-leaving");
    stage.appendChild(leavingEl);

    const newOrder = [...shifted, leavingId];
    this._ids = newOrder;

    const positions = this._diagPositions(newOrder.length);
    const lastPos = positions[positions.length - 1];

    // place just below and invisible (no transition for the teleport)
    leavingEl.style.transition = "none";
    this._applySlicePos(leavingEl, lastPos, false);
    leavingEl.style.transform = `translate(var(--x), calc(var(--y) + 36px)) skewX(var(--skX))`;
    leavingEl.style.opacity = "0";

    // next frame -> animate into place
    void leavingEl.offsetHeight;
    leavingEl.style.transition = ""; // restore css transitions
    leavingEl.style.transform = `translate(var(--x), var(--y)) skewX(var(--skX))`;
    leavingEl.style.opacity = "1";

    await this._afterTransition(leavingEl).catch(() => {});

    // --- scrub again so next cycle's .is-leaving takes over cleanly
    leavingEl.style.removeProperty("transform");
    leavingEl.style.removeProperty("opacity");
    leavingEl.style.removeProperty("transition");

    // refresh full layout (also updates header name + featured class)
    this._layoutDiagonal(this._ids);

    // persist new order to Crew flag (actor IDs)
    await this._persistCurrentOrder();
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
        this._resetOrder();
        return;
      }

      if (tgt.closest(".mg-ini-next")) {
        ev.preventDefault();
        if (!this._ids || !this._ids.length) {
          ui.notifications?.warn("No actors in Initiative to advance.");
          return;
        }
        this._endTurn();
        return;
      }
    });

    // Click a slice -> select its token (does NOT end turn)
    this._root.addEventListener("click", (ev) => {
      const slot = ev.target.closest(".mg-ini-slice");
      if (!slot) return;
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

  /** Save the current actor-id order to the Crew flag the bar reads */
  async _persistCurrentOrder() {
    let crew = null;
    try {
      const crewId = game.settings.get("midnight-gambit", "crewActorId");
      if (crewId) crew = game.actors.get(crewId) || null;
    } catch (_) {}

    if (!crew) return;

    const ids = Array.isArray(this._ids) ? this._ids : [];
    if (!ids.length) return;

    await crew.setFlag("midnight-gambit", "initiativeOrder", ids);
  }

  async _resetOrder() {
    const crewId = game.settings.get("midnight-gambit", "crewActorId");
    const crew   = crewId ? game.actors.get(crewId) : null;
    if (crew) await crew.unsetFlag("midnight-gambit", "initiativeOrder");
    this._rerender();
    this._autosizeFrame();
    this._layoutDiagonal(this._ids);
  }

  /** Mount / Unmount */
  _ensureAttached() {
    if (this._attached) return;
    this._root = this._buildHTML();
    document.body.appendChild(this._root);
    this._attached = true;
    this._placeDefault();
    this._wireLiveRefresh();
    this._bindRootEvents();
    this._layoutDiagonal(this._ids || this.getOrderActorIds());
    this._autosizeFrame();
  }

  _detach() {
    if (!this._attached) return;
    this._root?.remove();
    this._root = null;
    this._attached = false;
  }

  _placeDefault() {
    // Drop it near top-right; users can drag anywhere
    const r = this._root;
    r.style.left = "unset";
    r.style.right = "24px";
    r.style.top = "110px";
  }

  _rerender() {
    if (!this._attached) return;
    const pos = { left: this._root.style.left, right: this._root.style.right, top: this._root.style.top };
    this._detach();
    this._ensureAttached();
    // restore pos
    Object.assign(this._root.style, pos);
  }

  _wireLiveRefresh() {
    // If actor image or name changes, re-render
    this._unhooks?.forEach(h => Hooks.off(...h));
    this._unhooks = [];
    this._unhooks.push(["updateActor", this._onAnyUpdate.bind(this)]);
    this._unhooks.push(["deleteActor", this._onAnyUpdate.bind(this)]);
    this._unhooks.push(["createActor", this._onAnyUpdate.bind(this)]);
    this._unhooks.forEach(([h, fn]) => Hooks.on(h, fn));
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

  /** Compute a stable stage size from slot positions and lock it (no jank on advance) */
  _autosizeFrame() {
    if (!this._root || this._sizeLocked) return;

    const frame   = this._root;
    const stageBox= frame.querySelector(".mg-ini-stage");
    const stage   = frame.querySelector(".mg-ini-diag-stage");
    if (!stageBox || !stage) return;

    // Use your layout math (stable) instead of live DOM (which includes animation transforms)
    const ids = (this._ids && this._ids.length) ? this._ids : this.getOrderActorIds();
    const pos = this._diagPositions(ids.length);

    if (!pos.length) {
      stage.style.width  = `300px`;
      stage.style.height = `120px`;
      this._sizeLocked = true;
      return;
    }

    let minX =  Infinity, minY =  Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const p of pos) {
      // Axis-aligned bounds of a rect skewed by skewX(p.sk) with origin at top-left:
      // top-left:     (p.x, p.y)
      // top-right:    (p.x + p.w, p.y)
      // bottom-left:  (p.x + p.h * tan(sk), p.y + p.h)
      // bottom-right: (p.x + p.w + p.h * tan(sk), p.y + p.h)
      const skRad = p.sk * Math.PI / 180;
      const tan   = Math.tan(skRad);

      const x1 = p.x;
      const x2 = p.x + p.w;
      const x3 = p.x + p.h * tan;
      const x4 = p.x + p.w + p.h * tan;

      const localMinX = Math.min(x1, x3);
      const localMaxX = Math.max(x2, x4);
      const localMinY = p.y;
      const localMaxY = p.y + p.h;

      if (localMinX < minX) minX = localMinX;
      if (localMinY < minY) minY = localMinY;
      if (localMaxX > maxX) maxX = localMaxX;
      if (localMaxY > maxY) maxY = localMaxY;
    }

    // Width/height of content at REST (no animation offsets)
    const contentW = Math.ceil(maxX - minX);
    const contentH = Math.ceil(maxY - minY);

    // Safety buffer so the “enter from bottom” (+36px) never forces a resize
    const ANIM_BUFFER = 48;

    stage.style.width  = `${contentW}px`;
    stage.style.height = `${contentH + ANIM_BUFFER}px`;

    // Let the header + padded stage naturally size the outer frame
    this._sizeLocked = true; // <- lock so subsequent calls are no-ops
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