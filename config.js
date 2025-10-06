export const ITEM_TAGS = [
  { id: "close", label: "Close", description: "Only damages nearby enemies." },
  { id: "short-range", label: "Short Range", description: "Effects targets that are at a short to medium range." },
  { id: "mid-range", label: "Mid Range", description: "Effects targets at a mid to long range." },
  { id: "long-range", label: "Long Range", description: "Efects targets at a distance." },
  { id: "notorious", label: "Notorious", description: "Raises Heat when wielded." },
  { id: "single-use", label: "Single Use", description: "Expended after one use unless recovered or preserved." },
  { id: "durable", label: "Durable", description: "Survives jobs unless destroyed; higher cost." },
  { id: "specialized", label: "Specialized", description: "Requires a particular skill or training to use" },
  { id: "limited", label: "Limited", description: "Can only be used in specific scenarios (innfffiltration, combat, etc)" },
  { id: "expendable", label: "Expendable", description: "Degrades with each use - Destroyed on a 1-3 result." },
  { id: "portable", label: "Portable", description: "Small, Concealable, or easy to stash/redeploy" },
  { id: "stationary", label: "Stationary", description: "Can't be moved without effort or cost (turrets, or heavy equipment)." },
  { id: "enchanted", label: "Enchanted", description: "Has magical or arcane effects." },
  { id: "prototype", label: "Prototype", description: "Unstable, experimental - Gains eadge but risks backfire on a 1-3." },
  { id: "repurposed", label: "Repurposed", description: "Clearly modified from original purpose. (e.g. a cargo hauler repurposed into a combat rig." },
  { id: "cursed", label: "Cursed", description: "Use comes with a cost, consequence, or dark hitch." },
  { id: "sentient", label: "Sentient", description: "Has a personality or autonomy - needs coaxing or control." },
  { id: "upgradeable", label: "Upgradeable", description: "Can be modified with additional Lux for improvements." },
  { id: "linked", label: "Linked", description: "Connected to another Asset (e.g. a drone and it's controller)." },
  { id: "clocked", label: "Clocked", description: "Comes with a built-in usage or stability clock (e.g. how long you can use it until it overheats, breaks, or stops working)." },
  { id: "trigger", label: "Trigger", description: "Activates automatically under certain conditions." },
  { id: "gambit-sync", label: "Gambit-Sync", description: "Interacts with Gambits (e.g. rereshes a Gambit or grants a Crew Gambit)." },
  { id: "personal", label: "Personal", description: "Bound to a single character with no shared use." },
  { id: "crew", label: "Crew", description: "Shared by the group; can be used or stored in the Hideout." },
  { id: "faction-bound", label: "Faction-Bound", description: "Gained from a ffaction - comes with a price, a favor owed, ore rescrtictions on use." },
  { id: "licensed", label: "Licensed", description: "Required permits, registrations, or cover identities to use." },
  { id: "illegal", label: "Illegal", description: "Possession iteself causes heat in certain areas." },
];

// Asset-only tag library (separate from gear)
export const ASSET_TAGS = [
  { id: "contact",   label: "Contact",   description: "Reliable NPC resource." },
  { id: "license",   label: "License",   description: "Permit, charter, deed." },
  { id: "vehicle",   label: "Vehicle",   description: "Transport the crew controls." },
  { id: "stash",     label: "Stash",     description: "Hidden cache or vault." },
  { id: "leverage",  label: "Leverage",  description: "Debt, favor, blackmail." },
  { id: "map",       label: "Map",       description: "Plans or layout intel." },
  { id: "rumor",     label: "Rumor",     description: "Lead or clue; needs follow-up." },
  { id: "safehouse", label: "Safehouse", description: "Secure spot; limited capacity." }
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
    caps: { drawPool: 4, equipMax: 3, tier: "rookie" },
    unlocks: { trickDeck: false, aceInSleeve: false, signaturePerk: false, finalHand: false, allTiers: false, dualClass: false },
    grants: { attributePoints: 1, skillPoints: 1, moves: 1, sparkSlots: 1 }, // sparkSlots applied only if caster
    notes: "+1 Attribute, +1 Skill, +1 Move, +1 Spark Slot (casters)."
  },
  3: {
    caps: { drawPool: 4, equipMax: 3, tier: "trick-deck-unlocked" },
    unlocks: { trickDeck: true, aceInSleeve: false, signaturePerk: false, finalHand: false, allTiers: false, dualClass: false },
    grants: { attributePoints: 0, skillPoints: 1, moves: 1, sparkSlots: 0 },
    notes: "May begin crafting Trick Decks. +1 Skill, +1 Move."
  },
  4: {
    caps: { drawPool: 4, equipMax: 3, tier: "trick-deck" },
    unlocks: { trickDeck: true, aceInSleeve: false, signaturePerk: false, finalHand: false, allTiers: false, dualClass: false },
    grants: { attributePoints: 1, skillPoints: 1, moves: 1, sparkSlots: 1 },
    notes: "+1 Attribute, +1 Skill, +1 Move, +1 Spark Slot (casters)."
  },
  5: {
    caps: { drawPool: 5, equipMax: 3, tier: "trick-deck" },
    unlocks: { trickDeck: true, aceInSleeve: false, signaturePerk: false, finalHand: false, allTiers: false, dualClass: false },
    grants: { attributePoints: 0, skillPoints: 1, moves: 1, sparkSlots: 0 },
    notes: "+1 Skill, +1 Move."
  },
  6: {
    caps: { drawPool: 5, equipMax: 4, tier: "ace-in-the-sleeve-unlocked" },
    unlocks: { trickDeck: true, aceInSleeve: true, signaturePerk: false, finalHand: false, allTiers: false, dualClass: true },
    grants: { attributePoints: 1, skillPoints: 1, moves: 1, sparkSlots: 1 },
    notes: "Dual Class unlocked. +1 Attribute, +1 Skill, +1 Move, +1 Spark Slot (casters)."
  },
  7: {
    caps: { drawPool: 5, equipMax: 4, tier: "ace" },
    unlocks: { trickDeck: true, aceInSleeve: true, signaturePerk: true, finalHand: false, allTiers: false, dualClass: true },
    grants: { attributePoints: 0, skillPoints: 1, moves: 1, sparkSlots: 0, signaturePerk: 1 },
    notes: "Signature Perk. +1 Skill, +1 Move."
  },
  8: {
    caps: { drawPool: 6, equipMax: 4, tier: "ace" },
    unlocks: { trickDeck: true, aceInSleeve: true, signaturePerk: true, finalHand: false, allTiers: false, dualClass: true },
    grants: { attributePoints: 1, skillPoints: 1, moves: 1, sparkSlots: 1 },
    notes: "+1 Attribute, +1 Skill, +1 Move, +1 Spark Slot (casters)."
  },
  9: {
    caps: { drawPool: 7, equipMax: 4, tier: "ace" },
    unlocks: { trickDeck: true, aceInSleeve: true, signaturePerk: true, finalHand: false, allTiers: false, dualClass: true },
    grants: { attributePoints: 0, skillPoints: 1, moves: 1, sparkSlots: 0 },
    notes: "+1 Skill, +1 Move."
  },
  10: {
    caps: { drawPool: 8, equipMax: 5, tier: "final-hand-unlocked" },
    unlocks: { trickDeck: true, aceInSleeve: true, signaturePerk: true, finalHand: true, allTiers: false, dualClass: true },
    grants: { attributePoints: 1, skillPoints: 1, moves: 1, sparkSlots: 1, finalHandDiscoverable: 1 },
    notes: "Final Hands can be discovered. +1 Attribute, +1 Skill, +1 Move, +1 Spark Slot (casters)."
  },
  11: {
    caps: { drawPool: 8, equipMax: 5, tier: "all-tiers" },
    unlocks: { trickDeck: true, aceInSleeve: true, signaturePerk: true, finalHand: true, allTiers: true, dualClass: true },
    grants: { attributePoints: 0, skillPoints: 1, moves: 1, sparkSlots: 0 },
    notes: "+1 Skill, +1 Move."
  },
  12: {
    caps: { drawPool: 8, equipMax: 5, tier: "all-tiers" },
    unlocks: { trickDeck: true, aceInSleeve: true, signaturePerk: true, finalHand: true, allTiers: true, dualClass: true },
    grants: { attributePoints: 1, skillPoints: 1, moves: 1, sparkSlots: 1 },
    notes: "+1 Attribute, +1 Skill, +1 Move, +1 Spark Slot (casters)."
  }
};

