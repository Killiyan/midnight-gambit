import "./hooks.js";
import "./mg-ui.js";
import "./sidebar-actor.js";
import { MidnightGambitActor } from "./actor.js";
import { MidnightGambitItem } from "./item.js";
import { GuiseSheet } from "./guise-sheet.js";
import { MidnightGambitActorSheet } from "./sheet.js";
import { MidnightGambitItemSheet } from "./item-sheet.js";
import { MidnightGambitCrewSheet } from "./crew-sheet.js";
import { MidnightGambitNpcSheet } from "./npc-sheet.js";

/* MG HUD Mode
==============================================================================================================================================*/

const MG_HUD_CLASS = "mg-hud-enabled";

const MG_HUD_TRANSITION_MS = 1000;

let mgHudTransitionTimer = null;

function mgClearHudTransitionClasses() {
	document.body?.classList.remove(
		"mg-ui-transitioning",
		"mg-ui-exiting-foundry",
		"mg-ui-entering-foundry",
		"mg-ui-exiting-mg",
		"mg-ui-entering-mg"
	);
}

function mgApplyHudMode(enabled, options = {}) {
	const animate = options.animate ?? false;
	const body = document.body;
	if (!body) return;

	if (mgHudTransitionTimer) {
		clearTimeout(mgHudTransitionTimer);
		mgHudTransitionTimer = null;
	}

	mgClearHudTransitionClasses();

	const currentlyEnabled = body.classList.contains(MG_HUD_CLASS);
	const nextEnabled = !!enabled;

	if (!animate || currentlyEnabled === nextEnabled) {
		body.classList.toggle(MG_HUD_CLASS, nextEnabled);
		game.mgUi?.refreshLogo?.();
		return;
	}

	body.classList.add("mg-ui-transitioning");

	if (nextEnabled) {
		// 1) Old Foundry UI exits.
		body.classList.add("mg-ui-exiting-foundry");

		mgHudTransitionTimer = window.setTimeout(() => {
			// 2) Switch actual UI state.
			body.classList.add(MG_HUD_CLASS);
			game.mgUi?.refreshLogo?.();

			body.classList.remove("mg-ui-exiting-foundry");

			// 3) New MG UI enters.
			body.classList.add("mg-ui-entering-mg");

			mgHudTransitionTimer = window.setTimeout(() => {
				mgClearHudTransitionClasses();
				mgHudTransitionTimer = null;
			}, MG_HUD_TRANSITION_MS);
		}, MG_HUD_TRANSITION_MS);

		return;
	}

	// 1) Old MG UI exits.
	body.classList.add("mg-ui-exiting-mg");

	mgHudTransitionTimer = window.setTimeout(() => {
		// 2) Switch actual UI state.
		body.classList.remove(MG_HUD_CLASS);
		game.mgUi?.refreshLogo?.();

		body.classList.remove("mg-ui-exiting-mg");

		// 3) Foundry UI enters.
		body.classList.add("mg-ui-entering-foundry");

		mgHudTransitionTimer = window.setTimeout(() => {
			mgClearHudTransitionClasses();
			mgHudTransitionTimer = null;
		}, MG_HUD_TRANSITION_MS);
	}, MG_HUD_TRANSITION_MS);
}

async function mgSetHudMode(enabled) {
	await game.settings.set("midnight-gambit", "mgHudEnabled", !!enabled);

	ui.notifications?.info(`Midnight Gambit HUD ${enabled ? "enabled" : "disabled"}.`);
}

async function mgToggleHudMode() {
  const current = game.settings.get("midnight-gambit", "mgHudEnabled");
  await mgSetHudMode(!current);
}



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
    types: ["character", "npc"],
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

  //Enemy Aura register
  game.settings.register("midnight-gambit", "activeAuraActorId", {
    name: "Active Aura Actor ID",
    scope: "world",
    config: false,
    type: String,
    default: ""
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

  /* MG HUD Mode Toggle
  ----------------------------------------------------------------------*/
  game.settings.register("midnight-gambit", "mgHudEnabled", {
    name: "Enable Midnight Gambit HUD",
    hint: "Hides most default Foundry UI and shows the custom Midnight Gambit interface.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: value => mgApplyHudMode(value, { animate: true })
  });

  game.keybindings.register("midnight-gambit", "toggleMgHud", {
    name: "Toggle Midnight Gambit HUD",
    hint: "Switch between default Foundry UI and Midnight Gambit HUD mode.",
    editable: [
      {
        key: "KeyM",
        modifiers: [KeyboardManager.MODIFIER_KEYS.CONTROL, KeyboardManager.MODIFIER_KEYS.SHIFT]
      }
    ],
    onDown: () => {
      mgToggleHudMode();
      return true;
    },
    restricted: false,
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
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

  Actors.registerSheet("midnight-gambit", MidnightGambitNpcSheet, {
    types: ["npc"],
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

  // --- MG TinyMCE: add a prominent "Save" icon + autosave on blur, NO sheet re-render
  {
    const cfg = CONFIG.TinyMCE ?? {};
    const existingSetup = typeof cfg.setup === "function" ? cfg.setup : null;

    // Make sure the toolbar string exists and put mgSave FIRST
    const rawTb = String(cfg.toolbar || "").trim();
    if (!rawTb) {
      cfg.toolbar = "mgSave";
    } else if (!rawTb.includes("mgSave")) {
      // Put Save at the *front* so it never gets shoved under "More"
      cfg.toolbar = `mgSave | ${rawTb}`;
    } else {
      cfg.toolbar = rawTb;
    }

    // Keep primary buttons visible
    if (!cfg.toolbar_mode) {
      cfg.toolbar_mode = "sliding";
    }

    cfg.setup = (editor) => {
      if (existingSetup) existingSetup(editor);

      // Save just THIS field to the underlying document, without re-render
      const doInlineSave = async (fromBlur = false) => {
        try {
          // On blur, if nothing changed, skip work
          if (
            fromBlur &&
            typeof editor.isDirty === "function" &&
            !editor.isDirty()
          ) {
            return;
          }

          // Sync iframe → hidden textarea
          if (typeof editor.save === "function") editor.save();

          // TinyMCE binds to a real <textarea> / input
          const target = editor.targetElm || editor.getElement?.();
          if (!target) return;

          const name = target.getAttribute("name");
          if (!name) return;

          // Find the parent <form>
          const form = target.closest("form");
          if (!form) return;

          // Resolve the sheet via data-appid → ui.windows
          const appEl = form.closest(".app");
          if (!appEl) return;

          const appId = appEl.dataset.appid;
          if (!appId || !ui?.windows) return;

          const sheet = ui.windows[appId];
          if (!sheet) return;

          // ActorSheet / ItemSheet: document/object holds the data
          const doc = sheet.document || sheet.object;
          if (!doc) return;

          // Build partial update: { "system.description": "<html>" }, etc.
          const update = {};
          foundry.utils.setProperty(update, name, target.value);

          // Update WITHOUT re-rendering the sheet
          await doc.update(update, { render: false, diff: false });

          // Optionally clear TinyMCE dirty flag, if available
          if (typeof editor.setDirty === "function") editor.setDirty(false);
        } catch (err) {
          console.error("Midnight Gambit | TinyMCE inline save failed:", err);
        }
      };

      // Toolbar button – save icon
      editor.ui.registry.addButton("mgSave", {
        icon: "save", // TinyMCE's built-in save icon
        tooltip: "Save this text to the sheet",
        onAction: () => {
          void doInlineSave(false);
        }
      });

      // Autosave when editor loses focus (clicking any other control)
      editor.on("blur", () => {
        void doInlineSave(true);
      });
    };

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


Hooks.once("ready", () => {
	const enabled = game.settings.get("midnight-gambit", "mgHudEnabled");
	mgApplyHudMode(enabled);

	game.mgUi?.refreshLogo?.();

	game.mgHud = {
		enable: () => mgSetHudMode(true),
		disable: () => mgSetHudMode(false),
		toggle: () => mgToggleHudMode()
	};
});
