import { evaluateRoll, mgApplyStrainAttributePenalty, mgGetStrainEffectBadge, mgGetStrainRollEffects } from "./roll-utils.js";
import { MGInitiativeController } from "./initiative-controller.js";

/* Midnight Gambit Custom UI
==============================================================================================================================================*/

const MG_UI_ID = "mg-ui-root";
const MG_UI_NS = "midnight-gambit";

function mgGetSystemLogoPath() {
	const systemId =
		(typeof game !== "undefined" && game?.system?.id)
			? game.system.id
			: "midnight-gambit";

	return `systems/${systemId}/assets/images/MG-Icon.png`;
}

let mgOriginalFoundryLogoSrc = null;
let mgActiveControl = null;
let mgActiveTool = null;
let mgSubbarOpen = false;
let mgSubbarCloseTimer = null;
let mgPendingOpenTimer = null;
let mgActiveSidebarTab = "player";
let mgLeftSidebarCollapsed = false;
let mgRightSidebarCollapsed = false;
let mgPlayersOriginalParent = null;
let mgPlayersOriginalNextSibling = null;
let mgSceneViewerRefreshTimer = null;
let mgSceneViewerSignature = "";
const mgLeftAccordionState = {};

const MG_ATTRIBUTE_KEYS = ["tenacity", "finesse", "resolve", "guile", "instinct", "presence"];
const MG_SKILL_BUCKETS = {
	tenacity: ["brawl", "athletics", "endure"],
	finesse: ["aim", "stealth", "sleight"],
	resolve: ["will", "composure", "grit"],
	guile: ["lore", "investigate", "deceive"],
	instinct: ["survey", "hunt", "nature"],
	presence: ["command", "charm", "perform"]
};
const MG_SKILL_ATTRIBUTE_MAP = {
	brawl: "tenacity", endure: "tenacity", athletics: "tenacity",
	aim: "finesse", stealth: "finesse", sleight: "finesse",
	will: "resolve", grit: "resolve", composure: "resolve",
	lore: "guile", investigate: "guile", deceive: "guile",
	survey: "instinct", hunt: "instinct", nature: "instinct",
	command: "presence", charm: "presence", perform: "presence",
	spark: "guile"
};

function mgRenderStrainEffectBadge(effects) {
	const badge = mgGetStrainEffectBadge(effects, { includeGlobalLock: false });
	if (!badge) return "";

	return `
		<span class="mg-strain-warning-badge ${mgEsc(badge.tree)}" title="${mgEsc(badge.title)}">
			<i class="fa-solid fa-exclamation"></i>
		</span>
	`;
}

const MG_SKILL_LABELS = {
	brawl: "Brawl",
	endure: "Endure",
	athletics: "Athletics",
	aim: "Aim",
	stealth: "Stealth",
	sleight: "Sleight",
	will: "Will",
	grit: "Grit",
	composure: "Composure",
	lore: "Lore",
	investigate: "Investigate",
	deceive: "Deceive",
	survey: "Survey",
	hunt: "Hunt",
	nature: "Nature",
	command: "Command",
	charm: "Charm",
	perform: "Perform",
	spark: "Spark"
};

const MG_QUICK_DICE_SIDES = [2, 4, 6, 8, 10, 12, 20, 100];
const MG_QUICK_DICE_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8];

const MG_SPARK_SCHOOL_LABELS = {
	veiling: "Veiling",
	sundering: "Sundering",
	binding: "Binding",
	drift: "Drift",
	threading: "Threading",
	warding: "Warding",
	shaping: "Shaping",
	gloom: "Gloom",
	life: "Life",
	ember: "Ember"
};

/* Main Foundry canvas control groups shown in the MG Orb rail.
----------------------------------------------------------------------*/
const MG_CANVAS_CONTROLS = [
	{
		id: "token",
		label: "Tokens",
		icon: "fa-solid fa-user",
		control: "token",
		gmOnly: false
	},
	{
		id: "measure",
		label: "Measure",
		icon: "fa-solid fa-ruler-combined",
		control: "measure",
		gmOnly: false
	},
	{
		id: "tiles",
		label: "Tiles",
		icon: "fa-solid fa-cubes",
		control: "tiles",
		gmOnly: true
	},
	{
		id: "drawings",
		label: "Drawings",
		icon: "fa-solid fa-pencil",
		control: "drawings",
		gmOnly: false
	},
	{
		id: "walls",
		label: "Walls",
		icon: "fa-solid fa-block-brick",
		control: "walls",
		gmOnly: true
	},
	{
		id: "lighting",
		label: "Lighting",
		icon: "fa-solid fa-lightbulb",
		control: "lighting",
		gmOnly: true
	},
	{
		id: "sounds",
		label: "Sounds",
		icon: "fa-solid fa-music",
		control: "sounds",
		gmOnly: true
	},
	{
		id: "notes",
		label: "Notes",
		icon: "fa-solid fa-bookmark",
		control: "notes",
		gmOnly: true
	}
];

/*	Fallback subtools in case Foundry's ui.controls data is incomplete.
	These names should match common Foundry v11 tool names.
----------------------------------------------------------------------*/

const MG_FALLBACK_TOOLS = {
  token: [
    { name: "select", label: "Select", icon: "fa-solid fa-expand" },
    { name: "target", label: "Target", icon: "fa-solid fa-bullseye" },
    { name: "ruler", label: "Ruler", icon: "fa-solid fa-ruler" }
  ],
  measure: [
    { name: "circle", label: "Circle Template", icon: "fa-regular fa-circle" },
    { name: "cone", label: "Cone Template", icon: "fa-solid fa-play" },
    { name: "rect", label: "Rectangle Template", icon: "fa-regular fa-square" },
    { name: "ray", label: "Ray Template", icon: "fa-solid fa-arrow-right-long" }
  ],
  tiles: [
    { name: "select", label: "Select Tiles", icon: "fa-solid fa-expand" },
    { name: "tile", label: "Place Tile", icon: "fa-solid fa-image" },
    { name: "browse", label: "Browse Tiles", icon: "fa-solid fa-folder-open" }
  ],
  drawings: [
    { name: "select", label: "Select Drawings", icon: "fa-solid fa-expand" },
    { name: "rectangle", label: "Rectangle", icon: "fa-regular fa-square" },
    { name: "ellipse", label: "Ellipse", icon: "fa-regular fa-circle" },
    { name: "polygon", label: "Polygon", icon: "fa-solid fa-draw-polygon" },
    { name: "freehand", label: "Freehand", icon: "fa-solid fa-signature" },
    { name: "text", label: "Text", icon: "fa-solid fa-font" }
  ],
  walls: [
    { name: "select", label: "Select Walls", icon: "fa-solid fa-expand" },
    { name: "walls", label: "Draw Walls", icon: "fa-solid fa-slash" },
    { name: "terrain", label: "Terrain Walls", icon: "fa-solid fa-mountain" },
    { name: "invisible", label: "Invisible Walls", icon: "fa-regular fa-eye-slash" },
    { name: "ethereal", label: "Ethereal Walls", icon: "fa-solid fa-ghost" },
    { name: "doors", label: "Doors", icon: "fa-solid fa-door-closed" }
  ],
  lighting: [
    { name: "light", label: "Place Light", icon: "fa-solid fa-lightbulb" },
    { name: "day", label: "Daylight", icon: "fa-solid fa-sun" },
    { name: "night", label: "Darkness", icon: "fa-solid fa-moon" },
    { name: "reset", label: "Reset Lighting", icon: "fa-solid fa-rotate-left" }
  ],
  sounds: [
    { name: "sound", label: "Place Sound", icon: "fa-solid fa-volume-high" },
    { name: "preview", label: "Preview Sounds", icon: "fa-solid fa-headphones" }
  ],
  notes: [
    { name: "select", label: "Select Notes", icon: "fa-solid fa-expand" },
    { name: "journal", label: "Create Note", icon: "fa-solid fa-book-open" }
  ]
};

/* Clock Subtools
----------------------------------------------------------------------*/
const MG_CUSTOM_TOOL_MENUS = {
	dice: {
		label: "Dice",
		icon: "fa-solid fa-dice-d20",
		tools: MG_QUICK_DICE_SIDES.flatMap(sides => (
			MG_QUICK_DICE_COUNTS.map(count => ({
				name: `roll-${count}d${sides}`,
				label: `${count}d${sides}`,
				icon: "fa-solid fa-dice-d20",
				formula: `${count}d${sides}`,
				count,
				sides
			}))
		))
	},
	clocks: {
		label: "Clocks",
		icon: "fa-solid fa-clock",
		tools: [
			{
				name: "addClock",
				label: "Add Clock",
				icon: "fa-solid fa-clock",
				gmOnly: true
			},
			{
				name: "clearClocks",
				label: "Clear All Clocks",
				icon: "fa-solid fa-clock-rotate-left",
				gmOnly: true
			},
			{
				name: "hideClocks",
				label: () => game.mgClocks?.areHidden?.() ? "Show Clocks" : "Hide Clocks",
				icon: () => game.mgClocks?.areHidden?.() ? "fa-solid fa-eye" : "fa-solid fa-eye-slash"
			}
		]
	}
};

/* Left MG Sidebar States/Constants
----------------------------------------------------------------------*/
const MG_LEFT_SIDEBAR_TABS = [
	{
		id: "player",
		label: "Player",
		icon: "fa-solid fa-user"
	},
	{
		id: "crew",
		label: "Crew",
		icon: "fa-solid fa-users"
	},
	{
		id: "clocks",
		label: "Clocks",
		icon: "fa-solid fa-clock"
	},
	{
		id: "scenes",
		label: "Scenes",
		icon: "fa-solid fa-map"
	},
	{
		id: "actors",
		label: "Actors",
		icon: "fa-solid fa-user"
	},
	{
		id: "gm",
		label: "Director",
		icon: "fa-solid fa-camera-movie",
		gmOnly: true
	},
	{
		id: "items",
		label: "Items",
		icon: "fa-solid fa-briefcase"
	},
	{
		id: "journal",
		label: "Journal",
		icon: "fa-solid fa-book-open"
	},
	{
		id: "compendiums",
		label: "Compendiums",
		icon: "fa-solid fa-book"
	},
	{
		id: "playlists",
		label: "Playlists",
		icon: "fa-solid fa-music"
	},
	{
		id: "players",
		label: "Players",
		icon: "fa-solid fa-user-group"
	},
	{
		id: "settings",
		label: "Settings",
		icon: "fa-solid fa-gears"
	}
];

const MG_SCENE_FAVORITE_FLAG = "favoriteScene";
const MG_SCENE_FOLDER_PLAYER_VISIBLE_FLAG = "playersCanSeeFolder";
const MG_SCENE_USER_ORDER_FLAG = "sceneSidebarOrder";

/**
 * Creates the entire MG UI root once.
 */
function mgCreateUiRoot() {
  if (document.getElementById(MG_UI_ID)) return;

  const root = document.createElement("div");
  root.id = MG_UI_ID;
  root.className = "mg-ui-root";

root.innerHTML = `
	<button
		type="button"
		class="mg-sidebar-collapse-toggle left-sidebar-toggle"
		data-mg-collapse-sidebar="left"
		title="Toggle left sidebar"
		aria-label="Toggle left sidebar"
	>
		<i class="fa-solid fa-chevron-left"></i>
	</button>

	<aside class="mg-left-sidebar" data-mg-left-sidebar>
		<div class="panel" data-sidebar-panel>
			<header class="sidebar-header">
				<span class="kicker">Midnight Gambit</span>
				<h2 data-sidebar-title>Character</h2>
			</header>

			<div class="sidebar-body" data-sidebar-body>
				<!-- Sidebar content renders here -->
			</div>
		</div>

		<nav class="sidebar-tabs" data-sidebar-tabs aria-label="Midnight Gambit Sidebar">
			${mgRenderLeftSidebarTabs()}
		</nav>
	</aside>

	<button
		type="button"
		class="mg-sidebar-collapse-toggle mg-right-sidebar-collapse-toggle"
		data-mg-collapse-sidebar="right"
		title="Toggle right sidebar"
		aria-label="Toggle right sidebar"
	>
		<i class="fa-solid fa-chevron-right"></i>
	</button>

    <div class="mg-orb-wrap" data-mg-orb-wrap>
	<button type="button" class="mg-orb-button" data-mg-orb-toggle title="Midnight Gambit Controls">
		<img class="mg-orb-img" src="systems/${game.system.id}/assets/images/mg-queen.png" alt="Midnight Gambit" />

		<div class="mg-orb-selected-stack" data-mg-orb-selected-stack hidden>
			<span class="mg-orb-selected-parent" data-mg-orb-selected-parent>
				<i class="fa-solid fa-user"></i>
			</span>

			<span class="mg-orb-selected-divider" data-mg-orb-selected-divider>
				<i class="fa-solid fa-chevron-down"></i>
			</span>

			<span class="mg-orb-selected-child" data-mg-orb-selected-child>
				<i class="fa-solid fa-expand"></i>
			</span>
		</div>
	</button>

      <div class="mg-orb-stack">
        <nav class="mg-orb-subrail" data-mg-orb-subrail aria-label="Midnight Gambit Tool Controls">
          <div class="mg-orb-subrail-pointer" data-mg-subrail-pointer></div>
          <div class="mg-orb-subrail-tools" data-mg-subrail-tools></div>
        </nav>

        <nav class="mg-orb-rail" data-mg-orb-rail aria-label="Midnight Gambit Scene Controls">
          ${mgRenderControlButtons()}
        </nav>
      </div>
    </div>
  `;

	document.body.appendChild(root);

	mgBindUiRoot(root);
	mgBindLeftSidebar(root);
	mgBindSidebarCollapse(root);
	mgEnsureRightSidebarHeader();
	mgRestoreSidebarCollapseState();

	const savedState = mgLoadUiState();
	mgRestoreAccordionState(savedState);
	mgSetLeftSidebarTab(savedState.sidebarTab || "player");

	mgRefreshActiveControl();
}

function mgEnsureRightSidebarHeader() {
	const sidebar = document.getElementById("sidebar");
	if (!sidebar) return;
	if (sidebar.querySelector(":scope > .mg-right-sidebar-header")) return;

	const header = document.createElement("header");
	header.className = "mg-right-sidebar-header";
	header.innerHTML = `<h2>Chat</h2>`;
	sidebar.insertBefore(header, sidebar.firstElementChild);
}

/**
 * Builds the horizontal main rail buttons.
 */
function mgRenderControlButtons() {
  const controls = MG_CANVAS_CONTROLS.filter(control => {
    if (control.gmOnly && !game.user.isGM) return false;
    if (control.control !== "drawings" && !mgCanUseFoundryControl(control.control)) return false;
    return true;
  });

	const diceButton = `
		<button
			type="button"
			class="mg-orb-tool mg-orb-tool-mg"
			data-mg-custom-menu="dice"
			title="Dice"
			aria-label="Dice"
		>
			<i class="fa-solid fa-dice-d20"></i>
		</button>
	`;

	const foundryButtons = [];
	let diceInserted = false;

	for (const control of controls) {
		if (!diceInserted && control.control === "drawings") {
			foundryButtons.push(diceButton);
			diceInserted = true;
		}

		foundryButtons.push(`
			<button
				type="button"
				class="mg-orb-tool"
				data-mg-control="${control.control}"
				data-mg-control-id="${control.id}"
				title="${control.label}"
				aria-label="${control.label}"
			>
				<i class="${control.icon}"></i>
			</button>
		`);
	}

	if (!diceInserted) foundryButtons.push(diceButton);

  const mgButtons = `
	<button
		type="button"
		class="mg-orb-tool mg-orb-tool-mg"
		data-mg-custom-menu="clocks"
		title="Clocks"
		aria-label="Clocks"
	>
		<i class="fa-solid fa-clock"></i>
	</button>

    <button
      type="button"
      class="mg-orb-tool mg-orb-tool-mg"
      data-mg-action="initiative"
      title="Initiative"
      aria-label="Initiative"
    >
      <i class="fa-solid fa-swords"></i>
    </button>
  `;

  return `${foundryButtons.join("")}${mgButtons}`;
}

/* Left Sidebar Rendering
----------------------------------------------------------------------*/
function mgGetAssignedCharacter() {
	return game.user?.character || null;
}

function mgEsc(value) {
	const div = document.createElement("div");
	div.textContent = String(value ?? "");
	return div.innerHTML;
}

function mgAttr(value) {
	return mgEsc(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function mgCssUrl(value) {
	return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function mgSigned(value) {
	const n = Number(value) || 0;
	return n >= 0 ? `+${n}` : `${n}`;
}

function mgClampStatValue(value) {
	const n = Number(value);
	if (!Number.isFinite(n)) return 0;
	return Math.max(-3, Math.min(3, Math.trunc(n)));
}

function mgCapitalize(value) {
	const str = String(value ?? "");
	return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
}

function mgGetItemTagDefinition(tagId) {
	const tags = CONFIG.MidnightGambit?.ITEM_TAGS ?? [];
	if (Array.isArray(tags)) return tags.find(tag => tag?.id === tagId) ?? null;
	return tags?.[tagId] ?? null;
}

function mgRenderItemTagPills(item) {
	const tags = Array.isArray(item?.system?.tags) ? item.system.tags : [];
	if (!tags.length) return "";

	return `
		<div class="item-tags mg-sidebar-item-tags">
			${tags.map(tagId => {
				const tag = mgGetItemTagDefinition(tagId);
				const label = tag?.label ?? tagId;
				const tooltip = tag?.description ? ` data-tooltip="${mgAttr(tag.description)}"` : "";
				return `
					<span class="item-tag tag" data-item-id="${mgAttr(item.id)}" data-tag-id="${mgAttr(tagId)}"${tooltip}>
						${mgEsc(label)}
					</span>
				`;
			}).join("")}
		</div>
	`;
}

function mgStripHtml(value) {
	const div = document.createElement("div");
	div.innerHTML = String(value ?? "");
	return (div.textContent || div.innerText || "").trim();
}

function mgRenderSidebarItemDescription(item) {
	const description = String(item?.system?.description ?? "").trim();
	if (!mgStripHtml(description)) return "";

	return `
		<div class="desc mg-sidebar-item-desc">
			<label>Description</label>
			<div class="desc-content mg-seeall-content">
				${description}
			</div>
		</div>
	`;
}

function mgRenderSidebarStrainBubble(icon, value) {
	const number = Number(value ?? 0) || 0;
	return `
		<p class="strain-bubble">
			<i class="${mgAttr(icon)}"></i>
			<span class="remaining-number">${number}</span>
		</p>
	`;
}

function mgRenderSidebarItemCapacity(item) {
	const system = item?.system ?? {};
	const mortalDamage = Number(system.mortalStrainDamage ?? system.strainDamage ?? 0) || 0;
	const soulDamage = Number(system.soulStrainDamage ?? 0) || 0;
	const mortalCapacity = Number(system.remainingCapacity?.mortal ?? system.mortalCapacity ?? 0) || 0;
	const soulCapacity = Number(system.remainingCapacity?.soul ?? system.soulCapacity ?? 0) || 0;
	const hasDamage = mortalDamage > 0 || soulDamage > 0;
	const hasCapacity = mortalCapacity > 0 || soulCapacity > 0;

	if (!hasDamage && !hasCapacity) return "";

	return `
		<div class="item-capacity mg-sidebar-item-capacity" title="Strain Effects">
			${hasDamage ? `
				<label>Strain Damage</label>
				<div class="bubble-wrapper">
					${mgRenderSidebarStrainBubble("fa-kit fa-mortal-strain", mortalDamage)}
					${mgRenderSidebarStrainBubble("fa-kit fa-soul-strain", soulDamage)}
				</div>
			` : ""}

			${hasCapacity ? `
				<label>Capacity</label>
				<div class="bubble-wrapper">
					${mgRenderSidebarStrainBubble("fa-kit fa-mortal-strain", mortalCapacity)}
					${mgRenderSidebarStrainBubble("fa-kit fa-soul-strain", soulCapacity)}
				</div>
			` : ""}
		</div>
	`;
}

async function mgPostOwnedInventoryItemToChat(actor, item) {
	if (!actor || !item) return;

	const { name, system, type } = item;
	const allDefs = [
		...(CONFIG.MidnightGambit?.ITEM_TAGS ?? []),
		...(CONFIG.MidnightGambit?.WEAPON_TAGS ?? []),
		...(CONFIG.MidnightGambit?.ARMOR_TAGS ?? []),
		...(CONFIG.MidnightGambit?.MISC_TAGS ?? [])
	];

	const tagData = (Array.isArray(system?.tags) ? system.tags : [])
		.map(tagId => {
			const def = allDefs.find(tag => tag?.id === tagId);
			const label = def?.label || tagId;
			const desc = def?.description || "";
			return `<span class="item-tag tag" data-tag-id="${mgAttr(tagId)}" title="${mgAttr(desc)}">${mgEsc(label)}</span>`;
		})
		.join(" ");

	const mortalDamage = Number(system?.mortalStrainDamage ?? system?.strainDamage ?? 0) || 0;
	const soulDamage = Number(system?.soulStrainDamage ?? 0) || 0;
	const mortalCapacity = Number(system?.remainingCapacity?.mortal ?? system?.mortalCapacity ?? 0) || 0;
	const soulCapacity = Number(system?.remainingCapacity?.soul ?? system?.soulCapacity ?? 0) || 0;
	const damageInfo = mortalDamage || soulDamage
		? `
			<label>Strain Damage</label>
			<div class="bubble-wrapper">
				${mortalDamage ? mgRenderSidebarStrainBubble("fa-kit fa-mortal-strain", mortalDamage) : ""}
				${soulDamage ? mgRenderSidebarStrainBubble("fa-kit fa-soul-strain", soulDamage) : ""}
			</div>
		`
		: "";
	const capacityInfo = mortalCapacity || soulCapacity
		? `
			<label>Capacity</label>
			<div class="bubble-wrapper">
				${mortalCapacity ? mgRenderSidebarStrainBubble("fa-kit fa-mortal-strain", mortalCapacity) : ""}
				${soulCapacity ? mgRenderSidebarStrainBubble("fa-kit fa-soul-strain", soulCapacity) : ""}
			</div>
		`
		: "";
	const descHtml = system?.description
		? await TextEditor.enrichHTML(String(system.description ?? ""), { async: true, secrets: false })
		: "";
	const icon = type === "weapon" ? "fa-solid fa-sword" : type === "armor" ? "fa-solid fa-shield" : "fa-solid fa-backpack";

	await ChatMessage.create({
		user: game.user.id,
		speaker: ChatMessage.getSpeaker({ actor }),
		content: `
			<div class="chat-item">
				<h2><i class="${icon}"></i> ${mgEsc(name)}</h2>
				${descHtml ? `<div class="chat-item-desc">${descHtml}</div>` : ""}
				${damageInfo}
				${capacityInfo}
				${tagData ? `<strong>Tags:</strong><div class="chat-tags">${tagData}</div>` : ""}
			</div>
		`
	});
}

function mgRenderSidebarItemImage(item) {
	const src = item?.img || "icons/svg/item-bag.svg";
	return `
		<div class="card-media mg-sidebar-item-media">
			<img class="item-card-img" src="${mgEsc(src)}" alt="${mgAttr(item?.name)}" />
		</div>
	`;
}

function mgRenderFavoriteSidebarItems(actor) {
	const inventoryTypes = new Set(["weapon", "armor", "misc", "item"]);
	const favorites = actor.items
		.filter(item => inventoryTypes.has(item.type) && item.system?.favorite)
		.sort((a, b) => a.name.localeCompare(b.name));

	if (!favorites.length) {
		return `<div class="mg-left-empty mg-sidebar-items-empty">No favorite items yet.</div>`;
	}

	return `
		<div class="mg-sidebar-items-list">
			${favorites.map(item => `
				<article class="mg-sidebar-item" data-mg-sidebar-item-id="${mgAttr(item.id)}" data-seeall-cap="335">
					<button type="button" class="mg-sidebar-item-name" data-mg-post-owned-item="${mgAttr(item.id)}" title="Post ${mgAttr(item.name)} to chat">
						<i class="fa-solid fa-messages"></i>
						<span>${mgEsc(item.name)}</span>
					</button>

					${mgRenderSidebarItemImage(item)}
					<div class="card-wrapper mg-sidebar-item-body">
						${mgRenderSidebarItemCapacity(item)}
						${mgRenderSidebarItemDescription(item)}
						${mgRenderItemTagPills(item)}
					</div>

					<button
						class="mg-card-toggle card-seeall-toggle mg-sidebar-item-toggle"
						type="button"
						title="Expand / collapse card"
						aria-label="Expand / collapse card"
						hidden
					>
						<i class="fa-solid fa-angle-down"></i>
					</button>
				</article>
			`).join("")}
		</div>
	`;
}

function mgGetSparkSchools(actor) {
	const rawCasterType = actor?.system?.casterType ?? null;
	const casterType = rawCasterType === "caster" ? "full" : rawCasterType;
	const schoolKeys = casterType === "full"
		? [actor?.system?.sparkSchool1, actor?.system?.sparkSchool2]
		: casterType === "half"
			? [actor?.system?.sparkSchool1]
			: [];

	return schoolKeys
		.map(key => String(key ?? "").trim())
		.filter(Boolean)
		.map(key => MG_SPARK_SCHOOL_LABELS[key] ?? mgCapitalize(key));
}

function mgAccordionKey(actor, id) {
	return `${actor?.id ?? "none"}.${id}`;
}

function mgIsAccordionOpen(actor, id, fallback = true) {
	const key = mgAccordionKey(actor, id);
	if (!Object.prototype.hasOwnProperty.call(mgLeftAccordionState, key)) return fallback;
	return !!mgLeftAccordionState[key];
}

function mgSetAccordionOpen(actor, id, open) {
	mgLeftAccordionState[mgAccordionKey(actor, id)] = !!open;

	mgSaveUiState({
		leftAccordionState: { ...mgLeftAccordionState }
	});
}

function mgRenderAccordion(actor, { id, title, icon = "", open = true, body = "", attrs = "", toggleAttrs = "", className = "" }) {
	const isOpen = mgIsAccordionOpen(actor, id, open);
	const iconHtml = icon ? `<i class="${icon}"></i>` : "";
	const classes = ["mg-left-accordion", className, isOpen ? "is-open" : ""]
		.filter(Boolean)
		.join(" ");

	return `
		<section
			class="${classes}"
			data-mg-accordion="${id}"
			${attrs}
		>
			<button
				type="button"
				class="mg-left-accordion-toggle"
				data-mg-accordion-toggle="${id}"
				aria-expanded="${isOpen ? "true" : "false"}"
				${toggleAttrs}
			>
				<span>${iconHtml}${mgEsc(title)}</span>
				<i class="fa-solid fa-chevron-down mg-left-accordion-chevron"></i>
			</button>

			<div
				class="mg-left-accordion-body"
				${isOpen ? "" : "hidden"}
				style="max-height: ${isOpen ? "none" : "0px"};"
			>
				<div class="mg-left-accordion-inner">
					${body}
				</div>
			</div>
		</section>
	`;
}

/* Checking Primary Guise of actor and filling in related sourced
----------------------------------------------------------------------*/
function mgResolvePrimaryGuise(actor) {
	const ref = actor?.system?.guiseId || actor?.system?.guise;
	if (!actor || !ref) return null;

	return actor.items?.get?.(ref) ||
		actor.items?.find?.(item => item.id === ref || item.uuid === ref || item.name === ref) ||
		null;
}

/* Checking Secondary guise and updating sidebar/Spark if needed
----------------------------------------------------------------------*/
function mgResolveSidebarGuises(actor) {
	if (!actor) return [];

	const resolve = ref => {
		if (!ref) return null;
		return actor.items?.get?.(ref) ||
			actor.items?.find?.(item => item.id === ref || item.uuid === ref || item.name === ref) ||
			null;
	};

	const guises = [];
	const primary = mgResolvePrimaryGuise(actor);
	if (primary?.type === "guise") guises.push(primary);

	const secondaryRefs = Array.isArray(actor.system?.secondaryGuises)
		? actor.system.secondaryGuises
		: [];

	secondaryRefs.forEach(ref => {
		const guise = resolve(ref);
		if (guise?.type === "guise" && !guises.some(existing => existing.id === guise.id)) {
			guises.push(guise);
		}
	});

	return guises;
}

function mgActorHasSpark(actor) {
	const casterRank = type => (["full", "half", "caster"].includes(type ?? "none") ? 1 : 0);
	const guises = mgResolveSidebarGuises(actor);

	if (guises.some(guise =>
		casterRank(guise.system?.casterType) > 0 ||
		(Number(guise.system?.sparkSlots ?? 0) || 0) > 0
	)) {
		return true;
	}

	return casterRank(actor?.system?.casterType) > 0 ||
		(Number(actor?.system?.derivedSparkSlots ?? 0) || 0) > 0;
}

/* Grabbing Guise Name
----------------------------------------------------------------------*/
function mgResolveGuiseName(actor) {
	const primary = mgResolvePrimaryGuise(actor);
	if (primary) return primary.name;

	if (typeof actor?.system?.guise === "object") return actor.system.guise.name || "No Guise";
	return actor?.system?.guiseName || actor?.system?.class || "No Guise";
}

function mgGetSidebarCropStyle(actor) {
	const variables = mgGetSidebarCropVariables(actor);
	return `style="${variables}"`;
}

function mgGetDirectorActorImage(actor) {
	const override = mgGetActorPlacementImage(actor, "actorSidebar", "");
	const img = String(override || actor?.img || "").trim();

	if (!img || img === "icons/svg/mystery-man.svg" || img.endsWith("/mystery-man.svg")) {
		return "systems/midnight-gambit/assets/images/guise.jpg";
	}

	return img;
}

function mgGetActorPlacementImage(actor, key, fallback = actor?.img || "icons/svg/mystery-man.svg") {
	const src = String(actor?.getFlag?.("midnight-gambit", "crops")?.[key]?.src ?? "").trim();
	return src || fallback;
}

function mgGetSidebarCropVariables(actor) {
	return mgGetActorCropVariables(actor, "sidebar", ["profile"]);
}

function mgGetActorCropVariables(actor, key, fallbacks = [], options = {}) {
	const crops = actor?.getFlag?.("midnight-gambit", "crops") || {};
	let crop = crops[key]?.css;

	for (const fallback of fallbacks) {
		if (crop && Object.keys(crop).length) break;
		crop = crops[fallback]?.css;
	}

	crop ||= {};
	const x = Number.isFinite(crop.x) ? crop.x : 50;
	const y = Number.isFinite(crop.y) ? crop.y : 50;
	const scale = Number.isFinite(crop.scale) ? crop.scale : 1;
	const width = !options.ignoreWidth && Number.isFinite(crop.width) && crop.width > 0 ? ` --mg-crop-w: ${crop.width}%;` : "";
	const height = !options.ignoreHeight && Number.isFinite(crop.height) && crop.height > 0 ? ` --mg-crop-h: ${crop.height}%;` : "";

	return `--mg-crop-x: ${x}; --mg-crop-y: ${y}; --mg-crop-scale: ${scale};${width}${height}`;
}

function mgHasActorCrop(actor, key) {
	const crop = actor?.getFlag?.("midnight-gambit", "crops")?.[key]?.css;
	return !!(crop && Object.keys(crop).length);
}

/* Grabbing Crew Name
----------------------------------------------------------------------*/
function mgResolveCrewName(actor) {
	return actor?.system?.crewName || actor?.system?.crew || "No Crew";
}

function mgRange(start, end) {
	const max = Math.max(0, Number(end) || 0);
	const min = Math.max(1, Number(start) || 1);
	return Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i);
}

/* Getting Icons from FA Kit for each resource
----------------------------------------------------------------------*/
function mgRenderIconTrack({ kind, total, filled, dataAttr = "" }) {
	const count = Math.max(0, Number(total) || 0);
	const filledCount = Math.max(0, Number(filled) || 0);
	const icon = kind === "risk"
		? "fa-kit fa-risk"
		: kind === "sto"
			? "fa-kit fa-sto"
			: kind === "spark"
				? "fa-kit fa-spark"
				: kind === "mortal"
					? "fa-kit fa-mortal-strain"
					: "fa-kit fa-soul-strain";

	return `
		<div class="icon-track ${kind}-track">
			${mgRange(1, count).map(value => `
				<button
					type="button"
					class="dot ${value <= filledCount ? "filled" : ""}"
					data-value="${value}"
					${dataAttr}
					title="${mgEsc(mgCapitalize(kind))} ${value}"
				>
					<i class="${icon}"></i>
				</button>
			`).join("")}
		</div>
	`;
}

/* Adjusting the Attribute/Skill Rolls by Aura
----------------------------------------------------------------------*/
function mgGetActiveAuraPenalty(attrKey) {
	const empty = { value: 0, label: "", sourceActorId: "", sourceTokenId: "" };

	let activeAuraActorId = "";
	try {
		activeAuraActorId = game.settings.get("midnight-gambit", "activeAuraActorId");
	} catch (_) {
		return empty;
	}

	if (!activeAuraActorId) return empty;

	const actor = game.actors.get(activeAuraActorId);
	if (!actor || actor.type !== "npc" || !actor.system?.aura?.enabled) return empty;

	const npcAttr = Number(
		actor.system?.attributes?.[attrKey] ??
		actor.system?.baseAttributes?.[attrKey] ??
		0
	) || 0;
	const label = String(actor.system?.aura?.label || "Oppressive Presence");

	return {
		value: -npcAttr,
		label,
		sourceActorId: actor.id,
		sourceTokenId: ""
	};
}

function mgGetDifficultyModifier() {
	try {
		const value = Number(game.settings.get("midnight-gambit", "gmDifficultyModifier") ?? 0);
		if (!Number.isFinite(value)) return 0;
		return Math.max(-3, Math.min(3, Math.trunc(value)));
	} catch (_) {
		return 0;
	}
}

/* Adding different tabs for each sidebar section
----------------------------------------------------------------------*/
function mgGetVisibleLeftSidebarTabs() {
	const tabs = MG_LEFT_SIDEBAR_TABS.filter(tab => {
		if (tab.gmOnly && !game.user?.isGM) return false;
		if (tab.playerOnly && game.user?.isGM) return false;
		return true;
	});

	if (!game.user?.isGM) return tabs;

	const gmIndex = tabs.findIndex(tab => tab.id === "gm");
	if (gmIndex <= 0) return tabs;

	const gmTab = tabs[gmIndex];
	return [gmTab, ...tabs.slice(0, gmIndex), ...tabs.slice(gmIndex + 1)];
}

function mgNormalizeLeftSidebarTabId(tabId) {
	const visibleTabs = mgGetVisibleLeftSidebarTabs();
	if (visibleTabs.some(tab => tab.id === tabId)) return tabId;

	const replacement = visibleTabs.find(tab => tab.replaces === tabId);
	if (replacement) return replacement.id;

	const replacedByHidden = MG_LEFT_SIDEBAR_TABS.find(tab => tab.id === tabId)?.replaces;
	if (replacedByHidden && visibleTabs.some(tab => tab.id === replacedByHidden)) return replacedByHidden;

	return visibleTabs[0]?.id ?? "player";
}

function mgRenderLeftSidebarTabs() {
	return mgGetVisibleLeftSidebarTabs().map(tab => {
		const actor = tab.id === "player" ? mgGetAssignedCharacter() : null;
		const portrait = tab.portrait || (actor ? mgGetActorPlacementImage(actor, "sidebar", actor.img || "") : "");
		const tabClass = `sidebar-tab${portrait ? " has-portrait" : ""}`;
		const iconHtml = portrait
			? `<img class="tab-portrait" src="${mgAttr(portrait)}" alt="" />`
			: `<i class="${tab.icon}"></i>`;

		return `
		<button
			type="button"
			class="${tabClass}"
			data-mg-left-tab="${tab.id}"
			aria-label="${tab.label}"
		>
			${iconHtml}
			<span class="tab-label">${tab.label}</span>
		</button>
	`;
	}).join("");
}

function mgRefreshLeftSidebarTabs() {
	const root = document.getElementById(MG_UI_ID);
	const tabs = root?.querySelector("[data-sidebar-tabs]");
	if (!root || !tabs) return;

	const normalizedTab = mgNormalizeLeftSidebarTabId(mgActiveSidebarTab);
	if (normalizedTab !== mgActiveSidebarTab) {
		mgSetLeftSidebarTab(normalizedTab);
		return;
	}

	tabs.innerHTML = mgRenderLeftSidebarTabs();
	mgBindLeftSidebar(root);

	root.querySelectorAll("[data-mg-left-tab]").forEach(button => {
		button.classList.toggle("is-active", button.dataset.mgLeftTab === mgActiveSidebarTab);
	});
}

/* MG UI persistence
----------------------------------------------------------------------*/

function mgUiStateKey() {
	const worldId = game.world?.id ?? "world";
	const userId = game.user?.id ?? "user";
	return `${MG_UI_NS}.${worldId}.${userId}.orbState`;
}

function mgLoadUiState() {
	try {
		return JSON.parse(localStorage.getItem(mgUiStateKey()) || "{}");
	} catch (err) {
		console.warn("MG UI | Failed to load saved UI state.", err);
		return {};
	}
}

function mgRestoreAccordionState(state = mgLoadUiState()) {
	const saved = state.leftAccordionState;
	if (!saved || typeof saved !== "object" || Array.isArray(saved)) return;

	for (const key of Object.keys(mgLeftAccordionState)) {
		delete mgLeftAccordionState[key];
	}

	Object.assign(mgLeftAccordionState, saved);
}

function mgSaveUiState(patch = {}) {
	const root = document.getElementById(MG_UI_ID);
	const wrap = root?.querySelector("[data-mg-orb-wrap]");

	const current = mgLoadUiState();

	const next = {
		...current,
		orbOpen: wrap?.classList.contains("is-open") ?? current.orbOpen ?? false,
		subbarOpen: mgSubbarOpen,
		activeControl: mgActiveControl,
		activeTool: mgActiveTool,
		...patch
	};

	try {
		localStorage.setItem(mgUiStateKey(), JSON.stringify(next));
	} catch (err) {
		console.warn("MG UI | Failed to save UI state.", err);
	}
}

function mgGetControlMeta(controlName) {
	if (controlName?.startsWith("mg:")) {
		const menuName = controlName.slice(3);
		const menu = MG_CUSTOM_TOOL_MENUS[menuName];

		if (menu) {
			return {
				control: controlName,
				label: menu.label,
				icon: menu.icon
			};
		}
	}

	return MG_CANVAS_CONTROLS.find(c => c.control === controlName) ?? null;
}

function mgGetToolMeta(controlName, toolName) {
	if (!controlName || !toolName) return null;

	if (controlName.startsWith("mg:")) {
		const menuName = controlName.slice(3);
		return mgGetCustomToolsForMenu(menuName).find(t => t.name === toolName) ?? null;
	}

	return mgGetToolsForControl(controlName).find(t => t.name === toolName) ?? null;
}

function mgResolveToolValue(value) {
	return typeof value === "function" ? value() : value;
}

function mgGetCustomToolsForMenu(menuName) {
	const menu = MG_CUSTOM_TOOL_MENUS[menuName];
	const tools = menu?.tools ?? [];

	return tools
		.filter(tool => !tool.gmOnly || game.user.isGM)
		.map(tool => ({
			...tool,
			label: mgResolveToolValue(tool.label),
			icon: mgResolveToolValue(tool.icon)
		}));
}

/* Setting the ORB menu, and registering the selected tools
----------------------------------------------------------------------*/
function mgSetOrbBadge(controlName = mgActiveControl, toolName = mgActiveTool) {
	const root = document.getElementById(MG_UI_ID);
	const stack = root?.querySelector("[data-mg-orb-selected-stack]");
	const parentWrap = root?.querySelector("[data-mg-orb-selected-parent]");
	const parentIcon = parentWrap?.querySelector("i");
	const divider = root?.querySelector("[data-mg-orb-selected-divider]");
	const childWrap = root?.querySelector("[data-mg-orb-selected-child]");
	const childIcon = childWrap?.querySelector("i");

	if (!stack || !parentWrap || !parentIcon || !divider || !childWrap || !childIcon) return;

	const controlMeta = mgGetControlMeta(controlName);
	const toolMeta = mgGetToolMeta(controlName, toolName);

	// No control at all? Hide the whole badge stack.
	if (!controlMeta?.icon) {
		stack.hidden = true;
		stack.title = "";
		return;
	}

	// Parent control icon always shows.
	parentIcon.className = controlMeta.icon;
	parentWrap.title = controlMeta.label || "Active category";

	// Child tool icon shows only if we have one.
	if (toolMeta?.icon) {
		childIcon.className = toolMeta.icon;
		childWrap.title = toolMeta.label || "Active tool";
		childWrap.hidden = false;
		divider.hidden = false;

		stack.title = `${controlMeta.label || "Category"} ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ ${toolMeta.label || "Tool"}`;
	} else {
		childWrap.hidden = true;
		divider.hidden = true;

		stack.title = controlMeta.label || "Active category";
	}

	stack.hidden = false;
}

/* Binds the Orb toggle and rail button actions
----------------------------------------------------------------------*/
function mgBindUiRoot(root) {
	const wrap = root.querySelector("[data-mg-orb-wrap]");
	const toggle = root.querySelector("[data-mg-orb-toggle]");

	toggle?.addEventListener("click", event => {
		event.preventDefault();

		const nextOpen = !wrap?.classList.contains("is-open");
		wrap?.classList.toggle("is-open", nextOpen);

		if (!nextOpen) {
			mgCloseSubbar();
			mgSaveUiState({ orbOpen: false, subbarOpen: false });
			mgSetOrbBadge();
			return;
		}

		// Re-open the last selected category when opening the orb again.
		const state = mgLoadUiState();
		const controlName = mgActiveControl || state.activeControl;
		const sourceButton = controlName
			? root.querySelector(`[data-mg-control="${controlName}"]`)
			: null;

		if (controlName && sourceButton) {
			mgOpenSubbar(controlName, sourceButton);
		}

		mgSaveUiState({ orbOpen: true });
		mgSetOrbBadge();
	});

	root.querySelectorAll("[data-mg-control]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();

			const controlName = button.dataset.mgControl;
			const isSameControl = mgActiveControl === controlName;
			const shouldCloseSubbar = isSameControl && mgSubbarOpen;

			await mgActivateFoundryControl(controlName);

			if (shouldCloseSubbar) {
			mgCloseSubbar();
			} else {
			mgOpenSubbar(controlName, button);
			}
		});
	});

	root.querySelectorAll("[data-mg-custom-menu]").forEach(button => {
		button.addEventListener("click", event => {
			event.preventDefault();
			event.stopPropagation();

			const menuName = button.dataset.mgCustomMenu;
			const activeName = `mg:${menuName}`;
			const isSameControl = mgActiveControl === activeName;
			const shouldCloseSubbar = isSameControl && mgSubbarOpen;

			mgActiveControl = activeName;
			mgActiveTool = null;
			mgRefreshActiveControl(activeName);

			if (shouldCloseSubbar) {
				mgCloseSubbar();
			} else {
				mgOpenCustomSubbar(menuName, button);
			}
		});
	});

	root.querySelectorAll("[data-mg-action]").forEach(button => {
		button.addEventListener("click", event => {
		event.preventDefault();

		mgCloseSubbar();

		const action = button.dataset.mgAction;
		mgRunMgAction(action);
		});
	});
}

/* Opens the subtool rail for a specific main control.
   If another submenu is already open, close it first, then open the new one.
----------------------------------------------------------------------*/

function mgOpenSubbar(controlName, sourceButton) {
	const root = document.getElementById(MG_UI_ID);
	if (!root) return;

	const subrail = root.querySelector("[data-mg-orb-subrail]");
	const toolsWrap = root.querySelector("[data-mg-subrail-tools]");
	const pointer = root.querySelector("[data-mg-subrail-pointer]");

	if (!subrail || !toolsWrap) return;

	if (mgSubbarCloseTimer) {
		clearTimeout(mgSubbarCloseTimer);
		mgSubbarCloseTimer = null;
	}

	if (mgPendingOpenTimer) {
		clearTimeout(mgPendingOpenTimer);
		mgPendingOpenTimer = null;
	}

	const wasOpen = subrail.classList.contains("is-open");

	const openFresh = () => {
		mgRenderSubbarTools(controlName, toolsWrap);

		// Keep subbar locked to the selected icon, but do not animate sideways.
		mgPositionSubbar(sourceButton, subrail, pointer);

		subrail.classList.remove("is-closing");
		void subrail.offsetHeight; // force closed state to register
		subrail.classList.add("is-open");

		mgSubbarOpen = true;
		mgRefreshActiveTool();

		mgSaveUiState({
			orbOpen: true,
			subbarOpen: true,
			activeControl: controlName
		});

		mgSetOrbBadge(controlName, mgActiveTool);
	};

	// If already open, close the old submenu first, then open the new one.
	if (wasOpen) {
		mgCloseSubbar();

		mgPendingOpenTimer = window.setTimeout(() => {
			mgPendingOpenTimer = null;
			openFresh();
		}, 170);

		return;
	}

	openFresh();
}

function mgOpenCustomSubbar(menuName, sourceButton) {
	const root = document.getElementById(MG_UI_ID);
	if (!root) return;

	const subrail = root.querySelector("[data-mg-orb-subrail]");
	const toolsWrap = root.querySelector("[data-mg-subrail-tools]");
	const pointer = root.querySelector("[data-mg-subrail-pointer]");

	if (!subrail || !toolsWrap) return;

	if (mgSubbarCloseTimer) {
		clearTimeout(mgSubbarCloseTimer);
		mgSubbarCloseTimer = null;
	}

	if (mgPendingOpenTimer) {
		clearTimeout(mgPendingOpenTimer);
		mgPendingOpenTimer = null;
	}

	const wasOpen = subrail.classList.contains("is-open");

	const openFresh = () => {
		mgRenderCustomSubbarTools(menuName, toolsWrap);
		mgPositionSubbar(sourceButton, subrail, pointer);

		subrail.classList.remove("is-closing");
		void subrail.offsetHeight;
		subrail.classList.add("is-open");

		mgSubbarOpen = true;
		mgActiveControl = `mg:${menuName}`;
		mgActiveTool = null;
		mgRefreshActiveTool();

		mgSaveUiState({
			orbOpen: true,
			subbarOpen: true,
			activeControl: mgActiveControl,
			activeTool: null
		});

		mgSetOrbBadge(mgActiveControl, null);
	};

	if (wasOpen) {
		mgCloseSubbar();

		mgPendingOpenTimer = window.setTimeout(() => {
			mgPendingOpenTimer = null;
			openFresh();
		}, 170);

		return;
	}

	openFresh();
}

/* Renders the subtool buttons for the active control.
----------------------------------------------------------------------*/
function mgRenderSubbarTools(controlName, toolsWrap) {
	const tools = mgGetToolsForControl(controlName);
	toolsWrap.classList.remove("is-dice-subrail");

	toolsWrap.innerHTML = tools.map(tool => `
		<button
			type="button"
			class="mg-orb-subtool"
			data-mg-subtool="${tool.name}"
			title="${tool.label}"
			aria-label="${tool.label}"
		>
			<i class="${tool.icon}"></i>
		</button>
	`).join("");

	toolsWrap.querySelectorAll("[data-mg-subtool]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();

			const toolName = button.dataset.mgSubtool;
			await mgActivateFoundryTool(controlName, toolName);
			mgRefreshActiveTool(toolName);
		});
	});
}

/**
 * Renders Midnight Gambit custom subtool buttons.
 */
function mgRenderCustomSubbarTools(menuName, toolsWrap) {
	if (menuName === "dice") {
		mgRenderDiceSubbarTools(toolsWrap);
		return;
	}

	const tools = mgGetCustomToolsForMenu(menuName);
	toolsWrap.classList.remove("is-dice-subrail");

	toolsWrap.innerHTML = tools.map(tool => `
		<button
			type="button"
			class="mg-orb-subtool"
			data-mg-custom-subtool="${tool.name}"
			title="${tool.label}"
			aria-label="${tool.label}"
		>
			<i class="${tool.icon}"></i>
		</button>
	`).join("");

	toolsWrap.querySelectorAll("[data-mg-custom-subtool]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();

			const toolName = button.dataset.mgCustomSubtool;
			mgActiveControl = `mg:${menuName}`;
			mgActiveTool = toolName;

			mgRefreshActiveControl(mgActiveControl);
			mgRefreshActiveTool(toolName);
			mgSaveUiState({
				activeControl: mgActiveControl,
				activeTool: toolName
			});
			mgSetOrbBadge(mgActiveControl, toolName);

			await mgRunCustomTool(menuName, toolName);

			mgRenderCustomSubbarTools(menuName, toolsWrap);
			mgSetOrbBadge(mgActiveControl, mgActiveTool);
		});
	});
}

function mgRenderDiceSubbarTools(toolsWrap) {
	const tools = mgGetCustomToolsForMenu("dice");
	const toolsByFormula = new Map(tools.map(tool => [tool.formula, tool]));
	toolsWrap.classList.add("is-dice-subrail");

	toolsWrap.innerHTML = `
		<div class="mg-dice-subrail" role="grid" aria-label="Quick Dice Roller">
			${MG_QUICK_DICE_SIDES.map(sides => `
				<div class="mg-dice-row" role="row">
					<div class="mg-dice-row-label" role="rowheader">
						<i class="fa-solid fa-dice-d20"></i>
						<span>d${sides}</span>
					</div>

					${MG_QUICK_DICE_COUNTS.map(count => {
						const formula = `${count}d${sides}`;
						const tool = toolsByFormula.get(formula);
						const label = tool?.label ?? formula;
						const toolName = tool?.name ?? `roll-${formula}`;
						return `
							<button
								type="button"
								class="mg-dice-roll-button"
								data-mg-custom-subtool="${toolName}"
								data-mg-dice-formula="${formula}"
								title="Roll ${label}"
								aria-label="Roll ${label}"
								role="gridcell"
							>
								${count}
							</button>
						`;
					}).join("")}
				</div>
			`).join("")}
		</div>
	`;

	toolsWrap.querySelectorAll("[data-mg-dice-formula]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();

			const toolName = button.dataset.mgCustomSubtool;
			mgActiveControl = "mg:dice";
			mgActiveTool = toolName;

			mgRefreshActiveControl(mgActiveControl);
			mgRefreshActiveTool(toolName);
			mgSaveUiState({
				activeControl: mgActiveControl,
				activeTool: toolName
			});
			mgSetOrbBadge(mgActiveControl, toolName);

			await mgRunCustomTool("dice", toolName);
		});
	});
}

/**
 * Closes the subtool rail visually.
 */
function mgCloseSubbar() {
	const root = document.getElementById(MG_UI_ID);
	const subrail = root?.querySelector("[data-mg-orb-subrail]");
	if (!subrail) return;

	if (mgSubbarCloseTimer) {
		clearTimeout(mgSubbarCloseTimer);
		mgSubbarCloseTimer = null;
	}

	subrail.classList.add("is-closing");
	subrail.classList.remove("is-open");

	mgSubbarOpen = false;
	mgSaveUiState({ subbarOpen: false });
	mgSetOrbBadge();

	mgSubbarCloseTimer = window.setTimeout(() => {
		subrail.classList.remove("is-closing");
		mgSubbarCloseTimer = null;
	}, 170);
}

/**
 * Converts Foundry localization keys into readable labels.
 * Falls back to our own friendly labels if Foundry gives us a raw key.
 */
function mgReadableToolLabel(tool, controlName) {
	const raw = tool?.title || tool?.label || tool?.name || "";

	// Try Foundry localization first.
	const localized = raw ? game.i18n.localize(raw) : "";

	// If localization worked, use it.
	if (localized && localized !== raw) return localized;

	// If Foundry handed us a raw CONTROLS key, use our friendlier fallback labels.
	const fallback = MG_FALLBACK_TOOLS[controlName]?.find(t => t.name === tool?.name);
	if (fallback?.label) return fallback.label;

	// Last resort: make the tool name readable.
	return String(tool?.name || raw || "Tool")
		.replace(/[-_]/g, " ")
		.replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Get Foundry tools for a control, with fallback definitions.
 */
function mgGetToolsForControl(controlName) {
	const foundryControl = ui.controls?.controls?.find(c => c.name === controlName);
	const foundryTools = Array.isArray(foundryControl?.tools) ? foundryControl.tools : [];

	if (foundryTools.length) {
		return foundryTools
			.filter(tool => tool.visible !== false)
			.map(tool => {
				const fallback = MG_FALLBACK_TOOLS[controlName]?.find(t => t.name === tool.name);

				return {
					name: tool.name,
					label: mgReadableToolLabel(tool, controlName),
					icon: tool.icon || fallback?.icon || "fa-solid fa-circle"
				};
			});
	}

	return MG_FALLBACK_TOOLS[controlName] ?? [];
}

/**
 * Moves the triangular pointer under the active main category.
 */
function mgPositionSubbar(sourceButton, subrail, pointer) {
	if (!sourceButton || !subrail) return;

	const rail = sourceButton.closest("[data-mg-orb-rail]");
	if (!rail) return;

	// Use layout offsets instead of getBoundingClientRect.
	// This ignores the rail's slide/scale animation, so restore positioning is stable.
	const left = rail.offsetLeft + sourceButton.offsetLeft;

	subrail.classList.add("no-side-motion");
	subrail.style.left = `${Math.max(0, left)}px`;

	if (pointer) {
		pointer.style.left = `${sourceButton.offsetWidth / 2}px`;
	}

	requestAnimationFrame(() => {
		subrail.classList.remove("no-side-motion");
	});
}

/* Left Sidebar Binder
==============================================================================================================================================*/
function mgBindLeftSidebar(root) {
	root.querySelectorAll("[data-mg-left-tab]").forEach(button => {
		button.addEventListener("click", event => {
			event.preventDefault();
			event.stopPropagation();

			const tabId = button.dataset.mgLeftTab;
			mgSetLeftSidebarTab(tabId);
		});
	});

	mgBindLeftSidebarAccordions(root);
}

function mgBindLeftSidebarAccordions(root) {
	const body = root?.querySelector("[data-sidebar-body]");
	if (!body || body.dataset.mgAccordionBound === "true") return;

	body.dataset.mgAccordionBound = "true";
	body.addEventListener("click", event => {
		const button = event.target.closest("[data-mg-accordion-toggle]");
		if (!button || !body.contains(button)) return;

		event.preventDefault();
		event.stopPropagation();

		mgToggleLeftAccordion(button);
	});
}

function mgToggleLeftAccordion(button) {
	const panel = button.closest("[data-mg-character-sidebar], [data-mg-crew-sidebar]");
	const actorId = panel?.dataset?.mgCharacterSidebar || panel?.dataset?.mgCrewSidebar;
	const actor = game.actors.get(actorId);
	const id = button.dataset.mgAccordionToggle;
	const accordion = button.closest("[data-mg-accordion]");
	const body = accordion?.querySelector(".mg-left-accordion-body");
	if (!accordion || !body || !id) return;

	const nextOpen = !accordion.classList.contains("is-open");
	button.setAttribute("aria-expanded", String(nextOpen));
	mgSetAccordionOpen(actor, id, nextOpen);

	if (body._mgAccordionTimer) {
		clearTimeout(body._mgAccordionTimer);
		body._mgAccordionTimer = null;
	}

	if (body._mgAccordionEnd) {
		body.removeEventListener("transitionend", body._mgAccordionEnd);
		body._mgAccordionEnd = null;
	}

	if (nextOpen) {
		body.hidden = false;
		accordion.classList.add("is-opening", "is-open");
		accordion.classList.remove("is-closing");
		body.style.maxHeight = "0px";

		requestAnimationFrame(() => {
			body.style.maxHeight = `${mgGetLeftAccordionAnimationHeight(body)}px`;
		});

		const finishOpen = () => {
			body.style.maxHeight = "none";
			accordion.classList.remove("is-opening");
			body._mgAccordionTimer = null;
			body._mgAccordionEnd = null;
		};

		body._mgAccordionEnd = event => {
			if (event.propertyName !== "max-height") return;
			body.removeEventListener("transitionend", body._mgAccordionEnd);
			finishOpen();
		};

		body.addEventListener("transitionend", body._mgAccordionEnd);
		body._mgAccordionTimer = window.setTimeout(() => {
			if (body._mgAccordionEnd) body.removeEventListener("transitionend", body._mgAccordionEnd);
			finishOpen();
		}, 560);

		return;
	}

	accordion.classList.add("is-closing");
	accordion.classList.remove("is-opening", "is-open");
	body.style.maxHeight = `${mgGetLeftAccordionAnimationHeight(body)}px`;

	requestAnimationFrame(() => {
		body.style.maxHeight = "0px";
	});

	const finishClose = () => {
		body.hidden = true;
		accordion.classList.remove("is-closing");
		body._mgAccordionTimer = null;
		body._mgAccordionEnd = null;
	};

	body._mgAccordionEnd = event => {
		if (event.propertyName !== "max-height") return;
		body.removeEventListener("transitionend", body._mgAccordionEnd);
		finishClose();
	};

	body.addEventListener("transitionend", body._mgAccordionEnd);
	body._mgAccordionTimer = window.setTimeout(() => {
		if (body._mgAccordionEnd) body.removeEventListener("transitionend", body._mgAccordionEnd);
		finishClose();
	}, 560);
}

function mgGetLeftAccordionAnimationHeight(body) {
	const fullHeight = body?.scrollHeight ?? 0;
	const sidebarBody = body?.closest("[data-sidebar-body]");
	const visibleHeight = sidebarBody?.clientHeight ?? fullHeight;
	const targetHeight = Math.min(fullHeight, visibleHeight);

	return Math.max(0, Math.ceil(targetHeight));
}

function mgBindSidebarCollapse(root) {
	root.querySelectorAll("[data-mg-collapse-sidebar]").forEach(button => {
		button.addEventListener("click", event => {
			event.preventDefault();
			event.stopPropagation();

			const side = button.dataset.mgCollapseSidebar;
			if (side === "left") {
				mgSetSidebarCollapsed("left", !mgLeftSidebarCollapsed);
			}

			if (side === "right") {
				mgSetSidebarCollapsed("right", !mgRightSidebarCollapsed);
			}
		});
	});
}

function mgSetSidebarCollapsed(side, collapsed) {
	const body = document.body;
	const root = document.getElementById(MG_UI_ID);
	if (!body || !root) return;

	const isCollapsed = !!collapsed;

	if (side === "left") {
		mgLeftSidebarCollapsed = isCollapsed;
		body.classList.toggle("left-sidebar-collapsed", isCollapsed);

		const button = root.querySelector('[data-mg-collapse-sidebar="left"]');
		const icon = button?.querySelector("i");

		if (icon) {
			icon.className = isCollapsed
				? "fa-solid fa-chevron-right"
				: "fa-solid fa-chevron-left";
		}

		if (button) {
			button.title = isCollapsed ? "Show left sidebar" : "Hide left sidebar";
			button.setAttribute("aria-label", button.title);
			button.setAttribute("aria-expanded", String(!isCollapsed));
		}
	}

	if (side === "right") {
		mgRightSidebarCollapsed = isCollapsed;
		body.classList.toggle("mg-right-sidebar-collapsed", isCollapsed);

		const button = root.querySelector('[data-mg-collapse-sidebar="right"]');
		const icon = button?.querySelector("i");

		if (icon) {
			icon.className = isCollapsed
				? "fa-solid fa-chevron-left"
				: "fa-solid fa-chevron-right";
		}

		if (button) {
			button.title = isCollapsed ? "Show right sidebar" : "Hide right sidebar";
			button.setAttribute("aria-label", button.title);
			button.setAttribute("aria-expanded", String(!isCollapsed));

			if (!isCollapsed) {
				button.classList.remove("has-chat-notice");
			}
		}
	}

	mgSaveUiState({
		leftSidebarCollapsed: mgLeftSidebarCollapsed,
		rightSidebarCollapsed: mgRightSidebarCollapsed
	});
}

function mgRestoreSidebarCollapseState() {
	const state = mgLoadUiState();

	mgSetSidebarCollapsed("left", !!state.leftSidebarCollapsed);
	mgSetSidebarCollapsed("right", !!state.rightSidebarCollapsed);
}

function mgSetLeftSidebarTab(tabId) {
	const root = document.getElementById(MG_UI_ID);
	if (!root) return;

	const normalizedTabId = mgNormalizeLeftSidebarTabId(tabId);
	const visibleTabs = mgGetVisibleLeftSidebarTabs();
	const tab = visibleTabs.find(t => t.id === normalizedTabId) || visibleTabs[0];
	if (!tab) return;

	mgUndockFoundryPlayersBox();

	mgActiveSidebarTab = tab.id;
	mgSetLeftSidebarTabClass(root, tab.id);
	mgSetSceneViewerRefreshActive(tab.id === "scenes");

	root.querySelectorAll("[data-mg-left-tab]").forEach(button => {
		button.classList.toggle("is-active", button.dataset.mgLeftTab === tab.id);
	});

	const title = root.querySelector("[data-sidebar-title]");
	if (title) title.textContent = tab.label;

	const body = root.querySelector("[data-sidebar-body]");
	if (body) body.innerHTML = mgRenderLeftSidebarContent(tab.id);

	mgBindLeftSidebarContent(root, tab.id);

	mgSaveUiState({
		sidebarTab: tab.id
	});
}

/* Left sidebar tab state classes
----------------------------------------------------------------------*/
function mgSetLeftSidebarTabClass(root, tabId) {
	const sidebar = root?.querySelector("[data-mg-left-sidebar]");
	if (!sidebar) return;

	sidebar.dataset.mgLeftSidebarTab = tabId;
	MG_LEFT_SIDEBAR_TABS.forEach(tab => {
		sidebar.classList.toggle(`is-${tab.id}-tab`, tab.id === tabId);
	});
}

function mgRenderLeftSidebarContent(tabId) {
	switch (tabId) {
		case "player":
			return mgRenderPlayerSidebarContent();

		case "crew":
			return mgRenderCrewSidebarContent();

		case "clocks":
			return mgRenderClocksSidebarContent();

		case "scenes":
			return mgRenderSceneSidebarContent();

		case "actors":
			return mgRenderActorSidebarContent();

		case "gm":
			return mgRenderGmSidebarContent();

		case "items":
			return mgRenderItemSidebarContent();

		case "journal":
			return mgRenderJournalSidebarContent();

		case "compendiums":
			return mgRenderCompendiumSidebarContent();

		case "playlists":
			return mgRenderPlaylistSidebarContent();

		case "players":
			return mgRenderPlayersSidebarContent();

		case "settings":
			return mgRenderSettingsSidebarContent();

		default:
			return `<div class="mg-left-empty">Unknown tab.</div>`;
	}
}

function mgBindLeftSidebarContent(root, tabId) {
	if (tabId === "players") {
		mgDockFoundryPlayersBox(root);
	}

	mgBindLeftSidebarAccordions(root);
	mgBindCharacterSidebarContent(root);
	mgBindCrewSidebarContent(root);
	if (tabId === "clocks") {
		mgBindClocksSidebarContent(root);
	}

	if (tabId === "scenes") {
		mgBindSceneSidebarContent(root);
	}

	if (tabId === "actors") {
		mgBindActorSidebarContent(root);
	}

	if (tabId === "items") {
		mgBindItemSidebarContent(root);
	}

	if (tabId === "journal") {
		mgBindJournalSidebarContent(root);
	}

	if (tabId === "compendiums") {
		mgBindCompendiumSidebarContent(root);
	}

	if (tabId === "playlists") {
		mgBindPlaylistSidebarContent(root);
	}

	if (tabId === "gm") {
		mgBindGmSidebarContent(root);
	}

	root.querySelectorAll("[data-mg-open-actor]").forEach(button => {
		button.addEventListener("click", () => {
			const actor = game.actors.get(button.dataset.mgOpenActor);
			actor?.sheet?.render(true, { focus: true });
		});
	});

	root.querySelectorAll("[data-mg-open-actor-tab]").forEach(button => {
		button.addEventListener("click", () => {
			const actor = game.actors.get(button.dataset.mgOpenActorTab);
			mgOpenActorSheetTab(actor, button.dataset.mgTab);
		});
	});

	root.querySelectorAll("[data-mg-character-sidebar] [data-mg-post-owned-item]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			const actor = mgGetCharacterSidebarActor(root);
			const item = actor?.items?.get(button.dataset.mgPostOwnedItem);
			await mgPostOwnedInventoryItemToChat(actor, item);
		});
	});

	root.querySelectorAll("[data-mg-open-item]").forEach(button => {
		button.addEventListener("click", () => {
			const item = game.items.get(button.dataset.mgOpenItem);
			item?.sheet?.render(true, { focus: true });
		});
	});

	root.querySelectorAll("[data-mg-open-scene]").forEach(button => {
		button.addEventListener("click", async () => {
			const scene = game.scenes.get(button.dataset.mgOpenScene);
			if (!scene) return;
			await scene.view();
			mgRefreshScenesSidebarContent();
		});
	});

	root.querySelectorAll("[data-mg-open-journal]").forEach(button => {
		button.addEventListener("click", () => {
			const journal = (game.journal ?? game.journals)?.get(button.dataset.mgOpenJournal);
			journal?.sheet?.render(true, { focus: true });
		});
	});

	root.querySelectorAll("[data-mg-open-pack]").forEach(button => {
		button.addEventListener("click", () => {
			const pack = game.packs.get(button.dataset.mgOpenPack);
			pack?.render?.(true);
		});
	});

	root.querySelector("[data-mg-settings-config]")?.addEventListener("click", () => {
		game.settings?.sheet?.render?.(true);
	});

	root.querySelector("[data-mg-settings-controls]")?.addEventListener("click", () => {
		try {
			new KeybindingsConfig().render(true);
		} catch (err) {
			ui.notifications?.warn("Could not open Configure Controls.");
			console.warn("MG UI | Configure Controls failed.", err);
		}
	});

	root.querySelector("[data-mg-settings-modules]")?.addEventListener("click", () => {
		try {
			new ModuleManagement().render(true);
		} catch (err) {
			ui.notifications?.warn("Could not open Manage Modules.");
			console.warn("MG UI | Manage Modules failed.", err);
		}
	});

	root.querySelector("[data-mg-settings-world]")?.addEventListener("click", () => {
		try {
			new WorldConfig().render(true);
		} catch (err) {
			ui.notifications?.warn("Could not open Edit World.");
			console.warn("MG UI | Edit World failed.", err);
		}
	});

	root.querySelector("[data-mg-settings-users]")?.addEventListener("click", () => {
		try {
			new UserManagement().render(true);
		} catch (err) {
			ui.notifications?.warn("Could not open User Management.");
			console.warn("MG UI | User Management failed.", err);
		}
	});

	root.querySelector("[data-mg-settings-invites]")?.addEventListener("click", () => {
		try {
			new InvitationLinks().render(true);
		} catch (err) {
			ui.notifications?.warn("Could not open Invitation Links.");
			console.warn("MG UI | Invitation Links failed.", err);
		}
	});

	root.querySelector("[data-mg-settings-logout]")?.addEventListener("click", () => {
		try {
			if (typeof game.logOut === "function") return game.logOut();
			window.location.href = foundry.utils.getRoute("logout");
		} catch (err) {
			ui.notifications?.warn("Could not log out.");
			console.warn("MG UI | Log out failed.", err);
		}
	});

	root.querySelector("[data-mg-settings-setup]")?.addEventListener("click", () => {
		try {
			if (typeof game.shutDown === "function") return game.shutDown();
			window.location.href = foundry.utils.getRoute("setup");
		} catch (err) {
			ui.notifications?.warn("Could not return to setup.");
			console.warn("MG UI | Return to Setup failed.", err);
		}
	});
}

/* Scene sidebar interactions
----------------------------------------------------------------------*/
function mgBindSceneSidebarContent(root) {
	const panel = root?.querySelector(".mg-scene-directory");
	if (!panel) return;

	panel.querySelector("[data-mg-scene-search]")?.addEventListener("keydown", event => {
		if (event.key !== "Enter") return;
		event.preventDefault();
		mgFilterSceneSidebar(panel, event.currentTarget.value);
	});

	panel.querySelector("[data-mg-scene-collapse-folders]")?.addEventListener("click", event => {
		event.preventDefault();
		mgCollapseSceneFolders(panel);
	});

	panel.querySelectorAll("[data-mg-scene-create]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();
			await mgCreateScene(button.dataset.mgSceneCreate || null);
		});
	});

	panel.querySelectorAll("[data-mg-scene-folder-create]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();
			await mgCreateSceneFolder(button.dataset.mgSceneFolderCreate || null);
		});
	});

	panel.querySelectorAll("[data-mg-scene-menu]").forEach(button => {
		button.addEventListener("click", event => {
			event.preventDefault();
			event.stopPropagation();
			const row = button.closest("[data-mg-scene-id]");
			mgOpenSceneContextMenu(button.dataset.mgSceneMenu, button, row);
		});
	});

	panel.querySelectorAll("[data-mg-scene-id]").forEach(row => {
		row.addEventListener("contextmenu", event => {
			event.preventDefault();
			event.stopPropagation();
			mgOpenSceneContextMenu(row.dataset.mgSceneId, row, row, event);
		});
	});

	panel.querySelectorAll("[data-mg-active-scene-id]").forEach(banner => {
		banner.addEventListener("contextmenu", event => {
			event.preventDefault();
			event.stopPropagation();
			mgOpenSceneContextMenu(banner.dataset.mgActiveSceneId, banner, banner, event);
		});
	});

	panel.querySelectorAll("[data-mg-scene-folder-id]").forEach(folderEl => {
		folderEl.addEventListener("contextmenu", event => {
			event.preventDefault();
			event.stopPropagation();
			mgOpenSceneFolderContextMenu(folderEl.dataset.mgSceneFolderId, folderEl, event);
		});
	});

	mgBindSceneSidebarDrag(panel);
}

/* Scene sidebar search filtering
----------------------------------------------------------------------*/
function mgFilterSceneSidebar(panel, value) {
	const query = String(value ?? "").trim().toLowerCase();
	const rows = Array.from(panel.querySelectorAll("[data-mg-scene-id]"));
	let visibleRows = 0;

	rows.forEach(row => {
		const name = String(row.dataset.mgSceneName ?? "").toLowerCase();
		const visible = !query || name.includes(query);
		row.hidden = !visible;
		if (visible && row.dataset.mgSceneFavoriteList !== "true") visibleRows += 1;
	});

	panel.querySelectorAll("[data-mg-accordion]").forEach(accordion => {
		const hasVisibleScene = !!accordion.querySelector('[data-mg-scene-id]:not([hidden])');
		accordion.hidden = query ? !hasVisibleScene : false;

		if (query && hasVisibleScene && !accordion.classList.contains("is-open")) {
			const button = accordion.querySelector("[data-mg-accordion-toggle]");
			if (button) mgToggleLeftAccordion(button);
		}
	});

	panel.querySelectorAll("[data-mg-scene-search-section]").forEach(section => {
		const hasVisibleScene = !!section.querySelector('[data-mg-scene-id]:not([hidden])');
		section.hidden = query ? !hasVisibleScene : false;
	});

	const rootSceneVisible = !!panel.querySelector(".mg-scene-tree > [data-mg-scene-id]:not([hidden])");
	const anyVisible = visibleRows > 0 || rootSceneVisible || !!panel.querySelector('[data-mg-accordion]:not([hidden]) [data-mg-scene-id]:not([hidden])');
	const empty = panel.querySelector("[data-mg-scene-empty-search]");
	if (empty) empty.hidden = !query || anyVisible;
}

function mgCollapseSceneFolders(panel) {
	panel.querySelectorAll(".mg-scene-folder-accordion[data-mg-accordion]").forEach(accordion => {
		const id = accordion.dataset.mgAccordion;
		const button = accordion.querySelector("[data-mg-accordion-toggle]");
		const body = accordion.querySelector(".mg-left-accordion-body");
		if (!id || !button || !body) return;

		mgSetAccordionOpen(null, id, false);
		button.setAttribute("aria-expanded", "false");
		accordion.classList.remove("is-open", "is-opening", "is-closing");
		body.hidden = true;
		body.style.maxHeight = "0px";
	});
}

/* Scene sidebar drag and drop
----------------------------------------------------------------------*/
function mgBindSceneSidebarDrag(panel) {
	let dragging = null;

	const getDragSceneId = event =>
		event.dataTransfer?.getData("application/x-mg-scene-id") || event.dataTransfer?.getData("text/plain") || dragging?.dataset?.mgSceneId || "";

	const getDragToken = () => {
		if (dragging?.dataset?.mgSceneId) return mgSceneOrderToken("scene", dragging.dataset.mgSceneId);
		if (dragging?.dataset?.mgSceneFolderId) return mgSceneOrderToken("folder", dragging.dataset.mgSceneFolderId);
		return "";
	};

	const clearDropState = () => {
		panel.querySelectorAll(".mg-scene-drop-target, .mg-scene-drop-folder").forEach(el => {
			el.classList.remove("mg-scene-drop-target", "mg-scene-drop-folder");
		});
	};

	const finalizeContainerOrder = async container => {
		const sceneId = dragging?.dataset?.mgSceneId;
		const draggedFolderId = dragging?.dataset?.mgSceneFolderId;
		const dragToken = getDragToken();
		if (!dragToken || !container) return;

		const folderId = container.dataset.mgSceneContainer || null;
		const originalFolderId = dragging.dataset.mgSceneFolder || null;
		const originalDisplayContainer = dragging.dataset.mgSceneDisplayContainer || "";
		const entries = Array.from(container.children)
			.filter(el => el.matches?.(".mg-scene-row[data-mg-scene-id], [data-mg-scene-folder-id]"));

		if (!entries.some(entry => mgSceneOrderElementToken(entry) === dragToken)) {
			container.appendChild(dragging);
			entries.push(dragging);
		}

		if (!game.user?.isGM && mgNormalizeSceneContainerId(folderId) !== mgNormalizeSceneContainerId(originalDisplayContainer)) {
			container.querySelector(`[data-mg-scene-id="${mgCssEscape(sceneId)}"]`)?.remove();
			return;
		}

		await mgSaveSceneUserOrderFromContainer(container);

		if (sceneId && game.user?.isGM && folderId !== originalFolderId) {
			const scene = game.scenes?.get(sceneId);
			await scene?.update({ folder: folderId || null });
		}
		if (draggedFolderId && game.user?.isGM && folderId !== originalDisplayContainer) {
			const folder = game.folders?.get(draggedFolderId);
			await folder?.update({ folder: folderId || null });
		}
	};

	const getDirectDropTarget = (event, container) => {
		const target = event.target.closest(".mg-scene-row[data-mg-scene-id], [data-mg-scene-folder-id]");
		if (!target || target === dragging || target.parentElement !== container) return null;
		return target;
	};

	const insertDraggingNearTarget = (event, container, target) => {
		const rect = target.getBoundingClientRect();
		const after = event.clientY > rect.top + rect.height / 2;
		container.insertBefore(dragging, after ? target.nextSibling : target);
	};

	const isFolderNestZone = (event, folderDrop) => {
		const rect = folderDrop.getBoundingClientRect();
		const y = event.clientY - rect.top;
		return y > rect.height * 0.25 && y < rect.height * 0.75;
	};

	// Scene rows are draggable everywhere they appear, including favorites.
	panel.querySelectorAll(".mg-scene-row[data-mg-scene-id]").forEach(row => {
		row.setAttribute("draggable", "true");

		row.addEventListener("dragstart", event => {
			event.stopPropagation();
			const sceneId = row.dataset.mgSceneId || "";
			const canonicalRow = row.closest(".mg-scene-tree")
				? row
				: panel.querySelector(`.mg-scene-tree .mg-scene-row[data-mg-scene-id="${mgCssEscape(sceneId)}"]`);

			dragging = canonicalRow || row;
			dragging.dataset.mgSceneDisplayContainer = dragging.parentElement?.dataset?.mgSceneContainer || "";
			row.classList.add("mg-dragging");
			if (dragging !== row) dragging.classList.add("mg-dragging");
			event.dataTransfer?.setData("application/x-mg-scene-id", sceneId);
			event.dataTransfer?.setData("text/plain", sceneId);
			event.dataTransfer.effectAllowed = "move";
		});

		row.addEventListener("dragend", () => {
			row.classList.remove("mg-dragging");
			dragging?.classList?.remove("mg-dragging");
			dragging = null;
			clearDropState();
		});
	});

	// Folder accordions can be reordered, but their nesting is still controlled by folder creation.
	panel.querySelectorAll("[data-mg-scene-folder-id]").forEach(folder => {
		folder.setAttribute("draggable", "true");

		folder.addEventListener("dragstart", event => {
			if (event.target.closest(".mg-scene-row[data-mg-scene-id]") || event.target.closest("[data-mg-scene-folder-id]") !== folder) return;
			event.stopPropagation();
			dragging = folder;
			dragging.dataset.mgSceneDisplayContainer = dragging.parentElement?.dataset?.mgSceneContainer || "";
			folder.classList.add("mg-dragging");
			event.dataTransfer?.setData("application/x-mg-scene-folder-id", folder.dataset.mgSceneFolderId || "");
			event.dataTransfer?.setData("text/plain", folder.dataset.mgSceneFolderId || "");
			event.dataTransfer.effectAllowed = "move";
		});

		folder.addEventListener("dragend", () => {
			if (dragging !== folder) return;
			folder.classList.remove("mg-dragging");
			dragging = null;
			clearDropState();
		});
	});

	// Containers save a user-local order without touching shared scene or folder sort.
	panel.querySelectorAll("[data-mg-scene-container]").forEach(container => {
		container.addEventListener("dragover", event => {
			if (!dragging) return;
			const isRootContainer = container.dataset.mgSceneContainer === "";
			const isDraggingFolder = !!dragging.dataset.mgSceneFolderId;
			const allowsFolderPromotion = isDraggingFolder && game.user?.isGM && isRootContainer;
			if (!allowsFolderPromotion && (isDraggingFolder || !game.user?.isGM) && mgNormalizeSceneContainerId(container.dataset.mgSceneContainer) !== mgNormalizeSceneContainerId(dragging.dataset.mgSceneDisplayContainer)) return;
			const nearestContainer = event.target.closest("[data-mg-scene-container]");
			if (!isRootContainer && nearestContainer !== container) return;
			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = "move";
			clearDropState();
			container.classList.add("mg-scene-drop-target");

		});

		container.addEventListener("drop", async event => {
			if (!dragging) return;
			const isRootContainer = container.dataset.mgSceneContainer === "";
			const isDraggingFolder = !!dragging.dataset.mgSceneFolderId;
			const allowsFolderPromotion = isDraggingFolder && game.user?.isGM && isRootContainer;
			if (!allowsFolderPromotion && (isDraggingFolder || !game.user?.isGM) && mgNormalizeSceneContainerId(container.dataset.mgSceneContainer) !== mgNormalizeSceneContainerId(dragging.dataset.mgSceneDisplayContainer)) return;
			const nearestContainer = event.target.closest("[data-mg-scene-container]");
			if (!isRootContainer && nearestContainer !== container) return;
			event.preventDefault();
			event.stopPropagation();
			const target = getDirectDropTarget(event, container);
			if (target) insertDraggingNearTarget(event, container, target);
			clearDropState();
			await finalizeContainerOrder(container);
		});
	});

	// Dropping a scene onto the center of a folder header moves that scene into the folder for GMs.
	panel.querySelectorAll("[data-mg-scene-folder-drop]").forEach(folderDrop => {
		folderDrop.addEventListener("dragover", event => {
			if (!dragging) return;
			if (!dragging.dataset.mgSceneId) return;
			if (!game.user?.isGM) return;
			if (!isFolderNestZone(event, folderDrop)) return;
			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = "move";
			clearDropState();
			folderDrop.classList.add("mg-scene-drop-folder");
		});

		folderDrop.addEventListener("drop", async event => {
			if (!dragging?.dataset?.mgSceneId) return;
			const sceneId = getDragSceneId(event);
			const folderId = folderDrop.dataset.mgSceneFolderDrop || null;
			const scene = sceneId ? game.scenes?.get(sceneId) : null;
			if (!scene) return;
			if (!game.user?.isGM) return;
			if (!isFolderNestZone(event, folderDrop)) return;

			event.preventDefault();
			event.stopPropagation();
			clearDropState();

			const folder = game.folders?.get(folderId);
			await scene.update({ folder: folderId || null });
			await mgAppendSceneToUserOrder(folderId, scene.id);

			if (folder) {
				mgSetAccordionOpen(null, `scene-folder-${folder.id}`, true);
			}
		});
	});
}

/* Scene sidebar per-user ordering
----------------------------------------------------------------------*/
function mgNormalizeSceneContainerId(folderId) {
	return folderId || "";
}

function mgGetSceneUserOrder() {
	const order = game.user?.getFlag?.(MG_UI_NS, MG_SCENE_USER_ORDER_FLAG);
	return order && typeof order === "object" && !Array.isArray(order) ? { ...order } : {};
}

function mgGetSceneUserOrderKey(folderId) {
	return mgNormalizeSceneContainerId(folderId) || "root";
}

function mgSceneOrderToken(type, id) {
	return `${type}:${id}`;
}

function mgSceneOrderEntryToken(entry) {
	if (entry.type === "folder") return mgSceneOrderToken("folder", entry.id);
	return mgSceneOrderToken("scene", entry.id);
}

function mgSceneOrderElementToken(element) {
	if (element?.dataset?.mgSceneFolderId) return mgSceneOrderToken("folder", element.dataset.mgSceneFolderId);
	if (element?.dataset?.mgSceneId) return mgSceneOrderToken("scene", element.dataset.mgSceneId);
	return "";
}

async function mgSetSceneUserOrderForContainer(folderId, tokens) {
	const order = mgGetSceneUserOrder();
	order[mgGetSceneUserOrderKey(folderId)] = Array.from(new Set(tokens.filter(Boolean)));
	await game.user?.setFlag?.(MG_UI_NS, MG_SCENE_USER_ORDER_FLAG, order);
}

async function mgSaveSceneUserOrderFromContainer(container) {
	const folderId = container?.dataset?.mgSceneContainer || "";
	const tokens = Array.from(container?.children ?? [])
		.map(el => {
			if (el.matches?.(".mg-scene-row[data-mg-scene-id]")) return mgSceneOrderToken("scene", el.dataset.mgSceneId);
			if (el.matches?.("[data-mg-scene-folder-id]")) return mgSceneOrderToken("folder", el.dataset.mgSceneFolderId);
			return null;
		})
		.filter(Boolean);

	await mgSetSceneUserOrderForContainer(folderId, tokens);
}

async function mgAppendSceneToUserOrder(folderId, sceneId) {
	const key = mgGetSceneUserOrderKey(folderId);
	const order = mgGetSceneUserOrder();
	const token = mgSceneOrderToken("scene", sceneId);
	order[key] = [...(order[key] ?? []).filter(existing => existing !== token), token];
	await game.user?.setFlag?.(MG_UI_NS, MG_SCENE_USER_ORDER_FLAG, order);
}

/* Scene and scene folder creation
----------------------------------------------------------------------*/
async function mgCreateScene(folderId = null) {
	if (!game.user?.isGM) return;

	try {
		if (typeof Scene?.createDialog === "function") {
			await Scene.createDialog(
				{ folder: folderId || null },
				{ folder: folderId || null }
			);
			return;
		}

		const scene = await Scene.create({
			name: "New Scene",
			folder: folderId || null
		}, { renderSheet: false });
		scene?.sheet?.render(true, { focus: true });
	} catch (err) {
		ui.notifications?.error("Could not create scene.");
		console.warn("MG UI | Create scene failed.", err);
	}
}

async function mgCreateSceneFolder(parentId = null) {
	if (!game.user?.isGM) return;

	try {
		const parent = parentId ? game.folders?.get(parentId) : null;
		if (parent && mgGetSceneFolderDepth(parent) > 0) {
			ui.notifications?.warn("Scene folders can only be nested one level deep.");
			return;
		}

		if (typeof Folder?.createDialog === "function") {
			await Folder.createDialog(
				{ type: "Scene", folder: parentId || null },
				{ folder: parentId || null }
			);
			return;
		}

		const folder = await Folder.create({
			name: "New Folder",
			type: "Scene",
			folder: parentId || null
		}, { renderSheet: false });
		folder?.sheet?.render(true, { focus: true });
	} catch (err) {
		ui.notifications?.error("Could not create scene folder.");
		console.warn("MG UI | Create scene folder failed.", err);
	}
}

/* Scene context menus
----------------------------------------------------------------------*/
function mgCloseSceneContextMenu() {
	document.querySelectorAll(".mg-scene-context-menu, .mg-scene-folder-context-menu").forEach(menu => menu.remove());
	document.removeEventListener("click", mgCloseSceneContextMenu);
	document.removeEventListener("keydown", mgCloseSceneContextMenuOnEscape);
}

function mgCloseSceneContextMenuOnEscape(event) {
	if (event.key === "Escape") mgCloseSceneContextMenu();
}

globalThis.MGSidebarShared = {
	esc: mgEsc,
	attr: mgAttr,
	cssUrl: mgCssUrl,
	cssEscape: mgCssEscape,
	getActorPlacementImage: mgGetActorPlacementImage,
	getActorCropVariables: mgGetActorCropVariables,
	hasActorCrop: mgHasActorCrop,
	isAccordionOpen: mgIsAccordionOpen,
	setAccordionOpen: mgSetAccordionOpen,
	toggleLeftAccordion: mgToggleLeftAccordion,
	closeContextMenu: mgCloseSceneContextMenu,
	closeContextMenuOnEscape: mgCloseSceneContextMenuOnEscape
};

function mgOpenSceneContextMenu(sceneId, anchor, row, event = null) {
	const scene = game.scenes?.get(sceneId);
	if (!scene) return;

	mgCloseSceneContextMenu();

	const canManage = game.user?.isGM;
	const isFavorite = !!scene.getFlag?.(MG_UI_NS, MG_SCENE_FAVORITE_FLAG);
	const isNavigation = !!scene.navigation;
	const menu = document.createElement("nav");
	menu.className = "mg-scene-context-menu";
	menu.dataset.mgSceneContextMenu = scene.id;
	menu.innerHTML = `
		<button type="button" data-mg-scene-action="view"><i class="fa-solid fa-eye"></i> View Scene</button>
		${canManage ? `<button type="button" data-mg-scene-action="activate"><i class="fa-solid fa-location-dot"></i> Activate Scene</button>` : ""}
		${canManage ? `<button type="button" data-mg-scene-action="configure"><i class="fa-solid fa-gears"></i> Configure</button>` : ""}
		${canManage ? `<button type="button" data-mg-scene-action="thumbnail"><i class="fa-solid fa-image"></i> Generate Thumbnail</button>` : ""}
		${canManage ? `<button type="button" data-mg-scene-action="favorite"><i class="${isFavorite ? "fa-solid" : "fa-regular"} fa-star"></i> ${isFavorite ? "Remove Favorite" : "Favorite Scene"}</button>` : ""}
		${canManage ? `<button type="button" data-mg-scene-action="navigation"><i class="fa-solid fa-compass"></i> ${isNavigation ? "Hide From Navigation" : "Show In Navigation"}</button>` : ""}
		${canManage ? `<button type="button" data-mg-scene-action="duplicate"><i class="fa-regular fa-copy"></i> Duplicate</button>` : ""}
		${canManage ? `<button type="button" data-mg-scene-action="export"><i class="fa-solid fa-file-export"></i> Export Data</button>` : ""}
		${canManage ? `<button type="button" data-mg-scene-action="import"><i class="fa-solid fa-file-import"></i> Import Data</button>` : ""}
		${canManage ? `<button type="button" class="danger" data-mg-scene-action="delete"><i class="fa-solid fa-trash"></i> Delete</button>` : ""}
	`;

	menu.addEventListener("click", async clickEvent => {
		const button = clickEvent.target.closest("[data-mg-scene-action]");
		if (!button) return;

		clickEvent.preventDefault();
		clickEvent.stopPropagation();
		mgCloseSceneContextMenu();
		await mgRunSceneAction(scene, button.dataset.mgSceneAction);
	});

	document.body.appendChild(menu);
	const rect = event
		? { left: event.clientX, bottom: event.clientY, top: event.clientY, right: event.clientX }
		: (anchor ?? row)?.getBoundingClientRect?.();
	const menuRect = menu.getBoundingClientRect();
	const left = Math.min(window.innerWidth - menuRect.width - 8, Math.max(8, rect.left));
	const top = Math.min(window.innerHeight - menuRect.height - 8, Math.max(8, rect.bottom + 4));
	menu.style.left = `${left}px`;
	menu.style.top = `${top}px`;

	window.setTimeout(() => {
		document.addEventListener("click", mgCloseSceneContextMenu);
		document.addEventListener("keydown", mgCloseSceneContextMenuOnEscape);
	}, 0);
}

function mgOpenSceneFolderContextMenu(folderId, anchor, event = null) {
	const folder = game.folders?.get(folderId);
	if (!folder || folder.type !== "Scene" || !game.user?.isGM) return;

	mgCloseSceneContextMenu();

	const menu = document.createElement("nav");
	menu.className = "mg-scene-context-menu mg-scene-folder-context-menu";
	menu.dataset.mgSceneFolderContextMenu = folder.id;
	menu.innerHTML = `
		<button type="button" data-mg-folder-action="edit"><i class="fa-solid fa-pen-to-square"></i> Edit Folder</button>
		<button type="button" data-mg-folder-action="remove"><i class="fa-solid fa-trash"></i> Remove Folder</button>
		<button type="button" class="danger" data-mg-folder-action="delete-all"><i class="fa-solid fa-box-archive"></i> Delete All</button>
		<button type="button" data-mg-folder-action="export-compendium"><i class="fa-solid fa-book"></i> Export to Compendium</button>
	`;

	menu.addEventListener("click", async clickEvent => {
		const button = clickEvent.target.closest("[data-mg-folder-action]");
		if (!button) return;

		clickEvent.preventDefault();
		clickEvent.stopPropagation();
		mgCloseSceneContextMenu();
		await mgRunSceneFolderAction(folder, button.dataset.mgFolderAction);
	});

	document.body.appendChild(menu);
	const rect = event
		? { left: event.clientX, bottom: event.clientY, top: event.clientY, right: event.clientX }
		: anchor?.getBoundingClientRect?.();
	const menuRect = menu.getBoundingClientRect();
	const left = Math.min(window.innerWidth - menuRect.width - 8, Math.max(8, rect.left));
	const top = Math.min(window.innerHeight - menuRect.height - 8, Math.max(8, rect.bottom + 4));
	menu.style.left = `${left}px`;
	menu.style.top = `${top}px`;

	window.setTimeout(() => {
		document.addEventListener("click", mgCloseSceneContextMenu);
		document.addEventListener("keydown", mgCloseSceneContextMenuOnEscape);
	}, 0);
}

/* Scene folder context menu actions
----------------------------------------------------------------------*/
async function mgRunSceneFolderAction(folder, action) {
	try {
		switch (action) {
			case "edit":
				folder.sheet?.render(true, { focus: true });
				break;
			case "remove":
				await mgRemoveSceneFolderOnly(folder);
				break;
			case "delete-all":
				await mgDeleteSceneFolderContents(folder);
				break;
			case "export-compendium":
				await mgExportSceneFolderToCompendium(folder);
				break;
		}
	} catch (err) {
		ui.notifications?.error("Folder action failed.");
		console.warn("MG UI | Scene folder action failed.", { folder: folder?.id, action, err });
	}
}

function mgGetSceneFolderChildren(folder) {
	const folderId = folder?.id ?? null;
	const folders = Array.from(game.folders ?? [])
		.filter(child => child.type === "Scene" && (child.folder?.id ?? child.folder ?? null) === folderId);
	const scenes = Array.from(game.scenes ?? [])
		.filter(scene => (scene.folder?.id ?? scene.folder ?? null) === folderId);

	return { folders, scenes };
}

function mgCollectSceneFolderTree(folder, out = { folders: [], scenes: [] }) {
	const { folders, scenes } = mgGetSceneFolderChildren(folder);
	out.folders.push(folder);
	out.scenes.push(...scenes);
	folders.forEach(child => mgCollectSceneFolderTree(child, out));
	return out;
}

async function mgRemoveSceneFolderOnly(folder) {
	const parentId = folder.folder?.id ?? folder.folder ?? null;
	const { folders, scenes } = mgGetSceneFolderChildren(folder);

	const confirmed = await Dialog.confirm({
		title: `Remove ${folder.name}?`,
		content: `<p>Remove <strong>${mgEsc(folder.name)}</strong> and move its contents up one level?</p>`,
		yes: () => true,
		no: () => false,
		defaultYes: false
	});

	if (!confirmed) return;

	await Promise.all([
		...folders.map(child => child.update({ folder: parentId })),
		...scenes.map(scene => scene.update({ folder: parentId }))
	]);
	await folder.delete();
}

async function mgDeleteSceneFolderContents(folder) {
	const collected = mgCollectSceneFolderTree(folder);
	const confirmed = await Dialog.confirm({
		title: `Delete all in ${folder.name}?`,
		content: `<p>Delete <strong>${mgEsc(folder.name)}</strong>, ${collected.folders.length - 1} subfolders, and ${collected.scenes.length} scenes?</p>`,
		yes: () => true,
		no: () => false,
		defaultYes: false
	});

	if (!confirmed) return;

	const sceneIds = collected.scenes.map(scene => scene.id);
	const folderIds = collected.folders.map(f => f.id).reverse();

	if (sceneIds.length && typeof Scene.deleteDocuments === "function") {
		await Scene.deleteDocuments(sceneIds);
	} else {
		await Promise.all(sceneIds.map(id => game.scenes?.get(id)?.delete()));
	}

	if (folderIds.length && typeof Folder.deleteDocuments === "function") {
		await Folder.deleteDocuments(folderIds);
	} else {
		await Promise.all(folderIds.map(id => game.folders?.get(id)?.delete()));
	}
}

async function mgExportSceneFolderToCompendium(folder) {
	const fn = folder.exportToCompendium || folder.exportToCompendiumDialog;
	if (typeof fn === "function") {
		await fn.call(folder);
		return;
	}

	ui.notifications?.warn("Foundry does not expose folder compendium export here.");
}

/* Scene context menu actions
----------------------------------------------------------------------*/
async function mgRunSceneAction(scene, action) {
	try {
		switch (action) {
			case "view":
				await scene.view();
				mgRefreshScenesSidebarContent();
				break;
			case "activate":
				if (typeof scene.activate === "function") await scene.activate();
				else await scene.update({ active: true });
				mgRefreshScenesSidebarContent();
				break;
			case "configure":
				scene.sheet?.render(true, { focus: true });
				break;
			case "thumbnail":
				await mgGenerateSceneThumbnail(scene);
				break;
			case "favorite":
				await scene.setFlag(MG_UI_NS, MG_SCENE_FAVORITE_FLAG, !scene.getFlag(MG_UI_NS, MG_SCENE_FAVORITE_FLAG));
				break;
			case "navigation":
				await scene.update({ navigation: !scene.navigation });
				break;
			case "duplicate":
				await mgDuplicateScene(scene);
				break;
			case "export":
				scene.exportToJSON?.();
				break;
			case "import":
				scene.importFromJSONDialog?.();
				break;
			case "delete":
				await mgDeleteScene(scene);
				break;
		}
	} catch (err) {
		ui.notifications?.error("Scene action failed.");
		console.warn("MG UI | Scene action failed.", { scene: scene?.id, action, err });
	}
}

/* Scene action helpers
----------------------------------------------------------------------*/
async function mgGenerateSceneThumbnail(scene) {
	if (typeof scene.createThumbnail !== "function") {
		ui.notifications?.warn("This Foundry version does not expose thumbnail generation here.");
		return;
	}

	const thumbnail = await scene.createThumbnail();
	const thumb = thumbnail?.thumb || thumbnail;
	if (thumb) {
		await scene.update({ thumb });
		ui.notifications?.info(`Generated thumbnail for ${scene.name}.`);
	}
}

async function mgDuplicateScene(scene) {
	const data = scene.toObject();
	delete data._id;
	data.name = `${scene.name} Copy`;
	await Scene.create(data, { renderSheet: true });
}

async function mgDeleteScene(scene) {
	if (typeof scene.deleteDialog === "function") {
		await scene.deleteDialog();
		return;
	}

	const confirmed = await Dialog.confirm({
		title: `Delete ${scene.name}?`,
		content: `<p>Delete <strong>${mgEsc(scene.name)}</strong>?</p>`,
		yes: () => true,
		no: () => false,
		defaultYes: false
	});

	if (confirmed) await scene.delete();
}

function mgGetCharacterSidebarActor(root) {
	const panel = root?.querySelector("[data-mg-character-sidebar]");
	const actorId = panel?.dataset?.mgCharacterSidebar;
	return actorId ? game.actors.get(actorId) : null;
}

function mgRefreshLeftSidebarContent() {
	const root = document.getElementById(MG_UI_ID);
	const body = root?.querySelector("[data-sidebar-body]");
	if (!root || !body) return;

	body.innerHTML = mgRenderLeftSidebarContent(mgActiveSidebarTab);
	mgBindLeftSidebarContent(root, mgActiveSidebarTab);
}

globalThis.mgRefreshLeftSidebarContent = mgRefreshLeftSidebarContent;

function mgOpenActorSheetTab(actor, tabId) {
	if (!actor) return;

	actor.sheet?.render(true, { focus: true });

	window.setTimeout(() => {
		const sheetEl = actor.sheet?.element?.[0] ?? actor.sheet?.element;
		const tabButton = sheetEl?.querySelector?.(`nav.sheet-tabs [data-tab="${mgCssEscape(tabId)}"]`);
		if (tabButton) tabButton.click();
	}, 100);
}

function mgRefreshClocksSidebarContent() {
	if (mgActiveSidebarTab === "clocks") mgRefreshLeftSidebarContent();
}

globalThis.mgRefreshClocksSidebarContent = mgRefreshClocksSidebarContent;

/* Scene sidebar refresh
----------------------------------------------------------------------*/
function mgRefreshScenesSidebarContent() {
	if (mgActiveSidebarTab !== "scenes") return;
	mgSceneViewerSignature = mgGetSceneViewerSignature();
	mgRefreshLeftSidebarContent();
}

globalThis.mgRefreshScenesSidebarContent = mgRefreshScenesSidebarContent;

/* Actor sidebar refresh
----------------------------------------------------------------------*/
function mgRefreshActorsSidebarContent() {
	if (mgActiveSidebarTab !== "actors") return;
	mgRefreshLeftSidebarContent();
}

globalThis.mgRefreshActorsSidebarContent = mgRefreshActorsSidebarContent;

/* Item sidebar refresh
----------------------------------------------------------------------*/
function mgRefreshItemsSidebarContent() {
	if (mgActiveSidebarTab !== "items") return;
	mgRefreshLeftSidebarContent();
}

globalThis.mgRefreshItemsSidebarContent = mgRefreshItemsSidebarContent;

/* Journal sidebar refresh
----------------------------------------------------------------------*/
function mgRefreshJournalSidebarContent() {
	if (mgActiveSidebarTab !== "journal") return;
	mgRefreshLeftSidebarContent();
}

globalThis.mgRefreshJournalSidebarContent = mgRefreshJournalSidebarContent;

/* Compendium sidebar refresh
----------------------------------------------------------------------*/
function mgRefreshCompendiumSidebarContent() {
	if (mgActiveSidebarTab !== "compendiums") return;
	mgRefreshLeftSidebarContent();
}

globalThis.mgRefreshCompendiumSidebarContent = mgRefreshCompendiumSidebarContent;

/* Playlist sidebar refresh
----------------------------------------------------------------------*/
function mgRefreshPlaylistSidebarContent() {
	if (mgActiveSidebarTab !== "playlists") return;
	mgRefreshLeftSidebarContent();
}

globalThis.mgRefreshPlaylistSidebarContent = mgRefreshPlaylistSidebarContent;

function mgRefreshGmSidebarContent() {
	if (mgActiveSidebarTab !== "gm") return;
	mgRefreshLeftSidebarContent();
}

globalThis.mgRefreshGmSidebarContent = mgRefreshGmSidebarContent;

function mgRefreshCharacterSidebarActor(actorId) {
	const root = document.getElementById(MG_UI_ID);
	const panel = root?.querySelector(`[data-mg-character-sidebar="${mgCssEscape(actorId ?? "")}"]`);
	const actor = actorId ? game.actors.get(actorId) : null;
	if (!root || !panel || !actor) return false;

	const wrapper = document.createElement("div");
	wrapper.innerHTML = mgRenderCharacterSidebar(actor);
	const nextPanel = wrapper.firstElementChild;
	if (!nextPanel) return false;

	panel.replaceWith(nextPanel);
	mgBindCharacterSidebarContent(root);
	mgBindLeftSidebarAccordions(root);
	return true;
}

globalThis.mgRefreshCharacterSidebarActor = mgRefreshCharacterSidebarActor;

function mgBindCharacterSidebarContent(root) {
	const actor = mgGetCharacterSidebarActor(root);
	if (!actor) return;

	root.querySelectorAll("[data-mg-roll-attribute]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			await mgRollAttribute(actor, button.dataset.mgRollAttribute);
		});

		button.addEventListener("contextmenu", async event => {
			event.preventDefault();
			await mgEditActorStat(actor, "attribute", button.dataset.mgRollAttribute, button);
		});
	});

	root.querySelectorAll("[data-mg-roll-skill]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			await mgRollSkill(actor, button.dataset.mgRollSkill);
		});

		button.addEventListener("contextmenu", async event => {
			event.preventDefault();
			await mgEditActorStat(actor, "skill", button.dataset.mgRollSkill, button);
		});
	});

	root.querySelectorAll("[data-mg-resource-dot]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			await mgHandleResourceDot(actor, button.dataset.mgResourceDot, Number(button.dataset.value));
		});
	});

	root.querySelectorAll("[data-mg-strain-dot]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			await mgHandleStrainDot(actor, button.dataset.mgStrainDot, Number(button.dataset.value));
		});
	});

	root.querySelectorAll("[data-mg-cap-tick]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			await mgHandleCapacityTick(actor, button.dataset.mgCapTick, Number(button.dataset.dir));
		});
	});

	root.querySelectorAll("[data-mg-capacity-set]").forEach(element => {
		element.addEventListener("contextmenu", async event => {
			event.preventDefault();
			event.stopPropagation();
			await mgSetExactCapacity(actor, element.dataset.mgCapacitySet);
		});
	});

	root.querySelector("[data-mg-temp-skill-bonuses]")?.addEventListener("click", () => {
		const sheet = actor.sheet;
		if (typeof sheet?._mgOpenTempSkillBonusesDialog === "function") {
			sheet._mgOpenTempSkillBonusesDialog();
			return;
		}

		actor.sheet?.render(true, { focus: true });
	});

	root.querySelector("[data-mg-edge-toggle]")?.addEventListener("click", async event => {
		event.preventDefault();

		const next = !actor.system?.edgeNext;
		await actor.update({ "system.edgeNext": next }, { render: false });
		mgRefreshCharacterEdgeButtons(actor, next);
	});

	mgBindCharacterSidebarItemSeeAll(root);
}

function mgBindCharacterSidebarItemSeeAll(root) {
	const panel = root?.querySelector("[data-mg-character-sidebar]");
	if (!panel) return;

	const DEFAULT_CAP = 335;

	const refreshCard = card => {
		const toggle = card?.querySelector?.(".mg-sidebar-item-toggle");
		if (!card || !toggle) return;

		const cap = Number(card.dataset.seeallCap) || DEFAULT_CAP;
		const expanded = card.classList.contains("expanded");

		card.style.maxHeight = "none";
		const fullHeight = Math.ceil(card.scrollHeight);
		const overflows = fullHeight > cap + 4;

		toggle.hidden = !overflows;
		card.classList.toggle("short", !overflows);

		if (!overflows) {
			card.classList.remove("expanded", "is-transitioning");
			card.style.maxHeight = "none";
			toggle.setAttribute("aria-expanded", "false");
			toggle.querySelector("i")?.classList.remove("rotated");
			return;
		}

		card.classList.remove("is-transitioning");
		card.style.maxHeight = expanded ? `${fullHeight}px` : `${cap}px`;
		toggle.setAttribute("aria-expanded", String(expanded));
		toggle.querySelector("i")?.classList.toggle("rotated", expanded);
	};

	panel.querySelectorAll(".mg-sidebar-item").forEach(refreshCard);

	if (panel.dataset.mgSidebarItemSeeAllBound === "true") return;
	panel.dataset.mgSidebarItemSeeAllBound = "true";

	panel.addEventListener("click", event => {
		const toggle = event.target.closest(".mg-sidebar-item-toggle");
		if (!toggle || !panel.contains(toggle)) return;

		event.preventDefault();
		event.stopPropagation();

		const card = toggle.closest(".mg-sidebar-item");
		if (!card) return;

		const cap = Number(card.dataset.seeallCap) || DEFAULT_CAP;
		const expanding = !card.classList.contains("expanded");
		const startHeight = Math.ceil(card.getBoundingClientRect().height) || cap;

		if (card._mgSidebarItemSeeAllEnd) {
			card.removeEventListener("transitionend", card._mgSidebarItemSeeAllEnd);
			card._mgSidebarItemSeeAllEnd = null;
		}

		if (card._mgSidebarItemSeeAllTimer) {
			window.clearTimeout(card._mgSidebarItemSeeAllTimer);
			card._mgSidebarItemSeeAllTimer = null;
		}

		card.style.maxHeight = `${startHeight}px`;
		card.classList.add("is-transitioning");
		card.classList.toggle("expanded", expanding);
		toggle.setAttribute("aria-expanded", String(expanding));
		toggle.querySelector("i")?.classList.toggle("rotated", expanding);

		requestAnimationFrame(() => {
			const targetHeight = expanding ? Math.ceil(card.scrollHeight) : cap;
			card.style.maxHeight = `${targetHeight}px`;
		});

		card._mgSidebarItemSeeAllEnd = transitionEvent => {
			if (transitionEvent.target !== card || transitionEvent.propertyName !== "max-height") return;

			card.removeEventListener("transitionend", card._mgSidebarItemSeeAllEnd);
			card._mgSidebarItemSeeAllEnd = null;

			if (card._mgSidebarItemSeeAllTimer) {
				window.clearTimeout(card._mgSidebarItemSeeAllTimer);
				card._mgSidebarItemSeeAllTimer = null;
			}

			card.classList.remove("is-transitioning");
			card.style.maxHeight = expanding ? `${Math.ceil(card.scrollHeight)}px` : `${cap}px`;
		};

		card.addEventListener("transitionend", card._mgSidebarItemSeeAllEnd);
		card._mgSidebarItemSeeAllTimer = window.setTimeout(() => {
			if (!card._mgSidebarItemSeeAllEnd) return;
			card._mgSidebarItemSeeAllEnd({ target: card, propertyName: "max-height" });
		}, 650);
	});
}

function mgRefreshCharacterEdgeButtons(actor, forcedState = null) {
	if (!actor) return;
	const active = forcedState ?? !!actor.system?.edgeNext;

	document.querySelectorAll(`[data-mg-edge-toggle="${actor.id}"]`).forEach(button => {
		button.classList.toggle("is-active", active);
		button.setAttribute("aria-pressed", String(active));
	});

	try {
		const sheetButtons = actor.sheet?.element?.find
			? actor.sheet.element.find(".mg-edge-toggle")
			: null;

		sheetButtons?.toggleClass?.("is-active", active);
	} catch (_) {
		// Sheet may not be rendered; the actor flag is still the source of truth.
	}
}

async function mgRollAttribute(actor, attrKey) {
	if (!actor || !attrKey) return;

	const baseAttrMod = Number(actor.system?.attributes?.[attrKey] ?? 0);
	const tempAttrMod = Number(actor.system?.tempAttributeBonuses?.[attrKey] ?? 0);
	const aura = mgGetActiveAuraPenalty(attrKey);
	const auraAttrMod = Number(aura.value ?? 0);
	const difficultyMod = mgGetDifficultyModifier();
	const finalAttrMod = baseAttrMod + tempAttrMod;
	const strainEffects = mgGetStrainRollEffects(actor, attrKey);
	if (strainEffects.out) {
		ui.notifications?.warn(`${mgCapitalize(attrKey)} is unavailable at ${strainEffects.track} ${strainEffects.tree} track.`);
		return;
	}

	const strainedAttrMod = mgApplyStrainAttributePenalty(finalAttrMod, strainEffects);
	const pool = 2 + Math.abs(strainedAttrMod);
	const rollType = strainedAttrMod >= 0 ? "kh2" : "kl2";
	const edge = !!actor.system?.edgeNext;

	await evaluateRoll({
		formula: `${pool}d6${rollType}`,
		skillMod: auraAttrMod + difficultyMod,
		modifierParts: [auraAttrMod, difficultyMod],
		modifierBreakdown: [
			{
				key: "aura",
				label: aura.label || "Aura Modifier",
				icon: "fa-eye-evil",
				value: auraAttrMod
			},
			{
				key: "difficulty",
				label: "Difficulty",
				icon: "fa-camera-movie",
				value: difficultyMod
			}
		],
		label: `Attr Roll: ${mgCapitalize(attrKey)}`,
		actor,
		edge,
		auraLabel: aura.label,
		auraAttrMod,
		auraSourceActorId: aura.sourceActorId,
		auraSourceTokenId: aura.sourceTokenId,
		auraIconClass: "fa-eye-evil",
		strainEffects
	});

	if (edge) {
		await actor.update({ "system.edgeNext": false }, { render: false });
		mgRefreshCharacterEdgeButtons(actor, false);
	}
}

async function mgRollNpcAttribute(actor, attrKey) {
	if (!actor || actor.type !== "npc" || !attrKey) return;

	const attrMod = Number(actor.system?.attributes?.[attrKey] ?? actor.system?.baseAttributes?.[attrKey] ?? 0) || 0;
	const pool = 2 + Math.abs(attrMod);
	const rollType = attrMod >= 0 ? "kh2" : "kl2";

	await evaluateRoll({
		formula: `${pool}d6${rollType}`,
		label: `NPC Attribute Roll: ${mgCapitalize(attrKey)}`,
		actor
	});
}

async function mgRollSkill(actor, skillKey) {
	if (!actor || !skillKey) return;
	if (skillKey === "spark" && !mgActorHasSpark(actor)) {
		ui.notifications?.warn("This character does not have access to Spark.");
		return;
	}

	const baseSkillMod = Number(actor.system?.skills?.[skillKey] ?? 0);
	const tempSkillMod = Number(actor.system?.tempSkillBonuses?.[skillKey] ?? 0);
	let attrKey = MG_SKILL_ATTRIBUTE_MAP[skillKey] ?? "guile";
	if (skillKey === "spark") attrKey = actor.system?.sparkAttribute ?? "guile";

	const baseAttrMod = Number(actor.system?.attributes?.[attrKey] ?? 0);
	const tempAttrMod = Number(actor.system?.tempAttributeBonuses?.[attrKey] ?? 0);
	const aura = mgGetActiveAuraPenalty(attrKey);
	const auraAttrMod = Number(aura.value ?? 0);
	const difficultyMod = mgGetDifficultyModifier();
	const finalAttrMod = baseAttrMod + tempAttrMod;
	const finalSkillMod = baseSkillMod + tempSkillMod + auraAttrMod + difficultyMod;
	const strainEffects = mgGetStrainRollEffects(actor, attrKey);
	if (strainEffects.out) {
		ui.notifications?.warn(`${MG_SKILL_LABELS[skillKey] ?? skillKey} is unavailable at ${strainEffects.track} ${strainEffects.tree} track.`);
		return;
	}

	const strainedAttrMod = mgApplyStrainAttributePenalty(finalAttrMod, strainEffects);
	const pool = 2 + Math.abs(strainedAttrMod);
	const rollType = strainedAttrMod >= 0 ? "kh2" : "kl2";
	const edge = !!actor.system?.edgeNext;

	await evaluateRoll({
		formula: `${pool}d6${rollType}`,
		skillMod: finalSkillMod,
		modifierParts: [baseSkillMod, tempSkillMod, auraAttrMod, difficultyMod],
		modifierBreakdown: [
			{ key: "skill", label: "Skill Bonus", icon: "fa-user-plus", value: baseSkillMod },
			{ key: "temp", label: "Temporary Bonus", icon: "fa-handshake-angle", value: tempSkillMod },
			{ key: "aura", label: aura.label || "Aura Modifier", icon: "fa-eye-evil", value: auraAttrMod },
			{ key: "difficulty", label: "Difficulty", icon: "fa-camera-movie", value: difficultyMod }
		],
		label: `Skill Roll: ${MG_SKILL_LABELS[skillKey] ?? skillKey}`,
		actor,
		edge,
		auraLabel: aura.label,
		auraAttrMod,
		auraSourceActorId: aura.sourceActorId,
		auraSourceTokenId: aura.sourceTokenId,
		strainEffects
	});

	if (edge) {
		await actor.update({ "system.edgeNext": false }, { render: false });
		mgRefreshCharacterEdgeButtons(actor, false);
	}
}

async function mgEditActorStat(actor, type, key, button) {
	if (!actor || !key) return;

	const current = mgClampStatValue(button?.dataset?.base ?? (
		type === "attribute"
			? actor.system?.baseAttributes?.[key] ?? actor.system?.attributes?.[key]
			: actor.system?.skills?.[key]
	));
	const label = type === "attribute" ? mgCapitalize(key) : (MG_SKILL_LABELS[key] ?? key);
	const next = await mgOpenStatPicker(`Edit ${label}`, current);
	if (next === null) return;

	const value = mgClampStatValue(next);
	const path = type === "attribute" ? `system.baseAttributes.${key}` : `system.skills.${key}`;
	await actor.update({ [path]: value }, { render: false });
	mgRefreshLeftSidebarContent();
}

async function mgOpenStatPicker(title, current) {
	return new Promise(resolve => {
		let settled = false;
		const choices = [-3, -2, -1, 0, 1, 2, 3];
		const dlg = new Dialog({
			title,
			content: `
				<div class="mg-stat-picker">
					${choices.map(value => `
						<button class="mg-stat-choice ${value === current ? "selected" : ""}" type="button" data-value="${value}" aria-pressed="${value === current ? "true" : "false"}">
							${mgSigned(value)}
						</button>
					`).join("")}
				</div>
			`,
			buttons: {
				cancel: {
					label: "Cancel",
					callback: () => {
						settled = true;
						resolve(null);
					}
				}
			},
			close: () => {
				if (!settled) resolve(null);
			},
			render: html => {
				html.find("[data-value]").on("click", event => {
					settled = true;
					const value = Number(event.currentTarget.dataset.value);
					dlg.close();
					resolve(value);
				});
			}
		});
		dlg.render(true);
	});
}

async function mgHandleResourceDot(actor, resource, clicked) {
	if (!actor || !Number.isFinite(clicked)) return;

	if (resource === "risk") {
		const total = Number(actor.system?.riskDice ?? 5) || 0;
		const used = Number(actor.system?.riskUsed ?? 0) || 0;
		const remaining = total - used;
		const nextUsed = clicked > remaining ? total - clicked : total - (clicked - 1);
		await actor.update({ "system.riskUsed": Math.max(0, Math.min(total, nextUsed)) });
		return;
	}

	if (resource === "sto") {
		const current = Number(actor.system?.sto?.value ?? 0) || 0;
		const next = clicked <= current ? clicked - 1 : clicked;
		await actor.update({ "system.sto.value": Math.max(0, next) }, { render: false });
		mgRefreshLeftSidebarContent();
		return;
	}

	if (resource === "spark") {
		const total = Number(actor.system?.sparkSlots ?? 0) || 0;
		const used = Number(actor.system?.sparkUsed ?? 0) || 0;
		const remaining = total - used;
		const nextUsed = clicked > remaining ? total - clicked : total - (clicked - 1);
		const clamped = Math.max(0, Math.min(total, nextUsed));
		const spent = clamped > used;

		await actor.update({ "system.sparkUsed": clamped });

		if (spent) {
			ChatMessage.create({
				user: game.user.id,
				speaker: ChatMessage.getSpeaker({ actor }),
				content: `<div class="chat-move"><h2><i class="fa-kit fa-spark"></i> Spark has been used!</h2></div>`
			});
		}
	}
}

async function mgHandleStrainDot(actor, type, clicked) {
	if (!actor || !type || !Number.isFinite(clicked)) return;
	const current = Number(actor.system?.strain?.[type] ?? 0) || 0;
	const next = clicked <= current ? clicked - 1 : clicked;
	await actor.update({ [`system.strain.${type}`]: Math.max(0, Math.min(5, next)) }, { render: false });
	mgRefreshLeftSidebarContent();
}

async function mgHandleCapacityTick(actor, type, dir) {
	if (!actor || !type || !dir) return;

	const capKey = `${type} capacity`;
	const current = Number(actor.system?.strain?.[capKey] ?? 0) || 0;
	const track = Number(actor.system?.strain?.[type] ?? 0) || 0;
	const max = Number(actor.system?.strain?.maxCapacity?.[type] ?? current) || current;
	const updates = {};

	if (dir < 0) {
		if (current > 0) {
			updates[`system.strain.${capKey}`] = Math.max(0, current - 1);
		} else {
			updates[`system.strain.${type}`] = Math.min(5, track + 1);
		}
	} else if (current >= max) {
		const temp = Number(actor.system?.strain?.tempBonus?.[type] ?? 0) || 0;
		updates[`system.strain.tempBonus.${type}`] = temp + 1;
		updates[`system.strain.maxCapacity.${type}`] = current + 1;
		updates[`system.strain.${capKey}`] = current + 1;
	} else {
		updates[`system.strain.${capKey}`] = Math.min(max, current + 1);
	}

	await actor.update(updates, { render: false });
	mgRefreshLeftSidebarContent();
}

async function mgSetExactCapacity(actor, type) {
	if (!actor || !["mortal", "soul"].includes(type)) return;

	const capKey = `${type} capacity`;
	const currentCap = Number(actor.system?.strain?.[capKey] ?? 0);
	const currentMax = Number(actor.system?.strain?.maxCapacity?.[type] ?? currentCap);
	const label = type === "mortal" ? "Mortal Capacity" : "Soul Capacity";
	const sheet = actor.sheet;

	const bodyHtml = `
		<div class="form-group">
			<label>${label}</label>
			<input type="number" name="value" value="${currentCap}" min="0" step="1" />
		</div>
		<p class="notes">
			Current max: <strong>${currentMax}</strong>. Entering a higher number will add temporary capacity.
		</p>
	`;

	const val = typeof sheet?._mgPrompt === "function"
		? await sheet._mgPrompt({
			title: `Set ${label}`,
			bodyHtml,
			okText: "Save",
			okIcon: "fa-floppy-disk",
			cancelText: "Cancel",
			cancelIcon: "fa-circle-xmark",
			getValue: html => html.find('input[name="value"]').val()
		})
		: await Dialog.wait({
			title: `Set ${label}`,
			content: `<h2 class="modal-headline">Set ${label}</h2>${bodyHtml}`,
			buttons: {
				ok: { label: "Save", callback: html => $(html).find('input[name="value"]').val() },
				cancel: { label: "Cancel", callback: () => null }
			},
			default: "ok"
		});

	if (val === null) return;

	const nextCap = Math.max(0, Math.floor(Number(val)));
	if (!Number.isFinite(nextCap)) {
		ui.notifications?.warn("Please enter a valid capacity number.");
		return;
	}

	const updates = {
		[`system.strain.${capKey}`]: nextCap,
		[`system.strain.manualOverride.${capKey}`]: true
	};

	if (nextCap > currentMax) {
		const currentTemp = Number(actor.system?.strain?.tempBonus?.[type] ?? 0);
		const extraNeeded = nextCap - currentMax;

		updates[`system.strain.tempBonus.${type}`] = currentTemp + extraNeeded;
		updates[`system.strain.maxCapacity.${type}`] = nextCap;
	}

	await actor.update(updates, { render: false });
	mgRefreshLeftSidebarContent();
	actor.sheet?.render?.(false);
}

function mgRenderPlayersSidebarContent() {
	return `
		<section class="mg-left-section mg-left-players-section">
			<div class="mg-left-players-dock" data-mg-players-dock>
				<div class="mg-left-empty">
					<i class="fa-solid fa-user-group"></i>
					<p>Loading players...</p>
				</div>
			</div>
		</section>
	`;
}

function mgDockFoundryPlayersBox(root = document.getElementById(MG_UI_ID)) {
	const dock = root?.querySelector("[data-mg-players-dock]");
	if (!dock) return;

	let players = document.getElementById("players");

	if (!players) {
		ui.players?.render?.(true);
		window.setTimeout(() => mgDockFoundryPlayersBox(root), 50);
		return;
	}

	if (!mgPlayersOriginalParent && players.parentElement !== dock) {
		mgPlayersOriginalParent = players.parentElement;
		mgPlayersOriginalNextSibling = players.nextSibling;
	}

	players.classList.add("mg-players-docked");
	dock.innerHTML = "";
	dock.appendChild(players);
}

function mgUndockFoundryPlayersBox() {
	const players = document.getElementById("players");
	if (!players?.classList.contains("mg-players-docked")) return;

	players.classList.remove("mg-players-docked");

	if (mgPlayersOriginalParent?.isConnected) {
		if (mgPlayersOriginalNextSibling?.parentElement === mgPlayersOriginalParent) {
			mgPlayersOriginalParent.insertBefore(players, mgPlayersOriginalNextSibling);
		} else {
			mgPlayersOriginalParent.appendChild(players);
		}
	} else {
		document.body.appendChild(players);
	}
}

function mgRefreshDockedPlayersBox() {
	if (mgActiveSidebarTab !== "players") return;
	window.setTimeout(() => mgDockFoundryPlayersBox(), 0);
}

function mgRenderPlayerSidebarContent() {
	const actor = game.user?.character;

	if (!actor) {
		return `
			<div class="mg-left-empty character-empty">
				<i class="fa-solid fa-user"></i>
				<h2>No character selected</h2>
				<p>Head to the Players tab, right click yourself, and select character to use this sidebar.</p>
			</div>
		`;
	}

	return mgRenderCharacterSidebar(actor);
}

/* Character sidebar rendering
----------------------------------------------------------------------*/
function mgRenderCharacterSidebar(actor) {
	const img = mgGetActorPlacementImage(actor, "sidebar");
	const cropStyle = mgGetSidebarCropStyle(actor);
	const cropVariables = mgGetSidebarCropVariables(actor);
	const guiseName = mgResolveGuiseName(actor);
	const crewName = mgResolveCrewName(actor);
	const strain = actor.system?.strain ?? {};
	const mortalCap = Number(strain["mortal capacity"] ?? 0) || 0;
	const soulCap = Number(strain["soul capacity"] ?? 0) || 0;
	const mortalTrack = Number(strain.mortal ?? 0) || 0;
	const soulTrack = Number(strain.soul ?? 0) || 0;
	const riskDice = Number(actor.system?.riskDice ?? 5) || 0;
	const riskUsed = Number(actor.system?.riskUsed ?? 0) || 0;
	const riskRemaining = Math.max(0, riskDice - riskUsed);
	const stoValue = Number(actor.system?.sto?.value ?? 0) || 0;
	const stoDisplayMax = Math.max(6, stoValue);
	const sparkSlots = Number(actor.system?.sparkSlots ?? 0) || 0;
	const sparkUsed = Number(actor.system?.sparkUsed ?? 0) || 0;
	const sparkRemaining = Math.max(0, sparkSlots - sparkUsed);
	const hasSpark = mgActorHasSpark(actor);
	const sparkSchools = mgGetSparkSchools(actor);
	const sparkSchoolBlocks = sparkSchools.length
		? `
			<div class="spark-school-reminders" aria-label="Spark Schools">
				<div class="spark-school-list">
					${sparkSchools.map(school => `<span class="spark-school-block">${mgEsc(school)}</span>`).join("")}
				</div>
			</div>
		`
		: "";

	const resourcesBody = `
		<div class="resource-stack">
			<div class="resource-card">
				<label>Risk</label>
				${mgRenderIconTrack({
					kind: "risk",
					total: riskDice,
					filled: riskRemaining,
					dataAttr: 'data-mg-resource-dot="risk"'
				})}
			</div>

			<div class="resource-card">
				<label>STO</label>
				${mgRenderIconTrack({
					kind: "sto",
					total: stoDisplayMax,
					filled: stoValue,
					dataAttr: 'data-mg-resource-dot="sto"'
				})}
			</div>

			${hasSpark ? `<div class="resource-card">
				<label>Slots</label>
				${mgRenderIconTrack({
					kind: "spark",
					total: sparkSlots,
					filled: sparkRemaining,
					dataAttr: 'data-mg-resource-dot="spark"'
				})}
			</div>` : ""}
		</div>
	`;

	const attributesBody = `
		<div class="attribute-actions">
			<button
				type="button"
				class="edge-toggle ${actor.system?.edgeNext ? "is-active" : ""}"
				data-mg-edge-toggle="${actor.id}"
				aria-pressed="${actor.system?.edgeNext ? "true" : "false"}"
				title="Edge: your next Skill or Attribute roll is rolled twice"
			>
				<i class="fa-solid fa-scythe"></i>
				Edge
			</button>

			<button type="button" class="temp-bonuses" data-mg-temp-skill-bonuses>
				<i class="fa-solid fa-handshake-angle"></i>
				Temp Bonuses
			</button>
		</div>

		<div class="attribute-stack">
			${MG_ATTRIBUTE_KEYS.map(attrKey => {
				const attrValue = Number(actor.system?.attributes?.[attrKey] ?? 0) || 0;
				const baseValue = Number(actor.system?.baseAttributes?.[attrKey] ?? attrValue) || 0;
				const tempValue = Number(actor.system?.tempAttributeBonuses?.[attrKey] ?? 0) || 0;
				const attrStrainEffects = mgGetStrainRollEffects(actor, attrKey);
				const attrStrainBadge = mgRenderStrainEffectBadge(attrStrainEffects);

				return `
					<div class="attribute-card" data-attr="${attrKey}">
						${attrStrainBadge}
						<div
							class="attribute-roll"
						>
							<span>${mgEsc(mgCapitalize(attrKey))}</span>
							<button
								type="button"
								class="roll-value attribute-container"
								data-mg-roll-attribute="${attrKey}"
								data-base="${baseValue}"
								title="Click to roll. Right-click to edit base Attribute."
							>${mgSigned(attrValue)} ${tempValue ? `<em>${mgSigned(tempValue)}</em>` : ""}</button>
						</div>

						<div class="skill-grid">
							${(MG_SKILL_BUCKETS[attrKey] ?? []).map(skillKey => {
								const skillValue = Number(actor.system?.skills?.[skillKey] ?? 0) || 0;
								const tempSkill = Number(actor.system?.tempSkillBonuses?.[skillKey] ?? 0) || 0;

								return `
									<div class="skill-roll">
										<span>${mgEsc(MG_SKILL_LABELS[skillKey] ?? skillKey)}</span>
										<button
											type="button"
											class="skill-container"
											data-mg-roll-skill="${skillKey}"
											data-base="${skillValue}"
											title="Click to roll. Right-click to edit base Skill."
										>${skillValue}${tempSkill ? `<em>${mgSigned(tempSkill)}</em>` : ""}</button>
									</div>
								`;
							}).join("")}
						</div>
					</div>
				`;
			}).join("")}
		</div>
	`;

	const sparkBody = `
		<div class="spark-stack">
			${sparkSchoolBlocks}

			<div class="spark-panel">
				<div class="attribute-roll spark-skill">
					<span>Spark</span>
					<button
						type="button"
						class="roll-value skill-container"
						data-mg-roll-skill="spark"
						data-base="${Number(actor.system?.skills?.spark ?? 0) || 0}"
						title="Click to roll. Right-click to edit base Skill."
					>${Number(actor.system?.skills?.spark ?? 0) || 0}</button>
				</div>

				${mgRenderIconTrack({
					kind: "spark",
					total: sparkSlots,
					filled: sparkRemaining,
					dataAttr: 'data-mg-resource-dot="spark"'
				})}
			</div>
		</div>
	`;

	const itemsBody = `
		<div class="mg-sidebar-items-head">
			<button
				type="button"
				class="mg-left-action mg-sidebar-open-inventory"
				data-mg-open-actor-tab="${actor.id}"
				data-mg-tab="inventory"
			>
				<i class="fa-solid fa-treasure-chest"></i>
				Open Inventory
			</button>
		</div>

		${mgRenderFavoriteSidebarItems(actor)}
	`;

	return `
		<section class="character-tab" data-mg-character-sidebar="${actor.id}">
			<header class="identity">
				<div class="character-name">
					<h3>${mgEsc(actor.name)}</h3>
				</div>

				<div class="character-crew">
					<p class="guise">${mgEsc(guiseName)}</p>
					<p class="crew">${mgEsc(crewName)}</p>
				</div>
			</header>

			<button
				type="button"
				class="open-sheet"
				data-mg-open-actor="${actor.id}"
				title="Open ${mgEsc(actor.name)} sheet"
			>
				Open Sheet
				<i class="fa-solid fa-up-right-from-square"></i>
			</button>

			<div class="portrait-crop mg-cropbox" ${cropStyle}>
				<img class="portrait-img" src="${mgEsc(img)}" alt="${mgEsc(actor.name)}" style="${cropVariables}" />
			</div>

			<div class="strain-stack">
				${mgRenderStrainRow("mortal", "MC", mortalCap, mortalTrack)}
				${mgRenderStrainRow("soul", "SC", soulCap, soulTrack)}
			</div>

			${mgRenderAccordion(actor, {
				id: "resources",
				title: "Resources",
				icon: "fa-kit fa-risk",
				open: true,
				body: resourcesBody
			})}

			${mgRenderAccordion(actor, {
				id: "attributes",
				title: "Skills & Attributes",
				icon: "fa-solid fa-user",
				open: true,
				body: attributesBody
			})}

			${hasSpark ? mgRenderAccordion(actor, {
				id: "spark",
				title: "Spark",
				icon: "fa-kit fa-spark",
				open: hasSpark,
				body: sparkBody
			}) : ""}

			${mgRenderAccordion(actor, {
				id: "items",
				title: "Items",
				icon: "fa-solid fa-treasure-chest",
				open: true,
				body: itemsBody
			})}
		</section>
	`;
}

/* Character sidebar strain rows
----------------------------------------------------------------------*/
function mgRenderStrainRow(type, label, cap, track) {
	return `
		<div class="strain-row" data-mg-strain-row="${type}">
			<div class="capacity-badge">
				<label data-mg-capacity-set="${type}" title="Right-click to set exact ${label}">${label}</label>
				<div class="capacity-controls" data-type="${type}">
					<button type="button" data-mg-cap-tick="${type}" data-dir="-1" aria-label="Decrease ${label}">
						<i class="fa-solid fa-minus"></i>
					</button>
					<span class="capacity-value" data-type="${type}" data-mg-capacity-set="${type}" title="Right-click to set exact ${label}">${cap}</span>
					<button type="button" data-mg-cap-tick="${type}" data-dir="1" aria-label="Increase ${label}">
						<i class="fa-solid fa-plus"></i>
					</button>
				</div>
			</div>

			${mgRenderIconTrack({
				kind: type,
				total: 5,
				filled: track,
				dataAttr: `data-mg-strain-dot="${type}"`
			})}
		</div>
	`;
}

/* Crew sidebar data resolution
----------------------------------------------------------------------*/
function mgResolveCrewForSidebar() {
	const crewId = (() => {
		try {
			return game.settings.get("midnight-gambit", "crewActorId");
		} catch (_) {
			return "";
		}
	})();

	if (crewId) {
		const crew = game.actors.get(crewId);
		if (crew) return crew;
	}

	return game.actors?.find(a => a.type === "crew") ?? null;
}

function mgResolveCrewTier(crew) {
	const flagVal = Number(crew?.getFlag?.("midnight-gambit", "crewTier"));
	if (Number.isFinite(flagVal) && flagVal >= 1) return Math.min(5, flagVal);

	const sysVal = Number(crew?.system?.tier);
	if (Number.isFinite(sysVal) && sysVal >= 1) return Math.min(5, sysVal);

	return 1;
}

function mgActorFromUuidSync(uuid) {
	if (!uuid) return null;

	if (typeof fromUuidSync === "function") {
		try {
			const doc = fromUuidSync(uuid);
			if (doc?.documentName === "Actor") return doc;
			if (doc?.actor?.documentName === "Actor") return doc.actor;
		} catch (_) {}
	}

	const match = String(uuid).match(/^Actor\.([^.]+)$/);
	return match ? game.actors?.get(match[1]) ?? null : null;
}

function mgResolveCrewMemberModels(crew) {
	const party = crew?.system?.party ?? {};
	const cache = party.cache ?? {};
	const memberUuids = Array.isArray(party.members) ? party.members : [];

	const members = memberUuids.map(uuid => {
		const actor = mgActorFromUuidSync(uuid);
		const cached = cache?.[uuid] ?? {};
		const strain = actor?.system?.strain ?? {};
		const riskDice = Number(actor?.system?.riskDice ?? 5) || 0;
		const riskUsed = Number(actor?.system?.riskUsed ?? 0) || 0;
		const stoValue = Number(actor?.system?.sto?.value ?? 0) || 0;
		const sparkSlots = Number(actor?.system?.sparkSlots ?? 0) || 0;
		const sparkUsed = Number(actor?.system?.sparkUsed ?? 0) || 0;
		const guiseNames = actor
			? mgResolveSidebarGuises(actor).map(guise => guise.name).filter(Boolean)
			: [];

		if (!guiseNames.length) {
			const fallbackGuise = actor ? mgResolveGuiseName(actor) : cached.className;
			if (fallbackGuise) guiseNames.push(fallbackGuise);
		}

		return {
			uuid,
			actor,
			actorId: actor?.id ?? null,
			name: actor?.name ?? cached.name ?? "Unknown",
			img: actor?.img ?? cached.img ?? "icons/svg/mystery-man.svg",
			crewSidebarImg: actor ? mgGetActorPlacementImage(actor, "crewSidebar") : (cached.img ?? "icons/svg/mystery-man.svg"),
			crewInitiativeImg: actor ? mgGetActorPlacementImage(actor, "crewInitiative") : (cached.img ?? "icons/svg/mystery-man.svg"),
			guiseText: guiseNames.length ? guiseNames.join(" / ") : "No Guise",
			levelText: Number.isFinite(Number(actor?.system?.level))
				? String(Number(actor.system.level))
				: (cached.level != null ? String(cached.level) : "-"),
			missing: !actor,
			mcCap: Number(strain["mortal capacity"] ?? 0) || 0,
			scCap: Number(strain["soul capacity"] ?? 0) || 0,
			mcTrk: Number(strain.mortal ?? 0) || 0,
			scTrk: Number(strain.soul ?? 0) || 0,
			riskRemaining: Math.max(0, riskDice - riskUsed),
			riskMax: riskDice,
			stoValue,
			sparkRemaining: Math.max(0, sparkSlots - sparkUsed),
			sparkMax: sparkSlots,
			hasSpark: actor ? mgActorHasSpark(actor) : sparkSlots > 0
		};
	});

	const initiative = crew?.system?.initiative ?? {};
	const order = Array.isArray(initiative.order) ? initiative.order : [];
	const hidden = Array.isArray(initiative.hidden) ? initiative.hidden : [];
	const byUuid = new Map(members.map(member => [member.uuid, member]));
	const ordered = [];
	const seen = new Set();

	order.forEach(uuid => {
		const member = byUuid.get(uuid);
		if (!member) return;
		ordered.push({ ...member, hidden: hidden.includes(uuid) });
		seen.add(uuid);
	});

	members.forEach(member => {
		if (!seen.has(member.uuid)) ordered.push({ ...member, hidden: hidden.includes(member.uuid) });
	});

	return { members, initiativeMembers: ordered };
}

/* Crew sidebar cards
----------------------------------------------------------------------*/
function mgRenderCrewStrainSummary(member, type, label, cap, track) {
	const icon = type === "mortal" ? "fa-kit fa-mortal-strain" : "fa-kit fa-soul-strain";

	return `
		<div class="strain" data-type="${type}">
			<div class="strain-cap">
				<span>${mgEsc(label)}</span>
				<strong>${Number(cap) || 0}</strong>
			</div>
			<div class="strain-track">
				<i class="${icon}"></i>
				<span>x${Number(track) || 0}</span>
			</div>
		</div>
	`;
}

function mgRenderCrewResourceSummary(kind, value, max = null) {
	const icon = kind === "risk"
		? "fa-kit fa-risk"
		: kind === "sto"
			? "fa-kit fa-sto"
			: "fa-kit fa-spark";
	const current = Number(value) || 0;
	const total = Number(max);
	const hasMax = Number.isFinite(total) && total > 0;
	const labels = {
		risk: "Risk",
		sto: "STO",
		spark: "Spark Slots"
	};
	const display = hasMax ? `${current}/${total}` : `x${current}`;
	const displayHtml = hasMax
		? `${mgEsc(current)}<span class="resource-max">/${mgEsc(total)}</span>`
		: `x${mgEsc(current)}`;
	const label = `${labels[kind] ?? mgCapitalize(kind)}: ${display}`;

	return `
		<div class="resource" data-type="${kind}" title="${mgEsc(label)}" aria-label="${mgEsc(label)}">
			<i class="${icon}"></i>
			<span>${displayHtml}</span>
		</div>
		`;
}

function mgRenderCrewPartyMember(member) {
	const hasCrop = mgHasActorCrop(member.actor, "crewSidebar");
	const cropVariables = hasCrop ? mgGetActorCropVariables(member.actor, "crewSidebar", [], { ignoreWidth: true }) : "";

	return `
		<article class="crew-card ${member.missing ? "is-missing" : ""}" data-uuid="${mgEsc(member.uuid)}">
			<header class="card-head">
					<h4>${mgEsc(member.name)}</h4>
					<p>${mgEsc(member.guiseText)} <span>Lv ${mgEsc(member.levelText)}</span></p>
			</header>

			<div class="card-main">
				<div class="crew-member-crop mg-cropbox ${hasCrop ? "is-cropped" : ""}">
					<img src="${mgEsc(member.crewSidebarImg || member.img)}" alt="${mgEsc(member.name)}" style="${cropVariables}" />
				</div>

				<div class="card-body">
					<div class="strains">
						${mgRenderCrewStrainSummary(member, "mortal", "MC", member.mcCap, member.mcTrk)}
						${mgRenderCrewStrainSummary(member, "soul", "SC", member.scCap, member.scTrk)}
					</div>

					<div class="resources">
						${mgRenderCrewResourceSummary("risk", member.riskRemaining, member.riskMax)}
						${mgRenderCrewResourceSummary("sto", member.stoValue)}
						${member.hasSpark ? mgRenderCrewResourceSummary("spark", member.sparkRemaining, member.sparkMax) : ""}
					</div>
				</div>
			</div>

			${member.actorId ? `
				<button type="button" class="sheet-action" data-mg-open-actor="${member.actorId}">
					Sheet
					<i class="fa-solid fa-up-right-from-square"></i>
				</button>
			` : ""}
		</article>
	`;
}

function mgRenderCrewInitiativeMember(member, canEdit) {
	const hasCrop = mgHasActorCrop(member.actor, "crewInitiative");
	const cropVariables = hasCrop ? mgGetActorCropVariables(member.actor, "crewInitiative", [], { ignoreWidth: true }) : "";

	return `
		<article
			class="initiative-card mg-init-card ${member.hidden ? "is-muted" : ""}"
			data-uuid="${mgEsc(member.uuid)}"
			data-hidden="${member.hidden ? "true" : "false"}"
			${canEdit ? 'draggable="true"' : ""}
		>
			<div class="crew-initiative-crop mg-cropbox ${hasCrop ? "is-cropped" : ""}">
				<img src="${mgEsc(member.crewInitiativeImg || member.img)}" alt="${mgEsc(member.name)}" style="${cropVariables}" />
			</div>

			<div class="initiative-main">
				<h4>${mgEsc(member.name)}</h4>
				<p>${mgEsc(member.guiseText)} <span>Lv ${mgEsc(member.levelText)}</span></p>
			</div>

			<div class="initiative-actions">
				<button
					type="button"
					class="initiative-eye mg-init-eye"
					data-mg-crew-init-eye
					title="${member.hidden ? "Include in Initiative" : "Hide from Initiative"}"
					${canEdit ? "" : "disabled"}
				>
					<i class="fa-regular ${member.hidden ? "fa-eye-slash" : "fa-eye"}"></i>
				</button>

				<button
					type="button"
					class="initiative-grip"
					data-mg-crew-init-grip
					title="Drag to reorder"
					${canEdit ? "" : "disabled"}
				>
					<i class="fa-solid fa-grip-lines"></i>
				</button>
			</div>
		</article>
	`;
}

/* Crew sidebar rendering
----------------------------------------------------------------------*/
function mgRenderCrewSidebarContent() {
	const crew = mgResolveCrewForSidebar();

	if (!crew) {
		return `
			<div class="mg-left-empty">
				<i class="fa-solid fa-users"></i>
				<p>No Crew actor found.</p>
			</div>
		`;
	}

	const img = crew.img || "systems/midnight-gambit/assets/images/mg-queen.png";
	const tier = mgResolveCrewTier(crew);
	const canEdit = true;
	const { members, initiativeMembers } = mgResolveCrewMemberModels(crew);
	const partyBody = members.length
		? members.map(mgRenderCrewPartyMember).join("")
		: `<div class="mg-left-empty"><p>No party members found.</p></div>`;
	const initiativeBody = `
		<div class="initiative" data-mg-crew-initiative="${crew.id}">
			${canEdit ? `
				<button type="button" class="mg-left-action apply-initiative" data-mg-crew-apply-initiative="${crew.id}">
					Apply Initiative
					<i class="fa-solid fa-link"></i>
				</button>
			` : `<p class="mg-left-empty">View-only initiative. Crew owners can reorder.</p>`}

			<div class="initiative-list" data-mg-crew-init-list>
				${initiativeMembers.length
					? initiativeMembers.map(member => mgRenderCrewInitiativeMember(member, canEdit)).join("")
					: `<div class="mg-left-empty"><p>No initiative members found.</p></div>`}
			</div>
		</div>
	`;

	return `
		<section class="crew-tab" data-mg-crew-sidebar="${crew.id}">
			<header class="identity">
				<h3>${mgEsc(crew.name)}</h3>
				<span>Tier ${tier}</span>
			</header>

			<button type="button" class="open-sheet" data-mg-open-actor="${crew.id}">
				Open Sheet
				<i class="fa-solid fa-up-right-from-square"></i>
			</button>			

			<img class="crew-img" src="${mgEsc(img)}" alt="${mgEsc(crew.name)}" />

			${mgRenderAccordion(crew, {
				id: "crew-party",
				title: "Party",
				icon: "fa-solid fa-users",
				open: true,
				body: partyBody
			})}

			${mgRenderAccordion(crew, {
				id: "crew-initiative",
				title: "Initiative",
				icon: "fa-solid fa-list-ol",
				open: false,
				body: initiativeBody
			})}
		</section>
	`;
}

/* Crew sidebar initiative actions
----------------------------------------------------------------------*/
async function mgApplyCrewSidebarInitiative(crew, root) {
	const list = root?.querySelector("[data-mg-crew-init-list]");
	const cards = Array.from(list?.querySelectorAll(".mg-init-card") ?? [])
		.filter(card => card.dataset.hidden !== "true");

	if (!cards.length) {
		ui.notifications?.warn("No visible members found in the Initiative list.");
		return;
	}

	const uuids = cards.map(card => card.dataset.uuid).filter(Boolean);
	const actorIds = uuids
		.map(uuid => mgActorFromUuidSync(uuid)?.id)
		.filter(Boolean);

	if (!actorIds.length) {
		ui.notifications?.error("Could not resolve actor IDs from the Initiative list.");
		return;
	}

	await MGInitiativeController.instance.applyOrder(crew, uuids, actorIds);

	ui.notifications?.info("Initiative order applied.");
}

async function mgToggleCrewSidebarInitiativeMember(crew, card) {
	const uuid = card?.dataset?.uuid;
	if (!uuid) return;

	const wasHidden = card.dataset.hidden === "true";
	const nowHidden = !wasHidden;
	card.dataset.hidden = String(nowHidden);
	card.classList.toggle("is-muted", nowHidden);

	const icon = card.querySelector("[data-mg-crew-init-eye] i");
	if (icon) icon.className = `fa-regular ${nowHidden ? "fa-eye-slash" : "fa-eye"}`;

	try {
		const prev = Array.isArray(crew.system?.initiative?.hidden)
			? crew.system.initiative.hidden.slice()
			: [];
		const set = new Set(prev);
		if (nowHidden) set.add(uuid);
		else set.delete(uuid);

		await new Promise(resolve => window.setTimeout(resolve, 500));
		await crew.update({ "system.initiative.hidden": Array.from(set) }, { render: false });
	} catch (err) {
		card.dataset.hidden = String(wasHidden);
		card.classList.toggle("is-muted", wasHidden);
		if (icon) icon.className = `fa-regular ${wasHidden ? "fa-eye-slash" : "fa-eye"}`;
		console.warn("MG UI | Crew sidebar initiative visibility failed.", err);
	}
}

/* Crew sidebar interactions
----------------------------------------------------------------------*/
function mgBindCrewSidebarContent(root) {
	const panel = root?.querySelector("[data-mg-crew-sidebar]");
	const crew = panel?.dataset?.mgCrewSidebar ? game.actors.get(panel.dataset.mgCrewSidebar) : null;
	if (!panel || !crew) return;

	if (panel.dataset.mgCrewSidebarBound !== "true") {
		panel.dataset.mgCrewSidebarBound = "true";

		panel.addEventListener("click", async event => {
			const actorButton = event.target.closest("[data-mg-open-actor]");
			if (actorButton && panel.contains(actorButton)) {
				event.preventDefault();
				const actor = game.actors.get(actorButton.dataset.mgOpenActor);
				actor?.sheet?.render(true, { focus: true });
				return;
			}

			const applyButton = event.target.closest("[data-mg-crew-apply-initiative]");
			if (applyButton && panel.contains(applyButton)) {
				event.preventDefault();
				await mgApplyCrewSidebarInitiative(crew, panel);
				return;
			}

			const eyeButton = event.target.closest("[data-mg-crew-init-eye]");
			if (!eyeButton || !panel.contains(eyeButton)) return;
			event.preventDefault();
			event.stopPropagation();
			await mgToggleCrewSidebarInitiativeMember(crew, eyeButton.closest(".mg-init-card"));
		});
	}

	mgBindCrewSidebarInitiativeDrag(panel, crew);
}

/* Crew sidebar initiative drag and drop
----------------------------------------------------------------------*/
function mgBindCrewSidebarInitiativeDrag(panel, crew) {
	const list = panel?.querySelector("[data-mg-crew-init-list]");
	if (!list) return;
	if (list.dataset.mgCrewDragBound === "true") return;
	list.dataset.mgCrewDragBound = "true";

	let dragEl = null;
	const placeholder = document.createElement("div");
	placeholder.className = "mg-init-placeholder";

	list.querySelectorAll(".mg-init-card").forEach(card => {
		card.setAttribute("draggable", "true");
	});

	list.addEventListener("dragstart", event => {
		const card = event.target?.closest?.(".mg-init-card");
		if (!card || !list.contains(card)) return;
		dragEl = card;
		card.classList.add("mg-dragging");
		event.dataTransfer?.setData("text/plain", card.dataset.uuid ?? "");
		event.dataTransfer?.setDragImage?.(card, 16, 16);
		card.after(placeholder);
	});

	list.addEventListener("dragover", event => {
		const target = event.target?.closest?.(".mg-init-card, .mg-init-placeholder");
		if (!target || !list.contains(target)) return;
		event.preventDefault();

		const refEl = target.classList.contains("mg-init-placeholder") ? placeholder : target;
		const bounds = refEl.getBoundingClientRect();
		const midY = bounds.top + bounds.height / 2;
		if (event.clientY < midY) list.insertBefore(placeholder, refEl);
		else list.insertBefore(placeholder, refEl.nextSibling);
	});

	const finalize = async () => {
		if (!dragEl) return;
		if (placeholder.parentElement) placeholder.parentElement.insertBefore(dragEl, placeholder);
		placeholder.remove();
		dragEl.classList.remove("mg-dragging");
		dragEl = null;

		const newOrder = Array.from(list.querySelectorAll(".mg-init-card"))
			.map(card => card.dataset.uuid)
			.filter(Boolean);

		try {
			await crew.update({ "system.initiative.order": newOrder }, { render: false });
		} catch (err) {
			console.warn("MG UI | Crew sidebar initiative reorder failed.", err);
			mgRefreshLeftSidebarContent();
		}
	};

	list.addEventListener("drop", async event => {
		event.preventDefault();
		await finalize();
	});

	list.addEventListener("dragend", async event => {
		event.preventDefault();
		await finalize();
	});
}

function mgCrewSidebarContainsActor(crew, actor) {
	if (!crew || !actor) return false;
	if (crew.id === actor.id) return true;

	const members = Array.isArray(crew.system?.party?.members) ? crew.system.party.members : [];
	return members.includes(actor.uuid) || members.includes(`Actor.${actor.id}`);
}

function mgRefreshCrewSidebarForActor(actor) {
	if (mgActiveSidebarTab !== "crew") return;
	const crew = mgResolveCrewForSidebar();
	if (mgCrewSidebarContainsActor(crew, actor)) mgRefreshLeftSidebarContent();
}

/* Clock sidebar rendering
----------------------------------------------------------------------*/
function mgRenderClockSidebarList(scope) {
	const clocks = game.mgClocks?.getList?.(scope) ?? [];
	const empty = scope === "global" ? "No global clocks." : "No scene clocks.";
	const clearButton = game.user.isGM && clocks.length ? `
		<button type="button" class="mg-left-action mg-clock-clear-section" data-mg-clock-clear="${scope}">
			<i class="fa-solid fa-clock-rotate-left"></i>
			Clear Clocks
		</button>
	` : "";

	return `
		<div class="mg-clock-sidebar-list" data-mg-clock-sidebar-list="${scope}">
			${clearButton}
			${clocks.length ? clocks.map(clock => `
				<div
					class="mg-clock-sidebar-slot"
					data-mg-clock-slot="${clock.id}"
					draggable="true"
				></div>
			`).join("") : `<div class="mg-left-empty mg-clock-empty">${empty}</div>`}
		</div>
	`;
}

function mgRenderClocksSidebarContent() {
	const controls = game.user.isGM ? `
		<section class="mg-clock-sidebar-actions">
			<button type="button" class="mg-left-action" data-mg-clock-add="global">
				<i class="fa-solid fa-globe"></i>
				Add Global
			</button>
			<button type="button" class="mg-left-action" data-mg-clock-add="scene">
				<i class="fa-solid fa-map"></i>
				Add Scene
			</button>
			<button type="button" class="mg-left-action" data-mg-clock-toggle-hidden>
				<i class="${game.mgClocks?.areHidden?.() ? "fa-solid fa-eye" : "fa-solid fa-eye-slash"}"></i>
				${game.mgClocks?.areHidden?.() ? "Show Overlay" : "Hide Overlay"}
			</button>
		</section>
	` : `
		<section class="mg-clock-sidebar-actions">
			<button type="button" class="mg-left-action" data-mg-clock-toggle-hidden>
				<i class="${game.mgClocks?.areHidden?.() ? "fa-solid fa-eye" : "fa-solid fa-eye-slash"}"></i>
				${game.mgClocks?.areHidden?.() ? "Show Overlay" : "Hide Overlay"}
			</button>
		</section>
	`;

	return `
		<section class="mg-left-section mg-clock-sidebar">
			${controls}
			${mgRenderAccordion(null, {
				id: "clocks-global",
				title: "Global Clocks",
				icon: "fa-solid fa-globe",
				open: true,
				body: mgRenderClockSidebarList("global")
			})}
			${mgRenderAccordion(null, {
				id: "clocks-scene",
				title: "Scene Clocks",
				icon: "fa-solid fa-map",
				open: true,
				body: mgRenderClockSidebarList("scene")
			})}
		</section>
	`;
}

/* Clock sidebar interactions
----------------------------------------------------------------------*/
function mgBindClocksSidebarContent(root) {
	root.querySelectorAll("[data-mg-clock-add]").forEach(button => {
		button.addEventListener("click", async () => {
			await game.mgClocks?.createScoped?.(button.dataset.mgClockAdd);
			mgRefreshLeftSidebarContent();
		});
	});

	root.querySelector("[data-mg-clock-toggle-hidden]")?.addEventListener("click", async () => {
		await game.mgClocks?.toggleHidden?.();
		mgRefreshLeftSidebarContent();
	});

	root.querySelectorAll("[data-mg-clock-clear]").forEach(button => {
		button.addEventListener("click", async () => {
			await game.mgClocks?.clearScope?.(button.dataset.mgClockClear);
			mgRefreshLeftSidebarContent();
		});
	});

	root.querySelectorAll("[data-mg-clock-sidebar-list]").forEach(list => {
		const scope = list.dataset.mgClockSidebarList;
		list.querySelectorAll("[data-mg-clock-slot]").forEach(slot => {
			game.mgClocks?.renderSidebarClockInto?.(slot, slot.dataset.mgClockSlot, scope);
		});
		mgBindClockSidebarReorder(list, scope);
	});
}

function mgBindClockSidebarReorder(list, scope) {
	let dragging = null;

	list.querySelectorAll("[data-mg-clock-slot]").forEach(slot => {
		slot.addEventListener("dragstart", event => {
			dragging = slot;
			slot.classList.add("mg-dragging");
			event.dataTransfer?.setData("text/plain", slot.dataset.mgClockSlot || "");
			event.dataTransfer.effectAllowed = "move";
		});

		slot.addEventListener("dragend", async () => {
			if (dragging) dragging.classList.remove("mg-dragging");
			dragging = null;
			const ids = Array.from(list.querySelectorAll("[data-mg-clock-slot]"))
				.map(el => el.dataset.mgClockSlot)
				.filter(Boolean);
			await game.mgClocks?.saveOrder?.(scope, ids);
		});
	});

	list.addEventListener("dragover", event => {
		if (!dragging) return;
		event.preventDefault();
		const target = event.target.closest("[data-mg-clock-slot]");
		if (!target || target === dragging || target.parentElement !== list) return;
		const rect = target.getBoundingClientRect();
		const after = event.clientY > rect.top + rect.height / 2;
		list.insertBefore(dragging, after ? target.nextSibling : target);
	});
}

/* Scene sidebar rendering
----------------------------------------------------------------------*/
function mgRenderSceneSidebarContent() {
	const canManage = game.user?.isGM;
	const allScenes = Array.from(game.scenes ?? []);
	const scenes = allScenes
		.filter(scene => canManage || (scene.visible !== false && scene.navigation));
	const folderTree = mgBuildSceneFolderTree(scenes, { showAllFolders: canManage });
	const favoriteScenes = scenes.filter(scene => scene.getFlag?.(MG_UI_NS, MG_SCENE_FAVORITE_FLAG));
	const activeScene = allScenes.find(scene => scene.active) ?? null;

	const controls = canManage ? `
		<section class="mg-scene-directory-actions">
			<button type="button" class="mg-left-action" data-mg-scene-create>
				<i class="fa-solid fa-map"></i>
				Create Scene
			</button>
			<button type="button" class="mg-left-action" data-mg-scene-folder-create>
				<i class="fa-solid fa-folder"></i>
				Create Folder
			</button>
		</section>
	` : "";

	const search = `
		<label class="mg-scene-search">
			<i class="fa-solid fa-magnifying-glass"></i>
			<input type="search" placeholder="Search Scenes" data-mg-scene-search />
		</label>
	`;
	const collapseFolders = canManage ? `
		<button type="button" class="mg-left-action mg-scene-collapse-folders" data-mg-scene-collapse-folders>
			<i class="fa-solid fa-folder-tree"></i>
			Collapse Folders
		</button>
	` : "";
	const favorites = favoriteScenes.length ? mgRenderAccordion(null, {
		id: "scene-favorites",
		title: "Favorite Scenes",
		icon: "fa-solid fa-star",
		open: true,
		className: "mg-scene-favorites",
		attrs: "data-mg-scene-search-section data-mg-scene-favorites",
		body: `
			<div class="mg-scene-list">
				${favoriteScenes.map(scene => mgRenderSceneRow(scene, { favoriteList: true })).join("")}
			</div>
		`
	}) : "";

	if (!scenes.length) {
		return `
			<section class="mg-scene-directory">
				<div class="mg-scene-directory-header">
					${controls}
					${activeScene ? mgRenderActiveSceneBanner(activeScene) : ""}
					${favorites}
				</div>
				<div class="mg-left-empty">${canManage ? "No scenes found." : "No navigation scenes available."}</div>
			</section>
		`;
	}

	return `
		<section class="mg-scene-directory">
			<div class="mg-scene-directory-header">
				${controls}
				${activeScene ? mgRenderActiveSceneBanner(activeScene) : ""}
				${favorites}
			</div>

			<div class="mg-scene-directory-browser">
				${search}
				<hr class="mg-scene-directory-rule" />
				${collapseFolders}

				<div class="mg-scene-tree" data-mg-scene-tree data-mg-scene-container="">
					${mgRenderSceneBranch(folderTree)}
				</div>

				<div class="mg-left-empty mg-scene-empty-search" data-mg-scene-empty-search hidden>
					No scenes match this search.
				</div>
			</div>
		</section>
	`;
}

function mgRenderActiveSceneBanner(scene) {
	const thumb = scene.thumb || scene.img || "";
	const style = thumb ? ` style="background-image: url('${mgAttr(mgCssUrl(thumb))}');"` : "";

	return `
		<section class="mg-active-scene" data-mg-active-scene data-mg-active-scene-id="${scene.id}">
			<button type="button" class="mg-active-scene-card" data-mg-open-scene="${scene.id}"${style}>
				<span class="mg-active-scene-scrim"></span>
				<span class="mg-active-scene-kicker"><i class="fa-solid fa-tower-broadcast"></i> Active Scene</span>
				<span class="mg-active-scene-title">${mgEsc(scene.name)}</span>
			</button>
		</section>
	`;
}

/* Scene sidebar tree shaping
----------------------------------------------------------------------*/
function mgBuildSceneFolderTree(scenes, { showAllFolders = true } = {}) {
	const sceneFolders = Array.from(game.folders ?? [])
		.filter(folder => folder.type === "Scene")
		.filter(folder => showAllFolders || mgCanPlayerSeeSceneFolder(folder));
	const folderNodes = new Map(sceneFolders.map(folder => [
		folder.id,
		{ folder, folders: [], scenes: [] }
	]));
	const root = { folders: [], scenes: [] };

	for (const node of folderNodes.values()) {
		const parentId = mgGetSceneFolderTreeParentId(node.folder);
		const parent = parentId ? folderNodes.get(parentId) : null;
		(parent ?? root).folders.push(node);
	}

	for (const scene of scenes) {
		const folderId = scene.folder?.id ?? scene.folder ?? null;
		const parent = folderId ? folderNodes.get(folderId) : null;
		(parent ?? root).scenes.push(scene);
	}

	return root;
}

function mgCanPlayerSeeSceneFolder(folder) {
	return !!folder?.getFlag?.(MG_UI_NS, MG_SCENE_FOLDER_PLAYER_VISIBLE_FLAG);
}

function mgGetSceneFolderParentId(folder) {
	return folder?.folder?.id ?? folder?.folder ?? null;
}

function mgGetSceneFolderDepth(folder) {
	let depth = 0;
	let current = folder;
	const seen = new Set();

	while (current && mgGetSceneFolderParentId(current)) {
		const parentId = mgGetSceneFolderParentId(current);
		if (seen.has(parentId)) break;
		seen.add(parentId);
		current = game.folders?.get(parentId);
		if (!current || current.type !== "Scene") break;
		depth += 1;
	}

	return depth;
}

function mgGetSceneFolderTreeParentId(folder) {
	const parentId = mgGetSceneFolderParentId(folder);
	if (!parentId) return null;

	const parent = game.folders?.get(parentId);
	if (!parent || parent.type !== "Scene") return null;

	return mgGetSceneFolderDepth(parent) > 0
		? mgGetSceneFolderParentId(parent)
		: parentId;
}

function mgRenderSceneBranch(node, depth = 0) {
	const entries = [
		...node.folders.map(folderNode => ({
			type: "folder",
			id: folderNode.folder.id,
			name: folderNode.folder.name,
			html: mgRenderSceneFolder(folderNode, depth)
		})),
		...node.scenes.map(scene => ({
			type: "scene",
			id: scene.id,
			name: scene.name,
			html: mgRenderSceneRow(scene)
		}))
	];

	const order = mgGetSceneUserOrder()[mgGetSceneUserOrderKey(node.folder?.id ?? null)] ?? [];
	const orderMap = new Map(order.map((token, index) => [token, index]));

	return entries
		.sort((a, b) => {
			const aOrder = orderMap.get(mgSceneOrderEntryToken(a));
			const bOrder = orderMap.get(mgSceneOrderEntryToken(b));
			if (aOrder !== undefined || bOrder !== undefined) return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER);
			return a.name.localeCompare(b.name) || a.type.localeCompare(b.type);
		})
		.map(entry => entry.html)
		.join("");
}

/* Scene folder accordion rendering
----------------------------------------------------------------------*/
function mgRenderSceneFolder(node, depth = 0) {
	const folder = node.folder;
	const id = `scene-folder-${folder.id}`;
	const isOpen = mgIsAccordionOpen(null, id, true);
	const canCreateSubfolder = game.user?.isGM && depth === 0;
	const body = mgRenderSceneBranch(node, depth + 1) || `<div class="mg-left-empty mg-scene-folder-empty">No scenes in this folder.</div>`;
	const color = String(folder.color ?? "").trim();
	const iconStyle = color ? ` style="color: ${mgAttr(color)};"` : "";

	return `
		<section
			class="mg-left-accordion mg-scene-folder-accordion ${isOpen ? "is-open" : ""} ${depth > 0 ? "is-sub" : ""}"
			data-mg-accordion="${id}"
			data-mg-scene-folder-id="${folder.id}"
		>
			<div
				class="mg-left-accordion-toggle mg-scene-folder-toggle"
				data-mg-accordion-toggle="${id}"
				data-mg-scene-folder-drop="${folder.id}"
				aria-expanded="${isOpen ? "true" : "false"}"
			>
				<span><i class="fa-solid fa-folder" data-mg-scene-folder-icon${iconStyle}></i>${mgEsc(folder.name)}</span>
				<i class="fa-solid fa-chevron-down mg-left-accordion-chevron"></i>
			</div>

			<div
				class="mg-left-accordion-body"
				${isOpen ? "" : "hidden"}
				style="max-height: ${isOpen ? "none" : "0px"};"
			>
				<div class="mg-left-accordion-inner">
					<div class="mg-scene-folder-body" data-mg-scene-folder-body="${folder.id}" data-mg-scene-container="${folder.id}">
						${game.user?.isGM ? `
							<div class="mg-scene-folder-actions">
								<button type="button" class="mg-scene-mini-action" data-mg-scene-create="${folder.id}" title="Create scene in ${mgAttr(folder.name)}" aria-label="Create scene in ${mgAttr(folder.name)}">
									<i class="fa-solid fa-map"></i>
								</button>
								${canCreateSubfolder ? `
									<button type="button" class="mg-scene-mini-action" data-mg-scene-folder-create="${folder.id}" title="Create subfolder in ${mgAttr(folder.name)}" aria-label="Create subfolder in ${mgAttr(folder.name)}">
										<i class="fa-solid fa-folder-plus"></i>
									</button>
								` : ""}
							</div>
						` : ""}
						${body}
					</div>
				</div>
			</div>
		</section>
	`;
}

/* Scene row rendering and viewer presence
----------------------------------------------------------------------*/
function mgRenderSceneRow(scene, { favoriteList = false } = {}) {
	const isActive = !!scene.active;
	const isCurrent = canvas?.scene?.id === scene.id;
	const isNavigation = !!scene.navigation;
	const isFavorite = !!scene.getFlag?.(MG_UI_NS, MG_SCENE_FAVORITE_FLAG);
	const viewingUsers = mgGetUsersViewingScene(scene);
	const thumb = scene.thumb || scene.img || "";
	const style = thumb ? ` style="background-image: url('${mgAttr(mgCssUrl(thumb))}');"` : "";

	return `
		<article
			class="mg-scene-row ${isActive ? "is-active" : ""} ${isCurrent ? "is-current" : ""} ${isNavigation ? "is-navigation" : ""} ${isFavorite ? "is-favorite" : ""}"
			data-mg-scene-id="${scene.id}"
			data-mg-scene-name="${mgAttr(scene.name)}"
			data-mg-scene-favorite-list="${favoriteList ? "true" : "false"}"
			data-mg-scene-folder="${scene.folder?.id ?? scene.folder ?? ""}"
		>
			<button type="button" class="mg-scene-row-main" data-mg-open-scene="${scene.id}"${style}>
				<span class="mg-scene-row-scrim"></span>
				<span class="mg-scene-row-title">${mgEsc(scene.name)}</span>
				${viewingUsers.length ? mgRenderSceneViewerDots(viewingUsers) : ""}
				<span class="mg-scene-row-badges">
					${isActive ? `<i class="fa-solid fa-tower-broadcast" title="Active scene"></i>` : ""}
					${isCurrent ? `<i class="fa-solid fa-location-dot" title="Current scene"></i>` : ""}
					${isNavigation ? `<i class="fa-solid fa-compass" title="In navigation"></i>` : ""}
					${isFavorite ? `<i class="fa-solid fa-star" title="Favorite"></i>` : ""}
				</span>
			</button>
			<button type="button" class="mg-scene-context-button" data-mg-scene-menu="${scene.id}" title="Scene actions" aria-label="Scene actions for ${mgAttr(scene.name)}">
				<i class="fa-solid fa-ellipsis-vertical"></i>
			</button>
		</article>
	`;
}

function mgGetUsersViewingScene(scene) {
	const sceneId = scene?.id;
	if (!sceneId) return [];

	return mgGetSceneViewerUsers()
		.filter(user => mgGetUserViewedSceneId(user) === sceneId);
}

function mgGetSceneViewerUsers() {
	return Array.from(game.users ?? [])
		.filter(user => user.active)
		.filter(user => game.user?.isGM || !user.isGM);
}

function mgGetUserViewedSceneId(user) {
	const viewed = user?.viewedScene;
	return viewed?.id ?? viewed ?? user?.scene?.id ?? user?.scene ?? user?.getFlag?.("core", "viewedScene") ?? null;
}

/* Scene viewer presence refresh
----------------------------------------------------------------------*/
function mgGetSceneViewerSignature() {
	return mgGetSceneViewerUsers()
		.map(user => `${user.id}:${mgGetUserViewedSceneId(user) ?? ""}`)
		.sort()
		.join("|");
}

function mgSetSceneViewerRefreshActive(active) {
	if (!active) {
		if (mgSceneViewerRefreshTimer) window.clearInterval(mgSceneViewerRefreshTimer);
		mgSceneViewerRefreshTimer = null;
		mgSceneViewerSignature = "";
		return;
	}

	mgSceneViewerSignature = mgGetSceneViewerSignature();
	if (mgSceneViewerRefreshTimer) return;

	mgSceneViewerRefreshTimer = window.setInterval(() => {
		if (mgActiveSidebarTab !== "scenes") {
			mgSetSceneViewerRefreshActive(false);
			return;
		}

		const next = mgGetSceneViewerSignature();
		if (next === mgSceneViewerSignature) return;
		mgSceneViewerSignature = next;
		mgRefreshScenesSidebarContent();
	}, 1000);
}

function mgRenderSceneViewerDots(users) {
	return `
		<span class="mg-scene-viewers" aria-label="Players viewing this scene">
			${users.map(user => `
				<span
					class="mg-scene-viewer-dot"
					title="${mgAttr(user.name)}"
					style="--mg-scene-viewer-color: ${mgAttr(user.color || "#c5d4ec")};"
				></span>
			`).join("")}
		</span>
	`;
}

/* Actor sidebar bridge
----------------------------------------------------------------------*/
function mgBindActorSidebarContent(root) {
	globalThis.MGActorSidebar?.bindContent?.(root);
}

function mgRenderActorSidebarContent() {
	return globalThis.MGActorSidebar?.renderContent?.() ?? `<div class="mg-left-empty">Actor sidebar is still loading.</div>`;
}

function mgTidyActorFolderConfig(html, folder) {
	globalThis.MGActorSidebar?.tidyFolderConfig?.(html, folder);
}

function mgBindItemSidebarContent(root) {
	globalThis.MGItemSidebar?.bindContent?.(root);
}

function mgRenderItemSidebarContent() {
	return globalThis.MGItemSidebar?.renderContent?.() ?? `<div class="mg-left-empty">Item sidebar is still loading.</div>`;
}

function mgBindJournalSidebarContent(root) {
	globalThis.MGJournalSidebar?.bindContent?.(root);
}

function mgRenderJournalSidebarContent() {
	return globalThis.MGJournalSidebar?.renderContent?.() ?? `<div class="mg-left-empty">Journal sidebar is still loading.</div>`;
}

function mgBindCompendiumSidebarContent(root) {
	globalThis.MGCompendiumSidebar?.bindContent?.(root);
}

function mgRenderCompendiumSidebarContent() {
	return globalThis.MGCompendiumSidebar?.renderContent?.() ?? `<div class="mg-left-empty">Compendium sidebar is still loading.</div>`;
}

function mgBindPlaylistSidebarContent(root) {
	globalThis.MGPlaylistSidebar?.bindContent?.(root);
}

function mgRenderPlaylistSidebarContent() {
	return globalThis.MGPlaylistSidebar?.renderContent?.() ?? `<div class="mg-left-empty">Playlist sidebar is still loading.</div>`;
}

function mgRenderDirectorPlaylistControl() {
	const panel = globalThis.MGPlaylistSidebar?.renderActiveSoundsPanel?.();
	if (!panel) return `<div class="mg-left-empty">Playlist sidebar is still loading.</div>`;

	return `
		<div class="mg-scene-directory mg-playlist-directory mg-director-playlist-directory">
			<div class="mg-scene-directory-header">
				${panel}
			</div>
		</div>
	`;
}

function mgBindGmSidebarContent(root) {
	if (!game.user?.isGM) return;

	root?.querySelectorAll("[data-mg-difficulty]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();

			const value = Math.max(-3, Math.min(3, Number(button.dataset.mgDifficulty) || 0));
			await game.settings.set("midnight-gambit", "gmDifficultyModifier", value);
			mgRefreshGmSidebarContent();
		});
	});

	root?.querySelectorAll("[data-mg-open-aura-actor]").forEach(button => {
		button.addEventListener("click", event => {
			event.preventDefault();
			event.stopPropagation();

			const actor = game.actors.get(button.dataset.mgOpenAuraActor);
			actor?.sheet?.render(true, { focus: true });
		});
	});

	root?.querySelectorAll("[data-mg-clear-aura]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();

			const actor = game.actors.get(button.dataset.mgClearAura);

			if (actor?.type === "npc") {
				await actor.update({ "system.aura.enabled": false }, { render: false });
			}

			const current = game.settings.get("midnight-gambit", "activeAuraActorId");
			if (current === button.dataset.mgClearAura) {
				await game.settings.set("midnight-gambit", "activeAuraActorId", "");
			}

			mgRefreshGmSidebarContent();
		});
	});

	root?.querySelectorAll("[data-mg-roll-aura-attribute]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();

			const actor = game.actors.get(button.dataset.mgAuraActor);
			await mgRollNpcAttribute(actor, button.dataset.mgRollAuraAttribute);
		});
	});

	mgBindPlaylistSidebarContent(root);
}

/* Get Difficulty for GM Sidebar
----------------------------------------------------------------------*/
function mgRenderDifficultyControl() {
	const current = mgGetDifficultyModifier();
	const buttons = [-3, -2, -1, 0, 1, 2, 3].map(value => {
		const label = value > 0 ? `+${value}` : String(value);
		const active = value === current;

		return `
			<button
				type="button"
				class="mg-difficulty-button ${active ? "is-active" : ""}"
				data-mg-difficulty="${value}"
				aria-pressed="${active ? "true" : "false"}"
				title="Set difficulty to ${label}"
			>
				${label}
			</button>
		`;
	}).join("");

	return `
		<div class="mg-difficulty-control" data-mg-difficulty-control>
			<h2>Apply Difficulty</h2>

			<div class="mg-difficulty-buttons" role="group" aria-label="GM difficulty modifier">
				${buttons}
			</div>
		</div>
	`;
}

/* Get Active Aura for GM Sidebar
----------------------------------------------------------------------*/
function mgGetActiveAuraActor() {
	let activeAuraActorId = "";

	try {
		activeAuraActorId = game.settings.get("midnight-gambit", "activeAuraActorId");
	} catch (_) {
		return null;
	}

	if (!activeAuraActorId) return null;

	const actor = game.actors.get(activeAuraActorId);
	if (!actor || actor.type !== "npc" || !actor.system?.aura?.enabled) return null;

	return actor;
}

function mgRenderAuraAttributePills(actor) {
	const attrs = actor?.system?.attributes ?? actor?.system?.baseAttributes ?? {};
	const keys = ["tenacity", "finesse", "resolve", "guile", "instinct", "presence"];

	return `
		<div class="mg-director-aura-pills" aria-label="Aura modifiers">
			${keys.map(key => {
				const npcValue = Number(attrs[key] ?? 0) || 0;
				const rollValue = -npcValue;
				const label = key.slice(0, 3).toUpperCase();

				return `
					<button
						type="button"
						class="mg-director-aura-pill ${rollValue === 0 ? "is-zero" : ""}"
						data-mg-aura-actor="${actor.id}"
						data-mg-roll-aura-attribute="${key}"
						title="Roll ${mgCapitalize(key)} for ${mgAttr(actor.name)}"
					>
						<span>${label}</span>
						<strong>${mgSigned(rollValue)}</strong>
					</button>
				`;
			}).join("")}
		</div>
	`;
}

function mgRenderDirectorAuraActorRow(actor) {
	const img = mgGetDirectorActorImage(actor);
	const hasCrop = mgHasActorCrop(actor, "actorSidebar");
	const cropVariables = hasCrop ? mgGetActorCropVariables(actor, "actorSidebar", [], { ignoreHeight: true }) : "";
	const auraLabel = String(actor.system?.aura?.label || "Oppressive Presence");

	return `
		<div class="mg-director-aura-card">
			<article
				class="mg-scene-row mg-actor-row mg-director-aura-row"
				data-mg-active-actor-id="${actor.id}"
				data-mg-actor-id="${actor.id}"
				data-mg-actor-name="${mgAttr(actor.name)}"
			>
				<button type="button" class="mg-scene-row-main mg-actor-row-main" data-mg-open-aura-actor="${actor.id}">
					<span class="mg-actor-row-image mg-cropbox ${hasCrop ? "is-cropped" : ""}" aria-hidden="true">
						<img src="${mgEsc(img)}" alt="" style="${cropVariables}" />
					</span>
					<span class="mg-scene-row-scrim"></span>
					<span class="mg-scene-row-title mg-actor-row-title">${mgEsc(actor.name)}</span>
				</button>

				<button
					type="button"
					class="mg-scene-context-button mg-actor-context-button mg-director-clear-aura"
					data-mg-clear-aura="${actor.id}"
					title="Clear active aura"
					aria-label="Clear active aura from ${mgAttr(actor.name)}"
				>
					<i class="fa-solid fa-ban"></i>
				</button>
			</article>

			<div class="mg-director-aura-meta">
				<div class="mg-director-aura-label">
					<i class="fa-solid fa-eye-evil"></i>
					<span>${mgEsc(auraLabel)}</span>
				</div>

				${mgRenderAuraAttributePills(actor)}
			</div>
		</div>
	`;
}

function mgRenderAuraControl() {
	const actor = mgGetActiveAuraActor();

	if (!actor) {
		return `
			<div class="mg-scene-directory mg-director-aura-directory">
				<div class="mg-director-aura-empty">
					<i class="fa-solid fa-eye-slash"></i>
					<span>No active aura.</span>
				</div>
			</div>
		`;
	}

	return `
		<div class="mg-scene-directory mg-director-aura-directory" data-mg-director-aura-control>
			<div class="mg-scene-list">
				${mgRenderDirectorAuraActorRow(actor)}
			</div>
		</div>
	`;
}

/* Render GM Sidebar
----------------------------------------------------------------------*/
function mgRenderGmSidebarContent() {
	return `
		<section class="mg-gm-sidebar" data-mg-gm-sidebar>
			${mgRenderAccordion(null, {
				id: "gm-difficulty",
				title: "Difficulty",
				icon: "fa-solid fa-camera-movie",
				open: true,
				body: mgRenderDifficultyControl()
			})}

			${mgRenderAccordion(null, {
				id: "gm-auras",
				title: "Auras",
				icon: "fa-solid fa-eye-evil",
				open: true,
				body: mgRenderAuraControl()
			})}

			${mgRenderAccordion(null, {
				id: "gm-playlist",
				title: "Sounds / Playlist",
				icon: "fa-solid fa-music",
				open: true,
				body: mgRenderDirectorPlaylistControl()
			})}
		</section>
	`;
}

function mgRenderSettingsSidebarContent() {
	const gameSettings = `
		<button type="button" class="mg-left-action" data-mg-settings-config>
			<i class="fa-solid fa-gears"></i>
			Configure Settings
		</button>

		<button type="button" class="mg-left-action" data-mg-settings-controls>
			<i class="fa-solid fa-gamepad"></i>
			Configure Controls
		</button>

		<button type="button" class="mg-left-action" data-mg-settings-modules>
			<i class="fa-solid fa-cube"></i>
			Manage Modules
		</button>

		<button type="button" class="mg-left-action" data-mg-settings-world>
			<i class="fa-solid fa-globe"></i>
			Edit World
		</button>

		<button type="button" class="mg-left-action" data-mg-settings-users>
			<i class="fa-solid fa-users"></i>
			User Management
		</button>
	`;

	const accessLogout = `
		<button type="button" class="mg-left-action" data-mg-settings-invites>
			<i class="fa-solid fa-link"></i>
			Invitation Links
		</button>

		<button type="button" class="mg-left-action" data-mg-settings-logout>
			<i class="fa-solid fa-right-from-bracket"></i>
			Log out
		</button>

		<button type="button" class="mg-left-action" data-mg-settings-setup>
			<i class="fa-solid fa-door-open"></i>
			Return to Setup
		</button>
	`;

	return `
		<section class="mg-left-section">
			${mgRenderAccordion(null, {
				id: "settings-game",
				title: "Game Settings",
				icon: "fa-solid fa-gear",
				open: true,
				body: gameSettings
			})}

			${mgRenderAccordion(null, {
				id: "settings-access",
				title: "Access / Logout",
				icon: "fa-solid fa-right-from-bracket",
				open: true,
				body: accessLogout
			})}
		</section>
	`;
}

/* Centralized Foundry Scene Control Handling
==============================================================================================================================================*/

function mgGetFoundryControl(controlName) {
  return ui.controls?.controls?.find(c => c.name === controlName) ?? null;
}

function mgCanUseFoundryControl(controlName) {
	const foundryControl = mgGetFoundryControl(controlName);
	return !!foundryControl && foundryControl.visible !== false;
}

function mgGetFoundryTool(controlName, toolName) {
  const control = mgGetFoundryControl(controlName);
  const names = mgGetNativeToolNames(controlName, toolName);
  return control?.tools?.find(t => names.includes(t.name)) ?? null;
}

function mgNextFrame() {
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function mgCssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/"/g, '\\"');
}

function mgGetNativeToolNames(controlName, toolName) {
  const aliases = {
    drawings: {
      rect: ["rect", "rectangle"],
      rectangle: ["rectangle", "rect"]
    }
  };

  return aliases[controlName]?.[toolName] ?? [toolName];
}

async function mgInitializeNativeControl(controlName, toolName = null) {
  const control = mgGetFoundryControl(controlName);
  if (!control || typeof ui.controls?.initialize !== "function") return false;

  const names = toolName ? mgGetNativeToolNames(controlName, toolName) : [null];

  for (const name of names) {
    try {
      const update = {
        control: controlName,
        layer: control.layer
      };

      if (name) update.tool = name;

      await ui.controls.initialize(update);
      await mgNextFrame();

      const activeControl = ui.controls?.activeControl || ui.controls?.control?.name;
      const activeTool = ui.controls?.activeTool || ui.controls?.tool?.name || control.activeTool;

      if (activeControl === controlName && (!name || activeTool === name)) return true;
    } catch (err) {
      console.warn("MG UI | Direct scene control activation failed.", { controlName, toolName: name, err });
    }
  }

  return false;
}

/**
 * Clicks Foundry's real native control button.
 * This keeps Foundry's toolbar state and canvas layer behavior aligned.
 */
async function mgClickNativeControl(controlName) {
  if (!controlName) return false;

  const safeControl = mgCssEscape(controlName);

  const nativeControl =
    document.querySelector(`#controls [data-control="${safeControl}"]`) ||
    document.querySelector(`#controls li.scene-control[data-control="${safeControl}"]`) ||
    document.querySelector(`#controls button[data-control="${safeControl}"]`) ||
    document.querySelector(`#controls a[data-control="${safeControl}"]`);

  if (!nativeControl) {
    console.warn(`MG UI | Native control button not found: ${controlName}`);
    return mgInitializeNativeControl(controlName);
  }

  nativeControl.dispatchEvent(new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    view: window
  }));

  await mgNextFrame();

  const activeControl = ui.controls?.activeControl || ui.controls?.control?.name;
  if (activeControl === controlName) return true;

  return mgInitializeNativeControl(controlName);
}

/**
 * Clicks Foundry's real native tool button.
 * Foundry v11 renders subtools in a separate controls list, not always nested
 * inside the main control button, so we activate the control first, then search
 * for the active subtool button globally inside #controls.
 */
async function mgClickNativeTool(controlName, toolName) {
  if (!controlName || !toolName) return false;

  const toolNames = mgGetNativeToolNames(controlName, toolName);

  // First activate the parent control using Foundry's own button.
  const controlClicked = await mgClickNativeControl(controlName);
  if (!controlClicked) return false;

  await mgNextFrame();

  const selectors = toolNames.flatMap(name => {
    const safeTool = mgCssEscape(name);
    return [
      `#controls [data-tool="${safeTool}"]`,
      `#controls li.control-tool[data-tool="${safeTool}"]`,
      `#controls li[data-tool="${safeTool}"]`,
      `#controls button[data-tool="${safeTool}"]`,
      `#controls a[data-tool="${safeTool}"]`
    ];
  });

  const candidates = Array.from(document.querySelectorAll(selectors.join(",")));

  // Prefer buttons that are not disabled and are closest to the active subcontrols.
  const nativeButton =
    candidates.find(el => !el.classList.contains("disabled") && !el.getAttribute("disabled")) ||
    candidates[0];

  if (!nativeButton) {
    console.warn(`MG UI | Native tool button not found: ${controlName}/${toolName}`);
    console.warn(
      "MG UI | Available native tool buttons:",
      Array.from(document.querySelectorAll("#controls [data-tool]")).map(el => ({
        tool: el.dataset.tool,
        text: el.textContent?.trim(),
        classes: el.className
      }))
    );
    return mgInitializeNativeControl(controlName, toolName);
  }

  nativeButton.dispatchEvent(new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    view: window
  }));

  await mgNextFrame();

  const activeTool = ui.controls?.activeTool || ui.controls?.tool?.name || mgGetFoundryControl(controlName)?.activeTool;
  if (toolNames.includes(activeTool)) return true;

  return mgInitializeNativeControl(controlName, toolName);
}

/**
 * Activates a Foundry canvas control group.
 */
async function mgActivateFoundryControl(controlName) {
	if (!controlName) return;

	const foundryControl = mgGetFoundryControl(controlName);
	if (!foundryControl) {
		if (controlName === "drawings") {
			ui.notifications?.warn("MG UI: Drawing tools need Foundry's Create Drawing permission for Players.");
			console.warn("MG UI | Drawing control missing. Check core permission DRAWING_CREATE for the Player role.");
			return;
		}

		ui.notifications?.warn(`MG UI: Foundry control "${controlName}" was not found.`);
		console.warn("MG UI | Available controls:", ui.controls?.controls?.map(c => c.name));
		return;
	}

	const clicked = await mgClickNativeControl(controlName);

	if (!clicked) {
		ui.notifications?.warn(`MG UI: Could not activate "${controlName}".`);
		return;
	}

	mgActiveControl = controlName;
	mgRefreshActiveControl(controlName);

	mgSaveUiState({
		activeControl: controlName,
		activeTool: mgActiveTool
	});

	mgSetOrbBadge(controlName, mgActiveTool);
}

/**
 * Activates a Foundry subtool within the current control group.
 */
async function mgActivateFoundryTool(controlName, toolName) {
	if (!controlName || !toolName) return;

	const tool = mgGetFoundryTool(controlName, toolName);

	if (!tool) {
		console.warn(
		`MG UI | Tool "${toolName}" was not found in control "${controlName}".`,
		mgGetFoundryControl(controlName)?.tools?.map(t => t.name)
		);
	}

	const clicked = await mgClickNativeTool(controlName, toolName);

	if (!clicked) {
		ui.notifications?.warn(`MG UI: Could not activate "${toolName}".`);
		return;
	}

	mgActiveControl = controlName;
	mgActiveTool = toolName;

	mgRefreshActiveControl(controlName);
	mgRefreshActiveTool(toolName);

	mgSaveUiState({
		activeControl: controlName,
		activeTool: toolName
	});

	mgSetOrbBadge(controlName, toolName);
}

/**
 * Runs Midnight Gambit specific controls.
 */
function mgRunMgAction(action) {
  switch (action) {
    case "initiative": {
      if (game.mgInitiative?.showBar) {
        game.mgInitiative.showBar();
      } else {
        ui.notifications?.warn("MG Initiative is not ready yet.");
      }
      break;
    }

    case "clocks": {
      ui.notifications?.info("Clock launcher coming next.");
      break;
    }

    default:
      ui.notifications?.warn(`Unknown MG action: ${action}`);
      break;
  }
}

async function mgRunCustomTool(menuName, toolName) {
	if (menuName === "dice") {
		const tool = mgGetCustomToolsForMenu("dice").find(t => t.name === toolName);
		const formula = tool?.formula;

		if (!formula) {
			ui.notifications?.warn(`Unknown Dice roll: ${toolName}`);
			return;
		}

		await mgRollQuickDice(formula);
		return;
	}

	if (menuName === "clocks") {
		switch (toolName) {
			case "addClock": {
				if (!game.mgClocks?.create) {
					ui.notifications?.warn("MG Clocks are not ready yet.");
					return;
				}

				await game.mgClocks.create();
				return;
			}

			case "clearClocks": {
				if (!game.mgClocks?.clearAll) {
					ui.notifications?.warn("MG Clocks are not ready yet.");
					return;
				}

				await game.mgClocks.clearAll();
				return;
			}

			case "hideClocks": {
				if (!game.mgClocks?.toggleHidden) {
					ui.notifications?.warn("MG Clocks are not ready yet.");
					return;
				}

				await game.mgClocks.toggleHidden();
				return;
			}

			default:
				ui.notifications?.warn(`Unknown Clock tool: ${toolName}`);
				return;
		}
	}

	ui.notifications?.warn(`Unknown MG menu: ${menuName}`);
}

async function mgRollQuickDice(formula) {
	try {
		const roll = new Roll(formula);
		await roll.evaluate({ async: true });

		const messageData = {
			user: game.user.id,
			speaker: ChatMessage.getSpeaker(),
			flavor: `Roll ${formula}`,
			rollMode: game.settings.get("core", "rollMode")
		};

		if (typeof roll.toMessage === "function") {
			await roll.toMessage(messageData, { rollMode: messageData.rollMode });
			return;
		}

		await ChatMessage.create({
			...messageData,
			roll,
			type: CONST.CHAT_MESSAGE_TYPES.ROLL
		});
	} catch (err) {
		ui.notifications?.warn(`Could not roll ${formula}.`);
		console.warn("MG UI | Quick dice roll failed.", { formula, err });
	}
}

/**
 * Updates active visual state on the MG main rail.
 */
function mgRefreshActiveControl(forcedControl = null) {
	const active =
		forcedControl ||
		(mgActiveControl?.startsWith("mg:") && mgSubbarOpen ? mgActiveControl : "") ||
		ui.controls?.activeControl ||
		ui.controls?.control?.name ||
		"";

	mgActiveControl = active || mgActiveControl;

	document.querySelectorAll(".mg-orb-tool").forEach(button => {
		const controlName = button.dataset.mgControl;
		const customMenu = button.dataset.mgCustomMenu ? `mg:${button.dataset.mgCustomMenu}` : null;

		button.classList.toggle(
			"is-active",
			controlName === mgActiveControl || customMenu === mgActiveControl
		);
	});
}

/**
 * Updates active visual state on the subtool rail.
 */
function mgRefreshActiveTool(forcedTool = null) {
	const activeTool = mgActiveControl?.startsWith("mg:")
		? (forcedTool || mgActiveTool || "")
		: (
			forcedTool ||
			ui.controls?.activeTool ||
			ui.controls?.tool?.name ||
			mgActiveTool ||
			""
		);

	mgActiveTool = activeTool || null;

	document.querySelectorAll(".mg-orb-subtool, .mg-dice-roll-button").forEach(button => {
		const toolName = button.dataset.mgSubtool || button.dataset.mgCustomSubtool;
		button.classList.toggle("is-active", toolName === activeTool);
	});

	mgSetOrbBadge(mgActiveControl, mgActiveTool);
}

/* Refresh hooks
==============================================================================================================================================*/

Hooks.on("renderSceneControls", () => {
  mgRefreshActiveControl();
  mgRefreshActiveTool();
});

Hooks.on("renderSidebar", () => mgEnsureRightSidebarHeader());
Hooks.on("renderSidebarTab", () => mgEnsureRightSidebarHeader());
Hooks.on("renderPlayers", mgRefreshDockedPlayersBox);
Hooks.on("renderPlayerList", mgRefreshDockedPlayersBox);
Hooks.on("updateActor", actor => {
	if (mgActiveSidebarTab !== "player") return;
	const sidebarActor = game.user?.character;

	if (actor?.id === sidebarActor?.id) mgRefreshLeftSidebarContent();
});
Hooks.on("updateActor", actor => {
	mgRefreshCrewSidebarForActor(actor);
});
Hooks.on("updateSetting", setting => {
	if (mgActiveSidebarTab !== "crew") return;
	if (setting?.key === "midnight-gambit.crewActorId") mgRefreshLeftSidebarContent();
});
Hooks.on("updateSetting", setting => {
	if (
		setting?.key === "midnight-gambit.gmDifficultyModifier" ||
		setting?.key === "midnight-gambit.activeAuraActorId"
	) {
		mgRefreshGmSidebarContent();
	}
});
Hooks.on("updateUser", user => {
	if (user?.id === game.user?.id) mgRefreshLeftSidebarTabs();
	mgRefreshDockedPlayersBox();
	mgRefreshScenesSidebarContent();
	mgRefreshActorsSidebarContent();
	mgRefreshItemsSidebarContent();
	mgRefreshJournalSidebarContent();
	mgRefreshCompendiumSidebarContent();
	mgRefreshPlaylistSidebarContent();
});
Hooks.on("renderFolderConfig", (app, html) => {
	const folder = app?.object ?? app?.folder;
	if (folder?.type === "Scene") {
		mgTidySceneFolderConfig(html, folder);
		window.setTimeout(() => mgTidySceneFolderConfig(html, folder), 0);
	}
	if (folder?.type === "Actor") {
		mgTidyActorFolderConfig(html, folder);
		window.setTimeout(() => mgTidyActorFolderConfig(html, folder), 0);
	}
});
Hooks.on("canvasReady", () => mgRefreshScenesSidebarContent());
["createScene", "updateScene", "deleteScene", "createFolder", "updateFolder", "deleteFolder"].forEach(hookName => {
	Hooks.on(hookName, document => {
		if (mgActiveSidebarTab !== "scenes") return;
		if (document?.documentName === "Folder" && document.type !== "Scene") return;
		mgRefreshLeftSidebarContent();
	});
});
["createActor", "updateActor", "deleteActor", "createFolder", "updateFolder", "deleteFolder"].forEach(hookName => {
	Hooks.on(hookName, document => {
		if (mgActiveSidebarTab !== "actors") return;
		if (document?.documentName === "Folder" && document.type !== "Actor") return;
		mgRefreshLeftSidebarContent();
	});
});
["createItem", "updateItem", "deleteItem", "createFolder", "updateFolder", "deleteFolder"].forEach(hookName => {
	Hooks.on(hookName, document => {
		if (mgActiveSidebarTab !== "items") return;
		if (document?.documentName === "Folder" && document.type !== "Item") return;
		mgRefreshLeftSidebarContent();
	});
});
["createJournalEntry", "updateJournalEntry", "deleteJournalEntry", "createFolder", "updateFolder", "deleteFolder"].forEach(hookName => {
	Hooks.on(hookName, document => {
		if (mgActiveSidebarTab !== "journal") return;
		if (document?.documentName === "Folder" && document.type !== "JournalEntry") return;
		mgRefreshLeftSidebarContent();
	});
});
["createCompendium", "updateCompendium", "deleteCompendium", "createCompendiumCollection", "updateCompendiumCollection", "deleteCompendiumCollection", "createFolder", "updateFolder", "deleteFolder"].forEach(hookName => {
	Hooks.on(hookName, document => {
		if (mgActiveSidebarTab !== "compendiums") return;
		if (document?.documentName === "Folder" && document.type !== "Compendium") return;
		mgRefreshLeftSidebarContent();
	});
});
["createPlaylist", "updatePlaylist", "deletePlaylist", "createPlaylistSound", "updatePlaylistSound", "deletePlaylistSound", "createFolder", "updateFolder", "deleteFolder", "globalPlaylistVolumeChanged", "globalAmbientVolumeChanged", "globalInterfaceVolumeChanged"].forEach(hookName => {
	Hooks.on(hookName, document => {
		if (mgActiveSidebarTab !== "playlists" && mgActiveSidebarTab !== "gm") return;
		if (document?.documentName === "Folder" && document.type !== "Playlist") return;
		mgRefreshLeftSidebarContent();
	});
});

Hooks.on("updateActor", (actor, changed) => {
	if (!game.user?.isGM) return;
	if (mgActiveSidebarTab !== "gm") return;
	if (actor?.type !== "npc") return;

	const auraChanged =
		foundry.utils.getProperty(changed, "system.aura") !== undefined ||
		foundry.utils.getProperty(changed, "system.aura.enabled") !== undefined ||
		foundry.utils.getProperty(changed, "system.aura.label") !== undefined ||
		foundry.utils.getProperty(changed, "system.attributes") !== undefined ||
		foundry.utils.getProperty(changed, "system.baseAttributes") !== undefined;

	if (!auraChanged) return;

	mgRefreshGmSidebarContent();
});

/* Folder config cleanup
----------------------------------------------------------------------*/
function mgTidySceneFolderConfig(html, folder) {
	const root = html?.jquery ? html[0] : html?.[0] ?? html;
	if (!root?.querySelectorAll) return;

	mgHideFolderConfigSorting(root);

	const fieldName = `flags.${MG_UI_NS}.${MG_SCENE_FOLDER_PLAYER_VISIBLE_FLAG}`;
	if (!root.querySelector(`[name="${fieldName}"]`)) {
		const field = document.createElement("div");
		field.className = "form-group mg-scene-folder-player-visible";
		field.innerHTML = `
			<label>Players Can See Folder</label>
			<div class="form-fields">
				<input type="checkbox" name="${fieldName}" data-dtype="Boolean" ${folder?.getFlag?.(MG_UI_NS, MG_SCENE_FOLDER_PLAYER_VISIBLE_FLAG) ? "checked" : ""} />
			</div>
			<p class="hint">When unchecked, players still see navigation scenes inside this folder as loose scene cards.</p>
		`;

		const colorInput = root.querySelector('[name="color"]');
		const colorGroup = colorInput?.closest?.(".form-group, .form-field, fieldset, .standard-form-group");
		if (colorGroup?.parentElement) colorGroup.after(field);
		else root.querySelector("form")?.prepend(field);
	}

	mgNormalizeSceneFolderConfigLayout(root);
}

function mgHideFolderConfigSorting(root) {
	root.querySelectorAll('[name="sorting"], [name="sort"], select[name*="sort" i], input[name*="sort" i]').forEach(input => {
		mgHideFolderConfigField(input);
	});

	root.querySelectorAll(".form-group, .form-field, fieldset, .form-fields, .standard-form-group").forEach(group => {
		const text = group.textContent?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
		if (text.startsWith("sorting mode") || text === "sorting" || text.startsWith("sorting ")) {
			mgHideFolderConfigField(group);
		}
	});
}

function mgHideFolderConfigField(element) {
	const group = element.closest?.(".form-group, .form-field, fieldset, .standard-form-group") ?? element;
	group.hidden = true;
	group.style.display = "none";
}

function mgNormalizeSceneFolderConfigLayout(root) {
	const form = root.querySelector("form");
	if (!form || form.dataset.mgSceneFolderLayoutNormalized === "true") return;

	form.dataset.mgSceneFolderLayoutNormalized = "true";
	form.classList.add("mg-scene-folder-config-form");

	const fields = [
		root.querySelector('[name="name"]'),
		root.querySelector('[name="color"]'),
		root.querySelector(`[name="flags.${MG_UI_NS}.${MG_SCENE_FOLDER_PLAYER_VISIBLE_FLAG}"]`)
	].filter(Boolean);

	fields.forEach(input => {
		const currentGroup = input.closest(".form-group, .form-field, fieldset, .standard-form-group");
		if (currentGroup?.classList.contains("mg-scene-folder-config-block")) return;

		const block = document.createElement("div");
		block.className = "form-group mg-scene-folder-config-block";
		const labelText = input.name === "name"
			? "Folder Name"
			: input.name === "color"
				? "Folder Color"
				: "Players Can See Folder";
		const hint = input.name.includes(MG_SCENE_FOLDER_PLAYER_VISIBLE_FLAG)
			? `<p class="hint">When unchecked, players still see navigation scenes inside this folder as loose scene cards.</p>`
			: "";

		block.innerHTML = `
			<label>${labelText}</label>
			<div class="form-fields"></div>
			${hint}
		`;
		block.querySelector(".form-fields").appendChild(input);

		if (currentGroup?.parentElement) currentGroup.replaceWith(block);
		else form.prepend(block);
	});
}

async function mgRestoreUiState() {
	const state = mgLoadUiState();
	mgRestoreAccordionState(state);
	mgSetLeftSidebarTab(state.sidebarTab || "player");
	if (!state || (!state.activeControl && !state.orbOpen)) return;

	const root = document.getElementById(MG_UI_ID);
	const wrap = root?.querySelector("[data-mg-orb-wrap]");
	if (!root || !wrap) return;

	mgActiveControl = state.activeControl || mgActiveControl;
	mgActiveTool = state.activeTool || mgActiveTool;

	if (mgActiveControl && !mgActiveControl.startsWith("mg:") && !mgCanUseFoundryControl(mgActiveControl)) {
		mgActiveControl = null;
		mgActiveTool = null;
		mgSaveUiState({ activeControl: null, activeTool: null, subbarOpen: false });
	}

	// Restore Foundry's actual selected control/tool.
	if (mgActiveControl?.startsWith("mg:")) {
		mgRefreshActiveControl(mgActiveControl);
	} else if (mgActiveControl && mgActiveTool) {
		await mgActivateFoundryTool(mgActiveControl, mgActiveTool);
	} else if (mgActiveControl) {
		await mgActivateFoundryControl(mgActiveControl);
	}

	mgRefreshActiveControl(mgActiveControl);
	mgRefreshActiveTool(mgActiveTool);
	mgSetOrbBadge(mgActiveControl, mgActiveTool);

	if (state.orbOpen) {
		wrap.classList.add("is-open");

		if (mgActiveControl?.startsWith("mg:")) {
			const menuName = mgActiveControl.slice(3);
			const sourceButton = root.querySelector(`[data-mg-custom-menu="${menuName}"]`);

			if (sourceButton) {
				mgOpenCustomSubbar(menuName, sourceButton);
			}
		} else {
			const sourceButton = root.querySelector(`[data-mg-control="${mgActiveControl}"]`);

			if (sourceButton) {
				mgOpenSubbar(mgActiveControl, sourceButton);
			}
		}
	} else {
		wrap.classList.remove("is-open");
		mgCloseSubbar();
	}
}

function mgRefreshFoundryLogo() {
	const logoEl = document.querySelector("#logo");
	if (!logoEl) return;

	// #logo is usually the actual <img>, but this also supports a wrapper fallback.
	const logoImg = logoEl.matches?.("img")
		? logoEl
		: logoEl.querySelector?.("img");

	// Cache original state once
	if (!mgOriginalFoundryLogoSrc) {
		mgOriginalFoundryLogoSrc = {
			imgSrc: logoImg?.getAttribute("src") || "",
			backgroundImage: logoEl.style.backgroundImage || "",
			title: logoEl.getAttribute("title") || "",
			ariaLabel: logoEl.getAttribute("aria-label") || "",
			alt: logoImg?.getAttribute("alt") || ""
		};
	}

	const hudEnabled = document.body.classList.contains("mg-hud-enabled");
	const logoPath = mgGetSystemLogoPath();

	if (hudEnabled) {
		if (logoImg) {
			logoImg.setAttribute("src", logoPath);
			logoImg.setAttribute("alt", "Midnight Gambit");
		} else {
			logoEl.style.backgroundImage = `url("${logoPath}")`;
			logoEl.style.backgroundSize = "contain";
			logoEl.style.backgroundRepeat = "no-repeat";
			logoEl.style.backgroundPosition = "center";
		}

		logoEl.setAttribute("title", "Midnight Gambit");
		logoEl.setAttribute("aria-label", "Midnight Gambit");
		logoEl.classList.add("mg-system-logo-active");
		return;
	}

	// Restore Foundry default
	if (logoImg && mgOriginalFoundryLogoSrc.imgSrc) {
		logoImg.setAttribute("src", mgOriginalFoundryLogoSrc.imgSrc);
		logoImg.setAttribute("alt", mgOriginalFoundryLogoSrc.alt || "Foundry Virtual Tabletop");
	}

	logoEl.style.backgroundImage = mgOriginalFoundryLogoSrc.backgroundImage || "";
	logoEl.style.backgroundSize = "";
	logoEl.style.backgroundRepeat = "";
	logoEl.style.backgroundPosition = "";

	if (mgOriginalFoundryLogoSrc.title) {
		logoEl.setAttribute("title", mgOriginalFoundryLogoSrc.title);
	} else {
		logoEl.removeAttribute("title");
	}

	if (mgOriginalFoundryLogoSrc.ariaLabel) {
		logoEl.setAttribute("aria-label", mgOriginalFoundryLogoSrc.ariaLabel);
	} else {
		logoEl.removeAttribute("aria-label");
	}

	logoEl.classList.remove("mg-system-logo-active");
}

function mgWatchHudLogoState() {
	if (document.body.dataset.mgLogoObserver === "true") return;
	document.body.dataset.mgLogoObserver = "true";

	const observer = new MutationObserver(mutations => {
		for (const mutation of mutations) {
			if (mutation.type !== "attributes") continue;
			if (mutation.attributeName !== "class") continue;

			mgRefreshFoundryLogo();
			break;
		}
	});

	observer.observe(document.body, {
		attributes: true,
		attributeFilter: ["class"]
	});

	// Keep a debug handle around in case we ever need to disconnect it.
	game.mgLogoObserver = observer;
}

/**
 * Create UI once Foundry is ready.
 */
Hooks.once("ready", () => {
	mgCreateUiRoot();
	mgWatchHudLogoState();
	mgRefreshFoundryLogo();

	setTimeout(() => {
		mgRestoreUiState().catch(err => console.warn("MG UI | Restore failed.", err));
		mgRefreshFoundryLogo();
	}, 250);

	game.mgUi = {
		refresh: () => {
		mgRefreshActiveControl();
		mgRefreshActiveTool();
		},
		refreshLogo: mgRefreshFoundryLogo,
		watchLogo: mgWatchHudLogoState,
		controls: () => ui.controls?.controls?.map(c => c.name) ?? [],
		tools: controlName => mgGetToolsForControl(controlName),
		dumpTools: () => ui.controls?.controls?.map(control => ({
		name: control.name,
		layer: control.layer,
		activeTool: control.activeTool,
		tools: (control.tools ?? []).map(tool => ({
			name: tool.name,
			title: tool.title || tool.label || tool.name,
			button: !!tool.button,
			toggle: !!tool.toggle,
			active: !!tool.active,
			hasOnClick: typeof tool.onClick === "function"
		}))
		})) ?? [],
		closeSubbar: mgCloseSubbar,
		rebuild: () => {
			mgUndockFoundryPlayersBox();
			document.getElementById(MG_UI_ID)?.remove();
			mgCreateUiRoot();
		}
  };
});
