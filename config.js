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

/* Level Up Table
==============================================================================================================================================*/
export const LEVEL_TABLE = {
  1: {
    caps: { drawPool: 3, equipMax: 3, tier: "rookie-only" },
    unlocks: { trickDeck: false, aceInSleeve: false, signaturePerk: false, finalHand: false, allTiers: false, dualClass: false },
    grants: { attributePoints: 0, skillPoints: 1, moves: 1, sparkSlots: 0 },
    notes: "Choose your Guise, +1 Skill Point, +1 Move."
  },
  2: {
    caps: { drawPool: 4, equipMax: 4, tier: "rookie" },
    unlocks: { trickDeck: false, aceInSleeve: false, signaturePerk: false, finalHand: false, allTiers: false, dualClass: false },
    grants: { attributePoints: 1, skillPoints: 1, moves: 1, sparkSlots: 1 }, // sparkSlots applied only if caster
    notes: "+1 Attribute, +1 Skill, +1 Move, +1 Spark Slot (casters)."
  },
  3: {
    caps: { drawPool: 4, equipMax: 4, tier: "trick-deck-unlocked" },
    unlocks: { trickDeck: true, aceInSleeve: false, signaturePerk: false, finalHand: false, allTiers: false, dualClass: false },
    grants: { attributePoints: 0, skillPoints: 1, moves: 1, sparkSlots: 0 },
    notes: "May begin crafting Trick Decks. +1 Skill, +1 Move."
  },
  4: {
    caps: { drawPool: 4, equipMax: 4, tier: "trick-deck" },
    unlocks: { trickDeck: true, aceInSleeve: false, signaturePerk: false, finalHand: false, allTiers: false, dualClass: false },
    grants: { attributePoints: 1, skillPoints: 1, moves: 1, sparkSlots: 1 },
    notes: "+1 Attribute, +1 Skill, +1 Move, +1 Spark Slot (casters)."
  },
  5: {
    caps: { drawPool: 5, equipMax: 5, tier: "trick-deck" },
    unlocks: { trickDeck: true, aceInSleeve: false, signaturePerk: false, finalHand: false, allTiers: false, dualClass: false },
    grants: { attributePoints: 0, skillPoints: 1, moves: 1, sparkSlots: 0 },
    notes: "+1 Skill, +1 Move."
  },
  6: {
    caps: { drawPool: 5, equipMax: 5, tier: "ace-in-the-sleeve-unlocked" },
    unlocks: { trickDeck: true, aceInSleeve: true, signaturePerk: false, finalHand: false, allTiers: false, dualClass: true },
    grants: { attributePoints: 1, skillPoints: 1, moves: 1, sparkSlots: 1 },
    notes: "Dual Class unlocked. +1 Attribute, +1 Skill, +1 Move, +1 Spark Slot (casters)."
  },
  7: {
    caps: { drawPool: 5, equipMax: 5, tier: "ace" },
    unlocks: { trickDeck: true, aceInSleeve: true, signaturePerk: true, finalHand: false, allTiers: false, dualClass: true },
    grants: { attributePoints: 0, skillPoints: 1, moves: 1, sparkSlots: 0, signaturePerk: 1 },
    notes: "Signature Perk. +1 Skill, +1 Move."
  },
  8: {
    caps: { drawPool: 6, equipMax: 6, tier: "ace" },
    unlocks: { trickDeck: true, aceInSleeve: true, signaturePerk: true, finalHand: false, allTiers: false, dualClass: true },
    grants: { attributePoints: 1, skillPoints: 1, moves: 1, sparkSlots: 1 },
    notes: "+1 Attribute, +1 Skill, +1 Move, +1 Spark Slot (casters)."
  },
  9: {
    caps: { drawPool: 6, equipMax: 6, tier: "ace" },
    unlocks: { trickDeck: true, aceInSleeve: true, signaturePerk: true, finalHand: false, allTiers: false, dualClass: true },
    grants: { attributePoints: 0, skillPoints: 1, moves: 1, sparkSlots: 0 },
    notes: "+1 Skill, +1 Move."
  },
  10: {
    caps: { drawPool: 6, equipMax: 6, tier: "final-hand-unlocked" },
    unlocks: { trickDeck: true, aceInSleeve: true, signaturePerk: true, finalHand: true, allTiers: false, dualClass: true },
    grants: { attributePoints: 1, skillPoints: 1, moves: 1, sparkSlots: 1, finalHandDiscoverable: 1 },
    notes: "Final Hands can be discovered. +1 Attribute, +1 Skill, +1 Move, +1 Spark Slot (casters)."
  },
  11: {
    caps: { drawPool: 6, equipMax: 6, tier: "all-tiers" },
    unlocks: { trickDeck: true, aceInSleeve: true, signaturePerk: true, finalHand: true, allTiers: true, dualClass: true },
    grants: { attributePoints: 0, skillPoints: 1, moves: 1, sparkSlots: 0 },
    notes: "+1 Skill, +1 Move."
  },
  12: {
    caps: { drawPool: 6, equipMax: 6, tier: "all-tiers" },
    unlocks: { trickDeck: true, aceInSleeve: true, signaturePerk: true, finalHand: true, allTiers: true, dualClass: true },
    grants: { attributePoints: 1, skillPoints: 1, moves: 1, sparkSlots: 1 },
    notes: "+1 Attribute, +1 Skill, +1 Move, +1 Spark Slot (casters)."
  }
};

