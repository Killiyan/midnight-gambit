export async function evaluateRoll({ formula, rollData = {}, skillMod = 0, label = "Roll" }) {
 	 const displayFormula = skillMod !== 0 ? `${formula} + (${skillMod})` : formula;
  	const actualFormula = `${formula} ${skillMod >= 0 ? "+" : "-"} ${Math.abs(skillMod)}`;

  	const roll = new Roll(actualFormula, rollData);
  	await roll.evaluate({ async: true });

  	const total = roll.total;

  	let resultText;
  	const kept = roll.terms[0].results.filter(r => r.active).map(r => r.result);
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


	const chatContent = `
		<div class="chat-roll">
		<div class="roll-container">
			<label>${label}</label><br/>
			<strong>${resultText}</strong>
		</div>
		<hr/>
		${await roll.render()}
		</div>
	`;

	ChatMessage.create({
		user: game.user.id,
		speaker: ChatMessage.getSpeaker(),
		content: chatContent,
		roll,
		type: CONST.CHAT_MESSAGE_TYPES.ROLL,
		rollMode: game.settings.get("core", "rollMode")
	});
}
