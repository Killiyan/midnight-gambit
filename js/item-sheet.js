export class MidnightGambitItemSheet extends ItemSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["midnight-gambit", "sheet", "item"],
      width: 500,
      height: 700,
      resizable: true
    });
  }

	async _updateObject(event, formData) {
	if (this.item?.type === "asset" && Object.prototype.hasOwnProperty.call(formData, "system.tagsCsv")) {
		const csv = String(formData["system.tagsCsv"] ?? "").trim();
		const tags = csv ? csv.split(",").map(t => t.trim()).filter(Boolean) : [];
		formData["system.tags"] = tags;
		delete formData["system.tagsCsv"];
	}
	return super._updateObject(event, formData);
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



	// Mount TinyMCE editors on description/notes fields in item sheets
	async _initRichEditors(html) {
		const $root = html instanceof jQuery ? html : $(html);

		// Clone global config and tweak per-field caps
		const mkCfg = (maxH = 360) => {
			const cfg = foundry.utils.deepClone(CONFIG.TinyMCE);
			cfg.max_height = maxH;
			cfg.min_height = cfg.min_height ?? 140;
			cfg.resize = false; // disable manual resize handles (clean UI)
			const extra = `
			body.mce-content-body {
				overflow-y: auto;
				overscroll-behavior: contain;
			}
			`;
			cfg.content_style = (cfg.content_style ? cfg.content_style + "\n" : "") + extra;
			return cfg;
		};

		// Description (all item types have system.description)
		const desc = $root.find("textarea[name='system.description']")[0];
		if (desc) {
			await TextEditor.create({
			target: desc,
			name: "system.description",
			content: desc.value ?? "",
			tinymce: mkCfg(440),
			height: null
			});
		}

		// Notes (currently used by Asset items)
		const notes = $root.find("textarea[name='system.notes']")[0];
		if (notes) {
			await TextEditor.create({
			target: notes,
			name: "system.notes",
			content: notes.value ?? "",
			tinymce: mkCfg(320),
			height: null
			});
		}
	}


	activateListeners(html) {
		super.activateListeners(html);
		// Mount rich text editors on this sheet’s textareas
		this._initRichEditors(html).catch(console.error);

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