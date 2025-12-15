export async function evaluateRoll({
  formula,
  rollData = {},
  skillMod = 0,
  label = "Roll",
  edge = false,
  actor = null
}) {
	const displayFormula = skillMod !== 0 ? `${formula} + (${skillMod})` : formula;
	const actualFormula = skillMod !== 0
		? `${formula} ${skillMod >= 0 ? "+" : "-"} ${Math.abs(skillMod)}`
		: formula;

	// Helper to evaluate one roll
	const doRoll = async () => {
		const r = new Roll(actualFormula, rollData);
		await r.evaluate({ async: true });
		return r;
	};

	// If Edge, roll twice and keep the higher total (D&D advantage style)
	const rollA = await doRoll();
	const rollB = edge ? await doRoll() : null;

	const keptRoll =
		rollB && rollB.total > rollA.total ? rollB : rollA;

	// Build result label based on the KEPT roll
	const kept = keptRoll.terms?.[0]?.results?.filter(r => r.active).map(r => r.result) ?? [];
	let resultText;

	if (kept.length && kept.every(d => d === 6)) {
		resultText = `<div class="result-label"><i class="fa-solid fa-star text-gold"></i> <strong>ACE!</strong></div><span>You steal the spotlight.</span>`;
	} else if (kept.length && kept.every(d => d === 1)) {
		resultText = `<div class="result-label"><i class="fa-solid fa-skull-crossbones"></i> <strong>Critical Failure</strong></div><span>It goes horribly wrong.</span>`;
	} else if (keptRoll.total <= 6) {
		resultText = `<div class="result-label"><i class="fa-solid fa-fire-flame result-fail"></i> <strong>Failure</strong></div><span>something goes awry.</span>`;
	} else if (keptRoll.total <= 10) {
		resultText = `<div class="result-label"><i class="fa-solid fa-swords result-mixed"></i> <strong>Complication</strong></div> <span>success with a cost.</span>`;
	} else {
		resultText = `<div class="result-label"><i class="fa-solid fa-sparkles flourish-animate"></i> <strong class="flourish-animate">Flourish</strong></div><span>narrate your success.</span>`;
	}

	// Helper: get the two KEPT dice from a Roll (active dice in the first dice term)
	const keptDice = (r) => {
	const term0 = r?.terms?.[0];
	const results = term0?.results ?? [];
	return results.filter(x => x.active).map(x => x.result).slice(0, 2);
	};

	const keptA = keptDice(rollA);
	const keptB = keptDice(rollB);

	// All dice results + whether each die was kept (active)
	const diceResults = (r) => {
	const term0 = r?.terms?.[0];
	const results = term0?.results ?? [];
	return results.map(x => ({ r: x.result, a: !!x.active })); // r=result, a=active
	};

	const diceA = diceResults(rollA);
	const diceB = diceResults(rollB);



  const edgeHeader = edge
    ? `<div class="edge-label">
			<strong><i class="fa-solid fa-scythe"></i></strong>
			<span><strong>EDGE</strong> (rolled twice, kept higher)</span>
		</div>`
    : "";

	const rollsHtml = edge
	? `
		<div class="mg-edge">
		<div class="mg-edge-box"
			role="button"
			tabindex="0"
			data-edge="A"
			data-dice='${JSON.stringify(diceA)}'>
			<i class="fa-solid fa-dice-one"></i>
			<h4 class="mg-edge-total">${rollA.total}</h4>
		</div>

		<div class="mg-edge-box ${keptRoll === rollB ? "is-kept" : ""}"
			role="button"
			tabindex="0"
			data-edge="B"
			data-dice='${JSON.stringify(diceB)}'>
			<i class="fa-solid fa-dice-two"></i>
			<h4 class="mg-edge-total">${rollB.total}</h4>
		</div>
		</div>

		<div class="mg-edge-dice-panel dice" hidden></div>
	`
	: `${await rollA.render()}`;


	// --- Risk It control (chat button hooks.js expects) ---
	const usedNow  = Number(actor?.system?.riskUsed ?? 0);
	const totalRD  = Number(actor?.system?.riskDice ?? 0);
	const canRisk  = !!actor?.id && usedNow < totalRD;

	// Risk rerolls the LOWER of the TWO KEPT dice, so we must pass those two dice.
	const keptForRisk = Array.isArray(kept) ? kept.slice(0, 2) : [];
	const riskControls = canRisk && keptForRisk.length === 2
	? `
		<div class="mg-risk-controls">
		<button type="button"
				class="mg-risk-it"
				data-actor-id="${actor.id}"
				data-kept="${keptForRisk.join(",")}"
				data-skill-mod="${Number(skillMod || 0)}">
			<i class="fa-solid fa-dice-d6"></i> Risk It
		</button>
		<small class="hint">Replaces the lower kept die; a <strong>1</strong> causes 1 Strain.</small>
		</div>
	`
	: `
		<div class="mg-risk-controls">
		<small class="hint">${actor?.id ? "No Risk dice remaining." : ""}</small>
		</div>
	`;

	const chatContent = `
		<div class="chat-roll">
		<div class="roll-container">
			<label>${label}</label>
			<strong>${resultText}</strong>
		</div>
		${edgeHeader}
		<hr/>
		${rollsHtml}
		${riskControls}
		</div>
	`;

	// NOTE: we attach the KEPT roll as the message roll so dice buttons/etc behave
	await ChatMessage.create({
		user: game.user.id,
		speaker: ChatMessage.getSpeaker(),
		content: chatContent,
		roll: keptRoll,
		type: CONST.CHAT_MESSAGE_TYPES.ROLL,
		rollMode: game.settings.get("core", "rollMode")
	});

 	 return keptRoll;
}
