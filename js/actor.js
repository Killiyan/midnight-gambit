export class MidnightGambitActor extends Actor {
  prepareData() {
    super.prepareData();
    const data = this.system;

    // Ensure base attribute structure exists
    data.attributes ??= {
      tenacity: 0, finesse: 0, resolve: 0,
      guile: 0, instinct: 0, presence: 0
    };

    // Apply Guise modifiers if selected
    const guiseId = data.guise;
    if (guiseId) {
      const guise = game.items.get(guiseId);
      if (guise?.type === "guise") {
        const modifiers = guise.system.modifiers || {};
        for (const [key, mod] of Object.entries(modifiers)) {
          if (data.attributes[key] != null) {
            data.attributes[key] += mod;
          }
        }
      }
    }
  }
}
