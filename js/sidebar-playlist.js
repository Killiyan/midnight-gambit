const MG_UI_NS = "midnight-gambit";
const MG_PLAYLIST_USER_ORDER_FLAG = "playlistSidebarOrder";
const MG_PLAYLIST_IMAGE_FLAG = "sidebarImage";

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

function mgGetPlaylistImage(playlist) {
	return String(playlist?.getFlag?.(MG_UI_NS, MG_PLAYLIST_IMAGE_FLAG) ?? "").trim();
}

function mgGetPlaylistClass() {
	return globalThis.Playlist
		?? globalThis.CONFIG?.Playlist?.documentClass
		?? globalThis.foundry?.documents?.Playlist
		?? null;
}

function mgGetPlaylistSoundClass() {
	return globalThis.PlaylistSound
		?? globalThis.CONFIG?.PlaylistSound?.documentClass
		?? globalThis.foundry?.documents?.PlaylistSound
		?? null;
}

function mgInputToVolume(value) {
	if (globalThis.AudioHelper?.inputToVolume) return AudioHelper.inputToVolume(value);
	return Math.pow(Number(value) || 0, 1.5);
}

function mgVolumeToInput(value) {
	if (globalThis.AudioHelper?.volumeToInput) return AudioHelper.volumeToInput(value);
	return Math.pow(Number(value) || 0, 1 / 1.5);
}

function mgVolumePercent(value) {
	return Math.round(mgVolumeToInput(value) * 100);
}

function mgGetSetting(key, fallback = 1) {
	try {
		return game.settings?.get?.("core", key) ?? fallback;
	} catch (_) {
		return fallback;
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

function mgCloseContextMenu() {
	const shared = mgShared();
	if (typeof shared.closeContextMenu === "function") shared.closeContextMenu();
}

function mgCloseContextMenuOnEscape(event) {
	const shared = mgShared();
	if (typeof shared.closeContextMenuOnEscape === "function") shared.closeContextMenuOnEscape(event);
}

/* Playlist sidebar interactions
----------------------------------------------------------------------*/
function mgBindPlaylistSidebarContent(root) {
	const panel = root?.querySelector(".mg-playlist-directory");
	if (!panel) return;

	panel.querySelectorAll("[data-mg-playlist-volume]").forEach(slider => {
		slider.addEventListener("input", event => mgUpdatePlaylistGlobalVolume(event.currentTarget, false));
		slider.addEventListener("change", event => mgUpdatePlaylistGlobalVolume(event.currentTarget, true));
	});

	panel.querySelector("[data-mg-playlist-search]")?.addEventListener("input", event => {
		mgFilterPlaylistSidebar(panel, event.currentTarget.value);
	});

	panel.querySelector("[data-mg-playlist-collapse-folders]")?.addEventListener("click", event => {
		event.preventDefault();
		mgCollapsePlaylistFolders(panel);
	});

	panel.querySelectorAll("[data-mg-playlist-create]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();
			await mgCreatePlaylist(button.dataset.mgPlaylistCreate || null);
		});
	});

	panel.querySelectorAll("[data-mg-playlist-folder-create]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();
			await mgCreatePlaylistFolder(button.dataset.mgPlaylistFolderCreate || null);
		});
	});

	panel.querySelectorAll("[data-mg-playlist-toggle]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();
			const playlist = game.playlists?.get(button.dataset.mgPlaylistToggle);
			if (!playlist) return;
			if (playlist.playing) await mgPausePlaylist(playlist);
			else await playlist.playAll();
			globalThis.mgRefreshPlaylistSidebarContent?.();
		});
	});

	panel.querySelectorAll("[data-mg-playlist-stop]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();
			const playlist = game.playlists?.get(button.dataset.mgPlaylistStop);
			if (!playlist) return;
			await playlist.stopAll();
			globalThis.mgRefreshPlaylistSidebarContent?.();
		});
	});

	panel.querySelectorAll("[data-mg-playlist-next], [data-mg-playlist-prev]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();
			const id = button.dataset.mgPlaylistNext || button.dataset.mgPlaylistPrev;
			const playlist = game.playlists?.get(id);
			if (!playlist?.playNext) return;
			await playlist.playNext(undefined, { direction: button.dataset.mgPlaylistNext ? 1 : -1 });
		});
	});

	panel.querySelectorAll("[data-mg-playlist-sound-toggle]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();
			const playlist = game.playlists?.get(button.dataset.mgPlaylistId);
			const sound = playlist?.sounds?.get(button.dataset.mgPlaylistSoundToggle);
			if (!playlist || !sound) return;
			if (sound.playing) await sound.update({ playing: false, pausedTime: mgGetSoundCurrentTime(sound) });
			else await playlist.playSound(sound);
		});
	});

	panel.querySelectorAll("[data-mg-playlist-active-toggle]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();
			const playlist = game.playlists?.get(button.dataset.mgPlaylistId);
			const sound = playlist?.sounds?.get(button.dataset.mgPlaylistActiveToggle);
			if (!playlist || !sound) return;
			if (sound.playing) await sound.update({ playing: false, pausedTime: mgGetSoundCurrentTime(sound) });
			else await playlist.playSound(sound);
		});
	});

	panel.querySelectorAll("[data-mg-playlist-sound-stop]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();
			const playlist = game.playlists?.get(button.dataset.mgPlaylistId);
			const sound = playlist?.sounds?.get(button.dataset.mgPlaylistSoundStop);
			if (playlist && sound) await playlist.stopSound(sound);
		});
	});

	panel.querySelectorAll("[data-mg-playlist-sound-repeat]").forEach(button => {
		button.addEventListener("click", async event => {
			event.preventDefault();
			event.stopPropagation();
			const sound = game.playlists?.get(button.dataset.mgPlaylistId)?.sounds?.get(button.dataset.mgPlaylistSoundRepeat);
			if (!sound) return;
			await sound.update({ repeat: !sound.repeat });
			globalThis.mgRefreshPlaylistSidebarContent?.();
		});
	});

	panel.querySelectorAll("[data-mg-playlist-sound-volume]").forEach(slider => {
		slider.addEventListener("change", async event => {
			const playlist = game.playlists?.get(slider.dataset.mgPlaylistId);
			const sound = playlist?.sounds?.get(slider.dataset.mgPlaylistSoundVolume);
			if (!sound) return;
			const volume = mgInputToVolume(event.currentTarget.value);
			sound.updateSource?.({ volume });
			sound.sound?.fade?.(sound.effectiveVolume, { duration: mgGetPlaylistSoundClass()?.VOLUME_DEBOUNCE_MS ?? 100 });
			if (sound.isOwner) await sound.update?.({ volume }, { diff: false, render: false });
		});
	});

	panel.querySelectorAll("[data-mg-playlist-menu]").forEach(button => {
		button.addEventListener("click", event => {
			event.preventDefault();
			event.stopPropagation();
			const row = button.closest("[data-mg-playlist-id]");
			mgOpenPlaylistContextMenu(button.dataset.mgPlaylistMenu, button, row);
		});
	});

	panel.querySelectorAll("[data-mg-playlist-sound-row]").forEach(row => {
		row.addEventListener("contextmenu", event => {
			event.preventDefault();
			event.stopPropagation();
			mgOpenPlaylistSoundContextMenu(row.dataset.mgPlaylistId, row.dataset.mgPlaylistSoundId, row, event);
		});
	});

	panel.querySelectorAll(".mg-playlist-row[data-mg-playlist-id]").forEach(row => {
		row.addEventListener("contextmenu", event => {
			event.preventDefault();
			event.stopPropagation();
			mgOpenPlaylistContextMenu(row.dataset.mgPlaylistId, row, row, event);
		});
	});

	panel.querySelectorAll("[data-mg-playlist-folder-id]").forEach(folderEl => {
		folderEl.addEventListener("contextmenu", event => {
			event.preventDefault();
			event.stopPropagation();
			mgOpenPlaylistFolderContextMenu(folderEl.dataset.mgPlaylistFolderId, folderEl, event);
		});
	});

	mgBindPlaylistSidebarDrag(panel);
	mgStartPlaylistActiveTimeUpdates(panel);
}

async function mgUpdatePlaylistGlobalVolume(slider, persist) {
	const volume = mgInputToVolume(slider.value);
	const percent = mgVolumePercent(volume);
	const output = slider.closest(".mg-playlist-volume-row")?.querySelector("[data-mg-playlist-volume-value]");
	if (output) output.textContent = `${percent}%`;
	if (persist) await game.settings?.set?.("core", slider.name, volume);
}

function mgGetSoundCurrentTime(sound) {
	const current = sound?.sound?.currentTime;
	if (sound?.playing && Number.isFinite(current)) return Math.max(0, current);
	const paused = Number(sound?.pausedTime);
	return Number.isFinite(paused) ? Math.max(0, paused) : 0;
}

function mgHasSoundPausedTime(sound) {
	if (sound?.pausedTime === null || sound?.pausedTime === undefined || sound?.pausedTime === false) return false;
	return Number.isFinite(Number(sound.pausedTime));
}

function mgGetSoundDuration(sound) {
	const duration = sound?.sound?.duration;
	return Number.isFinite(duration) ? Math.max(0, duration) : 0;
}

function mgFormatPlaylistTime(seconds) {
	if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
	const whole = Math.floor(seconds);
	const minutes = Math.floor(whole / 60);
	const remainder = String(whole % 60).padStart(2, "0");
	return `${minutes}:${remainder}`;
}

function mgStartPlaylistActiveTimeUpdates(panel) {
	if (panel._mgPlaylistActiveTimer) window.clearInterval(panel._mgPlaylistActiveTimer);

	const update = () => {
		if (!panel.isConnected) {
			window.clearInterval(panel._mgPlaylistActiveTimer);
			panel._mgPlaylistActiveTimer = null;
			return;
		}

		panel.querySelectorAll("[data-mg-playlist-active-row]").forEach(row => {
			const playlist = game.playlists?.get(row.dataset.mgPlaylistId);
			const sound = playlist?.sounds?.get(row.dataset.mgPlaylistSoundId);
			if (!sound) return;

			const current = mgGetSoundCurrentTime(sound);
			const duration = mgGetSoundDuration(sound);
			const time = row.querySelector("[data-mg-playlist-active-time]");
			const progress = row.querySelector("[data-mg-playlist-active-progress]");
			if (time) time.textContent = `${mgFormatPlaylistTime(current)} / ${mgFormatPlaylistTime(duration)}`;
			if (progress) {
				progress.max = duration || 1;
				progress.value = duration ? Math.min(current, duration) : 0;
			}
		});
	};

	update();
	panel._mgPlaylistActiveTimer = window.setInterval(update, 1000);
}

async function mgPausePlaylist(playlist) {
	const updates = Array.from(playlist?.sounds ?? [])
		.filter(sound => sound.playing)
		.map(sound => ({
			_id: sound.id,
			playing: false,
			pausedTime: mgGetSoundCurrentTime(sound)
		}));

	if (!updates.length) {
		await playlist?.update?.({ playing: false });
		return;
	}

	await playlist.update({ playing: false, sounds: updates });
}

function mgFilterPlaylistSidebar(panel, value) {
	const query = String(value ?? "").trim().toLowerCase();
	let visibleRows = 0;

	panel.querySelectorAll(".mg-playlist-row-wrap[data-mg-playlist-id]").forEach(row => {
		const playlistName = String(row.dataset.mgPlaylistName ?? "").toLowerCase();
		const soundRows = Array.from(row.querySelectorAll("[data-mg-playlist-sound-row]"));
		let matchingSounds = 0;

		soundRows.forEach(soundRow => {
			const soundName = String(soundRow.dataset.mgPlaylistSoundName ?? "").toLowerCase();
			const soundVisible = !query || playlistName.includes(query) || soundName.includes(query);
			soundRow.hidden = !soundVisible;
			if (soundVisible) matchingSounds += 1;
		});

		const visible = !query || playlistName.includes(query) || matchingSounds > 0;
		row.hidden = !visible;
		if (visible) visibleRows += 1;
		if (query && visible && !row.classList.contains("is-open")) {
			const button = row.querySelector("[data-mg-accordion-toggle]");
			if (button) mgToggleLeftAccordion(button);
		}
	});

	panel.querySelectorAll(".mg-playlist-folder-accordion[data-mg-accordion]").forEach(accordion => {
		const hasVisible = !!accordion.querySelector(".mg-playlist-row-wrap[data-mg-playlist-id]:not([hidden])");
		accordion.hidden = query ? !hasVisible : false;
		if (query && hasVisible && !accordion.classList.contains("is-open")) {
			const button = accordion.querySelector("[data-mg-accordion-toggle]");
			if (button) mgToggleLeftAccordion(button);
		}
	});

	const empty = panel.querySelector("[data-mg-playlist-empty-search]");
	if (empty) empty.hidden = !query || visibleRows > 0;
}

function mgCollapsePlaylistFolders(panel) {
	panel.querySelectorAll(".mg-playlist-folder-accordion[data-mg-accordion]").forEach(accordion => {
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

/* Playlist drag and drop
----------------------------------------------------------------------*/
function mgBindPlaylistSidebarDrag(panel) {
	let dragging = null;

	const getDragPlaylistId = event =>
		event.dataTransfer?.getData("application/x-mg-playlist-id") || event.dataTransfer?.getData("text/plain") || dragging?.dataset?.mgPlaylistId || "";

	const getDragToken = () => {
		if (dragging?.dataset?.mgPlaylistId) return mgPlaylistOrderToken("playlist", dragging.dataset.mgPlaylistId);
		if (dragging?.dataset?.mgPlaylistFolderId) return mgPlaylistOrderToken("folder", dragging.dataset.mgPlaylistFolderId);
		return "";
	};

	const clearDropState = () => {
		panel.querySelectorAll(".mg-playlist-drop-target, .mg-playlist-drop-folder").forEach(el => {
			el.classList.remove("mg-playlist-drop-target", "mg-playlist-drop-folder");
		});
	};

	const finalizeContainerOrder = async container => {
		const playlistId = dragging?.dataset?.mgPlaylistId;
		const draggedFolderId = dragging?.dataset?.mgPlaylistFolderId;
		const dragToken = getDragToken();
		if (!dragToken || !container) return;

		const folderId = container.dataset.mgPlaylistContainer || null;
		const originalFolderId = dragging.dataset.mgPlaylistFolder || null;
		const originalDisplayContainer = dragging.dataset.mgPlaylistDisplayContainer || "";
		const entries = Array.from(container.children)
			.filter(el => el.matches?.(".mg-playlist-row-wrap[data-mg-playlist-id], [data-mg-playlist-folder-id]"));

		if (!entries.some(entry => mgPlaylistOrderElementToken(entry) === dragToken)) {
			container.appendChild(dragging);
			entries.push(dragging);
		}

		await mgSavePlaylistUserOrderFromContainer(container);
		if (playlistId && game.user?.isGM && folderId !== originalFolderId) {
			const playlist = game.playlists?.get(playlistId);
			await playlist?.update({ folder: folderId || null });
		}
		if (draggedFolderId && game.user?.isGM && folderId !== originalDisplayContainer) {
			const folder = game.folders?.get(draggedFolderId);
			await folder?.update({ folder: folderId || null });
		}
	};

	const getDirectDropTarget = (event, container) => {
		const target = event.target.closest(".mg-playlist-row-wrap[data-mg-playlist-id], [data-mg-playlist-folder-id]");
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

	panel.querySelectorAll(".mg-playlist-row-wrap[data-mg-playlist-id]").forEach(row => {
		row.setAttribute("draggable", "true");
		row.addEventListener("dragstart", event => {
			event.stopPropagation();
			dragging = row;
			dragging.dataset.mgPlaylistDisplayContainer = dragging.parentElement?.dataset?.mgPlaylistContainer || "";
			row.classList.add("mg-dragging");
			event.dataTransfer?.setData("application/x-mg-playlist-id", row.dataset.mgPlaylistId || "");
			event.dataTransfer?.setData("text/plain", row.dataset.mgPlaylistId || "");
			event.dataTransfer.effectAllowed = "move";
		});
		row.addEventListener("dragend", () => {
			row.classList.remove("mg-dragging");
			dragging = null;
			clearDropState();
		});
	});

	panel.querySelectorAll("[data-mg-playlist-folder-id]").forEach(folder => {
		folder.setAttribute("draggable", "true");
		folder.addEventListener("dragstart", event => {
			if (event.target.closest(".mg-playlist-row-wrap[data-mg-playlist-id]") || event.target.closest("[data-mg-playlist-folder-id]") !== folder) return;
			event.stopPropagation();
			dragging = folder;
			dragging.dataset.mgPlaylistDisplayContainer = dragging.parentElement?.dataset?.mgPlaylistContainer || "";
			folder.classList.add("mg-dragging");
			event.dataTransfer?.setData("application/x-mg-playlist-folder-id", folder.dataset.mgPlaylistFolderId || "");
			event.dataTransfer?.setData("text/plain", folder.dataset.mgPlaylistFolderId || "");
			event.dataTransfer.effectAllowed = "move";
		});
		folder.addEventListener("dragend", () => {
			if (dragging !== folder) return;
			folder.classList.remove("mg-dragging");
			dragging = null;
			clearDropState();
		});
	});

	panel.querySelectorAll("[data-mg-playlist-container]").forEach(container => {
		container.addEventListener("dragover", event => {
			if (!dragging) return;
			const isRootContainer = container.dataset.mgPlaylistContainer === "";
			const isDraggingFolder = !!dragging.dataset.mgPlaylistFolderId;
			const allowsFolderPromotion = isDraggingFolder && game.user?.isGM && isRootContainer;
			if (!allowsFolderPromotion && (isDraggingFolder || !game.user?.isGM) && mgNormalizePlaylistContainerId(container.dataset.mgPlaylistContainer) !== mgNormalizePlaylistContainerId(dragging.dataset.mgPlaylistDisplayContainer)) return;
			const nearestContainer = event.target.closest("[data-mg-playlist-container]");
			if (!isRootContainer && nearestContainer !== container) return;
			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = "move";
			clearDropState();
			container.classList.add("mg-playlist-drop-target");
			const target = getDirectDropTarget(event, container);
			if (target) insertDraggingNearTarget(event, container, target);
		});

		container.addEventListener("drop", async event => {
			if (!dragging) return;
			const isRootContainer = container.dataset.mgPlaylistContainer === "";
			const isDraggingFolder = !!dragging.dataset.mgPlaylistFolderId;
			const allowsFolderPromotion = isDraggingFolder && game.user?.isGM && isRootContainer;
			if (!allowsFolderPromotion && (isDraggingFolder || !game.user?.isGM) && mgNormalizePlaylistContainerId(container.dataset.mgPlaylistContainer) !== mgNormalizePlaylistContainerId(dragging.dataset.mgPlaylistDisplayContainer)) return;
			const nearestContainer = event.target.closest("[data-mg-playlist-container]");
			if (!isRootContainer && nearestContainer !== container) return;
			event.preventDefault();
			event.stopPropagation();
			clearDropState();
			await finalizeContainerOrder(container);
		});
	});

	panel.querySelectorAll("[data-mg-playlist-folder-drop]").forEach(folderDrop => {
		folderDrop.addEventListener("dragover", event => {
			if (!dragging?.dataset?.mgPlaylistId || !game.user?.isGM || !isFolderNestZone(event, folderDrop)) return;
			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = "move";
			clearDropState();
			folderDrop.classList.add("mg-playlist-drop-folder");
		});

		folderDrop.addEventListener("drop", async event => {
			if (!dragging?.dataset?.mgPlaylistId) return;
			const playlistId = getDragPlaylistId(event);
			const folderId = folderDrop.dataset.mgPlaylistFolderDrop || null;
			const playlist = playlistId ? game.playlists?.get(playlistId) : null;
			if (!playlist || !game.user?.isGM || !isFolderNestZone(event, folderDrop)) return;
			event.preventDefault();
			event.stopPropagation();
			clearDropState();
			const folder = game.folders?.get(folderId);
			await playlist.update({ folder: folderId || null });
			await mgAppendPlaylistToUserOrder(folderId, playlist.id);
			if (folder) mgSetAccordionOpen(null, `playlist-folder-${folder.id}`, true);
		});
	});
}

/* Playlist ordering
----------------------------------------------------------------------*/
function mgNormalizePlaylistContainerId(folderId) {
	return folderId || "";
}

function mgGetPlaylistUserOrder() {
	const order = game.user?.getFlag?.(MG_UI_NS, MG_PLAYLIST_USER_ORDER_FLAG);
	return order && typeof order === "object" && !Array.isArray(order) ? { ...order } : {};
}

function mgGetPlaylistUserOrderKey(folderId) {
	return mgNormalizePlaylistContainerId(folderId) || "root";
}

function mgPlaylistOrderToken(type, id) {
	return `${type}:${id}`;
}

function mgPlaylistOrderEntryToken(entry) {
	if (entry.type === "folder") return mgPlaylistOrderToken("folder", entry.id);
	return mgPlaylistOrderToken("playlist", entry.id);
}

function mgPlaylistOrderElementToken(element) {
	if (element?.dataset?.mgPlaylistFolderId) return mgPlaylistOrderToken("folder", element.dataset.mgPlaylistFolderId);
	if (element?.dataset?.mgPlaylistId) return mgPlaylistOrderToken("playlist", element.dataset.mgPlaylistId);
	return "";
}

async function mgSetPlaylistUserOrderForContainer(folderId, tokens) {
	const order = mgGetPlaylistUserOrder();
	order[mgGetPlaylistUserOrderKey(folderId)] = Array.from(new Set(tokens.filter(Boolean)));
	await game.user?.setFlag?.(MG_UI_NS, MG_PLAYLIST_USER_ORDER_FLAG, order);
}

async function mgSavePlaylistUserOrderFromContainer(container) {
	const folderId = container?.dataset?.mgPlaylistContainer || "";
	const tokens = Array.from(container?.children ?? [])
		.map(el => mgPlaylistOrderElementToken(el))
		.filter(Boolean);
	await mgSetPlaylistUserOrderForContainer(folderId, tokens);
}

async function mgAppendPlaylistToUserOrder(folderId, playlistId) {
	const key = mgGetPlaylistUserOrderKey(folderId);
	const order = mgGetPlaylistUserOrder();
	const token = mgPlaylistOrderToken("playlist", playlistId);
	order[key] = [...(order[key] ?? []).filter(existing => existing !== token), token];
	await game.user?.setFlag?.(MG_UI_NS, MG_PLAYLIST_USER_ORDER_FLAG, order);
}

/* Creation and context menus
----------------------------------------------------------------------*/
async function mgCreatePlaylist(folderId = null) {
	if (!game.user?.isGM) return;
	try {
		const PlaylistClass = mgGetPlaylistClass();
		if (!PlaylistClass) {
			ui.notifications?.error("Could not find the Playlist document class.");
			return;
		}
		if (typeof PlaylistClass?.createDialog === "function") {
			await PlaylistClass.createDialog({ folder: folderId || null }, { folder: folderId || null });
			return;
		}
		const playlist = await PlaylistClass?.create?.({ name: "New Playlist", folder: folderId || null }, { renderSheet: true });
		playlist?.sheet?.render?.(true, { focus: true });
	} catch (err) {
		ui.notifications?.error("Could not create playlist.");
		console.warn("MG UI | Create playlist failed.", err);
	}
}

async function mgCreatePlaylistFolder(parentId = null) {
	if (!game.user?.isGM) return;
	try {
		const parent = parentId ? game.folders?.get(parentId) : null;
		if (parent && mgGetPlaylistFolderDepth(parent) > 0) {
			ui.notifications?.warn("Playlist folders can only be nested one level deep.");
			return;
		}
		if (typeof Folder?.createDialog === "function") {
			await Folder.createDialog({ type: "Playlist", folder: parentId || null }, { folder: parentId || null });
			return;
		}
		const folder = await Folder.create({ name: "New Folder", type: "Playlist", folder: parentId || null }, { renderSheet: false });
		folder?.sheet?.render?.(true, { focus: true });
	} catch (err) {
		ui.notifications?.error("Could not create playlist folder.");
		console.warn("MG UI | Create playlist folder failed.", err);
	}
}

function mgOpenPlaylistContextMenu(playlistId, anchor, row, event = null) {
	const playlist = game.playlists?.get(playlistId);
	if (!playlist) return;
	mgCloseContextMenu();
	const canManage = game.user?.isGM;
	if (!canManage) return;
	const menu = document.createElement("nav");
	menu.className = "mg-scene-context-menu mg-playlist-context-menu";
	menu.innerHTML = `
		<button type="button" data-mg-playlist-action="edit"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
		<button type="button" data-mg-playlist-action="sound"><i class="fa-solid fa-music"></i> Add Sound</button>
		<button type="button" data-mg-playlist-action="duplicate"><i class="fa-regular fa-copy"></i> Duplicate</button>
		<button type="button" class="danger" data-mg-playlist-action="delete"><i class="fa-solid fa-trash"></i> Delete</button>
	`;
	menu.addEventListener("click", async clickEvent => {
		const button = clickEvent.target.closest("[data-mg-playlist-action]");
		if (!button) return;
		clickEvent.preventDefault();
		clickEvent.stopPropagation();
		mgCloseContextMenu();
		await mgRunPlaylistAction(playlist, button.dataset.mgPlaylistAction);
	});
	document.body.appendChild(menu);
	const rect = event ? { left: event.clientX, bottom: event.clientY } : (anchor ?? row)?.getBoundingClientRect?.();
	const menuRect = menu.getBoundingClientRect();
	menu.style.left = `${Math.min(window.innerWidth - menuRect.width - 8, Math.max(8, rect.left))}px`;
	menu.style.top = `${Math.min(window.innerHeight - menuRect.height - 8, Math.max(8, rect.bottom + 4))}px`;
	window.setTimeout(() => {
		document.addEventListener("click", mgCloseContextMenu);
		document.addEventListener("keydown", mgCloseContextMenuOnEscape);
	}, 0);
}

function mgBindPlaylistConfigImageField(app, html) {
	const playlist = app?.object;
	if (!playlist || playlist.documentName !== "Playlist") return;
	const element = html instanceof HTMLElement ? html : html?.[0];
	const form = element?.querySelector?.("form");
	if (!form || form.querySelector("[data-mg-playlist-image-field]")) return;

	const value = mgGetPlaylistImage(playlist);
	const group = document.createElement("div");
	group.className = "form-group mg-playlist-config-image";
	group.dataset.mgPlaylistImageField = "true";
	group.innerHTML = `
		<label>Sidebar Image</label>
		<div class="form-fields">
			<input type="text" name="flags.${MG_UI_NS}.${MG_PLAYLIST_IMAGE_FLAG}" value="${mgAttr(value)}" placeholder="path/to/image.webp" data-mg-playlist-config-image-input />
			<button type="button" class="file-picker" data-type="image" data-mg-playlist-config-image-picker title="Browse Files" aria-label="Browse Files">
				<i class="fa-solid fa-file-import"></i>
			</button>
		</div>
		<p class="hint">Optional image used by the Midnight Gambit playlist sidebar.</p>
	`;

	const footer = form.querySelector("footer, .form-footer, button[type='submit']")?.closest("footer, .form-footer") ?? form.querySelector("button[type='submit']");
	if (footer) footer.before(group);
	else form.appendChild(group);

	const input = group.querySelector("[data-mg-playlist-config-image-input]");
	group.querySelector("[data-mg-playlist-config-image-picker]")?.addEventListener("click", event => {
		event.preventDefault();
		if (typeof FilePicker !== "function") return;
		new FilePicker({
			type: "image",
			current: input?.value ?? "",
			callback: path => {
				if (!input) return;
				input.value = path;
				input.dispatchEvent(new Event("change", { bubbles: true }));
			}
		}).render(true);
	});
}

function mgOpenPlaylistSoundContextMenu(playlistId, soundId, anchor, event = null) {
	const playlist = game.playlists?.get(playlistId);
	const sound = playlist?.sounds?.get(soundId);
	if (!sound || !game.user?.isGM) return;
	mgCloseContextMenu();
	const menu = document.createElement("nav");
	menu.className = "mg-scene-context-menu mg-playlist-sound-context-menu";
	menu.innerHTML = `
		<button type="button" data-mg-playlist-sound-action="edit"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
		<button type="button" class="danger" data-mg-playlist-sound-action="delete"><i class="fa-solid fa-trash"></i> Delete</button>
	`;
	menu.addEventListener("click", async clickEvent => {
		const button = clickEvent.target.closest("[data-mg-playlist-sound-action]");
		if (!button) return;
		clickEvent.preventDefault();
		clickEvent.stopPropagation();
		mgCloseContextMenu();
		await mgRunPlaylistSoundAction(sound, button.dataset.mgPlaylistSoundAction);
	});
	document.body.appendChild(menu);
	const rect = event ? { left: event.clientX, bottom: event.clientY } : anchor?.getBoundingClientRect?.();
	const menuRect = menu.getBoundingClientRect();
	menu.style.left = `${Math.min(window.innerWidth - menuRect.width - 8, Math.max(8, rect.left))}px`;
	menu.style.top = `${Math.min(window.innerHeight - menuRect.height - 8, Math.max(8, rect.bottom + 4))}px`;
	window.setTimeout(() => {
		document.addEventListener("click", mgCloseContextMenu);
		document.addEventListener("keydown", mgCloseContextMenuOnEscape);
	}, 0);
}

function mgOpenPlaylistFolderContextMenu(folderId, anchor, event = null) {
	const folder = game.folders?.get(folderId);
	if (!folder || folder.type !== "Playlist" || !game.user?.isGM) return;
	mgCloseContextMenu();
	const menu = document.createElement("nav");
	menu.className = "mg-scene-context-menu mg-playlist-folder-context-menu";
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
		mgCloseContextMenu();
		await mgRunPlaylistFolderAction(folder, button.dataset.mgFolderAction);
	});
	document.body.appendChild(menu);
	const rect = event ? { left: event.clientX, bottom: event.clientY } : anchor?.getBoundingClientRect?.();
	const menuRect = menu.getBoundingClientRect();
	menu.style.left = `${Math.min(window.innerWidth - menuRect.width - 8, Math.max(8, rect.left))}px`;
	menu.style.top = `${Math.min(window.innerHeight - menuRect.height - 8, Math.max(8, rect.bottom + 4))}px`;
	window.setTimeout(() => {
		document.addEventListener("click", mgCloseContextMenu);
		document.addEventListener("keydown", mgCloseContextMenuOnEscape);
	}, 0);
}

async function mgRunPlaylistAction(playlist, action) {
	try {
		switch (action) {
			case "toggle":
				if (playlist.playing) await playlist.stopAll();
				else await playlist.playAll();
				break;
			case "next":
				await playlist.playNext?.();
				break;
			case "edit":
				playlist.sheet?.render?.(true, { focus: true });
				break;
			case "sound":
				await mgCreatePlaylistSound(playlist);
				break;
			case "duplicate":
				await mgDuplicatePlaylist(playlist);
				break;
			case "delete":
				await mgDeletePlaylist(playlist);
				break;
		}
	} catch (err) {
		ui.notifications?.error("Playlist action failed.");
		console.warn("MG UI | Playlist action failed.", { playlist: playlist?.id, action, err });
	}
}

async function mgCreatePlaylistSound(playlist) {
	const PlaylistSoundClass = mgGetPlaylistSoundClass();
	if (!PlaylistSoundClass) {
		ui.notifications?.error("Could not find the Playlist Sound document class.");
		return;
	}
	const sound = new PlaylistSoundClass({ name: game.i18n?.localize?.("SOUND.New") ?? "New Sound" }, { parent: playlist });
	sound.sheet?.render?.(true);
}

async function mgRunPlaylistSoundAction(sound, action) {
	try {
		switch (action) {
			case "edit":
				sound.sheet?.render?.(true, { focus: true });
				break;
			case "delete":
				await mgDeletePlaylistSound(sound);
				break;
		}
	} catch (err) {
		ui.notifications?.error("Sound action failed.");
		console.warn("MG UI | Playlist sound action failed.", { sound: sound?.id, action, err });
	}
}

async function mgDeletePlaylistSound(sound) {
	if (typeof sound.deleteDialog === "function") {
		await sound.deleteDialog();
		return;
	}
	const confirmed = await Dialog.confirm({
		title: `Delete ${sound.name}?`,
		content: `<p>Delete <strong>${mgEsc(sound.name)}</strong>?</p>`,
		yes: () => true,
		no: () => false,
		defaultYes: false
	});
	if (confirmed) await sound.delete();
}

async function mgDuplicatePlaylist(playlist) {
	const data = playlist.toObject();
	delete data._id;
	data.name = `${playlist.name} Copy`;
	await mgGetPlaylistClass()?.create?.(data, { renderSheet: true });
}

async function mgDeletePlaylist(playlist) {
	if (typeof playlist.deleteDialog === "function") {
		await playlist.deleteDialog();
		return;
	}
	const confirmed = await Dialog.confirm({
		title: `Delete ${playlist.name}?`,
		content: `<p>Delete <strong>${mgEsc(playlist.name)}</strong>?</p>`,
		yes: () => true,
		no: () => false,
		defaultYes: false
	});
	if (confirmed) await playlist.delete();
}

async function mgRunPlaylistFolderAction(folder, action) {
	try {
		switch (action) {
			case "edit":
				folder.sheet?.render?.(true, { focus: true });
				break;
			case "remove":
				await mgRemovePlaylistFolderOnly(folder);
				break;
			case "delete-all":
				await mgDeletePlaylistFolderContents(folder);
				break;
		}
	} catch (err) {
		ui.notifications?.error("Playlist folder action failed.");
		console.warn("MG UI | Playlist folder action failed.", { folder: folder?.id, action, err });
	}
}

function mgGetPlaylistFolderChildren(folder) {
	const folderId = folder?.id ?? null;
	const folders = Array.from(game.folders ?? [])
		.filter(child => child.type === "Playlist" && (child.folder?.id ?? child.folder ?? null) === folderId);
	const playlists = Array.from(game.playlists ?? [])
		.filter(playlist => (playlist.folder?.id ?? playlist.folder ?? null) === folderId);
	return { folders, playlists };
}

function mgCollectPlaylistFolderTree(folder, out = { folders: [], playlists: [] }) {
	const { folders, playlists } = mgGetPlaylistFolderChildren(folder);
	out.folders.push(folder);
	out.playlists.push(...playlists);
	folders.forEach(child => mgCollectPlaylistFolderTree(child, out));
	return out;
}

async function mgRemovePlaylistFolderOnly(folder) {
	const parentId = folder.folder?.id ?? folder.folder ?? null;
	const { folders, playlists } = mgGetPlaylistFolderChildren(folder);
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
		...playlists.map(playlist => playlist.update({ folder: parentId }))
	]);
	await folder.delete();
}

async function mgDeletePlaylistFolderContents(folder) {
	const collected = mgCollectPlaylistFolderTree(folder);
	const confirmed = await Dialog.confirm({
		title: `Delete all in ${folder.name}?`,
		content: `<p>Delete <strong>${mgEsc(folder.name)}</strong>, ${collected.folders.length - 1} subfolders, and ${collected.playlists.length} playlists?</p>`,
		yes: () => true,
		no: () => false,
		defaultYes: false
	});
	if (!confirmed) return;
	const playlistIds = collected.playlists.map(playlist => playlist.id);
	const folderIds = collected.folders.map(f => f.id).reverse();
	const PlaylistClass = mgGetPlaylistClass();
	if (playlistIds.length && typeof PlaylistClass?.deleteDocuments === "function") await PlaylistClass.deleteDocuments(playlistIds);
	else await Promise.all(playlistIds.map(id => game.playlists?.get(id)?.delete()));
	if (folderIds.length && typeof Folder.deleteDocuments === "function") await Folder.deleteDocuments(folderIds);
	else await Promise.all(folderIds.map(id => game.folders?.get(id)?.delete()));
}

/* Rendering
----------------------------------------------------------------------*/
function mgRenderPlaylistSidebarContent() {
	const canManage = game.user?.isGM;
	const playlists = Array.from(game.playlists ?? []).filter(playlist => canManage || mgCanUserSeePlaylist(playlist));
	const folderTree = mgBuildPlaylistFolderTree(playlists, { showAllFolders: canManage });
	const hasDirectoryEntries = playlists.length > 0 || folderTree.folders.length > 0;
	const controls = canManage ? `
		<section class="mg-scene-directory-actions mg-playlist-directory-actions">
			<button type="button" class="mg-left-action" data-mg-playlist-create>
				<i class="fa-solid fa-music"></i>
				Create Playlist
			</button>
			<button type="button" class="mg-left-action" data-mg-playlist-folder-create>
				<i class="fa-solid fa-folder"></i>
				Create Folder
			</button>
		</section>
	` : "";
	const search = `
		<label class="mg-scene-search mg-playlist-search">
			<i class="fa-solid fa-magnifying-glass"></i>
			<input type="search" placeholder="Search Playlists" data-mg-playlist-search />
		</label>
	`;
	const collapseFolders = canManage ? `
		<button type="button" class="mg-left-action mg-playlist-collapse-folders" data-mg-playlist-collapse-folders>
			<i class="fa-solid fa-folder-tree"></i>
			Collapse Folders
		</button>
	` : "";

	return `
		<section class="mg-scene-directory mg-playlist-directory">
			<div class="mg-scene-directory-header">
				${controls}
				${mgRenderActiveSoundsPanel()}
				${mgRenderVolumeControls()}
			</div>

			${hasDirectoryEntries ? `
				<div class="mg-scene-directory-browser mg-playlist-directory-browser">
					${search}
					<hr class="mg-scene-directory-rule mg-playlist-directory-rule" />
					${collapseFolders}

					<div class="mg-scene-tree mg-playlist-tree" data-mg-playlist-tree data-mg-playlist-container="">
						${mgRenderPlaylistBranch(folderTree)}
					</div>

					<div class="mg-left-empty mg-playlist-empty-search" data-mg-playlist-empty-search hidden>
						No playlists match this search.
					</div>
				</div>
			` : `<div class="mg-left-empty">No playlists found.</div>`}
		</section>
	`;
}

function mgRenderActiveSoundsPanel() {
	const activeSounds = Array.from(game.playlists ?? []).flatMap(playlist =>
		Array.from(playlist.sounds ?? [])
			.filter(sound => sound.playing || mgHasSoundPausedTime(sound))
			.map(sound => ({ playlist, sound }))
	);
	const body = activeSounds.length
		? activeSounds.map(({ playlist, sound }) => mgRenderActiveSoundRow(playlist, sound)).join("")
		: `<div class="mg-left-empty mg-playlist-active-empty">No sounds playing.</div>`;
	return `
		<section class="mg-playlist-active-sounds">
			<header class="mg-playlist-panel-header">
				<span><i class="fa-solid fa-volume-high"></i> Active Sounds</span>
			</header>
			<div class="mg-playlist-active-list">${body}</div>
		</section>
	`;
}

function mgRenderActiveSoundRow(playlist, sound) {
	const current = mgGetSoundCurrentTime(sound);
	const duration = mgGetSoundDuration(sound);

	return `
		<article
			class="mg-playlist-active-row ${sound.playing ? "is-active" : "is-paused"}"
			data-mg-playlist-active-row
			data-mg-playlist-id="${playlist.id}"
			data-mg-playlist-sound-id="${sound.id}"
			data-mg-playlist-sound-row
			data-mg-playlist-sound-name="${mgAttr(sound.name)}"
		>
			<div class="mg-playlist-active-main">
				<span>
					<strong>${mgEsc(sound.name)}</strong>
					<small>${mgEsc(playlist.name)}</small>
				</span>
				<div class="mg-playlist-active-progress-row">
					<output data-mg-playlist-active-time>${mgFormatPlaylistTime(current)} / ${mgFormatPlaylistTime(duration)}</output>
					<progress value="${Math.min(current, duration || current)}" max="${duration || 1}" data-mg-playlist-active-progress></progress>
				</div>
			</div>
			<label class="mg-playlist-active-volume" title="Volume for ${mgAttr(sound.name)}">
				<i class="fa-solid fa-volume-low"></i>
				<input type="range" min="0" max="1" step="0.01" value="${mgVolumeToInput(sound.volume ?? 1)}" data-mg-playlist-sound-volume="${sound.id}" data-mg-playlist-id="${playlist.id}" aria-label="Volume for ${mgAttr(sound.name)}" />
			</label>

			<div class="mg-playlist-active-actions">
				<button type="button" class="mg-playlist-sound-control" data-mg-playlist-active-toggle="${sound.id}" data-mg-playlist-id="${playlist.id}" title="${sound.playing ? "Pause" : "Play"} ${mgAttr(sound.name)}" aria-label="${sound.playing ? "Pause" : "Play"} ${mgAttr(sound.name)}">
					<i class="fa-solid ${sound.playing ? "fa-pause" : "fa-play"}"></i>
				</button>
				<button type="button" class="mg-playlist-sound-control" data-mg-playlist-sound-stop="${sound.id}" data-mg-playlist-id="${playlist.id}" title="Stop ${mgAttr(sound.name)}" aria-label="Stop ${mgAttr(sound.name)}">
					<i class="fa-solid fa-stop"></i>
				</button>
				<button type="button" class="mg-playlist-sound-control mg-playlist-repeat-control ${sound.repeat ? "is-active" : ""}" data-mg-playlist-sound-repeat="${sound.id}" data-mg-playlist-id="${playlist.id}" title="${sound.repeat ? "Disable" : "Enable"} repeat for ${mgAttr(sound.name)}" aria-label="${sound.repeat ? "Disable" : "Enable"} repeat for ${mgAttr(sound.name)}" aria-pressed="${sound.repeat ? "true" : "false"}">
					<i class="fa-solid fa-repeat"></i>
				</button>
			</div>			
		</article>
	`;
}

function mgRenderVolumeControls() {
	const controls = [
		["globalPlaylistVolume", "Playlists", "fa-solid fa-music"],
		["globalAmbientVolume", "Ambient", "fa-solid fa-volume"],
		["globalInterfaceVolume", "Interface", "fa-solid fa-sliders"]
	];
	return `
		<section class="mg-playlist-volume-controls">
			<header class="mg-playlist-panel-header">
				<span><i class="fa-solid fa-volume-high"></i> Volume</span>
			</header>
			${controls.map(([key, label, icon]) => {
				const volume = mgGetSetting(key, 1);
				return `
					<label class="mg-playlist-volume-row">
						<span><i class="${icon}"></i>${label}</span>
						<input type="range" min="0" max="1" step="0.01" name="${key}" value="${mgVolumeToInput(volume)}" data-mg-playlist-volume="${key}" />
						<output data-mg-playlist-volume-value>${mgVolumePercent(volume)}%</output>
					</label>
				`;
			}).join("")}
		</section>
	`;
}

function mgCanUserSeePlaylist(playlist) {
	if (!playlist) return false;
	try {
		return playlist.visible !== false && (playlist.testUserPermission?.(game.user, "LIMITED") ?? true);
	} catch (_) {
		return playlist.visible !== false;
	}
}

function mgBuildPlaylistFolderTree(playlists, { showAllFolders = true } = {}) {
	const visibleFolderIds = new Set();
	for (const playlist of playlists) {
		let folderId = playlist.folder?.id ?? playlist.folder ?? null;
		while (folderId) {
			visibleFolderIds.add(folderId);
			const folder = game.folders?.get(folderId);
			folderId = folder?.folder?.id ?? folder?.folder ?? null;
		}
	}
	const playlistFolders = Array.from(game.folders ?? [])
		.filter(folder => folder.type === "Playlist")
		.filter(folder => showAllFolders || visibleFolderIds.has(folder.id));
	const folderNodes = new Map(playlistFolders.map(folder => [
		folder.id,
		{ folder, folders: [], playlists: [] }
	]));
	const root = { folders: [], playlists: [] };

	for (const node of folderNodes.values()) {
		const parentId = mgGetPlaylistFolderTreeParentId(node.folder);
		const parent = parentId ? folderNodes.get(parentId) : null;
		(parent ?? root).folders.push(node);
	}

	for (const playlist of playlists) {
		const folderId = playlist.folder?.id ?? playlist.folder ?? null;
		const parent = folderId ? folderNodes.get(folderId) : null;
		(parent ?? root).playlists.push(playlist);
	}

	return root;
}

function mgGetPlaylistFolderParentId(folder) {
	return folder?.folder?.id ?? folder?.folder ?? null;
}

function mgGetPlaylistFolderDepth(folder) {
	let depth = 0;
	let current = folder;
	const seen = new Set();
	while (current && mgGetPlaylistFolderParentId(current)) {
		const parentId = mgGetPlaylistFolderParentId(current);
		if (seen.has(parentId)) break;
		seen.add(parentId);
		current = game.folders?.get(parentId);
		if (!current || current.type !== "Playlist") break;
		depth += 1;
	}
	return depth;
}

function mgGetPlaylistFolderTreeParentId(folder) {
	const parentId = mgGetPlaylistFolderParentId(folder);
	if (!parentId) return null;
	const parent = game.folders?.get(parentId);
	if (!parent || parent.type !== "Playlist") return null;
	return mgGetPlaylistFolderDepth(parent) > 0 ? mgGetPlaylistFolderParentId(parent) : parentId;
}

function mgRenderPlaylistBranch(node, depth = 0) {
	const entries = [
		...node.folders.map(folderNode => ({
			type: "folder",
			id: folderNode.folder.id,
			name: folderNode.folder.name,
			html: mgRenderPlaylistFolder(folderNode, depth)
		})),
		...node.playlists.map(playlist => ({
			type: "playlist",
			id: playlist.id,
			name: playlist.name,
			html: mgRenderPlaylistRow(playlist)
		}))
	];
	const order = mgGetPlaylistUserOrder()[mgGetPlaylistUserOrderKey(node.folder?.id ?? null)] ?? [];
	const orderMap = new Map(order.map((token, index) => [token, index]));
	return entries
		.sort((a, b) => {
			const aOrder = orderMap.get(mgPlaylistOrderEntryToken(a));
			const bOrder = orderMap.get(mgPlaylistOrderEntryToken(b));
			if (aOrder !== undefined || bOrder !== undefined) return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER);
			return a.name.localeCompare(b.name) || a.type.localeCompare(b.type);
		})
		.map(entry => entry.html)
		.join("");
}

function mgRenderPlaylistFolder(node, depth = 0) {
	const folder = node.folder;
	const id = `playlist-folder-${folder.id}`;
	const isOpen = mgIsAccordionOpen(null, id, true);
	const canCreateSubfolder = game.user?.isGM && depth === 0;
	const body = mgRenderPlaylistBranch(node, depth + 1) || `<div class="mg-left-empty mg-scene-folder-empty mg-playlist-folder-empty">No playlists in this folder.</div>`;
	const color = String(folder.color ?? "").trim();
	const iconStyle = color ? ` style="color: ${mgAttr(color)};"` : "";
	return `
		<section
			class="mg-left-accordion mg-scene-folder-accordion mg-playlist-folder-accordion ${isOpen ? "is-open" : ""} ${depth > 0 ? "is-sub" : ""}"
			data-mg-accordion="${id}"
			data-mg-playlist-folder-id="${folder.id}"
		>
			<div
				class="mg-left-accordion-toggle mg-scene-folder-toggle mg-playlist-folder-toggle"
				data-mg-accordion-toggle="${id}"
				data-mg-playlist-folder-drop="${folder.id}"
				aria-expanded="${isOpen ? "true" : "false"}"
			>
				<span><i class="fa-solid fa-folder" data-mg-playlist-folder-icon${iconStyle}></i>${mgEsc(folder.name)}</span>
				<i class="fa-solid fa-chevron-down mg-left-accordion-chevron"></i>
			</div>
			<div class="mg-left-accordion-body" ${isOpen ? "" : "hidden"} style="max-height: ${isOpen ? "none" : "0px"};">
				<div class="mg-left-accordion-inner">
					<div class="mg-scene-folder-body mg-playlist-folder-body" data-mg-playlist-folder-body="${folder.id}" data-mg-playlist-container="${folder.id}">
						${game.user?.isGM ? `
							<div class="mg-scene-folder-actions mg-playlist-folder-actions">
								<button type="button" class="mg-scene-mini-action mg-playlist-mini-action" data-mg-playlist-create="${folder.id}" title="Create playlist in ${mgAttr(folder.name)}" aria-label="Create playlist in ${mgAttr(folder.name)}">
									<i class="fa-solid fa-plus"></i>
								</button>
								${canCreateSubfolder ? `
									<button type="button" class="mg-scene-mini-action mg-playlist-mini-action" data-mg-playlist-folder-create="${folder.id}" title="Create subfolder in ${mgAttr(folder.name)}" aria-label="Create subfolder in ${mgAttr(folder.name)}">
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

function mgRenderPlaylistRow(playlist) {
	const sounds = Array.from(playlist.sounds ?? []);
	const isOpen = mgIsAccordionOpen(null, `playlist-${playlist.id}`, playlist.playing);
	const playingCount = sounds.filter(sound => sound.playing).length;
	const pausedCount = sounds.filter(sound => !sound.playing && mgHasSoundPausedTime(sound)).length;
	const playbackLabel = playlist.playing ? "Pause" : "Play";
	const image = mgGetPlaylistImage(playlist);
	const imageStyle = image ? ` style="background-image: url('${mgAttr(mgCssUrl(image))}');"` : "";
	return `
		<section
			class="mg-playlist-row-wrap ${isOpen ? "is-open" : ""}"
			data-mg-accordion="playlist-${playlist.id}"
			data-mg-playlist-id="${playlist.id}"
			data-mg-playlist-name="${mgAttr(playlist.name)}"
			data-mg-playlist-folder="${playlist.folder?.id ?? playlist.folder ?? ""}"
		>
			<article class="mg-scene-row mg-playlist-row ${playlist.playing ? "is-active" : ""}" data-mg-playlist-id="${playlist.id}" data-mg-playlist-name="${mgAttr(playlist.name)}" data-mg-playlist-folder="${playlist.folder?.id ?? playlist.folder ?? ""}">
				<div class="mg-playlist-row-transport">
					<button type="button" class="mg-playlist-row-play" data-mg-playlist-toggle="${playlist.id}" title="${playbackLabel} ${mgAttr(playlist.name)}" aria-label="${playbackLabel} ${mgAttr(playlist.name)}">
						<i class="fa-solid ${playlist.playing ? "fa-pause" : "fa-play"}"></i>
					</button>
					<button type="button" class="mg-playlist-row-stop" data-mg-playlist-stop="${playlist.id}" title="Stop ${mgAttr(playlist.name)}" aria-label="Stop ${mgAttr(playlist.name)}">
						<i class="fa-solid fa-stop"></i>
					</button>
				</div>
				<button type="button" class="mg-scene-row-main mg-playlist-row-main" data-mg-accordion-toggle="playlist-${playlist.id}" aria-expanded="${isOpen ? "true" : "false"}"${imageStyle}>
					<span class="mg-scene-row-scrim"></span>
					<span class="mg-playlist-row-copy">
						<strong class="mg-scene-row-title mg-playlist-row-title">${mgEsc(playlist.name)}</strong>
						<span class="mg-playlist-row-meta">
							<small>${sounds.length} Sounds${playingCount ? ` | ${playingCount} Playing` : ""}${pausedCount ? ` | ${pausedCount} Paused` : ""}</small>
						</span>
					</span>
					<span class="mg-playlist-row-chevron" aria-hidden="true">
						<i class="fa-solid fa-chevron-down"></i>
					</span>
				</button>
			</article>
			<div class="mg-left-accordion-body mg-playlist-sounds-body" ${isOpen ? "" : "hidden"} style="max-height: ${isOpen ? "none" : "0px"};">
				<div class="mg-playlist-sounds-list">
					${sounds.length ? sounds.sort((a, b) => playlist._sortSounds?.(a, b) ?? a.name.localeCompare(b.name)).map(sound => mgRenderPlaylistSoundRow(playlist, sound)).join("") : `<div class="mg-left-empty mg-playlist-sounds-empty">No sounds in this playlist.</div>`}
				</div>
			</div>
		</section>
	`;
}

function mgRenderPlaylistSoundRow(playlist, sound) {
	return `
		<article class="mg-playlist-sound-card ${sound.playing ? "is-active" : ""}" data-mg-playlist-sound-row data-mg-playlist-id="${playlist.id}" data-mg-playlist-sound-id="${sound.id}" data-mg-playlist-sound-name="${mgAttr(sound.name)}">
			<span class="mg-playlist-sound-title">
				<strong>${mgEsc(sound.name)}</strong>
				<small>${sound.repeat ? "Repeat" : "Single"}</small>
			</span>	
					
			<div class="sound-interaction">
				<div class="mg-playlist-sound-actions">
					<button type="button" class="mg-playlist-sound-control" data-mg-playlist-sound-toggle="${sound.id}" data-mg-playlist-id="${playlist.id}" title="${sound.playing ? "Pause" : "Play"} ${mgAttr(sound.name)}" aria-label="${sound.playing ? "Pause" : "Play"} ${mgAttr(sound.name)}">
						<i class="fa-solid ${sound.playing ? "fa-pause" : "fa-play"}"></i>
					</button>
					<button type="button" class="mg-playlist-sound-control" data-mg-playlist-sound-stop="${sound.id}" data-mg-playlist-id="${playlist.id}" title="Stop ${mgAttr(sound.name)}" aria-label="Stop ${mgAttr(sound.name)}">
						<i class="fa-solid fa-stop"></i>
					</button>
					<button type="button" class="mg-playlist-sound-control mg-playlist-repeat-control ${sound.repeat ? "is-active" : ""}" data-mg-playlist-sound-repeat="${sound.id}" data-mg-playlist-id="${playlist.id}" title="${sound.repeat ? "Disable" : "Enable"} repeat for ${mgAttr(sound.name)}" aria-label="${sound.repeat ? "Disable" : "Enable"} repeat for ${mgAttr(sound.name)}" aria-pressed="${sound.repeat ? "true" : "false"}">
						<i class="fa-solid fa-repeat"></i>
					</button>
				</div>
				<input type="range" min="0" max="1" step="0.01" value="${mgVolumeToInput(sound.volume ?? 1)}" data-mg-playlist-sound-volume="${sound.id}" data-mg-playlist-id="${playlist.id}" title="Sound volume" aria-label="Volume for ${mgAttr(sound.name)}" />
			</div>
		</article>
	`;
}

globalThis.MGPlaylistSidebar = {
	bindContent: mgBindPlaylistSidebarContent,
	renderContent: mgRenderPlaylistSidebarContent,
	renderActiveSoundsPanel: mgRenderActiveSoundsPanel
};

Hooks.on("renderPlaylistConfig", mgBindPlaylistConfigImageField);
