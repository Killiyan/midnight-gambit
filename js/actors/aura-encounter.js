const SCOPE = "midnight-gambit";
const KEY = "auraEncounter";
let queue = Promise.resolve();

export function mgAuraReference(actor) {
  return actor?.isToken && actor.token ? actor.token.uuid : actor?.uuid ?? "";
}

export function mgResolveAura(reference) {
  if (!reference) return null;
  try {
    const doc = fromUuidSync(reference);
    const actor = doc?.documentName === "Token" ? doc.actor : doc;
    return actor?.type === "npc" ? actor : null;
  } catch (_) { return null; }
}

export function mgAuraDisplayName(reference, actor = mgResolveAura(reference)) {
  // Use the encounter's TokenDocument, not the synthetic actor's cached name.
  if (reference?.startsWith("Scene.")) {
    const parts = reference.split(".");
    const token = game.scenes?.get(parts[1])?.tokens?.get(parts[3]);
    let source = token;
    if (!source) {
      try { source = fromUuidSync(reference); } catch (_) {}
    }
    const name = source?.name ?? source?._source?.name;
    if (name) return name;
  }
  return actor?.name ?? "NPC";
}

export function mgGetAuraEncounter() {
  const stored = game.settings.get(SCOPE, KEY) ?? {};
  if (stored.version === 1) return {
    version: 1,
    entries: [...new Set((stored.entries ?? []).filter(ref => typeof ref === "string"))],
    active: String(stored.active ?? "")
  };
  const actor = game.actors.get(game.settings.get(SCOPE, "activeAuraActorId"));
  const ref = actor?.system?.aura?.enabled ? mgAuraReference(actor) : "";
  return { version: 1, entries: ref ? [ref] : [], active: ref };
}

export function mgGetActiveAura() {
  const state = mgGetAuraEncounter();
  return state.entries.includes(state.active) ? mgResolveAura(state.active) : null;
}

export function mgGetAuraPenalty(key) {
  const actor = mgGetActiveAura();
  if (!actor) return { value: 0, label: "", sourceActorId: "", sourceTokenId: "", sourceUuid: "" };
  return {
    value: -(Number(actor.system?.attributes?.[key] ?? actor.system?.baseAttributes?.[key]) || 0),
    label: String(actor.system?.aura?.label || "Oppressive Presence"),
    sourceActorId: actor.id,
    sourceTokenId: actor.isToken ? actor.token.id : "",
    sourceUuid: mgAuraReference(actor)
  };
}

// Serialize edits so a quick switch/remove cannot overwrite another pending action.
function editEncounter(edit) {
  if (!game.user.isGM) return Promise.resolve();
  queue = queue.catch(error => console.error("MG | Aura encounter update failed", error)).then(async () => {
    const state = mgGetAuraEncounter();
    const previous = [...state.entries];
    await edit(state);
    state.entries = [...new Set(state.entries)].filter(ref => mgResolveAura(ref));
    if (!state.entries.includes(state.active)) state.active = "";
    // Keep sheet flags consistent, including synthetic token actors.
    for (const ref of new Set([...previous, ...state.entries])) {
      const actor = mgResolveAura(ref);
      const enabled = ref === state.active;
      if (actor && Boolean(actor.system?.aura?.enabled) !== enabled) {
        await actor.update({ "system.aura.enabled": enabled }, { render: false, mgAuraEncounter: true });
      }
    }
    await game.settings.set(SCOPE, KEY, state);
    const active = mgResolveAura(state.active);
    await game.settings.set(SCOPE, "activeAuraActorId", active && !active.isToken ? active.id : "");
    Hooks.callAll("mgAuraEncounterChanged", state);
  });
  return queue;
}

export function mgSetEncounterMember(actor, included) {
  const ref = mgAuraReference(actor);
  if (actor?.type !== "npc" || !ref) return Promise.resolve();
  return editEncounter(state => {
    if (included) state.entries.push(ref);
    else state.entries = state.entries.filter(entry => entry !== ref);
  });
}

export function mgSetActiveAura(actor, enabled) {
  const ref = mgAuraReference(actor);
  if (actor?.type !== "npc" || !ref) return Promise.resolve();
  return editEncounter(state => {
    if (enabled) { state.entries.push(ref); state.active = ref; }
    else if (state.active === ref) state.active = "";
  });
}

export function mgClearAuraEncounter() {
  return editEncounter(state => { state.entries = []; state.active = ""; });
}

export function mgReorderAuraEncounter(order) {
  return editEncounter(state => {
    const ordered = order.filter(ref => state.entries.includes(ref));
    state.entries = [...new Set([...ordered, ...state.entries])];
  });
}

const isAuthority = () => game.user?.isGM && game.users.find(user => user.active && user.isGM)?.id === game.user.id;

Hooks.once("ready", () => {
  if (isAuthority()) return editEncounter(() => {});
});

// Also support macros or other controls which update the Aura flag directly.
Hooks.on("updateActor", (actor, changes, options) => {
  if (!isAuthority() || options?.mgAuraEncounter || actor.type !== "npc") return;
  const enabled = changes["system.aura.enabled"] ?? changes.system?.aura?.enabled;
  if (enabled !== undefined) return mgSetActiveAura(actor, Boolean(enabled));
});
Hooks.on("updateToken", (token, changes, options) => {
  if (!isAuthority() || options?.mgAuraEncounter || token.actor?.type !== "npc") return;
  const enabled = changes.delta?.system?.aura?.enabled ?? changes.actorData?.system?.aura?.enabled
    ?? changes["delta.system.aura.enabled"] ?? changes["actorData.system.aura.enabled"];
  if (enabled !== undefined) return mgSetActiveAura(token.actor, Boolean(enabled));
});
for (const event of ["deleteActor", "deleteToken", "deleteScene"]) {
  Hooks.on(event, doc => {
    if (!isAuthority()) return;
    return editEncounter(state => {
      state.entries = state.entries.filter(ref => ref !== doc.uuid && !ref.startsWith(`${doc.uuid}.`));
    });
  });
}

Hooks.on("updateSetting", setting => {
  if (setting.key === `${SCOPE}.${KEY}`) {
    for (const app of Object.values(ui.windows ?? {})) {
      if (app.actor?.type === "npc" && app.rendered) app.render(false);
    }
  }
});
