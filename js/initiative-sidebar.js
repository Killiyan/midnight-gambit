// systems/midnight-gambit/js/initiative-sidebar.js
import { MGInitiativeController } from "./initiative-controller.js";

const MG_NS = "midnight-gambit";
const END_ID = "__MG_END__";
const VISIBLE_SLOTS = 5;

function mgEscapeHTML(input) {
  const s = String(input ?? "");
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export class MGInitiativeSidebar {
  static #instance;
  static get instance() {
    if (!this.#instance) this.#instance = new MGInitiativeSidebar();
    return this.#instance;
  }

  constructor() {
    this._mounted = false;
    this._unsub = null;
    this._raf = null;
    this._lastSyncId = null;

    this._ids = [];
    this._activeIndex = 0; // includes END slot
    this._animating = false;

    this._bound = false;
  }

  // -----------------------------
  // Mount / Unmount
  // -----------------------------
  async mount() {
    if (this._mounted) return;

    MGInitiativeController.instance.activate();

    const host = document.getElementById("ui") || document.body;

    let root = document.getElementById("mg-initiative-sidebar");
    if (!root) {
      root = document.createElement("section");
      root.id = "mg-initiative-sidebar";
      root.classList.add("mg-ini-side");
      host.appendChild(root);
    }

    this._mounted = true;
    this._updateDockOffset();

    if (!this._unsub) {
      this._unsub = MGInitiativeController.instance.subscribe((evt) => this._onEvt(evt));
    }

    // initial fill
    this._syncFromSource();
    this._renderShell();
    this._paintSlots();
  }

  async unmount() {
    this._mounted = false;
    const root = document.getElementById("mg-initiative-sidebar");
    if (root) root.remove();

    if (this._unsub) {
      this._unsub();
      this._unsub = null;
    }
  }

  // -----------------------------
  // Docking
  // -----------------------------
  _updateDockOffset() {
    const root = document.getElementById("mg-initiative-sidebar");
    if (!root) return;

    const sidebar = document.getElementById("sidebar");
    const w = sidebar?.getBoundingClientRect?.().width ?? 300;

    document.documentElement.style.setProperty("--sidebar-offset-right", `${w}px`);

    root.style.position = "fixed";
    root.style.bottom = "5px";
    root.style.right = `${w}px`;
    root.style.height = "auto";
    root.style.width = "250px"; // tweak later
    root.style.zIndex = "1";
    root.style.pointerEvents = "auto";
  }

  // -----------------------------
  // Source-of-truth -> local state
  // -----------------------------
  _getFullTrackIds() {
    // Use controller roster (Crew/flags). END is appended locally.
    const ids = MGInitiativeController.instance.getOrderActorIds();
    return Array.isArray(ids) ? ids.filter(id => !!game.actors.get(id)) : [];
  }

  _syncFromSource() {
    const ids = this._getFullTrackIds();
    this._ids = ids;

    // activeIndex (0..n where n is END)
    const ai = MGInitiativeController.instance.getActiveIndex(ids);
    this._activeIndex = Number.isFinite(ai) ? ai : 0;
  }

  _trackLength() {
    // combatants + END
    return Math.max(1, this._ids.length + 1);
  }

  _isEndActive() {
    return this._activeIndex === this._ids.length;
  }

  _idAtTrackIndex(trackIndex) {
    // trackIndex: 0..n where n == END
    if (trackIndex === this._ids.length) return END_ID;
    return this._ids[trackIndex] ?? null;
  }

  _windowIds() {
    // Return the 5 combatant ids starting at activeIndex,
    // BUT when END is active, we still show the next 5 combatants window starting at 0 (or keep last window).
    // For now: if END is active, show the top 5 starting at 0.
    const n = this._ids.length;
    if (!n) return Array(VISIBLE_SLOTS).fill(null);

    const L = this._trackLength();
    const start = this._activeIndex;

    const out = [];
    for (let i = 0; i < VISIBLE_SLOTS; i++) {
      // We only want combatants in the 5 slots, not END.
      const idx = (start + i) % L;
      const id = (idx === n) ? END_ID : this._ids[idx];
      out.push(id ?? null);
    }
    return out;
  }

  // -----------------------------
  // Render
  // -----------------------------
  _renderShell() {
    const root = document.getElementById("mg-initiative-sidebar");
    if (!root) return;

    const collapsed = !!game.settings.get(MG_NS, "initiativeSidebarCollapsed");
    root.classList.toggle("is-collapsed", collapsed);

    // Build once
    root.innerHTML = `
      <div class="mg-ini-side-wrap">
        <button type="button" class="mg-ini-side-handle" data-action="toggle" title="${collapsed ? "Show" : "Hide"}">
          <i class="fa-solid ${collapsed ? "fa-swords" : "fa-chevron-right"}"></i>
        </button>

        <header class="mg-ini-side-head">
          <div class="mg-ini-side-controls">
            <button type="button" class="mg-ini-side-btn" data-action="reset" title="Reset">
              <i class="fa-solid fa-rotate-left"></i>
            </button>
            <button type="button" class="mg-ini-side-btn" data-action="next" title="Next">
              <i class="fa-solid fa-forward-step"></i>
            </button>
          </div>

          <div class="mg-ini-side-title">
            <div class="mg-ini-side-sub">The spotlight's on</div>
            <div class="mg-ini-side-nextname" data-role="nextname">—</div>
          </div>
        </header>

        <div class="mg-ini-side-stack" data-role="stack">
          ${Array.from({ length: VISIBLE_SLOTS }).map((_, i) => `
            <div class="mg-ini-side-slot slot-${i}" data-slot="${i}">
              <div class="mg-ini-slice">
                <div class="mg-ini-side-card">
                  <div class="mg-ini-side-card-img"><img src="" alt=""></div>
                  <div class="mg-ini-side-card-name"></div>
                </div>
              </div>
            </div>
          `).join("")}
        </div>


      </div>
    `;

    this._bind(root);
  }

  _paintCard(cardEl, id) {
    if (!cardEl) return;

    const img = cardEl.querySelector(".mg-ini-side-card-img img");
    const name = cardEl.querySelector(".mg-ini-side-card-name");

    if (id === END_ID) {
      // END should be text-only (no clock art)
      if (img) img.src = "";                 // clear image
      if (name) name.textContent = "END";    // label
      cardEl.classList.add("is-end");
      return;
    }

    cardEl.classList.remove("is-end");

    if (!id) {
      if (img) img.src = "";
      if (name) name.textContent = "";
      return;
    }

    const a = game.actors.get(id);
    if (img) img.src = a?.img ?? "icons/svg/mystery-man.svg";
    if (name) name.textContent = a?.name ?? "—";
  }

  _paintSlots(windowIdsOverride = null) {
    const root = document.getElementById("mg-initiative-sidebar");
    if (!root) return;

    const collapsed = !!game.settings.get(MG_NS, "initiativeSidebarCollapsed");
    root.classList.toggle("is-collapsed", collapsed);

    const handle = root.querySelector(".mg-ini-side-handle");
    if (handle) {
      handle.title = collapsed ? "Show" : "Hide";
      const icon = handle.querySelector("i");
      if (icon) {
        icon.classList.toggle("fa-swords", collapsed);
        icon.classList.toggle("fa-chevron-right", !collapsed);
      }
    }

    // Use override window ids if provided (important for animation)
    const windowIds = Array.isArray(windowIdsOverride) ? windowIdsOverride : this._windowIds();

    // next name
    const nextNameEl = root.querySelector('[data-role="nextname"]');
    const topId = windowIds[0];
    const topActor = topId ? game.actors.get(topId) : null;
    if (nextNameEl) nextNameEl.textContent = topActor?.name ?? (this._isEndActive() ? "End of Round" : "—");

    // paint slots content only
    windowIds.forEach((id, slotIdx) => {
      const slot = root.querySelector(`.mg-ini-side-slot[data-slot="${slotIdx}"]`);
      if (!slot) return;

      // IMPORTANT: do not touch is-leaving / is-shifting / is-entering here
      // Only update is-empty and dataset + content.
      const img = slot.querySelector(".mg-ini-side-card-img img");
      const name = slot.querySelector(".mg-ini-side-card-name");
      const card = slot.querySelector(".mg-ini-side-card");

      // ALWAYS normalize is-end on the slice (fixes “sticky END”)
      const slice = slot.querySelector(".mg-ini-slice");
      if (slice) slice.classList.toggle("is-end", id === END_ID);  

      if (id === END_ID) {
        slot.classList.remove("is-empty");
        slot.dataset.actorId = END_ID;

        if (img) img.src = "";               // no clock
        if (name) name.textContent = "END";
        if (card) card.removeAttribute("aria-hidden");

        // tag the slice so CSS can style it
        const slice = slot.querySelector(".mg-ini-slice");
        if (slice) slice.classList.add("is-end");
        return;
      }


      if (!id) {
        slot.classList.add("is-empty");
        slot.dataset.actorId = "";
        if (img) img.src = "";
        if (name) name.textContent = "";
        if (card) card.setAttribute("aria-hidden", "true");
        return;
      }

      const a = game.actors.get(id);
      slot.classList.remove("is-empty");
      slot.dataset.actorId = id;

      if (img) img.src = a?.img ?? "icons/svg/mystery-man.svg";
      if (name) name.textContent = a?.name ?? "—";
      if (card) card.removeAttribute("aria-hidden");
    });

    // END ghost active
    const end = root.querySelector('[data-role="end"]');
    if (end) end.classList.toggle("is-active", this._isEndActive());
  }

  // -----------------------------
  // Animation: advance one step
  // -----------------------------
  async _animateAdvance() {
    if (this._animating) return;
    this._animating = true;

    const root = document.getElementById("mg-initiative-sidebar");
    if (!root) { this._animating = false; return; }

    const slots = Array.from(root.querySelectorAll(".mg-ini-side-slot"));
    if (slots.length !== VISIBLE_SLOTS) { this._animating = false; return; }

    // Ensure each slot has a card element (should from _renderShell)
    const cards = slots.map(s => s.querySelector(".mg-ini-slice"));
    if (cards.some(c => !c)) { this._animating = false; return; }

    // Freeze IDs currently displayed (so our comparisons are stable)
    const currentWindow = this._windowIds();

    // Set slot empty states based on currentWindow (no content repaint here)
    currentWindow.forEach((id, i) => {
      slots[i].classList.toggle("is-empty", !id);
      slots[i].dataset.actorId = id ?? "";
    });

    // 1) Animate ONLY the top card leaving (on the CARD element, not the slot)
    const leavingCard = cards[0];

    // Force transition inline (Forge/CSS flakiness insurance)
    leavingCard.style.willChange = "translate, opacity";
    leavingCard.style.transition = "translate 280ms ease, opacity 280ms ease";

    // Start from normal
    leavingCard.style.translate = "0px 0px";
    leavingCard.style.opacity = "1";
    void leavingCard.offsetWidth;

    // Animate out (left)
    leavingCard.style.translate = "-48px 0px";
    leavingCard.style.opacity = "0";

    const TRANS_MS = 260;
    await new Promise(r => setTimeout(r, TRANS_MS));

    // Reset leaving card visuals immediately (we'll reuse it)
    leavingCard.style.transition = "none";
    leavingCard.style.translate = "0px 0px";
    leavingCard.style.opacity = "1";
    void leavingCard.offsetWidth;

    // 2) Advance state
    const L = this._trackLength();
    this._activeIndex = (this._activeIndex + 1) % L;
    this._ids = this._getFullTrackIds();

    const nextWindow = this._windowIds();

    // Update "Up next" label from nextWindow[0]
    const nextNameEl = root.querySelector('[data-role="nextname"]');
    const topId = nextWindow[0];
    const topActor = topId && topId !== END_ID ? game.actors.get(topId) : null;
    if (nextNameEl) nextNameEl.textContent = topActor?.name ?? (topId === END_ID ? "End of Round" : "—");

    // 3) FLIP-like slide: move existing card DOM nodes up one slot
    // IMPORTANT: remove leavingCard so slot-0 doesn't temporarily contain two cards.
    leavingCard.remove();

    // Grab references to the cards that will move (slot1..slot4)
    const movingCards = cards.slice(1); // length 4

    // Measure "from" rects before we move them
    const fromRects = movingCards.map(c => c.getBoundingClientRect());

    // Move them: slot1->slot0, slot2->slot1, slot3->slot2, slot4->slot3
    for (let i = 0; i < VISIBLE_SLOTS - 1; i++) {
      slots[i].appendChild(movingCards[i]);
    }

    // Invert: set transform so they appear where they came from
    for (let i = 0; i < VISIBLE_SLOTS - 1; i++) {
      const movedCard = movingCards[i];
      const toRect = movedCard.getBoundingClientRect();
      const fromRect = fromRects[i];

      const dx = fromRect.left - toRect.left;
      const dy = fromRect.top - toRect.top;

      movedCard.style.willChange = "translate";
      movedCard.style.transition = "none";
      movedCard.style.translate = `${dx}px ${dy}px`;
    }

    // Play: animate transform back to normal
    await new Promise(r => requestAnimationFrame(r));
    for (let i = 0; i < VISIBLE_SLOTS - 1; i++) {
      const movedCard = movingCards[i];
      movedCard.style.transition = "translate 280ms ease";
      movedCard.style.translate = "0px 0px";
    }

    // 4) Slot-4: reuse the leavingCard as the new bottom card and slide it IN from left
    const bottomSlot = slots[VISIBLE_SLOTS - 1];
    bottomSlot.appendChild(leavingCard);

    const bottomId = nextWindow[VISIBLE_SLOTS - 1];
    this._paintCard(leavingCard, bottomId);

    // Set empty state based on bottomId
    bottomSlot.classList.toggle("is-empty", !bottomId);
    bottomSlot.dataset.actorId = bottomId ?? "";

    // Enter-from-left for bottom (always when non-empty)
    if (bottomId) {
      leavingCard.style.transition = "none";
      leavingCard.style.translate = "48px 0px";   // start off to the RIGHT
      leavingCard.style.opacity = "0";
      void leavingCard.offsetWidth;

      leavingCard.style.transition = "translate 280ms ease, opacity 280ms ease";
      leavingCard.style.translate = "0px 0px";
      leavingCard.style.opacity = "1";
    }

    // 5) Cleanup transforms after animation settles
    setTimeout(() => {
      for (let i = 0; i < VISIBLE_SLOTS; i++) {
        const slice = slots[i].querySelector(".mg-ini-slice");
        if (!slice) continue;
        slice.style.willChange = "";
        slice.style.transition = "";
        slice.style.translate = "";
        slice.style.opacity = "";
      }
    }, 320);


    this._animating = false;
  }

  async _animateReset() {
    if (this._animating) return;
    this._animating = true;

    // reset local state immediately
    this._activeIndex = 0;
    this._ids = this._getFullTrackIds();
    this._paintSlots();

    this._animating = false;
  }

  // -----------------------------
  // Events
  // -----------------------------
  _onEvt(evt) {
    const syncId = evt?.payload?.syncId;
    if (syncId && this._lastSyncId === syncId) return;
    if (syncId) this._lastSyncId = syncId;

    // Keep roster up-to-date, but animate based on event type
    if (evt?.type === "progress") {
      if (this._animating) return; // ignore replicated echo
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(() => this._animateAdvance());
      return;
    }

    if (evt?.type === "reset") {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(() => this._animateReset());
      return;
    }

    if (evt?.type === "order") {
      this._syncFromSource();
      this._paintSlots();
    }
  }

  // -----------------------------
  // Interaction
  // -----------------------------
  _bind(root) {
    if (this._bound) return;
    this._bound = true;

    root.addEventListener("click", async (ev) => {
      const btn = ev.target.closest("[data-action]");
      if (!btn) return;

      ev.preventDefault();
      ev.stopPropagation();

      const action = btn.dataset.action;

      if (action === "toggle") {
        const next = !game.settings.get(MG_NS, "initiativeSidebarCollapsed");
        await game.settings.set(MG_NS, "initiativeSidebarCollapsed", next);
        root.classList.toggle("is-collapsed", next);
        // update icon/title
        this._paintSlots();
        return;
      }

      if (this._animating) return;

      if (action === "next") {
        // Optimistic local animation + replicated truth
        this._animateAdvance().catch(console.error);
        MGInitiativeController.instance.advance().catch(console.error);
        return;
      }

      if (action === "reset") {
        this._animateReset().catch(console.error);
        MGInitiativeController.instance.reset().catch(console.error);
      }
    }, { passive: false });
  }
}
