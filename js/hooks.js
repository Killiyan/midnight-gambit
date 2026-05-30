import { MidnightGambitCrewSheet } from "./crew-sheet.js";
import { MGInitiativeBar } from "./initiative-bar.js";
import { MGInitiativeSidebar } from "./initiative-sidebar.js";
import { MGInitiativeController } from "./initiative-controller.js";
import { evaluateRoll } from "./roll-utils.js";


async function mgEnsureBasicUserDrawingPermission() {
  if (!game.user.isGM) return;

  const permissionKey = "DRAWING_CREATE";
  const playerRole = CONST.USER_ROLES?.PLAYER ?? 1;

  try {
    const permissions = foundry.utils.deepClone(game.settings.get("core", "permissions") ?? {});
    const currentRole = permissions[permissionKey];

    if (Array.isArray(currentRole)) {
      if (currentRole.includes(playerRole)) return;
      permissions[permissionKey] = [...currentRole, playerRole].sort((a, b) => a - b);
      await game.settings.set("core", "permissions", permissions);
      console.info("MG | Enabled drawing creation for basic users.");
      return;
    }

    if (typeof currentRole === "number" && currentRole <= playerRole) return;

    permissions[permissionKey] = playerRole;
    await game.settings.set("core", "permissions", permissions);
    console.info("MG | Enabled drawing creation for basic users.");
  } catch (err) {
    console.warn("MG | Could not update Foundry drawing permission.", err);
  }
}


Hooks.once("ready", () => {
  // Singleton access for debugging in console: game.mgInitiative
  game.mgInitiative = MGInitiativeBar.instance;

  mgEnsureBasicUserDrawingPermission();
  renderAssignedGambitHand();

  game.socket.on("system.midnight-gambit", async (data) => {
    if (!data) return;

    if (data.type === "playClockSfx") {
      const sender = game.users.get(data.userId);
      if (!sender?.isGM || sender.id === game.user.id) return;
      mgPlayClockSfx(data.volume ?? 0.8);
      return;
    }

    if (data.type !== "makeGlobalItem") return;

    // Only the GM should answer promotion requests.
    if (!game.user.isGM) return;

    try {
      const itemData = foundry.utils.deepClone(data.itemData ?? {});
      if (!itemData.name || !itemData.type) {
        console.warn("MG | Invalid makeGlobalItem payload:", data);
        return;
      }

      delete itemData._id;

      const created = await Item.create(itemData, { renderSheet: false });

      const requestingUser = game.users.get(data.requestingUserId);
      const whisperTargets = requestingUser ? [requestingUser.id] : [];

      await ChatMessage.create({
        user: game.user.id,
        whisper: whisperTargets,
        content: `
          <div class="chat-item">
            <h2><i class="fa-solid fa-globe"></i> Global Item Created</h2>
            <p><strong>${created.name}</strong> was added to the Items directory.</p>
          </div>
        `
      });

      ui.notifications?.info(`Created global item: ${created.name}`);
    } catch (err) {
      console.error("MG | Failed to make global item:", err);
      ui.notifications?.error("Failed to make global item. See console.");
    }
  });
});


/*Create Actor
==============================================================================================================================================*/

//Creating the actor from template.json in root directory
Hooks.on("createActor", async (actor) => {
  if (actor.type !== "character") return;

  try {
    const response = await fetch("systems/midnight-gambit/template.json");
    const tpl = await response.json();

    if (tpl?.system) {
      await actor.update({ system: tpl.system }, { diff: false });
    }
    console.log("✅ Applied system template (system only)");
  } catch (err) {
    console.error("❌ Failed to apply template.json:", err);
  }
});

Hooks.on("createItem", async (item, options, userId) => {
  const actor = item.actor;
  if (!actor) return;
  if (item.type !== "move") return;

  const state = actor.getFlag("midnight-gambit", "state") ?? {};
  const pendingMoves = Number(state?.pending?.moves ?? 0);

  if (pendingMoves <= 0) return;

  const pending = {
    ...(state.pending ?? {}),
    moves: Math.max(0, pendingMoves - 1)
  };

  await actor.setFlag("midnight-gambit", "state", {
    ...state,
    pending
  });

  ui.notifications.info(`Learned Move added: ${item.name}`);
});

Hooks.on("updateActor", (actor) => {
  if (actor.id === game.user.character?.id) renderGambitHand(actor);
});

Hooks.on("updateUser", (user) => {
  if (user.id === game.user.id) renderAssignedGambitHand();
});

/* Setting Player's Gambit Hand
==============================================================================================================================================*/

function renderAssignedGambitHand() {
  renderGambitHand(mgGetAssignedCharacter());
}

function mgGetAssignedCharacter() {
  const actor = game.user.character;
  if (!actor || actor.type !== "character" || !actor.isOwner) return null;
  return actor;
}

function renderGambitHand(actor) {
  document.querySelectorAll("[data-mg-floating-gambit-hand], .gambit-hand-ui[id^='gambit-hand-ui-']").forEach(el => {
    el._mgGambitPositionCleanup?.();
    el.remove();
  });

  if (!actor) return;

  const drawnIds = actor.system.gambits.drawn ?? [];
  const drawnItems = drawnIds.map(entry => mgResolveGambitItem(actor, entry)).filter(Boolean);
  const deckIds = actor.system.gambits.deck ?? [];
  const moveItems = mgGetHandMoves(actor);
  const viewStorageKey = `midnight-gambit.gambitHandView.${game.user?.id ?? "user"}.${actor.id}`;
  let activeView = "gambits";
  try {
    activeView = localStorage.getItem(viewStorageKey) ?? "gambits";
  } catch (_) {}
  if (!["gambits", "moves"].includes(activeView)) activeView = "gambits";

  const handHtml = document.createElement("div");
  handHtml.id = "gambit-hand-ui";
  handHtml.dataset.mgFloatingGambitHand = "true";
  handHtml.dataset.actorId = actor.id;
  handHtml.classList.add("gambit-hand-ui", `gambit-design-${mgGetGambitCardDesign(actor)}`);
  handHtml.innerHTML = `
    <div class="gambit-hand-controls">
      <div class="gambit-hand-slide-controls" aria-hidden="true">
      
        <button class="gambit-hand-slide-left" type="button" title="Move Left" aria-label="Move Left">
          <i class="fa-solid fa-chevron-left"></i>
        </button>

        <button class="gambit-hand-slide-right" type="button" title="Move Right" aria-label="Move Right">
          <i class="fa-solid fa-chevron-right"></i>
        </button>
      </div>

      <div class="gambit-hand-perma-toggles">
        <button class="gambit-hand-view-toggle" type="button" title="Show Moves" aria-label="Show Moves" aria-pressed="false">
          <i class="fa-kit fa-mortal-strain"></i>
        </button>

        <button class="gambit-hand-toggle" type="button" aria-expanded="false" title="Show Gambits">
          <i class="fa-solid fa-chevron-up"></i>
        </button>  
      </div>

    </div>
    <div class="gambit-hand-stage">
      <div class="gambit-hand-cards gambit-hand-cards-gambits"></div>
      <div class="gambit-hand-cards gambit-hand-cards-moves"></div>
    </div>
  `;

  const toggle = handHtml.querySelector(".gambit-hand-toggle");
  const viewToggle = handHtml.querySelector(".gambit-hand-view-toggle");
  const slideControls = handHtml.querySelector(".gambit-hand-slide-controls");
  const slideLeft = handHtml.querySelector(".gambit-hand-slide-left");
  const slideRight = handHtml.querySelector(".gambit-hand-slide-right");
  const gambitCardsWrap = handHtml.querySelector(".gambit-hand-cards-gambits");
  const moveCardsWrap = handHtml.querySelector(".gambit-hand-cards-moves");
  let moveSlideIndex = 0;
  let visibleView = activeView;
  let viewSwitchTimer = null;

  const syncViewButton = () => {
    const movesActive = activeView === "moves";
    viewToggle?.classList.toggle("is-active", movesActive);
    viewToggle?.setAttribute("aria-pressed", String(movesActive));
    if (!movesActive) mgSetSlideControlsVisible(slideControls, false);
    if (viewToggle) {
      viewToggle.title = movesActive ? "Show Gambits" : "Show Moves";
      viewToggle.setAttribute("aria-label", viewToggle.title);
      const icon = viewToggle.querySelector("i");
      if (icon) icon.className = movesActive ? "fa-solid fa-cards" : "fa-kit fa-mortal-strain";
    }
  };

  const syncModeClasses = () => {
    const movesVisible = visibleView === "moves";
    handHtml.classList.toggle("is-moves-mode", movesVisible);
    handHtml.classList.toggle("is-gambits-mode", !movesVisible);
  };

  const syncVisibleLayer = () => {
    syncModeClasses();
    gambitCardsWrap?.classList.toggle("is-active-view", visibleView === "gambits");
    moveCardsWrap?.classList.toggle("is-active-view", visibleView === "moves");
  };

  const switchHandView = (nextView) => {
    if (!["gambits", "moves"].includes(nextView) || nextView === activeView || handHtml.classList.contains("is-view-switching")) return;

    window.clearTimeout(viewSwitchTimer);
    activeView = nextView;
    syncViewButton();

    try {
      localStorage.setItem(viewStorageKey, activeView);
    } catch (err) {
      console.warn("MG | Could not save Gambit hand view.", err);
    }

    gambitCardsWrap?.classList.remove("is-active-view");
    moveCardsWrap?.classList.remove("is-active-view");
    handHtml.classList.add("is-view-switching");

    viewSwitchTimer = window.setTimeout(() => {
      visibleView = activeView;
      syncVisibleLayer();
      handHtml.classList.remove("is-view-switching");

      if (visibleView === "moves") {
        moveSlideIndex = mgUpdateMoveHandSlider(moveCardsWrap, moveSlideIndex, slideLeft, slideRight, { jump: true });
      }
    }, 500);
  };

  const renderHands = () => {
    if (gambitCardsWrap) {
      gambitCardsWrap.innerHTML = "";
      renderGambitHandCards(actor, gambitCardsWrap, handHtml, drawnItems, deckIds);
    }

    if (moveCardsWrap) {
      moveCardsWrap.innerHTML = "";
      renderMoveHandCards(actor, moveCardsWrap, handHtml, moveItems);
      mgSetMoveHandScrollLayout(moveCardsWrap);
    }

    syncViewButton();
    visibleView = activeView;
    syncVisibleLayer();
    moveSlideIndex = 0;
    requestAnimationFrame(() => mgUpdateMoveHandSlider(moveCardsWrap, moveSlideIndex, slideLeft, slideRight, { jump: true }));
  };

  viewToggle?.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (handHtml.classList.contains("is-transitioning") || handHtml.classList.contains("is-view-switching")) return;

    switchHandView(activeView === "moves" ? "gambits" : "moves");
  });

  slideLeft?.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    moveSlideIndex += 1;
    moveSlideIndex = mgUpdateMoveHandSlider(moveCardsWrap, moveSlideIndex, slideLeft, slideRight);
  });

  slideRight?.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    moveSlideIndex -= 1;
    moveSlideIndex = mgUpdateMoveHandSlider(moveCardsWrap, moveSlideIndex, slideLeft, slideRight);
  });

  toggle.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    const expanded = !handHtml.classList.contains("is-expanded");
    const unlockDelay = 500;

    window.clearTimeout(handHtml._mgGambitTransitionTimer);
    handHtml.classList.add("is-transitioning");
    handHtml.classList.toggle("is-expanded", expanded);
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.title = expanded ? "Hide Gambits" : "Show Gambits";
    toggle.querySelector("i")?.classList.toggle("fa-chevron-down", expanded);
    toggle.querySelector("i")?.classList.toggle("fa-chevron-up", !expanded);

    const unlockCards = () => {
      handHtml.classList.remove("is-transitioning");
      handHtml.removeEventListener("transitionend", onTransitionEnd);
      window.clearTimeout(handHtml._mgGambitTransitionTimer);
      handHtml._mgGambitTransitionTimer = null;
    };

    const onTransitionEnd = (event) => {
      if (event.target !== handHtml || event.propertyName !== "transform") return;
      unlockCards();
    };

    handHtml.addEventListener("transitionend", onTransitionEnd);
    handHtml._mgGambitTransitionTimer = window.setTimeout(unlockCards, unlockDelay);
  });

  renderHands();
  document.body.appendChild(handHtml);
  mgTrackGambitHandPosition(handHtml);
}

function renderGambitHandCards(actor, cardsWrap, handHtml, drawnItems, deckIds) {
  const total = drawnItems.length;

  if (!total) {
    const empty = document.createElement("div");
    empty.className = "gambit-hand-empty";
    empty.innerHTML = deckIds.length
      ? `
        <button class="gambit-hand-draw" type="button">
          <i class="fa-solid fa-cards"></i>
          <span>Draw</span>
        </button>
      `
      : `
        <p class="gambit-hand-empty-message">Create a deck from the compendium before drawing.</p>
      `;

    if (deckIds.length) {
      empty.querySelector(".gambit-hand-draw")?.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        await mgDrawGambits(actor);
      });
    }

    cardsWrap.appendChild(empty);
  }

  drawnItems.forEach((card, i) => {
    const div = document.createElement("div");
    div.className = "gambit-hand-card";
    div.dataset.itemId = card.id;
    div.style.setProperty("--stack-index", String(i + 1));
    div.innerHTML = `
      <div class="gambit-title">${mgEscapeHtml(card.name)}</div>
    `;

    div.addEventListener("contextmenu", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (handHtml.classList.contains("is-transitioning")) return;
      await mgPreviewGambit(actor, card);
    });

    div.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (handHtml.classList.contains("is-transitioning")) return;
      await mgPlayGambit(actor, card);
    });

    cardsWrap.appendChild(div);
  });
}

function renderMoveHandCards(actor, cardsWrap, handHtml, moveItems) {
  const total = moveItems.length;

  if (!total) {
    const empty = document.createElement("div");
    empty.className = "gambit-hand-empty gambit-hand-empty-moves";
    empty.innerHTML = `
      <p class="gambit-hand-empty-message">No Moves available yet.</p>
    `;
    cardsWrap.appendChild(empty);
    return;
  }

  moveItems.forEach((move, i) => {
    const div = document.createElement("div");
    div.className = "gambit-hand-card gambit-move-hand-card";
    div.dataset.moveId = move.id;
    div.dataset.moveKind = move.kind;
    div.style.setProperty("--stack-index", String(i + 1));
    div.innerHTML = `
      <div class="gambit-move-kind"><i class="fa-solid ${mgGetMoveKindIcon(move)}"></i> ${mgEscapeHtml(move.label)}</div>
      <div class="gambit-title">${mgEscapeHtml(move.name)}</div>
    `;

    div.addEventListener("contextmenu", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (handHtml.classList.contains("is-transitioning")) return;
      await mgPreviewMove(actor, move);
    });

    div.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (handHtml.classList.contains("is-transitioning")) return;
      await mgPostMove(actor, move);
    });

    cardsWrap.appendChild(div);
  });
}

function mgSetMoveHandScrollLayout(cardsWrap) {
  if (!cardsWrap) return;

  Object.assign(cardsWrap.style, {
    width: "min(30rem, calc(100vw - 4rem))",
    maxWidth: "30rem",
    justifyContent: "flex-start",
    overflowX: "hidden",
    overflowY: "hidden",
  });
}

function mgClearMoveHandScrollLayout(cardsWrap) {
  if (!cardsWrap) return;

  [
    "width",
    "maxWidth",
    "justifyContent",
    "overflowX",
    "overflowY"
  ].forEach((prop) => cardsWrap.style.removeProperty(prop));

  cardsWrap.scrollLeft = 0;
}

function mgGetMoveHandSliderState(cardsWrap) {
  if (!cardsWrap) return { max: 0, step: 1, pages: 1 };

  const max = Math.max(0, cardsWrap.scrollWidth - cardsWrap.clientWidth);
  const step = Math.max(1, Math.floor(cardsWrap.clientWidth * 0.78));
  const pages = Math.max(1, Math.ceil(max / step) + 1);

  return { max, step, pages };
}

function mgUpdateMoveHandSlider(cardsWrap, requestedIndex, leftButton, rightButton, { jump = false } = {}) {
  const { max, step, pages } = mgGetMoveHandSliderState(cardsWrap);
  const index = Math.max(0, Math.min(pages - 1, Number(requestedIndex) || 0));
  const target = Math.max(0, max - (index * step));

  cardsWrap?.scrollTo?.({
    left: target,
    behavior: jump ? "auto" : "smooth"
  });

  if (leftButton) leftButton.disabled = index >= pages - 1 || max <= 0;
  if (rightButton) rightButton.disabled = index <= 0 || max <= 0;
  const controls = leftButton?.closest?.(".gambit-hand-slide-controls") || rightButton?.closest?.(".gambit-hand-slide-controls");
  if (controls) {
    const inMovesMode = cardsWrap?.closest?.(".gambit-hand-ui")?.classList?.contains("is-moves-mode");
    mgSetSlideControlsVisible(controls, inMovesMode && pages > 1 && max > 8);
  }

  return index;
}

function mgSetSlideControlsVisible(controls, visible) {
  if (!controls) return;
  controls.classList.toggle("is-visible", !!visible);
  controls.setAttribute("aria-hidden", visible ? "false" : "true");
}

function mgTrackGambitHandPosition(handHtml) {
  let raf = null;
  let followUntil = 0;

  const follow = () => {
    mgPositionGambitHand(handHtml);
    if (performance.now() < followUntil) raf = requestAnimationFrame(follow);
    else raf = null;
  };

  const update = () => {
    followUntil = performance.now() + 600;
    if (!raf) follow();
  };

  update();
  window.addEventListener("resize", update, { passive: true });

  const sidebar = document.querySelector("#sidebar");
  const uiRight = document.querySelector("#ui-right");
  const resizeObserver = globalThis.ResizeObserver ? new ResizeObserver(update) : null;
  if (resizeObserver) {
    if (sidebar) resizeObserver.observe(sidebar);
    if (uiRight) resizeObserver.observe(uiRight);
  }

  const mutationObserver = new MutationObserver(update);
  [sidebar, uiRight, document.body].filter(Boolean).forEach(el => {
    mutationObserver.observe(el, { attributes: true, attributeFilter: ["class", "style"] });
  });

  handHtml._mgGambitPositionCleanup = () => {
    window.removeEventListener("resize", update);
    if (raf) cancelAnimationFrame(raf);
    resizeObserver?.disconnect();
    mutationObserver.disconnect();
  };
}

function mgPositionGambitHand(handHtml) {
  const gutter = 16;
  let right = gutter;

  const sidebar = document.querySelector("#sidebar");
  if (sidebar) {
    const rect = sidebar.getBoundingClientRect();
    const style = getComputedStyle(sidebar);
    const isVisible = style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.left < window.innerWidth;
    if (isVisible) right = Math.max(gutter, window.innerWidth - rect.left + gutter);
  }

  handHtml.style.setProperty("--mg-gambit-dock-right", `${right}px`);
}

async function mgPlayGambit(actor, card) {
  const descHtml = await mgGambitDescriptionHtml(card);

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="gambit-chat-card">
        <h2><i class="fa-solid fa-cards"></i> ${mgEscapeHtml(card.name)}</h2>
        ${descHtml}
      </div>
    `
  });

  const { drawn = [], discard = [] } = actor.system.gambits;
  const cardId = mgGambitEntryId(card);
  const newDrawn = drawn.filter(entry => mgGambitEntryId(entry) !== cardId);
  const newDiscard = [...discard, cardId];

  await actor.update({
    "system.gambits.drawn": newDrawn,
    "system.gambits.discard": newDiscard
  });

  document.querySelectorAll(".gambit-hand-card").forEach(cardEl => {
    if (cardEl.dataset.itemId === cardId) cardEl.remove();
  });
  document.querySelector(".mg-gz-backdrop")?.remove();
}

async function mgPreviewGambit(actor, card) {
  document.querySelector(".mg-gz-backdrop")?.remove();

  const descHtml = await mgGambitDescriptionHtml(card);
  const overlay = document.createElement("div");
  overlay.className = `mg-gz-backdrop gambit-design-${mgGetGambitCardDesign(actor)}`;
  overlay.innerHTML = `
    <article class="mg-gz-card" role="dialog" aria-modal="true" aria-label="${mgEscapeHtml(card.name)}">
      <button class="mg-gz-close" type="button" title="Close" aria-label="Close">
        <i class="fa-solid fa-xmark"></i>
      </button>
      <h2 class="gambit-title">${mgEscapeHtml(card.name)}</h2>
      <div class="mg-gz-body">${descHtml || "<em>No description.</em>"}</div>
      <button class="mg-gz-play" type="button">
        <i class="fa-solid fa-play"></i>
        <span>Play</span>
      </button>
    </article>
  `;

  const close = () => overlay.remove();
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay || ev.target.closest(".mg-gz-close")) close();
  });
  overlay.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    if (ev.target === overlay) close();
  });
  overlay.querySelector(".mg-gz-play")?.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    await mgPlayGambit(actor, card);
  });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("mg-gz-show"));
}

async function mgPostMove(actor, move) {
  const descHtml = await mgMoveDescriptionHtml(move);
  const icon = mgGetMoveKindIcon(move);

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="chat-move">
        <h2><i class="fa-solid ${icon}"></i> ${mgEscapeHtml(move.name)}</h2>
        ${descHtml}
      </div>
    `
  });
}

async function mgPreviewMove(actor, move) {
  document.querySelector(".mg-gz-backdrop")?.remove();

  const descHtml = await mgMoveDescriptionHtml(move);
  const icon = mgGetMoveKindIcon(move);
  const overlay = document.createElement("div");
  overlay.className = `mg-gz-backdrop gambit-design-${mgGetGambitCardDesign(actor)} mg-move-preview`;
  overlay.dataset.moveKind = move.kind || "basic";
  overlay.innerHTML = `
    <article class="mg-gz-card" role="dialog" aria-modal="true" aria-label="${mgEscapeHtml(move.name)}">
      <button class="mg-gz-close" type="button" title="Close" aria-label="Close">
        <i class="fa-solid fa-xmark"></i>
      </button>
      <div class="gambit-move-kind"><span><i class="fa-solid ${icon}"></i> ${mgEscapeHtml(move.label)}</span></div>
      <h2 class="gambit-title">${mgEscapeHtml(move.name)}</h2>
      <div class="mg-gz-body">${descHtml || "<em>No description.</em>"}</div>
      <button class="mg-gz-play mg-gz-post-move" type="button">
        <i class="fa-solid fa-messages"></i>
        <span>Post</span>
      </button>
    </article>
  `;

  const close = () => overlay.remove();
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay || ev.target.closest(".mg-gz-close")) close();
  });
  overlay.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    if (ev.target === overlay) close();
  });
  overlay.querySelector(".mg-gz-post-move")?.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    await mgPostMove(actor, move);
    close();
  });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("mg-gz-show"));
}

function mgGetMoveKindIcon(move) {
  switch (move?.kind) {
    case "signature":
      return "fa-diamond";
    case "learned":
      return "fa-book";
    default:
      return "fa-hand-fist";
  }
}

async function mgGambitDescriptionHtml(card) {
  const raw = card?.system?.description ?? "";
  if (globalThis.TextEditor?.enrichHTML) return TextEditor.enrichHTML(raw, { async: true });
  return raw ? `<p>${mgEscapeHtml(raw)}</p>` : "";
}

async function mgMoveDescriptionHtml(move) {
  const raw = move?.description ?? "";
  if (globalThis.TextEditor?.enrichHTML) return TextEditor.enrichHTML(raw, { async: true });
  return raw ? `<p>${mgEscapeHtml(raw)}</p>` : "";
}

async function mgDrawGambits(actor) {
  const { deck = [], drawn = [], maxDrawSize = 3, locked = false } = actor.system.gambits ?? {};

  if (locked || drawn.length >= maxDrawSize || deck.length === 0) {
    ui.notifications.warn("Cannot draw more cards.");
    return;
  }

  const drawCount = Math.min(maxDrawSize - drawn.length, deck.length);
  const shuffled = mgShuffle(deck);
  const drawnNow = shuffled.slice(0, drawCount);
  const newDrawn = [...drawn, ...drawnNow];
  const newDeck = deck.filter(id => !drawnNow.includes(id));

  await actor.update({
    "system.gambits.deck": newDeck,
    "system.gambits.drawn": newDrawn,
    "system.gambits.locked": true
  });

  renderGambitHand(actor);
}

function mgShuffle(array) {
  const copy = [...(array ?? [])];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function mgResolveGambitItem(actor, entry) {
  const id = mgGambitEntryId(entry);
  if (id) return actor.items.get(id) ?? game.items?.get(id) ?? globalThis.fromUuidSync?.(id) ?? null;
  if (entry?.name) return entry;
  return null;
}

function mgGambitEntryId(entry) {
  if (!entry) return null;
  if (typeof entry === "string") return entry;
  return entry.id ?? entry._id ?? entry.uuid ?? null;
}

function mgGetGambitCardDesign(actor) {
  const design = actor?.system?.gambits?.cardDesign || "midnight";
  return ["pearl", "cobalt", "midnight", "noir"].includes(design) ? design : "midnight";
}

function mgGetHandMoves(actor) {
  const moves = [];
  const seen = new Set();
  const allGuises = actor.items.filter(i => i.type === "guise");
  const primaryRef = actor.system?.guiseId || actor.system?.guise || null;
  const primaryGuise = primaryRef
    ? actor.items.get(primaryRef) || allGuises.find(g => g.uuid === primaryRef) || null
    : null;

  const addMove = ({ id, name, description, kind, label, sourceOrder = 0 }) => {
    const cleanName = String(name ?? "").trim();
    const cleanDescription = String(description ?? "").trim();
    if (!cleanName && !cleanDescription) return;

    const key = id || `${kind}:${cleanName}:${cleanDescription}`;
    if (seen.has(key)) return;
    seen.add(key);

    moves.push({
      id: key,
      name: cleanName || "Unnamed Move",
      description: cleanDescription,
      kind,
      label,
      sourceOrder
    });
  };

  const addGuiseMoves = (guise, sourceOrder) => {
    if (!guise) return;

    addMove({
      id: `signature:${guise.id}`,
      name: guise.system?.signaturePerk ?? guise.name,
      description: guise.system?.signatureDescription ?? "",
      kind: "signature",
      label: "Signature Perk",
      sourceOrder
    });

    const rawMoves = Array.isArray(guise.system?.moves) ? guise.system.moves : [];
    rawMoves.forEach((move, index) => {
      addMove({
        id: `basic:${guise.id}:${index}:${move?.name ?? ""}`,
        name: move?.name ?? "Unnamed Move",
        description: move?.description ?? "",
        kind: "basic",
        label: "Basic Move",
        sourceOrder: sourceOrder + index / 100
      });
    });
  };

  addGuiseMoves(primaryGuise, 0);

  allGuises
    .filter(g => !primaryGuise || g.id !== primaryGuise.id)
    .forEach((guise, index) => addGuiseMoves(guise, 10 + index));

  actor.items
    .filter(item => item.type === "move" && item.system?.isSignature === true)
    .forEach((item, index) => {
      addMove({
        id: item.id,
        name: item.name,
        description: item.system?.description ?? "",
        kind: "signature",
        label: "Signature Perk",
        sourceOrder: 50 + index
      });
    });

  const learnedOrder = actor.getFlag("midnight-gambit", "moveOrder") ?? [];
  const learnedOrderMap = new Map(
    (Array.isArray(learnedOrder) ? learnedOrder : []).map((id, index) => [id, index])
  );

  actor.items
    .filter(item => item.type === "move" && item.system?.learned === true && item.system?.isSignature !== true)
    .sort((a, b) => {
      const aOrder = learnedOrderMap.has(a.id) ? learnedOrderMap.get(a.id) : Number.MAX_SAFE_INTEGER;
      const bOrder = learnedOrderMap.has(b.id) ? learnedOrderMap.get(b.id) : Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder;
    })
    .forEach((item, index) => {
      addMove({
        id: item.id,
        name: item.name,
        description: item.system?.description ?? "",
        kind: "learned",
        label: "Learned Move",
        sourceOrder: 100 + index
      });
    });

  return moves.sort((a, b) => a.sourceOrder - b.sourceOrder || a.name.localeCompare(b.name));
}

function mgEscapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* MG Chat Hook
==============================================================================================================================================*/

Hooks.once("init", () => {
  game.settings.register("midnight-gambit", "chatPortraitSource", {
    name: "Chat Portrait Source",
    hint: "Which image to show next to chat messages.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      token: "Token image (if present)",
      actor: "Actor image",
      user: "User avatar"
    },
    default: "token"
  });

  game.settings.register("midnight-gambit", "chatPortraitSize", {
    name: "Chat Portrait Size (px)",
    hint: "Square size of the portrait next to chat messages.",
    scope: "world",
    config: true,
    type: Number,
    default: 38,
    range: { min: 24, max: 96, step: 2 }
  });

  game.settings.register("midnight-gambit", "chatPortraitShape", {
    name: "Chat Portrait Shape",
    hint: "How the portrait should be masked.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      circle: "Circle",
      rounded: "Rounded square",
      square: "Square"
    },
    default: "circle"
  });

  // --- Crew Sheet registration ---
  Actors.registerSheet("midnight-gambit", MidnightGambitCrewSheet, {
    types: ["crew"],
    makeDefault: true
  });

  const reg = game.settings?.settings;
  if (!reg) return;

  // Crew Actor ID used by Initiative bar and "Open Crew Sheet"
  if (!reg.has("midnight-gambit.crewActorId")) {
    game.settings.register("midnight-gambit", "crewActorId", {
      name: "Crew Actor (Initiative Source)",
      hint: "Actor ID for the active Crew/Party. Set from the Crew sheet via 'Link to Initiative Bar'.",
      scope: "world",
      config: false,          // hidden from UI (you already control it in-sheet)
      type: String,
      default: ""
    });
  }
  // Legacy setting some older snippets wrote; keep it for back-compat
  if (!reg.has("midnight-gambit.activeCrewUuid")) {
    game.settings.register("midnight-gambit", "activeCrewUuid", {
      name: "Legacy Active Crew UUID",
      scope: "world",
      config: false,
      type: String,
      default: ""
    });
  }

  if (!reg.has("midnight-gambit.initiativeSidebarCollapsed")) {
    game.settings.register("midnight-gambit", "initiativeSidebarCollapsed", {
      name: "Initiative Sidebar Collapsed",
      scope: "client",
      config: false,
      type: Boolean,
      default: false
    });
  }

  if (!reg.has("midnight-gambit.initiativeViewMode")) {
    game.settings.register("midnight-gambit", "initiativeViewMode", {
      name: "Initiative View Mode",
      hint: "Overlay, Sidebar, Both, or Off.",
      scope: "client",
      config: true,
      type: String,
      choices: {
        overlay: "Overlay",
        sidebar: "Sidebar",
        both: "Both",
        off: "Off"
      },
      default: "overlay",
      onChange: async () => {
        // settings can change after init; only run once UI exists
        try {
          const mode = game.settings.get("midnight-gambit", "initiativeViewMode");
          if (mode === "sidebar" || mode === "both") {
            await MGInitiativeSidebar.instance.mount();
            game.mgInitiativeSidebar = MGInitiativeSidebar.instance;
          } else {
            await MGInitiativeSidebar.instance.unmount();
          }
        } catch (e) {
          console.error("MG | initiativeViewMode onChange failed:", e);
        }
      }
    });
  }

  if (!reg.has("midnight-gambit.globalClocks")) {
    game.settings.register("midnight-gambit", "globalClocks", {
      name: "Global Clocks",
      scope: "world",
      config: false,
      type: Object,
      default: {},
      onChange: () => {
        try {
          mgRenderAllClocks();
          globalThis.mgRefreshClocksSidebarContent?.();
        } catch (err) {
          console.warn("MG | Global clock refresh failed.", err);
        }
      }
    });
  }
});

Hooks.on("renderChatMessage", (message, html) => {
  const btn = html[0]?.querySelector(".mg-remove-aura");
  if (!btn || !game.user.isGM) return;

  btn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    const auraActorId = btn.dataset.auraActorId;
    const rollActorId = btn.dataset.rollActorId;
    const label = btn.dataset.label || "Roll";
    const formula = btn.dataset.formula || "2d6kh2";
    const skillMod = Number(btn.dataset.skillMod ?? 0);
    const edge = btn.dataset.edge === "true";
    const auraAttrMod = Number(btn.dataset.auraAttrMod ?? 0);

    let modifierParts = [];
    try {
      modifierParts = JSON.parse(btn.dataset.modifierParts || "[]");
    } catch (_) {
      modifierParts = [];
    }

    let modifierBreakdown = [];
    try {
      modifierBreakdown = JSON.parse(btn.dataset.modifierBreakdown || "[]");
    } catch (_) {
      modifierBreakdown = [];
    }

    const auraActor = game.actors.get(auraActorId);
    const rollActor = game.actors.get(rollActorId);

    if (auraActor) {
      await auraActor.update({ "system.aura.enabled": false }, { render: false });
    }

    const replayBreakdown = Array.isArray(modifierBreakdown) && modifierBreakdown.length
      ? modifierBreakdown.filter(part => part?.key !== "aura")
      : [];

    // Remove the aura amount from the modifier parts for the replay roll.
    // New cards carry keyed breakdown data so equal-valued difficulty mods survive correctly.
    const replayParts = replayBreakdown.length
      ? replayBreakdown.map(part => Number(part?.value ?? 0))
      : modifierParts.slice();

    if (!replayBreakdown.length) {
      const idx = replayParts.indexOf(auraAttrMod);
      if (idx !== -1) replayParts.splice(idx, 1);
    }

    const replaySkillMod = skillMod - auraAttrMod;

    await evaluateRoll({
      formula,
      rollData: {},
      skillMod: replaySkillMod,
      modifierParts: replayParts,
      modifierBreakdown: replayBreakdown,
      label,
      actor: rollActor,
      edge,
      auraLabel: "",
      auraAttrMod: 0,
      auraSourceActorId: "",
      auraSourceTokenId: ""
    });

    btn.disabled = true;
    btn.classList.add("is-disabled");
  }, { once: true });
});

/* Get Crew Sheet Helper
==============================================================================================================================================*/
function mgGetSettingSafe(module, key) {
  try { return game.settings.get(module, key); } catch { return null; }
}

// Resolve the current Crew actor we should open
async function mgResolveCurrentCrewActor() {
  // 1) Preferred: world setting by Actor ID
  const id = mgGetSettingSafe("midnight-gambit", "crewActorId");
  if (id) {
    const a = game.actors.get(id);
    if (a) return a;
  }

  // 2) Legacy: world setting by Actor UUID
  const legacy = mgGetSettingSafe("midnight-gambit", "activeCrewUuid");
  if (legacy) {
    try {
      const doc = await fromUuid(legacy);
      if (doc?.documentName === "Actor") return doc;
    } catch (_) {}
  }

  // 3) Scene flag fallback (useful if you ever store per-scene Crew)
  const sceneCrewId = canvas?.scene?.getFlag("midnight-gambit", "crewActorId");
  if (sceneCrewId) {
    const a = game.actors.get(sceneCrewId);
    if (a) return a;
  }

  // 4) Last resort: first Actor of type "crew"
  const anyCrew = game.actors.find(a => a.type === "crew");
  if (anyCrew) return anyCrew;

  return null;
}



/* MG Clock functions - renders for all but only GM can edit
==============================================================================================================================================*/

const MG_NS = "midnight-gambit";
const MG_CLOCK_SFX = "systems/midnight-gambit/assets/sounds/gambit-clock.ogg";

function mgClamp01(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function mgGetInterfaceVolume() {
  try {
    return mgClamp01(game.settings?.get?.("core", "globalInterfaceVolume"), 1);
  } catch (_) {
    return 1;
  }
}

function mgPlayClockSfx(baseVolume = 0.8, { broadcast = false } = {}) {
  const volume = mgClamp01(baseVolume, 0.8) * mgGetInterfaceVolume();

  AudioHelper.play(
    { src: MG_CLOCK_SFX, volume, autoplay: true, loop: false },
    false
  );

  if (broadcast && game.user?.isGM) {
    game.socket?.emit?.("system.midnight-gambit", {
      type: "playClockSfx",
      userId: game.user.id,
      volume: mgClamp01(baseVolume, 0.8)
    });
  }
}

// Setting timing for the comet sweep
const MG_SWEEP_PERIOD_MS = 1300;
// Pause at the end of each comet loop (ms)
const MG_SWEEP_PAUSE_MS = 200;
// Force comet direction (true = clockwise, false = counter-clockwise)
const MG_SWEEP_CLOCKWISE = true
// Fade from ~8:30–9 o’clock toward noon, and finish before noon
const MG_SWEEP_FADE_START_RATIO = 0.70; // begin fade at 70% of the travel (~252°)
const MG_SWEEP_FADE_END_RATIO   = 0.95; // fully faded by 92% of travel (~331°)
// Visual thickness (relative to ring stroke width)
const MG_COMET_HEAD_SCALE       = 1.05; // head = sw * 1.05 (round cap)
const MG_COMET_TAIL_SCALE       = 0.70; // tail = sw * 0.70 (butt cap, blurred)

// --- Handle (queen) icon ---
function mgGetHandleUrl() {
  const sysId = game?.system?.id ?? "midnight-gambit";
  return `systems/${sysId}/assets/images/mg-queen.png`;
}

const MG_HANDLE_SIZE = 50;   // px (unscaled)

/* Multi-clock scene + per-user UI flags
----------------------------------------------------------------------*/
const FLAG_CLOCKS = "clocks";
const SETTING_GLOBAL_CLOCKS = "globalClocks";
const UFLAG_UI    = "clockUi";
const UFLAG_CLOCKS_HIDDEN = "clockUiHidden";
const CLOCK_SCOPE_SCENE = "scene";
const CLOCK_SCOPE_GLOBAL = "global";
const CLOCK_DOCK_UI_ID = "__clockDock";

// Small id helper
function mgNewId() {
  return (foundry?.utils?.randomID?.(8)) ?? Math.random().toString(36).slice(2, 10);
}

function mgNormalizeClockScope(scope) {
  return scope === CLOCK_SCOPE_GLOBAL ? CLOCK_SCOPE_GLOBAL : CLOCK_SCOPE_SCENE;
}

function mgClockDomId(scope, id, mode = "canvas") {
  const prefix = mode === "sidebar" ? "mg-sidebar-clock" : "mg-clock";
  return `${prefix}-${mgNormalizeClockScope(scope)}-${id}`;
}

function mgClockSelector(scope, id) {
  return `#${mgClockDomId(scope, id, "canvas")}`;
}

function mgClockScopeFromWrap($wrap) {
  return mgNormalizeClockScope($wrap?.data?.("clockScope") ?? $wrap?.[0]?.dataset?.clockScope);
}

function mgEnsureClockDockDOM() {
  let dock = document.getElementById("mg-clock-dock");
  if (dock) {
    mgApplyDockCollapsed(dock);
    return dock;
  }

  dock = document.createElement("div");
  dock.id = "mg-clock-dock";
  dock.className = "mg-clock-dock";
  dock.innerHTML = `
    <div class="mg-clock-dock-grip" title="Drag clocks" data-mg-clock-dock-grip>
      <i class="fa-solid fa-grip-lines"></i>
    </div>
    <div class="mg-clock-dock-list" data-mg-clock-dock-list></div>
  `;
  document.body.appendChild(dock);
  mgApplyDockPos();
  mgApplyDockCollapsed(dock);
  mgBindClockDock(dock);
  return dock;
}

function mgGetClockDockList() {
  const dock = mgEnsureClockDockDOM();
  return dock.querySelector("[data-mg-clock-dock-list]") ?? dock;
}

// Get the full clocks map
function mgClocksGetAll(scope = CLOCK_SCOPE_SCENE) {
  scope = mgNormalizeClockScope(scope);
  if (scope === CLOCK_SCOPE_GLOBAL) {
    try {
      return game.settings?.get?.(MG_NS, SETTING_GLOBAL_CLOCKS) ?? {};
    } catch (_) {
      return {};
    }
  }
  return canvas.scene?.getFlag(MG_NS, FLAG_CLOCKS) ?? {};
}

function mgClocksGetVisibleRefs() {
  const refs = [];
  for (const [scope, clocks] of [
    [CLOCK_SCOPE_GLOBAL, mgClocksGetAll(CLOCK_SCOPE_GLOBAL)],
    [CLOCK_SCOPE_SCENE, mgClocksGetAll(CLOCK_SCOPE_SCENE)]
  ]) {
    for (const id of Object.keys(clocks ?? {})) {
      if (!game.user.isGM && clocks[id]?.gmOnly) continue;
      refs.push({ id, scope });
    }
  }
  return refs.sort((a, b) => {
    const ac = mgClockGetById(a.id, a.scope);
    const bc = mgClockGetById(b.id, b.scope);
    return (Number(bc.createdAt) || 0) - (Number(ac.createdAt) || 0);
  });
}

// Get ONE clock (safe defaults)
function mgClockGetById(id, scope = CLOCK_SCOPE_SCENE) {
  scope = mgNormalizeClockScope(scope);
  const c = (mgClocksGetAll(scope))[id] ?? {};
  const total  = Number.isFinite(+c.total)  ? Math.max(1, Math.min(200, +c.total)) : 8;
  const filled = Number.isFinite(+c.filled) ? Math.max(0, Math.min(total, +c.filled)) : 0;
  const name   = (c.name ?? "").toString();
  const gmOnly = !!c.gmOnly; // NEW
  const createdAt = Number(c.createdAt) || 0;
  return { id, scope, name, total, filled, gmOnly, createdAt };
}

// Scene flag updaters
async function mgClockSetById(id, patch, scope = CLOCK_SCOPE_SCENE) {
  if (!game.user.isGM) return;
  scope = mgNormalizeClockScope(scope);
  const curr = mgClockGetById(id, scope);
  const next = { ...curr, ...patch, id, scope };
  delete next.scope;
  if (scope === CLOCK_SCOPE_GLOBAL) {
    const all = { ...mgClocksGetAll(CLOCK_SCOPE_GLOBAL), [id]: next };
    await game.settings.set(MG_NS, SETTING_GLOBAL_CLOCKS, all);
  } else {
    if (!canvas.scene) return;
    await canvas.scene.setFlag(MG_NS, `${FLAG_CLOCKS}.${id}`, next);
  }
  globalThis.mgRefreshClocksSidebarContent?.();
}

async function mgClockResetToById(id, n, scope = CLOCK_SCOPE_SCENE) {
  if (!game.user.isGM) return;
  n = Math.max(1, Math.min(200, Number(n) || 1));
  const curr = mgClockGetById(id, scope);
  await mgClockSetById(id, { ...curr, total: n, filled: 0 }, scope);
}

async function mgClockDeleteById(id, scope = CLOCK_SCOPE_SCENE) {
  if (!game.user.isGM) return;
  scope = mgNormalizeClockScope(scope);
  if (scope === CLOCK_SCOPE_GLOBAL) {
    const all = { ...mgClocksGetAll(CLOCK_SCOPE_GLOBAL) };
    delete all[id];
    await game.settings.set(MG_NS, SETTING_GLOBAL_CLOCKS, all);
  } else {
    if (!canvas.scene) return;
    await canvas.scene.unsetFlag(MG_NS, `${FLAG_CLOCKS}.${id}`);
  }
  $(mgClockSelector(scope, id)).remove();
  document.querySelector(`[data-mg-sidebar-clock="${scope}:${id}"]`)?.remove();
  globalThis.mgRefreshClocksSidebarContent?.();
}

// Create a new clock (returns id)
async function mgClockCreate(initial = {}) {
  if (!game.user.isGM) return null;
  const scope = mgNormalizeClockScope(initial.scope);
  if (scope === CLOCK_SCOPE_SCENE && !canvas.scene) return null;
  const id = mgNewId();
  const def = { name: "Clock", total: 8, filled: 0, gmOnly: false, createdAt: Date.now(), ...initial };
  delete def.scope;
  if (scope === CLOCK_SCOPE_GLOBAL) {
    const all = { ...mgClocksGetAll(CLOCK_SCOPE_GLOBAL), [id]: def };
    await game.settings.set(MG_NS, SETTING_GLOBAL_CLOCKS, all);
  } else {
    await canvas.scene.setFlag(MG_NS, `${FLAG_CLOCKS}.${id}`, def);
  }
  globalThis.mgRefreshClocksSidebarContent?.();
  return id;
}

async function mgClockMoveScope(id, fromScope, toScope) {
  if (!game.user.isGM) return;
  fromScope = mgNormalizeClockScope(fromScope);
  toScope = mgNormalizeClockScope(toScope);
  if (fromScope === toScope) return;
  const clock = mgClockGetById(id, fromScope);
  await mgClockDeleteById(id, fromScope);
  const data = { ...clock, createdAt: Date.now() };
  delete data.scope;
  if (toScope === CLOCK_SCOPE_GLOBAL) {
    const all = { ...mgClocksGetAll(CLOCK_SCOPE_GLOBAL), [id]: data };
    await game.settings.set(MG_NS, SETTING_GLOBAL_CLOCKS, all);
  } else if (canvas.scene) {
    await canvas.scene.setFlag(MG_NS, `${FLAG_CLOCKS}.${id}`, data);
  }
  await mgRenderAllClocks();
  globalThis.mgRefreshClocksSidebarContent?.();
}

/* Local updater to support Scrub
----------------------------------------------------------------------*/
function mgLocalSetFilled($wrap, id, n /* filled */) {
  const scope = mgClockScopeFromWrap($wrap);
  const { total } = mgClockGetById(id, scope);

  // clamp filled and compute remaining
  const filled = Math.max(0, Math.min(total, n));
  const remaining = mgRemaining(total, filled);

  // Mark first `remaining` segments as ON; rest OFF (used)
  const segs = $wrap.find("path.seg");
  for (let i = 0; i < segs.length; i++) {
    const p = segs[i];
    if (i < remaining) { p.classList.add("on");  p.classList.remove("off"); p.removeAttribute("opacity"); }
    else               { p.classList.add("off"); p.classList.remove("on");  p.setAttribute("opacity","0.6"); }
  }

  // Update the numeric readout to remaining/total
  const cnt   = $wrap.find(".mg-clock-count")[0];
  const badge = $wrap.find(".mg-clock-badge")[0];
  if (cnt)   cnt.innerHTML   = `<span class="clock-major">${remaining}</span><span class="clock-small">/${total}</span>`;
  if (badge) badge.innerHTML = `<span class="clock-major">${remaining}</span><span class="clock-small">/${total}</span>`;

  // Handle sits at the end of the remaining arc
  const angle = (remaining > 0) ? mgEndAngleForIndex(remaining - 1, total) : -90;
  mgPlaceHandle($wrap, id, angle);

  // Recolor stage (Blue / Yellow / Red) based on what's left
  mgApplySegColors($wrap, id);
  mgUpdateRings($wrap, id);
}

function mgRemaining(total, filled) {
  return Math.max(0, total - Math.max(0, Math.min(total, filled)));
}

/* Remaining segments mask helper
----------------------------------------------------------------------*/
function mgEnsureRemainingMask(svg, id, total, filled, cx, cy, r, sw, hideSliceDeg = 0) {
  const NS = "http://www.w3.org/2000/svg";
  const maskId = `mg-rem-mask-${id}`;

  // ensure <defs>
  let defs = svg.querySelector("defs.mg-glows");
  if (!defs) {
    defs = document.createElementNS(NS, "defs");
    defs.setAttribute("class", "mg-glows");
    svg.prepend(defs);
  }

  // create or find mask
  let mask = svg.querySelector(`#${maskId}`);
  if (!mask) {
    mask = document.createElementNS(NS, "mask");
    mask.setAttribute("id", maskId);
    defs.appendChild(mask);
  }

  // clear previous
  while (mask.firstChild) mask.removeChild(mask.firstChild);

  // base: everything hidden
  const vb = (svg.getAttribute("viewBox") || "0 0 120 120").split(/\s+/).map(Number);
  const base = document.createElementNS(NS, "rect");
  base.setAttribute("x", "0"); base.setAttribute("y", "0");
  base.setAttribute("width", String(vb[2] || 120));
  base.setAttribute("height", String(vb[3] || 120));
  base.setAttribute("fill", "black");
  mask.appendChild(base);

  const remaining = Math.max(0, total - filled);
  const revealStroke = Math.max(sw * 1.15, sw + 1); // a touch wider to avoid seams

  // helper to arc path between degrees
  const toXY = (deg) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };

  if (remaining <= 0) return maskId;

  if (remaining === total) {
    // Reveal full circle
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", cx); c.setAttribute("cy", cy); c.setAttribute("r", r);
    c.setAttribute("fill", "none");
    c.setAttribute("stroke", "white");
    c.setAttribute("stroke-width", revealStroke);
    c.setAttribute("stroke-linecap", "round");
    mask.appendChild(c);

    // Optional: hide a tiny slice *after* 12 o’clock so the comet looks like it stops at noon
    if (hideSliceDeg > 0) {
      // Noon in our coord system is -90°
      const startDeg = -90;                       // 12 o'clock
      const endDeg   = startDeg + hideSliceDeg;   // small slice past noon (CW)
      const [x1, y1] = toXY(startDeg);
      const [x2, y2] = toXY(endDeg);
      const largeArc = hideSliceDeg > 180 ? 1 : 0;

      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", `M ${x1.toFixed(3)} ${y1.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(3)} ${y2.toFixed(3)}`);
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", "black");                   // black = hide
      p.setAttribute("stroke-width", revealStroke + 2);    // ensure we fully clip the head
      p.setAttribute("stroke-linecap", "butt");
      mask.appendChild(p);
    }

    return maskId;
  }

  // Partial arc (gap-aware): reveal only the remaining span
  const segSpan = 360 / total;
  const gapDeg  = Math.min(6, segSpan * 0.25);
  const startDeg = -90 + (gapDeg / 2);                         // top, after gap
  const endDeg   = mgEndAngleForIndex(remaining - 1, total);   // handle end
  const arcDelta = ((endDeg - startDeg) + 360) % 360;
  const largeArc = arcDelta > 180 ? 1 : 0;

  const [x1, y1] = toXY(startDeg);
  const [x2, y2] = toXY(endDeg);

  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", `M ${x1.toFixed(3)} ${y1.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(3)} ${y2.toFixed(3)}`);
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", "white");
  p.setAttribute("stroke-width", revealStroke);
  p.setAttribute("stroke-linecap", "round");
  mask.appendChild(p);

  return maskId;
}

/* Adding a glowing depending on how much of the clock is left
----------------------------------------------------------------------*/
function mgColorStage(total, filled) {
  const remaining = Math.max(0, total - Math.max(0, Math.min(total, filled)));
  const remainingRatio = remaining / Math.max(1, total);
  if (remainingRatio <= 0.25) return { stroke: "hsl(0,100%,60%)" };    // red
  if (remainingRatio <= 0.50) return { stroke: "hsl(45,100%,60%)" };   // yellow
  return { stroke: "hsl(200,90%,60%)" };                               // MG blue
}

function mgEnsureGlowDefs(svg) {
  const NS = "http://www.w3.org/2000/svg";
  let defs = svg.querySelector("defs.mg-glows");
  if (!defs) {
    defs = document.createElementNS(NS, "defs");
    defs.setAttribute("class", "mg-glows");
    svg.prepend(defs);
  }

  // Soft glow used by the head and segments
  if (!svg.querySelector("#mg-glow")) {
    const f = document.createElementNS(NS, "filter");
    f.setAttribute("id", "mg-glow");
    f.setAttribute("x", "-45%");
    f.setAttribute("y", "-45%");
    f.setAttribute("width", "190%");
    f.setAttribute("height", "190%");
    const blur = document.createElementNS(NS, "feGaussianBlur");
    blur.setAttribute("in", "SourceGraphic");
    blur.setAttribute("stdDeviation", "3.25");
    blur.setAttribute("result", "blur");
    const merge = document.createElementNS(NS, "feMerge");
    const m1 = document.createElementNS(NS, "feMergeNode"); m1.setAttribute("in", "blur");
    const m2 = document.createElementNS(NS, "feMergeNode"); m2.setAttribute("in", "SourceGraphic");
    merge.appendChild(m1); merge.appendChild(m2);
    f.appendChild(blur); f.appendChild(merge);
    defs.appendChild(f);
  }

  // Soft feather for the tail
  if (!svg.querySelector("#mg-tail-blur")) {
    const f = document.createElementNS(NS, "filter");
    f.setAttribute("id", "mg-tail-blur");
    f.setAttribute("x", "-40%");
    f.setAttribute("y", "-40%");
    f.setAttribute("width", "180%");
    f.setAttribute("height", "180%");
    const blur = document.createElementNS(NS, "feGaussianBlur");
    blur.setAttribute("in", "SourceGraphic");
    blur.setAttribute("stdDeviation", "2");
    blur.setAttribute("result", "b");
    const merge = document.createElementNS(NS, "feMerge");
    const m1 = document.createElementNS(NS, "feMergeNode"); m1.setAttribute("in", "b");
    const m2 = document.createElementNS(NS, "feMergeNode"); m2.setAttribute("in", "SourceGraphic");
    merge.appendChild(m1); merge.appendChild(m2);
    f.appendChild(blur); f.appendChild(merge);
    defs.appendChild(f);
  }
}

// Lighten an `hsl(...)` string so the head can look "white-hot"
function mgHotColor(hslStr) {
  const m = /hsl\((\d+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/i.exec(hslStr);
  if (!m) return hslStr;
  let h = +m[1], s = +m[2], l = +m[3];
  // push toward a bright, slightly desaturated core
  s = Math.max(55, Math.min(85, s - 10));
  l = Math.min(95, l + 18);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

// Post a chat line when the clock ticks down (remaining decreased)
async function mgAnnounceClockTickDown(name, remaining, total, gmOnly) {
  const title = name ? `<strong>${name}</strong>` : "The clock";
  const content = `
    <div class="mg-clock-chat">
      <div class="clock-label">
        <h2 class="title"><i class="fa-solid fa-clock"></i><span class="headline-wrap">${title}<span class="clock-text">ticks down…</span></span></h2>
      </div>
      <div class="mg-clock-count">
        <span class="clock-major">
          ${remaining}
        </span>
        <span class="clock-small">
          /${total} <span>turns left.</span>
        </span>
      </div>
    </div>
  `;
  const data = {
    user: game.user.id,
    speaker: ChatMessage.getSpeaker(),
    content
  };
  // If GM-only clock, whisper to GMs; otherwise, broadcast
  if (gmOnly) {
    data.whisper = game.users.filter(u => u.isGM).map(u => u.id);
  }
  try { await ChatMessage.create(data); } catch (_) {}
}


/* Single glow underlay for partial or full
----------------------------------------------------------------------*/
function mgUpdateGlowArc($wrap, id) {
  const scope = mgClockScopeFromWrap($wrap);
  const { total, filled } = mgClockGetById(id, scope);
  const remaining = Math.max(0, total - filled);

  const svg = $wrap.find(".mg-clock-svg")[0];
  if (!svg) return;
  mgEnsureGlowDefs(svg);

  // remove old comet bits (keep defs/masks)
  svg.querySelectorAll(
    ".glow-arc,.glow-full," +
    ".glow-comet,.glow-comet-tail," +
    ".glow-comet-full,.glow-comet-tail-full," +
    ".glow-comet-head-halo,.glow-comet-tail-bright"
  ).forEach(n => { try { n.remove(); } catch(_){} });

  const bg  = svg.querySelector(".bg-ring");
  const vb  = (svg.getAttribute("viewBox") || "0 0 120 120").split(/\s+/).map(Number);
  const cx  = vb[2] / 2, cy = vb[3] / 2;
  const r   = bg ? parseFloat(bg.getAttribute("r")) : 44;
  const sw  = parseFloat(svg.querySelector("path.seg")?.getAttribute("stroke-width") || bg?.getAttribute("stroke-width") || 8);

  if (remaining <= 0) { mgEnsureHandleOnTop($wrap); return; }

  const { stroke } = mgColorStage(total, filled);
  const headColor = mgHotColor(stroke); // brighter head
  const tailColor = stroke;             // base ring color

  // Mask so comet only shows over the remaining arc
  // (no extra noon slice needed since we hard-start at 12)
  const maskId = mgEnsureRemainingMask(svg, id, total, filled, cx, cy, r, sw, 0);

  // Build a full-circle PATH that STARTS AT 12 O'CLOCK and goes clockwise:
  // M (top) -> A to bottom (cw) -> A back to top (cw)
  const dFull = `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r}`;

  // HEAD (round cap, subtle blur) — on the path
  const head = document.createElementNS("http://www.w3.org/2000/svg", "path");
  head.setAttribute("class", "glow-comet");
  head.setAttribute("fill", "none");
  head.setAttribute("stroke-linecap", "round");
  head.setAttribute("pointer-events", "none");
  head.setAttribute("filter", "url(#mg-glow)");
  head.setAttribute("d", dFull);
  head.setAttribute("stroke", headColor); head.style.stroke = headColor;
  const swHead = sw * 1.05;
  head.setAttribute("stroke-width", swHead);
  head.setAttribute("mask", `url(#${maskId})`);
  svg.appendChild(head);

  // TAIL (butt cap so it fades smoothly) — on the same path
  const tail = document.createElementNS("http://www.w3.org/2000/svg", "path");
  tail.setAttribute("class", "glow-comet-tail");
  tail.setAttribute("fill", "none");
  tail.setAttribute("stroke-linecap", "butt");
  tail.setAttribute("pointer-events", "none");
  tail.setAttribute("filter", "url(#mg-tail-blur)");
  tail.setAttribute("d", dFull);
  tail.setAttribute("stroke", tailColor); tail.style.stroke = tailColor;
  const swTail = sw * 0.70;
  tail.setAttribute("stroke-width", swTail);
  tail.setAttribute("stroke-opacity", "0.38");
  tail.setAttribute("mask", `url(#${maskId})`);
  svg.appendChild(tail);

  // Path length (now exact for THIS path)
  const L    = head.getTotalLength();
  const dash = Math.max(6, L * 0.16);

  // Because the path starts at 12, "phase" 0 == noon. Easy.
  const phaseHead = 0; // pause exactly at 12
  const SIGN = (typeof MG_SWEEP_CLOCKWISE !== "undefined" && MG_SWEEP_CLOCKWISE) ? 1 : -1;
  const phaseTail = phaseHead + SIGN * (dash * 0.70); // tail trails behind

  // Animate (mgStartSweep compensates round caps for head)
  mgStartSweep(head, L, {
    dashPx:   dash,
    capPx:    swHead / 2,
    periodMs: MG_SWEEP_PERIOD_MS,
    pauseMs:  MG_SWEEP_PAUSE_MS,
    offsetPx: phaseHead,
    fadeStartRatio: MG_SWEEP_FADE_START_RATIO,
    fadeEndRatio:   MG_SWEEP_FADE_END_RATIO
  });

  mgStartSweep(tail, L, {
    dashPx:   dash,
    capPx:    0,                  // butt cap
    periodMs: MG_SWEEP_PERIOD_MS,
    pauseMs:  MG_SWEEP_PAUSE_MS,
    offsetPx: phaseTail,
    fadeStartRatio: MG_SWEEP_FADE_START_RATIO,
    fadeEndRatio:   MG_SWEEP_FADE_END_RATIO
  });

  mgEnsureHandleOnTop($wrap);
}

function mgApplySegColors($wrap, id) {
  const scope = mgClockScopeFromWrap($wrap);
  const { total, filled } = mgClockGetById(id, scope);
  const { stroke } = mgColorStage(total, filled);

  // Remaining = ON (colored)
  $wrap.find("path.seg.on").each((_i, p) => {
    p.setAttribute("stroke", stroke);
    p.style.stroke = stroke;             // override any CSS
    p.removeAttribute("opacity");
    p.removeAttribute("filter");
  });

  // Used = OFF (muted)
  $wrap.find("path.seg.off").each((_i, p) => {
    p.setAttribute("stroke", "hsl(0,0%,35%)");
    p.style.stroke = "hsl(0,0%,35%)";    // override any CSS
    p.setAttribute("opacity", "0.6");
    p.removeAttribute("filter");
  });
}

// Animate one dash fully across the path, then pause with the HEAD at the end.
function mgStartSweep(el, length, opts = {}) {
  if (!el) return;

  const period   = opts.periodMs ?? MG_SWEEP_PERIOD_MS ?? 1000;
  const pauseMs  = Math.max(0, opts.pauseMs ?? MG_SWEEP_PAUSE_MS ?? 0);
  const travelMs = Math.max(1, period - pauseMs);
  const fracMove = Math.max(0.001, Math.min(0.999, travelMs / period)); // move portion

  const dashPx = Math.max(6, Math.min(42, opts.dashPx ?? (length * 0.18)));
  const gapPx  = Math.max(1, length - dashPx);        // single dash
  const phase  = opts.offsetPx ?? 0;                  // where "12 o'clock" is on this path
  const cap    = Math.max(0, opts.capPx ?? 0);        // front-cap compensation for round caps

  // ---- Start/end offsets ----
  // CCW baseline (for reference):
  const ccwFrom = (-cap) + phase;                     // head-front at phase (start)
  const ccwTo   = (length - dashPx - cap) + phase;    // head-front one loop ahead

  const cwFrom = phase;                               // head-front at 12
  const cwTo   = phase - (length - dashPx);           // wrap around once

  const useCW = (typeof MG_SWEEP_CLOCKWISE !== "undefined" && MG_SWEEP_CLOCKWISE);
  const from  = useCW ? cwFrom : ccwFrom;
  const to    = useCW ? cwTo   : ccwTo;

  // ---- Fade window (ends BEFORE travel finishes) ----
  const rs = Math.max(0, Math.min(1, opts.fadeStartRatio ?? (typeof MG_SWEEP_FADE_START_RATIO !== "undefined" ? MG_SWEEP_FADE_START_RATIO : 0.70)));
  const reDefault = (typeof MG_SWEEP_FADE_END_RATIO !== "undefined") ? MG_SWEEP_FADE_END_RATIO : 0.92;
  let re  = Math.max(0, Math.min(1, opts.fadeEndRatio ?? reDefault));
  if (re <= rs + 0.02) re = Math.min(0.995, rs + 0.05); // ensure non-zero fade span

  const fadeStart = Math.min(fracMove - 0.02, fracMove * rs); // time to begin fading
  const fadeEnd   = Math.min(fracMove - 0.001, fracMove * re);// fully faded before end

  // Interpolate offsets at fadeStart/End
  const tS = fadeStart / fracMove;
  const tE = fadeEnd   / fracMove;
  const offS = from + (to - from) * tS;
  const offE = from + (to - from) * tE;

  el.style.strokeLinecap    = "round";
  el.style.strokeDasharray  = `${dashPx.toFixed(1)} ${gapPx.toFixed(1)}`;
  el.style.strokeDashoffset = String(from);

  try { el._mgAnim?.cancel(); } catch (_) {}
  el._mgAnim = el.animate(
    [
      { strokeDashoffset: from, opacity: 1 },                 // full bright at 12 o'clock
      { strokeDashoffset: offS, opacity: 1, offset: fadeStart }, // visible until ~9 o'clock
      { strokeDashoffset: offE, opacity: 0, offset: fadeEnd },   // faded out before 12
      { strokeDashoffset: to,   opacity: 0, offset: fracMove },  // remain hidden through end
      { strokeDashoffset: to,   opacity: 0 }                     // hidden during pause
    ],
    { duration: period, iterations: Infinity, easing: "linear" }
  );
}

// Play the same sting when the clock first enters the "red" (<=25% remaining) stage.
// - Only the GM triggers the sound to avoid duplicates.
// - Broadcast to everyone if the clock is Public; play local-only if GM-only.
function mgMaybePlayRedSfx($wrap, id, total, filled) {
  const root = $wrap[0];
  if (!root) return;

  const remaining = Math.max(0, total - Math.max(0, Math.min(total, filled)));
  const isRedNow  = (remaining / Math.max(1, total)) <= 0.25;

  const wasRed = root.dataset.mgRedStage === "1";
  root.dataset.mgRedStage = isRedNow ? "1" : "0";

  // Fire only on the transition into red
  if (!wasRed && isRedNow) {
    if (game.user.isGM) {
      const c = mgClockGetById(id, mgClockScopeFromWrap($wrap)) || {};
      const broadcast = !c.gmOnly; // Public → everyone hears; GM-only → just GM
      mgPlayClockSfx(0.8, { broadcast });
    }
  }
}

/* Segment Smoother
----------------------------------------------------------------------*/
function mgUpdateRings($wrap, id) {
  const scope = mgClockScopeFromWrap($wrap);
  const { total, filled } = mgClockGetById(id, scope);
  const remaining = Math.max(0, total - filled);

  const svg = $wrap.find(".mg-clock-svg")[0];
  if (!svg) return;

  const bg = svg.querySelector(".bg-ring");
  const segsG = svg.querySelector(".segs");

  // smooth band for full state
  let fullRing = svg.querySelector(".full-ring");
  if (!fullRing) {
    fullRing = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    fullRing.setAttribute("class", "full-ring");
    fullRing.setAttribute("fill", "none");
    fullRing.setAttribute("stroke-linecap", "round");
    fullRing.setAttribute("display", "none");
    fullRing.setAttribute("pointer-events", "none");
    svg.appendChild(fullRing);
  }

  const vb = (svg.getAttribute("viewBox") || "0 0 120 120").split(/\s+/).map(Number);
  const cx = vb[2] / 2, cy = vb[3] / 2;
  const r  = bg ? parseFloat(bg.getAttribute("r")) : 44;
  const sw = parseFloat(svg.querySelector("path.seg")?.getAttribute("stroke-width") || bg?.getAttribute("stroke-width") || 8);

  fullRing.setAttribute("cx", cx);
  fullRing.setAttribute("cy", cy);
  fullRing.setAttribute("r",  r);
  fullRing.setAttribute("stroke-width", sw);

  const { stroke } = mgColorStage(total, filled);
  fullRing.setAttribute("stroke", stroke);
  fullRing.style.stroke = stroke;

  if (remaining === total) {
    if (segsG) segsG.setAttribute("display", "none");
    if (bg)    bg.setAttribute("opacity", "0");
    fullRing.removeAttribute("display");
  } else {
    if (segsG) segsG.removeAttribute("display");
    if (bg)    bg.setAttribute("opacity", "1");
    fullRing.setAttribute("display", "none");
  }

  // always update glow (partial or full)
  mgMaybePlayRedSfx($wrap, id, total, filled);   // <-- add this line

  // always update glow (partial or full)
  mgUpdateGlowArc($wrap, id);

  // keep the Queen handle above the band/glow
  mgEnsureHandleOnTop($wrap);
}

/* Keep Handle on top
----------------------------------------------------------------------*/
function mgEnsureHandleOnTop($wrap) {
  const svg  = $wrap.find(".mg-clock-svg")[0];
  const posG = svg?.querySelector("g.mg-handle-pos");
  if (posG) svg.appendChild(posG); // re-append = bring to front in SVG z-order
}

/* Per-user UI prefs for each clock
----------------------------------------------------------------------*/
function mgUiLoad(id) {
  const all = game.user?.getFlag?.(MG_NS, UFLAG_UI) ?? {};
  return all?.[id] ?? null;
}

async function mgUiSave(id, patch) {
  const all = game.user?.getFlag?.(MG_NS, UFLAG_UI) ?? {};
  const next = { ...(all ?? {}), [id]: { ...(all?.[id] ?? {}), ...patch } };
  await game.user.setFlag(MG_NS, UFLAG_UI, next);
}

function mgClocksAreHiddenForUser() {
  return !!game.user?.getFlag?.(MG_NS, UFLAG_CLOCKS_HIDDEN);
}

function mgApplyUserClockVisibility() {
  const hidden = mgClocksAreHiddenForUser();
  const dock = document.getElementById("mg-clock-dock");
  if (!dock) return;
  dock.classList.toggle("is-hidden", hidden);
  dock.setAttribute("aria-hidden", hidden ? "true" : "false");
}

async function mgSetUserClocksHidden(hidden) {
  await game.user.setFlag(MG_NS, UFLAG_CLOCKS_HIDDEN, !!hidden);
  mgApplyUserClockVisibility();
  ui.notifications?.info(hidden ? "Clocks hidden." : "Clocks shown.");
}

async function mgToggleUserClocksHidden() {
  await mgSetUserClocksHidden(!mgClocksAreHiddenForUser());
}

function mgApplyDockPos() {
  const dock = document.getElementById("mg-clock-dock");
  if (!dock) return;

  const ui = mgUiLoad(CLOCK_DOCK_UI_ID) ?? {};
  const rect = dock.getBoundingClientRect?.() ?? { width: 0, height: 0 };
  const w = rect.width || dock.offsetWidth || 200;
  const h = rect.height || dock.offsetHeight || 70;
  const pad = 16;

  let left;
  let top;

  if (typeof ui.x === "number" && typeof ui.y === "number") {
    left = ui.x;
    top = ui.y;
  } else {
    const sidebar = document.getElementById("sidebar") || document.querySelector("#sidebar, .sidebar, #ui-right");
    const sideRect = sidebar?.getBoundingClientRect?.();
    left = sideRect ? Math.max(pad, sideRect.left - w - 12) : Math.max(pad, window.innerWidth - w - 360);
    top = pad;
  }

  left = Math.max(0, Math.min(window.innerWidth - w, left));
  top = Math.max(0, Math.min(window.innerHeight - h, top));

  dock.style.position = "fixed";
  dock.style.left = `${left}px`;
  dock.style.top = `${top}px`;
  dock.style.right = "";
}

function mgApplyDockCollapsed(dock = document.getElementById("mg-clock-dock")) {
  if (!dock) return;

  const ui = mgUiLoad(CLOCK_DOCK_UI_ID) ?? {};
  const collapsed = !!ui.collapsed;
  dock.classList.toggle("mg-collapsed", collapsed);

  const grip = dock.querySelector("[data-mg-clock-dock-grip]");
  if (grip) {
    grip.title = collapsed ? "Double click to show clocks" : "Drag clocks, double click to collapse";
  }
}

function mgBindClockDock(dock) {
  if (!dock || dock.dataset.mgClockDockBound === "1") return;
  dock.dataset.mgClockDockBound = "1";

  let moving = false;
  let off = { dx: 0, dy: 0 };

  dock.addEventListener("pointerdown", event => {
    const grip = event.target?.closest?.("[data-mg-clock-dock-grip]");
    if (!grip) return;
    event.preventDefault();
    const r = dock.getBoundingClientRect();
    moving = true;
    off = { dx: event.clientX - r.left, dy: event.clientY - r.top };
    dock.classList.add("mg-dragging");
    try { grip.setPointerCapture?.(event.pointerId); } catch (_) {}
  });

  dock.addEventListener("pointermove", event => {
    if (!moving) return;
    const w = dock.offsetWidth;
    const h = dock.offsetHeight;
    let nx = event.clientX - off.dx;
    let ny = event.clientY - off.dy;
    nx = Math.max(0, Math.min(window.innerWidth - w, nx));
    ny = Math.max(0, Math.min(window.innerHeight - h, ny));
    dock.style.left = `${nx}px`;
    dock.style.top = `${ny}px`;
    dock.style.right = "";
  });

  dock.addEventListener("pointerup", async event => {
    if (!moving) return;
    moving = false;
    dock.classList.remove("mg-dragging");
    try { event.target?.releasePointerCapture?.(event.pointerId); } catch (_) {}
    const r = dock.getBoundingClientRect();
    await mgUiSave(CLOCK_DOCK_UI_ID, { x: Math.round(r.left), y: Math.round(r.top) });
  });

  dock.addEventListener("dblclick", async event => {
    const grip = event.target?.closest?.("[data-mg-clock-dock-grip]");
    if (!grip) return;

    event.preventDefault();
    event.stopPropagation();

    const ui = mgUiLoad(CLOCK_DOCK_UI_ID) ?? {};
    await mgUiSave(CLOCK_DOCK_UI_ID, { collapsed: !ui.collapsed });
    mgApplyDockCollapsed(dock);
  });

  dock.addEventListener("pointercancel", () => {
    moving = false;
    dock.classList.remove("mg-dragging");
  });
}

// Apply saved/default position to a clock wrapper
function mgApplyPos($wrap) {
  const id = $wrap.data("clockId");
  const scope = mgClockScopeFromWrap($wrap);
  const ui = mgUiLoad(`${scope}:${id}`) ?? {};
  const el = $wrap[0];

  // Measure (fallback if not yet laid out)
  const rect = el.getBoundingClientRect?.() ?? { width: 0, height: 0 };
  const w = rect.width  || el.offsetWidth  || 200;
  const h = rect.height || el.offsetHeight || 140;

  let left, top;

  if (typeof ui.x === "number" && typeof ui.y === "number") {
    // Use saved spot
    left = ui.x;
    top  = ui.y;
  } else {
    // First time for this user → CENTER on screen (both axes), with a small stagger
    const pad = 16;
    const sidebar = document.getElementById("sidebar") || document.querySelector("#sidebar, .sidebar, #ui-right");
    const sideRect = sidebar?.getBoundingClientRect?.();
    const cx  = sideRect ? Math.max(pad, sideRect.left - w - 12) : Math.max(pad, window.innerWidth - w - 360);
    const cy  = pad;

    const others = Array.from(document.querySelectorAll(".mg-clock-canvas")).filter(e => e !== el);
    const n = others.length;                 // how many already present in DOM
    const offset = Math.min(n * 44, Math.max(0, window.innerHeight - h - pad));

    left = Math.min(window.innerWidth  - w - pad, cx);
    top  = Math.min(window.innerHeight - h - pad, cy + offset);
  }

  // Clamp into viewport
  left = Math.max(0, Math.min(window.innerWidth  - w, left));
  top  = Math.max(0, Math.min(window.innerHeight - h, top));

  // Apply
  el.style.position = "fixed";
  el.style.left = `${left}px`;
  el.style.top  = `${top}px`;
  el.style.right = "";
}

/* Collapse support like Foundry Default
----------------------------------------------------------------------*/
function mgApplyCollapsed($wrap) {
  const id = $wrap.data("clockId");
  const scope = mgClockScopeFromWrap($wrap);
  const ui = mgUiLoad(`${scope}:${id}`) ?? {};
  const collapsed = !!ui.collapsed;
  $wrap.toggleClass("mg-collapsed", collapsed);

  const { total, filled } = mgClockGetById(id, scope);
  $wrap.attr("title", collapsed ? `${filled}/${total} — double-click to restore` : "");
}

/* Lift any existing single Clock scene into the new multi clock map
----------------------------------------------------------------------*/
async function mgMigrateSingleClockToList() {
  const sc = canvas.scene; if (!sc) return;

  // If the new list exists with entries, nothing to do
  const hasList = sc.getFlag(MG_NS, FLAG_CLOCKS);
  if (hasList && Object.keys(hasList).length) return;

  // Read old single-clock flags (if any)
  const total  = sc.getFlag(MG_NS, "clock.total");
  const filled = sc.getFlag(MG_NS, "clock.filled");
  const name   = sc.getFlag(MG_NS, "clock.name");

  // If nothing to migrate, stop — don't auto-create
  if (total == null && filled == null && !name) return;

  // Create one migrated clock
  await mgClockCreate({
    name: name ?? "Clock",
    total: Number.isFinite(+total)  ? +total  : 8,
    filled: Number.isFinite(+filled) ? +filled : 0
  });

  // Clean up old flags (optional)
  await sc.unsetFlag(MG_NS, "clock.total").catch(()=>{});
  await sc.unsetFlag(MG_NS, "clock.filled").catch(()=>{});
  await sc.unsetFlag(MG_NS, "clock.name").catch(()=>{});
}

/* Setting the Clock Dom
----------------------------------------------------------------------*/
// Ensure DOM for ONE clock instance
function mgEnsureClockDOM(id, scope = CLOCK_SCOPE_SCENE, mode = "canvas") {
  scope = mgNormalizeClockScope(scope);
  const domId = mgClockDomId(scope, id, mode);
  let $wrap = $(`#${domId}`);
  if ($wrap.length) return $wrap;

  const modeClass = mode === "sidebar" ? "mg-clock-sidebar-card" : "mg-clock-canvas";

  $wrap = $(`
    <div id="${domId}" class="mg-clock ${modeClass}" data-clock-id="${id}" data-clock-scope="${scope}">
      <div class="mg-clock-inner">
        <div class="mg-clock-grip" title="Drag to move, Double click to collapse/expand"></div>

        <div class="mg-clock-face">
        <div class="mg-clock-visual">
          <svg class="mg-clock-svg" viewBox="0 0 120 120" width="120" height="120" aria-hidden="true" style="width:120px;height:120px;">
            <g class="segs"></g>
          </svg>
          <div class="mg-clock-center">
            <span class="mg-clock-count"></span>
          </div>
        </div>
        </div>
        <div class="mg-clock-content">
        <input type="text" class="mg-clock-name" maxlength="60"
               placeholder="Clock" title="Clock name (GM only)" />

        <span class="mg-clock-badge"></span>

        <div class="mg-clock-controls">
          <div class="main-controls">
            <button type="button" class="mg-clock-dec"  title="Decrease (Shift: -2)"><i class="fa-solid fa-minus"></i></button>
            <input  type="number" class="mg-clock-total" min="1" max="200" step="1" title="Segments" inputmode="numeric" />
            <button type="button" class="mg-clock-inc"  title="Increase (Shift: +2)"><i class="fa-solid fa-plus"></i></button>
          </div>
          <div class="add-remove">
            <button type="button" class="mg-clock-vis" title="Public — click to hide from Players" data-tooltip="Toggle Visibility">
              <i class="fa-solid fa-eye"></i>
            </button>
            <button type="button" class="mg-clock-scope" title="Move Clock" data-tooltip="Move Clock"><i class="fa-solid fa-globe"></i></button>
            <button type="button" class="mg-clock-close" title="Remove Clock" data-tooltip="Remove Clock"><i class="fa-solid fa-trash"></i></button>
          </div>

        </div>
        </div>
      </div>
    </div>
  `);

  if (mode === "canvas") mgGetClockDockList().appendChild($wrap[0]);
  else document.body.appendChild($wrap[0]);
  if (mode === "canvas") {
    mgApplyDockPos();
  }

  // keep in-bounds on resize
  window.addEventListener("resize", () => {
    if (mode === "canvas") mgApplyDockPos();
  }, { passive: true });

  const center = $wrap.find(".mg-clock-center")[0];
  if (center) {
    center.style.background = "transparent";
    center.style.boxShadow = "none";
    center.style.border = "0";
    center.style.pointerEvents = "none";
  }
  const count = $wrap.find(".mg-clock-count")[0];
  if (count) {
    count.style.background = "transparent";
    count.style.boxShadow = "none";
    count.style.border = "0";
  }
  const badge = $wrap.find(".mg-clock-badge")[0];
  if (badge) {
    badge.style.background = "transparent";
    badge.style.boxShadow = "none";
    badge.style.border = "0";
  }
  const vis = $wrap.find(".mg-clock-visual")[0];
  if (vis) {
    vis.style.overflow = "visible";   // let glow show fully
    vis.style.background = "transparent";
  }
  return $wrap;
}

/* Clock Segment Creation
----------------------------------------------------------------------*/
// per-clock handle scale
const mgHandleScaleMap = {};

function mgEndAngleForIndex(i, total) {
  const segSpan = 360 / total;
  const gapDeg  = Math.min(6, segSpan * 0.25);
  const arcSpan = Math.max(0, segSpan - gapDeg);
  const start = -90 + i * segSpan + (gapDeg / 2);
  return start + arcSpan;
}

/* Handle of Queen for DM scrub
----------------------------------------------------------------------*/
function mgPlaceHandle($wrap, id, angleDeg) {
  const svg = $wrap.find(".mg-clock-svg")[0];
  const NS  = "http://www.w3.org/2000/svg";
  const cx = 60, cy = 60, r = 44;

  // Compute the end point on the ring
  const rad = angleDeg * Math.PI / 180;
  const x = cx + r * Math.cos(rad);
  const y = cy + r * Math.sin(rad);

  // Nested groups:
  // <g class="mg-handle-pos" transform="translate(x,y)">
  //   <g class="mg-handle-scale" style="transform: scale(s)">
  //     <image x="-size/2" y="-size/2" width=size height=size />
  //   </g>
  // </g>
  let posG   = svg.querySelector("g.mg-handle-pos");
  let scaleG = svg.querySelector("g.mg-handle-scale");

  if (!posG) {
    posG = document.createElementNS(NS, "g");
    posG.setAttribute("class", "mg-handle-pos");

    scaleG = document.createElementNS(NS, "g");
    scaleG.setAttribute("class", "mg-handle-scale");

    const img = document.createElementNS(NS, "image");
    img.setAttribute("class", "mg-handle-img");
    const url = mgGetHandleUrl();
    img.setAttribute("href", url);
    img.setAttributeNS("http://www.w3.org/1999/xlink", "href", url);
    img.setAttribute("width", String(MG_HANDLE_SIZE));
    img.setAttribute("height", String(MG_HANDLE_SIZE));
    img.setAttribute("preserveAspectRatio", "xMidYMid meet");

    // Anchor the image so its CENTER is at the group's (0,0)
    img.setAttribute("x", String(-MG_HANDLE_SIZE / 2));
    img.setAttribute("y", String(-MG_HANDLE_SIZE / 2));

    scaleG.appendChild(img);
    posG.appendChild(scaleG);
    svg.appendChild(posG);
  } else {
    scaleG = posG.querySelector("g.mg-handle-scale");
  }

  // Position: translate to the exact (x,y) — no scale compensation here
  posG.setAttribute("transform", `translate(${x},${y})`);

  // Scale: via CSS transform on the inner group → smooth transition
  const s = mgHandleScaleMap[id] ?? 1;
  scaleG.style.transform = `scale(${s})`;

  mgEnsureHandleOnTop($wrap);
}


function mgUpdateHandleToFilled($wrap, id) {
  const scope = mgClockScopeFromWrap($wrap);
  const { total, filled } = mgClockGetById(id, scope);
  const remaining = mgRemaining(total, filled);
  const idx = Math.max(0, Math.min(total - 1, remaining - 1));
  const angle = (remaining > 0) ? mgEndAngleForIndex(idx, total) : -90;
  mgPlaceHandle($wrap, id, angle);
}

function mgIdxFromEvent($wrap, ev, id) {
  const svg = $wrap.find(".mg-clock-svg")[0];
  const rect = svg.getBoundingClientRect();
  const x = ev.clientX - (rect.left + rect.width  / 2);
  const y = ev.clientY - (rect.top  + rect.height / 2);
  let deg = (Math.atan2(y, x) * 180 / Math.PI + 450) % 360; // 0 at top, CW
  const { total } = mgClockGetById(id, mgClockScopeFromWrap($wrap));
  return Math.max(0, Math.min(total - 1, Math.floor(deg / (360 / total))));
}

function mgDrawClock($wrap, id) {
  const scope = mgClockScopeFromWrap($wrap);
  const { total, filled } = mgClockGetById(id, scope);
  const svg = $wrap.find(".mg-clock-svg")[0];
  const segsG = $wrap.find(".segs")[0];

  // clear segs group
  while (segsG?.firstChild) segsG.removeChild(segsG.firstChild);

  // ensure glow defs
  mgEnsureGlowDefs(svg);

  const NS = "http://www.w3.org/2000/svg";
  const cx = 60, cy = 60, r = 44;
  const stroke = (total <= 32) ? 12 : (total <= 64) ? 10 : (total <= 96) ? 8 : 6;

  const segSpan = 360 / total;
  const gapDeg  = Math.min(6, segSpan * 0.25);
  const arcSpan = Math.max(0, segSpan - gapDeg);

  // background ring: reuse if present, else create
  let bg = svg.querySelector(".bg-ring");
  if (!bg) {
    bg = document.createElementNS(NS, "circle");
    bg.setAttribute("class", "bg-ring");
    svg.insertBefore(bg, segsG);
  }
  bg.setAttribute("cx", cx);
  bg.setAttribute("cy", cy);
  bg.setAttribute("r",  r);
  bg.setAttribute("fill", "none");
  bg.setAttribute("stroke", "rgba(255,255,255,0.15)");
  bg.setAttribute("stroke-width", stroke);

  const toXY = (deg) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };

  // build segments (neutral; we'll flip to "remaining" after)
  for (let i = 0; i < total; i++) {
    const start = -90 + i * segSpan + (gapDeg / 2);
    const end   = start + arcSpan;
    const [x1, y1] = toXY(start);
    const [x2, y2] = toXY(end);
    const largeArc = arcSpan > 180 ? 1 : 0;

    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", `M ${x1.toFixed(3)} ${y1.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(3)} ${y2.toFixed(3)}`);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke-width", stroke);
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("class", "seg off");
    p.setAttribute("stroke", "hsl(0,0%,35%)");
    p.setAttribute("opacity", "0.6");
    segsG.appendChild(p);
  }

  // IMPORTANT: render as remaining/total (marks 'on' segs, count, handle)
  mgLocalSetFilled($wrap, id, filled);
}

/* Scrub Helper
----------------------------------------------------------------------*/
function mgUpdateHandleScale($wrap, id) {
  const svg    = $wrap.find(".mg-clock-svg")[0];
  const scaleG = svg?.querySelector("g.mg-handle-scale");
  const s = mgHandleScaleMap[id] ?? 1;
  if (scaleG) scaleG.style.transform = `scale(${s})`;
}

/* Click rules for the input and toggles, also adding a scrub element at the end of the stroke
----------------------------------------------------------------------*/
function mgBindClock($wrap, id) {
  $wrap.off(".mgclock");
  const scope = mgClockScopeFromWrap($wrap);
  const isSidebarClock = $wrap.hasClass("mg-clock-sidebar-card");
  const isCanvasClock = $wrap.hasClass("mg-clock-canvas");

  // Name (GM only)
  $wrap.on("keydown.mgclock", ".mg-clock-name", (ev) => {
    if (!game.user.isGM) return;
    if (ev.key === "Enter") { ev.preventDefault(); ev.currentTarget.blur(); }
  });
  $wrap.on("change.mgclock blur.mgclock", ".mg-clock-name", async (ev) => {
    if (!game.user.isGM) return;
    const name = String(ev.currentTarget.value ?? "").trim().slice(0, 60);
    await mgClockSetById(id, { name }, scope);
  });

  // Visibility toggle (GM only)
  $wrap.on("click.mgclock", ".mg-clock-vis", async () => {
    if (!game.user.isGM) return;

    const { gmOnly } = mgClockGetById(id, scope);
    const becomingPublic = gmOnly === true;

    await mgClockSetById(id, { gmOnly: !gmOnly }, scope);

    // If we just flipped from Hidden → Public, play the sting for everyone
    if (becomingPublic) {
      mgPlayClockSfx(0.6, { broadcast: true });
    }
  });

  // Controls (GM only)
  $wrap.on("click.mgclock", ".mg-clock-inc", async (ev) => {
    if (!game.user.isGM) return;
    const step = ev.shiftKey ? 2 : 1;
    const { filled } = mgClockGetById(id, scope);
    await mgClockSetById(id, { filled: Math.max(0, filled - step) }, scope);
  });
  $wrap.on("click.mgclock", ".mg-clock-dec", async (ev) => {
    if (!game.user.isGM) return;
    const step = ev.shiftKey ? 2 : 1;
    const { filled, total, name, gmOnly } = mgClockGetById(id, scope);
    const nf = Math.min(total, filled + step);   // spending = increase 'filled'
    if (nf === filled) return;
    await mgClockSetById(id, { filled: nf }, scope);
    const remaining = Math.max(0, total - nf);
    mgAnnounceClockTickDown(name, remaining, total, gmOnly);
  });

  // N/N overwrite (GM only)
  async function applyFromInput(input) {
    if (!game.user.isGM) return;
    const raw = Number(input.value);
    if (!Number.isFinite(raw)) return;
    await mgClockResetToById(id, raw, scope);
    const { total } = mgClockGetById(id, scope);
    input.value = String(total);
  }
  $wrap.on("change.mgclock",  ".mg-clock-total", (ev) => applyFromInput(ev.currentTarget));
  $wrap.on("keydown.mgclock", ".mg-clock-total", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); applyFromInput(ev.currentTarget); ev.currentTarget.blur(); }
  });
  $wrap.on("wheel.mgclock", ".mg-clock-total", (ev) => { ev.currentTarget.blur(); });

  // === Scrub (GM only) — capture pointer, update locally, save on release ===
  let scrubbing = false, lastIdx = null, lastFilled = 0, startFilled = 0;

  $wrap.on("pointerdown.mgclock", ".mg-clock-visual, .mg-clock-visual *", (ev) => {
    if (!game.user.isGM) return;
    ev.preventDefault();
    scrubbing = true; lastIdx = null;
    startFilled = mgClockGetById(id, scope).filled;  // remember where we started

    // scale knob a bit
    mgHandleScaleMap[id] = 1.18; mgUpdateHandleToFilled($wrap, id);
    mgUpdateHandleScale($wrap, id);

    // IMPORTANT: capture the pointer so we keep move/up events
    try { (ev.target instanceof Element) && ev.target.setPointerCapture?.(ev.pointerId); } catch (_) {}

    const idx = mgIdxFromEvent($wrap, ev, id);
    lastIdx = idx;
    const { total } = mgClockGetById(id, scope);
    lastFilled = Math.max(0, total - (idx + 1));
    mgLocalSetFilled($wrap, id, lastFilled); // instant local feedback
  });

  $wrap.on("pointermove.mgclock", ".mg-clock-visual, .mg-clock-visual *", (ev) => {
    if (!scrubbing || !game.user.isGM) return;
    const idx = mgIdxFromEvent($wrap, ev, id);
    if (idx !== lastIdx) {
      lastIdx = idx;
      const { total } = mgClockGetById(id, scope);
      lastFilled = Math.max(0, total - (idx + 1));
      mgLocalSetFilled($wrap, id, lastFilled); // keep it buttery
    }
  });

  $wrap.on("pointerup.mgclock pointercancel.mgclock", ".mg-clock-visual, .mg-clock-visual *", async (ev) => {
    if (!scrubbing) return;
    scrubbing = false;

    try { (ev.target instanceof Element) && ev.target.releasePointerCapture?.(ev.pointerId); } catch (_) {}

    mgHandleScaleMap[id] = 1.0; mgUpdateHandleToFilled($wrap, id);
    mgUpdateHandleScale($wrap, id);

    // One network write at the end → everyone else updates
    await mgClockSetById(id, { filled: lastFilled }, scope);
    try {
      if (lastFilled > startFilled) {
        const { total, name, gmOnly } = mgClockGetById(id, scope); // total/name/vis are stable
        const remaining = Math.max(0, total - lastFilled);
        mgAnnounceClockTickDown(name, remaining, total, gmOnly);
      }
    } catch (_) {}
  });

  // Subtle hover scale (unchanged)
  $wrap.on("pointerover.mgclock", ".mg-clock-visual, .mg-clock-visual *", () => {
    if (!game.user.isGM || scrubbing) return;
    mgHandleScaleMap[id] = 1.08; mgUpdateHandleToFilled($wrap, id);
    if (!scrubbing) { mgHandleScaleMap[id] = 1.08; mgUpdateHandleScale($wrap, id); }
  });
  $wrap.on("pointerout.mgclock", ".mg-clock-visual, .mg-clock-visual *", () => {
    if (!game.user.isGM || scrubbing) return;
    mgHandleScaleMap[id] = 1.0; mgUpdateHandleToFilled($wrap, id);
    if (!scrubbing) { mgHandleScaleMap[id] = 1.0; mgUpdateHandleScale($wrap, id); }
  });

  /* Editable UI element for the Clock
  ----------------------------------------------------------------------*/
  // === Drag the widget by the grip (per-user, with pointer capture) ===
  let moving = false, off = {dx:0, dy:0};

$wrap.on("pointerdown.mgclock", ".mg-clock-grip", (ev) => {
  if (isSidebarClock || isCanvasClock) return;
  ev.preventDefault();
  const r = $wrap[0].getBoundingClientRect();
  moving = true;
  off = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
  $wrap.addClass("mg-dragging");

  // Capture the pointer so we ALWAYS get move/up even if you leave the grip
  try { ev.currentTarget.setPointerCapture?.(ev.pointerId); } catch (_) {}
});

$wrap.on("pointermove.mgclock", ".mg-clock-grip", (ev) => {
  if (!moving) return;
  const el = $wrap[0];
  const w = el.offsetWidth, h = el.offsetHeight;
  let nx = ev.clientX - off.dx;
  let ny = ev.clientY - off.dy;
  nx = Math.max(0, Math.min(window.innerWidth  - w, nx));
  ny = Math.max(0, Math.min(window.innerHeight - h, ny));
  el.style.left = `${nx}px`;
  el.style.top  = `${ny}px`;
  el.style.right = "";
});

$wrap.on("pointerup.mgclock pointercancel.mgclock", ".mg-clock-grip", async (ev) => {
  if (!moving) return;
  moving = false;
  $wrap.removeClass("mg-dragging");

  // Release pointer capture
  try { ev.currentTarget.releasePointerCapture?.(ev.pointerId); } catch (_) {}

  // Persist position for this user
  const r = $wrap[0].getBoundingClientRect();
  await mgUiSave(`${scope}:${id}`, { x: Math.round(r.left), y: Math.round(r.top) });
});

  // Double-click collapse/expand (per-user)
  // Swallow accidental double-clicks on UI so they don't collapse
  $wrap.on("dblclick.mgclock", ".mg-clock-controls, .mg-clock-visual, .mg-clock-name", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
  });

  // Collapse/expand ONLY via the grip (per-user)
$wrap.on("dblclick.mgclock", ".mg-clock-grip", async (ev) => {
    if (isSidebarClock || isCanvasClock) return;
    ev.preventDefault();
    ev.stopPropagation();

    const ui   = mgUiLoad(`${scope}:${id}`) ?? {};
    const next = !ui.collapsed;

    $wrap.toggleClass("mg-collapsed", next);
    await mgUiSave(`${scope}:${id}`, { collapsed: next });
    mgApplyCollapsed($wrap);
  });

  $wrap.on("click.mgclock", ".mg-clock-close", async () => {
    if (!game.user.isGM) return;
    const ok = await Dialog.confirm({ title: "Remove Clock?", content: "<p>This will remove this clock.</p>" });
    if (!ok) return;
    await mgClockDeleteById(id, scope);
    $wrap.remove();
  });

  $wrap.on("click.mgclock", ".mg-clock-scope", async () => {
    if (!game.user.isGM) return;
    const nextScope = scope === CLOCK_SCOPE_GLOBAL ? CLOCK_SCOPE_SCENE : CLOCK_SCOPE_GLOBAL;
    await mgClockMoveScope(id, scope, nextScope);
  });
}

/* Force players to render newly made clock
----------------------------------------------------------------------*/
function mgRenderOneClock(id, scope = CLOCK_SCOPE_SCENE) {
  scope = mgNormalizeClockScope(scope);
  // Respect visibility for players
  const c = mgClockGetById(id, scope);
  if (!c) return;

  if (!game.user.isGM && c.gmOnly) {
    $(mgClockSelector(scope, id)).remove();
    return;
  }

  const $wrap = mgEnsureClockDOM(id, scope, "canvas");
  mgGetClockDockList().appendChild($wrap[0]);
  mgApplyDockPos();
  mgApplyUserClockVisibility();

  // Set name + control perms like in mgRenderAllClocks
  const nameInput = $wrap.find(".mg-clock-name")[0];
  if (nameInput) {
    nameInput.value = c.name || "";
    nameInput.placeholder = c.name || "Clock";
    if (game.user.isGM) { nameInput.readOnly = false; nameInput.classList.remove("readonly"); }
    else { nameInput.readOnly = true; nameInput.classList.add("readonly"); }
  }

  const totalInput = $wrap.find(".mg-clock-total")[0];
  if (totalInput) totalInput.value = String(c.total);

  const $controls = $wrap.find(".mg-clock-controls");
  if (game.user.isGM) {
    $wrap.removeClass("readonly");
    $controls.toggle(true).attr("aria-hidden","false");
  } else {
    $wrap.addClass("readonly");
    $controls.toggle(false).attr("aria-hidden","true");
  }

  // Update visibility toggle (if you added the eye button)
  const visBtn = $wrap.find(".mg-clock-vis")[0];
  if (visBtn) {
    const i = visBtn.querySelector("i");
    visBtn.title = c.gmOnly ? "Hidden (GM Only) — click to make Public" : "Public — click to hide from Players";
    if (i) i.className = c.gmOnly ? "fa-solid fa-eye-slash" : "fa-solid fa-eye";
    visBtn.setAttribute("aria-pressed", c.gmOnly ? "true" : "false");
  }

  const scopeBtn = $wrap.find(".mg-clock-scope")[0];
  if (scopeBtn) {
    const toScene = scope === CLOCK_SCOPE_GLOBAL;
    scopeBtn.title = toScene ? "Tie to Scene" : "Make Global";
    scopeBtn.setAttribute("data-tooltip", toScene ? "Tie to Scene" : "Make Global");
    const i = scopeBtn.querySelector("i");
    if (i) i.className = toScene ? "fa-solid fa-link" : "fa-solid fa-globe";
  }

  mgDrawClock($wrap, id);
  mgBindClock($wrap, id);
}

/* Force Foundry to remove a clock from players UI if DM deletes
----------------------------------------------------------------------*/
function mgPruneClockDOM() {
  const allowed = new Set(mgClocksGetVisibleRefs().map(ref => `${ref.scope}:${ref.id}`));
  document.querySelectorAll(".mg-clock-canvas").forEach(el => {
    const cid = el.getAttribute("data-clock-id");
    const scope = mgNormalizeClockScope(el.getAttribute("data-clock-scope"));
    if (cid && !allowed.has(`${scope}:${cid}`)) el.remove();
  });
  const dock = document.getElementById("mg-clock-dock");
  if (dock && !dock.querySelector(".mg-clock-canvas")) dock.remove();
}

// Only GMs may create NPC actors.
// Put this OUTSIDE every function, near your other createActor/preCreateActor hooks.
Hooks.on("preCreateActor", (actor, data, options, userId) => {
  const user = game.users.get(userId);
  const type = data?.type ?? actor?.type;

  if (type !== "npc") return;

  if (!user?.isGM) {
    if (game.user.id === userId) {
      ui.notifications?.warn("Only the GM can create NPCs.");
    }
    return false;
  }
});

// Hide NPC actor type from non-GM Create Actor dialogs.
Hooks.on("renderDialog", (_dialog, html) => {
  if (game.user.isGM) return;

  const root = html instanceof jQuery ? html[0] : html;
  if (!root) return;

  root.querySelectorAll('select[name="type"] option[value="npc"]').forEach(option => {
    const select = option.closest("select");
    option.remove();

    if (select?.value === "npc") {
      select.value = "character";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
});

/* Attaching clock to the scene and saving position
----------------------------------------------------------------------*/
async function mgRenderAllClocks() {
  const refs = mgClocksGetVisibleRefs();

  // Remove any clocks this user shouldn’t see
  const allowed = new Set(refs.map(ref => `${ref.scope}:${ref.id}`));
  document.querySelectorAll(".mg-clock-canvas").forEach(el => {
    const cid = el.getAttribute("data-clock-id");
    const scope = mgNormalizeClockScope(el.getAttribute("data-clock-scope"));
    if (cid && !allowed.has(`${scope}:${cid}`)) el.remove();
  });

  for (const { id, scope } of refs) mgRenderOneClock(id, scope);

  for (const { id, scope } of refs) {
    const $wrap = mgEnsureClockDOM(id, scope, "canvas");
    mgGetClockDockList().appendChild($wrap[0]);
    mgApplyDockPos();

    const { name, gmOnly } = mgClockGetById(id, scope);

    // Name field perms
    const nameInput = $wrap.find(".mg-clock-name")[0];
    if (nameInput) {
      nameInput.value = name || "";
      nameInput.placeholder = name || "Clock";
      if (game.user.isGM) { nameInput.readOnly = false; nameInput.classList.remove("readonly"); }
      else { nameInput.readOnly = true; nameInput.classList.add("readonly"); }
    }

    const totalInput = $wrap.find(".mg-clock-total")[0];
    if (totalInput) totalInput.value = String(mgClockGetById(id, scope).total);

    // Controls perms
    const $controls = $wrap.find(".mg-clock-controls");
    if (game.user.isGM) {
      $wrap.removeClass("readonly");
      $controls.toggle(true).attr("aria-hidden","false");
    } else {
      $wrap.addClass("readonly");
      $controls.toggle(false).attr("aria-hidden","true");
    }

    // Update visibility toggle icon state (if present)
    const btn = $wrap.find(".mg-clock-vis")[0];
    if (btn) {
      const i = btn.querySelector("i");
      btn.title = gmOnly ? "Hidden (GM Only) — click to make Public" : "Public — click to hide from Players";
      if (i) i.className = gmOnly ? "fa-solid fa-eye-slash" : "fa-solid fa-eye";
      btn.setAttribute("aria-pressed", gmOnly ? "true" : "false");
    }

    const scopeBtn = $wrap.find(".mg-clock-scope")[0];
    if (scopeBtn) {
      const toScene = scope === CLOCK_SCOPE_GLOBAL;
      scopeBtn.title = toScene ? "Tie to Scene" : "Make Global";
      scopeBtn.setAttribute("data-tooltip", toScene ? "Tie to Scene" : "Make Global");
      const i = scopeBtn.querySelector("i");
      if (i) i.className = toScene ? "fa-solid fa-link" : "fa-solid fa-globe";
    }

    mgDrawClock($wrap, id);
    mgBindClock($wrap, id);
  }

  mgApplyUserClockVisibility();
  const dock = document.getElementById("mg-clock-dock");
  if (dock) dock.classList.toggle("is-empty", !refs.length);
  if (!refs.length) dock?.remove();
}

/* Hooking clocks into scene
----------------------------------------------------------------------*/
// Hooks: mount & live updates
function mgClearAllClockDOM() {
  document.querySelectorAll(".mg-clock-canvas").forEach(el => el.remove());
  const dock = document.getElementById("mg-clock-dock");
  if (dock) dock.remove();
}

Hooks.on("canvasReady", async () => {
  mgClearAllClockDOM();            // remove prior scene’s widgets
  await mgMigrateSingleClockToList();
  await mgRenderAllClocks();       // render only what this scene has
});

Hooks.on("updateScene", (scene, data) => {
  if (scene.id !== canvas.scene?.id) return;

  const flagsNS = data.flags?.[MG_NS];
  if (!flagsNS) return;

  // === 1) Adds/changes under flags.<ns>.clocks (normal updates)
  const deltaClocks = flagsNS[FLAG_CLOCKS];
  if (deltaClocks && typeof deltaClocks === "object") {
    for (const k of Object.keys(deltaClocks)) {
      const patch = deltaClocks[k];

      // a) Nested deletion: flags.<ns>.clocks["-=" + id] = null
      if (k.startsWith("-=")) {
        const id = k.slice(2);   // strip "-="
        $(mgClockSelector(CLOCK_SCOPE_SCENE, id)).remove();
        continue;
      }

      // b) Explicit null inside map: flags.<ns>.clocks[id] = null
      if (patch === null || patch === undefined) {
        $(mgClockSelector(CLOCK_SCOPE_SCENE, k)).remove();
        continue;
      }

      // c) New or updated → render/bind for THIS user
      mgRenderOneClock(k, CLOCK_SCOPE_SCENE);
    }
  }

  // === 2) Top-level deletion: flags.<ns>["-=clocks.<id>"] = null
  for (const k of Object.keys(flagsNS)) {
    if (k.startsWith(`-=${FLAG_CLOCKS}.`)) {
      const id = k.slice((`-=${FLAG_CLOCKS}.`).length);
      $(mgClockSelector(CLOCK_SCOPE_SCENE, id)).remove();
    }
  }

  // === 3) Final safety sweep: remove anything this user shouldn't see
  mgPruneClockDOM();
  globalThis.mgRefreshClocksSidebarContent?.();
});

/* On Clock creation, adding an option for Hidden/Public
----------------------------------------------------------------------*/
async function mgOpenCreateClockDialog() {
  if (!game.user.isGM) return null;

  const content = `
  <form class="mg-create-clock">
    <label>Name</label>
    <input type="text" name="name" placeholder="Clock" />

    <label>Segments</label>
    <input type="number" name="total" min="1" max="200" step="1" value="8"/>

    <label>Visibility</label>
    <label>
      <input type="radio" name="vis" value="public" checked />
      <i class="fa-solid fa-eye"></i> Public
    </label>
    <label>
      <input type="radio" name="vis" value="hidden" />
      <i class="fa-solid fa-eye-slash"></i> GM Only
    </label>
  </form>`;

  // Returns the object we build in callback, or null if canceled
  return await Dialog.prompt({
    title: "Create Clock",
    content,
    label: "Create",
    callback: html => {
      const form = html[0].querySelector("form");
      if (!form) return null;
      const fd = new FormData(form);
      const name = (fd.get("name") || "Clock").toString().trim().slice(0, 60);
      const total = Math.max(1, Math.min(200, Number(fd.get("total")) || 8));
      const gmOnly = fd.get("vis") === "hidden";
      return { name, total, filled: 0, gmOnly };
    },
    rejectClose: false // Esc/close returns null
  });
}

async function mgCreateClockFromUi() {
	if (!game.user.isGM) {
		ui.notifications?.warn("Only the GM can create clocks.");
		return;
	}

	const opts = await mgOpenCreateClockDialog();
	if (!opts) return;

	const id = await mgClockCreate(opts);

	if (id) {
		await mgRenderAllClocks();

		// Public clocks play the sting for everyone.
		if (!opts.gmOnly) {
			mgPlayClockSfx(0.8, { broadcast: true });
		}
	}
}

async function mgClearAllClocksFromUi() {
	if (!game.user.isGM) {
		ui.notifications?.warn("Only the GM can clear clocks.");
		return;
	}

	const ok = await Dialog.confirm({
		title: "Clear All Clocks?",
		content: "<p>This will remove all clocks from the current scene.</p>"
	});

	if (!ok) return;

	const all = mgClocksGetAll();

	for (const id of Object.keys(all)) {
		await mgClockDeleteById(id);
	}

	await mgRenderAllClocks();
}

async function mgClearClocksByScope(scope = CLOCK_SCOPE_SCENE) {
	if (!game.user.isGM) {
		ui.notifications?.warn("Only the GM can clear clocks.");
		return;
	}

	scope = mgNormalizeClockScope(scope);
	const label = scope === CLOCK_SCOPE_GLOBAL ? "global" : "scene";
	const all = mgClocksGetAll(scope);
	const ids = Object.keys(all);
	if (!ids.length) return;

	const ok = await Dialog.confirm({
		title: "Clear Clocks?",
		content: `<p>This will remove all ${label} clocks.</p>`
	});

	if (!ok) return;

	for (const id of ids) {
		await mgClockDeleteById(id, scope);
	}

	await mgRenderAllClocks();
	globalThis.mgRefreshClocksSidebarContent?.();
}

function mgGetClockListForSidebar(scope = CLOCK_SCOPE_SCENE) {
  scope = mgNormalizeClockScope(scope);
  const all = mgClocksGetAll(scope);
  const orderFlags = game.user?.getFlag?.(MG_NS, "clockOrder") ?? {};
  const uiOrder = Array.isArray(orderFlags?.[scope]) ? orderFlags[scope] : [];
  const ids = Object.keys(all).filter(id => game.user.isGM || !all[id]?.gmOnly);
  const ordered = [
    ...uiOrder.filter(id => ids.includes(id)),
    ...ids.filter(id => !uiOrder.includes(id)).sort((a, b) => {
      const ac = mgClockGetById(a, scope);
      const bc = mgClockGetById(b, scope);
      return (Number(bc.createdAt) || 0) - (Number(ac.createdAt) || 0);
    })
  ];
  return ordered.map(id => mgClockGetById(id, scope));
}

async function mgSaveClockOrderForUser(scope, ids) {
  scope = mgNormalizeClockScope(scope);
  const orderFlags = game.user?.getFlag?.(MG_NS, "clockOrder") ?? {};
  await game.user?.setFlag?.(MG_NS, "clockOrder", { ...orderFlags, [scope]: ids });
}

function mgRenderSidebarClockInto(host, id, scope = CLOCK_SCOPE_SCENE) {
  if (!host) return;
  scope = mgNormalizeClockScope(scope);
  const c = mgClockGetById(id, scope);
  if (!game.user.isGM && c.gmOnly) return;

  const $wrap = mgEnsureClockDOM(id, scope, "sidebar");
  $wrap.attr("data-mg-sidebar-clock", `${scope}:${id}`);
  $wrap.removeClass("mg-clock-canvas").addClass("mg-clock-sidebar-card");
  $wrap[0].style.position = "";
  $wrap[0].style.left = "";
  $wrap[0].style.top = "";
  $wrap[0].style.right = "";
  $wrap[0].hidden = false;
  host.appendChild($wrap[0]);

  const nameInput = $wrap.find(".mg-clock-name")[0];
  if (nameInput) {
    nameInput.value = c.name || "";
    nameInput.placeholder = c.name || "Clock";
    nameInput.readOnly = !game.user.isGM;
    nameInput.classList.toggle("readonly", !game.user.isGM);
  }

  const totalInput = $wrap.find(".mg-clock-total")[0];
  if (totalInput) totalInput.value = String(c.total);

  const $controls = $wrap.find(".mg-clock-controls");
  if (game.user.isGM) {
    $wrap.removeClass("readonly");
    $controls.toggle(true).attr("aria-hidden","false");
  } else {
    $wrap.addClass("readonly");
    $controls.toggle(false).attr("aria-hidden","true");
  }

  const visBtn = $wrap.find(".mg-clock-vis")[0];
  if (visBtn) {
    const i = visBtn.querySelector("i");
    visBtn.title = c.gmOnly ? "Hidden (GM Only) — click to make Public" : "Public — click to hide from Players";
    if (i) i.className = c.gmOnly ? "fa-solid fa-eye-slash" : "fa-solid fa-eye";
    visBtn.setAttribute("aria-pressed", c.gmOnly ? "true" : "false");
  }

  const scopeBtn = $wrap.find(".mg-clock-scope")[0];
  if (scopeBtn) {
    const toScene = scope === CLOCK_SCOPE_GLOBAL;
    scopeBtn.title = toScene ? "Tie to Scene" : "Make Global";
    scopeBtn.setAttribute("data-tooltip", toScene ? "Tie to Scene" : "Make Global");
    const i = scopeBtn.querySelector("i");
    if (i) i.className = toScene ? "fa-solid fa-link" : "fa-solid fa-globe";
  }

  mgDrawClock($wrap, id);
  mgBindClock($wrap, id);
}

/* Midnight Gambit palette (queen icon): Initiative + Clocks + Crew
----------------------------------------------------------------------*/
Hooks.on("getSceneControlButtons", (controls) => {
  // Avoid duplicates on hot-reload
  if (controls.some(c => c.name === "midnight-gambit")) return;

  // Insert right after the Token group if present
  const afterToken = controls.findIndex(c => c.name === "token");
  const insertAt = afterToken >= 0 ? afterToken + 1 : controls.length;

  const gm = game.user.isGM;

  const mg = {
    name: "midnight-gambit",
    title: "Midnight Gambit Tools",
    icon: "mg-queen",
    layer: "controls",
    activeTool: "mgInitiative"    ,
    tools: [
      // --- Initiative toggle ---
      {
        name: "mgInitiative",
        title: "Initiative",
        icon: "fa-solid fa-swords",
        toggle: true,
        active: false,
        onClick: (toggled) => {
          if (!game.mgInitiative) {
            ui.notifications?.error("Initiative UI failed to load (game.mgInitiative missing).");
            return;
          }
          toggled ? game.mgInitiative.showBar() : game.mgInitiative.hideBar();
        }
      },

      // --- Add Clock (GM only) ---
      {
        name: "mgAddClock",
        title: "Add Clock",
        icon: "fas fa-clock",
        button: true,
        visible: gm,
        onClick: async () => {
          const opts = await mgOpenCreateClockDialog();
          if (!opts) return;                                // canceled
          const id = await mgClockCreate(opts);             // creates with GM-only choice
          if (id) {
            mgRenderAllClocks();

            // If it was created as Public, play the ominous sting for everyone
            if (!opts.gmOnly) {
              mgPlayClockSfx(0.8, { broadcast: true });
            }
          }
        }
      },

      // --- Clear All Clocks (GM only) ---
      {
        name: "mgClearClocks",
        title: "Clear All Clocks (Scene)",
        icon: "fa-solid fa-clock-rotate-left",
        button: true,
        visible: gm,
        onClick: async () => {
          const ok = await Dialog.confirm({
            title: "Clear All Clocks?",
            content: "<p>This will remove all clocks from the current scene.</p>"
          });
          if (!ok) return;

          const all = mgClocksGetAll();
          for (const id of Object.keys(all)) await mgClockDeleteById(id);
          await mgRenderAllClocks();
        }
      },

      // --- Open Crew Sheet (handy shortcut) ---
      {
        name: "mgOpenCrew",
        title: "Open Crew Sheet",
        icon: "fa-solid fa-users",
        button: true,
        onClick: async () => {
          const actor = await mgResolveCurrentCrewActor();
          if (!actor) {
            ui.notifications?.warn("No Crew found. Open your Crew sheet and click 'Link to Initiative Bar' once.");
            return;
          }
          actor.sheet?.render(true, { focus: true });
          ui.notifications?.info(`Opened Crew: ${actor.name}`);
        }
      }
    ]
  };

  controls.splice(insertAt, 0, mg);
});

Hooks.once("ready", () => {
	game.mgClocks = {
		create: mgCreateClockFromUi,
		createScoped: async scope => {
			const opts = await mgOpenCreateClockDialog();
			if (!opts) return null;
			const id = await mgClockCreate({ ...opts, scope });
			if (id && !opts.gmOnly) {
				mgPlayClockSfx(0.8, { broadcast: true });
			}
			await mgRenderAllClocks();
			return id;
		},
		clearAll: mgClearAllClocksFromUi,
		clearScope: mgClearClocksByScope,
		renderAll: mgRenderAllClocks,
		clearDom: mgClearAllClockDOM,
		areHidden: mgClocksAreHiddenForUser,
		setHidden: mgSetUserClocksHidden,
		toggleHidden: mgToggleUserClocksHidden,
		getList: mgGetClockListForSidebar,
		renderSidebarClockInto: mgRenderSidebarClockInto,
		saveOrder: mgSaveClockOrderForUser,
		moveScope: mgClockMoveScope,
		delete: mgClockDeleteById
	};
});


/* Portrait Injection
----------------------------------------------------------------------*/

Hooks.on("renderChatMessage", async (message, html) => {
  let speaker = {};
  let $avatar = null;

  try {
    // Guard: avoid double-injection
    if (html[0]?.classList?.contains("mg-chat")) return;

    // Settings (already registered in your file)
    const source = game.settings.get("midnight-gambit", "chatPortraitSource"); // "token" | "actor" | "user"

    // Resolve an image without touching your message content
    speaker = message.speaker ?? {};
    let img = null;

    // Try token texture if requested/available
    if (!img && (source === "token" || source === "actor")) {
      const tokId = speaker.token;
      const live  = tokId ? canvas?.tokens?.get(tokId) : null;
      const scTok = tokId ? canvas?.scene?.tokens?.get?.(tokId) : null;
      const tokDoc = live?.document || scTok;
      img = tokDoc?.texture?.src ?? null;
    }

    // Try actor image
    if (!img && (source === "actor" || source === "token")) {
      const actorId = speaker.actor;
      const actor   = actorId ? game.actors.get(actorId) : null;
      img = actor?.img ?? null;
    }

    // Fallback to user avatar
    if (!img) {
      const user = game.users.get(message.user?.id);
      img = user?.avatar ?? null;
    }

    // If no image, do nothing
    if (!img) return;

    // Mark root for CSS and insert avatar right inside the message root
    html.addClass("mg-chat");

    $avatar = $(`
      <div class="mg-chat-avatar-wrap">
        <img class="mg-chat-avatar" src="${img}" alt="" loading="lazy"/>
      </div>
    `);

    const actorIdForHud = message.speaker?.actor;
    if (actorIdForHud) {
      const actorForHud = game.actors.get(actorIdForHud);

      if (actorForHud) {
        const sto = Number(actorForHud.system?.sto?.value ?? 0);
        const riskTotal = Number(actorForHud.system?.riskDice ?? 0);
        const riskUsed = Number(actorForHud.system?.riskUsed ?? 0);
        const riskRemaining = Math.max(0, riskTotal - riskUsed);

        const $hud = $(`
          <div class="mg-chat-avatar-hud">
            <div class="mg-chat-avatar-stat mg-chat-avatar-stat-risk">
              <i class="fa-kit fa-risk"></i>
              <span>${riskRemaining}</span>
            </div>
            <div class="mg-chat-avatar-stat mg-chat-avatar-stat-sto">
              <i class="fa-kit fa-sto"></i>
              <span>${sto}</span>
            </div>
          </div>
        `);

        $avatar.append($hud);
      }
    }

    // Apply per-actor chat framing (CSS vars) TO THE IMG (not the wrapper)
    const actorId = speaker.actor;
    const actor = actorId ? game.actors.get(actorId) : null;

    if (actor) {
      const crop = actor.getFlag("midnight-gambit", "crops")?.chat?.css || null;

      const hasCrop =
        crop &&
        Number.isFinite(crop.x) &&
        Number.isFinite(crop.y) &&
        Number.isFinite(crop.scale);

      if (hasCrop) {
        const x = crop.x;
        const y = crop.y;
        const s = crop.scale;

        const imgEl = $avatar.find("img.mg-chat-avatar")[0];
        if (imgEl?.style) {
          imgEl.style.setProperty("--mg-crop-x", String(x));
          imgEl.style.setProperty("--mg-crop-y", String(y));
          imgEl.style.setProperty("--mg-crop-scale", String(s));
          imgEl.classList.add("mg-chat-avatar-cropped");
        }
      }
    }

    // Insert avatar at the very top of the message node; do NOT wrap/move your content
    html.prepend($avatar);

    // Add a class to header/content so CSS can place them next to the avatar without reparenting
    html.find(".message-header, .message-content").addClass("mg-chat-body");
  } catch (err) {
    console.error("Midnight Gambit | Chat portrait injection error:", err);
  }

});

/* Permissions override
----------------------------------------------------------------------*/
function mgIsRestrictedMessage(message) {
  return !!message?.blind || (Array.isArray(message?.whisper) && message.whisper.length > 0);
}

function mgCanViewerSeeRoll(message) {
  return !!message?.isContentVisible;
}

function mgCanRevealToEveryone(message) {
  // GM can always try. Authors can try to reveal their own rolls.
  return !!(game.user.isGM || message.isAuthor);
}

function mgRestrictedBadgeHtml(message) {
  if (!mgIsRestrictedMessage(message) || !mgCanViewerSeeRoll(message)) return "";

  const icon = message.blind ? "fa-user-secret" : "fa-eye-slash";
  const label = message.blind ? "Blind Roll" : "Hidden Roll";

  return `
    <div class="mg-roll-privacy-badge" title="${label}">
      <i class="fa-solid ${icon}" aria-hidden="true"></i>
    </div>
  `;
}

async function mgPromptRevealToEveryone(message) {
  if (!mgCanRevealToEveryone(message)) return;

  const ok = await Dialog.confirm({
    title: "Reveal Roll?",
    content: `<p>Reveal this hidden roll to everyone in chat?</p>`,
    yes: () => true,
    no: () => false,
    defaultYes: false
  });

  if (!ok) return;

  try {
    await message.update({
      blind: false,
      whisper: []
    });

    ui.notifications?.info("Roll revealed to everyone.");
  } catch (err) {
    console.error("MG | Failed to reveal roll to everyone:", err);
    ui.notifications?.error("Could not reveal this roll to everyone.");
  }
}

function mgBuildObscuredRollCard() {
  return `
    <div class="mg-chat-card chat-roll mg-roll-card mg-roll-card-obscured">
      <div class="mg-roll-header">
        <div class="mg-roll-label-wrap">
          <label class="mg-roll-label">Hidden Message</label>
        </div>
      </div>

      <div class="roll-wrapper">
        <div class="mg-roll-outcome result-hidden">
          <div class="mg-roll-outcome-title">
            <i class="fa-solid fa-eye-slash"></i>
            <strong>Hidden Roll</strong>
          </div>

          <div class="mg-roll-outcome-text">
            This result is hidden.
          </div>
        </div>
      </div>
    </div>
  `;
}

function mgBuildRestrictedChatData(sourceMessage, base = {}) {
  const data = { ...base };

  if (sourceMessage?.blind) data.blind = true;
  if (Array.isArray(sourceMessage?.whisper) && sourceMessage.whisper.length) {
    data.whisper = [...sourceMessage.whisper];
  }

  return data;
}

/* Vanilla Foundry Roll -> MG Structure
----------------------------------------------------------------------*/

Hooks.on("renderChatMessage", (message, html) => {
  try {
    const root = html[0];
    if (!root) return;

    // Skip cards that are already using MG markup
    if (
      root.querySelector(".mg-chat-card") ||
      root.querySelector(".mg-risk-result") ||
      root.querySelector(".gambit-card")
    ) return;

    const rollContainer = root.querySelector(".dice-roll");
    const roll = message?.roll;
    if (!rollContainer || !roll) return;

    if (rollContainer.dataset.mgVanillaProcessed === "true") return;
    rollContainer.dataset.mgVanillaProcessed = "true";

    const isRestricted = mgIsRestrictedMessage(message);
    const canSeeContent = mgCanViewerSeeRoll(message);
    const canRevealToEveryone = mgCanRevealToEveryone(message);

    // If THIS viewer cannot see the roll, render the hidden shell
    if (isRestricted && !canSeeContent) {
      const messageContent = root.querySelector(".message-content");

      if (messageContent) {
        messageContent.innerHTML = mgBuildObscuredRollCard();
      } else {
        rollContainer.innerHTML = mgBuildObscuredRollCard();
      }

      return;
    }

    // Pull dice results from the first Die term
    const dieTerm = roll.terms?.find(t => Array.isArray(t?.results));
    const allDice = (dieTerm?.results ?? []).map((r, index) => ({
      index,
      value: Number(r.result) || 0,
      active: !!r.active
    }));

    const keptDice = allDice.filter(d => d.active);
    const droppedDice = allDice.filter(d => !d.active);

    const visibleDice = keptDice.length ? keptDice : allDice;
    const hasDroppedDice = droppedDice.length > 0;

    const formula = String(roll.formula ?? "").trim();
    const total = Number(roll.total ?? 0);

    const diceHtml = `
      <div class="mg-roll-dice-list">
        ${visibleDice.map((die, displayIndex) => `
          <div
            class="mg-roll-die ${die.active ? "is-kept" : "is-dropped"}"
            data-die-index="${die.index}"
            data-display-index="${displayIndex}">
            ${die.value}
          </div>
        `).join("")}
      </div>
    `;

    const droppedDiceHtml = hasDroppedDice ? `
      <div class="mg-roll-dropped-panel vanilla-roll" hidden>
        <div class="mg-roll-dropped-list">
          <div class="mg-roll-tray-group mg-roll-tray-group-kept">
            ${allDice.map((die, displayIndex) => `
              <div
                class="mg-roll-die ${die.active ? "is-kept" : "is-dropped"}"
                data-die-index="${die.index}"
                data-display-index="${displayIndex}">
                ${die.value}
              </div>
            `).join("")}
          </div>

          <div class="mg-roll-formula-line">${formula}</div>
        </div>
      </div>
    ` : `
      <div class="mg-roll-dropped-panel vanilla-roll" hidden>
        <div class="mg-roll-dropped-list">
          <div class="mg-roll-formula-line">${formula}</div>
        </div>
      </div>
    `;

    const mathChevron = `
      <div class="mg-roll-expand-indicator" aria-hidden="true">
        <i class="fa-solid fa-chevron-down"></i>
      </div>
    `;

    const privacyBadge = mgRestrictedBadgeHtml(message);

    const revealHint = (isRestricted && canRevealToEveryone)
      ? `<div class="mg-roll-reveal-hint"><small>Right-click to reveal to everyone.</small></div>`
      : "";

    const vanillaCard = `
      <div class="mg-chat-card chat-roll mg-roll-card mg-vanilla-roll-card ${isRestricted ? "is-restricted-roll" : ""}" data-total="${total}">
        <div class="mg-roll-header">
          <div class="mg-roll-label-wrap">
            <label class="mg-roll-label">Roll</label>
            ${privacyBadge}
          </div>
        </div>

        <div class="roll-wrapper">
          <div class="mg-roll-math-wrap">
            <div class="mg-roll-math is-interactive"
                role="button"
                tabindex="0"
                aria-expanded="false">
              <div class="mg-roll-math-column">
                ${diceHtml}
              </div>

              ${mathChevron}

              <div class="mg-roll-total-box">
                <strong class="mg-roll-total">${total}</strong>
              </div>
            </div>

            ${droppedDiceHtml}
          </div>
          ${revealHint}
        </div>
      </div>
    `;

    rollContainer.innerHTML = vanillaCard;

    const math = rollContainer.querySelector(".mg-roll-math");
    const panel = rollContainer.querySelector(".mg-roll-dropped-panel");

    const setOpen = (open) => {
      math.classList.toggle("open", open);
      math.setAttribute("aria-expanded", open ? "true" : "false");
      if (panel) panel.hidden = !open;
    };

    setOpen(false);

    math?.addEventListener("click", () => {
      const open = math.classList.contains("open");
      setOpen(!open);
    });

    math?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const open = math.classList.contains("open");
        setOpen(!open);
      }
    });

    // Restricted visible rolls: right-click to reveal to everyone
    if (isRestricted && canRevealToEveryone) {
      const card = rollContainer.querySelector(".mg-roll-card");
      card?.addEventListener("contextmenu", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await mgPromptRevealToEveryone(message);
      });
    }

  } catch (err) {
    console.error("Midnight Gambit | Vanilla roll MG render failed:", err);
  }
});

// --- Risk It: one-use per message; subsequent risks via the spawned result card ---
Hooks.on("renderChatMessage", (message, html) => {
  const root = html[0];
  if (!root) return;

  // ------------------------------------------------------------
  // MG chat controls visibility:
  // Only show Risk/STO buttons to actor owners (or GM).
  // This runs per-client, so chat stays clean for everyone else.
  // ------------------------------------------------------------
  {
    const btn =
      root.querySelector(".mg-risk-it, .mg-risk-again, .mg-spend-sto");

    // If this message has no MG controls, nothing to do.
    if (btn) {
      const actorId =
        btn.dataset.actorId || message?.speaker?.actor || null;

      const actor = actorId ? game.actors.get(actorId) : null;

      // If we can't resolve an actor, fail "closed" (hide buttons).
      const canUse =
        !!actor && (actor.isOwner || game.user.isGM);

      if (!canUse) {
        root
          .querySelectorAll(".mg-risk-it, .mg-risk-again, .mg-spend-sto")
          .forEach((n) => n.remove());

        // Optional cleanup: remove empty wrappers so chat doesn't have dead space
        root
          .querySelectorAll(".mg-roll-controls, .mg-risk-controls, .mg-risk-controls-again")
          .forEach((wrap) => {
            if (!wrap.querySelector("button")) wrap.remove();
          });
      }
    }
  }


  // Helper: disable a button visually
  const disableBtn = (btn) => {
    btn.disabled = true;
    btn.classList.add("is-disabled");
    btn.setAttribute("aria-disabled", "true");
  };

  // Helper: flash both strain tracks on an open actor sheet
  const flashStrain = (actor) => {
    const el = actor?.sheet?.element;
    if (!el?.length) return;
    const $tracks = el.find(".strain-track");
    $tracks.addClass("mg-strain-flash");
    setTimeout(() => $tracks.removeClass("mg-strain-flash"), 1200);
  };

  // Core handler for both the first Risk and "Risk Again"
  const handleRiskClick = async (btn) => {
    disableBtn(btn); // UI first

    // Mark this message as consumed so refresh doesn't re-enable it
    try { await message.setFlag("midnight-gambit", "riskConsumed", true); } catch (e) {}

    const actorId  = btn.dataset.actorId;
    const keptStr  = btn.dataset.kept || "";
    const skillMod = Number(btn.dataset.skillMod || 0);
    const sessionId = btn.dataset.sessionId || message.getFlag("midnight-gambit", "stoSession")?.sessionId || foundry.utils.randomID();


    const actor = game.actors.get(actorId);
    if (!actor) return ui.notifications.warn("Actor not found for Risk.");

    const kept = keptStr.split(",").map(n => Number(n)).filter(Number.isFinite);
    if (kept.length < 2) return ui.notifications.warn("Risk requires two kept dice.");

    // Roll the risk die
    const riskRoll = await (new Roll("1d6")).evaluate({ async: true });
    const R = riskRoll.total;

    // Replace the lower of the two kept dice
    const L   = Math.min(kept[0], kept[1]);
    const idx = kept.indexOf(L);
    const newDice = kept.slice();
    newDice[idx] = R;

    const newSum   = newDice[0] + newDice[1];
    const newTotal = newSum + skillMod;

    // --- STO session bookkeeping (apply once, undo once, never double tick) ---
    let stoSession = message.getFlag("midnight-gambit", "stoSession") || {
      sessionId,
      stoApplied: false,
      stoAppliedDelta: 0,
      stoUndone: false
    };

    // STO stacks ONLY on Failure (including crit fail)
    const isFailNow = (newDice.every(d => d === 1)) || (newTotal <= 6);
    const isNotFailNow = !isFailNow;


    // If the Risk reroll turns a previously good roll into bad, apply STO (once)
    if (isFailNow && !stoSession.stoApplied) {
      const cur = Number(actor.system?.sto?.value ?? 0);
      const next = Math.min(6, cur + 1);
      const delta = (next !== cur) ? 1 : 0;

      if (delta) await actor.update({ "system.sto.value": next }, { render: false });

      stoSession.stoApplied = true;
      stoSession.stoAppliedDelta = delta;
      stoSession.stoUndone = false;
    }

    // If STO was applied for this session, and we now get a good result, undo (once)
    if (isNotFailNow && stoSession.stoApplied && !stoSession.stoUndone && stoSession.stoAppliedDelta === 1) {
      const cur = Number(actor.system?.sto?.value ?? 0);
      const next = Math.max(0, cur - 1);
      await actor.update({ "system.sto.value": next }, { render: false });
      stoSession.stoUndone = true;
    }

    // Consume one Risk die (gray out one dot)
    try {
      const used  = Number(actor.system?.riskUsed ?? 0);
      const total = Number(actor.system?.riskDice ?? 0);
      if (used < total) await actor.update({ "system.riskUsed": used + 1 });
    } catch (err) {
      console.warn("MG | failed to consume a Risk die:", err);
    }

  // Can we risk again? (only show the button if there are dice left)
  const usedNow  = Number(actor.system?.riskUsed ?? 0);
  const totalRD  = Number(actor.system?.riskDice ?? 0);
  const canAgain = usedNow < totalRD;

  // --- Build resultText to match your original style, but for the NEW result ---
  let resultLabel = "";
  let resultDesc = "";
  let resultIcon = "";
  let resultClass = "";

  if (newDice.every(d => d === 6)) {
    resultLabel = "ACE!";
    resultDesc = "You steal the spotlight.";
    resultIcon = "fa-star text-gold";
    resultClass = "result-ace";
  } else if (newDice.every(d => d === 1)) {
    resultLabel = "Critical Failure";
    resultDesc = "It goes horribly wrong.";
    resultIcon = "fa-skull-crossbones";
    resultClass = "result-crit";
  } else if (newTotal <= 6) {
    resultLabel = "Failure";
    resultDesc = "Something goes awry.";
    resultIcon = "fa-fire-flame result-fail";
    resultClass = "result-fail";
  } else if (newTotal <= 10) {
    resultLabel = "Complication";
    resultDesc = "Success with a cost.";
    resultIcon = "fa-swords result-mixed";
    resultClass = "result-complication";
  } else {
    resultLabel = "Flourish";
    resultDesc = "Narrate your success.";
    resultIcon = "fa-crown";
    resultClass = "result-flourish";
  }

  // --- Compact swap display shown inside the outcome body ---
  const swapHtml = `
    <div class="mg-risk-swap-inline">
      <span class="mg-risk-swap-die">${L}</span>
      <i class="fa-solid fa-arrow-right"></i>
      <span class="mg-risk-swap-die">${R}</span>
    </div>
  `;

  const diceHtml = `
    <div class="mg-roll-dice-list">
      ${newDice.map((die, i) => `
        <div class="mg-roll-die ${i === idx ? "is-risk-replaced" : ""}">
          ${die}
        </div>
      `).join("")}
    </div>
  `;

  const modifiersHtml = `
    <div class="mg-roll-modifiers ${skillMod !== 0 ? "" : "is-empty"}">
      ${skillMod !== 0 ? `
        <div class="mg-roll-modifier" data-mod-key="skill" title="Skill Bonus">
          <i class="fa-solid fa-user-plus"></i>
          <span class="mg-roll-mod-value">${skillMod > 0 ? "+" : ""}${skillMod}</span>
        </div>
      ` : ""}
    </div>
  `;

  const againBtn = canAgain
    ? `<button type="button"
              class="mg-roll-action mg-risk-again"
              data-actor-id="${actor.id}"
              data-kept="${newDice.join(",")}"
              data-skill-mod="${skillMod}"
              data-session-id="${sessionId}"
              title="Risk">
        <i class="fa-kit fa-risk"></i>
      </button>`
    : `<button type="button"
              class="mg-roll-action is-disabled"
              disabled
              aria-disabled="true"
              title="Risk unavailable">
        <i class="fa-kit fa-risk"></i>
      </button>`;

  // ------------------------------------------------------------
  // STO buttons for the Risk Result card (owner-only rendering is handled elsewhere)
  // Shows ONLY if spending STO upgrades the outcome band.
  // ------------------------------------------------------------
  let stoCompBtn = `
    <button type="button"
      class="mg-roll-action is-disabled"
      disabled
      aria-disabled="true"
      title="Upgrade to Complication unavailable">
      <i class="fa-solid fa-swords"></i>
    </button>`;

  let stoFlourishBtn = `
    <button type="button"
      class="mg-roll-action is-disabled"
      disabled
      aria-disabled="true"
      title="Upgrade to Flourish unavailable">
      <i class="fa-solid fa-crown"></i>
    </button>`;

  const stoValue = Number(actor.system?.sto?.value ?? 0);

  if (stoValue > 0) {
    // From Failure -> Complication or Flourish
    if (newTotal <= 6) {
      const needComp = 7 - newTotal;
      const needFlourish = 11 - newTotal;

      if (needComp > 0 && needComp <= stoValue) {
        stoCompBtn = `
          <button type="button"
            class="mg-roll-action mg-spend-sto sto-complication"
            data-actor-id="${actor.id}"
            data-spend="${needComp}"
            data-total="${newTotal}"
            title="Upgrade to Complication">
            <i class="fa-solid fa-swords"></i>
          </button>`;
      }

      if (needFlourish > 0 && needFlourish <= stoValue) {
        stoFlourishBtn = `
          <button type="button"
            class="mg-roll-action mg-spend-sto sto-flourish"
            data-actor-id="${actor.id}"
            data-spend="${needFlourish}"
            data-total="${newTotal}"
            title="Upgrade to Flourish">
            <i class="fa-solid fa-crown"></i>
          </button>`;
      }
    }

    // From Complication -> Flourish
    else if (newTotal >= 7 && newTotal <= 10) {
      const needFlourish = 11 - newTotal;

      if (needFlourish > 0 && needFlourish <= stoValue) {
        stoFlourishBtn = `
          <button type="button"
            class="mg-roll-action mg-spend-sto sto-flourish"
            data-actor-id="${actor.id}"
            data-spend="${needFlourish}"
            data-total="${newTotal}"
            title="Upgrade to Flourish">
            <i class="fa-solid fa-crown"></i>
          </button>`;
      }
    }
  }

  const controlButtons = `
    <div class="mg-roll-controls mg-risk-controls-again">
      ${againBtn}
      ${stoCompBtn}
      ${stoFlourishBtn}
    </div>
  `;

  // --- Compose the follow-up message ---
  const content = `
    <div class="mg-chat-card chat-roll mg-roll-card mg-risk-result" data-total="${newTotal}">
      <div class="mg-roll-header">
        <div class="mg-roll-label-wrap">
          <label class="mg-roll-label">Risk Result</label>
          ${mgRestrictedBadgeHtml(message)}
        </div>
      </div>

      <div class="roll-wrapper">
        <div class="mg-roll-outcome ${resultClass}">
          <div class="mg-roll-outcome-title">
            <i class="fa-solid ${resultIcon}"></i>
            <strong>${resultLabel}</strong>
          </div>

          <div class="mg-roll-outcome-text">
            ${resultDesc}
            ${swapHtml}
          </div>
        </div>

        <div class="mg-roll-math-wrap">
          <div class="mg-roll-math" tabindex="0" aria-expanded="false">
            <div class="mg-roll-math-column">
              ${diceHtml}
              ${modifiersHtml}
            </div>

            <div class="mg-roll-total-box">
              <strong class="mg-roll-total">${newTotal}</strong>
            </div>
          </div>
        </div>

        ${controlButtons}
      </div>
    </div>
  `;

  const newMsg = await ChatMessage.create(mgBuildRestrictedChatData(message, {
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER
  }));

  function mgRestrictedMetaHtml(message) {
  if (!mgIsRestrictedMessage(message) || !mgCanViewerSeeRoll(message)) return "";

  return `
    <div class="mg-roll-private-meta">
      <i class="fa-solid fa-eye-slash" aria-hidden="true"></i>
      <span>${mgRestrictedTargetLabel(message)}</span>
    </div>
  `;
}

  function mgRestrictedTargetLabel(message) {
    if (!mgIsRestrictedMessage(message)) return "";

    // Self roll / blind style
    if (message?.blind) return "Hidden Roll";

    const ids = Array.isArray(message?.whisper) ? message.whisper : [];
    if (!ids.length) return "Hidden Roll";

    const names = ids
      .map(id => game.users.get(id)?.name)
      .filter(Boolean);

    if (!names.length) return "Hidden Roll";

    return `To: ${names.join(", ")}`;
  }

  // Carry STO session forward so the next Risk Again click is still the same session
  try { await newMsg.setFlag("midnight-gambit", "stoSession", stoSession); } catch (e) {}

  };

  // 1) Original chat roll's "Risk It" button (one-use, persisted)
  const riskBtn = root.querySelector(".mg-risk-it");
  if (riskBtn) {
    const consumed = message.getFlag("midnight-gambit", "riskConsumed");
    if (consumed) disableBtn(riskBtn);
    else riskBtn.addEventListener("click", () => handleRiskClick(riskBtn), { once: true });
  }

  // 2) Each spawned "Risk Result" card can be used once as well
  const riskAgainBtn = root.querySelector(".mg-risk-again");
  if (riskAgainBtn) {
    const consumed = message.getFlag("midnight-gambit", "riskConsumed");
    if (consumed) disableBtn(riskAgainBtn);
    else riskAgainBtn.addEventListener("click", () => handleRiskClick(riskAgainBtn), { once: true });
  }

  html.on("click", ".mg-spend-sto", async (event) => {
    event.preventDefault();

    const btn = event.currentTarget;
    const actor = game.actors.get(btn.dataset.actorId);
    if (!actor) return;

    const spend = Number(btn.dataset.spend);
    if (!spend) return;

    const chatRoll = btn.closest(".chat-roll");
    if (!chatRoll) return;

    const baseTotal = Number(chatRoll.dataset.total);
    if (Number.isNaN(baseTotal)) return;

    const curSTO = Number(actor.system?.sto?.value ?? 0);
    if (curSTO < spend) return; // safety

    const finalTotal = baseTotal + spend;

    // Spend ONLY what's needed
    await actor.update({ "system.sto.value": Math.max(0, curSTO - spend) }, { render: false });

    // Determine new outcome bracket
    let resultClass;
    let resultIcon;
    let resultLabel;
    let resultText;

    if (finalTotal >= 11) {
      resultClass = "result-flourish";
      resultIcon = "fa-crown";
      resultLabel = "Flourish";
      resultText = "Narrate your success.";
    }
    else if (finalTotal >= 7) {
      resultClass = "result-complication";
      resultIcon = "fa-swords";
      resultLabel = "Complication";
      resultText = "Success with a cost.";
    }
    else {
      resultClass = "result-fail";
      resultIcon = "fa-fire-flame";
      resultLabel = "Failure";
      resultText = "Something goes awry.";
    }

    await ChatMessage.create(mgBuildRestrictedChatData(message, {
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <div class="mg-chat-card chat-roll mg-roll-card sto-upgrade" data-total="${finalTotal}">
          <div class="mg-roll-header">
            <div class="mg-roll-label-wrap">
              <label class="mg-roll-label">STO Upgrade</label>
              ${mgRestrictedBadgeHtml(message)}
            </div>
          </div>

          <div class="roll-wrapper">
            <div class="mg-roll-outcome ${resultClass}">
              <div class="mg-roll-outcome-title">
                <i class="fa-solid ${resultIcon}" aria-hidden="true"></i>
                <strong>${resultLabel}</strong>
              </div>

              <div class="mg-roll-outcome-text">
                ${resultText}
                <span class="sto-spent">${spend} STO Spent</span>
              </div>
            </div>

            <div class="mg-roll-math-wrap">
              <div class="mg-roll-math" tabindex="0" aria-expanded="false">
                <div class="mg-roll-math-column">
                  <div class="mg-roll-modifiers">
                    <div class="mg-roll-modifier">
                      <span class="label"><i class="fa-solid fa-user"></i></span>
                      <strong>${baseTotal}</strong>
                    </div>
                    <div class="mg-roll-modifier">
                      <span class="label"><i class="fa-kit fa-sto"></i></span>
                      <strong>+${spend}</strong>
                    </div>
                  </div>
                </div>

                <div class="mg-roll-total-box">
                  <strong class="mg-roll-total">${finalTotal}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      `,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER
    }));

  });
});


// --- Edge: click a box to reveal its kept dice (chat only) ---
Hooks.on("renderChatMessage", (_message, html) => {
  html.on("click", ".mg-edge-box", async (ev) => {
    const box = ev.currentTarget;
    const chatRoll = box.closest(".chat-roll");
    const panel = chatRoll?.querySelector(".mg-edge-dice-panel");
    if (!panel) return;

    const raw = (box.dataset.dice || "").trim();
    let dice = [];
    try { dice = JSON.parse(raw); } catch { return; }
    if (!Array.isArray(dice) || !dice.length) return;

    const edgeLabel = box.dataset.edge || "";
    const dur = 500;

    // Helper: build the tooltip HTML
    const build = () => `
      <div class="dice-tooltip">
        <ol class="dice-rolls">
          ${dice.map(d => `
            <li class="roll die d6 ${d.a ? "" : "discarded"}">${d.r}</li>
          `).join("")}
        </ol>
      </div>
    `;

    // If clicking the same box that's already open -> close it
    const isSameOpen = panel.classList.contains("is-open") && panel.dataset.openFor === edgeLabel;
    if (isSameOpen) {
      panel.style.overflow = "hidden";
      panel.style.maxHeight = panel.scrollHeight + "px";
      panel.offsetHeight; // force reflow
      panel.style.transition = `max-height ${dur}ms ease`;
      panel.style.maxHeight = "0px";

      await new Promise(r => setTimeout(r, dur));
      panel.classList.remove("is-open");
      panel.dataset.openFor = "";
      panel.style.transition = "";
      panel.style.maxHeight = "";
      panel.style.overflow = "";
      return;
    }

    // Otherwise: CLOSE (if open) -> SWAP -> OPEN
    panel.style.overflow = "hidden";
    panel.style.transition = `max-height ${dur}ms ease`;

    const wasOpen = panel.classList.contains("is-open");

    // 1) If open, animate shut first
    if (wasOpen) {
      panel.style.maxHeight = panel.scrollHeight + "px";
      panel.offsetHeight; // reflow
      panel.style.maxHeight = "0px";
      await new Promise(r => setTimeout(r, dur));
    }

    // 2) Swap the content while closed
    panel.dataset.openFor = edgeLabel;
    panel.innerHTML = build();

    // 3) Animate open
    panel.classList.add("is-open");
    panel.style.maxHeight = "0px";
    panel.offsetHeight; // reflow
    panel.style.maxHeight = panel.scrollHeight + "px";
    await new Promise(r => setTimeout(r, dur));

    // Cleanup so it can naturally size if chat reflows
    panel.style.transition = "";
    panel.style.maxHeight = "";
    panel.style.overflow = "";
  });

  // keep your keyboard handler
  html.on("keydown", ".mg-edge-box", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      ev.currentTarget.click();
    }
  });
});

/* Move Learn Spenders Global
------------------------------------------------------------------*/
async function mgConsumePending(actor, type, count = 1) {
  try {
    const ns = "midnight-gambit";
    const state = (await actor.getFlag(ns, "state")) ?? {};
    const pending = state.pending ?? {};

    const current = Number(pending[type] ?? 0);
    if (!current || current <= 0) return false; // nothing to consume

    pending[type] = Math.max(0, current - count);
    state.pending = pending;

    await actor.setFlag(ns, "state", state);

    // Re-render any open sheets for this actor so UI (glow/pulse) clears.
    for (const app of Object.values(actor.apps ?? {})) {
      if (app.render) app.render(false);
    }

    // Optional: small toast for feedback
    // ui.notifications?.info?.(`Learned a Move. Unspent Move rewards: ${pending[type]}.`);

    return true;
  } catch (err) {
    console.error("MG consume pending failed:", err);
    return false;
  }
}

/**
 * When an Item is created, if it is a Move on an Actor sheet, consume one "moves" pending reward.
 * This covers: drag from compendium, drag from sidebar, "Create Item" on the sheet, etc.
 */

/* When an Item is created, if it is a Move on an Actor sheet, consume one "moves" pending reward.
This covers: drag from compendium, drag from sidebar, "Create Item" on the sheet, etc.
------------------------------------------------------------------*/
Hooks.on("createItem", async (item, options, userId) => {
  try {
    // Only handle events initiated by this user
    if (game.userId !== userId) return;

    // We only care about embedded items created on an Actor
    const actor = item?.parent;
    if (!actor || actor.documentName !== "Actor") return;

    // Only when the item is a Move
    if (item.type !== "move") return;

    // Consume one pending move (if any)
    await mgConsumePending(actor, "moves", 1);
  } catch (err) {
    console.error("MG createItem hook error:", err);
  }
});

/* Safety-net: if flags.midnight-gambit.state changes (e.g., from other code),
re-render actor sheets so the leveler/flash UI reflects the new totals.
------------------------------------------------------------------*/
Hooks.on("updateActor", (actor, changes) => {
  const mgFlagsChanged =
    changes?.flags?.["midnight-gambit"]?.state !== undefined ||
    changes?.flags?.["midnight-gambit"]?.pending !== undefined;

  if (mgFlagsChanged) {
    for (const app of Object.values(actor.apps ?? {})) {
      if (app.render) app.render(false);
    }
  }

  if (actor.type !== "crew") return;
  if (foundry.utils.hasProperty(changes, "flags.midnight-gambit.directoryIcon")) {
    ui.actors?.render(true);
  }
});

/* Inventory Item Update Sync
------------------------------------------------------------------*/
// When an embedded inventory item changes, refresh any open parent actor sheets.
// This keeps tags, strain damage, capacity, quantity, etc. synced after editing
// the item through its item sheet.
Hooks.on("updateItem", (item, changes, options, userId) => {
  try {
    // Only react to embedded Items owned by an Actor.
    const actor = item?.parent;
    if (!actor || actor.documentName !== "Actor") return;

    // Character inventory only. Crew assets have their own card/edit flow.
    if (actor.type !== "character") return;

    // Only inventory-ish item types.
    if (!["weapon", "armor", "misc", "gambit", "asset"].includes(item.type)) return;

    // If this client cannot see/own the actor, don't touch its sheet.
    if (!actor.isOwner && !game.user.isGM) return;

    // Re-render every open sheet for this actor on this client.
    for (const app of Object.values(actor.apps ?? {})) {
      app?.render?.(false);
    }
  } catch (err) {
    console.warn("MG | updateItem inventory sync failed:", err);
  }
});

/* Inventory Item Update Sync
------------------------------------------------------------------*/
// When an embedded inventory item changes, refresh any open parent actor sheets.
// This keeps tags, strain damage, capacity, quantity, etc. synced after editing
// the item through its item sheet.
Hooks.on("updateItem", (item, changes, options, userId) => {
  try {
    const actor = item?.parent;
    if (!actor || actor.documentName !== "Actor") return;
    if (actor.type !== "character") return;
    if (!["weapon", "armor", "misc", "gambit", "asset"].includes(item.type)) return;

    if (!actor.isOwner && !game.user.isGM) return;

    for (const app of Object.values(actor.apps ?? {})) {
      app?.render?.(false);
    }
  } catch (err) {
    console.warn("MG | updateItem inventory sync failed:", err);
  }
});

/* Check if a guise has been added to the sheet, and then apply level up section
------------------------------------------------------------------*/
Hooks.on("updateActor", (actor, diff, _opts, _id) => {
  // Find this actor's rendered sheet (if open)
  const app = Object.values(ui.windows).find(
    w => w.object?.id === actor.id && typeof w._mgRefreshGuiseVisibility === "function"
  );
  if (!app) return;

  // Only react when Guise likely changed (be generous to be safe)
  const guiseTouched =
    hasProperty(diff, "system.guise") ||
    hasProperty(diff, "system.guiseId") ||
    hasProperty(diff, "system.guise.active") ||
    Array.isArray(diff.items) ||
    hasProperty(diff, "items");

  if (guiseTouched) app._mgRefreshGuiseVisibility(app.element);
});

// --- Setting: default Crew directory image (path-safe default) ---
Hooks.once("init", () => {
  game.settings.register("midnight-gambit", "defaultCrewDirectoryImage", {
    name: "Default Crew Directory Image",
    hint: "Shown in the Actors sidebar for Crew actors that still have the default silhouette.",
    scope: "world",
    config: true,
    type: String,
    // Use absolute virtual path here
    default: "systems/midnight-gambit/assets/images/mg-queen.png"
  });
});

// Resolve a path within this system reliably for directory thumbnails
function normalizeSystemAsset(url) {
  if (!url) return url;
  const u = String(url).trim().replace(/\\/g, "/");

  // Absolute or external → just route it
  if (/^(?:https?:\/\/|data:)/i.test(u)) return foundry.utils.getRoute(u);

  // Leading slash is already an absolute virtual path (/systems, /modules, etc.)
  if (u.startsWith("/")) return foundry.utils.getRoute(u);

  // Starts with a known virtual root → treat as absolute
  if (/^(systems|modules|worlds|icons|ui|assets)\b/i.test(u)) {
    return foundry.utils.getRoute(u);
  }

  // Otherwise anchor to THIS system and route
  const cleaned = u.replace(/^\.\.?\//, "");
  return foundry.utils.getRoute(`systems/${game.system.id}/${cleaned}`);
}

Hooks.on("renderActorDirectory", (app, html) => {
  // Setting value → normalize (so ../assets/... works too)
  const rawDefault = game.settings.get("midnight-gambit", "defaultCrewDirectoryImage");
  const defaultUrl = normalizeSystemAsset(rawDefault) ||
                     foundry.utils.getRoute("systems/midnight-gambit/assets/images/mg-queen.png");

  // Each <li class="document actor" data-document-id="...">
  html.find("li.document.actor").each((_, li) => {
    const id = li.dataset.documentId || li.dataset.entityId;
    const actor = game.actors.get(id);
    if (!actor) return;

    // Thumbnail element (v11 covers both forms)
    const $img = $(li).find("img.thumbnail, .thumbnail img").first();
    const $thumbBox = $img.length ? null : $(li).find(".thumbnail").first();

    // Per-actor list-only override flag
    const perActorRaw = actor.getFlag("midnight-gambit", "directoryIcon");
    const perActor = normalizeSystemAsset(perActorRaw);

    const img = actor.img ?? "";
    const isSilhouette = !img || img === "icons/svg/mystery-man.svg";

    const want = perActor || (actor.type === "crew" && isSilhouette ? defaultUrl : null);
    if (!want) return;

    if ($img?.length) {
      $img.attr("src", want).attr("data-src", want).attr("srcset", "");
    } else if ($thumbBox?.length) {
      $thumbBox.css("background-image", `url(${want})`);
    }
  });
});

// Clickable tag pills inside CHAT MESSAGES only
Hooks.on("renderChatMessage", (_message, html) => {
  // decode entities like &amp; -> &
  const decodeHTML = (htmlStr) => {
    const div = document.createElement("div");
    div.innerHTML = String(htmlStr ?? "");
    return div.textContent || div.innerText || "";
  };

  // Delegate clicks from within this specific message's DOM
  html.on("click", ".tag, .asset-tag, .item-tag", (ev) => {
    const el = ev.currentTarget;
    const cfg = CONFIG.MidnightGambit || {};

    // Build a merged registry across all *TAGS arrays
    const allDefs = Object.entries(cfg)
      .filter(([k, v]) => (/_TAGS$|TAGS$|^TAGS$/i).test(k) && Array.isArray(v))
      .flatMap(([_, arr]) => arr);

    // Prefer data-tag-id; else match by label text
    let tagId = (el.dataset?.tagId || "").trim();
    if (!tagId) {
      const label = (el.textContent || "").trim();
      const byLabel = allDefs.find(t => (t.label || t.id) === label);
      tagId = byLabel?.id || "";
    }
    if (!tagId) return;

    const def = allDefs.find(t => t.id === tagId);
    if (!def) return;

    // Decode for clean & in title/body
    const titleText = `${decodeHTML(def.label || tagId)}`;
    const bodyHtml  = `<div class="mg-tag-dialog"><p>${decodeHTML(def.description || "No description available.")}</p></div>`;

    // Dialog: set plain-text title post-render to avoid double-escaping
    const dlg = new Dialog(
      { title: titleText, content: bodyHtml, buttons: { ok: { label: "Close" } } },
      { classes: ["mg-tag-dialog"] }
    );

    const handler = (app, $html) => {
      if (app.appId !== dlg.appId) return;          // only for this dialog
      const titleEl = $html.closest(".app.window-app")[0]?.querySelector(".window-title");
      if (titleEl) titleEl.textContent = titleText; // set plain text title
      Hooks.off("renderDialog", handler);            // run once
    };
    Hooks.on("renderDialog", handler);

    dlg.render(true);
  });
});

// Clickable tag pills in ANY SHEET/WINDOW (but NOT in chat)
Hooks.once("ready", () => {
  const decodeHTML = (htmlStr) => {
    const div = document.createElement("div");
    div.innerHTML = String(htmlStr ?? "");
    return div.textContent || div.innerText || "";
  };

  document.body.addEventListener("click", (ev) => {
    // Ignore chat; handled by renderChatMessage above
    if (ev.target.closest("#chat-log")) return;

    // Find a tag pill in sheets
    const el = ev.target.closest?.(".asset-tag.tag, .asset-tag, .tag");
    if (!el) return;

    // Assets card handler already calls stopPropagation(); respect it
    if (ev.defaultPrevented) return;

    // Merge registries
    const cfg = CONFIG.MidnightGambit || {};
    const allDefs = Object.entries(cfg)
      .filter(([k, v]) => (/_TAGS$|TAGS$|^TAGS$/i).test(k) && Array.isArray(v))
      .flatMap(([_, arr]) => arr);

    // Resolve id
    let tagId = el.dataset?.tagId?.trim();
    if (!tagId) {
      const label = (el.textContent || "").trim();
      const byLabel = allDefs.find(t => (t.label || t.id) === label);
      tagId = byLabel?.id || "";
    }
    if (!tagId) return;

    const def = allDefs.find(t => t.id === tagId);
    if (!def) return;

    const titleText = `${decodeHTML(def.label || tagId)}`;
    const bodyHtml  = `<div class="mg-tag-dialog"><p>${decodeHTML(def.description || "No description available.")}</p></div>`;

    const dlg = new Dialog(
      { title: titleText, content: bodyHtml, buttons: { ok: { label: "Close" } } },
      { classes: ["mg-tag-dialog"] }
    );

    const handler = (app, $html) => {
      if (app.appId !== dlg.appId) return;          // only for this dialog
      const titleEl = $html.closest(".app.window-app")[0]?.querySelector(".window-title");
      if (titleEl) titleEl.textContent = titleText; // set plain text title
      Hooks.off("renderDialog", handler);            // run once
    };
    Hooks.on("renderDialog", handler);

    dlg.render(true);

  });
});

Hooks.once("ready", async () => {
  const crews = game.actors?.filter?.(a => a.type === "crew") ?? [];
  for (const a of crews) {
    const sys = a.system ?? {};
    const up  = {};
    let needs = false;

    // currency.lux (don’t overwrite if it exists and is a number)
    const lux = Number(sys?.currency?.lux);
    if (!sys.currency || typeof sys.currency !== "object") {
      up["system.currency"] = { lux: Number.isFinite(lux) ? lux : 0 };
      needs = true;
    } else if (!Number.isFinite(lux)) {
      up["system.currency.lux"] = 0;
      needs = true;
    }

    // gambits bucket (don’t clobber)
    const g = sys.gambits;
    if (!g || typeof g !== "object") {
      up["system.gambits"] = { deck: [], drawn: [], discard: [], handSize: 3, deckSize: 10 };
      needs = true;
    } else {
      // only repair missing numbers; do not recompute handSize here (sheet handles tier logic)
      if (!Array.isArray(g.deck))    up["system.gambits.deck"]    = [];
      if (!Array.isArray(g.drawn))   up["system.gambits.drawn"]   = [];
      if (!Array.isArray(g.discard)) up["system.gambits.discard"] = [];
      if (!Number.isFinite(Number(g.handSize))) up["system.gambits.handSize"] = 3;
      if (!Number.isFinite(Number(g.deckSize))) up["system.gambits.deckSize"] = 10;
      needs ||= Object.keys(up).some(k => k.startsWith("system.gambits"));
    }

    if (needs) {
      try { await a.update(up, { render: false }); } catch (e) {
        console.warn("MG crew migrate failed:", a, e);
      }
    }
  }
});

Hooks.once("ready", async () => {
  try {
    const mode = game.settings.get("midnight-gambit", "initiativeViewMode");
    if (mode === "sidebar" || mode === "both") {
      await MGInitiativeSidebar.instance.mount();
      game.mgInitiativeSidebar = MGInitiativeSidebar.instance;
    } else {
      await MGInitiativeSidebar.instance.unmount();
    }
  } catch (e) {
    console.error("MG | initiative sidebar initial apply failed:", e);
  }
});

Hooks.on("updateActor", async (crew, data) => {
  if (crew.type !== "crew") return;
  if (!("name" in data)) return;

  const crewId = crew.id;
  const newName = crew.name;

  // Find all characters that reference this crew
  const chars = game.actors?.filter(a => a.type === "character" && a.system?.crewId === crewId) || [];
  for (const a of chars) {
    try { await a.update({ "system.crewName": newName }, { render: false }); }
    catch (e) { console.warn("MG | crew rename propagate failed for", a, e); }
  }
});

// Combat Tracker sidebar button: GM opens/closes MG Initiative for everyone
Hooks.on("renderCombatTracker", (app, html) => {
  // Only GM should broadcast open/close
  if (!game.user.isGM) return;

  const $app = html.closest(".app");
  if (!$app.length) return;

  // Prevent duplicates on rerender
  if ($app.find(".mg-open-initiative").length) return;

  const btn = $(`
    <a class="header-button mg-open-initiative" title="Toggle MG Initiative">
      <i class="fa-solid fa-swords"></i> MG Initiative
    </a>
  `);

  btn.on("click", async (ev) => {
    ev.preventDefault();

    if (!game.mgInitiative) {
      ui.notifications?.error("Initiative UI failed to load (game.mgInitiative missing).");
      return;
    }

    // If it's already present, close it. Otherwise open it.
    const isOpen = !!document.querySelector(".mg-ini-root");
    if (isOpen) await game.mgInitiative.hideBar();
    else await game.mgInitiative.showBar();
  });

  // Stick it into the window header buttons area
  const headerButtons = $app.find(".window-header .window-title");
  headerButtons.after(btn);
});

// --- Hide Foundry's Combat Tracker sidebar tab (data-tab="combat") ---
Hooks.once("ready", () => {
  const removeCombatTab = () => {
    // Remove the tab button
    const tabBtn = document.querySelector('#sidebar-tabs [data-tab="combat"]');
    tabBtn?.remove();

    // Remove the actual tab panel/app if it exists
    // (Foundry typically uses #combat for the Combat Tracker sidebar app)
    const combatApp = document.getElementById("combat");
    combatApp?.remove();
  };

  // Run once now
  removeCombatTab();

  // Run again whenever sidebar tabs re-render
  Hooks.on("renderSidebarTab", () => removeCombatTab());
});

/* MG: Prevent TinyMCE from auto-owning focus on sheets
----------------------------------------------------------------------*/
Hooks.on("renderApplication", (app, html) => {
  const root = html instanceof jQuery ? html[0] : html;
  const appEl = root?.closest?.(".window-app");
  if (!appEl) return;

  // Only Midnight Gambit sheets, not dialogs.
  const isMgSheet =
    appEl.classList.contains("midnight-gambit") &&
    appEl.classList.contains("sheet");

  if (!isMgSheet) return;

  // Do NOT affect dialogs/edit modals where immediate typing may be wanted.
  if (appEl.classList.contains("dialog")) return;

  const clearTinyFocus = () => {
    try {
      const active = window.tinymce?.activeEditor;
      const target = active?.targetElm || active?.getElement?.();

      // Only clear TinyMCE focus if the active editor belongs to THIS sheet.
      if (target && !appEl.contains(target)) return;

      active?.blur?.();
      active?.getWin?.()?.blur?.();
      active?.getBody?.()?.blur?.();

      const focused = document.activeElement;
      if (focused?.closest?.(".tox-tinymce")) focused.blur();

      appEl.setAttribute("tabindex", "-1");
      appEl.focus({ preventScroll: true });
    } catch (err) {
      console.warn("MG | TinyMCE sheet focus clear failed:", err);
    }
  };

  requestAnimationFrame(clearTinyFocus);
  setTimeout(clearTinyFocus, 50);
  setTimeout(clearTinyFocus, 150);
});

// ----------------------------------------------------
// MG: Prevent TinyMCE from auto-owning focus on sheets
// Keeps rich editors mounted, but moves focus back to the sheet window.
// Does NOT run on dialogs.
// ----------------------------------------------------
function mgClearTinyMceSheetFocus(app, html) {
  const root = html instanceof jQuery ? html[0] : html;
  const appEl = root?.closest?.(".window-app");
  if (!appEl) return;

  if (!appEl.classList.contains("midnight-gambit")) return;
  if (!appEl.classList.contains("sheet")) return;
  if (appEl.classList.contains("dialog")) return;

  const clearTinyFocus = () => {
    try {
      const active = window.tinymce?.activeEditor;
      const target = active?.targetElm || active?.getElement?.();

      // Only clear focus if the active TinyMCE editor belongs to this sheet.
      if (target && !appEl.contains(target)) return;

      active?.blur?.();
      active?.getWin?.()?.blur?.();
      active?.getBody?.()?.blur?.();

      const focused = document.activeElement;
      if (focused?.closest?.(".tox-tinymce")) focused.blur();

      appEl.setAttribute("tabindex", "-1");
      appEl.focus({ preventScroll: true });
    } catch (err) {
      console.warn("MG | TinyMCE sheet focus clear failed:", err);
    }
  };

  requestAnimationFrame(clearTinyFocus);
  setTimeout(clearTinyFocus, 50);
  setTimeout(clearTinyFocus, 150);
}

// Actor sheets: Character, NPC, Crew
Hooks.on("renderActorSheet", mgClearTinyMceSheetFocus);

// Item sheets: Weapon, Armor, Misc, Gambit, Asset, Move, Guise
Hooks.on("renderItemSheet", mgClearTinyMceSheetFocus);

/* Force Chat to Start at Bottom (refresh-safe)
----------------------------------------------------------------------*/
let mgDidInitialChatScroll = false;

Hooks.on("renderChatLog", (app, html) => {
  // Only force on the first render after a refresh/reload.
  if (mgDidInitialChatScroll) return;
  mgDidInitialChatScroll = true;

  const doScroll = () => {
    try {
      // Prefer Foundry's method if present
      if (typeof app.scrollBottom === "function") app.scrollBottom();
      else if (ui?.chat && typeof ui.chat.scrollBottom === "function") ui.chat.scrollBottom();
      else {
        // Hard fallback
        const log = html.find("#chat-log")[0];
        if (log) log.scrollTop = log.scrollHeight;
      }
    } catch (e) {
      console.warn("Midnight Gambit | Failed to scroll chat to bottom:", e);
    }
  };

  // Do it now, then again next tick to beat late layout/CSS changes.
  doScroll();
  requestAnimationFrame(doScroll);
});

Hooks.on("renderChatMessage", (_message, html) => {
  const log = document.querySelector("#chat-log");
  if (!log) return;

  const distanceFromBottom = log.scrollHeight - (log.scrollTop + log.clientHeight);

  // If user is basically at the bottom, keep them pinned
  if (distanceFromBottom < 40) {
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  }
});

Hooks.on("createChatMessage", () => {
  if (!document.body?.classList?.contains("mg-right-sidebar-collapsed")) return;

  const button = document.querySelector('[data-mg-collapse-sidebar="right"]');
  button?.classList?.add("has-chat-notice");
});

// --- Restricted MG cards: right-click to reveal to everyone ---
Hooks.on("renderChatMessage", (message, html) => {
  const root = html[0];
  if (!root) return;

  if (!mgIsRestrictedMessage(message)) return;
  if (!mgCanViewerSeeRoll(message)) return;
  if (!mgCanRevealToEveryone(message)) return;

  const card = root.querySelector(
    ".mg-chat-card, .mg-risk-result, .sto-upgrade"
  );
  if (!card) return;

  // Mark it so CSS / debugging can tell it's restricted
  card.classList.add("is-restricted-roll");

  // Optional tooltip hint
  card.setAttribute("title", "Right-click to reveal to everyone");

  card.addEventListener("contextmenu", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await mgPromptRevealToEveryone(message);
  });
});

// --- Apply privacy badge + target line to ANY visible restricted MG roll ---
Hooks.on("renderChatMessage", (message, html) => {
  const root = html[0];
  if (!root) return;

  if (!mgIsRestrictedMessage(message)) return;
  if (!mgCanViewerSeeRoll(message)) return;

  const mgCards = root.querySelectorAll(".mg-chat-card");
  if (!mgCards.length) return;

  for (const card of mgCards) {
    card.classList.add("is-restricted-roll");

    // 1) Ensure the tiny privacy icon exists on ANY restricted MG roll
    const labelWrap = card.querySelector(".mg-roll-label-wrap");
    if (labelWrap && !labelWrap.querySelector(".mg-roll-privacy-badge")) {
      labelWrap.insertAdjacentHTML("beforeend", mgRestrictedBadgeHtml(message));
    }

    // 2) Ensure the "To: Gamemaster" / target line exists on ANY restricted MG roll
    const header = card.querySelector(".mg-roll-header");
    if (header && !card.querySelector(".mg-roll-private-meta")) {
      header.insertAdjacentHTML("afterend", mgRestrictedMetaHtml(message));
    }
  }
});

/* MG Initiative Sidebar Button (works in Electron + Web)
----------------------------------------------------------------------*/
function mgEnsureInitiativeSidebarButton() {
  const tabs = document.querySelector("#sidebar-tabs");
  if (!tabs) return;

  // Already installed?
  if (tabs.querySelector('[data-tab="mg-initiative"]')) return;

  // Create a new sidebar tab button
  const btn = document.createElement("a");
  btn.classList.add("item");
  btn.dataset.tab = "mg-initiative";
  btn.title = "Initiative";

  // Use any FA icon you like
  btn.innerHTML = `<i class="fa-solid fa-swords"></i>`;

  // Insert near the combat tab if it exists, otherwise append
  const combat = tabs.querySelector('[data-tab="combat"]');
  if (combat?.parentNode) combat.parentNode.insertBefore(btn, combat.nextSibling);
  else tabs.appendChild(btn);

  // Click => open/toggle your MG bar
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    // If you want "toggle", you can check visibility here.
    game.mgInitiative?.showBar?.();
  });
}

// Run after UI is ready, and re-run on renders that rebuild the sidebar.
Hooks.once("ready", () => {
  mgEnsureInitiativeSidebarButton();
});

// Sidebar gets rebuilt a lot; keep it alive.
Hooks.on("renderSidebar", () => mgEnsureInitiativeSidebarButton());
Hooks.on("renderSidebarTab", () => mgEnsureInitiativeSidebarButton());

Hooks.once("ready", async () => {
  try {
    // Force the sidebar to exist on every client, every load.
    await MGInitiativeSidebar.instance.mount();
    game.mgInitiativeSidebar = MGInitiativeSidebar.instance;
  } catch (e) {
    console.error("MG | initiative sidebar mount failed:", e);
  }
});

// ---------------------------------------------------------------------------
// Strain + Capacity UI Sync (multiplayer, no full sheet re-render required)
// ---------------------------------------------------------------------------
Hooks.on("updateActor", (actor, diff) => {
  const strainDiff = diff?.system?.strain;
  if (!strainDiff) return;

  // Determine what changed (supports keys with spaces like "mortal capacity")
  const changedKeys = Object.keys(strainDiff);
  if (!changedKeys.length) return;

  // Open apps for this actor (anyone viewing the sheet)
  const apps = Object.values(actor.apps || {});
  if (!apps.length) return;

  // Helper to update a single sheet DOM
  const patchSheet = ($root) => {
    // 1) Current strain dots (mortal/soul)
    for (const type of ["mortal", "soul"]) {
      // Only patch if that specific field changed OR if any strain field changed (cheap + safe)
      if (!changedKeys.includes(type) && !changedKeys.includes("mortal") && !changedKeys.includes("soul")) {
        // don't early return; capacities might have changed
      }

      const newValue = Number(foundry.utils.getProperty(actor.system.strain, type) ?? 0);

      const $track = $root.find(`.strain-track[data-strain="${type}"]`);
      if ($track.length) {
        $track.find(".strain-dot").each((_, node) => {
          const v = Number(node.dataset.value);
          node.classList.toggle("filled", v <= newValue);
        });
      }
    }

    // 2) Capacity spans (these are the ones you showed)
    // Mortal Capacity
    if (changedKeys.includes("mortal capacity") || changedKeys.includes("soul capacity")) {
      const mortalCap = actor.system.strain?.["mortal capacity"];
      const soulCap   = actor.system.strain?.["soul capacity"];

      const $mortalCapSpan = $root.find(`.capacity-value[data-type="mortal"]`);
      if ($mortalCapSpan.length && typeof mortalCap !== "undefined") {
        $mortalCapSpan.text(mortalCap);
      }

      const $soulCapSpan = $root.find(`.capacity-value[data-type="soul"]`);
      if ($soulCapSpan.length && typeof soulCap !== "undefined") {
        $soulCapSpan.text(soulCap);
      }
    }
  };

  // Patch every rendered sheet for this actor on this client
  for (const app of apps) {
    const $root = app?.element;
    if (!$root?.length) continue;
    patchSheet($root);
  }
});

// --- Roll math: click to reveal dropped dice under the main bar ---
Hooks.on("renderChatMessage", (_message, html) => {
  const root = html[0];
  if (!root) return;

  const math = root.querySelector(".mg-roll-math");
  const panel = root.querySelector(".mg-roll-dropped-panel");
  if (!math || !panel) return;

  const dur = 300;

  const togglePanel = async () => {
    const isOpen = panel.classList.contains("is-open");

    if (isOpen) {
      panel.style.overflow = "hidden";
      panel.style.maxHeight = panel.scrollHeight + "px";
      panel.offsetHeight; // force reflow
      panel.style.transition = `max-height ${dur}ms ease`;
      panel.style.maxHeight = "0px";

      math.setAttribute("aria-expanded", "false");
      math.classList.remove("tray-open");

      await new Promise(r => setTimeout(r, dur));

      panel.classList.remove("is-open");
      panel.hidden = true;
      panel.style.transition = "";
      panel.style.maxHeight = "";
      panel.style.overflow = "";
      return;
    }

    panel.hidden = false;
    panel.style.overflow = "hidden";
    panel.style.maxHeight = "0px";
    panel.offsetHeight; // force reflow
    panel.style.transition = `max-height ${dur}ms ease`;
    panel.style.maxHeight = panel.scrollHeight + "px";

    math.setAttribute("aria-expanded", "true");
    panel.classList.add("is-open");
    math.classList.toggle("tray-open");
    math.classList.add("tray-open");

    await new Promise(r => setTimeout(r, dur));

    panel.style.transition = "";
    panel.style.maxHeight = "";
    panel.style.overflow = "";
  };

  math.addEventListener("click", (ev) => {
    // Don't toggle if the user clicked a button inside the bar
    if (ev.target.closest("button")) return;
    togglePanel().catch(console.error);
  });

  math.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    ev.preventDefault();
    togglePanel().catch(console.error);
  });
});

// Remove Aura cancel for basic players
Hooks.on("renderChatMessage", (_message, html) => {
  if (game.user.isGM) return;

  html.find(".mg-remove-aura").remove();
});

// ---------------------------------------------------------------------------
// Default to LINKED tokens for Midnight Gambit
// (prevents "scene token becomes a separate character instance")
// ---------------------------------------------------------------------------

// Ensure newly-created Actors default to a linked Prototype Token
Hooks.on("preCreateActor", (actor, data, options, userId) => {
  // Only set if not explicitly defined
  const pt = data.prototypeToken ?? {};
  if (typeof pt.actorLink === "undefined") {
    actor.updateSource({ prototypeToken: { ...pt, actorLink: true } });
  }
});

// Ensure newly-created Tokens default to linked actor data
Hooks.on("preCreateToken", (tokenDoc, data, options, userId) => {
  if (typeof data.actorLink === "undefined") {
    tokenDoc.updateSource({ actorLink: true });
  }
});
