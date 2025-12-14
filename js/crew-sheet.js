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
		data.directoryIcon = rawDirIcon; // last-picked raw value (for the Settings UI)

		// Prefer the flag when present; otherwise use actor.img (already sanitized elsewhere)
		const stored = rawDirIcon
			? (this._vfsPathForStorage(rawDirIcon) || "systems/midnight-gambit/assets/images/mg-queen.png")
			: (this.actor.img || "systems/midnight-gambit/assets/images/mg-queen.png");

			let resolved = foundry.utils.getRoute(stored);
			if (resolved.startsWith("/https://")) resolved = resolved.slice(1);
			data.directoryIconResolved = resolved;




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
		data.owner = this.actor.isOwner;
		data.editable = this.isEditable;

		const docTier = this._readCrewTier();
		data.crewTier = docTier;

		// ----- Level-pending badge logic using per-tier baseline -----
		const baselines = await this._getTierBaselines();
		const base = baselines[String(docTier)] || null;
		const rewardsForThisTier = this._rewardsForTier(docTier);
		const hasRequirements = (rewardsForThisTier.assets > 0) || (rewardsForThisTier.gambits > 0) || (rewardsForThisTier.hideoutUp > 0);


		// If there are no requirements at this tier, there's nothing to be pending about.
		const needsAssets  = Number(rewardsForThisTier.assets  || 0);
		const needsGambits = Number(rewardsForThisTier.gambits || 0);
		const hasReqs = (needsAssets + needsGambits + Number(rewardsForThisTier.hideoutUp || 0)) > 0;

		let pending = false;

		if (hasReqs) {
			// If we didn't capture a baseline for this tier (e.g., legacy data), create one now.
			if (!base) {
				await this._setTierBaseline(docTier, rewardsForThisTier);
			}

			const useBase = base || { itemIds: [], need: rewardsForThisTier };
			const existing = new Set(useBase.itemIds);

			// Count newly created items since entering this tier
			const newItems = this.actor.items.filter(i => !existing.has(i.id));
			const newAssetCount  = newItems.filter(i => i.type === "asset").length;
			const newGambitCount = newItems.filter(i => i.type === "gambit").length;

			const needA = Number(useBase.need?.assets  || 0);
			const needG = Number(useBase.need?.gambits || 0);

			pending = (newAssetCount < needA) || (newGambitCount < needG);
		}

		// Expose to template
		data.levelPending = Boolean(pending);


		// s.bio etc. stay as-is below
		s.bio ??= { lookAndFeel: "", weakness: "", location: "", features: "", tags: [] };

		// Ensure tags are objects for the template (migrate old string tags on the fly)
		if (Array.isArray(s.bio.tags)) {
		s.bio.tags = s.bio.tags.map(t => (typeof t === "string" ? { label: t, desc: "" } : t));
		}

		// Replace your current gambits init with this:
		s.gambits ??= { deck: [], drawn: [], discard: [], handSize: 3, deckSize: 10 };
		for (const k of ["deck","drawn","discard"]) s.gambits[k] ??= [];

		for (const k of ["deck","drawn","discard"]) s.gambits[k] ??= [];

		// Build template-friendly arrays and include a total presence flag
		const mapItem = id => this.actor.items.get(id);

		const deckArr    = (s.gambits.deck    || []).map(mapItem).filter(Boolean);
		const drawnArr   = (s.gambits.drawn   || []).map(mapItem).filter(Boolean);
		const discardArr = (s.gambits.discard || []).map(mapItem).filter(Boolean);

		const gb = {
			deck: deckArr,
			drawn: drawnArr,
			discard: discardArr,
			handSize: Number(s.gambits.handSize) || 3,
			hasAny: (deckArr.length + discardArr.length) > 0
		};

		const gambitCounts = {
		deckCount: deckArr.length,
		deckMax: Number(s.gambits?.handSize ?? 3),
		discardCount: discardArr.length
		};

		gambitCounts.deckCount = Array.isArray(this.actor.system?.gambits?.deck) ? this.actor.system.gambits.deck.length : 0;

		data.gb = gb;
		data.gambitCounts = gambitCounts;

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
				// Tier gate: Crew sheet only accepts Crew-tier Gambits
				const tier = (obj.system?.tier ?? src.system?.tier ?? "rookie").toLowerCase();
				if (tier !== "crew") {
				ui.notifications?.warn("Only Crew-tier Gambits can be added to the Crew.");
				return false;
				}

				// Hand-size cap with confirm override
				const g = this.actor.system?.gambits ?? {};
				const handSize  = Number(g.handSize ?? 3) || 3;
				const currentCt = Array.isArray(g.deck) ? g.deck.length : 0;

				if (currentCt >= handSize) {
				const ok = await Dialog.confirm({
					title: "Over Hand Limit?",
					content: `
					<p>You're going over your max available Crew Gambits for this level
					(<strong>${currentCt}/${handSize}</strong>).</p>
					<p><em>Only add this if your Director approves!</em></p>
					`,
					defaultYes: false,
					yes: () => true, no: () => false
				});
				if (!ok) return false;
				}
			}

			// Create the embedded item on the Crew
			const [created] = await this.actor.createEmbeddedDocuments("Item", [obj]);

			// If it's a Gambit, drop it into the Crew's hand immediately
			if (isGambit && created?.id) {
				const g2 = foundry.utils.deepClone(this.actor.system.gambits ?? {});
				g2.deck = Array.isArray(g2.deck) ? g2.deck.slice() : [];
				g2.deck.push(created.id);
				await this.actor.update({ "system.gambits.deck": g2.deck }, { render: false });
			}

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

			// Also set a back-reference on the dropped character (no re-render)
			try {
			await actor.update({
				"system.crewId": this.actor.id,
				"system.crewName": this.actor.name
			}, { render: false });

			// Optional: toast for feedback
			ui.notifications?.info(`${actor.name} assigned to Crew: ${this.actor.name}`);
			} catch (err) {
				console.warn("MG | Could not set crew fields on member actor:", err);
			}


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

	const vfs = this._vfsPathForStorage(raw);
	if (vfs !== raw) {
		try { await this.actor.setFlag("midnight-gambit", "directoryIcon", vfs); } catch {}
	}

	}

	/** Crew Gambit slots by tier. Base 3 +1 at tiers 1, 2, and 4 = max 6. */
	_crewGambitSlotsForTier(tier) {
		const t = Number(tier) || 1;
		// explicit mapping for clarity & easy tweaks
		if (t <= 1) return 4; // 3 base +1 at tier 1
		if (t === 2) return 5; // +1
		if (t === 3) return 5; // no change
		if (t === 4) return 6; // +1
		return 6;              // tier 5 stays 6
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

			// --- Remove member from this Crew (UUID-based, does both sides cleanly) ---
			$root.off("click.mgRemoveMember").on("click.mgRemoveMember", ".mg-remove-member", async (ev) => {
				ev.preventDefault();
				ev.stopPropagation();

				// Find the card and its UUID (your HTML sets data-uuid on .mg-member-card)
				const card = ev.currentTarget.closest(".mg-member-card[data-uuid]");
				const uuid = card?.dataset?.uuid;
				if (!uuid) {
					ui.notifications?.warn("Couldn’t determine which member to remove.");
					return;
				}

				// Resolve the actual Actor from UUID (supports Token/other UUIDs too)
				let doc = null;
				try { doc = await fromUuid(uuid); } catch {}
				const member = (doc?.documentName === "Actor") ? doc
							: (doc?.actor) ? doc.actor
							: null;
				if (!member) {
					ui.notifications?.warn("Member actor not found from UUID.");
					return;
				}

				// v11-safe esc
				const esc = (s) => (window?.Handlebars?.escapeExpression)
					? Handlebars.escapeExpression(String(s ?? ""))
					: String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;")
									.replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");

				const ok = await Dialog.confirm({
					title: "Remove from Party?",
					content: `<p>Remove <strong>${esc(member.name)}</strong> from this Crew?</p>`,
					defaultYes: false
				});
				if (!ok) return;

				try {
					// 1) Remove member UUID from Crew party + initiative
					const sys = this.actor.system ?? {};
					const nextMembers = (sys.party?.members ?? []).filter(u => u !== uuid);
					const nextOrder   = (sys.initiative?.order ?? []).filter(u => u !== uuid);

					await this.actor.update({
					"system.party.members": nextMembers,
					"system.initiative.order": nextOrder
					}, { render: false });

					// 2) Clear back-reference on the character if it pointed to THIS crew
					if (member.system?.crewId === this.actor.id) {
					await member.update({
						"system.crewId": null,
						"system.crewName": ""
					}, { render: false });
					}

					// 3) Soft refresh: this sheet + that actor’s open sheets
					this.render(false);
					Object.values(member.apps ?? {}).forEach(app => app?.render?.(false));

					ui.notifications?.info(`${member.name} removed from the Crew.`);
				} catch (err) {
					console.error("MG | remove member failed:", err);
					ui.notifications?.error("Failed to remove member. See console.");
				}
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
			// Also fix any previously-saved img that missed /assets/images/
			this._sanitizeActorImgOnce();
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
					// 0) Remember the raw selection (optional flag)
					await this.actor.setFlag("midnight-gambit", "directoryIcon", path);

					// 1) Normalize to a VFS path (or http/data) for *storage* in actor.img
					const vfsPath = this._vfsPathForStorage(path);

					// 2) Store to actor.img so the Actors directory (for everyone) has a valid, Forge-safe src
					await this.actor.update({ img: vfsPath }, { render: false });

					// 3) Route it for immediate preview + directory DOM patch
					const url = foundry.utils.getRoute(vfsPath);

					// Sheet preview
					this.element.find(".mg-diricon-preview img").attr("src", url);

					// Sidebar directory entry (live patch for this client)
					this._refreshDirectoryThumb(url);

					// Fallback: re-render directory in case it’s closed
					ui.actors?.render(false);
				}
			});
			
			picker.render(true);
		});

		// Settings tab: Clear directory icon
		$root.off("click.mgClearDirIcon").on("click.mgClearDirIcon", ".mg-clear-diricon", async (ev) => {
			ev.preventDefault();

			await this.actor.unsetFlag("midnight-gambit", "directoryIcon");

			const fallbackVfs = "systems/midnight-gambit/assets/images/mg-queen.png";
			await this.actor.update({ img: fallbackVfs }, { render: false });

			const fallbackUrl = foundry.utils.getRoute(fallbackVfs);

			// 1) Sheet preview
			this.element.find(".mg-diricon-preview img").attr("src", fallbackUrl);

			// 2) Directory entry (inline)
			this._refreshDirectoryThumb(fallbackUrl);

			// 3) Fallback render
			ui.actors?.render(false);

		});

		// --- Settings tab: Crew Leveling (Level Up / Undo Last Level)
		$root.off("click.mgCrewLevelUp").on("click.mgCrewLevelUp", ".mg-crew-levelup", async (ev) => {
			ev.preventDefault();
			await this._openCrewLevelWizard();
		});

		$root.off("click.mgCrewUndo").on("click.mgCrewUndo", ".mg-crew-undo", async (ev) => {
			ev.preventDefault();
			await this._undoLastCrewLevel();
		});

		$root.off("click.mgCrewUndoAll").on("click.mgCrewUndoAll", ".mg-crew-undo-all", async (ev) => {
		ev.preventDefault();
			const ok = await Dialog.confirm({
				title: "Reset Crew to Tier 1?",
				content: "<p>This will revert the crew back to Tier 1 (hand size 3) and clear level history.</p>"
			});
			if (!ok) return;
		await this._undoToTierOne();
		});

		// Header "Review Level Requirements" → open non-mutating checklist dialog
		$root.off("click.mgCrewReview")
		.on("click.mgCrewReview", ".mg-crew-review-level", async (ev) => {
			ev.preventDefault();
			await this._openCrewReviewDialog(); // <-- new, read-only dialog
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
					label: "Finish Level",
					icon: '<i class="fa-solid fa-flag-checkered"></i>',
					cssClass: "mg-lvl-save",
					callback: () => true
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
				<a class="header-button ae-open" title="Open Asset"><i class="fa-regular fa-pen-to-square"></i> Open Asset</a>
				<a class="header-button ae-delete" title="Delete Asset"><i class="fa-solid fa-trash"></i> Delete Asset</a>
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

			// Count how many tag chips we actually have
			const chipCount = tags.querySelectorAll(".asset-tag, .item-tag, .tag-pill, .tag").length;

			// Old behaviour: height-based overflow
			const overflowsByHeight = tags.scrollHeight > (COLLAPSED_MAX + 1);

			// New: treat "4+ chips" as overflow regardless of exact pixel math
			const overflows = chipCount > 2 || overflowsByHeight;

			// "short" means there is NO overflow — hide toggle and (your CSS) hides gradient
			wrap.classList.toggle("short", !overflows);
			toggle.hidden = !overflows;

			// Enforce collapsed max-height when not expanded so the clamp actually happens
			if (!isExpanded) {
			tags.style.maxHeight = overflows ? `${COLLAPSED_MAX}px` : "";
			} else {
			// Let expanded state grow naturally
			tags.style.maxHeight = "";
			}

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

		// Crew Assets: Description/Notes "See All" (mg-seeall-wrap)
		{
		const $root = html instanceof jQuery ? html : $(html);

		const DEFAULT_CAP = 140;
		const TRANSITION_MS = 500;

		const capFor = (wrap) => {
			const v = Number(wrap?.dataset?.seeallCap);
			return Number.isFinite(v) ? v : DEFAULT_CAP;
		};

		// Measure a wrap and decide if it's short / needs toggle
		const setupOne = (wrap) => {
			if (!wrap || wrap.classList.contains("animating")) return;

			const content = wrap.querySelector(".mg-seeall-content");
			const toggle  = wrap.querySelector(".mg-seeall-toggle");
			if (!content || !toggle) return;

			const cap      = capFor(wrap);
			const expanded = wrap.classList.contains("expanded");

			// IMPORTANT: remove clamp before measuring, otherwise scrollHeight lies
			const prevMax = content.style.maxHeight;
			content.style.maxHeight = "";
			// force reflow
			// eslint-disable-next-line no-unused-expressions
			content.offsetHeight;

			const overflows = content.scrollHeight > (cap + 1);

			// restore clamp state
			if (!expanded && overflows) content.style.maxHeight = `${cap}px`;
			else content.style.maxHeight = "";

			// (if something left a value behind, don't keep it)
			if (expanded && prevMax) content.style.maxHeight = "";

			wrap.classList.toggle("short", !overflows);
			toggle.hidden = !overflows;

			if (!toggle.querySelector("i")) {
			toggle.innerHTML = '<i class="fa-solid fa-angle-down"></i>';
			}
			toggle.querySelector("i")?.classList.toggle("rotated", expanded);
		};

		const refreshAll = () => {
			const wraps =
			$root[0]?.querySelectorAll(
				'.tab[data-tab="assets"] .mg-seeall-wrap, .tab.assets .mg-seeall-wrap'
			) || [];
			wraps.forEach(setupOne);
		};

		// Click handler (expand/collapse)
		$root
			.off("click.mgCrewAssetSeeAll")
			.on(
			"click.mgCrewAssetSeeAll",
			'.tab[data-tab="assets"] .mg-seeall-toggle, .tab.assets .mg-seeall-toggle',
			(ev) => {
				ev.preventDefault();
				ev.stopPropagation();

				const wrap = ev.currentTarget.closest(".mg-seeall-wrap");
				const content = wrap?.querySelector(".mg-seeall-content");
				if (!wrap || !content || wrap.classList.contains("animating")) return;

				const cap = capFor(wrap);
				const icon = ev.currentTarget.querySelector("i");
				const wasExpanded = wrap.classList.contains("expanded");

				// make sure we start from a numeric px height so transitions work
				content.style.maxHeight = "";
				// eslint-disable-next-line no-unused-expressions
				content.offsetHeight;

				const startPx = content.scrollHeight;
				content.style.maxHeight = `${startPx}px`;
				// eslint-disable-next-line no-unused-expressions
				content.offsetHeight;

				const targetPx = wasExpanded ? cap : content.scrollHeight;

				wrap.classList.add("animating");
				wrap.classList.toggle("expanded", !wasExpanded);
				if (icon) icon.classList.toggle("rotated", !wasExpanded);

				content.style.maxHeight = `${targetPx}px`;

				const onEnd = (e) => {
				if (e && e.target !== content) return;
				content.removeEventListener("transitionend", onEnd);

				wrap.classList.remove("animating");

				// After expand: clear so it can grow naturally
				// After collapse: keep clamped to cap
				if (wrap.classList.contains("expanded")) content.style.maxHeight = "";
				else content.style.maxHeight = `${cap}px`;

				setupOne(wrap);
				};

				content.addEventListener("transitionend", onEnd, { once: true });
				setTimeout(onEnd, TRANSITION_MS + 80); // safety
			}
			);

		// Re-measure when switching to Assets tab
		$root
			.off("click.mgCrewAssetSeeAllTab")
			.on("click.mgCrewAssetSeeAllTab", ".sheet-tabs .item", (ev) => {
			const tab = ev.currentTarget?.dataset?.tab;
			if (tab === "assets") setTimeout(refreshAll, 0);
			});

		// Initial
		setTimeout(refreshAll, 0);
		}

		/* Crew Assets: FULL CARD collapse/expand (like inventory)
		------------------------------------------------------------*/
		{
		const TRANSITION_MS = 500;         // must match CSS
		const DEFAULT_CAP = 380;           // <-- tweak collapsed height here

		const capFor = (card) => {
			const v = Number(card?.dataset?.cardCap);
			return Number.isFinite(v) ? v : DEFAULT_CAP;
		};

		const setIcon = (card) => {
			const btn  = card.querySelector(".mg-card-toggle");
			const icon = btn?.querySelector("i");
			if (!btn) return;
			if (!icon) btn.innerHTML = '<i class="fa-solid fa-angle-down"></i>';
			btn.querySelector("i")?.classList.toggle("rotated", card.classList.contains("expanded"));
		};

		// IMPORTANT: we DO keep a px maxHeight when expanded,
		// so collapse can animate smoothly from that value.
		const setCollapsed = (card) => {
			const cap = capFor(card);
			card.classList.remove("expanded");
			card.style.maxHeight = `${cap}px`;
			setIcon(card);
		};

		const setExpanded = (card) => {
			card.classList.add("expanded");
			// lock to scrollHeight in px (don’t clear!) so collapse animates later
			card.style.maxHeight = `${card.scrollHeight}px`;
			setIcon(card);
		};

		const initOne = (card) => {
			if (!card) return;
			// Default state = collapsed & equal height
			setCollapsed(card);
		};

		const refreshExpandedHeight = (card) => {
			if (!card?.classList.contains("expanded")) return;
			// If inner content expands (desc/tags), keep the card's px maxHeight in sync
			card.style.maxHeight = `${card.scrollHeight}px`;
		};

		// Initialize all cards (on render / tab open)
		const initAll = () => {
			const cards = $root.find('.tab[data-tab="assets"] .asset-card').toArray();
			for (const c of cards) initOne(c);
		};

		// Toggle button click
		$root.off("click.mgAssetCardToggle").on(
			"click.mgAssetCardToggle",
			'.tab[data-tab="assets"] .asset-card .mg-card-toggle',
			(ev) => {
			ev.preventDefault();
			ev.stopPropagation();

			const card = ev.currentTarget.closest(".asset-card");
			if (!card || card.classList.contains("animating")) return;

			const cap = capFor(card);
			const isExpanded = card.classList.contains("expanded");

			card.classList.add("animating");

			if (!isExpanded) {
				// EXPAND: cap -> scrollHeight
				card.style.maxHeight = `${cap}px`;
				card.offsetHeight; // reflow
				const target = card.scrollHeight;
				card.style.maxHeight = `${target}px`;

				const done = () => {
				card.classList.remove("animating");
				card.classList.add("expanded");
				// KEEP px height so collapse animates later
				card.style.maxHeight = `${card.scrollHeight}px`;
				setIcon(card);
				};

				card.addEventListener("transitionend", done, { once: true });
				setTimeout(done, TRANSITION_MS + 80);
			} else {
				// COLLAPSE: current scrollHeight -> cap
				const start = card.scrollHeight;
				card.style.maxHeight = `${start}px`;
				card.offsetHeight; // reflow
				card.style.maxHeight = `${cap}px`;

				const done = () => {
				card.classList.remove("animating");
				card.classList.remove("expanded");
				card.style.maxHeight = `${cap}px`;
				setIcon(card);
				};

				card.addEventListener("transitionend", done, { once: true });
				setTimeout(done, TRANSITION_MS + 80);
			}
			}
		);

		// When inner mg-seeall expands/collapses, bump card height if card is expanded
		// (This is what fixes "desc opens but card doesn't grow")
		$root.off("click.mgAssetCardBumpOnInnerSeeAll").on(
			"click.mgAssetCardBumpOnInnerSeeAll",
			'.tab[data-tab="assets"] .mg-seeall-toggle, .tab[data-tab="assets"] .tags-toggle',
			(ev) => {
			const card = ev.currentTarget.closest(".asset-card");
			if (!card) return;
			// Let inner handler run first, then measure
			setTimeout(() => refreshExpandedHeight(card), 0);
			}
		);

		// Hidden tab issue: init when switching to assets
		$root.off("click.mgAssetCardTabInit").on("click.mgAssetCardTabInit", ".sheet-tabs .item", (ev) => {
			if (ev.currentTarget?.dataset?.tab !== "assets") return;
			setTimeout(initAll, 0);
		});

		// If assets is already visible on first render
		setTimeout(initAll, 0);
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

		// Play Gambit: post to chat, then MOVE from hand → discard
		$root.off("click.mgPlayGambit").on("click.mgPlayGambit", ".play-gambit", async (ev) => {
		ev.preventDefault();

		// Resolve item id from the button or ancestor card
		const card = ev.currentTarget.closest("[data-item-id]") || ev.currentTarget;
		const id   = card?.dataset?.itemId || ev.currentTarget.dataset.itemId;
		if (!id) return;

		const item = this.actor.items.get(id);
		if (!item) return;

		// 1) Post the gambit to chat (enrich description as rich HTML)
		const descHtml = await TextEditor.enrichHTML(String(item.system?.description ?? ""), { async: true });
		await ChatMessage.create({
			user: game.user.id,
			speaker: ChatMessage.getSpeaker({ actor: this.actor }),
			content: `<div class="gambit-chat-card"><h2><i class="fa-solid fa-cards"></i> ${Handlebars.escapeExpression(item.name)}</h2>${descHtml}</div>`
		});

		// 2) Move it from hand (deck) → discard (no deletion)
		const g       = foundry.utils.deepClone(this.actor.system.gambits ?? {});
		const hand    = Array.isArray(g.deck)    ? g.deck.slice()    : [];
		const discard = Array.isArray(g.discard) ? g.discard.slice() : [];

		const nextHand = hand.filter(i => i !== id);
		const set      = new Set(discard); set.add(id);
		const nextDiscard = Array.from(set);

		await this.actor.update({
			"system.gambits.deck": nextHand,
			"system.gambits.discard": nextDiscard
		});

		this.render(false);
		});

		// Discard Gambit (MOVE from hand → discard; do NOT delete)
		$root.off("click.mgDiscardGambit").on("click.mgDiscardGambit", ".discard-gambit", async (ev) => {
		ev.preventDefault();
		const id = ev.currentTarget.closest("[data-item-id]")?.dataset?.itemId;
		if (!id) return;

		const g = foundry.utils.deepClone(this.actor.system.gambits ?? {});
		const hand    = Array.isArray(g.deck)    ? g.deck.slice()    : [];
		const discard = Array.isArray(g.discard) ? g.discard.slice() : [];

		// Remove from hand, add to discard (de-duped)
		const nextHand = hand.filter(i => i !== id);
		const set = new Set(discard); set.add(id);
		const nextDiscard = Array.from(set);

		await this.actor.update({
			"system.gambits.deck": nextHand,
			"system.gambits.discard": nextDiscard
		});

		this.render(false);
		});

		// Reset Hand: move ALL discard → hand (de-dupe), empty discard
		$root.off("click.mgResetGambits").on("click.mgResetGambits", ".gambit-reset", async (ev) => {
		ev.preventDefault();

		const g = foundry.utils.deepClone(this.actor.system.gambits ?? {});
		const hand    = Array.isArray(g.deck)    ? g.deck.slice()    : [];
		const discard = Array.isArray(g.discard) ? g.discard.slice() : [];

		// union(hand, discard), then clear discard
		const set = new Set(hand);
		for (const id of discard) set.add(id);

		const nextHand = Array.from(set);
		const nextDiscard = [];

		// Optional clamp to hand limit (you said “start with 3”)
		// Comment out if you want all to return regardless of limit.
		const limit = Number(g.handSize ?? 3) || 3;
		const clampedHand = nextHand.slice(0, limit);

		await this.actor.update({
			"system.gambits.deck": clampedHand,
			"system.gambits.discard": nextDiscard
		});

		this.render(false);
		ui.notifications?.info("Crew hand reset.");
		});

		// --- Remember last-opened tab (per user, per crew)
		{
		const $root = html instanceof jQuery ? html : $(html);
		const storeKey = `mgCrewTab.${this.actor.id}`;

		// Save on tab click
		$root.off("click.mgRememberTab")
			.on("click.mgRememberTab", ".sheet-tabs .item", (ev) => {
			const tab = ev.currentTarget?.dataset?.tab;
			if (!tab) return;
			try { localStorage.setItem(storeKey, tab); } catch (_) {}
			});

		// After Foundry initialized tabs, re-activate the stored tab
		// (do this once per render — belt & suspenders in case something else tried to switch)
		const validTabs = Array.from($root[0].querySelectorAll(".sheet-tabs .item"))
			.map(n => n.dataset.tab)
			.filter(Boolean);

		const saved = (() => {
			try { return localStorage.getItem(storeKey); } catch (_) { return null; }
		})();

		// Default: "party" (your Crew's "general" tab). If you rename your general tab, change this.
		const fallback = "party";

		const target = (saved && validTabs.includes(saved)) ? saved : fallback;

		try { this._tabs?.[0]?.activate(target); } catch (_) {}
		}

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

	/** -----------------------
	 *  Tier Baseline Utilities
	 *  -----------------------
	 *  We store, per tier, the itemIds that existed immediately after entering that tier,
	 *  and the requirements for that tier. "Pending" is computed by counting items created
	 *  since that baseline.
	 */
	async _getTierBaselines() {
		const map = this.actor.getFlag("midnight-gambit", "crewTierBaselines");
		return (map && typeof map === "object") ? { ...map } : {};
	}

	async _setTierBaselines(map) {
		await this.actor.setFlag("midnight-gambit", "crewTierBaselines", map && typeof map === "object" ? map : {});
	}

	/** Record a baseline for a tier (overwrite if it already exists). */
	async _setTierBaseline(tier, need) {
		const baselines = await this._getTierBaselines();
		const itemIds   = this.actor.items.map(i => i.id);
		baselines[String(tier)] = {
			tier: Number(tier) || 1,
			itemIds,
			need: {
			assets:  Number(need?.assets  ?? 0),
			gambits: Number(need?.gambits ?? 0),
			hideoutUp: Number(need?.hideoutUp ?? 0)
			},
			ts: Date.now()
		};
	await this._setTierBaselines(baselines);
	}

	/** Remove baselines for tiers strictly above `tier` (used on undo). */
	async _pruneBaselinesAbove(tier) {
		const t = Number(tier) || 1;
		const baselines = await this._getTierBaselines();
		let dirty = false;
		for (const k of Object.keys(baselines)) {
			if (Number(k) > t) { delete baselines[k]; dirty = true; }
		}
		if (dirty) await this._setTierBaselines(baselines);
	}


	/** Crew Tier → required rewards and resulting hand size.
	 *  Table:
	 *   Tier 1: Base (3 hand) — creation time
	 *   Tier 2: +1 Asset, +1 Crew Gambit → hand 4
	 *   Tier 3: +1 Hideout Upgrade       → hand 4
	 *   Tier 4: +1 Asset, +1 Crew Gambit → hand 5
	 *   Tier 5: +1 Hideout Upgrade       → hand 5
	 */
	_handSizeForTier(t) {
	const tier = Number(t) || 1;
		if (tier <= 1) return 3;
		if (tier <= 3) return 4;
		if (tier <= 5) return 5;
		return 5;
	}

	_rewardsForTier(t) {
	// Returns what's gained WHEN ENTERING this tier.
	const tier = Number(t) || 1;
		if (tier === 2) return { assets: 1, gambits: 1, hideoutUp: 0 };
		if (tier === 3) return { assets: 0, gambits: 0, hideoutUp: 1 };
		if (tier === 4) return { assets: 1, gambits: 1, hideoutUp: 0 };
		if (tier === 5) return { assets: 0, gambits: 0, hideoutUp: 1 };
		return { assets: 0, gambits: 0, hideoutUp: 0 }; // tier 1 baseline handled at creation
	}

	/** Canonical crew tier storage helpers.
	 *  We use a flag as the source of truth and mirror to system.tier for templates.
	 */
	_readCrewTier() {
	const flagVal = Number(this.actor.getFlag("midnight-gambit", "crewTier"));
	if (Number.isFinite(flagVal) && flagVal >= 1) return Math.min(5, flagVal);

	const sysVal = Number(getProperty(this.actor, "system.tier"));
	if (Number.isFinite(sysVal) && sysVal >= 1) return Math.min(5, sysVal);

	return 1;
	}

	async _writeCrewTier(nextTier, nextHand) {
	const tier = Math.max(1, Math.min(5, Number(nextTier) || 1));
	const hand = Math.max(1, Number(nextHand) || 3);
	// Mirror to both places so templates and other code see the same thing
	await this.actor.update({
		"system.tier": tier,
		"system.gambits.handSize": hand
	}, { render: false });
	await this.actor.setFlag("midnight-gambit", "crewTier", tier);
	return { tier, hand };
	}


	/** Open the Crew Level-Up wizard. Steps are simple & live:
	 *  - Determine next tier (max 5)
	 *  - Compute required rewards for that new tier
	 *  - Bump tier + hand size immediately (so caps are right)
	 *  - Live-track items created while the dialog is open
	 *  - Finish enabled only when required items are satisfied
	 *  - Persist an undo snapshot so we can revert
	 */
	async _openCrewLevelWizard() {

		// --- Normalize current tier safely (1–5) ---
		const currentTier = this._readCrewTier();
		const nextTier    = Math.min(5, currentTier + 1);
			if (nextTier === currentTier) {
				ui.notifications?.info("Crew is already at maximum Tier.");
				return;
		}

		// --- Snapshot for Undo (push to history stack) ---
		await this._pushUndoSnapshot(`Level to Tier ${nextTier}`);

		// --- Resolve rewards & hand size for NEXT tier (what you gain now) ---
		const rewards  = this._rewardsForTier(nextTier);
		const nextHand = this._handSizeForTier(nextTier);

		// --- Snapshot for Undo ---
		const before = {
			tier: currentTier,
			handSize: Number(this.actor.system?.gambits?.handSize ?? 3) || 3,
			itemIds: this.actor.items.map(i => i.id)
		};
		await this.actor.setFlag("midnight-gambit", "crewLevelUndo", before);

		// --- Apply core changes immediately (so caps/limits are right) ---
		await this._writeCrewTier(nextTier, nextHand);

		await this._setTierBaseline(nextTier, rewards);

		// --- Wizard UI scaffold ---
		const fmt = (n, w) => n === 1 ? `1 ${w}` : `${n} ${w}s`;
		const needsAssets  = rewards.assets;
		const needsGambits = rewards.gambits;
		const needsUpg     = rewards.hideoutUp;

		const countNow = () => {
			const idsNow = this.actor.items.map(i => i.id);
			const newIds = idsNow.filter(id => !before.itemIds.includes(id));
			const created = newIds.map(id => this.actor.items.get(id)).filter(Boolean);
			return {
			assets:  created.filter(i => i.type === "asset").length,
			gambits: created.filter(i => i.type === "gambit").length,
			createdIds: newIds
			};
		};

		const wrapId = `lvl-${randomID()}`;
		const content = `
		<style>
			.mg-level-wizard { line-height:1.4; }
			.mg-level-wizard .req { display:flex; gap:.5rem; align-items:center; margin:.25rem 0; }
			.mg-level-wizard .req .ok { color:var(--color-text-success, #47c972); display:none; }
			.mg-level-wizard .req.done .ok { display:inline; }
			.mg-level-wizard .hint { opacity:.8; font-size:.95em; margin:.25rem 0 .5rem; }
			.mg-level-wizard .counts { margin-top:.5rem; font-size:.95em; opacity:.9; }
			.mg-level-wizard .small { opacity:.75; font-size:.9em; }
		</style>
		<div id="${wrapId}" class="mg-level-wizard">
			<p><strong>Tier ${currentTier} → Tier ${nextTier}</strong></p>
			<p class="hint">Drag required items onto the Crew sheet as usual. This wizard auto-detects when you’ve added them.</p>
			<div class="req req-assets" data-need="${needsAssets}">
			<i class="fa-regular fa-box"></i>
			<span>${needsAssets ? ("Add " + fmt(needsAssets, "Asset")) : "No Assets at this tier"}</span>
			<i class="ok fa-solid fa-check"></i>
			</div>
			<div class="req req-gambits" data-need="${needsGambits}">
			<i class="fa-solid fa-cards"></i>
			<span>${needsGambits ? ("Add " + fmt(needsGambits, "Crew Gambit")) : "No Gambits at this tier"}</span>
			<i class="ok fa-solid fa-check"></i>
			</div>
			<div class="req req-upg ${needsUpg ? "" : "done"}" data-need="${needsUpg}">
			<i class="fa-regular fa-warehouse"></i>
			<span>${needsUpg
				? ("Apply " + fmt(needsUpg, "Hideout Upgrade") + " (note it manually for now)")
				: "No Hideout upgrade at this tier"}</span>
			<i class="ok fa-solid fa-check"></i>
			</div>
			<div class="counts small">Hand size is now <strong>${nextHand}</strong>.</div>
		</div>`;

		let resolver = null;
		const donePromise = new Promise(r => resolver = r);

		const updateUI = (dlg) => {
			const live = countNow();
			const root = document.getElementById(wrapId);
			if (!root) return;

			const rA = root.querySelector(".req-assets");
			const rG = root.querySelector(".req-gambits");

			if (rA) rA.classList.toggle("done", (needsAssets === 0) || (live.assets  >= needsAssets));
			if (rG) rG.classList.toggle("done", (needsGambits === 0) || (live.gambits >= needsGambits));

			const allDone =
			((needsAssets  === 0) || (live.assets  >= needsAssets)) &&
			((needsGambits === 0) || (live.gambits >= needsGambits)) &&
			((needsUpg     === 0) || true); // manual note for now

			const $dlg  = dlg?.element || $(".app.dialog");
			const $save = $dlg.find(".dialog-buttons .mg-lvl-save");
			$save.prop("disabled", !allDone);

			if (allDone) resolver?.(true);
		};

		const hookId = Hooks.on("createItem", (item) => {
			if (item?.parent?.id !== this.actor.id) return;
			if (!document.getElementById(wrapId)) return;
			updateUI(dlgRef);
		});

		const dlgRef = new Dialog({
			title: `Crew Level-Up: Tier ${nextTier}`,
			content,
			buttons: {
				save: {
				label: "Finish Level",
				icon: '<i class="fa-solid fa-flag-checkered"></i>',
				cssClass: "mg-lvl-save",
				callback: () => true
				},


				cancel: {
					label: "Cancel (Undo Changes)",
					icon: '<i class="fa-regular fa-circle-xmark"></i>',
					callback: async () => { await this._undoLastCrewLevel(); return false; }
				}
			},
			default: "save",
			close: async () => { try { Hooks.off("createItem", hookId); } catch {} }
		}, { classes: ["midnight-gambit","dialog","mg-level-dialog"], width: 520 });

		dlgRef.render(true);
		setTimeout(() => {
			dlgRef.element.find(".mg-lvl-save").prop("disabled", true);
			updateUI(dlgRef);
		}, 30);

		try { await Promise.race([donePromise, new Promise(r => setTimeout(r, 10*60*1000))]); } catch {}
	}

	/** Revert the last level operation:
	 *  - Restore previous tier and hand size
	 *  - Remove any items created during the level dialog
	 *  - Clear the undo flag
	 */
	async _undoLastCrewLevel() {
		const hist = await this._getLevelHistory();
		if (!hist.length) {
			ui.notifications?.warn("No level history found to undo.");
			return;
		}

		const snap = hist.pop();
		await this._setLevelHistory(hist);
		await this._restoreFromSnapshot(snap);

		// NEW: prune baselines above the restored tier
		const cur = this._readCrewTier();
		await this._pruneBaselinesAbove(cur);

		this.render(false);
		ui.notifications?.info("Undid the last crew level.");
	}


	/** Roll back to the earliest snapshot (or hard reset if none), Tier 1 + hand 3. */
	async _undoToTierOne() {
		let hist = await this._getLevelHistory();
		if (hist.length) {
			// Restore the earliest snapshot (first level taken)
			const first = hist[0];
			await this._restoreFromSnapshot(first);
			hist = []; // clear history after hard reset to base
			await this._setLevelHistory(hist);
		} else {
			// No history yet → just hard set to base
			await this._writeCrewTier(1, 3);
			// Optional: you can also wipe gambits/assets here if you want a true blank slate.
		}

		// Clear all completion flags
		await this.actor.setFlag("midnight-gambit", "crewLevelComplete", { "1": true });
		await this._setTierBaselines({});

	this.render(false);
		ui.notifications?.info("Crew reset to Tier 1 (base).");
	}

	/** Compute current level-pending status + remaining requirements. */
	async _computeLevelPending() {
		const tier = this._readCrewTier();
		const rewards = this._rewardsForTier(tier);

		const needA = Number(rewards.assets  || 0);
		const needG = Number(rewards.gambits || 0);
		const needU = Number(rewards.hideoutUp || 0);
		const hasReqs = (needA + needG + needU) > 0;

		if (!hasReqs) return { pending:false, needA:0, needG:0, needU:0 };

		const baselines = await this._getTierBaselines();
		const base = baselines[String(tier)] || { itemIds: [], need: rewards };
		const existing = new Set(base.itemIds);

		// Count items created since entering this tier
		const newItems = this.actor.items.filter(i => !existing.has(i.id));
		const gotA = newItems.filter(i => i.type === "asset").length;
		const gotG = newItems.filter(i => i.type === "gambit").length;

		const needAssets  = Number(base.need?.assets  ?? needA);
		const needGambits = Number(base.need?.gambits ?? needG);
		const pending = (gotA < needAssets) || (gotG < needGambits);

		return {
			pending,
			needA: Math.max(0, needAssets  - gotA),
			needG: Math.max(0, needGambits - gotG),
			needU // informational only right now
		};
	}

	/** -----------------------
	 *  Level History Utilities
	 *  -----------------------
	 *  We keep a stack of snapshots so you can undo repeatedly or jump to Tier 1.
	 *  Each snapshot is taken BEFORE we apply a level. It stores:
	 *    - tierBefore, handBefore
	 *    - itemIds (to detect items created after this point)
	 *    - ts (timestamp), note (optional)
	 */
	async _getLevelHistory() {
		const arr = this.actor.getFlag("midnight-gambit", "crewLevelHistory");
		return Array.isArray(arr) ? arr.slice() : [];
	}

	async _setLevelHistory(arr) {
		await this.actor.setFlag("midnight-gambit", "crewLevelHistory", Array.isArray(arr) ? arr : []);
	}

	async _pushUndoSnapshot(note = "") {
		const tierBefore = this._readCrewTier();
		const handBefore = Number(this.actor.system?.gambits?.handSize ?? 3) || 3;
		const itemIds    = this.actor.items.map(i => i.id);

		const hist = await this._getLevelHistory();
		hist.push({ tierBefore, handBefore, itemIds, ts: Date.now(), note });
		await this._setLevelHistory(hist);
		return hist.length;
	}

	/** Restore a snapshot (core fields + delete any items created after it). */
	async _restoreFromSnapshot(snap) {
		if (!snap) return false;

		// Restore core values (no re-render)
		const tier = Number(snap.tierBefore) || 1;
		const hand = Number(snap.handBefore) || 3;
		await this._writeCrewTier(tier, hand);

		// Remove items that were created after the snapshot (best-effort)
		const idsNow   = this.actor.items.map(i => i.id);
		const toRemove = idsNow.filter(id => !snap.itemIds.includes(id));
		if (toRemove.length) {
			try { await this.actor.deleteEmbeddedDocuments("Item", toRemove, { render: false }); }
			catch (e) { console.warn("MG | history restore: delete created items failed", e); }
		}

		// Keep baselines consistent (anything above the restored tier is stale)
		await this._pruneBaselinesAbove(tier);

		return true;
	}


	/** Read-only checklist for the CURRENT tier's pending requirements.
 *  - Does NOT change tier, hand size, baselines, or history.
 *  - Live-updates checkmarks while the dialog is open (on createItem).
	*/
	async _openCrewReviewDialog() {
		const tier     = this._readCrewTier();
		const rewards  = this._rewardsForTier(tier);
		const needA    = Number(rewards.assets || 0);
		const needG    = Number(rewards.gambits || 0);
		const needU    = Number(rewards.hideoutUp || 0);
		const hasReqs  = (needA + needG + needU) > 0;

		// If nothing is required at this tier, just inform and bail.
		if (!hasReqs) {
			ui.notifications?.info(`Tier ${tier} has no outstanding requirements.`);
			return;
		}

		// Get (or synthesize) the baseline used for pending logic
		const baselines = await this._getTierBaselines();
		const base      = baselines[String(tier)] || { itemIds: [], need: rewards };
		const baselineSet = new Set(base.itemIds);

		// Live counters based on items created since entering this tier
		const countNow = () => {
			const newItems = this.actor.items.filter(i => !baselineSet.has(i.id));
			const haveA = newItems.filter(i => i.type === "asset").length;
			const haveG = newItems.filter(i => i.type === "gambit").length;
			return { haveA, haveG };
		};

		const wrapId = `review-${randomID()}`;
		const fmt = (n, w) => n === 1 ? `1 ${w}` : `${n} ${w}s`;

		const content = `
			<style>
			.mg-review { line-height:1.4; }
			.mg-review .req { display:flex; gap:.5rem; align-items:center; margin:.25rem 0; }
			.mg-review .req .ok { color:var(--color-text-success,#47c972); display:none; }
			.mg-review .req.done .ok { display:inline; }
			.mg-review .hint { opacity:.8; font-size:.95em; margin:.25rem 0 .5rem; }
			.mg-review .counts { margin-top:.5rem; font-size:.95em; opacity:.9; }
			</style>
			<div id="${wrapId}" class="mg-review">
			<p><strong>Tier ${tier} requirements</strong></p>
			<p class="hint">Drag the required items onto the Crew sheet. This checklist updates automatically.</p>
			<div class="req req-assets" data-need="${needA}">
				<i class="fa-regular fa-box"></i>
				<span>${needA ? `Add ${fmt(needA, "Asset")} (<span class="countA">0</span>/${needA})` : "No Assets at this tier"}</span>
				<i class="ok fa-solid fa-check"></i>
			</div>
			<div class="req req-gambits" data-need="${needG}">
				<i class="fa-solid fa-cards"></i>
				<span>${needG ? `Add ${fmt(needG, "Crew Gambit")} (<span class="countG">0</span>/${needG})` : "No Gambits at this tier"}</span>
				<i class="ok fa-solid fa-check"></i>
			</div>
			<div class="req req-upg ${needU ? "" : "done"}" data-need="${needU}">
				<i class="fa-regular fa-warehouse"></i>
				<span>${needU ? `Apply ${fmt(needU, "Hideout Upgrade")} (note it manually)` : `No Hideout upgrade at this tier`}</span>
				<i class="ok fa-solid fa-check"></i>
			</div>
			</div>
		`;

		const updateUI = (dlg) => {
			const { haveA, haveG } = countNow();
			const root = document.getElementById(wrapId);
			if (!root) return;

			const needAssets  = Number(root.querySelector(".req-assets")?.dataset.need || 0);
			const needGambits = Number(root.querySelector(".req-gambits")?.dataset.need || 0);

			if (root.querySelector(".countA")) root.querySelector(".countA").textContent = String(Math.min(haveA, needAssets));
			if (root.querySelector(".countG")) root.querySelector(".countG").textContent = String(Math.min(haveG, needGambits));


			// No enable/disable of buttons; this is purely a reminder dialog.
		};

		const hookId = Hooks.on("createItem", (item) => {
			if (item?.parent?.id !== this.actor.id) return;
			if (!document.getElementById(wrapId)) return;
			updateUI(dlgRef);
		});

		const dlgRef = new Dialog({
			title: `Crew Level Review: Tier ${tier}`,
			content,
			buttons: {
			close: {
				label: "Close",
				icon: '<i class="fa-regular fa-circle-xmark"></i>',
				callback: () => true
			}
			},
			default: "close",
			close: async () => { try { Hooks.off("createItem", hookId); } catch {} }
		}, { classes: ["midnight-gambit","dialog","mg-review-dialog"], width: 520 });

		dlgRef.render(true);
		setTimeout(() => updateUI(dlgRef), 30);
	}

	/** One-time fix: if actor.img looks like "systems/<id>/<file>" (no assets/),
	 *  rewrite it to "systems/<id>/assets/images/<file>".
	 */
	async _sanitizeActorImgOnce() {
	const img = String(this.actor.img || "");
	const sysId = game.system.id;

	// Match "systems/<sysId>/<basename.ext>" with no further slashes
	const m = img.match(new RegExp(`^systems/${sysId}/([^/]+\\.[a-z0-9]+)$`, "i"));
	if (!m) return;

	const file = m[1];
	const fixed = `systems/${sysId}/assets/images/${file}`;
	if (fixed !== img) {
		try {
		await this.actor.update({ img: fixed }, { render: false });
		// live-patch the directory entry too
		const url = foundry.utils.getRoute(fixed);
		this._refreshDirectoryThumb(url);
		// and any local preview on the sheet
		this.element.find(".mg-diricon-preview img").attr("src", url);
		} catch (e) {
		console.warn("MG | _sanitizeActorImgOnce failed", e);
		}
	}
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
			ui.notifications?.warn("Only Gambit items can be added to the Deck.");
			return;
		}

		// Hand-size cap with confirm override
		const g = this.actor.system?.gambits ?? {};
		const handSize  = Number(g.handSize ?? 3) || 3;
		const currentCt = Array.isArray(g.deck) ? g.deck.length : 0;

		if (currentCt >= handSize) {
			const ok = await Dialog.confirm({
			title: "Over Hand Limit?",
			content: `
				<p>You're going over your max available Crew Gambits for this level
				(<strong>${currentCt}/${handSize}</strong>).</p>
				<p><em>Only add this if your Director approves!</em></p>
			`,
			defaultYes: false,
			yes: () => true, no: () => false
			});
			if (!ok) return;
		}

		const obj = item instanceof Item ? item.toObject() : item;
		delete obj._id;

		const [created] = await this.actor.createEmbeddedDocuments("Item", [obj]);
		const g2 = foundry.utils.deepClone(this.actor.system.gambits);
		g2.deck = Array.isArray(g2.deck) ? g2.deck.slice() : [];
		g2.deck.push(created.id);
		await this.actor.update({ "system.gambits.deck": g2.deck });
		});
	}
	}

    /* Bio tab bindings
    ----------------------------------------------------------------------*/
	_bindBioTab(html) {
	const root = html.find(".mg-crew-bio");
	if (!root.length) return;

	// --- Tags (Enter/comma add; dialog for desc; dedupe; instant DOM)
	{
	const input = root.find(".bio-add-tag")[0];
	const list  = root.find(".bio-tags .tag-list")[0];

	// Re-entrancy lock so we never open two prompts at the same time
	this._bioTagPromptOpen ??= false;

	// Read + coerce legacy string tags → objects
	const readTags = () => {
		const raw = this.actor.system?.bio?.tags ?? [];
		return Array.from(raw).map(t => (typeof t === "string" ? { label: t, desc: "" } : t));
	};

	const normalize = (s) => {
		const v = String(s).trim();
		if (!v) return "";
		return v.split(/\s+/).map(p => p[0] ? p[0].toUpperCase() + p.slice(1) : p).join(" ");
	};

	const esc = foundry.utils.htmlEscape
		? foundry.utils.htmlEscape
		: (str) => String(str)
			.replace(/&/g,"&amp;").replace(/</g,"&lt;")
			.replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");

	const addOne = async (raw) => {
		const label = normalize(raw);
		if (!label) return;

		// Current tags (objects)
		const tags = readTags();

		// Dedupe by label (case-insensitive)
		const exists = tags.some(x => x.label?.toLowerCase() === label.toLowerCase());
		if (exists) {
		ui.notifications?.info(`Tag “${label}” already exists.`);
		return;
		}

		// Optional cap
		if (tags.length >= 24) {
		ui.notifications?.warn("Tag limit reached (24).");
		return;
		}

		// Guard: if another prompt is open, ignore this request
		if (this._bioTagPromptOpen) return;
		this._bioTagPromptOpen = true;

		let desc = "";
		try {
		desc = await Dialog.prompt({
			title: "Add Tag Description",
			content: `<p>Describe “${esc(label)}”:</p><textarea rows="3" style="width:100%"></textarea>`,
			label: "Save",
			// html is jQuery in v11 — use [0] or .find()
			callback: (html) => (html?.[0]?.querySelector("textarea")?.value || "").trim()
		}) || "";
		} finally {
		this._bioTagPromptOpen = false;
		}

		const newTag = { label, desc };
		tags.push(newTag);

		// Persist (no full render)
		await this.actor.update({ "system.bio.tags": tags }, { render: false });

		// Optimistic DOM append (matches template classes exactly)
		if (list) {
		const pill = document.createElement("div");
		pill.className = "tag-pill tag is-entering";
		pill.setAttribute("role", "listitem");
		pill.title = newTag.desc || "";
		pill.dataset.label = label.toLowerCase();
		pill.innerHTML = `
			<span class="label">${esc(newTag.label)}</span>
			<button type="button" class="remove" title="Remove tag ${esc(newTag.label)}" aria-label="Remove tag ${esc(newTag.label)}">
			<i class="fa-light fa-xmark"></i>
			</button>
		`;
		list.appendChild(pill);
		requestAnimationFrame(() => pill.classList.remove("is-entering"));
		}
	};

	// De-duped, namespaced bindings (no stacking across re-renders)
	// Add on Enter or comma; also support paste of comma-separated on blur
	root.off("keydown.mgBioAdd").on("keydown.mgBioAdd", ".bio-add-tag", async (ev) => {
		if (ev.key !== "Enter" && ev.key !== ",") return;
		ev.preventDefault(); ev.stopPropagation();

		const el = ev.currentTarget;
		const raw = el.value.replace(/,+$/, "");
		if (!raw.trim()) return;

		for (const part of raw.split(",").map(s => s.trim()).filter(Boolean)) {
		await addOne(part);
		}
		el.value = "";
	});

	root.off("blur.mgBioAdd").on("blur.mgBioAdd", ".bio-add-tag", async (ev) => {
		const el = ev.currentTarget;
		const raw = el.value.replace(/,+$/, "");
		if (!raw.trim()) return;

		for (const part of raw.split(",").map(s => s.trim()).filter(Boolean)) {
		await addOne(part);
		}
		el.value = "";
	});

	// Remove by label (robust if order changed)
	root.off("click.mgBioTagRemove")
		.on("click.mgBioTagRemove", ".bio-tags .tag-pill .remove", async (ev) => {
			ev.preventDefault();
			const pill  = ev.currentTarget.closest(".tag-pill");
			if (!pill) return;

			const label = pill.querySelector(".label")?.textContent ?? "";
			const tags  = readTags();
			const idx   = tags.findIndex(x => x.label?.toLowerCase() === label.toLowerCase());
			if (idx < 0) return;

			pill.classList.add("is-leaving");

			tags.splice(idx, 1);
			await this.actor.update({ "system.bio.tags": tags }, { render: false });

			setTimeout(() => pill.remove(), 240);
		});
	}

	// --- Edit an existing tag (click the pill or label; NOT the remove button)
	{
		const esc = foundry.utils.htmlEscape
			? foundry.utils.htmlEscape
			: (str) => String(str)
				.replace(/&/g,"&amp;").replace(/</g,"&lt;")
				.replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");

		const readTags = () => {
			const raw = this.actor.system?.bio?.tags ?? [];
			return Array.from(raw).map(t => (typeof t === "string" ? { label: t, desc: "" } : t));
		};

		const normalize = (s) => {
			const v = String(s).trim();
			if (!v) return "";
			return v.split(/\s+/).map(p => p[0] ? p[0].toUpperCase() + p.slice(1) : p).join(" ");
		};

		// Namespaced binding; don’t stack on re-render
		root.off("click.mgBioTagEdit")
			.on("click.mgBioTagEdit", ".bio-tags .tag-pill", async (ev) => {
			// Ignore clicks on the remove button
			if (ev.target.closest?.(".remove")) return;

			const pill  = ev.currentTarget;
			const labelEl = pill.querySelector(".label");
			if (!labelEl) return;

			// Find the tag by label (case-insensitive)
			const oldLabel = labelEl.textContent ?? "";
			const tags = readTags();
			const idx  = tags.findIndex(x => x.label?.toLowerCase() === oldLabel.toLowerCase());
			if (idx < 0) return;

			const curr = tags[idx];
			const dlgHtml = `
				<style>
				.mg-edit-tag form { display: grid; gap: .5rem; }
				.mg-edit-tag label { font-weight: 600; }
				.mg-edit-tag input, .mg-edit-tag textarea {
					width: 100%; box-sizing: border-box; padding: .5rem .6rem;
				}
				</style>
				<div class="mg-edit-tag">
				<form>
					<label>Label</label>
					<input type="text" name="label" value="${esc(curr.label)}" />
					<label>Description</label>
					<textarea name="desc" rows="3">${esc(curr.desc || "")}</textarea>
				</form>
				</div>
			`;

			// Prevent double-open
			if (this._bioTagPromptOpen) return;
			this._bioTagPromptOpen = true;

			let result;
			try {
				result = await Dialog.prompt({
				title: `Edit Tag`,
				content: dlgHtml,
				label: "Save",
				callback: (html) => {
					const root = html?.[0];
					const newLabel = normalize(root?.querySelector('input[name="label"]')?.value || "");
					const newDesc  = (root?.querySelector('textarea[name="desc"]')?.value || "").trim();
					return { newLabel, newDesc };
				}
				});
			} finally {
				this._bioTagPromptOpen = false;
			}
			if (!result) return;

			const { newLabel, newDesc } = result;
			if (!newLabel) {
				ui.notifications?.warn("Tag label cannot be empty.");
				return;
			}

			// If label changed, dedupe against others (ignore the current index)
			const exists = tags.some((t, i) => i !== idx && t.label?.toLowerCase() === newLabel.toLowerCase());
			if (exists) {
				ui.notifications?.warn(`Another tag named “${newLabel}” already exists.`);
				return;
			}

			// Apply changes
			const updated = [...tags];
			updated[idx] = { label: newLabel, desc: newDesc || "" };

			await this.actor.update({ "system.bio.tags": updated }, { render: false });

			// Update the pill DOM in place (no full render)
			labelEl.textContent = newLabel;
			pill.title = newDesc || "";
			pill.dataset.label = newLabel.toLowerCase();
			});
		}
	}

	/** Normalize a picker-entered path to a VFS path we can safely save to actor.img.
	 *  Rules:
	 *   - Keep http(s) and data: as-is
	 *   - Strip a single leading "/" (FVTT VFS is relative)
	 *   - If it starts with known roots (systems/modules/worlds/icons/ui) -> keep as-is
	 *   - If it starts with "assets/" -> anchor to this system
	 *   - If it's a bare filename (no "/") -> assume assets/images/<file> in this system
	 *   - Otherwise treat as system-relative (e.g. "assets/images/foo.png")
	 */
	_vfsPathForStorage(url) {
		if (!url) return "";
		let u = String(url).trim().replace(/\\/g, "/");

		// External or data URIs: keep as-is
		if (/^(?:https?:|data:)/i.test(u)) return u;

		// Drop leading slash so it's a VFS-relative path
		if (u.startsWith("/")) u = u.replace(/^\/+/, "");

		// Known roots are fine as-is
		if (/^(systems|modules|worlds|icons|ui)\b/i.test(u)) return u;

		// If it begins with "assets/", anchor to this system
		if (/^assets\//i.test(u)) return `systems/${game.system.id}/${u}`;

		// If it's a bare filename (no slash), assume assets/images/<file> in this system
		if (!u.includes("/")) return `systems/${game.system.id}/assets/images/${u}`;

		// Otherwise treat as system-relative (e.g., "assets/images/foo.png")
		u = u.replace(/^\.\//, "");
		return `systems/${game.system.id}/${u}`;
	}


}