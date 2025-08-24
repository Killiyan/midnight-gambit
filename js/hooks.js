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

/* Setting Player's Gambit Hand
==============================================================================================================================================*/

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
            <h2><i class="fa-solid fa-cards"></i> ${card.name}</h2>
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

/* MG Clock functions - renders for all but only GM can edit
==============================================================================================================================================*/

const MG_NS = "midnight-gambit";
const FLAG_TOTAL  = "clock.total";
const FLAG_FILLED = "clock.filled";

// --- Handle (queen) icon ---
function mgGetHandleUrl() {
  const sysId = game?.system?.id ?? "midnight-gambit";
  return `systems/${sysId}/assets/images/mg-queen.png`;
}

const MG_HANDLE_SIZE = 50;   // px (unscaled)
let   mgHandleScale  = 1;    // live scale factor for hover/drag

function mgClockGet() {
  const total  = Number(canvas.scene?.getFlag(MG_NS, FLAG_TOTAL));
  const filled = Number(canvas.scene?.getFlag(MG_NS, FLAG_FILLED));
  const t = Number.isFinite(total)  ? Math.max(1, Math.min(200, total))  : 8; // cap 200
  const f = Number.isFinite(filled) ? Math.max(0, Math.min(t, filled)) : 0;
  return { total: t, filled: f };
}

async function mgClockSetTotal(n) {
  if (!game.user.isGM || !canvas.scene) return;
  const t = Math.max(1, Math.min(200, Number(n) || 1));
  const { filled } = mgClockGet();
  const f = Math.min(filled, t);
  await canvas.scene.setFlag(MG_NS, FLAG_TOTAL, t);
  if (f !== filled) await canvas.scene.setFlag(MG_NS, FLAG_FILLED, f);
}

// NEW: set total AND filled = n in one go (overwrite)
async function mgClockResetTo(n) {
  if (!game.user.isGM || !canvas.scene) return;
  const t = Math.max(1, Math.min(200, Number(n) || 1));
  // Two setFlag calls are fine; Foundry will broadcast once per change
  await canvas.scene.setFlag(MG_NS, FLAG_TOTAL, t);
  await canvas.scene.setFlag(MG_NS, FLAG_FILLED, t);
}

async function mgClockSetFilled(n) {
  if (!game.user.isGM || !canvas.scene) return;
  const { total } = mgClockGet();
  const f = Math.max(0, Math.min(total, Number(n) || 0));
  await canvas.scene.setFlag(MG_NS, FLAG_FILLED, f);
}


/* Setting the Clock Dom
----------------------------------------------------------------------*/
function mgClockEnsureDOM() {
  let $wrap = $("#mg-clock");
  if ($wrap.length) return $wrap;

  $wrap = $(`
    <div id="mg-clock" class="mg-clock" style="position:fixed; top:12px; right:332px; z-index:50;">
      <div class="mg-clock-inner">
        <div class="mg-clock-grip" title="Drag to move"></div>
        <span class="mg-clock-badge"></span>
        <div class="mg-clock-visual">
          <svg class="mg-clock-svg" viewBox="0 0 120 120" width="120" height="120" aria-hidden="true" style="width:120px;height:120px;">
            <g class="segs"></g>
          </svg>
          <div class="mg-clock-center">
            <span class="mg-clock-count">0<span class="clock-small">/0</span></span>
          </div>
        </div>
        <div class="mg-clock-controls">
          <button type="button" class="mg-clock-dec" title="Decrease (Shift: -2)">−</button>
          <input type="number" class="mg-clock-total" min="1" max="100" step="1" title="Segments" inputmode="numeric" />
          <button type="button" class="mg-clock-inc" title="Increase (Shift: +2)">+</button>
        </div>
      </div>
    </div>
  `);
  

  document.body.appendChild($wrap[0]);

  // Apply saved/default position
  mgClockApplyPos($wrap);
  mgClockApplyCollapsed($wrap);

  // Keep it in-bounds on window resize
  window.addEventListener("resize", () => {
    const w = $("#mg-clock");
    if (w.length) mgClockApplyPos(w);
  }, { passive: true });

  return $wrap;
}

/* Clock Segment Creation
----------------------------------------------------------------------*/

function mgClockDrawSegments($wrap) {
  const cx = 60, cy = 60, r = 44;

  const { total, filled } = mgClockGet();
  const stroke = (total <= 32) ? 12 : (total <= 64) ? 10 : (total <= 96) ? 8 : 6;

  const svg = $wrap.find(".mg-clock-svg")[0];
  const segsG = $wrap.find(".segs")[0];
  while (segsG?.firstChild) segsG.removeChild(segsG.firstChild);

  const segSpan = 360 / total;                  // degrees per segment
  const gapDeg  = Math.min(6, segSpan * 0.25);  // <= 25% of segment, never more than 6°
  const arcSpan = Math.max(0, segSpan - gapDeg);
  // ... keep the rest of your function as-is

  const NS = "http://www.w3.org/2000/svg";

  // --- background track (faint full circle) ---
  const bg = document.createElementNS(NS, "circle");
  bg.setAttribute("cx", String(cx));
  bg.setAttribute("cy", String(cy));
  bg.setAttribute("r", String(r));
  bg.setAttribute("fill", "none");
  bg.setAttribute("stroke", "rgba(255,255,255,0.15)");
  bg.setAttribute("stroke-width", String(stroke));
  segsG.appendChild(bg);

  const toXY = (deg) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };

  for (let i = 0; i < total; i++) {
    const startDeg = -90 + i * segSpan + (gapDeg / 2);
    const endDeg   = startDeg + arcSpan;

    const [x1, y1] = toXY(startDeg);
    const [x2, y2] = toXY(endDeg);
    const largeArc = arcSpan > 180 ? 1 : 0;

    const d = `M ${x1.toFixed(3)} ${y1.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(3)} ${y2.toFixed(3)}`;

    const on = i < filled;
    const path = document.createElementNS(NS, "path");
    path.setAttribute("class", `seg ${on ? "on" : "off"}`);
    path.setAttribute("d", d);
    path.setAttribute("stroke-width", String(stroke));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("fill", "none");

    // Force a visible stroke color even if CSS is overridden
    path.setAttribute("stroke", on ? "hsl(200,90%,60%)" : "hsl(0,0%,35%)");
    if (!on) path.setAttribute("opacity", "0.6");

    // Click target index (GM toggling uses this)
    path.setAttribute("data-index", String(i));

    segsG.appendChild(path);
  }

  mgClockUpdateHandleToFilled();

  // center count & total selector
  // Show BIG number + small "/total"
  const major = filled;                // or: const major = Math.max(0, total - filled);
  const cnt = $wrap.find(".mg-clock-count")[0];
  if (cnt) {
    cnt.innerHTML = `<span class="clock-major">${major}</span><span class="clock-small">/${total}</span>`;
  }

  const totalInput = $wrap.find(".mg-clock-total")[0];
  if (totalInput) {
    totalInput.value = "";                           // keep empty after updates
    totalInput.setAttribute("placeholder", String(total)); // hint = current total
  }

  // Debug: how many segments did we draw?
  console.debug("MG Clock draw:", { total, filled, nodes: segsG.childNodes.length });

  // Badge text for minimized clock
  const badge = $wrap.find(".mg-clock-badge")[0];
  if (badge) {
    badge.innerHTML = `<span class="clock-major">${major}</span><span class="clock-small">/${total}</span>`;
  }
}

/* Rendering clock and making it readonly for users
----------------------------------------------------------------------*/

function mgClockRender() {
  const $wrap = mgClockEnsureDOM();
  mgClockDrawSegments($wrap);
  mgClockApplyCollapsed($wrap);

  const $controls = $wrap.find(".mg-clock-controls");

  if (game.user.isGM) {
    $wrap.removeClass("readonly");
    $controls.prop("disabled", false)
             .find("button, .mg-clock-total").prop("disabled", false);
    $controls.toggle(true).attr("aria-hidden", "false");
  } else {
    $wrap.addClass("readonly");
    $controls.prop("disabled", true)
             .find("button, .mg-clock-total").prop("disabled", true);
    $controls.toggle(false).attr("aria-hidden", "true");
  }

  mgClockBindHandlers(); // (re)bind
}

/* Creating a scrub element of the MG Logo
----------------------------------------------------------------------*/

// Convert a pointer event on the SVG into a segment index [0 .. total-1]
function mgClockIndexFromEvent(ev) {
  const svg = document.querySelector("#mg-clock .mg-clock-svg");
  if (!svg) return 0;
  const rect = svg.getBoundingClientRect();
  const x = ev.clientX - (rect.left + rect.width  / 2);
  const y = ev.clientY - (rect.top  + rect.height / 2);

  // atan2: 0° at +X, CCW; adjust so 0° at top, CW
  let deg = (Math.atan2(y, x) * 180 / Math.PI + 450) % 360;
  const { total } = mgClockGet();
  const segSpan = 360 / total;
  let idx = Math.floor(deg / segSpan);
  return Math.max(0, Math.min(total - 1, idx));
}

// Angle (degrees) at the END of the given segment index (i), respecting gaps
function mgClockEndAngleForIndex(i, total) {
  const segSpan = 360 / total;
  const gapDeg  = Math.min(6, segSpan * 0.25);
  const arcSpan = Math.max(0, segSpan - gapDeg);
  const startDeg = -90 + i * segSpan + (gapDeg / 2);
  return startDeg + arcSpan; // end of painted arc
}

// Place/scale the handle group at a polar angle on the ring
function mgClockPlaceHandle(svg, angleDeg) {
  const cx = 60, cy = 60, r = 44;
  const rad = angleDeg * Math.PI / 180;
  const x = cx + r * Math.cos(rad);
  const y = cy + r * Math.sin(rad);

  let g = svg.querySelector("g.mg-handle");
  if (!g) {
    const NS = "http://www.w3.org/2000/svg";
    g = document.createElementNS(NS, "g");
    g.setAttribute("class", "mg-handle");

    const img = document.createElementNS(NS, "image");
    img.setAttribute("class", "mg-handle-img");

    const url = mgGetHandleUrl();
    img.setAttribute("href", url);
    img.setAttributeNS("http://www.w3.org/1999/xlink", "href", url);

    img.setAttribute("width", String(MG_HANDLE_SIZE));
    img.setAttribute("height", String(MG_HANDLE_SIZE));
    img.setAttribute("preserveAspectRatio", "xMidYMid meet");

    g.appendChild(img);
    svg.appendChild(g);
  } else {
    const img = g.querySelector("image.mg-handle-img");
    if (img) {
      const url = mgGetHandleUrl();
      img.setAttribute("href", url);
      img.setAttributeNS("http://www.w3.org/1999/xlink", "href", url);
    }
  }

  const s  = mgHandleScale;
  const tx = x - (MG_HANDLE_SIZE * s) / 2;
  const ty = y - (MG_HANDLE_SIZE * s) / 2;
  g.setAttribute("transform", `translate(${tx},${ty}) scale(${s})`);

  // keep handle on top
  svg.appendChild(g);
}



// Convenience: move to current filled end
function mgClockUpdateHandleToFilled() {
  const $wrap = $("#mg-clock");
  const svg = $wrap.find(".mg-clock-svg")[0];
  if (!svg) return;
  const { total, filled } = mgClockGet();
  const idx = Math.max(0, Math.min(total - 1, Math.max(0, filled) - 1));
  const angle = (filled > 0) ? mgClockEndAngleForIndex(idx, total) : -90; // top when 0
  mgClockPlaceHandle(svg, angle);
}

// During drag: snap handle to a given index immediately (no round-trip)
function mgClockMoveHandleToIndex(idx) {
  const $wrap = $("#mg-clock");
  const svg = $wrap.find(".mg-clock-svg")[0];
  if (!svg) return;
  const { total } = mgClockGet();
  idx = Math.max(0, Math.min(total - 1, idx));
  const angle = mgClockEndAngleForIndex(idx, total);
  mgClockPlaceHandle(svg, angle);
}

/* Click rules for the input and toggles, also adding a scrub element at the end of the stroke
----------------------------------------------------------------------*/

function mgClockBindHandlers() {
  const $wrap = $("#mg-clock");
  if (!$wrap.length) return;
  $wrap.off(".mgclock"); // avoid duplicate bindings

  // GM-only: Increase and Decrease clock
  $wrap.on("click.mgclock", ".mg-clock-inc", async (ev) => {
    if (!game.user.isGM) return;
    const step = ev.shiftKey ? 2 : 1;
    const { filled } = mgClockGet();
    await mgClockSetFilled(filled + step);
  });

  $wrap.on("click.mgclock", ".mg-clock-dec", async (ev) => {
    if (!game.user.isGM) return;
    const step = ev.shiftKey ? 2 : 1;
    const { filled } = mgClockGet();
    await mgClockSetFilled(filled - step);
  });

  // Apply whatever's in the input, even if it's the same value, then clear the input after
  async function applyClockFromInput(inputEl) {
    const raw = Number(inputEl.value);
    if (!Number.isFinite(raw)) return;
    // total = filled = raw (overwrite)
    await mgClockResetTo(raw);
    // pull the clamped value
    const { total } = mgClockGet();
    // clear after apply
    inputEl.value = "";
    inputEl.setAttribute("placeholder", String(total)); // show current total hint
  }

  // GM-only: typing a number then blurring applies N/N
  $wrap.on("change.mgclock", ".mg-clock-total", async (ev) => {
    if (!game.user.isGM) return;
    await applyClockFromInput(ev.currentTarget);
  });

  // GM-only: pressing Enter applies N/N (even if value didn't change)
  $wrap.on("keydown.mgclock", ".mg-clock-total", async (ev) => {
    if (!game.user.isGM) return;
    if (ev.key === "Enter") {
      ev.preventDefault();
      await applyClockFromInput(ev.currentTarget);
      ev.currentTarget.blur();
    }
  });

  // Remove Mouse wheel's ability to change the input
  $wrap.on("wheel.mgclock", ".mg-clock-total", (ev) => {
    if (!game.user.isGM) return;
    ev.currentTarget.blur();
  });

  // GM-only: click segment to set directly
  $wrap.on("click.mgclock", "path.seg", async (ev) => {
    if (!game.user.isGM) return;
    const idx = Number(ev.currentTarget.getAttribute("data-index"));
    const { filled } = mgClockGet();
    // Toggle last filled; otherwise set to clicked index+1
    const next = (idx + 1 === filled) ? idx : (idx + 1);
    await mgClockSetFilled(next);
  });

  /* Draggable Scrub for DM
  ----------------------------------------------------------------------*/

  let dragActive = false;
  let lastDragIdx = null;

  // Start drag anywhere inside the visual (SVG, paths, center overlay, knob, etc.)
  $wrap.on("pointerdown.mgclock", ".mg-clock-visual, .mg-clock-visual *", async (ev) => {
    if (!game.user.isGM) return;
    ev.preventDefault();
    dragActive = true;
    lastDragIdx = null;
    mgHandleScale = 1.18;                  // scale up on engage
    mgClockUpdateHandleToFilled();

    const captureEl = $wrap.find(".mg-clock-visual")[0] || $wrap.find(".mg-clock-svg")[0];
    try { captureEl?.setPointerCapture?.(ev.pointerId); } catch (_) {}

    const idx = mgClockIndexFromEvent(ev);
    lastDragIdx = idx;
    mgClockMoveHandleToIndex(idx);         // local immediate feedback
    await mgClockSetFilled(idx + 1);       // sync flag
  });

  // Scrub while dragging
  $wrap.on("pointermove.mgclock", ".mg-clock-visual, .mg-clock-visual *", async (ev) => {
    if (!game.user.isGM || !dragActive) return;
    const idx = mgClockIndexFromEvent(ev);
    if (idx !== lastDragIdx) {
      lastDragIdx = idx;
      mgClockMoveHandleToIndex(idx);       // local move
      await mgClockSetFilled(idx + 1);     // sync
    }
  });

  // End drag
  $wrap.on("pointerup.mgclock pointercancel.mgclock", ".mg-clock-visual, .mg-clock-visual *", (ev) => {
    if (!dragActive) return;
    dragActive = false;
    mgHandleScale = 1.0;                   // scale back
    mgClockUpdateHandleToFilled();
    const captureEl = $wrap.find(".mg-clock-visual")[0] || $wrap.find(".mg-clock-svg")[0];
    try { captureEl?.releasePointerCapture?.(ev.pointerId); } catch (_) {}
  });

  // Subtle hover scale (use pointerover/out because they bubble)
  $wrap.on("pointerover.mgclock", ".mg-clock-visual, .mg-clock-visual *", () => {
    if (!game.user.isGM || dragActive) return;
    mgHandleScale = 1.08; 
    mgClockUpdateHandleToFilled();
  });

  $wrap.on("pointerout.mgclock", ".mg-clock-visual, .mg-clock-visual *", () => {
    if (!game.user.isGM || dragActive) return;
    mgHandleScale = 1.0; 
    mgClockUpdateHandleToFilled();
  });

  /* Drag handlers for players to move UI element
  ----------------------------------------------------------------------*/
  let moving = false;
  let moveOffset = { dx: 0, dy: 0 };

  $wrap.on("pointerdown.mgclock", ".mg-clock-grip", (ev) => {
    ev.preventDefault();
    const el = $wrap[0];
    const rect = el.getBoundingClientRect();
    moving = true;
    moveOffset.dx = ev.clientX - rect.left;
    moveOffset.dy = ev.clientY - rect.top;
    try { ev.currentTarget.setPointerCapture?.(ev.pointerId); } catch (_) {}
    // visual feedback
    $wrap.addClass("mg-dragging");
  });

  $wrap.on("pointermove.mgclock", ".mg-clock-grip", (ev) => {
    if (!moving) return;
    const el = $wrap[0];
    const w = el.offsetWidth, h = el.offsetHeight;
    let nx = ev.clientX - moveOffset.dx;
    let ny = ev.clientY - moveOffset.dy;
    nx = Math.max(0, Math.min(window.innerWidth  - w, nx));
    ny = Math.max(0, Math.min(window.innerHeight - h, ny));
    el.style.left = `${nx}px`;
    el.style.top  = `${ny}px`;
    el.style.right = "";
  });

  $wrap.on("pointerup.mgclock pointercancel.mgclock", ".mg-clock-grip", async (ev) => {
    if (!moving) return;
    moving = false;
    try { ev.currentTarget.releasePointerCapture?.(ev.pointerId); } catch (_) {}
    $wrap.removeClass("mg-dragging");

    const rect = $wrap[0].getBoundingClientRect();
    await mgClockSavePos(rect.left, rect.top);
  });

  // Double-click the bar to minimize/restore (per user)
  $wrap.on("dblclick.mgclock", ".mg-clock-inner", async (ev) => {
    ev.preventDefault();
    const nowCollapsed = !mgClockLoadCollapsed();
    $wrap.toggleClass("mg-collapsed", nowCollapsed);
    await mgClockSaveCollapsed(nowCollapsed);
    mgClockApplyCollapsed($wrap); // refresh title/badge
  });
}

/* Editable UI element for the Clock
----------------------------------------------------------------------*/
// Per-user position for the clock UI
const FLAG_POS = "clock.uiPos"; // user flag: {x,y}

function mgClockLoadPos() {
  const p = game.user?.getFlag?.("midnight-gambit", FLAG_POS);
  return (p && Number.isFinite(p.x) && Number.isFinite(p.y)) ? p : null;
}

async function mgClockSavePos(x, y) {
  if (!game.user) return;
  const nx = Math.round(Math.max(0, Math.min(window.innerWidth  - 50, x))); // 50px guard
  const ny = Math.round(Math.max(0, Math.min(window.innerHeight - 50, y)));
  await game.user.setFlag("midnight-gambit", FLAG_POS, { x: nx, y: ny });
}

function mgClockApplyPos($wrap) {
  const el = $wrap[0];
  // Measure size first
  const w = el.offsetWidth  || 180;
  const h = el.offsetHeight || 140;

  let left, top;
  const saved = mgClockLoadPos();
  if (saved) {
    left = saved.x; top = saved.y;
  } else {
    // default: top-right 16px, but convert to left/top
    left = Math.max(0, window.innerWidth - w - 16);
    top  = 12;
  }

  // Clamp to viewport
  left = Math.max(0, Math.min(window.innerWidth  - w, left));
  top  = Math.max(0, Math.min(window.innerHeight - h, top));

  // Apply (clear 'right' to avoid conflicts)
  el.style.position = "fixed";
  el.style.left = `${left}px`;
  el.style.top  = `${top}px`;
  el.style.right = "";
}

/* Collapse support like Foundry Default
----------------------------------------------------------------------*/
const FLAG_UI_COLLAPSED = "clock.uiCollapsed";

function mgClockLoadCollapsed() {
  return !!game.user?.getFlag?.("midnight-gambit", FLAG_UI_COLLAPSED);
}
async function mgClockSaveCollapsed(v) {
  if (!game.user) return;
  await game.user.setFlag("midnight-gambit", FLAG_UI_COLLAPSED, !!v);
}
function mgClockApplyCollapsed($wrap) {
  const collapsed = mgClockLoadCollapsed();
  $wrap.toggleClass("mg-collapsed", collapsed);

  // Optional: tooltip with current count when collapsed
  const { total, filled } = mgClockGet();
  $wrap.attr("title", collapsed ? `Clock ${filled}/${total} — double-click to restore` : "");
}


/* Attaching clock to the scene and saving position
----------------------------------------------------------------------*/
// Initial mount
Hooks.on("ready", () => {
  mgClockRender();
});

// Re-render on scene ready (scene switch)
Hooks.on("canvasReady", () => {
  mgClockRender();
});

// Live updates for everyone when flags change
Hooks.on("updateScene", (scene, data) => {
  if (scene.id !== canvas.scene?.id) return;
  const pathBase = `flags.${MG_NS}.clock`;
  const changed =
    foundry.utils.hasProperty(data, `${pathBase}.total`) ||
    foundry.utils.hasProperty(data, `${pathBase}.filled`);
  if (!changed) return;

  // Update current DOM (no rebind necessary)
  const $wrap = mgClockEnsureDOM();
  mgClockDrawSegments($wrap);
});



