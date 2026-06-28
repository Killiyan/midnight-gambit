const MG_UI_NS = "midnight-gambit";
const MG_ACTOR_FOLDER_PLAYER_VISIBLE_FLAG = "playersCanSeeFolder";
const MG_ACTOR_USER_ORDER_FLAG = "actorSidebarOrder";
const MG_ACTOR_GUISE_IMAGE = "systems/midnight-gambit/assets/images/guise.jpg";
const MG_ACTOR_DEFAULT_IMAGE = "icons/svg/mystery-man.svg";

function mgShared() {
	return globalThis.MGSidebarShared ?? {};
}

function mgEsc(value) {
	const shared = mgShared();
	if (typeof shared.esc === "function") return shared.esc(value);
	const div = document.createElement("div");
	div.textContent = String(value ?? "");
	return div.innerHTML;
}

function mgAttr(value) {
	const shared = mgShared();
	if (typeof shared.attr === "function") return shared.attr(value);
	return mgEsc(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function mgCssUrl(value) {
	const shared = mgShared();
	if (typeof shared.cssUrl === "function") return shared.cssUrl(value);
	return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function mgCssEscape(value) {
	const shared = mgShared();
	if (typeof shared.cssEscape === "function") return shared.cssEscape(value);
	if (window.CSS?.escape) return CSS.escape(String(value));
	return String(value).replace(/"/g, '\\"');
}

function mgGetActorSidebarImage(actor) {
	const shared = mgShared();
	if (typeof shared.getActorPlacementImage === "function") {
		const override = shared.getActorPlacementImage(actor, "actorSidebar", "");
		if (override) return override;
	}
	const img = String(actor?.img ?? "").trim();
	if (!img || img === MG_ACTOR_DEFAULT_IMAGE || img.endsWith("/mystery-man.svg")) return MG_ACTOR_GUISE_IMAGE;
	return img;
}

function mgGetFoundryAppClass(className) {
	const candidates = [
		globalThis[className],
		globalThis.foundry?.applications?.apps?.[className],
		globalThis.foundry?.applications?.sheets?.[className],
		globalThis.foundry?.applications?.api?.[className]
	];

	const direct = candidates.find(candidate => typeof candidate === "function");
	if (direct) return direct;

	const foundryRoot = globalThis.foundry;
	const seen = new Set();
	const stack = [foundryRoot].filter(Boolean);
	while (stack.length) {
		const current = stack.pop();
		if (!current || seen.has(current)) continue;
		seen.add(current);

		let names = [];
		try {
			names = Object.getOwnPropertyNames(current);
		} catch (_) {
			continue;
		}

		for (const name of names) {
			let value;
			try {
				value = current[name];
			} catch (_) {
				continue;
			}

			if (name === className && typeof value === "function") return value;
			if (value && typeof value === "object" && !seen.has(value)) stack.push(value);
		}
	}

	return null;
}

async function mgRenderFoundryApp(app) {
	if (!app || typeof app.render !== "function") return false;

	try {
		await app.render(true);
		return true;
	} catch (legacyErr) {
		try {
			await app.render({ force: true });
			return true;
		} catch (modernErr) {
			try {
				await app.render();
				return true;
			} catch (plainErr) {
				console.warn("MG UI | Foundry app render failed.", { legacyErr, modernErr, plainErr });
				return false;
			}
		}
	}
}

function mgGetActorCropVariables(actor, key, fallbacks = [], options = {}) {
	const shared = mgShared();
	if (typeof shared.getActorCropVariables === "function") {
		return shared.getActorCropVariables(actor, key, fallbacks, options);
	}

	const crops = actor?.getFlag?.(MG_UI_NS, "crops") || {};
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
	const shared = mgShared();
	if (typeof shared.hasActorCrop === "function") return shared.hasActorCrop(actor, key);
	const crop = actor?.getFlag?.(MG_UI_NS, "crops")?.[key]?.css;
	return !!(crop && Object.keys(crop).length);
}

function mgIsAccordionOpen(actor, id, fallback = true) {
	const shared = mgShared();
	return typeof shared.isAccordionOpen === "function" ? shared.isAccordionOpen(actor, id, fallback) : fallback;
}

function mgSetAccordionOpen(actor, id, open) {
	const shared = mgShared();
	if (typeof shared.setAccordionOpen === "function") shared.setAccordionOpen(actor, id, open);
}

function mgToggleLeftAccordion(button) {
	const shared = mgShared();
	if (typeof shared.toggleLeftAccordion === "function") shared.toggleLeftAccordion(button);
}

function mgCloseSceneContextMenu() {
	const shared = mgShared();
	if (typeof shared.closeContextMenu === "function") shared.closeContextMenu();
}

function mgCloseSceneContextMenuOnEscape(event) {
	const shared = mgShared();
	if (typeof shared.closeContextMenuOnEscape === "function") shared.closeContextMenuOnEscape(event);
}

/* Actor sidebar interactions
----------------------------------------------------------------------*/
function mgBindActorSidebarContent(root) {
	const panel = root?.querySelector(".mg-actor-directory");
	if (!panel) return;

	panel.querySelector("[data-mg-actor-search]")?.addEventListener("keydown", event => {
		if (event.key !== "Enter") return;
		event.preventDefault();
		mgFilterActorSidebar(panel, event.currentTarget.value);
	});

	panel.querySelector("[data-mg-actor-collapse-folders]")?.addEventListener("click", event => {
		event.preventDefault();
		mgCollapseActorFolders(panel);
	});

	panel.querySelectorAll("[data-mg-actor-create]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();
			await mgCreateActor(button.dataset.mgActorCreate || null);
		});
	});

	panel.querySelectorAll("[data-mg-actor-folder-create]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();
			await mgCreateActorFolder(button.dataset.mgActorFolderCreate || null);
		});
	});

	panel.querySelectorAll("[data-mg-actor-menu]").forEach(button => {
		button.addEventListener("click", event => {
			event.preventDefault();
			event.stopPropagation();
			const row = button.closest("[data-mg-actor-id]");
			mgOpenActorContextMenu(button.dataset.mgActorMenu, button, row);
		});
	});

	panel.querySelectorAll("[data-mg-actor-id]").forEach(row => {
		row.addEventListener("contextmenu", event => {
			event.preventDefault();
			event.stopPropagation();
			mgOpenActorContextMenu(row.dataset.mgActorId, row, row, event);
		});
	});

	panel.querySelectorAll("[data-mg-active-actor-id]").forEach(card => {
		card.addEventListener("contextmenu", event => {
			event.preventDefault();
			event.stopPropagation();
			mgOpenActorContextMenu(card.dataset.mgActiveActorId, card, card, event);
		});
	});

	panel.querySelectorAll("[data-mg-actor-folder-id]").forEach(folderEl => {
		folderEl.addEventListener("contextmenu", event => {
			event.preventDefault();
			event.stopPropagation();
			mgOpenActorFolderContextMenu(folderEl.dataset.mgActorFolderId, folderEl, event);
		});
	});

	mgBindActorSidebarDrag(panel);
}

/* Actor sidebar search filtering
----------------------------------------------------------------------*/
function mgFilterActorSidebar(panel, value) {
	const query = String(value ?? "").trim().toLowerCase();
	const rows = Array.from(panel.querySelectorAll("[data-mg-actor-id]"));
	let visibleRows = 0;

	rows.forEach(row => {
		const name = String(row.dataset.mgActorName ?? "").toLowerCase();
		const visible = !query || name.includes(query);
		row.hidden = !visible;
		if (visible) visibleRows += 1;
	});

	panel.querySelectorAll(".mg-actor-folder-accordion[data-mg-accordion]").forEach(accordion => {
		const hasVisibleActor = !!accordion.querySelector('[data-mg-actor-id]:not([hidden])');
		accordion.hidden = query ? !hasVisibleActor : false;

		if (query && hasVisibleActor && !accordion.classList.contains("is-open")) {
			const button = accordion.querySelector("[data-mg-accordion-toggle]");
			if (button) mgToggleLeftAccordion(button);
		}
	});

	const anyVisible = visibleRows > 0 || !!panel.querySelector('[data-mg-accordion]:not([hidden]) [data-mg-actor-id]:not([hidden])');
	const empty = panel.querySelector("[data-mg-actor-empty-search]");
	if (empty) empty.hidden = !query || anyVisible;
}

function mgCollapseActorFolders(panel) {
	panel.querySelectorAll(".mg-actor-folder-accordion[data-mg-accordion]").forEach(accordion => {
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

/* Actor sidebar drag and drop
----------------------------------------------------------------------*/
function mgBindActorSidebarDrag(panel) {
	let dragging = null;

	const getDragActorId = event =>
		event.dataTransfer?.getData("application/x-mg-actor-id") || event.dataTransfer?.getData("text/plain") || dragging?.dataset?.mgActorId || "";

	const getDragToken = () => {
		if (dragging?.dataset?.mgActorId) return mgActorOrderToken("actor", dragging.dataset.mgActorId);
		if (dragging?.dataset?.mgActorFolderId) return mgActorOrderToken("folder", dragging.dataset.mgActorFolderId);
		return "";
	};

	const clearDropState = () => {
		panel.querySelectorAll(".mg-actor-drop-target, .mg-actor-drop-folder").forEach(el => {
			el.classList.remove("mg-actor-drop-target", "mg-actor-drop-folder");
		});
	};

	const finalizeContainerOrder = async container => {
		const actorId = dragging?.dataset?.mgActorId;
		const draggedFolderId = dragging?.dataset?.mgActorFolderId;
		const dragToken = getDragToken();
		if (!dragToken || !container) return;

		const folderId = container.dataset.mgActorContainer || null;
		const originalFolderId = dragging.dataset.mgActorFolder || null;
		const originalDisplayContainer = dragging.dataset.mgActorDisplayContainer || "";
		const entries = Array.from(container.children)
			.filter(el => el.matches?.(".mg-actor-row[data-mg-actor-id], [data-mg-actor-folder-id]"));

		if (!entries.some(entry => mgActorOrderElementToken(entry) === dragToken)) {
			container.appendChild(dragging);
			entries.push(dragging);
		}

		if (!game.user?.isGM && mgNormalizeActorContainerId(folderId) !== mgNormalizeActorContainerId(originalDisplayContainer)) {
			container.querySelector(`[data-mg-actor-id="${mgCssEscape(actorId)}"]`)?.remove();
			return;
		}

		await mgSaveActorUserOrderFromContainer(container);

		if (actorId && game.user?.isGM && folderId !== originalFolderId) {
			const actor = game.actors?.get(actorId);
			await actor?.update({ folder: folderId || null });
		}
		if (draggedFolderId && game.user?.isGM && folderId !== originalDisplayContainer) {
			const folder = game.folders?.get(draggedFolderId);
			await folder?.update({ folder: folderId || null });
		}
	};

	const getDirectDropTarget = (event, container) => {
		const target = event.target.closest(".mg-actor-row[data-mg-actor-id], [data-mg-actor-folder-id]");
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

	panel.querySelectorAll(".mg-actor-row[data-mg-actor-id]").forEach(row => {
		row.setAttribute("draggable", "true");

		row.addEventListener("dragstart", event => {
			event.stopPropagation();
			const actorId = row.dataset.mgActorId || "";
			const actor = game.actors?.get(actorId);
			dragging = row;
			dragging.dataset.mgActorDisplayContainer = dragging.parentElement?.dataset?.mgActorContainer || "";
			row.classList.add("mg-dragging");
			event.dataTransfer?.setData("application/x-mg-actor-id", actorId);
			event.dataTransfer?.setData("text/plain", actor?.uuid
				? JSON.stringify({ type: "Actor", uuid: actor.uuid })
				: actorId);
			event.dataTransfer.effectAllowed = "copyMove";
		});

		row.addEventListener("dragend", () => {
			row.classList.remove("mg-dragging");
			dragging = null;
			clearDropState();
		});
	});

	panel.querySelectorAll("[data-mg-actor-folder-id]").forEach(folder => {
		folder.setAttribute("draggable", "true");

		folder.addEventListener("dragstart", event => {
			if (event.target.closest(".mg-actor-row[data-mg-actor-id]") || event.target.closest("[data-mg-actor-folder-id]") !== folder) return;
			event.stopPropagation();
			dragging = folder;
			dragging.dataset.mgActorDisplayContainer = dragging.parentElement?.dataset?.mgActorContainer || "";
			folder.classList.add("mg-dragging");
			event.dataTransfer?.setData("application/x-mg-actor-folder-id", folder.dataset.mgActorFolderId || "");
			event.dataTransfer?.setData("text/plain", folder.dataset.mgActorFolderId || "");
			event.dataTransfer.effectAllowed = "move";
		});

		folder.addEventListener("dragend", () => {
			if (dragging !== folder) return;
			folder.classList.remove("mg-dragging");
			dragging = null;
			clearDropState();
		});
	});

	panel.querySelectorAll("[data-mg-actor-container]").forEach(container => {
		container.addEventListener("dragover", event => {
			if (!dragging) return;
			const isRootContainer = container.dataset.mgActorContainer === "";
			const isDraggingFolder = !!dragging.dataset.mgActorFolderId;
			const allowsFolderPromotion = isDraggingFolder && game.user?.isGM && isRootContainer;
			if (!allowsFolderPromotion && (isDraggingFolder || !game.user?.isGM) && mgNormalizeActorContainerId(container.dataset.mgActorContainer) !== mgNormalizeActorContainerId(dragging.dataset.mgActorDisplayContainer)) return;
			const nearestContainer = event.target.closest("[data-mg-actor-container]");
			if (!isRootContainer && nearestContainer !== container) return;
			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = "move";
			clearDropState();
			container.classList.add("mg-actor-drop-target");

		});

		container.addEventListener("drop", async event => {
			if (!dragging) return;
			const isRootContainer = container.dataset.mgActorContainer === "";
			const isDraggingFolder = !!dragging.dataset.mgActorFolderId;
			const allowsFolderPromotion = isDraggingFolder && game.user?.isGM && isRootContainer;
			if (!allowsFolderPromotion && (isDraggingFolder || !game.user?.isGM) && mgNormalizeActorContainerId(container.dataset.mgActorContainer) !== mgNormalizeActorContainerId(dragging.dataset.mgActorDisplayContainer)) return;
			const nearestContainer = event.target.closest("[data-mg-actor-container]");
			if (!isRootContainer && nearestContainer !== container) return;
			event.preventDefault();
			event.stopPropagation();
			const target = getDirectDropTarget(event, container);
			if (target) insertDraggingNearTarget(event, container, target);
			clearDropState();
			await finalizeContainerOrder(container);
		});
	});

	panel.querySelectorAll("[data-mg-actor-folder-drop]").forEach(folderDrop => {
		folderDrop.addEventListener("dragover", event => {
			if (!dragging?.dataset?.mgActorId || !game.user?.isGM || !isFolderNestZone(event, folderDrop)) return;
			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = "move";
			clearDropState();
			folderDrop.classList.add("mg-actor-drop-folder");
		});

		folderDrop.addEventListener("drop", async event => {
			if (!dragging?.dataset?.mgActorId) return;
			const actorId = getDragActorId(event);
			const folderId = folderDrop.dataset.mgActorFolderDrop || null;
			const actor = actorId ? game.actors?.get(actorId) : null;
			if (!actor || !game.user?.isGM || !isFolderNestZone(event, folderDrop)) return;

			event.preventDefault();
			event.stopPropagation();
			clearDropState();

			const folder = game.folders?.get(folderId);
			await actor.update({ folder: folderId || null });
			await mgAppendActorToUserOrder(folderId, actor.id);

			if (folder) mgSetAccordionOpen(null, `actor-folder-${folder.id}`, true);
		});
	});
}

/* Actor sidebar per-user ordering
----------------------------------------------------------------------*/
function mgNormalizeActorContainerId(folderId) {
	return folderId || "";
}

function mgGetActorUserOrder() {
	const order = game.user?.getFlag?.(MG_UI_NS, MG_ACTOR_USER_ORDER_FLAG);
	return order && typeof order === "object" && !Array.isArray(order) ? { ...order } : {};
}

function mgGetActorUserOrderKey(folderId) {
	return mgNormalizeActorContainerId(folderId) || "root";
}

function mgActorOrderToken(type, id) {
	return `${type}:${id}`;
}

function mgActorOrderEntryToken(entry) {
	if (entry.type === "folder") return mgActorOrderToken("folder", entry.id);
	return mgActorOrderToken("actor", entry.id);
}

function mgActorOrderElementToken(element) {
	if (element?.dataset?.mgActorFolderId) return mgActorOrderToken("folder", element.dataset.mgActorFolderId);
	if (element?.dataset?.mgActorId) return mgActorOrderToken("actor", element.dataset.mgActorId);
	return "";
}

async function mgSetActorUserOrderForContainer(folderId, tokens) {
	const order = mgGetActorUserOrder();
	order[mgGetActorUserOrderKey(folderId)] = Array.from(new Set(tokens.filter(Boolean)));
	await game.user?.setFlag?.(MG_UI_NS, MG_ACTOR_USER_ORDER_FLAG, order);
}

async function mgSaveActorUserOrderFromContainer(container) {
	const folderId = container?.dataset?.mgActorContainer || "";
	const tokens = Array.from(container?.children ?? [])
		.map(el => mgActorOrderElementToken(el))
		.filter(Boolean);

	await mgSetActorUserOrderForContainer(folderId, tokens);
}

async function mgAppendActorToUserOrder(folderId, actorId) {
	const key = mgGetActorUserOrderKey(folderId);
	const order = mgGetActorUserOrder();
	const token = mgActorOrderToken("actor", actorId);
	order[key] = [...(order[key] ?? []).filter(existing => existing !== token), token];
	await game.user?.setFlag?.(MG_UI_NS, MG_ACTOR_USER_ORDER_FLAG, order);
}

/* Actor and actor folder creation
----------------------------------------------------------------------*/
async function mgCreateActor(folderId = null) {
	if (!game.user?.isGM) return;

	try {
		if (typeof Actor?.createDialog === "function") {
			await Actor.createDialog({ folder: folderId || null }, { folder: folderId || null });
			return;
		}

		const actor = await Actor.create({ name: "New Actor", type: "character", folder: folderId || null }, { renderSheet: false });
		actor?.sheet?.render(true, { focus: true });
	} catch (err) {
		ui.notifications?.error("Could not create actor.");
		console.warn("MG UI | Create actor failed.", err);
	}
}

async function mgCreateActorFolder(parentId = null) {
	if (!game.user?.isGM) return;

	try {
		const parent = parentId ? game.folders?.get(parentId) : null;
		if (parent && mgGetActorFolderDepth(parent) > 0) {
			ui.notifications?.warn("Actor folders can only be nested one level deep.");
			return;
		}

		if (typeof Folder?.createDialog === "function") {
			await Folder.createDialog({ type: "Actor", folder: parentId || null }, { folder: parentId || null });
			return;
		}

		const folder = await Folder.create({ name: "New Folder", type: "Actor", folder: parentId || null }, { renderSheet: false });
		folder?.sheet?.render(true, { focus: true });
	} catch (err) {
		ui.notifications?.error("Could not create actor folder.");
		console.warn("MG UI | Create actor folder failed.", err);
	}
}

/* Actor context menus
----------------------------------------------------------------------*/
function mgOpenActorContextMenu(actorId, anchor, row, event = null) {
	const actor = game.actors?.get(actorId);
	if (!actor) return;

	mgCloseSceneContextMenu();

	const canManage = game.user?.isGM;
	const menu = document.createElement("nav");
	menu.className = "mg-scene-context-menu mg-actor-context-menu";
	menu.dataset.mgActorContextMenu = actor.id;
	menu.innerHTML = `
		<button type="button" data-mg-actor-action="edit"><i class="fa-solid fa-pen-to-square"></i> Edit Actor</button>
		<button type="button" data-mg-actor-action="artwork"><i class="fa-solid fa-image"></i> View Artwork</button>
		${canManage ? `<button type="button" data-mg-actor-action="ownership"><i class="fa-solid fa-user-shield"></i> Configure Ownership</button>` : ""}
		<button type="button" data-mg-actor-action="export"><i class="fa-solid fa-file-export"></i> Export Data</button>
		${canManage ? `<button type="button" data-mg-actor-action="import"><i class="fa-solid fa-file-import"></i> Import Data</button>` : ""}
		${canManage ? `<button type="button" data-mg-actor-action="duplicate"><i class="fa-regular fa-copy"></i> Duplicate</button>` : ""}
		${canManage ? `<button type="button" class="danger" data-mg-actor-action="delete"><i class="fa-solid fa-trash"></i> Delete</button>` : ""}
	`;

	menu.addEventListener("click", async clickEvent => {
		const button = clickEvent.target.closest("[data-mg-actor-action]");
		if (!button) return;

		clickEvent.preventDefault();
		clickEvent.stopPropagation();
		mgCloseSceneContextMenu();
		await mgRunActorAction(actor, button.dataset.mgActorAction);
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

function mgOpenActorFolderContextMenu(folderId, anchor, event = null) {
	const folder = game.folders?.get(folderId);
	if (!folder || folder.type !== "Actor" || !game.user?.isGM) return;

	mgCloseSceneContextMenu();

	const menu = document.createElement("nav");
	menu.className = "mg-scene-context-menu mg-actor-folder-context-menu";
	menu.dataset.mgActorFolderContextMenu = folder.id;
	menu.innerHTML = `
		<button type="button" data-mg-folder-action="edit"><i class="fa-solid fa-pen-to-square"></i> Edit Folder</button>
		<button type="button" data-mg-folder-action="remove"><i class="fa-solid fa-trash"></i> Remove Folder</button>
		<button type="button" class="danger" data-mg-folder-action="delete-all"><i class="fa-solid fa-box-archive"></i> Delete All</button>
	`;

	menu.addEventListener("click", async clickEvent => {
		const button = clickEvent.target.closest("[data-mg-folder-action]");
		if (!button) return;

		clickEvent.preventDefault();
		clickEvent.stopPropagation();
		mgCloseSceneContextMenu();
		await mgRunActorFolderAction(folder, button.dataset.mgFolderAction);
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

/* Actor context menu actions
----------------------------------------------------------------------*/
async function mgRunActorAction(actor, action) {
	try {
		switch (action) {
			case "edit":
				actor.sheet?.render(true, { focus: true });
				break;
			case "artwork":
				await mgViewActorArtwork(actor);
				break;
			case "ownership":
				await mgOpenActorOwnershipConfig(actor);
				break;
			case "export":
				actor.exportToJSON?.();
				break;
			case "import":
				actor.importFromJSONDialog?.();
				break;
			case "duplicate":
				await mgDuplicateActor(actor);
				break;
			case "delete":
				await mgDeleteActor(actor);
				break;
		}
	} catch (err) {
		ui.notifications?.error("Actor action failed.");
		console.warn("MG UI | Actor action failed.", { actor: actor?.id, action, err });
	}
}

async function mgViewActorArtwork(actor) {
	const src = mgGetActorSidebarImage(actor);
	const title = actor.name || "Actor Artwork";
	const ImagePopoutApp = mgGetFoundryAppClass("ImagePopout");

	if (ImagePopoutApp) {
		const configs = [
			() => new ImagePopoutApp({ src, uuid: actor.uuid, window: { title } }),
			() => new ImagePopoutApp(src, { title, uuid: actor.uuid }),
			() => new ImagePopoutApp({ src, title, uuid: actor.uuid })
		];

		for (const createApp of configs) {
			try {
				const app = createApp();
				if (await mgRenderFoundryApp(app)) return;
			} catch (err) {
				console.warn("MG UI | Actor artwork popout construction failed.", err);
			}
		}
	}

	mgOpenFallbackArtworkDialog(actor, src, title);
}

function mgOpenFallbackArtworkDialog(actor, src, title) {
	const content = `
		<figure class="mg-actor-artwork-popout">
			<img src="${mgEsc(src)}" alt="${mgAttr(actor.name)}" />
			<figcaption>${mgEsc(actor.name)}</figcaption>
		</figure>
	`;

	if (typeof Dialog === "function") {
		new Dialog({
			title,
			content,
			buttons: {
				close: {
					label: "Close"
				}
			},
			default: "close"
		}).render(true);
		return;
	}

	window.open(src, "_blank", "noopener");
}

async function mgOpenActorOwnershipConfig(actor) {
	const OwnershipConfig = mgGetFoundryAppClass("DocumentOwnershipConfig");

	if (OwnershipConfig) {
		const configs = [
			() => new OwnershipConfig({ document: actor }),
			() => new OwnershipConfig(actor)
		];

		for (const createApp of configs) {
			try {
				const app = createApp();
				if (await mgRenderFoundryApp(app)) return;
			} catch (err) {
				console.warn("MG UI | Actor ownership config construction failed.", err);
			}
		}
	}

	await mgOpenFallbackOwnershipDialog(actor);
}

async function mgOpenFallbackOwnershipDialog(actor) {
	if (!game.user?.isGM) return;

	const levels = mgGetOwnershipLevels();
	const defaultLevels = levels.filter(level => level.value >= 0);
	const ownership = { ...(actor.ownership ?? {}) };
	const users = Array.from(game.users ?? []);
	const renderSelect = (name, value, choices = levels) => `
		<select name="${mgAttr(name)}">
			${choices.map(level => `<option value="${level.value}" ${Number(value) === level.value ? "selected" : ""}>${mgEsc(level.label)}</option>`).join("")}
		</select>
	`;
	const rows = users.map(user => `
		<div class="form-group">
			<label>${mgEsc(user.name)}</label>
			<div class="form-fields">
				${renderSelect(`user.${user.id}`, ownership[user.id] ?? -1)}
			</div>
		</div>
	`).join("");

	const content = `
		<form class="mg-actor-ownership-form">
			<div class="form-group">
				<label>Default</label>
				<div class="form-fields">
					${renderSelect("default", ownership.default ?? 0, defaultLevels)}
				</div>
			</div>
			${rows}
		</form>
	`;

	return Dialog.confirm({
		title: `Configure Ownership: ${actor.name}`,
		content,
		yes: async html => {
			const root = html?.jquery ? html[0] : html?.[0] ?? html;
			const form = root?.querySelector?.(".mg-actor-ownership-form");
			if (!form) return;

			const next = {};
			const defaultValue = Number(form.querySelector('[name="default"]')?.value ?? 0);
			next.default = Number.isFinite(defaultValue) ? defaultValue : 0;

			for (const user of users) {
				const raw = Number(form.elements?.[`user.${user.id}`]?.value ?? -1);
				if (Number.isFinite(raw) && raw >= 0) next[user.id] = raw;
			}

			await actor.update({ ownership: next });
		},
		no: () => false,
		defaultYes: false
	});
}

function mgGetOwnershipLevels() {
	const constants = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS ?? {};
	const fallback = {
		NONE: 0,
		LIMITED: 1,
		OBSERVER: 2,
		OWNER: 3
	};
	const source = Object.keys(constants).length ? constants : fallback;
	const labels = {
		"-1": "Default",
		[source.NONE]: "None",
		[source.LIMITED]: "Limited",
		[source.OBSERVER]: "Observer",
		[source.OWNER]: "Owner"
	};

	return [
		{ value: -1, label: labels["-1"] },
		{ value: source.NONE ?? 0, label: labels[source.NONE ?? 0] ?? "None" },
		{ value: source.LIMITED ?? 1, label: labels[source.LIMITED ?? 1] ?? "Limited" },
		{ value: source.OBSERVER ?? 2, label: labels[source.OBSERVER ?? 2] ?? "Observer" },
		{ value: source.OWNER ?? 3, label: labels[source.OWNER ?? 3] ?? "Owner" }
	];
}

async function mgDuplicateActor(actor) {
	const data = actor.toObject();
	delete data._id;
	data.name = `${actor.name} Copy`;
	await Actor.create(data, { renderSheet: true });
}

async function mgDeleteActor(actor) {
	if (typeof actor.deleteDialog === "function") {
		await actor.deleteDialog();
		return;
	}

	const confirmed = await Dialog.confirm({
		title: `Delete ${actor.name}?`,
		content: `<p>Delete <strong>${mgEsc(actor.name)}</strong>?</p>`,
		yes: () => true,
		no: () => false,
		defaultYes: false
	});

	if (confirmed) await actor.delete();
}

async function mgRunActorFolderAction(folder, action) {
	try {
		switch (action) {
			case "edit":
				folder.sheet?.render(true, { focus: true });
				break;
			case "remove":
				await mgRemoveActorFolderOnly(folder);
				break;
			case "delete-all":
				await mgDeleteActorFolderContents(folder);
				break;
		}
	} catch (err) {
		ui.notifications?.error("Actor folder action failed.");
		console.warn("MG UI | Actor folder action failed.", { folder: folder?.id, action, err });
	}
}

function mgGetActorFolderChildren(folder) {
	const folderId = folder?.id ?? null;
	const folders = Array.from(game.folders ?? [])
		.filter(child => child.type === "Actor" && (child.folder?.id ?? child.folder ?? null) === folderId);
	const actors = Array.from(game.actors ?? [])
		.filter(actor => (actor.folder?.id ?? actor.folder ?? null) === folderId);

	return { folders, actors };
}

function mgCollectActorFolderTree(folder, out = { folders: [], actors: [] }) {
	const { folders, actors } = mgGetActorFolderChildren(folder);
	out.folders.push(folder);
	out.actors.push(...actors);
	folders.forEach(child => mgCollectActorFolderTree(child, out));
	return out;
}

async function mgRemoveActorFolderOnly(folder) {
	const parentId = folder.folder?.id ?? folder.folder ?? null;
	const { folders, actors } = mgGetActorFolderChildren(folder);
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
		...actors.map(actor => actor.update({ folder: parentId }))
	]);
	await folder.delete();
}

async function mgDeleteActorFolderContents(folder) {
	const collected = mgCollectActorFolderTree(folder);
	const confirmed = await Dialog.confirm({
		title: `Delete all in ${folder.name}?`,
		content: `<p>Delete <strong>${mgEsc(folder.name)}</strong>, ${collected.folders.length - 1} subfolders, and ${collected.actors.length} actors?</p>`,
		yes: () => true,
		no: () => false,
		defaultYes: false
	});

	if (!confirmed) return;

	const actorIds = collected.actors.map(actor => actor.id);
	const folderIds = collected.folders.map(f => f.id).reverse();
	if (actorIds.length && typeof Actor.deleteDocuments === "function") await Actor.deleteDocuments(actorIds);
	else await Promise.all(actorIds.map(id => game.actors?.get(id)?.delete()));
	if (folderIds.length && typeof Folder.deleteDocuments === "function") await Folder.deleteDocuments(folderIds);
	else await Promise.all(folderIds.map(id => game.folders?.get(id)?.delete()));
}

/* Actor sidebar rendering
----------------------------------------------------------------------*/
function mgRenderActorSidebarContent() {
	const canManage = game.user?.isGM;
	const actors = Array.from(game.actors ?? [])
		.filter(actor => canManage || mgCanUserSeeActor(actor));
	const folderTree = mgBuildActorFolderTree(actors, { showAllFolders: canManage });
	const assignedActor = game.user?.character ?? null;
	const controls = canManage ? `
		<section class="mg-scene-directory-actions mg-actor-directory-actions">
			<button type="button" class="mg-left-action" data-mg-actor-create>
				<i class="fa-solid fa-user-plus"></i>
				Create Actor
			</button>
			<button type="button" class="mg-left-action" data-mg-actor-folder-create>
				<i class="fa-solid fa-folder"></i>
				Create Folder
			</button>
		</section>
	` : "";
	const search = `
		<label class="mg-scene-search mg-actor-search">
			<i class="fa-solid fa-magnifying-glass"></i>
			<input type="search" placeholder="Search Actors" data-mg-actor-search />
		</label>
	`;
	const collapseFolders = canManage ? `
		<button type="button" class="mg-left-action mg-actor-collapse-folders" data-mg-actor-collapse-folders>
			<i class="fa-solid fa-folder-tree"></i>
			Collapse Folders
		</button>
	` : "";

	if (!actors.length) {
		return `
			<section class="mg-scene-directory mg-actor-directory">
				<div class="mg-scene-directory-header">
					${controls}
					${assignedActor ? mgRenderAssignedActorCard(assignedActor) : ""}
				</div>
				<div class="mg-left-empty">No visible actors found.</div>
			</section>
		`;
	}

	return `
		<section class="mg-scene-directory mg-actor-directory">
			<div class="mg-scene-directory-header">
				${controls}
				${assignedActor ? mgRenderAssignedActorCard(assignedActor) : ""}
			</div>

			<div class="mg-scene-directory-browser mg-actor-directory-browser">
				${search}
				<hr class="mg-scene-directory-rule mg-actor-directory-rule" />
				${collapseFolders}

				<div class="mg-scene-tree mg-actor-tree" data-mg-actor-tree data-mg-actor-container="">
					${mgRenderActorBranch(folderTree)}
				</div>

				<div class="mg-left-empty mg-actor-empty-search" data-mg-actor-empty-search hidden>
					No actors match this search.
				</div>
			</div>
		</section>
	`;
}

function mgRenderAssignedActorCard(actor) {
	const img = mgGetActorSidebarImage(actor);
	const hasCrop = mgHasActorCrop(actor, "actorSidebar");
	const cropVariables = hasCrop ? mgGetActorCropVariables(actor, "actorSidebar", [], { ignoreHeight: true }) : "";

	return `
		<section class="mg-active-scene mg-active-actor" data-mg-active-actor-id="${actor.id}">
			<button type="button" class="mg-active-scene-card mg-active-actor-card" data-mg-open-actor="${actor.id}">
				<span class="mg-actor-row-image mg-active-actor-image mg-cropbox ${hasCrop ? "is-cropped" : ""}" aria-hidden="true">
					<img src="${mgEsc(img)}" alt="" style="${cropVariables}" />
				</span>
				<span class="mg-active-scene-scrim"></span>
				<span class="mg-active-scene-kicker"><i class="fa-solid fa-user"></i> Your Character</span>
				<span class="mg-active-scene-title">${mgEsc(actor.name)}</span>
			</button>
		</section>
	`;
}

/* Actor sidebar tree shaping
----------------------------------------------------------------------*/
function mgCanUserSeeActor(actor) {
	if (!actor) return false;
	if (actor.visible !== false) return true;
	try {
		return actor.testUserPermission?.(game.user, "LIMITED") ?? actor.isOwner;
	} catch (_) {
		return !!actor.isOwner;
	}
}

function mgCanPlayerSeeActorFolder(folder) {
	return !!folder?.getFlag?.(MG_UI_NS, MG_ACTOR_FOLDER_PLAYER_VISIBLE_FLAG);
}

function mgBuildActorFolderTree(actors, { showAllFolders = true } = {}) {
	const actorFolders = Array.from(game.folders ?? [])
		.filter(folder => folder.type === "Actor")
		.filter(folder => showAllFolders || mgCanPlayerSeeActorFolder(folder));
	const folderNodes = new Map(actorFolders.map(folder => [
		folder.id,
		{ folder, folders: [], actors: [] }
	]));
	const root = { folders: [], actors: [] };

	for (const node of folderNodes.values()) {
		const parentId = mgGetActorFolderTreeParentId(node.folder);
		const parent = parentId ? folderNodes.get(parentId) : null;
		(parent ?? root).folders.push(node);
	}

	for (const actor of actors) {
		const folderId = actor.folder?.id ?? actor.folder ?? null;
		const parent = folderId ? folderNodes.get(folderId) : null;
		(parent ?? root).actors.push(actor);
	}

	return root;
}

function mgGetActorFolderParentId(folder) {
	return folder?.folder?.id ?? folder?.folder ?? null;
}

function mgGetActorFolderDepth(folder) {
	let depth = 0;
	let current = folder;
	const seen = new Set();
	while (current && mgGetActorFolderParentId(current)) {
		const parentId = mgGetActorFolderParentId(current);
		if (seen.has(parentId)) break;
		seen.add(parentId);
		current = game.folders?.get(parentId);
		if (!current || current.type !== "Actor") break;
		depth += 1;
	}
	return depth;
}

function mgGetActorFolderTreeParentId(folder) {
	const parentId = mgGetActorFolderParentId(folder);
	if (!parentId) return null;
	const parent = game.folders?.get(parentId);
	if (!parent || parent.type !== "Actor") return null;
	return mgGetActorFolderDepth(parent) > 0 ? mgGetActorFolderParentId(parent) : parentId;
}

function mgRenderActorBranch(node, depth = 0) {
	const entries = [
		...node.folders.map(folderNode => ({
			type: "folder",
			id: folderNode.folder.id,
			name: folderNode.folder.name,
			html: mgRenderActorFolder(folderNode, depth)
		})),
		...node.actors.map(actor => ({
			type: "actor",
			id: actor.id,
			name: actor.name,
			html: mgRenderActorRow(actor)
		}))
	];
	const order = mgGetActorUserOrder()[mgGetActorUserOrderKey(node.folder?.id ?? null)] ?? [];
	const orderMap = new Map(order.map((token, index) => [token, index]));

	return entries
		.sort((a, b) => {
			const aOrder = orderMap.get(mgActorOrderEntryToken(a));
			const bOrder = orderMap.get(mgActorOrderEntryToken(b));
			if (aOrder !== undefined || bOrder !== undefined) return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER);
			return a.name.localeCompare(b.name) || a.type.localeCompare(b.type);
		})
		.map(entry => entry.html)
		.join("");
}

function mgRenderActorFolder(node, depth = 0) {
	const folder = node.folder;
	const id = `actor-folder-${folder.id}`;
	const isOpen = mgIsAccordionOpen(null, id, true);
	const canCreateSubfolder = game.user?.isGM && depth === 0;
	const body = mgRenderActorBranch(node, depth + 1) || `<div class="mg-left-empty mg-scene-folder-empty mg-actor-folder-empty">No actors in this folder.</div>`;
	const color = String(folder.color ?? "").trim();
	const iconStyle = color ? ` style="color: ${mgAttr(color)};"` : "";

	return `
		<section
			class="mg-left-accordion mg-scene-folder-accordion mg-actor-folder-accordion ${isOpen ? "is-open" : ""} ${depth > 0 ? "is-sub" : ""}"
			data-mg-accordion="${id}"
			data-mg-actor-folder-id="${folder.id}"
		>
			<div
				class="mg-left-accordion-toggle mg-scene-folder-toggle mg-actor-folder-toggle"
				data-mg-accordion-toggle="${id}"
				data-mg-actor-folder-drop="${folder.id}"
				aria-expanded="${isOpen ? "true" : "false"}"
			>
				<span><i class="fa-solid fa-folder" data-mg-actor-folder-icon${iconStyle}></i>${mgEsc(folder.name)}</span>
				<i class="fa-solid fa-chevron-down mg-left-accordion-chevron"></i>
			</div>
			<div class="mg-left-accordion-body" ${isOpen ? "" : "hidden"} style="max-height: ${isOpen ? "none" : "0px"};">
				<div class="mg-left-accordion-inner">
					<div class="mg-scene-folder-body mg-actor-folder-body" data-mg-actor-folder-body="${folder.id}" data-mg-actor-container="${folder.id}">
						${game.user?.isGM ? `
							<div class="mg-scene-folder-actions mg-actor-folder-actions">
								<button type="button" class="mg-scene-mini-action mg-actor-mini-action" data-mg-actor-create="${folder.id}" title="Create actor in ${mgAttr(folder.name)}" aria-label="Create actor in ${mgAttr(folder.name)}">
									<i class="fa-solid fa-user-plus"></i>
								</button>
								${canCreateSubfolder ? `
									<button type="button" class="mg-scene-mini-action mg-actor-mini-action" data-mg-actor-folder-create="${folder.id}" title="Create subfolder in ${mgAttr(folder.name)}" aria-label="Create subfolder in ${mgAttr(folder.name)}">
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

function mgRenderActorRow(actor) {
	const img = mgGetActorSidebarImage(actor);
	const hasCrop = mgHasActorCrop(actor, "actorSidebar");
	const cropVariables = hasCrop ? mgGetActorCropVariables(actor, "actorSidebar", [], { ignoreHeight: true }) : "";

	return `
		<article
			class="mg-scene-row mg-actor-row"
			data-mg-actor-id="${actor.id}"
			data-mg-actor-name="${mgAttr(actor.name)}"
			data-mg-actor-folder="${actor.folder?.id ?? actor.folder ?? ""}"
		>
			<button type="button" class="mg-scene-row-main mg-actor-row-main" data-mg-open-actor="${actor.id}">
				<span class="mg-actor-row-image mg-cropbox ${hasCrop ? "is-cropped" : ""}" aria-hidden="true">
					<img src="${mgEsc(img)}" alt="" style="${cropVariables}" />
				</span>
				<span class="mg-scene-row-scrim"></span>
				<span class="mg-scene-row-title mg-actor-row-title">${mgEsc(actor.name)}</span>
			</button>
			<button type="button" class="mg-scene-context-button mg-actor-context-button" data-mg-actor-menu="${actor.id}" title="Actor actions" aria-label="Actor actions for ${mgAttr(actor.name)}">
				<i class="fa-solid fa-ellipsis-vertical"></i>
			</button>
		</article>
	`;
}

/* Actor folder config cleanup
----------------------------------------------------------------------*/
function mgTidyActorFolderConfig(html, folder) {
	const root = html?.jquery ? html[0] : html?.[0] ?? html;
	if (!root?.querySelectorAll) return;

	mgHideFolderConfigSorting(root);

	const fieldName = `flags.${MG_UI_NS}.${MG_ACTOR_FOLDER_PLAYER_VISIBLE_FLAG}`;
	if (!root.querySelector(`[name="${fieldName}"]`)) {
		const field = document.createElement("div");
		field.className = "form-group mg-actor-folder-player-visible";
		field.innerHTML = `
			<label>Players Can See Folder</label>
			<div class="form-fields">
				<input type="checkbox" name="${fieldName}" data-dtype="Boolean" ${folder?.getFlag?.(MG_UI_NS, MG_ACTOR_FOLDER_PLAYER_VISIBLE_FLAG) ? "checked" : ""} />
			</div>
			<p class="hint">When unchecked, players still see owned or visible actors inside this folder as loose actor cards.</p>
		`;

		const colorInput = root.querySelector('[name="color"]');
		const colorGroup = colorInput?.closest?.(".form-group, .form-field, fieldset, .standard-form-group");
		if (colorGroup?.parentElement) colorGroup.after(field);
		else root.querySelector("form")?.prepend(field);
	}

	mgNormalizeActorFolderConfigLayout(root);
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

function mgNormalizeActorFolderConfigLayout(root) {
	const form = root.querySelector("form");
	if (!form || form.dataset.mgActorFolderLayoutNormalized === "true") return;

	form.dataset.mgActorFolderLayoutNormalized = "true";
	form.classList.add("mg-scene-folder-config-form", "mg-actor-folder-config-form");

	const fields = [
		root.querySelector('[name="name"]'),
		root.querySelector('[name="color"]'),
		root.querySelector(`[name="flags.${MG_UI_NS}.${MG_ACTOR_FOLDER_PLAYER_VISIBLE_FLAG}"]`)
	].filter(Boolean);

	fields.forEach(input => {
		const currentGroup = input.closest(".form-group, .form-field, fieldset, .standard-form-group");
		if (currentGroup?.classList.contains("mg-actor-folder-config-block")) return;

		const block = document.createElement("div");
		block.className = "form-group mg-scene-folder-config-block mg-actor-folder-config-block";
		const labelText = input.name === "name"
			? "Folder Name"
			: input.name === "color"
				? "Folder Color"
				: "Players Can See Folder";
		const hint = input.name.includes(MG_ACTOR_FOLDER_PLAYER_VISIBLE_FLAG)
			? `<p class="hint">When unchecked, players still see owned or visible actors inside this folder as loose actor cards.</p>`
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

globalThis.MGActorSidebar = {
	bindContent: mgBindActorSidebarContent,
	renderContent: mgRenderActorSidebarContent,
	tidyFolderConfig: mgTidyActorFolderConfig
};
