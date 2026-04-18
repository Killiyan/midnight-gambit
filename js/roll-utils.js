export async function evaluateRoll({
  formula,
  rollData = {},
  skillMod = 0,
  modifierParts = null,
  modifierBreakdown = null, // NEW: optional richer metadata for chat display only
  label = "Roll",
  actor = null,
  edge = false,
  auraLabel = "",
  auraAttrMod = 0,
  auraSourceActorId = "",
  auraSourceTokenId = "",
  auraIconClass = "fa-eye-evil"
}) {
  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[m]));

  const normalizedParts = Array.isArray(modifierParts)
    ? modifierParts.map(n => Number(n)).filter(n => Number.isFinite(n) && n !== 0)
    : [];

  const formulaSuffix = normalizedParts.length
    ? normalizedParts.map(n => `${n >= 0 ? "+" : "-"} ${Math.abs(n)}`).join(" ")
    : (skillMod !== 0 ? `${skillMod >= 0 ? "+" : "-"} ${Math.abs(skillMod)}` : "");

  const actualFormula = formulaSuffix ? `${formula} ${formulaSuffix}` : formula;

  const doRoll = async () => {
    const r = new Roll(actualFormula, rollData);
    await r.evaluate({ async: true });
    return r;
  };

  const rollA = await doRoll();
  const rollB = edge ? await doRoll() : null;
  const keptRoll = (rollB && rollB.total > rollA.total) ? rollB : rollA;
  const total = Number(keptRoll.total ?? 0);

  const allDice = (keptRoll.terms?.[0]?.results ?? []).map((r, index) => ({
    index,
    value: Number(r.result) || 0,
    active: !!r.active
  }));

  const kept = allDice.filter(d => d.active).map(d => d.value);

  const isAce = kept.length && kept.every(d => d === 6);
  const isCrit = kept.length && kept.every(d => d === 1);
  const isFail = !isAce && !isCrit && total <= 6;
  const isComp = !isAce && !isCrit && total > 6 && total <= 10;
  const isFlourish = total >= 11;

  let resultLabel = "";
  let resultDesc = "";
  let resultIcon = "";
  let resultClass = "";

  if (isAce) {
    resultLabel = "ACE!";
    resultDesc = "You steal the spotlight.";
    resultIcon = "fa-star text-gold";
    resultClass = "result-ace";
  } else if (isCrit) {
    resultLabel = "Critical Failure";
    resultDesc = "It goes horribly wrong.";
    resultIcon = "fa-skull-crossbones";
    resultClass = "result-crit";
  } else if (isFail) {
    resultLabel = "Failure";
    resultDesc = "Something goes awry.";
    resultIcon = "fa-fire-flame result-fail";
    resultClass = "result-fail";
  } else if (isComp) {
    resultLabel = "Complication";
    resultDesc = "You achieve with a minor setback.";
    resultIcon = "fa-swords result-mixed";
    resultClass = "result-complication";
  } else {
    resultLabel = "Flourish";
    resultDesc = "Narrate your success.";
    resultIcon = "fa-crown flourish-animate";
    resultClass = "result-flourish";
  }

  const stoValue = Number(actor?.system?.sto?.value ?? 0);

  const needComp = total <= 6 ? (7 - total) : 0;
  const needFlourish = total <= 10 ? (11 - total) : 0;

  const canStoComp =
    !!actor &&
    !isAce &&
    total <= 6 &&
    needComp > 0 &&
    needComp <= stoValue;

  const canStoFlourish =
    !!actor &&
    !isAce &&
    total <= 10 &&
    needFlourish > 0 &&
    needFlourish <= stoValue;

  const stoCompBtn = `
    <button type="button"
      class="mg-spend-sto sto-complication ${canStoComp ? "" : "is-disabled"}"
      data-actor-id="${esc(actor?.id ?? "")}"
      data-spend="${needComp}"
      data-target="complication"
      ${canStoComp ? "" : 'disabled aria-disabled="true"'}
      title="Upgrade to Complication">
      <i class="fa-solid fa-swords"></i>
    </button>
  `;

  const stoFlourishBtn = `
    <button type="button"
      class="mg-spend-sto sto-flourish ${canStoFlourish ? "" : "is-disabled"}"
      data-actor-id="${esc(actor?.id ?? "")}"
      data-spend="${needFlourish}"
      data-target="flourish"
      ${canStoFlourish ? "" : 'disabled aria-disabled="true"'}
      title="Upgrade to Flourish">
      <i class="fa-solid fa-crown"></i>
    </button>
  `;

  const auraBlock = (auraLabel && auraAttrMod !== 0)
    ? `
      <div class="mg-aura-block">
        <div class="mg-aura-main">
          <span class="mg-aura-badge" title="${esc(auraLabel)}">
            <i class="fa-solid ${esc(auraIconClass)}"></i>
            ${auraAttrMod >= 0 ? "+" : ""}${auraAttrMod}
          </span>
        </div>

        ${auraSourceActorId ? `
          <button type="button"
            class="mg-remove-aura"
            data-aura-actor-id="${esc(auraSourceActorId)}"
            data-roll-actor-id="${esc(actor?.id ?? "")}"
            data-label="${esc(label)}"
            data-formula="${esc(formula)}"
            data-skill-mod="${skillMod}"
            data-edge="${edge ? "true" : "false"}"
            data-modifier-parts='${esc(JSON.stringify(modifierParts ?? []))}'
            data-aura-attr-mod="${auraAttrMod}"
            title="Remove Aura and reroll">
            <i class="fa-solid fa-ban"></i>
          </button>
        ` : ""}
      </div>
    `
    : "";

  const edgeHeader = edge
    ? `
      <div class="edge-label">
        <strong><i class="fa-solid fa-scythe"></i></strong>
        <span><strong>EDGE</strong> (rolled twice, kept higher)</span>
      </div>
    `
    : "";

  const sessionId = foundry.utils.randomID();
  const usedRisk = Number(actor?.system?.riskUsed ?? 0);
  const totalRisk = Number(actor?.system?.riskDice ?? 0);
  const canRisk = !!actor && kept.length >= 2 && usedRisk < totalRisk;

  const riskBtn = (actor && kept.length >= 2)
    ? `
      <button type="button"
        class="mg-risk-it ${canRisk ? "" : "is-disabled"}"
        data-actor-id="${esc(actor.id)}"
        data-kept="${kept.slice(0, 2).join(",")}"
        data-skill-mod="${skillMod}"
        data-session-id="${sessionId}"
        ${canRisk ? "" : 'disabled aria-disabled="true"'}
        title="Risk It">
        <i class="fa-kit fa-risk"></i>
      </button>
    `
    : "";

  const defaultBreakdown = [];
  if (!normalizedParts.length && skillMod !== 0) {
    defaultBreakdown.push({
      key: "skill",
      label: "Skill Bonus",
      icon: "fa-user-plus",
      value: Number(skillMod)
    });
  }

  const partsForDisplay = Array.isArray(modifierBreakdown) && modifierBreakdown.length
    ? modifierBreakdown
    : (normalizedParts.length
        ? normalizedParts.map((value, index) => ({
            key: `mod-${index}`,
            label: "Modifier",
            icon: "fa-circle",
            value
          }))
        : defaultBreakdown);

  const visibleParts = partsForDisplay
    .map(part => ({
      key: String(part?.key ?? "mod"),
      label: String(part?.label ?? "Modifier"),
      icon: String(part?.icon ?? "fa-circle"),
      value: Number(part?.value ?? 0)
    }))
    .filter(part => Number.isFinite(part.value) && part.value !== 0);
    
  const keptDiceDisplay = allDice.filter(die => die.active);
  const droppedDiceDisplay = allDice.filter(die => !die.active);

  const sortedTrayDice = [
    ...keptDiceDisplay,
    ...droppedDiceDisplay
  ];  

  const discardedEdgeRoll = edge && rollB
    ? (keptRoll === rollA ? rollB : rollA)
    : null;

  const discardedEdgeDice = discardedEdgeRoll
    ? (discardedEdgeRoll.terms?.[0]?.results ?? []).map((r, index) => ({
        index,
        value: Number(r.result) || 0,
        active: !!r.active
      }))
    : [];

  // Main visible bar = only the kept dice from the winning roll
  const diceHtml = `
    <div class="mg-roll-dice-list">
      ${keptDiceDisplay.map((die, displayIndex) => `
        <div
          class="mg-roll-die is-kept"
          data-die-index="${die.index}"
          data-display-index="${displayIndex}">
          ${die.value}
        </div>
      `).join("")}
    </div>
  `;

  // Tray group 1 = the FULL winning roll, with kept dice lit and dropped dice dark
  const keptRollTrayHtml = `
    <div class="mg-roll-tray-group mg-roll-tray-group-kept">
      ${sortedTrayDice.map((die, displayIndex) => `
        <div
          class="mg-roll-die ${die.active ? "is-kept" : "is-dropped"}"
          data-die-index="${die.index}"
          data-display-index="${displayIndex}">
          ${die.value}
        </div>
      `).join("")}
    </div>
  `;

  // Tray group 2 = the FULL discarded Edge roll, if Edge exists
  const discardedEdgeTrayHtml = discardedEdgeDice.length
    ? `
      <div class="mg-roll-tray-group mg-roll-tray-group-edge">
        ${discardedEdgeDice.map((die, displayIndex) => `
          <div
            class="mg-roll-die is-dropped"
            data-die-index="${die.index}"
            data-display-index="${displayIndex}">
            ${die.value}
          </div>
        `).join("")}
      </div>
    `
    : "";

  const hasDroppedDice = allDice.some(die => !die.active) || discardedEdgeDice.length > 0;

  const droppedDiceHtml = hasDroppedDice
    ? `
      <div class="mg-roll-dropped-panel" hidden>
        <div class="mg-roll-dropped-list">
          ${keptRollTrayHtml}
          ${discardedEdgeTrayHtml}
        </div>
      </div>
    `
    : "";

  const modifiersHtml = `
    <div class="mg-roll-modifiers ${visibleParts.length ? "" : "is-empty"}">
      ${visibleParts.map(part => `
        <div class="mg-roll-modifier" data-mod-key="${esc(part.key)}" title="${esc(part.label)}">
          <i class="fa-solid ${esc(part.icon)}"></i>
          <span class="mg-roll-mod-value">${part.value >= 0 ? "+" : ""}${part.value}</span>
        </div>
      `).join("")}
    </div>
  `;

  const controlButtons = `
    <div class="mg-roll-controls mg-risk-controls">
      ${riskBtn || `
        <button type="button" class="mg-roll-action is-disabled" disabled aria-disabled="true" title="Risk unavailable">
          <i class="fa-kit fa-risk"></i>
        </button>
      `}
      ${stoCompBtn}
      ${stoFlourishBtn}
    </div>
  `;

  const mathChevron = hasDroppedDice
    ? `
      <div class="mg-roll-expand-indicator" aria-hidden="true">
        <i class="fa-solid fa-chevron-down"></i>
      </div>
    `
    : "";  

  const edgeClass = edge ? "has-edge" : "";
  const chatContent = `
    <div class="mg-chat-card chat-roll mg-roll-card"
        data-total="${total}"
        data-actor-id="${actor.id}">
      <div class="mg-roll-header">
        <div class="mg-roll-label-wrap">
          <label class="mg-roll-label">${esc(label)}</label>
        </div>
        ${auraBlock}
      </div>

      <div class="roll-wrapper">
        <div class="mg-roll-outcome ${resultClass}">
          <div class="mg-roll-outcome-title">
            <i class="fa-solid ${resultIcon}"></i>
            <strong>${resultLabel}</strong>
          </div>
          <div class="mg-roll-outcome-text">${resultDesc}</div>
        </div>

        ${edgeHeader}

        <div class="mg-roll-math-wrap ${edge ? "has-edge" : ""}">
          <div class="mg-roll-math ${hasDroppedDice ? "is-interactive" : ""}" ${hasDroppedDice ? 'role="button" tabindex="0" aria-expanded="false"' : ""}>
            <div class="mg-roll-math-column">
              ${diceHtml}
              ${modifiersHtml}
            </div>
            ${mathChevron}

            <div class="mg-roll-total-box">
              <strong class="mg-roll-total">${total}</strong>
            </div>
          </div>

          ${droppedDiceHtml}
        </div>

        ${controlButtons}
      </div>
    </div>
  `;

  let pendingSTODelta = 0;

  const stoSession = {
    sessionId,
    stoApplied: false,
    stoAppliedDelta: 0,
    stoUndone: false
  };

  if (actor && total <= 6 && !rollData?.fromSTO) {
    const cur = Number(actor.system?.sto?.value ?? 0);
    const next = Math.min(6, cur + 1);
    pendingSTODelta = (next !== cur) ? 1 : 0;

    stoSession.stoApplied = pendingSTODelta > 0;
    stoSession.stoAppliedDelta = pendingSTODelta;
  }

  const msgData = {
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: chatContent,
    roll: keptRoll,
    type: CONST.CHAT_MESSAGE_TYPES.ROLL,
    rollMode: game.settings.get("core", "rollMode")
  };

  if (edge && rollB) {
    msgData.rolls = [rollA, rollB];
  }

  const msg = await ChatMessage.create(msgData);

  if (actor && pendingSTODelta) {
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

  await msg.setFlag("midnight-gambit", "stoSession", stoSession);
  return msg;
}