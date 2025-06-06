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

      context.attributeKeys = [
        "tenacity",
        "finesse",
        "resolve",
        "guile",
        "instinct",
        "presence"
      ];

      const guiseId = this.actor.system.guise;
      if (guiseId) {
        const guise = game.items.get(guiseId);
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


      context.data = context;  // <- this makes all context vars available to the template root

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

      /** This looks for strain amount and adds/removes on clicks */
      html.find(".strain-dot").on("click", async (event) => {
        const el = event.currentTarget;
        const strainType = el.dataset.type;
        const clickedValue = parseInt(el.dataset.value);

        const actor = this.actor;
        if (!actor) return;

        const currentValue = getProperty(actor.system.strain, strainType);

        /** I think this guy makes it so that if you click the last track of strain, it removes the damage */
        const newValue = (clickedValue === currentValue) ? clickedValue - 1 : clickedValue;

        console.log(`Clicked ${strainType} strain: ${clickedValue} (was ${currentValue}) → ${newValue}`);

        await actor.update({ [`system.strain.${strainType}`]: newValue });
        this.render(false);
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
      html.find(".draw-gambit").on("click", async (event) => {
        const deck = this.actor.system.gambits.deck ?? [];
        const drawn = this.actor.system.gambits.drawn ?? [];

        if (deck.length === 0) return;

        const index = Math.floor(Math.random() * deck.length);
        const [card] = deck.splice(index, 1);
        drawn.push(card);

        await this.actor.update({
          "system.gambits.deck": deck,
          "system.gambits.drawn": drawn
        });
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
        const cardId = event.currentTarget.dataset.cardId;
        if (!cardId) return;

        const deck = this.actor.system.gambits.deck ?? [];
        const drawn = this.actor.system.gambits.drawn ?? [];

        // Find the card in drawn
        const cardIndex = drawn.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return;

        const card = drawn[cardIndex];

        const updatedDeck = [...deck, card];
        const updatedDrawn = [...drawn];
        updatedDrawn.splice(cardIndex, 1);

        await this.actor.update({
          "system.gambits.deck": updatedDeck,
          "system.gambits.drawn": updatedDrawn
        });
      });

      // Handle dragstart
      html.find('.gambit-card').on('dragstart', event => {
        const cardId = event.currentTarget.dataset.cardId;
        const source = event.currentTarget.dataset.source;
        if (!cardId || !source) return;
        event.originalEvent.dataTransfer.setData("text/plain", JSON.stringify({ cardId, source }));
      });

      // Handle drop on deck or drawn
      const handleDrop = (targetArea) => {
        return async (event) => {
          event.preventDefault();
          const data = JSON.parse(event.originalEvent.dataTransfer.getData("text/plain"));
          const { cardId, source } = data;

          if (source === targetArea) return; // no-op

          const deck = this.actor.system.gambits.deck ?? [];
          const drawn = this.actor.system.gambits.drawn ?? [];

          let from = source === "deck" ? deck : drawn;
          let to = source === "deck" ? drawn : deck;

          const cardIndex = from.findIndex(c => c.id === cardId);
          if (cardIndex === -1) return;

          const card = from[cardIndex];
          from = [...from];
          to = [...to, card];
          from.splice(cardIndex, 1);

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
          "system.strain.manualOverride.mortal capacity": false,
          "system.strain.manualOverride.soul capacity": false
        };

        await actor.update(updates);
        await actor.prepareData();  // force recompute
        this.render(true);
        ui.notifications.info(`${actor.name} has completed a Long Rest.`);
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

    }


  //Drag and Drop guise action
  async _onDropItemCreate(itemData) {
    if (itemData.type === "guise") {
      console.log("✅ Dropped a guise item on actor");

      // Set base attributes if missing
      if (!this.actor.system.baseAttributes || Object.keys(this.actor.system.baseAttributes).length === 0) {
        const base = foundry.utils.deepClone(this.actor.system.attributes);
        await this.actor.update({ "system.baseAttributes": base });
      }

      let guise = await fromUuid(itemData.uuid || `Item.${itemData._id}`);
      if (!guise) guise = game.items.get(itemData._id);
      if (!guise) {
        ui.notifications.error("Could not locate the dropped Guise item.");
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
        "system.guise": guise.id,
        "system.casterType": casterType,
        "system.sparkSchool1": sparkSchool1,
        "system.sparkSchool2": sparkSchool2
      });

      ui.notifications.info(`${guise.name} applied as new Guise!`);
      await this.render(true);
      return [];
    }

    return super._onDropItemCreate(itemData);
  }

}
