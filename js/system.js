import "./hooks.js";
import { MidnightGambitActor } from "./actor.js";
import { MidnightGambitItem } from "./item.js";
import { GuiseSheet } from "./guise-sheet.js";
import { MidnightGambitActorSheet } from "./sheet.js";
import { MidnightGambitItemSheet } from "./item-sheet.js";


// Initializing my custom actor and pointing to its HTML structure
//Also initiating Item sheet
Hooks.once("init", async () => {
  console.log("Midnight Gambit | Initializing System");

  // Register custom document classes
  CONFIG.Actor.documentClass = MidnightGambitActor;
  CONFIG.Item.documentClass = MidnightGambitItem;

  // Register Actor Sheet
  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet("midnight-gambit", MidnightGambitActorSheet, {
    types: ["character"],
    makeDefault: true
  });

  //Setting custom tag rules so they persist
  game.settings.register("midnight-gambit", "customTags", {
    name: "Custom Tags",
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  // Register Item Sheets
  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("midnight-gambit", MidnightGambitItemSheet, {
    types: ["weapon", "armor", "misc", "gambit"],
    makeDefault: true
  });

  Items.registerSheet("midnight-gambit", GuiseSheet, {
    types: ["guise"],
    makeDefault: false
  });

  try {
    const { ITEM_TAGS } = await import("../config.js");
    CONFIG.MidnightGambit ??= {};
    const customTags = game.settings.get("midnight-gambit", "customTags") || [];
    CONFIG.MidnightGambit.ITEM_TAGS = [...ITEM_TAGS, ...customTags];

    console.log("✅ ITEM_TAGS loaded into CONFIG at init");
  } catch (e) {
    console.error("❌ Failed to load ITEM_TAGS in init:", e);
  }
});
