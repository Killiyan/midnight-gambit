import { evaluateRoll } from "./roll-utils.js";

export class MidnightGambitActorSheet extends ActorSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      template: "systems/midnight-gambit/templates/actors/actor-sheet.html",
      width: 800,
      height: 950
    });
  }

    //Grabbing all the actor data information to create the initial sheet
    async getData(options) {
      const context = await super.getData(options);

      // Make sure the actor is available in the template
      context.actor = this.actor;
      context.system = this.actor.system;
      
      const deckIds = context.system.gambits.deck ?? [];
      const drawnIds = context.system.gambits.drawn ?? [];
      const discardIds = context.system.gambits.discard ?? [];

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
      
      // Show which Attribute powers each skill in the UI (shorthand, lower-case)
      context.skillAttrShort = {
        brawl: "ten", endure: "ten", athletics: "ten",
        aim: "fin", stealth: "fin", sleight: "fin",
        will: "res", grit: "res",
        lore: "gui", investigate: "gui", deceive: "gui", spark: "gui",
        survey: "ins", hunt: "ins", nature: "ins",
        command: "pre", charm: "pre", perform: "pre"
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

      context.data = context;  // <- this makes all context vars available to the template root
      context.tags = CONFIG.MidnightGambit?.ITEM_TAGS ?? [];
      return context;
    }

    /** Binds event listeners after rendering. This is the Event listener for most the system*/
    activateListeners(html) {
      super.activateListeners(html);

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

      //Shuffle Function
      function shuffleArray(array) {
        const copy = [...array];
        for (let i = copy.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
      }

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
        await actor.update({ [`system.strain.${strainType}`]: newValue }, { render: false });

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

      const tabs = new Tabs({
        navSelector: groupEl ? `nav.sheet-tabs[data-group="${group}"]` : `nav.sheet-tabs`,
        contentSelector: `.tab-content`,
        initial: initialTab
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
              navBtn.append(`<span class="mg-pending-badge" aria-hidden="true">${total}</span>`);
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

        await this.actor.update(update);
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
        const itemId = event.currentTarget.dataset.itemId;
        if (!itemId) return;

        const { deck = [], drawn = [] } = this.actor.system.gambits;

        const updatedDeck = [...deck, itemId];
        const updatedDrawn = drawn.filter(id => id !== itemId);

        await this.actor.update({
          "system.gambits.deck": updatedDeck,
          "system.gambits.drawn": updatedDrawn
        });
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
          // Fill up to clicked
          newUsed = total - clicked;
        } else {
          // Unfill clicked and right
          newUsed = total - (clicked - 1);
        }

        console.log(`Spark clicked: ${clicked} → sparkUsed: ${newUsed} (was ${used})`);
        await this.actor.update({ "system.sparkUsed": newUsed });
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

      //Capacity Boxes add on Click, and remove on Shift click
      html.find(".capacity-box input").on("click", async (event) => {
        const input = event.currentTarget;
        const name = input.name; // e.g., "system.strain.mortal capacity"
        const path = input.name; // e.g. "system.strain.mortal capacity"
        const current = foundry.utils.getProperty(this.actor.system, path.replace("system.", ""));
        const type = name.includes("mortal") ? "mortal" : "soul";

        const direction = event.shiftKey ? 1 : -1;
        const newValue = Math.max(0, current + direction);

        await checkArmorDamage(this.actor, current, newValue, type);

        const updates = {
          [`system.strain.${type} capacity`]: newValue,
          [`system.strain.manualOverride.${type} capacity`]: true
        };

        await this.actor.update(updates);
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


      //Rolling Attributes in chat with the right logic
      html.find(".attribute-modifier").on("click", async (event) => {
        const attrKey = event.currentTarget.dataset.key;
        const mod = this.actor.system.attributes?.[attrKey] ?? 0;

        const pool = 2 + Math.abs(mod);
        const rollType = mod >= 0 ? "kh2" : "kl2";
        const formula = `${pool}d6${rollType}`;

        await evaluateRoll({
          formula,
          label: `Attribute Roll: ${attrKey.toUpperCase()}`,
          actor: this.actor
        });
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
        will: "resolve", grit: "resolve",
        lore: "guile", investigate: "guile", deceive: "guile", spark: "guile",
        survey: "instinct", hunt: "instinct", nature: "instinct",
        command: "presence", charm: "presence", perform: "presence"
      };

      const skillAttributeDisplay = {
        brawl: "Ten", endure: "Ten", athletics: "Ten",
        aim: "Fin", stealth: "Fin", sleight: "Fin",
        will: "Res", grit: "Res",
        lore: "Gui", investigate: "Gui", deceive: "Gui", spark: "Gui",
        survey: "Ins", hunt: "Ins", nature: "Ins",
        command: "Pre", charm: "Pre", perform: "Pre"
      };

      html.find(".skill-name, .skill-value").on("click", async (event) => {
        const skillKey = event.currentTarget.dataset.key;
        const skillMod = this.actor.system.skills?.[skillKey] ?? 0;

        const skillAttributeMap = {
          brawl: "tenacity", endure: "tenacity", athletics: "tenacity",
          aim: "finesse", stealth: "finesse", sleight: "finesse",
          will: "resolve", grit: "resolve",
          lore: "guile", investigate: "guile", deceive: "guile", spark: "guile",
          survey: "instinct", hunt: "instinct", nature: "instinct",
          command: "presence", charm: "presence", perform: "presence"
        };

        const attrKey = skillAttributeMap[skillKey];
        const attrMod = this.actor.system.attributes?.[attrKey] ?? 0;

        const pool = 2 + Math.abs(attrMod);
        const rollType = attrMod >= 0 ? "kh2" : "kl2";
        const formula = `${pool}d6${rollType}`;

        await evaluateRoll({
          formula,
          skillMod,
          label: `Skill Roll: ${skillKey.toUpperCase()} (${attrKey.toUpperCase()})`,
          actor: this.actor
        });
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



      //Setting values before Foundry Sheet refresh - Fixes Mortal and Soul Capacity
      html.find("input").on("keydown", async (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          const input = event.currentTarget;
          const name = input.name;
          const value = parseInt(input.value);

          const updates = {};

          if (name === "system.strain.mortal capacity") {
            updates["system.strain.manualOverride.mortal capacity"] = true;
            updates["system.strain.mortal capacity"] = value;
          } else if (name === "system.strain.soul capacity") {
            updates["system.strain.manualOverride.soul capacity"] = true;
            updates["system.strain.soul capacity"] = value;
          }

          await this.actor.update(updates);
          this.render(false);
          input.blur();
        }
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

      // Open item sheet when clicking the inventory item
      html.find(".clickable-item").on("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        // Go up to the inventory-item div
        const parent = event.currentTarget.closest(".inventory-item");
        if (!parent) return;

        const itemId = parent.dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (item) item.sheet.render(true);
      });

      //Posting Item Tags listener
      html.find(".post-weapon-tags, .post-armor-tags, .post-misc-tags").on("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const itemId = event.currentTarget.dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;

        const { name, system, type } = item;
        const tagData = (system.tags || [])
          .map(tagId => {
            const tagDef = CONFIG.MidnightGambit?.ITEM_TAGS?.find(t => t.id === tagId);
            return tagDef
              ? `<span class="item-tag" data-tooltip="${tagDef.description}">${tagDef.label}</span>`
              : `<span class="item-tag">${tagId}</span>`;
          })
          .join(" ");

        let extraInfo = "";

        // Weapon: Strain Damage
        if (type === "weapon" && system.strainDamage) {
          extraInfo += `<p><strong>Strain Damage:</strong> ${system.strainDamage}</p>`;
        }

        // Armor: MC / SC
        if (type === "armor") {
          const mc = system.mortalCapacity ?? 0;
          const sc = system.soulCapacity ?? 0;
          if (mc || sc) {
            extraInfo += `<p><strong>Strain Capacity:</strong> MC ${mc} / SC ${sc}</p>`;
          }
        }

        // Misc: Strain Damage + Capacity
        if (type === "misc") {
          if (system.strainDamage) {
            extraInfo += `<p><strong>Strain Damage:</strong> ${system.strainDamage}</p>`;
          }

          const mc = system.mortalCapacity ?? 0;
          const sc = system.soulCapacity ?? 0;
          if (mc || sc) {
            extraInfo += `<p><strong>Strain Capacity:</strong> MC ${mc} / SC ${sc}</p>`;
          }
        }

        const content = `
          <div class="chat-item">
            <h2><i class="fa-solid fa-shield"></i> ${name}</h2>
            ${system.description ? `<p><em>${system.description}</em></p>` : ""}
            ${extraInfo}
            ${tagData ? `<strong>Tags:</strong><div class="chat-tags">${tagData}</div>` : ""}
          </div>
        `;

        ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor: this.actor }),
          content
        });

        // Tooltip fallback (redundant, but safe)
        html.find(".item-tag").each(function () {
          const tooltip = this.dataset.tooltip;
          if (tooltip) this.setAttribute("title", tooltip);
        });
      });

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

    }
    
  //END EVENT LISTENERS
  //---------------------------------------------------------------------------------------------------------------------------

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

      const currentDeck = this.actor.system.gambits.deck ?? [];
      const level = this.actor.system.level ?? 1;
      const maxDeck = 3; // TODO: scale later based on level

      if (currentDeck.length >= maxDeck) {
        ui.notifications.warn(`You can only have ${maxDeck} Gambits in your deck at Level ${level}.`);
        return []; // prevent adding to deck
      }

      if (!currentDeck.includes(gambitItem.id)) {
        await this.actor.update({
          "system.gambits.deck": [...currentDeck, gambitItem.id]
        });
      }

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

    return super._onDropItemCreate(itemData);
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

  // Cleanup our temporary hooks when the sheet closes
  async close(options) {
    try {
      if (this._mgMoveCreateHook) Hooks.off("createItem", this._mgMoveCreateHook);
      if (this._mgMoveDeleteHook) Hooks.off("deleteItem", this._mgMoveDeleteHook);
      this._mgMoveCreateHook = null;
      this._mgMoveDeleteHook = null;
    } catch (_) {}
    return super.close(options);
  }
}

