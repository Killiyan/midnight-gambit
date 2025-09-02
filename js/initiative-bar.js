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
  showBar() { this.render(true); this._ensureAttached(); }
  hideBar() { this._detach(); }
  toggleBar() { (this._attached ? this.hideBar() : this.showBar()); }

  /** Internal state */
  _attached = false;
  _drag = { active: false, dx: 0, dy: 0 };

  /** Try Crew flag first, else fallback to player characters */
  getOrderActorIds() {
    // Expect a Crew Actor id in a system setting, then a flag array for order
    const crewId = game.settings.get("midnight-gambit", "crewActorId") || null;
    const crew   = crewId ? game.actors.get(crewId) : null;
    const fromFlag = crew?.getFlag("midnight-gambit", "initiativeOrder");
    if (Array.isArray(fromFlag) && fromFlag.length) return fromFlag.filter(id => game.actors.get(id));

    // Fallback: all player-controlled character actors (owned or playerOwner)
    return game.actors
      .filter(a => a.type === "character" && (a.isOwner || Object.values(a.ownership || {}).some(x => x >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)))
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
          <button class="mg-ini-btn mg-ini-reset" title="Reset to start"><i class="fa-solid fa-rotate-left"></i></button>
          <button class="mg-ini-btn mg-ini-close" title="Close"><i class="fa-solid fa-xmark"></i></button>
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
      el.className = "mg-ini-slot" + (isActive ? " is-active" : "");
      el.dataset.actorId = id;
      el.title = `${actor.name} — End Turn`;
      el.innerHTML = `
        <div class="mg-ini-portrait" style="background-image:url('${actor.img}');"></div>
        <span class="mg-ini-name">${actor.name}</span>
        <span class="mg-ini-badge" aria-hidden="true">End</span>
      `;
      row.appendChild(el);
    });

    // Drag move
    wrap.querySelector("[data-drag-handle]").addEventListener("pointerdown", (ev) => this._onDragStart(ev, wrap));
    // Close / Reset
    wrap.querySelector(".mg-ini-close").addEventListener("click", () => this.hideBar());
    wrap.querySelector(".mg-ini-reset").addEventListener("click", () => this._resetOrder());
    // End Turn clicks
    row.addEventListener("click", (ev) => {
      const slot = ev.target.closest(".mg-ini-slot");
      if (slot) this._endTurn(slot);
    });

    return wrap;
  }

  /** Active is simply the first element in the order array */
  _getActiveId(ids) { return ids[0] || null; }

  /** Animate current to end */
  async _endTurn(slot) {
    // Only allow if clicked active or GM; clicking non-active still advances (keeps table fast)
    const row = this._root.querySelector(".mg-ini-row");
    if (!row) return;

    slot.classList.add("is-leaving");
    // Wait for CSS transition to complete
    const done = new Promise((res) => slot.addEventListener("transitionend", res, { once: true }));
    // Kick the transition
    requestAnimationFrame(() => slot.style.transform = "translateX(32px) scale(0.9)");
    await done.catch(() => {});

    // Move to end
    slot.classList.remove("is-active", "is-leaving");
    slot.style.transform = "";
    row.appendChild(slot);

    // Update Crew flag order if available
    this._persistCurrentOrder();
    // Re-mark first as active
    this._markActiveFirst();
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
    position: absolute; z-index: 75;
    min-width: 420px; max-width: 80vw;
    background: var(--mg-panel-bg, rgba(10,12,16,.75));
    backdrop-filter: blur(6px);
    border: 1px solid var(--mg-panel-br, rgba(255,255,255,.08));
    border-radius: 16px; box-shadow: 0 10px 24px rgba(0,0,0,.35);
    padding: 10px 10px 12px;
    user-select: none;
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
    transition: transform .35s ease, opacity .35s ease, box-shadow .2s ease;
    will-change: transform, opacity;
    cursor: pointer;
  }
  .mg-ini-slot.is-active {
    box-shadow: 0 0 0 2px var(--mg-blue, #57A2FF) inset, 0 0 18px rgba(87,162,255,.25);
  }
  .mg-ini-slot:is(:hover,:focus) { transform: translateY(-2px); }
  .mg-ini-slot.is-leaving { opacity: .4; }
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
