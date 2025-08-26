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
const FLAG_NAME = "clock.name";
const MG_CLOCK_SFX = "systems/midnight-gambit/assets/sounds/gambit-clock.ogg";
// Setting timing for the comet sweep
const MG_SWEEP_PERIOD_MS = 1300;
// Pause at the end of each comet loop (ms)
const MG_SWEEP_PAUSE_MS = 200;
// Force comet direction (true = clockwise, false = counter-clockwise)
const MG_SWEEP_CLOCKWISE = true
// Start fading at 9 o’clock (last 50% of the sweep)
const MG_SWEEP_FADE_START_RATIO = 0.5; // 0.5 of the travel -> 270°

// --- Handle (queen) icon ---
function mgGetHandleUrl() {
  const sysId = game?.system?.id ?? "midnight-gambit";
  return `systems/${sysId}/assets/images/mg-queen.png`;
}

const MG_HANDLE_SIZE = 50;   // px (unscaled)
let   mgHandleScale  = 1;    // live scale factor for hover/drag

function mgClockGet() {
  const sc = canvas.scene;
  const total  = Number(sc?.getFlag(MG_NS, FLAG_TOTAL));
  const filled = Number(sc?.getFlag(MG_NS, FLAG_FILLED));
  const name   = sc?.getFlag(MG_NS, FLAG_NAME) ?? "";

  const t = Number.isFinite(total)  ? Math.max(1, Math.min(200, total)) : 8;
  const f = Number.isFinite(filled) ? Math.max(0, Math.min(t, filled)) : 0;

  return { total: t, filled: f, name };
}


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

  // Soft glow (slightly stronger than before)
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

  // Stronger halo for the comet head
  if (!svg.querySelector("#mg-glow-strong")) {
    const f2 = document.createElementNS(NS, "filter");
    f2.setAttribute("id", "mg-glow-strong");
    f2.setAttribute("x", "-60%");
    f2.setAttribute("y", "-60%");
    f2.setAttribute("width", "220%");
    f2.setAttribute("height", "220%");
    const blur2 = document.createElementNS(NS, "feGaussianBlur");
    blur2.setAttribute("in", "SourceGraphic");
    blur2.setAttribute("stdDeviation", "5");
    blur2.setAttribute("result", "blur");
    const merge2 = document.createElementNS(NS, "feMerge");
    const mm1 = document.createElementNS(NS, "feMergeNode"); mm1.setAttribute("in", "blur");
    const mm2 = document.createElementNS(NS, "feMergeNode"); mm2.setAttribute("in", "SourceGraphic");
    merge2.appendChild(mm1); merge2.appendChild(mm2);
    f2.appendChild(blur2); f2.appendChild(merge2);
    defs.appendChild(f2);
  }

  // Soft, directional-ish blur for the tail (subtle)
  if (!svg.querySelector("#mg-tail-blur")) {
    const f = document.createElementNS("http://www.w3.org/2000/svg", "filter");
    f.setAttribute("id", "mg-tail-blur");
    f.setAttribute("x", "-40%");
    f.setAttribute("y", "-40%");
    f.setAttribute("width", "180%");
    f.setAttribute("height", "180%");
    const blur = document.createElementNS("http://www.w3.org/2000/svg", "feGaussianBlur");
    blur.setAttribute("in", "SourceGraphic");
    blur.setAttribute("stdDeviation", "2");          // tweak: 1.5–3 looks good
    blur.setAttribute("result", "b");
    const merge = document.createElementNS("http://www.w3.org/2000/svg", "feMerge");
    const m1 = document.createElementNS("http://www.w3.org/2000/svg", "feMergeNode"); m1.setAttribute("in", "b");
    const m2 = document.createElementNS("http://www.w3.org/2000/svg", "feMergeNode"); m2.setAttribute("in", "SourceGraphic");
    merge.appendChild(m1); merge.appendChild(m2);
    f.appendChild(blur); f.appendChild(merge);
    svg.querySelector("defs.mg-glows").appendChild(f);
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
    fadeStartRatio: MG_SWEEP_FADE_START_RATIO
  });

  mgStartSweep(tail, L, {
    dashPx:   dash,
    capPx:    0,                  // butt cap
    periodMs: MG_SWEEP_PERIOD_MS,
    pauseMs:  MG_SWEEP_PAUSE_MS,
    offsetPx: phaseTail,
    fadeStartRatio: MG_SWEEP_FADE_START_RATIO
  });

  mgEnsureHandleOnTop($wrap);
}

/* Glowing comet around the circle
----------------------------------------------------------------------*/
function mgStopSweep(el) {
  try { el?._mgAnim?.cancel(); } catch (_) {}
  if (!el) return;
  el.style.removeProperty("stroke-dasharray");
  el.style.removeProperty("stroke-dashoffset");
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
  const fracMove = Math.max(0.001, Math.min(0.999, travelMs / period)); // movement portion

  const dashPx = Math.max(6, Math.min(42, opts.dashPx ?? (length * 0.18)));
  const gapPx  = Math.max(1, length - dashPx);
  const phase  = opts.offsetPx ?? 0;
  const cap    = Math.max(0, opts.capPx ?? 0);   // ≈ strokeWidth/2 for round caps

  // CCW baseline with cap compensation: head-front at start/end
  const startCCW = (-cap) + phase;
  const endCCW   = (length - dashPx - cap) + phase;

  // For CW we want to PAUSE with head-front exactly at `phase` → add the cap back
  const from = (typeof MG_SWEEP_CLOCKWISE !== "undefined" && MG_SWEEP_CLOCKWISE) ? endCCW : startCCW;
  const to   = (typeof MG_SWEEP_CLOCKWISE !== "undefined" && MG_SWEEP_CLOCKWISE) ? (startCCW + cap) : endCCW;

  // Fade timing: begin fade during the last quarter of the TRAVEL portion (9→12 o’clock)
  const ratio = Math.max(0, Math.min(1, opts.fadeStartRatio ?? 1)); // default = fade at end
  const fadeStart = Math.min(fracMove - 0.001, fracMove * ratio);   // in [0..fracMove)

  // Dashoffset at fade-start (linear along the travel)
  const t = fadeStart / fracMove;
  const offAtFade = (isFinite(t) ? (from + (to - from) * t) : from);

  el.style.strokeLinecap    = "round";
  el.style.strokeDasharray  = `${dashPx.toFixed(1)} ${gapPx.toFixed(1)}`;
  el.style.strokeDashoffset = String(from);

  try { el._mgAnim?.cancel(); } catch (_) {}
  el._mgAnim = el.animate(
    [
      { strokeDashoffset: from,      opacity: 1 },                    // start visible
      { strokeDashoffset: offAtFade, opacity: 1, offset: fadeStart }, // still visible up to 9 o'clock
      { strokeDashoffset: to,        opacity: 0, offset: fracMove },  // fully faded at 12 o'clock
      { strokeDashoffset: to,        opacity: 0 }                     // stay hidden during pause
    ],
    { duration: period, iterations: Infinity, easing: "linear" }
  );
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

  console.debug("MG Clock draw(id):", { id, total, filled, nodes: segsG.childNodes.length });
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
    const { filled, total } = mgClockGetById(id);
    await mgClockSetById(id, { filled: Math.min(total, filled + step) })
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
  let scrubbing = false, lastIdx = null, lastFilled = 0;

  $wrap.on("pointerdown.mgclock", ".mg-clock-visual, .mg-clock-visual *", (ev) => {
    if (!game.user.isGM) return;
    ev.preventDefault();
    scrubbing = true; lastIdx = null;

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

  console.debug("MG RenderAllClocks start:", { ids });

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

