import { evaluateRoll } from "./roll-utils.js";

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
const mgLeftAccordionState = {};

const MG_ATTRIBUTE_KEYS = ["tenacity", "finesse", "resolve", "guile", "instinct", "presence"];
const MG_SKILL_BUCKETS = {
	tenacity: ["brawl", "endure", "athletics"],
	finesse: ["aim", "stealth", "sleight"],
	resolve: ["will", "grit", "composure"],
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
		label: "Crew / Party",
		icon: "fa-solid fa-users"
	},
	{
		id: "initiative",
		label: "Initiative",
		icon: "fa-solid fa-swords"
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
		icon: "fa-solid fa-table-cells-large"
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
		class="mg-sidebar-collapse-toggle mg-left-sidebar-collapse-toggle"
		data-mg-collapse-sidebar="left"
		title="Toggle left sidebar"
		aria-label="Toggle left sidebar"
	>
		<i class="fa-solid fa-chevron-left"></i>
	</button>

	<aside class="mg-left-sidebar" data-mg-left-sidebar>
		<div class="mg-left-sidebar-panel" data-mg-left-sidebar-panel>
			<header class="mg-left-sidebar-header">
				<span class="mg-left-sidebar-kicker">Midnight Gambit</span>
				<h2 data-mg-left-sidebar-title>Character</h2>
			</header>

			<div class="mg-left-sidebar-body" data-mg-left-sidebar-body>
				<!-- Sidebar content renders here -->
			</div>
		</div>

		<nav class="mg-left-sidebar-tabs" data-mg-left-sidebar-tabs aria-label="Midnight Gambit Sidebar">
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
	mgRestoreSidebarCollapseState();

	const savedState = mgLoadUiState();
	mgRestoreAccordionState(savedState);
	mgSetLeftSidebarTab(savedState.sidebarTab || "player");

	mgRefreshActiveControl();
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

  const foundryButtons = controls.map(control => `
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
  `).join("");

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

  return `${foundryButtons}${mgButtons}`;
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

function mgSigned(value) {
	const n = Number(value) || 0;
	return n >= 0 ? `+${n}` : `${n}`;
}

function mgClampStatValue(value) {
	const n = Number(value);
	if (!Number.isFinite(n)) return 0;
	return Math.max(-2, Math.min(3, Math.trunc(n)));
}

function mgCapitalize(value) {
	const str = String(value ?? "");
	return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
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

function mgRenderAccordion(actor, { id, title, icon = "", open = true, body = "" }) {
	const isOpen = mgIsAccordionOpen(actor, id, open);
	const iconHtml = icon ? `<i class="${icon}"></i>` : "";

	return `
		<section class="mg-left-accordion ${isOpen ? "is-open" : ""}" data-mg-accordion="${id}">
			<button
				type="button"
				class="mg-left-accordion-toggle"
				data-mg-accordion-toggle="${id}"
				aria-expanded="${isOpen ? "true" : "false"}"
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

function mgResolvePrimaryGuise(actor) {
	const ref = actor?.system?.guiseId || actor?.system?.guise;
	if (!actor || !ref) return null;

	return actor.items?.get?.(ref) ||
		actor.items?.find?.(item => item.id === ref || item.uuid === ref || item.name === ref) ||
		null;
}

function mgResolveGuiseName(actor) {
	const primary = mgResolvePrimaryGuise(actor);
	if (primary) return primary.name;

	if (typeof actor?.system?.guise === "object") return actor.system.guise.name || "No Guise";
	return actor?.system?.guiseName || actor?.system?.class || "No Guise";
}

function mgResolveCrewName(actor) {
	return actor?.system?.crewName || actor?.system?.crew || "No Crew";
}

function mgRange(start, end) {
	const max = Math.max(0, Number(end) || 0);
	const min = Math.max(1, Number(start) || 1);
	return Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i);
}

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
		<div class="mg-left-icon-track mg-left-${kind}-track">
			${mgRange(1, count).map(value => `
				<button
					type="button"
					class="mg-left-dot ${value <= filledCount ? "filled" : ""}"
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

function mgRenderLeftSidebarTabs() {
	return MG_LEFT_SIDEBAR_TABS.map(tab => {
		const actor = tab.id === "player" ? mgGetAssignedCharacter() : null;
		const portrait = actor?.img || "";
		const tabClass = `mg-left-sidebar-tab${portrait ? " has-portrait" : ""}`;
		const iconHtml = portrait
			? `<img class="mg-left-sidebar-tab-portrait" src="${portrait}" alt="" />`
			: `<i class="${tab.icon}"></i>`;

		return `
		<button
			type="button"
			class="${tabClass}"
			data-mg-left-tab="${tab.id}"
			aria-label="${tab.label}"
		>
			${iconHtml}
			<span class="mg-left-sidebar-tab-label">${tab.label}</span>
		</button>
	`;
	}).join("");
}

function mgRefreshLeftSidebarTabs() {
	const root = document.getElementById(MG_UI_ID);
	const tabs = root?.querySelector("[data-mg-left-sidebar-tabs]");
	if (!root || !tabs) return;

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

		stack.title = `${controlMeta.label || "Category"} → ${toolMeta.label || "Tool"}`;
	} else {
		childWrap.hidden = true;
		divider.hidden = true;

		stack.title = controlMeta.label || "Active category";
	}

	stack.hidden = false;
}

/**
 * Binds the Orb toggle and rail button actions.
 */
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

/**
 * Opens the subtool rail for a specific main control.
 * If another submenu is already open, close it first, then open the new one.
 */
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

/**
 * Renders the subtool buttons for the active control.
 */
function mgRenderSubbarTools(controlName, toolsWrap) {
	const tools = mgGetToolsForControl(controlName);

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
	const tools = mgGetCustomToolsForMenu(menuName);

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
	const body = root?.querySelector("[data-mg-left-sidebar-body]");
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
	const panel = button.closest("[data-mg-character-sidebar]");
	const actor = game.actors.get(panel?.dataset?.mgCharacterSidebar);
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
			body.style.maxHeight = `${body.scrollHeight}px`;
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
	body.style.maxHeight = `${body.scrollHeight}px`;

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
		body.classList.toggle("mg-left-sidebar-collapsed", isCollapsed);

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

	const tab = MG_LEFT_SIDEBAR_TABS.find(t => t.id === tabId) || MG_LEFT_SIDEBAR_TABS[0];
	if (!tab) return;

	mgUndockFoundryPlayersBox();

	mgActiveSidebarTab = tab.id;

	root.querySelectorAll("[data-mg-left-tab]").forEach(button => {
		button.classList.toggle("is-active", button.dataset.mgLeftTab === tab.id);
	});

	const title = root.querySelector("[data-mg-left-sidebar-title]");
	if (title) title.textContent = tab.label;

	const body = root.querySelector("[data-mg-left-sidebar-body]");
	if (body) body.innerHTML = mgRenderLeftSidebarContent(tab.id);

	mgBindLeftSidebarContent(root, tab.id);

	mgSaveUiState({
		sidebarTab: tab.id
	});
}

function mgRenderLeftSidebarContent(tabId) {
	switch (tabId) {
		case "player":
			return mgRenderPlayerSidebarContent();

		case "crew":
			return mgRenderCrewSidebarContent();

		case "initiative":
			return mgRenderInitiativeSidebarContent();

		case "scenes":
			return mgRenderSceneSidebarContent();

		case "actors":
			return mgRenderActorSidebarContent();

		case "items":
			return mgRenderItemSidebarContent();

		case "journal":
			return mgRenderJournalSidebarContent();

		case "compendiums":
			return mgRenderCompendiumSidebarContent();

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

	root.querySelectorAll("[data-mg-open-actor]").forEach(button => {
		button.addEventListener("click", () => {
			const actor = game.actors.get(button.dataset.mgOpenActor);
			actor?.sheet?.render(true, { focus: true });
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
		});
	});

	root.querySelectorAll("[data-mg-open-journal]").forEach(button => {
		button.addEventListener("click", () => {
			const journal = game.journal.get(button.dataset.mgOpenJournal);
			journal?.sheet?.render(true, { focus: true });
		});
	});

	root.querySelectorAll("[data-mg-open-pack]").forEach(button => {
		button.addEventListener("click", () => {
			const pack = game.packs.get(button.dataset.mgOpenPack);
			pack?.render?.(true);
		});
	});

	root.querySelector("[data-mg-show-initiative]")?.addEventListener("click", () => {
		game.mgInitiative?.showBar?.();
	});

	root.querySelector("[data-mg-hide-initiative]")?.addEventListener("click", () => {
		game.mgInitiative?.hideBar?.();
	});

	root.querySelector("[data-mg-mount-initiative-sidebar]")?.addEventListener("click", async () => {
		await game.mgInitiativeSidebar?.mount?.();
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
}

function mgGetCharacterSidebarActor(root) {
	const panel = root?.querySelector("[data-mg-character-sidebar]");
	const actorId = panel?.dataset?.mgCharacterSidebar;
	return actorId ? game.actors.get(actorId) : null;
}

function mgRefreshLeftSidebarContent() {
	const root = document.getElementById(MG_UI_ID);
	const body = root?.querySelector("[data-mg-left-sidebar-body]");
	if (!root || !body) return;

	body.innerHTML = mgRenderLeftSidebarContent(mgActiveSidebarTab);
	mgBindLeftSidebarContent(root, mgActiveSidebarTab);
}

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
	const finalAttrMod = baseAttrMod + tempAttrMod;
	const pool = 2 + Math.abs(finalAttrMod);
	const rollType = finalAttrMod >= 0 ? "kh2" : "kl2";
	const edge = !!actor.system?.edgeNext;

	await evaluateRoll({
		formula: `${pool}d6${rollType}`,
		skillMod: auraAttrMod,
		modifierParts: [auraAttrMod],
		modifierBreakdown: auraAttrMod !== 0 ? [{
			key: "aura",
			label: aura.label || "Aura Modifier",
			icon: "fa-eye-evil",
			value: auraAttrMod
		}] : [],
		label: `Attr Roll: ${mgCapitalize(attrKey)}`,
		actor,
		edge,
		auraLabel: aura.label,
		auraAttrMod,
		auraSourceActorId: aura.sourceActorId,
		auraSourceTokenId: aura.sourceTokenId,
		auraIconClass: "fa-eye-evil"
	});

	if (edge) {
		await actor.update({ "system.edgeNext": false }, { render: false });
		mgRefreshCharacterEdgeButtons(actor, false);
	}
}

async function mgRollSkill(actor, skillKey) {
	if (!actor || !skillKey) return;

	const baseSkillMod = Number(actor.system?.skills?.[skillKey] ?? 0);
	const tempSkillMod = Number(actor.system?.tempSkillBonuses?.[skillKey] ?? 0);
	let attrKey = MG_SKILL_ATTRIBUTE_MAP[skillKey] ?? "guile";
	if (skillKey === "spark") attrKey = actor.system?.sparkAttribute ?? "guile";

	const baseAttrMod = Number(actor.system?.attributes?.[attrKey] ?? 0);
	const tempAttrMod = Number(actor.system?.tempAttributeBonuses?.[attrKey] ?? 0);
	const aura = mgGetActiveAuraPenalty(attrKey);
	const auraAttrMod = Number(aura.value ?? 0);
	const finalAttrMod = baseAttrMod + tempAttrMod;
	const finalSkillMod = baseSkillMod + tempSkillMod + auraAttrMod;
	const pool = 2 + Math.abs(finalAttrMod);
	const rollType = finalAttrMod >= 0 ? "kh2" : "kl2";
	const edge = !!actor.system?.edgeNext;

	await evaluateRoll({
		formula: `${pool}d6${rollType}`,
		skillMod: finalSkillMod,
		modifierParts: [baseSkillMod, tempSkillMod, auraAttrMod],
		modifierBreakdown: [
			{ key: "skill", label: "Skill Bonus", icon: "fa-user-plus", value: baseSkillMod },
			{ key: "temp", label: "Temporary Bonus", icon: "fa-handshake-angle", value: tempSkillMod },
			{ key: "aura", label: aura.label || "Aura Modifier", icon: "fa-eye-evil", value: auraAttrMod }
		],
		label: `Skill Roll: ${MG_SKILL_LABELS[skillKey] ?? skillKey}`,
		actor,
		edge,
		auraLabel: aura.label,
		auraAttrMod,
		auraSourceActorId: aura.sourceActorId,
		auraSourceTokenId: aura.sourceTokenId
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
		const choices = [-2, -1, 0, 1, 2, 3];
		const dlg = new Dialog({
			title,
			content: `
				<div class="mg-stat-picker">
					${choices.map(value => `
						<button type="button" data-value="${value}" class="${value === current ? "is-selected" : ""}">
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
			<div class="mg-left-empty mg-left-character-empty">
				<i class="fa-solid fa-user"></i>
				<h2>No character assigned.</h2>
				<p>Open Player Settings and assign a character to use this sidebar.</p>
			</div>
		`;
	}

	return mgRenderCharacterSidebar(actor);
}

function mgRenderCharacterSidebar(actor) {
	const img = actor.img || "icons/svg/mystery-man.svg";
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
	const hasSpark = sparkSlots > 0 || Number(actor.system?.skills?.spark ?? 0) !== 0;

	const resourcesBody = `
		<div class="mg-left-resource-stack">
			<div class="mg-left-resource-card">
				<label>Risk</label>
				${mgRenderIconTrack({
					kind: "risk",
					total: riskDice,
					filled: riskRemaining,
					dataAttr: 'data-mg-resource-dot="risk"'
				})}
			</div>

			<div class="mg-left-resource-card">
				<label>STO</label>
				${mgRenderIconTrack({
					kind: "sto",
					total: stoDisplayMax,
					filled: stoValue,
					dataAttr: 'data-mg-resource-dot="sto"'
				})}
			</div>

			<div class="mg-left-resource-card">
				<label>Slots</label>
				${mgRenderIconTrack({
					kind: "spark",
					total: sparkSlots,
					filled: sparkRemaining,
					dataAttr: 'data-mg-resource-dot="spark"'
				})}
			</div>
		</div>
	`;

	const attributesBody = `
		<div class="mg-left-attribute-actions">
			<button
				type="button"
				class="mg-left-edge-toggle ${actor.system?.edgeNext ? "is-active" : ""}"
				data-mg-edge-toggle="${actor.id}"
				aria-pressed="${actor.system?.edgeNext ? "true" : "false"}"
				title="Edge: your next Skill or Attribute roll is rolled twice"
			>
				<i class="fa-solid fa-scythe"></i>
				Edge
			</button>		

			<button type="button" class="mg-left-temp-bonuses" data-mg-temp-skill-bonuses>
				<i class="fa-solid fa-handshake-angle"></i>
				Temp Bonuses
			</button>
		</div>

		<div class="mg-left-attribute-stack">
			${MG_ATTRIBUTE_KEYS.map(attrKey => {
				const attrValue = Number(actor.system?.attributes?.[attrKey] ?? 0) || 0;
				const baseValue = Number(actor.system?.baseAttributes?.[attrKey] ?? attrValue) || 0;
				const tempValue = Number(actor.system?.tempAttributeBonuses?.[attrKey] ?? 0) || 0;

				return `
					<div class="mg-left-attribute-card" data-attr="${attrKey}">
						<button
							type="button"
							class="mg-left-attribute-roll"
							data-mg-roll-attribute="${attrKey}"
							data-base="${baseValue}"
							title="Click to roll. Right-click to edit base Attribute."
						>
							<span>${mgEsc(mgCapitalize(attrKey))}</span>
							<strong class="attribute-container">${mgSigned(attrValue)} ${tempValue ? `<em>${mgSigned(tempValue)}</em>` : ""}</strong>
						</button>

						<div class="mg-left-skill-grid">
							${(MG_SKILL_BUCKETS[attrKey] ?? []).map(skillKey => {
								const skillValue = Number(actor.system?.skills?.[skillKey] ?? 0) || 0;
								const tempSkill = Number(actor.system?.tempSkillBonuses?.[skillKey] ?? 0) || 0;

								return `
									<button
										type="button"
										class="mg-left-skill-roll"
										data-mg-roll-skill="${skillKey}"
										data-base="${skillValue}"
										title="Click to roll. Right-click to edit base Skill."
									>
										<span>${mgEsc(MG_SKILL_LABELS[skillKey] ?? skillKey)}</span>
										<strong class="skill-container">${skillValue}${tempSkill ? `<em>${mgSigned(tempSkill)}</em>` : ""}</strong>
									</button>
								`;
							}).join("")}
						</div>
					</div>
				`;
			}).join("")}
		</div>
	`;

	const sparkBody = `
		<div class="mg-left-spark-panel">
			<button
				type="button"
				class="mg-left-skill-roll mg-left-spark-skill"
				data-mg-roll-skill="spark"
				data-base="${Number(actor.system?.skills?.spark ?? 0) || 0}"
			>
				<span>Spark</span>
				<strong>${Number(actor.system?.skills?.spark ?? 0) || 0}</strong>
			</button>

			${mgRenderIconTrack({
				kind: "spark",
				total: sparkSlots,
				filled: sparkRemaining,
				dataAttr: 'data-mg-resource-dot="spark"'
			})}
		</div>
	`;

	return `
		<section class="mg-left-character-panel" data-mg-character-sidebar="${actor.id}">
			<header class="mg-left-character-identity">
				<div class="mg-left-character-name">
					<h3>${mgEsc(actor.name)}</h3>
				</div>

				<div class="mg-left-character-crew">
					<p class="guise">${mgEsc(guiseName)}</p>
					<p class="crew">${mgEsc(crewName)}</p>
				</div>
			</header>

			<img class="mg-left-character-img" src="${img}" alt="${mgEsc(actor.name)}" />

			<div class="mg-left-strain-stack">
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

			${mgRenderAccordion(actor, {
				id: "spark",
				title: "Spark",
				icon: "fa-kit fa-spark",
				open: hasSpark,
				body: sparkBody
			})}
		</section>
	`;
}

function mgRenderStrainRow(type, label, cap, track) {
	return `
		<div class="mg-left-strain-row" data-mg-strain-row="${type}">
			<div class="mg-left-capacity-badge">
				<label>${label}</label>
				<div class="mg-left-capacity-controls" data-type="${type}">
					<button type="button" data-mg-cap-tick="${type}" data-dir="-1" aria-label="Decrease ${label}">
						<i class="fa-solid fa-minus"></i>
					</button>
					<span class="capacity-value" data-type="${type}">${cap}</span>
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

	return `
		<section class="mg-left-card mg-left-crew-card">
			<img class="mg-left-card-img" src="${img}" alt="${crew.name}" />

			<div class="mg-left-card-body">
				<label>Crew / Party</label>
				<h3>${crew.name}</h3>
				<p>Shared party resources and crew sheet.</p>

				<button type="button" class="mg-left-action" data-mg-open-actor="${crew.id}">
					<i class="fa-solid fa-up-right-from-square"></i>
					Open Crew
				</button>
			</div>
		</section>
	`;
}

function mgRenderInitiativeSidebarContent() {
	return `
		<section class="mg-left-section">
			<button type="button" class="mg-left-action" data-mg-show-initiative>
				<i class="fa-solid fa-swords"></i>
				Show Initiative
			</button>

			<button type="button" class="mg-left-action" data-mg-hide-initiative>
				<i class="fa-solid fa-eye-slash"></i>
				Hide Initiative
			</button>

			<button type="button" class="mg-left-action" data-mg-mount-initiative-sidebar>
				<i class="fa-solid fa-sidebar"></i>
				Mount Sidebar Initiative
			</button>
		</section>
	`;
}

function mgRenderSceneSidebarContent() {
	const scenes = Array.from(game.scenes ?? []);

	if (!scenes.length) {
		return `<div class="mg-left-empty">No scenes found.</div>`;
	}

	return `
		<section class="mg-left-list">
			${scenes.map(scene => `
				<button type="button" class="mg-left-list-row" data-mg-open-scene="${scene.id}">
					<i class="fa-solid fa-map"></i>
					<span>${scene.name}</span>
				</button>
			`).join("")}
		</section>
	`;
}

function mgRenderActorSidebarContent() {
	const actors = Array.from(game.actors ?? [])
		.filter(actor => game.user.isGM || actor.isOwner);

	if (!actors.length) {
		return `<div class="mg-left-empty">No visible actors found.</div>`;
	}

	return `
		<section class="mg-left-list">
			${actors.map(actor => `
				<button type="button" class="mg-left-list-row" data-mg-open-actor="${actor.id}">
					<img src="${actor.img || "icons/svg/mystery-man.svg"}" alt="" />
					<span>${actor.name}</span>
				</button>
			`).join("")}
		</section>
	`;
}

function mgRenderItemSidebarContent() {
	const items = Array.from(game.items ?? []);

	if (!items.length) {
		return `<div class="mg-left-empty">No world items found.</div>`;
	}

	return `
		<section class="mg-left-list">
			${items.map(item => `
				<button type="button" class="mg-left-list-row" data-mg-open-item="${item.id}">
					<img src="${item.img || "icons/svg/item-bag.svg"}" alt="" />
					<span>${item.name}</span>
				</button>
			`).join("")}
		</section>
	`;
}

function mgRenderJournalSidebarContent() {
	const journals = Array.from(game.journal ?? []);

	if (!journals.length) {
		return `<div class="mg-left-empty">No journal entries found.</div>`;
	}

	return `
		<section class="mg-left-list">
			${journals.map(journal => `
				<button type="button" class="mg-left-list-row" data-mg-open-journal="${journal.id}">
					<i class="fa-solid fa-book-open"></i>
					<span>${journal.name}</span>
				</button>
			`).join("")}
		</section>
	`;
}

function mgRenderCompendiumSidebarContent() {
	const packs = Array.from(game.packs ?? []);

	if (!packs.length) {
		return `<div class="mg-left-empty">No compendiums found.</div>`;
	}

	return `
		<section class="mg-left-list">
			${packs.map(pack => `
				<button type="button" class="mg-left-list-row" data-mg-open-pack="${pack.collection}">
					<i class="fa-solid fa-box-archive"></i>
					<span>${pack.metadata?.label || pack.collection}</span>
				</button>
			`).join("")}
		</section>
	`;
}

function mgRenderSettingsSidebarContent() {
	return `
		<section class="mg-left-section">
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

	document.querySelectorAll(".mg-orb-subtool").forEach(button => {
		const toolName = button.dataset.mgSubtool || button.dataset.mgCustomSubtool;
		button.classList.toggle("is-active", toolName === activeTool);
	});

	mgSetOrbBadge(mgActiveControl, mgActiveTool);
}
/**
 * Keep active styles roughly synced when Foundry controls rerender.
 */
Hooks.on("renderSceneControls", () => {
  mgRefreshActiveControl();
  mgRefreshActiveTool();
});

Hooks.on("renderPlayers", mgRefreshDockedPlayersBox);
Hooks.on("renderPlayerList", mgRefreshDockedPlayersBox);
Hooks.on("updateActor", actor => {
	if (mgActiveSidebarTab !== "player") return;
	const sidebarActor = game.user?.character;

	if (actor?.id === sidebarActor?.id) mgRefreshLeftSidebarContent();
});
Hooks.on("updateUser", user => {
	if (user?.id === game.user?.id) mgRefreshLeftSidebarTabs();
	mgRefreshDockedPlayersBox();
});

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
