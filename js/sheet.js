export class MidnightGambitActorSheet extends ActorSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      template: "systems/midnight-gambit/templates/actors/actor-sheet.html",
      width: 800,
      height: 950
    });
  }

  activateListeners(html) {
    super.activateListeners(html);
    
    // your entire listener setup goes here (strain, flashback, tabs, gambits, etc.)
  }
}