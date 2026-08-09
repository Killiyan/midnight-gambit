const MG_LIBRARY_COMPENDIUM_SETTING = "libraryCompendiums";
const MG_BUILTIN_LIBRARY_PACKS = {
	move: "midnight-gambit.moves",
	gambit: "midnight-gambit.gambits"
};

function mgGetPackId(pack) {
	return String(pack?.collection ?? pack?.metadata?.id ?? "");
}

export function mgIsBuiltinLibraryPack(packOrId) {
	const id = typeof packOrId === "string" ? packOrId : mgGetPackId(packOrId);
	return Object.values(MG_BUILTIN_LIBRARY_PACKS).includes(id);
}

export function mgIsItemLibraryPack(pack) {
	return String(pack?.documentName ?? pack?.metadata?.type ?? pack?.metadata?.entity ?? "") === "Item";
}

export function mgCanToggleLibraryPack(pack) {
	return mgIsItemLibraryPack(pack) && !mgIsBuiltinLibraryPack(pack);
}

export function mgCanShowLibraryPackAction(pack) {
	return mgIsItemLibraryPack(pack);
}

export function mgGetLibraryCompendiumIds() {
	const ids = game.settings.get("midnight-gambit", MG_LIBRARY_COMPENDIUM_SETTING) || [];
	return Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
}

export function mgIsLibraryCompendium(pack) {
	const id = mgGetPackId(pack);
	return mgIsBuiltinLibraryPack(id) || mgGetLibraryCompendiumIds().includes(id);
}

export async function mgSetLibraryCompendium(pack, enabled) {
	const id = mgGetPackId(pack);
	if (!id || !mgCanToggleLibraryPack(pack)) return false;

	const ids = new Set(mgGetLibraryCompendiumIds());
	if (enabled) ids.add(id);
	else ids.delete(id);

	await game.settings.set("midnight-gambit", MG_LIBRARY_COMPENDIUM_SETTING, Array.from(ids));
	return true;
}

export async function mgSetCompendiumLibraryItems(pack, enabled = true) {
	if (!mgIsItemLibraryPack(pack) || typeof pack.getDocuments !== "function") return 0;

	const docs = await pack.getDocuments();
	const libraryDocs = docs.filter(item => ["move", "gambit"].includes(item?.type));
	let updated = 0;
	const updates = [];

	for (const item of libraryDocs) {
		if (item.system?.libraryEnabled === enabled) continue;
		updates.push({ _id: item.id, "system.libraryEnabled": enabled });
		updated += 1;
	}

	if (updates.length) {
		const wasLocked = pack.locked;
		try {
			if (wasLocked) await pack.configure({ locked: false });
			await Item.updateDocuments(updates, { pack: mgGetPackId(pack) });
		} finally {
			if (wasLocked) await pack.configure({ locked: true });
		}
	}

	return updated;
}

export async function mgToggleLibraryCompendium(pack) {
	const enabled = !mgIsLibraryCompendium(pack);
	return mgSetLibraryCompendium(pack, enabled);
}

function mgGetPackForKind(kind) {
	const id = MG_BUILTIN_LIBRARY_PACKS[kind];
	if (!id) return null;
	return game.packs.get(id)
		?? game.packs.find(p => p.metadata?.system === "midnight-gambit" && p.metadata?.name === `${kind}s`)
		?? null;
}

function mgIsLooseLibraryItem(item, kind) {
	if (!item || item.parent || item.type !== kind) return false;
	return item.system?.libraryEnabled === true;
}

function mgIsPackLibraryItem(item, kind, pack) {
	if (!item || item.type !== kind) return false;
	if (mgIsBuiltinLibraryPack(pack)) return true;
	return item.system?.libraryEnabled === true;
}

function mgDedupeDocuments(documents) {
	const seen = new Set();
	const out = [];

	for (const document of documents) {
		const key = String(document?.uuid ?? document?.collection ?? document?.id ?? "");
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(document);
	}

	return out;
}

export async function mgGetLibraryDocuments(kind) {
	const documents = [];
	const packs = [];
	const builtinPack = mgGetPackForKind(kind);
	if (builtinPack) packs.push(builtinPack);

	for (const id of mgGetLibraryCompendiumIds()) {
		const pack = game.packs.get(id);
		if (pack && mgCanToggleLibraryPack(pack)) packs.push(pack);
	}

	for (const pack of mgDedupeDocuments(packs)) {
		try {
			const docs = await pack.getDocuments();
			documents.push(...docs.filter(item => mgIsPackLibraryItem(item, kind, pack)));
		} catch (err) {
			console.warn("MG Library | Could not read library compendium.", { pack: mgGetPackId(pack), err });
		}
	}

	documents.push(...Array.from(game.items ?? []).filter(item => mgIsLooseLibraryItem(item, kind)));
	return mgDedupeDocuments(documents);
}
