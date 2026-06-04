// systems/midnight-gambit/js/initiative-sidebar.js
import { MGInitiativeController } from "./initiative-controller.js";

const MG_NS = "midnight-gambit";
const END_ID = "__MG_END__";
const VISIBLE_SLOTS = 5;
const NAME_LEAVE_PX = 140;
const NAME_TRANS_MS = 260;

function mgEscapeHTML(input) {
  const s = String(input ?? "");
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function mgGetActorCropVariables(actor, key, fallbacks = []) {
  const crops = actor?.getFlag?.(MG_NS, "crops") || {};
  let crop = crops[key]?.css;
  for (const fallback of fallbacks) {
    if (crop) break;
    crop = crops[fallback]?.css;
  }
  if (key === "sidebarInitiative" && crop?.model !== "skewSlicePan") return "";
  if (key === "sidebarInitiativeMain" && crop?.model !== "skewSliceMainPan") return "";
  if (!crop) return "";

  const x = Number.isFinite(crop.x) ? crop.x : 50;
  const y = Number.isFinite(crop.y) ? crop.y : 50;
  const scale = Number.isFinite(crop.scale) ? crop.scale : 1;
  const width = Number.isFinite(crop.width) && crop.width > 0
    ? ` --mg-crop-w: ${crop.width}%;`
    : "";
  const height = Number.isFinite(crop.height) && crop.height > 0
    ? ` --mg-crop-h: ${crop.height}%;`
    : "";

  return `--mg-crop-x: ${x}; --mg-crop-y: ${y}; --mg-crop-scale: ${scale};${width}${height}`;
}

function mgGetActorSidebarInitiativeImage(actor, fallback = "systems/midnight-gambit/assets/images/mg-queen.png") {
  return String(actor?.getFlag?.(MG_NS, "crops")?.sidebarInitiative?.src ?? "").trim() ||
    actor?.img ||
    fallback;
}

function mgHasActorCrop(actor, key) {
  const crop = actor?.getFlag?.(MG_NS, "crops")?.[key]?.css;
  if (key === "sidebarInitiative" && crop?.model !== "skewSlicePan") return false;
  if (key === "sidebarInitiativeMain" && crop?.model !== "skewSliceMainPan") return false;
  return !!(crop && Object.keys(crop).length);
}

function mgActorCropTouched(changed) {
  const mgFlags = changed?.flags?.[MG_NS];
  return !!(mgFlags && Object.prototype.hasOwnProperty.call(mgFlags, "crops")) ||
    Object.prototype.hasOwnProperty.call(changed ?? {}, `flags.${MG_NS}.crops`) ||
    getProperty(changed, `flags.${MG_NS}.crops`) != null;
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
    this._foilEl = null;
    this._foilFadeInMs = 700;

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
    this._wireLiveActorRefresh();

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
    root.style.bottom = "10px";
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

                <!-- Hover stats (Capacity + Track) -->
                <div class="mg-ini-hoverstats" aria-hidden="true">
                  <div class="mg-ini-hs-row" data-type="mortal">
                    <span class="mg-ini-hs-pill">
                      <i class="fa-kit fa-mortal-strain"></i>
                      <span class="mg-ini-hs-track" data-field="track">0</span>
                    </span>                  
                    <span class="mg-ini-hs-pill">
                      <i class="fa-solid fa-shield"></i>
                      <span class="mg-ini-hs-cap" data-field="cap">0</span>
                    </span>
                  </div>

                  <div class="mg-ini-hs-row" data-type="soul">
                    <span class="mg-ini-hs-pill">
                      <i class="fa-kit fa-soul-strain"></i>
                      <span class="mg-ini-hs-track" data-field="track">0</span>
                    </span>                  
                    <span class="mg-ini-hs-pill">
                      <i class="fa-solid fa-shield"></i>
                      <span class="mg-ini-hs-cap" data-field="cap">0</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          `).join("")}

          <div class="mg-ini-foil" style="display:none; opacity:0;">
            <svg class="mg-ini-foil-svg" xmlns="http://www.w3.org/2000/svg">
              <rect class="mg-ini-foil__ring" x="0.5" y="0.5" width="1" height="1" rx="0" ry="0"></rect>
            </svg>
          </div>          
        </div>


      </div>
    `;

    this._bind(root);
  }

  _syncFoilToTopSlot({ reset = false, fade = false } = {}) {
    const root = document.getElementById("mg-initiative-sidebar");
    const topSlot = root?.querySelector('.mg-ini-side-slot[data-slot="0"]');
    const slice = topSlot?.querySelector(".mg-ini-side-card") || topSlot?.querySelector(".mg-ini-slice");

    const actorId = topSlot?.dataset?.actorId;
    const show = !!slice && !!actorId && actorId !== END_ID && !topSlot.classList.contains("is-empty");

    this._syncFoilToSlice(show ? slice : null, show);

    if (show && reset) this._resetFoilStroke();
    if (show && fade) this._foilFadeIn().catch(() => {});
  }  

  _ensureFoilLayer() {
    this._ensureFoilCSS();

    const root = document.getElementById("mg-initiative-sidebar");
    const stack = root?.querySelector(".mg-ini-side-stack");
    if (!stack) return null;

    let foil = stack.querySelector(":scope > .mg-ini-foil");

    if (!foil) {
      foil = document.createElement("div");
      foil.className = "mg-ini-foil";
      foil.style.display = "none";
      foil.style.opacity = "0";
      foil.innerHTML = `
        <svg class="mg-ini-foil-svg" xmlns="http://www.w3.org/2000/svg">
          <rect class="mg-ini-foil__ring" x="0.5" y="0.5" width="1" height="1" rx="0" ry="0"/>
        </svg>
      `;
      stack.appendChild(foil);
    }

    this._foilEl = foil;
    return foil;
  }

  _syncFoilToSlice(sliceEl, isFeatured) {
    const root = document.getElementById("mg-initiative-sidebar");
    const stack = root?.querySelector(".mg-ini-side-stack");
    if (!stack) return;

    const foil = this._ensureFoilLayer();
    if (!foil) return;

    if (!sliceEl || !isFeatured) {
      foil.style.display = "none";
      return;
    }

    const stackRect = stack.getBoundingClientRect();
    const sliceRect = sliceEl.getBoundingClientRect();

    const foilW = sliceEl.offsetWidth || sliceRect.width;
    const foilH = sliceEl.offsetHeight || sliceRect.height;

    const skewDeg = -20;

    // Anchor to the visible bottom-left of the slice.
    const x = sliceRect.left - stackRect.left;
    const bottomY = sliceRect.bottom - stackRect.top;
    const y = bottomY - foilH;

    foil.style.display = "";
    if (!this._animating) foil.style.opacity = "1";

    foil.style.width = `${foilW}px`;
    foil.style.height = `${foilH}px`;

    const comp = getComputedStyle(sliceEl);

    foil.style.transform = `translate(${x}px, ${y}px) skewY(${skewDeg}deg)`;
    foil.style.transformOrigin = "bottom left";

    // Sidebar cards are sharp skewed panels, so force square foil corners.
    const r = 0;
    foil.style.setProperty("--mg-foil-radius", "0px");

    const svg = foil.querySelector(".mg-ini-foil-svg");
    const ring = foil.querySelector(".mg-ini-foil__ring");
    if (!svg || !ring) return;

    svg.setAttribute("width", String(foilW));
    svg.setAttribute("height", String(foilH));

    const sw = Math.max(2, parseFloat(getComputedStyle(ring).strokeWidth) || 3);
    const inset = sw / 2;

    ring.setAttribute("x", String(inset));
    ring.setAttribute("y", String(inset));
    ring.setAttribute("width", String(Math.max(0, foilW - sw)));
    ring.setAttribute("height", String(Math.max(0, foilH - sw)));
    ring.setAttribute("rx", String(Math.max(0)));
    ring.setAttribute("ry", String(Math.max(0)));

    const wPrime = Math.max(0, foilW - sw);
    const hPrime = Math.max(0, foilH - sw);
    const rPrime = Math.max(0, Math.min(r - inset, wPrime * 0.5, hPrime * 0.5));
    const perimeter = 2 * (wPrime + hPrime - 2 * rPrime) + 2 * Math.PI * rPrime;

    const wispLen = Math.max(48, perimeter * 0.18);
    const gapLen = Math.max(1, perimeter - wispLen);

    foil.style.setProperty("--mg-perimeter", `${perimeter.toFixed(2)}px`);
    foil.style.setProperty("--mg-dash-on", `${wispLen.toFixed(2)}px`);
    foil.style.setProperty("--mg-dash-off", `${gapLen.toFixed(2)}px`);

    const slotStroke = comp.getPropertyValue("--slot-stroke")?.trim();
    if (slotStroke) foil.style.setProperty("--slot-stroke", slotStroke);
  }

  _ensureFoilCSS() {
    if (document.getElementById("mg-foil-css")) return;

    const css = `
      .mg-ini-foil {
        position: absolute;
        left: 0;
        top: 0;
        width: 0;
        height: 0;
        pointer-events: none;
        z-index: 50;
        opacity: 1;
        transition: opacity 180ms cubic-bezier(.2,.8,.2,1);
      }

      .mg-ini-foil::after {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        border-radius: var(--mg-foil-radius, 12px);
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

      .mg-ini-foil-svg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        overflow: visible;
      }

      .mg-ini-foil__ring {
        fill: none;
        stroke: var(--slot-stroke, #A2D729);
        stroke-width: var(--mg-foil-stroke, 3px);
        stroke-linecap: butt;
        stroke-linejoin: miter;
        vector-effect: non-scaling-stroke;
        stroke-dasharray: var(--mg-dash-on, 80px) var(--mg-dash-off, 4000px);
        stroke-dashoffset: 0;
        filter:
          drop-shadow(0 0 var(--mg-glow1, 8px) color-mix(in oklab, var(--mg-glow-color, var(--slot-stroke, #A2D729)) 90%, transparent))
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

  _resetFoilStroke() {
    const ring = this._foilEl?.querySelector(".mg-ini-foil__ring");
    if (!ring) return;

    ring.style.strokeDashoffset = "0px";

    const prev = ring.style.animation;
    ring.style.animation = "none";

    if (typeof ring.getBBox === "function") void ring.getBBox();
    else void ring.getBoundingClientRect();

    if (prev) ring.style.animation = prev;
    else ring.style.removeProperty("animation");
  }

  async _foilFadeOut(ms = 180) {
    const foil = this._foilEl ?? this._ensureFoilLayer();
    if (!foil) return;

    if (ms <= 0) {
      foil.style.transition = "none";
      foil.style.opacity = "0";
      foil.style.display = "none";
      return;
    }

    foil.style.transition = `opacity ${ms}ms cubic-bezier(.2,.8,.2,1)`;
    foil.style.display = "";
    void foil.offsetWidth;
    foil.style.opacity = "0";
    await this._afterTransition(foil, ms + 120);
    foil.style.display = "none";
  }

  async _foilFadeIn(ms) {
    const foil = this._foilEl ?? this._ensureFoilLayer();
    if (!foil) return;

    const dur = ms ?? this._foilFadeInMs ?? 700;

    foil.style.transition = "none";
    foil.style.display = "";
    foil.style.opacity = "0";
    void foil.offsetWidth;

    foil.style.transition = `opacity ${dur}ms cubic-bezier(.2,.8,.2,1)`;
    foil.style.opacity = "1";
    await this._afterTransition(foil, dur + 120);
    foil.style.removeProperty("transition");
  }  

  // -----------------------------
  // Hover Stats: Strain Snapshot + Paint
  // -----------------------------
  _getStrainSnapshot(actor) {
    const s = actor?.system?.strain ?? {};
    return {
      mortal: {
        cap: Number(s["mortal capacity"] ?? 0) || 0,
        track: Number(s.mortal ?? 0) || 0
      },
      soul: {
        cap: Number(s["soul capacity"] ?? 0) || 0,
        track: Number(s.soul ?? 0) || 0
      }
    };
  }

  _refreshSliceHoverStats(sliceEl, actorId) {
    if (!sliceEl) return;

    // END / empty slots shouldn't show stats
    if (!actorId || actorId === END_ID) return;

    const actor = game.actors.get(actorId);
    if (!actor) return;

    const panel = sliceEl.querySelector(".mg-ini-hoverstats");
    if (!panel) return;

    const snap = this._getStrainSnapshot(actor);

    for (const type of ["mortal", "soul"]) {
      const row = panel.querySelector(`.mg-ini-hs-row[data-type="${type}"]`);
      if (!row) continue;

      const capEl = row.querySelector(`[data-field="cap"]`);
      const trackEl = row.querySelector(`[data-field="track"]`);

      if (capEl) capEl.textContent = String(Math.max(0, snap[type].cap));
      if (trackEl) trackEl.textContent = String(Math.max(0, snap[type].track));
    }
  }

  _refreshAllSidebarHoverStatsForActor(actorId) {
    const root = document.getElementById("mg-initiative-sidebar");
    if (!root || !actorId) return;

    const slots = root.querySelectorAll(`.mg-ini-side-slot[data-actor-id="${actorId}"]`);
    for (const slot of slots) {
      const slice = slot.querySelector(".mg-ini-slice");
      if (slice) this._refreshSliceHoverStats(slice, actorId);
    }
  }

  refreshActorImages(actorId) {
    const root = document.getElementById("mg-initiative-sidebar");
    if (!root || !actorId) return;

    const actor = game.actors.get(actorId);
    const slots = root.querySelectorAll(`.mg-ini-side-slot[data-actor-id="${actorId}"]`);
    for (const slot of slots) {
      const imgWrap = slot.querySelector(".mg-ini-side-card-img");
      const img = imgWrap?.querySelector("img");
      if (img) img.src = mgGetActorSidebarInitiativeImage(actor);
      this._applyActorCrop(imgWrap, actor);
    }
  }

  _applyActorCrop(imgWrap, actor) {
    if (!imgWrap) return;
    const isMainSlot = imgWrap.closest?.(".mg-ini-side-slot")?.dataset?.slot === "0";
    const cropKey = isMainSlot && mgHasActorCrop(actor, "sidebarInitiativeMain")
      ? "sidebarInitiativeMain"
      : "sidebarInitiative";
    const hasCrop = mgHasActorCrop(actor, cropKey);
    imgWrap.classList.toggle("is-cropped", hasCrop);
    if (hasCrop) {
      imgWrap.setAttribute("style", mgGetActorCropVariables(actor, cropKey));
    } else {
      imgWrap.removeAttribute("style");
    }
  }

  _clearActorCrop(cardEl) {
    const imgWrap = cardEl?.querySelector?.(".mg-ini-side-card-img");
    if (!imgWrap) return;
    imgWrap.classList.remove("is-cropped");
    imgWrap.removeAttribute("style");
  }

  _wireLiveActorRefresh() {
    if (this._liveHooksWired) return;
    this._liveHooksWired = true;

    // Actor sheet edits (capacity/track) -> update sidebar instantly
    Hooks.on("updateActor", (actor, changed) => {
      if (!this._mounted) return;
      if (!actor?.id) return;
      if (!Array.isArray(this._ids) || !this._ids.includes(actor.id)) return;

      if (mgActorCropTouched(changed)) {
        this.refreshActorImages(actor.id);
        return;
      }

      // Only react to strain/cap changes (prevents unnecessary work)
      const touched =
        getProperty(changed, "system.strain") != null ||
        getProperty(changed, "system.strain.mortal") != null ||
        getProperty(changed, "system.strain.soul") != null ||
        getProperty(changed, "system.strain.mortal capacity") != null ||
        getProperty(changed, "system.strain.soul capacity") != null;

      if (!touched) return;

      this._refreshAllSidebarHoverStatsForActor(actor.id);
    });

    // Item changes (armor repair updates remainingCapacity) -> capacity recalc flows into actor -> refresh UI
    Hooks.on("updateItem", (item, changed) => {
      if (!this._mounted) return;
      const parent = item?.parent;
      if (!parent || parent.documentName !== "Actor") return;
      if (!Array.isArray(this._ids) || !this._ids.includes(parent.id)) return;

      // If armor repair triggers actor update too, this is redundant but harmless.
      this._refreshAllSidebarHoverStatsForActor(parent.id);
    });
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
      this._clearActorCrop(cardEl);
      return;
    }

    cardEl.classList.remove("is-end");

    if (!id) {
      if (img) img.src = "";
      if (name) name.textContent = "";
      this._clearActorCrop(cardEl);
      return;
    }

    const a = game.actors.get(id);
    if (img) img.src = mgGetActorSidebarInitiativeImage(a, "icons/svg/mystery-man.svg");
    this._applyActorCrop(cardEl.querySelector(".mg-ini-side-card-img"), a);
    if (name) name.textContent = a?.name ?? "—";
  }

  _afterTransition(el, timeout = 430) {
    return new Promise((resolve) => {
      let done = false;

      const finish = () => {
        if (done) return;
        done = true;
        el?.removeEventListener?.("transitionend", onEnd);
        resolve();
      };

      const onEnd = (ev) => {
        if (ev?.propertyName && ev.propertyName !== "transform" && ev.propertyName !== "opacity") return;
        finish();
      };

      el?.addEventListener?.("transitionend", onEnd, { once: true });
      setTimeout(finish, timeout);
    });
  }

  async _animateNextNameChange(newName) {
    const root = document.getElementById("mg-initiative-sidebar");
    const label = root?.querySelector('[data-role="nextname"]');
    if (!label) return;

    // same behavior as main initiative bar: start off to the right, then slide in
    label.style.willChange = "transform, opacity";
    label.style.transition = "none";
    label.style.transform = `translateX(${NAME_LEAVE_PX}px)`;
    label.style.opacity = "0";

    void label.offsetWidth;

    label.textContent = newName;
    label.style.transition =
      `transform ${NAME_TRANS_MS}ms cubic-bezier(.2,.8,.2,1), ` +
      `opacity ${NAME_TRANS_MS}ms cubic-bezier(.2,.8,.2,1)`;
    label.style.transform = "translateX(0)";
    label.style.opacity = "1";

    try {
      await this._afterTransition(label, NAME_TRANS_MS + 170);
    } finally {
      label.style.removeProperty("transition");
      label.style.removeProperty("transform");
      label.style.removeProperty("opacity");
      label.style.willChange = "";
    }
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
    // next name
    const nextNameEl = root.querySelector('[data-role="nextname"]');
    const topId = windowIds[0];
    const topActor = topId && topId !== END_ID ? game.actors.get(topId) : null;
    const nextName = topActor?.name ?? (topId === END_ID ? "End of Round" : "—");

    // Only hard-set here when we are not mid animation.
    if (nextNameEl && !this._animating) {
      nextNameEl.textContent = nextName;
    }

    // paint slots content only
    windowIds.forEach((id, slotIdx) => {
      const slot = root.querySelector(`.mg-ini-side-slot[data-slot="${slotIdx}"]`);
      if (!slot) return;

      // IMPORTANT: do not touch is-leaving / is-shifting / is-entering here
      // Only update is-empty and dataset + content.
      const img = slot.querySelector(".mg-ini-side-card-img img");
      const imgWrap = slot.querySelector(".mg-ini-side-card-img");
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
        this._applyActorCrop(imgWrap, null);

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
        this._applyActorCrop(imgWrap, null);
        return;
      }

      const a = game.actors.get(id);
      slot.classList.remove("is-empty");
      slot.dataset.actorId = id;

      if (img) img.src = mgGetActorSidebarInitiativeImage(a);
      this._applyActorCrop(imgWrap, a);
      if (name) name.textContent = a?.name ?? "—";
      if (card) card.removeAttribute("aria-hidden");

      const sliceEl = slot.querySelector(".mg-ini-slice");
      if (sliceEl) this._refreshSliceHoverStats(sliceEl, id);      
    });

    // END ghost active
    const end = root.querySelector('[data-role="end"]');
    if (end) end.classList.toggle("is-active", this._isEndActive());

    if (!this._animating) {
      requestAnimationFrame(() => {
        this._syncFoilToTopSlot({ reset: false, fade: false });
      });
    }
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

    await this._foilFadeOut().catch(() => {});

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

    // Animate "Up next" label like the main initiative bar
    const topId = nextWindow[0];
    const topActor = topId && topId !== END_ID ? game.actors.get(topId) : null;
    const nextName = topActor?.name ?? (topId === END_ID ? "End of Round" : "—");
    this._animateNextNameChange(nextName).catch(console.error);

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


    this._paintSlots(nextWindow);

    // Wait until the slide cleanup has finished before placing the foil.
    await new Promise(r => setTimeout(r, 340));
    await new Promise(r => requestAnimationFrame(r));

    this._syncFoilToTopSlot({ reset: true, fade: true });

    this._animating = false;
  }

  async _animateReset() {
    if (this._animating) return;
    this._animating = true;

    // reset local state immediately
    this._activeIndex = 0;
    this._ids = this._getFullTrackIds();

    const resetWindow = this._windowIds();
    const topId = resetWindow[0];
    const topActor = topId && topId !== END_ID ? game.actors.get(topId) : null;
    const resetName = topActor?.name ?? (topId === END_ID ? "End of Round" : "â€”");

    this._paintSlots(resetWindow);
    await Promise.all([
      this._animateNextNameChange(resetName).catch(() => {}),
      new Promise(r => requestAnimationFrame(r))
    ]);
    this._syncFoilToTopSlot({ reset: true, fade: true });

    this._animating = false;
  }

  // -----------------------------
  // Events
  // -----------------------------
  _onEvt(evt) {
    const syncId = evt?.payload?.syncId;
    if (syncId && this._lastSyncId === syncId) return;
    if (syncId) this._lastSyncId = syncId;

    if (evt?.type === "progress") {
      if (this._animating) return;

      const payload = evt.payload ?? {};

      if (Array.isArray(payload.ids)) {
        this._ids = payload.ids.filter(id => !!game.actors.get(id));
      } else {
        this._ids = this._getFullTrackIds();
      }

      // Start the sidebar animation from the canonical previous index.
      const prev = Number(payload.prev ?? payload.activeIndex ?? 0);
      const L = this._trackLength();
      this._activeIndex = ((prev % L) + L) % L;

      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(() => this._animateAdvance());
      return;
    }

    if (evt?.type === "reset") {
      if (this._animating) return;

      const payload = evt.payload ?? {};

      if (Array.isArray(payload.ids)) {
        this._ids = payload.ids.filter(id => !!game.actors.get(id));
      } else {
        this._ids = this._getFullTrackIds();
      }

      this._activeIndex = 0;

      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(() => this._animateReset());
      return;
    }

    if (evt?.type === "order") {
      const payload = evt.payload ?? {};

      if (Array.isArray(payload.ids)) {
        this._ids = payload.ids.filter(id => !!game.actors.get(id));
      } else {
        this._syncFromSource();
      }

      if (Number.isFinite(Number(payload.activeIndex))) {
        const L = this._trackLength();
        this._activeIndex = ((Number(payload.activeIndex) % L) + L) % L;
      }

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
        this._paintSlots();
        return;
      }

      // During animation, ignore Next/Reset spam.
      if (this._animating) return;

      if (action === "next") {
        // Do NOT animate locally here.
        // Ask the controller to advance. The replicated controller event will trigger animation.
        MGInitiativeController.instance.advance().catch(console.error);
        return;
      }

      if (action === "reset") {
        // Do NOT reset locally here.
        // Ask the controller to reset. The replicated controller event will trigger reset.
        MGInitiativeController.instance.reset().catch(console.error);
        return;
      }
    }, { passive: false });
  }
}
