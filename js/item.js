export class MidnightGambitItem extends Item {
  prepareDerivedData() {
    super.prepareDerivedData();

    const system = this.system;

    // Always initialize tags as an array
    if (!Array.isArray(system.tags)) {
      system.tags = [];
    }

    // Future-proof logic per type if needed
    switch (this.type) {
      case "weapon":
      case "armor":
      case "misc":
        // No hardcoded logic — tags come from user or future UI
        break;
    }
  }
}
