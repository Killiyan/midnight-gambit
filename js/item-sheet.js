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

	// Fallback if CONFIG doesn't have the tags yet
	let tags = CONFIG.MidnightGambit?.ITEM_TAGS;

	if (!tags || tags.length === 0) {
	try {
		const mod = await import("../config.js");
		tags = mod.ITEM_TAGS;
	} catch (e) {
		console.warn("Failed to load tags dynamically in item-sheet.js", e);
		tags = [];
	}
	}

	context.tags = tags;

    console.log("✅ Item sheet getData fired");
    console.log("Tags in context:", context.tags);

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
	}

}
