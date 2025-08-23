export class MidnightGambitActor extends Actor {
  prepareData() {
    super.prepareData();
    const data = this.system;

    // === Initialize attribute and strain structures ===
    const ATTR_KEYS = ["tenacity","finesse","resolve","guile","instinct","presence"];

    // Ensure baseAttributes exists AND each key is a finite number
    data.baseAttributes ??= {};
    for (const k of ATTR_KEYS) {
      const n = Number(data.baseAttributes[k]);
      data.baseAttributes[k] = Number.isFinite(n) ? n : 0;
    }

    // Clone AFTER sanitizing
    const base = foundry.utils.deepClone(data.baseAttributes);


    data.strain ??= { mortal: 0, soul: 0 };
    data.baseStrainCapacity ??= { mortal: 0, soul: 0 };
    data.strain.manualOverride ??= {};

    const manual = data.strain.manualOverride;

    if (!manual["mortal capacity"]) {
      data.strain["mortal capacity"] = data.baseStrainCapacity?.mortal ?? 0;
    }
    if (!manual["soul capacity"]) {
      data.strain["soul capacity"] = data.baseStrainCapacity?.soul ?? 0;
    }

    // === Armor: initialize remaining capacity if missing ===
    for (const item of this.items) {
      if (item.type === "armor" || item.type === "misc") {
        const sys = item.system;
        if (!sys.remainingCapacity) {
          item.updateSource({
            "system.remainingCapacity": {
              mortal: sys.mortalCapacity ?? 0,
              soul: sys.soulCapacity ?? 0
            }
          });
        }
      }
    }

    // === Risk & Spark defaults ===
    data.baseRiskDice ??= 5;
    data.riskDiceCapacity = data.baseRiskDice;
    data.sparkUsed ??= 0;

    // --- Resolve guise whether system.guise is an embedded id OR a UUID ---
    const ref = data.guise;
    let guise = null;

    if (ref) {
      // 1) Prefer embedded Item id on the actor
      guise = this.items.get(ref);

      // 2) Fallback to UUID (older actors / compendium reference)
      if (!guise && typeof fromUuidSync === "function") {
        try { guise = fromUuidSync(ref); } catch (_) {}
      }
    }

    if (guise?.type === "guise") {
      const gSys = guise.system || {};
      const modifiers = gSys.modifiers ?? {};

      // Apply modifiers as NUMBERS (avoid string concat/NaN)
      for (const [key, mod] of Object.entries(modifiers)) {
        if (base[key] != null) {
          const m = Number(mod);
          if (Number.isFinite(m)) base[key] += m;
        }
      }

      // Apply Guise strain capacity if not manually overridden
      if (!manual["mortal capacity"]) {
        data.strain["mortal capacity"] = gSys.mortalCap ?? 0;
      }
      if (!manual["soul capacity"]) {
        data.strain["soul capacity"] = gSys.soulCap ?? 0;
      }

      // Apply other Guise fields
      data.baseStrainCapacity = {
        mortal: gSys.mortalCap ?? 0,
        soul:   gSys.soulCap   ?? 0
      };
      data.sparkSlots = gSys.sparkSlots ?? 0;
      data.riskDice   = gSys.riskDice   ?? 5;
      data.casterType = gSys.casterType ?? null;
    }


    // === Clamp attributes ===
    for (const key of Object.keys(base)) {
      base[key] = Math.max(-2, Math.min(3, base[key]));
    }

    data.level ??= 1;
    data.attributes = base;
  }

  async _onCreateDescendantDocuments(embeddedName, documents, context) {
    if (embeddedName !== "Item") return;

    const guise = documents.find(doc => doc.type === "guise");
    if (!guise) return;

    console.log(`✅ Intercepted Guise creation: ${guise.name}`);

    if (!this.system.baseAttributes || Object.keys(this.system.baseAttributes).length === 0) {
      const base = foundry.utils.deepClone(this.system.attributes);
      await this.update({ "system.baseAttributes": base });
    }

    const updates = {
      "system.guise": guise.uuid,
      "system.strain['mortal capacity']": guise.system.mortalCap ?? 5,
      "system.strain['soul capacity']": guise.system.soulCap ?? 5,
      "system.sparkSlots": guise.system.sparkSlots ?? 0,
      "system.sparkUsed": 0,
      "system.riskDice": guise.system.riskDice ?? 5
    };

    console.log("Guise sparkSlots value before update:", guise.system.sparkSlots);
    console.log("Full updates object:", updates);

    await this.update(updates);
    //await this.deleteEmbeddedDocuments("Item", [guise.id]);

    context.keepId = true;
    return [];
  }
}
