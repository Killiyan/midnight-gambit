export class MidnightGambitItem extends Item {
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
      case "weapon":
      case "armor":
      case "misc":
        // No hardcoded logic — tags come from user or future UI
        break;
        case "asset": {
          const system = this.system;
          const q = Number(system.qty);
          system.qty = Number.isFinite(q) ? q : 1;

          if (typeof system.notes !== "string") system.notes = "";
          if (typeof system.description !== "string") system.description = ""; // ← ensure textarea has a value
          break;
        }
    }
  }
}
