import { evaluateRoll } from "./roll-utils.js";

export class MidnightGambitActorSheet extends ActorSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      template: "systems/midnight-gambit/templates/actors/actor-sheet.html",
      width: 800,
      height: 950
    });
  }

    async getData(options) {
      const context = await super.getData(options);

      // Make sure the actor is available in the template
      context.actor = this.actor;
      context.system = this.actor.system;

      const deckIds = context.system.gambits.deck ?? [];
      const drawnIds = context.system.gambits.drawn ?? [];
      const discardIds = context.system.gambits.discard ?? [];
      
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


      /** This adds a tab section for the charaacter sheet and sets the selectors for said tabs. Also sets the tabs to stay on the active tab after a render */
      const currentTab = this.actor.getFlag("midnight-gambit", "activeTab") ?? "general";

      const tabs = new Tabs({
        navSelector: ".sheet-tabs",
        contentSelector: ".tab-content",
        initial: currentTab
      });
      tabs.bind(html[0]);

      // Track tab changes and store to flags
      html.find(".sheet-tabs .item").on("click", async (event) => {
        const tab = event.currentTarget.dataset.tab;
        if (tab) await this.actor.setFlag("midnight-gambit", "activeTab", tab);
      });


      // Move floating tab nav outside .window-content so it's not clipped
      const nav = html.find(".sheet-tabs.floating");
      const app = html.closest(".window-app");
      if (nav.length && app.length) {
        app.append(nav);
      }

      // Drawing button for Gambits
      html.find(".draw-gambit").on("click", async () => {
        console.log("DRAW DEBUG:", this.actor.system.gambits);
        
        const { deck = [], drawn = [], maxDrawSize = 3, locked = false } = this.actor.system.gambits;

        if (locked || drawn.length >= maxDrawSize || deck.length === 0) {
          ui.notifications.warn("Cannot draw more cards.");
          return;
        }

        const drawCount = Math.min(maxDrawSize - drawn.length, deck.length);
        const shuffled = shuffleArray(deck);
        const newDrawn = [...drawn, ...shuffled.slice(0, drawCount)];
        const newDeck = deck.filter(id => !newDrawn.includes(id));

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
      });


      //Making it so if you click moves in the Character sheet they post to chat!
      html.find(".post-move").on("click", event => {
        const name = event.currentTarget.dataset.moveName || "Unknown Move";
        const description = event.currentTarget.dataset.moveDescription || "";

        const chatContent = `
          <div class="chat-move">
            <h2>${name}</h2>
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
            <h2>Signature Perk: ${name}</h2>
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

        const confirmed = await Dialog.confirm({
          title: "Remove Guise?",
          content: "<p>Are you sure you want to unassign this Guise? This will keep all your current values.</p>",
          yes: () => true,
          no: () => false,
          defaultYes: false
        });

        if (!confirmed) return;

        await this.actor.update({ "system.guise": null });
        this.render(true);
      });

      //Attribute Roll Logic
      html.find(".attribute-modifier").on("contextmenu", async (event) => {
        event.preventDefault();

        const $target = $(event.currentTarget);
        const attrKey = $target.data("key");
        const current = Number($target.data("base"));

        const newValue = await Dialog.prompt({
          title: `Edit ${attrKey}`,
          content: `<label>Base ${attrKey}: <input type="number" value="${current}" name="value" /></label>`,
          callback: (html) => html.find('input[name="value"]').val(),
          rejectClose: false,
        });

        if (newValue !== null) {
          await this.actor.update({ [`system.baseAttributes.${attrKey}`]: parseInt(newValue) });
        }
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

      html.find(".skill-value").on("contextmenu", async (event) => {
        event.preventDefault();
        const key = event.currentTarget.dataset.key;
        const current = parseInt(event.currentTarget.dataset.base) || 0;

        const newValue = await Dialog.prompt({
          title: `Edit Skill: ${key}`,
          content: `<label>${key}: <input type="number" value="${current}" name="value" /></label>`,
          callback: html => html.find('input[name="value"]').val(),
          rejectClose: false,
        });

        if (newValue !== null && !isNaN(parseInt(newValue))) {
          await this.actor.update({ [`system.skills.${key}`]: parseInt(newValue) });
          this.render(false);
        }
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
          await item.update({ "system.capacityApplied": true });
        }

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

        const confirmed = await Dialog.confirm({
          title: `Delete ${item.name}?`,
          content: `<p>Are you sure you want to permanently delete <strong>${item.name}</strong> from your inventory?</p>`,
          yes: () => true,
          no: () => false,
          defaultYes: false
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
            <h2>${name}</h2>
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
      
      //Gambit Card Drag and Drop
      html.find(".gambit-card").on("dragstart", event => {
        const itemId = event.currentTarget.dataset.itemId;
        const source = event.currentTarget.dataset.source;
        if (!itemId || !source) return;

        event.originalEvent.dataTransfer.setData(
          "text/plain",
          JSON.stringify({ itemId, source })
        );
      });

      //Reset Gambit Button - like a long rest but for deck
      html.find(".reset-gambit-deck").on("click", async () => {
        const { deck = [], drawn = [], discard = [] } = this.actor.system.gambits;

        // Combine all into one
        const fullDeck = [...deck, ...drawn, ...discard];
        const shuffled = shuffleArray(fullDeck); // optional, but nice touch

        await this.actor.update({
          "system.gambits.deck": shuffled,
          "system.gambits.drawn": [],
          "system.gambits.discard": [],
          "system.gambits.locked": false
        });

        new Dialog({
          title: "Reset Gambit Deck",
          content: `<p>Are you sure you want to reset your Gambit deck?<br>All drawn and discarded cards will be returned to your deck.</p>`,
          buttons: {
            yes: {
              icon: '<i class="fas fa-check"></i>',
              label: "Reset",
              callback: async () => {
                const { deck = [], drawn = [], discard = [] } = actor.system.gambits;
                const fullDeck = [...deck, ...drawn, ...discard];
                const shuffled = shuffleArray(fullDeck);

                await actor.update({
                  "system.gambits.deck": shuffled,
                  "system.gambits.drawn": [],
                  "system.gambits.discard": [],
                  "system.gambits.locked": false
                });

                ui.notifications.info("Gambit deck has been reset.");
              }
            },
            no: {
              icon: '<i class="fas fa-times"></i>',
              label: "Cancel"
            }
          },
          default: "yes"
        }).render(true);

        ui.notifications.info("Gambit deck reset!");
      });

      //Post Gambit into Game chat
      html.find(".post-gambit").on("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const itemId = event.currentTarget.dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;

        const { name, system } = item;
        const { description = "", tier = "", tags = [] } = system;

        const tagLabels = (tags || [])
          .map(t => CONFIG.MidnightGambit.ITEM_TAGS.find(def => def.id === t)?.label || t)
          .join(", ");

        const html = `
          <div class="gambit-chat-card">
            <h2>🎴 ${name}</h2>
            <p><strong>Tier:</strong> ${tier.charAt(0).toUpperCase() + tier.slice(1)}</p>
            ${tagLabels ? `<p><strong>Tags:</strong> ${tagLabels}</p>` : ""}
            <p>${description}</p>
          </div>
        `;

        ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor: this.actor }),
          content: html
        });
      });

      //Gambit hand at bottom of the screen styling
      html.find(".gambit-hand-card").on("click", async (event) => {
        const itemId = event.currentTarget.dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;

        // 1. Post to chat
        await ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor: this.actor }),
          content: `<h2>🎴 ${item.name}</h2><p>${item.system.description}</p>`
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

      }

    //END EVENT LISTENERS
    //---------------------------------------------------------------------------------------------------------------------------

  //Drag and Drop guise action
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

      // Use fromUuid if coming from compendium (has UUID)
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

        await Dialog.prompt({
          title: "Choose Spark School(s)",
          content: form.outerHTML,
          callback: () => {
            const selected1 = document.querySelector('[name="sparkSchool1"]')?.value || "";
            sparkSchool1 = selected1;

            if (["full", "caster"].includes(casterType)) {
              const selected2 = document.querySelector('[name="sparkSchool2"]')?.value || "";
              sparkSchool2 = selected2;
            }
          },
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
          },
          rejectClose: false
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

    return super._onDropItemCreate(itemData);
  }
  //END DRAG AND DROP
  //---------------------------------------------------------------------------------------------------------------------------
}
