// Paste into a Foundry Script macro and run as GM after reloading the system.
// Writes only teaser fields on existing entries in MG | Gambits.
// Re-running replaces matching teasers with the text in the import JSON files.
// Names must match (ignoring case, spacing, and curly apostrophes).
if (!game.user.isGM) {
  ui.notifications.error("Only a GM can populate Gambit teasers.");
  return;
}

const pack = game.packs.get("midnight-gambit.gambits");
if (!pack) {
  ui.notifications.error("Could not find the Gambits compendium.");
  return;
}

const normalizeName = name => String(name ?? "").normalize("NFKC")
  .replace(/[‘’]/g, "'").trim().toLowerCase().replace(/\s+/g, " ");
const files = ["rookie", "trick-deck", "ace-in-the-sleeve", "all-in"];
const wasLocked = pack.locked;
let unlocked = false;
try {
  // Validate all source files before unlocking or writing anything.
  const sources = await Promise.all(files.map(async tier => {
    const path = `systems/midnight-gambit/imports/${tier}-gambits-import.json`;
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not read ${path}: ${response.status}`);
    const entries = await response.json();
    if (!Array.isArray(entries)) throw new Error(`Expected an array in ${path}`);
    return entries;
  }));
  const teasers = new Map();
  for (const entry of sources.flat()) {
    const name = normalizeName(entry.name);
    const teaser = entry.system?.teaser;
    if (entry.type !== "gambit" || !name || typeof teaser !== "string"
      || !teaser.trim() || teaser.length > 64 || teasers.has(name)) {
      throw new Error(`Invalid or duplicate Gambit teaser: ${entry.name}`);
    }
    teasers.set(name, teaser);
  }

  const docs = await pack.getDocuments();
  const matched = new Set();
  const unmatched = [];
  const updates = [];
  for (const doc of docs) {
    if (doc.type !== "gambit") continue;
    const name = normalizeName(doc.name);
    if (!teasers.has(name)) {
      unmatched.push(doc.name);
      continue;
    }
    matched.add(name);
    const teaser = teasers.get(name);
    if (doc.system?.teaser !== teaser) updates.push({ _id: doc.id, "system.teaser": teaser });
  }

  if (updates.length) {
    if (wasLocked) {
      await pack.configure({ locked: false });
      unlocked = true;
    }
    await Item.updateDocuments(updates, { pack: pack.collection });
  }
  const missing = [...teasers.keys()].filter(name => !matched.has(name));
  console.log("MG | Gambit teaser results", { updated: updates.length, unmatched, missing });
  const report = `Gambit teasers: ${updates.length} updated, ${matched.size} matched, `
    + `${unmatched.length} compendium entries without source text, ${missing.length} source entries absent from the compendium.`;
  if (unmatched.length || missing.length) ui.notifications.warn(`${report} See the console for names.`);
  else ui.notifications.info(`${report} Reopen the Gambit Library to see the changes.`);
} catch (error) {
  console.error("MG | Gambit teaser population failed", error);
  ui.notifications.error("Gambit teaser population failed. See the console for details.");
} finally {
  if (unlocked) await pack.configure({ locked: true });
}
