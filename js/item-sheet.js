export class MidnightGambitItemSheet extends ItemSheet {
	static get defaultOptions() {
		return mergeObject(super.defaultOptions, {
			classes: ["midnight-gambit", "sheet", "item"],
			width: 700,
			height: 700,
			resizable: true,

			// Do not auto-save/re-render while typing.
			submitOnChange: false,
			submitOnClose: true,
			closeOnSubmit: false
		});
	}

	_getHeaderButtons() {
		const buttons = super._getHeaderButtons?.() ?? [];

		buttons.unshift({
			label: "Save",
			class: "mg-save-item",
			icon: "fa-solid fa-floppy-disk",
			onclick: async () => {
				await this.submit({ preventClose: true });
				ui.notifications?.info(`${this.item.name} saved.`);
			}
		});

		const canPromote =
			this.item?.isEmbedded &&
			this.item?.parent?.documentName === "Actor" &&
			["weapon", "armor", "misc", "gambit", "asset"].includes(this.item.type);

		if (canPromote) {
			buttons.unshift({
				label: "Make Global",
				class: "mg-make-global",
				icon: "fa-solid fa-globe",
				onclick: async () => {
					await this._mgMakeItemGlobal();
				}
			});
		}

		return buttons;
	}

	async _mgMakeItemGlobal() {
		const sourceItem = this.item;
		if (!sourceItem?.isEmbedded) {
			ui.notifications?.info("This item is already global.");
			return;
		}

		const parentActor = sourceItem.parent;
		const itemData = sourceItem.toObject();

		// Remove embedded-only ID so Foundry gives the global copy a fresh ID.
		delete itemData._id;

		// Optional: mark where it came from.
		itemData.flags ??= {};
		itemData.flags["midnight-gambit"] ??= {};
		itemData.flags["midnight-gambit"].promotedFrom = {
			actorId: parentActor?.id ?? null,
			actorName: parentActor?.name ?? "",
			itemId: sourceItem.id,
			itemName: sourceItem.name,
			at: Date.now()
		};

		const confirm = await Dialog.confirm({
			title: "Make Global Item?",
			content: `
				<p>Create a reusable global copy of <strong>${sourceItem.name}</strong> in the Items directory?</p>
				<p>The inventory copy will stay on <strong>${parentActor?.name ?? "this actor"}</strong>.</p>
			`,
			defaultYes: true
		});

		if (!confirm) return;

		// GM can create the world item directly.
		if (game.user.isGM) {
			const created = await Item.create(itemData, { renderSheet: true });
			ui.notifications?.info(`Created global item: ${created.name}`);
			return;
		}

		// Player route: ask an active GM client to create it.
		const activeGM = game.users.find(u => u.active && u.isGM);
		if (!activeGM) {
			ui.notifications?.warn("A GM must be online to make this item global.");
			return;
		}

		game.socket.emit("system.midnight-gambit", {
			type: "makeGlobalItem",
			requestingUserId: game.user.id,
			itemData
		});

		ui.notifications?.info(`Asked the GM to make "${sourceItem.name}" global.`);
	}

	_mgRefreshParentActorSheet() {
		const parentActor = this.item?.parent;
		if (parentActor?.documentName !== "Actor") return;

		for (const app of Object.values(parentActor.apps ?? {})) {
			app?.render?.(false);
		}
	}

	async _updateObject(event, formData) {
		// Asset tag CSV conversion
		if (
			this.item?.type === "asset" &&
			Object.prototype.hasOwnProperty.call(formData, "system.tagsCsv")
		) {
			const csv = String(formData["system.tagsCsv"] ?? "").trim();
			const tags = csv
				? csv.split(",").map(t => t.trim()).filter(Boolean)
				: [];

			formData["system.tags"] = tags;
			delete formData["system.tagsCsv"];
		}

		// Normalize split strain fields for weapons and misc.
		if (["weapon", "misc"].includes(this.item?.type)) {
			const mortal = Number(
				formData["system.mortalStrainDamage"] ??
				this.item.system?.mortalStrainDamage ??
				this.item.system?.strainDamage ??
				0
			);

			const soul = Number(
				formData["system.soulStrainDamage"] ??
				this.item.system?.soulStrainDamage ??
				0
			);

			const nextMortal = Number.isFinite(mortal) ? mortal : 0;
			const nextSoul = Number.isFinite(soul) ? soul : 0;

			formData["system.mortalStrainDamage"] = nextMortal;
			formData["system.soulStrainDamage"] = nextSoul;

			// Legacy fallback while old card/chat code still exists.
			formData["system.strainDamage"] = nextMortal;
		}

		// Normalize capacity for armor and misc.
		if (["armor", "misc"].includes(this.item?.type)) {
			const oldMortalMax = Number(this.item.system?.mortalCapacity ?? 0);
			const oldSoulMax = Number(this.item.system?.soulCapacity ?? 0);

			const nextMortalMaxRaw =
				formData["system.mortalCapacity"] ??
				this.item.system?.mortalCapacity ??
				0;

			const nextSoulMaxRaw =
				formData["system.soulCapacity"] ??
				this.item.system?.soulCapacity ??
				0;

			const nextMortalMax = Number(nextMortalMaxRaw);
			const nextSoulMax = Number(nextSoulMaxRaw);

			const safeMortalMax = Number.isFinite(nextMortalMax) ? nextMortalMax : 0;
			const safeSoulMax = Number.isFinite(nextSoulMax) ? nextSoulMax : 0;

			const oldRemainingMortal = Number(
				this.item.system?.remainingCapacity?.mortal ?? oldMortalMax
			);

			const oldRemainingSoul = Number(
				this.item.system?.remainingCapacity?.soul ?? oldSoulMax
			);

			// If the item was undamaged, or if it was born at 0/0, carry remaining up to the new max.
			const mortalWasUndamaged =
				oldMortalMax === 0 ||
				oldRemainingMortal >= oldMortalMax;

			const soulWasUndamaged =
				oldSoulMax === 0 ||
				oldRemainingSoul >= oldSoulMax;

			formData["system.mortalCapacity"] = safeMortalMax;
			formData["system.soulCapacity"] = safeSoulMax;

			formData["system.remainingCapacity.mortal"] = mortalWasUndamaged
				? safeMortalMax
				: Math.min(oldRemainingMortal, safeMortalMax);

			formData["system.remainingCapacity.soul"] = soulWasUndamaged
				? safeSoulMax
				: Math.min(oldRemainingSoul, safeSoulMax);
		}

		await super._updateObject(event, formData);
		this._mgRefreshParentActorSheet();
	}

	// One source of truth for template selection
	get template() {
		const base = "systems/midnight-gambit/templates/items";
		switch (this.item?.type) {
			case "asset": return `${base}/asset-sheet.html`;
			default:      return `${base}/item-sheet.html`;
		}
	}

	// Keep this async getData – it builds the rich context you need
	async getData(options) {
		const context = await super.getData(options);
		context.item = this.item;
		context.system = this.item.system ?? {};
		context.itemType = this.item.type;
		
		context.owner = this.item.isOwner;
		context.editable = this.isEditable;

			// Initialize remainingCapacity for armor once
			if (context.itemType === "armor") {
			context.system.remainingCapacity ??= {
				mortal: context.system.mortalCapacity ?? 0,
				soul: context.system.soulCapacity ?? 0
			};
			if (!this.item.system.remainingCapacity) {
				await this.item.update({
				"system.remainingCapacity": {
					mortal: context.system.mortalCapacity ?? 0,
					soul: context.system.soulCapacity ?? 0
				}
				});
			}
		}

		// ---- Weapon strainDamage migration (legacy -> mortal/soul) ----
		if (context.itemType === "weapon") {
			const sys = context.system ?? {};

			const hasNew =
				sys.mortalStrainDamage !== undefined ||
				sys.soulStrainDamage !== undefined;

			const hasLegacy = sys.strainDamage !== undefined && sys.strainDamage !== null;

			if (!hasNew && hasLegacy) {
				const legacy = Number(sys.strainDamage) || 0;

				// Update once on open: legacy strainDamage becomes Mortal strain by default
				context.system.mortalStrainDamage = legacy;
				context.system.soulStrainDamage = 0;

				// Persist it (don’t delete legacy yet; safe deprecation)
				if (this.item?.isOwner) {
				await this.item.update({
					"system.mortalStrainDamage": legacy,
					"system.soulStrainDamage": 0
				});
				}
			} else {
				// Ensure defaults exist for rendering
				context.system.mortalStrainDamage ??= 0;
				context.system.soulStrainDamage ??= 0;
			}
		}

		// Load global tags (type-aware, with dynamic fallback)
		let globalTags;
			if (this.item.type === "asset") {
			globalTags = CONFIG.MidnightGambit?.ASSET_TAGS;
			if (!globalTags || globalTags.length === 0) {
				try {
				const mod = await import("../config.js");
				globalTags = mod.ASSET_TAGS ?? [];
				} catch (e) {
				console.warn("Failed to load ASSET_TAGS dynamically in item-sheet.js", e);
				globalTags = [];
				}
			}
			} else {
			globalTags = CONFIG.MidnightGambit?.ITEM_TAGS;
			if (!globalTags || globalTags.length === 0) {
				try {
				const mod = await import("../config.js");
				globalTags = mod.ITEM_TAGS ?? [];
				} catch (e) {
				console.warn("Failed to load ITEM_TAGS dynamically in item-sheet.js", e);
				globalTags = [];
				}
			}
		}

		// --- Tag list with flags (global custom vs local-only custom) ---
		const isAsset     = this.item.type === "asset";
		const settingKey  = isAsset ? "assetCustomTags" : "customTags";

		// 1) Which global customs exist in the world registry?
		const storedCustom = game.settings.get("midnight-gambit", settingKey) || [];
		const globalCustomIds = new Set(storedCustom.map(t => t.id));

		// 2) Flag the library list you already loaded as global or not
		const flaggedGlobal = (globalTags || []).map(t => {
		const isGlobalCustom = globalCustomIds.has(t.id);
		return { ...t, isCustom: isGlobalCustom, isGlobal: isGlobalCustom };
		});

		// 3) Add item-local customs that aren’t in the library
		const localEntries = Object.entries(context.system.customTags || {});
		const globalIds    = new Set(flaggedGlobal.map(t => t.id));
		const localOnly    = localEntries
		.filter(([id]) => !globalIds.has(id))
		.map(([id, description]) => ({
			id,
			label: id.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
			description,
			isCustom: true,
			isGlobal: false
		}));

		// 4) Expose to the template
		context.customTags = localEntries.map(([id]) => id);
		context.tags       = [...flaggedGlobal, ...localOnly];
		context.tagsMap    = Object.fromEntries(context.tags.map(tag => [tag.id, tag]));

		// Cache tag metadata on the sheet instance for live UI updates
		this._tagsMap = context.tagsMap;

		return context;
	}

	activateListeners(html) {
		super.activateListeners(html);

		// Toggle tag on the item without re-rendering, and live-update both the
		// top tag buttons and the bottom “selected tags” row.
		html.off("click.mgTag", ".tag-pill").on("click.mgTag", ".tag-pill", async (ev) => {
		ev.preventDefault();
		ev.stopPropagation();

		const pill  = ev.currentTarget;
		const tagId = pill.dataset.tagId;
		if (!tagId) return;

		// --- 1) Toggle in the document data ---------------------------------
		const currentTags = Array.isArray(this.item.system?.tags)
			? [...this.item.system.tags]
			: [];
		const set = new Set(currentTags);

		if (set.has(tagId)) {
			set.delete(tagId);
		} else {
			set.add(tagId);
		}

		// Persist tags to the Item document but DO NOT re-render the sheet
		await this.item.update(
			{ "system.tags": Array.from(set) },
			{ render: false }
		);

		// --- 2) Update the top tag button states ----------------------------
		const has = set.has.bind(set);
		html.find(".tag-pill").each((_, el) => {
			const id = el.dataset.tagId;
			if (!id) return;
			const on = has(id);
			el.classList.toggle("selected", on);
			el.classList.toggle("active",   on); // if you also use .active in your CSS
		});

		// --- 3) Live-update the bottom tag grid without touching the
		//         "+ ADD CUSTOM TAG" button, and without duplication ----------
		const root    = html[0];
		const tagsMap = this._tagsMap || {};

		// We assume your bottom layout is something like:
		// <div class="...">
		//   <span class="item-tag tag" data-tag-id="notorious">Notorious</span>
		//   ...
		//   <button class="add-custom-tag">+ ADD CUSTOM TAG</button>
		// </div>
		//
		// The button is our anchor; its parent is the wrapper for both pills + button.
		const addBtn = root.querySelector(".add-custom-tag");
		if (!addBtn) return;

		const wrapper = addBtn.parentElement;
		if (!wrapper) return;

		// Hide the original static tags (first render) but keep them in DOM
		// so your template structure is intact until a full refresh.
		wrapper
			.querySelectorAll(".item-tag.tag:not(.mg-live-tag)")
			.forEach((el) => {
			el.style.display = "none";
			});

		// Remove any previously generated live pills
		wrapper.querySelectorAll(".mg-live-tag").forEach((el) => el.remove());

		// Build a fresh live list for the current tag set
		for (const id of set) {
			const meta = tagsMap[id] || { label: id };

			const livePill = document.createElement("span");
			// Use your styling classes + a marker for future cleanup
			livePill.className     = "item-tag tag mg-live-tag";
			livePill.dataset.tagId = id;
			livePill.textContent   = meta.label || id;

			// Insert each live pill before the "+ ADD CUSTOM TAG" button
			wrapper.insertBefore(livePill, addBtn);
		}
		});


		// Add custom tag
		html.find(".add-custom-tag").on("click", async () => {
		const tagHtml = `
			<div>
			<label>Tag Name</label>
			<input type="text" name="customTagName" placeholder="e.g. Brutal" />
			</div>
			<div>
			<label>Tag Description</label>
			<textarea name="customTagDescription" placeholder="What does this tag do?" rows="3" style="width:100%;"></textarea>
			</div>
		`;
		const tagResult = await Dialog.prompt({
			title: "Add Custom Tag",
			content: tagHtml,
			callback: html => {
			const name = html.find('[name="customTagName"]').val()?.trim();
			const description = html.find('[name="customTagDescription"]').val()?.trim();
			return name ? { name, description } : null;
			},
			rejectClose: false
		});
		if (!tagResult) return;

		const newTag = {
			id: tagResult.name.toLowerCase().replace(/\s+/g, "-"),
			label: tagResult.name,
			description: tagResult.description || "",
			isCustom: true
		};

		const isAsset = this.item.type === "asset";
		const settingKey = isAsset ? "assetCustomTags" : "customTags";
		const configKey  = isAsset ? "ASSET_TAGS"      : "ITEM_TAGS";

		let library    = game.settings.get("midnight-gambit", settingKey) || [];
		const configList = CONFIG.MidnightGambit?.[configKey] || [];

		// Check against BOTH the merged CONFIG list (base + customs) and the stored world customs
		const existingIds = new Set([
		...configList.map(t => t.id),
		...library.map(t => t.id)
		]);

		if (existingIds.has(newTag.id)) {
		ui.notifications.warn(
			`The tag “${newTag.label}” already exists in the ${isAsset ? "Asset" : "Gear"} library.`
		);
		return;
		}

		library = [...library, newTag];
		await game.settings.set("midnight-gambit", settingKey, library);
		(CONFIG.MidnightGambit[configKey] ??= []).push({ ...newTag, isCustom: true, isGlobal: true });
		ui.notifications.info(`Added ${isAsset ? "Asset" : "Gear"} tag: ${newTag.label}`);


		const currentTags = [...(this.item.system.tags || [])];
		if (!currentTags.includes(newTag.id)) currentTags.push(newTag.id);

		await this.item.update({
			"system.tags": currentTags,
			"system.customTags": {
			...(this.item.system.customTags || {}),
			[newTag.id]: newTag.description
			}
		});

		this.render(false);
		});

		// Delete custom tag globally (library-aware: Assets vs Gear) + hard purge
		html.off("click.mgDel", ".delete-custom-tag").on("click.mgDel", ".delete-custom-tag", async (event) => {
		event.preventDefault();
		event.stopPropagation(); // ← prevent the underlying .tag-pill toggle from firing
		const tagId = event.currentTarget.dataset.tagId;
		if (!tagId) return;

		const isAsset    = this.item?.type === "asset";
		const listKey    = isAsset ? "ASSET_TAGS"      : "ITEM_TAGS";
		const settingKey = isAsset ? "assetCustomTags" : "customTags";

		// Is this a GLOBAL custom in the world registry?
		const stored = game.settings.get("midnight-gambit", settingKey) || [];
		const inWorldCustom = stored.some(t => t.id === tagId);

		// If not in the global library, treat as LOCAL-only and just remove from THIS item.
		if (!inWorldCustom) {
			const yes = await Dialog.confirm({
			title: `Remove Local Tag: ${tagId}`,
			content: `<p><strong>${tagId}</strong> isn’t in the ${isAsset ? "Asset" : "Gear"} library.<br>Remove it from this item only?</p>`,
			yes: () => true, no: () => false
			});
			if (!yes) return;

			const localSet = new Set(this.item.system?.tags || []);
			localSet.delete(tagId);
			const localCustom = { ...(this.item.system?.customTags || {}) };
			delete localCustom[tagId];

			await this.item.update({
			"system.tags": Array.from(localSet),
			"system.customTags": localCustom
			});

			this.render(false);
			return;
		}

		// Confirm global deletion + purge
		const confirmed = await Dialog.confirm({
			title: `Delete Tag Globally: ${tagId}`,
			content: `<p>This will remove <strong>${tagId}</strong> from the ${isAsset ? "Asset" : "Gear"} tag library and purge it from all matching items.</p>`,
			yes: () => true, no: () => false
		});
		if (!confirmed) return;

		// 1) Update world setting (persistent registry)
		const newStored = stored.filter(t => t.id !== tagId);
		await game.settings.set("midnight-gambit", settingKey, newStored);

		// 2) Update in-memory CONFIG registry (deep copy -> filter -> assign)
		const live = Array.from(CONFIG.MidnightGambit?.[listKey] || []);
		const kill = (t) => String(t.id || "").toLowerCase() !== String(tagId).toLowerCase();
		CONFIG.MidnightGambit[listKey] = live.filter(kill);

		// 3) Immediately strip from the CURRENT item (use -= deletion operator for object keys)
		{
			const lc = (s) => String(s ?? "").toLowerCase();

			// 3a) Remove from the tags array
			const tags = Array.from(this.item.system?.tags || []);
			const nextTags = tags.filter(t => lc(t) !== lc(tagId));

			// 3b) Remove matching keys from customTags using the deletion operator
			const ct = this.item.system?.customTags || {};
			const deletions = {};
			for (const k of Object.keys(ct)) {
				if (lc(k) === lc(tagId)) {
				deletions[`system.customTags.-=${k}`] = null;
				}
			}

			await this.item.update({
				"system.tags": nextTags,
				...deletions
			});
		}

		// Helper: only touch relevant item family
		const appliesTo = (doc) => isAsset ? (doc.type === "asset") : (doc.type !== "asset");

		// 4) Sweep world Items
		let worldUpdates = 0;
		for (const item of (game.items?.contents ?? [])) {
			if (!appliesTo(item)) continue;
			const tags = item.system?.tags || [];
			const custom = item.system?.customTags || {};
			if (!tags.includes(tagId) && !Object.prototype.hasOwnProperty.call(custom, tagId)) continue;

			const lc = (s) => String(s ?? "").toLowerCase();
			const prunedTags = tags.filter(t => lc(t) !== lc(tagId));

			// Build deletion ops for any matching customTags keys
			const deletions = {};
			for (const k of Object.keys(custom)) {
			if (lc(k) === lc(tagId)) deletions[`system.customTags.-=${k}`] = null;
			}

			await item.update({
			"system.tags": prunedTags,
			...deletions
			});
			worldUpdates++;
		}

		// 5) Sweep actor-embedded items
		let actorItemsUpdated = 0;
		for (const actor of (game.actors?.contents ?? [])) {
				const updates = [];
				for (const item of actor.items) {
				if (!appliesTo(item)) continue;
				const tags = item.system?.tags || [];
				const custom = item.system?.customTags || {};
				if (!tags.includes(tagId) && !Object.prototype.hasOwnProperty.call(custom, tagId)) continue;

				const lc = (s) => String(s ?? "").toLowerCase();
				const prunedTags = tags.filter(t => lc(t) !== lc(tagId));

				// Build deletion ops for any matching customTags keys
				const deletions = {};
				for (const k of Object.keys(custom)) {
				if (lc(k) === lc(tagId)) deletions[`system.customTags.-=${k}`] = null;
				}

				updates.push({
				_id: item.id,
				"system.tags": prunedTags,
				...deletions
				});
			}

			if (updates.length) {
			await actor.updateEmbeddedDocuments("Item", updates);
			actorItemsUpdated += updates.length;
			}
		}

			ui.notifications.info(
			`Deleted "${tagId}" from the ${isAsset ? "Asset" : "Gear"} library and purged it from ${worldUpdates} world item(s) and ${actorItemsUpdated} actor item(s).`
			);

			// Re-render this sheet and other open sheets of the same family
			this.render(false);
			this._rerenderOpenTagSheets(isAsset);
		});
		

		// Open item sheet from an inventory card
		html.find(".item-edit").on("click", async (event) => {
		event.preventDefault();
		event.stopPropagation();

		const itemId =
			event.currentTarget.dataset.itemId ||
			event.currentTarget.closest(".inventory-item")?.dataset?.itemId;

		if (!itemId) return;

		const item = this.actor.items.get(itemId);
		if (!item) {
			ui.notifications?.warn("Item not found.");
			return;
		}

		item.sheet?.render(true);
		});		
	}

	/**
	 * Rebuild the “selected tags” row under the grid WITHOUT
	 * touching the "+ ADD CUSTOM TAG" button.
	 *
	 * @param {jQuery} html        The sheet root
	 * @param {Set<string>} tagSet Current active tag IDs
	 */
	_refreshActiveTagList(html, tagSet) {
		const tagsMap = this._tagsMap || {};
		const root    = html instanceof jQuery ? html[0] : html;
		if (!root) return;

		// Wrapper that holds both the pills and the "+ ADD CUSTOM TAG" button
		const wrapper = root.querySelector(".tag-wrapper");
		if (!wrapper) {
		console.warn("Midnight Gambit | _refreshActiveTagList: no .tag-wrapper found");
		return;
		}

		// 1) Remove ONLY the previously rendered active-tag pills
		wrapper.querySelectorAll(".mg-active-tag-pill").forEach((el) => el.remove());

		// 2) Find the "+ ADD CUSTOM TAG" button so we can always keep it last
		const addBtn = wrapper.querySelector(".add-custom-tag");

		// 3) Rebuild pills from the current active tag set
		for (const id of tagSet) {
		const meta = tagsMap[id] || { label: id };

		const pill = document.createElement("span");
		pill.className     = "item-tag tag";
		pill.dataset.tagId = id;
		pill.textContent   = meta.label || id;

		// Insert pills BEFORE the add-custom-tag button, if present
		if (addBtn) {
			wrapper.insertBefore(pill, addBtn);
		} else {
			// Fallback: if somehow no button, just append
			wrapper.appendChild(pill);
		}
		}
	}


	/** Re-render all open item sheets of the relevant family so pills update without a full refresh */
	_rerenderOpenTagSheets(isAsset) {
	for (const app of Object.values(ui.windows)) {
		if (!app?.rendered) continue;
		// Repaint item sheets of the same family
		if (app instanceof ItemSheet) {
		const t = app.object?.type;
		if (isAsset ? (t === "asset") : (t !== "asset")) app.render(false);
		}
	}
	}

  /** Ensure inline TinyMCE saves don't close/reopen the item sheet */
  async _onSubmit(event, { updateData = null, preventClose = false } = {}) {
    event.preventDefault();
    return super._onSubmit(event, { updateData, preventClose: true });
  }
}