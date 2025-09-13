export async function evaluateRoll({
  formula,
  rollData = {},
  skillMod = 0,
  label = "Roll",
  actor = null,          // ⬅ new
  enableRisk = true      // ⬅ new (toggle if ever needed)
}) {
	const displayFormula = skillMod !== 0 ? `${formula} + (${skillMod})` : formula;
	const actualFormula  = `${formula} ${skillMod >= 0 ? "+" : "-"} ${Math.abs(skillMod)}`;

	const roll = new Roll(actualFormula, rollData);
	await roll.evaluate({ async: true });

	const total = roll.total;

	// Pull the kept dice from the first DiceTerm
	const kept = roll.terms[0].results.filter(r => r.active).map(r => r.result);

	let resultText;
	if (kept.every(d => d === 6)) {
	resultText = `<div class="result-label"><i class="fa-solid fa-star text-gold"></i> <strong>ACE!</strong></div><span>You steal the spotlight.</span>`;
	} else if (kept.every(d => d === 1)) {
	resultText = `<div class="result-label"><i class="fa-solid fa-skull-crossbones"></i> <strong>Critical Failure</strong></div><span>It goes horribly wrong.</span>`;
	} else if (total <= 6) {
	resultText = `<div class="result-label"><i class="fa-solid fa-fire-flame result-fail"></i> <strong>Failure</strong></div><span>something goes awry.</span>`;
	} else if (total <= 10) {
	resultText = `<div class="result-label"><i class="fa-solid fa-swords result-mixed"></i> <strong>Complication</strong></div> <span>success with a cost.</span>`;
	} else {
	resultText = `<div class="result-label"><i class="fa-solid fa-sparkles flourish-animate"></i> <strong class="flourish-animate">Flourish</strong></div><span>narrate your success.</span>`;
	}

	// Risk controls (basic version; one-use on this message)
	const riskControls = (enableRisk && actor)
	? `
		<div class="mg-risk-controls">
		<button type="button"
				class="mg-risk-it"
				data-actor-id="${actor.id}"
				data-kept="${kept.join(",")}"
				data-skill-mod="${skillMod}">
			<i class="fa-solid fa-dice-d6"></i> Risk It
		</button>
		<small class="hint">Replaces the lower die. On a <strong>1</strong>, take 1 Strain.</small>
		</div>`
	: "";

	const chatContent = `
	<div class="chat-roll">
		<div class="roll-container">
		<label>${label}</label>
		<strong>${resultText}</strong>
		</div>
		${await roll.render()}
		${riskControls}
	</div>
	`;

	await ChatMessage.create({
	user: game.user.id,
	speaker: ChatMessage.getSpeaker(),
	content: chatContent,
	roll,
	type: CONST.CHAT_MESSAGE_TYPES.ROLL,
	rollMode: game.settings.get("core", "rollMode")
	});
}
