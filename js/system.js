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

  // TinyMCE — use our copied skin folder directly + our content css
  CONFIG.TinyMCE = foundry.utils.mergeObject(CONFIG.TinyMCE ?? {}, {
    // skin_url points to the folder that CONTAINS skin.min.css
    skin_url: foundry.utils.getRoute("systems/midnight-gambit/assets/tinymce/skins/ui/mg"),

    // content CSS is a FILE path (iframe styles)
    content_css: [
      foundry.utils.getRoute("systems/midnight-gambit/assets/tinymce/skins/content/mg/content.css")
    ],

    menubar: false,
    branding: false,
    statusbar: false,
    plugins: "lists link code",
    toolbar: "undo redo | bold italic underline | bullist numlist | link removeformat | code"
  }, { inplace: false });

  console.log("MG | TinyMCE skin_url:", CONFIG.TinyMCE.skin_url);

  // --- MG TinyMCE: force interior padding (override TinyMCE's 1px inline styles)
  {
    const cfg = CONFIG.TinyMCE ?? {};
    const existingSetup = typeof cfg.setup === "function" ? cfg.setup : null;

    cfg.setup = (editor) => {
      if (existingSetup) existingSetup(editor);

      const applyBodyPadding = () => {
        const b = editor.getBody();
        if (!b) return;
        b.style.boxSizing = "border-box";
        b.style.paddingLeft = "1.125rem";
        b.style.paddingRight = "1.125rem";
        // you can tweak the values above to match your spacing scale
      };

      // Do it on init and whenever content/selection changes (autoresize sometimes re-applies inline styles)
      ["init", "SetContent", "NodeChange"].forEach(ev => editor.on(ev, applyBodyPadding));
    };

    CONFIG.TinyMCE = cfg;
  }


  // --- MG TinyMCE: add autoresize + Max height
  {
    const cfg = CONFIG.TinyMCE ?? {};

    // Cap how tall the editor can grow before it scrolls internally
    cfg.min_height = cfg.min_height ?? 140;
    cfg.max_height = 320; // <-- pick your cap (e.g., 280 / 320 / 400)

    // Make sure autoresize is active
    const pluginSet = new Set(String(cfg.plugins || "").split(/\s+/).filter(Boolean));
    pluginSet.add("autoresize");
    cfg.plugins = Array.from(pluginSet).join(" ");

    // Keep the bottom bar off so it doesn't add stray pixels
    cfg.statusbar = false;
    cfg.resize = false;

    // Update the iframe CSS: allow vertical scrolling when at max height
    const padCSS = `
      /* Padding + scrolling INSIDE the editor iframe */
      body.mce-content-body {
        padding: 1.125rem !important;
        margin: 0;
        line-height: 1.4;
        box-sizing: border-box;
        overflow-y: auto;            /* <-- allow scroll only when needed */
        overscroll-behavior: contain;/* keep wheel from bubbling past editor */
      }
      body.mce-content-body > :first-child { margin-top: 0; }
      body.mce-content-body > :last-child  { margin-bottom: 0; }
    `;
    cfg.content_style = (cfg.content_style ? cfg.content_style + "\n" : "") + padCSS;

    CONFIG.TinyMCE = cfg;
  }

  // --- Server-side file writer for dev exports ---
  Hooks.once("ready", () => {
    if (game.user.isGM) {
      game.socket.on("system.midnight-gambit", async (data) => {
        if (data.action !== "writeDB") return;
        const fs = require("fs");
        const path = require("path");
        const fullPath = path.join(foundry.utils.getBasePath("data"), data.path);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, data.content, "utf8");
        console.log(`[Midnight Gambit] Exported pack to ${data.path}`);
      });
    }
  });

  try {
    const { ITEM_TAGS, ASSET_TAGS, LEVEL_TABLE } = await import("../config.js");
    CONFIG.MidnightGambit ??= {};
    const customTags      = game.settings.get("midnight-gambit", "customTags") || [];
    const assetCustomTags = game.settings.get("midnight-gambit", "assetCustomTags") || [];

    CONFIG.MidnightGambit.ITEM_TAGS  = [...ITEM_TAGS,  ...customTags];
    CONFIG.MidnightGambit.ASSET_TAGS = [...ASSET_TAGS, ...assetCustomTags];
    CONFIG.MidnightGambit.LEVELS     = LEVEL_TABLE;


  } catch (e) {
    console.error("❌ Failed to load config data in init:", e);
  }
});
