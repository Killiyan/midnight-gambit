// crew-sheet.js
// Midnight Gambit - Crew Sheet (Party + Initiative)
// - Drag characters in from sidebar
// - Party tab shows portraits, class (Guise), level
// - Double-click a card to open actor sheet
// - Initiative tab: full-card drag reorder, persisted to system.initiative.order

export class MidnightGambitCrewSheet extends ActorSheet {
	static get defaultOptions() {
	return foundry.utils.mergeObject(super.defaultOptions, {
		classes: ["midnight-gambit", "sheet", "actor", "crew-sheet"],
		template: "systems/midnight-gambit/templates/actors/crew-sheet.html",
		width: 900,
		height: 720,
		tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "party" }]
	});
	}

	/** Header buttons (adds a GM-only "Primary Crew" toggle) */
	_getHeaderButtons() {
	// Keep Foundry’s stock buttons (Configure, Close, etc.)
	const buttons = (super._getHeaderButtons?.() ?? []);

	// Only GMs can set world-level settings
	if (game.user.isGM) {
		const current = game.settings.get("midnight-gambit", "crewActorId") || "";
		const isPrimary = current === this.actor.id;

		buttons.unshift({
		label: isPrimary ? "Primary Crew" : "Make Primary",
		class: isPrimary ? "mg-primary-crew is-active" : "mg-primary-crew",
		icon: isPrimary ? "fa-solid fa-star" : "fa-regular fa-star",
		onclick: async () => {
			await game.settings.set("midnight-gambit", "crewActorId", this.actor.id);
			ui.notifications?.info(`"${this.actor.name}" is now the Primary Crew.`);
			this.render(false); // refresh header so star/label updates
		}
		});
	}

	return buttons;
	}


	/** Limit data based on ownership so players can reorder/add if they are owners of the Crew actor. */
	get isEditable() {
		return this.actor?.isOwner ?? false;
	}

	async getData(options) {
		const data = await super.getData(options);
		const sys = this.actor.system ?? {};
		const party = sys.party ?? {};
		const initiative = sys.initiative ?? {};

		// Resolve live members from UUIDs; build a sane display model
		const members = await this._resolveMembers(party.members || [], party.cache || {});
		const order = Array.isArray(initiative.order) ? initiative.order.slice() : [];

		// Initiative list uses saved order first, then appends any new members
		const initMembers = [];
		const seen = new Set();
		const hidden = Array.isArray(initiative.hidden) ? initiative.hidden : [];

		for (const uuid of order) {
		const m = members.find(x => x.uuid === uuid);
		if (m) { initMembers.push({ ...m, hidden: hidden.includes(m.uuid) }); seen.add(uuid); }
		}
		for (const m of members) {
		if (!seen.has(m.uuid)) initMembers.push({ ...m, hidden: hidden.includes(m.uuid) });
		}

		data.partyMembers = members;
		data.initiativeMembers = initMembers;

		data.canEdit = this.isEditable;

		// Directory icon override (Actors list only)
		data.directoryIcon = this.actor.getFlag("midnight-gambit", "directoryIcon") || "";

		const rawDirIcon = this.actor.getFlag("midnight-gambit", "directoryIcon") || "";
		data.directoryIcon = rawDirIcon;  // raw value as stored
		data.directoryIconResolved =
			this._normalizeDirIconPath(rawDirIcon) ||
			foundry.utils.getRoute("systems/midnight-gambit/assets/images/mg-queen.png");





		// Make actor available to the template (for name binding)
		data.actor = this.actor;

		// Splash images across the top (Party portraits)
		data.splashImages = members.map(m => m.img).filter(Boolean);

		return data;

	}

	/** Try to find the actor's Guise item in the most reliable order:
	 *  1) If actor.system.guise is set, prefer the EMBEDDED item with that id
	 *  2) If that fails, first embedded item of type "guise"
	 *  3) As a last resort, world/uuid lookup (harmless to try)
	 */
	async _getGuiseItem(actor) {
	try {
		const sys = actor.system ?? {};
		const gid = sys.guise;

		// 1) Embedded-by-id (common case)
		if (gid && actor.items?.get) {
		const embedded = actor.items.get(gid);
		if (embedded) return embedded;
		}

		// 2) First embedded guise
		const embeddedGuise = actor.items?.find?.(i => i?.type === "guise");
		if (embeddedGuise) return embeddedGuise;

		// 3) World/UUID (fallback)
		if (gid) {
		try {
			const worldById = game.items?.get?.(gid);
			if (worldById) return worldById;
		} catch {}
		try {
			const from = await fromUuid(gid);
			if (from?.documentName === "Item" && from.type === "guise") return from;
		} catch {}
		}
	} catch {}
	return null;
	}

	/** Class name preference (to mirror your actor-sheet.html):
	 *  - guise.name if found
	 *  - actor.system.class (your placeholder) as backup
	 *  - "—" otherwise
	 */
	async _resolveClassName(actor) {
	const guise = await this._getGuiseItem(actor);
	if (guise?.name) return guise.name;
	const sysClass = actor.system?.class;
	return sysClass ? String(sysClass) : "—";
	}

	/** Level preference (to mirror your actor-sheet.html):
	 *  - actor.system.level (primary)
	 *  - guise.system.level (backup)
	 *  - "—" otherwise
	 */
	async _resolveLevel(actor) {
	const sys = actor.system ?? {};
	if (Number.isFinite(Number(sys.level))) return String(Number(sys.level));
	const guise = await this._getGuiseItem(actor);
	const gl = guise?.system?.level;
	if (Number.isFinite(Number(gl))) return String(Number(gl));
	return "—";
	}

  /** Convert Party member UUIDs into live data (+cache fallback). */
	async _resolveMembers(uuids, cache) {
		const out = [];
    	for (const uuid of uuids) {
      		let doc = null;
      		try { doc = await fromUuid(uuid); } catch (e) {}
      		if (doc?.documentName !== "Actor") doc = null;

      		let name = doc?.name ?? cache?.[uuid]?.name ?? "Unknown";
      		let img  = doc?.img  ?? cache?.[uuid]?.img  ?? "icons/svg/mystery-man.svg";
      		let type = doc?.type ?? cache?.[uuid]?.type ?? "character";
			// Compute Class (Guise name) and Level to match actor-sheet.html
			let className = "—";
			let levelText = "—";

		if (doc) {
		try {
			className = await this._resolveClassName(doc);
			levelText = await this._resolveLevel(doc);

			// Soft fallback from cache if still unknown
			if (className === "—" && cache?.[uuid]?.className) className = cache[uuid].className;
			if (levelText === "—" && cache?.[uuid]?.level != null) levelText = String(cache[uuid].level);
		} catch (e) {
			// Last-ditch cache fallback
			className = cache?.[uuid]?.className ?? "—";
			if (cache?.[uuid]?.level != null) levelText = String(cache[uuid].level);
		}
		} else {
		// Missing actor -> cache only
		className = cache?.[uuid]?.className ?? "—";
		if (cache?.[uuid]?.level != null) levelText = String(cache[uuid].level);
		}


      out.push({
        uuid,
        name,
        img,
        type,
        className,
        levelText,
        missing: !doc
      });
    }
    return out;
  }

  /** Top-level drop handler: accept Actor documents of type "character". */
  async _onDrop(event) {
    if (!this.isEditable) return false;
    const data = TextEditor.getDragEventData(event);
    if (data?.type !== "Actor") return false;

    const actor = await fromUuid(data.uuid);
    if (!actor || actor.documentName !== "Actor") return false;
    if (actor.type !== "character") {
      ui.notifications?.warn("Only player characters can join the Crew (for now).");
      return false;
    }

    const sys = this.actor.system ?? {};
    const party = sys.party ?? {};
    const members = Array.isArray(party.members) ? party.members.slice() : [];

    if (members.includes(actor.uuid)) {
      ui.notifications?.info(`${actor.name} is already in the party.`);
      return false;
    }

    members.push(actor.uuid);

    // Build/merge a small cache snapshot
    const cache = foundry.utils.duplicate(party.cache ?? {});
    cache[actor.uuid] = {
      name: actor.name,
      img: actor.img,
      type: actor.type,
      className: await this._peekClassName(actor),
      level: await this._peekLevel(actor)
    };

    // Also append to initiative if not present
    const initiative = sys.initiative ?? {};
    const order = Array.isArray(initiative.order) ? initiative.order.slice() : [];
    if (!order.includes(actor.uuid)) order.push(actor.uuid);

    await this.actor.update({
      "system.party.members": members,
      "system.party.cache": cache,
      "system.initiative.order": order
    });

    this.render(false);
    return true;
  }

	async _peekClassName(actor) {
	try { return await this._resolveClassName(actor); }
	catch { return "—"; }
	}

	async _peekLevel(actor) {
	try { return await this._resolveLevel(actor); }
	catch { return "—"; }
	}

	/** Normalize an image path for core UIs (Actors directory & sheet preview). */
	_normalizeIconPath(url) {
		if (!url) return "";
		// Already absolute or external? Route & return.
		if (/^(systems|modules|worlds|https?:\/\/|data:)/i.test(url)) {
			return foundry.utils.getRoute(url);
		}
		// Handle "./" or "../" paths by anchoring to this system.
		const cleaned = String(url).replace(/^\.\.?\//, "");
		const base = `systems/${game.system.id}`;
		return foundry.utils.getRoute(`${base}/${cleaned}`);
	}

	/** Normalize a path so it loads in core UIs & previews. Never re-anchors. */
	_normalizeDirIconPath(url) {
		if (!url) return "";
		const u = String(url).trim().replace(/\\/g, "/");

		// External or data URIs
		if (/^(?:https?:\/\/|data:)/i.test(u)) return foundry.utils.getRoute(u);

		// Absolute virtual paths or known roots (don't prepend anything)
		if (u.startsWith("/")) return foundry.utils.getRoute(u);
		if (/^(systems|modules|worlds|icons|ui|assets)\b/i.test(u)) return foundry.utils.getRoute(u);

		// Anything else: route as-is (works for most FilePicker returns)
		return foundry.utils.getRoute(u);
	}

	/** Default directory the picker opens to (world assets first, else your system). */
	_initialPickerDir() {
		const worldBase = `worlds/${game.world?.id || ""}`;
		// point somewhere sane in the world dir if it exists in your content tree
		return worldBase ? `${worldBase}/assets/images` : `systems/${game.system.id}/assets/images`;
	}


	/** Update the Actors sidebar thumbnail for THIS crew immediately (no full render needed). */
	_refreshDirectoryThumb(url) {
		const dir = ui.actors;
		if (!dir?.element?.length) return; // sidebar closed, nothing to patch

		const $li = dir.element.find(
			`li.document.actor[data-document-id="${this.actor.id}"], li.document.actor[data-entity-id="${this.actor.id}"]`
		);
		if (!$li.length) return;

		const $img = $li.find("img.thumbnail, .thumbnail img").first();
		if ($img.length) {
			$img.attr("src", url).attr("data-src", url).attr("srcset", "");
		} else {
			$li.find(".thumbnail").first().css("background-image", `url(${url})`);
		}
	}


	/** (Optional) One-time fix: clean up any flag that accidentally saved a doubled base. */
	async _sanitizeDirIconFlagOnce() {
	const raw = this.actor.getFlag("midnight-gambit", "directoryIcon");
	if (!raw) return;

	const cleaned = this._normalizeDirIconPath(raw);
	if (cleaned !== raw) {
		try {
		await this.actor.setFlag("midnight-gambit", "directoryIcon", cleaned);
		} catch (_) {
		// ignore if not owner
		}
	}
	}

	activateListeners(html) {
	super.activateListeners(html);

		const $root = html instanceof jQuery ? html : $(html);

		// Double-click Party/Initiative card => open actor sheet
		$root.on("dblclick", ".mg-member-card[data-uuid], .mg-init-card[data-uuid]", async (ev) => {
			const card = ev.currentTarget;
			const uuid = card?.dataset?.uuid;
			if (!uuid) return;
			try {
			const doc = await fromUuid(uuid);
			if (doc?.sheet) doc.sheet.render(true);
			} catch {}
		});

		// NEW: single-click "Open Sheet" button (works for anyone)
		$root.on("click", ".mg-open-member", async (ev) => {
			ev.preventDefault();
			ev.stopPropagation(); // don’t trigger card dblclick etc.
			const card = ev.currentTarget.closest("[data-uuid]");
			const uuid = card?.dataset?.uuid;
			if (!uuid) return;
			try {
			const doc = await fromUuid(uuid);
			doc?.sheet?.render(true);
			} catch {}
		});

		// Toggle hidden/visible for a member in initiative (works for everyone)
		$root.off("click.mgInitHide").on("click.mgInitHide", ".mg-init-visibility, .mg-init-eye", async (ev) => {
		ev.preventDefault();
		ev.stopPropagation();

		const card = ev.currentTarget.closest(".mg-init-card");
		const uuid = card?.dataset?.uuid;
		if (!uuid) return;

		// Flip local DOM state for instant feedback
		const wasHidden = card.dataset.hidden === "true";
		const nowHidden = !wasHidden;
		card.dataset.hidden = String(nowHidden);
		card.classList.toggle("is-hidden", nowHidden);

		// Update icon
		const icon = ev.currentTarget.querySelector("i");
		if (icon) icon.className = `fa-solid ${nowHidden ? "fa-eye-slash" : "fa-eye"}`;

		// Persist to the actor; revert UI if it fails
		try {
			const prev = Array.isArray(this.actor.system?.initiative?.hidden)
			? this.actor.system.initiative.hidden.slice()
			: [];
			const set = new Set(prev);
			if (nowHidden) set.add(uuid); else set.delete(uuid);

			await this.actor.update({ "system.initiative.hidden": Array.from(set) }, { render: false });
		} catch (err) {
			// Revert UI if update failed (e.g., no ownership)
			card.dataset.hidden = String(wasHidden);
			card.classList.toggle("is-hidden", wasHidden);
			if (icon) icon.className = `fa-solid ${wasHidden ? "fa-eye-slash" : "fa-eye"}`;
			ui.notifications?.warn("You need owner permission to change initiative visibility.");
			console.warn("MG | toggle hidden failed", err);
		}
		});

		// Everything below this should only bind for owners (reorder/remove)
		if (!this.isEditable) return;

		// Remove member (from Party => also remove from Initiative)
		$root.on("click", ".mg-remove-member", async (ev) => {
			ev.preventDefault();
			const card = ev.currentTarget.closest(".mg-member-card");
			const uuid = card?.dataset?.uuid;
			if (!uuid) return;

			const sys = this.actor.system ?? {};
			const members = (sys.party?.members ?? []).filter(u => u !== uuid);
			const order = (sys.initiative?.order ?? []).filter(u => u !== uuid);

			await this.actor.update({
			"system.party.members": members,
			"system.initiative.order": order
			});
			this.render(false);
		});

		// Link this Crew to the Initiative Bar AND persist current order to the bar's flag
		$root
		.off("click.mgUseIni")
		.on("click.mgUseIni", ".mg-use-initiative", async (ev) => {
			ev.preventDefault();
			await this._applyInitiativeFromDOM($root);            // persist order (UUIDs + Actor IDs)
			await game.settings.set("midnight-gambit", "activeCrewUuid", this.actor.uuid); // backward-compat
			await game.settings.set("midnight-gambit", "crewActorId", this.actor.id);      // used by the bar
			ui.notifications?.info(`Initiative Bar linked to "${this.actor.name}".`);
		});

		// (Optional) If you add a tab button like ".mg-apply-initiative", hook it too:
		$root
		.off("click.mgApplyIni")
		.on("click.mgApplyIni", ".mg-apply-initiative", async (ev) => {
			ev.preventDefault();
			await this._applyInitiativeFromDOM($root);
			ui.notifications?.info("Initiative order applied.");
		});
		
		// Fix any previously saved double-prefixed value on open
		if (this.isEditable) {
		this._sanitizeDirIconFlagOnce();
		}

		// Ensure any old non-namespaced handlers are removed
		$root.off("click", ".mg-pick-diricon");
		$root.off("click", ".mg-clear-diricon");

		// Settings tab: Choose directory icon (Actors list thumbnail)
		$root.off("click.mgPickDirIcon").on("click.mgPickDirIcon", ".mg-pick-diricon", async (ev) => {
		ev.preventDefault();

		const current = this.actor.getFlag("midnight-gambit", "directoryIcon") || this._initialPickerDir?.();
		const picker = new FilePicker({
			type: "image",
			activeSource: "data",
			current,
			callback: async (path) => {
			// Store exactly what the picker returns (works for worlds/modules/systems/http/data:)
			await this.actor.setFlag("midnight-gambit", "directoryIcon", path);

			// Route-safe URL for preview + directory thumb
			const url = this._normalizeDirIconPath(path);

			// 1) Update the sheet preview
			this.element.find(".mg-diricon-preview img").attr("src", url);

			// 2) Update the directory entry inline (no refresh needed)
			this._refreshDirectoryThumb(url);

			// 3) Fallback: re-render directory in case it’s closed
			ui.actors?.render(false);
			}
		});
		picker.render(true);
		});

		// Settings tab: Clear directory icon
		$root.off("click.mgClearDirIcon").on("click.mgClearDirIcon", ".mg-clear-diricon", async (ev) => {
		ev.preventDefault();

		await this.actor.unsetFlag("midnight-gambit", "directoryIcon");

		const fallback = this._normalizeDirIconPath("systems/midnight-gambit/assets/images/mg-queen.png");

		// 1) Sheet preview
		this.element.find(".mg-diricon-preview img").attr("src", fallback);

		// 2) Directory entry (inline)
		this._refreshDirectoryThumb(fallback);

		// 3) Fallback render
		ui.actors?.render(false);
		});

		// Initiative drag-reorder (full card draggable)
		this._bindInitiativeDrag($root);
	}

	/**
	 * Read the visible Initiative tab order and persist it for both:
	 * - Crew sheet storage: system.initiative.order (array of UUIDs)
	 * - Initiative Bar source: flag("midnight-gambit","initiativeOrder") (array of Actor IDs)
	 * - Completely apply + hard-reset the Initiative Bar to the visible order
	*/
	async _applyInitiativeFromDOM($root) {
		// 1) Read visible (non-hidden) cards in-order
		const cards = $root.find('.mg-initiative-list .mg-init-card')
			.toArray()
			.filter(el => el?.dataset?.hidden !== "true");

		if (!cards.length) {
			ui.notifications?.warn("No members found in the Initiative list.");
			return;
		}

		const uuids = cards.map(el => el.dataset.uuid).filter(Boolean);

		// 2) Resolve UUIDs to Actor IDs (for the overlay)
		const actorIds = [];
		for (const uuid of uuids) {
			let doc = null;
			try { doc = await fromUuid(uuid); } catch (_) {}
			let actor = null;
			if (doc?.documentName === "Actor") actor = doc;
			else if (doc?.actor) actor = doc.actor;           // TokenDocument etc.
			else if (doc?.parent?.documentName === "Actor") actor = doc.parent;

			const id = actor?.id;
			if (id) actorIds.push(id);
		}

		if (!actorIds.length) {
			ui.notifications?.error("Could not resolve actor IDs from the Initiative list.");
			return;
		}

		// 3) Persist both representations
		//    a) Keep your sheet's canonical order by UUID (what you already use)
		await this.actor.update({ "system.initiative.order": uuids });

		//    b) Write the array of Actor IDs for the Initiative Bar overlay
		await this.actor.setFlag("midnight-gambit", "initiativeOrder", actorIds);

		//    c) Tell the overlay to HARD RESET to exactly these ids (no ghosts)
		const syncId = `crew-${this.actor.id}-${Date.now()}`; // prevent dedupe on rapid clicks
		await this.actor.setFlag("midnight-gambit", "initiativeReset", {
		ids: actorIds,
		syncId
		});

	}

	_bindInitiativeDrag($root) {
	const $list = $root.find(".mg-initiative-list");
	if (!$list.length) return;

	let dragUuid = null;
	let dragEl = null;
	const placeholder = document.createElement("div");
	placeholder.className = "mg-init-placeholder";

	// Cards are draggable
	$list.find(".mg-init-card").attr("draggable", "true");

	// dragstart
	$list.on("dragstart", ".mg-init-card", (ev) => {
		const el = ev.currentTarget;
		dragEl = el;
		dragUuid = el.dataset.uuid;
		el.classList.add("mg-dragging");
		ev.originalEvent?.dataTransfer?.setData("text/plain", dragUuid);
		ev.originalEvent?.dataTransfer?.setDragImage?.(el, 16, 16);
		el.after(placeholder);
	});

	// dragover
	$list.on("dragover", ".mg-init-card, .mg-init-placeholder", (ev) => {
		ev.preventDefault();
		const target = ev.currentTarget;
		const isPlaceholder = target.classList.contains("mg-init-placeholder");
		const refEl = isPlaceholder ? placeholder : target;

		if (!refEl.parentElement) return;
		const bounds = refEl.getBoundingClientRect();
		const midY = bounds.top + bounds.height / 2;
		if (ev.originalEvent.clientY < midY) {
		refEl.parentElement.insertBefore(placeholder, refEl);
		} else {
		refEl.parentElement.insertBefore(placeholder, refEl.nextSibling);
		}
	});

	// drop / dragend finalize
	const finalize = async () => {
		if (!dragUuid) return;
		const parent = placeholder.parentElement;
		if (parent && dragEl) parent.insertBefore(dragEl, placeholder);
		placeholder.remove();
		dragEl?.classList.remove("mg-dragging");

		// Persist new order
		const newOrder = Array.from($list[0].querySelectorAll(".mg-init-card"))
		.map(el => el.dataset.uuid)
		.filter(Boolean);

		await this.actor.update({ "system.initiative.order": newOrder });
		dragUuid = null;
		dragEl = null;
	};

	$list.on("drop", ".mg-init-card, .mg-init-placeholder", async (ev) => {
		ev.preventDefault();
		await finalize();
	});

	$list.on("dragend", async (ev) => {
		ev.preventDefault();
		await finalize();
	});
	}
}