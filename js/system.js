import "./hooks.js";
import { MidnightGambitActor } from "./actor.js";
import { MidnightGambitItem } from "./item.js";
import { GuiseSheet } from "./guise-sheet.js";
import { MidnightGambitActorSheet } from "./sheet.js";

// Initializing my custom actor and pointing to its HTML structure
Hooks.once("init", () => {
  console.log("Midnight Gambit | Initializing System");

  // Register custom Item Sheet
  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("midnight-gambit", GuiseSheet, {
    types: ["guise"],
    makeDefault: true
  });

  // Assign custom Actor class
  CONFIG.Actor.documentClass = MidnightGambitActor;

  // Register custom Actor Sheet
  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet("midnight-gambit", MidnightGambitActorSheet, {
    types: ["character"],
    makeDefault: true
  });
});
