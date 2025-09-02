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
  // We do NOT use Application's render/template; we mount our own DOM.
  showBar() { this._ensureAttached(); }
  hideBar() { this._detach(); }
  toggleBar() { (this._attached ? this.hideBar() : this.showBar()); }

  // (Optional safety) NOP out Application.render so nothing upstream tries to template-render us.
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
    const activeId = this._getActiveId(ids);

    const wrap = document.createElement("div");
    wrap.className = "mg-initiative";
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Initiative Order");

    // header / drag handle
    wrap.innerHTML = `
      <div class="mg-ini-header" data-drag-handle>
        <span class="mg-ini-title"><i class="fa-solid fa-flag-checkered"></i> Initiative</span>
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
      <div class="mg-ini-row" aria-live="polite"></div>
    `;
    


    const row = wrap.querySelector(".mg-ini-row");
    ids.forEach((id) => {
      const actor = game.actors.get(id);
      if (!actor) return;
      const isActive = id === activeId;

      const el = document.createElement("button");
      el.type = "button";
      el.className = "mg-ini-slot" + (isActive ? " is-active" : "");
      el.dataset.actorId = id;
      el.title = `${actor.name} — End Turn`;
      el.innerHTML = `
        <div class="mg-ini-portrait" style="background-image:url('${actor.img}');"></div>
        <span class="mg-ini-name">${actor.name}</span>
      `;
      row.appendChild(el);
    });

    wrap.querySelector(".mg-ini-next").addEventListener("click", () => {
      const first = wrap.querySelector(".mg-ini-slot");
      if (!first) {
        ui.notifications?.warn("No actors in Initiative to advance.");
        return;
      }
      this._endTurn();
    });

    // Drag move
    wrap.querySelector("[data-drag-handle]").addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return; // only left-click
      // If the pointerdown is on any interactive control, don't start a drag
      if (ev.target.closest(".mg-ini-actions, .mg-ini-btn, button, a, input, select, textarea")) return;
      this._onDragStart(ev, wrap);
    });


    return wrap;
  }

  /** Bind all UI events via delegation on the root node */
  _bindRootEvents() {
    if (!this._root) return;

    // Stop clicks inside from bubbling to the canvas
    this._root.addEventListener("click", (ev) => ev.stopPropagation());
    this._root.addEventListener("contextmenu", (ev) => ev.stopPropagation());

    // Header buttons (close / reset / next)
    this._root.addEventListener("click", (ev) => {
      const close = ev.target.closest(".mg-ini-close");
      if (close) { ev.preventDefault(); this.hideBar(); return; }

      const reset = ev.target.closest(".mg-ini-reset");
      if (reset) { ev.preventDefault(); this._resetOrder(); return; }

      const next = ev.target.closest(".mg-ini-next");
      if (next) {
        ev.preventDefault();
        const first = this._root.querySelector(".mg-ini-slot");
        if (!first) { ui.notifications?.warn("No actors in Initiative to advance."); return; }
        this._endTurn();
        return;
      }
    });

    // Click a portrait -> select token (does NOT end turn)
    this._root.addEventListener("click", (ev) => {
      const slot = ev.target.closest(".mg-ini-slot");
      if (!slot) return;
      const actor = game.actors.get(slot.dataset.actorId);
      const token = canvas.tokens.placeables.find(t => t.actor?.id === actor?.id);
      if (token) token.control({ releaseOthers: true });
    });
  }


  /** Active is simply the first element in the order array */
  _getActiveId(ids) { return ids[0] || null; }

  /** Animate current to end */
  async _endTurn() {
    const row = this._root?.querySelector(".mg-ini-row");
    if (!row) return;

    const slot = row.querySelector(".mg-ini-slot");
    if (!slot) return;

    // 1) LEAVE: slide down & fade
    slot.classList.add("is-leaving");
    await this._afterTransition(slot).catch(() => {});

    // 2) Move to end
    slot.classList.remove("is-leaving");
    row.appendChild(slot);

    // 3) ENTER: spawn at slight offset above, then settle
    slot.classList.add("is-entering");
    slot.style.transform = "translateY(-18px)";
    slot.style.opacity = "0";
    // next frame → animate in
    requestAnimationFrame(() => {
      slot.style.transform = "translateY(0)";
      slot.style.opacity = "1";
    });
    await this._afterTransition(slot).catch(() => {});
    slot.classList.remove("is-entering");
    slot.style.transform = "";
    slot.style.opacity = "";

    // Persist & mark first
    await this._persistCurrentOrder();
    this._markActiveFirst();
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

  _markActiveFirst() {
    const slots = [...this._root.querySelectorAll(".mg-ini-slot")];
    slots.forEach(s => s.classList.remove("is-active"));
    if (slots[0]) slots[0].classList.add("is-active");
  }

  _currentIdsFromDOM() {
    return [...this._root.querySelectorAll(".mg-ini-slot")].map(s => s.dataset.actorId);
  }

  async _persistCurrentOrder() {
    const crewId = game.settings.get("midnight-gambit", "crewActorId");
    const crew   = crewId ? game.actors.get(crewId) : null;
    if (!crew) return;
    const ids = this._currentIdsFromDOM();
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
  .mg-initiative {
    position: fixed;
    z-index: 32;
    pointer-events: auto;
  }
  .mg-ini-header {
    display:flex; align-items:center; justify-content:space-between;
    padding: 4px 6px 8px; cursor: move;
  }
  .mg-ini-title { font-weight: 700; letter-spacing:.3px; }
  .mg-ini-actions .mg-ini-btn {
    background: transparent; border: 0; cursor: pointer; padding: 4px 6px; border-radius: 8px;
  }
  .mg-ini-actions .mg-ini-btn:hover { background: rgba(255,255,255,.06); }
  .mg-ini-row {
    display:flex; gap: 10px; padding: 6px; overflow-x: auto; scrollbar-width: thin;
  }
  .mg-ini-slot {
    display:flex; align-items:center; gap: 10px;
    background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 12px; padding: 6px 10px;
    transition: transform .25s ease, opacity .25s ease, box-shadow .2s ease;
    will-change: transform, opacity;
    cursor: default; /* portraits no longer advance turns */
  }
  .mg-ini-slot.is-active {
    box-shadow: 0 0 0 2px var(--mg-blue, #57A2FF) inset, 0 0 18px rgba(87,162,255,.25);
  }
  .mg-ini-slot.is-leaving { transform: translateY(18px); opacity: 0; }
  .mg-ini-slot.is-entering { /* initial inline styles set in JS; class is just a hook if you want extra styling */ }

  .mg-ini-portrait {
    width: 36px; height: 36px; border-radius: 999px; background-size: cover; background-position: center;
    border: 1px solid rgba(255,255,255,.15); box-shadow: 0 2px 6px rgba(0,0,0,.35) inset;
  }
  .mg-ini-name { font-size: .9rem; max-width: 160px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; }
  .mg-ini-badge {
    margin-left: 2px; font-size: .7rem; padding: 2px 6px; border-radius: 10px;
    background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.1);
  }
  `;
  document.head.appendChild(css);
});
