export class GuiseSheet extends ItemSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      template: "systems/midnight-gambit/templates/items/guise-sheet.html",
      width: 500,
      height: 400
    });
  }

  // DROP-IN: normalized render context
  async getData(options) {
    const base = await super.getData(options);
    const sys  = foundry.utils.duplicate(this.item.system ?? {});

    // --- Always present sane defaults ---
    sys.modifiers     ??= {};
    sys.sparkSlots    ??= 0;
    sys.riskDice      ??= 5;
    sys.casterType    ??= "none";
    sys.signaturePerk ??= "";

    // --- Ensure moves is a TRUE array for the template ---
    if (!Array.isArray(sys.moves)) {
      const obj = sys.moves && typeof sys.moves === "object" ? sys.moves : {};
      sys.moves = Object.keys(obj)
        .filter(k => /^\d+$/.test(k))
        .sort((a,b) => Number(a) - Number(b))
        .map(k => obj[k]);
    }
    sys.moves = Array.isArray(sys.moves) ? sys.moves : [];

    base.system = sys;
    base.attributeKeys = ["tenacity","finesse","resolve","guile","instinct","presence"];
    return base;
  }

  activateListeners(html) {
    super.activateListeners(html);

    // DROP-IN: Always treat moves as array for actions
    const toArray = (raw) => {
      if (Array.isArray(raw)) return foundry.utils.duplicate(raw);
      if (raw && typeof raw === "object") {
        return Object.keys(raw)
          .filter(k => /^\d+$/.test(k))
          .sort((a,b) => Number(a) - Number(b))
          .map(k => foundry.utils.duplicate(raw[k]));
      }
      return [];
    };

    // Add Move
    html.find(".add-move").off("click.mgAddMove").on("click.mgAddMove", async () => {
      const moves = toArray(this.item.system?.moves);
      moves.push({ name: "", description: "" });
      await this.item.update({ "system.moves": moves });
      this.render(true);
    });

    // Remove Move
    html.find(".remove-move").off("click.mgDelMove").on("click.mgDelMove", async (ev) => {
      const idx = Number(ev.currentTarget.dataset.index);
      const moves = toArray(this.item.system?.moves);
      if (idx >= 0 && idx < moves.length) moves.splice(idx, 1);
      await this.item.update({ "system.moves": moves });
      this.render(true);
    });

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

    // Match "system.moves[<n>].description"
    $root.find("textarea.move-description[name^='system.moves'][name$='.description']").each((_, el) => {
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

  // DROP-IN: normalize payload before saving
  async _updateObject(event, formData) {
    // Make sure any TinyMCE fields flush to textareas (safety net)
    try { if (window.tinyMCE?.triggerSave) tinyMCE.triggerSave(); } catch {}

    // Expand the flat form object into nested data
    const expanded = foundry.utils.expandObject(formData);

    // Pull whatever the form produced for moves
    const movesRaw = foundry.utils.getProperty(expanded, "system.moves");

    // If it's NOT an array, but an object with numeric keys, coerce to array
    if (!Array.isArray(movesRaw) && movesRaw && typeof movesRaw === "object") {
      const arr = Object.keys(movesRaw)
        .filter(k => /^\d+$/.test(k))
        .sort((a,b) => Number(a) - Number(b))
        .map(k => {
          const m = movesRaw[k] ?? {};
          return {
            name: typeof m.name === "string" ? m.name : "",
            description: typeof m.description === "string" ? m.description : ""
          };
        });
      foundry.utils.setProperty(expanded, "system.moves", arr);
    }

    // If still falsy, make it an empty array
    if (!Array.isArray(foundry.utils.getProperty(expanded, "system.moves"))) {
      foundry.utils.setProperty(expanded, "system.moves", []);
    }

    // Light trims (won't nuke rich text)
    const sig = foundry.utils.getProperty(expanded, "system.signatureDescription");
    if (typeof sig === "string") foundry.utils.setProperty(expanded, "system.signatureDescription", sig.trim());
    const desc = foundry.utils.getProperty(expanded, "system.description");
    if (typeof desc === "string") foundry.utils.setProperty(expanded, "system.description", desc.trim());

    // Finally, update
    return super._updateObject(event, foundry.utils.flattenObject(expanded));
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "systems/midnight-gambit/templates/items/guise-sheet.html",
      width: 500,
      height: 400,
      submitOnChange: false,
      submitOnClose:  false,
      closeOnSubmit:  false
    });
  }

  _getHeaderButtons() {
    const buttons = super._getHeaderButtons?.() ?? [];
    buttons.unshift({
      label: "Save",
      class: "mg-save-guise",
      icon: "fa-solid fa-floppy-disk",
      onclick: async () => {
        // Flush editors then submit
        try { if (window.tinyMCE?.triggerSave) tinyMCE.triggerSave(); } catch {}
        await this.submit({ preventClose: true });
        ui.notifications?.info("Guise saved.");
      }
    });
    return buttons;
  }

  async _saveAll() {
    try { if (window.tinyMCE?.triggerSave) tinyMCE.triggerSave(); } catch {}
    await this.submit({ preventClose: true });
  }

  async _onSubmit(event) {
    // 1) Flush TinyMCE → textareas get the current HTML
    try { if (window.tinyMCE?.triggerSave) tinyMCE.triggerSave(); } catch {}

    // 2) Let Foundry collect form data
    const result = await super._onSubmit(event);

    // 3) Post-trim top-level strings (safe, non-destructive)
    const sys = this.item.system ?? {};
    const patch = {};

    if (typeof sys.description === "string") {
      patch["system.description"] = sys.description.trim();
    }
    if (typeof sys.signatureDescription === "string") {
      patch["system.signatureDescription"] = sys.signatureDescription.trim();
    }

    // If your Moves live at system.moves[].description/name, you can optionally normalize whitespace:
    if (Array.isArray(sys.moves)) {
      const nextMoves = sys.moves.map(m => ({
        ...m,
        name: typeof m.name === "string" ? m.name.trim() : m.name,
        description: typeof m.description === "string" ? m.description.trim() : m.description
      }));
      patch["system.moves"] = nextMoves;
    }

    if (Object.keys(patch).length) {
      // Avoid re-render thrash; we’re already in a submit/render cycle
      await this.item.update(patch, { render: false });
      this.render(false);
    }

    return result;
  }
}
