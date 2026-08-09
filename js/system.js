import "./hooks.js";
import "./mg-ui.js";
import "./sidebar-actor.js";
import "./sidebar-item.js";
import "./sidebar-journal.js";
import "./sidebar-compendium.js";
import "./sidebar-playlist.js";
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
const MG_DEFAULT_AUDIO_INPUT = 0.5;
const MG_CORE_AUDIO_VOLUME_KEYS = [
  "globalPlaylistVolume",
  "globalAmbientVolume",
  "globalInterfaceVolume"
];
const MG_SKIRMISH_SUBTYPE_MIGRATION_VERSION = 1;

let mgHudTransitionTimer = null;
let mgHudChordLatched = false;
const mgHudChordKeys = new Set();
const mgHudChordPressedAt = new Map();

function mgInputToVolume(value) {
  if (globalThis.AudioHelper?.inputToVolume) return AudioHelper.inputToVolume(value);
  return Math.pow(Number(value) || 0, 1.5);
}

function mgHasSavedClientSetting(namespace, key) {
  const settingKey = `${namespace}.${key}`;

  try {
    const storage = game.settings?.storage?.get?.("client");
    const raw = storage?.getItem?.(settingKey);
    if (raw !== null && raw !== undefined) return true;
  } catch (_) {}

  try {
    return localStorage.getItem(settingKey) !== null;
  } catch (_) {
    return false;
  }
}

async function mgEnsureDefaultAudioVolumes() {
  const defaultVolume = mgInputToVolume(MG_DEFAULT_AUDIO_INPUT);

  for (const key of MG_CORE_AUDIO_VOLUME_KEYS) {
    if (mgHasSavedClientSetting("core", key)) continue;
    try {
      await game.settings.set("core", key, defaultVolume);
    } catch (err) {
      console.warn(`MG | Could not set default ${key}.`, err);
    }
  }
}

function mgNormalizeSkirmishSubtypeValue(value) {
  return String(value ?? "").trim() === "combat" ? "skirmish" : String(value ?? "").trim();
}

function mgGetSkirmishSubtypeMigrationUpdate(item) {
  if (!item || item.type !== "move") return null;

  const system = item.system ?? {};
  const update = {};
  const subtype = String(system.moveSubtype ?? "").trim();
  const rawSubtypes = Array.isArray(system.moveSubtypes) ? system.moveSubtypes : [];
  const nextSubtypes = [];
  let changed = false;

  for (const entry of rawSubtypes) {
    const normalized = mgNormalizeSkirmishSubtypeValue(entry);
    if (!normalized) continue;
    if (normalized !== String(entry ?? "").trim()) changed = true;
    if (!nextSubtypes.includes(normalized)) nextSubtypes.push(normalized);
  }

  if (subtype === "combat") {
    update["system.moveSubtype"] = "skirmish";
    if (!rawSubtypes.length) update["system.moveSubtypes"] = ["skirmish"];
  }

  if (rawSubtypes.length && changed) {
    update["system.moveSubtypes"] = nextSubtypes;
    if (!update["system.moveSubtype"] && (!subtype || !nextSubtypes.includes(subtype))) {
      update["system.moveSubtype"] = nextSubtypes[0] ?? "";
    }
  }

  return Object.keys(update).length ? update : null;
}

async function mgRunSkirmishSubtypeMigration() {
  if (!game.user?.isGM) return;

  const current = Number(game.settings.get("midnight-gambit", "skirmishSubtypeMigrationVersion") ?? 0);
  if (current >= MG_SKIRMISH_SUBTYPE_MIGRATION_VERSION) return;

  let worldItems = 0;
  let actorItems = 0;
  let compendiumItems = 0;

  for (const item of game.items ?? []) {
    const update = mgGetSkirmishSubtypeMigrationUpdate(item);
    if (!update) continue;
    await item.update(update);
    worldItems++;
  }

  for (const actor of game.actors ?? []) {
    const updates = [];
    for (const item of actor.items ?? []) {
      const update = mgGetSkirmishSubtypeMigrationUpdate(item);
      if (!update) continue;
      updates.push({ _id: item.id, ...update });
    }
    if (!updates.length) continue;
    await actor.updateEmbeddedDocuments("Item", updates);
    actorItems += updates.length;
  }

  for (const pack of game.packs ?? []) {
    if (pack.metadata?.type !== "Item") continue;
    if (pack.metadata?.system && pack.metadata.system !== "midnight-gambit") continue;

    const wasLocked = pack.locked;
    try {
      if (wasLocked) await pack.configure({ locked: false });
      const docs = await pack.getDocuments();
      const updates = docs
        .map(item => {
          const update = mgGetSkirmishSubtypeMigrationUpdate(item);
          return update ? { _id: item.id, ...update } : null;
        })
        .filter(Boolean);

      if (updates.length) {
        await Item.updateDocuments(updates, { pack: pack.collection });
        compendiumItems += updates.length;
      }
    } catch (err) {
      console.warn(`MG | Could not migrate Move subtypes in compendium ${pack.collection}.`, err);
    } finally {
      if (wasLocked) {
        try {
          await pack.configure({ locked: true });
        } catch (err) {
          console.warn(`MG | Could not re-lock compendium ${pack.collection}.`, err);
        }
      }
    }
  }

  await game.settings.set(
    "midnight-gambit",
    "skirmishSubtypeMigrationVersion",
    MG_SKIRMISH_SUBTYPE_MIGRATION_VERSION
  );

  const total = worldItems + actorItems + compendiumItems;
  if (total) {
    console.log(`MG | Migrated ${total} Move subtype value(s) from combat to skirmish.`, {
      worldItems,
      actorItems,
      compendiumItems
    });
  }
}

function mgIsEditableKeyTarget(target) {
	if (!target) return false;
	if (target.isContentEditable) return true;

	const editable = target.closest?.("input, textarea, select, [contenteditable='true'], [contenteditable='']");
	return !!editable;
}

function mgActivateChatSidebar() {
	const sidebar = ui?.sidebar;

	if (sidebar && typeof sidebar.activateTab === "function") {
		sidebar.activateTab("chat");
	} else {
		document.querySelector('#sidebar-tabs [data-tab="chat"], #sidebar [data-tab="chat"]')?.click();
	}

	const chat = document.getElementById("chat");
	if (chat) {
		chat.classList.add("active");
		chat.style.display = "";
	}

	ui?.chat?.scrollBottom?.();
}

function mgBindHudChordToggle() {
	if (document.body?.dataset.mgHudChordBound === "true") return;
	document.body.dataset.mgHudChordBound = "true";

	document.addEventListener("keydown", event => {
		if (event.repeat || mgIsEditableKeyTarget(event.target)) return;
		if (event.code !== "KeyM" && event.code !== "KeyG") return;
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

		mgHudChordKeys.add(event.code);
		mgHudChordPressedAt.set(event.code, performance.now());
		event.preventDefault();
		event.stopPropagation();

		if (mgHudChordLatched || !mgHudChordKeys.has("KeyM") || !mgHudChordKeys.has("KeyG")) return;
		if (Math.abs(mgHudChordPressedAt.get("KeyM") - mgHudChordPressedAt.get("KeyG")) > 350) return;

		mgHudChordLatched = true;
		void mgToggleHudMode();
	}, true);

	document.addEventListener("keyup", event => {
		if (event.code !== "KeyM" && event.code !== "KeyG") return;

		mgHudChordKeys.delete(event.code);
		mgHudChordPressedAt.delete(event.code);
		if (!mgHudChordKeys.has("KeyM") || !mgHudChordKeys.has("KeyG")) mgHudChordLatched = false;
	}, true);

	window.addEventListener("blur", () => {
		mgHudChordKeys.clear();
		mgHudChordPressedAt.clear();
		mgHudChordLatched = false;
	});
}

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
		if (nextEnabled) mgActivateChatSidebar();
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
			mgActivateChatSidebar();
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
}

async function mgToggleHudMode() {
  const current = game.settings.get("midnight-gambit", "mgHudEnabled");
  await mgSetHudMode(!current);
}

function mgEnsureSignaturePerkItemType() {
  const type = "signaturePerk";
  const label = "TYPES.Item.signaturePerk";

  const pushType = (list) => {
    if (!Array.isArray(list) || list.includes(type)) return;
    list.push(type);
  };

  pushType(game.system?.template?.Item?.types);
  pushType(game.system?.documentTypes?.Item);
  pushType(CONFIG.Item?.documentTypes);

  if (game.system?.template?.Item && !game.system.template.Item[type]) {
    game.system.template.Item[type] = {
      system: {
        description: "",
        tags: []
      }
    };
  }

  CONFIG.Item.typeLabels ??= {};
  CONFIG.Item.typeLabels[type] = label;
}



// Initializing my custom actor and pointing to its HTML structure
//Also initiating Item sheet
Hooks.once("init", async () => {
  console.log("Midnight Gambit | Initializing System");
  mgEnsureSignaturePerkItemType();

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

  game.settings.register("midnight-gambit", "gmDifficultyModifier", {
    name: "GM Difficulty Modifier",
    hint: "A world-level modifier applied to Midnight Gambit player rolls.",
    scope: "world",
    config: false,
    type: Number,
    default: 0
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

  game.settings.register("midnight-gambit", "libraryCompendiums", {
    name: "Library Compendiums",
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  game.settings.register("midnight-gambit", "skirmishSubtypeMigrationVersion", {
    name: "Skirmish Subtype Migration Version",
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });

  /* MG HUD Mode Toggle
  ----------------------------------------------------------------------*/
  game.settings.register("midnight-gambit", "mgHudEnabled", {
    name: "Enable Midnight Gambit HUD",
    hint: "Hides most default Foundry UI and shows the custom Midnight Gambit interface.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: value => mgApplyHudMode(value, { animate: true })
  });

  game.keybindings.register("midnight-gambit", "toggleMgHud", {
    name: "Toggle Midnight Gambit HUD",
    hint: "Switch between default Foundry UI and Midnight Gambit HUD mode by pressing M and G together.",
    editable: [],
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
    types: ["weapon", "armor", "misc", "gambit", "move", "signaturePerk", "asset"],
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
    const {
      ITEM_TAGS,
      ASSET_TAGS,
      GAMBIT_TIERS,
      GAMBIT_TYPES,
      MOVE_TYPES,
      MOVE_SUBTYPES,
      LEVEL_TABLE
    } = await import("../config.js");
    CONFIG.MidnightGambit ??= {};
    const customTags      = game.settings.get("midnight-gambit", "customTags") || [];
    const assetCustomTags = game.settings.get("midnight-gambit", "assetCustomTags") || [];

    CONFIG.MidnightGambit.ITEM_TAGS  = [...ITEM_TAGS,  ...customTags];
    CONFIG.MidnightGambit.ASSET_TAGS = [...ASSET_TAGS, ...assetCustomTags];
    CONFIG.MidnightGambit.GAMBIT_TIERS = GAMBIT_TIERS;
    CONFIG.MidnightGambit.GAMBIT_TYPES = GAMBIT_TYPES;
    CONFIG.MidnightGambit.MOVE_TYPES = MOVE_TYPES;
    CONFIG.MidnightGambit.MOVE_SUBTYPES = MOVE_SUBTYPES;
    CONFIG.MidnightGambit.LEVELS     = LEVEL_TABLE;


  } catch (e) {
    console.error("❌ Failed to load config data in init:", e);
  }
});


Hooks.once("ready", () => {
	const enabled = game.settings.get("midnight-gambit", "mgHudEnabled");
	mgApplyHudMode(enabled);
	mgBindHudChordToggle();
	void mgEnsureDefaultAudioVolumes();
	void mgRunSkirmishSubtypeMigration();

	game.mgUi?.refreshLogo?.();

	game.mgHud = {
		enable: () => mgSetHudMode(true),
		disable: () => mgSetHudMode(false),
		toggle: () => mgToggleHudMode()
	};
});
