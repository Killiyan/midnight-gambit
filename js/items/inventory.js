import { mgBindInventoryUI } from "../ui/inventory-ui.js";
import { mgCreateInventoryItem } from "./item-sheet.js";
import { ItemsLibraryApplication } from "../library/items-library.js";
import { mgFindActorCrew, mgSendInventoryItem } from "./inventory-trade.js";

const INVENTORY_TYPES = new Set(["weapon", "armor", "misc"]);

export function mgPrepareInventoryCapacity(items) {
  for (const item of items) {
    item.system.remainingCapacity ??= {};
    for (const type of ["mortal", "soul"]) {
      item.system.remainingCapacity[type] ??= Number(item.system[`${type}Capacity`]) || 0;
    }
    const display = {};
    for (const type of ["mortal", "soul"]) {
      const max = Math.max(0, Number(item.system[`${type}Capacity`]) || 0);
      const remaining = Number(item.system.remainingCapacity?.[type] ?? max) || 0;
      display[type] = {
        hasCapacity: max > 0, remaining, max, label: `${remaining}/${max}`,
        needsRepair: ["armor", "misc"].includes(item.type) && remaining < max
      };
    }
    display.hasCapacity = display.mortal.hasCapacity || display.soul.hasCapacity;
    item.system.capacityDisplay = display;
    item.system.isFullyRepaired = !display.mortal.needsRepair && !display.soul.needsRepair;
  }
}

export function mgPrepareNpcInventory(sheet, context) {
  context.isNpcInventory = true;
  context.canSendInventoryItems = Boolean(mgFindActorCrew(sheet.actor));
  mgPrepareInventoryCapacity(sheet.actor.items);
}

// Repair stored durability without changing an actor's base Capacity or Strain tracks.
export async function mgRepairInventoryItem(item) {
  if (!item?.isOwner || !["armor", "misc"].includes(item.type)) return null;
  const requiresEquipped = item.parent?.type === "character";
  if (requiresEquipped && !item.system.equipped) return null;
  const pools = ["mortal", "soul"].map(key => ({
    key, label: key === "mortal" ? "MC" : "SC",
    max: Math.max(0, Number(item.system[`${key}Capacity`]) || 0),
    current: Number(item.system.remainingCapacity?.[key] ?? item.system[`${key}Capacity`] ?? 0)
  })).filter(pool => pool.max > 0);
  if (!pools.some(pool => pool.current < pool.max)) return null;
  const result = await Dialog.wait({
    title: `Repair ${item.name}`,
    content: `<form class="mg-form">${pools.map(pool => `<div class="form-group">
      <label>Repair ${pool.label} to</label><div class="form-fields">
      <input type="number" name="${pool.key}" value="${pool.current}" min="${pool.current}" max="${pool.max}" step="1" required>
      <span>/ ${pool.max}</span></div></div>`).join("")}</form>`,
    buttons: {
      repair: { label: "Repair", callback: html => {
        const form = html.find("form")[0];
        if (!form.reportValidity()) return null;
        return Object.fromEntries(pools.map(pool => [pool.key, Number(form.elements.namedItem(pool.key).value)]));
      } },
      cancel: { label: "Cancel", callback: () => null }
    },
    default: "repair"
  });
  if (!result) return null;
  const live = item.parent?.items.get(item.id);
  if (!live?.isOwner || (requiresEquipped && !live.system.equipped) || pools.some(pool =>
    Number(live.system[`${pool.key}Capacity`] ?? 0) !== pool.max ||
    Number(live.system.remainingCapacity?.[pool.key] ?? pool.max) !== pool.current
  )) {
    ui.notifications.info("This item's Capacity changed. Open Repair again to use its current values.");
    return null;
  }
  const updates = {}, deltas = { mortal: 0, soul: 0 };
  for (const pool of pools) {
    const value = result[pool.key];
    if (!Number.isSafeInteger(value) || value < pool.current || value > pool.max) return null;
    updates[`system.remainingCapacity.${pool.key}`] = value;
    deltas[pool.key] = value - pool.current;
  }
  if (!deltas.mortal && !deltas.soul) return null;
  if (live.parent?.type === "character" && live.system.equipped) updates["system.capacityApplied"] = true;
  await live.update(updates, { render: false });
  return deltas;
}

export function mgBindNpcInventory(sheet, html) {
  const root = html.find('.tab-inventory');
  mgBindInventoryUI.call(sheet, html);
  html.find('.sheet-tabs [data-tab="inventory"]').on('click.mgInventoryLayout', () => {
    setTimeout(() => {
      html[0]?._mgRefreshTagsOverflow?.();
      html[0]?._mgInvRefreshInnerSeeAll?.();
    }, 0);
  });
  const getItem = event => sheet.actor.items.get(event.currentTarget.closest('[data-item-id]')?.dataset.itemId);
  const cards = () => root.find('.inventory-card');
  root.find('.post-item').on('click', async event => {
    const item = getItem(event);
    if (!item) return;
    const description = await TextEditor.enrichHTML(item.system.description ?? '', { async: true, secrets: sheet.actor.isOwner });
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: sheet.actor }),
      content: `<div class="chat-item"><h2>${Handlebars.escapeExpression(item.name)}</h2>${description}</div>` });
  });
  cards().attr('draggable', 'true').on('dragstart', event => {
    const item = getItem(event);
    if (item) event.originalEvent.dataTransfer.setData('text/plain', JSON.stringify(item.toDragData()));
  });
  if (!sheet.isEditable || !sheet.actor.isOwner) return;
  root.find('.mg-create-item').on('click', event => { event.preventDefault(); return mgCreateInventoryItem(sheet.actor); });
  root.find('.mg-open-items-library').on('click', event => { event.preventDefault(); new ItemsLibraryApplication(sheet.actor).render(true); });
  root.find('.item-send').on('click', event => { event.preventDefault(); return mgSendInventoryItem(getItem(event)); });
  root.find('.repair-armor').on('click', async event => {
    event.preventDefault();
    await mgRepairInventoryItem(getItem(event));
    sheet.render(false);
  });
  root.find('.item-favorite').on('click', async event => {
    event.preventDefault();
    const item = getItem(event);
    if (INVENTORY_TYPES.has(item?.type)) await item.update({ 'system.favorite': !item.system.favorite });
  });
  const quantity = async (input, value) => {
    const item = sheet.actor.items.get(input.closest('[data-item-id]')?.dataset.itemId);
    if (!INVENTORY_TYPES.has(item?.type)) return;
    await item.update({ 'system.quantity': Math.max(0, Math.trunc(Number(value) || 0)) });
  };
  root.find('.item-quantity').on('change', event => { event.stopPropagation(); return quantity(event.currentTarget, event.currentTarget.value); })
    .on('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); } });
  root.find('.item-quantity-inc, .item-quantity-dec').on('click', event => {
    event.preventDefault();
    const input = event.currentTarget.closest('.quantity-controls').querySelector('input');
    return quantity(input, Number(input.value) + Number(event.currentTarget.dataset.step));
  });
  root.find('.lux-inc, .lux-dec').on('click', async event => {
    event.preventDefault();
    await sheet.actor.update({ 'system.currency.lux': Math.max(0, (Number(sheet.actor.system.currency?.lux) || 0) + Number(event.currentTarget.dataset.step)) });
  });
}
