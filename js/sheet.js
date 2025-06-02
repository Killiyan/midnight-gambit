export class MidnightGambitActorSheet extends ActorSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      template: "systems/midnight-gambit/templates/actors/actor-sheet.html",
      width: 800,
      height: 950
    });
  }

    async getData(options) {
      const data = await super.getData(options);

      data.attributeKeys = [
        "tenacity",
        "finesse",
        "resolve",
        "guile",
        "instinct",
        "presence"
      ];

      return data;
    }

    /** Binds event listeners after rendering. This is the Event listener for most the system*/
    activateListeners(html) {
      super.activateListeners(html);

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

      /**This is the listener for clicking the :Load Levels */
      html.find(".load-icon").on("click", async (event) => {
        const load = event.currentTarget.dataset.load;
        await this.actor.update({ "system.load": load });
        this.render(false);
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
          "system.baseStrainCapacity.mortal": guise?.system.strainCapacity?.mortal ?? 0,
          "system.baseStrainCapacity.soul": guise?.system.strainCapacity?.soul ?? 0
        };

        await actor.update(updates);
        ui.notifications.info(`${actor.name} has completed a Long Rest.`);
      });
    }

    async _onDropItemCreate(itemData) {
      if (itemData.type === "guise") {
        console.log("✅ Dropped a guise item on actor");

        // Snapshot base attributes if not already set
        if (!this.actor.system.baseAttributes || Object.keys(this.actor.system.baseAttributes).length === 0) {
          const base = foundry.utils.deepClone(this.actor.system.attributes);
          await this.actor.update({ "system.baseAttributes": base });
        }

        // Update actor to reference the guise
        await this.actor.update({ "system.guise": itemData._id });

        // Prevent item from being added to inventory
        return [];
      }

      // Let Foundry handle other item types
      return super._onDropItemCreate(itemData);
    }
}
