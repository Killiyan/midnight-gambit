export class MidnightGambitItemSheet extends ItemSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["midnight-gambit", "sheet", "item"],
      width: 500,
      height: "auto",
      resizable: true
    });
  }

	// One source of truth for template selection
	get template() {
	return "systems/midnight-gambit/templates/items/item-sheet.html";
	}

	// Keep this async getData – it builds the rich context you need
	async getData(options) {
		const context = await super.getData(options);
		context.item = this.item;
		context.system = this.item.system ?? {};
		context.itemType = this.item.type;

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

		// Load global tags (with dynamic fallback)
		let globalTags = CONFIG.MidnightGambit?.ITEM_TAGS;
		if (!globalTags || globalTags.length === 0) {
		try {
			const mod = await import("../config.js");
			globalTags = mod.ITEM_TAGS;
		} catch (e) {
			console.warn("Failed to load tags dynamically in item-sheet.js", e);
			globalTags = [];
		}
		}

		// Merge custom tags present on the item but not in CONFIG (keep labels readable)
		const allTagIds = new Set((CONFIG.MidnightGambit?.ITEM_TAGS || []).map(t => t.id));
		const customTagEntries = Object.entries(context.system.customTags || {}).filter(([id]) => allTagIds.has(id));
		const existingIds = new Set(globalTags.map(t => t.id));
		const customTags = customTagEntries
		.filter(([id]) => !existingIds.has(id))
		.map(([id, description]) => ({
			id,
			label: id.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
			description,
			isCustom: true
		}));

		context.customTags = customTagEntries.map(([id]) => id);
		context.tags = [...globalTags, ...customTags];
		context.tagsMap = Object.fromEntries(context.tags.map(tag => [tag.id, tag]));

		console.log("✅ Item sheet getData fired");
		console.log("Tags in context:", context.tags);

		return context;
	}

	activateListeners(html) {
		super.activateListeners(html);

		// Toggle tag on item
		html.find(".tag-pill").click(async (ev) => {
		const button = ev.currentTarget;
		const tagId = button.dataset.tagId;
		const currentTags = this.item.system.tags ?? [];
		const updatedTags = currentTags.includes(tagId)
			? currentTags.filter(t => t !== tagId)
			: [...currentTags, tagId];
		await this.item.update({ "system.tags": updatedTags });
		this.render();
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

		let customTags = game.settings.get("midnight-gambit", "customTags") || [];
		const exists = customTags.some(t => t.id === newTag.id);
		if (!exists) {
			customTags.push(newTag);
			await game.settings.set("midnight-gambit", "customTags", customTags);
			CONFIG.MidnightGambit.ITEM_TAGS.push(newTag);
			ui.notifications.info(`Added custom tag: ${newTag.label}`);
		} else {
			ui.notifications.warn(`Tag "${newTag.label}" already exists.`);
		}

		const currentTags = [...(this.item.system.tags || [])];
		if (!currentTags.includes(newTag.id)) currentTags.push(newTag.id);

		await this.item.update({
			"system.tags": currentTags,
			"system.customTags": {
			...(this.item.system.customTags || {}),
			[newTag.id]: newTag.description
			}
		});

		this.render();
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
		const tagIndex = CONFIG.MidnightGambit.ITEM_TAGS.findIndex(t => t.id === tagId);
		if (tagIndex === -1) return;

		const currentDesc = CONFIG.MidnightGambit.ITEM_TAGS[tagIndex].description ?? "";
		const newDesc = await Dialog.prompt({
			title: `Edit Tag Description (${CONFIG.MidnightGambit.ITEM_TAGS[tagIndex].label})`,
			content: `<textarea name="desc" rows="4" style="width:100%;">${currentDesc}</textarea>`,
			callback: html => html.find("textarea[name='desc']").val(),
			rejectClose: false
		});
		if (newDesc !== null) {
			CONFIG.MidnightGambit.ITEM_TAGS[tagIndex].description = newDesc;
			this.render();
		}
		});

		// Delete custom tag globally (CONFIG + persistent settings + all items)
		html.find(".delete-custom-tag").on("click", async (event) => {
		event.preventDefault();
		const tagId = event.currentTarget.dataset.tagId;
		if (!tagId) return;

		const confirmed = await Dialog.confirm({
			title: `Delete Tag: ${tagId}`,
			content: `<p>This will remove <strong>${tagId}</strong> from <em>all items and future tag lists</em>. Are you sure?</p>`,
			yes: () => true,
			no: () => false
		});
		if (!confirmed) return;

		// 1) Update in-memory registry
		CONFIG.MidnightGambit.ITEM_TAGS = (CONFIG.MidnightGambit.ITEM_TAGS || []).filter(t => t.id !== tagId);

		// 2) Update persistent registry (world setting) so it survives reloads
		let stored = game.settings.get("midnight-gambit", "customTags") || [];
		stored = stored.filter(t => t.id !== tagId);
		await game.settings.set("midnight-gambit", "customTags", stored);

		// 3) Clean the tag off ALL items in the world directory (World Items)
		const worldItems = game.items?.contents ?? [];
		for (const item of worldItems) {
			const tags = item.system?.tags || [];
			const customTags = item.system?.customTags || {};
			if (tags.includes(tagId) || Object.hasOwn(customTags, tagId)) {
			const updated = {
				"system.tags": tags.filter(t => t !== tagId),
				"system.customTags": { ...customTags }
			};
			delete updated["system.customTags"][tagId];
			await item.update(updated);
			}
		}

		// 4) Clean the tag off all embedded items on every actor (Actor-owned Items)
		const actors = game.actors?.contents ?? [];
		for (const actor of actors) {
			// Gather embedded item updates in batches per actor (avoid spam)
			const updates = [];
			for (const item of actor.items) {
			const tags = item.system?.tags || [];
			const customTags = item.system?.customTags || {};
			if (tags.includes(tagId) || Object.hasOwn(customTags, tagId)) {
				const updated = {
				_id: item.id,
				"system.tags": tags.filter(t => t !== tagId),
				"system.customTags": { ...customTags }
				};
				delete updated["system.customTags"][tagId];
				updates.push(updated);
			}
			}
			if (updates.length) {
			await actor.updateEmbeddedDocuments("Item", updates);
			}
		}

		ui.notifications.info(`Custom tag "${tagId}" deleted everywhere and removed from registry.`);
		console.log(`🗑️ Deleted custom tag globally: ${tagId}`);
		this.render();
		});

	}
}
