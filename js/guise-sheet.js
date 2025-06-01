export class GuiseSheet extends ItemSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      template: "systems/midnight-gambit/templates/items/guise-sheet.html",
      width: 500,
      height: 400
    });
  }
}
