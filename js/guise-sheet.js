export class GuiseSheet extends ItemSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      template: "systems/midnight-gambit/templates/items/guise-sheet.html",
      width: 500,
      height: 400
    });
  }

  async getData(options) {
    const data = await super.getData(options);

    data.system = this.item.system; // This must come first

    // Force Safe Default structure
    data.system.moves = Array.isArray(data.system.moves) ? data.system.moves : [];
    data.system.modifiers ??= {};
    data.system.sparkSlots ??= 0;
    data.system.riskDice ??= 5;
    data.system.casterType ??= "none";
    data.system.description = (data.system.description ?? "").trim();
    data.system.signaturePerk ??= "";
    data.system.signatureDescription = (data.system.signatureDescription ?? "").trim();

    data.attributeKeys = [
      "tenacity", "finesse", "resolve", "guile",
      "instinct", "presence"
    ];

    return data;
  }





  activateListeners(html) {
    super.activateListeners(html);
    const sheet = this;

    // Add Move
    html.find(".add-move").on("click", async () => {
      const moves = duplicate(this.item.system.moves ?? []);
      moves.push({ name: "", description: "" });
      await this.item.update({ "system.moves": moves });
      this.render(true);
    });


    // Remove Move
    html.find(".remove-move").on("click", async (event) => {
      const idx = Number(event.currentTarget.dataset.index);
      const moves = duplicate(this.item.system.moves ?? []);
      moves.splice(idx, 1);
      await this.item.update({ "system.moves": moves });
      this.render(true);
    });

    // Manual Move Name Update
    html.find(".move-name").on("change", async (event) => {
      const idx = Number(event.currentTarget.dataset.index);
      const value = event.currentTarget.value;
      const moves = duplicate(this.item.system.moves ?? []);
      moves[idx].name = value;
      await this.item.update({ "system.moves": moves });
    });
    
    // Manual Move Description Update
    html.find(".move-description").on("change", async (event) => {
      const idx = Number(event.currentTarget.dataset.index);
      const value = event.currentTarget.value;
      const moves = duplicate(this.item.system.moves ?? []);
      moves[idx].description = value;
      await this.item.update({ "system.moves": moves });
    });
  }

  async _updateObject(event, formData) {
    // Expand dot syntax from the form into an object
    const expanded = expandObject(formData);

    // Clean the description values
    if (expanded.system?.description) {
      expanded.system.description = expanded.system.description.trim();
    }
    if (expanded.system?.signatureDescription) {
      expanded.system.signatureDescription = expanded.system.signatureDescription.trim();
    }

    // Save the cleaned data
    return await this.item.update(expanded);
  }

}
