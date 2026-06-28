const MG_UI_NS = "midnight-gambit";
const MG_COMPENDIUM_USER_ORDER_FLAG = "compendiumSidebarOrder";
const MG_COMPENDIUM_DEFAULT_IMAGE = "systems/midnight-gambit/assets/images/items.jpg";
const MG_COMPENDIUM_HEADER_IMAGE = "systems/midnight-gambit/assets/images/items.jpg";

const MG_COMPENDIUM_IMAGES = {
  "midnight-gambit.guises": "systems/midnight-gambit/assets/images/compendium-guises.png",
  "midnight-gambit.gambits": "systems/midnight-gambit/assets/images/compendium-gambits.png",
  "midnight-gambit.moves": "systems/midnight-gambit/assets/images/compendium-moves.png",
  "midnight-gambit.items": "systems/midnight-gambit/assets/images/compendium-items.png"
};

function mgGetCompendiumCardImage(pack) {
	const metadata = pack?.metadata ?? {};
	const ids = [
		pack?.collection,
		metadata.id,
		metadata.package && metadata.name ? `${metadata.package}.${metadata.name}` : null
	].map(id => String(id ?? ""));

	return ids.map(id => MG_COMPENDIUM_IMAGES[id]).find(Boolean) || MG_COMPENDIUM_DEFAULT_IMAGE;
}

function mgGetCompendiumPackFromApp(app) {
	const candidates = [
		app?.collection,
		app?.pack,
		app?.document,
		app?.options?.collection,
		app?.options?.pack,
		app?.id
	];

	for (const candidate of candidates) {
		if (!candidate) continue;
		if (typeof candidate === "string") {
			const id = candidate.replace(/^Compendium\./, "");
			const pack = game.packs?.get(id);
			if (pack) return pack;
			continue;
		}

		const id = mgGetPackId(candidate);
		if (id) return game.packs?.get(id) ?? candidate;
	}

	return null;
}

const MG_COMPENDIUM_TYPES = [
	["Actor", "Actors"],
	["Item", "Items"],
	["JournalEntry", "Journals"],
	["Scene", "Scenes"],
	["RollTable", "Roll Tables"],
	["Cards", "Cards"],
	["Macro", "Macros"],
	["Playlist", "Playlists"]
];

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

function mgSlug(value) {
	return String(value ?? "compendium")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		|| `compendium-${Date.now()}`;
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

function mgGetPackId(pack) {
	return pack?.collection ?? pack?.metadata?.id ?? "";
}

function mgGetCompendiumCollectionClass() {
	const samplePack = game.packs?.values?.().next?.().value ?? game.packs?.contents?.[0];
	return globalThis.CompendiumCollection
		?? globalThis.foundry?.documents?.collections?.CompendiumCollection
		?? globalThis.foundry?.abstract?.CompendiumCollection
		?? samplePack?.constructor
		?? null;
}

async function mgCreateCompendiumPack(metadata, folderId = null, options = {}) {
	const CompendiumCollectionClass = mgGetCompendiumCollectionClass();
	if (typeof CompendiumCollectionClass?.createCompendium !== "function") return null;

	const pack = await CompendiumCollectionClass.createCompendium(metadata, options);
	if (folderId && typeof pack?.setFolder === "function") await pack.setFolder(folderId);
	else if (folderId && typeof pack?.configure === "function") await pack.configure({ folder: folderId });
	return pack;
}

function mgGetPackLabel(pack) {
	return pack?.metadata?.label || pack?.title || pack?.collection || "Compendium";
}

function mgGetPackType(pack) {
	return pack?.documentName || pack?.metadata?.type || pack?.metadata?.entity || "Document";
}

function mgGetPackFolderId(pack) {
	return pack?.folder?.id ?? pack?.folder ?? pack?.metadata?.folder ?? null;
}

function mgIsPackLocked(pack) {
	return !!(pack?.locked ?? pack?.metadata?.locked);
}

function mgIsWorldCompendium(pack) {
	const metadata = pack?.metadata ?? {};
	const packageId = String(metadata.package ?? pack?.packageName ?? pack?.package ?? "").toLowerCase();
	const collectionId = String(pack?.collection ?? metadata.id ?? "").toLowerCase();
	const path = String(metadata.path ?? pack?.path ?? "").replace(/\\/g, "/").toLowerCase();

	return packageId === "world"
		|| collectionId.startsWith("world.")
		|| (path.includes("/worlds/") && path.includes("/packs/"));
}

function mgIsDefaultCompendiumImage(src) {
	const value = String(src ?? "").toLowerCase();
	return !value
		|| value.includes("icons/svg/")
		|| value.includes("icons/vtt-512.png")
		|| value.endsWith("/undefined")
		|| value.endsWith("/null");
}

function mgApplyCompendiumPopupImages(app, html) {
	const root = html?.jquery ? html[0] : html?.[0] ?? html ?? app?.element?.[0] ?? app?.element;
	if (!root?.querySelectorAll) return;

	const image = mgGetCompendiumCardImage(mgGetCompendiumPackFromApp(app));

	root.querySelectorAll(".header-banner").forEach(banner => {
		banner.style.setProperty("background-image", `url('${mgCssUrl(image)}')`, "important");
		banner.classList.add("mg-compendium-default-banner");

		banner.querySelectorAll("img").forEach(img => {
			img.src = image;
			img.classList.add("mg-compendium-default-image");
		});
	});

	root.querySelectorAll(".directory-item img, img.document-image, img.thumbnail").forEach(img => {
		if (!mgIsDefaultCompendiumImage(img.getAttribute("src"))) return;
		img.src = image;
		img.classList.add("mg-compendium-default-image");
	});
}

function mgCanUserSeePack(pack) {
	if (!pack) return false;
	if (game.user?.isGM) return true;
	if (pack.private || pack.metadata?.private) return false;
	return true;
}

async function mgConfigurePack(pack, data) {
	if (!pack) return;
	if (typeof pack.configure === "function") {
		await pack.configure(data);
		globalThis.mgRefreshCompendiumSidebarContent?.();
		return;
	}
	if (typeof pack.update === "function") {
		await pack.update(data);
		globalThis.mgRefreshCompendiumSidebarContent?.();
		return;
	}
	Object.assign(pack.metadata ?? {}, data);
	globalThis.mgRefreshCompendiumSidebarContent?.();
}

/* Compendium sidebar interactions
----------------------------------------------------------------------*/
function mgBindCompendiumSidebarContent(root) {
	const panel = root?.querySelector(".mg-compendium-directory");
	if (!panel) return;

	panel.querySelector("[data-mg-compendium-search]")?.addEventListener("keydown", event => {
		if (event.key !== "Enter") return;
		event.preventDefault();
		mgFilterCompendiumSidebar(panel, event.currentTarget.value);
	});

	panel.querySelector("[data-mg-compendium-collapse-folders]")?.addEventListener("click", event => {
		event.preventDefault();
		mgCollapseCompendiumFolders(panel);
	});

	panel.querySelectorAll("[data-mg-compendium-create]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();
			await mgCreateCompendium(button.dataset.mgCompendiumCreate || null);
		});
	});

	panel.querySelectorAll("[data-mg-compendium-folder-create]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();
			await mgCreateCompendiumFolder(button.dataset.mgCompendiumFolderCreate || null);
		});
	});

	panel.querySelectorAll("[data-mg-compendium-menu]").forEach(button => {
		button.addEventListener("click", event => {
			event.preventDefault();
			event.stopPropagation();
			const row = button.closest("[data-mg-compendium-id]");
			mgOpenCompendiumContextMenu(button.dataset.mgCompendiumMenu, button, row);
		});
	});

	panel.querySelectorAll("[data-mg-compendium-id]").forEach(row => {
		row.addEventListener("contextmenu", event => {
			event.preventDefault();
			event.stopPropagation();
			mgOpenCompendiumContextMenu(row.dataset.mgCompendiumId, row, row, event);
		});
	});

	panel.querySelectorAll("[data-mg-compendium-folder-id]").forEach(folderEl => {
		folderEl.addEventListener("contextmenu", event => {
			event.preventDefault();
			event.stopPropagation();
			mgOpenCompendiumFolderContextMenu(folderEl.dataset.mgCompendiumFolderId, folderEl, event);
		});
	});

	mgBindCompendiumSidebarDrag(panel);
}

function mgFilterCompendiumSidebar(panel, value) {
	const query = String(value ?? "").trim().toLowerCase();
	const rows = Array.from(panel.querySelectorAll("[data-mg-compendium-id]"));
	let visibleRows = 0;

	rows.forEach(row => {
		const name = String(row.dataset.mgCompendiumName ?? "").toLowerCase();
		const type = String(row.dataset.mgCompendiumType ?? "").toLowerCase();
		const visible = !query || name.includes(query) || type.includes(query);
		row.hidden = !visible;
		if (visible) visibleRows += 1;
	});

	panel.querySelectorAll(".mg-compendium-folder-accordion[data-mg-accordion]").forEach(accordion => {
		const hasVisiblePack = !!accordion.querySelector('[data-mg-compendium-id]:not([hidden])');
		accordion.hidden = query ? !hasVisiblePack : false;

		if (query && hasVisiblePack && !accordion.classList.contains("is-open")) {
			const button = accordion.querySelector("[data-mg-accordion-toggle]");
			if (button) mgToggleLeftAccordion(button);
		}
	});

	const anyVisible = visibleRows > 0 || !!panel.querySelector('[data-mg-accordion]:not([hidden]) [data-mg-compendium-id]:not([hidden])');
	const empty = panel.querySelector("[data-mg-compendium-empty-search]");
	if (empty) empty.hidden = !query || anyVisible;
}

function mgCollapseCompendiumFolders(panel) {
	panel.querySelectorAll(".mg-compendium-folder-accordion[data-mg-accordion]").forEach(accordion => {
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

/* Compendium sidebar drag and drop
----------------------------------------------------------------------*/
function mgBindCompendiumSidebarDrag(panel) {
	let dragging = null;

	const getDragPackId = event =>
		event.dataTransfer?.getData("application/x-mg-compendium-id") || event.dataTransfer?.getData("text/plain") || dragging?.dataset?.mgCompendiumId || "";

	const getDragToken = () => {
		if (dragging?.dataset?.mgCompendiumId) return mgCompendiumOrderToken("pack", dragging.dataset.mgCompendiumId);
		if (dragging?.dataset?.mgCompendiumFolderId) return mgCompendiumOrderToken("folder", dragging.dataset.mgCompendiumFolderId);
		return "";
	};

	const clearDropState = () => {
		panel.querySelectorAll(".mg-compendium-drop-target, .mg-compendium-drop-folder").forEach(el => {
			el.classList.remove("mg-compendium-drop-target", "mg-compendium-drop-folder");
		});
	};

	const finalizeContainerOrder = async container => {
		const packId = dragging?.dataset?.mgCompendiumId;
		const draggedFolderId = dragging?.dataset?.mgCompendiumFolderId;
		const dragToken = getDragToken();
		if (!dragToken || !container) return;

		const folderId = container.dataset.mgCompendiumContainer || null;
		const originalFolderId = dragging.dataset.mgCompendiumFolder || null;
		const originalDisplayContainer = dragging.dataset.mgCompendiumDisplayContainer || "";
		const entries = Array.from(container.children)
			.filter(el => el.matches?.(".mg-compendium-row[data-mg-compendium-id], [data-mg-compendium-folder-id]"));

		if (!entries.some(entry => mgCompendiumOrderElementToken(entry) === dragToken)) {
			container.appendChild(dragging);
			entries.push(dragging);
		}

		if (!game.user?.isGM && mgNormalizeCompendiumContainerId(folderId) !== mgNormalizeCompendiumContainerId(originalDisplayContainer)) {
			container.querySelector(`[data-mg-compendium-id="${mgCssEscape(packId)}"]`)?.remove();
			return;
		}

		await mgSaveCompendiumUserOrderFromContainer(container);

		if (packId && game.user?.isGM && folderId !== originalFolderId) {
			const pack = game.packs?.get(packId);
			await mgConfigurePack(pack, { folder: folderId || null });
		}
		if (draggedFolderId && game.user?.isGM && folderId !== originalDisplayContainer) {
			const folder = game.folders?.get(draggedFolderId);
			await folder?.update({ folder: folderId || null });
		}
	};

	const getDirectDropTarget = (event, container) => {
		const target = event.target.closest(".mg-compendium-row[data-mg-compendium-id], [data-mg-compendium-folder-id]");
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

	panel.querySelectorAll(".mg-compendium-row[data-mg-compendium-id]").forEach(row => {
		row.setAttribute("draggable", "true");

		row.addEventListener("dragstart", event => {
			event.stopPropagation();
			const packId = row.dataset.mgCompendiumId || "";
			dragging = row;
			dragging.dataset.mgCompendiumDisplayContainer = dragging.parentElement?.dataset?.mgCompendiumContainer || "";
			row.classList.add("mg-dragging");
			event.dataTransfer?.setData("application/x-mg-compendium-id", packId);
			event.dataTransfer?.setData("text/plain", packId);
			event.dataTransfer.effectAllowed = "move";
		});

		row.addEventListener("dragend", () => {
			row.classList.remove("mg-dragging");
			dragging = null;
			clearDropState();
		});
	});

	panel.querySelectorAll("[data-mg-compendium-folder-id]").forEach(folder => {
		folder.setAttribute("draggable", "true");

		folder.addEventListener("dragstart", event => {
			if (event.target.closest(".mg-compendium-row[data-mg-compendium-id]") || event.target.closest("[data-mg-compendium-folder-id]") !== folder) return;
			event.stopPropagation();
			dragging = folder;
			dragging.dataset.mgCompendiumDisplayContainer = dragging.parentElement?.dataset?.mgCompendiumContainer || "";
			folder.classList.add("mg-dragging");
			event.dataTransfer?.setData("application/x-mg-compendium-folder-id", folder.dataset.mgCompendiumFolderId || "");
			event.dataTransfer?.setData("text/plain", folder.dataset.mgCompendiumFolderId || "");
			event.dataTransfer.effectAllowed = "move";
		});

		folder.addEventListener("dragend", () => {
			if (dragging !== folder) return;
			folder.classList.remove("mg-dragging");
			dragging = null;
			clearDropState();
		});
	});

	panel.querySelectorAll("[data-mg-compendium-container]").forEach(container => {
		container.addEventListener("dragover", event => {
			if (!dragging) return;
			const isRootContainer = container.dataset.mgCompendiumContainer === "";
			const isDraggingFolder = !!dragging.dataset.mgCompendiumFolderId;
			const allowsFolderPromotion = isDraggingFolder && game.user?.isGM && isRootContainer;
			if (!allowsFolderPromotion && (isDraggingFolder || !game.user?.isGM) && mgNormalizeCompendiumContainerId(container.dataset.mgCompendiumContainer) !== mgNormalizeCompendiumContainerId(dragging.dataset.mgCompendiumDisplayContainer)) return;
			const nearestContainer = event.target.closest("[data-mg-compendium-container]");
			if (!isRootContainer && nearestContainer !== container) return;
			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = "move";
			clearDropState();
			container.classList.add("mg-compendium-drop-target");

		});

		container.addEventListener("drop", async event => {
			if (!dragging) return;
			const isRootContainer = container.dataset.mgCompendiumContainer === "";
			const isDraggingFolder = !!dragging.dataset.mgCompendiumFolderId;
			const allowsFolderPromotion = isDraggingFolder && game.user?.isGM && isRootContainer;
			if (!allowsFolderPromotion && (isDraggingFolder || !game.user?.isGM) && mgNormalizeCompendiumContainerId(container.dataset.mgCompendiumContainer) !== mgNormalizeCompendiumContainerId(dragging.dataset.mgCompendiumDisplayContainer)) return;
			const nearestContainer = event.target.closest("[data-mg-compendium-container]");
			if (!isRootContainer && nearestContainer !== container) return;
			event.preventDefault();
			event.stopPropagation();
			const target = getDirectDropTarget(event, container);
			if (target) insertDraggingNearTarget(event, container, target);
			clearDropState();
			await finalizeContainerOrder(container);
		});
	});

	panel.querySelectorAll("[data-mg-compendium-folder-drop]").forEach(folderDrop => {
		folderDrop.addEventListener("dragover", event => {
			if (!dragging?.dataset?.mgCompendiumId || !game.user?.isGM || !isFolderNestZone(event, folderDrop)) return;
			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = "move";
			clearDropState();
			folderDrop.classList.add("mg-compendium-drop-folder");
		});

		folderDrop.addEventListener("drop", async event => {
			if (!dragging?.dataset?.mgCompendiumId) return;
			const packId = getDragPackId(event);
			const folderId = folderDrop.dataset.mgCompendiumFolderDrop || null;
			const pack = packId ? game.packs?.get(packId) : null;
			if (!pack || !game.user?.isGM || !isFolderNestZone(event, folderDrop)) return;

			event.preventDefault();
			event.stopPropagation();
			clearDropState();

			const folder = game.folders?.get(folderId);
			await mgConfigurePack(pack, { folder: folderId || null });
			await mgAppendCompendiumToUserOrder(folderId, mgGetPackId(pack));

			if (folder) mgSetAccordionOpen(null, `compendium-folder-${folder.id}`, true);
		});
	});
}

/* Compendium sidebar per-user ordering
----------------------------------------------------------------------*/
function mgNormalizeCompendiumContainerId(folderId) {
	return folderId || "";
}

function mgGetCompendiumUserOrder() {
	const order = game.user?.getFlag?.(MG_UI_NS, MG_COMPENDIUM_USER_ORDER_FLAG);
	return order && typeof order === "object" && !Array.isArray(order) ? { ...order } : {};
}

function mgGetCompendiumUserOrderKey(folderId) {
	return mgNormalizeCompendiumContainerId(folderId) || "root";
}

function mgCompendiumOrderToken(type, id) {
	return `${type}:${id}`;
}

function mgCompendiumOrderEntryToken(entry) {
	if (entry.type === "folder") return mgCompendiumOrderToken("folder", entry.id);
	return mgCompendiumOrderToken("pack", entry.id);
}

function mgCompendiumOrderElementToken(element) {
	if (element?.dataset?.mgCompendiumFolderId) return mgCompendiumOrderToken("folder", element.dataset.mgCompendiumFolderId);
	if (element?.dataset?.mgCompendiumId) return mgCompendiumOrderToken("pack", element.dataset.mgCompendiumId);
	return "";
}

async function mgSetCompendiumUserOrderForContainer(folderId, tokens) {
	const order = mgGetCompendiumUserOrder();
	order[mgGetCompendiumUserOrderKey(folderId)] = Array.from(new Set(tokens.filter(Boolean)));
	await game.user?.setFlag?.(MG_UI_NS, MG_COMPENDIUM_USER_ORDER_FLAG, order);
}

async function mgSaveCompendiumUserOrderFromContainer(container) {
	const folderId = container?.dataset?.mgCompendiumContainer || "";
	const tokens = Array.from(container?.children ?? [])
		.map(el => mgCompendiumOrderElementToken(el))
		.filter(Boolean);

	await mgSetCompendiumUserOrderForContainer(folderId, tokens);
}

async function mgAppendCompendiumToUserOrder(folderId, packId) {
	const key = mgGetCompendiumUserOrderKey(folderId);
	const order = mgGetCompendiumUserOrder();
	const token = mgCompendiumOrderToken("pack", packId);
	order[key] = [...(order[key] ?? []).filter(existing => existing !== token), token];
	await game.user?.setFlag?.(MG_UI_NS, MG_COMPENDIUM_USER_ORDER_FLAG, order);
}

async function mgRemoveCompendiumFromUserOrder(packId) {
	const token = mgCompendiumOrderToken("pack", packId);
	const order = mgGetCompendiumUserOrder();
	let dirty = false;

	for (const [key, tokens] of Object.entries(order)) {
		if (!Array.isArray(tokens) || !tokens.includes(token)) continue;
		order[key] = tokens.filter(existing => existing !== token);
		dirty = true;
	}

	if (dirty) await game.user?.setFlag?.(MG_UI_NS, MG_COMPENDIUM_USER_ORDER_FLAG, order);
}

/* Compendium creation
----------------------------------------------------------------------*/
async function mgCreateCompendium(folderId = null) {
	if (!game.user?.isGM) return;

	if (typeof mgGetCompendiumCollectionClass()?.createCompendium !== "function") {
		ui.notifications?.warn("Foundry does not expose compendium creation here.");
		return;
	}

	const typeOptions = MG_COMPENDIUM_TYPES
		.map(([value, label]) => `<option value="${mgAttr(value)}">${mgEsc(label)}</option>`)
		.join("");
	const content = `
		<form class="mg-compendium-create-form">
			<div class="form-group">
				<label>Name</label>
				<div class="form-fields">
					<input type="text" name="label" value="New Compendium" />
				</div>
			</div>
			<div class="form-group">
				<label>Type</label>
				<div class="form-fields">
					<select name="type">${typeOptions}</select>
				</div>
			</div>
		</form>
	`;

	await Dialog.confirm({
		title: "Create Compendium",
		content,
		yes: async html => {
			const root = html?.jquery ? html[0] : html?.[0] ?? html;
			const form = root?.querySelector?.(".mg-compendium-create-form");
			if (!form) return;

			const label = form.elements?.label?.value?.trim() || "New Compendium";
			const type = form.elements?.type?.value || "Actor";
			const name = mgSlug(label);
			const pack = await mgCreateCompendiumPack({
				label,
				name,
				type,
				package: "world",
				private: false
			}, folderId || null);
			if (folderId && pack) mgSetAccordionOpen(null, `compendium-folder-${folderId}`, true);
			globalThis.mgRefreshCompendiumSidebarContent?.();
		},
		no: () => false,
		defaultYes: false
	});
}

async function mgCreateCompendiumFolder(parentId = null) {
	if (!game.user?.isGM) return;

	try {
		const parent = parentId ? game.folders?.get(parentId) : null;
		if (parent && mgGetCompendiumFolderDepth(parent) > 0) {
			ui.notifications?.warn("Compendium folders can only be nested one level deep.");
			return;
		}

		if (typeof Folder?.createDialog === "function") {
			await Folder.createDialog({ type: "Compendium", folder: parentId || null }, { folder: parentId || null });
			return;
		}

		const folder = await Folder.create({ name: "New Folder", type: "Compendium", folder: parentId || null }, { renderSheet: false });
		folder?.sheet?.render(true, { focus: true });
		globalThis.mgRefreshCompendiumSidebarContent?.();
	} catch (err) {
		ui.notifications?.error("Could not create compendium folder.");
		console.warn("MG UI | Create compendium folder failed.", err);
	}
}

/* Compendium context menus
----------------------------------------------------------------------*/
function mgOpenCompendiumContextMenu(packId, anchor, row, event = null) {
	const pack = game.packs?.get(packId);
	if (!pack) return;

	mgCloseSceneContextMenu();

	const canManage = game.user?.isGM;
	const locked = mgIsPackLocked(pack);
	const canDelete = canManage && mgIsWorldCompendium(pack);
	const menu = document.createElement("nav");
	menu.className = "mg-scene-context-menu mg-compendium-context-menu";
	menu.dataset.mgCompendiumContextMenu = mgGetPackId(pack);
	menu.innerHTML = `
		${canManage ? `<button type="button" data-mg-compendium-action="ownership"><i class="fa-solid fa-user-shield"></i> Configure Ownership</button>` : ""}
		${canManage ? `<button type="button" data-mg-compendium-action="lock"><i class="fa-solid ${locked ? "fa-lock-open" : "fa-lock"}"></i> ${locked ? "Unlock Editing" : "Lock Editing"}</button>` : ""}
		${canManage ? `<button type="button" data-mg-compendium-action="duplicate"><i class="fa-regular fa-copy"></i> Duplicate Compendium</button>` : ""}
		${canManage ? `<button type="button" data-mg-compendium-action="import-all"><i class="fa-solid fa-file-import"></i> Import All Content</button>` : ""}
		${canDelete ? `<button type="button" class="danger" data-mg-compendium-action="delete"><i class="fa-solid fa-trash"></i> Delete</button>` : ""}
	`;

	menu.addEventListener("click", async clickEvent => {
		const button = clickEvent.target.closest("[data-mg-compendium-action]");
		if (!button) return;

		clickEvent.preventDefault();
		clickEvent.stopPropagation();
		mgCloseSceneContextMenu();
		await mgRunCompendiumAction(pack, button.dataset.mgCompendiumAction);
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

function mgOpenCompendiumFolderContextMenu(folderId, anchor, event = null) {
	const folder = game.folders?.get(folderId);
	if (!folder || folder.type !== "Compendium" || !game.user?.isGM) return;

	mgCloseSceneContextMenu();

	const menu = document.createElement("nav");
	menu.className = "mg-scene-context-menu mg-compendium-folder-context-menu";
	menu.dataset.mgCompendiumFolderContextMenu = folder.id;
	menu.innerHTML = `
		<button type="button" data-mg-folder-action="edit"><i class="fa-solid fa-pen-to-square"></i> Edit Folder</button>
		<button type="button" data-mg-folder-action="remove"><i class="fa-solid fa-trash"></i> Remove Folder</button>
	`;

	menu.addEventListener("click", async clickEvent => {
		const button = clickEvent.target.closest("[data-mg-folder-action]");
		if (!button) return;

		clickEvent.preventDefault();
		clickEvent.stopPropagation();
		mgCloseSceneContextMenu();
		await mgRunCompendiumFolderAction(folder, button.dataset.mgFolderAction);
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

async function mgRunCompendiumAction(pack, action) {
	try {
		switch (action) {
			case "ownership":
				await mgOpenCompendiumOwnershipConfig(pack);
				break;
			case "lock":
				await mgConfigurePack(pack, { locked: !mgIsPackLocked(pack) });
				break;
			case "duplicate":
				await mgDuplicateCompendium(pack);
				break;
			case "import-all":
				await mgImportAllCompendiumContent(pack);
				break;
			case "delete":
				await mgDeleteCompendium(pack);
				break;
		}
	} catch (err) {
		ui.notifications?.error("Compendium action failed.");
		console.warn("MG UI | Compendium action failed.", { pack: pack?.collection, action, err });
	}
}

async function mgOpenCompendiumOwnershipConfig(pack) {
	const PermissionConfig = mgGetFoundryAppClass("CompendiumPermissionConfig")
		?? mgGetFoundryAppClass("CompendiumOwnershipConfig");
	if (PermissionConfig) {
		const configs = [
			() => new PermissionConfig(pack),
			() => new PermissionConfig({ document: pack }),
			() => new PermissionConfig({ pack })
		];

		for (const createApp of configs) {
			try {
				const app = createApp();
				if (app?.render) {
					app.render(true);
					return;
				}
			} catch (err) {
				console.warn("MG UI | Compendium ownership config construction failed.", err);
			}
		}
	}

	if (typeof pack.configureOwnershipDialog === "function") {
		await pack.configureOwnershipDialog();
		return;
	}
	if (typeof pack.configureOwnership === "function") {
		await pack.configureOwnership();
		return;
	}
	if (typeof pack.sheet?.render === "function") {
		pack.sheet.render(true);
		return;
	}
	ui.notifications?.warn("Foundry does not expose compendium ownership configuration here.");
}

async function mgDuplicateCompendium(pack) {
	const source = pack?.metadata ?? {};
	const label = `${mgGetPackLabel(pack)} Copy`;
	const metadata = {
		...source,
		label,
		name: mgSlug(label),
		package: "world",
		locked: false
	};
	delete metadata.id;
	delete metadata.path;
	delete metadata.manifest;
	delete metadata.folder;

	const CompendiumCollectionClass = mgGetCompendiumCollectionClass();
	if (typeof CompendiumCollectionClass?.createCompendium !== "function") {
		ui.notifications?.warn("Foundry does not expose compendium duplication here.");
		return;
	}

	const duplicate = await mgCreateCompendiumPack(metadata, mgGetPackFolderId(pack));
	if (typeof pack.getDocuments === "function" && typeof duplicate?.importDocument === "function") {
		const docs = await pack.getDocuments();
		for (const doc of docs) await duplicate.importDocument(doc);
	}
	globalThis.mgRefreshCompendiumSidebarContent?.();
}

async function mgImportAllCompendiumContent(pack) {
	if (typeof pack.importAll === "function") {
		await pack.importAll();
		return;
	}
	if (typeof pack.importAllDialog === "function") {
		await pack.importAllDialog();
		return;
	}
	ui.notifications?.warn("Foundry does not expose import all for this compendium here.");
}

async function mgDeleteCompendium(pack) {
	if (!mgIsWorldCompendium(pack)) {
		ui.notifications?.warn("Only world compendiums can be deleted.");
		return;
	}

	const label = mgGetPackLabel(pack);
	const confirmed = await Dialog.confirm({
		title: `Delete ${label}?`,
		content: `<p>Delete <strong>${mgEsc(label)}</strong> and all documents inside it?</p>`,
		yes: () => true,
		no: () => false,
		defaultYes: false
	});

	if (!confirmed) return;

	const packId = mgGetPackId(pack);
	if (typeof pack.deleteCompendium === "function") await pack.deleteCompendium();
	else if (typeof mgGetCompendiumCollectionClass()?.deleteCompendium === "function") await mgGetCompendiumCollectionClass().deleteCompendium(packId);
	else if (typeof game.packs?.deleteCompendium === "function") await game.packs.deleteCompendium(packId);
	else {
		ui.notifications?.warn("Foundry does not expose compendium deletion here.");
		return;
	}

	await mgRemoveCompendiumFromUserOrder(packId);
	globalThis.mgRefreshCompendiumSidebarContent?.();
}

async function mgRunCompendiumFolderAction(folder, action) {
	try {
		switch (action) {
			case "edit":
				folder.sheet?.render(true, { focus: true });
				break;
			case "remove":
				await mgRemoveCompendiumFolderOnly(folder);
				break;
		}
	} catch (err) {
		ui.notifications?.error("Compendium folder action failed.");
		console.warn("MG UI | Compendium folder action failed.", { folder: folder?.id, action, err });
	}
}

async function mgRemoveCompendiumFolderOnly(folder) {
	const parentId = folder.folder?.id ?? folder.folder ?? null;
	const { folders, packs } = mgGetCompendiumFolderChildren(folder);
	const confirmed = await Dialog.confirm({
		title: `Remove ${folder.name}?`,
		content: `<p>Remove <strong>${mgEsc(folder.name)}</strong> and move its compendiums up one level?</p>`,
		yes: () => true,
		no: () => false,
		defaultYes: false
	});

	if (!confirmed) return;

	await Promise.all([
		...folders.map(child => child.update({ folder: parentId })),
		...packs.map(pack => mgConfigurePack(pack, { folder: parentId }))
	]);
	await folder.delete();
}

/* Compendium sidebar rendering
----------------------------------------------------------------------*/
function mgRenderCompendiumSidebarContent() {
	const canManage = game.user?.isGM;
	const packs = Array.from(game.packs ?? []);
	const folderTree = mgBuildCompendiumFolderTree(packs, { showAllFolders: canManage });
	const hasDirectoryEntries = packs.length > 0 || folderTree.folders.length > 0;
	const controls = canManage ? `
		<section class="mg-scene-directory-actions mg-compendium-directory-actions">
			<button type="button" class="mg-left-action" data-mg-compendium-create>
				<i class="fa-solid fa-book-medical"></i>
				Create Compendium
			</button>
			<button type="button" class="mg-left-action" data-mg-compendium-folder-create>
				<i class="fa-solid fa-folder"></i>
				Create Folder
			</button>
		</section>
	` : "";
	const search = `
		<label class="mg-scene-search mg-compendium-search">
			<i class="fa-solid fa-magnifying-glass"></i>
			<input type="search" placeholder="Search Compendiums" data-mg-compendium-search />
		</label>
	`;
	const collapseFolders = canManage ? `
		<button type="button" class="mg-left-action mg-compendium-collapse-folders" data-mg-compendium-collapse-folders>
			<i class="fa-solid fa-folder-tree"></i>
			Collapse Folders
		</button>
	` : "";

	return `
		<section class="mg-scene-directory mg-compendium-directory">
			<div class="mg-scene-directory-header">
				${controls}
				${mgRenderCompendiumsCard()}
			</div>

			${hasDirectoryEntries ? `
				<div class="mg-scene-directory-browser mg-compendium-directory-browser">
					${search}
					<hr class="mg-scene-directory-rule mg-compendium-directory-rule" />
					${collapseFolders}

					<div class="mg-scene-tree mg-compendium-tree" data-mg-compendium-tree data-mg-compendium-container="">
						${mgRenderCompendiumBranch(folderTree)}
					</div>

					<div class="mg-left-empty mg-compendium-empty-search" data-mg-compendium-empty-search hidden>
						No compendiums match this search.
					</div>
				</div>
			` : `<div class="mg-left-empty">No visible compendiums found.</div>`}
		</section>
	`;
}

function mgRenderCompendiumsCard() {
  return `
    <section class="mg-active-scene mg-active-compendiums">
      <div class="mg-active-scene-card mg-active-compendiums-card" style="background-image: url('${mgCssUrl(MG_COMPENDIUM_HEADER_IMAGE)}');">
        <span class="mg-active-scene-scrim"></span>
        <span class="mg-active-scene-kicker"><i class="fa-solid fa-box-archive"></i> Directory</span>
        <span class="mg-active-scene-title">Compendiums</span>
      </div>
    </section>
  `;
}

function mgBuildCompendiumFolderTree(packs, { showAllFolders = true } = {}) {
	const visibleFolderIds = new Set();
	for (const pack of packs) {
		let folderId = mgGetPackFolderId(pack);
		while (folderId) {
			visibleFolderIds.add(folderId);
			const folder = game.folders?.get(folderId);
			folderId = folder?.folder?.id ?? folder?.folder ?? null;
		}
	}
	const folders = Array.from(game.folders ?? [])
		.filter(folder => folder.type === "Compendium")
		.filter(folder => showAllFolders || visibleFolderIds.has(folder.id));
	const folderNodes = new Map(folders.map(folder => [
		folder.id,
		{ folder, folders: [], packs: [] }
	]));
	const root = { folders: [], packs: [] };

	for (const node of folderNodes.values()) {
		const parentId = mgGetCompendiumFolderTreeParentId(node.folder);
		const parent = parentId ? folderNodes.get(parentId) : null;
		(parent ?? root).folders.push(node);
	}

	for (const pack of packs) {
		const folderId = mgGetPackFolderId(pack);
		const parent = folderId ? folderNodes.get(folderId) : null;
		(parent ?? root).packs.push(pack);
	}

	return root;
}

function mgGetCompendiumFolderChildren(folder) {
	const folderId = folder?.id ?? null;
	const folders = Array.from(game.folders ?? [])
		.filter(child => child.type === "Compendium" && (child.folder?.id ?? child.folder ?? null) === folderId);
	const packs = Array.from(game.packs ?? [])
		.filter(pack => mgGetPackFolderId(pack) === folderId);

	return { folders, packs };
}

function mgGetCompendiumFolderParentId(folder) {
	return folder?.folder?.id ?? folder?.folder ?? null;
}

function mgGetCompendiumFolderDepth(folder) {
	let depth = 0;
	let current = folder;
	const seen = new Set();
	while (current && mgGetCompendiumFolderParentId(current)) {
		const parentId = mgGetCompendiumFolderParentId(current);
		if (seen.has(parentId)) break;
		seen.add(parentId);
		current = game.folders?.get(parentId);
		if (!current || current.type !== "Compendium") break;
		depth += 1;
	}
	return depth;
}

function mgGetCompendiumFolderTreeParentId(folder) {
	const parentId = mgGetCompendiumFolderParentId(folder);
	if (!parentId) return null;
	const parent = game.folders?.get(parentId);
	if (!parent || parent.type !== "Compendium") return null;
	return mgGetCompendiumFolderDepth(parent) > 0 ? mgGetCompendiumFolderParentId(parent) : parentId;
}

function mgRenderCompendiumBranch(node, depth = 0) {
	const entries = [
		...node.folders.map(folderNode => ({
			type: "folder",
			id: folderNode.folder.id,
			name: folderNode.folder.name,
			html: mgRenderCompendiumFolder(folderNode, depth)
		})),
		...node.packs.map(pack => ({
			type: "pack",
			id: mgGetPackId(pack),
			name: mgGetPackLabel(pack),
			html: mgRenderCompendiumRow(pack)
		}))
	];
	const order = mgGetCompendiumUserOrder()[mgGetCompendiumUserOrderKey(node.folder?.id ?? null)] ?? [];
	const orderMap = new Map(order.map((token, index) => [token, index]));

	return entries
		.sort((a, b) => {
			const aOrder = orderMap.get(mgCompendiumOrderEntryToken(a));
			const bOrder = orderMap.get(mgCompendiumOrderEntryToken(b));
			if (aOrder !== undefined || bOrder !== undefined) return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER);
			return a.name.localeCompare(b.name) || a.type.localeCompare(b.type);
		})
		.map(entry => entry.html)
		.join("");
}

function mgRenderCompendiumFolder(node, depth = 0) {
	const folder = node.folder;
	const id = `compendium-folder-${folder.id}`;
	const isOpen = mgIsAccordionOpen(null, id, true);
	const canCreateSubfolder = game.user?.isGM && depth === 0;
	const body = mgRenderCompendiumBranch(node, depth + 1) || `<div class="mg-left-empty mg-scene-folder-empty mg-compendium-folder-empty">No compendiums in this folder.</div>`;
	const color = String(folder.color ?? "").trim();
	const iconStyle = color ? ` style="color: ${mgAttr(color)};"` : "";

	return `
		<section
			class="mg-left-accordion mg-scene-folder-accordion mg-compendium-folder-accordion ${isOpen ? "is-open" : ""} ${depth > 0 ? "is-sub" : ""}"
			data-mg-accordion="${id}"
			data-mg-compendium-folder-id="${folder.id}"
		>
			<div
				class="mg-left-accordion-toggle mg-scene-folder-toggle mg-compendium-folder-toggle"
				data-mg-accordion-toggle="${id}"
				data-mg-compendium-folder-drop="${folder.id}"
				aria-expanded="${isOpen ? "true" : "false"}"
			>
				<span><i class="fa-solid fa-folder" data-mg-compendium-folder-icon${iconStyle}></i>${mgEsc(folder.name)}</span>
				<i class="fa-solid fa-chevron-down mg-left-accordion-chevron"></i>
			</div>
			<div class="mg-left-accordion-body" ${isOpen ? "" : "hidden"} style="max-height: ${isOpen ? "none" : "0px"};">
				<div class="mg-left-accordion-inner">
					<div class="mg-scene-folder-body mg-compendium-folder-body" data-mg-compendium-folder-body="${folder.id}" data-mg-compendium-container="${folder.id}">
						${game.user?.isGM ? `
							<div class="mg-scene-folder-actions mg-compendium-folder-actions">
								<button type="button" class="mg-scene-mini-action mg-compendium-mini-action" data-mg-compendium-create="${folder.id}" title="Create compendium in ${mgAttr(folder.name)}" aria-label="Create compendium in ${mgAttr(folder.name)}">
									<i class="fa-solid fa-plus"></i>
								</button>
								${canCreateSubfolder ? `
									<button type="button" class="mg-scene-mini-action mg-compendium-mini-action" data-mg-compendium-folder-create="${folder.id}" title="Create subfolder in ${mgAttr(folder.name)}" aria-label="Create subfolder in ${mgAttr(folder.name)}">
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

function mgRenderCompendiumRow(pack) {
	const id = mgGetPackId(pack);
	const label = mgGetPackLabel(pack);
	const type = mgGetPackType(pack);
	const image = mgGetCompendiumCardImage(pack);
	const folderId = mgGetPackFolderId(pack) || "";
	const locked = mgIsPackLocked(pack);
	const inaccessible = !mgCanUserSeePack(pack);
	const stateClass = `${locked ? " is-locked" : ""}${inaccessible ? " is-inaccessible" : ""}`;

	return `
		<article
			class="mg-scene-row mg-compendium-row${stateClass}"
			data-mg-compendium-id="${mgAttr(id)}"
			data-mg-compendium-name="${mgAttr(label)}"
			data-mg-compendium-type="${mgAttr(type)}"
			data-mg-compendium-folder="${mgAttr(folderId)}"
		>
			<button type="button" class="mg-scene-row-main mg-compendium-row-main" data-mg-open-pack="${mgAttr(id)}">
				<span class="mg-actor-row-image mg-compendium-row-image" aria-hidden="true">
					<img src="${mgEsc(image)}" alt="" />
				</span>
				<span class="mg-scene-row-scrim"></span>
				<span class="mg-scene-row-title mg-compendium-row-title">
					${mgEsc(label)}
					<small>${mgEsc(type)}</small>
				</span>
				<span class="mg-scene-row-badges mg-compendium-row-badges">
					${locked ? `<i class="fa-solid fa-lock" title="Locked"></i>` : `<i class="fa-solid fa-box-archive" title="Compendium"></i>`}
				</span>
			</button>
			<button type="button" class="mg-scene-context-button mg-compendium-context-button" data-mg-compendium-menu="${mgAttr(id)}" title="Compendium actions" aria-label="Compendium actions for ${mgAttr(label)}">
				<i class="fa-solid fa-ellipsis-vertical"></i>
			</button>
		</article>
	`;
}

globalThis.MGCompendiumSidebar = {
	bindContent: mgBindCompendiumSidebarContent,
	renderContent: mgRenderCompendiumSidebarContent
};

["renderCompendium", "renderCompendiumPack", "renderCompendiumCollection", "renderCompendiumDirectory"].forEach(hookName => {
	Hooks.on(hookName, (app, html) => {
		mgApplyCompendiumPopupImages(app, html);
		window.setTimeout(() => mgApplyCompendiumPopupImages(app, html), 0);
	});
});
