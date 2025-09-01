// systems/midnight-gambit/initiative-bar.js
// Foundry window-based Initiative bar (uses initiative-bar.html)

export class MGInitiativeApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "mg-initiative",
      title: "Initiative",
      template: "systems/midnight-gambit/templates/initiative-bar.html",
      popOut: true,
      resizable: false,
      width: 520,
      height: "auto",
      classes: ["midnight-gambit", "mg-initiative-app"]
    });
  }

  /** Build handlebars context for initiative-bar.html */
  async getData(options = {}) {
    const ctx = await super.getData(options);
    const crews = game.actors?.contents?.filter(a => a.type === "crew") ?? [];
    const firstCrew = crews[0] ?? null;

    // active crew: prefer a crew whose flag points to itself; else first
    let crew = firstCrew;
    for (const c of crews) {
      const f = c.getFlag("midnight-gambit", "initiative");
      if (f?.activeCrewUuid && f.activeCrewUuid === _actorUUID(c)) { crew = c; break; }
    }

    const members = crew ? _readCrewMembers(crew) : [];
    const hasCrew = !!crew;

    // pointer (active member)
    const ptr = _crewActivePointer(crew);
    const activeUuid = (ptr.activeUuid && members.some(m => m.uuid === ptr.activeUuid))
      ? ptr.activeUuid
      : (members[0]?.uuid ?? "");

    return {
      ...ctx,
      crews: crews.map(c => ({ uuid: _actorUUID(c), name: c.name })),
      activeCrewUuid: crew ? _actorUUID(crew) : "",
      hasCrew,
      members,
      activeUuid
    };
  }

  /** Wire UI events from the template */
  activateListeners(html) {
    super.activateListeners(html);

    // Crew selector
    html.find(".mg-crew-select").on("change", async ev => {
      const crewUuid = ev.currentTarget.value;
      const crew = await fromUuid(crewUuid).catch(()=>null) || game.actors.get(crewUuid.replace(/^Actor\./, ""));
      if (!crew) return;
      await crew.setFlag("midnight-gambit", "initiative", {
        ...(crew.getFlag("midnight-gambit", "initiative") ?? {}),
        activeCrewUuid: crewUuid
      });
      this.render(false);
    });

    // End Turn = rotate members, persist to crew.system.initiative.order and flag activeUuid
    html.find(".mg-advance").on("click", async () => {
      const crews = game.actors?.contents?.filter(a => a.type === "crew") ?? [];
      let crew = crews.find(c => (c.getFlag("midnight-gambit", "initiative")?.activeCrewUuid) === _actorUUID(c)) || crews[0];
      if (!crew) return;

      const members = _readCrewMembers(crew);
      if (members.length <= 1) return ui.notifications?.info("Not enough members to rotate.");

      const [first, ...rest] = members;
      const rotated = [...rest, first];

      await crew.update({
        "system.initiative.order": rotated.map(m => ({ uuid: m.uuid, value: m.value ?? 0 }))
      });
      await crew.setFlag("midnight-gambit", "initiative", {
        ...(crew.getFlag("midnight-gambit", "initiative") ?? {}),
        activeUuid: rotated[0].uuid
      });

      this.render(false);
    });

    // Click a slot to set active
    html.find(".mg-slot").on("click", async ev => {
      const uuid = ev.currentTarget.dataset.uuid;
      const crews = game.actors?.contents?.filter(a => a.type === "crew") ?? [];
      let crew = crews.find(c => (c.getFlag("midnight-gambit", "initiative")?.activeCrewUuid) === _actorUUID(c)) || null;
      if (!crew) crew = crews.find(c => _readCrewMembers(c).some(m => m.uuid === uuid)) || crews[0];
      if (!crew) return;

      await crew.setFlag("midnight-gambit", "initiative", {
        ...(crew.getFlag("midnight-gambit", "initiative") ?? {}),
        activeUuid: uuid
      });
      this.render(false);
    });
  }
}

/** Export a singleton instance so hooks can render it without `new` */
export const MGInitiativeBar = new MGInitiativeApp();

/* ---------- helpers (module scope) ---------- */

function _actorUUID(a) {
  return a?.uuid ?? (a ? `Actor.${a.id}` : "");
}

function _crewActivePointer(crew) {
  const f = crew?.getFlag("midnight-gambit", "initiative") ?? {};
  return { activeCrewUuid: f.activeCrewUuid || _actorUUID(crew), activeUuid: f.activeUuid || "" };
}

function _readCrewMembers(crew) {
  const out = [];

  // 1) crew.system.initiative.order
  const order = crew?.system?.initiative?.order;
  if (Array.isArray(order) && order.length) {
    for (const e of order) {
      const uuid = typeof e === "string" ? e : (e.uuid ?? (e.actorId ?? e.id));
      const a = uuid ? fromUuidSync?.(uuid) ?? game.actors.get(uuid.replace(/^Actor\./, "")) : null;
      if (!a) continue;
      out.push({ uuid: _actorUUID(a), name: a.name, img: a.img || "icons/svg/mystery-man.svg", value: Number.isFinite(+e?.value) ? +e.value : 0 });
    }
    return out;
  }

  // 2) crew.system.members
  const members = crew?.system?.members;
  if (Array.isArray(members) && members.length) {
    for (const uuid of members) {
      const a = uuid ? fromUuidSync?.(uuid) ?? game.actors.get(uuid.replace(/^Actor\./, "")) : null;
      if (!a) continue;
      out.push({ uuid: _actorUUID(a), name: a.name, img: a.img || "icons/svg/mystery-man.svg", value: 0 });
    }
    return out;
  }

  // 3) fallback: active combatants
  const combat = game.combats?.active;
  if (combat?.combatants?.size) {
    for (const c of combat.combatants) {
      const a = c.actor; if (!a) continue;
      out.push({ uuid: _actorUUID(a), name: a.name, img: a.img || "icons/svg/mystery-man.svg", value: c.initiative ?? 0 });
    }
  }
  return out;
}
