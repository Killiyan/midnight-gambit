// crew-sheet.js
// Midnight Gambit - Crew Sheet (Party + Initiative)
// - Drag characters in from sidebar
// - Party tab shows portraits, class (Guise), level
// - Double-click a card to open actor sheet
// - Initiative tab: full-card drag reorder, persisted to system.initiative.order

// v11-safe HTML escaper
const ESC = (s) =>
  (window.Handlebars?.escapeExpression?.(String(s ?? ""))) ??
  String(s ?? "").replace(/[&<>"'`=\/]/g, (c) =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;","/":"&#x2F;","`":"&#x60;","=":"&#x3D;" }[c])
  );


export class MidnightGambitCrewSheet extends ActorSheet {
	static get defaultOptions() {
	return foundry.utils.mergeObject(super.defaultOptions, {
		classes: ["midnight-gambit", "sheet", "actor", "crew-sheet"],
		template: "systems/midnight-gambit/templates/actors/crew-sheet.html",
		width: 900,
		height: 720,
		tabs: [
			{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "party" },
			{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", group: "crew", initial: "gambits" }
		]
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

		// Use a duplicate so we don't mutate the live document while rendering
		const s = foundry.utils.duplicate(this.actor.system ?? {});
		s.currency ??= {};

		// Currency parity with character Lux
		s.currency.lux = Number.isFinite(Number(s.currency.lux)) ? Number(s.currency.lux) : 0;

		data.system = s;


		// s.bio etc. stay as-is below
		s.bio ??= { lookAndFeel: "", weakness: "", location: "", features: "", tags: [] };

		s.bio ??= { lookAndFeel: "", weakness: "", location: "", features: "", tags: [] };
		s.gambits ??= { deck: [], drawn: [], discard: [], handSize: 3, deckSize: 10 };
		for (const k of ["deck","drawn","discard"]) s.gambits[k] ??= [];

		// Build template-friendly arrays
		const mapItem = id => this.actor.items.get(id);
		const gb = {
		deck:    (s.gambits.deck    || []).map(mapItem).filter(Boolean),
		drawn:   (s.gambits.drawn   || []).map(mapItem).filter(Boolean),
		discard: (s.gambits.discard || []).map(mapItem).filter(Boolean),
		handSize: Number(s.gambits.handSize) || 3
		};

		// Expose to the template
		data.assets = this.actor.items.filter(i => i.type === "asset");
		data.gb = gb;
		data.isEditable = this.isEditable;

		// Assets for the card grid (sorted) + pretty tag labels
		const tagDefs  = CONFIG.MidnightGambit?.ASSET_TAGS ?? [];   // [{id,label,description?}, ...]
		const labelFor = (id) => tagDefs.find(t => t.id === id)?.label || id;

		data.assets = this.actor.items
		.filter(i => i.type === "asset")
		.sort((a, b) => a.name.localeCompare(b.name))
		.map(i => {
			const raw = i.system?.tags;
			const ids = Array.isArray(raw)
			? raw
			: (typeof raw === "string" ? raw.split(",").map(s => s.trim()).filter(Boolean) : []);

			const v = i.toObject();
			v.id = i.id || v._id;               // keep the id your template expects
			v._tags = ids.map((id) => ({ id, label: labelFor(id) })); // [{id,label}]
			return v;
		});

		for (const it of data.assets) {
		const rawDesc  = String(it.system?.description ?? "");
		const rawNotes = String(it.system?.notes ?? "");

		it.descHtml  = await TextEditor.enrichHTML(rawDesc,  { async: true }); // TinyMCE formatting → safe HTML
		it.notesHtml = await TextEditor.enrichHTML(rawNotes, { async: true });
		}

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

	/** Top-level drop handler:
	 *  - Accept Actor documents of type "character" onto the Party tab (your custom logic)
	 *  - Accept Item drops (Assets, Gambits) and create embedded Items on the Crew,
	 *    then re-render immediately so the new row appears without a manual refresh.
	 *  - For anything else: defer to base class.
	 */
	async _onDrop(event) {
	if (!this.isEditable) return false;

	const data = TextEditor.getDragEventData(event);

	// === Handle Item drops here so we can force a re-render ===
	if (data?.type === "Item") {
		try {
			const src = await fromUuid(data.uuid);
			if (!src || src.documentName !== "Item") return false;

			// Clone to a plain object and strip _id so it gets a fresh one
			const obj = (src instanceof Item) ? src.toObject() : src;
			delete obj._id;

			const type = (obj.type || src.type);
			const isAsset  = type === "asset";
			const isGambit = type === "gambit";

			// Allow Assets; Gate Gambits
			if (!isAsset && !isGambit) return false;

			if (isGambit) {
			// Gate: Crew sheet only accepts Crew-tier Gambits
			const tier = (obj.system?.tier ?? src.system?.tier ?? "rookie").toLowerCase();
			if (tier !== "crew") {
				ui.notifications?.warn("Only Crew-tier Gambits can be added to the Crew.");
				return false;
			}
			}

			// Create the embedded item on the Crew
			const [created] = await this.actor.createEmbeddedDocuments("Item", [obj]);

			// If it's a Gambit, drop it into the Crew's deck immediately
			if (isGambit && created?.id) {
			const g = foundry.utils.deepClone(this.actor.system.gambits ?? {});
			g.deck = Array.isArray(g.deck) ? g.deck.slice() : [];
			g.deck.push(created.id);
			await this.actor.update({ "system.gambits.deck": g.deck }, { render: false });
			}

			// Force a sheet refresh so the new row shows up NOW
			this.render(false);
			return true;
		} catch (err) {
			console.warn("MG | _onDrop Item failed:", err);
			return false;
		}
	}

	// === Party member (Actor) drop logic ===
	if (data?.type === "Actor") {
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

	// Fallback: let the base class handle anything else
	return super._onDrop?.(event);
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

		// Make every button non-submit unless it opts in explicitly
		$root.find("button:not([type])").attr("type", "button");

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

			// Visually mute immediately
			card.classList.toggle("is-muted", nowHidden);

			// Disable interaction right away
			if (nowHidden) {
			card.style.opacity = "0.5";
			} else {
			card.style.opacity = "";
			card.style.pointerEvents = "";
			}

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

		/* Crew Assets: card grid bindings
		------------------------------------------------------------------*/
		{
		// Post to chat on name click (same UX as Moves) — Description as RICH HTML now
		$root.off("click.mgAssetPostName").on("click.mgAssetPostName", ".assets .post-asset", async (ev) => {
			ev.preventDefault();
			const id = ev.currentTarget.dataset.itemId || ev.currentTarget.closest(".inventory-item")?.dataset?.itemId;
			const item = this.actor.items.get(id);
			if (!item) return;

			// Enrich both fields so TinyMCE formatting survives in chat
			const descHtml  = await TextEditor.enrichHTML(String(item.system?.description ?? ""), { async: true });
			const notesHtml = item.system?.notes
			? await TextEditor.enrichHTML(String(item.system.notes), { async: true })
			: "";

			const content = `
			<div class="chat-item">
				<h2><i class="fa-solid fa-vault"></i> ${ESC(item.name)}</h2>
				${descHtml ? `<div class="asset-desc-chat">${descHtml}</div>` : ""}
				${(item.system?.tags?.length)
				? `<strong>Tags:</strong>
					<div class="asset-tags chat-tags">${
					item.system.tags.map(t => {
						const def = CONFIG.MidnightGambit?.ASSET_TAGS?.find(d => d.id === t);
						const label = def?.label || t;
						return `<span class="asset-tag tag" data-tag-id="${ESC(t)}">${ESC(label)}</span>`;
					}).join(" ")
					}</div>`
				: ""
				}
				${notesHtml ? `<div class="asset-notes-chat"><strong>Notes:</strong><br>${notesHtml}</div>` : ""}
			</div>
			`;
			await ChatMessage.create({
			user: game.user.id,
			speaker: ChatMessage.getSpeaker({ actor: this.actor }),
			content
			});
		});

		// Crew → Asset card "Edit": Quantity + Description (TinyMCE) + Notes (TinyMCE); OPEN/DELETE in header
		$root.off("click.mgCrewAssetEdit").on("click.mgCrewAssetEdit", ".asset-edit", async (ev) => {
			ev.preventDefault();
			ev.stopPropagation();

			// Resolve item id from button or ancestor card
			const card = ev.currentTarget.closest("[data-item-id]") || ev.currentTarget;
			const itemId = card?.dataset?.itemId;
			const item = itemId ? this.actor.items.get(itemId) : null;
			if (!item) return ui.notifications?.warn("Asset not found.");

			const safeName = (foundry.utils?.escapeHTML?.(item.name) ?? item.name);
			const qty   = Math.max(0, Number(getProperty(item, "system.qty") ?? 0));
			const desc  = String(getProperty(item, "system.description") ?? "");
			const notes = String(getProperty(item, "system.notes") ?? "");

			// Safe IDs that won't break querySelector
			const descId  = `desc-${randomID()}`;
			const notesId = `notes-${randomID()}`;

			const content = `
			<form class="mg-asset-edit" style="margin:0;">
				<div class="input-wrapper" style="margin-bottom:8px;">
				<label>Quantity</label>
				<input type="number" class="ae-qty" min="0" value="${qty}" style="width:100px;" />
				</div>

				<div class="input-wrapper" style="margin-bottom:10px;">
				<label>Description</label>
				<div class="mg-editor-wrap">
					<textarea id="${descId}" name="system.description" class="mg-rich ae-desc" style="width:100%;"></textarea>
				</div>
				</div>

				<div class="input-wrapper">
				<label>Notes</label>
				<div class="mg-editor-wrap">
					<textarea id="${notesId}" name="system.notes" class="mg-rich ae-notes" style="width:100%;"></textarea>
				</div>
				</div>
			</form>
			`;

			const hdrKey = `mg-hdr-${randomID()}`;

			const dlg = new Dialog({
			title: `Edit: ${safeName}`,
			content,
			buttons: {
				save: {
				icon: '<i class="fa-solid fa-floppy-disk"></i>',
				label: "Save",
				callback: async (html) => {
					const form = html[0]?.querySelector?.(".mg-asset-edit");
					if (!form) return;

					// 1) Gather values
					const newQty = Math.max(0, Number(form.querySelector(".ae-qty")?.value ?? 0));

					// v11-safe: pull HTML from TinyMCE editor if mounted, else fallback to textarea value
					const readEditorHTML = (el) => {
					try {
						const ed = TextEditor.getEditor?.(el) || window.tinyMCE?.get?.(el?.id);
						if (ed && typeof ed.getContent === "function") return ed.getContent();
					} catch (_) {}
					return el?.value ?? "";
					};
					const descEl   = form.querySelector(`[id='${descId}']`) || document.getElementById(descId);
					const notesEl  = form.querySelector(`[id='${notesId}']`) || document.getElementById(notesId);
					const descHTML = readEditorHTML(descEl);
					const notesHTML= readEditorHTML(notesEl);

					await item.update({
					"system.qty": newQty,
					"system.description": descHTML,
					"system.notes": notesHTML
					}, { render: false });

					// Refresh the crew sheet so the card updates immediately
					await this.render(false);
					ui.notifications.info("Asset updated.");
					try { dlg.close({}); } catch (_) {}
				}
				},
				cancel: { label: "Cancel" }
			},
			default: "save",
			close: () => { $(`.${hdrKey}`).remove(); }
			}, { classes: ["midnight-gambit", "dialog", "asset-notes-editor"], width: 560 });

			dlg.render(true);

			// Initialize TinyMCE + inject header buttons when THIS dialog renders
			Hooks.once("renderDialog", async (_app, html) => {
			if (_app !== dlg) return;
			const $html = html instanceof jQuery ? html : $(html);

			// ----- Header buttons (Open / Delete) -----
			const $app = $html.closest(".app.window-app.dialog");
			const $header = $app.find(".window-header");
			$header.find(`.${hdrKey}`).remove();
			const $actions = $(`
				<div class="mg-header-actions ${hdrKey}">
				<a class="header-button ae-open" title="Open Asset"><i class="fa-regular fa-pen-to-square"></i></a>
				<a class="header-button ae-delete" title="Delete Asset"><i class="fa-solid fa-trash"></i></a>
				</div>
			`);
			$header.find(".window-title").after($actions);

			$actions.find(".ae-open").on("click", (e) => {
				e.preventDefault(); e.stopPropagation();
				item.sheet?.render(true);
			});

			$actions.find(".ae-delete").on("click", async (e) => {
				e.preventDefault(); e.stopPropagation();
				const ok = await Dialog.confirm({
				title: `Delete ${safeName}?`,
				content: `<p>Remove <strong>${safeName}</strong> from the Crew?</p>`
				});
				if (!ok) return;
				await item.delete();
				dlg.close({});
				this.render(true);
			});

			Hooks.once("closeDialog", (app) => { if (app === dlg) $(`.${hdrKey}`).remove(); });

			// ----- Mount TinyMCE: Description + Notes (both awaited) -----
			const descTarget  = $html.find(`[id='${descId}']`)[0];
			const notesTarget = $html.find(`[id='${notesId}']`)[0];
			if (!descTarget || !notesTarget) return;

			// Seed existing HTML before init (so first paint matches)
			descTarget.value  = desc;
			notesTarget.value = notes;

			// Clone your global config, give comfy caps, and allow internal scroll at cap
			const mkCfg = (maxH) => {
				const t = foundry.utils.deepClone(CONFIG.TinyMCE);
				t.max_height = maxH;
				t.min_height = t.min_height ?? 140;
				t.content_style = (t.content_style ?? "") + `
				body.mce-content-body { overflow-y: auto; overscroll-behavior: contain; }
				`;
				return t;
			};

			await TextEditor.create({ target: descTarget,  name: "system.description", content: desc,  tinymce: mkCfg(440), height: null });
			await TextEditor.create({ target: notesTarget, name: "system.notes",       content: notes, tinymce: mkCfg(320), height: null });

			// Enter on qty submits the dialog (save)
			$html.find(".ae-qty").on("keydown", (e) => {
				if (e.key !== "Enter") return;
				e.preventDefault();
				dlg.submit();
			});
			});
		});

		// Search filtering (handles Enter key or button click) — unchanged
		{
			const STAGGER_STEP_MS = 80;   // delay between each card's enter
			const STAGGER_COUNT   = 3;    // how many cards to stagger (then no delay)
			const DEBOUNCE_MS = 220;
			const LEAVE_MS = 500; // must match CSS transition time

			const debounce = (fn, wait = DEBOUNCE_MS) => {
			let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
			};

			const cardMatches = (el, q) => {
			const name  = (el.querySelector(".name")?.textContent  || "").toLowerCase();
			const tags  = (el.querySelector(".tags")?.textContent  || "").toLowerCase();
			const notes = (el.querySelector(".notes")?.textContent || "").toLowerCase();
			return !q || name.includes(q) || tags.includes(q) || notes.includes(q);
			};

			const enterCard = (el, idx = 0) => {
			el.classList.remove("is-entering", "is-leaving", "pre-enter");
			if (!el.classList.contains("is-hidden")) {
				el.classList.add("is-hidden");
				el.offsetHeight;
			}
			el.classList.remove("is-hidden");
			el.classList.add("pre-enter");
			el.offsetHeight;

			const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
			const slot   = Math.min(idx, STAGGER_COUNT - 1);
			const delay  = reduce ? 0 : slot * STAGGER_STEP_MS;
			el.style.transitionDelay = `${delay}ms`;

			requestAnimationFrame(() => {
				el.classList.add("is-entering");
				const onEnd = (e) => {
				if (e && e.target !== el) return;
				el.classList.remove("is-entering", "pre-enter");
				el.style.transitionDelay = "";
				el.removeEventListener("transitionend", onEnd);
				};
				el.addEventListener("transitionend", onEnd, { once: true });
			});
			};

			const leaveCard = (el) => {
			el.classList.remove("is-entering", "pre-enter");
			el.style.transitionDelay = "";
			if (el.classList.contains("is-hidden")) return;
			el.classList.add("is-leaving");
			};

			const showEmpty = (show) => {
			const empty = $root.find(".assets .asset-search-empty")[0];
			if (!empty) return;
			empty.style.display = show ? "block" : "none";
			};

			const runSearchNow = () => {
			const input = $root.find(".asset-search")[0];
			const q = (input?.value || "").toLowerCase().trim();
			const cards = $root.find(".asset-grid .asset-card").toArray();
			const matchSet = new Set(cards.filter(el => cardMatches(el, q)));

			for (const el of cards) leaveCard(el);

			setTimeout(() => {
				let hits = 0, enterIndex = 0;
				for (const el of cards) {
				const isMatch = matchSet.has(el);
				el.classList.remove("is-leaving");
				if (isMatch) { hits++; enterCard(el, enterIndex++); }
				else el.classList.add("is-hidden");
				}
				showEmpty(hits === 0);
				$root.find(".asset-grid .tags-wrap").each((_, w) => updateOneWrap(w));
			}, LEAVE_MS);
			};
			const runSearch = debounce(runSearchNow, DEBOUNCE_MS);

			$root.off("keydown.mgAssetSearchEnter").on("keydown.mgAssetSearchEnter", ".assets .asset-search", (ev) => {
			if (ev.key === "Enter") { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); runSearch(); }
			});
			$root.off("click.mgAssetSearchBtn").on("click.mgAssetSearchBtn", ".assets .asset-search-btn", (ev) => {
			ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); runSearch();
			});
			$root.off("click.mgAssetSearchReset").on("click.mgAssetSearchReset", ".assets .asset-search-reset", (ev) => {
			ev.preventDefault();
			const input = $root.find(".assets .asset-search")[0];
			if (input) input.value = "";
			showEmpty(false);
			const cards = $root.find(".asset-grid .asset-card").toArray();
			for (const el of cards) leaveCard(el);
			setTimeout(() => { let idx = 0; for (const el of cards) enterCard(el, idx++); }, LEAVE_MS);
			});
		}

		// Drag-hover chrome on the whole asset area; drop flows into _onDrop
		const $zone = $root.find(".assets .mg-asset-drop");
		if ($zone.length) {
			$zone.on("dragenter", (e) => { e.preventDefault(); e.stopPropagation(); $zone.addClass("drag-hover"); });
			$zone.on("dragover",  (e) => { e.preventDefault(); e.stopPropagation(); });
			$zone.on("dragleave", (e) => { if (!$zone[0].contains(e.relatedTarget)) $zone.removeClass("drag-hover"); });
			$zone.on("drop",      (e) => { e.preventDefault(); e.stopPropagation(); $zone.removeClass("drag-hover"); return this._onDrop(e.originalEvent); });
		}
		}


		/* Tag overflow: clamp to two rows with "See all / See less"
		------------------------------------------------------------*/
		{
		const COLLAPSED_MAX = 80;   // px ≈ two rows of chips in your theme
		const TRANSITION_MS = 500;  // must match CSS transition

		// Measure one wrapper and set classes/affordances
		const updateOneWrap = (wrap) => {
			if (!wrap || wrap.classList.contains("animating")) return;
			const tags   = wrap.querySelector(".tags");
			const toggle = wrap.querySelector(".tags-toggle");
			if (!tags || !toggle) return;

			const isExpanded = wrap.classList.contains("expanded");
			const overflows  = tags.scrollHeight > (COLLAPSED_MAX + 1);

			// "short" means there is NO overflow — hide toggle and (your CSS) hides gradient
			wrap.classList.toggle("short", !overflows);
			toggle.hidden = !overflows;

			// Ensure an icon exists and rotate it based on expanded state
			if (!toggle.querySelector("i")) {
			toggle.innerHTML = '<i class="fa-solid fa-angle-down"></i>';
			}
			const icon = toggle.querySelector("i");
			icon.classList.toggle("rotated", isExpanded);
		};

		// Animate max-height to a target, then run callback
		const animateTo = (el, targetPx, after) => {
			el.style.maxHeight = `${targetPx}px`;
			const onEnd = (e) => {
			if (e && e.target !== el) return;
			el.removeEventListener("transitionend", onEnd);
			after?.();
			};
			// Safety in case transitionend doesn’t fire
			setTimeout(() => after?.(), TRANSITION_MS + 50);
			el.addEventListener("transitionend", onEnd, { once: true });
		};

		// Toggle click (expand/collapse)
		$root.off("click.mgTagsToggle").on("click.mgTagsToggle", ".assets .tags-toggle", (ev) => {
			ev.preventDefault();
			const wrap = ev.currentTarget.closest(".tags-wrap");
			if (!wrap || wrap.classList.contains("animating")) return;

			const tags   = wrap.querySelector(".tags");
			const toggle = wrap.querySelector(".tags-toggle");
			if (!tags || !toggle) return;

			wrap.classList.add("animating");

			const wasExpanded = wrap.classList.contains("expanded");
			if (!wasExpanded) {
			// EXPAND: current → scrollHeight
			tags.style.maxHeight = `${Math.max(tags.clientHeight, COLLAPSED_MAX)}px`;
			tags.offsetHeight; // reflow
			animateTo(tags, tags.scrollHeight, () => {
				wrap.classList.add("expanded");
				tags.style.maxHeight = ""; // let CSS take over

				// smooth icon flip
				const icon = toggle.querySelector("i");
				if (icon) requestAnimationFrame(() => icon.classList.add("rotated"));

				wrap.classList.remove("animating");
				updateOneWrap(wrap);
			});
			} else {
			// COLLAPSE: scrollHeight → COLLAPSED_MAX
			tags.style.maxHeight = `${tags.scrollHeight}px`;
			tags.offsetHeight; // reflow
			animateTo(tags, COLLAPSED_MAX, () => {
				wrap.classList.remove("expanded");
				tags.style.maxHeight = "";

				// smooth icon flip back
				const icon = toggle.querySelector("i");
				if (icon) requestAnimationFrame(() => icon.classList.remove("rotated"));

				wrap.classList.remove("animating");
				updateOneWrap(wrap);
			});
			}
		});

		// Initial measure (note: if tab hidden, we also re-measure on tab change below)
		$root.find(".asset-grid .tags-wrap").each((_, w) => updateOneWrap(w));

		// Re-measure when switching to the Assets tab (hidden tab reports scrollHeight=0)
		$root.off("click.mgTagsTab").on("click.mgTagsTab", ".sheet-tabs .item", (ev) => {
			if (ev.currentTarget?.dataset?.tab !== "assets") return;
			setTimeout(() => {
			$root.find(".asset-grid .tags-wrap").each((_, w) => updateOneWrap(w));
			}, 0);
		});
		}


		/* Lux +/- clickers (simple, safe, no re-render) */
		{
		const readLux = () => {
			const el = $root.find(".lux-value")[0];
			const fromDom = Number(el?.value);
			if (Number.isFinite(fromDom)) return fromDom;
			const fromActor = Number(this.actor.system?.currency?.lux);
			return Number.isFinite(fromActor) ? fromActor : 0;
		};

		const clamp = (n) => Math.max(0, Number.isFinite(n) ? n : 0);

		const saveLux = async (val) => {
			const v = clamp(val);
			await this.actor.update({ "system.currency.lux": v }, { render: false });
			const el = $root.find(".lux-value")[0];
			if (el) { el.value = String(v); el.setAttribute("value", String(v)); }
		};

		// Click: +/- 1 (Shift = +/-10, Alt = +/-5)
		$root.off("click.mgLuxStep")
			.on("click.mgLuxStep", ".lux-dec, .lux-inc", async (ev) => {
			ev.preventDefault(); ev.stopPropagation();
			const base = Number(ev.currentTarget.dataset.step) || 0;
			const mult = ev.shiftKey ? 10 : (ev.altKey ? 5 : 1);
			const step = base * mult;
			const next = readLux() + step;
			await saveLux(next);
			});

		// Keep it sticky on blur / manual edits (lets typing work too)
		$root.off("change.mgLuxEdit blur.mgLuxEdit")
			.on("change.mgLuxEdit blur.mgLuxEdit", ".lux-value", async (ev) => {
			ev.preventDefault(); ev.stopPropagation();
			await saveLux(Number(ev.currentTarget.value));
			});

		// Optional nicety: Enter commits without submitting anything weird
		$root.off("keydown.mgLuxEnter")
			.on("keydown.mgLuxEnter", ".lux-value", async (ev) => {
			if (ev.key !== "Enter") return;
			ev.preventDefault(); ev.stopPropagation();
			await saveLux(Number(ev.currentTarget.value));
			ev.currentTarget.blur();
			});
		}

		/* Global "See All / See Less" utility
		------------------------------------------------------------*/
		const bindSeeAll = ($root, {
		wrapSel = ".mg-seeall-wrap",
		contentSel = ".mg-seeall-content",
		toggleSel = ".mg-seeall-toggle",
		collapsedMax = 140,     // default cap if a wrap doesn't specify data-seeall-cap
		transitionMs = 500
		} = {}) => {

		// Read per-wrap cap; fall back to the function default
		const capFor = (wrap) => {
			const v = Number(wrap?.dataset?.seeallCap);
			return Number.isFinite(v) ? v : collapsedMax;
		};

		const updateOne = (wrap) => {
			if (!wrap || wrap.classList.contains("animating")) return;
			const content = wrap.querySelector(contentSel);
			const toggle  = wrap.querySelector(toggleSel);
			if (!content || !toggle) return;

			const cap        = capFor(wrap);
			const isExpanded = wrap.classList.contains("expanded");
			const overflows  = content.scrollHeight > (cap + 1);

			// "short" means NO overflow → hide toggle; your CSS hides gradient on .short
			wrap.classList.toggle("short", !overflows);
			toggle.hidden = !overflows;

			if (!toggle.querySelector("i")) toggle.innerHTML = '<i class="fa-solid fa-angle-down"></i>';
			toggle.querySelector("i").classList.toggle("rotated", isExpanded);
		};

		const animateTo = (el, targetPx, done) => {
			el.style.maxHeight = `${targetPx}px`;
			const onEnd = (e) => {
			if (e && e.target !== el) return;
			el.removeEventListener("transitionend", onEnd);
			done?.();
			};
			setTimeout(() => done?.(), transitionMs + 50); // safety
			el.addEventListener("transitionend", onEnd, { once: true });
		};

		// Click toggle (expand/collapse)
		$root.off("click.mgSeeAllToggle").on("click.mgSeeAllToggle", `${wrapSel} ${toggleSel}`, (ev) => {
			ev.preventDefault();
			const wrap = ev.currentTarget.closest(wrapSel);
			if (!wrap || wrap.classList.contains("animating")) return;

			const content = wrap.querySelector(contentSel);
			const toggle  = wrap.querySelector(toggleSel);
			if (!content || !toggle) return;

			const cap = capFor(wrap);
			wrap.classList.add("animating");
			const isExpanded = wrap.classList.contains("expanded");

			if (!isExpanded) {
			// EXPAND: (current or cap) → natural scroll height
			content.style.maxHeight = `${Math.max(content.clientHeight, cap)}px`;
			content.offsetHeight; // reflow
			animateTo(content, content.scrollHeight, () => {
				wrap.classList.add("expanded");
				content.style.maxHeight = "";
				const icon = toggle.querySelector("i");
				if (icon) requestAnimationFrame(() => icon.classList.add("rotated"));
				wrap.classList.remove("animating");
				updateOne(wrap);
			});
			} else {
			// COLLAPSE: natural scroll height → cap
			content.style.maxHeight = `${content.scrollHeight}px`;
			content.offsetHeight; // reflow
			animateTo(content, cap, () => {
				wrap.classList.remove("expanded");
				content.style.maxHeight = "";
				const icon = toggle.querySelector("i");
				if (icon) requestAnimationFrame(() => icon.classList.remove("rotated"));
				wrap.classList.remove("animating");
				updateOne(wrap);
			});
			}
		});

		// Initial measure (hidden tabs will look short here; we refresh on tab switch)
		$root.find(wrapSel).each((_, el) => updateOne(el));

		// Re-measure after the Assets tab becomes visible
		const refreshAll = () => setTimeout(() => {
			$root.find(wrapSel).each((_, el) => updateOne(el));
		}, 0);

		// When switching tabs, if Assets is selected, refresh measurements
		$root.off("click.mgSeeAllTab").on("click.mgSeeAllTab", ".sheet-tabs .item", (ev) => {
			const tab = ev.currentTarget?.dataset?.tab;
			if (tab === "assets") refreshAll();
		});

		// If Assets is already visible on first render
		const assetsTabVisible = $root.find('.tab[data-tab="assets"]').is(":visible");
		if (assetsTabVisible) refreshAll();
		};

		// Initialize the global see-all toggles (one time per render)
		bindSeeAll($root);

		/* Crew Gambits Tab
		------------------------------------------------------------------*/
		{
		const $root = html instanceof jQuery ? html : $(html);

		// Post Gambit to Chat
		$root.off("click.mgPostGambit").on("click.mgPostGambit", ".post-gambit", async (ev) => {
			ev.preventDefault();
			const id = ev.currentTarget.dataset.itemId;
			const item = this.actor.items.get(id);
			if (!item) return;
			const descHtml = await TextEditor.enrichHTML(String(item.system?.description ?? ""), { async: true });
			await ChatMessage.create({
			user: game.user.id,
			speaker: ChatMessage.getSpeaker({ actor: this.actor }),
			content: `<div class="gambit-chat-card"><h2><i class="fa-solid fa-cards"></i> ${item.name}</h2>${descHtml}</div>`
			});
		});

		// Discard Gambit
		$root.off("click.mgDiscardGambit").on("click.mgDiscardGambit", ".discard-gambit", async (ev) => {
			ev.preventDefault();
			const id = ev.currentTarget.closest("[data-item-id]")?.dataset?.itemId;
			const g = foundry.utils.deepClone(this.actor.system.gambits ?? {});
			g.deck = (g.deck || []).filter(i => i !== id);
			g.discard = [...(g.discard || []), id];
			await this.actor.update({ "system.gambits.deck": g.deck, "system.gambits.discard": g.discard });
			this.render(false);
		});

		// Remove Gambit entirely
		$root.off("click.mgRemoveGambit").on("click.mgRemoveGambit", ".remove-gambit", async (ev) => {
			ev.preventDefault();
			const id = ev.currentTarget.closest("[data-item-id]")?.dataset?.itemId;
			await this.actor.deleteEmbeddedDocuments("Item", [id]);
			const g = foundry.utils.deepClone(this.actor.system.gambits ?? {});
			g.deck = (g.deck || []).filter(i => i !== id);
			g.discard = (g.discard || []).filter(i => i !== id);
			await this.actor.update({ "system.gambits": g });
			this.render(false);
		});
		}


		// --- Render new tabs (Assets / Gambits / Bio)
		this._bindGambitsTab(html);
		this._bindBioTab(html);
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

    /* Gambits tab bindings
    ----------------------------------------------------------------------*/  
	_bindGambitsTab(html) {
	const root = html.find(".mg-crew-gambits");
	if (!root.length) return;

	if (this.isEditable) {
		root.find(".gb-draw").on("click", async () => {
		const g = foundry.utils.deepClone(this.actor.system.gambits);
		const handSize = Number(g.handSize) || 3;
		if (!g.deck.length && g.discard.length) {
			g.deck = foundry.utils.shuffle(g.discard); g.discard = [];
		}
		if (!g.deck.length) return;
		if (g.drawn.length >= handSize) { ui.notifications?.warn("Hand is full."); return; }
		const id = g.deck.shift(); if (id) g.drawn.push(id);
		await this.actor.update({ "system.gambits": g });
		});

		root.find(".gb-shuffle").on("click", async () => {
		const g = foundry.utils.deepClone(this.actor.system.gambits);
		g.deck = foundry.utils.shuffle(g.deck);
		await this.actor.update({ "system.gambits.deck": g.deck });
		});

		root.find(".gb-recall").on("click", async () => {
		const g = foundry.utils.deepClone(this.actor.system.gambits);
		g.deck = g.deck.concat(g.discard);
		g.discard = [];
		g.deck = foundry.utils.shuffle(g.deck);
		await this.actor.update({ "system.gambits": g });
		});

		root.on("click", ".gb-play", async (ev) => {
		const id = ev.currentTarget.dataset.id;
		const g = foundry.utils.deepClone(this.actor.system.gambits);
		const idx = g.drawn.indexOf(id);
		if (idx >= 0) {
			g.drawn.splice(idx, 1);
			g.discard.push(id);
			await this.actor.update({ "system.gambits": g });
			const item = this.actor.items.get(id);
			if (item) ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor: this.actor }),
			content: `<b>Crew plays:</b> ${Handlebars.escapeExpression(item.name)}`
			});
		}
		});

		root.on("click", ".gb-discard", async (ev) => {
		const id = ev.currentTarget.dataset.id;
		const g = foundry.utils.deepClone(this.actor.system.gambits);
		const idx = g.drawn.indexOf(id);
		if (idx >= 0) {
			g.drawn.splice(idx, 1);
			g.discard.push(id);
			await this.actor.update({ "system.gambits": g });
		}
		});

		// Drag/drop: only Item type "gambit"
		const dropZone = root.find(".mg-crew-gb-drop");
		dropZone.on("dragover", (ev) => ev.preventDefault());
		dropZone.on("drop", async (ev) => {
		ev.preventDefault();
		const txt = ev.originalEvent?.dataTransfer?.getData("text/plain");
		if (!txt) return;
		let data; try { data = JSON.parse(txt); } catch { return; }
		if (data.type !== "Item") return;

		const doc = await fromUuid(data.uuid);
		if (!doc || doc.documentName !== "Item") return;
		const item = doc instanceof Item ? doc : doc.toObject();
		if ((item.type || doc.type) !== "gambit") {
			ui.notifications?.warn("Only Gambit items can be added to the Deck."); return;
		}
		const obj = item instanceof Item ? item.toObject() : item;
		delete obj._id;
		const [created] = await this.actor.createEmbeddedDocuments("Item", [obj]);
		const g = foundry.utils.deepClone(this.actor.system.gambits);
		g.deck.push(created.id);
		await this.actor.update({ "system.gambits.deck": g.deck });
		});
	}
	}

    /* Bio tab bindings
    ----------------------------------------------------------------------*/
	_bindBioTab(html) {
	const root = html.find(".mg-crew-bio");
	if (!root.length) return;

	const commit = (path, val) => this.actor.update({ [path]: val });

	root.find(".bio-look").on("change", (ev)=> commit("system.bio.lookAndFeel", ev.currentTarget.value));
	root.find(".bio-weak").on("change", (ev)=> commit("system.bio.weakness", ev.currentTarget.value));
	root.find(".bio-location").on("change", (ev)=> commit("system.bio.location", ev.currentTarget.value));
	root.find(".bio-features").on("change", (ev)=> commit("system.bio.features", ev.currentTarget.value));

	root.find(".bio-add-tag").on("keydown", async (ev) => {
		if (ev.key !== "Enter") return;
		ev.preventDefault();
		const v = ev.currentTarget.value?.trim();
		if (!v) return;
		const tags = Array.from(this.actor.system.bio?.tags || []);
		tags.push(v);
		await this.actor.update({ "system.bio.tags": tags });
		ev.currentTarget.value = "";
	});

	root.on("click", ".tag i", async (ev) => {
		const span = ev.currentTarget.closest(".tag");
		const idx = Number(span?.dataset.idx);
		if (!Number.isInteger(idx)) return;
		const tags = Array.from(this.actor.system.bio?.tags || []);
		tags.splice(idx, 1);
		await this.actor.update({ "system.bio.tags": tags });
	});
	}
}