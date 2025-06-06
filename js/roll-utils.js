export async function evaluateRoll({ formula, rollData = {}, skillMod = 0, label = "Roll" }) {
 	 const displayFormula = skillMod !== 0 ? `${formula} + (${skillMod})` : formula;
  	const actualFormula = `${formula} ${skillMod >= 0 ? "+" : "-"} ${Math.abs(skillMod)}`;

  	const roll = new Roll(actualFormula, rollData);
  	await roll.evaluate({ async: true });

  	const total = roll.total;

  	let resultText;
  	const kept = roll.terms[0].results.filter(r => r.active).map(r => r.result);
	if (kept.every(d => d === 6)) {
	resultText = `<i class="fa-solid fa-star text-gold"></i> <strong>ACE!</strong> — You steal the spotlight.`;
	} else if (kept.every(d => d === 1)) {
	resultText = `<i class="fa-solid fa-skull-crossbones"></i> <strong>Critical Failure</strong> — It goes horribly wrong.`;
	} else if (total <= 6) {
	resultText = `<i class="fa-solid fa-fire-flame"></i> <strong>Failure</strong> — something goes awry.`;
	} else if (total <= 10) {
	resultText = `<i class="fa-solid fa-swords"></i> <strong>Complication</strong> — success with a cost.`;
	} else {
	resultText = `<i class="fa-solid fa-sparkles flourish-animate"></i> <strong class="flourish-animate">Flourish</strong> — narrate your success.`;

	}


	const chatContent = `
		<div class="chat-roll">
		<strong>${label}</strong><br/>
		<strong>${resultText}</strong>
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
