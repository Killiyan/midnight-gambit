import "./hooks.js";
import { MidnightGambitActor } from "./actor.js";
import { MidnightGambitItem } from "./item.js";
import { GuiseSheet } from "./guise-sheet.js";
import { MidnightGambitActorSheet } from "./sheet.js";
import { MidnightGambitItemSheet } from "./item-sheet.js";
import { MidnightGambitCrewSheet } from "./crew-sheet.js";



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

  game.settings.register("midnight-gambit", "initiativeProgress", {
    name: "Initiative Progress",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  // Persist whether the Initiative Bar is open across refresh
  game.settings.register("midnight-gambit", "initiativeOpen", {
    name: "Initiative Bar Open",
    scope: "client",   // per-user so GMs/players don't force each other open
    config: false,
    type: Boolean,
    default: false
  });

  //Setting custom tag rules so they persist
  game.settings.register("midnight-gambit", "customTags", {
    name: "Custom Tags",
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  game.settings.register("midnight-gambit", "assetCustomTags", {
    name: "Asset Custom Tags",
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  // Register Item Sheets
  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("midnight-gambit", MidnightGambitItemSheet, {
    types: ["weapon", "armor", "misc", "gambit", "move", "asset"],
    makeDefault: true
  });

  Items.registerSheet("midnight-gambit", GuiseSheet, {
    types: ["guise"],
    makeDefault: false
  });

  Actors.registerSheet("midnight-gambit", MidnightGambitCrewSheet, {
    types: ["crew"],
    makeDefault: true
  });

  try {
    const { ITEM_TAGS, ASSET_TAGS, LEVEL_TABLE } = await import("../config.js");
    CONFIG.MidnightGambit ??= {};
    const customTags      = game.settings.get("midnight-gambit", "customTags") || [];
    const assetCustomTags = game.settings.get("midnight-gambit", "assetCustomTags") || [];

    CONFIG.MidnightGambit.ITEM_TAGS  = [...ITEM_TAGS,  ...customTags];
    CONFIG.MidnightGambit.ASSET_TAGS = [...ASSET_TAGS, ...assetCustomTags];
    CONFIG.MidnightGambit.LEVELS     = LEVEL_TABLE;

    console.log("✅ ITEM_TAGS, ASSET_TAGS & LEVEL_TABLE loaded into CONFIG at init");
  } catch (e) {
    console.error("❌ Failed to load config data in init:", e);
  }
});
