export class MidnightGambitActor extends Actor {
  prepareData() {
    super.prepareData();
    const data = this.system;

    //Initialize base attributes
    data.baseAttributes ??= {
      tenacity: 0, finesse: 0, resolve: 0,
      guile: 0, instinct: 0, presence: 0
    };

    const base = foundry.utils.deepClone(data.baseAttributes);
    const guiseId = data.guise;

    // Set default strain values
    data.strain ??= { mortal: 0, soul: 0 };
    data.baseStrainCapacity ??= { mortal: 0, soul: 0 };

    // Set default risk dice ammount
    data.baseRiskDice ??= 5;
    data.riskDiceCapacity = data.baseRiskDice; // default max

    if (guiseId) {
      const guise = fromUuidSync(guiseId) || game.items.get(guiseId);

      if (guise?.type === "guise") {
        const gSys = guise.system;
        const modifiers = gSys.modifiers || {};

        for (const [key, mod] of Object.entries(modifiers)) {
          if (base[key] != null) {
            base[key] += mod;
          }
        }

        // Additional field logic
        if (gSys.mortalCap != null) data.strain["mortal capacity"] = gSys.mortalCap;
        if (gSys.soulCap != null) data.strain["soul capacity"] = gSys.soulCap;
        if (gSys.sparkSlots != null) data.sparkSlots = gSys.sparkSlots;
        if (gSys.riskDice != null) data.riskDice = gSys.riskDice;
        if (gSys.casterType) data.casterType = gSys.casterType;

        // Apply bonus risk capacity
        if (gSys.riskDice != null) {
          data.riskDiceCapacity = gSys.riskDice;
        }
      }
    }

    // Clamp attribute modifiers to -2 (min) and +3 (max)
    for (const key of Object.keys(base)) {
      base[key] = Math.max(-2, Math.min(3, base[key]));
    }

    data.level ??= 1;
    data.attributes = base;
    data.sparkUsed ??= 0;
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
    await this.deleteEmbeddedDocuments("Item", [guise.id]);

    context.keepId = true;
    return [];
  }
}
