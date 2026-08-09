// Midnight Gambit: Dedupe MG | Moves compendium
// Default is dry-run. Set DRY_RUN to false after reviewing the console output.

const PACK_ID = "midnight-gambit.moves";
const DRY_RUN = true;

const pack = game.packs.get(PACK_ID);
if (!game.user.isGM) {
  ui.notifications.error("Only a GM can dedupe the Moves compendium.");
  return;
}

if (!pack) {
  ui.notifications.error(`Could not find compendium pack: ${PACK_ID}`);
  return;
}

const wasLocked = pack.locked;
if (wasLocked) await pack.configure({ locked: false });

const docs = await pack.getDocuments();
const groups = new Map();

for (const doc of docs) {
  if (doc.type !== "move") continue;
  const key = doc.name.trim().toLowerCase();
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(doc);
}

function mgScoreMoveDoc(doc) {
  let score = 0;
  const subtypes = doc.system?.moveSubtypes;
  if (Array.isArray(subtypes) && subtypes.length) score += 100 + subtypes.length;
  if (doc.system?.teaser) score += 25;
  if (doc.system?.moveSubtype && doc.system.moveSubtype !== "combat") score += 10;
  if (doc.folder) score += 5;
  return score;
}

const duplicateGroups = [...groups.values()].filter(group => group.length > 1);
const removals = [];
const plan = [];

for (const group of duplicateGroups) {
  const ranked = [...group].sort((a, b) => {
    const scoreDiff = mgScoreMoveDoc(b) - mgScoreMoveDoc(a);
    if (scoreDiff !== 0) return scoreDiff;
    return String(b.id).localeCompare(String(a.id));
  });

  const keep = ranked[0];
  const remove = ranked.slice(1);
  removals.push(...remove);
  plan.push({
    name: keep.name,
    keep: keep.id,
    keepScore: mgScoreMoveDoc(keep),
    remove: remove.map(doc => ({
      id: doc.id,
      score: mgScoreMoveDoc(doc),
      moveSubtype: doc.system?.moveSubtype,
      moveSubtypes: doc.system?.moveSubtypes,
      teaser: doc.system?.teaser
    }))
  });
}

console.log("MG | Moves dedupe plan", {
  dryRun: DRY_RUN,
  duplicateGroups: duplicateGroups.length,
  documentsToRemove: removals.length,
  plan
});

if (DRY_RUN) {
  ui.notifications.info(
    `Moves dedupe dry run: ${duplicateGroups.length} duplicate names, ${removals.length} extras found. See console.`
  );
  if (wasLocked) await pack.configure({ locked: true });
  return;
}

for (const doc of removals) {
  await doc.delete();
}

if (wasLocked) await pack.configure({ locked: true });

ui.notifications.info(`Moves dedupe complete. Removed ${removals.length} duplicate move(s).`);
console.log("MG | Moves dedupe complete", {
  removed: removals.length,
  duplicateGroups: duplicateGroups.length
});
