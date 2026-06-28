export const ITEM_TAGS = [
  { id: "close", label: "Close", description: "Only damages nearby enemies." },
  { id: "short-range", label: "Short Range", description: "Effects targets that are at a short to medium range." },
  { id: "mid-range", label: "Mid Range", description: "Effects targets at a mid to long range." },
  { id: "long-range", label: "Long Range", description: "Efects targets at a distance." },
  { id: "single-use", label: "Single Use", description: "Expended after one use unless recovered or preserved." },
  { id: "limited", label: "Limited", description: "Can only be used in specific scenarios (infiltration, combat, etc)" },
  { id: "expendable", label: "Expendable", description: "Degrades with each use - Destroyed on a 1-3 result." },
  { id: "enchanted", label: "Enchanted", description: "Has magical or arcane effects." },
  { id: "repurposed", label: "Repurposed", description: "Clearly modified from original purpose." },
  { id: "cursed", label: "Cursed", description: "Use comes with a cost, consequence, or dark hitch." },
  { id: "upgradeable", label: "Upgradeable", description: "Can be modified with additional Lux for improvements." },
  { id: "trigger", label: "Trigger", description: "Activates automatically under certain conditions." }
];

// Asset-only tag library (separate from gear)
export const ASSET_TAGS = [
  { id: "gear-and-equipment",   label: "Gear & Equipment",   description: "Specialized tools, weapons, gadgets, magic items, and disguises." },
  { id: "vehicles",   label: "Vehicles & Mobility",   description: "Rides, mechs, gliders, animals." },
  { id: "ally",   label: "Allies & Favors",   description: "Temporary (or permanent) help from NPCs or Organizations." },
  { id: "territory",   label: "Territory",   description: "Control of zones or access." },
  { id: "limited",   label: "Limited",   description: "Asset contains a limited amount of uses." },
  { id: "special",   label: "Special Tools",   description: "One offs or items that cannot be easily replaced." },
  { id: "durable",   label: "Durable",   description: "Survives a job unless destroyed" },
  { id: "specialized",   label: "Specialized",   description: "Requires a particular skill or training to operate." },
  { id: "expendable",   label: "Expendable",   description: "Degrades with each use." }
];

export const GAMBIT_TIERS = [
  { id: "rookie", label: "Rookie", defaultCost: 1, costOptions: [1, 2] },
  { id: "trickDeck", label: "Trick Deck", defaultCost: 3 },
  { id: "aceInTheSleeve", label: "Ace in the Sleeve", defaultCost: 4 },
  { id: "allIn", label: "All In", defaultCost: 5 },
  { id: "crew", label: "Crew", defaultCost: 0 }
];

export const GAMBIT_TYPES = [
  { id: "social", label: "Social" },
  { id: "combat", label: "Combat" },
  { id: "infiltration", label: "Infiltration" },
  { id: "support", label: "Support" }
];

export const MOVE_TYPES = [
  { id: "combat", label: "Combat" },
  { id: "spark", label: "Spark" },
  { id: "utility", label: "Utility" }
];

export const MOVE_SUBTYPES = [
  { id: "bruiser", label: "Bruiser" },
  { id: "defensive", label: "Defensive" },
  { id: "duelist", label: "Duelist" },
  { id: "improvised-weapons", label: "Improvised Weapons" },
  { id: "melee", label: "Melee" },
  { id: "mobility", label: "Mobility" },
  { id: "ranged", label: "Ranged" },
  { id: "combat", label: "Combat" },
  { id: "healing", label: "Healing" },
  { id: "support", label: "Support" }
];

export const GAMBIT_TIER_COSTS = Object.fromEntries(
  GAMBIT_TIERS.map(tier => [tier.id, tier.defaultCost])
);

export const GAMBIT_TYPE_LABELS = Object.fromEntries(
  GAMBIT_TYPES.map(type => [type.id, type.label])
);

export const MOVE_TYPE_LABELS = Object.fromEntries(
  MOVE_TYPES.map(type => [type.id, type.label])
);

export const MOVE_SUBTYPE_LABELS = Object.fromEntries(
  MOVE_SUBTYPES.map(type => [type.id, type.label])
);

export function normalizeGambitTier(tier) {
  const value = String(tier ?? "rookie");
  const legacy = {
    trick: "trickDeck",
    "trick-deck": "trickDeck",
    ace: "aceInTheSleeve",
    "ace-in-the-sleeve": "aceInTheSleeve",
    final: "allIn",
    "final-hand": "allIn",
    "all-in": "allIn"
  };
  const normalized = legacy[value] ?? value;
  return GAMBIT_TIER_COSTS[normalized] !== undefined ? normalized : "rookie";
}

export function getGambitCostForTier(tier, cost = null) {
  const normalized = normalizeGambitTier(tier);
  if (normalized === "rookie") {
    const rookieCost = Number(cost);
    return [1, 2].includes(rookieCost) ? rookieCost : 1;
  }
  return GAMBIT_TIER_COSTS[normalized] ?? 1;
}

export function normalizeGambitType(type) {
  const value = String(type ?? "").trim();
  return GAMBIT_TYPE_LABELS[value] ? value : "";
}

export function normalizeMoveType(type) {
  const value = String(type ?? "").trim();
  return MOVE_TYPE_LABELS[value] ? value : "";
}

export function normalizeMoveSubtype(type) {
  const value = String(type ?? "").trim();
  return MOVE_SUBTYPE_LABELS[value] ? value : "";
}

export function getGambitPointsForLevel(level) {
  const lvl = Math.max(1, Math.min(12, Number(level) || 1));
  return Math.min(10, 4 + Math.floor(lvl / 2));
}

export function getGambitDeckSlotsForLevel(level) {
  const lvl = Math.max(1, Math.min(12, Number(level) || 1));
  return Math.min(4, 1 + Math.floor(lvl / 3));
}

/* Level Up Table
==============================================================================================================================================*/
export const LEVEL_TABLE = {
  1: {
    caps: { drawPool: 3, equipMax: 3, gambitPoints: 4, deckSlots: 1, tier: "rookie-only" },
    unlocks: { trickDeck: false, aceInSleeve: false, signaturePerk: false, finalHand: false, allTiers: false, dualClass: false },
    grants: { attributePoints: 0, moves: 2, sparkSlots: 0 },
    notes: "Choose your Guise, +2 Learned Moves."
  },
  2: {
    caps: { drawPool: 4, equipMax: 4, gambitPoints: 5, deckSlots: 1, tier: "rookie" },
    unlocks: { trickDeck: false, aceInSleeve: false, signaturePerk: false, finalHand: false, allTiers: false, dualClass: false },
    grants: { attributePoints: 0, moves: 1, sparkSlots: 1 },
    notes: "+1 Learned Move, +1 Spark Slot (casters)."
  },
  3: {
    caps: { drawPool: 4, equipMax: 4, gambitPoints: 5, deckSlots: 2, tier: "trick-deck-unlocked" },
    unlocks: { trickDeck: true, aceInSleeve: false, signaturePerk: false, finalHand: false, allTiers: false, dualClass: false },
    grants: { attributePoints: 1, moves: 1, sparkSlots: 0, expertise: 1 },
    notes: "+1 Attribute Point, may begin utilizing Trick Deck Gambits, +1 Learned Move, +1 Deck Slot, +1 Expertise."
  },
  4: {
    caps: { drawPool: 4, equipMax: 4, gambitPoints: 6, deckSlots: 2, tier: "trick-deck" },
    unlocks: { trickDeck: true, aceInSleeve: false, signaturePerk: false, finalHand: false, allTiers: false, dualClass: false },
    grants: { attributePoints: 0, moves: 1, sparkSlots: 1 },
    notes: "+1 Learned Move, +1 Spark Slot (casters)."
  },
  5: {
    caps: { drawPool: 5, equipMax: 5, gambitPoints: 6, deckSlots: 2, tier: "trick-deck" },
    unlocks: { trickDeck: true, aceInSleeve: false, signaturePerk: false, finalHand: false, allTiers: false, dualClass: false },
    grants: { attributePoints: 0, moves: 1, sparkSlots: 0 },
    notes: "+1 Learned Move."
  },
  6: {
    caps: { drawPool: 5, equipMax: 5, gambitPoints: 7, deckSlots: 3, tier: "ace-in-the-sleeve-unlocked" },
    unlocks: { trickDeck: true, aceInSleeve: true, signaturePerk: false, finalHand: false, allTiers: false, dualClass: true },
    grants: { attributePoints: 1, moves: 1, sparkSlots: 1, expertise: 1 },
    notes: "Dual Guise or +1 Attribute Point, +1 Learned Move, +1 Spark Slot (casters), may begin utilizing Ace in the Sleeve Gambits, +1 Deck Slot, +1 Expertise."
  },
  7: {
    caps: { drawPool: 5, equipMax: 5, gambitPoints: 7, deckSlots: 3, tier: "ace" },
    unlocks: { trickDeck: true, aceInSleeve: true, signaturePerk: true, finalHand: false, allTiers: false, dualClass: true },
    grants: { attributePoints: 0, moves: 1, sparkSlots: 0 },
    notes: "+1 Learned Move."
  },
  8: {
    caps: { drawPool: 6, equipMax: 6, gambitPoints: 8, deckSlots: 3, tier: "ace" },
    unlocks: { trickDeck: true, aceInSleeve: true, signaturePerk: true, finalHand: false, allTiers: false, dualClass: true },
    grants: { attributePoints: 0, moves: 1, sparkSlots: 1 },
    notes: "+1 Learned Move, +1 Spark Slot (casters)."
  },
  9: {
    caps: { drawPool: 6, equipMax: 6, gambitPoints: 8, deckSlots: 4, tier: "all-in-unlocked" },
    unlocks: { trickDeck: true, aceInSleeve: true, signaturePerk: true, finalHand: false, allTiers: false, dualClass: true },
    grants: { attributePoints: 1, moves: 1, sparkSlots: 0, expertise: 1 },
    notes: "May utilize All In Gambits, +1 Attribute Point, +1 Learned Move, +1 Deck Slot, +1 Expertise."
  },
  10: {
    caps: { drawPool: 6, equipMax: 6, gambitPoints: 9, deckSlots: 4, tier: "all-in" },
    unlocks: { trickDeck: true, aceInSleeve: true, signaturePerk: true, finalHand: true, allTiers: false, dualClass: true },
    grants: { attributePoints: 0, moves: 1, sparkSlots: 1 },
    notes: "+1 Learned Move, +1 Spark Slot (casters)."
  },
  11: {
    caps: { drawPool: 6, equipMax: 6, gambitPoints: 9, deckSlots: 4, tier: "all-in" },
    unlocks: { trickDeck: true, aceInSleeve: true, signaturePerk: true, finalHand: true, allTiers: true, dualClass: true },
    grants: { attributePoints: 0, moves: 1, sparkSlots: 0 },
    notes: "+1 Learned Move."
  },
  12: {
    caps: { drawPool: 6, equipMax: 6, gambitPoints: 10, deckSlots: 4, tier: "all-in" },
    unlocks: { trickDeck: true, aceInSleeve: true, signaturePerk: true, finalHand: true, allTiers: true, dualClass: true },
    grants: { attributePoints: 1, moves: 1, sparkSlots: 1, expertise: 1 },
    notes: "+1 Attribute Point, +1 Learned Move, +1 Spark Slot (casters), +1 Expertise."
  }
};

