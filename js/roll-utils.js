export async function evaluateRoll({
  formula,
  rollData = {},
  skillMod = 0,
  label = "Roll",
  actor = null,
  edge = false
}) {
  const displayFormula = skillMod !== 0 ? `${formula} + (${skillMod})` : formula;
  const actualFormula  = skillMod !== 0
    ? `${formula} ${skillMod >= 0 ? "+" : "-"} ${Math.abs(skillMod)}`
    : formula;

  // Helper to evaluate one roll
  const doRoll = async () => {
    const r = new Roll(actualFormula, rollData);
    await r.evaluate({ async: true });
    return r;
  };

  // If Edge, roll twice and keep the higher total (ties -> A)
  const rollA = await doRoll();
  const rollB = edge ? await doRoll() : null;

  const keptRoll = (rollB && rollB.total > rollA.total) ? rollB : rollA;

  const total = keptRoll.total;

  // Kept dice (active dice in first term)
  const kept = keptRoll.terms?.[0]?.results?.filter(r => r.active).map(r => r.result) ?? [];

  // Determine outcome band (match your existing thresholds)
  const isAce   = kept.length && kept.every(d => d === 6);
  const isCrit  = kept.length && kept.every(d => d === 1);
  const isFail  = !isAce && !isCrit && total <= 6;
  const isComp  = !isAce && !isCrit && total > 6 && total <= 10;
  const isFlourish = total >= 11;

  const stoValue = Number(actor?.system?.sto?.value ?? 0);

  let stoBtn = "";

  if (actor && stoValue > 0 && !isAce) {
    // Fail -> Complication/Flourish
    if (total <= 6) {
      const needComp = 7 - total;
      const needFlourish = 11 - total;

      if (needComp > 0 && needComp <= stoValue) {
        stoBtn += `
          <button type="button"
            class="mg-spend-sto sto-complication"
            data-actor-id="${actor.id}"
            data-spend="${needComp}"
            data-target="complication"
            title="Upgrade to Complication">
            <i class="fa-solid fa-swords"></i> STO
          </button>`;
      }

      if (needFlourish > 0 && needFlourish <= stoValue) {
        stoBtn += `
          <button type="button"
            class="mg-spend-sto sto-flourish"
            data-actor-id="${actor.id}"
            data-spend="${needFlourish}"
            data-target="flourish"
            title="Upgrade to Flourish">
            <i class="fa-solid fa-crown"></i> STO
          </button>`;
      }
    }
    // Complication -> Flourish
    else if (total >= 7 && total <= 10) {
      const needFlourish = 11 - total;

      if (needFlourish > 0 && needFlourish <= stoValue) {
        stoBtn += `
          <button type="button"
            class="mg-spend-sto sto-flourish"
            data-actor-id="${actor.id}"
            data-spend="${needFlourish}"
            data-target="flourish"
            title="Upgrade to Flourish">
            <i class="fa-solid fa-crown"></i> STO
          </button>`;
      }
    }
  }

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
    resultText = `<div class="result-label"><i class="fa-solid fa-crown flourish-animate"></i> <strong class="flourish-animate">Flourish</strong></div><span>narrate your success.</span>`;
  }

  // ------------------------------------------------------------
  // Edge UI (OLD behavior): two boxes + dice panel (no Foundry tooltip)
  // ------------------------------------------------------------
  const diceResults = (r) => {
    const term0 = r?.terms?.[0];
    const results = term0?.results ?? [];
    return results.map(x => ({ r: x.result, a: !!x.active })); // r=result, a=active
  };

  const edgeHeader = edge
    ? `<div class="edge-label">
        <strong><i class="fa-solid fa-scythe"></i></strong>
        <span><strong>EDGE</strong> (rolled twice, kept higher)</span>
      </div>`
    : "";

  const rollsHtml = edge
    ? (() => {
        const diceA = JSON.stringify(diceResults(rollA)).replace(/'/g, "&#39;");
        const diceB = JSON.stringify(diceResults(rollB)).replace(/'/g, "&#39;");

        // Mark kept roll visually like your old system (kept is B only when B beats A)
        const keptIsB = keptRoll === rollB;

        return `
          <div class="mg-edge">
            <div class="mg-edge-box ${!keptIsB ? "is-kept" : ""}"
              role="button"
              tabindex="0"
              data-edge="A"
              data-dice='${diceA}'>
              <i class="fa-solid fa-dice-one"></i>
              <h4 class="mg-edge-total">${rollA.total}</h4>
            </div>

            <div class="mg-edge-box ${keptIsB ? "is-kept" : ""}"
              role="button"
              tabindex="0"
              data-edge="B"
              data-dice='${diceB}'>
              <i class="fa-solid fa-dice-two"></i>
              <h4 class="mg-edge-total">${rollB.total}</h4>
            </div>
          </div>

          <div class="mg-edge-dice-panel dice" hidden></div>
        `;
      })()
    : `${await keptRoll.render()}`;

  // ------------------------------------------------------------
  // Session id (ties Risk rerolls to the same STO transaction)
  // ------------------------------------------------------------
  const sessionId = foundry.utils.randomID();

  // ------------------------------------------------------------
  // Risk button (NEW formatting, but use KEPT roll’s kept dice)
  // IMPORTANT: Risk expects the two kept dice only.
  // ------------------------------------------------------------
  const usedRisk  = Number(actor?.system?.riskUsed ?? 0);
  const totalRisk = Number(actor?.system?.riskDice ?? 0);
  const hasRiskRemaining = usedRisk < totalRisk;

  const riskBtn = (actor && kept.length >= 2 && hasRiskRemaining)
    ? `<button type="button"
                class="mg-risk-it"
                data-actor-id="${actor.id}"
                data-kept="${kept.slice(0, 2).join(",")}"
                data-skill-mod="${Number(skillMod) || 0}"
                data-session-id="${sessionId}">
        <i class="fa-solid fa-dice-d6"></i> Risk It
      </button>
      <small class="hint">Replaces the lower kept die; a <strong>1</strong> causes 1 Strain.</small>`
    : `<small class="hint">No Risk dice remaining.</small>`;

  const chatContent = `
    <div class="chat-roll" data-total="${total}">
      <div class="roll-container">
        <label>${label}</label><br/>
        <strong>${resultText}</strong>
      </div>

      ${edgeHeader}
      <hr/>
      ${rollsHtml}

      ${(riskBtn || stoBtn)
        ? `<div class="mg-risk-controls">
            ${riskBtn}
            ${stoBtn}
          </div>`
        : ""}
    </div>
  `;

  // ------------------------------------------------------------
  // STO: decide now, apply AFTER chat renders (prevents spoilers)
  // Failure = total 1–6, INCLUDING crit fails
  // ------------------------------------------------------------
  let pendingSTODelta = 0;

  const stoSession = {
    sessionId,
    stoApplied: false,
    stoAppliedDelta: 0, // 1 if STO actually incremented, 0 if capped
    stoUndone: false
  };

  if (actor && total <= 6 && !rollData?.fromSTO) {
    const cur = Number(actor.system?.sto?.value ?? 0);
    const next = Math.min(6, cur + 1);
    pendingSTODelta = (next !== cur) ? 1 : 0;

    stoSession.stoApplied = pendingSTODelta > 0;
    stoSession.stoAppliedDelta = pendingSTODelta;
  }

  // Create message FIRST so the roll is visible before STO ticks up
  const msgData = {
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: chatContent,
    roll: keptRoll, // keep KEPT roll as the canonical roll
    type: CONST.CHAT_MESSAGE_TYPES.ROLL,
    rollMode: game.settings.get("core", "rollMode")
  };

  // If your Foundry build supports "rolls", include both so Dice So Nice can animate both.
  // If it doesn't, this property will be ignored safely.
  if (edge && rollB) {
    msgData.rolls = [rollA, rollB];
  }

  const msg = await ChatMessage.create(msgData);

  // Apply STO after the roll is visible in chat (prevents outcome spoilers)
  if (actor && pendingSTODelta) {
    // Wait for dice visuals to finish if possible
    if (game.dice3d?.waitFor3DAnimationByMessageID) {
      await game.dice3d.waitFor3DAnimationByMessageID(msg.id);
    } else {
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    const cur = Number(actor.system?.sto?.value ?? 0);
    const next = Math.min(6, cur + 1);

    if (next !== cur) {
      await actor.update({ "system.sto.value": next }, { render: false });
    }
  }

  // Attach STO session info to the chat message (Risk It can reference it)
  await msg.setFlag("midnight-gambit", "stoSession", stoSession);

  return msg;
}
