export class GuiseSheet extends ItemSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      template: "systems/midnight-gambit/templates/items/guise-sheet.html",
      width: 500,
      height: 400
    });
  }

  async getData(options) {
    const data = await super.getData(options);

    data.system = this.item.system; // This must come first

    // Force Safe Default structure
    data.system.moves = Array.isArray(data.system.moves) ? data.system.moves : [];
    data.system.modifiers ??= {};
    data.system.sparkSlots ??= 0;
    data.system.riskDice ??= 5;
    data.system.casterType ??= "none";
    data.system.description = (data.system.description ?? "").trim();
    data.system.signaturePerk ??= "";
    data.system.signatureDescription = (data.system.signatureDescription ?? "").trim();

    data.attributeKeys = [
      "tenacity", "finesse", "resolve", "guile",
      "instinct", "presence"
    ];

    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);

    // ---------- Add Move ----------
    html.find(".add-move").on("click", async () => {
      const moves = duplicate(this.item.system.moves ?? []);
      moves.push({ name: "", description: "" });
      await this.item.update({ "system.moves": moves });
      this.render(true);
    });

    // ---------- Remove Move ----------
    html.find(".remove-move").on("click", async (event) => {
      const idx = Number(event.currentTarget.dataset.index);
      const moves = duplicate(this.item.system.moves ?? []);
      moves.splice(idx, 1);
      await this.item.update({ "system.moves": moves });
      this.render(true);
    });

    // ❌ REMOVE this; it was causing flicker & lost data on blur
    // html.find(".move-name").on("change", async (event) => { ... });

    // ---------- UPGRADE move textareas to TinyMCE on every render ----------
    const $root = html instanceof jQuery ? html : $(html);

    const mkCfg = (maxH = 420) => {
      const cfg = foundry.utils.deepClone(CONFIG.TinyMCE);
      cfg.max_height = maxH;
      cfg.min_height = cfg.min_height ?? 160;
      cfg.resize = false;
      // safety so the iframe never starts at 0px
      const extra = `
        .tox.tox-tinymce{min-height:180px;width:100%}
        .tox .tox-edit-area__iframe{min-height:160px}
      `;
      cfg.content_style = (cfg.content_style ? cfg.content_style + "\n" : "") + extra;
      return cfg;
    };

    // Find all move description areas every time the sheet renders.
    $root.find("textarea.move-description[name^='system.moves.'][name$='.description']").each((_, el) => {
      if (el.dataset.tiny === "1") return; // guard against double init

      TextEditor.create({
        target: el,
        name: el.name,
        content: el.value ?? "",
        tinymce: mkCfg(),
        height: null
      })
        .then(() => { el.dataset.tiny = "1"; })
        .catch(console.error);
    });
  }


  async _updateObject(event, formData) {
    // Expand dot syntax from the form into an object
    const expanded = expandObject(formData);

    // Clean the description values
    if (expanded.system?.description) {
      expanded.system.description = expanded.system.description.trim();
    }
    if (expanded.system?.signatureDescription) {
      expanded.system.signatureDescription = expanded.system.signatureDescription.trim();
    }

    // Save the cleaned data
    return await this.item.update(expanded);
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "systems/midnight-gambit/templates/items/guise-sheet.html",
      width: 500,
      height: 400,
      submitOnChange: false
    });
  }
}
