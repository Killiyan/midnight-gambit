export class GuiseSheet extends ItemSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      template: "systems/midnight-gambit/templates/items/guise-sheet.html",
      width: 500,
      height: 400
    });
  }

  getData(options) {
    const data = super.getData(options);
    data.system = this.item.system;
    data.system.moves ??= [];
    data.system.modifiers ??= {};
    data.system.sparkSlots ??= 0;
    data.system.riskDice ??= 5;
    data.system.casterType ??= "none";

    data.attributeKeys = [
      "tenacity", "finesse", "resolve", "guile",
      "instinct", "presence"
    ];

    return data;
  }




  activateListeners(html) {
  super.activateListeners(html);

    html.find(".add-move").on("click", async (event) => {
      event.preventDefault();
      const moves = duplicate(this.item.system.moves || []);
      moves.push({ name: "", description: "" });
      await this.item.update({ "system.moves": moves });
    });
  }
}
