// systems/midnight-gambit/initiative-bar.js
// Frameless Initiative overlay for Midnight Gambit.

const MAX_VISIBLE = 5;
// Virtual "actor" used for the END slot
const END_ID = "__MG_END__";
const LEAVE_PX = 140;           // how far a leaving card slides left

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

    // window starts at 0 when you open it
    this._vOffset = 0;

    const stage = this._root.querySelector(".mg-ini-diag-stage");
    this._ensureSlices(stage, this._ids);   // create ALL actor nodes

    this._layoutDiagonal(this._ids);        // lay out window using _vOffset
    this._autosizeFrame();                  // lock size to window (no jiggle)
  }


  /** Internal state */
  _attached = false;
  _attached = false;
  _root = null;
  _ids = [];
  _sizeLocked = false;
  _vOffset = 0;
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

  // Smoothly animate the END cap using absolute pixel transforms
  _animateEndTo(el, p) {
    // Build absolute transform string (avoid CSS var reliance)
    const nextT = `translate(${p.x}px, ${p.y}px) skewX(${p.sk}deg)`;

    // Read previous transform (from dataset if we have it; else computed)
    const cs = getComputedStyle(el);
    const prevT = el.dataset.prevT || cs.transform || "none";
    const prevOpacity = cs.opacity || "1";

    // If transform actually changes, animate it
    if (prevT !== nextT) {
      try {
        el.animate(
          [{ transform: prevT, opacity: prevOpacity }, { transform: nextT, opacity: "1" }],
          { duration: 280, easing: "ease", fill: "forwards" }
        );
      } catch (_) {
        // Fallback: just set instantly if WAAPI isn't available
        el.style.transform = nextT;
        el.style.opacity = "1";
      }
    }

    // Set the final state and remember it
    el.style.transform = nextT;
    el.style.opacity = "1";
    el.dataset.prevT = nextT;
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

    // For END: animate using absolute transform so it always glides
    if (el?.dataset?.actorId === END_ID) {
      this._animateEndTo(el, p);
    } else {
      // Everyone else continues to use CSS var–driven transform
      // (Leave your existing var assignments above as-is)
    }    

    // END: mirror transform inline so var updates are guaranteed to animate
    if (el?.dataset?.actorId === END_ID) {
      el.style.transform = `translate(var(--x), var(--y)) skewX(var(--skX))`;
    }
  }

  // Advance one step with fully-synced anims.
  // If entrant === leaver, use a temporary ghost to do the left-slide
  // while the real card rises from below into the last slot.
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

    // Prep list to await transitions
    const toAnimate = [];

    // --- ENTRANT PREP ---
    // Case A: entrant is a *different* element → standard rise from below
    if (!entrantIsLeaver && entrantEl) {
      this._applySlicePos(entrantEl, slotsAfter[winCount - 1], false);
      entrantEl.style.visibility = "";
      entrantEl.style.transition = "none";
      entrantEl.style.transform  = `translate(var(--x), calc(var(--y) + 36px)) skewX(var(--skX))`;
      entrantEl.style.opacity    = "0";
      toAnimate.push(entrantEl);
    }

    // Case B: entrant === leaver
    // We will:
    //  1) Clone a GHOST of the leaver to perform the left-slide+fade.
    //  2) Turn the *real* leaver into the entrant (prep below + opacity 0).
    let ghost = null;
    if (entrantIsLeaver) {
      // 1) Ghost for the left-slide
      ghost = leavingEl.cloneNode(true);
      ghost.setAttribute("data-ghost", "1");
      ghost.style.pointerEvents = "none";
      ghost.style.visibility = "";          // visible ghost
      // ensure it starts from the current var-driven pose (no inline overrides)
      ghost.style.removeProperty("transform");
      ghost.style.removeProperty("opacity");
      stage.appendChild(ghost);

      // 2) Real node becomes entrant, prepped below last slot
      const lastPos = slotsAfter[winCount - 1];
      this._applySlicePos(leavingEl, lastPos, false);
      leavingEl.style.visibility = "";
      leavingEl.style.transition = "none";
      leavingEl.style.transform  = `translate(var(--x), calc(var(--y) + 36px)) skewX(var(--skX))`;
      leavingEl.style.opacity    = "0";
      toAnimate.push(leavingEl);
    }

    // --- SHIFTERS (middle cards) ---
    for (let j = 1; j < windowBefore.length; j++) {
      const id = windowBefore[j];
      const el = stage.querySelector(`.mg-ini-slice[data-actor-id="${id}"]`);
      if (!el) continue;
      const p = slotsAfter[j - 1];
      this._applySlicePos(el, p, (j - 1 === 0) && id !== END_ID);
      el.style.visibility = "";
      toAnimate.push(el);
    }

    // Update header immediately
    const nextId = windowAfter[0];
    const nm = game.actors.get(nextId ?? "")?.name ?? (nextId === END_ID ? "End of Round" : "—");
    const tgt = this._root?.querySelector("[data-next-name]");
    if (tgt) tgt.textContent = nm;

    // Sync flip
    await this._nextFrame();

    // --- LEAVE ANIMATION ---
    if (entrantIsLeaver && ghost) {
      // Ghost slides-left + fade via class (uses your .is-leaving CSS)
      // Add class *now* so it transitions from current pose → left/out
      ghost.classList.add("is-leaving");
      toAnimate.push(ghost);
    } else if (leavingEl) {
      // Standard: real leaver slides-left + fades (inline so it never gets blocked)
      leavingEl.style.transform = `translate(calc(var(--x) - 140px), var(--y)) skewX(var(--skX))`;
      leavingEl.style.opacity   = "0";
    }

    // --- ENTRANT RISE ---
    if (!entrantIsLeaver && entrantEl) {
      entrantEl.style.transition = "";
      entrantEl.style.transform  = `translate(var(--x), var(--y)) skewX(var(--skX))`;
      entrantEl.style.opacity    = "1";
    } else if (entrantIsLeaver) {
      // Real node (leavingEl repurposed) rises into last slot
      leavingEl.style.transition = "";
      leavingEl.style.transform  = `translate(var(--x), var(--y)) skewX(var(--skX))`;
      leavingEl.style.opacity    = "1";
    }

    // Await all transitions (ghost + entrant + shifters together)
    try {
      await Promise.all(toAnimate.map((el) => this._afterTransition(el)));
    } catch (_) {}

    // Cleanup ghost
    if (ghost && ghost.parentElement === stage) stage.removeChild(ghost);

    // Cleanup entrant inline overrides
    if (!entrantIsLeaver && entrantEl) {
      entrantEl.style.removeProperty("opacity");
      if (entrantEl.dataset.actorId !== END_ID) {
        entrantEl.style.removeProperty("transform");
        entrantEl.style.removeProperty("transition");
      }
    } else if (entrantIsLeaver) {
      leavingEl.style.removeProperty("opacity");
      if (leavingEl.dataset.actorId !== END_ID) {
        leavingEl.style.removeProperty("transform");
        leavingEl.style.removeProperty("transition");
      }
    }

    // Commit offset & reconcile layout (puts everything exactly where it belongs)
    this._vOffset = vOffsetAfter;
    this._layoutDiagonal(this._ids);
    if (typeof this._autosizeFrame === "function") this._autosizeFrame();

    try { if (typeof this._persistCurrentOrder === "function") await this._persistCurrentOrder(); } catch (_) {}
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


  /** Reset to Crew order and relayout without closing */
  async _resetOrder() {
    this._ids = this.getOrderActorIds();
    this._vOffset = 0; // restart the window at the beginning
    if (!this._attached) return;

    const stage = this._root?.querySelector(".mg-ini-diag-stage");
    if (!stage) return;

    this._ensureSlices(stage, this._ids);
    this._layoutDiagonal(this._ids);
    // size stays locked
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
    this._attached = true;
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

  /** Live sync: when Crew changes its initiative flag/system, refresh in place */
  _wireLiveRefresh() {
    if (this._wired) return;
    this._wired = true;

    Hooks.on("updateActor", (actor, changed) => {
      const crew = this._resolveCrewActor();
      if (!crew || actor.id !== crew.id) return;

      const touchedFlag   = getProperty(changed, "flags.midnight-gambit.initiativeOrder");
      const touchedSystem = getProperty(changed, "system.initiative.order");
      if (!touchedFlag && !touchedSystem) return;

      // Pull fresh order and relayout
      this._ids = this.getOrderActorIds();
      if (!this._attached) return;
      const stage = this._root?.querySelector(".mg-ini-diag-stage");
      if (!stage) return;
      const visible = this._ids.slice(0, Math.min(this._ids.length, MAX_VISIBLE));
      this._ensureSlices(stage, visible);
      this._layoutDiagonal(this._ids);
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

