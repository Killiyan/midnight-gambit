let mgJournalTinyMCERegistered = false;

export function mgRegisterJournalTinyMCESheet() {
  if (mgJournalTinyMCERegistered) return true;

  const PageClass = globalThis.JournalEntryPage ?? globalThis.CONFIG?.JournalEntryPage?.documentClass;
  const TinyMCESheet = globalThis.JournalTextTinyMCESheet ?? globalThis.foundry?.appv1?.sheets?.JournalTextTinyMCESheet;

  if (!PageClass || !TinyMCESheet || !globalThis.DocumentSheetConfig) {
    console.warn("MG | Journal TinyMCE sheet registration skipped.", {
      PageClass,
      TinyMCESheet,
      DocumentSheetConfig: globalThis.DocumentSheetConfig
    });
    return false;
  }

  globalThis.DocumentSheetConfig.registerSheet(PageClass, "midnight-gambit", TinyMCESheet, {
    label: "Midnight Gambit TinyMCE",
    types: ["text"],
    makeDefault: true,
    canBeDefault: true,
    canConfigure: true
  });

  mgJournalTinyMCERegistered = true;
  return true;
}
