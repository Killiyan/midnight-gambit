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

/**
 * Main Foundry canvas control groups shown in the MG Orb rail.
 */
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

/**
 * Fallback subtools in case Foundry's ui.controls data is incomplete.
 * These names should match common Foundry v11 tool names.
 */
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
    { name: "rect", label: "Rectangle", icon: "fa-regular fa-square" },
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

/**
 * Creates the entire MG UI root once.
 */
function mgCreateUiRoot() {
  if (document.getElementById(MG_UI_ID)) return;

  const root = document.createElement("div");
  root.id = MG_UI_ID;
  root.className = "mg-ui-root";

  root.innerHTML = `
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
  mgRefreshActiveControl();
}

/**
 * Builds the horizontal main rail buttons.
 */
function mgRenderControlButtons() {
  const controls = MG_CANVAS_CONTROLS.filter(control => {
    if (control.gmOnly && !game.user.isGM) return false;
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
      data-mg-action="clocks"
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
      <i class="fa-solid fa-forward-step"></i>
    </button>
  `;

  return `${foundryButtons}${mgButtons}`;
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
	return MG_CANVAS_CONTROLS.find(c => c.control === controlName) ?? null;
}

function mgGetToolMeta(controlName, toolName) {
	if (!controlName || !toolName) return null;
	return mgGetToolsForControl(controlName).find(t => t.name === toolName) ?? null;
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

/* Centralized Foundry Scene Control Handling
==============================================================================================================================================*/

function mgGetFoundryControl(controlName) {
  return ui.controls?.controls?.find(c => c.name === controlName) ?? null;
}

function mgGetFoundryTool(controlName, toolName) {
  const control = mgGetFoundryControl(controlName);
  return control?.tools?.find(t => t.name === toolName) ?? null;
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
    return false;
  }

  nativeControl.dispatchEvent(new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    view: window
  }));

  await mgNextFrame();
  return true;
}

/**
 * Clicks Foundry's real native tool button.
 * Foundry v11 renders subtools in a separate controls list, not always nested
 * inside the main control button, so we activate the control first, then search
 * for the active subtool button globally inside #controls.
 */
async function mgClickNativeTool(controlName, toolName) {
  if (!controlName || !toolName) return false;

  const safeTool = mgCssEscape(toolName);

  // First activate the parent control using Foundry's own button.
  const controlClicked = await mgClickNativeControl(controlName);
  if (!controlClicked) return false;

  await mgNextFrame();

  const candidates = Array.from(document.querySelectorAll([
    `#controls [data-tool="${safeTool}"]`,
    `#controls li.control-tool[data-tool="${safeTool}"]`,
    `#controls li[data-tool="${safeTool}"]`,
    `#controls button[data-tool="${safeTool}"]`,
    `#controls a[data-tool="${safeTool}"]`
  ].join(",")));

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
    return false;
  }

  nativeButton.dispatchEvent(new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    view: window
  }));

  await mgNextFrame();
  return true;
}

/**
 * Activates a Foundry canvas control group.
 */
async function mgActivateFoundryControl(controlName) {
	if (!controlName) return;

	const foundryControl = mgGetFoundryControl(controlName);
	if (!foundryControl) {
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

/**
 * Updates active visual state on the MG main rail.
 */
function mgRefreshActiveControl(forcedControl = null) {
  const active = forcedControl || ui.controls?.activeControl || ui.controls?.control?.name || "";
  mgActiveControl = active || mgActiveControl;

  document.querySelectorAll(".mg-orb-tool[data-mg-control]").forEach(button => {
    button.classList.toggle("is-active", button.dataset.mgControl === mgActiveControl);
  });
}

/**
 * Updates active visual state on the subtool rail.
 */
function mgRefreshActiveTool(forcedTool = null) {
	const activeTool =
		forcedTool ||
		ui.controls?.activeTool ||
		ui.controls?.tool?.name ||
		mgActiveTool ||
		"";

	if (activeTool) mgActiveTool = activeTool;

	document.querySelectorAll(".mg-orb-subtool[data-mg-subtool]").forEach(button => {
		button.classList.toggle("is-active", button.dataset.mgSubtool === activeTool);
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

async function mgRestoreUiState() {
	const state = mgLoadUiState();
	if (!state || (!state.activeControl && !state.orbOpen)) return;

	const root = document.getElementById(MG_UI_ID);
	const wrap = root?.querySelector("[data-mg-orb-wrap]");
	if (!root || !wrap) return;

	mgActiveControl = state.activeControl || mgActiveControl;
	mgActiveTool = state.activeTool || mgActiveTool;

	// Restore Foundry's actual selected control/tool.
	if (mgActiveControl && mgActiveTool) {
		await mgActivateFoundryTool(mgActiveControl, mgActiveTool);
	} else if (mgActiveControl) {
		await mgActivateFoundryControl(mgActiveControl);
	}

	mgRefreshActiveControl(mgActiveControl);
	mgRefreshActiveTool(mgActiveTool);
	mgSetOrbBadge(mgActiveControl, mgActiveTool);

	if (state.orbOpen) {
		wrap.classList.add("is-open");

		const sourceButton = root.querySelector(`[data-mg-control="${mgActiveControl}"]`);
		if (sourceButton) {
			mgOpenSubbar(mgActiveControl, sourceButton);
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
		document.getElementById(MG_UI_ID)?.remove();
		mgCreateUiRoot();
		}
  };
});