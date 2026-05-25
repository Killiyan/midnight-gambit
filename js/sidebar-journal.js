const MG_UI_NS = "midnight-gambit";
const MG_JOURNAL_USER_ORDER_FLAG = "journalSidebarOrder";
const MG_JOURNAL_CARD_IMAGE = "systems/midnight-gambit/assets/images/journals.jpg";

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

function mgGetJournalCollection() {
	return game.journal ?? game.journals ?? null;
}

function mgGetJournalEntryClass() {
	return globalThis.JournalEntry
		?? globalThis.CONFIG?.JournalEntry?.documentClass
		?? globalThis.foundry?.documents?.JournalEntry
		?? null;
}

function mgGetJournalImage(journal) {
	const flagged = journal?.getFlag?.(MG_UI_NS, "sidebarImage") || journal?.getFlag?.(MG_UI_NS, "image");
	if (flagged) return flagged;
	if (journal?.img) return journal.img;

	const imagePage = Array.from(journal?.pages ?? [])
		.find(page => page?.type === "image" && (page.src || page.system?.src));
	return imagePage?.src || imagePage?.system?.src || MG_JOURNAL_CARD_IMAGE;
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

function mgIsAccordionOpen(journal, id, fallback = true) {
	const shared = mgShared();
	return typeof shared.isAccordionOpen === "function" ? shared.isAccordionOpen(journal, id, fallback) : fallback;
}

function mgSetAccordionOpen(journal, id, open) {
	const shared = mgShared();
	if (typeof shared.setAccordionOpen === "function") shared.setAccordionOpen(journal, id, open);
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

/* Journal sidebar interactions
----------------------------------------------------------------------*/
function mgBindJournalEntrySidebarContent(root) {
	const panel = root?.querySelector(".mg-journal-directory");
	if (!panel) return;

	panel.querySelector("[data-mg-journal-search]")?.addEventListener("keydown", event => {
		if (event.key !== "Enter") return;
		event.preventDefault();
		mgFilterJournalEntrySidebar(panel, event.currentTarget.value);
	});

	panel.querySelector("[data-mg-journal-collapse-folders]")?.addEventListener("click", event => {
		event.preventDefault();
		mgCollapseJournalEntryFolders(panel);
	});

	panel.querySelectorAll("[data-mg-journal-create]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();
			await mgCreateJournalEntry(button.dataset.mgJournalCreate || null);
		});
	});

	panel.querySelectorAll("[data-mg-journal-folder-create]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();
			await mgCreateJournalEntryFolder(button.dataset.mgJournalFolderCreate || null);
		});
	});

	panel.querySelectorAll("[data-mg-journal-menu]").forEach(button => {
		button.addEventListener("click", event => {
			event.preventDefault();
			event.stopPropagation();
			const row = button.closest("[data-mg-journal-id]");
			mgOpenJournalEntryContextMenu(button.dataset.mgJournalMenu, button, row);
		});
	});

	panel.querySelectorAll("[data-mg-journal-id]").forEach(row => {
		row.addEventListener("contextmenu", event => {
			event.preventDefault();
			event.stopPropagation();
			mgOpenJournalEntryContextMenu(row.dataset.mgJournalId, row, row, event);
		});
	});

	panel.querySelectorAll("[data-mg-journal-folder-id]").forEach(folderEl => {
		folderEl.addEventListener("contextmenu", event => {
			event.preventDefault();
			event.stopPropagation();
			mgOpenJournalEntryFolderContextMenu(folderEl.dataset.mgJournalFolderId, folderEl, event);
		});
	});

	mgBindJournalEntrySidebarDrag(panel);
}

function mgFilterJournalEntrySidebar(panel, value) {
	const query = String(value ?? "").trim().toLowerCase();
	const rows = Array.from(panel.querySelectorAll("[data-mg-journal-id]"));
	let visibleRows = 0;

	rows.forEach(row => {
		const name = String(row.dataset.mgJournalName ?? "").toLowerCase();
		const visible = !query || name.includes(query);
		row.hidden = !visible;
		if (visible) visibleRows += 1;
	});

	panel.querySelectorAll(".mg-journal-folder-accordion[data-mg-accordion]").forEach(accordion => {
		const hasVisibleJournalEntry = !!accordion.querySelector('[data-mg-journal-id]:not([hidden])');
		accordion.hidden = query ? !hasVisibleJournalEntry : false;

		if (query && hasVisibleJournalEntry && !accordion.classList.contains("is-open")) {
			const button = accordion.querySelector("[data-mg-accordion-toggle]");
			if (button) mgToggleLeftAccordion(button);
		}
	});

	const anyVisible = visibleRows > 0 || !!panel.querySelector('[data-mg-accordion]:not([hidden]) [data-mg-journal-id]:not([hidden])');
	const empty = panel.querySelector("[data-mg-journal-empty-search]");
	if (empty) empty.hidden = !query || anyVisible;
}

function mgCollapseJournalEntryFolders(panel) {
	panel.querySelectorAll(".mg-journal-folder-accordion[data-mg-accordion]").forEach(accordion => {
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

/* Journal sidebar drag and drop
----------------------------------------------------------------------*/
function mgBindJournalEntrySidebarDrag(panel) {
	let dragging = null;

	const getDragJournalEntryId = event =>
		event.dataTransfer?.getData("application/x-mg-journal-id") || event.dataTransfer?.getData("text/plain") || dragging?.dataset?.mgJournalId || "";

	const getDragToken = () => {
		if (dragging?.dataset?.mgJournalId) return mgJournalOrderToken("journal", dragging.dataset.mgJournalId);
		if (dragging?.dataset?.mgJournalFolderId) return mgJournalOrderToken("folder", dragging.dataset.mgJournalFolderId);
		return "";
	};

	const clearDropState = () => {
		panel.querySelectorAll(".mg-journal-drop-target, .mg-journal-drop-folder").forEach(el => {
			el.classList.remove("mg-journal-drop-target", "mg-journal-drop-folder");
		});
	};

	const finalizeContainerOrder = async container => {
		const journalId = dragging?.dataset?.mgJournalId;
		const draggedFolderId = dragging?.dataset?.mgJournalFolderId;
		const dragToken = getDragToken();
		if (!dragToken || !container) return;

		const folderId = container.dataset.mgJournalContainer || null;
		const originalFolderId = dragging.dataset.mgJournalFolder || null;
		const originalDisplayContainer = dragging.dataset.mgJournalDisplayContainer || "";
		const entries = Array.from(container.children)
			.filter(el => el.matches?.(".mg-journal-row[data-mg-journal-id], [data-mg-journal-folder-id]"));

		if (!entries.some(entry => mgJournalOrderElementToken(entry) === dragToken)) {
			container.appendChild(dragging);
			entries.push(dragging);
		}

		if (!game.user?.isGM && mgNormalizeJournalEntryContainerId(folderId) !== mgNormalizeJournalEntryContainerId(originalDisplayContainer)) {
			container.querySelector(`[data-mg-journal-id="${mgCssEscape(journalId)}"]`)?.remove();
			return;
		}

		await mgSaveJournalEntryUserOrderFromContainer(container);

		if (journalId && game.user?.isGM && folderId !== originalFolderId) {
			const journal = mgGetJournalCollection()?.get(journalId);
			await journal?.update({ folder: folderId || null });
		}
		if (draggedFolderId && game.user?.isGM && folderId !== originalDisplayContainer) {
			const folder = game.folders?.get(draggedFolderId);
			await folder?.update({ folder: folderId || null });
		}
	};

	const getDirectDropTarget = (event, container) => {
		const target = event.target.closest(".mg-journal-row[data-mg-journal-id], [data-mg-journal-folder-id]");
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

	panel.querySelectorAll(".mg-journal-row[data-mg-journal-id]").forEach(row => {
		row.setAttribute("draggable", "true");

		row.addEventListener("dragstart", event => {
			event.stopPropagation();
			const journalId = row.dataset.mgJournalId || "";
			dragging = row;
			dragging.dataset.mgJournalDisplayContainer = dragging.parentElement?.dataset?.mgJournalContainer || "";
			row.classList.add("mg-dragging");
			event.dataTransfer?.setData("application/x-mg-journal-id", journalId);
			event.dataTransfer?.setData("text/plain", journalId);
			event.dataTransfer.effectAllowed = "move";
		});

		row.addEventListener("dragend", () => {
			row.classList.remove("mg-dragging");
			dragging = null;
			clearDropState();
		});
	});

	panel.querySelectorAll("[data-mg-journal-folder-id]").forEach(folder => {
		folder.setAttribute("draggable", "true");

		folder.addEventListener("dragstart", event => {
			if (event.target.closest(".mg-journal-row[data-mg-journal-id]") || event.target.closest("[data-mg-journal-folder-id]") !== folder) return;
			event.stopPropagation();
			dragging = folder;
			dragging.dataset.mgJournalDisplayContainer = dragging.parentElement?.dataset?.mgJournalContainer || "";
			folder.classList.add("mg-dragging");
			event.dataTransfer?.setData("application/x-mg-journal-folder-id", folder.dataset.mgJournalFolderId || "");
			event.dataTransfer?.setData("text/plain", folder.dataset.mgJournalFolderId || "");
			event.dataTransfer.effectAllowed = "move";
		});

		folder.addEventListener("dragend", () => {
			if (dragging !== folder) return;
			folder.classList.remove("mg-dragging");
			dragging = null;
			clearDropState();
		});
	});

	panel.querySelectorAll("[data-mg-journal-container]").forEach(container => {
		container.addEventListener("dragover", event => {
			if (!dragging) return;
			const isRootContainer = container.dataset.mgJournalContainer === "";
			const isDraggingFolder = !!dragging.dataset.mgJournalFolderId;
			const allowsFolderPromotion = isDraggingFolder && game.user?.isGM && isRootContainer;
			if (!allowsFolderPromotion && (isDraggingFolder || !game.user?.isGM) && mgNormalizeJournalEntryContainerId(container.dataset.mgJournalContainer) !== mgNormalizeJournalEntryContainerId(dragging.dataset.mgJournalDisplayContainer)) return;
			const nearestContainer = event.target.closest("[data-mg-journal-container]");
			if (!isRootContainer && nearestContainer !== container) return;
			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = "move";
			clearDropState();
			container.classList.add("mg-journal-drop-target");

			const target = getDirectDropTarget(event, container);
			if (target) insertDraggingNearTarget(event, container, target);
		});

		container.addEventListener("drop", async event => {
			if (!dragging) return;
			const isRootContainer = container.dataset.mgJournalContainer === "";
			const isDraggingFolder = !!dragging.dataset.mgJournalFolderId;
			const allowsFolderPromotion = isDraggingFolder && game.user?.isGM && isRootContainer;
			if (!allowsFolderPromotion && (isDraggingFolder || !game.user?.isGM) && mgNormalizeJournalEntryContainerId(container.dataset.mgJournalContainer) !== mgNormalizeJournalEntryContainerId(dragging.dataset.mgJournalDisplayContainer)) return;
			const nearestContainer = event.target.closest("[data-mg-journal-container]");
			if (!isRootContainer && nearestContainer !== container) return;
			event.preventDefault();
			event.stopPropagation();
			clearDropState();
			await finalizeContainerOrder(container);
		});
	});

	panel.querySelectorAll("[data-mg-journal-folder-drop]").forEach(folderDrop => {
		folderDrop.addEventListener("dragover", event => {
			if (!dragging?.dataset?.mgJournalId || !game.user?.isGM || !isFolderNestZone(event, folderDrop)) return;
			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = "move";
			clearDropState();
			folderDrop.classList.add("mg-journal-drop-folder");
		});

		folderDrop.addEventListener("drop", async event => {
			if (!dragging?.dataset?.mgJournalId) return;
			const journalId = getDragJournalEntryId(event);
			const folderId = folderDrop.dataset.mgJournalFolderDrop || null;
			const journal = journalId ? mgGetJournalCollection()?.get(journalId) : null;
			if (!journal || !game.user?.isGM || !isFolderNestZone(event, folderDrop)) return;

			event.preventDefault();
			event.stopPropagation();
			clearDropState();

			const folder = game.folders?.get(folderId);
			await journal.update({ folder: folderId || null });
			await mgAppendJournalEntryToUserOrder(folderId, journal.id);

			if (folder) mgSetAccordionOpen(null, `journal-folder-${folder.id}`, true);
		});
	});
}

/* Journal sidebar per-user ordering
----------------------------------------------------------------------*/
function mgNormalizeJournalEntryContainerId(folderId) {
	return folderId || "";
}

function mgGetJournalEntryUserOrder() {
	const order = game.user?.getFlag?.(MG_UI_NS, MG_JOURNAL_USER_ORDER_FLAG);
	return order && typeof order === "object" && !Array.isArray(order) ? { ...order } : {};
}

function mgGetJournalEntryUserOrderKey(folderId) {
	return mgNormalizeJournalEntryContainerId(folderId) || "root";
}

function mgJournalOrderToken(type, id) {
	return `${type}:${id}`;
}

function mgJournalOrderEntryToken(entry) {
	if (entry.type === "folder") return mgJournalOrderToken("folder", entry.id);
	return mgJournalOrderToken("journal", entry.id);
}

function mgJournalOrderElementToken(element) {
	if (element?.dataset?.mgJournalFolderId) return mgJournalOrderToken("folder", element.dataset.mgJournalFolderId);
	if (element?.dataset?.mgJournalId) return mgJournalOrderToken("journal", element.dataset.mgJournalId);
	return "";
}

async function mgSetJournalEntryUserOrderForContainer(folderId, tokens) {
	const order = mgGetJournalEntryUserOrder();
	order[mgGetJournalEntryUserOrderKey(folderId)] = Array.from(new Set(tokens.filter(Boolean)));
	await game.user?.setFlag?.(MG_UI_NS, MG_JOURNAL_USER_ORDER_FLAG, order);
}

async function mgSaveJournalEntryUserOrderFromContainer(container) {
	const folderId = container?.dataset?.mgJournalContainer || "";
	const tokens = Array.from(container?.children ?? [])
		.map(el => mgJournalOrderElementToken(el))
		.filter(Boolean);

	await mgSetJournalEntryUserOrderForContainer(folderId, tokens);
}

async function mgAppendJournalEntryToUserOrder(folderId, journalId) {
	const key = mgGetJournalEntryUserOrderKey(folderId);
	const order = mgGetJournalEntryUserOrder();
	const token = mgJournalOrderToken("journal", journalId);
	order[key] = [...(order[key] ?? []).filter(existing => existing !== token), token];
	await game.user?.setFlag?.(MG_UI_NS, MG_JOURNAL_USER_ORDER_FLAG, order);
}

/* Journal and journal folder creation
----------------------------------------------------------------------*/
async function mgCreateJournalEntry(folderId = null) {
	if (!game.user?.isGM) return;

	try {
		const JournalEntryClass = mgGetJournalEntryClass();
		if (!JournalEntryClass) {
			ui.notifications?.error("Could not find the Journal Entry document class.");
			console.warn("MG UI | JournalEntry class was unavailable.", { globalJournalEntry: globalThis.JournalEntry, config: globalThis.CONFIG?.JournalEntry });
			return;
		}

		if (typeof JournalEntryClass?.createDialog === "function") {
			await JournalEntryClass.createDialog({ folder: folderId || null }, { folder: folderId || null });
			return;
		}

		const journal = await JournalEntryClass.create({ name: "New Journal Entry", folder: folderId || null }, { renderSheet: false });
		journal?.sheet?.render(true, { focus: true });
	} catch (err) {
		ui.notifications?.error("Could not create journal.");
		console.warn("MG UI | Create journal failed.", err);
	}
}

async function mgCreateJournalEntryFolder(parentId = null) {
	if (!game.user?.isGM) return;

	try {
		const parent = parentId ? game.folders?.get(parentId) : null;
		if (parent && mgGetJournalEntryFolderDepth(parent) > 0) {
			ui.notifications?.warn("Journal folders can only be nested one level deep.");
			return;
		}

		if (typeof Folder?.createDialog === "function") {
			await Folder.createDialog({ type: "JournalEntry", folder: parentId || null }, { folder: parentId || null });
			return;
		}

		const folder = await Folder.create({ name: "New Folder", type: "JournalEntry", folder: parentId || null }, { renderSheet: false });
		folder?.sheet?.render(true, { focus: true });
	} catch (err) {
		ui.notifications?.error("Could not create journal folder.");
		console.warn("MG UI | Create journal folder failed.", err);
	}
}

/* Journal context menus
----------------------------------------------------------------------*/
function mgOpenJournalEntryContextMenu(journalId, anchor, row, event = null) {
	const journal = mgGetJournalCollection()?.get(journalId);
	if (!journal) return;

	mgCloseSceneContextMenu();

	const canManage = game.user?.isGM;
	const menu = document.createElement("nav");
	menu.className = "mg-scene-context-menu mg-journal-context-menu";
	menu.dataset.mgJournalContextMenu = journal.id;
	menu.innerHTML = `
		<button type="button" data-mg-journal-action="edit"><i class="fa-solid fa-pen-to-square"></i> Edit Journal</button>
		<button type="button" data-mg-journal-action="artwork"><i class="fa-solid fa-image"></i> View Image</button>
		${canManage ? `<button type="button" data-mg-journal-action="ownership"><i class="fa-solid fa-user-shield"></i> Configure Ownership</button>` : ""}
		<button type="button" data-mg-journal-action="export"><i class="fa-solid fa-file-export"></i> Export Data</button>
		${canManage ? `<button type="button" data-mg-journal-action="import"><i class="fa-solid fa-file-import"></i> Import Data</button>` : ""}
		${canManage ? `<button type="button" data-mg-journal-action="duplicate"><i class="fa-regular fa-copy"></i> Duplicate</button>` : ""}
		${canManage ? `<button type="button" class="danger" data-mg-journal-action="delete"><i class="fa-solid fa-trash"></i> Delete</button>` : ""}
	`;

	menu.addEventListener("click", async clickEvent => {
		const button = clickEvent.target.closest("[data-mg-journal-action]");
		if (!button) return;

		clickEvent.preventDefault();
		clickEvent.stopPropagation();
		mgCloseSceneContextMenu();
		await mgRunJournalEntryAction(journal, button.dataset.mgJournalAction);
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

function mgOpenJournalEntryFolderContextMenu(folderId, anchor, event = null) {
	const folder = game.folders?.get(folderId);
	if (!folder || folder.type !== "JournalEntry" || !game.user?.isGM) return;

	mgCloseSceneContextMenu();

	const menu = document.createElement("nav");
	menu.className = "mg-scene-context-menu mg-journal-folder-context-menu";
	menu.dataset.mgJournalFolderContextMenu = folder.id;
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
		await mgRunJournalEntryFolderAction(folder, button.dataset.mgFolderAction);
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

async function mgRunJournalEntryAction(journal, action) {
	try {
		switch (action) {
			case "edit":
				journal.sheet?.render(true, { focus: true });
				break;
			case "artwork":
				await mgViewJournalEntryArtwork(journal);
				break;
			case "ownership":
				await mgOpenJournalEntryOwnershipConfig(journal);
				break;
			case "export":
				journal.exportToJSON?.();
				break;
			case "import":
				journal.importFromJSONDialog?.();
				break;
			case "duplicate":
				await mgDuplicateJournalEntry(journal);
				break;
			case "delete":
				await mgDeleteJournalEntry(journal);
				break;
		}
	} catch (err) {
		ui.notifications?.error("Journal action failed.");
		console.warn("MG UI | Journal action failed.", { journal: journal?.id, action, err });
	}
}

async function mgViewJournalEntryArtwork(journal) {
	const src = mgGetJournalImage(journal);
	const title = journal.name || "Journal Image";
	const ImagePopoutApp = mgGetFoundryAppClass("ImagePopout");

	if (ImagePopoutApp) {
		const configs = [
			() => new ImagePopoutApp({ src, uuid: journal.uuid, window: { title } }),
			() => new ImagePopoutApp(src, { title, uuid: journal.uuid }),
			() => new ImagePopoutApp({ src, title, uuid: journal.uuid })
		];

		for (const createApp of configs) {
			try {
				const app = createApp();
				if (await mgRenderFoundryApp(app)) return;
			} catch (err) {
				console.warn("MG UI | Journal image popout construction failed.", err);
			}
		}
	}

	mgOpenFallbackArtworkDialog(journal, src, title);
}

function mgOpenFallbackArtworkDialog(journal, src, title) {
	const content = `
		<figure class="mg-journal-artwork-popout">
			<img src="${mgEsc(src)}" alt="${mgAttr(journal.name)}" />
			<figcaption>${mgEsc(journal.name)}</figcaption>
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

async function mgOpenJournalEntryOwnershipConfig(journal) {
	const OwnershipConfig = mgGetFoundryAppClass("DocumentOwnershipConfig");

	if (OwnershipConfig) {
		const configs = [
			() => new OwnershipConfig({ document: journal }),
			() => new OwnershipConfig(journal)
		];

		for (const createApp of configs) {
			try {
				const app = createApp();
				if (await mgRenderFoundryApp(app)) return;
			} catch (err) {
				console.warn("MG UI | JournalEntry ownership config construction failed.", err);
			}
		}
	}

	await mgOpenFallbackOwnershipDialog(journal);
}

async function mgOpenFallbackOwnershipDialog(journal) {
	if (!game.user?.isGM) return;

	const levels = mgGetOwnershipLevels();
	const defaultLevels = levels.filter(level => level.value >= 0);
	const ownership = { ...(journal.ownership ?? {}) };
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
		<form class="mg-journal-ownership-form">
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
		title: `Configure Ownership: ${journal.name}`,
		content,
		yes: async html => {
			const root = html?.jquery ? html[0] : html?.[0] ?? html;
			const form = root?.querySelector?.(".mg-journal-ownership-form");
			if (!form) return;

			const next = {};
			const defaultValue = Number(form.querySelector('[name="default"]')?.value ?? 0);
			next.default = Number.isFinite(defaultValue) ? defaultValue : 0;

			for (const user of users) {
				const raw = Number(form.elements?.[`user.${user.id}`]?.value ?? -1);
				if (Number.isFinite(raw) && raw >= 0) next[user.id] = raw;
			}

			await journal.update({ ownership: next });
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

async function mgDuplicateJournalEntry(journal) {
	const data = journal.toObject();
	delete data._id;
	data.name = `${journal.name} Copy`;
	await mgGetJournalEntryClass()?.create(data, { renderSheet: true });
}

async function mgDeleteJournalEntry(journal) {
	if (typeof journal.deleteDialog === "function") {
		await journal.deleteDialog();
		return;
	}

	const confirmed = await Dialog.confirm({
		title: `Delete ${journal.name}?`,
		content: `<p>Delete <strong>${mgEsc(journal.name)}</strong>?</p>`,
		yes: () => true,
		no: () => false,
		defaultYes: false
	});

	if (confirmed) await journal.delete();
}

async function mgRunJournalEntryFolderAction(folder, action) {
	try {
		switch (action) {
			case "edit":
				folder.sheet?.render(true, { focus: true });
				break;
			case "remove":
				await mgRemoveJournalEntryFolderOnly(folder);
				break;
			case "delete-all":
				await mgDeleteJournalEntryFolderContents(folder);
				break;
		}
	} catch (err) {
		ui.notifications?.error("Journal folder action failed.");
		console.warn("MG UI | Journal folder action failed.", { folder: folder?.id, action, err });
	}
}

function mgGetJournalEntryFolderChildren(folder) {
	const folderId = folder?.id ?? null;
	const folders = Array.from(game.folders ?? [])
		.filter(child => child.type === "JournalEntry" && (child.folder?.id ?? child.folder ?? null) === folderId);
	const journals = Array.from(mgGetJournalCollection() ?? [])
		.filter(journal => (journal.folder?.id ?? journal.folder ?? null) === folderId);

	return { folders, journals };
}

function mgCollectJournalEntryFolderTree(folder, out = { folders: [], journals: [] }) {
	const { folders, journals } = mgGetJournalEntryFolderChildren(folder);
	out.folders.push(folder);
	out.journals.push(...journals);
	folders.forEach(child => mgCollectJournalEntryFolderTree(child, out));
	return out;
}

async function mgRemoveJournalEntryFolderOnly(folder) {
	const parentId = folder.folder?.id ?? folder.folder ?? null;
	const { folders, journals } = mgGetJournalEntryFolderChildren(folder);
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
		...journals.map(journal => journal.update({ folder: parentId }))
	]);
	await folder.delete();
}

async function mgDeleteJournalEntryFolderContents(folder) {
	const collected = mgCollectJournalEntryFolderTree(folder);
	const confirmed = await Dialog.confirm({
		title: `Delete all in ${folder.name}?`,
		content: `<p>Delete <strong>${mgEsc(folder.name)}</strong>, ${collected.folders.length - 1} subfolders, and ${collected.journals.length} journals?</p>`,
		yes: () => true,
		no: () => false,
		defaultYes: false
	});

	if (!confirmed) return;

	const journalIds = collected.journals.map(journal => journal.id);
	const folderIds = collected.folders.map(f => f.id).reverse();
	const JournalEntryClass = mgGetJournalEntryClass();
	if (journalIds.length && typeof JournalEntryClass?.deleteDocuments === "function") await JournalEntryClass.deleteDocuments(journalIds);
	else await Promise.all(journalIds.map(id => mgGetJournalCollection()?.get(id)?.delete()));
	if (folderIds.length && typeof Folder.deleteDocuments === "function") await Folder.deleteDocuments(folderIds);
	else await Promise.all(folderIds.map(id => game.folders?.get(id)?.delete()));
}

/* Journal sidebar rendering
----------------------------------------------------------------------*/
function mgRenderJournalEntrySidebarContent() {
	const canManage = game.user?.isGM;
	const journals = Array.from(mgGetJournalCollection() ?? [])
		.filter(journal => canManage || mgCanUserSeeJournalEntry(journal));
	const folderTree = mgBuildJournalEntryFolderTree(journals, { showAllFolders: canManage });
	const hasDirectoryEntries = journals.length > 0 || folderTree.folders.length > 0;
	const controls = canManage ? `
		<section class="mg-scene-directory-actions mg-journal-directory-actions">
			<button type="button" class="mg-left-action" data-mg-journal-create>
				<i class="fa-solid fa-book-open"></i>
				Create Journal
			</button>
			<button type="button" class="mg-left-action" data-mg-journal-folder-create>
				<i class="fa-solid fa-folder"></i>
				Create Folder
			</button>
		</section>
	` : "";
	const search = `
		<label class="mg-scene-search mg-journal-search">
			<i class="fa-solid fa-magnifying-glass"></i>
			<input type="search" placeholder="Search Journals" data-mg-journal-search />
		</label>
	`;
	const collapseFolders = canManage ? `
		<button type="button" class="mg-left-action mg-journal-collapse-folders" data-mg-journal-collapse-folders>
			<i class="fa-solid fa-folder-tree"></i>
			Collapse Folders
		</button>
	` : "";

	return `
		<section class="mg-scene-directory mg-journal-directory">
			<div class="mg-scene-directory-header">
				${controls}
				${mgRenderJournalsCard()}
			</div>

			${hasDirectoryEntries ? `
				<div class="mg-scene-directory-browser mg-journal-directory-browser">
					${search}
					<hr class="mg-scene-directory-rule mg-journal-directory-rule" />
					${collapseFolders}

					<div class="mg-scene-tree mg-journal-tree" data-mg-journal-tree data-mg-journal-container="">
						${mgRenderJournalEntryBranch(folderTree)}
					</div>

					<div class="mg-left-empty mg-journal-empty-search" data-mg-journal-empty-search hidden>
						No journals match this search.
					</div>
				</div>
			` : `<div class="mg-left-empty">No visible journals found.</div>`}
		</section>
	`;
}

function mgRenderJournalsCard() {
	return `
		<section class="mg-active-scene mg-active-journals">
			<div class="mg-active-scene-card mg-active-journals-card" style="background-image: url('${mgCssUrl(MG_JOURNAL_CARD_IMAGE)}');">
				<span class="mg-active-scene-scrim"></span>
				<span class="mg-active-scene-kicker"><i class="fa-solid fa-book-open"></i> Directory</span>
				<span class="mg-active-scene-title">Journals</span>
			</div>
		</section>
	`;
}

function mgCanUserSeeJournalEntry(journal) {
	if (!journal) return false;
	if (journal.visible !== false) return true;
	try {
		return journal.testUserPermission?.(game.user, "LIMITED") ?? journal.isOwner;
	} catch (_) {
		return !!journal.isOwner;
	}
}

function mgBuildJournalEntryFolderTree(journals, { showAllFolders = true } = {}) {
	const visibleJournalEntryFolderIds = new Set();
	for (const journal of journals) {
		let folderId = journal.folder?.id ?? journal.folder ?? null;
		while (folderId) {
			visibleJournalEntryFolderIds.add(folderId);
			const folder = game.folders?.get(folderId);
			folderId = folder?.folder?.id ?? folder?.folder ?? null;
		}
	}
	const journalFolders = Array.from(game.folders ?? [])
		.filter(folder => folder.type === "JournalEntry")
		.filter(folder => showAllFolders || visibleJournalEntryFolderIds.has(folder.id));
	const folderNodes = new Map(journalFolders.map(folder => [
		folder.id,
		{ folder, folders: [], journals: [] }
	]));
	const root = { folders: [], journals: [] };

	for (const node of folderNodes.values()) {
		const parentId = mgGetJournalEntryFolderTreeParentId(node.folder);
		const parent = parentId ? folderNodes.get(parentId) : null;
		(parent ?? root).folders.push(node);
	}

	for (const journal of journals) {
		const folderId = journal.folder?.id ?? journal.folder ?? null;
		const parent = folderId ? folderNodes.get(folderId) : null;
		(parent ?? root).journals.push(journal);
	}

	return root;
}

function mgGetJournalEntryFolderParentId(folder) {
	return folder?.folder?.id ?? folder?.folder ?? null;
}

function mgGetJournalEntryFolderDepth(folder) {
	let depth = 0;
	let current = folder;
	const seen = new Set();
	while (current && mgGetJournalEntryFolderParentId(current)) {
		const parentId = mgGetJournalEntryFolderParentId(current);
		if (seen.has(parentId)) break;
		seen.add(parentId);
		current = game.folders?.get(parentId);
		if (!current || current.type !== "JournalEntry") break;
		depth += 1;
	}
	return depth;
}

function mgGetJournalEntryFolderTreeParentId(folder) {
	const parentId = mgGetJournalEntryFolderParentId(folder);
	if (!parentId) return null;
	const parent = game.folders?.get(parentId);
	if (!parent || parent.type !== "JournalEntry") return null;
	return mgGetJournalEntryFolderDepth(parent) > 0 ? mgGetJournalEntryFolderParentId(parent) : parentId;
}

function mgRenderJournalEntryBranch(node, depth = 0) {
	const entries = [
		...node.folders.map(folderNode => ({
			type: "folder",
			id: folderNode.folder.id,
			name: folderNode.folder.name,
			html: mgRenderJournalEntryFolder(folderNode, depth)
		})),
		...node.journals.map(journal => ({
			type: "journal",
			id: journal.id,
			name: journal.name,
			html: mgRenderJournalEntryRow(journal)
		}))
	];
	const order = mgGetJournalEntryUserOrder()[mgGetJournalEntryUserOrderKey(node.folder?.id ?? null)] ?? [];
	const orderMap = new Map(order.map((token, index) => [token, index]));

	return entries
		.sort((a, b) => {
			const aOrder = orderMap.get(mgJournalOrderEntryToken(a));
			const bOrder = orderMap.get(mgJournalOrderEntryToken(b));
			if (aOrder !== undefined || bOrder !== undefined) return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER);
			return a.name.localeCompare(b.name) || a.type.localeCompare(b.type);
		})
		.map(entry => entry.html)
		.join("");
}

function mgRenderJournalEntryFolder(node, depth = 0) {
	const folder = node.folder;
	const id = `journal-folder-${folder.id}`;
	const isOpen = mgIsAccordionOpen(null, id, true);
	const canCreateSubfolder = game.user?.isGM && depth === 0;
	const body = mgRenderJournalEntryBranch(node, depth + 1) || `<div class="mg-left-empty mg-scene-folder-empty mg-journal-folder-empty">No journals in this folder.</div>`;
	const color = String(folder.color ?? "").trim();
	const iconStyle = color ? ` style="color: ${mgAttr(color)};"` : "";

	return `
		<section
			class="mg-left-accordion mg-scene-folder-accordion mg-journal-folder-accordion ${isOpen ? "is-open" : ""} ${depth > 0 ? "is-sub" : ""}"
			data-mg-accordion="${id}"
			data-mg-journal-folder-id="${folder.id}"
		>
			<div
				class="mg-left-accordion-toggle mg-scene-folder-toggle mg-journal-folder-toggle"
				data-mg-accordion-toggle="${id}"
				data-mg-journal-folder-drop="${folder.id}"
				aria-expanded="${isOpen ? "true" : "false"}"
			>
				<span><i class="fa-solid fa-folder" data-mg-journal-folder-icon${iconStyle}></i>${mgEsc(folder.name)}</span>
				<i class="fa-solid fa-chevron-down mg-left-accordion-chevron"></i>
			</div>
			<div class="mg-left-accordion-body" ${isOpen ? "" : "hidden"} style="max-height: ${isOpen ? "none" : "0px"};">
				<div class="mg-left-accordion-inner">
					<div class="mg-scene-folder-body mg-journal-folder-body" data-mg-journal-folder-body="${folder.id}" data-mg-journal-container="${folder.id}">
						${game.user?.isGM ? `
							<div class="mg-scene-folder-actions mg-journal-folder-actions">
								<button type="button" class="mg-scene-mini-action mg-journal-mini-action" data-mg-journal-create="${folder.id}" title="Create journal in ${mgAttr(folder.name)}" aria-label="Create journal in ${mgAttr(folder.name)}">
									<i class="fa-solid fa-plus"></i>
								</button>
								${canCreateSubfolder ? `
									<button type="button" class="mg-scene-mini-action mg-journal-mini-action" data-mg-journal-folder-create="${folder.id}" title="Create subfolder in ${mgAttr(folder.name)}" aria-label="Create subfolder in ${mgAttr(folder.name)}">
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

function mgRenderJournalEntryRow(journal) {
	const img = mgGetJournalImage(journal);

	return `
		<article
			class="mg-scene-row mg-journal-row"
			data-mg-journal-id="${journal.id}"
			data-mg-journal-name="${mgAttr(journal.name)}"
			data-mg-journal-folder="${journal.folder?.id ?? journal.folder ?? ""}"
		>
			<button type="button" class="mg-scene-row-main mg-journal-row-main" data-mg-open-journal="${journal.id}">
				<span class="mg-actor-row-image mg-journal-row-image" aria-hidden="true">
					<img src="${mgEsc(img)}" alt="" />
				</span>
				<span class="mg-scene-row-scrim"></span>
				<span class="mg-scene-row-title mg-journal-row-title">${mgEsc(journal.name)}</span>
			</button>
			<button type="button" class="mg-scene-context-button mg-journal-context-button" data-mg-journal-menu="${journal.id}" title="Journal actions" aria-label="Journal actions for ${mgAttr(journal.name)}">
				<i class="fa-solid fa-ellipsis-vertical"></i>
			</button>
		</article>
	`;
}

globalThis.MGJournalSidebar = {
	bindContent: mgBindJournalEntrySidebarContent,
	renderContent: mgRenderJournalEntrySidebarContent
};
