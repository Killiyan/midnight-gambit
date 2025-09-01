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

    for (const uuid of order) {
      const m = members.find(x => x.uuid === uuid);
      if (m) { initMembers.push(m); seen.add(uuid); }
    }
    for (const m of members) if (!seen.has(m.uuid)) initMembers.push(m);

	data.partyMembers = members;
	data.initiativeMembers = initMembers;
	data.canEdit = this.isEditable;

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

		$root.on("click", ".mg-use-initiative", async (ev) => {
		await game.settings.set("midnight-gambit", "activeCrewUuid", this.actor.uuid);
		ui.notifications?.info(`Initiative Bar linked to "${this.actor.name}".`);
		});


		// Initiative drag-reorder (full card draggable)
		this._bindInitiativeDrag($root);
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
