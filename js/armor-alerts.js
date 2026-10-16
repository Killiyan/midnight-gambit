async function mgPlayArmorBreakSound() {
  const path = "systems/midnight-gambit/assets/sounds/Alert.mp3";
  const src = foundry.utils.getRoute?.(path) ?? path;
  // In v11 AudioHelper can be a global lexical binding, not a window property.
  const helper = typeof AudioHelper !== "undefined" ? AudioHelper : foundry.audio?.AudioHelper;
  if (helper?.play) {
    try {
      await helper.play({ src, volume: 0.8, autoplay: true, loop: false }, false);
      return;
    } catch (_) {
      // Retry through browser audio if Foundry cannot load the sound.
    }
  }
  try {
    const audio = new Audio(src);
    const setting = Number(game.settings?.get?.("core", "globalInterfaceVolume") ?? 1);
    audio.volume = 0.8 * (Number.isFinite(setting) ? Math.max(0, Math.min(1, setting)) : 1);
    await audio.play();
  } catch (_) {
    // Keep audio failures quiet; the inventory badge still indicates damage.
  }
}

// Detect depletion at the document level so sheet and sidebar damage behave alike.
Hooks.on("preUpdateItem", (item, changes, options) => {
  if (item.parent?.documentName !== "Actor" || !["armor", "misc"].includes(item.type)) return;
  if (!item.system.equipped) return;
  const changed = foundry.utils.expandObject(changes);
  const depleted = ["mortal", "soul"].filter(type => {
    const max = Number(item.system[`${type}Capacity`] ?? 0);
    const before = Number(item.system.remainingCapacity?.[type] ?? max);
    const after = changed.system?.remainingCapacity?.[type];
    return max > 0 && before > 0 && after != null && Number(after) <= 0;
  });
  if (depleted.length) {
    options.mgArmorDepleted ??= {};
    options.mgArmorDepleted[item.id] = depleted;
  }
});

Hooks.on("updateItem", (item, _changes, options, userId) => {
  if (userId !== game.user.id) return;
  const depleted = options.mgArmorDepleted?.[item.id]?.filter(type =>
    Number(item.system.remainingCapacity?.[type]) <= 0
  );
  if (!depleted?.length) return;
  void mgPlayArmorBreakSound();
});
