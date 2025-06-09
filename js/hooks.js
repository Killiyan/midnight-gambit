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

Hooks.on("createItem", async (item, options, userId) => {
  const actor = item.actor;

  if (!actor) return; // Item not owned
  if (!["weapon", "armor", "misc"].includes(item.type)) return;

  ui.notifications.info(`${item.name} added to ${actor.name}'s inventory.`);

  // Only re-render if the current user owns the actor
  if (actor.isOwner) {
    actor.sheet.render(false); // Refresh sheet without popping it open
  }
});

Hooks.on("renderActorSheet", async (app, html, data) => {
  renderGambitHand(app.actor);
});

function renderGambitHand(actor) {
  const existing = document.querySelector(`#gambit-hand-ui-${actor.id}`);
  if (existing) existing.remove();

  if (!actor.isOwner || actor.type !== "character") return;

  const drawnIds = actor.system.gambits.drawn ?? [];
  const drawnItems = drawnIds.map(id => actor.items.get(id)).filter(Boolean);
  const total = drawnItems.length;
  const mid = (total - 1) / 2;

  const handHtml = document.createElement("div");
  handHtml.id = `gambit-hand-ui-${actor.id}`;
  handHtml.classList.add("gambit-hand-ui");

  drawnItems.forEach((card, i) => {
    const div = document.createElement("div");
    div.className = "gambit-hand-card";
    div.dataset.itemId = card.id;
    div.style.setProperty("--rotate", `${(i - mid) * 10}deg`);
    div.innerHTML = `
      <div class="gambit-foil"></div>
      <div class="gambit-title">${card.name}</div>
    `;

    div.addEventListener("click", async () => {
      await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `
          <div class="gambit-chat-card">
            <h2>🎴 ${card.name}</h2>
            <p>${card.system.description}</p>
          </div>
        `
      });

      const { drawn = [], discard = [] } = actor.system.gambits;
      const newDrawn = drawn.filter(id => id !== card.id);
      const newDiscard = [...discard, card.id];

      await actor.update({
        "system.gambits.drawn": newDrawn,
        "system.gambits.discard": newDiscard
      });

      div.remove();
    });

    handHtml.appendChild(div);
  });

  document.body.appendChild(handHtml);
}



