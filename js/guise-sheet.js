const MG_GUISE_IMAGE = "systems/midnight-gambit/assets/images/guise.jpg";
const MG_ITEM_DEFAULT_IMAGE = "icons/svg/item-bag.svg";

function mgGetGuiseSheetImage(item) {
  const img = String(item?.img ?? "").trim();
  if (!img || img === MG_ITEM_DEFAULT_IMAGE || img.endsWith("/item-bag.svg")) return MG_GUISE_IMAGE;
  return img;
}

function mgGuiseSignaturesFromSystem(sys = {}) {
  const raw = Array.isArray(sys.signaturePerks) ? sys.signaturePerks : [];
  const signatures = raw.map(sig => ({
    name: sig?.name ?? "",
    description: sig?.description ?? "",
    tags: Array.isArray(sig?.tags) ? sig.tags : [],
    tagsCsv: Array.isArray(sig?.tags) ? sig.tags.join(",") : (sig?.tagsCsv ?? "")
  }));

  if (!signatures.length && (String(sys.signaturePerk ?? "").trim() || String(sys.signatureDescription ?? "").trim())) {
    signatures.push({
      name: sys.signaturePerk ?? "",
      description: sys.signatureDescription ?? "",
      tags: Array.isArray(sys.signatureTags) ? sys.signatureTags : [],
      tagsCsv: Array.isArray(sys.signatureTags) ? sys.signatureTags.join(",") : (sys.signatureTagsCsv ?? "")
    });
  }

  return signatures;
}

function mgGuiseMovesFromSystem(sys = {}) {
  const raw = sys.moves;
  const moves = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === "object")
      ? Object.keys(raw)
        .filter(k => /^\d+$/.test(k))
        .sort((a,b) => Number(a) - Number(b))
        .map(k => raw[k])
      : [];

  return moves.map(m => ({
    name: m?.name ?? "",
    description: m?.description ?? "",
    tags: Array.isArray(m?.tags) ? m.tags : [],
    tagsCsv: Array.isArray(m?.tags) ? m.tags.join(",") : (m?.tagsCsv ?? "")
  }));
}

async function mgReplaceGuiseSystemArray(item, key, value, options = {}) {
  await item.update({ [`system.-=${key}`]: null }, { render: false });
  return item.update({ [`system.${key}`]: value }, options);
}

export class GuiseSheet extends ItemSheet {

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
    sys.signatureTags    ??= [];
    sys.signatureTagsCsv ??= "";
    sys.sparkAttribute ??= "guile";
    sys.signaturePerks = mgGuiseSignaturesFromSystem(sys);

    // Ensure moves is a true array for the template.
    sys.moves = mgGuiseMovesFromSystem(sys);

    // Signature tags CSV helper for the form
    sys.signatureTags = Array.isArray(sys.signatureTags) ? sys.signatureTags : [];
    sys.signatureTagsCsv = sys.signatureTags.join(",");

    // Global tag library (includes global custom tags if you merge them into CONFIG)
    const tagList = Array.isArray(CONFIG.MidnightGambit?.ITEM_TAGS)
      ? CONFIG.MidnightGambit.ITEM_TAGS
      : [];

    // Precompute selected maps so the template can do lookup without needing an "includes" helper
    const signatureTagSelected = Object.fromEntries((sys.signatureTags || []).map(id => [id, true]));
    const signaturePerkTagSelected = sys.signaturePerks.map(sig => Object.fromEntries((sig.tags || []).map(id => [id, true])));
    const moveTagSelected = sys.moves.map(m => Object.fromEntries((m.tags || []).map(id => [id, true])));

    base.system = sys;
    base.attributeKeys = ["tenacity","finesse","resolve","guile","instinct","presence"];

    // NEW template context
    base.tags = tagList;
    base.signatureTagSelected = signatureTagSelected;
    base.signaturePerkTagSelected = signaturePerkTagSelected;
    base.moveTagSelected = moveTagSelected;
    base.itemDisplayImg = mgGetGuiseSheetImage(this.item);

    return base;
  }

  _mgClearTinyMceFocus(html) {
    const root = html instanceof jQuery ? html[0] : html;
    const appEl = root?.closest?.(".window-app");
    if (!appEl) return;

    const clear = () => {
      try {
        const active = window.tinymce?.activeEditor;
        const target = active?.targetElm || active?.getElement?.();

        if (target && !appEl.contains(target)) return;

        active?.blur?.();
        active?.getWin?.()?.blur?.();
        active?.getBody?.()?.blur?.();

        const focused = document.activeElement;
        if (focused?.closest?.(".tox-tinymce")) focused.blur();

        appEl.setAttribute("tabindex", "-1");
        appEl.focus({ preventScroll: true });
      } catch (err) {
        console.warn("MG | Guise TinyMCE focus clear failed:", err);
      }
    };

    requestAnimationFrame(clear);
    setTimeout(clear, 50);
    setTimeout(clear, 150);
  }  

  activateListeners(html) {
    super.activateListeners(html);

    // Add Move
    html.find(".add-move").off("click.mgAddMove").on("click.mgAddMove", async () => {
      const moves = mgGuiseMovesFromSystem(this.item.system);
      moves.push({ name: "", description: "", tags: [] });
      await mgReplaceGuiseSystemArray(this.item, "moves", moves);
      this.render(true);
    });

    html.find(".add-signature-perk").off("click.mgAddSignature").on("click.mgAddSignature", async () => {
      const signatures = mgGuiseSignaturesFromSystem(this.item.system);
      signatures.push({ name: "", description: "", tags: [] });
      await mgReplaceGuiseSystemArray(this.item, "signaturePerks", signatures);
      this.render(true);
    });

    html.find(".remove-signature-perk").off("click.mgDelSignature").on("click.mgDelSignature", async (ev) => {
      const idx = Number(ev.currentTarget.dataset.index);
      const signatures = mgGuiseSignaturesFromSystem(this.item.system);
      if (idx >= 0 && idx < signatures.length) signatures.splice(idx, 1);
      await mgReplaceGuiseSystemArray(this.item, "signaturePerks", signatures);
      this.render(true);
    });

    // Remove Move
    html.find(".remove-move").off("click.mgDelMove").on("click.mgDelMove", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const idx = Number(ev.currentTarget.dataset.index);
      const moves = mgGuiseMovesFromSystem(this.item.system);
      if (idx >= 0 && idx < moves.length) moves.splice(idx, 1);
      await mgReplaceGuiseSystemArray(this.item, "moves", moves);
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
      .then(() => {
        el.dataset.tiny = "1";
        this._mgClearTinyMceFocus(html);
      })
      .catch(console.error);
    });

    $root.find("textarea.signature-description[name^='system.signaturePerks'][name$='.description']").each((_, el) => {
      if (el.dataset.tiny === "1") return;
      TextEditor.create({
        target: el,
        name: el.name,
        content: el.value ?? "",
        tinymce: mkCfg(),
        height: null
      })
      .then(() => {
        el.dataset.tiny = "1";
        this._mgClearTinyMceFocus(html);
      })
      .catch(console.error);
    });

    // Tag toggles (item-sheet style: no re-render, live UI update, keep TinyMCE intact)
    html.off("click.mgTag", ".tag-selector .tag-pill").on("click.mgTag", ".tag-selector .tag-pill", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const pill  = ev.currentTarget;
      const tagId = pill.dataset.tagId;
      if (!tagId) return;

      const selector = pill.closest(".tag-selector");
      const targetPath = selector?.dataset?.tagsTarget; // "signatureTags", "signaturePerks.0.tags", or "moves.0.tags"
      if (!targetPath) return;

      // 1) Toggle the tag set from the CURRENT document data
      const current = foundry.utils.getProperty(this.item.system, targetPath) ?? [];
      const set = new Set(Array.isArray(current) ? current : []);

      if (set.has(tagId)) set.delete(tagId);
      else set.add(tagId);

      const next = Array.from(set);

      // 2) Persist to the Item WITHOUT re-rendering (prevents TinyMCE wipe)
      await this.item.update({ [`system.${targetPath}`]: next }, { render: false });

      // 3) Live-update ONLY the pills in this selector
      selector.querySelectorAll(".tag-pill").forEach((el) => {
        const id = el.dataset.tagId;
        if (!id) return;
        el.classList.toggle("selected", set.has(id));
        el.classList.toggle("active", set.has(id)); // if you use .active anywhere
      });

      // 4) Keep the form in sync so your header Save doesn't overwrite tags
      const root = html instanceof jQuery ? html[0] : html;
      const hidden = root.querySelector(`input[data-tags-csv="${CSS.escape(targetPath)}"]`);
      if (hidden) hidden.value = next.join(",");
    });
  }

  // DROP-IN: normalize payload before saving
  async _updateObject(event, formData) {
    // Make sure any TinyMCE fields flush to textareas (safety net)
    try { if (window.tinyMCE?.triggerSave) tinyMCE.triggerSave(); } catch {}

    // Expand the flat form object into nested data
    const expanded = foundry.utils.expandObject(formData);

    const parseCsv = (v) =>
      String(v ?? "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);

    // Signature tags
    const sigCsv = foundry.utils.getProperty(expanded, "system.signatureTagsCsv");

    // Only overwrite signatureTags if the form actually submitted the CSV field.
    // Otherwise, preserve what is already stored on the item (prevents "Save" nuking tags).
    if (sigCsv !== undefined) {
      foundry.utils.setProperty(expanded, "system.signatureTags", parseCsv(sigCsv));
    } else {
      const existingSig = Array.isArray(this.item.system?.signatureTags) ? this.item.system.signatureTags : [];
      foundry.utils.setProperty(expanded, "system.signatureTags", existingSig);
    }

    if (expanded.system) delete expanded.system.signatureTagsCsv;

    const signaturesRaw = foundry.utils.getProperty(expanded, "system.signaturePerks");
    const existingSignatures = mgGuiseSignaturesFromSystem(this.item.system);
    if (!Array.isArray(signaturesRaw) && signaturesRaw && typeof signaturesRaw === "object") {
      const arr = Object.keys(signaturesRaw)
        .filter(k => /^\d+$/.test(k))
        .sort((a,b) => Number(a) - Number(b))
        .map(k => {
          const sig = signaturesRaw[k] ?? {};
          return {
            name: typeof sig.name === "string" ? sig.name : "",
            description: typeof sig.description === "string" ? sig.description : "",
            tags: parseCsv(sig.tagsCsv ?? sig.tags ?? "")
          };
        });
      foundry.utils.setProperty(expanded, "system.signaturePerks", arr);
    }

    if (!Array.isArray(foundry.utils.getProperty(expanded, "system.signaturePerks"))) {
      foundry.utils.setProperty(expanded, "system.signaturePerks", existingSignatures);
    }

    const signaturesArr = foundry.utils.getProperty(expanded, "system.signaturePerks");
    if (Array.isArray(signaturesArr)) {
      const nextSignatures = signaturesArr.map((sig, idx) => {
        const hasTagFields = (sig?.tagsCsv !== undefined) || (sig?.tags !== undefined);
        const preserved = Array.isArray(existingSignatures?.[idx]?.tags) ? existingSignatures[idx].tags : [];
        const nextTags = hasTagFields
          ? (Array.isArray(sig?.tags) ? sig.tags : parseCsv(sig?.tagsCsv ?? sig?.tags ?? ""))
          : preserved;

        const out = {
          name: typeof sig?.name === "string" ? sig.name : "",
          description: typeof sig?.description === "string" ? sig.description : "",
          tags: nextTags
        };
        return out;
      });

      foundry.utils.setProperty(expanded, "system.signaturePerks", nextSignatures);

      const first = nextSignatures[0] ?? { name: "", description: "", tags: [] };
      foundry.utils.setProperty(expanded, "system.signaturePerk", first.name);
      foundry.utils.setProperty(expanded, "system.signatureDescription", first.description);
      foundry.utils.setProperty(expanded, "system.signatureTags", first.tags);
    }

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
            description: typeof m.description === "string" ? m.description : "",
            tags: parseCsv(m.tagsCsv ?? m.tags ?? "")
          };
        });
      foundry.utils.setProperty(expanded, "system.moves", arr);
    }

    // If still falsy, make it an empty array
    if (!Array.isArray(foundry.utils.getProperty(expanded, "system.moves"))) {
      foundry.utils.setProperty(expanded, "system.moves", []);
    }

    // If moves is already an array, still parse tagsCsv -> tags
    const movesArr = foundry.utils.getProperty(expanded, "system.moves");
    if (Array.isArray(movesArr)) {
      const existingMoves = Array.isArray(this.item.system?.moves) ? this.item.system.moves : [];

      foundry.utils.setProperty(
        expanded,
        "system.moves",
        movesArr.map((m, idx) => {
          const hasTagFields = (m?.tagsCsv !== undefined) || (m?.tags !== undefined);

          // If the form submitted tags/tagsCsv, respect it.
          // If it did NOT, preserve the already-saved tags at this index.
          const preserved = Array.isArray(existingMoves?.[idx]?.tags) ? existingMoves[idx].tags : [];

          const nextTags = hasTagFields
            ? (Array.isArray(m?.tags) ? m.tags : parseCsv(m?.tagsCsv ?? m?.tags ?? ""))
            : preserved;

          const out = { ...m, tags: nextTags };
          delete out.tagsCsv;
          return out;
        })
      );
    }  

    // Light trims (won't nuke rich text)
    const sig = foundry.utils.getProperty(expanded, "system.signatureDescription");
    if (typeof sig === "string") foundry.utils.setProperty(expanded, "system.signatureDescription", sig.trim());
    const sigPerks = foundry.utils.getProperty(expanded, "system.signaturePerks");
    if (Array.isArray(sigPerks)) {
      foundry.utils.setProperty(
        expanded,
        "system.signaturePerks",
        sigPerks.map(sig => ({
          ...sig,
          name: typeof sig.name === "string" ? sig.name.trim() : sig.name,
          description: typeof sig.description === "string" ? sig.description.trim() : sig.description
        }))
      );
    }
    const desc = foundry.utils.getProperty(expanded, "system.description");
    if (typeof desc === "string") foundry.utils.setProperty(expanded, "system.description", desc.trim());

    // Finally, update
    return super._updateObject(event, foundry.utils.flattenObject(expanded));
  }

static get defaultOptions() {
  return foundry.utils.mergeObject(super.defaultOptions, {
    template: "systems/midnight-gambit/templates/items/guise-sheet.html",
    width: 800,
    height: 800,
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
    if (Array.isArray(sys.signaturePerks)) {
      const nextSignatures = sys.signaturePerks.map(sig => ({
        ...sig,
        name: typeof sig.name === "string" ? sig.name.trim() : sig.name,
        description: typeof sig.description === "string" ? sig.description.trim() : sig.description
      }));
      patch["system.signaturePerks"] = nextSignatures;
      const first = nextSignatures[0] ?? { name: "", description: "", tags: [] };
      patch["system.signaturePerk"] = first.name ?? "";
      patch["system.signatureDescription"] = first.description ?? "";
      patch["system.signatureTags"] = Array.isArray(first.tags) ? first.tags : [];
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
