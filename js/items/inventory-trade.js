const MG_ACTOR_DEFAULT_IMAGE = "icons/svg/mystery-man.svg";

export function mgFindActorCrew(actor) {
  if (actor?.type === "npc") {
    const crew = game.actors.get(game.settings.get("midnight-gambit", "crewActorId"));
    return crew?.type === "crew" ? crew : null;
  }
  if (actor?.type !== "character") return null;

  const linkedCrewId = String(actor.system?.crewId ?? "");
  const linkedCrew = linkedCrewId ? game.actors.get(linkedCrewId) : null;
  if (
    linkedCrew?.type === "crew" &&
    (linkedCrew.system?.party?.members ?? []).includes(actor.uuid)
  ) return linkedCrew;

  return game.actors.find(candidate =>
    candidate.type === "crew" &&
    (candidate.system?.party?.members ?? []).includes(actor.uuid)
  ) ?? null;
}

export function mgGetCrewTradePortrait(actor, fallbackImg) {
  const crop = actor?.getFlag?.("midnight-gambit", "crops")?.crewSheet ?? {};
  const css = crop.css ?? null;
  const hasCrop = Boolean(css && Object.keys(css).length);
  const x = Number.isFinite(css?.x) ? css.x : 50;
  const y = Number.isFinite(css?.y) ? css.y : 50;
  const scale = Number.isFinite(css?.scale) ? css.scale : 1;
  const height = Number.isFinite(css?.height) && css.height > 0
    ? ` --mg-crop-h: ${css.height}%;`
    : "";

  return {
    img: String(crop.src ?? "").trim() || fallbackImg,
    hasCrop,
    cropStyle: hasCrop
      ? `--mg-crop-x: ${x}; --mg-crop-y: ${y}; --mg-crop-scale: ${scale};${height}`
      : ""
  };
}

export function mgGetAssignedCharacterId(user) {
  const assigned = user?._source?.character ?? user?.character;
  return typeof assigned === "string" ? assigned : assigned?.id ?? null;
}

export function mgResolvePrimaryGuise(actor) {
  const ref = actor?.system?.guiseId || actor?.system?.guise;
  if (!ref) return null;

  let guise = actor?.items?.get(ref) ?? null;
  if (!guise && typeof fromUuidSync === "function") {
    try { guise = fromUuidSync(ref); } catch (_) {}
  }

  return guise?.type === "guise" ? guise : null;
}

// Shared recipient picker and transfer request for character and NPC inventories.
export async function mgSendInventoryItem(item) {
  const actor = item?.parent;
  if (!item || !["weapon", "armor", "misc"].includes(item.type)) return;
  if (!actor.isOwner) {
    return ui.notifications?.warn("You do not have permission to send this item.");
  }

  const crew = mgFindActorCrew(actor);
  if (!crew) {
    ui.notifications?.warn(actor.type === "npc" ? "No Primary Crew is selected." : "This character is not in a Crew.");
    return;
  }

  const esc = value => Handlebars.escapeExpression(String(value ?? ""));
  const ownerLevel = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  const cache = crew.system?.party?.cache ?? {};
  const destinations = [{
    actorUuid: crew.uuid,
    actorName: crew.name,
    actorImg: crew.img || MG_ACTOR_DEFAULT_IMAGE,
    hasCrop: false,
    cropStyle: "",
    className: "Crew Inventory",
    levelText: "",
    actorType: "crew",
    recipientUserId: null
  }];

  for (const memberUuid of (crew.system?.party?.members ?? [])) {
    if (memberUuid === actor.uuid) continue;

    const member = await fromUuid(memberUuid).catch(() => null);
    const cached = cache?.[memberUuid] ?? {};
    const memberType = member?.type ?? cached.type ?? "character";
    if (memberType !== "character") continue;

    const actorId = member?.id ?? String(memberUuid).match(/^Actor\.([^.]+)$/)?.[1] ?? null;
    const recipientUser = actorId
      ? game.users.find(user => !user.isGM && mgGetAssignedCharacterId(user) === actorId)
        ?? game.users.find(user => !user.isGM && member?.testUserPermission?.(user, ownerLevel))
      : null;
    const fallbackImg = member?.img ?? cached.img ?? MG_ACTOR_DEFAULT_IMAGE;
    const portrait = mgGetCrewTradePortrait(member, fallbackImg);
    const guise = member ? mgResolvePrimaryGuise(member) : null;
    const level = Number(member?.system?.level ?? guise?.system?.level);

    destinations.push({
      actorUuid: memberUuid,
      actorName: member?.name ?? cached.name ?? "Unknown",
      actorImg: portrait.img,
      hasCrop: portrait.hasCrop,
      cropStyle: portrait.cropStyle,
      className: guise?.name ?? member?.system?.class ?? cached.className ?? "—",
      levelText: Number.isFinite(level) ? String(level) : String(cached.level ?? "—"),
      actorType: "character",
      recipientUserId: recipientUser?.id ?? null
    });
  }

  destinations.sort((a, b) => {
    if (a.actorType !== b.actorType) return a.actorType === "crew" ? -1 : 1;
    return a.actorName.localeCompare(b.actorName);
  });

  const cards = destinations.map(destination => (
    `<article class="mg-member-card mg-trade-recipient" data-target-uuid="${esc(destination.actorUuid)}" role="button" tabindex="0">
      <div class="mg-member-portrait ${destination.hasCrop ? "is-cropped" : ""}">
        <img src="${esc(destination.actorImg)}" alt="${esc(destination.actorName)}" style="${esc(destination.cropStyle)}" />
      </div>
      <div class="mg-member-info">
        <div class="mg-member-name">${esc(destination.actorName)}</div>
        <div class="mg-member-meta">
          <span class="mg-member-class">${esc(destination.className)}</span>
          ${destination.levelText ? `<span class="mg-member-level">Lv ${esc(destination.levelText)}</span>` : ""}
        </div>
      </div>
      <div class="mg-trade-recipient-action"><i class="fa-solid fa-paper-plane"></i></div>
    </article>`
  )).join("");

  const targetUuid = await new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const dialog = new Dialog({
      title: `Send ${item.name}`,
      content: `<div class="mg-crew-sheet"><div class="mg-party-grid mg-trade-recipient-grid">${cards}</div></div>`,
      buttons: {
        cancel: { label: "Cancel", callback: () => finish(null) }
      },
      render: dialogHtml => {
        const chooseRecipient = recipientEvent => {
          if (recipientEvent.type === "keydown" && !["Enter", " "].includes(recipientEvent.key)) return;
          recipientEvent.preventDefault();
          finish(String(recipientEvent.currentTarget.dataset.targetUuid ?? ""));
          dialog.close();
        };
        dialogHtml.find(".mg-trade-recipient").on("click keydown", chooseRecipient);
      },
      close: () => finish(null)
    }, { classes: ["midnight-gambit", "dialog", "crew-sheet", "mg-trade-dialog"], width: 900 });
    dialog.render(true);
  });

  if (!targetUuid) return;
  const destination = destinations.find(entry => entry.actorUuid === targetUuid);
  if (!destination) return ui.notifications?.warn("Destination not found.");
  if (!game.mgRequestInventoryTransfer) {
    return ui.notifications?.error("Item transfers are not ready. Refresh Foundry and try again.");
  }

  await game.mgRequestInventoryTransfer({
    sourceItem: item,
    targetActorUuid: destination.actorUuid,
    targetActorName: destination.actorName,
    targetActorType: destination.actorType,
    recipientUserId: destination.recipientUserId
  });

}
