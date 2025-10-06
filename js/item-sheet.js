export class MidnightGambitItemSheet extends ItemSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["midnight-gambit", "sheet", "item"],
      width: 500,
      height: "auto",
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

			// --- One-time prune of orphan tag ids on this item (prevents "ghost" chip on source sheet) ---
			{
				const isAsset  = this.item.type === "asset";
				const listKey  = isAsset ? "ASSET_TAGS" : "ITEM_TAGS";
				const lc = (s) => String(s ?? "").toLowerCase();

				const libIds   = new Set((CONFIG.MidnightGambit?.[listKey] || []).map(t => lc(t.id)));
				const localMap = context.system.customTags || {};
				const localIds = new Set(Object.keys(localMap).map(lc));
				const valid    = new Set([...libIds, ...localIds]);

				const current  = Array.from(context.system.tags || []);
				const next     = current.map(lc).filter(id => valid.has(id));

				if (current.length !== next.length) {
					await this.item.update({ "system.tags": next });
					// reflect immediately in this render pass
					context.system.tags = next;
				}
			}

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



		console.log("✅ Item sheet getData fired");
		console.log("Tags in context:", context.tags);

		return context;
	}

	activateListeners(html) {
		super.activateListeners(html);

		// Toggle tag on item
		html.off("click.mgTag", ".tag-pill").on("click.mgTag", ".tag-pill", async (ev) => {
		ev.preventDefault();
		ev.stopPropagation(); // ← avoid double fires when clicking near controls
		const tagId = ev.currentTarget.dataset.tagId;
		const set = new Set(this.item.system?.tags || []);
		set.has(tagId) ? set.delete(tagId) : set.add(tagId);
		await this.item.update({ "system.tags": Array.from(set) });
		this.render(false);
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

		// Remove tag from this item only (do NOT touch global registry here)
		html.find(".remove-tag").on("click", async (event) => {
		event.preventDefault();
		const tagId = event.currentTarget.dataset.tagId;
		if (!tagId) return;

		const item = this.item;
		const updatedTags = (item.system.tags || []).filter(t => t !== tagId);
		const updatedCustom = { ...(item.system.customTags || {}) };
		delete updatedCustom[tagId];

		await item.update({
			"system.tags": updatedTags,
			"system.customTags": updatedCustom
		});

		console.log("Removed tag from item:", tagId, "item:", item.name);
		this.render();
		});

		// Edit tag description
		html.find(".editable-tag-label").on("click", async (event) => {
		const tagId = event.currentTarget.dataset.tagId;
		const listKey = this.item.type === "asset" ? "ASSET_TAGS" : "ITEM_TAGS";
		const tagIndex = (CONFIG.MidnightGambit[listKey] || []).findIndex(t => t.id === tagId);
		if (tagIndex === -1) return;

		const currentDesc = CONFIG.MidnightGambit[listKey][tagIndex].description ?? "";
		const newDesc = await Dialog.prompt({
			title: `Edit Tag Description (${CONFIG.MidnightGambit[listKey][tagIndex].label})`,
			content: `<textarea name="desc" rows="4" style="width:100%;">${currentDesc}</textarea>`,
			callback: html => html.find("textarea[name='desc']").val(),
			rejectClose: false
		});
		if (newDesc !== null) {
			CONFIG.MidnightGambit[listKey][tagIndex].description = newDesc;
			this.render();
		}
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

		// Coherence pass (lower-cased): keep only ids that still exist in the registry or in item's custom map
		{
		const lc = (s) => String(s ?? "").toLowerCase();

		const libIds   = new Set((CONFIG.MidnightGambit?.[listKey] || []).map(t => lc(t.id)));
		const localMap = this.item.system?.customTags || {};
		const localIds = new Set(Object.keys(localMap).map(lc));

		const valid = new Set([...libIds, ...localIds]); // union of current library and this item's custom map

		const current = Array.from(this.item.system?.tags || []);
		const next    = current
			.map(lc)                     // normalize
			.filter(id => id !== lc(tagId)) // remove the one we just deleted globally
			.filter(id => valid.has(id));   // drop any other orphans

		// If anything changed, write it back
		if (current.length !== next.length) {
			await this.item.update({ "system.tags": next });
		}
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

			const updatedCustom = { ...custom };
			delete updatedCustom[tagId];

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

				const updatedCustom = { ...custom };
				delete updatedCustom[tagId];

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

		// Keep Asset tags CSV in sync while typing
		if (this.item?.type === "asset") {
			const $root = html instanceof jQuery ? html : $(html);
			$root.find(".tags-input").on("input", (ev) => {
				$root.find('input[name="system.tagsCsv"]').val(ev.currentTarget.value || "");
			});
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
}
