export class MidnightGambitItemSheet extends ItemSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["midnight-gambit", "sheet", "item"],
      template: "systems/midnight-gambit/templates/items/item-sheet.html",
      width: 500,
      height: "auto",
      resizable: true
    });
  }

	async getData(options) {
	const context = await super.getData(options);
	context.item = this.item;
	context.system = this.item.system;
	context.itemType = this.item.type;

	// Initialize remainingCapacity if needed
	if (context.itemType === "armor") {
	context.system.remainingCapacity ??= {
		mortal: context.system.mortalCapacity ?? 0,
		soul: context.system.soulCapacity ?? 0
	};

	// Persist back to item if it was undefined
	if (!this.item.system.remainingCapacity) {
		await this.item.update({
		"system.remainingCapacity": {
			mortal: context.system.mortalCapacity ?? 0,
			soul: context.system.soulCapacity ?? 0
		}
		});
	}
	}

	// Load global tags
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

	// Build list only from existing custom tags still in CONFIG
	const allTagIds = new Set(CONFIG.MidnightGambit.ITEM_TAGS.map(t => t.id));
	const customTagEntries = Object.entries(context.system.customTags || {}).filter(([id]) => allTagIds.has(id));
	const existingIds = new Set(globalTags.map(t => t.id));
	const customTags = customTagEntries
	.filter(([id]) => !existingIds.has(id)) // prevent duplicates
	.map(([id, description]) => ({
		id,
		label: id.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
		description,
		isCustom: true
	}));


	context.customTags = customTagEntries.map(([id]) => id);
	context.tags = [...globalTags, ...customTags];

	console.log("✅ Item sheet getData fired");
	console.log("Tags in context:", context.tags);

	// Turn tag array into a lookup map for template lookups
	context.tagsMap = Object.fromEntries(context.tags.map(tag => [tag.id, tag]));

	return context;
	}

	activateListeners(html) {
	super.activateListeners(html);

	html.find(".tag-pill").click(async (ev) => {
		const button = ev.currentTarget;
		const tagId = button.dataset.tagId;
		const currentTags = this.item.system.tags ?? [];

		const updatedTags = currentTags.includes(tagId)
		? currentTags.filter(t => t !== tagId)
		: [...currentTags, tagId];

		await this.item.update({ "system.tags": updatedTags });

		// Refresh UI immediately
		this.render();
	});

	//Set support for players adding custom tags in game
	html.find(".add-custom-tag").on("click", async (event) => {
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

	// Push it to global CONFIG so it shows up in future sheets
	CONFIG.MidnightGambit.ITEM_TAGS.push(newTag);

	const currentTags = [...(this.item.system.tags || [])];
	currentTags.push(newTag.id);

	await this.item.update({
	"system.tags": currentTags,
	"system.customTags": {
		...(this.item.system.customTags || {}),
		[newTag.id]: newTag.description
	}
	});

	this.render();

	});

	//Option to Remove a tag if it has been added as a custom one
	html.find(".remove-tag").on("click", async (event) => {
	event.preventDefault();
	const tagId = event.currentTarget.dataset.tagId;
	if (!tagId) return;

	const item = this.item;

	// Remove from item data
	const updatedTags = (item.system.tags || []).filter(t => t !== tagId);
	const updatedCustom = { ...(item.system.customTags || {}) };
	delete updatedCustom[tagId];

	// Remove from in-memory tag list used in getData
	CONFIG.MidnightGambit.ITEM_TAGS = CONFIG.MidnightGambit.ITEM_TAGS.filter(t => t.id !== tagId);

	await item.update({
		"system.tags": updatedTags,
		"system.customTags": updatedCustom
	});

	console.log("✅ Fully removed custom tag:", tagId);
	this.render();
	});

	//Adding ability to edit a tag's decription
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

	//Remove Custom Tag from system
	html.find(".delete-custom-tag").on("click", async (event) => {
	event.preventDefault();
	const tagId = event.currentTarget.dataset.tagId;
	if (!tagId) return;

	// Confirm
	const confirmed = await Dialog.confirm({
		title: `Delete Tag: ${tagId}`,
		content: `<p>This will remove <strong>${tagId}</strong> from <em>all items and future tag lists</em>. Are you sure?</p>`,
		yes: () => true,
		no: () => false
	});
	if (!confirmed) return;

	// Remove from in-memory list
	CONFIG.MidnightGambit.ITEM_TAGS = CONFIG.MidnightGambit.ITEM_TAGS.filter(t => t.id !== tagId);

	// Remove from all items in world (optional but clean)
	for (const item of game.items.contents) {
		const tags = item.system.tags || [];
		const customTags = item.system.customTags || {};
		if (tags.includes(tagId) || customTags[tagId]) {
		const updated = {
			"system.tags": tags.filter(t => t !== tagId),
			"system.customTags": { ...customTags }
		};
		delete updated["system.customTags"][tagId];
		await item.update(updated);
		}
	}

	ui.notifications.info(`Custom tag "${tagId}" deleted from system.`);
	this.render();
	});

	}

}
