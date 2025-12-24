export async function evaluateRoll({ formula, rollData = {}, skillMod = 0, label = "Roll", actor = null }) {
  const displayFormula = skillMod !== 0 ? `${formula} + (${skillMod})` : formula;
  const actualFormula  = `${formula} ${skillMod >= 0 ? "+" : "-"} ${Math.abs(skillMod)}`;

  const roll = new Roll(actualFormula, rollData);
  await roll.evaluate({ async: true });

  const total = roll.total;

  // Kept dice (assumes first term is the dice pool)
  const kept = roll.terms?.[0]?.results?.filter(r => r.active).map(r => r.result) ?? [];

  // Determine outcome band (match your existing thresholds)
  const isAce   = kept.length && kept.every(d => d === 6);
  const isCrit  = kept.length && kept.every(d => d === 1);
  const isFail  = !isAce && !isCrit && total <= 6;
  const isComp  = !isAce && !isCrit && total > 6 && total <= 10;
  const isGood  = isAce || total > 10; // Flourish/Ace

  let resultText;
  if (isAce) {
    resultText = `<div class="result-label"><i class="fa-solid fa-star text-gold"></i> <strong>ACE!</strong></div><span>You steal the spotlight.</span>`;
  } else if (isCrit) {
    resultText = `<div class="result-label"><i class="fa-solid fa-skull-crossbones"></i> <strong>Critical Failure</strong></div><span>It goes horribly wrong.</span>`;
  } else if (isFail) {
    resultText = `<div class="result-label"><i class="fa-solid fa-fire-flame result-fail"></i> <strong>Failure</strong></div><span>something goes awry.</span>`;
  } else if (isComp) {
    resultText = `<div class="result-label"><i class="fa-solid fa-swords result-mixed"></i> <strong>Complication</strong></div> <span>success with a cost.</span>`;
  } else {
    resultText = `<div class="result-label"><i class="fa-solid fa-sparkles flourish-animate"></i> <strong class="flourish-animate">Flourish</strong></div><span>narrate your success.</span>`;
  }

  // Roll Session id (ties Risk rerolls to the same STO transaction)
  const sessionId = foundry.utils.randomID();

  // Risk button: only if we have two kept dice
  const riskBtn = (actor && kept.length >= 2)
    ? `<button type="button"
              class="mg-risk-it"
              data-actor-id="${actor.id}"
              data-kept="${kept.join(",")}"
              data-skill-mod="${Number(skillMod) || 0}"
              data-session-id="${sessionId}">
        <i class="fa-solid fa-dice-d6"></i> Risk It
      </button>
	  <small class="hint">Replaces the lower kept die; a <strong>1</strong> causes 1 Strain.</small>`
    : "";

	const chatContent = `
	<div class="chat-roll">
		<div class="roll-container">
		<label>${label}</label><br/>
		<strong>${resultText}</strong>
		</div>

		<hr/>
		${await roll.render()}

		${riskBtn ? `<div class="mg-risk-controls">${riskBtn}</div>` : ""}
	</div>
	`;

  // Create message FIRST so we can safely attach flags
  const msg = await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: chatContent,
    roll,
    type: CONST.CHAT_MESSAGE_TYPES.ROLL,
    rollMode: game.settings.get("core", "rollMode")
  });

  // Initialize STO session flags on this message
  const stoSession = {
    sessionId,
    stoApplied: false,
    stoAppliedDelta: 0, // 1 if STO actually incremented, 0 if capped
    stoUndone: false
  };

  // Auto-apply STO on Fail/Complication immediately (so "do nothing" still counts)
  if (actor && (isFail || isComp || isCrit)) {
    const cur = Number(actor.system?.sto?.value ?? 0);
    const next = Math.min(6, cur + 1);
    const delta = (next !== cur) ? 1 : 0;

    if (delta) await actor.update({ "system.sto.value": next }, { render: false });

    stoSession.stoApplied = true;
    stoSession.stoAppliedDelta = delta;
  }

  await msg.setFlag("midnight-gambit", "stoSession", stoSession);

  return msg;
}
