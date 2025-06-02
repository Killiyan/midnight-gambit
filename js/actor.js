export class MidnightGambitActor extends Actor {
  prepareData() {
    super.prepareData();
    const data = this.system;

    data.baseAttributes ??= {
      tenacity: 0, finesse: 0, resolve: 0,
      guile: 0, instinct: 0, presence: 0
    };

    const base = foundry.utils.deepClone(data.baseAttributes);
    const guiseId = data.guise;
    if (guiseId) {
      const guise = game.items.get(guiseId);
      if (guise?.type === "guise") {
        const modifiers = guise.system.modifiers || {};
        for (const [key, mod] of Object.entries(modifiers)) {
          if (base[key] != null) {
            base[key] += mod;
          }
        }
      }
    }

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

      await this.update({ "system.guise": guise.id });

      await this.deleteEmbeddedDocuments("Item", [guise.id]);

      // Tell Foundry NOT to finalize anything else
      context.keepId = true;
      return [];
    }


}
