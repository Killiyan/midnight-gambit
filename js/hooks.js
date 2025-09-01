import { MGInitiativeBar } from "./initiative-bar.js";


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

  // MG: hide the core Combat/Initiative UI (sidebar + token controls)
  game.settings.register("midnight-gambit", "hideCoreCombat", {
    scope: "world",
    config: true,
    name: "Midnight Gambit — Hide Core Combat (Initiative)",
    hint: "Hides the Foundry combat sidebar and token combat controls, so only the MG Initiative Bar is used.",
    type: Boolean,
    default: true
  });

  // Handlebars helpers used by initiative-bar.html
  Handlebars.registerHelper("eq", (a, b) => a === b);

  // Active crew UUID driving the initiative bar (world-scoped)
  game.settings.register("midnight-gambit", "activeCrewUuid", {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  // === INITIATIVE TOOL (Application instance; renders initiative-bar.html) ===
  Hooks.on("getSceneControlButtons", (controls) => {
    const tokenCtl = controls.find(c => c.name === "token");
    if (!tokenCtl) return;

    // remove any dupes
    tokenCtl.tools = tokenCtl.tools.filter(t => t.name !== "mg-initiative");

    tokenCtl.tools.push({
      name: "mg-initiative",
      title: "Midnight Gambit: Initiative",
      icon: "fa-solid fa-users-between-lines",
      toggle: true,
      // Foundry Application instances expose .rendered when open
      active: !!MGInitiativeBar?.rendered,
      onClick: (toggled) => {
        if (toggled) {
          // OPEN the Foundry window (uses templates/initiative-bar.html)
          MGInitiativeBar.render(true);
        } else {
          // CLOSE it
          MGInitiativeBar.close();
        }
        // keep the toolbar toggle honest even if user hits [x]
        setTimeout(() => ui.controls?.initialize(), 0);
      }
    });

    // Optional: if you hide core combat, strip default combat tools
    if (game.settings.get("midnight-gambit", "hideCoreCombat")) {
      tokenCtl.tools = tokenCtl.tools.filter(t => !["combat", "toggleCombat"].includes(t.name));
    }
  });



  // --- Crew Sheet registration ---
  Actors.registerSheet("midnight-gambit", MidnightGambitCrewSheet, {
    types: ["crew"],
    makeDefault: true
  });
});

// Hide the Combat tab button and panel in the sidebar
Hooks.on("renderSidebar", (app, html) => {
  if (!game.settings.get("midnight-gambit", "hideCoreCombat")) return;
  // Hide the tab button
  html.find('.sidebar-tabs .item[data-tab="combat"]').hide();
  // Hide the panel itself if someone tries to route to it
  html.find('.tab[data-tab="combat"]').hide();
});

Hooks.on("renderSidebarTab", (app, html) => {
  if (!game.settings.get("midnight-gambit", "hideCoreCombat")) return;
  // If somehow the Combat tab renders, immediately redirect to Actors (or whatever you prefer)
  if (app?.id === "combat") ui.sidebar.activateTab("actors");
});

Hooks.on("renderTokenHUD", (hud, html) => {
  if (!game.settings.get("midnight-gambit", "hideCoreCombat")) return;
  // Remove any combat-related HUD icons
  html.find('.control-icon[data-action="combat"]').remove();       // add/remove from combat
  html.find('.control-icon[data-action="combatCycle"]').remove();  // next/prev turn if present
});

Hooks.once("ready", () => {
  const hide = game.settings.get("midnight-gambit", "hideCoreCombat");
  document.body.toggleAttribute("data-hide-core-combat", hide);
});

// keep it in sync if someone flips the setting at runtime
Hooks.on("closeSettingsConfig", () => {
  const hide = game.settings.get("midnight-gambit", "hideCoreCombat");
  document.body.toggleAttribute("data-hide-core-combat", hide);
});


/* MG Clock functions - renders for all but only GM can edit
==============================================================================================================================================*/

const MG_NS = "midnight-gambit";
const MG_CLOCK_SFX = "systems/midnight-gambit/assets/sounds/gambit-clock.ogg";
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
const UFLAG_UI    = "clockUi";

// Small id helper
function mgNewId() {
  return (foundry?.utils?.randomID?.(8)) ?? Math.random().toString(36).slice(2, 10);
}

// Get the full clocks map
function mgClocksGetAll() {
  return canvas.scene?.getFlag(MG_NS, FLAG_CLOCKS) ?? {};
}

// Get ONE clock (safe defaults)
function mgClockGetById(id) {
  const c = (mgClocksGetAll())[id] ?? {};
  const total  = Number.isFinite(+c.total)  ? Math.max(1, Math.min(200, +c.total)) : 8;
  const filled = Number.isFinite(+c.filled) ? Math.max(0, Math.min(total, +c.filled)) : 0;
  const name   = (c.name ?? "").toString();
  const gmOnly = !!c.gmOnly; // NEW
  return { id, name, total, filled, gmOnly };
}

// Scene flag updaters
async function mgClockSetById(id, patch) {
  if (!game.user.isGM || !canvas.scene) return;
  const key = `${FLAG_CLOCKS}.${id}`;
  const curr = mgClockGetById(id);
  await canvas.scene.setFlag(MG_NS, key, { ...curr, ...patch });
}

async function mgClockResetToById(id, n) {
  if (!game.user.isGM || !canvas.scene) return;
  n = Math.max(1, Math.min(200, Number(n) || 1));
  const key = `${FLAG_CLOCKS}.${id}`;
  const curr = mgClockGetById(id);
  await canvas.scene.setFlag(MG_NS, key, { ...curr, total: n, filled: 0 });
}

async function mgClockDeleteById(id) {
  if (!game.user.isGM || !canvas.scene) return;
  await canvas.scene.unsetFlag(MG_NS, `${FLAG_CLOCKS}.${id}`);
}

// Create a new clock (returns id)
async function mgClockCreate(initial = {}) {
  if (!game.user.isGM || !canvas.scene) return null;
  const id = mgNewId();
  const def = { name: "Clock", total: 8, filled: 0, gmOnly: false, ...initial };
  await canvas.scene.setFlag(MG_NS, `${FLAG_CLOCKS}.${id}`, def);
  return id;
}

/* Local updater to support Scrub
----------------------------------------------------------------------*/
function mgLocalSetFilled($wrap, id, n /* filled */) {
  const { total } = mgClockGetById(id);

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
        <span class="title"><i class="fa-solid fa-clock"></i> <span class="mg-clock-name">${title}</span></span>
        <p>ticks down…</p>
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
  const { total, filled } = mgClockGetById(id);
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
  const { total, filled } = mgClockGetById(id);
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
      const c = mgClockGetById(id) || {};
      const broadcast = !c.gmOnly; // Public → everyone hears; GM-only → just GM
      AudioHelper.play(
        { src: MG_CLOCK_SFX, volume: 0.8, autoplay: true, loop: false },
        broadcast
      );
    }
  }
}

/* Segment Smoother
----------------------------------------------------------------------*/
function mgUpdateRings($wrap, id) {
  const { total, filled } = mgClockGetById(id);
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
  mgUpdateGlowArc($wrap, id);


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

// Apply saved/default position to a clock wrapper
function mgApplyPos($wrap) {
  const id = $wrap.data("clockId");
  const ui = mgUiLoad(id) ?? {};
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
    const cx  = Math.max(pad, (window.innerWidth  - w) / 2);
    const cy  = Math.max(pad, (window.innerHeight - h) / 2);

    const others = Array.from(document.querySelectorAll(".mg-clock")).filter(e => e !== el);
    const n = others.length;                 // how many already present in DOM
    const offset = Math.min(n * 24, 96);     // stagger 24px per clock

    left = Math.min(window.innerWidth  - w - pad, cx + offset);
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
  const ui = mgUiLoad(id) ?? {};
  const collapsed = !!ui.collapsed;
  $wrap.toggleClass("mg-collapsed", collapsed);

  const { total, filled } = mgClockGetById(id);
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
function mgEnsureClockDOM(id) {
  let $wrap = $(`#mg-clock-${id}`);
  if ($wrap.length) return $wrap;

  $wrap = $(`
    <div id="mg-clock-${id}" class="mg-clock" data-clock-id="${id}">
      <div class="mg-clock-inner">
        <div class="mg-clock-grip" title="Drag to move, Double click to collapse/expand"></div>

        <input type="text" class="mg-clock-name" maxlength="60"
               placeholder="Clock" title="Clock name (GM only)" />

        <span class="mg-clock-badge"></span>

        <div class="mg-clock-visual">
          <svg class="mg-clock-svg" viewBox="0 0 120 120" width="120" height="120" aria-hidden="true" style="width:120px;height:120px;">
            <g class="segs"></g>
          </svg>
          <div class="mg-clock-center">
            <span class="mg-clock-count"></span>
          </div>
        </div>

        <div class="mg-clock-controls">
          <div class="main-controls">
            <button type="button" class="mg-clock-dec"  title="Decrease (Shift: -2)">−</button>
            <input  type="number" class="mg-clock-total" min="1" max="200" step="1" title="Segments" inputmode="numeric" />
            <button type="button" class="mg-clock-inc"  title="Increase (Shift: +2)">+</button>
          </div>
          <div class="add-remove">
            <button type="button" class="mg-clock-vis" title="Public — click to hide from Players" data-tooltip="Toggle Visibility">
              <i class="fa-solid fa-eye"></i>
            </button>
            <button type="button" class="mg-clock-close" title="Remove Clock" data-tooltip="Remove Clock"><i class="fa-solid fa-trash"></i></button>
          </div>

        </div>
      </div>
    </div>
  `);

  document.body.appendChild($wrap[0]);
  mgApplyPos($wrap);
  mgApplyCollapsed($wrap);

  // keep in-bounds on resize
  window.addEventListener("resize", () => {
    const w = $(`#mg-clock-${id}`);
    if (w.length) mgApplyPos(w);
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
  const { total, filled } = mgClockGetById(id);
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
  const { total } = mgClockGetById(id);
  return Math.max(0, Math.min(total - 1, Math.floor(deg / (360 / total))));
}

function mgDrawClock($wrap, id) {
  const { total, filled } = mgClockGetById(id);
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

  // Name (GM only)
  $wrap.on("keydown.mgclock", ".mg-clock-name", (ev) => {
    if (!game.user.isGM) return;
    if (ev.key === "Enter") { ev.preventDefault(); ev.currentTarget.blur(); }
  });
  $wrap.on("change.mgclock blur.mgclock", ".mg-clock-name", async (ev) => {
    if (!game.user.isGM) return;
    const name = String(ev.currentTarget.value ?? "").trim().slice(0, 60);
    await mgClockSetById(id, { name });
  });

  // Visibility toggle (GM only)
  $wrap.on("click.mgclock", ".mg-clock-vis", async () => {
    if (!game.user.isGM) return;

    const { gmOnly } = mgClockGetById(id);
    const becomingPublic = gmOnly === true;

    await mgClockSetById(id, { gmOnly: !gmOnly });

    // If we just flipped from Hidden → Public, play the sting for everyone
    if (becomingPublic) {
      AudioHelper.play(
        { src: MG_CLOCK_SFX, volume: 0.6, autoplay: true, loop: false },
        true // broadcast
      );
    }
  });

  // Controls (GM only)
  $wrap.on("click.mgclock", ".mg-clock-inc", async (ev) => {
    if (!game.user.isGM) return;
    const step = ev.shiftKey ? 2 : 1;
    const { filled } = mgClockGetById(id);
    await mgClockSetById(id, { filled: Math.max(0, filled - step) });
  });
  $wrap.on("click.mgclock", ".mg-clock-dec", async (ev) => {
    if (!game.user.isGM) return;
    const step = ev.shiftKey ? 2 : 1;
    const { filled, total, name, gmOnly } = mgClockGetById(id);
    const nf = Math.min(total, filled + step);   // spending = increase 'filled'
    if (nf === filled) return;
    await mgClockSetById(id, { filled: nf });
    const remaining = Math.max(0, total - nf);
    mgAnnounceClockTickDown(name, remaining, total, gmOnly);
  });

  // N/N overwrite (GM only)
  async function applyFromInput(input) {
    if (!game.user.isGM) return;
    const raw = Number(input.value);
    if (!Number.isFinite(raw)) return;
    await mgClockResetToById(id, raw);
    const { total } = mgClockGetById(id);
    input.value = ""; input.setAttribute("placeholder", String(total));
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
    startFilled = mgClockGetById(id).filled;  // remember where we started

    // scale knob a bit
    mgHandleScaleMap[id] = 1.18; mgUpdateHandleToFilled($wrap, id);
    mgUpdateHandleScale($wrap, id);

    // IMPORTANT: capture the pointer so we keep move/up events
    try { (ev.target instanceof Element) && ev.target.setPointerCapture?.(ev.pointerId); } catch (_) {}

    const idx = mgIdxFromEvent($wrap, ev, id);
    lastIdx = idx;
    const { total } = mgClockGetById(id);
    lastFilled = Math.max(0, total - (idx + 1));
    mgLocalSetFilled($wrap, id, lastFilled); // instant local feedback
  });

  $wrap.on("pointermove.mgclock", ".mg-clock-visual, .mg-clock-visual *", (ev) => {
    if (!scrubbing || !game.user.isGM) return;
    const idx = mgIdxFromEvent($wrap, ev, id);
    if (idx !== lastIdx) {
      lastIdx = idx;
      const { total } = mgClockGetById(id);
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
    await mgClockSetById(id, { filled: lastFilled });
    try {
      if (lastFilled > startFilled) {
        const { total, name, gmOnly } = mgClockGetById(id); // total/name/vis are stable
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
  await mgUiSave(id, { x: Math.round(r.left), y: Math.round(r.top) });
});

  // Double-click collapse/expand (per-user)
  // Swallow accidental double-clicks on UI so they don't collapse
  $wrap.on("dblclick.mgclock", ".mg-clock-controls, .mg-clock-visual, .mg-clock-name", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
  });

  // Collapse/expand ONLY via the grip (per-user)
  $wrap.on("dblclick.mgclock", ".mg-clock-grip", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    const ui   = mgUiLoad(id) ?? {};
    const next = !ui.collapsed;

    $wrap.toggleClass("mg-collapsed", next);
    await mgUiSave(id, { collapsed: next });
    mgApplyCollapsed($wrap);
  });

  $wrap.on("click.mgclock", ".mg-clock-close", async () => {
    if (!game.user.isGM) return;
    const ok = await Dialog.confirm({ title: "Remove Clock?", content: "<p>This will remove this clock from the scene.</p>" });
    if (!ok) return;
    await mgClockDeleteById(id);
    $wrap.remove();
  });
}

/* Force players to render newly made clock
----------------------------------------------------------------------*/
function mgRenderOneClock(id) {
  // Respect visibility for players
  const c = mgClockGetById(id);
  if (!c) return;

  if (!game.user.isGM && c.gmOnly) {
    $(`#mg-clock-${id}`).remove();
    return;
  }

  const $wrap = mgEnsureClockDOM(id);
  mgApplyPos($wrap);

  // Set name + control perms like in mgRenderAllClocks
  const nameInput = $wrap.find(".mg-clock-name")[0];
  if (nameInput) {
    nameInput.value = c.name || "";
    nameInput.placeholder = c.name || "Clock";
    if (game.user.isGM) { nameInput.readOnly = false; nameInput.classList.remove("readonly"); }
    else { nameInput.readOnly = true; nameInput.classList.add("readonly"); }
  }

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

  mgDrawClock($wrap, id);
  mgBindClock($wrap, id);
}

/* Force Foundry to remove a clock from players UI if DM deletes
----------------------------------------------------------------------*/
function mgPruneClockDOM() {
  const all = mgClocksGetAll();
  const allowed = new Set(
    Object.keys(all).filter(id => game.user.isGM || !all[id]?.gmOnly)
  );
  document.querySelectorAll(".mg-clock").forEach(el => {
    const cid = el.getAttribute("data-clock-id");
    if (cid && !allowed.has(cid)) el.remove();
  });
}

/* Attaching clock to the scene and saving position
----------------------------------------------------------------------*/
async function mgRenderAllClocks() {
  const all = mgClocksGetAll();
  const ids = Object.keys(all).filter(id => game.user.isGM || !all[id]?.gmOnly);

  // Remove any clocks this user shouldn’t see
  const allowed = new Set(ids);
  document.querySelectorAll(".mg-clock").forEach(el => {
    const cid = el.getAttribute("data-clock-id");
    if (cid && !allowed.has(cid)) el.remove();
  });

  for (const id of ids) mgRenderOneClock(id);

  for (const id of ids) {
    const $wrap = mgEnsureClockDOM(id);
    mgApplyPos($wrap);

    const { name, gmOnly } = mgClockGetById(id);

    // Name field perms
    const nameInput = $wrap.find(".mg-clock-name")[0];
    if (nameInput) {
      nameInput.value = name || "";
      nameInput.placeholder = name || "Clock";
      if (game.user.isGM) { nameInput.readOnly = false; nameInput.classList.remove("readonly"); }
      else { nameInput.readOnly = true; nameInput.classList.add("readonly"); }
    }

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

    mgDrawClock($wrap, id);
    mgBindClock($wrap, id);
  }
}

/* Hooking clocks into scene
----------------------------------------------------------------------*/
// Hooks: mount & live updates
function mgClearAllClockDOM() {
  document.querySelectorAll(".mg-clock").forEach(el => el.remove());
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
        $(`#mg-clock-${id}`).remove();
        continue;
      }

      // b) Explicit null inside map: flags.<ns>.clocks[id] = null
      if (patch === null || patch === undefined) {
        $(`#mg-clock-${k}`).remove();
        continue;
      }

      // c) New or updated → render/bind for THIS user
      mgRenderOneClock(k);
    }
  }

  // === 2) Top-level deletion: flags.<ns>["-=clocks.<id>"] = null
  for (const k of Object.keys(flagsNS)) {
    if (k.startsWith(`-=${FLAG_CLOCKS}.`)) {
      const id = k.slice((`-=${FLAG_CLOCKS}.`).length);
      $(`#mg-clock-${id}`).remove();
    }
  }

  // === 3) Final safety sweep: remove anything this user shouldn't see
  mgPruneClockDOM();
});

/* On Clock creation, adding an option for Hidden/Public
----------------------------------------------------------------------*/
async function mgOpenCreateClockDialog() {
  if (!game.user.isGM) return null;

  const content = `
  <form class="mg-create-clock">
    <div class="form-group">
      <label>Name</label>
      <input type="text" name="name" placeholder="Clock" />
    </div>

    <div class="form-group">
      <label>Segments</label>
      <input type="number" name="total" min="1" max="200" step="1" value="8"/>
    </div>

    <fieldset class="form-group">
      <legend>Visibility</legend>
      <label style="display:flex;gap:.5rem;align-items:center;">
        <input type="radio" name="vis" value="public" checked />
        <i class="fa-solid fa-eye"></i> Public
      </label>
      <label style="display:flex;gap:.5rem;align-items:center;">
        <input type="radio" name="vis" value="hidden" />
        <i class="fa-solid fa-eye-slash"></i> GM Only
      </label>
    </fieldset>
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

/* Sidebar Clock addition
----------------------------------------------------------------------*/
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;

  // Put our tools under the Token group (fallback to first group if not found)
  const group = controls.find(c => c.name === "token") ?? controls[0];
  if (!group) return;

  group.tools.push(
    {
      name: "mgAddClock",
      title: "Add Clock",
      icon: "fas fa-clock",
      button: true,
      onClick: async () => {
        const opts = await mgOpenCreateClockDialog();
        if (!opts) return;                                // canceled
        const id = await mgClockCreate(opts);             // creates with gmOnly choice
        if (id) {
          mgRenderAllClocks();

          // If it was created as Public, play the ominous sting for everyone
          if (!opts.gmOnly) {
            AudioHelper.play(
              { src: MG_CLOCK_SFX, volume: 0.8, autoplay: true, loop: false },
              true // broadcast to all clients
            );
          }
        }
      }
    },
    {
      name: "mgClearClocks",
      title: "Clear All Clocks (Scene)",
      icon: "fas fa-trash",
      button: true,
      onClick: async () => {
        const ok = await Dialog.confirm({
          title: "Clear All Clocks?",
          content: "<p>This will remove all clocks from the current scene.</p>"
        });
        if (!ok) return;
        const all = mgClocksGetAll();
        for (const id of Object.keys(all)) await mgClockDeleteById(id);
        mgClearAllClockDOM();
      }
    }
  );
});

/* Portrait Injection
----------------------------------------------------------------------*/

Hooks.on("renderChatMessage", (message, html) => {
  try {
    // Guard: avoid double-injection
    if (html[0]?.classList?.contains("mg-chat")) return;

    // Settings (already registered in your file)
    const source = game.settings.get("midnight-gambit", "chatPortraitSource"); // "token" | "actor" | "user"
    const size   = Number(game.settings.get("midnight-gambit", "chatPortraitSize")) || 38;
    const shape  = game.settings.get("midnight-gambit", "chatPortraitShape");   // "circle" | "rounded" | "square"

    // Resolve an image without touching your message content
    const speaker = message.speaker ?? {};
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
      img = (source === "user" ? (user?.avatar ?? null) : (user?.avatar ?? null));
    }

    // If no image, do nothing
    if (!img) return;

    // Mark root for CSS and insert avatar right inside the message root
    html.addClass("mg-chat");

    const $avatar = $(`
      <div class="mg-chat-avatar-wrap">
        <img class="mg-chat-avatar" src="${img}" alt="" loading="lazy"/>
      </div>
    `);

    // Inline size/shape so changes reflect immediately
    const br = shape === "circle" ? "9999px" : shape === "rounded" ? "10px" : "0";
    $avatar.find("img").addClass("mg-chat-avatar-img");


    // Insert avatar at the very top of the message node; do NOT wrap/move your content
    html.prepend($avatar);

    // Add a class to header/content so CSS can place them next to the avatar without reparenting
    html.find(".message-header, .message-content").addClass("mg-chat-body");

  } catch (err) {
    console.error("Midnight Gambit | Chat portrait injection error:", err);
  }
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


