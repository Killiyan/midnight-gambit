const MG_COMPENDIUM_IMAGES = {
  "midnight-gambit.guises": "systems/midnight-gambit/assets/images/compendium-guises.png",
  "midnight-gambit.gambits": "systems/midnight-gambit/assets/images/compendium-gambits.png",
  "midnight-gambit.moves": "systems/midnight-gambit/assets/images/compendium-moves.png",
  "midnight-gambit.items": "systems/midnight-gambit/assets/images/compendium-items.png"
};

export function mgGetCompendiumCardImage(pack) {
	const metadata = pack?.metadata ?? {};
	const ids = [
		pack?.collection,
		metadata.id,
		metadata.package && metadata.name ? `${metadata.package}.${metadata.name}` : null
	].map(id => String(id ?? ""));

	const image = game.settings.get("midnight-gambit", "compendiumLibraryConfig")?.[ids[0]]?.image;
	return image || metadata.banner || ids.map(id => MG_COMPENDIUM_IMAGES[id]).find(Boolean)
		|| "systems/midnight-gambit/assets/images/items.jpg";
}

const MG_LIBRARY_COMPENDIUM_SETTING = "libraryCompendiums";
const MG_EXCLUDED_LIBRARY_COMPENDIUM_SETTING = "excludedLibraryCompendiums";
const MG_BUILTIN_LIBRARY_PACKS = {
	move: "midnight-gambit.moves",
	gambit: "midnight-gambit.gambits",
	inventory: "midnight-gambit.items"
};

export const MG_COMPENDIUM_CATEGORIES = [
	{ id: "general", label: "Items", types: null, library: "" },
	{ id: "shop", label: "Shop", types: ["weapon", "armor", "misc", "asset"], library: "Items Library" },
	{ id: "moves", label: "Moves", types: ["move"], library: "Moves Library" },
	{ id: "gambits", label: "Gambits", types: ["gambit"], library: "Gambit Library" },
	{ id: "guises", label: "Guises", types: ["guise"], library: "" }
];
const MG_FIXED_CATEGORIES = {
	"midnight-gambit.items": "shop",
	"midnight-gambit.moves": "moves",
	"midnight-gambit.gambits": "gambits",
	"midnight-gambit.guises": "guises"
};

export function mgGetCompendiumLibraryConfig(pack) {
	const id = mgGetPackId(pack);
	const saved = game.settings.get("midnight-gambit", "compendiumLibraryConfig")?.[id] ?? {};
	const category = MG_FIXED_CATEGORIES[id] ?? saved.category ?? "general";
	return { category, image: saved.image || "", icon: saved.icon || "fa-solid fa-store", fixed: Boolean(MG_FIXED_CATEGORIES[id]) };
}

export function mgGetCompendiumCategory(pack) {
	const id = mgGetCompendiumLibraryConfig(pack).category;
	return MG_COMPENDIUM_CATEGORIES.find(category => category.id === id) ?? MG_COMPENDIUM_CATEGORIES[0];
}

export async function mgSaveCompendiumLibraryConfig(pack, { category, icon }) {
	if (!game.user.isGM || !mgIsItemLibraryPack(pack)) throw new Error("Only a GM can configure an Item compendium.");
	const current = mgGetCompendiumLibraryConfig(pack);
	if (current.fixed) category = current.category;
	const definition = MG_COMPENDIUM_CATEGORIES.find(entry => entry.id === category);
	if (!definition) throw new Error("Choose a valid compendium category.");
	if (definition.types) {
		const index = await pack.getIndex({ fields: ["type"] });
		const invalid = Array.from(index).filter(item => !definition.types.includes(item.type));
		if (invalid.length) throw new Error(`This compendium contains ${invalid.length} incompatible item(s). Keep it General or move those items first.`);
	}
	icon = String(icon || current.icon).trim();
	if (!/^fa-[a-z0-9-]+(?: fa-[a-z0-9-]+){1,5}$/.test(icon)) throw new Error("Use Font Awesome icon classes, such as fa-solid fa-store.");
	const settings = { ...(game.settings.get("midnight-gambit", "compendiumLibraryConfig") ?? {}) };
	settings[mgGetPackId(pack)] = { ...settings[mgGetPackId(pack)], category, icon };
	await game.settings.set("midnight-gambit", "compendiumLibraryConfig", settings);
}

// Presentation can change independently of a compendium's fixed content type.
export async function mgSaveCompendiumAppearance(pack, { image, icon, label }) {
	if (!game.user.isGM) throw new Error("Only a GM can edit compendium appearance.");
	const id = mgGetPackId(pack);
	if (!id) throw new Error("Compendium not found.");
	const settings = { ...(game.settings.get("midnight-gambit", "compendiumLibraryConfig") ?? {}) };
	const config = { ...settings[id], image: String(image ?? "").trim() };
	if (label !== undefined) {
		label = String(label).trim();
		if (!label) throw new Error("Enter a compendium name.");
		config.label = label;
	}
	if (mgIsItemLibraryPack(pack) && mgGetCompendiumLibraryConfig(pack).category === "shop" && icon !== undefined) {
		icon = String(icon).trim();
		if (!/^fa-[a-z0-9-]+(?: fa-[a-z0-9-]+){1,5}$/.test(icon)) throw new Error("Use Font Awesome icon classes, such as fa-solid fa-store.");
		config.icon = icon;
	}
	settings[id] = config;
	await game.settings.set("midnight-gambit", "compendiumLibraryConfig", settings);
}

export function mgGetCompendiumLabel(pack) {
	return game.settings.get("midnight-gambit", "compendiumLibraryConfig")?.[mgGetPackId(pack)]?.label
		|| pack?.metadata?.label || pack?.title || pack?.collection || "Compendium";
}

// Apply saved display names to Foundry's own compendium windows and directory, too.
function mgApplyCompendiumNames() {
	for (const pack of game.packs ?? []) {
		const label = game.settings.get("midnight-gambit", "compendiumLibraryConfig")?.[mgGetPackId(pack)]?.label;
		if (!label || pack.metadata.label === label) continue;
		pack.metadata.label = label;
		pack.render(false);
	}
}
Hooks.once("ready", mgApplyCompendiumNames);

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
	return mgIsItemLibraryPack(pack) && Boolean(mgGetCompendiumCategory(pack).library);
}

export function mgCanShowLibraryPackAction(pack) {
	return mgCanToggleLibraryPack(pack);
}

export function mgGetLibraryCompendiumIds() {
	const ids = game.settings.get("midnight-gambit", MG_LIBRARY_COMPENDIUM_SETTING) || [];
	return Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
}

export function mgIsLibraryCompendium(pack) {
	if (!mgIsItemLibraryPack(pack) || !mgGetCompendiumCategory(pack).library) return false;
	const id = mgGetPackId(pack);
	const excluded = game.settings.get("midnight-gambit", MG_EXCLUDED_LIBRARY_COMPENDIUM_SETTING) || [];
	return !excluded.includes(id) && (mgIsBuiltinLibraryPack(id) || mgGetLibraryCompendiumIds().includes(id));
}

export async function mgSetLibraryCompendium(pack, enabled) {
	const id = mgGetPackId(pack);
	if (!id || !mgCanToggleLibraryPack(pack)) return false;

	if (mgIsBuiltinLibraryPack(id)) {
		const excluded = new Set(game.settings.get("midnight-gambit", MG_EXCLUDED_LIBRARY_COMPENDIUM_SETTING) || []);
		if (enabled) excluded.delete(id);
		else excluded.add(id);
		await game.settings.set("midnight-gambit", MG_EXCLUDED_LIBRARY_COMPENDIUM_SETTING, Array.from(excluded));
		return true;
	}

	const ids = new Set(mgGetLibraryCompendiumIds());
	if (enabled) ids.add(id);
	else ids.delete(id);

	await game.settings.set("midnight-gambit", MG_LIBRARY_COMPENDIUM_SETTING, Array.from(ids));
	return true;
}

export async function mgSetCompendiumLibraryItems(pack, enabled = true) {
	if (!mgIsItemLibraryPack(pack) || typeof pack.getDocuments !== "function") return 0;

	const docs = await pack.getDocuments();
	const category = mgGetCompendiumLibraryConfig(pack).category;
	const kind = category === "moves" ? "move" : category === "gambits" ? "gambit" : null;
	const libraryDocs = docs.filter(item => kind && item?.type === kind);
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
	if (builtinPack && builtinPack.visible !== false && mgIsLibraryCompendium(builtinPack)) packs.push(builtinPack);

	for (const id of mgGetLibraryCompendiumIds()) {
		const pack = game.packs.get(id);
		if (pack && pack.visible !== false && mgIsLibraryCompendium(pack)
			&& mgGetCompendiumLibraryConfig(pack).category === (kind === "move" ? "moves" : "gambits")) packs.push(pack);
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

export const MG_ITEM_LIBRARY_TYPES = [
	{ id: "weapon", label: "Weapons", icon: "fa-solid fa-sword" },
	{ id: "armor", label: "Armor", icon: "fa-solid fa-shield" },
	{ id: "misc", label: "Misc", icon: "fa-solid fa-briefcase" },
	{ id: "asset", label: "Assets", icon: "fa-solid fa-vault" }
];

export function mgCanReadItemShop(pack) {
	return mgIsItemLibraryPack(pack) && pack.visible !== false
		&& mgGetCompendiumLibraryConfig(pack).category === "shop" && mgIsLibraryCompendium(pack);
}

export async function mgGetItemLibraryShops() {
	const packs = Array.from(game.packs ?? []).filter(mgCanReadItemShop);
	const shops = await Promise.all(packs.map(async pack => {
		try {
			const index = await pack.getIndex({ fields: ["type"] });
			const count = Array.from(index).filter(item => MG_ITEM_LIBRARY_TYPES.some(type => type.id === item.type)).length;
			// Move/Guise/Gambit-only packs are not shops. Empty enabled Item packs can be stocked later.
			if (!count && Array.from(index).length) return null;
			return {
				id: mgGetPackId(pack),
				name: mgGetCompendiumLabel(pack),
				image: mgGetCompendiumCardImage(pack),
				icon: mgGetCompendiumLibraryConfig(pack).icon,
				count
			};
		} catch (error) {
			console.warn("MG Items Library | Could not read shop", { pack: mgGetPackId(pack), error });
			return null;
		}
	}));
	return shops.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

// Classify previously included, homogeneous packs. Mixed and empty packs remain General.
Hooks.once("ready", async () => {
	if (!game.user.isGM || game.users.find(user => user.active && user.isGM)?.id !== game.user.id) return;
	const configs = { ...(game.settings.get("midnight-gambit", "compendiumLibraryConfig") ?? {}) };
	let changed = false;
	for (const id of mgGetLibraryCompendiumIds()) {
		const pack = game.packs.get(id);
		if (!pack || !mgIsItemLibraryPack(pack) || configs[id]?.category || MG_FIXED_CATEGORIES[id]) continue;
		try {
			const entries = Array.from(await pack.getIndex({ fields: ["type"] }));
			const category = entries.length && MG_COMPENDIUM_CATEGORIES.find(category => category.types && entries.every(item => category.types.includes(item.type)));
			configs[id] = { ...configs[id], category: category?.id || "general", icon: configs[id]?.icon || "fa-solid fa-store" };
			changed = true;
		} catch (error) { console.warn("MG Library | Could not classify compendium", { id, error }); }
	}
	if (changed) await game.settings.set("midnight-gambit", "compendiumLibraryConfig", configs);
});

// Validate document creation as well as drag/drop, so macros and imports follow the category.
function mgValidateCompendiumItem(item, data, options = {}) {
	const pack = game.packs.get(item.pack ?? options.pack);
	if (!pack || !mgIsItemLibraryPack(pack)) return;
	const category = mgGetCompendiumCategory(pack);
	if (category.types && !category.types.includes(data.type ?? item.type)) {
		ui.notifications.warn(`${category.label} compendiums only accept: ${category.types.join(", ")}.`);
		return false;
	}
}
Hooks.on("preCreateItem", mgValidateCompendiumItem);
Hooks.on("preUpdateItem", mgValidateCompendiumItem);

// Refresh every open library when its sources or shop presentation change.
Hooks.on("updateSetting", setting => {
	if (!["libraryCompendiums", "excludedLibraryCompendiums", "compendiumLibraryConfig"].some(key => setting.key === `midnight-gambit.${key}`)) return;
	mgApplyCompendiumNames();
	for (const app of Object.values(ui.windows ?? {})) {
		if (!app.rendered || !app.options.classes?.includes("mg-gambit-library-app")) continue;
		app._libraryCards = null;
		app._cardsByShop?.clear();
		app.render(false);
	}
	globalThis.mgRefreshCompendiumSidebarContent?.();
});
