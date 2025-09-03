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

  /** Public helpers */
  // We do NOT use Application's template render; we mount our own DOM.
  showBar() {
    this._ensureAttached();
    // ensure we have an order cached and laid out
    if (!this._ids || !this._ids.length) this._ids = this.getOrderActorIds();
    this._layoutDiagonal(this._ids);
  }
  hideBar() { this._detach(); }
  toggleBar() { (this._attached ? this.hideBar() : this.showBar()); }

  // (safety) noop Application.render
  async render() { return this; }



  /** Internal state */
  _attached = false;
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
        <div class="img" style="background-image:url('${a.img}')"></div>
      `;
      stage.appendChild(btn);
    }
    // Remove slices for actors no longer present
    [...stage.querySelectorAll(".mg-ini-slice")].forEach(el => {
      if (!ids.includes(el.dataset.actorId)) el.remove();
    });
  }

  // Tall slices with right-edge alignment (lower top-right meets upper bottom-right)
  _diagPositions(count) {
    const sk = -22;                                     // degrees, right-lean
    const t  = Math.tan(sk * Math.PI / 180);            // shear factor for skewX(sk)

    // spacing + tiny nudge to taste
    const gapY  = 28;                                   // vertical gap between a column pair
    const edgeX = 4;                                    // small cosmetic nudge along the slanted edge

    // column tops
    const featured = { x: 40,  y:  96, w: 240, h: 340 }; // big left
    const midTop   = { x: 380, y:  24, w: 190, h: 260 }; // middle col (top)
    const rightTop = { x: 640, y: 104, w: 190, h: 260 }; // right col (top)

    // place a slice directly below another with right edges aligned
    // y_low = y_top + h_top + gapY
    // x_low = x_top + (w_top - w_low) + t * (h_top + gapY) + edgeX
    const belowAligned = (above, w, h) => {
      const y = above.y + above.h + gapY;
      const x = above.x + (above.w - w) + t * (above.h + gapY) + edgeX;
      return { x, y, w, h };
    };

    const slots = [];
    if (count > 0) slots.push({ ...featured, sk });
    if (count > 1) slots.push({ ...midTop,   sk });
    if (count > 2) slots.push({ ...belowAligned(midTop,   190, 260), sk });
    if (count > 3) slots.push({ ...rightTop, sk });
    if (count > 4) slots.push({ ...belowAligned(rightTop, 190, 260), sk });

    // extras: continue stacking under the last right-hand slot
    let prev = (count > 4) ? slots[slots.length - 1] : rightTop;
    for (let i = 5; i < count; i++) {
      const nxt = belowAligned(prev, 190, 260);
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
    el.classList.toggle("is-featured", !!featured);
  }

  /** Animate advance: first slides left & fades; others shift forward; first re-enters at end from bottom */
  async _endTurn() {
    const stage = this._root?.querySelector(".mg-ini-diag-stage");
    if (!stage) return;

    // Make sure we have ids and slices
    if (!this._ids || !this._ids.length) this._ids = this.getOrderActorIds();
    this._ensureSlices(stage, this._ids);
    if (!this._ids.length) {
      ui.notifications?.warn("No actors in Initiative to advance.");
      return;
    }

  const leavingId = this._ids[0];
  let leavingEl = stage.querySelector(`.mg-ini-slice[data-actor-id="${leavingId}"]`);
  if (!leavingEl) {
    // Build once more and lay out, then reselect
    this._ensureSlices(stage, this._ids);
    this._layoutDiagonal(this._ids);
    leavingEl = stage.querySelector(`.mg-ini-slice[data-actor-id="${leavingId}"]`);
    if (!leavingEl) {
      ui.notifications?.warn("No actors in Initiative to advance.");
      return;
    }
  }

    // 1) trigger others to shift forward (re-layout for positions 1..end -> 0..end-1)
    const shifted = ids.slice(1);
    this._layoutDiagonal(shifted); // everyone animates via CSS transition

    // 2) leaving: slide left & fade
    leavingEl.classList.add("is-leaving");
    await this._afterTransition(leavingEl).catch(() => {});

    // 3) move leaving to end; set it just below its final slot, then animate up into place
    leavingEl.classList.remove("is-leaving");
    stage.appendChild(leavingEl);

    const newOrder = [...shifted, leavingId];
    this._ids = newOrder;

    // place it just below last slot, invisible
    const positions = this._diagPositions(newOrder.length);
    const lastPos = positions[positions.length - 1];
    // start slightly below and transparent
    leavingEl.style.transition = "none";
    this._applySlicePos(leavingEl, lastPos, false);
    leavingEl.style.transform = `translate(var(--x), calc(var(--y) + 36px)) skew(var(--sk))`;
    leavingEl.style.opacity = "0";

    // next frame → animate up into place
    void leavingEl.offsetHeight; // reflow
    leavingEl.style.transition = ""; // restore CSS transitions
    leavingEl.style.transform = `translate(var(--x), var(--y)) skew(var(--sk))`;
    leavingEl.style.opacity = "1";

    await this._afterTransition(leavingEl).catch(() => {});
    // Refresh full layout (also updates header name + featured class)
    this._layoutDiagonal(this._ids);

    // Persist the new actor-ID order to Crew flag if available
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
      // Build & layout once more if the node isn't there yet
      this._ensureSlices(stage, this._ids);
      this._layoutDiagonal(this._ids);
      leavingEl = stage.querySelector(`.mg-ini-slice[data-actor-id="${leavingId}"]`);
      if (!leavingEl) {
        ui.notifications?.warn("No actors in Initiative to advance.");
        return;
      }
    }

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

    // place just below and invisible
    leavingEl.style.transition = "none";
    this._applySlicePos(leavingEl, lastPos, false);
    leavingEl.style.transform = `translate(var(--x), calc(var(--y) + 36px)) skewX(var(--skX))`;
    leavingEl.style.opacity = "0";

    // next frame -> animate into place
    void leavingEl.offsetHeight;
    leavingEl.style.transition = "";
    leavingEl.style.transform = `translate(var(--x), var(--y)) skewX(var(--skX))`;
    leavingEl.style.opacity = "1";

    await this._afterTransition(leavingEl).catch(() => {});

    // refresh full layout (also updates header name + featured class)
    this._layoutDiagonal(this._ids);

    // persist new order to Crew flag (actor IDs)
    await this._persistCurrentOrder();
  }


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

// Mini CSS injection (fallback if SCSS not yet compiled)
Hooks.once("ready", () => {
  const css = document.createElement("style");
  css.textContent = `
  /* Stage box size – matches your mock proportions */
  .mg-initiative.mg-ini--diag {
    position: fixed;
    z-index: 10000;
    pointer-events: auto;
    width: 920px;
    height: 560px;              /* a bit taller gives breathing room */
    background: #122236cc;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,.08);
    box-shadow: 0 10px 24px rgba(0,0,0,.35);
    padding: 10px 10px 12px;
  }

  /* Optional diagonal dash lane */
  .mg-ini-lane {
    position: absolute;
    left: 472px; top: 18px; bottom: 18px; width: 10px;
    background-image: linear-gradient(#7da3d2 0 0);
    background-size: 10px 16px;
    background-repeat: repeat-y;
    opacity: .35;
    transform: skewX(-22deg);
    border-radius: 3px;
    pointer-events: none;
  }

  /* The angled portrait slice (now tall) */
  .mg-ini-slice {
    position: absolute;
    width: var(--w, 200px);
    height: var(--h, 181px);
    transform: translate(var(--x, 0px), var(--y, 0px)) skewX(var(--skX, -22deg));
    transform-origin: top left;
    border-radius: 12px;
    border: 5px solid rgba(255,255,255,.95);      /* thicker white like mock */
    box-shadow: 0 12px 28px rgba(0,0,0,.40);
    overflow: hidden;
    padding: 0;
    background: #0f1c2b;
    transition: transform .28s ease, opacity .28s ease, box-shadow .2s ease, filter .2s ease;
  }

  /* Unskew the image so it reads upright */
  .mg-ini-slice .img {
    position: absolute; inset: -6px;              /* bleed to hide skew gaps behind border */
    background-size: cover; background-position: center;
    transform: skewX(calc(-1 * var(--skX, -22deg))) scale(1.03);
    transform-origin: top left;
  }

  /* Featured glow */
  .mg-ini-slice.is-featured {
    box-shadow: 0 0 0 4px rgba(87,162,255,.85) inset, 0 18px 44px rgba(0,0,0,.5);
  }

  /* Leave/enter cues for advance */
  .mg-ini-slice.is-leaving {
    transform: translate(calc(var(--x) - 140px), var(--y)) skewX(var(--skX));
    opacity: 0;
  }

  `;
  document.head.appendChild(css);
});
