// actor.js
export class MidnightGambitActor extends Actor {
  prepareData() {
    super.prepareData();

    const data = this.system;

    // Set default attributes if missing
    if (!data.attributes) {
      data.attributes = {
        tenacity: 0,
        finesse: 0,
        resolve: 0,
        guile: 0,
        instinct: 0,
        presence: 0
      };
    }
  }
}
