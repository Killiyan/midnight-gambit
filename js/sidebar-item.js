const MG_UI_NS = "midnight-gambit";
const MG_ITEM_USER_ORDER_FLAG = "itemSidebarOrder";
const MG_ITEM_CARD_IMAGE = "systems/midnight-gambit/assets/images/items.jpg";
const MG_ITEM_GUISE_IMAGE = "systems/midnight-gambit/assets/images/guise.jpg";
const MG_ITEM_DEFAULT_IMAGE = "icons/svg/item-bag.svg";

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

function mgCssEscape(value) {
	const shared = mgShared();
	if (typeof shared.cssEscape === "function") return shared.cssEscape(value);
	if (window.CSS?.escape) return CSS.escape(String(value));
	return String(value).replace(/"/g, '\\"');
}

function mgCssUrl(value) {
	const shared = mgShared();
	if (typeof shared.cssUrl === "function") return shared.cssUrl(value);
	return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function mgGetItemSidebarImage(item) {
	const img = String(item?.img ?? "").trim();
	const fallback = item?.type === "guise" ? MG_ITEM_GUISE_IMAGE : MG_ITEM_CARD_IMAGE;
	if (!img || img === MG_ITEM_DEFAULT_IMAGE || img.endsWith("/item-bag.svg")) return fallback;
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

function mgIsAccordionOpen(item, id, fallback = true) {
	const shared = mgShared();
	return typeof shared.isAccordionOpen === "function" ? shared.isAccordionOpen(item, id, fallback) : fallback;
}

function mgSetAccordionOpen(item, id, open) {
	const shared = mgShared();
	if (typeof shared.setAccordionOpen === "function") shared.setAccordionOpen(item, id, open);
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

/* Item sidebar interactions
----------------------------------------------------------------------*/
function mgBindItemSidebarContent(root) {
	const panel = root?.querySelector(".mg-item-directory");
	if (!panel) return;

	panel.querySelector("[data-mg-item-search]")?.addEventListener("keydown", event => {
		if (event.key !== "Enter") return;
		event.preventDefault();
		mgFilterItemSidebar(panel, event.currentTarget.value);
	});

	panel.querySelector("[data-mg-item-collapse-folders]")?.addEventListener("click", event => {
		event.preventDefault();
		mgCollapseItemFolders(panel);
	});

	panel.querySelectorAll("[data-mg-item-create]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();
			await mgCreateItem(button.dataset.mgItemCreate || null);
		});
	});

	panel.querySelectorAll("[data-mg-item-folder-create]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();
			await mgCreateItemFolder(button.dataset.mgItemFolderCreate || null);
		});
	});

	panel.querySelectorAll("[data-mg-item-menu]").forEach(button => {
		button.addEventListener("click", event => {
			event.preventDefault();
			event.stopPropagation();
			const row = button.closest("[data-mg-item-id]");
			mgOpenItemContextMenu(button.dataset.mgItemMenu, button, row);
		});
	});

	panel.querySelectorAll("[data-mg-item-id]").forEach(row => {
		row.addEventListener("contextmenu", event => {
			event.preventDefault();
			event.stopPropagation();
			mgOpenItemContextMenu(row.dataset.mgItemId, row, row, event);
		});
	});

	panel.querySelectorAll("[data-mg-item-folder-id]").forEach(folderEl => {
		folderEl.addEventListener("contextmenu", event => {
			event.preventDefault();
			event.stopPropagation();
			mgOpenItemFolderContextMenu(folderEl.dataset.mgItemFolderId, folderEl, event);
		});
	});

	mgBindItemSidebarDrag(panel);
}

function mgFilterItemSidebar(panel, value) {
	const query = String(value ?? "").trim().toLowerCase();
	const rows = Array.from(panel.querySelectorAll("[data-mg-item-id]"));
	let visibleRows = 0;

	rows.forEach(row => {
		const name = String(row.dataset.mgItemName ?? "").toLowerCase();
		const visible = !query || name.includes(query);
		row.hidden = !visible;
		if (visible) visibleRows += 1;
	});

	panel.querySelectorAll(".mg-item-folder-accordion[data-mg-accordion]").forEach(accordion => {
		const hasVisibleItem = !!accordion.querySelector('[data-mg-item-id]:not([hidden])');
		accordion.hidden = query ? !hasVisibleItem : false;

		if (query && hasVisibleItem && !accordion.classList.contains("is-open")) {
			const button = accordion.querySelector("[data-mg-accordion-toggle]");
			if (button) mgToggleLeftAccordion(button);
		}
	});

	const anyVisible = visibleRows > 0 || !!panel.querySelector('[data-mg-accordion]:not([hidden]) [data-mg-item-id]:not([hidden])');
	const empty = panel.querySelector("[data-mg-item-empty-search]");
	if (empty) empty.hidden = !query || anyVisible;
}

function mgCollapseItemFolders(panel) {
	panel.querySelectorAll(".mg-item-folder-accordion[data-mg-accordion]").forEach(accordion => {
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

/* Item sidebar drag and drop
----------------------------------------------------------------------*/
function mgBindItemSidebarDrag(panel) {
	let dragging = null;

	const getDragItemId = event =>
		event.dataTransfer?.getData("application/x-mg-item-id") || event.dataTransfer?.getData("text/plain") || dragging?.dataset?.mgItemId || "";

	const getDragToken = () => {
		if (dragging?.dataset?.mgItemId) return mgItemOrderToken("item", dragging.dataset.mgItemId);
		if (dragging?.dataset?.mgItemFolderId) return mgItemOrderToken("folder", dragging.dataset.mgItemFolderId);
		return "";
	};

	const clearDropState = () => {
		panel.querySelectorAll(".mg-item-drop-target, .mg-item-drop-folder").forEach(el => {
			el.classList.remove("mg-item-drop-target", "mg-item-drop-folder");
		});
	};

	const finalizeContainerOrder = async container => {
		const itemId = dragging?.dataset?.mgItemId;
		const draggedFolderId = dragging?.dataset?.mgItemFolderId;
		const dragToken = getDragToken();
		if (!dragToken || !container) return;

		const folderId = container.dataset.mgItemContainer || null;
		const originalFolderId = dragging.dataset.mgItemFolder || null;
		const originalDisplayContainer = dragging.dataset.mgItemDisplayContainer || "";
		const entries = Array.from(container.children)
			.filter(el => el.matches?.(".mg-item-row[data-mg-item-id], [data-mg-item-folder-id]"));

		if (!entries.some(entry => mgItemOrderElementToken(entry) === dragToken)) {
			container.appendChild(dragging);
			entries.push(dragging);
		}

		if (!game.user?.isGM && mgNormalizeItemContainerId(folderId) !== mgNormalizeItemContainerId(originalDisplayContainer)) {
			container.querySelector(`[data-mg-item-id="${mgCssEscape(itemId)}"]`)?.remove();
			return;
		}

		await mgSaveItemUserOrderFromContainer(container);

		if (itemId && game.user?.isGM && folderId !== originalFolderId) {
			const item = game.items?.get(itemId);
			await item?.update({ folder: folderId || null });
		}
		if (draggedFolderId && game.user?.isGM && folderId !== originalDisplayContainer) {
			const folder = game.folders?.get(draggedFolderId);
			await folder?.update({ folder: folderId || null });
		}
	};

	const getDirectDropTarget = (event, container) => {
		const target = event.target.closest(".mg-item-row[data-mg-item-id], [data-mg-item-folder-id]");
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

	panel.querySelectorAll(".mg-item-row[data-mg-item-id]").forEach(row => {
		row.setAttribute("draggable", "true");

		row.addEventListener("dragstart", event => {
			event.stopPropagation();
			const itemId = row.dataset.mgItemId || "";
			const item = game.items?.get(itemId);
			dragging = row;
			dragging.dataset.mgItemDisplayContainer = dragging.parentElement?.dataset?.mgItemContainer || "";
			row.classList.add("mg-dragging");
			event.dataTransfer?.setData("application/x-mg-item-id", itemId);
			event.dataTransfer?.setData("text/plain", item?.uuid
				? JSON.stringify({ type: "Item", uuid: item.uuid })
				: itemId);
			event.dataTransfer.effectAllowed = "copyMove";
		});

		row.addEventListener("dragend", () => {
			row.classList.remove("mg-dragging");
			dragging = null;
			clearDropState();
		});
	});

	panel.querySelectorAll("[data-mg-item-folder-id]").forEach(folder => {
		folder.setAttribute("draggable", "true");

		folder.addEventListener("dragstart", event => {
			if (event.target.closest(".mg-item-row[data-mg-item-id]") || event.target.closest("[data-mg-item-folder-id]") !== folder) return;
			event.stopPropagation();
			dragging = folder;
			dragging.dataset.mgItemDisplayContainer = dragging.parentElement?.dataset?.mgItemContainer || "";
			folder.classList.add("mg-dragging");
			event.dataTransfer?.setData("application/x-mg-item-folder-id", folder.dataset.mgItemFolderId || "");
			event.dataTransfer?.setData("text/plain", folder.dataset.mgItemFolderId || "");
			event.dataTransfer.effectAllowed = "move";
		});

		folder.addEventListener("dragend", () => {
			if (dragging !== folder) return;
			folder.classList.remove("mg-dragging");
			dragging = null;
			clearDropState();
		});
	});

	panel.querySelectorAll("[data-mg-item-container]").forEach(container => {
		container.addEventListener("dragover", event => {
			if (!dragging) return;
			const isRootContainer = container.dataset.mgItemContainer === "";
			const isDraggingFolder = !!dragging.dataset.mgItemFolderId;
			const allowsFolderPromotion = isDraggingFolder && game.user?.isGM && isRootContainer;
			if (!allowsFolderPromotion && (isDraggingFolder || !game.user?.isGM) && mgNormalizeItemContainerId(container.dataset.mgItemContainer) !== mgNormalizeItemContainerId(dragging.dataset.mgItemDisplayContainer)) return;
			const nearestContainer = event.target.closest("[data-mg-item-container]");
			if (!isRootContainer && nearestContainer !== container) return;
			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = "move";
			clearDropState();
			container.classList.add("mg-item-drop-target");

		});

		container.addEventListener("drop", async event => {
			if (!dragging) return;
			const isRootContainer = container.dataset.mgItemContainer === "";
			const isDraggingFolder = !!dragging.dataset.mgItemFolderId;
			const allowsFolderPromotion = isDraggingFolder && game.user?.isGM && isRootContainer;
			if (!allowsFolderPromotion && (isDraggingFolder || !game.user?.isGM) && mgNormalizeItemContainerId(container.dataset.mgItemContainer) !== mgNormalizeItemContainerId(dragging.dataset.mgItemDisplayContainer)) return;
			const nearestContainer = event.target.closest("[data-mg-item-container]");
			if (!isRootContainer && nearestContainer !== container) return;
			event.preventDefault();
			event.stopPropagation();
			const target = getDirectDropTarget(event, container);
			if (target) insertDraggingNearTarget(event, container, target);
			clearDropState();
			await finalizeContainerOrder(container);
		});
	});

	panel.querySelectorAll("[data-mg-item-folder-drop]").forEach(folderDrop => {
		folderDrop.addEventListener("dragover", event => {
			if (!dragging?.dataset?.mgItemId || !game.user?.isGM || !isFolderNestZone(event, folderDrop)) return;
			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = "move";
			clearDropState();
			folderDrop.classList.add("mg-item-drop-folder");
		});

		folderDrop.addEventListener("drop", async event => {
			if (!dragging?.dataset?.mgItemId) return;
			const itemId = getDragItemId(event);
			const folderId = folderDrop.dataset.mgItemFolderDrop || null;
			const item = itemId ? game.items?.get(itemId) : null;
			if (!item || !game.user?.isGM || !isFolderNestZone(event, folderDrop)) return;

			event.preventDefault();
			event.stopPropagation();
			clearDropState();

			const folder = game.folders?.get(folderId);
			await item.update({ folder: folderId || null });
			await mgAppendItemToUserOrder(folderId, item.id);

			if (folder) mgSetAccordionOpen(null, `item-folder-${folder.id}`, true);
		});
	});
}

/* Item sidebar per-user ordering
----------------------------------------------------------------------*/
function mgNormalizeItemContainerId(folderId) {
	return folderId || "";
}

function mgGetItemUserOrder() {
	const order = game.user?.getFlag?.(MG_UI_NS, MG_ITEM_USER_ORDER_FLAG);
	return order && typeof order === "object" && !Array.isArray(order) ? { ...order } : {};
}

function mgGetItemUserOrderKey(folderId) {
	return mgNormalizeItemContainerId(folderId) || "root";
}

function mgItemOrderToken(type, id) {
	return `${type}:${id}`;
}

function mgItemOrderEntryToken(entry) {
	if (entry.type === "folder") return mgItemOrderToken("folder", entry.id);
	return mgItemOrderToken("item", entry.id);
}

function mgItemOrderElementToken(element) {
	if (element?.dataset?.mgItemFolderId) return mgItemOrderToken("folder", element.dataset.mgItemFolderId);
	if (element?.dataset?.mgItemId) return mgItemOrderToken("item", element.dataset.mgItemId);
	return "";
}

async function mgSetItemUserOrderForContainer(folderId, tokens) {
	const order = mgGetItemUserOrder();
	order[mgGetItemUserOrderKey(folderId)] = Array.from(new Set(tokens.filter(Boolean)));
	await game.user?.setFlag?.(MG_UI_NS, MG_ITEM_USER_ORDER_FLAG, order);
}

async function mgSaveItemUserOrderFromContainer(container) {
	const folderId = container?.dataset?.mgItemContainer || "";
	const tokens = Array.from(container?.children ?? [])
		.map(el => mgItemOrderElementToken(el))
		.filter(Boolean);

	await mgSetItemUserOrderForContainer(folderId, tokens);
}

async function mgAppendItemToUserOrder(folderId, itemId) {
	const key = mgGetItemUserOrderKey(folderId);
	const order = mgGetItemUserOrder();
	const token = mgItemOrderToken("item", itemId);
	order[key] = [...(order[key] ?? []).filter(existing => existing !== token), token];
	await game.user?.setFlag?.(MG_UI_NS, MG_ITEM_USER_ORDER_FLAG, order);
}

/* Item and item folder creation
----------------------------------------------------------------------*/
async function mgCreateItem(folderId = null) {
	if (!game.user?.isGM) return;

	try {
		if (typeof Item?.createDialog === "function") {
			await Item.createDialog({ folder: folderId || null }, { folder: folderId || null });
			return;
		}

		const item = await Item.create({ name: "New Item", type: "misc", folder: folderId || null }, { renderSheet: false });
		item?.sheet?.render(true, { focus: true });
	} catch (err) {
		ui.notifications?.error("Could not create item.");
		console.warn("MG UI | Create item failed.", err);
	}
}

async function mgCreateItemFolder(parentId = null) {
	if (!game.user?.isGM) return;

	try {
		const parent = parentId ? game.folders?.get(parentId) : null;
		if (parent && mgGetItemFolderDepth(parent) > 0) {
			ui.notifications?.warn("Item folders can only be nested one level deep.");
			return;
		}

		if (typeof Folder?.createDialog === "function") {
			await Folder.createDialog({ type: "Item", folder: parentId || null }, { folder: parentId || null });
			return;
		}

		const folder = await Folder.create({ name: "New Folder", type: "Item", folder: parentId || null }, { renderSheet: false });
		folder?.sheet?.render(true, { focus: true });
	} catch (err) {
		ui.notifications?.error("Could not create item folder.");
		console.warn("MG UI | Create item folder failed.", err);
	}
}

/* Item context menus
----------------------------------------------------------------------*/
function mgOpenItemContextMenu(itemId, anchor, row, event = null) {
	const item = game.items?.get(itemId);
	if (!item) return;

	mgCloseSceneContextMenu();

	const canManage = game.user?.isGM;
	const menu = document.createElement("nav");
	menu.className = "mg-scene-context-menu mg-item-context-menu";
	menu.dataset.mgItemContextMenu = item.id;
	menu.innerHTML = `
		<button type="button" data-mg-item-action="edit"><i class="fa-solid fa-pen-to-square"></i> Edit Item</button>
		<button type="button" data-mg-item-action="artwork"><i class="fa-solid fa-image"></i> View Artwork</button>
		${canManage ? `<button type="button" data-mg-item-action="ownership"><i class="fa-solid fa-user-shield"></i> Configure Ownership</button>` : ""}
		<button type="button" data-mg-item-action="export"><i class="fa-solid fa-file-export"></i> Export Data</button>
		${canManage ? `<button type="button" data-mg-item-action="import"><i class="fa-solid fa-file-import"></i> Import Data</button>` : ""}
		${canManage ? `<button type="button" data-mg-item-action="duplicate"><i class="fa-regular fa-copy"></i> Duplicate</button>` : ""}
		${canManage ? `<button type="button" class="danger" data-mg-item-action="delete"><i class="fa-solid fa-trash"></i> Delete</button>` : ""}
	`;

	menu.addEventListener("click", async clickEvent => {
		const button = clickEvent.target.closest("[data-mg-item-action]");
		if (!button) return;

		clickEvent.preventDefault();
		clickEvent.stopPropagation();
		mgCloseSceneContextMenu();
		await mgRunItemAction(item, button.dataset.mgItemAction);
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

function mgOpenItemFolderContextMenu(folderId, anchor, event = null) {
	const folder = game.folders?.get(folderId);
	if (!folder || folder.type !== "Item" || !game.user?.isGM) return;

	mgCloseSceneContextMenu();

	const menu = document.createElement("nav");
	menu.className = "mg-scene-context-menu mg-item-folder-context-menu";
	menu.dataset.mgItemFolderContextMenu = folder.id;
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
		await mgRunItemFolderAction(folder, button.dataset.mgFolderAction);
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

async function mgRunItemAction(item, action) {
	try {
		switch (action) {
			case "edit":
				item.sheet?.render(true, { focus: true });
				break;
			case "artwork":
				await mgViewItemArtwork(item);
				break;
			case "ownership":
				await mgOpenItemOwnershipConfig(item);
				break;
			case "export":
				item.exportToJSON?.();
				break;
			case "import":
				item.importFromJSONDialog?.();
				break;
			case "duplicate":
				await mgDuplicateItem(item);
				break;
			case "delete":
				await mgDeleteItem(item);
				break;
		}
	} catch (err) {
		ui.notifications?.error("Item action failed.");
		console.warn("MG UI | Item action failed.", { item: item?.id, action, err });
	}
}

async function mgViewItemArtwork(item) {
	const src = mgGetItemSidebarImage(item);
	const title = item.name || "Item Artwork";
	const ImagePopoutApp = mgGetFoundryAppClass("ImagePopout");

	if (ImagePopoutApp) {
		const configs = [
			() => new ImagePopoutApp({ src, uuid: item.uuid, window: { title } }),
			() => new ImagePopoutApp(src, { title, uuid: item.uuid }),
			() => new ImagePopoutApp({ src, title, uuid: item.uuid })
		];

		for (const createApp of configs) {
			try {
				const app = createApp();
				if (await mgRenderFoundryApp(app)) return;
			} catch (err) {
				console.warn("MG UI | Item artwork popout construction failed.", err);
			}
		}
	}

	mgOpenFallbackArtworkDialog(item, src, title);
}

function mgOpenFallbackArtworkDialog(item, src, title) {
	const content = `
		<figure class="mg-item-artwork-popout">
			<img src="${mgEsc(src)}" alt="${mgAttr(item.name)}" />
			<figcaption>${mgEsc(item.name)}</figcaption>
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

async function mgOpenItemOwnershipConfig(item) {
	const OwnershipConfig = mgGetFoundryAppClass("DocumentOwnershipConfig");

	if (OwnershipConfig) {
		const configs = [
			() => new OwnershipConfig({ document: item }),
			() => new OwnershipConfig(item)
		];

		for (const createApp of configs) {
			try {
				const app = createApp();
				if (await mgRenderFoundryApp(app)) return;
			} catch (err) {
				console.warn("MG UI | Item ownership config construction failed.", err);
			}
		}
	}

	await mgOpenFallbackOwnershipDialog(item);
}

async function mgOpenFallbackOwnershipDialog(item) {
	if (!game.user?.isGM) return;

	const levels = mgGetOwnershipLevels();
	const defaultLevels = levels.filter(level => level.value >= 0);
	const ownership = { ...(item.ownership ?? {}) };
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
		<form class="mg-item-ownership-form">
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
		title: `Configure Ownership: ${item.name}`,
		content,
		yes: async html => {
			const root = html?.jquery ? html[0] : html?.[0] ?? html;
			const form = root?.querySelector?.(".mg-item-ownership-form");
			if (!form) return;

			const next = {};
			const defaultValue = Number(form.querySelector('[name="default"]')?.value ?? 0);
			next.default = Number.isFinite(defaultValue) ? defaultValue : 0;

			for (const user of users) {
				const raw = Number(form.elements?.[`user.${user.id}`]?.value ?? -1);
				if (Number.isFinite(raw) && raw >= 0) next[user.id] = raw;
			}

			await item.update({ ownership: next });
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

async function mgDuplicateItem(item) {
	const data = item.toObject();
	delete data._id;
	data.name = `${item.name} Copy`;
	await Item.create(data, { renderSheet: true });
}

async function mgDeleteItem(item) {
	if (typeof item.deleteDialog === "function") {
		await item.deleteDialog();
		return;
	}

	const confirmed = await Dialog.confirm({
		title: `Delete ${item.name}?`,
		content: `<p>Delete <strong>${mgEsc(item.name)}</strong>?</p>`,
		yes: () => true,
		no: () => false,
		defaultYes: false
	});

	if (confirmed) await item.delete();
}

async function mgRunItemFolderAction(folder, action) {
	try {
		switch (action) {
			case "edit":
				folder.sheet?.render(true, { focus: true });
				break;
			case "remove":
				await mgRemoveItemFolderOnly(folder);
				break;
			case "delete-all":
				await mgDeleteItemFolderContents(folder);
				break;
		}
	} catch (err) {
		ui.notifications?.error("Item folder action failed.");
		console.warn("MG UI | Item folder action failed.", { folder: folder?.id, action, err });
	}
}

function mgGetItemFolderChildren(folder) {
	const folderId = folder?.id ?? null;
	const folders = Array.from(game.folders ?? [])
		.filter(child => child.type === "Item" && (child.folder?.id ?? child.folder ?? null) === folderId);
	const items = Array.from(game.items ?? [])
		.filter(item => (item.folder?.id ?? item.folder ?? null) === folderId);

	return { folders, items };
}

function mgCollectItemFolderTree(folder, out = { folders: [], items: [] }) {
	const { folders, items } = mgGetItemFolderChildren(folder);
	out.folders.push(folder);
	out.items.push(...items);
	folders.forEach(child => mgCollectItemFolderTree(child, out));
	return out;
}

async function mgRemoveItemFolderOnly(folder) {
	const parentId = folder.folder?.id ?? folder.folder ?? null;
	const { folders, items } = mgGetItemFolderChildren(folder);
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
		...items.map(item => item.update({ folder: parentId }))
	]);
	await folder.delete();
}

async function mgDeleteItemFolderContents(folder) {
	const collected = mgCollectItemFolderTree(folder);
	const confirmed = await Dialog.confirm({
		title: `Delete all in ${folder.name}?`,
		content: `<p>Delete <strong>${mgEsc(folder.name)}</strong>, ${collected.folders.length - 1} subfolders, and ${collected.items.length} items?</p>`,
		yes: () => true,
		no: () => false,
		defaultYes: false
	});

	if (!confirmed) return;

	const itemIds = collected.items.map(item => item.id);
	const folderIds = collected.folders.map(f => f.id).reverse();
	if (itemIds.length && typeof Item.deleteDocuments === "function") await Item.deleteDocuments(itemIds);
	else await Promise.all(itemIds.map(id => game.items?.get(id)?.delete()));
	if (folderIds.length && typeof Folder.deleteDocuments === "function") await Folder.deleteDocuments(folderIds);
	else await Promise.all(folderIds.map(id => game.folders?.get(id)?.delete()));
}

/* Item sidebar rendering
----------------------------------------------------------------------*/
function mgRenderItemSidebarContent() {
	const canManage = game.user?.isGM;
	const items = Array.from(game.items ?? [])
		.filter(item => canManage || mgCanUserSeeItem(item));
	const folderTree = mgBuildItemFolderTree(items, { showAllFolders: canManage });
	const controls = canManage ? `
		<section class="mg-scene-directory-actions mg-item-directory-actions">
			<button type="button" class="mg-left-action" data-mg-item-create>
				<i class="fa-solid fa-briefcase"></i>
				Create Item
			</button>
			<button type="button" class="mg-left-action" data-mg-item-folder-create>
				<i class="fa-solid fa-folder"></i>
				Create Folder
			</button>
		</section>
	` : "";
	const search = `
		<label class="mg-scene-search mg-item-search">
			<i class="fa-solid fa-magnifying-glass"></i>
			<input type="search" placeholder="Search Items" data-mg-item-search />
		</label>
	`;
	const collapseFolders = canManage ? `
		<button type="button" class="mg-left-action mg-item-collapse-folders" data-mg-item-collapse-folders>
			<i class="fa-solid fa-folder-tree"></i>
			Collapse Folders
		</button>
	` : "";

	return `
		<section class="mg-scene-directory mg-item-directory">
			<div class="mg-scene-directory-header">
				${controls}
				${mgRenderItemsCard()}
			</div>

			${items.length ? `
				<div class="mg-scene-directory-browser mg-item-directory-browser">
					${search}
					<hr class="mg-scene-directory-rule mg-item-directory-rule" />
					${collapseFolders}

					<div class="mg-scene-tree mg-item-tree" data-mg-item-tree data-mg-item-container="">
						${mgRenderItemBranch(folderTree)}
					</div>

					<div class="mg-left-empty mg-item-empty-search" data-mg-item-empty-search hidden>
						No items match this search.
					</div>
				</div>
			` : `<div class="mg-left-empty">No visible items found.</div>`}
		</section>
	`;
}

function mgRenderItemsCard() {
	return `
		<section class="mg-active-scene mg-active-items">
			<div class="mg-active-scene-card mg-active-items-card" style="background-image: url('${mgCssUrl(MG_ITEM_CARD_IMAGE)}');">
				<span class="mg-active-scene-scrim"></span>
				<span class="mg-active-scene-kicker"><i class="fa-solid fa-briefcase"></i> Directory</span>
				<span class="mg-active-scene-title">Items</span>
			</div>
		</section>
	`;
}

function mgCanUserSeeItem(item) {
	if (!item) return false;
	if (item.visible !== false) return true;
	try {
		return item.testUserPermission?.(game.user, "LIMITED") ?? item.isOwner;
	} catch (_) {
		return !!item.isOwner;
	}
}

function mgBuildItemFolderTree(items, { showAllFolders = true } = {}) {
	const visibleItemFolderIds = new Set();
	for (const item of items) {
		let folderId = item.folder?.id ?? item.folder ?? null;
		while (folderId) {
			visibleItemFolderIds.add(folderId);
			const folder = game.folders?.get(folderId);
			folderId = folder?.folder?.id ?? folder?.folder ?? null;
		}
	}
	const itemFolders = Array.from(game.folders ?? [])
		.filter(folder => folder.type === "Item")
		.filter(folder => showAllFolders || visibleItemFolderIds.has(folder.id));
	const folderNodes = new Map(itemFolders.map(folder => [
		folder.id,
		{ folder, folders: [], items: [] }
	]));
	const root = { folders: [], items: [] };

	for (const node of folderNodes.values()) {
		const parentId = mgGetItemFolderTreeParentId(node.folder);
		const parent = parentId ? folderNodes.get(parentId) : null;
		(parent ?? root).folders.push(node);
	}

	for (const item of items) {
		const folderId = item.folder?.id ?? item.folder ?? null;
		const parent = folderId ? folderNodes.get(folderId) : null;
		(parent ?? root).items.push(item);
	}

	return root;
}

function mgGetItemFolderParentId(folder) {
	return folder?.folder?.id ?? folder?.folder ?? null;
}

function mgGetItemFolderDepth(folder) {
	let depth = 0;
	let current = folder;
	const seen = new Set();
	while (current && mgGetItemFolderParentId(current)) {
		const parentId = mgGetItemFolderParentId(current);
		if (seen.has(parentId)) break;
		seen.add(parentId);
		current = game.folders?.get(parentId);
		if (!current || current.type !== "Item") break;
		depth += 1;
	}
	return depth;
}

function mgGetItemFolderTreeParentId(folder) {
	const parentId = mgGetItemFolderParentId(folder);
	if (!parentId) return null;
	const parent = game.folders?.get(parentId);
	if (!parent || parent.type !== "Item") return null;
	return mgGetItemFolderDepth(parent) > 0 ? mgGetItemFolderParentId(parent) : parentId;
}

function mgRenderItemBranch(node, depth = 0) {
	const entries = [
		...node.folders.map(folderNode => ({
			type: "folder",
			id: folderNode.folder.id,
			name: folderNode.folder.name,
			html: mgRenderItemFolder(folderNode, depth)
		})),
		...node.items.map(item => ({
			type: "item",
			id: item.id,
			name: item.name,
			html: mgRenderItemRow(item)
		}))
	];
	const order = mgGetItemUserOrder()[mgGetItemUserOrderKey(node.folder?.id ?? null)] ?? [];
	const orderMap = new Map(order.map((token, index) => [token, index]));

	return entries
		.sort((a, b) => {
			const aOrder = orderMap.get(mgItemOrderEntryToken(a));
			const bOrder = orderMap.get(mgItemOrderEntryToken(b));
			if (aOrder !== undefined || bOrder !== undefined) return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER);
			return a.name.localeCompare(b.name) || a.type.localeCompare(b.type);
		})
		.map(entry => entry.html)
		.join("");
}

function mgRenderItemFolder(node, depth = 0) {
	const folder = node.folder;
	const id = `item-folder-${folder.id}`;
	const isOpen = mgIsAccordionOpen(null, id, true);
	const canCreateSubfolder = game.user?.isGM && depth === 0;
	const body = mgRenderItemBranch(node, depth + 1) || `<div class="mg-left-empty mg-scene-folder-empty mg-item-folder-empty">No items in this folder.</div>`;
	const color = String(folder.color ?? "").trim();
	const iconStyle = color ? ` style="color: ${mgAttr(color)};"` : "";

	return `
		<section
			class="mg-left-accordion mg-scene-folder-accordion mg-item-folder-accordion ${isOpen ? "is-open" : ""} ${depth > 0 ? "is-sub" : ""}"
			data-mg-accordion="${id}"
			data-mg-item-folder-id="${folder.id}"
		>
			<div
				class="mg-left-accordion-toggle mg-scene-folder-toggle mg-item-folder-toggle"
				data-mg-accordion-toggle="${id}"
				data-mg-item-folder-drop="${folder.id}"
				aria-expanded="${isOpen ? "true" : "false"}"
			>
				<span><i class="fa-solid fa-folder" data-mg-item-folder-icon${iconStyle}></i>${mgEsc(folder.name)}</span>
				<i class="fa-solid fa-chevron-down mg-left-accordion-chevron"></i>
			</div>
			<div class="mg-left-accordion-body" ${isOpen ? "" : "hidden"} style="max-height: ${isOpen ? "none" : "0px"};">
				<div class="mg-left-accordion-inner">
					<div class="mg-scene-folder-body mg-item-folder-body" data-mg-item-folder-body="${folder.id}" data-mg-item-container="${folder.id}">
						${game.user?.isGM ? `
							<div class="mg-scene-folder-actions mg-item-folder-actions">
								<button type="button" class="mg-scene-mini-action mg-item-mini-action" data-mg-item-create="${folder.id}" title="Create item in ${mgAttr(folder.name)}" aria-label="Create item in ${mgAttr(folder.name)}">
									<i class="fa-solid fa-plus"></i>
								</button>
								${canCreateSubfolder ? `
									<button type="button" class="mg-scene-mini-action mg-item-mini-action" data-mg-item-folder-create="${folder.id}" title="Create subfolder in ${mgAttr(folder.name)}" aria-label="Create subfolder in ${mgAttr(folder.name)}">
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

function mgRenderItemRow(item) {
	const img = mgGetItemSidebarImage(item);

	return `
		<article
			class="mg-scene-row mg-item-row"
			data-mg-item-id="${item.id}"
			data-mg-item-name="${mgAttr(item.name)}"
			data-mg-item-folder="${item.folder?.id ?? item.folder ?? ""}"
		>
			<button type="button" class="mg-scene-row-main mg-item-row-main" data-mg-open-item="${item.id}">
				<span class="mg-actor-row-image mg-item-row-image" aria-hidden="true">
					<img src="${mgEsc(img)}" alt="" />
				</span>
				<span class="mg-scene-row-scrim"></span>
				<span class="mg-scene-row-title mg-item-row-title">${mgEsc(item.name)}</span>
			</button>
			<button type="button" class="mg-scene-context-button mg-item-context-button" data-mg-item-menu="${item.id}" title="Item actions" aria-label="Item actions for ${mgAttr(item.name)}">
				<i class="fa-solid fa-ellipsis-vertical"></i>
			</button>
		</article>
	`;
}

globalThis.MGItemSidebar = {
	bindContent: mgBindItemSidebarContent,
	renderContent: mgRenderItemSidebarContent
};
