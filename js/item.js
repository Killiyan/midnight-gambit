import { mgGetCompendiumCategory } from "./library-sources.js";
import {
  getGambitCostForTier,
  normalizeGambitTier,
  normalizeGambitType,
  normalizeMoveSubtype,
  normalizeMoveSubtypes,
  normalizeMoveType
} from "../config.js";

export class MidnightGambitItem extends Item {
  // Compendium creation uses only the item types allowed by its content type.
  static async createDialog(data = {}, { parent = null, pack = null, ...options } = {}) {
    const collection = pack ? game.packs.get(pack) : null;
    const types = collection ? mgGetCompendiumCategory(collection).types : null;
    if (!types) return super.createDialog(data, { parent, pack, ...options });

    const type = types.includes(data.type) ? data.type : types[0];
    const labels = types.reduce((labels, type) => {
      const key = CONFIG.Item.typeLabels?.[type] ?? type;
      labels[type] = game.i18n.has(key) ? game.i18n.localize(key) : type.charAt(0).toUpperCase() + type.slice(1);
      return labels;
    }, {});
    const folders = collection._formatFolderSelectOptions();
    const title = game.i18n.format("DOCUMENT.Create", { type: game.i18n.localize(this.metadata.label) });
    const html = await renderTemplate("templates/sidebar/document-create.html", {
      name: data.name || this.defaultName(), folder: data.folder, folders,
      hasFolders: folders.length > 0, type, types: labels, hasTypes: types.length > 1
    });
    return Dialog.prompt({
      title, content: html, label: title,
      callback: html => {
        const form = html[0].querySelector("form");
        const fields = new FormDataExtended(form).object;
        const creation = { ...data, ...fields, type: types.length === 1 ? type : fields.type };
        if (!types.includes(creation.type)) throw new Error("Choose a type allowed by this compendium.");
        if (!creation.folder) delete creation.folder;
        if (!creation.name?.trim()) creation.name = this.defaultName();
        return this.create(creation, { parent, pack, renderSheet: true });
      },
      rejectClose: false, options
    });
  }

  prepareDerivedData() {
    super.prepareDerivedData();

    // Always normalize + prune tags against active library and local custom map
    const sys = this.system;

    // 1) Normalize to array
    const arr = Array.isArray(sys.tags) ? sys.tags : [];

    // 2) Build the valid-id set for this type
    const listKey = this.type === "asset" ? "ASSET_TAGS" : "ITEM_TAGS";
    const libIds  = new Set((CONFIG.MidnightGambit?.[listKey] || []).map(t => String(t.id)));
    const localIds = new Set(Object.keys(sys.customTags || {}));
    const valid = new Set([...libIds, ...localIds]);

    // 3) Prune any orphan ids (and de-dupe while we’re at it)
    const seen = new Set();
    sys.tags = arr.filter(id => {
      const s = String(id);
      if (!valid.has(s)) return false;
      if (seen.has(s))   return false;
      seen.add(s);
      return true;
    });


    // Future-proof logic per type if needed
    switch (this.type) {
      case "gambit": {
        if (typeof sys.teaser !== "string") sys.teaser = "";
        sys.tier = normalizeGambitTier(sys.tier);
        sys.gambitType = normalizeGambitType(sys.gambitType);
        sys.gpCost = getGambitCostForTier(sys.tier, sys.gpCost);
        break;
      }
      case "move": {
        if (typeof sys.teaser !== "string") sys.teaser = "";
        if (sys.isSignature === true) {
          sys.libraryEnabled = false;
          sys.learned = false;
          sys.moveType = "";
          sys.moveSubtype = "";
          sys.moveSubtypes = [];
        } else {
          sys.moveType = normalizeMoveType(sys.moveType);
          const subtypes = normalizeMoveSubtypes(
            Array.isArray(sys.moveSubtypes) && sys.moveSubtypes.length ? sys.moveSubtypes : sys.moveSubtype
          );
          sys.moveSubtypes = subtypes;
          sys.moveSubtype = subtypes[0] ?? normalizeMoveSubtype(sys.moveSubtype);
        }
        break;
      }
      case "signaturePerk": {
        sys.tags = Array.isArray(sys.tags) ? sys.tags : [];
        sys.libraryEnabled = false;
        sys.learned = false;
        break;
      }
      case "weapon":
      case "armor":
      case "misc":
        // No hardcoded logic — tags come from user or future UI
        break;
        case "asset": {
          const system = this.system;
          const q = Number(system.qty);
          system.qty = Number.isFinite(q) ? q : 1;

          if (typeof system.description !== "string") system.description = "";
          break;
        }
    }
  }
}
