//Creating the actor from template.json in root directory
Hooks.on("createActor", async (actor) => {
  if (actor.type !== "character") return;

  try {
    const response = await fetch("systems/midnight-gambit/template.json");
    const templateData = await response.json();

    await actor.update(templateData);
    console.log("✅ Template applied to new actor");
  } catch (err) {
    console.error("❌ Failed to apply template.json:", err);
  }
});