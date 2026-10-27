// Paste into a Foundry Script macro and run as GM.
// Fills missing Crew Gambit teasers in MG | Gambits from their descriptions.
// Existing teasers are preserved so manual edits survive repeat runs.
if (!game.user.isGM) {
  ui.notifications.error("Only a GM can populate Crew Gambit teasers.");
  return;
}

const pack = game.packs.get("midnight-gambit.gambits");
if (!pack) {
  ui.notifications.error("Could not find the Gambits compendium.");
  return;
}

function makeTeaser(description) {
  const html = document.createElement("div");
  html.innerHTML = String(description ?? "");
  html.querySelectorAll("script, style").forEach(node => node.remove());
  // Keep adjacent paragraphs and list entries from running together.
  html.querySelectorAll("p, div, li, br, h1, h2, h3, h4").forEach(node => {
    node.append(document.createTextNode(" "));
  });
  const text = String(html.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const firstSentence = text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;
  if (firstSentence.length <= 64) return firstSentence;
  // Prefer a complete introductory clause; otherwise show a short excerpt.
  const clause = firstSentence.split(/\s*[;:—]\s*/)[0];
  if (clause.length >= 16 && clause.length <= 64) return clause;
  const excerpt = firstSentence.slice(0, 63).replace(/\s+\S*$/, "").trimEnd();
  return `${excerpt || firstSentence.slice(0, 63)}…`;
}

const wasLocked = pack.locked;
let unlocked = false;
try {
  const docs = await pack.getDocuments();
  const updates = [];
  const preview = [];
  const emptyDescriptions = [];
  for (const doc of docs) {
    if (doc.type !== "gambit" || String(doc.system?.tier ?? "").trim().toLowerCase() !== "crew") continue;
    if (String(doc.system?.teaser ?? "").trim()) continue;
    const teaser = makeTeaser(doc.system?.description);
    if (!teaser) {
      emptyDescriptions.push(doc.name);
      continue;
    }
    updates.push({ _id: doc.id, "system.teaser": teaser });
    preview.push({ name: doc.name, teaser });
  }

  if (updates.length) {
    if (wasLocked) {
      await pack.configure({ locked: false });
      unlocked = true;
    }
    await Item.updateDocuments(updates, { pack: pack.collection });
  }
  console.table(preview);
  if (emptyDescriptions.length) console.warn("MG | Crew Gambits without descriptions", emptyDescriptions);
  ui.notifications.info(`Crew Gambit teasers: ${updates.length} populated, ${emptyDescriptions.length} missing descriptions. Reopen the Crew Gambit Library to see the changes.`);
} catch (error) {
  console.error("MG | Crew Gambit teaser population failed", error);
  ui.notifications.error("Crew Gambit teaser population failed. See the console for details.");
} finally {
  if (unlocked) await pack.configure({ locked: true });
}
