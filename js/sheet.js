import { evaluateRoll } from "./roll-utils.js";

export class MidnightGambitActorSheet extends ActorSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      template: "systems/midnight-gambit/templates/actors/actor-sheet.html",
      width: 850,
      height: 950
    });
  }

    //Grabbing all the actor data information to create the initial sheet
    async getData(options) {
      const context = await super.getData(options);

      // Make sure the actor is available in the template
      context.actor = this.actor;
      context.system = this.actor.system;

      context.sparkAttribute = this.actor.system.sparkAttribute ?? "guile";

      
      const deckIds = context.system.gambits.deck ?? [];
      const drawnIds = context.system.gambits.drawn ?? [];
      const discardIds = context.system.gambits.discard ?? [];

      // --- Gambit counters for UI ---
      const handCount = drawnIds.length;
      const deckCount = deckIds.length;
      const handMax   = Number(context.system.gambits?.maxDrawSize ?? 3);
      const deckMax   = Number(context.system.gambits?.maxDeckSize ?? 3);

      context.gambitCounts = {
        handCount, handMax,                      // e.g., "Hand Size: 2/4"
        deckCount, deckMax,                      // e.g., "Deck Size: 3/5"
        handAtCap: handCount >= handMax,
        deckAtCap: deckCount >= deckMax,
        deckRemaining: Math.max(0, deckMax - deckCount)
      };


      // === Guise presence drives Level UI ===
      // "hasActiveGuise" is true if the actor has an applied guise id on system,
      // or at least one Guise item owned (pick whichever you really use).
      const hasSystemGuise =
        Boolean(getProperty(this.actor, "system.guise")) ||
        Boolean(getProperty(this.actor, "system.guiseId")) ||
        Boolean(getProperty(this.actor, "system.guise.active"));

      const hasItemGuise = Array.isArray(this.actor.items)
        ? this.actor.items.some(i => i.type === "guise")
        : false;

      context.hasActiveGuise = hasSystemGuise || hasItemGuise;

      
      
      context.gambitDeck = deckIds.map(id => this.actor.items.get(id)).filter(Boolean);
      context.gambitDrawn = drawnIds.map(id => this.actor.items.get(id)).filter(Boolean);
      context.gambitDiscard = discardIds.map(id => this.actor.items.get(id)).filter(Boolean);

      context.gambitDrawnWithAngle = context.gambitDrawn.map((card, i, arr) => {
        const total = arr.length;
        const mid = (total - 1) / 2;
        const angle = (i - mid) * 10; // spacing angle
        return { ...card, rotate: angle };
      });      

      if (!this.actor?.system?.gambits) {
        console.warn("Missing gambit data on actor.");
        return super.getData(options);
      }

      context.attributeKeys = [
        "tenacity",
        "finesse",
        "resolve",
        "guile",
        "instinct",
        "presence"
      ];

      // Skill buckets for the new under-attribute layout
      context.skillBuckets = {
        tenacity: ["brawl", "endure", "athletics"],
        finesse:  ["aim", "stealth", "sleight"],
        resolve:  ["will", "grit", "composure"],
        guile:    ["lore", "investigate", "deceive"],
        instinct: ["survey", "hunt", "nature"],
        presence: ["command", "charm", "perform"]
      };

      // Human-friendly labels (keeps template clean)
      context.skillLabels = {
        brawl: "Brawl",
        endure: "Endure",
        athletics: "Athletics",
        aim: "Aim",
        stealth: "Stealth",
        sleight: "Sleight",
        will: "Will",
        grit: "Grit",
        composure: "Composure",
        lore: "Lore",
        investigate: "Investigate",
        deceive: "Deceive",
        survey: "Survey",
        hunt: "Hunt",
        nature: "Nature",
        command: "Command",
        charm: "Charm",
        perform: "Perform",

        // Spark label if you render it in the Spark section
        spark: "Spark"
      };

      
      context.skillAttrShort = {
        brawl: "ten", endure: "ten", athletics: "ten",
        aim: "fin", stealth: "fin", sleight: "fin",
        will: "res", grit: "res", composure: "res",
        lore: "gui", investigate: "gui", deceive: "gui",
        survey: "ins", hunt: "ins", nature: "ins",
        command: "pre", charm: "pre", perform: "pre",

        // Spark is no longer rendered in the skill grid, but this can stay for now
        // if you still render Spark elsewhere and want the tooltip shorthand.
        spark: "gui"
      };


      context.CONFIG = CONFIG;

      const guiseId = this.actor.system.guise;
      if (guiseId) {
        const guise = this.actor.items.get(guiseId) || game.items.get(guiseId);
        if (guise) {
          context.guise = guise;

          const casterType = guise.system?.casterType ?? null;

          context.isCaster = casterType === "full" || casterType === "half";
          context.isFullCaster = casterType === "full";
          context.isHalfCaster = casterType === "half";

          console.log("Guise ID:", guiseId);
          console.log("Caster Type:", casterType);
          console.log("isCaster?", context.isCaster);
          console.log("isFullCaster?", context.isFullCaster);
          console.log("isHalfCaster?", context.isHalfCaster);
        }
      } else {
        context.isCaster = false;
      }
      
      for (const item of context.actor.items) {
        const mc = item.system.mortalCapacity || 0;
        const sc = item.system.soulCapacity || 0;

        // If remaining not set yet, default it to full
        if (!item.system.remainingCapacity) {
          item.system.remainingCapacity = {};
        }

        if (item.system.remainingCapacity.mortal === undefined) {
          item.system.remainingCapacity.mortal = mc;
        }

        if (item.system.remainingCapacity.soul === undefined) {
          item.system.remainingCapacity.soul = sc;
        }

        item.system.isFullyRepaired =
          (!mc || item.system.remainingCapacity.mortal === mc) &&
          (!sc || item.system.remainingCapacity.soul === sc);
      }

      /* Split moves into Basic (from Guise or not-learned) vs Learned
      ----------------------------------------------------------------------*/
      const allMoves = this.actor.items.filter(i => i.type === "move");
      context.basicMoves   = allMoves.filter(m => !m.system?.learned);
      context.learnedMoves = allMoves.filter(m =>  m.system?.learned);

      /* Level up / Undo context
      ----------------------------------------------------------------------*/
      const level = this.actor.system.level ?? 1;
      const levels = CONFIG.MidnightGambit?.LEVELS ?? {};
      const maxLevel = Math.max(...Object.keys(levels).map(n => Number(n) || 0), 1);

      context.canLevelUp = level < maxLevel;
      context.canLevelDown = level > 1;

      // Pending counters to drive banner/wizard
      const state = await this.actor.getFlag("midnight-gambit", "state");
      const p = state?.pending || {};
      context.pending = {
        attributes: Number(p.attributes || 0),
        skills: Number(p.skills || 0),
        moves: Number(p.moves || 0),
        sparkSlots: Number(p.sparkSlots || 0),
        signaturePerk: Number(p.signaturePerk || 0),
        finalHandDiscoverable: Number(p.finalHandDiscoverable || 0)
      };
      context.hasPending = Object.values(context.pending).some(n => Number(n) > 0);

      // --- Enrich TinyMCE HTML for Signature + Moves (safe → HTML) ---
      if (context.guise) {
        const sig = String(context.guise.system?.signatureDescription ?? "");
        context.signatureHtml = await TextEditor.enrichHTML(sig, { async: true });

        const rawMoves = Array.isArray(context.guise.system?.moves) ? context.guise.system.moves : [];
        context.enrichedMoves = await Promise.all(
          rawMoves.map(async m => ({
            ...m,
            html: await TextEditor.enrichHTML(String(m.description ?? ""), { async: true })
          }))
        );
      } else {
        context.signatureHtml = "";
        context.enrichedMoves = [];
      }


      context.data = context;  // <- this makes all context vars available to the template root
      context.tags = CONFIG.MidnightGambit?.ITEM_TAGS ?? [];
      return context;
    }

    /** Wrap the profile img in a cropbox and apply saved vars from flags. */
    _mgInitProfileCrop(html) {
      const $root = html instanceof jQuery ? html : $(html);
      const $img = $root.find("img.mg-profile-img").first();
      if (!$img.length) return;

      // Wrap once
      let $wrap = $img.closest(".mg-profile-crop.mg-cropbox");
      if (!$wrap.length) {
        $wrap = $(`<div class="mg-profile-crop mg-cropbox"></div>`);
        $img.wrap($wrap);
        $wrap = $img.closest(".mg-profile-crop.mg-cropbox");
      }

      // Apply from flags
      const crop = this.actor.getFlag("midnight-gambit", "crops")?.profile?.css || {};
      const x = Number.isFinite(crop.x) ? crop.x : 50;
      const y = Number.isFinite(crop.y) ? crop.y : 50;
      const s = Number.isFinite(crop.scale) ? crop.scale : 1;

      $wrap[0].style.setProperty("--mg-crop-x", String(x));
      $wrap[0].style.setProperty("--mg-crop-y", String(y));
      $wrap[0].style.setProperty("--mg-crop-scale", String(s));
    }

    /** Modal cropper: drag to pan, wheel to zoom; saves to flags on Save. */
    _mgOpenProfileCropper(html) {
      const $root = html instanceof jQuery ? html : $(html);
      const $img = $root.find("img.mg-profile-img").first();
      const src = $img.attr("src");
      if (!src) return;

      // Current values
      const saved = this.actor.getFlag("midnight-gambit", "crops")?.profile?.css || {};
      let x = Number.isFinite(saved.x) ? saved.x : 50;
      let y = Number.isFinite(saved.y) ? saved.y : 50;
      let s = Number.isFinite(saved.scale) ? saved.scale : 1;

      // Build overlay
      const $ui = $(`
        <div class="mg-crop-editor" role="dialog" aria-modal="true">
          <div class="mg-crop-panel">
            <div class="mg-row">
              <div><strong>Crop Actor Profile Image</strong></div>
              <div class="hint">Drag to pan • Mouse wheel to zoom • Esc to cancel</div>
            </div>
            <div class="mg-crop-stage">
              <img src="${src}" alt="preview" style="--x:${x}; --y:${y}; --s:${s}">
            </div>
            <div class="mg-actions">
              <button class="ghost mg-cancel">Cancel</button>
              <button class="primary mg-save">Save</button>
            </div>
          </div>
        </div>
      `);

      const stage = $ui.find(".mg-crop-stage")[0];
      const imgEl = $ui.find(".mg-crop-stage img")[0];

      // Drag state
      let dragging = false;
      let last = { cx: 0, cy: 0 };

      const apply = () => {
        imgEl.style.setProperty("--x", String(x));
        imgEl.style.setProperty("--y", String(y));
        imgEl.style.setProperty("--s", String(s));
      };

      // Drag to pan (pointer events = works with mouse + pen)
      stage.addEventListener("pointerdown", (ev) => {
        dragging = true;
        last = { cx: ev.clientX, cy: ev.clientY };
        stage.setPointerCapture?.(ev.pointerId);
      });
      stage.addEventListener("pointermove", (ev) => {
        if (!dragging) return;
        const dx = ev.clientX - last.cx;
        const dy = ev.clientY - last.cy;
        last = { cx: ev.clientX, cy: ev.clientY };
        const w = stage.clientWidth;
        const h = stage.clientHeight;
        x -= (dx / w) * 100;
        y -= (dy / h) * 100;
        apply();
      });
      stage.addEventListener("pointerup", () => { dragging = false; });
      stage.addEventListener("pointercancel", () => { dragging = false; });

      // Wheel to zoom (clamped)
      stage.addEventListener("wheel", (ev) => {
        ev.preventDefault();
        const delta = Math.sign(ev.deltaY) * 0.05;
        s = Math.min(3, Math.max(0.5, s - delta));
        apply();
      }, { passive: false });

      // Buttons
      $ui.on("click", ".mg-cancel", () => $ui.remove());
      $ui.on("click", ".mg-save", async () => {
        try {
          const ns = "midnight-gambit";
          const crops = (await this.actor.getFlag(ns, "crops")) || {};
          crops.profile = crops.profile || {};
          crops.profile.css = { x, y, scale: s };
          await this.actor.setFlag(ns, "crops", crops);
          this._mgInitProfileCrop(html); // apply immediately on sheet
          $ui.remove();
        } catch (err) {
          console.error("MG | Save profile crop failed:", err);
          ui.notifications?.error("Failed to save profile crop. See console.");
        }
      });

      // Esc to close
      const onKey = (ev) => {
        if (ev.key === "Escape") { $ui.remove(); window.removeEventListener("keydown", onKey); }
      };
      window.addEventListener("keydown", onKey);

      document.body.appendChild($ui[0]);
    }

/** Modal cropper for Chat Avatar: identical behavior to profile cropper */
_mgOpenChatCropper() {
  const src = this.actor?.img;
  if (!src) return;

  // Current values
  const saved = this.actor.getFlag("midnight-gambit", "crops")?.chat?.css || {};
  let x = Number.isFinite(saved.x) ? saved.x : 50;
  let y = Number.isFinite(saved.y) ? saved.y : 50;
  let s = Number.isFinite(saved.scale) ? saved.scale : 1;

  const $ui = $(`
    <div class="mg-crop-editor chat-crop" role="dialog" aria-modal="true">
      <div class="mg-crop-panel">
        <div class="mg-row">
          <div><strong>Frame Chat Avatar</strong></div>
          <div class="hint">Drag to pan • Mouse wheel to zoom • Esc to cancel</div>
        </div>

        <div class="mg-crop-stage">
          <img src="${src}" alt="preview" style="--x:${x}; --y:${y}; --s:${s}">
        </div>

        <div class="mg-actions">
          <button type="button" class="ghost mg-cancel">Cancel</button>
          <button type="button" class="primary mg-save">Save</button>
        </div>
      </div>
    </div>
  `);

  const stage = $ui.find(".mg-crop-stage")[0];
  const imgEl = $ui.find(".mg-crop-stage img")[0];

  let dragging = false;
  let last = { cx: 0, cy: 0 };

  const apply = () => {
    imgEl.style.setProperty("--x", String(x));
    imgEl.style.setProperty("--y", String(y));
    imgEl.style.setProperty("--s", String(s));
  };

  stage.addEventListener("pointerdown", (ev) => {
    dragging = true;
    last = { cx: ev.clientX, cy: ev.clientY };
    stage.setPointerCapture?.(ev.pointerId);
  });

  stage.addEventListener("pointermove", (ev) => {
    if (!dragging) return;

    const dx = ev.clientX - last.cx;
    const dy = ev.clientY - last.cy;
    last = { cx: ev.clientX, cy: ev.clientY };

    const w = stage.clientWidth || 1;
    const h = stage.clientHeight || 1;

    // Same feel as profile cropper (not hypersensitive)
    const PAN = 0.45;
    x -= ((dx / w) * 100) * PAN;
    y -= ((dy / h) * 100) * PAN;

    apply();
  });

  stage.addEventListener("pointerup", () => { dragging = false; });
  stage.addEventListener("pointercancel", () => { dragging = false; });

  stage.addEventListener("wheel", (ev) => {
    ev.preventDefault();

    // Same zoom feel as profile cropper
    const delta = Math.sign(ev.deltaY) * 0.05;
    s = Math.min(6, Math.max(0.25, s - delta));

    apply();
  }, { passive: false });

  $ui.on("click", ".mg-cancel", () => $ui.remove());

  $ui.on("click", ".mg-save", async () => {
    try {
      const ns = "midnight-gambit";
      const crops = (await this.actor.getFlag(ns, "crops")) || {};
      crops.chat = crops.chat || {};
      crops.chat.css = { x, y, scale: s };
      await this.actor.setFlag(ns, "crops", crops);

      // Refresh chat so you don't need a new roll to test
      ui.chat?.render?.(true);

      $ui.remove();
    } catch (err) {
      console.error("MG | Save chat crop failed:", err);
      ui.notifications?.error("Failed to save chat framing. See console.");
    }
  });

  const onKey = (ev) => {
    if (ev.key === "Escape") {
      $ui.remove();
      window.removeEventListener("keydown", onKey);
    }
  };
  window.addEventListener("keydown", onKey);

  document.body.appendChild($ui[0]);
}


    /** Binds event listeners after rendering. This is the Event listener for most the system*/
    async activateListeners(html) {
      super.activateListeners(html);

      this._mgInitProfileCrop(html);
      html.find(".mg-crop-profile").off("click.mgCrop").on("click.mgCrop", (ev) => {
        ev.preventDefault();
        this._mgOpenProfileCropper(html);
      });

      html.find(".mg-crop-chat").off("click.mgCropChat").on("click.mgCropChat", (ev) => {
        ev.preventDefault();
        this._mgOpenChatCropper(html);
      });

      // Owner / GM? Full interactivity. Otherwise: view-only and bail out.
      const isOwner = this.actor?.testUserPermission?.(game.user, "OWNER") || game.user.isGM;
      if (!isOwner) {
        // (If you pasted the tab-hiding helper earlier, keep this call. If not, it's safe to ignore.)
        if (typeof this._mgRestrictTabsForNonOwners === "function") {
          this._mgRestrictTabsForNonOwners(html);
        }
        this._mgMakeReadOnly(html);
        return;
      }

      // Dynamically apply .narrow-mode based on sheet width
      const appWindow = html[0]?.closest(".window-app");
      const form = html[0];

      if (appWindow && form) {
        const observer = new ResizeObserver(entries => {
          for (let entry of entries) {
            const width = entry.contentRect.width;
            if (width < 700) {
              form.classList.add("narrow-mode");
            } else {
              form.classList.remove("narrow-mode");
            }
          }
        });

        observer.observe(appWindow);
        this._resizeObserver = observer;
      }

      // Shuffle Function
      function shuffleArray(array) {
        const copy = [...(array ?? [])];
        for (let i = copy.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
      }

      // MG Edge Toggle Button
      html.find(".mg-edge-toggle").on("click", async (ev) => {
        ev.preventDefault();
        const cur = !!this.actor.system.edgeNext;
        await this.actor.update({ "system.edgeNext": !cur }, { render: false });

        // Update UI immediately without re-render
        const btn = ev.currentTarget;
        btn.classList.toggle("is-active", !cur);
      });

      // This updates the strain amount on click; Also added parameter to suppress re-render on DOM so it won't jump around on click
      html.find(".strain-dot").on("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        // Kill any active input focus
        if (document.activeElement) try { document.activeElement.blur(); } catch(_) {}

        // Setting the strain type Mortal/Strain
        const el = event.currentTarget;
        const strainType   = el.dataset.type;
        const clickedValue = Number(el.dataset.value);

        const actor = this.actor;
        if (!actor) return;

        //Finds the current value and subtracts the differntial
        const currentValue = getProperty(actor.system.strain, strainType);
        const newValue = Math.max(0, clickedValue === currentValue ? clickedValue - 1 : clickedValue);

        // 1) Update the doc WITHOUT triggering a render
        await actor.update({ [`system.strain.${strainType}`]: newValue });

        // 2) Manually reflect the change in the currently open sheet
        const $track = html.find(`.strain-track[data-strain="${strainType}"]`);
        $track.find(".strain-dot").each((_, node) => {
          const v = Number(node.dataset.value);
          node.classList.toggle("filled", v <= newValue);
        });
      });
      
      /** This looks for risk dice amount and applies similar click logic */
      html.find(".risk-dot").on("click", async (event) => {
        const el = event.currentTarget;
        const clicked = parseInt(el.dataset.value);
        const riskDice = this.actor.system.riskDice ?? 5;
        const currentUsed = this.actor.system.riskUsed ?? 0;
        const currentlyFilled = riskDice - currentUsed;

        let newUsed;

        if (clicked > currentlyFilled) {
          // Clicked an unfilled dot → fill up to it
          newUsed = riskDice - clicked;
        } else {
          // Clicked a filled dot → unfill it and all to the right
          newUsed = riskDice - (clicked - 1);
        }

        /**This tracks how much Risk you have used, and calculates it with your current*/
        console.log(`Risk click: ${clicked} → riskUsed: ${newUsed} (was ${currentUsed})`);

        await this.actor.update({ "system.riskUsed": newUsed });

        this.render(false);
      });

      /** STO (Stacking the Odds) tracker — click to add or spend */
      html.find(".sto-dot")
        .off("click.mgSTO")
        .on("click.mgSTO", async (event) => {
          event.preventDefault();
          event.stopPropagation();

          const el = event.currentTarget;
          const clicked = Number(el.dataset.value);
          if (!Number.isFinite(clicked)) return;

          const actor = this.actor;
          if (!actor) return;

          const current = Number(actor.system?.sto?.value ?? 0);

          // Core rule:
          // - click empty → set to clicked
          // - click filled → drop to clicked - 1
          let next = (clicked <= current)
            ? clicked - 1
            : clicked;

          next = Math.max(0, Math.min(6, next));

          await actor.update(
            { "system.sto.value": next },
            { render: false }
          );

          // Patch UI immediately (no full render)
          const $track = this.element.find(`.sto-track[data-track="sto"]`);
          $track.find(".sto-dot").each((_, node) => {
            const v = Number(node.dataset.value);
            node.classList.toggle("filled", v <= next);
          });
        });




      /**This is the listener for clicking the Flashback Resource */
      html.find(".flashback-dot").on("click", async (event) => {
        const current = this.actor.system.flashbackUsed ?? false;
        await this.actor.update({ "system.flashbackUsed": !current });
        this.render(false);
      });

      html.find(".load-icon").on("click", async (event) => {
        const selected = event.currentTarget.dataset.load;
        await this.actor.update({ "system.load": selected });

        // Remove all selected immediately
        html.find(".load-icon").removeClass("selected");

        const $clicked = $(event.currentTarget);

        // Step 1: Force reflow to commit the style
        void $clicked[0].offsetWidth;

        // Step 2: Add animating class
        $clicked.addClass("selected");
      });

      /** This adds a tab section for the character sheet and sets the selectors for said tabs. Also sets the tabs to stay on the active tab after a render */
      // It also makes the data stored locally not on the system
      const groupEl = html.find("nav.sheet-tabs")[0];
      const group = groupEl?.getAttribute("data-group") || "main";

      // Unique key per actor + viewer (and per tab group if you add more later)
      const TAB_KEY = `mg.tab.${this.actor.id}.${game.user.id}.${group}`;
      const initialTab = localStorage.getItem(TAB_KEY) || "general";

      // Keep the active tab per-actor/per-user
      const tabs = new Tabs({
        navSelector: groupEl ? `nav.sheet-tabs[data-group="${group}"]` : `nav.sheet-tabs`,
        // Use the standard container that holds your <section class="tab" ...> panes
        contentSelector: `.sheet-body`,
        initial: initialTab,
        // Foundry v11 will call this; make sure it's a function
        callback: (_tabs, _html, _event) => { /* no-op, but prevents v11 crash */ }
      });
      tabs.bind(html[0]);


      // Save selection locally (no actor flags = no sync to other users)
      html.find(groupEl ? `nav.sheet-tabs[data-group="${group}"]` : `nav.sheet-tabs`)
        .on("click", "[data-tab]", (ev) => {
          const tab = ev.currentTarget.dataset.tab;
          if (tab) localStorage.setItem(TAB_KEY, tab);
        });

        // Move floating tab nav outside .window-content so it's not clipped
        const nav = html.find(".sheet-tabs.floating");
        const app = html.closest(".window-app");
        if (nav.length && app.length) {
          app.append(nav);

          // --- Settings tab glow + count badge (nav lives in .window-app now) ---
          const appRoot = app; // jQuery of .window-app

          const refreshSettingsGlow = async () => {
            const state = (await this.actor.getFlag("midnight-gambit", "state")) ?? {};
            const p = state.pending ?? {};
            const total = Object.values(p).reduce((a, n) => a + (Number(n) || 0), 0);
            const hasPending = total > 0;

            const navBtn = appRoot.find('nav.sheet-tabs [data-tab="settings"]');
            if (!navBtn.length) return;

            navBtn.toggleClass("mg-pending-glow", hasPending);
            navBtn.find(".mg-pending-badge").remove();
            if (hasPending) {
              navBtn.append(`<p class="mg-pending-badge" aria-hidden="true">${total}</p>`);
            }
          };

          // Run once when the sheet renders (no await here)
          refreshSettingsGlow().catch(err => console.warn("MG glow init failed:", err));

          // Re-run when this actor's flags change (pending updates)
          this._onActorUpdatePending = async (doc, changes) => {
            if (doc.id !== this.actor.id) return;

            // Be lenient: if any midnight-gambit flags changed, refresh
            const mgFlagsChanged =
              foundry.utils.getProperty(changes, "flags.midnight-gambit") !== undefined ||
              foundry.utils.getProperty(changes, "flags['midnight-gambit']") !== undefined ||
              foundry.utils.getProperty(changes, "flags") !== undefined;

            if (mgFlagsChanged) await refreshSettingsGlow();
          };

          Hooks.on("updateActor", this._onActorUpdatePending);
        }

      // Drawing button for Gambits
      html.find(".draw-gambit").on("click", async () => {
        event.preventDefault();
        event.stopPropagation();
        const { deck = [], drawn = [], maxDrawSize = 3, locked = false } = this.actor.system.gambits;

        if (locked || drawn.length >= maxDrawSize || deck.length === 0) {
          ui.notifications.warn("Cannot draw more cards.");
          return;
        }

        const drawCount = Math.min(maxDrawSize - drawn.length, deck.length);
        const shuffled = shuffleArray(deck);

        const drawnNow = shuffled.slice(0, drawCount);
        const newDrawn = [...drawn, ...drawnNow];
        const newDeck  = deck.filter(id => !drawnNow.includes(id));

        await this.actor.update({
          "system.gambits.deck": newDeck,
          "system.gambits.drawn": newDrawn,
          "system.gambits.locked": true
        });
      });

      //Discard Gambit
      html.find(".discard-card").on("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const itemId = event.currentTarget.dataset.itemId;
        const parent = event.currentTarget.closest(".gambit-card");
        const source = parent?.dataset.source;

        if (!itemId || !source) return;

        const drawn = this.actor.system.gambits[source] ?? [];
        const discard = this.actor.system.gambits.discard ?? [];

        const updatedSource = drawn.filter(id => id !== itemId);
        const updatedDiscard = [...discard, itemId];

        await this.actor.update({
          [`system.gambits.${source}`]: updatedSource,
          "system.gambits.discard": updatedDiscard
        });
      });

      //Remove Card from Hand
      html.find(".remove-from-hand").on("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const itemId = event.currentTarget.dataset.itemId;
        const parent = event.currentTarget.closest(".gambit-card");
        const source = parent?.dataset.source;
        if (!itemId || !source) return;

        const update = {};
        const list = this.actor.system.gambits[source] ?? [];
        update[`system.gambits.${source}`] = list.filter(id => id !== itemId);

        await this.actor.update(update, { render: false });
        this.render(false);
      });

      //Making it so if you click moves in the Character sheet they post to chat!
      html.find(".post-move").on("click", event => {
        const name = event.currentTarget.dataset.moveName || "Unknown Move";
        const description = event.currentTarget.dataset.moveDescription || "";

        const chatContent = `
          <div class="chat-move">
            <h2><i class="fa-solid fa-hand-fist"></i> ${name}</h2>
            <p>${description}</p>
          </div>
        `;

        ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor: this.actor }),
          content: chatContent
        });
      });

      //Doing the same chat posting for Signature Perks
      html.find(".post-signature").on("click", async (event) => {
        const name = event.currentTarget.dataset.perkName;
        const description = event.currentTarget.dataset.perkDescription;

        const chatContent = `
          <div class="chat-move">
            <h2><i class="fa-solid fa-diamond"></i> Signature Perk: ${name}</h2>
            <p>${description}</p>
          </div>
        `;

        ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor: this.actor }),
          content: chatContent
        });
      });

      // Returning Gambits to Deck when removed
      html.find('.return-to-deck').on('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const itemId = event.currentTarget.dataset.itemId;
        if (!itemId) return;

        const { deck = [], drawn = [] } = this.actor.system.gambits;
        const updatedDeck = [...deck, itemId];
        const updatedDrawn = drawn.filter(id => id !== itemId);

        await this.actor.update({
          "system.gambits.deck": updatedDeck,
          "system.gambits.drawn": updatedDrawn
        }, { render: false });

        this.render(false);
      });

      // Handle dragstart
      html.find(".gambit-card").on("dragstart", event => {
        const itemId = event.currentTarget.dataset.itemId;
        const source = event.currentTarget.dataset.source;
        if (!itemId || !source) return;

        event.originalEvent.dataTransfer.setData(
          "text/plain",
          JSON.stringify({ itemId, source })
        );
      });

      // Handle drop on deck or drawn
      const handleDrop = (targetArea) => {
        return async (event) => {
          event.preventDefault();
          const data = JSON.parse(event.originalEvent.dataTransfer.getData("text/plain"));
          const { itemId, source } = data;

          if (source === targetArea) return;

          const deck = this.actor.system.gambits.deck ?? [];
          const drawn = this.actor.system.gambits.drawn ?? [];

          let from = source === "deck" ? deck : drawn;
          let to = source === "deck" ? drawn : deck;

          const index = from.indexOf(itemId);
          if (index === -1) return;

          from = [...from];
          to = [...to, itemId];
          from.splice(index, 1);

          await this.actor.update({
            "system.gambits.deck": source === "deck" ? from : to,
            "system.gambits.drawn": source === "deck" ? to : from
          });
        };
      };

      // Set hover class on container only when dragging enters/leaves the overall drop zone
      const setupDragHover = (containerSelector) => {
        const container = html.find(containerSelector);

        container.on('dragenter', (e) => {
          e.preventDefault();
          e.stopPropagation();
          container.addClass('drag-hover');
        });

        container.on('dragover', (e) => {
          e.preventDefault();
          e.stopPropagation();
        });

        container.on('dragleave', (e) => {
          // Check if actually leaving the container, not entering a child
          if (!container[0].contains(e.relatedTarget)) {
            container.removeClass('drag-hover');
          }
        });

        container.on('drop', (e) => {
          container.removeClass('drag-hover');
        });
      };

      // Add drag-hover support to both deck and hand
      setupDragHover('.gambit-deck');
      setupDragHover('.gambit-hand');


      // Register drop zones
      html.find('.gambit-deck').on('dragover', e => e.preventDefault());
      html.find('.gambit-hand').on('dragover', e => e.preventDefault());
      html.find('.gambit-deck').on('drop', handleDrop("deck"));
      html.find('.gambit-hand').on('drop', handleDrop("drawn"));

      // Spark slot click logic
      html.find(".spark-dot").on("click", async (event) => {
        const el = event.currentTarget;
        const clicked = parseInt(el.dataset.value);
        const total = this.actor.system.sparkSlots ?? 0;
        const used = this.actor.system.sparkUsed ?? 0;
        const remaining = total - used;

        let newUsed;
        if (clicked > remaining) {
          // Fill up to clicked (refund/restore behavior)
          newUsed = total - clicked;
        } else {
          // Unfill clicked and right (spend behavior)
          newUsed = total - (clicked - 1);
        }

        // Safety clamp
        newUsed = Math.max(0, Math.min(total, newUsed));

        const spent = newUsed > used; // only true when you click a FILLED spark to spend it

        await this.actor.update({ "system.sparkUsed": newUsed });

        // Post chat message ONLY when spending Spark
        if (spent) {
          const chatContent = `
            <div class="chat-move">
              <h2><i class="fa-solid fa-dice-d10"></i> Spark has been used!</h2>
            </div>
          `;

          ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            content: chatContent
          });
        }

        this.render(false);
      });

      //Long rest button that resets values to base
      html.find(".long-rest-button").click(async () => {
        const actor = this.actor;
        const guiseId = actor.system.guise;
        const guise = guiseId ? game.items.get(guiseId) : null;

        const updates = {
          "system.sparkUsed": 0,
          "system.strain.mortal": 0,
          "system.strain.soul": 0,
          "system.riskUsed": 0,
          "system.flashbackUsed": false,
          "system.strain.manualOverride.mortal capacity": false,
          "system.strain.manualOverride.soul capacity": false,
          "system.strain.mortal capacity": actor.system.baseStrainCapacity?.mortal ?? 0,
          "system.strain.soul capacity": actor.system.baseStrainCapacity?.soul ?? 0
        };

        // After updating actor strain values...
        for (const item of actor.items.filter(i =>
        ["armor", "misc"].includes(i.type) &&
        (i.system.mortalCapacity > 0 || i.system.soulCapacity > 0))) {
          await item.update({ "system.capacityApplied": false });
        }

        await actor.update(updates);
        await actor.prepareData();  // force recompute
        this.render(true);
        ui.notifications.info(`${actor.name} has completed a Long Rest.`);
      });

      //Checking if armor is damaged, if so it lowers on inventory
      const checkArmorDamage = async (actor, oldValue, newValue, type) => {
        if (newValue >= oldValue) return; // Only track damage
        console.log(`[ArmorCheck] ${type} damage taken: ${oldValue} → ${newValue}`);

        const capacityItems = actor.items.filter(item =>
          ["armor", "misc"].includes(item.type) &&
          item.system.equipped &&
          item.system.capacityApplied &&
          item.system.remainingCapacity?.[type] > 0
        );

        for (const item of capacityItems) {
          const remaining = item.system.remainingCapacity[type];
          if (remaining > 0) {
            await item.update({
              [`system.remainingCapacity.${type}`]: remaining - 1
            });

            console.log(`🛡️ ${item.name} absorbed 1 ${type} damage (now ${remaining - 1})`);
            break; // Only damage the first item that can take it
          }
        }
      };

      // Capacity tickers: − removes 1, + adds 1 (still respects armor/misc capacity logic)
      html.find(".capacity-controls .cap-tick").on("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const btn = event.currentTarget;

        const type = btn.closest(".capacity-controls")?.dataset?.type; // "mortal" | "soul"
        if (!type) return;

        const dir = Number(btn.dataset.dir || 0); // -1 or +1
        if (!dir) return;

        const key = `${type} capacity`; // "mortal capacity" | "soul capacity"
        const current = Number(this.actor.system?.strain?.[key] ?? 0);
        const newValue = Math.max(0, current + dir);

        // If we're decreasing capacity, let armor/misc absorb the "damage" as before
        if (dir < 0) {
          await checkArmorDamage(this.actor, current, newValue, type);
        }

        const updates = {
          [`system.strain.${key}`]: newValue,
          [`system.strain.manualOverride.${key}`]: true
        };

        await this.actor.update(updates, { render: false });

        // Patch the number immediately (no flicker)
        const valEl = html.find(`.capacity-value[data-type="${type}"]`)[0];
        if (valEl) valEl.textContent = String(newValue);

        // If you prefer the old behavior (recompute any derived UI), keep this:
        this.render(false);
      });

      //Remove guise button to return the sheet to default if needed.
      html.find(".remove-guise").on("click", async (event) => {
        event.preventDefault();

        const confirmed = await Dialog.wait({
          title: "Remove Guise?",
          content: `
            <p>Are you sure you want to unassign this Guise? This will keep all your current values.</p>
          `,
          buttons: {
            yes: { label: this._mgBtn("Remove", "fa-trash-arrow-up"), callback: () => true },
            no: { label: this._mgBtn("Cancel", "fa-circle-xmark"), callback: () => false }
          },
          default: "no"
        });

        if (!confirmed) return;

        await this.actor.update({ "system.guise": null });
        this.render(true);
      });

      //Attribute Roll Logic and Base Edit
      html.find(".attribute-modifier").on("contextmenu", async (event) => {
        event.preventDefault();

        const el  = event.currentTarget;
        const key = el.dataset.key;
        const current = Number(el.getAttribute("data-base")) || 0;

        const val = await this._mgPrompt({
          title: `Edit ${key}`,
          bodyHtml: `<label>Base ${key}: <input type="number" value="${current}" name="value" /></label>`,
          okText: "Save",
          okIcon: "fa-floppy-disk",
          cancelText: "Cancel",
          cancelIcon: "fa-circle-xmark",
          getValue: (html) => html.find('input[name="value"]').val()
        });

        if (val === null) return;

        const next = Number(val);
        if (!Number.isFinite(next)) {
          ui.notifications.warn("Please enter a valid number.");
          return;
        }

        await this.actor.update({ [`system.baseAttributes.${key}`]: next }, { render: false });

        // Reflect immediately in the open sheet (no re-render)
        el.setAttribute("data-base", String(next));
        el.textContent = next >= 0 ? `+${next}` : `${next}`;
      });

      // Rolling Attributes in chat with the right logic
      html.find(".attribute-modifier").on("click", async (event) => {
        const attrKey = event.currentTarget.dataset.key;
        const mod = this.actor.system.attributes?.[attrKey] ?? 0;

        const pool = 2 + Math.abs(mod);
        const rollType = mod >= 0 ? "kh2" : "kl2";
        const formula = `${pool}d6${rollType}`;

        const edge = !!this.actor.system.edgeNext;

        await evaluateRoll({
          formula,
          label: `Attribute Roll: ${attrKey.toUpperCase()}`,
          actor: this.actor,
          edge
        });

        // Consume Edge after the roll (one-and-done)
        if (edge) {
          await this.actor.update({ "system.edgeNext": false }, { render: false });
          const btn = html.find(".mg-edge-toggle")[0];
          if (btn) btn.classList.remove("is-active");
        }
      });


      // Handle disabling duplicate spark school selections
      const select1 = html.find("#spark-school-1");
      const select2 = html.find("#spark-school-2");

      // Update options to prevent duplicate selection
      function updateSparkOptions() {
        const val1 = select1.val();
        const val2 = select2.val();

        // Reset all options to enabled
        select1.find("option").prop("disabled", false);
        select2.find("option").prop("disabled", false);

        // Disable selected option in the opposite select
        if (val2) {
          select1.find(`option[value="${val2}"]`).prop("disabled", true);
        }
        if (val1) {
          select2.find(`option[value="${val1}"]`).prop("disabled", true);
        }
      }

      // Attach listeners
      select1.on("change", updateSparkOptions);
      select2.on("change", updateSparkOptions);

      // Run it once on render to sync state
      updateSparkOptions();

      //Adding Skill rolling logic based off Attributes + and adding Skill +
      const skillAttributeMap = {
        brawl: "tenacity", endure: "tenacity", athletics: "tenacity",
        aim: "finesse", stealth: "finesse", sleight: "finesse",
        will: "resolve", grit: "resolve", composure: "resolve",
        lore: "guile", investigate: "guile", deceive: "guile",
        survey: "instinct", hunt: "instinct", nature: "instinct",
        command: "presence", charm: "presence", perform: "presence",

        // Spark: still mapped for now until we implement Guise casting attribute
        spark: "guile"
      };


      const skillAttributeDisplay = {
        brawl: "Ten", endure: "Ten", athletics: "Ten",
        aim: "Fin", stealth: "Fin", sleight: "Fin",
        will: "Res", grit: "Res",
        lore: "Gui", investigate: "Gui", deceive: "Gui", spark: "Gui",
        survey: "Ins", hunt: "Ins", nature: "Ins",
        command: "Pre", charm: "Pre", perform: "Pre"
      };


      html.find(".skill-name, .skill-value").off("click.mgSkillRoll").on("click.mgSkillRoll", async (event) => {
        const skillKey = event.currentTarget.dataset.key;
        const skillMod = this.actor.system.skills?.[skillKey] ?? 0;

        const skillAttributeMap = {
          brawl: "tenacity", endure: "tenacity", athletics: "tenacity",
          aim: "finesse", stealth: "finesse", sleight: "finesse",
          will: "resolve", grit: "resolve", composure: "resolve",
          lore: "guile", investigate: "guile", deceive: "guile",
          survey: "instinct", hunt: "instinct", nature: "instinct",
          command: "presence", charm: "presence", perform: "presence",

          // Spark: still mapped for now until we implement Guise casting attribute
          spark: "guile"
        };


        let attrKey = skillAttributeMap[skillKey];

        // Spark is Guise-dependent
        if (skillKey === "spark") {
          attrKey = this.actor.system.sparkAttribute ?? "guile";
        }

        const attrMod = this.actor.system.attributes?.[attrKey] ?? 0;

        const pool = 2 + Math.abs(attrMod);
        const rollType = attrMod >= 0 ? "kh2" : "kl2";
        const formula = `${pool}d6${rollType}`;

        const edge = !!this.actor.system.edgeNext;

        await evaluateRoll({
          formula,
          skillMod,
          label: `Skill Roll: ${context.skillLabels?.[skillKey] ?? skillKey}`,
          actor: this.actor,
          edge
        });

        // Consume Edge after the roll (one-and-done)
        if (edge) {
          await this.actor.update({ "system.edgeNext": false }, { render: false });
          const btn = html.find(".mg-edge-toggle")[0];
          if (btn) btn.classList.remove("is-active");
        }
      });


      // Skill base edit (numeric-safe, manual UI refresh)
      html.find(".skill-value").on("contextmenu", async (event) => {
        event.preventDefault();

        const el   = event.currentTarget;
        const key  = el.dataset.key;
        const curr = Number(el.getAttribute("data-base")) || 0;

        const val = await this._mgPrompt({
          title: `Edit Skill: ${key}`,
          bodyHtml: `<label>${key}: <input type="number" value="${curr}" name="value" /></label>`,
          okText: "Save",
          okIcon: "fa-floppy-disk",
          cancelText: "Cancel",
          cancelIcon: "fa-circle-xmark",
          getValue: (html) => html.find('input[name="value"]').val()
        });

        if (val === null) return;

        const next = Number(val);
        if (!Number.isFinite(next)) {
          ui.notifications.warn("Please enter a valid number.");
          return;
        }

        // Save without rerender (prevents mobile jump)
        await this.actor.update({ [`system.skills.${key}`]: next }, { render: false });

        // Reflect immediately in the open sheet
        el.setAttribute("data-base", String(next));
        el.textContent = String(next);              // or: (next >= 0 ? `+${next}` : `${next}`)
      });

      // Setting values before Foundry Sheet refresh - Fixes Mortal and Soul Capacity
      html.find("input").on("keydown", async (event) => {
        if (event.key !== "Enter") return;

        const input = event.currentTarget;

        if (input.classList.contains("item-search")) return;

        const name  = input.name ?? "";
        const value = parseInt(input.value, 10);

        const updates = {};

        if (name === "system.strain.mortal capacity") {
          updates["system.strain.manualOverride.mortal capacity"] = true;
          updates["system.strain.mortal capacity"] = value;
        } else if (name === "system.strain.soul capacity") {
          updates["system.strain.manualOverride.soul capacity"] = true;
          updates["system.strain.soul capacity"] = value;
        }

        // If this input doesn't map to a known override, don't do anything
        if (Object.keys(updates).length === 0) return;

        event.preventDefault();

        await this.actor.update(updates, { render: false });
        this.render(false);
        input.blur();
      });


      // Handle quantity changes
      html.find(".item-quantity").on("change", async (event) => {
        const itemId = event.currentTarget.closest(".inventory-item").dataset.itemId;
        const quantity = parseInt(event.currentTarget.value);
        const item = this.actor.items.get(itemId);
        if (item) await item.update({ "system.quantity": quantity });
      });

      html.find(".item-equipped").on("change", async (event) => {
        const itemId = event.currentTarget.closest(".inventory-item").dataset.itemId;
        const equipped = event.currentTarget.checked;
        const item = this.actor.items.get(itemId);
        if (!item) return;

        await item.update({ "system.equipped": equipped });

        // Skip unless this item can grant capacity
        const grantsCapacity = ["armor", "misc"].includes(item.type) &&
          (item.system.mortalCapacity > 0 || item.system.soulCapacity > 0);
        if (!grantsCapacity) return;

        const { mortalCapacity = 0, soulCapacity = 0, capacityApplied = false } = item.system;

        console.log(`🛡️ Equip event for ${item.name}`);
        console.log("Equipped?", equipped, "| Already Applied?", capacityApplied);
        console.log("MC/SC Bonus from item:", mortalCapacity, soulCapacity);

        const currentMC = this.actor.system.strain["mortal capacity"] ?? 0;
        const currentSC = this.actor.system.strain["soul capacity"] ?? 0;

        if (equipped && !capacityApplied) {
          await this.actor.update({
            "system.strain.mortal capacity": currentMC + mortalCapacity,
            "system.strain.soul capacity": currentSC + soulCapacity,
            "system.strain.manualOverride.mortal capacity": true,
            "system.strain.manualOverride.soul capacity": true
          });

          await item.update({
            "system.capacityApplied": true,
            "system.remainingCapacity.mortal": mortalCapacity,
            "system.remainingCapacity.soul": soulCapacity
          });
        }

      });

      //Repair Armor
      html.find(".repair-armor").on("click", async (event) => {
        const itemId = event.currentTarget.dataset.itemId;
        const item = this.actor.items.get(itemId);
        const isRepairable = ["armor", "misc"].includes(item.type) &&
        (item.system.mortalCapacity > 0 || item.system.soulCapacity > 0);

        if (!isRepairable || !item.system.equipped) return;

        const {
          mortalCapacity = 0,
          soulCapacity = 0,
          remainingCapacity = { mortal: 0, soul: 0 }
        } = item.system;

        const remainingMC = remainingCapacity.mortal ?? 0;
        const remainingSC = remainingCapacity.soul ?? 0;

        const isDamaged = remainingMC < mortalCapacity || remainingSC < soulCapacity;
        if (!isDamaged) {
          ui.notifications.info(`${item.name} is already fully repaired.`);
          return;
        }

        // Restore armor’s own durability
        await item.update({
          "system.remainingCapacity.mortal": mortalCapacity,
          "system.remainingCapacity.soul": soulCapacity,
          "system.capacityApplied": false
        });

        ui.notifications.info(`${item.name} repaired. Durability restored.`);
      });

      //Remove item from Inventory
      html.find(".item-delete").on("click", async (event) => {
        const itemId = event.currentTarget.dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;

        const confirmed = await Dialog.wait({
          title: `Delete ${item.name}?`,
          content: `
            <h2>Delete ${item.name}?</h2>
            <p>Are you sure you want to permanently delete <strong>${item.name}</strong> from your inventory?</p>
          `,
          buttons: {
            yes: { label: this._mgBtn("Delete", "fa-trash"), callback: () => true },
            no:  { label: this._mgBtn("Cancel", "fa-circle-xmark"), callback: () => false }
          },
          default: "no"
        });

        if (confirmed) {
          await item.delete();
        }
      });

      // Posting Inventory Items to Chat (Weapons / Armor / Misc) via header click
      html.find(".tab-inventory .post-item").on("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        // Resolve item from the header or parent card
        const header   = event.currentTarget;
        const itemId   = header.dataset.itemId
          || header.closest(".inventory-item")?.dataset?.itemId;
        const item     = this.actor.items.get(itemId);
        if (!item) return;

        const { name, system, type } = item;

        // Safe HTML escape for labels/ids
        const safe = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
          ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])
        );

        // Merge all known tag definitions so we get labels + descriptions
        const allDefs = [
          ...(CONFIG.MidnightGambit?.ITEM_TAGS   ?? []),
          ...(CONFIG.MidnightGambit?.WEAPON_TAGS ?? []),
          ...(CONFIG.MidnightGambit?.ARMOR_TAGS  ?? []),
          ...(CONFIG.MidnightGambit?.MISC_TAGS   ?? [])
        ];

        const tagData = (system.tags || [])
          .map(tagId => {
            const def   = allDefs.find(t => t.id === tagId);
            const label = def?.label || tagId;
            const desc  = def?.description || "";
            return `<span class="item-tag tag" data-tag-id="${safe(tagId)}" title="${safe(desc)}">${safe(label)}</span>`;
          })
          .join(" ");

        let extraInfo = "";

        // Weapon: Strain Damage (Mortal/Soul, with legacy fallback)
        if (type === "weapon") {
          const mortal = Number(system.mortalStrainDamage ?? system.strainDamage ?? 0);
          const soul   = Number(system.soulStrainDamage ?? 0);

          if (mortal || soul) {
            extraInfo += `
              <label>Strain Damage</label>
              <div class="bubble-wrapper">
                ${mortal ? `
                  <p class="strain-bubble">
                    <i class="fa-solid fa-dagger"></i>
                    <span class="remaining-number">${mortal}</span>
                  </p>` : ""
                }
                ${soul ? `
                  <p class="strain-bubble">
                    <i class="fa-solid fa-moon-over-sun"></i>
                    <span class="remaining-number">${soul}</span>
                  </p>` : ""
                }
              </div>`;
          }
        }


        // Armor: MC / SC
        if (type === "armor") {
          const mc = system.mortalCapacity ?? 0;
          const sc = system.soulCapacity ?? 0;
          if (mc || sc) {
            extraInfo += `
              <label>Capacity</label>
              <div class="bubble-wrapper">
                <p class="strain-bubble">
                  <i class="fa-solid fa-dagger"></i>
                  <span class="remaining-number">${mc}</span>
                </p>
                <p class="strain-bubble">
                  <i class="fa-solid fa-moon-over-sun"></i>
                  <span class="remaining-number">${sc}</span>
                </p>
              </div>`;
          }
        }

        // Misc: Strain Damage + Capacity
        if (type === "misc") {
          const mortalSD = Number(system.mortalStrainDamage ?? system.strainDamage ?? 0);
          const soulSD   = Number(system.soulStrainDamage ?? 0);

          if (mortalSD || soulSD) {
            extraInfo += `
              <label>Strain Damage</label>
              <div class="bubble-wrapper">
                ${mortalSD ? `
                  <p class="strain-bubble">
                    <i class="fa-solid fa-dagger"></i>
                    <span class="remaining-number">${mortalSD}</span>
                  </p>` : ""
                }
                ${soulSD ? `
                  <p class="strain-bubble">
                    <i class="fa-solid fa-moon-over-sun"></i>
                    <span class="remaining-number">${soulSD}</span>
                  </p>` : ""
                }
              </div>`;
          }

          const mc = Number(system.mortalCapacity ?? 0);
          const sc = Number(system.soulCapacity ?? 0);
          if (mc || sc) {
            extraInfo += `
              <label>Capacity</label>
              <div class="bubble-wrapper">
                ${mc ? `
                  <p class="strain-bubble">
                    <i class="fa-solid fa-dagger"></i>
                    <span class="remaining-number">${mc}</span>
                  </p>` : ""
                }
                ${sc ? `
                  <p class="strain-bubble">
                    <i class="fa-solid fa-moon-over-sun"></i>
                    <span class="remaining-number">${sc}</span>
                  </p>` : ""
                }
              </div>`;
          }
        }


        // Enrich the TinyMCE HTML for chat so formatting (lists, bold, etc.) is preserved
        const descHtml = system.description
          ? await TextEditor.enrichHTML(String(system.description ?? ""), { async: true, secrets: false })
          : "";

        const content = `
          <div class="chat-item">
            <h2><i class="fa-solid fa-shield"></i> ${safe(name)}</h2>
            ${descHtml ? `<div class="chat-item-desc">${descHtml}</div>` : ""}
            ${extraInfo}
            ${tagData ? `<strong>Tags:</strong><div class="chat-tags">${tagData}</div>` : ""}
          </div>
        `;

        await ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor: this.actor }),
          content
        });

        // Re-apply tooltips as a safety net
        html.find(".item-tag").each(function () {
          const tooltip = this.dataset.tooltip;
          if (tooltip) this.setAttribute("title", tooltip);
        });
      });

      // Inventory Search (character sheet)
      {
        const $root = html instanceof jQuery ? html : $(html);
        const $tab  = $root.find(".tab-inventory");

        if (!$tab.length) return;

        const STAGGER_STEP_MS = 80;   // delay between each card's enter
        const STAGGER_COUNT   = 3;    // how many cards get staggered
        const DEBOUNCE_MS     = 220;
        const LEAVE_MS        = 500;  // must match your CSS transition time

        const debounce = (fn, wait = DEBOUNCE_MS) => {
          let t;
          return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), wait);
          };
        };

        // Decide if a given inventory card matches the query
        const cardMatches = (el, q) => {
          const norm = (s) => String(s ?? "").toLowerCase();

          // We prefer .name (h3.name) like the Crew Assets,
          // but fall back to any .clickable-item text just in case.
          const nameEl =
            el.querySelector(".name") ||
            el.querySelector(".clickable-item");
          const name  = norm(nameEl?.textContent || "");

          // Tags: either .item-tags or generic .tags wrapper
          const tagsEl =
            el.querySelector(".item-tags") ||
            el.querySelector(".tags");
          const tags = norm(tagsEl?.textContent || "");

          // Optional notes/description area if you wire that up later
          const notesEl = el.querySelector(".notes");
          const notes   = norm(notesEl?.textContent || "");

          return !q || name.includes(q) || tags.includes(q) || notes.includes(q);
        };

        // Animate a card entering (visible)
        const enterCard = (el, idx = 0) => {
          el.classList.remove("is-entering", "is-leaving", "pre-enter");

          // If it's currently visible, briefly hide to restart animation
          if (!el.classList.contains("is-hidden")) {
            el.classList.add("is-hidden");
            // force reflow so the browser sees the class change
            // eslint-disable-next-line no-unused-expressions
            el.offsetHeight;
          }

          el.classList.remove("is-hidden");
          el.classList.add("pre-enter");
          // another reflow to lock in starting state
          // eslint-disable-next-line no-unused-expressions
          el.offsetHeight;

          const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
          const slot   = Math.min(idx, STAGGER_COUNT - 1);
          const delay  = reduce ? 0 : slot * STAGGER_STEP_MS;
          el.style.transitionDelay = `${delay}ms`;

          requestAnimationFrame(() => {
            el.classList.add("is-entering");
            const onEnd = (e) => {
              if (e && e.target !== el) return;
              el.classList.remove("is-entering", "pre-enter");
              el.style.transitionDelay = "";
              el.removeEventListener("transitionend", onEnd);
            };
            el.addEventListener("transitionend", onEnd, { once: true });
          });
        };

        // Animate a card leaving (fading out + sliding down)
        const leaveCard = (el) => {
          el.classList.remove("is-entering", "pre-enter");
          el.style.transitionDelay = "";
          if (el.classList.contains("is-hidden")) return;
          el.classList.add("is-leaving");
        };

        // Show / hide the "no results" message
        const showEmpty = (show) => {
          const empty =
            $tab.find(".inventory-search-empty")[0] ||
            $tab.find(".inventory-empty")[0];
          if (!empty) return;
          empty.style.display = show ? "block" : "none";
        };

        // Core search routine (no events, just logic)
        const runSearchNow = () => {
          const input = $tab.find(".item-search")[0];
          const q = (input?.value || "").toLowerCase().trim();

          // Support both .inventory-card and legacy .inventory-item classes
          const cards = $tab.find(".inventory-card, .inventory-item").toArray();
          const matchSet = new Set(cards.filter((el) => cardMatches(el, q)));

          // Start the leave animation for everything
          for (const el of cards) leaveCard(el);

          // After leave animation finishes, finalize which ones show / hide
          setTimeout(() => {
            let hits = 0;
            let enterIndex = 0;

            for (const el of cards) {
              const isMatch = matchSet.has(el);
              el.classList.remove("is-leaving");
              if (isMatch) {
                hits++;
                enterCard(el, enterIndex++);
              } else {
                el.classList.add("is-hidden");
              }
            }

            showEmpty(hits === 0 && !!q);
          }, LEAVE_MS);
        };

        const runSearch = debounce(runSearchNow, DEBOUNCE_MS);

        // ----- Event wiring: Enter key + Search + Reset -----

        // Enter in the search input
        $root
          .off("keydown.mgInvSearchEnter")
          .on("keydown.mgInvSearchEnter", ".tab-inventory .item-search", (ev) => {
            if (ev.key !== "Enter") return;
            ev.preventDefault();
            ev.stopPropagation();
            ev.stopImmediatePropagation();
            runSearch();
          });

        // Click the Search button
        $root
          .off("click.mgInvSearchBtn")
          .on("click.mgInvSearchBtn", ".tab-inventory .item-search-btn", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            ev.stopImmediatePropagation();
            runSearch();
          });

        // Click the Reset button
        $root
          .off("click.mgInvSearchReset")
          .on("click.mgInvSearchReset", ".tab-inventory .item-search-reset", (ev) => {
            ev.preventDefault();

            const input = $tab.find(".item-search")[0];
            if (input) input.value = "";

            showEmpty(false);

            const cards = $tab.find(".inventory-card, .inventory-item").toArray();
            for (const el of cards) leaveCard(el);

            setTimeout(() => {
              let idx = 0;
              for (const el of cards) {
                el.classList.remove("is-leaving");
                enterCard(el, idx++);
              }
            }, LEAVE_MS);
          });

        // Initial state: everything visible, no animations, no empty message
        const initialCards = $tab.find(".inventory-card, .inventory-item").toArray();
        for (const el of initialCards) {
          el.classList.remove("is-hidden", "is-entering", "is-leaving", "pre-enter");
          el.style.transitionDelay = "";
        }
        showEmpty(false);
      }

      // "See All / See Less" for inventory cards
      // Uniform collapsed height + infinite expand/collapse using CSS transition on max-height
      {
        const $root = html instanceof jQuery ? html : $(html);

        const DEFAULT_CAP   = 340; // px fallback if no data-seeall-cap
        const TRANSITION_MS = 500; // match your CSS max-height transition (~.5s)

        // Capture-phase listener to bump card height even if inner toggles stopPropagation()
        {
          const rootEl = $root[0];
          if (rootEl) {
            // Remove prior copy if this sheet re-renders
            if (rootEl._mgInvCardBumpCapture) {
              rootEl.removeEventListener("click", rootEl._mgInvCardBumpCapture, true);
            }

            rootEl._mgInvCardBumpCapture = (ev) => {
              const btn = ev.target?.closest?.(
                ".tab-inventory .mg-seeall-toggle, .tab-inventory .tags-toggle"
              );
              if (!btn) return;

              const card = btn.closest(".inventory-item.mg-card-wrap, .inventory-card.mg-card-wrap");
              if (!card) return;

              // Let the inner toggle update its own max-height first, then measure
              setTimeout(() => bumpExpandedCard(card), 0);
            };

            rootEl.addEventListener("click", rootEl._mgInvCardBumpCapture, true);
          }
        }

        // Initialize all inventory cards to the same collapsed height
        const initCards = () => {
          const cards =
            $root[0]?.querySelectorAll(
              ".tab-inventory .inventory-item.mg-card-wrap, .tab-inventory .inventory-card.mg-card-wrap"
            ) || [];

          cards.forEach((card) => {
            const capAttr = Number(card.dataset.seeallCap) || DEFAULT_CAP;
            card.dataset.mgCollapsedPx = String(capAttr);

            // If not expanded, force the collapsed height so they all match
            if (!card.classList.contains("expanded")) {
              card.style.overflow = "hidden";
              card.style.maxHeight = `${capAttr}px`;
            } else {
              // If somehow already expanded on render, lock it to its real height
              card.style.overflow = "visible";
              card.style.maxHeight = `${card.scrollHeight}px`;
            }

            const icon = card.querySelector(".card-seeall-toggle i");
            if (icon) icon.classList.toggle("rotated", card.classList.contains("expanded"));
          });
        };

        // While a card is expanded, its contents (Description/Notes toggles) can change height.
        // This bumps the card's maxHeight to match so it "grows" instead of overflowing/clipping.
        const bumpExpandedCard = (card) => {
          if (!card?.classList?.contains("expanded")) return;
          // lock current px, then animate to new scrollHeight
          const start = Math.ceil(card.getBoundingClientRect().height);
          const target = card.scrollHeight;

          card.style.overflow = "hidden";
          card.style.maxHeight = `${start}px`;
          // force reflow
          // eslint-disable-next-line no-unused-expressions
          card.offsetHeight;

          card.style.maxHeight = `${target}px`;

          // once it settles, allow overflow visible again (but KEEP a px maxHeight!)
          setTimeout(() => {
            if (!card.classList.contains("expanded")) return;
            card.style.overflow = "visible";
            card.style.maxHeight = `${card.scrollHeight}px`;
          }, TRANSITION_MS + 50);
        };

        const toggleCard = (btn) => {
          const card = btn.closest(".inventory-item.mg-card-wrap, .inventory-card.mg-card-wrap");
          if (!card) return;

          const icon        = btn.querySelector("i");
          const collapsedPx = Number(card.dataset.mgCollapsedPx) || DEFAULT_CAP;
          const isExpanded  = card.classList.contains("expanded");

          if (!isExpanded) {
            // ===== EXPAND (collapsed px -> full px) =====
            const start  = Math.ceil(card.getBoundingClientRect().height) || collapsedPx;
            const target = card.scrollHeight;

            card.style.overflow  = "hidden";
            card.style.maxHeight = `${start}px`;
            // force reflow
            // eslint-disable-next-line no-unused-expressions
            card.offsetHeight;

            card.style.maxHeight = `${target}px`;
            card.classList.add("expanded");
            if (icon) icon.classList.add("rotated");

            // After expand completes: allow overflow, but KEEP a pixel maxHeight so collapse can animate later
            setTimeout(() => {
              if (!card.classList.contains("expanded")) return;
              card.style.overflow = "visible";
              card.style.maxHeight = `${card.scrollHeight}px`;
            }, TRANSITION_MS + 50);

            return;
          }

          // ===== COLLAPSE (full px -> collapsed px) =====
          // Critical: establish a *pixel* start height (NOT "auto") so CSS can animate.
          const start = Math.ceil(card.getBoundingClientRect().height) || card.scrollHeight;

          card.style.overflow  = "hidden";
          card.style.maxHeight = `${start}px`;

          // force reflow so the browser commits the start value
          // eslint-disable-next-line no-unused-expressions
          card.offsetHeight;

          // animate down
          card.style.maxHeight = `${collapsedPx}px`;
          card.classList.remove("expanded");
          if (icon) icon.classList.remove("rotated");

          // keep the clamp in collapsed state
          setTimeout(() => {
            if (card.classList.contains("expanded")) return;
            card.style.overflow = "hidden";
            card.style.maxHeight = `${collapsedPx}px`;
          }, TRANSITION_MS + 50);
        };

        $root
          .off("click.mgInvCardToggle")
          .on("click.mgInvCardToggle", ".tab-inventory .card-seeall-toggle", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            toggleCard(ev.currentTarget);

            // After expand/collapse, re-measure inner Description/Notes so chevrons appear correctly
            setTimeout(() => {
              $root[0]?._mgInvRefreshInnerSeeAll?.();
            }, 0);
          });


        // When Description/Notes expands/collapses inside a card, bump the card height if it’s expanded
        $root
          .off("click.mgInvCardInnerBump")
          .on("click.mgInvCardInnerBump", ".tab-inventory .mg-seeall-toggle", (ev) => {
            const card = ev.currentTarget.closest(".inventory-item.mg-card-wrap, .inventory-card.mg-card-wrap");
            if (!card) return;
            // let the inner seeall logic run first, then measure
            setTimeout(() => bumpExpandedCard(card), 0);
          });

        initCards();
      }

      // Inventory Tag Overflow (character sheet – same behavior as Crew Assets)
      {
        const $root = html instanceof jQuery ? html : $(html);

        const COLLAPSED_MAX = 80;   // px of tag-stack height before clamping
        const TRANSITION_MS = 500;  // keep in sync with your CSS transition

        // Allow per-wrapper override, else fallback
        const capFor = (wrap) => Number(wrap?.dataset?.seeallCap) || COLLAPSED_MAX;


        // Measure one wrapper and decide if it needs a toggle
        const updateOne = (wrap) => {
          if (!wrap || wrap.classList.contains("animating")) return;

          const content = wrap.querySelector(".mg-seeall-content");
          const toggle  = wrap.querySelector(".mg-seeall-toggle");
          if (!content || !toggle) return;

          const cap        = capFor(wrap);
          const isExpanded = wrap.classList.contains("expanded");
          const overflows  = content.scrollHeight > (cap + 1);

          wrap.classList.toggle("short", !overflows);

          toggle.hidden = !overflows;

          if (!toggle.querySelector("i")) {
            toggle.innerHTML = '<i class="fa-solid fa-angle-down"></i>';
          }

          toggle.querySelector("i")?.classList.toggle("rotated", isExpanded);

          // Clamp only when collapsed AND overflowing
          if (!isExpanded && overflows) {
            content.style.maxHeight = `${cap}px`;
          } else {
            content.style.maxHeight = "";
          }
        };

        const refreshAll = () => {
          const wraps = $root[0]?.querySelectorAll(".tab-inventory .tags-wrap") || [];
          wraps.forEach(updateOne);
        };

        // Click handler for the chevron on the inventory tab
        $root
          .off("click.mgInvTagsToggle")
          .on("click.mgInvTagsToggle", ".tab-inventory .tags-toggle", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            const wrap = ev.currentTarget.closest(".tags-wrap");
            const tags =
              wrap?.querySelector(".item-tags") ||
              wrap?.querySelector(".tags");
            const icon = ev.currentTarget.querySelector("i");
            if (!wrap || !tags) return;

            const wasExpanded = wrap.classList.contains("expanded");
            const startHeight = tags.clientHeight;

            // Target height: full scroll height if expanding, clamped if collapsing
            const targetHeight = wasExpanded
              ? COLLAPSED_MAX
              : Math.max(tags.scrollHeight, startHeight);

            // Prepare animation: set current height, then animate to target
            tags.style.maxHeight = `${startHeight}px`;
            // force reflow
            // eslint-disable-next-line no-unused-expressions
            tags.offsetHeight;
            tags.style.maxHeight = `${targetHeight}px`;

            wrap.classList.add("animating");
            wrap.classList.toggle("expanded", !wasExpanded);
            if (icon) icon.classList.toggle("rotated", !wasExpanded);

            const onEnd = (e) => {
              if (e && e.target !== tags) return;

              tags.removeEventListener("transitionend", onEnd);
              wrap.classList.remove("animating");

              // When collapsed, keep the clamp; when expanded, let it auto-size
              if (wrap.classList.contains("expanded")) {
                tags.style.maxHeight = "";
              } else if (tags.scrollHeight > COLLAPSED_MAX + 1) {
                tags.style.maxHeight = `${COLLAPSED_MAX}px`;
              } else {
                tags.style.maxHeight = "";
              }

              updateOne(wrap);
            };

            tags.addEventListener("transitionend", onEnd, { once: true });

            // Failsafe in case transitionend doesn’t fire
            setTimeout(onEnd, TRANSITION_MS + 100);
          });

        // Initial measurement when the sheet renders
        refreshAll();
      }

      // Description / Notes inner "See All" (mg-seeall-wrap)
      {
        const $root = html instanceof jQuery ? html : $(html);

        const DEFAULT_CAP   = 140;  // px fallback if data-seeall-cap is missing
        const TRANSITION_MS = 500;  // keep in sync with CSS max-height transition

        const setupOne = (wrap) => {
          if (!wrap) return;

          const capAttr  = Number(wrap.dataset.seeallCap) || DEFAULT_CAP;
          const content  = wrap.querySelector(".mg-seeall-content");
          const toggle   = wrap.querySelector(".mg-seeall-toggle");
          if (!content || !toggle) return;

          const overflows = content.scrollHeight > (capAttr + 1);

          // Hide toggle if no overflow, remove clamp
          wrap.classList.toggle("short", !overflows);

          if (!toggle.querySelector("i")) {
            toggle.innerHTML = '<i class="fa-solid fa-angle-down"></i>';
          }
          const icon = toggle.querySelector("i");

          const expanded = wrap.classList.contains("expanded");

          if (!expanded && overflows) {
            content.style.maxHeight = `${capAttr}px`;
          } else {
            content.style.maxHeight = "";
          }

          if (icon) icon.classList.toggle("rotated", expanded);
        };

        const refreshAll = () => {
          const wraps =
            $root[0]?.querySelectorAll('.tab[data-tab="inventory"] .mg-seeall-wrap, .tab.inventory .mg-seeall-wrap') || [];

          wraps.forEach(setupOne);
        };
        
        // expose for other listeners (like card expand)
        $root[0]._mgInvRefreshInnerSeeAll = refreshAll;

        $root
          .off("click.mgInnerSeeall")
          .on("click.mgInnerSeeall", '.tab[data-tab="inventory"] .mg-seeall-toggle, .tab.inventory .mg-seeall-toggle', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            const wrap = ev.currentTarget.closest(".mg-seeall-wrap");
            const content = wrap?.querySelector(".mg-seeall-content");
            const icon = ev.currentTarget.querySelector("i");
            if (!wrap || !content) return;

            const capAttr    = Number(wrap.dataset.seeallCap) || DEFAULT_CAP;
            const wasExpanded = wrap.classList.contains("expanded");

            const startHeight = content.clientHeight;
            const targetHeight = wasExpanded
              ? capAttr
              : Math.max(content.scrollHeight, startHeight);

            // Start from current height
            content.style.maxHeight = `${startHeight}px`;
            // force reflow so browser commits it
            // eslint-disable-next-line no-unused-expressions
            content.offsetHeight;
            content.style.maxHeight = `${targetHeight}px`;

            wrap.classList.add("animating");
            wrap.classList.toggle("expanded", !wasExpanded);
            if (icon) icon.classList.toggle("rotated", !wasExpanded);

            const onEnd = (e) => {
              if (e && e.target !== content) return;

              content.removeEventListener("transitionend", onEnd);
              wrap.classList.remove("animating");

              const nowExpanded = wrap.classList.contains("expanded");

              if (nowExpanded) {
                // Let it auto-size after the expand transition
                content.style.maxHeight = "";
              } else {
                // Re-apply clamp if it still overflows
                if (content.scrollHeight > capAttr + 1) {
                  content.style.maxHeight = `${capAttr}px`;
                } else {
                  content.style.maxHeight = "";
                }
              }
            };

            content.addEventListener("transitionend", onEnd, { once: true });
            setTimeout(onEnd, TRANSITION_MS + 100); // failsafe
          });

        // Initial clamp / toggle visibility on render
        refreshAll();
      }

      // Enable tooltips manually after rendering the sheet
      html.find(".sync-tags").on("click", async (event) => {
        event.preventDefault();

        const itemId = event.currentTarget.dataset.itemId;
        const ownedItem = this.actor.items.get(itemId);
        if (!ownedItem) return;

        // Step 1: Try sourceId first
        let sourceItem = null;
        const sourceId = ownedItem.flags?.core?.sourceId;

        if (sourceId) {
          sourceItem = game.items.get(sourceId);
        }

        // Step 2: Fallback — find item in world by name
        if (!sourceItem) {
          sourceItem = game.items.find(i => i.name === ownedItem.name && i.type === ownedItem.type);
        }

        if (!sourceItem) {
          ui.notifications.warn(`Could not find base item for ${ownedItem.name}`);
          return;
        }

        // Merge tags
        const ownedTags = ownedItem.system.tags ?? [];
        const sourceTags = sourceItem.system.tags ?? [];

        const allTags = [...new Set([...ownedTags, ...sourceTags])];

        await ownedItem.update({ "system.tags": allTags });

        ui.notifications.info(`${ownedItem.name} tags synced from base item.`);
      });

      //Right click to remove tag from character sheet
      html.find(".item-tag").on("contextmenu", async (event) => {
        event.preventDefault();

        const $tag = $(event.currentTarget);
        const itemId = $tag.data("item-id");
        const tagId = $tag.data("tag-id");

        const item = this.actor.items.get(itemId);
        if (!item) return;

        const currentTags = item.system.tags || [];
        const updatedTags = currentTags.filter(t => t !== tagId);

        await item.update({ "system.tags": updatedTags });

        ui.notifications.info(`Removed tag '${tagId}' from ${item.name}`);
      });

      //Reset Gambit Button - like a long rest but for deck
      html.find(".reset-gambit-deck").on("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        // Avoid double-fires while dialog is open
        const btn = ev.currentTarget;
        btn.disabled = true;

        try {
          const ok = await Dialog.wait({
            title: "Reset Gambit Deck?",
            content: `
              <p>This returns all drawn and discarded Gambits to your Deck and clears your hand.</p>
            `,
            buttons: {
              yes: { label: this._mgBtn("Reset", "fa-arrows-rotate"), callback: () => true },
              no:  { label: this._mgBtn("Cancel", "fa-circle-xmark"), callback: () => false }
            },
            default: "yes"
          });

          if (!ok) return; // user cancelled — do nothing

          const g = this.actor.system.gambits ?? {};
          const deck    = Array.isArray(g.deck)    ? g.deck    : [];
          const drawn   = Array.isArray(g.drawn)   ? g.drawn   : [];
          const discard = Array.isArray(g.discard) ? g.discard : [];

          // Put everything back into deck (dedup), clear piles
          const newDeck = Array.from(new Set([...deck, ...drawn, ...discard]));

          await this.actor.update({
            "system.gambits.deck": newDeck,
            "system.gambits.drawn": [],
            "system.gambits.discard": [],
            "system.gambits.locked": false
          });

          // Optional: notify and soft re-render
          ui.notifications.info("Gambit deck reset.");
          this.render(false);
        } finally {
          btn.disabled = false;
        }
      });

      // Post Gambit into Game chat
      html.find(".post-gambit").on("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const itemId = event.currentTarget.dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;

        await this._mgPostGambitToChat(item);
      });

      // Play Gambit (post + discard)
      html.find(".play-gambit").on("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const itemId = event.currentTarget.dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;

        await this._mgPostGambitToChat(item);

        // Discard after playing
        const { drawn = [], discard = [] } = this.actor.system.gambits;
        const updatedDrawn = drawn.filter(id => id !== itemId);
        const updatedDiscard = [...discard, itemId];

        await this.actor.update({
          "system.gambits.drawn": updatedDrawn,
          "system.gambits.discard": updatedDiscard
        });
      });

      /** Utility: render a clean chat card for a Gambit item */
      async function postGambitToChat(actor, itemId) {
        const item = actor.items.get(itemId);
        if (!item) throw new Error(`No item ${itemId} on actor ${actor.name}`);

        // Local HTML escaper (Foundry-safe across versions)
        const escapeHtml = (str) =>
          String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");

        const content = `
          <div class="mg-chat-card gambit-card">
            <header class="mg-card-header">
              <h3 class="mg-card-title"><i class="fa-solid fa-cards"></i> ${escapeHtml(item.name)}</h3>
            </header>
            <section class="mg-card-body">
              ${item.system?.description ?? ""}
            </section>
          </div>
        `;

        return ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          content,
          type: CONST.CHAT_MESSAGE_TYPES.OTHER
        });
      }

      /** Fallback discard helper (only used if no .discard-card button found) */
      async function discardGambitById(actor, itemId) {
        // Many systems keep piles in flags or system data. If you already have a
        // dedicated discard function, use that instead of this placeholder.

        // Example approach if you store drawn/deck/discard arrays on actor.system.gambits:
        const sys = actor.system;
        const drawn = Array.isArray(sys.gambits?.drawn) ? [...sys.gambits.drawn] : [];
        const discard = Array.isArray(sys.gambits?.discard) ? [...sys.gambits.discard] : [];

        const idx = drawn.findIndex(g => g._id === itemId || g.id === itemId || g === itemId);
        if (idx !== -1) {
          const card = drawn.splice(idx, 1)[0];
          discard.push(card);
          await actor.update({
            "system.gambits.drawn": drawn,
            "system.gambits.discard": discard
          });
        } else {
          // If your hand stores just IDs and not full objects, adjust accordingly:
          // 1) remove the id from drawn
          // 2) push the id into discard
          console.warn(`[MG] discardGambitById: card not found in drawn for ${itemId}`);
        }
      }


      //Gambit hand at bottom of the screen styling
      html.find(".gambit-hand-card").on("click", async (event) => {
        const itemId = event.currentTarget.dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;

        // 1. Post to chat
        await ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor: this.actor }),
          content: `<h2><i class="fa-solid fa-cards"></i> ${item.name}</h2><p>${item.system.description}</p>`
        });

        // 2. Remove from drawn, add to discard
        const { drawn = [], discard = [] } = this.actor.system.gambits;

        const updatedDrawn = drawn.filter(id => id !== itemId);
        const updatedDiscard = [...discard, itemId];

        await this.actor.update({
          "system.gambits.drawn": updatedDrawn,
          "system.gambits.discard": updatedDiscard
        });
      });

      /* SETTINGS TAB: Level Up / Undo
      ----------------------------------------------------------------------*/
      {
        const actor = this.actor;

        // Guard: if methods are missing, don’t attach handlers (prevents cryptic errors)
        const hasLevelUp = typeof actor?.mgLevelUp === "function";
        const hasUndo    = typeof actor?.mgUndoLastLevel === "function";
        if (!hasLevelUp || !hasUndo) {
          console.warn("MG | Level methods missing on actor. Did actor.js load?", { hasLevelUp, hasUndo });
        }

        // Ensure we don’t double-bind if the sheet re-renders
        html.find(".mg-level-up").off("click.mg");
        html.find(".mg-undo-level").off("click.mg");

        html.find(".mg-level-up").on("click.mg", async (ev) => {
          ev.preventDefault();
          if (!hasLevelUp) return ui.notifications.warn("Level Up not available (actor missing mgLevelUp).");
          try {
            await actor.mgLevelUp({ guided: false });
            this._openLevelWizard(); // pop the stepper after the level-up
          } catch (err) {
            console.error("MG | Level Up error:", err);
            ui.notifications.error("Level Up failed. See console for details.");
          }
        });

        html.find(".mg-undo-level").on("click.mg", async (ev) => {
          ev.preventDefault();
          if (!hasUndo) return ui.notifications.warn("Undo not available (actor missing mgUndoLastLevel).");
          try {
            await actor.mgUndoLastLevel();
          } catch (err) {
            console.error("MG | Undo Level error:", err);
            ui.notifications.error("Undo failed. See console for details.");
          }
        });
      }

      /* Reading if the level is minimum or maximum and disabling buttons if so
      ----------------------------------------------------------------------*/
      (async () => {
        try {
          const lvl = Number(this.actor.system?.level) || 1;
          const levels = CONFIG.MidnightGambit?.LEVELS ?? {};
          const maxLvl = Math.max(...Object.keys(levels).map(n => Number(n) || 0), 1);

          const state = await this.actor.getFlag("midnight-gambit", "state");
          const hasHistory = Array.isArray(state?.levelHistory) && state.levelHistory.length > 0;

          const $up   = html.find(".mg-level-up");
          const $undo = html.find(".mg-undo-level");

          const upDisabled = lvl >= maxLvl;
          const undoDisabled = false; // set to !hasHistory if you want hard-disable

          $up
            .prop("disabled", upDisabled)
            .toggleClass("disabled", upDisabled)
            .attr("title", upDisabled ? "Already at max level" : "Level Up");

          // If you prefer Undo to look disabled when nothing to undo, uncomment:
          // $undo
          //   .prop("disabled", undoDisabled)
          //   .toggleClass("disabled", undoDisabled)
          //   .attr("title", undoDisabled ? "Nothing to undo" : "Undo Last Level");
        } catch (e) {
          console.warn("MG | Could not update Level Up / Undo button state:", e);
        }

        /* Show "Unspent Level Rewards" banner in Settings tab
        ----------------------------------------------------------------------*/
        {
          const state = await this.actor.getFlag("midnight-gambit", "state");
          const p = state?.pending || {};
          const hasPending = Object.values(p).some(n => Number(n) > 0);

          // 1) Glow + tiny badge on the Settings tab button (always update)
          const navBtn = html.find('nav.sheet-tabs [data-tab="settings"]');
          if (navBtn.length) {
            // Remove any previous badge
            navBtn.find(".mg-pending-badge").remove();

            // Toggle the glow
            navBtn.toggleClass("mg-pending-glow", hasPending);

            // Add a small badge with the total pending, if any
            if (hasPending) {
              const totalPending = Object.values(p).reduce((a, n) => a + (Number(n) || 0), 0);
              navBtn.append(`<span class="mg-pending-badge" aria-hidden="true">${totalPending}</span>`);
            }
          }

          // 2) Banner inside the Settings tab content (create or remove)
          const settingsTab = html.find('.tab.settings-tab[data-tab="settings"]');
          if (settingsTab.length) {
            // Always clear any old banner
            settingsTab.find(".mg-pending-banner").remove();

            // Only show if there are pending rewards AND a guise is attached
            const hasGuise = !!this.actor.system.guise;
            if (hasPending && hasGuise) {
              settingsTab.append(`
                <div class="mg-pending-banner mg-pending-glow">
                  <h2><i class="fa-solid fa-wand-magic-sparkles"></i> Unspent Level Rewards</h2>
                  <button type="button" class="mg-open-level-wizard">Review & Spend <i class="fa-solid fa-arrow-right"></i></button>
                </div>
              `);
            }
          }

          // 3) Wire up the button if present
          html.find(".mg-open-level-wizard").off("click.mg").on("click.mg", (e) => {
            e.preventDefault();
            this._openLevelWizard();
          });
        }
      })();

      // Post move to chat on header click
      html.find(".move-card .move-name").click(ev => {
        const li = $(ev.currentTarget).closest(".move-card");
        const item = this.actor.items.get(li.data("itemId"));
        item?.toChat();
      });


      /* Learned Moves drop zone hover
      ----------------------------------------------------------------------*/
      {
        const $zone = html.find(".moves-section");
        if ($zone.length) {
          $zone.on("dragenter dragover", (e) => {
            e.preventDefault();
            e.stopPropagation();
            $zone.addClass("drag-hover");
          });
          $zone.on("dragleave", (e) => {
            if (!$zone[0].contains(e.relatedTarget)) {
              $zone.removeClass("drag-hover");
            }
          });
          $zone.on("drop", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            $zone.removeClass("drag-hover");
            // Forward to Foundry’s drop handling → calls our _onDropItemCreate above
            return this._onDrop(e.originalEvent);
          });
        }
      }

      /* Auto-spend pending Move when one is added
      ----------------------------------------------------------------------*/
      Hooks.on("createItem", async (item, options, userId) => {
        try {
          const actor = item?.parent;
          if (!(actor instanceof Actor)) return;
          if (item.type !== "move") return;

          // Only if there are pending moves
          const state = (await actor.getFlag("midnight-gambit", "state")) ?? {};
          const pendingMoves = Number(state?.pending?.moves ?? 0);
          if (pendingMoves <= 0) return;

          // Make sure the move is flagged as learned
          if (!item.system?.learned) {
            await item.update({ "system.learned": true });
          }

          // Spend one pending move
          if (typeof actor.mgSpendPending === "function") {
            await actor.mgSpendPending("move", { itemId: item.id });
          } else {
            // fallback raw decrement
            const p = { ...(state.pending ?? {}) };
            p.moves = Math.max(0, p.moves - 1);
            await actor.setFlag("midnight-gambit", "state", { ...state, pending: p });
          }

          // Soft refresh the actor’s sheet(s)
          for (const appId of Object.keys(actor.apps ?? {})) {
            actor.apps[appId]?.render(false);
          }
        } catch (err) {
          console.warn("MG | auto-spend move failed:", err);
        }
      });

      this._mgBindMoveGrid(html);

      // Change Profile Image (works for trusted + basic owners)
      html.off("click.mgProfileImg").on("click.mgProfileImg", ".mg-change-profile-image", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        if (!this.isEditable) {
          ui.notifications?.warn("You do not have permission to edit this character.");
          return;
        }

        const current = this.actor.img ?? "icons/svg/mystery-man.svg";

        // Foundry permission gates: basic players often cannot open FilePicker (especially on Forge)
        const canBrowse = game.user?.can?.("FILES_BROWSE") ?? game.user?.isTrusted ?? false;

        // Helper: apply update + live preview
        const applyImg = async (path) => {
          try {
            await this.actor.update({ img: path });

            // Optional instant preview (safe no-op if selector doesn't exist)
            const routed = foundry.utils.getRoute(path);
            this.element.find(".profile-banner img, .profile-image").attr("src", routed);

            ui.notifications?.info("Profile image updated.");
          } catch (err) {
            console.error("MG | Failed to update actor profile image:", err);
            ui.notifications?.error("Failed to update profile image.");
          }
        };

        // If user can browse, open FilePicker normally
        if (canBrowse) {
          const fp = new FilePicker({
            type: "image",
            current,
            callback: applyImg
          });
          fp.render(true);
          return;
        }

        // Fallback: basic players still get a dialog to paste an image URL/path
        new Dialog({
          title: "Set Profile Image",
          content: `
            <p>You don't have file browsing permissions, but you can still set an image by URL/path.</p>
            <div class="form-group">
              <label>Image URL or Path</label>
              <input type="text" name="mgImgPath" value="${current}" style="width:100%;" />
            </div>
          `,
          buttons: {
            save: {
              icon: '<i class="fa-solid fa-check"></i>',
              label: "Save",
              callback: (html) => {
                const path = html.find('input[name="mgImgPath"]').val()?.trim();
                if (path) applyImg(path);
              }
            },
            cancel: {
              icon: '<i class="fa-solid fa-xmark"></i>',
              label: "Cancel"
            }
          },
          default: "save"
        }).render(true);
      });

      // Defensive: hide Level controls if no Guise (in case template guard is missing)
      {
        const guiseId   = this.actor?.system?.guise;
        const hasGuise  = !!(guiseId && game.items.get(guiseId));
        // Prefer a single wrapper if you have it:
        const $block = this.element.find(".mg-level-controls");
        if ($block.length) $block.toggle(hasGuise);

        // And hide any lone level buttons if they exist outside the wrapper
        this.element.find(".mg-open-level-wizard, .mg-leveler, .mg-level-btn").toggle(hasGuise);
      }

      this._mgRefreshGuiseVisibility(html);

      // === Bottom Hand: right-click to zoom a Gambit card ===
      $(document)
        .off("contextmenu.mgHandZoom")
        .on("contextmenu.mgHandZoom", ".gambit-hand-ui .gambit-hand-card", async (event) => {
          event.preventDefault();
          event.stopPropagation();

          const el = event.currentTarget;

          // Resolve the clicked card
          const itemId = el.dataset.itemId || el.getAttribute("data-id");
          const source = el.dataset.source || "drawn";
          let item = null;
          if (itemId) item = this.actor?.items?.get(itemId) || game.items?.get(itemId) || null;

          const name = item?.name ?? el.dataset.name ?? "Gambit";
          const description = item?.system?.description ?? el.dataset.description ?? "";

          // 1) Dim the actual hand card (smooth transition)
          this._mgMarkHandCardActive?.(el, true);

          // 2) Pull animation to center — wait for it to finish
          try { await this._mgPullFromHand?.(el); } catch (_) {}

          // 3) Open zoom; when closed, restore the real card's opacity
          this._mgOpenGambitZoom(
            { id: itemId, source, name, description },
            {
              sourceEl: el,
              onClose: () => this._mgMarkHandCardActive?.(el, false)
            }
          );
        });

        // Header pencil → open modal to edit top-of-card fields (currently: Name)
        {
          const $root = html instanceof jQuery ? html : $(html);

          $root.off("click.mgEditHeader").on("click.mgEditHeader", ".mg-edit-name", async (ev) => {
            ev.preventDefault();

            // --- Safe HTML escaper compatible with v11 ---
            const esc = (s) => {
              const str = String(s ?? "");
              if (window?.Handlebars?.escapeExpression) return Handlebars.escapeExpression(str);
              return str
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
            };

            // Current values (expand later if you add more header fields)
            const currentName = this.actor.name ?? "";

            const content = `
              <form class="mg-form">
                <div class="form-group">
                  <label>Name</label>
                  <input type="text" name="name" value="${esc(currentName)}" />
                </div>
              </form>
            `;

            const result = await Dialog.wait({
              title: "Edit Character Header",
              content,
              buttons: {
                ok: {
                  label: this._mgBtn("Save", "fa-floppy-disk"),
                  callback: (dlgHtml) => {
                    const $dlg = $(dlgHtml);
                    return {
                      name: String($dlg.find('input[name="name"]').val() ?? "").trim()
                    };
                  }
                },
                cancel: { label: this._mgBtn("Cancel", "fa-circle-xmark"), callback: () => null }
              },
              default: "ok"
            });

            if (!result) return;

            const updates = {};
            if (result.name && result.name !== this.actor.name) updates["name"] = result.name;

            if (Object.keys(updates).length) {
              await this.actor.update(updates);
              // Soft refresh headline text without full re-render
              const wrap = this.element.find("[data-mg-nameblock] .mg-name-view");
              if (wrap.length) wrap.text(this.actor.name);
            }
          });
        }

        // Keep crew affiliation label in sync with data updates (v11-safe)
        if (this._mgCrewNameHook) Hooks.off("updateActor", this._mgCrewNameHook);
        this._mgCrewNameHook = (doc, diff) => {
          if (!doc || doc.id !== this.actor.id) return;

          // Only react if crewName changed
          const changed = foundry.utils.getProperty(diff, "system.crewName");
          if (changed === undefined) return;

          const $label = this.element.find(".mg-crew-affiliation .crew-name");
          if ($label.length) $label.text(doc.system?.crewName || "No Crew");
        };
        Hooks.on("updateActor", this._mgCrewNameHook);

        // --- Journal: mount TinyMCE on all .mg-rich fields ---
        {
          const root = html[0];
          const areas = root.querySelectorAll(".mg-journal textarea.mg-rich");
          if (areas.length) {
            for (const ta of areas) {
              // Seed with existing value so first paint matches
              const path = ta.name; // e.g., "system.journal.race"
              const value = getProperty?.(this.actor, path) ?? "";
              ta.value = String(value);

              // Clone global config; cap height and allow internal scroll
              const cfg = foundry.utils.deepClone(CONFIG.TinyMCE);
              cfg.max_height = 320;
              cfg.min_height = cfg.min_height ?? 140;
              cfg.content_style = (cfg.content_style ?? "") + `
                body.mce-content-body { overflow-y:auto; overscroll-behavior:contain; }
              `;

              await TextEditor.create({
                target: ta,
                name: path,
                content: value,
                tinymce: cfg,
                height: null
              });
            }
          }
        }

      // Live STO updates while sheet is open
      this._stoHookId = Hooks.on("updateActor", (actor, changes) => {
        if (actor.id !== this.actor.id) return;

        const stoPath = changes?.system?.sto?.value;
        if (stoPath === undefined) return;

        const stoValue = Number(actor.system?.sto?.value ?? 0);

        const $track = this.element.find(`.sto-track[data-track="sto"]`);
        if (!$track.length) return;

        $track.find(".sto-dot").each((_, node) => {
          const v = Number(node.dataset.value);
          node.classList.toggle("filled", v <= stoValue);
        });
      });

    }

  /** Preserve scroll position across re-renders + fix header paint glitches. */
  async _render(force, options = {}) {
    const bodyBefore = this.element?.[0]?.querySelector?.(".window-content");
    const scrollTop = bodyBefore?.scrollTop ?? 0;

    await super._render(force, options);

    const bodyAfter = this.element?.[0]?.querySelector?.(".window-content");
    if (bodyAfter) bodyAfter.scrollTop = scrollTop;

    // After Foundry finishes painting, nudge the header so text is always visible
    this._mgRepaintHeader();
  }
    
  //END EVENT LISTENERS
  //---------------------------------------------------------------------------------------------------------------------------

  /** Compute the player's Gambit deck/hand max from the LEVELS table with robust fallbacks. */
  _mgGetPlayerGambitMax() {
    const lvl = Number(this.actor.system?.level) || 1;
    const LVLS = CONFIG.MidnightGambit?.LEVELS ?? {};
    const row  = LVLS[lvl] ?? {};

    // Try common schema variants (support your past/future naming)
    const candidates = [
      row.gambits?.deckSize,
      row.gambits?.handSize,
      row.gambits?.slots,
      row.deckSize,
      row.handSize,
      row.gambitSlots,
      row.slots
    ].filter(v => Number.isFinite(Number(v)));

    if (candidates.length) return Number(candidates[0]);

    // Fallbacks to actor/system values if LEVELS row doesn't define it
    const sys = this.actor.system?.gambits ?? {};
    return Number(sys.deckSize ?? sys.maxDeckSize ?? sys.maxDrawSize ?? 3) || 3;
  }


  /**
   * Centered overlay for a Gambit: shows name + description.
   * Uses your exact HTML structure and styling. No CSS overrides beyond overlay/animation.
   * Accepts { id, source, name, description } and optional { sourceEl, onClose }.
   */
  _mgOpenGambitZoom(data, { sourceEl = null, onClose = null } = {}) {
    const itemId     = data?.id ?? null;
    const fromSource = data?.source ?? "drawn";
    const rawName    = data?.name ?? "Gambit";
    const name       = String(rawName).replace(/[&<>"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]));
    const description = (data?.description ?? "").trim(); // allow rich HTML from item/system

    // Inject tiny, namespaced CSS just for the overlay + enter animation
    if (!document.getElementById("mg-gz-styles")) {
      const style = document.createElement("style");
      style.id = "mg-gz-styles";
      style.textContent = `
        .mg-gz-backdrop {
          position: fixed; inset: 0; display: grid; place-items: center;
          background: rgba(0,0,0,0.55); z-index: 10000;
          opacity: 0; transition: opacity 160ms ease;
        }
        .mg-gz-backdrop.mg-gz-show { opacity: 1; }
        /* Only animation affordances on the container so your own card CSS stays intact */
        .mg-gz-card {
          box-shadow: 0 10px 40px rgba(0,0,0,0.6);
          transform: scale(0.92);
          opacity: 0;
          transition: transform 160ms ease, opacity 160ms ease;
        }
        .mg-gz-card.mg-gz-in { transform: scale(1); opacity: 1; }
      `;
      document.head.appendChild(style);
    }

    // Build the overlay using YOUR structure
    const overlay = document.createElement("div");
    overlay.className = "mg-gz-backdrop";
    overlay.innerHTML = `
      <div class="mg-gz-card" role="dialog" aria-label="${name}">
        <div class="mg-gz-header">
          <h3 class="gambit-title">${name}</h3>
          <button class="mg-gz-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="mg-gz-body">${description || "<em>No description.</em>"}</div>
        <button class="mg-gz-play" data-item-id="${itemId ?? ""}" data-source="${fromSource}">
          <i class="fa-solid fa-play mg-icon"></i> Play
        </button>
      </div>
    `;

    const cardEl = overlay.querySelector(".mg-gz-card");

    // Unified close that also triggers optional onClose callback
    const finishClose = () => { try { if (typeof onClose === "function") onClose(); } catch(_) {} };
    const close = () => {
      window.removeEventListener("keydown", onKey);
      overlay.classList.remove("mg-gz-show");
      cardEl.classList.remove("mg-gz-in");
      setTimeout(() => { overlay.remove(); finishClose(); }, 160);
    };
    const onKey = (ev) => { if (ev.key === "Escape") close(); };

    // Close interactions
    overlay.addEventListener("click", (ev) => { if (ev.target === overlay) close(); });
    overlay.querySelectorAll(".mg-gz-close").forEach(btn => btn.addEventListener("click", close));
    window.addEventListener("keydown", onKey);

    // Play → post to chat → move to Discard → close
    overlay.querySelector(".mg-gz-play")?.addEventListener("click", async (ev) => {
      ev.preventDefault();
      try {
        // 1) Post to chat
        const chatContent = `
          <div class="chat-move">
            <h2><i class="fa-solid fa-cards"></i> ${name}</h2>
            <p>${description}</p>
          </div>
        `;
        await ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor: this.actor }),
          content: chatContent
        });

        // 2) Move from its source list → discard (if we know which)
        if (itemId) {
          const g = this.actor.system.gambits ?? {};
          const srcList = Array.isArray(g[fromSource]) ? [...g[fromSource]] : [];
          const discard = Array.isArray(g.discard) ? [...g.discard] : [];
          const idx = srcList.indexOf(itemId);
          if (idx !== -1) srcList.splice(idx, 1);
          if (!discard.includes(itemId)) discard.push(itemId);
          await this.actor.update({
            [`system.gambits.${fromSource}`]: srcList,
            "system.gambits.discard": discard
          });
        }
      } catch (err) {
        console.error("MG | Play Gambit failed:", err);
        ui.notifications?.error("Failed to play Gambit. See console.");
      } finally {
        close();
      }
    });

    // Mount + staged entrance (transform-origin biased toward the clicked card)
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.classList.add("mg-gz-show");
      if (sourceEl) {
        try {
          const r = sourceEl.getBoundingClientRect();
          const cx = (r.left + r.right) / 2;
          const cy = (r.top + r.bottom) / 2;
          cardEl.style.transformOrigin = `${(cx / innerWidth) * 100}% ${(cy / innerHeight) * 100}%`;
        } catch(_) {}
      }
      cardEl.classList.add("mg-gz-in");
    });

    return overlay;
  }

  async close(options) {
    if (this._stoHookId) {
      Hooks.off("updateActor", this._stoHookId);
      this._stoHookId = null;
    }
    return super.close(options);
  }

  /**
   * Pull a styled clone of the hand card to the exact viewport center.
   * We animate the fixed-position shell (not the inner ghost) so centering is precise.
   */
  async _mgPullFromHand(sourceEl) {
    if (!sourceEl) return;

    // 1) Measure the source card
    const src = sourceEl.getBoundingClientRect();

    // 2) Build an ancestry "shell" so your existing CSS still applies
    const shell = document.createElement("div");
    shell.className = "gambit-hand-ui";
    const shellInner = document.createElement("div");
    shellInner.className = "gambit-hand";
    shell.appendChild(shellInner);

    // 3) Clone the card (deep) with all its classes/children intact
    const ghost = sourceEl.cloneNode(true);
    shellInner.appendChild(ghost);

    // 4) Fix-position the shell at the card’s spot
    Object.assign(shell.style, {
      position: "fixed",
      left: `${src.left}px`,
      top: `${src.top}px`,
      width: `${src.width}px`,
      height: `${src.height}px`,
      margin: 0,
      zIndex: 10001,
      pointerEvents: "none",
      // We'll animate THIS element so centering math is exact
      transformOrigin: "0 0",
      transition: "transform 220ms ease, opacity 220ms ease",
      opacity: "1"
    });

    // Keep the ghost visually intact; no transforms here
    ghost.style.willChange = "transform, opacity";

    document.body.appendChild(shell);

    // 5) Compute transform that centers the scaled shell
    const scale = Math.min(1.2, Math.max(1.05, 600 / Math.max(src.width, src.height)));
    const targetLeft = (window.innerWidth  / 2) - (src.width  * scale) / 2;
    const targetTop  = (window.innerHeight / 2) - (src.height * scale) / 2;

    const dx = targetLeft - src.left;
    const dy = targetTop  - src.top;

    // Force reflow so the transition kicks
    // eslint-disable-next-line no-unused-expressions
    shell.offsetWidth;

    // 6) Animate the shell to center (translate THEN scale from its top-left)
    shell.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`;

    // 7) Finish & clean up
    await new Promise((res) => setTimeout(res, 220));
    shell.style.opacity = "0";
    await new Promise((res) => setTimeout(res, 120));
    shell.remove();
  }

  _mgMarkHandCardActive(el, isActive) {
    if (!el) return;
    el.style.transition = "opacity 160ms ease";
    el.style.opacity = isActive ? "0.15" : "1";
  }

  /** Nudge the header name text so Chrome repaints it (fixes rare invisibility bug). */
  _mgRepaintHeader() {
    const root = this.element?.[0];
    if (!root) return;

    const el = root.querySelector("[data-mg-nameblock] .mg-name-view");
    if (!el) return;

    // Tiny transform dance to force a repaint without changing layout
    el.style.willChange = "transform";
    el.style.transform = "translateZ(0.001px)";
    // Force reflow so the browser commits the new layer
    void el.getBoundingClientRect();
    // Clear hints again
    el.style.transform = "";
    el.style.willChange = "";
  }

  // --- Read-only mode for non-owners: block clicks, rolls, inputs, drags ---
  _mgMakeReadOnly(html) {
    const $root = html instanceof jQuery ? html : $(html);

    // Disable form controls (but keep scrolling)
    $root.find('input:not([type="hidden"]), select, textarea, button').prop('disabled', true);
    $root.find('[contenteditable="true"]').attr('contenteditable', 'false');

    // Remove draggable affordances
    $root.find('[draggable="true"]').attr('draggable', 'false');

    // Any interactive selectors we want to neuter (rolls, toggles, etc.)
    const hotSelectors = [
      ".strain-dot",
      ".risk-dot",
      ".flashback-dot",
      ".load-icon",
      ".draw-gambit",
      ".discard-card",
      ".remove-from-hand",
      ".post-move",
      ".post-signature",
      ".spark-dot",
      ".capacity-box input",
      ".remove-guise",
      ".attribute-modifier",
      ".skill-name", ".skill-value",
      ".repair-armor",
      ".item-delete",
      ".post-weapon-tags", ".post-armor-tags", ".post-misc-tags",
      ".sync-tags",
      ".reset-gambit-deck",
      ".post-gambit",
      ".play-gambit",
      ".gambit-hand-card",
      "[data-roll]", ".rollable", ".inline-roll"
    ].join(", ");

    // Intercept events so existing handlers never fire
    const block = (ev) => {
      // Allow normal links (e.g., to open compendium entries) to still work
      const el = ev.target;
      const allowLink = el.closest?.("a[href]") != null;
      if (allowLink) return;
      ev.stopImmediatePropagation();
      ev.stopPropagation();
      ev.preventDefault();
      return false;
    };

    $root.on("click.mgLock", hotSelectors, block);
    $root.on("dblclick.mgLock", hotSelectors, block);
    $root.on("contextmenu.mgLock", hotSelectors, block);
    $root.on("dragstart.mgLock", hotSelectors, block);
    $root.on("keydown.mgLock", hotSelectors, (ev) => {
      if (ev.key === "Enter" || ev.key === " ") block(ev);
    });

    // Optional: add a class for styling "read-only" visuals if you want
    $root.addClass("mg-view-only");
  }

  /* If the current user is not an owned of this Actor, only show the first tab.
  This hides the extra tab buttons and their panels in the DOM
  Change MIN_LEVEL to "OBSERVER" if you want observers to see all tabs.
  ----------------------------------------------------------------------*/
  _mgRestrictTabsForNonOwners(html) {
    const isOwner = this.actor?.testUserPermission?.(game.user, "OWNER") || this.actor?.isOwner || game.user.isGM;
    if (isOwner) return; // Owners & GMs see everything

    // Locate the tab nav & body
    const $root = html instanceof jQuery ? html : $(html);
    const $nav  = $root.find("nav.sheet-tabs, .sheet-tabs").first();
    const $items = $nav.find('.item[data-tab], [data-tab].item');

    if (!$items.length) return;

    // First tab id (fallback-safe)
    const $firstItem = $items.first();
    const firstTab = $firstItem.data("tab") || $firstItem.attr("data-tab");
    if (!firstTab) return;

    // Remove all other nav items
    $items.slice(1).remove();

    // Hide/remove all other tab panels
    const $body = $root.find(".sheet-body");
    const $tabs = $body.find('.tab[data-tab]');
    $tabs.each((_, el) => {
      const tab = el.getAttribute("data-tab");
      if (tab !== firstTab) el.remove();
    });

    // Force-activate the first tab visually
    $nav.find(".item").removeClass("active");
    $firstItem.addClass("active");
    $body.find(".tab").removeClass("active");
    $body.find(`.tab[data-tab="${firstTab}"]`).addClass("active");
  }


  /* Post a Gambit card to chat with full styled HTML
  ----------------------------------------------------------------------*/
  async _mgPostGambitToChat(item) {
    const { name, system } = item;
    const { description = "", tier = "", tags = [] } = system;

    const tagLabels = (tags || [])
      .map(t => CONFIG.MidnightGambit.ITEM_TAGS.find(def => def.id === t)?.label || t)
      .join(", ");

    const html = `
      <div class="gambit-chat-card">
        <h2><i class="fa-solid fa-cards"></i> ${name}</h2>
        <p><strong>Tier:</strong> ${tier.charAt(0).toUpperCase() + tier.slice(1)}</p>
        ${tagLabels ? `<p><strong>Tags:</strong> ${tagLabels}</p>` : ""}
        <p>${description}</p>
      </div>
    `;

    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: html
    });
  }

  /* Level Wizard
  ==============================================================================*/

  /* Putting icons next to buttons on all sections
  ----------------------------------------------------------------------*/  
  _mgBtn(text, faRight = "fa-arrow-right") {
    return `${text} <i class="fa-solid ${faRight}"></i>`;
  }

  /** Generic prompt with <h2> title in body and right-justified icon labels */
  async _mgPrompt({ title, bodyHtml, okText = "Save", okIcon = "fa-check", cancelText = "Cancel", cancelIcon = "fa-circle-xmark", getValue }) {
    const result = await Dialog.wait({
      title,                                    // plain title
      content: `<h2 class="modal-headline">${title}</h2>${bodyHtml}`,  // visual H2 in content
      buttons: {
        ok: { label: this._mgBtn(okText, okIcon), callback: html => getValue($(html)) },
        cancel: { label: this._mgBtn(cancelText, cancelIcon), callback: () => null }
      },
      default: "ok"
    });
    return result;
  }

  /* Decrement a pending counter on the actor flag (fallback if mgSpendPending is absent)
  ----------------------------------------------------------------------*/
  async _mgConsumePendingRaw(kind = "moves", amt = 1) {
    const state = await this.actor.getFlag("midnight-gambit", "state") ?? {};
    const p = { ...(state.pending ?? {}) };
    const cur = Number(p[kind] ?? 0);
    if (cur <= 0) return false; // nothing to do
    p[kind] = Math.max(0, cur - amt);
    await this.actor.setFlag("midnight-gambit", "state", { ...state, pending: p });
    return true;
  }

  /* Detect multiple moves added
  ----------------------------------------------------------------------*/
  async mgSpendPending(kind, data = {}) {
    const map = { move: "moves", attribute: "attributes", skill: "skills" };
    const key = map[kind] ?? kind;
    const state = (await this.getFlag("midnight-gambit", "state")) ?? {};
    const p = { ...(state.pending ?? {}) };
    const cur = Number(p[key] ?? 0);
    if (!cur) return false;

    p[key] = Math.max(0, cur - 1);
    await this.setFlag("midnight-gambit", "state", { ...state, pending: p });
    return true;
  }

    /* Level up function guiding players through their levels
  ----------------------------------------------------------------------*/

  async _openLevelWizard() {
    const actor = this.actor;

    const fmt = (p) => [
      p.attributes ? `${p.attributes} Attribute` : null,
      p.skills ? `${p.skills} Skill` : null,
      p.moves ? `${p.moves} Move` : null,
      p.sparkSlots ? `${p.sparkSlots} Spark Slot` : null,
      p.signaturePerk ? `Signature Perk` : null,
      p.finalHandDiscoverable ? `Final Hands discoverable` : null
    ].filter(Boolean).join(", ");

    const readPending = async () => {
      const s = await actor.getFlag("midnight-gambit","state");
      const p = s?.pending || {};
      return {
        attributes: Number(p.attributes||0),
        skills: Number(p.skills||0),
        moves: Number(p.moves||0),
        sparkSlots: Number(p.sparkSlots||0),
        signaturePerk: Number(p.signaturePerk||0),
        finalHandDiscoverable: Number(p.finalHandDiscoverable||0)
      };
    };

    // 1) Summary
    let pending = await readPending();
    if (!Object.values(pending).some(n => n>0)) {
      ui.notifications.info("No unspent level rewards.");
      return;
    }

    await Dialog.wait({
      title: "Level Up Rewards",   // plain string only
      content: `
        <p>You have gained: <strong>${fmt(pending)}</strong>.</p>
        <p>Let’s apply them now. You can close any step to finish later.</p>
      `,
      buttons: {
        ok: {
          label: `Continue <i class="fa-solid fa-arrow-right"></i>`
        }
      }
    });

    // 2) Spend Attribute Points
    while ((pending = await readPending()).attributes > 0) {
      const keys = ["tenacity","finesse","resolve","guile","instinct","presence"];
      const options = keys.map(k => `<option value="${k}">${k.toUpperCase()}</option>`).join("");
      const content = `
        <p>Spend 1 <strong>Attribute</strong> point:</p>
        <select name="attrKey">${options}</select>
      `;
      const chosen = await this._mgPrompt({
        title: "Spend Attribute",
        bodyHtml: `
          <p>Spend 1 <strong>Attribute</strong> point:</p>
          <select name="attrKey">${options}</select>
        `,
        okText: "Apply",
        okIcon: "fa-check",
        cancelText: "Later",
        cancelIcon: "fa-clock",
        getValue: (html) => html.find('select[name="attrKey"]').val()
      });
      if (!chosen) break; // user closed → leave as pending
      try { await actor.mgSpendPending("attribute", { key: chosen }); } catch (e) { ui.notifications.error(e.message); break; }
    }

    // 3) Spend Skill Points
    while ((pending = await readPending()).skills > 0) {
      const skills = Object.keys(actor.system?.skills || {}).sort();
      const options = skills.map(k => `<option value="${k}">${k}</option>`).join("");
      const content = `
        <p>Spend 1 <strong>Skill</strong> point:</p>
        <select name="skillKey">${options}</select>
      `;
      const chosen = await this._mgPrompt({
        title: "Spend Skill",
        bodyHtml: `
          <p>Spend 1 <strong>Skill</strong> point:</p>
          <select name="skillKey">${options}</select>
        `,
        okText: "Apply",
        okIcon: "fa-check",
        cancelText: "Later",
        cancelIcon: "fa-clock",
        getValue: (html) => html.find('select[name="skillKey"]').val()
      });
      if (!chosen) break;
      try { await actor.mgSpendPending("skill", { key: chosen }); } catch (e) { ui.notifications.error(e.message); break; }
    }

    // 4) Apply Spark Slots (casters only — they’re the only ones who got these pending)
    while ((pending = await readPending()).sparkSlots > 0) {
      const ok = await Dialog.wait({
        title: "Add Spark Slot?",
        content: `
          <p>Add <strong>+1 Spark Slot</strong> to your pool now?</p>
        `,
        buttons: {
          yes: { label: this._mgBtn("Add", "fa-plus"), callback: () => true },
          no:  { label: this._mgBtn("Later", "fa-clock"), callback: () => false }
        },
        default: "yes"
      });
      if (!ok) break; // leave pending if they want to do later
      try { await actor.mgSpendPending("spark"); } catch (e) { ui.notifications.error(e.message); break; }
    }

    // 5) Signature Perk / Final Hand acknowledgements (real pickers later)
    if ((pending = await readPending()).signaturePerk > 0) {
      const ok = await Dialog.wait({
        title: "Signature Perk",
        content: `
          <p>You unlocked a <strong>Signature Perk</strong>.</p>
        `,
        buttons: {
          yes: { label: this._mgBtn("Acknowledge", "fa-check-double"), callback: () => true },
          no:  { label: this._mgBtn("Later", "fa-clock"), callback: () => false }
        },
        default: "yes"
      });

      if (ok) { try { await actor.mgSpendPending("ack-signature"); } catch (e) {} }
    }

    if ((pending = await readPending()).finalHandDiscoverable > 0) {
      const ok = await Dialog.wait({
        title: "Final Hand",
        content: `
          <p><strong>Final Hands</strong> are now discoverable. Mark this as acknowledged?</p>
        `,
        buttons: {
          yes: { label: this._mgBtn("Acknowledge", "fa-check-double"), callback: () => true },
          no:  { label: this._mgBtn("Later", "fa-clock"), callback: () => false }
        },
        default: "yes"
      });
      if (ok) { try { await actor.mgSpendPending("ack-finalhand"); } catch (e) {} }
    }

    // 6) Moves (we’ll do a picker later — for now just nudge them)
    if ((pending = await readPending()).moves > 0) {
      await Dialog.wait({
        title: "Choose New Move",
        content: `
          <p>You have <strong>${pending.moves}</strong> unspent move(s). Head to your Moves area and add one; the pending counter will remain until you finalize.</p>
        `,
        buttons: {
          ok: { label: this._mgBtn("Okay", "fa-thumbs-up") }
        }
      });
    }

    // 7) Done
    pending = await readPending();
    if (Object.values(pending).some(n => n>0)) {
      ui.notifications.info("Some rewards remain unspent — you can finish later from the Settings tab banner.");
    } else {
      ui.notifications.info("Level rewards applied. Nice!");
    }

    // Soft re-render to refresh banner/buttons
    this.render(false);
  }

  /* Drag and Drop onto Character Sheet
  ==============================================================================*/
  async _onDropItemCreate(itemData) {

    // --- Guard: block Crew-tier Gambits from being dropped on Character sheets ---
    try {
      // Normalize payload (compendiums sometimes nest at system.system)
      const raw = itemData?.system?.system ? itemData.system : itemData;
      const type = raw?.type ?? itemData?.type;

      if (type === "gambit") {
        // Try to read tier directly
        let tier = String(raw?.system?.tier ?? raw?.tier ?? "").toLowerCase();

        // Fallback 1: resolve by UUID (compendiums, sidebar)
        if (!tier && itemData?.uuid) {
          const src = await fromUuid(itemData.uuid).catch(() => null);
          tier = String(src?.system?.tier ?? "").toLowerCase();
        }

        // Fallback 2: resolve by core sourceId (world copy of a compendium item)
        if (!tier && itemData?.flags?.core?.sourceId) {
          const base = await fromUuid(itemData.flags.core.sourceId).catch(() => null);
          tier = String(base?.system?.tier ?? "").toLowerCase();
        }

        if (tier === "crew") {
          ui.notifications?.warn("Crew-tier Gambits can only be added to the Crew.");
          return []; // stop the drop cleanly (Actor gets nothing)
        }
      }
    } catch (e) {
      console.warn("MG | Gambit tier guard failed (non-fatal):", e);
    }

    // --- Deck capacity check for Player Gambits (pre-create) ---
    try {
      // Normalize payload
      const raw = itemData?.system?.system ? itemData.system : itemData;
      const type = raw?.type ?? itemData?.type;

      if (type === "gambit") {
        // Read current deck + max (fallbacks keep old characters safe)
        const g = this.actor.system?.gambits ?? {};
        const deck = Array.isArray(g.deck) ? g.deck : [];
        const deckMax = this._mgGetPlayerGambitMax();

        if (deck.length >= deckMax) {
          const ok = await Dialog.confirm({
            title: "Over Deck Limit?",
            content: `
              <p>You're going over your max available Player Gambits for this level
              (<strong>${deck.length}/${deckMax}</strong>).</p>
              <p><em>Only add this if your Director approves!</em></p>
            `,
            defaultYes: false,
            yes: () => true, no: () => false
          });
          if (!ok) return []; // cancel the add
        }
      }
    } catch (e) {
      console.warn("MG | Player Gambit deck cap check failed (non-fatal):", e);
    }

    if (itemData.type === "guise") {
    console.log("✅ Dropped a guise item on actor");

    if (!this.actor.system.baseAttributes || Object.keys(this.actor.system.baseAttributes).length === 0) {
      const base = foundry.utils.deepClone(this.actor.system.attributes);
      await this.actor.update({ "system.baseAttributes": base });
    }

    let guise;
    try {
      console.log("🧪 Dropped itemData:", itemData);

      // Use from Uuid if coming from compendium (has UUID)
      if (itemData?.uuid) {
        guise = await fromUuid(itemData.uuid);
        if (!guise) throw new Error("Failed to load item from UUID");
      } else {
        // Flatten if the data is embedded like a compendium wrapper
        const data = itemData.system?.system ? itemData.system : itemData;

        // Validate required fields
        if (!data.name || !data.type) {
          throw new Error("Dropped item is missing required fields");
        }

        guise = await Item.implementation.create(data, { temporary: true });
      }
    } catch (err) {
      console.error("Failed to retrieve dropped guise:", err);
      ui.notifications.error("Could not load the dropped Guise item.");
      return [];
    }

    const [embedded] = await this.actor.createEmbeddedDocuments("Item", [guise.toObject()]);
    await this.actor.update({ "system.guise": embedded.id });

    if (!guise || guise.type !== "guise") {
      ui.notifications.error("Dropped item is not a valid Guise.");
      return [];
    }

      /* Guise Caster Type
      ----------------------------------------------------------------------*/
      const casterType = guise.system?.casterType ?? null;
      let sparkSchool1 = "";
      let sparkSchool2 = "";

      if (["full", "half"].includes(casterType)) {
        const schools = [
          { value: "veiling", label: "Veiling" },
          { value: "sundering", label: "Sundering" },
          { value: "binding", label: "Binding" },
          { value: "drift", label: "Drift" },
          { value: "threading", label: "Threading" },
          { value: "warding", label: "Warding" },
          { value: "shaping", label: "Shaping" },
          { value: "gloom", label: "Gloom" },
          { value: "ember", label: "Ember" }
        ];

        const form = document.createElement("form");

        // Spark School 1
        const label1 = document.createElement("label");
        label1.textContent = "Spark School 1";
        const select1 = document.createElement("select");
        select1.name = "sparkSchool1";
        select1.innerHTML = `<option value="">-- Select --</option>` +
          schools.map(s => `<option value="${s.value}">${s.label}</option>`).join("");

        form.appendChild(label1);
        form.appendChild(select1);

        let select2;
        if (["full", "caster"].includes(casterType)) {
          const label2 = document.createElement("label");
          label2.textContent = "Spark School 2";
          select2 = document.createElement("select");
          select2.name = "sparkSchool2";
          select2.innerHTML = `<option value="">-- Select --</option>` +
            schools.map(s => `<option value="${s.value}">${s.label}</option>`).join("");

          // Prevent duplicate selections
          select1.addEventListener("change", () => {
            const selected1 = select1.value;
            select2.querySelectorAll("option").forEach(opt => {
              opt.disabled = opt.value === selected1 && opt.value !== "";
            });
          });

          form.appendChild(label2);
          form.appendChild(select2);
        }

        /* Choose Spark Schools prompt
        ----------------------------------------------------------------------*/
        await Dialog.wait({
          title: "Choose Spark School(s)",
          content: `
            ${form.outerHTML}
          `,
          buttons: {
            ok: { label: this._mgBtn("Confirm", "fa-check"), callback: () => {
              const selected1 = document.querySelector('[name="sparkSchool1"]')?.value || "";
              sparkSchool1 = selected1;

              if (["full", "caster"].includes(casterType)) {
                const selected2 = document.querySelector('[name="sparkSchool2"]')?.value || "";
                sparkSchool2 = selected2;
              }
              return true;
            }},
            cancel: { label: this._mgBtn("Cancel", "fa-circle-xmark"), callback: () => false }
          },
          default: "ok",
          render: (html) => {
            if (["full", "caster"].includes(casterType)) {
              const select1El = html[0].querySelector('[name="sparkSchool1"]');
              const select2El = html[0].querySelector('[name="sparkSchool2"]');

              select1El.addEventListener("change", () => {
                const selected1 = select1El.value;
                Array.from(select2El.options).forEach(opt => {
                  opt.disabled = opt.value === selected1 && opt.value !== "";
                });
              });
            }
          }
        });
      }

      await this.actor.update({
        "system.guise": embedded.id,
        "system.casterType": casterType,
        "system.sparkSchool1": sparkSchool1,
        "system.sparkSchool2": sparkSchool2
      });

      await this.actor.update({});   // <-- force apply guise bonuses
      ui.notifications.info(`${guise.name} applied as new Guise!`);
      await this.render(true);
      return [];
    }
    
    /* Gambit Item creation and limits
    ----------------------------------------------------------------------*/
    if (itemData.type === "gambit") {
      const [gambitItem] = await this.actor.createEmbeddedDocuments("Item", [itemData]);

      // Use level-scaled deck capacity from actor data (not hard-coded 3)
      const g = this.actor.system.gambits ?? {};
      const deck = Array.isArray(g.deck) ? g.deck : [];
      const maxDeck = this._mgGetPlayerGambitMax();

      // Don’t add duplicates; enforce capacity
      const nextDeck = deck.includes(gambitItem.id) ? deck : [...deck, gambitItem.id];

      if (nextDeck.length > maxDeck) {
        // Roll back the item we just created and warn
        await gambitItem.delete();
        ui.notifications.warn(`Your deck can hold ${maxDeck} Gambits right now.`);
        return [];
      }

      await this.actor.update({ "system.gambits.deck": nextDeck });
      return [];
    }


    /* Learned Move drop-on-actor
    ---------------------------------------------------------------------*/
    if (itemData.type === "move") {
      console.log("✅ Dropped a MOVE on actor");

      // 1) Hydrate move data whether from compendium UUID or raw data
      let moveDoc;
      try {
        if (itemData?.uuid) {
          // From compendium or world via UUID
          const src = await fromUuid(itemData.uuid);
          if (!src) throw new Error("Could not resolve dropped Move via UUID");
          moveDoc = src.toObject();
        } else {
          // From world item or drag payload
          const data = itemData.system?.system ? itemData.system : itemData;
          if (!data?.name || !data?.type) throw new Error("Dropped Move missing fields");
          moveDoc = data;
        }
      } catch (err) {
        console.error("Failed to read dropped Move:", err);
        ui.notifications.error("Could not read the dropped Move.");
        return [];
      }

      // 2) De-dupe prevention: by core sourceId OR by name (case-insensitive)
      //    (protects against adding the exact same move twice)
      const existing = this.actor.items.find(i =>
        i.type === "move" && (
          (i.flags?.core?.sourceId && i.flags.core.sourceId === moveDoc.flags?.core?.sourceId) ||
          (i.name?.toLowerCase?.() === moveDoc.name?.toLowerCase?.())
        )
      );
      if (existing) {
        ui.notifications.warn(`${moveDoc.name} is already on ${this.actor.name}.`);
        return [];
      }

      // 3) Mark as LEARNED so the sheet can sort it into the right area
      moveDoc.system = moveDoc.system || {};
      moveDoc.system.learned = true;

      // 4) Create on actor
      const [embedded] = await this.actor.createEmbeddedDocuments("Item", [moveDoc]);

      // 5) Nice feedback + refresh
      ui.notifications.info(`Learned Move added: ${embedded.name}`);
      this.render(false);
      return [];
    }

    // Gate Gambit drops on Character sheets: disallow Crew-tier here
    try {
      const data = TextEditor.getDragEventData(event);
      if (data?.type === "Item") {
        const src = await fromUuid(data.uuid);
        if (src?.documentName === "Item") {
          const type = src.type;
          if (type === "gambit") {
            const tier = String(src.system?.tier ?? "rookie").toLowerCase();
            if (tier === "crew") {
              ui.notifications?.warn("Crew-tier Gambits can only be added to the Crew.");
              return false;
            }
          }
        }
      }
    } catch (_) {}


    return super._onDropItemCreate(itemData);
  }

  /** Preserve scroll position across re-renders + fix header paint glitches. */
  async _render(force, options = {}) {
    const bodyBefore = this.element?.[0]?.querySelector?.(".window-content");
    const scrollTop = bodyBefore?.scrollTop ?? 0;

    await super._render(force, options);

    const bodyAfter = this.element?.[0]?.querySelector?.(".window-content");
    if (bodyAfter) bodyAfter.scrollTop = scrollTop;

    // After Foundry finishes painting, nudge the header so text is always visible
    this._mgRepaintHeader();
  }

  //END DRAG AND DROP
  //---------------------------------------------------------------------------------------------------------------------------

  /* Move order helpers (class-safe)
  ---------------------------------------------------------------------*/
  async _mgGetMoveOrder() {
    const state = await this.actor.getFlag("midnight-gambit", "moveOrder");
    return Array.isArray(state) ? state : [];
  }

  async _mgSetMoveOrder(orderIds) {
    const existing = new Set(this.actor.items.filter(i => i.type === "move").map(i => i.id));
    const clean = orderIds.filter(id => existing.has(id));
    await this.actor.setFlag("midnight-gambit", "moveOrder", clean);
    return clean;
  }

  async _mgSaveMoveOrderFromDom($grid) {
    const ids = $grid.find(".move-block").map((_i, el) => el.dataset.itemId).get();
    await this._mgSetMoveOrder(ids);
  }

  async _mgApplyMoveOrderToDom($grid) {
    const order = await this._mgGetMoveOrder();
    if (!order.length) return;
    const byId = {};
    $grid.find(".move-block").each((_i, el) => { byId[el.dataset.itemId] = el; });

    for (const id of order) if (byId[id]) $grid.append(byId[id]);
    $grid.find(".move-block").each((_i, el) => {
      if (!order.includes(el.dataset.itemId)) $grid.append(el);
    });
  }

  // Bind delete + drag reorder on the Moves grid (with live preview slot)
  _mgBindMoveGrid(html) {
    const $root = html instanceof jQuery ? html : $(html);
    const $grid = $root.find(".moves-grid");
    if (!$grid.length) return;

    // Ensure each card is draggable
    $grid.find(".move-block").attr("draggable", "true");

    // A single placeholder used during drag to show the drop slot
    let dragId = null;
    let dragEl = null;
    let placeholder = document.createElement("div");
    placeholder.className = "move-block mg-drop-placeholder";
    placeholder.setAttribute("aria-hidden", "true");

    // --- DELETE handler (unchanged; keep your working delete logic) ---
    $grid.off("click.mgMovesDel").on("click.mgMovesDel", ".delete-move", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const btn  = ev.currentTarget;
      const card = btn.closest(".move-block");
      const itemId =
        card?.dataset?.itemId ||
        btn.getAttribute("data-item-id") ||
        btn.closest("[data-item-id]")?.getAttribute("data-item-id");

      if (!itemId) {
        ui.notifications?.warn?.("Could not determine which Move to delete.");
        return;
      }

      const item = this.actor.items.get(itemId);
      if (!item) {
        ui.notifications?.warn?.("That Move was not found on this character.");
        return;
      }

      const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
      const ok = await Dialog.confirm({
        title: "Remove Move?",
        content: `<p>This will remove <strong>${esc(item.name)}</strong> from this character.</p>`
      });
      if (!ok) return;

      try {
        await this.actor.deleteEmbeddedDocuments("Item", [itemId], { renderSheet: false });
        // drop from saved order flag if present
        const order = (await this.actor.getFlag("midnight-gambit", "moveOrder")) ?? [];
        if (order.includes(itemId)) {
          await this.actor.setFlag("midnight-gambit", "moveOrder", order.filter(id => id !== itemId));
        }
        // optimistic DOM removal
        card.remove();
      } catch (err) {
        console.error("MG | Failed to delete Move:", err);
        ui.notifications?.error?.("Failed to delete that Move. See console for details.");
      }
    });

    // --- DRAG logic with live preview slot ---
    function clearPreview() {
      if (placeholder?.parentNode) placeholder.parentNode.removeChild(placeholder);
      $grid.find(".move-block.drop-above, .move-block.drop-below, .move-block.dragging").removeClass("drop-above drop-below dragging");
    }

    $grid.on("dragstart.mgMoves", ".move-block", (ev) => {
      dragEl = ev.currentTarget;
      dragId = dragEl.dataset.itemId || null;

      // Size the placeholder to the dragged card (height + margin)
      const rect = dragEl.getBoundingClientRect();
      placeholder.style.height = `${rect.height}px`;

      ev.originalEvent?.dataTransfer?.setData("text/plain", dragId ?? "");
      ev.originalEvent?.dataTransfer?.setDragImage?.(dragEl, rect.width / 2, rect.height / 2);
      dragEl.classList.add("dragging");
    });

    $grid.on("dragend.mgMoves", ".move-block", () => {
      clearPreview();
      dragId = null;
      dragEl = null;
    });

    // Show preview: hovered card’s slot becomes the drop slot (take that spot)
    $grid.off("dragover.mgMoves", ".move-block").on("dragover.mgMoves", ".move-block", (ev) => {
      if (!dragId) return;
      ev.preventDefault();

      const target = ev.currentTarget;
      if (target === dragEl) return;

      // Clean any old preview styling and ensure single placeholder
      $grid.find(".move-block.drop-above, .move-block.drop-below").removeClass("drop-above drop-below");
      if (placeholder.parentNode && placeholder.parentNode !== target.parentNode) {
        placeholder.parentNode.removeChild(placeholder);
      }

      // Always claim the hovered card’s slot → insert placeholder BEFORE it
      if (placeholder.nextSibling !== target) {
        target.parentNode.insertBefore(placeholder, target);
      }
    });


    // Allow dropping into empty space in the grid → move to end
    $grid.on("dragover.mgMoves", (ev) => {
      // only if we're over the grid but not over a specific card
      if (!dragId) return;
      if (ev.target.closest(".move-block")) return; // handled by the other handler
      ev.preventDefault();

      // If there’s no placeholder yet, append to the end
      if (!placeholder.parentNode || placeholder.parentNode !== $grid[0]) {
        clearPreview();
        $grid[0].appendChild(placeholder);
      }
    });

    // Drop: move the dragged element where the placeholder sits, then persist
    $grid.on("drop.mgMoves", async (ev) => {
      if (!dragId || !dragEl) return;
      ev.preventDefault();

      // If no placeholder (edge case), do nothing
      if (!placeholder.parentNode) return;

      // Move the card to the placeholder position
      placeholder.parentNode.insertBefore(dragEl, placeholder);
      clearPreview();

      // Persist order flag
      const ids = $grid.find(".move-block").map((_i, el) => el.dataset.itemId).get();
      await this.actor.setFlag("midnight-gambit", "moveOrder", ids);
    });

    // Re-apply saved order once on render
    this._mgApplyMoveOrderToDom($grid);

    // Track Move create/delete while this sheet is open
    this._mgMoveCreateHook = async (item) => {
      if (item?.parent !== this.actor || item.type !== "move") return;
      setTimeout(async () => {
        const $grid2 = this.element.find(".moves-grid");
        if (!$grid2.length) return;
        const order = (await this.actor.getFlag("midnight-gambit", "moveOrder")) ?? [];
        if (!order.includes(item.id)) {
          const ids = $grid2.find(".move-block").map((_i, el) => el.dataset.itemId).get();
          await this.actor.setFlag("midnight-gambit", "moveOrder", ids);
        }
      }, 0);
    };
    this._mgMoveDeleteHook = async (item) => {
      if (item?.parent !== this.actor || item.type !== "move") return;
      const order = (await this.actor.getFlag("midnight-gambit", "moveOrder")) ?? [];
      if (order.includes(item.id)) {
        await this.actor.setFlag("midnight-gambit", "moveOrder", order.filter(id => id !== item.id));
      }
    };
    Hooks.on("createItem", this._mgMoveCreateHook);
    Hooks.on("deleteItem", this._mgMoveDeleteHook);
  }

  _mgRefreshGuiseVisibility(html = this.element) {
    const hasSystemGuise =
      Boolean(getProperty(this.actor, "system.guise")) ||
      Boolean(getProperty(this.actor, "system.guiseId")) ||
      Boolean(getProperty(this.actor, "system.guise.active"));

    const hasItemGuise = Array.isArray(this.actor.items)
      ? this.actor.items.some(i => i.type === "guise")
      : false;

    const hasGuise = hasSystemGuise || hasItemGuise;

    const $root = html instanceof jQuery ? html : $(html);
    $root.find("[data-requires-guise]").toggle(hasGuise);
    $root.find("[data-hides-with-guise]").toggle(!hasGuise);
  }  
  async _onDrop(event) {
    try {
      const data = TextEditor.getDragEventData(event);
      if (data?.type === "Item" && data?.uuid) {
        const src = await fromUuid(data.uuid).catch(() => null);
        if (src?.documentName === "Item" && src.type === "gambit") {
          const tier = String(src.system?.tier ?? "").toLowerCase();

          // Block Crew-tier on players
          if (tier === "crew") {
            ui.notifications?.warn("Crew-tier Gambits can only be added to the Crew.");
            return false;
          }

          // Deck capacity confirm (players)
          const g = this.actor.system?.gambits ?? {};
          const deck = Array.isArray(g.deck) ? g.deck : [];
          const deckMax = this._mgGetPlayerGambitMax();

          if (deck.length >= deckMax) {
            const ok = await Dialog.confirm({
              title: "Over Deck Limit?",
              content: `
                <p>You're going over your max available Player Gambits for this level
                (<strong>${deck.length}/${deckMax}</strong>).</p>
                <p><em>Only add this if your Director approves!</em></p>
              `,
              defaultYes: false,
              yes: () => true, no: () => false
            });
            if (!ok) return false;
          }
        }
      }
    } catch (_) { /* no-op */ }

    return super._onDrop?.(event) ?? false;
  }

  /** Ensure inline TinyMCE saves don't close/reopen the actor sheet */
  async _onSubmit(event, { updateData = null, preventClose = false } = {}) {
    event.preventDefault();
    // Always prevent close for this sheet; X / Esc still close it manually
    return super._onSubmit(event, { updateData, preventClose: true });
  }

  // Cleanup our temporary hooks when the sheet closes
  async close(options) {
    try {
      if (this._mgMoveCreateHook) Hooks.off("createItem", this._mgMoveCreateHook);
      if (this._mgMoveDeleteHook) Hooks.off("deleteItem", this._mgMoveDeleteHook);
      this._mgMoveCreateHook = null;
      this._mgMoveDeleteHook = null;
    } catch (_) {}

    try {
      if (this._mgCrewNameHook) Hooks.off("updateActor", this._mgCrewNameHook);
      this._mgCrewNameHook = null;
    } catch (_) {}

    return super.close(options);
  }
}

