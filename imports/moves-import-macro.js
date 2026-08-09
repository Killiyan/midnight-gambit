// Midnight Gambit: Import Moves into the Moves compendium
// Foundry VTT v11-ish friendly
// Reads imports/moves-import.json and creates/updates Move items in MG | Moves.

const PACK_ID = "midnight-gambit.moves";
const JSON_PATH = "systems/midnight-gambit/imports/moves-import.json";

const MOVE_TYPE_IMAGES = {
  combat: "systems/midnight-gambit/assets/images/moves-combat.png",
  spark: "systems/midnight-gambit/assets/images/moves-spark.png",
  utility: "systems/midnight-gambit/assets/images/moves-utility.png"
};

const FALLBACK_MOVE_IMAGE = "systems/midnight-gambit/assets/images/moves-utility.png";

const MOVE_TYPE_IDS_BY_LABEL = {
  Combat: "combat",
  Spark: "spark",
  Utility: "utility"
};

const MOVE_SUBTYPE_IDS_BY_LABEL = {
  Ranged: "ranged",
  Duelist: "duelist",
  Bruiser: "bruiser",
  Mobility: "mobility",
  "Improvised Weapons": "improvised-weapons",
  Defensive: "defensive",
  Combat: "skirmish",
  Skirmish: "skirmish",
  Healing: "healing",
  Support: "support",
  General: "general"
};

const MOVE_SUBTYPE_LABELS_BY_ID = {
  ranged: "Ranged",
  duelist: "Duelist",
  bruiser: "Bruiser",
  mobility: "Mobility",
  "improvised-weapons": "Improvised Weapons",
  defensive: "Defensive",
  combat: "Skirmish",
  skirmish: "Skirmish",
  healing: "Healing",
  support: "Support",
  general: "General"
};

function mgSlug(value, fallback = "general") {
  const slug = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}

function mgNormalizeFolderName(value, fallback = "Moves") {
  return String(value ?? fallback).trim() || fallback;
}

function mgGetMoveTypeId(labelOrId) {
  const value = mgNormalizeFolderName(labelOrId, "Utility");
  return MOVE_TYPE_IDS_BY_LABEL[value] || mgSlug(value, "utility");
}

function mgGetMoveSubtypeId(labelOrId) {
  const value = mgNormalizeFolderName(labelOrId, "General");
  return MOVE_SUBTYPE_IDS_BY_LABEL[value] || mgSlug(value, "general");
}

function mgGetMoveSubtypeLabel(subtypeId) {
  return MOVE_SUBTYPE_LABELS_BY_ID[subtypeId] || mgNormalizeFolderName(subtypeId, "General");
}

function mgNormalizeMoveSubtypes(data, primarySubtypeId) {
  const rawSubtypes = Array.isArray(data.system?.moveSubtypes)
    ? data.system.moveSubtypes
    : [];
  const normalized = rawSubtypes
    .map(id => mgGetMoveSubtypeId(id))
    .filter(Boolean);

  if (!normalized.includes(primarySubtypeId)) normalized.unshift(primarySubtypeId);
  return [...new Set(normalized)];
}

function mgGetMoveImage(moveTypeId) {
  return MOVE_TYPE_IMAGES[String(moveTypeId ?? "").trim()] || FALLBACK_MOVE_IMAGE;
}

function mgGetPackFolderParentId(folder) {
  return folder?.folder?.id ?? folder?.folder ?? null;
}

async function mgGetOrCreatePackFolder(name, parentId = null) {
  const folderName = mgNormalizeFolderName(name);
  const normalizedParent = parentId || null;
  let folder = pack.folders?.find?.(f =>
    f.name === folderName &&
    (mgGetPackFolderParentId(f) || null) === normalizedParent
  );

  if (!folder) {
    folder = await Folder.create({
      name: folderName,
      type: "Item",
      sorting: "a",
      folder: normalizedParent
    }, { pack: pack.collection });
  }

  return folder;
}

if (!game.user.isGM) {
  ui.notifications.error("Only a GM can import into the system compendium.");
  return;
}

const pack = game.packs.get(PACK_ID);
if (!pack) {
  ui.notifications.error(`Could not find compendium pack: ${PACK_ID}`);
  return;
}

const wasLocked = pack.locked;
if (wasLocked) await pack.configure({ locked: false });

let moves = [];
try {
  const response = await fetch(JSON_PATH);
  if (!response.ok) throw new Error(`Could not fetch ${JSON_PATH}. Status: ${response.status}`);
  moves = await response.json();
} catch (err) {
  console.error("MG | Failed to read Move import JSON:", err);
  ui.notifications.error(`Failed to read ${JSON_PATH}. Check the file path.`);
  return;
}

if (!Array.isArray(moves)) {
  ui.notifications.error("Import JSON must be an array of Move item objects.");
  return;
}

await pack.getIndex({ fields: ["name", "type", "folder"] });
const index = pack.index ?? [];

let created = 0;
let updated = 0;
let skipped = 0;

for (const raw of moves) {
  try {
    const data = foundry.utils.deepClone(raw);
    if (!data.name || data.type !== "move") {
      skipped++;
      console.warn("MG | Skipped invalid Move import entry:", data);
      continue;
    }

    const moveTypeLabel = mgNormalizeFolderName(data.folder ?? data.system?.moveType, "Utility");
    const moveTypeId = mgGetMoveTypeId(data.system?.moveType ?? moveTypeLabel);
    const primarySubtypeId = mgGetMoveSubtypeId(data.system?.moveSubtype ?? data.subfolder);
    const moveSubtypes = mgNormalizeMoveSubtypes(data, primarySubtypeId);
    const moveSubtypeLabel = mgGetMoveSubtypeLabel(primarySubtypeId);

    const parentFolder = await mgGetOrCreatePackFolder(moveTypeLabel, null);
    const childFolder = await mgGetOrCreatePackFolder(moveSubtypeLabel, parentFolder.id);

    data.folder = childFolder.id;
    data.type = "move";
    data.img = mgGetMoveImage(moveTypeId);
    data.system ??= {};
    data.system.description ??= "";
    data.system.teaser ??= "";
    data.system.tags = Array.isArray(data.system.tags) ? data.system.tags : [];
    data.system.moveType = moveTypeId;
    data.system.moveSubtype = primarySubtypeId;
    data.system.moveSubtypes = moveSubtypes;
    data.system.learned = false;
    data.system.npcMove = false;
    data.system.npcSignature = false;
    data.system.isSignature = false;

    const existing = index.find(entry =>
      entry.type === "move" &&
      entry.name === data.name
    );

    if (existing?._id) {
      const doc = await pack.getDocument(existing._id);
      await doc.update({
        img: data.img,
        folder: childFolder.id,
        "system.description": data.system.description,
        "system.teaser": data.system.teaser,
        "system.tags": data.system.tags,
        "system.moveType": data.system.moveType,
        "system.moveSubtype": data.system.moveSubtype,
        "system.moveSubtypes": data.system.moveSubtypes,
        "system.learned": false,
        "system.npcMove": false,
        "system.npcSignature": false,
        "system.isSignature": false
      });
      updated++;
    } else {
      await Item.create(data, { pack: pack.collection });
      created++;
    }
  } catch (err) {
    skipped++;
    console.error("MG | Failed to import Move:", raw, err);
  }
}

if (wasLocked) await pack.configure({ locked: true });

ui.notifications.info(`Moves import complete. Created: ${created}, Updated: ${updated}, Skipped: ${skipped}.`);
console.log("MG | Moves import complete.", { created, updated, skipped, pack: PACK_ID });
