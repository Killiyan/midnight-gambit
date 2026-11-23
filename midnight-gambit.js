import "./js/ui/companion.js";
import "./js/system.js";
import "./js/actors/actor.js";
import "./js/hooks.js";
import "./js/items/armor-alerts.js";
import "./js/helpers.js";
import "./js/actors/sheet.js";
import "./js/actors/crew-sheet.js";
import "./js/actors/npc-sheet.js";
import "./js/initiative/initiative-bar.js";
import "./js/ui/group-check.js";

Hooks.once("init", async () => {
  await loadTemplates(["systems/midnight-gambit/templates/actors/parts/inventory.html"]);
});
