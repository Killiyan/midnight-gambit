import { evaluateRoll } from "./roll-utils.js";

export class MidnightGambitActorSheet extends ActorSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      template: "systems/midnight-gambit/templates/actors/actor-sheet.html",
      width: 850,
      height: 950
    });
  }

    //Grabbing all the actor data information to create the initial sheet
    async getData(options) {
      const context = await super.getData(options);

      // Make sure the actor is available in the template
      context.actor = this.actor;
      context.system = this.actor.system;

      context.sparkAttribute = this.actor.system.sparkAttribute ?? "guile";

      
      const deckIds = context.system.gambits.deck ?? [];
      const drawnIds = context.system.gambits.drawn ?? [];
      const discardIds = context.system.gambits.discard ?? [];

      // --- Gambit counters for UI ---
      const handCount = drawnIds.length;
      const deckCount = deckIds.length;
      const handMax   = Number(context.system.gambits?.maxDrawSize ?? 3);
      const deckMax   = Number(context.system.gambits?.maxDeckSize ?? 3);

      context.gambitCounts = {
        handCount, handMax,                      // e.g., "Hand Size: 2/4"
        deckCount, deckMax,                      // e.g., "Deck Size: 3/5"
        handAtCap: handCount >= handMax,
        deckAtCap: deckCount >= deckMax,
        deckRemaining: Math.max(0, deckMax - deckCount)
      };


      // === Guise presence drives Level UI ===
      // "hasActiveGuise" is true if the actor has an applied guise id on system,
      // or at least one Guise item owned (pick whichever you really use).
      const hasSystemGuise =
        Boolean(getProperty(this.actor, "system.guise")) ||
        Boolean(getProperty(this.actor, "system.guiseId")) ||
        Boolean(getProperty(this.actor, "system.guise.active"));

      const hasItemGuise = Array.isArray(this.actor.items)
        ? this.actor.items.some(i => i.type === "guise")
        : false;

      context.hasActiveGuise = hasSystemGuise || hasItemGuise;
      
      context.gambitDeck = deckIds.map(id => this.actor.items.get(id)).filter(Boolean);
      context.gambitDrawn = drawnIds.map(id => this.actor.items.get(id)).filter(Boolean);
      context.gambitDiscard = discardIds.map(id => this.actor.items.get(id)).filter(Boolean);

      context.gambitDrawnWithAngle = context.gambitDrawn.map((card, i, arr) => {
        const total = arr.length;
        const mid = (total - 1) / 2;
        const angle = (i - mid) * 10; // spacing angle
        return { ...card, rotate: angle };
      });      

      if (!this.actor?.system?.gambits) {
        console.warn("Missing gambit data on actor.");
        return super.getData(options);
      }

      context.attributeKeys = [
        "tenacity",
        "finesse",
        "resolve",
        "guile",
        "instinct",
        "presence"
      ];

      // Skill buckets for the new under-attribute layout
      context.skillBuckets = {
        tenacity: ["brawl", "endure", "athletics"],
        finesse:  ["aim", "stealth", "sleight"],
        resolve:  ["will", "grit", "composure"],
        guile:    ["lore", "investigate", "deceive"],
        instinct: ["survey", "hunt", "nature"],
        presence: ["command", "charm", "perform"]
      };

      // Human-friendly labels (keeps template clean)
      context.skillLabels = {
        brawl: "Brawl",
        endure: "Endure",
        athletics: "Athletics",
        aim: "Aim",
        stealth: "Stealth",
        sleight: "Sleight",
        will: "Will",
        grit: "Grit",
        composure: "Composure",
        lore: "Lore",
        investigate: "Investigate",
        deceive: "Deceive",
        survey: "Survey",
        hunt: "Hunt",
        nature: "Nature",
        command: "Command",
        charm: "Charm",
        perform: "Perform",

        // Spark label if you render it in the Spark section
        spark: "Spark"
      };

      const allSkillKeys = [
        "brawl", "endure", "athletics",
        "aim", "stealth", "sleight",
        "will", "grit", "composure",
        "lore", "investigate", "deceive",
        "survey", "hunt", "nature",
        "command", "charm", "perform",
        "spark"
      ];

      const storedTempAttrBonuses = this.actor.system?.tempAttributeBonuses ?? {};
      context.tempAttributeBonuses = Object.fromEntries(
        context.attributeKeys.map((key) => [key, Number(storedTempAttrBonuses[key] ?? 0)])
      );      

      const storedTempSkillBonuses = this.actor.system?.tempSkillBonuses ?? {};

      context.tempSkillBonuses = Object.fromEntries(
        Object.keys(context.system.skills ?? {}).map((key) => [
          key,
          Number(storedTempSkillBonuses[key] ?? 0)
        ])
      );
      
      context.skillAttrShort = {
        brawl: "ten", endure: "ten", athletics: "ten",
        aim: "fin", stealth: "fin", sleight: "fin",
        will: "res", grit: "res", composure: "res",
        lore: "gui", investigate: "gui", deceive: "gui",
        survey: "ins", hunt: "ins", nature: "ins",
        command: "pre", charm: "pre", perform: "pre",

        // Spark is no longer rendered in the skill grid, but this can stay for now
        // if you still render Spark elsewhere and want the tooltip shorthand.
        spark: "gui"
      };

      context.CONFIG = CONFIG;

      // --- Guise shown on-sheet (Moves/Signature) is allowed to differ from primary (stats) ---
      const primaryGuiseId = this.actor.system?.guiseId || this.actor.system?.guise || null;
      const movesGuiseId = primaryGuiseId;

      context.primaryGuiseId = primaryGuiseId;
      context.movesGuiseId = movesGuiseId;

      // --- Resolve an item ref that might be an embedded id OR a UUID ---
      const resolveGuiseDoc = async (ref) => {
        if (!ref) return null;

        // 1) Embedded item id on this actor
        let doc = this.actor.items.get(ref);
        if (doc) return doc;

        // 2) World item id
        doc = game.items?.get(ref);
        if (doc) return doc;

        // 3) UUID (Actor...Item..., Item..., Compendium...)
        try {
          const uuidDoc = await fromUuid(ref);
          return uuidDoc ?? null;
        } catch (e) {
          console.warn("MG | Failed to resolve guise ref:", ref, e);
          return null;
        }
      };

      if (movesGuiseId) {
        const guise = await resolveGuiseDoc(movesGuiseId);

        if (guise?.type === "guise") {
          context.guise = guise;

          console.log("Primary Guise ID:", primaryGuiseId);
          console.log("Moves Guise ID:", movesGuiseId);
          console.log("Rendering Moves from:", guise.name);
        }
      }

      // IMPORTANT: caster state must come from the ACTOR, not the rendered guise.
      // This is what makes secondary-caster multi-guise show Spark correctly.
      const rawCasterType = this.actor.system?.casterType ?? null;
      const ct = (rawCasterType === "caster") ? "full" : rawCasterType;

      context.isCaster = ct === "full" || ct === "half";
      context.isFullCaster = ct === "full";
      context.isHalfCaster = ct === "half";
      context.casterType = ct;
      
      for (const item of context.actor.items) {
        const mc = item.system.mortalCapacity || 0;
        const sc = item.system.soulCapacity || 0;

        // If remaining not set yet, default it to full
        if (!item.system.remainingCapacity) {
          item.system.remainingCapacity = {};
        }

        if (item.system.remainingCapacity.mortal === undefined) {
          item.system.remainingCapacity.mortal = mc;
        }

        if (item.system.remainingCapacity.soul === undefined) {
          item.system.remainingCapacity.soul = sc;
        }

        item.system.isFullyRepaired =
          (!mc || item.system.remainingCapacity.mortal === mc) &&
          (!sc || item.system.remainingCapacity.soul === sc);
      }

      // ----------------------------------------------------------------------
      // Moves: learned moves + secondary guise content reconstructed from guise items
      // ----------------------------------------------------------------------
      const allMoves = this.actor.items.filter(i => i.type === "move");

      // Keep your existing learned-moves behavior
      context.learnedMoves = allMoves.filter(m =>
        m.system?.learned === true &&
        m.system?.isSignature !== true
      );

      // We will build secondary signature/basic content directly from non-primary guise items,
      // so the Moves tab always works even if no embedded "fromSecondaryGuise" moves exist yet.
      context.secondarySignatureMoves = [];
      context.secondaryBasicMoves = [];
      context.enrichedSecondarySignatureMoves = [];
      context.enrichedSecondaryBasicMoves = [];

      /* Level up / Undo context
      ----------------------------------------------------------------------*/
      const level = this.actor.system.level ?? 1;
      const levels = CONFIG.MidnightGambit?.LEVELS ?? {};
      const maxLevel = Math.max(...Object.keys(levels).map(n => Number(n) || 0), 1);

      context.canLevelUp = level < maxLevel;
      context.canLevelDown = level > 1;

      // Pending counters to drive banner/wizard
      const state = await this.actor.getFlag("midnight-gambit", "state");
      const p = state?.pending || {};
      context.pending = {
        attributes: Number(p.attributes || 0),
        skills: Number(p.skills || 0),
        moves: Number(p.moves || 0),
        sparkSlots: Number(p.sparkSlots || 0),
        signaturePerk: Number(p.signaturePerk || 0),
        finalHandDiscoverable: Number(p.finalHandDiscoverable || 0)
      };
      context.hasPending = Object.values(context.pending).some(n => Number(n) > 0);

      // --- Guise-driven Signature + Moves (primary + secondary) ----------------
      const allGuises = this.actor.items.filter(i => i.type === "guise");

      // Resolve primary guise robustly (system.guise might be an embedded id OR a uuid)
      let primaryGuise = null;
      const gRef = this.actor.system.guiseId || this.actor.system.guise;

      if (gRef) {
        primaryGuise =
          this.actor.items.get(gRef) ||
          allGuises.find(g => g.uuid === gRef) ||
          null;
      }

      // Primary guise becomes the main `guise` used by your original HTML
      context.guise = primaryGuise ?? null;

      // Helper: normalize tags whether stored as array or CSV string
      const parseTags = (v) => {
        if (Array.isArray(v)) return v.filter(Boolean);
        if (typeof v === "string") {
          return v
            .split(",")
            .map(s => s.trim())
            .filter(Boolean);
        }
        return [];
      };

      // PRIMARY signature + basic moves (feeds your original primary HTML block)
      if (context.guise) {
        const sig = String(context.guise.system?.signatureDescription ?? "");
        context.signatureHtml = await TextEditor.enrichHTML(sig, { async: true });

        context.signatureTags = parseTags(context.guise.system?.signatureTags);

        const rawMoves = Array.isArray(context.guise.system?.moves)
          ? context.guise.system.moves
          : [];

        context.enrichedMoves = await Promise.all(
          rawMoves.map(async (m) => {
            const tags = parseTags(m?.tags ?? m?.tagsCsv);
            return {
              ...m,
              tags,
              html: await TextEditor.enrichHTML(String(m?.description ?? ""), { async: true })
            };
          })
        );
      } else {
        context.signatureHtml = "";
        context.signatureTags = [];
        context.enrichedMoves = [];
      }

      // SECONDARY guise list (header / settings still use this)
      const secondaryGuiseDocs = allGuises.filter(g => !primaryGuise || g.id !== primaryGuise.id);

      context.secondaryGuises = secondaryGuiseDocs.map(g => ({
        id: g.id,
        name: g.name
      }));

      // SECONDARY signature perks reconstructed directly from guise items
      context.enrichedSecondarySignatureMoves = await Promise.all(
        secondaryGuiseDocs
          .filter(g => (g.system?.signaturePerk ?? "").trim() || (g.system?.signatureDescription ?? "").trim())
          .map(async (g) => ({
            _id: g.id,
            name: g.system?.signaturePerk ?? g.name,
            description: g.system?.signatureDescription ?? "",
            html: await TextEditor.enrichHTML(String(g.system?.signatureDescription ?? ""), { async: true }),
            tags: parseTags(g.system?.signatureTags),
            guiseSource: g.id
          }))
      );

      // SECONDARY basic moves reconstructed directly from guise items
      context.enrichedSecondaryBasicMoves = await Promise.all(
        secondaryGuiseDocs.flatMap((g) => {
          const rawMoves = Array.isArray(g.system?.moves) ? g.system.moves : [];
          return rawMoves.map(async (m) => ({
            _id: `${g.id}-${m.name ?? "move"}`,
            name: m.name ?? "Unnamed Move",
            description: m.description ?? "",
            html: await TextEditor.enrichHTML(String(m.description ?? ""), { async: true }),
            tags: parseTags(m?.tags ?? m?.tagsCsv),
            guiseSource: g.id
          }));
        })
      );
        
      // --- Settings tab: Primary/Secondary toggles -------------------------------
      // Resolve refs to embedded ids first so UI state is stable.
      const normalizeGuiseRefToId = (ref) => {
        if (!ref) return null;

        const byId = this.actor.items.get(ref);
        if (byId?.type === "guise") return byId.id;

        const byUuid = allGuises.find(g => g.uuid === ref);
        if (byUuid) return byUuid.id;

        return null;
      };

      const primaryResolvedId = normalizeGuiseRefToId(this.actor.system?.guiseId || this.actor.system?.guise);
      const secondaryResolvedIds = (Array.isArray(this.actor.system?.secondaryGuises) ? this.actor.system.secondaryGuises : [])
        .map(normalizeGuiseRefToId)
        .filter(Boolean);

      context.settingsGuises = allGuises.map(g => ({
        id: g.id,
        name: g.name,
        isPrimary: g.id === primaryResolvedId,
        isSecondary: secondaryResolvedIds.includes(g.id)
      }));    

      // ----------------------------------------------------------------------
      // Enrich embedded Move items used for multi-guise / signature perk drops
      // ----------------------------------------------------------------------
      const enrichMoveItem = async (itemDoc) => {
        const desc = String(itemDoc?.system?.description ?? "");
        return {
          _id: itemDoc.id,
          name: itemDoc.name,
          description: desc,
          tags: Array.isArray(itemDoc.system?.tags) ? itemDoc.system.tags : [],
          html: await TextEditor.enrichHTML(desc, { async: true })
        };
      };

      // Signature perk MOVES (embedded move items flagged as signature)
      context.enrichedSignaturePerkMoves = await Promise.all(
        (context.signaturePerkMoves ?? []).map(enrichMoveItem)
      );

      // Extra basic moves from secondary guises (embedded move items with guiseSource)
      context.enrichedEmbeddedGuiseMoves = await Promise.all(
        (context.embeddedGuiseMoves ?? []).map(enrichMoveItem)
      );      

      // Embedded signature perks (from secondary guises OR standalone drops)
      const embeddedSigItems = this.actor.items.filter(i =>
        i.type === "move" && i.system?.isSignature === true
      );

      context.embeddedSignatureMoves = await Promise.all(
        embeddedSigItems.map(async (m) => {
          const desc = String(m.system?.description ?? "");
          const tags = parseTags(m.system?.tags ?? m.system?.tagsCsv);

          return {
            _id: m.id,
            name: m.name,
            description: desc,
            tags,
            html: await TextEditor.enrichHTML(desc, { async: true })
          };
        })
      );   

      // -------------------------
      // Actor Settings (Settings tab)
      // -------------------------
      const derivedRiskDice = Number(this.actor.system?.derivedRiskDice ?? 5);
      const riskDiceBonus = Number(this.actor.system?.actorSettings?.riskDiceBonus ?? 0) || 0;

      const derivedSparkSlots = Number(this.actor.system?.derivedSparkSlots ?? this.actor.system?.sparkSlots ?? 0);
      const sparkSlotsBonus = Number(this.actor.system?.actorSettings?.sparkSlotsBonus ?? 0) || 0;

      const stoValue = Number(this.actor.system?.sto?.value ?? 0);
      const stoDisplayMax = Math.max(6, stoValue);

      context.actorSettings = {
        derivedRiskDice,
        isRiskModified: riskDiceBonus !== 0,
        derivedSparkSlots,
        isSparkModified: sparkSlotsBonus !== 0,
        isStoModified: stoValue !== 0
      };

      context.stoDisplayMax = stoDisplayMax;

      context.data = context;
      context.tags = CONFIG.MidnightGambit?.ITEM_TAGS ?? [];
      return context;
    }

    /** Wrap the profile img in a cropbox and apply saved vars from flags. */
    _mgInitProfileCrop(html) {
      const $root = html instanceof jQuery ? html : $(html);
      const $img = $root.find("img.mg-profile-img").first();
      if (!$img.length) return;

      // Wrap once
      let $wrap = $img.closest(".mg-profile-crop.mg-cropbox");
      if (!$wrap.length) {
        $wrap = $(`<div class="mg-profile-crop mg-cropbox"></div>`);
        $img.wrap($wrap);
        $wrap = $img.closest(".mg-profile-crop.mg-cropbox");
      }

      // Apply from flags
      const crop = this.actor.getFlag("midnight-gambit", "crops")?.profile?.css || {};
      const x = Number.isFinite(crop.x) ? crop.x : 50;
      const y = Number.isFinite(crop.y) ? crop.y : 50;
      const s = Number.isFinite(crop.scale) ? crop.scale : 1;

      $wrap[0].style.setProperty("--mg-crop-x", String(x));
      $wrap[0].style.setProperty("--mg-crop-y", String(y));
      $wrap[0].style.setProperty("--mg-crop-scale", String(s));
    }

    /** Modal cropper: drag to pan, wheel to zoom; saves to flags on Save. */
    _mgOpenProfileCropper(html) {
      const $root = html instanceof jQuery ? html : $(html);
      const $img = $root.find("img.mg-profile-img").first();
      const src = $img.attr("src");
      if (!src) return;

      // Current values
      const saved = this.actor.getFlag("midnight-gambit", "crops")?.profile?.css || {};
      let x = Number.isFinite(saved.x) ? saved.x : 50;
      let y = Number.isFinite(saved.y) ? saved.y : 50;
      let s = Number.isFinite(saved.scale) ? saved.scale : 1;

      // Build overlay
      const $ui = $(`
        <div class="mg-crop-editor" role="dialog" aria-modal="true">
          <div class="mg-crop-panel">
            <div class="mg-row">
              <div><strong>Crop Actor Profile Image</strong></div>
              <div class="hint">Drag to pan • Mouse wheel to zoom • Esc to cancel</div>
            </div>
            <div class="mg-crop-stage">
              <img src="${src}" alt="preview" style="--x:${x}; --y:${y}; --s:${s}">
            </div>
            <div class="mg-actions">
              <button class="ghost mg-cancel">Cancel</button>
              <button class="primary mg-save">Save</button>
            </div>
          </div>
        </div>
      `);

      const stage = $ui.find(".mg-crop-stage")[0];
      const imgEl = $ui.find(".mg-crop-stage img")[0];

      // Drag state
      let dragging = false;
      let last = { cx: 0, cy: 0 };

      const apply = () => {
        imgEl.style.setProperty("--x", String(x));
        imgEl.style.setProperty("--y", String(y));
        imgEl.style.setProperty("--s", String(s));
      };

      // Drag to pan (pointer events = works with mouse + pen)
      stage.addEventListener("pointerdown", (ev) => {
        dragging = true;
        last = { cx: ev.clientX, cy: ev.clientY };
        stage.setPointerCapture?.(ev.pointerId);
      });
      stage.addEventListener("pointermove", (ev) => {
        if (!dragging) return;
        const dx = ev.clientX - last.cx;
        const dy = ev.clientY - last.cy;
        last = { cx: ev.clientX, cy: ev.clientY };
        const w = stage.clientWidth;
        const h = stage.clientHeight;
        x -= (dx / w) * 100;
        y -= (dy / h) * 100;
        apply();
      });
      stage.addEventListener("pointerup", () => { dragging = false; });
      stage.addEventListener("pointercancel", () => { dragging = false; });

      // Wheel to zoom (clamped)
      stage.addEventListener("wheel", (ev) => {
        ev.preventDefault();
        const delta = Math.sign(ev.deltaY) * 0.05;
        s = Math.min(3, Math.max(0.5, s - delta));
        apply();
      }, { passive: false });

      // Buttons
      $ui.on("click", ".mg-cancel", () => $ui.remove());
      $ui.on("click", ".mg-save", async () => {
        try {
          const ns = "midnight-gambit";
          const crops = (await this.actor.getFlag(ns, "crops")) || {};
          crops.profile = crops.profile || {};
          crops.profile.css = { x, y, scale: s };
          await this.actor.setFlag(ns, "crops", crops);
          this._mgInitProfileCrop(html); // apply immediately on sheet
          $ui.remove();
        } catch (err) {
          console.error("MG | Save profile crop failed:", err);
          ui.notifications?.error("Failed to save profile crop. See console.");
        }
      });

      // Esc to close
      const onKey = (ev) => {
        if (ev.key === "Escape") { $ui.remove(); window.removeEventListener("keydown", onKey); }
      };
      window.addEventListener("keydown", onKey);

      document.body.appendChild($ui[0]);
    }

/** Modal cropper for Chat Avatar: identical behavior to profile cropper */
_mgOpenChatCropper() {
  const src = this.actor?.img;
  if (!src) return;

  // Current values
  const saved = this.actor.getFlag("midnight-gambit", "crops")?.chat?.css || {};
  let x = Number.isFinite(saved.x) ? saved.x : 50;
  let y = Number.isFinite(saved.y) ? saved.y : 50;
  let s = Number.isFinite(saved.scale) ? saved.scale : 1;

  const $ui = $(`
    <div class="mg-crop-editor chat-crop" role="dialog" aria-modal="true">
      <div class="mg-crop-panel">
        <div class="mg-row">
          <div><strong>Frame Chat Avatar</strong></div>
          <div class="hint">Drag to pan • Mouse wheel to zoom • Esc to cancel</div>
        </div>

        <div class="mg-crop-stage">
          <img src="${src}" alt="preview" style="--x:${x}; --y:${y}; --s:${s}">
        </div>

        <div class="mg-actions">
          <button type="button" class="ghost mg-cancel">Cancel</button>
          <button type="button" class="primary mg-save">Save</button>
        </div>
      </div>
    </div>
  `);

  const stage = $ui.find(".mg-crop-stage")[0];
  const imgEl = $ui.find(".mg-crop-stage img")[0];

  let dragging = false;
  let last = { cx: 0, cy: 0 };

  const apply = () => {
    imgEl.style.setProperty("--x", String(x));
    imgEl.style.setProperty("--y", String(y));
    imgEl.style.setProperty("--s", String(s));
  };

  stage.addEventListener("pointerdown", (ev) => {
    dragging = true;
    last = { cx: ev.clientX, cy: ev.clientY };
    stage.setPointerCapture?.(ev.pointerId);
  });

  stage.addEventListener("pointermove", (ev) => {
    if (!dragging) return;

    const dx = ev.clientX - last.cx;
    const dy = ev.clientY - last.cy;
    last = { cx: ev.clientX, cy: ev.clientY };

    const w = stage.clientWidth || 1;
    const h = stage.clientHeight || 1;

    // Same feel as profile cropper (not hypersensitive)
    const PAN = 0.45;
    x -= ((dx / w) * 100) * PAN;
    y -= ((dy / h) * 100) * PAN;

    apply();
  });

  stage.addEventListener("pointerup", () => { dragging = false; });
  stage.addEventListener("pointercancel", () => { dragging = false; });

  stage.addEventListener("wheel", (ev) => {
    ev.preventDefault();

    // Zoom speed (hold Shift for faster zoom)
    const step = ev.shiftKey ? 0.15 : 0.05;
    const delta = Math.sign(ev.deltaY) * step;

    // NO practical max; keep only a safety min so scale never hits 0
    s = Math.max(0.05, s - delta);

    apply();
  }, { passive: false });

  $ui.on("click", ".mg-cancel", () => $ui.remove());

  $ui.on("click", ".mg-save", async () => {
    try {
      const ns = "midnight-gambit";
      const crops = (await this.actor.getFlag(ns, "crops")) || {};
      crops.chat = crops.chat || {};
      crops.chat.css = { x, y, scale: s };
      await this.actor.setFlag(ns, "crops", crops);

      // Refresh chat so you don't need a new roll to test
      ui.chat?.render?.(true);

      $ui.remove();
    } catch (err) {
      console.error("MG | Save chat crop failed:", err);
      ui.notifications?.error("Failed to save chat framing. See console.");
    }
  });

  const onKey = (ev) => {
    if (ev.key === "Escape") {
      $ui.remove();
      window.removeEventListener("keydown", onKey);
    }
  };
  window.addEventListener("keydown", onKey);

  document.body.appendChild($ui[0]);
}


    /** Binds event listeners after rendering. This is the Event listener for most the system*/
    async activateListeners(html) {
      super.activateListeners(html);

      this._mgInitProfileCrop(html);
      html.find(".mg-crop-profile").off("click.mgCrop").on("click.mgCrop", (ev) => {
        ev.preventDefault();
        this._mgOpenProfileCropper(html);
      });

      html.find(".mg-crop-chat").off("click.mgCropChat").on("click.mgCropChat", (ev) => {
        ev.preventDefault();
        this._mgOpenChatCropper(html);
      });

      // Owner / GM? Full interactivity. Otherwise: view-only and bail out.
      const isOwner = this.actor?.testUserPermission?.(game.user, "OWNER") || game.user.isGM;
      if (!isOwner) {
        // (If you pasted the tab-hiding helper earlier, keep this call. If not, it's safe to ignore.)
        if (typeof this._mgRestrictTabsForNonOwners === "function") {
          this._mgRestrictTabsForNonOwners(html);
        }
        this._mgMakeReadOnly(html);
        return;
      }

      // Dynamically apply .narrow-mode based on sheet width
      const appWindow = html[0]?.closest(".window-app");
      const form = html[0];

      if (appWindow && form) {
        const observer = new ResizeObserver(entries => {
          for (let entry of entries) {
            const width = entry.contentRect.width;
            if (width < 700) {
              form.classList.add("narrow-mode");
            } else {
              form.classList.remove("narrow-mode");
            }
          }
        });

        observer.observe(appWindow);
        this._resizeObserver = observer;
      }

      // Shuffle Function
      function shuffleArray(array) {
        const copy = [...(array ?? [])];
        for (let i = copy.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
      }

      // MG Edge Toggle Button
      html.find(".mg-edge-toggle").on("click", async (ev) => {
        ev.preventDefault();
        const cur = !!this.actor.system.edgeNext;
        await this.actor.update({ "system.edgeNext": !cur }, { render: false });

        // Update UI immediately without re-render
        const btn = ev.currentTarget;
        btn.classList.toggle("is-active", !cur);
      });

      // This updates the strain amount on click; we suppress full re-render to avoid UI jump
      html.find(".strain-dot").on("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        // Kill any active input focus
        if (document.activeElement) {
          try { document.activeElement.blur(); } catch (_) {}
        }

        const el = event.currentTarget;
        const strainType   = el.dataset.type;           // "mortal" | "soul" (your dots use data-type)
        const clickedValue = Number(el.dataset.value);  // 1..N

        const actor = this.actor;
        if (!actor) return;

        const currentValue = getProperty(actor.system.strain, strainType);
        const newValue = Math.max(
          0,
          clickedValue === currentValue ? clickedValue - 1 : clickedValue
        );

        // 1) Update the document WITHOUT triggering a render (important for multiplayer UI consistency)
        await actor.update({ [`system.strain.${strainType}`]: newValue }, { render: false });

        // 2) Manually reflect the change in the currently open sheet:
        // 2a) dots
        const $track = html.find(`.strain-track[data-strain="${strainType}"]`);
        $track.find(".strain-dot").each((_, node) => {
          const v = Number(node.dataset.value);
          node.classList.toggle("filled", v <= newValue);
        });

        // 2b) ticker number inside the shield (covers common patterns)
        // Try input first
        const $tickerInput = html.find(
          `input[name="system.strain.${strainType}"], input[data-strain="${strainType}"].strain-ticker`
        );
        if ($tickerInput.length) {
          $tickerInput.val(newValue);
        }

        // Try plain text spans/divs (e.g., the number inside the shield)
        const $tickerText = html.find(
          `[data-strain-current="${strainType}"], .strain-current[data-strain="${strainType}"], .strain-ticker-value[data-strain="${strainType}"]`
        );
        if ($tickerText.length) {
          $tickerText.text(newValue);
        }
      });

      
      /** This looks for risk dice amount and applies similar click logic */
      html.find(".risk-dot").on("click", async (event) => {
        const el = event.currentTarget;
        const clicked = parseInt(el.dataset.value);
        const riskDice = this.actor.system.riskDice ?? 5;
        const currentUsed = this.actor.system.riskUsed ?? 0;
        const currentlyFilled = riskDice - currentUsed;

        let newUsed;

        if (clicked > currentlyFilled) {
          // Clicked an unfilled dot → fill up to it
          newUsed = riskDice - clicked;
        } else {
          // Clicked a filled dot → unfill it and all to the right
          newUsed = riskDice - (clicked - 1);
        }

        /**This tracks how much Risk you have used, and calculates it with your current*/
        console.log(`Risk click: ${clicked} → riskUsed: ${newUsed} (was ${currentUsed})`);

        await this.actor.update({ "system.riskUsed": newUsed });

        this.render(false);
      });

      /** STO (Stacking the Odds) tracker — click to add or spend */
      html.find(".sto-dot")
        .off("click.mgSTO")
        .on("click.mgSTO", async (event) => {
          event.preventDefault();
          event.stopPropagation();

          const el = event.currentTarget;
          const clicked = Number(el.dataset.value);
          if (!Number.isFinite(clicked)) return;

          const actor = this.actor;
          if (!actor) return;

          const current = Number(actor.system?.sto?.value ?? 0);

          // Core rule:
          // - click empty → set to clicked
          // - click filled → drop to clicked - 1
          let next = (clicked <= current)
            ? clicked - 1
            : clicked;

          next = Math.max(0, next);

          await actor.update(
            { "system.sto.value": next },
            { render: false }
          );

          // Patch UI immediately (no full render)
          const $track = this.element.find(`.sto-track[data-track="sto"]`);
          $track.find(".sto-dot").each((_, node) => {
            const v = Number(node.dataset.value);
            node.classList.toggle("filled", v <= next);
          });
        });




      /**This is the listener for clicking the Flashback Resource */
      html.find(".flashback-dot").on("click", async (event) => {
        const current = this.actor.system.flashbackUsed ?? false;
        await this.actor.update({ "system.flashbackUsed": !current });
        this.render(false);
      });

      html.find(".load-icon").on("click", async (event) => {
        const selected = event.currentTarget.dataset.load;
        await this.actor.update({ "system.load": selected });

        // Remove all selected immediately
        html.find(".load-icon").removeClass("selected");

        const $clicked = $(event.currentTarget);

        // Step 1: Force reflow to commit the style
        void $clicked[0].offsetWidth;

        // Step 2: Add animating class
        $clicked.addClass("selected");
      });

      /** This adds a tab section for the character sheet and sets the selectors for said tabs. Also sets the tabs to stay on the active tab after a render */
      // It also makes the data stored locally not on the system
      const groupEl = html.find("nav.sheet-tabs")[0];
      const group = groupEl?.getAttribute("data-group") || "main";

      // Unique key per actor + viewer (and per tab group if you add more later)
      const TAB_KEY = `mg.tab.${this.actor.id}.${game.user.id}.${group}`;
      const initialTab = localStorage.getItem(TAB_KEY) || "general";

      // Keep the active tab per-actor/per-user
      const tabs = new Tabs({
        navSelector: groupEl ? `nav.sheet-tabs[data-group="${group}"]` : `nav.sheet-tabs`,
        // Use the standard container that holds your <section class="tab" ...> panes
        contentSelector: `.sheet-body`,
        initial: initialTab,
        // Foundry v11 will call this; make sure it's a function
        callback: (_tabs, _html, _event) => { /* no-op, but prevents v11 crash */ }
      });
      tabs.bind(html[0]);


      // Save selection locally (no actor flags = no sync to other users)
      html.find(groupEl ? `nav.sheet-tabs[data-group="${group}"]` : `nav.sheet-tabs`)
        .on("click", "[data-tab]", (ev) => {
          const tab = ev.currentTarget.dataset.tab;
          if (tab) localStorage.setItem(TAB_KEY, tab);

          // After the tab becomes visible, re-measure tag stacks so .short/toggles are correct
          setTimeout(() => {
            html[0]?._mgRefreshTagsOverflow?.();
          }, 0);
        });

        // Move floating tab nav outside .window-content so it's not clipped
        const nav = html.find(".sheet-tabs.floating");
        const app = html.closest(".window-app");
        if (nav.length && app.length) {
          app.append(nav);

          // --- Settings tab glow + count badge (nav lives in .window-app now) ---
          const appRoot = app; // jQuery of .window-app

          const refreshSettingsGlow = async () => {
            const state = (await this.actor.getFlag("midnight-gambit", "state")) ?? {};
            const p = state.pending ?? {};
            const total = Object.values(p).reduce((a, n) => a + (Number(n) || 0), 0);
            const hasPending = total > 0;

            const navBtn = appRoot.find('nav.sheet-tabs [data-tab="settings"]');
            if (!navBtn.length) return;

            navBtn.toggleClass("mg-pending-glow", hasPending);
            navBtn.find(".mg-pending-badge").remove();
            if (hasPending) {
              navBtn.append(`<p class="mg-pending-badge" aria-hidden="true">${total}</p>`);
            }
          };

          // Run once when the sheet renders (no await here)
          refreshSettingsGlow().catch(err => console.warn("MG glow init failed:", err));

          // Re-run when this actor's flags change (pending updates)
          this._onActorUpdatePending = async (doc, changes) => {
            if (doc.id !== this.actor.id) return;

            // Be lenient: if any midnight-gambit flags changed, refresh
            const mgFlagsChanged =
              foundry.utils.getProperty(changes, "flags.midnight-gambit") !== undefined ||
              foundry.utils.getProperty(changes, "flags['midnight-gambit']") !== undefined ||
              foundry.utils.getProperty(changes, "flags") !== undefined;

            if (mgFlagsChanged) await refreshSettingsGlow();
          };

          Hooks.on("updateActor", this._onActorUpdatePending);
        }

      // Drawing button for Gambits
      html.find(".draw-gambit").on("click", async () => {
        event.preventDefault();
        event.stopPropagation();
        const { deck = [], drawn = [], maxDrawSize = 3, locked = false } = this.actor.system.gambits;

        if (locked || drawn.length >= maxDrawSize || deck.length === 0) {
          ui.notifications.warn("Cannot draw more cards.");
          return;
        }

        const drawCount = Math.min(maxDrawSize - drawn.length, deck.length);
        const shuffled = shuffleArray(deck);

        const drawnNow = shuffled.slice(0, drawCount);
        const newDrawn = [...drawn, ...drawnNow];
        const newDeck  = deck.filter(id => !drawnNow.includes(id));

        await this.actor.update({
          "system.gambits.deck": newDeck,
          "system.gambits.drawn": newDrawn,
          "system.gambits.locked": true
        });
      });

      //Discard Gambit
      html.find(".discard-card").on("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const itemId = event.currentTarget.dataset.itemId;
        const parent = event.currentTarget.closest(".gambit-card");
        const source = parent?.dataset.source;

        if (!itemId || !source) return;

        const drawn = this.actor.system.gambits[source] ?? [];
        const discard = this.actor.system.gambits.discard ?? [];

        const updatedSource = drawn.filter(id => id !== itemId);
        const updatedDiscard = [...discard, itemId];

        await this.actor.update({
          [`system.gambits.${source}`]: updatedSource,
          "system.gambits.discard": updatedDiscard
        });
      });

      //Remove Card from Hand
      html.find(".remove-from-hand").on("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const itemId = event.currentTarget.dataset.itemId;
        const parent = event.currentTarget.closest(".gambit-card");
        const source = parent?.dataset.source;
        if (!itemId || !source) return;

        const update = {};
        const list = this.actor.system.gambits[source] ?? [];
        update[`system.gambits.${source}`] = list.filter(id => id !== itemId);

        await this.actor.update(update, { render: false });
        this.render(false);
      });

      //Making it so if you click moves in the Character sheet they post to chat!
      html.find(".post-move").on("click", event => {
        const name = event.currentTarget.dataset.moveName || "Unknown Move";
        const description = event.currentTarget.dataset.moveDescription || "";

        const chatContent = `
          <div class="chat-move">
            <h2><i class="fa-solid fa-hand-fist"></i> ${name}</h2>
            <p>${description}</p>
          </div>
        `;

        ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor: this.actor }),
          content: chatContent
        });
      });

      //Doing the same chat posting for Signature Perks
      html.find(".post-signature").on("click", async (event) => {
        const name = event.currentTarget.dataset.perkName;
        const description = event.currentTarget.dataset.perkDescription;

        const chatContent = `
          <div class="chat-move">
            <h2><i class="fa-solid fa-diamond"></i> Signature Perk: ${name}</h2>
            <p>${description}</p>
          </div>
        `;

        ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor: this.actor }),
          content: chatContent
        });
      });

      // Returning Gambits to Deck when removed
      html.find('.return-to-deck').on('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const itemId = event.currentTarget.dataset.itemId;
        if (!itemId) return;

        const { deck = [], drawn = [] } = this.actor.system.gambits;
        const updatedDeck = [...deck, itemId];
        const updatedDrawn = drawn.filter(id => id !== itemId);

        await this.actor.update({
          "system.gambits.deck": updatedDeck,
          "system.gambits.drawn": updatedDrawn
        }, { render: false });

        this.render(false);
      });

      // Handle dragstart
      html.find(".gambit-card").on("dragstart", event => {
        const itemId = event.currentTarget.dataset.itemId;
        const source = event.currentTarget.dataset.source;
        if (!itemId || !source) return;

        event.originalEvent.dataTransfer.setData(
          "text/plain",
          JSON.stringify({ itemId, source })
        );
      });

      // --- MG internal gambit drag/drop uses custom MIME to avoid clobbering Foundry drops ---
      const MG_GAMBIT_MIME = "application/x-midnightgambit-gambit";

      // When dragging a gambit card within the sheet, store MG-only payload
      html.find(".gambit-card[draggable='true']").off("dragstart.mgGambit").on("dragstart.mgGambit", function (event) {
        const $card = $(this);
        const itemId = $card.data("itemId");
        const source = $card.data("source"); // "deck" or "drawn"

        const payload = { itemId, source };
        event.originalEvent.dataTransfer.setData(MG_GAMBIT_MIME, JSON.stringify(payload));

        // Optional: also set a tiny plain-text fallback for browser UX (NOT used by logic)
        event.originalEvent.dataTransfer.setData("text/plain", "MG_GAMBIT");
      });

      // Helper: is this an internal MG gambit drag?
      const isMgGambitDrag = (event) => {
        const dt = event?.originalEvent?.dataTransfer;
        if (!dt) return false;
        // Some browsers expose types as DOMStringList
        const types = Array.from(dt.types ?? []);
        return types.includes(MG_GAMBIT_MIME);
      };

      // Handle drop on deck or drawn (ONLY for MG gambit drags)
      const handleDrop = (targetArea) => {
        return async (event) => {
          // If this isn't our internal gambit drag, do NOT intercept (let Foundry handle)
          if (!isMgGambitDrag(event)) return;

          event.preventDefault();
          event.stopPropagation();

          const raw = event.originalEvent.dataTransfer.getData(MG_GAMBIT_MIME);
          const data = raw ? JSON.parse(raw) : null;
          const { itemId, source } = data ?? {};

          if (!itemId || !source) return;
          if (source === targetArea) return;

          const deck = this.actor.system.gambits.deck ?? [];
          const drawn = this.actor.system.gambits.drawn ?? [];

          let from = source === "deck" ? deck : drawn;
          let to   = source === "deck" ? drawn : deck;

          const index = from.indexOf(itemId);
          if (index === -1) return;

          from = [...from];
          to   = [...to, itemId];
          from.splice(index, 1);

          await this.actor.update({
            "system.gambits.deck":  source === "deck" ? from : to,
            "system.gambits.drawn": source === "deck" ? to   : from
          });
        };
      };

      // Set hover class ONLY for MG gambit drags
      const setupDragHover = (containerSelector) => {
        const container = html.find(containerSelector);

        container.off(".mgGambitHover");

        container.on("dragenter.mgGambitHover", (e) => {
          if (!isMgGambitDrag(e)) return;
          e.preventDefault();
          e.stopPropagation();
          container.addClass("drag-hover");
        });

        container.on("dragover.mgGambitHover", (e) => {
          if (!isMgGambitDrag(e)) return;
          e.preventDefault();
          e.stopPropagation();
        });

        container.on("dragleave.mgGambitHover", (e) => {
          if (!container[0].contains(e.relatedTarget)) container.removeClass("drag-hover");
        });

        container.on("drop.mgGambitHover", (e) => {
          if (!isMgGambitDrag(e)) return;
          container.removeClass("drag-hover");
        });
      };

      // Add drag-hover support to both deck and hand
      setupDragHover(".gambit-deck");
      setupDragHover(".gambit-hand");

      // Register drop zones (only intercept MG gambit drags; Foundry drops pass through)
      html.find(".gambit-deck").off(".mgGambitDrop");
      html.find(".gambit-hand").off(".mgGambitDrop");

      html.find(".gambit-deck").on("dragover.mgGambitDrop", (e) => {
        if (!isMgGambitDrag(e)) return;
        e.preventDefault();
      });
      html.find(".gambit-hand").on("dragover.mgGambitDrop", (e) => {
        if (!isMgGambitDrag(e)) return;
        e.preventDefault();
      });

      html.find(".gambit-deck").on("drop.mgGambitDrop", handleDrop("deck"));
      html.find(".gambit-hand").on("drop.mgGambitDrop", handleDrop("drawn"));


      // Register drop zones
      html.find('.gambit-deck').on('dragover', e => e.preventDefault());
      html.find('.gambit-hand').on('dragover', e => e.preventDefault());
      html.find('.gambit-deck').on('drop', handleDrop("deck"));
      html.find('.gambit-hand').on('drop', handleDrop("drawn"));

      // Spark slot click logic
      html.find(".spark-dot").on("click", async (event) => {
        const el = event.currentTarget;
        const clicked = parseInt(el.dataset.value);
        const total = this.actor.system.sparkSlots ?? 0;
        const used = this.actor.system.sparkUsed ?? 0;
        const remaining = total - used;

        let newUsed;
        if (clicked > remaining) {
          // Fill up to clicked (refund/restore behavior)
          newUsed = total - clicked;
        } else {
          // Unfill clicked and right (spend behavior)
          newUsed = total - (clicked - 1);
        }

        // Safety clamp
        newUsed = Math.max(0, Math.min(total, newUsed));

        const spent = newUsed > used; // only true when you click a FILLED spark to spend it

        await this.actor.update({ "system.sparkUsed": newUsed });

        // Post chat message ONLY when spending Spark
        if (spent) {
          const chatContent = `
            <div class="chat-move">
              <h2><i class="fa-solid fa-dice-d10"></i> Spark has been used!</h2>
            </div>
          `;

          ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            content: chatContent
          });
        }

        this.render(false);
      });

      /**
       * Recalculate STRAIN CAPACITY from:
       * - Guise/Base capacity (system.baseStrainCapacity)
       * - Equipped gear buffer (item.system.remainingCapacity)
       * - Temp bonus buffer (system.strain.tempBonus)  -> shielding / corrections
       *
       * - Capacity is a buffer that counts DOWN first.
       * - The strain TRACK (dots) only fills once capacity hits 0.
       *
       * So:
       * - system.strain["mortal capacity"] / ["soul capacity"] = CURRENT remaining capacity (buffer)
       * - system.strain.mortal / .soul = TRACK damage (dots)
       * - system.strain.maxCapacity = derived max (for clamping + UI)
       */
      const recalcStrainFromGear = async ({ resetToMax = false } = {}) => {
        const actor = this.actor;
        if (!actor) return;

        // Ensure tempBonus exists (older actors won't have it)
        const tempBonus = actor.system?.strain?.tempBonus ?? { mortal: 0, soul: 0 };
        const tempM = Number(tempBonus.mortal ?? 0);
        const tempS = Number(tempBonus.soul ?? 0);

        const baseM = Number(actor.system.baseStrainCapacity?.mortal ?? 0);
        const baseS = Number(actor.system.baseStrainCapacity?.soul ?? 0);

        const gear = actor.items.filter(i =>
          ["armor", "misc"].includes(i.type) &&
          i.system.equipped &&
          i.system.capacityApplied
        );

        // Equipped buffer is literally what’s left on the items.
        const gearM = gear.reduce((sum, i) => sum + Number(i.system.remainingCapacity?.mortal ?? 0), 0);
        const gearS = gear.reduce((sum, i) => sum + Number(i.system.remainingCapacity?.soul ?? 0), 0);

        const maxM = Math.max(0, baseM + gearM + tempM);
        const maxS = Math.max(0, baseS + gearS + tempS);

        const curCapM = Number(actor.system?.strain?.["mortal capacity"] ?? 0);
        const curCapS = Number(actor.system?.strain?.["soul capacity"] ?? 0);

        const nextCapM = resetToMax ? maxM : Math.min(curCapM, maxM);
        const nextCapS = resetToMax ? maxS : Math.min(curCapS, maxS);

        // Track doesn't get touched here (it represents real strain once capacity is gone)
        // But we DO clamp negative/silly values for safety.
        const nextTrackM = Math.max(0, Number(actor.system?.strain?.mortal ?? 0));
        const nextTrackS = Math.max(0, Number(actor.system?.strain?.soul ?? 0));

        await actor.update({
          // Remaining buffer
          "system.strain.mortal capacity": nextCapM,
          "system.strain.soul capacity": nextCapS,

          // Derived max (used by UI + clamps)
          "system.strain.maxCapacity.mortal": maxM,
          "system.strain.maxCapacity.soul": maxS,

          // Track (unchanged, but sanitized)
          "system.strain.mortal": nextTrackM,
          "system.strain.soul": nextTrackS,

          // Protect from prepareData overwrite
          "system.strain.manualOverride.mortal capacity": true,
          "system.strain.manualOverride.soul capacity": true
        }, { render: false });
      };


      html.find(".long-rest-button").click(async () => {
        const actor = this.actor;

        const updates = {
          "system.sparkUsed": 0,
          "system.strain.mortal": 0,
          "system.strain.soul": 0,

          // Long Rest clears temporary shielding/corrections
          "system.strain.tempBonus.mortal": 0,
          "system.strain.tempBonus.soul": 0,

          "system.riskUsed": 0,
          "system.flashbackUsed": false
        };

        await actor.update(updates);

        // NOTE: Long Rest does *not* repair armor durability.
        // Armor/Misc remainingCapacity only recovers via the item's Repair button in Inventory.

        // Reset actor capacity buffer to Base + CURRENT equipped remainingCapacity (post-damage) + temp (now cleared)
        await recalcStrainFromGear({ resetToMax: true });

        await actor.prepareData();
        this.render(true);
        ui.notifications.info(`${actor.name} has completed a Long Rest.`);
      });

      //Checking if armor is damaged, if so it lowers on inventory
      const checkArmorDamage = async (actor, oldValue, newValue, type) => {
        if (newValue >= oldValue) return; // Only track damage
        console.log(`[ArmorCheck] ${type} damage taken: ${oldValue} → ${newValue}`);

        const capacityItems = actor.items.filter(item =>
          ["armor", "misc"].includes(item.type) &&
          item.system.equipped &&
          item.system.capacityApplied &&
          item.system.remainingCapacity?.[type] > 0
        );

        for (const item of capacityItems) {
          const remaining = item.system.remainingCapacity[type];
          if (remaining > 0) {
            await item.update({
              [`system.remainingCapacity.${type}`]: remaining - 1
            });

            console.log(`🛡️ ${item.name} absorbed 1 ${type} damage (now ${remaining - 1})`);
            break; // Only damage the first item that can take it
          }
        }
      };

      // Capacity tickers:
      // - Normal click: "-" spends capacity first, then fills the TRACK once capacity is 0
      // - Normal click: "+" heals the TRACK first, then restores capacity (up to max)
      // - Shift+click: adjusts TEMP MAX capacity (shielding / corrections)
      html.find(".capacity-controls .cap-tick").on("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const btn = event.currentTarget;
        const controls = btn.closest(".capacity-controls");
        const type = controls?.dataset?.type; // "mortal" | "soul"
        if (!type) return;

        const dir = Number(btn.dataset.dir || 0); // -1 or +1
        if (!dir) return;

        const actor = this.actor;
        if (!actor) return;

        const capKey = `${type} capacity`; // remaining buffer

        const getMax = () => {
          // Prefer cached derived value (set by recalcStrainFromGear)
          const cached = Number(actor.system?.strain?.maxCapacity?.[type] ?? NaN);
          if (Number.isFinite(cached)) return cached;

          // Fallback: derive on the fly
          const base = Number(actor.system?.baseStrainCapacity?.[type] ?? 0);
          const temp = Number(actor.system?.strain?.tempBonus?.[type] ?? 0);
          const gear = actor.items.filter(i =>
            ["armor", "misc"].includes(i.type) &&
            i.system.equipped &&
            i.system.capacityApplied
          );
          const gearSum = gear.reduce((sum, i) => sum + Number(i.system.remainingCapacity?.[type] ?? 0), 0);
          return Math.max(0, base + temp + gearSum);
        };

        const getCap = () => Number(actor.system?.strain?.[capKey] ?? 0);
        const getTrack = () => Number(actor.system?.strain?.[type] ?? 0);

        const patchUI = () => {
          const cap = getCap();
          const track = getTrack();

          const $track = html.find(`.strain-track[data-strain="${type}"]`);
          $track.find(".strain-dot").each((_, node) => {
            const v = Number(node.dataset.value);
            node.classList.toggle("filled", v <= track);
          });

          const valEl = html.find(`.capacity-value[data-type="${type}"]`)[0];
          if (valEl) valEl.textContent = String(Math.max(0, cap));

          // Optional max labels if you have them
          const maxEl = html[0]?.querySelector(`.capacity-max[data-type='${type}']`);
          if (maxEl) maxEl.textContent = String(getMax());
        };

        // SHIFT+CLICK = TEMP MAX capacity adjust
        if (event.shiftKey) {
          const path = `system.strain.tempBonus.${type}`;
          const curTemp = Number(actor.system?.strain?.tempBonus?.[type] ?? 0);
          const nextTemp = dir > 0 ? (curTemp + 1) : Math.max(0, curTemp - 1);

          await actor.update({ [path]: nextTemp }, { render: false });
          await recalcStrainFromGear({ resetToMax: false });

          // When temp bonus goes UP, it should immediately grant 1 capacity.
          if (dir > 0) {
            const max = getMax();
            const nextCap = Math.min(max, getCap() + 1);
            await actor.update({ [`system.strain.${capKey}`]: nextCap }, { render: false });
          }

          patchUI();
          return;
        }

        // NORMAL CLICK behavior
        const max = getMax();
        let cap = getCap();
        let track = getTrack();

        // DAMAGE
        if (dir < 0) {
          if (cap > 0) {
            const nextCap = Math.max(0, cap - 1);

            // If an equipped armor/misc item is providing capacity, tick its remainingCapacity down
            await checkArmorDamage(actor, cap, nextCap, type);

            // Recompute max from gear AFTER item durability changes (keeps max labels + math correct)
            await recalcStrainFromGear({ resetToMax: false });

            // Now spend the actor’s remaining capacity buffer
            await actor.update({ [`system.strain.${capKey}`]: nextCap }, { render: false });

            patchUI();
            return;
          }

          // Capacity is 0: now we fill the TRACK.
          const dotCount = html.find(`.strain-track[data-strain="${type}"] .strain-dot`).length;
          const trackMax = Math.max(0, dotCount);
          const nextTrack = Math.min(trackMax, track + 1);
          await actor.update({ [`system.strain.${type}`]: nextTrack }, { render: false });
          patchUI();
          return;
        }

        // HEAL
        if (dir > 0) {
          // IMPORTANT RULE:
          // Track should ONLY heal from "+" when capacity is 0.
          // This preserves "Piercing" scenarios where you can have track damage while still gaining capacity.
          if (cap <= 0 && track > 0) {
            const nextTrack = Math.max(0, track - 1);
            await actor.update({ [`system.strain.${type}`]: nextTrack }, { render: false });
            patchUI();
            return;
          }

          // Otherwise, "+" only adds capacity (even if track > 0).
          // Capacity should never be "hard capped" for play (shielding, buffs, fixing mistakes).
          // If we're already at the current derived max, auto-increase tempBonus so max grows too.
          if (cap >= max) {
            const curTemp = Number(actor.system?.strain?.tempBonus?.[type] ?? 0);
            await actor.update({ [`system.strain.tempBonus.${type}`]: curTemp + 1 }, { render: false });

            // Recompute derived max (base + gear + temp), but DON'T reset buffer.
            await recalcStrainFromGear({ resetToMax: false });

            const maxAfter = getMax();
            const capAfter = getCap();
            const nextCap = Math.min(maxAfter, capAfter + 1);

            await actor.update({ [`system.strain.${capKey}`]: nextCap }, { render: false });
            patchUI();
            return;
          }

          // Otherwise, just restore buffer up to the current max.
          const nextCap = Math.min(max, cap + 1);
          await actor.update({ [`system.strain.${capKey}`]: nextCap }, { render: false });
          patchUI();
          return;
        }
      });

      // Update the capacity ticker numbers without re-rendering the sheet
      const updateCapacityTickerUI = (html, actor) => {
        const strain = actor.system?.strain ?? {};

        const capM = Number(strain["mortal capacity"] ?? 0);
        const capS = Number(strain["soul capacity"] ?? 0);

        const maxM = Number(strain?.maxCapacity?.mortal ?? 0);
        const maxS = Number(strain?.maxCapacity?.soul ?? 0);

        const mcEl =
          html[0].querySelector(".capacity-ticker[data-type='mortal'] .capacity-value") ||
          html[0].querySelector("[data-capacity='mortal'] .capacity-value") ||
          html[0].querySelector(".capacity-value[data-type='mortal']");

        const scEl =
          html[0].querySelector(".capacity-ticker[data-type='soul'] .capacity-value") ||
          html[0].querySelector("[data-capacity='soul'] .capacity-value") ||
          html[0].querySelector(".capacity-value[data-type='soul']");

        if (mcEl) mcEl.textContent = String(Math.max(0, capM));
        if (scEl) scEl.textContent = String(Math.max(0, capS));

        const mcMaxEl = html[0].querySelector(".capacity-max[data-type='mortal']");
        const scMaxEl = html[0].querySelector(".capacity-max[data-type='soul']");
        if (mcMaxEl) mcMaxEl.textContent = String(Math.max(0, maxM));
        if (scMaxEl) scMaxEl.textContent = String(Math.max(0, maxS));
      };

      // Remove guise button (supports multiple guises + cleans up injected moves/perks)
      html.find(".remove-guise").on("click", async (event) => {
        event.preventDefault();

        const actor = this.actor;

        // All embedded Guise items on this actor
        const guises = actor.items.filter(i => i.type === "guise");
        if (!guises.length) {
          ui.notifications?.warn("No Guises found on this actor.");
          return;
        }

        // Primary refs (you’ve had multiple shapes historically)
        const primaryRef = actor.system?.guiseId || actor.system?.guise || null;

        const primaryGuise =
          guises.find(g => g.id === primaryRef) ||
          guises.find(g => g.uuid === primaryRef) ||
          null;

        const options = guises.map(g => {
          const isPrimary = primaryGuise && g.id === primaryGuise.id;
          const label = isPrimary ? `${g.name} (Primary)` : g.name;
          return `<option value="${g.id}">${label}</option>`;
        }).join("");

        const pickerHtml = (guises.length > 1)
          ? `
            <p>Select which Guise to remove:</p>
            <div class="form-group">
              <label>Guise</label>
              <select name="mgGuiseToRemove">${options}</select>
            </div>
          `
          : `<p>Remove Guise: <strong>${guises[0].name}</strong> ?</p>`;

        let removeId = guises[0].id;

        const confirmed = await Dialog.wait({
          title: "Remove Guise?",
          content: `
            ${pickerHtml}
            <p>This will remove the selected Guise item and also delete any Signature Perk / Moves that were added from it.</p>
          `,
          buttons: {
            yes: {
              label: "Remove",
              callback: (html) => {
                // IMPORTANT: read from the dialog HTML, not the sheet
                const sel = html?.find?.('select[name="mgGuiseToRemove"]')?.val?.();
                if (sel) removeId = sel;
                return true;
              }
            },
            no: { label: "Cancel", callback: () => false }
          },
          default: "no"
        });

        if (!confirmed) return;

        const targetGuise = guises.find(g => g.id === removeId);
        if (!targetGuise) {
          ui.notifications?.error("Could not resolve the selected Guise.");
          return;
        }

        const targetIsPrimary = primaryGuise && (targetGuise.id === primaryGuise.id);

        // Helper: delete any injected moves/perks that came from a given Guise ID
        const deleteInjectedFromGuiseId = async (guiseId) => {
          const injected = actor.items.filter(i =>
            i.type === "move" &&
            (
              // your secondary-injection pattern
              i.system?.fromSecondaryGuise === true &&
              i.system?.guiseSource === guiseId
            )
          );

          if (injected.length) {
            await actor.deleteEmbeddedDocuments("Item", injected.map(i => i.id));
          }
        };

        // 1) Delete injected moves/perks from the target guise
        await deleteInjectedFromGuiseId(targetGuise.id);

        // 2) Delete the guise itself
        await actor.deleteEmbeddedDocuments("Item", [targetGuise.id]);

        // Current system lists
        const secondary = Array.isArray(actor.system?.secondaryGuises)
          ? [...actor.system.secondaryGuises]
          : [];

        const movesGuiseId = actor.system?.movesGuiseId ?? null;

        // 3) Update system state depending on what got removed
        if (!targetIsPrimary) {
          // Removing SECONDARY
          const nextSecondary = secondary.filter(id => id !== targetGuise.id);

          // If we were rendering moves from the removed secondary, fall back to primary
          const nextMovesGuiseId =
            (movesGuiseId === targetGuise.id)
              ? (primaryGuise?.id ?? null)
              : movesGuiseId;

          await actor.update({
            "system.secondaryGuises": nextSecondary,
            "system.movesGuiseId": nextMovesGuiseId
          });

          ui.notifications?.info(`Removed secondary Guise: ${targetGuise.name}`);
          this.render(true);
          return;
        }

        // Removing PRIMARY
        // Recompute remaining guises after deletion
        const remainingGuises = actor.items.filter(i => i.type === "guise");
        if (!remainingGuises.length) {
          // No guises left
          await actor.update({
            "system.guiseId": null,
            "system.guise": null,
            "system.movesGuiseId": null,
            "system.secondaryGuises": []
          });

          ui.notifications?.info(`Removed primary Guise: ${targetGuise.name}`);
          this.render(true);
          return;
        }

        // Choose a remaining guise to become new primary
        // Prefer one that used to be in secondaryGuises, otherwise first remaining
        const preferred =
          remainingGuises.find(g => secondary.includes(g.id)) ||
          remainingGuises[0];

        // IMPORTANT: if that preferred guise had injected “secondary” moves,
        // delete them now so we don’t render them twice after promotion.
        await deleteInjectedFromGuiseId(preferred.id);

        // Remove promoted guise from secondary list (it’s primary now)
        const nextSecondary = secondary.filter(id => id !== preferred.id);

        await actor.update({
          // keep primary refs canonical: embedded item ids only
          "system.guiseId": preferred.id,
          "system.guise": preferred.id,
          "system.movesGuiseId": preferred.id,
          "system.secondaryGuises": nextSecondary
        });

        ui.notifications?.info(`Removed primary Guise: ${targetGuise.name}. Promoted: ${preferred.name}`);
        this.render(true);
      });

      // -------------------------
      // Settings tab: Final Resource inputs (Risk for now)
      // -------------------------
      const commitFinalResource = async (inputEl) => {
        const res = inputEl.dataset.resource;
        const derived = Number(inputEl.dataset.derived);
        const next = Number(inputEl.value);

        if (!Number.isFinite(next) || next < 0) {
          if (res === "riskDice") {
            inputEl.value = String(this.actor.system?.riskDice ?? derived ?? 5);
          } else if (res === "sparkSlots") {
            inputEl.value = String(this.actor.system?.sparkSlots ?? derived ?? 0);
          } else if (res === "stoValue") {
            inputEl.value = String(this.actor.system?.sto?.value ?? 0);
          }
          return;
        }

        if (res === "riskDice") {
          const bonus = next - derived;
          await this.actor.update({
            "system.actorSettings.riskDiceBonus": bonus
          });
        }

        if (res === "sparkSlots") {
          const bonus = next - derived;
          await this.actor.update({
            "system.actorSettings.sparkSlotsBonus": bonus
          });
        }

        if (res === "stoValue") {
          const safe = Math.max(0, next);
          await this.actor.update({
            "system.sto.value": safe
          });
        }

        this.render(false);
      };

      html.find(".mg-final-resource")
        .off("change.mgFinalResource")
        .on("change.mgFinalResource", async (ev) => {
          ev.preventDefault();
          await commitFinalResource(ev.currentTarget);
        })
        .off("keydown.mgFinalResource")
        .on("keydown.mgFinalResource", async (ev) => {
          if (ev.key !== "Enter") return;
          ev.preventDefault();
          await commitFinalResource(ev.currentTarget);
      });

      html.find(".mg-reset-resource")
        .off("click.mgResetResource")
        .on("click.mgResetResource", async (ev) => {
          ev.preventDefault();
          const btn = ev.currentTarget;
          const res = btn.dataset.resource;

          if (res === "riskDice") {
            await this.actor.update({ "system.actorSettings.riskDiceBonus": 0 });
          }

          if (res === "sparkSlots") {
            await this.actor.update({ "system.actorSettings.sparkSlotsBonus": 0 });
          }

          if (res === "stoValue") {
            await this.actor.update({ "system.sto.value": 0 });
          }

          this.render(false);
      });

      // -------------------------
      // Settings tab: swap primary guise (toggle UI)
      // -------------------------
      html.find(".mg-primary-toggle")
        .off("click.mgPrimaryGuise")
        .on("click.mgPrimaryGuise", async (ev) => {
          ev.preventDefault();

          const clicked = ev.currentTarget;
          const newPrimaryId = clicked.dataset.guiseId;
          if (!newPrimaryId) return;

          const normalizeGuiseRefToId = (ref) => {
            if (!ref) return null;

            const byId = this.actor.items.get(ref);
            if (byId?.type === "guise") return byId.id;

            const byUuid = this.actor.items.find(i => i.type === "guise" && i.uuid === ref);
            if (byUuid) return byUuid.id;

            return null;
          };

          const currentPrimaryId = normalizeGuiseRefToId(this.actor.system?.guiseId || this.actor.system?.guise);
          const currentSecondary = (Array.isArray(this.actor.system?.secondaryGuises) ? this.actor.system.secondaryGuises : [])
            .map(normalizeGuiseRefToId)
            .filter(Boolean);

          // Already primary → do nothing
          if (newPrimaryId === currentPrimaryId) return;

          // Safety: only allow owned guise ids
          const allGuiseIds = this.actor.items
            .filter(i => i.type === "guise")
            .map(i => i.id);

          if (!allGuiseIds.includes(newPrimaryId)) {
            ui.notifications?.warn("That Guise is not owned by this actor.");
            return;
          }

          // Build next secondary list
          let nextSecondary = currentSecondary.filter(id => id !== newPrimaryId);

          if (currentPrimaryId && currentPrimaryId !== newPrimaryId && !nextSecondary.includes(currentPrimaryId)) {
            nextSecondary.unshift(currentPrimaryId);
          }

          // Max 2 guises total: keep one secondary
          nextSecondary = nextSecondary.slice(0, 1);

          // Prevent spam-clicking during transition
          const wrap = clicked.closest(".mg-guise-toggle-list");
          const toggles = wrap ? Array.from(wrap.querySelectorAll(".mg-primary-toggle")) : [];
          toggles.forEach(btn => btn.disabled = true);

          // --- Optimistic UI update first so CSS transition can actually run ---
          toggles.forEach(btn => {
            btn.classList.remove("is-on");
            btn.classList.add("is-off");
            btn.setAttribute("aria-pressed", "false");
          });

          clicked.classList.remove("is-off");
          clicked.classList.add("is-on");
          clicked.setAttribute("aria-pressed", "true");

          // Let the browser paint the class change, then give the transition a moment
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          await new Promise(resolve => setTimeout(resolve, 160));

          try {
            await this.actor.update({
              "system.guise": newPrimaryId,
              "system.guiseId": newPrimaryId,
              "system.secondaryGuises": nextSecondary
            });
            // Do NOT manually call this.render(true) here.
            // The actor update will refresh the sheet state.
          } finally {
            toggles.forEach(btn => btn.disabled = false);
          }
        });

      //Attribute Roll Logic and Base Edit
      html.find(".attribute-modifier").on("contextmenu", async (event) => {
        event.preventDefault();

        const el  = event.currentTarget;
        const key = el.dataset.key;
        const current = Number(el.getAttribute("data-base")) || 0;

        const val = await this._mgPrompt({
          title: `Edit ${key}`,
          bodyHtml: `<label>Base ${key}: <input type="number" value="${current}" name="value" /></label>`,
          okText: "Save",
          okIcon: "fa-floppy-disk",
          cancelText: "Cancel",
          cancelIcon: "fa-circle-xmark",
          getValue: (html) => html.find('input[name="value"]').val()
        });

        if (val === null) return;

        const next = Number(val);
        if (!Number.isFinite(next)) {
          ui.notifications.warn("Please enter a valid number.");
          return;
        }

        await this.actor.update({ [`system.baseAttributes.${key}`]: next }, { render: false });

        // Reflect immediately in the open sheet (no re-render)
        el.setAttribute("data-base", String(next));
        el.textContent = next >= 0 ? `+${next}` : `${next}`;
      });

      html.find(".attribute-modifier").on("click", async (event) => {
        const attrKey = event.currentTarget.dataset.key;

        const baseAttrMod = Number(this.actor.system.attributes?.[attrKey] ?? 0);
        const tempAttrMod = Number(this.actor.system.tempAttributeBonuses?.[attrKey] ?? 0);

        const aura = this._getActiveAuraPenalty(attrKey);
        const auraAttrMod = Number(aura.value ?? 0);

        // Aura should NOT change the dice pool anymore
        const finalAttrMod = baseAttrMod + tempAttrMod;

        const pool = 2 + Math.abs(finalAttrMod);
        const rollType = finalAttrMod >= 0 ? "kh2" : "kl2";
        const formula = `${pool}d6${rollType}`;

        const edge = !!this.actor.system.edgeNext;

        await evaluateRoll({
          formula,
          skillMod: auraAttrMod,
          modifierParts: [auraAttrMod],
          modifierBreakdown: auraAttrMod !== 0 ? [
            {
              key: "aura",
              label: aura.label || "Aura Modifier",
              icon: "fa-eye-evil",
              value: auraAttrMod
            }
          ] : [],
          label: `Attr Roll: ${attrKey.charAt(0).toUpperCase() + attrKey.slice(1)}`,
          actor: this.actor,
          edge,
          auraLabel: aura.label,
          auraAttrMod,
          auraSourceActorId: aura.sourceActorId,
          auraSourceTokenId: aura.sourceTokenId,
          auraIconClass: "fa-eye-evil"
        });

        if (edge) {
          await this.actor.update({ "system.edgeNext": false }, { render: false });
          const btn = html.find(".mg-edge-toggle")[0];
          if (btn) btn.classList.remove("is-active");
        }
      });
      
      // Handle disabling duplicate spark school selections
      const select1 = html.find("#spark-school-1");
      const select2 = html.find("#spark-school-2");

      // Update options to prevent duplicate selection
      function updateSparkOptions() {
        const val1 = select1.val();
        const val2 = select2.val();

        // Reset all options to enabled
        select1.find("option").prop("disabled", false);
        select2.find("option").prop("disabled", false);

        // Disable selected option in the opposite select
        if (val2) {
          select1.find(`option[value="${val2}"]`).prop("disabled", true);
        }
        if (val1) {
          select2.find(`option[value="${val1}"]`).prop("disabled", true);
        }
      }

      // Attach listeners
      select1.on("change", updateSparkOptions);
      select2.on("change", updateSparkOptions);

      // Run it once on render to sync state
      updateSparkOptions();

      //Adding Skill rolling logic based off Attributes + and adding Skill +
      const skillAttributeMap = {
        brawl: "tenacity", endure: "tenacity", athletics: "tenacity",
        aim: "finesse", stealth: "finesse", sleight: "finesse",
        will: "resolve", grit: "resolve", composure: "resolve",
        lore: "guile", investigate: "guile", deceive: "guile",
        survey: "instinct", hunt: "instinct", nature: "instinct",
        command: "presence", charm: "presence", perform: "presence",

        // Spark: still mapped for now until we implement Guise casting attribute
        spark: "guile"
      };


      const skillAttributeDisplay = {
        brawl: "Ten", endure: "Ten", athletics: "Ten",
        aim: "Fin", stealth: "Fin", sleight: "Fin",
        will: "Res", grit: "Res",
        lore: "Gui", investigate: "Gui", deceive: "Gui", spark: "Gui",
        survey: "Ins", hunt: "Ins", nature: "Ins",
        command: "Pre", charm: "Pre", perform: "Pre"
      };

      const skillLabels = {
        brawl: "Brawl",
        endure: "Endure",
        athletics: "Athletics",
        aim: "Aim",
        stealth: "Stealth",
        sleight: "Sleight",
        will: "Will",
        grit: "Grit",
        composure: "Composure",
        lore: "Lore",
        investigate: "Investigate",
        deceive: "Deceive",
        survey: "Survey",
        hunt: "Hunt",
        nature: "Nature",
        command: "Command",
        charm: "Charm",
        perform: "Perform",
        spark: "Spark"
      };

      html.find(".mg-temp-skill-bonuses")
        .off("click.mgTempSkillBonuses")
        .on("click.mgTempSkillBonuses", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await this._mgOpenTempSkillBonusesDialog();
        });      

      html.find(".skill-name, .skill-value")
        .off("click.mgSkillRoll")
        .on("click.mgSkillRoll", async (event) => {
          event.preventDefault();
          event.stopPropagation();

          const skillKey = event.currentTarget.dataset.key;
          if (!skillKey) return;

          const baseSkillMod = Number(this.actor.system.skills?.[skillKey] ?? 0);
          const tempSkillMod = Number(this.actor.system.tempSkillBonuses?.[skillKey] ?? 0);

          let attrKey = skillAttributeMap[skillKey];

          // Spark is Guise-dependent
          if (skillKey === "spark") {
            attrKey = this.actor.system.sparkAttribute ?? "guile";
          }

          const baseAttrMod = Number(this.actor.system.attributes?.[attrKey] ?? 0);
          const tempAttrMod = Number(this.actor.system.tempAttributeBonuses?.[attrKey] ?? 0);

          const aura = this._getActiveAuraPenalty(attrKey);
          const auraAttrMod = Number(aura.value ?? 0);

          // Aura is now a flat final modifier, not dice-pool pressure
          const finalAttrMod = baseAttrMod + tempAttrMod;
          const finalSkillMod = baseSkillMod + tempSkillMod + auraAttrMod;

          const pool = 2 + Math.abs(finalAttrMod);
          const rollType = finalAttrMod >= 0 ? "kh2" : "kl2";
          const formula = `${pool}d6${rollType}`;

          const edge = !!this.actor.system.edgeNext;
          const skillLabel = skillLabels[skillKey] ?? skillKey;

          const bonusText =
            (tempSkillMod !== 0 || auraAttrMod !== 0)
              ? ` (${baseSkillMod >= 0 ? "+" : ""}${baseSkillMod} base, ${tempSkillMod >= 0 ? "+" : ""}${tempSkillMod} temp${auraAttrMod !== 0 ? `, ${auraAttrMod >= 0 ? "+" : ""}${auraAttrMod} aura` : ""})`
              : "";

          await evaluateRoll({
            formula,
            skillMod: finalSkillMod,
            modifierParts: [baseSkillMod, tempSkillMod, auraAttrMod],
            modifierBreakdown: [
              {
                key: "skill",
                label: "Skill Bonus",
                icon: "fa-user-plus",
                value: baseSkillMod
              },
              {
                key: "temp",
                label: "Temporary Bonus",
                icon: "fa-handshake-angle",
                value: tempSkillMod
              },
              {
                key: "aura",
                label: aura.label || "Aura Modifier",
                icon: "fa-eye-evil",
                value: auraAttrMod
              }
            ],
            label: `Skill Roll: ${skillLabel}`,
            actor: this.actor,
            edge,
            auraLabel: aura.label,
            auraAttrMod,
            auraSourceActorId: aura.sourceActorId,
            auraSourceTokenId: aura.sourceTokenId
          });

          if (edge) {
            await this.actor.update({ "system.edgeNext": false }, { render: false });
            const btn = html.find(".mg-edge-toggle")[0];
            if (btn) btn.classList.remove("is-active");
          }
      });
      
      // Skill base edit (numeric-safe, manual UI refresh)
      html.find(".skill-value").on("contextmenu", async (event) => {
        event.preventDefault();

        const el   = event.currentTarget;
        const key  = el.dataset.key;
        const curr = Number(el.getAttribute("data-base")) || 0;

        const val = await this._mgPrompt({
          title: `Edit Skill: ${key}`,
          bodyHtml: `<label>${key}: <input type="number" value="${curr}" name="value" /></label>`,
          okText: "Save",
          okIcon: "fa-floppy-disk",
          cancelText: "Cancel",
          cancelIcon: "fa-circle-xmark",
          getValue: (html) => html.find('input[name="value"]').val()
        });

        if (val === null) return;

        const next = Number(val);
        if (!Number.isFinite(next)) {
          ui.notifications.warn("Please enter a valid number.");
          return;
        }

        // Save without rerender (prevents mobile jump)
        await this.actor.update({ [`system.skills.${key}`]: next }, { render: false });

        // Reflect immediately in the open sheet
        el.setAttribute("data-base", String(next));
        el.textContent = String(next);              // or: (next >= 0 ? `+${next}` : `${next}`)
      });

      // Setting values before Foundry Sheet refresh - Fixes Mortal and Soul Capacity
      html.find("input").on("keydown", async (event) => {
        if (event.key !== "Enter") return;

        const input = event.currentTarget;

        if (input.classList.contains("item-search")) return;

        const name  = input.name ?? "";
        const value = parseInt(input.value, 10);

        const updates = {};

        if (name === "system.strain.mortal capacity") {
          updates["system.strain.manualOverride.mortal capacity"] = true;
          updates["system.strain.mortal capacity"] = value;
        } else if (name === "system.strain.soul capacity") {
          updates["system.strain.manualOverride.soul capacity"] = true;
          updates["system.strain.soul capacity"] = value;
        }

        // If this input doesn't map to a known override, don't do anything
        if (Object.keys(updates).length === 0) return;

        event.preventDefault();

        await this.actor.update(updates, { render: false });
        this.render(false);
        input.blur();
      });

      html.find(".item-quantity").on("change", async (event) => {
        const itemId = event.currentTarget
          .closest(".inventory-card, .inventory-item")
          ?.dataset?.itemId;

        if (!itemId) return;

        const quantity = parseInt(event.currentTarget.value);
        const item = this.actor.items.get(itemId);
        if (item) await item.update({ "system.quantity": quantity });
      });

      // --- Equip toggle (inventory-card) ---
      const handleEquipToggle = async (event) => {
        const card = event.currentTarget.closest(".inventory-card");
        if (!card) return;

        const itemId =
          card.dataset.itemId ||
          event.currentTarget.dataset.itemId; // fallback if you ever put data-item-id on the checkbox

        if (!itemId) return;

        const item = this.actor.items.get(itemId);
        if (!item) return;

        const cb = card.querySelector("input.item-equipped[type='checkbox']");
        const equipped = cb ? cb.checked : !Boolean(item.system.equipped);

        await item.update({ "system.equipped": equipped }, { render: false });

        // keep UI synced
        if (cb) cb.checked = equipped;

        const grantsCapacity =
          ["armor", "misc"].includes(item.type) &&
          ((item.system.mortalCapacity ?? 0) > 0 || (item.system.soulCapacity ?? 0) > 0);

        if (grantsCapacity) {
          if (equipped) {
            await item.update({
              "system.capacityApplied": true,
              "system.remainingCapacity.mortal": item.system.mortalCapacity ?? 0,
              "system.remainingCapacity.soul": item.system.soulCapacity ?? 0
            }, { render: false });
          } else {
            await item.update({ "system.capacityApplied": false }, { render: false });
          }

          // this is what should make your ticker number change
          await recalcStrainFromGear({ resetToMax: equipped });
        }

        // Update the UI in-place (no full sheet rerender)
        updateCapacityTickerUI(html, this.actor);
      };

      // Only listen in ONE place.
      // Checkbox changes:
      html.on("change", "input.item-equipped[type='checkbox']", handleEquipToggle);

      // Fancy equip UI clicks (add/remove selectors as needed):
      html.on("click", ".item-equip, .item-equip-toggle, .equip-toggle, .item-equipped-label", handleEquipToggle);

      // Favorite changes (no sheet rerender)
      html.on("change", ".item-favorite", async (event) => {
        const card = event.currentTarget.closest(".inventory-card");
        if (!card) return;

        const itemId = card.dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;

        const isFav = !!event.currentTarget.checked;

        // Save without rerender
        await item.update({ "system.favorite": isFav }, { render: false });

        // Live DOM move (only works if you have these containers)
        const $tab = html.find(".tab-inventory");

        const favBody = $tab.find('.inventory-bucket-body[data-bucket="favorites"]')[0];
        const bucket =
          item.type === "weapon" ? "weapons" :
          item.type === "armor"  ? "armor"   :
          "misc";

        const targetBody = isFav
          ? favBody
          : $tab.find(`.inventory-bucket-body[data-bucket="${bucket}"]`)[0];

        // If we can’t find your bucket bodies, just stop here (state still saves)
        if (!targetBody) return;

        targetBody.appendChild(card);
      });

      // Favorite toggle (moves card between buckets, no sheet rerender)
      html.find(".item-favorite").on("change", async (event) => {
        const card = event.currentTarget.closest(".inventory-card, .inventory-item");
        const itemId = card?.dataset?.itemId;
        if (!itemId) return;

        const item = this.actor.items.get(itemId);
        if (!item) return;

        const isFav = !!event.currentTarget.checked;

        // Save data without rerender
        await item.update({ "system.favorite": isFav }, { render: false });

        // ---- DOM MOVE (no rerender) ----
        const root = html.find(".tab-inventory")[0];
        if (!root) return;

        const normalizeKey = (s) =>
          String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

        // Your title keys are usually "Favorites", "Weapons", "Armor", "Misc"
        const typeToBucketKey = (t) => {
          const tt = normalizeKey(t);
          if (tt === "weapon") return "weapons";
          if (tt === "weapons") return "weapons";
          if (tt === "armor") return "armor";
          if (tt === "misc") return "misc";
          return tt;
        };

        const getBucketTitleByKey = (key) => {
          const titles = Array.from(root.querySelectorAll(".inventory-bucket-title"));
          const want = normalizeKey(key);

          return titles.find((el) => {
            const explicit = normalizeKey(el.dataset?.bucketKey || el.getAttribute?.("data-bucket-key"));
            const text = normalizeKey(el.textContent);
            return explicit === want || text === want;
          });
        };

        // Your bucket-toggle code wraps cards into .inventory-bucket-body.
        // This makes sure the wrapper exists, even if something changed.
        const ensureBucketBody = (titleEl) => {
          if (!titleEl) return null;

          let next = titleEl.nextElementSibling;
          if (next && next.classList?.contains("inventory-bucket-body")) return next;

          const body = document.createElement("div");
          body.classList.add("inventory-bucket-body", "inventory-grid");
          body.style.width = "100%";
          body.style.overflow = "hidden";
          titleEl.insertAdjacentElement("afterend", body);

          // Move everything until next title into body
          next = body.nextElementSibling;
          while (next && !next.classList.contains("inventory-bucket-title")) {
            const move = next;
            next = next.nextElementSibling;
            body.appendChild(move);
          }
          return body;
        };

        const destKey = isFav ? "favorites" : typeToBucketKey(item.type);
        const destTitle = getBucketTitleByKey(destKey);
        const destBody = ensureBucketBody(destTitle);

        if (!destBody) return;

        // Move the existing card node (no duplication)
        destBody.appendChild(card);

        // Optional: keep search behavior consistent if you're currently searching
        // (doesn't rerender; just re-applies existing hidden classes if you use them)
        const q = (root.querySelector(".item-search")?.value || "").trim();
        if (q.length) {
          // If your search function relies on classes, it’s already applied.
          // Leaving this blank on purpose to avoid re-triggering your animation pipeline.
        }
      });

      //Repair Armor
      html.find(".repair-armor").on("click", async (event) => {
        const itemId = event.currentTarget.dataset.itemId;
        const item = this.actor.items.get(itemId);

        const isRepairable =
          item &&
          ["armor", "misc"].includes(item.type) &&
          (Number(item.system.mortalCapacity) > 0 || Number(item.system.soulCapacity) > 0);

        // Only equipped gear contributes to capacity and can be repaired for the live sheet effect
        if (!isRepairable || !item.system.equipped) return;

        const mortalCapacity = Number(item.system.mortalCapacity ?? 0);
        const soulCapacity = Number(item.system.soulCapacity ?? 0);

        const remainingMC = Number(item.system.remainingCapacity?.mortal ?? 0);
        const remainingSC = Number(item.system.remainingCapacity?.soul ?? 0);

        const deltaMC = Math.max(0, mortalCapacity - remainingMC);
        const deltaSC = Math.max(0, soulCapacity - remainingSC);

        const isDamaged = deltaMC > 0 || deltaSC > 0;
        if (!isDamaged) {
          ui.notifications.info(`${item.name} is already fully repaired.`);
          return;
        }

        // 1) Restore the item's own durability
        await item.update(
          {
            "system.remainingCapacity.mortal": mortalCapacity,
            "system.remainingCapacity.soul": soulCapacity,
            "system.capacityApplied": true
          },
          { render: false }
        );

        ui.notifications.info(`${item.name} repaired. Durability restored.`);

        // 2) Recalculate derived capacity (base + CURRENT equipped remainingCapacity)
        // NOTE: This should NOT heal track; it only updates maxCapacity bookkeeping.
        await recalcStrainFromGear({ resetToMax: false });

        // 3) Live update the actor's *current* capacity buffer by the amount repaired.
        // This is why the player shouldn't need to Rest to see the armor capacity come back.
        const updates = {};
        if (deltaMC > 0) {
          const capKey = "mortal capacity";
          const cur = Number(this.actor.system?.strain?.[capKey] ?? 0);
          const max = Number(this.actor.system?.strain?.maxCapacity?.mortal ?? (cur + deltaMC));
          updates[`system.strain.${capKey}`] = Math.min(max, cur + deltaMC);
        }
        if (deltaSC > 0) {
          const capKey = "soul capacity";
          const cur = Number(this.actor.system?.strain?.[capKey] ?? 0);
          const max = Number(this.actor.system?.strain?.maxCapacity?.soul ?? (cur + deltaSC));
          updates[`system.strain.${capKey}`] = Math.min(max, cur + deltaSC);
        }

        if (Object.keys(updates).length) {
          await this.actor.update(updates, { render: false });
        }

        this.render(false);
      });

      //Remove item from Inventory
      html.find(".item-delete").on("click", async (event) => {
        const itemId = event.currentTarget.dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;

        const confirmed = await Dialog.wait({
          title: `Delete ${item.name}?`,
          content: `
            <h2>Delete ${item.name}?</h2>
            <p>Are you sure you want to permanently delete <strong>${item.name}</strong> from your inventory?</p>
          `,
          buttons: {
            yes: { label: this._mgBtn("Delete", "fa-trash"), callback: () => true },
            no:  { label: this._mgBtn("Cancel", "fa-circle-xmark"), callback: () => false }
          },
          default: "no"
        });

        if (confirmed) {
          await item.delete();
        }
      });

      // Posting Inventory Items to Chat (Weapons / Armor / Misc) via header click
      html.find(".tab-inventory .post-item").on("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        // Resolve item from the header or parent card
        const header   = event.currentTarget;
        const itemId   = header.dataset.itemId
          || header.closest(".inventory-item")?.dataset?.itemId;
        const item     = this.actor.items.get(itemId);
        if (!item) return;

        const { name, system, type } = item;

        // Safe HTML escape for labels/ids
        const safe = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
          ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])
        );

        // Merge all known tag definitions so we get labels + descriptions
        const allDefs = [
          ...(CONFIG.MidnightGambit?.ITEM_TAGS   ?? []),
          ...(CONFIG.MidnightGambit?.WEAPON_TAGS ?? []),
          ...(CONFIG.MidnightGambit?.ARMOR_TAGS  ?? []),
          ...(CONFIG.MidnightGambit?.MISC_TAGS   ?? [])
        ];

        const tagData = (system.tags || [])
          .map(tagId => {
            const def   = allDefs.find(t => t.id === tagId);
            const label = def?.label || tagId;
            const desc  = def?.description || "";
            return `<span class="item-tag tag" data-tag-id="${safe(tagId)}" title="${safe(desc)}">${safe(label)}</span>`;
          })
          .join(" ");

        let extraInfo = "";

        // Weapon: Strain Damage (Mortal/Soul, with legacy fallback)
        if (type === "weapon") {
          const mortal = Number(system.mortalStrainDamage ?? system.strainDamage ?? 0);
          const soul   = Number(system.soulStrainDamage ?? 0);

          if (mortal || soul) {
            extraInfo += `
              <label>Strain Damage</label>
              <div class="bubble-wrapper">
                ${mortal ? `
                  <p class="strain-bubble">
                    <i class="fa-solid fa-dagger"></i>
                    <span class="remaining-number">${mortal}</span>
                  </p>` : ""
                }
                ${soul ? `
                  <p class="strain-bubble">
                    <i class="fa-solid fa-moon-over-sun"></i>
                    <span class="remaining-number">${soul}</span>
                  </p>` : ""
                }
              </div>`;
          }
        }


        // Armor: MC / SC
        if (type === "armor") {
          const mc = system.mortalCapacity ?? 0;
          const sc = system.soulCapacity ?? 0;
          if (mc || sc) {
            extraInfo += `
              <label>Capacity</label>
              <div class="bubble-wrapper">
                <p class="strain-bubble">
                  <i class="fa-solid fa-dagger"></i>
                  <span class="remaining-number">${mc}</span>
                </p>
                <p class="strain-bubble">
                  <i class="fa-solid fa-moon-over-sun"></i>
                  <span class="remaining-number">${sc}</span>
                </p>
              </div>`;
          }
        }

        // Misc: Strain Damage + Capacity
        if (type === "misc") {
          const mortalSD = Number(system.mortalStrainDamage ?? system.strainDamage ?? 0);
          const soulSD   = Number(system.soulStrainDamage ?? 0);

          if (mortalSD || soulSD) {
            extraInfo += `
              <label>Strain Damage</label>
              <div class="bubble-wrapper">
                ${mortalSD ? `
                  <p class="strain-bubble">
                    <i class="fa-solid fa-dagger"></i>
                    <span class="remaining-number">${mortalSD}</span>
                  </p>` : ""
                }
                ${soulSD ? `
                  <p class="strain-bubble">
                    <i class="fa-solid fa-moon-over-sun"></i>
                    <span class="remaining-number">${soulSD}</span>
                  </p>` : ""
                }
              </div>`;
          }

          const mc = Number(system.mortalCapacity ?? 0);
          const sc = Number(system.soulCapacity ?? 0);
          if (mc || sc) {
            extraInfo += `
              <label>Capacity</label>
              <div class="bubble-wrapper">
                ${mc ? `
                  <p class="strain-bubble">
                    <i class="fa-solid fa-dagger"></i>
                    <span class="remaining-number">${mc}</span>
                  </p>` : ""
                }
                ${sc ? `
                  <p class="strain-bubble">
                    <i class="fa-solid fa-moon-over-sun"></i>
                    <span class="remaining-number">${sc}</span>
                  </p>` : ""
                }
              </div>`;
          }
        }


        // Enrich the TinyMCE HTML for chat so formatting (lists, bold, etc.) is preserved
        const descHtml = system.description
          ? await TextEditor.enrichHTML(String(system.description ?? ""), { async: true, secrets: false })
          : "";

        const content = `
          <div class="chat-item">
            <h2><i class="fa-solid fa-shield"></i> ${safe(name)}</h2>
            ${descHtml ? `<div class="chat-item-desc">${descHtml}</div>` : ""}
            ${extraInfo}
            ${tagData ? `<strong>Tags:</strong><div class="chat-tags">${tagData}</div>` : ""}
          </div>
        `;

        await ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor: this.actor }),
          content
        });

        // Re-apply tooltips as a safety net
        html.find(".item-tag").each(function () {
          const tooltip = this.dataset.tooltip;
          if (tooltip) this.setAttribute("title", tooltip);
        });
      });

      // Inventory Search (character sheet)
      {
        const $root = html instanceof jQuery ? html : $(html);
        const $tab  = $root.find(".tab-inventory");

        if (!$tab.length) return;

        const STAGGER_STEP_MS = 80;   // delay between each card's enter
        const STAGGER_COUNT   = 3;    // how many cards get staggered
        const DEBOUNCE_MS     = 220;
        const LEAVE_MS        = 500;  // must match your CSS transition time

        const debounce = (fn, wait = DEBOUNCE_MS) => {
          let t;
          return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), wait);
          };
        };

        // Decide if a given inventory card matches the query
        const cardMatches = (el, q) => {
          const norm = (s) => String(s ?? "").toLowerCase();

          // Title text (your cards style plain h3, so include it as fallback)
          const nameEl =
            el.querySelector(".name") ||
            el.querySelector(".clickable-item") ||
            el.querySelector("h3");
          const name = norm(nameEl?.textContent || "");

          // Tags text (support multiple possible structures)
          const tagsEl =
            el.querySelector(".item-tags") ||
            el.querySelector(".tags") ||
            el.querySelector("[data-tags]");
          const tags = norm(tagsEl?.textContent || "");

          // Notes/description fallbacks (your SCSS uses .desc)
          const notesEl =
            el.querySelector(".notes") ||
            el.querySelector(".desc") ||
            el.querySelector(".item-description");
          const notes = norm(notesEl?.textContent || "");

          return !q || name.includes(q) || tags.includes(q) || notes.includes(q);
        };

        // Animate a card entering (visible)
        const enterCard = (el, idx = 0) => {
          el.classList.remove("is-entering", "is-leaving", "pre-enter");

          // If it's currently visible, briefly hide to restart animation
          if (!el.classList.contains("is-hidden")) {
            el.classList.add("is-hidden");
            // force reflow so the browser sees the class change
            // eslint-disable-next-line no-unused-expressions
            el.offsetHeight;
          }

          el.classList.remove("is-hidden");
          el.classList.add("pre-enter");
          // another reflow to lock in starting state
          // eslint-disable-next-line no-unused-expressions
          el.offsetHeight;

          const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
          const slot   = Math.min(idx, STAGGER_COUNT - 1);
          const delay  = reduce ? 0 : slot * STAGGER_STEP_MS;
          el.style.transitionDelay = `${delay}ms`;

          requestAnimationFrame(() => {
            el.classList.add("is-entering");
            const onEnd = (e) => {
              if (e && e.target !== el) return;
              el.classList.remove("is-entering", "pre-enter");
              el.style.transitionDelay = "";
              el.removeEventListener("transitionend", onEnd);
            };
            el.addEventListener("transitionend", onEnd, { once: true });
          });
        };

        // Animate a card leaving (fading out + sliding down)
        const leaveCard = (el) => {
          el.classList.remove("is-entering", "pre-enter");
          el.style.transitionDelay = "";
          if (el.classList.contains("is-hidden")) return;
          el.classList.add("is-leaving");
        };

        // Animate an inventory bucket title entering (visible)
        const enterTitle = (el) => {
          el.classList.remove("is-entering", "is-leaving", "pre-enter");
          el.style.transitionDelay = "";

          // lock in start state
          el.classList.add("pre-enter");
          // eslint-disable-next-line no-unused-expressions
          el.offsetHeight;

          requestAnimationFrame(() => {
            el.classList.add("is-entering");

            const onEnd = (e) => {
              if (e && e.target !== el) return;
              el.classList.remove("is-entering", "pre-enter");
              el.removeEventListener("transitionend", onEnd);
            };

            el.addEventListener("transitionend", onEnd, { once: true });
          });
        };

        // Animate an inventory bucket title leaving (fade/slide out)
        const leaveTitle = (el) => {
          el.classList.remove("is-entering", "pre-enter");
          el.style.transitionDelay = "";
          el.classList.add("is-leaving");
        };

        // Show / hide the "no results" message
        const showEmpty = (show) => {
          const empty =
            $tab.find(".inventory-search-empty")[0] ||
            $tab.find(".inventory-empty")[0];
          if (!empty) return;
          empty.style.display = show ? "block" : "none";
        };

        // Temp bucket state while searching (so collapsed buckets don't hide matches)
        let mgBucketPreSearchState = null;

        let mgInvSearchToken = 0;
        let mgInvSearchTimer = null;

        // --- Search: unified grid across buckets ---
        let mgInvSearchGrid = null;        // the temporary grid we render matches into
        let mgInvCardHomes = null;         // Map(cardEl -> { parent, next })
        let mgInvBucketEls = null;         // cached bucket wrapper nodes (optional)
        
        const ensureSearchGrid = () => {
          const tabEl = $tab?.[0];
          if (!tabEl) return null;

          // IMPORTANT: your SCSS is nested under .inventory-tab
          const invRoot = tabEl.querySelector(".inventory-tab") || tabEl;

          // Reuse if it exists + connected
          if (mgInvSearchGrid && mgInvSearchGrid.isConnected) return mgInvSearchGrid;

          // Reuse if it already exists in DOM
          mgInvSearchGrid = invRoot.querySelector(".inventory-search-grid");
          if (mgInvSearchGrid) return mgInvSearchGrid;

          // Create it with the SAME class your styling expects
          mgInvSearchGrid = document.createElement("div");
          mgInvSearchGrid.className = "inventory-grid inventory-search-grid";
          mgInvSearchGrid.style.display = "none"; // only show while searching

          // Anchor: first bucket title (wherever it actually lives)
          const firstTitle = invRoot.querySelector(".inventory-bucket-title");

          if (firstTitle?.parentNode) {
            // Insert into the SAME parent as the title so insertBefore is valid
            firstTitle.parentNode.insertBefore(mgInvSearchGrid, firstTitle);
          } else {
            // Fallback: put it at top of inventory section if possible
            const section = invRoot.querySelector(".inventory-section") || invRoot;
            section.prepend(mgInvSearchGrid);
          }

          return mgInvSearchGrid;
        };

        // Snapshot original home positions once (so we can restore after search)
        const snapshotCardHomes = (cards) => {
          if (mgInvCardHomes) return;
          mgInvCardHomes = new Map();
          for (const card of cards) {
            mgInvCardHomes.set(card, { parent: card.parentNode, next: card.nextSibling });
          }
        };

        // Hide/show bucket *parts* during search so they stop affecting layout.
        const setBucketsVisible = (visible) => {
          const tabEl = $tab[0];
          if (!tabEl) return;

          const bodies = Array.from(tabEl.querySelectorAll(".inventory-bucket-body"));
          const titles = Array.from(tabEl.querySelectorAll(".inventory-bucket-title"));

          // Cache original inline display so restore is accurate
          const stashDisplay = (el) => {
            if (!el) return;
            if (el.dataset.mgOrigDisplay === undefined) {
              el.dataset.mgOrigDisplay = el.style.display ?? "";
            }
          };

          for (const b of bodies) {
            stashDisplay(b);
            b.style.display = visible ? (b.dataset.mgOrigDisplay || "") : "none";
          }

          // Titles are also managed elsewhere (animation), but this makes restore resilient
          for (const t of titles) {
            stashDisplay(t);
            t.style.display = visible ? (t.dataset.mgOrigDisplay || "") : "none";
          }
        };

        // Move only matching cards into the unified grid (keeps original DOM order)
        const renderMatchesIntoSearchGrid = (cards, matchSet) => {
          const grid = ensureSearchGrid();
          if (!grid) return;

          grid.innerHTML = "";
          grid.style.display = "flex";

          // Append matches in the original DOM order
          for (const card of cards) {
            if (matchSet.has(card)) grid.appendChild(card);
          }
        };

        // Restore all cards back to their original parent + position
        const restoreCardsToHomes = () => {
          const grid = ensureSearchGrid();
          if (grid) {
            grid.style.display = "none";
            grid.innerHTML = "";
          }

          if (!mgInvCardHomes) return;

          for (const [card, home] of mgInvCardHomes.entries()) {
            const parent = home?.parent;
            if (!parent) continue;

            const next = home.next;
            if (next && next.parentNode === parent) parent.insertBefore(card, next);
            else parent.appendChild(card);
          }
        };

        const runSearchNow = () => {
          const input = $tab.find(".item-search")[0];
          const q = (input?.value || "").toLowerCase().trim();
          const searching = q.length > 0;

          // If searching, temporarily force bucket bodies open so matches can appear
          const bucketTitles = $tab.find(".inventory-bucket-title").toArray();
          const bucketBodies = $tab.find(".inventory-bucket-body").toArray();

          if (searching && !mgBucketPreSearchState) {
            mgBucketPreSearchState = bucketBodies.map((body) => {
              const title = body.previousElementSibling?.classList?.contains("inventory-bucket-title")
                ? body.previousElementSibling
                : null;

              return {
                body,
                hidden: !!body.hidden,
                maxHeight: body.style.maxHeight,
                title,
                titleCollapsed: !!title?.classList?.contains("is-collapsed"),
                titleDisplay: title?.style?.display ?? ""
              };
            });
          }

          if (searching) {
            for (const body of bucketBodies) {
              body.hidden = false;
              body.style.maxHeight = ""; // let it size naturally for search
            }
            for (const t of bucketTitles) t.classList.remove("is-collapsed");
          }

          const titles = $tab.find(".inventory-bucket-title").toArray();
          const cards  = $tab.find(".inventory-card, .inventory-item").toArray();

          // Cancel any in-flight finalize from a previous search
          mgInvSearchToken += 1;
          const token = mgInvSearchToken;

          if (mgInvSearchTimer) {
            clearTimeout(mgInvSearchTimer);
            mgInvSearchTimer = null;
          }

          // Hard reset transition classes so the next search ALWAYS animates
          for (const el of cards) {
            el.classList.remove("is-entering", "pre-enter", "is-leaving");
            el.style.transitionDelay = "";
            // if it was hidden from the previous query, keep it hidden for now — we’ll decide after LEAVE_MS
          }
          for (const t of titles) {
            t.classList.remove("is-entering", "pre-enter", "is-leaving");
            t.style.transitionDelay = "";
          }

          // Build match set
          const matchSet = new Set(cards.filter((el) => cardMatches(el, q)));

          // Snapshot card homes once so we can restore after search
          snapshotCardHomes(cards);

          // Start leave animation for ALL cards (even ones that will remain)
          for (const el of cards) leaveCard(el);

          // Start leave animation for titles ONLY when searching
          if (searching) {
            for (const t of titles) leaveTitle(t);
          }


          // After leave animation finishes, finalize DOM layout + re-enter matches
          mgInvSearchTimer = setTimeout(() => {
            if (token !== mgInvSearchToken) return; // stale finalize, ignore

            // Toggle titles out of layout *after* fade so it feels seamless
            if (searching) {
              for (const t of titles) {
                t.style.display = "none";
                t.classList.remove("is-leaving");
              }
            } else {
              for (const t of titles) {
                t.style.display = "";
                t.classList.remove("is-leaving");
                enterTitle(t);
              }
            }

            if (searching) {
              // Remove buckets from layout and render matches into unified grid
              setBucketsVisible(false);
              renderMatchesIntoSearchGrid(cards, matchSet);
            } else {
              // Restore bucket layout and return cards to their original homes
              setBucketsVisible(true);
              restoreCardsToHomes();
            }

            let hits = 0;
            let enterIndex = 0;

            for (const el of cards) {
              const isMatch = searching ? matchSet.has(el) : true;

              // finalize leave
              el.classList.remove("is-leaving");

              if (isMatch) {
                hits++;
                // Make sure it’s not hidden before we animate in
                el.classList.remove("is-hidden");

                // Force a reflow so re-adding enter classes always triggers (prevents “flicker” on 2nd search)
                // eslint-disable-next-line no-unused-expressions
                el.offsetHeight;

                enterCard(el, enterIndex++);
              } else {
                el.classList.add("is-hidden");
              }
            }

            showEmpty(hits === 0 && searching);

            // Bucket titles + restoring collapsed state after clearing search
            if (searching) {
              for (const t of bucketTitles) t.style.display = "none";
            } else {
              for (const t of bucketTitles) t.style.display = "";

              if (mgBucketPreSearchState) {
                for (const st of mgBucketPreSearchState) {
                  if (!st?.body) continue;

                  st.body.hidden = !!st.hidden;
                  if (st.body.hidden) st.body.style.maxHeight = "0px";
                  else st.body.style.maxHeight = st.maxHeight || "";

                  if (st.title) {
                    st.title.classList.toggle("is-collapsed", !!st.titleCollapsed);
                    st.title.style.display = st.titleDisplay || "";
                  }
                }
                mgBucketPreSearchState = null;
              }
            }

          }, LEAVE_MS);
        };


        const runSearch = debounce(runSearchNow, DEBOUNCE_MS);

        // ----- Event wiring: Enter key + Search + Reset -----

        // Enter in the search input
        $root
          .off("keydown.mgInvSearchEnter")
          .on("keydown.mgInvSearchEnter", ".tab-inventory .item-search", (ev) => {
            if (ev.key !== "Enter") return;
            ev.preventDefault();
            ev.stopPropagation();
            ev.stopImmediatePropagation();
            runSearch();
          });


        // Click the Search button
        $root
          .off("click.mgInvSearchBtn")
          .on("click.mgInvSearchBtn", ".tab-inventory .item-search-btn", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            ev.stopImmediatePropagation();
            runSearch();
          });

        // Click the Reset button
        $root
          .off("click.mgInvSearchReset")
          .on("click.mgInvSearchReset", ".tab-inventory .item-search-reset", (ev) => {
            ev.preventDefault();

            const input = $tab.find(".item-search")[0];
            if (input) input.value = "";

            // Run the same logic as “empty search”
            runSearchNow();
          });

          // ------------------------------------------------------------
          // Inventory bucket collapse / expand (smooth + persisted)
          // Insert this block ABOVE:  // "See All / See Less" for inventory cards
          // ------------------------------------------------------------
          {
            const $root = html instanceof jQuery ? html : $(html);
            const $tab  = $root.find(".tab-inventory");
            if (!$tab.length) return;

            const BUCKET_MS = 500; // keep in sync with your other inventory transitions

            // Persist bucket state per actor (store ONLY collapsed buckets)
            const BUCKET_FLAG_SCOPE = "midnight-gambit";
            const BUCKET_FLAG_KEY   = "inventoryBucketCollapsed";

            const getBucketKey = (titleEl) => {
              if (!titleEl) return null;

              // 1) Prefer an explicit stable key if present
              const explicit = titleEl.dataset?.bucketKey || titleEl.getAttribute?.("data-bucket-key");
              if (explicit) {
                const k = String(explicit).trim().toLowerCase();
                titleEl.dataset.bucketKey = k; // lock it in for future calls
                return k;
              }

              // 2) Derive a stable key from text, but strip dynamic junk like "(3)"
              const rawText = String(titleEl.textContent || "");
              const cleaned = rawText
                .replace(/\(\s*\d+\s*\)/g, "")   // remove counts like "(3)"
                .replace(/\s+/g, " ")
                .trim()
                .toLowerCase();

              if (!cleaned) return null;

              // Lock the derived key onto the element so it stays consistent during this session
              titleEl.dataset.bucketKey = cleaned;
              return cleaned;
            };


            const readState = () => {
              try { return this.actor?.getFlag(BUCKET_FLAG_SCOPE, BUCKET_FLAG_KEY) || {}; }
              catch (_e) { return {}; }
            };

            const writeState = async (state) => {
              try {
                // Write flags without forcing a sheet rerender (keeps your animation intact)
                const path = `flags.${BUCKET_FLAG_SCOPE}.${BUCKET_FLAG_KEY}`;
                await this.actor.update({ [path]: state }, { render: false });
              } catch (_e) {}
            };

            // Turn: [Title][Cards...][Next Title] into [Title][Body{Cards...}][Next Title]
            const ensureBucketBodies = () => {
              const root = $tab[0];
              if (!root) return;

              const titles = Array.from(root.querySelectorAll(".inventory-bucket-title"));
              for (const title of titles) {
                let next = title.nextElementSibling;

                // already normalized
                if (next && next.classList?.contains("inventory-bucket-body")) continue;

                const body = document.createElement("div");

                // IMPORTANT: keep your existing grid layout so cards don’t get weird
                body.classList.add("inventory-bucket-body", "inventory-grid");
                body.style.width = "100%";
                body.style.overflow = "hidden";

                title.insertAdjacentElement("afterend", body);

                // Move everything until the next title into the body
                while (next && !next.classList.contains("inventory-bucket-title")) {
                  const move = next;
                  next = next.nextElementSibling;
                  body.appendChild(move);
                }
              }
            };

            const setChevronState = (titleEl, collapsed) => {
              titleEl.classList.toggle("is-collapsed", collapsed);
              const icon = titleEl.querySelector(".inventory-bucket-toggle i");
              if (icon) icon.classList.toggle("rotated", !collapsed); // rotated = expanded
            };

            // Smooth max-height animation + stable end state (hidden=true when collapsed)
            const animateBucket = (body, expand) => {
              if (!body) return Promise.resolve();

              return new Promise((resolve) => {
                // prevent double clicks during animation
                if (body.dataset.animating === "1") return resolve();
                body.dataset.animating = "1";

                const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
                const ms = reduce ? 0 : BUCKET_MS;

                body.style.overflow = "hidden";
                body.style.transition = `max-height ${ms}ms ease`;

                const finish = () => {
                  body.style.transition = "";
                  body.style.overflow = "";
                  body.dataset.animating = "0";
                  resolve();
                };

                if (expand) {
                  body.hidden = false;

                  body.style.maxHeight = "0px";
                  // force reflow
                  // eslint-disable-next-line no-unused-expressions
                  body.offsetHeight;

                  body.style.maxHeight = `${body.scrollHeight}px`;

                  const onEnd = (e) => {
                    if (e && e.target !== body) return;
                    body.removeEventListener("transitionend", onEnd);

                    // let it size naturally after opening
                    body.style.maxHeight = "";
                    finish();
                  };

                  if (ms === 0) return onEnd();
                  body.addEventListener("transitionend", onEnd, { once: true });
                  setTimeout(onEnd, ms + 120);
                  return;
                }

                // collapse
                body.hidden = false; // ensure measurable
                body.style.maxHeight = `${Math.ceil(body.getBoundingClientRect().height)}px`;
                // force reflow
                // eslint-disable-next-line no-unused-expressions
                body.offsetHeight;

                body.style.maxHeight = "0px";

                const onEnd = (e) => {
                  if (e && e.target !== body) return;
                  body.removeEventListener("transitionend", onEnd);

                  // IMPORTANT: hide after collapse so nothing peeks through
                  body.hidden = true;
                  body.style.maxHeight = "0px";
                  finish();
                };

                if (ms === 0) return onEnd();
                body.addEventListener("transitionend", onEnd, { once: true });
                setTimeout(onEnd, ms + 120);
              });
            };

            // Build wrappers and apply saved state on render
            ensureBucketBodies();

            {
              const state = readState();
              const titles = Array.from($tab[0].querySelectorAll(".inventory-bucket-title"));

              for (const title of titles) {
                const body = title.nextElementSibling;
                if (!body || !body.classList.contains("inventory-bucket-body")) continue;

                const key = getBucketKey(title);
                if (!key) continue;

                const collapsed = state[key] === true;
                setChevronState(title, collapsed);

                body.hidden = collapsed;
                body.style.maxHeight = collapsed ? "0px" : "";
                body.dataset.animating = "0";
              }
            }

            // Click handler
            $root
              .off("click.mgInvBucketToggle")
              .on("click.mgInvBucketToggle", ".tab-inventory .inventory-bucket-toggle", async (ev) => {
                ev.preventDefault();
                ev.stopPropagation();

                // Ignore toggles while searching (your search mode hides titles anyway)
                const q = ($tab.find(".item-search")[0]?.value || "").trim();
                if (q.length) return;

                const title = ev.currentTarget.closest(".inventory-bucket-title");
                if (!title) return;

                const body = title.nextElementSibling;
                if (!body || !body.classList.contains("inventory-bucket-body")) return;

                const key = getBucketKey(title);
                if (!key) return;

                const state = readState();
                const collapsed = title.classList.contains("is-collapsed");

                if (!collapsed) {
                  // COLLAPSE
                  setChevronState(title, true);
                  state[key] = true;

                  // Animate first, then persist (so even if something rerenders later, it doesn't kill the transition)
                  await animateBucket(body, false);
                  writeState(state);
                  return;
                }

                // EXPAND
                setChevronState(title, false);

                // IMPORTANT: persist open explicitly so it survives hard refresh
                state[key] = false;

                // Animate first, then persist
                await animateBucket(body, true);
                await writeState(state);

              });
          }



        // Initial state: everything visible, no animations, no empty message
        const initialCards = $tab.find(".inventory-card, .inventory-item").toArray();
        for (const el of initialCards) {
          el.classList.remove("is-hidden", "is-entering", "is-leaving", "pre-enter");
          el.style.transitionDelay = "";
        }
        showEmpty(false);
      }


      // "See All / See Less" for inventory cards
      // Uniform collapsed height + infinite expand/collapse using CSS transition on max-height
      {
        const $root = html instanceof jQuery ? html : $(html);

        const DEFAULT_CAP   = 340; // px fallback if no data-seeall-cap
        const TRANSITION_MS = 500; // match your CSS max-height transition (~.5s)

        // Capture-phase listener to bump card height even if inner toggles stopPropagation()
        {
          const rootEl = $root[0];
          if (rootEl) {
            // Remove prior copy if this sheet re-renders
            if (rootEl._mgInvCardBumpCapture) {
              rootEl.removeEventListener("click", rootEl._mgInvCardBumpCapture, true);
            }

            rootEl._mgInvCardBumpCapture = (ev) => {
              const btn = ev.target?.closest?.(
                ".tab-inventory .mg-seeall-toggle, .tab-inventory .tags-toggle"
              );
              if (!btn) return;

              const card = btn.closest(".inventory-item.mg-card-wrap, .inventory-card.mg-card-wrap");
              if (!card) return;

              // Let the inner toggle update its own max-height first, then measure
              setTimeout(() => bumpExpandedCard(card), 0);
            };

            rootEl.addEventListener("click", rootEl._mgInvCardBumpCapture, true);
          }
        }

        // Initialize all inventory cards to the same collapsed height
        const initCards = () => {
          const cards =
            $root[0]?.querySelectorAll(
              ".tab-inventory .inventory-item.mg-card-wrap, .tab-inventory .inventory-card.mg-card-wrap"
            ) || [];

          cards.forEach((card) => {
            const capAttr = Number(card.dataset.seeallCap) || DEFAULT_CAP;
            card.dataset.mgCollapsedPx = String(capAttr);

            // If not expanded, force the collapsed height so they all match
            if (!card.classList.contains("expanded")) {
              card.style.overflow = "hidden";
              card.style.maxHeight = `${capAttr}px`;
            } else {
              // If somehow already expanded on render, lock it to its real height
              card.style.overflow = "visible";
              card.style.maxHeight = `${card.scrollHeight}px`;
            }

            const icon = card.querySelector(".card-seeall-toggle i");
            if (icon) icon.classList.toggle("rotated", card.classList.contains("expanded"));
          });
        };

        // While a card is expanded, its contents (Description/Notes toggles) can change height.
        // This bumps the card's maxHeight to match so it "grows" instead of overflowing/clipping.
        const bumpExpandedCard = (card) => {
          if (!card?.classList?.contains("expanded")) return;
          // lock current px, then animate to new scrollHeight
          const start = Math.ceil(card.getBoundingClientRect().height);
          const target = card.scrollHeight;

          card.style.overflow = "hidden";
          card.style.maxHeight = `${start}px`;
          // force reflow
          // eslint-disable-next-line no-unused-expressions
          card.offsetHeight;

          card.style.maxHeight = `${target}px`;

          // once it settles, allow overflow visible again (but KEEP a px maxHeight!)
          setTimeout(() => {
            if (!card.classList.contains("expanded")) return;
            card.style.overflow = "visible";
            card.style.maxHeight = `${card.scrollHeight}px`;
          }, TRANSITION_MS + 50);
        };

        const toggleCard = (btn) => {
          const card = btn.closest(".inventory-item.mg-card-wrap, .inventory-card.mg-card-wrap");
          if (!card) return;

          const icon        = btn.querySelector("i");
          const collapsedPx = Number(card.dataset.mgCollapsedPx) || DEFAULT_CAP;
          const isExpanded  = card.classList.contains("expanded");

          if (!isExpanded) {
            // ===== EXPAND (collapsed px -> full px) =====
            const start  = Math.ceil(card.getBoundingClientRect().height) || collapsedPx;
            const target = card.scrollHeight;

            card.style.overflow  = "hidden";
            card.style.maxHeight = `${start}px`;
            // force reflow
            // eslint-disable-next-line no-unused-expressions
            card.offsetHeight;

            card.style.maxHeight = `${target}px`;
            card.classList.add("expanded");
            if (icon) icon.classList.add("rotated");

            // After expand completes: allow overflow, but KEEP a pixel maxHeight so collapse can animate later
            setTimeout(() => {
              if (!card.classList.contains("expanded")) return;
              card.style.overflow = "visible";
              card.style.maxHeight = `${card.scrollHeight}px`;
            }, TRANSITION_MS + 50);

            return;
          }

          // ===== COLLAPSE (full px -> collapsed px) =====
          // Critical: establish a *pixel* start height (NOT "auto") so CSS can animate.
          const start = Math.ceil(card.getBoundingClientRect().height) || card.scrollHeight;

          card.style.overflow  = "hidden";
          card.style.maxHeight = `${start}px`;

          // force reflow so the browser commits the start value
          // eslint-disable-next-line no-unused-expressions
          card.offsetHeight;

          // animate down
          card.style.maxHeight = `${collapsedPx}px`;
          card.classList.remove("expanded");
          if (icon) icon.classList.remove("rotated");

          // keep the clamp in collapsed state
          setTimeout(() => {
            if (card.classList.contains("expanded")) return;
            card.style.overflow = "hidden";
            card.style.maxHeight = `${collapsedPx}px`;
          }, TRANSITION_MS + 50);
        };

        $root
          .off("click.mgInvCardToggle")
          .on("click.mgInvCardToggle", ".tab-inventory .card-seeall-toggle", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            toggleCard(ev.currentTarget);

            // After expand/collapse, re-measure inner Description/Notes so chevrons appear correctly
            setTimeout(() => {
              $root[0]?._mgInvRefreshInnerSeeAll?.();
            }, 0);
          });


        // When Description/Notes expands/collapses inside a card, bump the card height if it’s expanded
        $root
          .off("click.mgInvCardInnerBump")
          .on("click.mgInvCardInnerBump", ".tab-inventory .mg-seeall-toggle", (ev) => {
            const card = ev.currentTarget.closest(".inventory-item.mg-card-wrap, .inventory-card.mg-card-wrap");
            if (!card) return;
            // let the inner seeall logic run first, then measure
            setTimeout(() => bumpExpandedCard(card), 0);
          });

        initCards();
      }

      // Tag Overflow (Inventory + Moves) — chevron + smooth reveal
      {
        const $root = html instanceof jQuery ? html : $(html);

        const COLLAPSED_MAX = 44;   // px of tag-stack height before clamping
        const TRANSITION_MS = 500;  // keep in sync with your CSS transition

        // Helper: find the tags container inside a tags-wrap (works for both your layouts)
        const getTagsEl = (wrap) =>
          wrap?.querySelector(".item-tags") ||
          wrap?.querySelector(".tags");

        const ensureTransition = (el) => {
          if (!el) return;
          // If your CSS already sets this, this is harmless.
          if (!el.style.transition) el.style.transition = "max-height 0.5s ease";
          if (!el.style.overflow) el.style.overflow = "hidden";
        };

        const updateOne = (wrap) => {
          if (!wrap || wrap.classList.contains("animating")) return;

          const tagsEl = getTagsEl(wrap);
          const toggle = wrap.querySelector(".tags-toggle");
          if (!tagsEl || !toggle) return;

          ensureTransition(tagsEl);

          const overflows = tagsEl.scrollHeight > (COLLAPSED_MAX + 1);
          const expanded  = wrap.classList.contains("expanded");

          // If it doesn't overflow, mark short + hide toggle + remove clamp
          wrap.classList.toggle("short", !overflows);
          toggle.hidden = !overflows;

          // Make sure we have an icon
          let icon = toggle.querySelector("i");
          if (!icon) {
            toggle.innerHTML = '<i class="fa-solid fa-angle-down"></i>';
            icon = toggle.querySelector("i");
          }
          icon?.classList.toggle("rotated", expanded);

          // Clamp only when collapsed AND overflowing
          if (!expanded && overflows) {
            tagsEl.style.maxHeight = `${COLLAPSED_MAX}px`;
          } else {
            tagsEl.style.maxHeight = "";
          }
        };

        const refreshAll = () => {
          const wraps =
            $root[0]?.querySelectorAll(
              '.tab-inventory .tags-wrap, .tab-moves .tags-wrap'
            ) || [];
          wraps.forEach(updateOne);
        };

        // Expose for tab-click remeasure (your tab click handler already calls this)
        $root[0]._mgRefreshTagsOverflow = refreshAll;

        // Also re-measure once after layout settles (fonts, rich text, etc.)
        setTimeout(refreshAll, 0);        

        // Click handler for BOTH tabs
        $root
          .off("click.mgTagsToggle")
          .on("click.mgTagsToggle", ".tab-inventory .tags-toggle, .tab-moves .tags-toggle", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            const toggle = ev.currentTarget;
            const wrap   = toggle.closest(".tags-wrap");
            const tagsEl = getTagsEl(wrap);
            const icon   = toggle.querySelector("i");
            if (!wrap || !tagsEl) return;

            ensureTransition(tagsEl);

            const wasExpanded = wrap.classList.contains("expanded");
            const startHeight = tagsEl.clientHeight;

            // Expanding: go to scrollHeight
            // Collapsing: go back to COLLAPSED_MAX
            const targetHeight = wasExpanded
              ? COLLAPSED_MAX
              : Math.max(tagsEl.scrollHeight, startHeight);

            // Animate max-height start -> target
            tagsEl.style.maxHeight = `${startHeight}px`;
            // force reflow
            // eslint-disable-next-line no-unused-expressions
            tagsEl.offsetHeight;
            tagsEl.style.maxHeight = `${targetHeight}px`;

            wrap.classList.add("animating");
            wrap.classList.toggle("expanded", !wasExpanded);
            icon?.classList.toggle("rotated", !wasExpanded);

            const onEnd = (e) => {
              if (e && e.target !== tagsEl) return;

              tagsEl.removeEventListener("transitionend", onEnd);
              wrap.classList.remove("animating");

              // Expanded = let it auto-size, Collapsed = keep clamp if it still overflows
              if (wrap.classList.contains("expanded")) {
                tagsEl.style.maxHeight = "";
              } else if (tagsEl.scrollHeight > COLLAPSED_MAX + 1) {
                tagsEl.style.maxHeight = `${COLLAPSED_MAX}px`;
              } else {
                tagsEl.style.maxHeight = "";
              }

              updateOne(wrap);
            };

            tagsEl.addEventListener("transitionend", onEnd, { once: true });
            setTimeout(onEnd, TRANSITION_MS + 100); // failsafe
          });

        // Initial measurement when the sheet renders
        refreshAll();
      }

      // Description / Notes inner "See All" (mg-seeall-wrap)
      {
        const $root = html instanceof jQuery ? html : $(html);

        const DEFAULT_CAP   = 140;  // px fallback if data-seeall-cap is missing
        const TRANSITION_MS = 500;  // keep in sync with CSS max-height transition

        const setupOne = (wrap) => {
          if (!wrap) return;

          const capAttr  = Number(wrap.dataset.seeallCap) || DEFAULT_CAP;
          const content  = wrap.querySelector(".mg-seeall-content");
          const toggle   = wrap.querySelector(".mg-seeall-toggle");
          if (!content || !toggle) return;

          const overflows = content.scrollHeight > (capAttr + 1);

          // Hide toggle if no overflow, remove clamp
          wrap.classList.toggle("short", !overflows);

          if (!toggle.querySelector("i")) {
            toggle.innerHTML = '<i class="fa-solid fa-angle-down"></i>';
          }
          const icon = toggle.querySelector("i");

          const expanded = wrap.classList.contains("expanded");

          if (!expanded && overflows) {
            content.style.maxHeight = `${capAttr}px`;
          } else {
            content.style.maxHeight = "";
          }

          if (icon) icon.classList.toggle("rotated", expanded);
        };

        const refreshAll = () => {
          const wraps =
            $root[0]?.querySelectorAll('.tab[data-tab="inventory"] .mg-seeall-wrap, .tab.inventory .mg-seeall-wrap') || [];

          wraps.forEach(setupOne);
        };
        
        // expose for other listeners (like card expand)
        $root[0]._mgInvRefreshInnerSeeAll = refreshAll;

        $root
          .off("click.mgInnerSeeall")
          .on("click.mgInnerSeeall", '.tab[data-tab="inventory"] .mg-seeall-toggle, .tab.inventory .mg-seeall-toggle', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            const wrap = ev.currentTarget.closest(".mg-seeall-wrap");
            const content = wrap?.querySelector(".mg-seeall-content");
            const icon = ev.currentTarget.querySelector("i");
            if (!wrap || !content) return;

            const capAttr    = Number(wrap.dataset.seeallCap) || DEFAULT_CAP;
            const wasExpanded = wrap.classList.contains("expanded");

            const startHeight = content.clientHeight;
            const targetHeight = wasExpanded
              ? capAttr
              : Math.max(content.scrollHeight, startHeight);

            // Start from current height
            content.style.maxHeight = `${startHeight}px`;
            // force reflow so browser commits it
            // eslint-disable-next-line no-unused-expressions
            content.offsetHeight;
            content.style.maxHeight = `${targetHeight}px`;

            wrap.classList.add("animating");
            wrap.classList.toggle("expanded", !wasExpanded);
            if (icon) icon.classList.toggle("rotated", !wasExpanded);

            const onEnd = (e) => {
              if (e && e.target !== content) return;

              content.removeEventListener("transitionend", onEnd);
              wrap.classList.remove("animating");

              const nowExpanded = wrap.classList.contains("expanded");

              if (nowExpanded) {
                // Let it auto-size after the expand transition
                content.style.maxHeight = "";
              } else {
                // Re-apply clamp if it still overflows
                if (content.scrollHeight > capAttr + 1) {
                  content.style.maxHeight = `${capAttr}px`;
                } else {
                  content.style.maxHeight = "";
                }
              }
            };

            content.addEventListener("transitionend", onEnd, { once: true });
            setTimeout(onEnd, TRANSITION_MS + 100); // failsafe
          });

        // Initial clamp / toggle visibility on render
        refreshAll();
      }

      // Enable tooltips manually after rendering the sheet
      html.find(".sync-tags").on("click", async (event) => {
        event.preventDefault();

        const itemId = event.currentTarget.dataset.itemId;
        const ownedItem = this.actor.items.get(itemId);
        if (!ownedItem) return;

        // Step 1: Try sourceId first
        let sourceItem = null;
        const sourceId = ownedItem.flags?.core?.sourceId;

        if (sourceId) {
          sourceItem = game.items.get(sourceId);
        }

        // Step 2: Fallback — find item in world by name
        if (!sourceItem) {
          sourceItem = game.items.find(i => i.name === ownedItem.name && i.type === ownedItem.type);
        }

        if (!sourceItem) {
          ui.notifications.warn(`Could not find base item for ${ownedItem.name}`);
          return;
        }

        // Merge tags
        const ownedTags = ownedItem.system.tags ?? [];
        const sourceTags = sourceItem.system.tags ?? [];

        const allTags = [...new Set([...ownedTags, ...sourceTags])];

        await ownedItem.update({ "system.tags": allTags });

        ui.notifications.info(`${ownedItem.name} tags synced from base item.`);
      });

      //Right click to remove tag from character sheet
      html.find(".item-tag").on("contextmenu", async (event) => {
        event.preventDefault();

        const $tag = $(event.currentTarget);
        const itemId = $tag.data("item-id");
        const tagId = $tag.data("tag-id");

        const item = this.actor.items.get(itemId);
        if (!item) return;

        const currentTags = item.system.tags || [];
        const updatedTags = currentTags.filter(t => t !== tagId);

        await item.update({ "system.tags": updatedTags });

        ui.notifications.info(`Removed tag '${tagId}' from ${item.name}`);
      });

      //Reset Gambit Button - like a long rest but for deck
      html.find(".reset-gambit-deck").on("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        // Avoid double-fires while dialog is open
        const btn = ev.currentTarget;
        btn.disabled = true;

        try {
          const ok = await Dialog.wait({
            title: "Reset Gambit Deck?",
            content: `
              <p>This returns all drawn and discarded Gambits to your Deck and clears your hand.</p>
            `,
            buttons: {
              yes: { label: this._mgBtn("Reset", "fa-arrows-rotate"), callback: () => true },
              no:  { label: this._mgBtn("Cancel", "fa-circle-xmark"), callback: () => false }
            },
            default: "yes"
          });

          if (!ok) return; // user cancelled — do nothing

          const g = this.actor.system.gambits ?? {};
          const deck    = Array.isArray(g.deck)    ? g.deck    : [];
          const drawn   = Array.isArray(g.drawn)   ? g.drawn   : [];
          const discard = Array.isArray(g.discard) ? g.discard : [];

          // Put everything back into deck (dedup), clear piles
          const newDeck = Array.from(new Set([...deck, ...drawn, ...discard]));

          await this.actor.update({
            "system.gambits.deck": newDeck,
            "system.gambits.drawn": [],
            "system.gambits.discard": [],
            "system.gambits.locked": false
          });

          // Optional: notify and soft re-render
          ui.notifications.info("Gambit deck reset.");
          this.render(false);
        } finally {
          btn.disabled = false;
        }
      });

      // Post Gambit into Game chat
      html.find(".post-gambit").on("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const itemId = event.currentTarget.dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;

        await this._mgPostGambitToChat(item);
      });

      // Play Gambit (post + discard)
      html.find(".play-gambit").on("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const itemId = event.currentTarget.dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;

        await this._mgPostGambitToChat(item);

        // Discard after playing
        const { drawn = [], discard = [] } = this.actor.system.gambits;
        const updatedDrawn = drawn.filter(id => id !== itemId);
        const updatedDiscard = [...discard, itemId];

        await this.actor.update({
          "system.gambits.drawn": updatedDrawn,
          "system.gambits.discard": updatedDiscard
        });
      });

      /** Utility: render a clean chat card for a Gambit item */
      async function postGambitToChat(actor, itemId) {
        const item = actor.items.get(itemId);
        if (!item) throw new Error(`No item ${itemId} on actor ${actor.name}`);

        // Local HTML escaper (Foundry-safe across versions)
        const escapeHtml = (str) =>
          String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");

        const content = `
          <div class="mg-chat-card gambit-card">
            <header class="mg-card-header">
              <h3 class="mg-card-title"><i class="fa-solid fa-cards"></i> ${escapeHtml(item.name)}</h3>
            </header>
            <section class="mg-card-body">
              ${item.system?.description ?? ""}
            </section>
          </div>
        `;

        return ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          content,
          type: CONST.CHAT_MESSAGE_TYPES.OTHER
        });
      }

      /** Fallback discard helper (only used if no .discard-card button found) */
      async function discardGambitById(actor, itemId) {
        // Many systems keep piles in flags or system data. If you already have a
        // dedicated discard function, use that instead of this placeholder.

        // Example approach if you store drawn/deck/discard arrays on actor.system.gambits:
        const sys = actor.system;
        const drawn = Array.isArray(sys.gambits?.drawn) ? [...sys.gambits.drawn] : [];
        const discard = Array.isArray(sys.gambits?.discard) ? [...sys.gambits.discard] : [];

        const idx = drawn.findIndex(g => g._id === itemId || g.id === itemId || g === itemId);
        if (idx !== -1) {
          const card = drawn.splice(idx, 1)[0];
          discard.push(card);
          await actor.update({
            "system.gambits.drawn": drawn,
            "system.gambits.discard": discard
          });
        } else {
          // If your hand stores just IDs and not full objects, adjust accordingly:
          // 1) remove the id from drawn
          // 2) push the id into discard
          console.warn(`[MG] discardGambitById: card not found in drawn for ${itemId}`);
        }
      }


      //Gambit hand at bottom of the screen styling
      html.find(".gambit-hand-card").on("click", async (event) => {
        const itemId = event.currentTarget.dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (!item) return;

        // 1. Post to chat
        await ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor: this.actor }),
          content: `<h2><i class="fa-solid fa-cards"></i> ${item.name}</h2><p>${item.system.description}</p>`
        });

        // 2. Remove from drawn, add to discard
        const { drawn = [], discard = [] } = this.actor.system.gambits;

        const updatedDrawn = drawn.filter(id => id !== itemId);
        const updatedDiscard = [...discard, itemId];

        await this.actor.update({
          "system.gambits.drawn": updatedDrawn,
          "system.gambits.discard": updatedDiscard
        });
      });

      /* SETTINGS TAB: Level Up / Undo
      ----------------------------------------------------------------------*/
      {
        const actor = this.actor;

        // Guard: if methods are missing, don’t attach handlers (prevents cryptic errors)
        const hasLevelUp = typeof actor?.mgLevelUp === "function";
        const hasUndo    = typeof actor?.mgUndoLastLevel === "function";
        if (!hasLevelUp || !hasUndo) {
          console.warn("MG | Level methods missing on actor. Did actor.js load?", { hasLevelUp, hasUndo });
        }

        // Ensure we don’t double-bind if the sheet re-renders
        html.find(".mg-level-up").off("click.mg");
        html.find(".mg-undo-level").off("click.mg");

        html.find(".mg-level-up").on("click.mg", async (ev) => {
          ev.preventDefault();
          if (!hasLevelUp) return ui.notifications.warn("Level Up not available (actor missing mgLevelUp).");
          try {
            await actor.mgLevelUp({ guided: false });
            this._openLevelWizard(); // pop the stepper after the level-up
          } catch (err) {
            console.error("MG | Level Up error:", err);
            ui.notifications.error("Level Up failed. See console for details.");
          }
        });

        html.find(".mg-undo-level").on("click.mg", async (ev) => {
          ev.preventDefault();
          if (!hasUndo) return ui.notifications.warn("Undo not available (actor missing mgUndoLastLevel).");
          try {
            await actor.mgUndoLastLevel();
          } catch (err) {
            console.error("MG | Undo Level error:", err);
            ui.notifications.error("Undo failed. See console for details.");
          }
        });
      }

      /* Reading if the level is minimum or maximum and disabling buttons if so
      ----------------------------------------------------------------------*/
      (async () => {
        try {
          const lvl = Number(this.actor.system?.level) || 1;
          const levels = CONFIG.MidnightGambit?.LEVELS ?? {};
          const maxLvl = Math.max(...Object.keys(levels).map(n => Number(n) || 0), 1);

          const state = await this.actor.getFlag("midnight-gambit", "state");
          const hasHistory = Array.isArray(state?.levelHistory) && state.levelHistory.length > 0;

          const $up   = html.find(".mg-level-up");
          const $undo = html.find(".mg-undo-level");

          const upDisabled = lvl >= maxLvl;
          const undoDisabled = false; // set to !hasHistory if you want hard-disable

          $up
            .prop("disabled", upDisabled)
            .toggleClass("disabled", upDisabled)
            .attr("title", upDisabled ? "Already at max level" : "Level Up");

          // If you prefer Undo to look disabled when nothing to undo, uncomment:
          // $undo
          //   .prop("disabled", undoDisabled)
          //   .toggleClass("disabled", undoDisabled)
          //   .attr("title", undoDisabled ? "Nothing to undo" : "Undo Last Level");
        } catch (e) {
          console.warn("MG | Could not update Level Up / Undo button state:", e);
        }

        /* Show "Unspent Level Rewards" banner in Settings tab
        ----------------------------------------------------------------------*/
        {
          const state = await this.actor.getFlag("midnight-gambit", "state");
          const p = state?.pending || {};
          const hasPending = Object.values(p).some(n => Number(n) > 0);

          // 1) Glow + tiny badge on the Settings tab button (always update)
          const navBtn = html.find('nav.sheet-tabs [data-tab="settings"]');
          if (navBtn.length) {
            // Remove any previous badge
            navBtn.find(".mg-pending-badge").remove();

            // Toggle the glow
            navBtn.toggleClass("mg-pending-glow", hasPending);

            // Add a small badge with the total pending, if any
            if (hasPending) {
              const totalPending = Object.values(p).reduce((a, n) => a + (Number(n) || 0), 0);
              navBtn.append(`<span class="mg-pending-badge" aria-hidden="true">${totalPending}</span>`);
            }
          }

          // 2) Banner inside the Settings tab content (create or remove)
          const settingsTab = html.find('.tab.settings-tab[data-tab="settings"]');
          if (settingsTab.length) {
            // Always clear any old banner
            settingsTab.find(".mg-pending-banner").remove();

            // Only show if there are pending rewards AND a guise is attached
            const hasGuise = !!this.actor.system.guise;
            if (hasPending && hasGuise) {
              settingsTab.append(`
                <div class="mg-pending-banner mg-pending-glow">
                  <h2><i class="fa-solid fa-wand-magic-sparkles"></i> Unspent Level Rewards</h2>
                  <button type="button" class="mg-open-level-wizard">Review & Spend <i class="fa-solid fa-arrow-right"></i></button>
                </div>
              `);
            }
          }

          // 3) Wire up the button if present
          html.find(".mg-open-level-wizard").off("click.mg").on("click.mg", (e) => {
            e.preventDefault();
            this._openLevelWizard();
          });
        }
      })();

      // Post move to chat on header click
      html.find(".move-card .move-name").click(ev => {
        const li = $(ev.currentTarget).closest(".move-card");
        const item = this.actor.items.get(li.data("itemId"));
        item?.toChat();
      });


      /* Learned Moves drop zone hover
      ----------------------------------------------------------------------*/
      {
        const $zone = html.find(".moves-section");
        if ($zone.length) {
          $zone.on("dragenter dragover", (e) => {
            e.preventDefault();
            e.stopPropagation();
            $zone.addClass("drag-hover");
          });
          $zone.on("dragleave", (e) => {
            if (!$zone[0].contains(e.relatedTarget)) {
              $zone.removeClass("drag-hover");
            }
          });
          $zone.on("drop", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            $zone.removeClass("drag-hover");
            // Forward to Foundry’s drop handling → calls our _onDropItemCreate above
            return this._onDrop(e.originalEvent);
          });
        }
      }

      /* Auto-spend pending Move when one is added
      ----------------------------------------------------------------------*/
      Hooks.on("createItem", async (item, options, userId) => {
        try {
          const actor = item?.parent;
          if (!(actor instanceof Actor)) return;
          if (item.type !== "move") return;

          // Only if there are pending moves
          const state = (await actor.getFlag("midnight-gambit", "state")) ?? {};
          const pendingMoves = Number(state?.pending?.moves ?? 0);
          if (pendingMoves <= 0) return;

          // Make sure the move is flagged as learned
          if (!item.system?.learned) {
            await item.update({ "system.learned": true });
          }

          // Spend one pending move
          if (typeof actor.mgSpendPending === "function") {
            await actor.mgSpendPending("move", { itemId: item.id });
          } else {
            // fallback raw decrement
            const p = { ...(state.pending ?? {}) };
            p.moves = Math.max(0, p.moves - 1);
            await actor.setFlag("midnight-gambit", "state", { ...state, pending: p });
          }

          // Soft refresh the actor’s sheet(s)
          for (const appId of Object.keys(actor.apps ?? {})) {
            actor.apps[appId]?.render(false);
          }
        } catch (err) {
          console.warn("MG | auto-spend move failed:", err);
        }
      });

      this._mgBindMoveGrid(html);

      // Change Profile Image (works for trusted + basic owners)
      html.off("click.mgProfileImg").on("click.mgProfileImg", ".mg-change-profile-image", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        if (!this.isEditable) {
          ui.notifications?.warn("You do not have permission to edit this character.");
          return;
        }

        const current = this.actor.img ?? "icons/svg/mystery-man.svg";

        // Foundry permission gates: basic players often cannot open FilePicker (especially on Forge)
        const canBrowse = game.user?.can?.("FILES_BROWSE") ?? game.user?.isTrusted ?? false;

        // Helper: apply update + live preview
        const applyImg = async (path) => {
          try {
            await this.actor.update({ img: path });

            // Optional instant preview (safe no-op if selector doesn't exist)
            const routed = foundry.utils.getRoute(path);
            this.element.find(".profile-banner img, .profile-image").attr("src", routed);

            ui.notifications?.info("Profile image updated.");
          } catch (err) {
            console.error("MG | Failed to update actor profile image:", err);
            ui.notifications?.error("Failed to update profile image.");
          }
        };

        // If user can browse, open FilePicker normally
        if (canBrowse) {
          const fp = new FilePicker({
            type: "image",
            current,
            callback: applyImg
          });
          fp.render(true);
          return;
        }

        // Fallback: basic players still get a dialog to paste an image URL/path
        new Dialog({
          title: "Set Profile Image",
          content: `
            <p>You don't have file browsing permissions, but you can still set an image by URL/path.</p>
            <div class="form-group">
              <label>Image URL or Path</label>
              <input type="text" name="mgImgPath" value="${current}" style="width:100%;" />
            </div>
          `,
          buttons: {
            save: {
              icon: '<i class="fa-solid fa-check"></i>',
              label: "Save",
              callback: (html) => {
                const path = html.find('input[name="mgImgPath"]').val()?.trim();
                if (path) applyImg(path);
              }
            },
            cancel: {
              icon: '<i class="fa-solid fa-xmark"></i>',
              label: "Cancel"
            }
          },
          default: "save"
        }).render(true);
      });

      // Defensive: hide Level controls if no Guise (in case template guard is missing)
      {
        const guiseId   = this.actor?.system?.guise;
        const hasGuise  = !!(guiseId && game.items.get(guiseId));
        // Prefer a single wrapper if you have it:
        const $block = this.element.find(".mg-level-controls");
        if ($block.length) $block.toggle(hasGuise);

        // And hide any lone level buttons if they exist outside the wrapper
        this.element.find(".mg-open-level-wizard, .mg-leveler, .mg-level-btn").toggle(hasGuise);
      }

      this._mgRefreshGuiseVisibility(html);

      // === Bottom Hand: right-click to zoom a Gambit card ===
      $(document)
        .off("contextmenu.mgHandZoom")
        .on("contextmenu.mgHandZoom", ".gambit-hand-ui .gambit-hand-card", async (event) => {
          event.preventDefault();
          event.stopPropagation();

          const el = event.currentTarget;

          // Resolve the clicked card
          const itemId = el.dataset.itemId || el.getAttribute("data-id");
          const source = el.dataset.source || "drawn";
          let item = null;
          if (itemId) item = this.actor?.items?.get(itemId) || game.items?.get(itemId) || null;

          const name = item?.name ?? el.dataset.name ?? "Gambit";
          const description = item?.system?.description ?? el.dataset.description ?? "";

          // 1) Dim the actual hand card (smooth transition)
          this._mgMarkHandCardActive?.(el, true);

          // 2) Pull animation to center — wait for it to finish
          try { await this._mgPullFromHand?.(el); } catch (_) {}

          // 3) Open zoom; when closed, restore the real card's opacity
          this._mgOpenGambitZoom(
            { id: itemId, source, name, description },
            {
              sourceEl: el,
              onClose: () => this._mgMarkHandCardActive?.(el, false)
            }
          );
        });

        // Header pencil → open modal to edit top-of-card fields (currently: Name)
        {
          const $root = html instanceof jQuery ? html : $(html);

          $root.off("click.mgEditHeader").on("click.mgEditHeader", ".mg-edit-name", async (ev) => {
            ev.preventDefault();

            // --- Safe HTML escaper compatible with v11 ---
            const esc = (s) => {
              const str = String(s ?? "");
              if (window?.Handlebars?.escapeExpression) return Handlebars.escapeExpression(str);
              return str
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
            };

            // Current values (expand later if you add more header fields)
            const currentName = this.actor.name ?? "";

            const content = `
              <form class="mg-form">
                <div class="form-group">
                  <label>Name</label>
                  <input type="text" name="name" value="${esc(currentName)}" />
                </div>
              </form>
            `;

            const result = await Dialog.wait({
              title: "Edit Character Header",
              content,
              buttons: {
                ok: {
                  label: this._mgBtn("Save", "fa-floppy-disk"),
                  callback: (dlgHtml) => {
                    const $dlg = $(dlgHtml);
                    return {
                      name: String($dlg.find('input[name="name"]').val() ?? "").trim()
                    };
                  }
                },
                cancel: { label: this._mgBtn("Cancel", "fa-circle-xmark"), callback: () => null }
              },
              default: "ok"
            });

            if (!result) return;

            const updates = {};
            if (result.name && result.name !== this.actor.name) updates["name"] = result.name;

            if (Object.keys(updates).length) {
              await this.actor.update(updates);
              // Soft refresh headline text without full re-render
              const wrap = this.element.find("[data-mg-nameblock] .mg-name-view");
              if (wrap.length) wrap.text(this.actor.name);
            }
          });
        }

        // Keep crew affiliation label in sync with data updates (v11-safe)
        if (this._mgCrewNameHook) Hooks.off("updateActor", this._mgCrewNameHook);
        this._mgCrewNameHook = (doc, diff) => {
          if (!doc || doc.id !== this.actor.id) return;

          // Only react if crewName changed
          const changed = foundry.utils.getProperty(diff, "system.crewName");
          if (changed === undefined) return;

          const $label = this.element.find(".mg-crew-affiliation .crew-name");
          if ($label.length) $label.text(doc.system?.crewName || "No Crew");
        };
        Hooks.on("updateActor", this._mgCrewNameHook);

        // --- Journal: mount TinyMCE on all .mg-rich fields ---
        {
          const root = html[0];
          const areas = root.querySelectorAll(".mg-journal textarea.mg-rich");
          if (areas.length) {
            for (const ta of areas) {
              // Seed with existing value so first paint matches
              const path = ta.name; // e.g., "system.journal.race"
              const value = getProperty?.(this.actor, path) ?? "";
              ta.value = String(value);

              // Clone global config; cap height and allow internal scroll
              const cfg = foundry.utils.deepClone(CONFIG.TinyMCE);
              cfg.max_height = 320;
              cfg.min_height = cfg.min_height ?? 140;
              cfg.content_style = (cfg.content_style ?? "") + `
                body.mce-content-body { overflow-y:auto; overscroll-behavior:contain; }
              `;

              await TextEditor.create({
                target: ta,
                name: path,
                content: value,
                tinymce: cfg,
                height: null
              });
            }
          }
        }

      // Live STO updates while sheet is open
      this._stoHookId = Hooks.on("updateActor", (actor, changes) => {
        if (actor.id !== this.actor.id) return;

        const stoPath = changes?.system?.sto?.value;
        if (stoPath === undefined) return;

        const stoValue = Number(actor.system?.sto?.value ?? 0);

        const $track = this.element.find(`.sto-track[data-track="sto"]`);
        if (!$track.length) return;

        $track.find(".sto-dot").each((_, node) => {
          const v = Number(node.dataset.value);
          node.classList.toggle("filled", v <= stoValue);
        });
      });

    }

  /** Preserve scroll position across re-renders + fix header paint glitches. */
  async _render(force, options = {}) {
    const bodyBefore = this.element?.[0]?.querySelector?.(".window-content");
    const scrollTop = bodyBefore?.scrollTop ?? 0;

    await super._render(force, options);

    const bodyAfter = this.element?.[0]?.querySelector?.(".window-content");
    if (bodyAfter) bodyAfter.scrollTop = scrollTop;

    // After Foundry finishes painting, nudge the header so text is always visible
    this._mgRepaintHeader();
  }
    
  //END EVENT LISTENERS
  //---------------------------------------------------------------------------------------------------------------------------

  /** Temp Skill bonus */
  async _mgOpenTempSkillBonusesDialog() {
    const attributeKeys = [
      "tenacity",
      "finesse",
      "resolve",
      "guile",
      "instinct",
      "presence"
    ];

    const skillBuckets = {
      tenacity: ["brawl", "endure", "athletics"],
      finesse: ["aim", "stealth", "sleight"],
      resolve: ["will", "grit", "composure"],
      guile: ["lore", "investigate", "deceive"],
      instinct: ["survey", "hunt", "nature"],
      presence: ["command", "charm", "perform"]
    };

    const skillLabels = {
      brawl: "Brawl",
      endure: "Endure",
      athletics: "Athletics",
      aim: "Aim",
      stealth: "Stealth",
      sleight: "Sleight",
      will: "Will",
      grit: "Grit",
      composure: "Composure",
      lore: "Lore",
      investigate: "Investigate",
      deceive: "Deceive",
      survey: "Survey",
      hunt: "Hunt",
      nature: "Nature",
      command: "Command",
      charm: "Charm",
      perform: "Perform",
      spark: "Spark"
    };

    const current = this.actor.system?.tempSkillBonuses ?? {};
    const currentAttrBonuses = this.actor.system?.tempAttributeBonuses ?? {};

    const columnsHtml = `
      <div class="attribute-container mg-temp-bonus-modal">
        ${attributeKeys.map((attrKey) => {
          const skills = skillBuckets[attrKey] ?? [];

          return `
            <div class="attribute-column" data-attr="${attrKey}">
              <label class="attribute-label">${attrKey}</label>

              <div class="attribute-interior">
                <div class="attribute">
                  <input
                    class="attribute-modifier mg-temp-attr-input"
                    type="number"
                    name="temp-attr-${attrKey}"
                    value="${Number(currentAttrBonuses[attrKey] ?? 0)}"
                    step="1"
                    data-key="${attrKey}"
                  />
                </div>

                <hr>

                <div class="attribute-skills">
                  ${skills.map((skillKey) => {
                    const label = skillLabels[skillKey] ?? skillKey;
                    const value = Number(current[skillKey] ?? 0);

                    return `
                      <div class="skill-row">
                        <div class="skill-name" data-key="${skillKey}">
                          ${label}
                        </div>

                        <input
                          class="skill-value mg-temp-skill-input"
                          type="number"
                          name="temp-${skillKey}"
                          value="${value}"
                          step="1"
                          data-key="${skillKey}"
                        />
                      </div>
                    `;
                  }).join("")}
                </div>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;

    const result = await new Promise((resolve) => {
      const dlg = new Dialog({
        title: "Temp Skill Bonuses",
        content: `
          <div class="mg-temp-bonus-dialog-content">
            <h2 class="modal-headline">Temp Skill Bonuses</h2>
            <p class="mg-temp-bonus-copy">
              Set temporary bonuses or penalties that apply automatically when a skill is rolled.
            </p>
            ${columnsHtml}
          </div>
        `,
        buttons: {
          ok: {
            label: this._mgBtn("Save", "fa-floppy-disk"),
            callback: (html) => {
              const skillOut = {};
              const attrOut = {};

              for (const attrKey of attributeKeys) {
                attrOut[attrKey] = Number(html.find(`input[name="temp-attr-${attrKey}"]`).val() ?? 0) || 0;

                for (const skillKey of (skillBuckets[attrKey] ?? [])) {
                  skillOut[skillKey] = Number(html.find(`input[name="temp-${skillKey}"]`).val() ?? 0) || 0;
                }
              }

              resolve({
                skillBonuses: skillOut,
                attributeBonuses: attrOut
              });
            }
          },
          cancel: {
            label: this._mgBtn("Cancel", "fa-circle-xmark"),
            callback: () => resolve(null)
          }
        },
        default: "ok",
        render: (html) => {
          html.closest(".app").addClass("mg-temp-bonus");
        }
      });

      dlg.render(true);
    });

    if (result === null) return;

    await this.actor.update({
      "system.tempSkillBonuses": result.skillBonuses,
      "system.tempAttributeBonuses": result.attributeBonuses
    }, { render: false });

    this.render(false);
  }

  /** NPC Aura */
  _getActiveAuraPenalty(attrKey) {
    const activeAuraActorId = game.settings.get("midnight-gambit", "activeAuraActorId");
    if (!activeAuraActorId) {
      return { value: 0, label: "", sourceActorId: "", sourceTokenId: "" };
    }

    const actor = game.actors.get(activeAuraActorId);
    if (!actor || actor.type !== "npc") {
      return { value: 0, label: "", sourceActorId: "", sourceTokenId: "" };
    }

    const enabled = !!actor.system?.aura?.enabled;
    if (!enabled) {
      return { value: 0, label: "", sourceActorId: "", sourceTokenId: "" };
    }

    const npcAttr = Number(
      actor.system?.attributes?.[attrKey] ??
      actor.system?.baseAttributes?.[attrKey] ??
      0
    );

    const label = String(actor.system?.aura?.label || "Oppressive Presence");

    return {
      value: -npcAttr,
      label,
      sourceActorId: actor.id,
      sourceTokenId: ""
    };
  }

  /** Compute the player's Gambit deck/hand max from the LEVELS table with robust fallbacks. */
  _mgGetPlayerGambitMax() {
    const lvl = Number(this.actor.system?.level) || 1;
    const LVLS = CONFIG.MidnightGambit?.LEVELS ?? {};
    const row  = LVLS[lvl] ?? {};

    // Try common schema variants (support your past/future naming)
    const candidates = [
      row.gambits?.deckSize,
      row.gambits?.handSize,
      row.gambits?.slots,
      row.deckSize,
      row.handSize,
      row.gambitSlots,
      row.slots
    ].filter(v => Number.isFinite(Number(v)));

    if (candidates.length) return Number(candidates[0]);

    // Fallbacks to actor/system values if LEVELS row doesn't define it
    const sys = this.actor.system?.gambits ?? {};
    return Number(sys.deckSize ?? sys.maxDeckSize ?? sys.maxDrawSize ?? 3) || 3;
  }

  /**
   * Centered overlay for a Gambit: shows name + description.
   * Uses your exact HTML structure and styling. No CSS overrides beyond overlay/animation.
   * Accepts { id, source, name, description } and optional { sourceEl, onClose }.
   */
  _mgOpenGambitZoom(data, { sourceEl = null, onClose = null } = {}) {
    const itemId     = data?.id ?? null;
    const fromSource = data?.source ?? "drawn";
    const rawName    = data?.name ?? "Gambit";
    const name       = String(rawName).replace(/[&<>"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]));
    const description = (data?.description ?? "").trim(); // allow rich HTML from item/system

    // Inject tiny, namespaced CSS just for the overlay + enter animation
    if (!document.getElementById("mg-gz-styles")) {
      const style = document.createElement("style");
      style.id = "mg-gz-styles";
      style.textContent = `
        .mg-gz-backdrop {
          position: fixed; inset: 0; display: grid; place-items: center;
          background: rgba(0,0,0,0.55); z-index: 10000;
          opacity: 0; transition: opacity 160ms ease;
        }
        .mg-gz-backdrop.mg-gz-show { opacity: 1; }
        /* Only animation affordances on the container so your own card CSS stays intact */
        .mg-gz-card {
          box-shadow: 0 10px 40px rgba(0,0,0,0.6);
          transform: scale(0.92);
          opacity: 0;
          transition: transform 160ms ease, opacity 160ms ease;
        }
        .mg-gz-card.mg-gz-in { transform: scale(1); opacity: 1; }
      `;
      document.head.appendChild(style);
    }

    // Build the overlay using YOUR structure
    const overlay = document.createElement("div");
    overlay.className = "mg-gz-backdrop";
    overlay.innerHTML = `
      <div class="mg-gz-card" role="dialog" aria-label="${name}">
        <div class="mg-gz-header">
          <h3 class="gambit-title">${name}</h3>
          <button class="mg-gz-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="mg-gz-body">${description || "<em>No description.</em>"}</div>
        <button class="mg-gz-play" data-item-id="${itemId ?? ""}" data-source="${fromSource}">
          <i class="fa-solid fa-play mg-icon"></i> Play
        </button>
      </div>
    `;

    const cardEl = overlay.querySelector(".mg-gz-card");

    // Unified close that also triggers optional onClose callback
    const finishClose = () => { try { if (typeof onClose === "function") onClose(); } catch(_) {} };
    const close = () => {
      window.removeEventListener("keydown", onKey);
      overlay.classList.remove("mg-gz-show");
      cardEl.classList.remove("mg-gz-in");
      setTimeout(() => { overlay.remove(); finishClose(); }, 160);
    };
    const onKey = (ev) => { if (ev.key === "Escape") close(); };

    // Close interactions
    overlay.addEventListener("click", (ev) => { if (ev.target === overlay) close(); });
    overlay.querySelectorAll(".mg-gz-close").forEach(btn => btn.addEventListener("click", close));
    window.addEventListener("keydown", onKey);

    // Play → post to chat → move to Discard → close
    overlay.querySelector(".mg-gz-play")?.addEventListener("click", async (ev) => {
      ev.preventDefault();
      try {
        // 1) Post to chat
        const chatContent = `
          <div class="chat-move">
            <h2><i class="fa-solid fa-cards"></i> ${name}</h2>
            <p>${description}</p>
          </div>
        `;
        await ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor: this.actor }),
          content: chatContent
        });

        // 2) Move from its source list → discard (if we know which)
        if (itemId) {
          const g = this.actor.system.gambits ?? {};
          const srcList = Array.isArray(g[fromSource]) ? [...g[fromSource]] : [];
          const discard = Array.isArray(g.discard) ? [...g.discard] : [];
          const idx = srcList.indexOf(itemId);
          if (idx !== -1) srcList.splice(idx, 1);
          if (!discard.includes(itemId)) discard.push(itemId);
          await this.actor.update({
            [`system.gambits.${fromSource}`]: srcList,
            "system.gambits.discard": discard
          });
        }
      } catch (err) {
        console.error("MG | Play Gambit failed:", err);
        ui.notifications?.error("Failed to play Gambit. See console.");
      } finally {
        close();
      }
    });

    // Mount + staged entrance (transform-origin biased toward the clicked card)
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.classList.add("mg-gz-show");
      if (sourceEl) {
        try {
          const r = sourceEl.getBoundingClientRect();
          const cx = (r.left + r.right) / 2;
          const cy = (r.top + r.bottom) / 2;
          cardEl.style.transformOrigin = `${(cx / innerWidth) * 100}% ${(cy / innerHeight) * 100}%`;
        } catch(_) {}
      }
      cardEl.classList.add("mg-gz-in");
    });

    return overlay;
  }

  async close(options) {
    if (this._stoHookId) {
      Hooks.off("updateActor", this._stoHookId);
      this._stoHookId = null;
    }
    return super.close(options);
  }

  /**
   * Pull a styled clone of the hand card to the exact viewport center.
   * We animate the fixed-position shell (not the inner ghost) so centering is precise.
   */
  async _mgPullFromHand(sourceEl) {
    if (!sourceEl) return;

    // 1) Measure the source card
    const src = sourceEl.getBoundingClientRect();

    // 2) Build an ancestry "shell" so your existing CSS still applies
    const shell = document.createElement("div");
    shell.className = "gambit-hand-ui";
    const shellInner = document.createElement("div");
    shellInner.className = "gambit-hand";
    shell.appendChild(shellInner);

    // 3) Clone the card (deep) with all its classes/children intact
    const ghost = sourceEl.cloneNode(true);
    shellInner.appendChild(ghost);

    // 4) Fix-position the shell at the card’s spot
    Object.assign(shell.style, {
      position: "fixed",
      left: `${src.left}px`,
      top: `${src.top}px`,
      width: `${src.width}px`,
      height: `${src.height}px`,
      margin: 0,
      zIndex: 10001,
      pointerEvents: "none",
      // We'll animate THIS element so centering math is exact
      transformOrigin: "0 0",
      transition: "transform 220ms ease, opacity 220ms ease",
      opacity: "1"
    });

    // Keep the ghost visually intact; no transforms here
    ghost.style.willChange = "transform, opacity";

    document.body.appendChild(shell);

    // 5) Compute transform that centers the scaled shell
    const scale = Math.min(1.2, Math.max(1.05, 600 / Math.max(src.width, src.height)));
    const targetLeft = (window.innerWidth  / 2) - (src.width  * scale) / 2;
    const targetTop  = (window.innerHeight / 2) - (src.height * scale) / 2;

    const dx = targetLeft - src.left;
    const dy = targetTop  - src.top;

    // Force reflow so the transition kicks
    // eslint-disable-next-line no-unused-expressions
    shell.offsetWidth;

    // 6) Animate the shell to center (translate THEN scale from its top-left)
    shell.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`;

    // 7) Finish & clean up
    await new Promise((res) => setTimeout(res, 220));
    shell.style.opacity = "0";
    await new Promise((res) => setTimeout(res, 120));
    shell.remove();
  }

  _mgMarkHandCardActive(el, isActive) {
    if (!el) return;
    el.style.transition = "opacity 160ms ease";
    el.style.opacity = isActive ? "0.15" : "1";
  }

  /** Nudge the header name text so Chrome repaints it (fixes rare invisibility bug). */
  _mgRepaintHeader() {
    const root = this.element?.[0];
    if (!root) return;

    const el = root.querySelector("[data-mg-nameblock] .mg-name-view");
    if (!el) return;

    // Tiny transform dance to force a repaint without changing layout
    el.style.willChange = "transform";
    el.style.transform = "translateZ(0.001px)";
    // Force reflow so the browser commits the new layer
    void el.getBoundingClientRect();
    // Clear hints again
    el.style.transform = "";
    el.style.willChange = "";
  }

  // --- Read-only mode for non-owners: block clicks, rolls, inputs, drags ---
  _mgMakeReadOnly(html) {
    const $root = html instanceof jQuery ? html : $(html);

    // Disable form controls (but keep scrolling)
    $root.find('input:not([type="hidden"]), select, textarea, button').prop('disabled', true);
    $root.find('[contenteditable="true"]').attr('contenteditable', 'false');

    // Remove draggable affordances
    $root.find('[draggable="true"]').attr('draggable', 'false');

    // Any interactive selectors we want to neuter (rolls, toggles, etc.)
    const hotSelectors = [
      ".strain-dot",
      ".risk-dot",
      ".flashback-dot",
      ".load-icon",
      ".draw-gambit",
      ".discard-card",
      ".remove-from-hand",
      ".post-move",
      ".post-signature",
      ".spark-dot",
      ".capacity-box input",
      ".remove-guise",
      ".attribute-modifier",
      ".skill-name", ".skill-value",
      ".repair-armor",
      ".item-delete",
      ".post-weapon-tags", ".post-armor-tags", ".post-misc-tags",
      ".sync-tags",
      ".reset-gambit-deck",
      ".post-gambit",
      ".play-gambit",
      ".gambit-hand-card",
      "[data-roll]", ".rollable", ".inline-roll"
    ].join(", ");

    // Intercept events so existing handlers never fire
    const block = (ev) => {
      // Allow normal links (e.g., to open compendium entries) to still work
      const el = ev.target;
      const allowLink = el.closest?.("a[href]") != null;
      if (allowLink) return;
      ev.stopImmediatePropagation();
      ev.stopPropagation();
      ev.preventDefault();
      return false;
    };

    $root.on("click.mgLock", hotSelectors, block);
    $root.on("dblclick.mgLock", hotSelectors, block);
    $root.on("contextmenu.mgLock", hotSelectors, block);
    $root.on("dragstart.mgLock", hotSelectors, block);
    $root.on("keydown.mgLock", hotSelectors, (ev) => {
      if (ev.key === "Enter" || ev.key === " ") block(ev);
    });

    // Optional: add a class for styling "read-only" visuals if you want
    $root.addClass("mg-view-only");
  }

  /* If the current user is not an owned of this Actor, only show the first tab.
  This hides the extra tab buttons and their panels in the DOM
  Change MIN_LEVEL to "OBSERVER" if you want observers to see all tabs.
  ----------------------------------------------------------------------*/
  _mgRestrictTabsForNonOwners(html) {
    const isOwner = this.actor?.testUserPermission?.(game.user, "OWNER") || this.actor?.isOwner || game.user.isGM;
    if (isOwner) return; // Owners & GMs see everything

    // Locate the tab nav & body
    const $root = html instanceof jQuery ? html : $(html);
    const $nav  = $root.find("nav.sheet-tabs, .sheet-tabs").first();
    const $items = $nav.find('.item[data-tab], [data-tab].item');

    if (!$items.length) return;

    // First tab id (fallback-safe)
    const $firstItem = $items.first();
    const firstTab = $firstItem.data("tab") || $firstItem.attr("data-tab");
    if (!firstTab) return;

    // Remove all other nav items
    $items.slice(1).remove();

    // Hide/remove all other tab panels
    const $body = $root.find(".sheet-body");
    const $tabs = $body.find('.tab[data-tab]');
    $tabs.each((_, el) => {
      const tab = el.getAttribute("data-tab");
      if (tab !== firstTab) el.remove();
    });

    // Force-activate the first tab visually
    $nav.find(".item").removeClass("active");
    $firstItem.addClass("active");
    $body.find(".tab").removeClass("active");
    $body.find(`.tab[data-tab="${firstTab}"]`).addClass("active");
  }


  /* Post a Gambit card to chat with full styled HTML
  ----------------------------------------------------------------------*/
  async _mgPostGambitToChat(item) {
    const { name, system } = item;
    const { description = "", tier = "", tags = [] } = system;

    const tagLabels = (tags || [])
      .map(t => CONFIG.MidnightGambit.ITEM_TAGS.find(def => def.id === t)?.label || t)
      .join(", ");

    const html = `
      <div class="gambit-chat-card">
        <h2><i class="fa-solid fa-cards"></i> ${name}</h2>
        <p><strong>Tier:</strong> ${tier.charAt(0).toUpperCase() + tier.slice(1)}</p>
        ${tagLabels ? `<p><strong>Tags:</strong> ${tagLabels}</p>` : ""}
        <p>${description}</p>
      </div>
    `;

    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: html
    });
  }

  /* Level Wizard
  ==============================================================================*/

  /* Putting icons next to buttons on all sections
  ----------------------------------------------------------------------*/  
  _mgBtn(text, faRight = "fa-arrow-right") {
    return `${text} <i class="fa-solid ${faRight}"></i>`;
  }

  async _mgPrompt({
    title,
    bodyHtml,
    okText = "Save",
    okIcon = "fa-check",
    cancelText = "Cancel",
    cancelIcon = "fa-circle-xmark",
    getValue,
    classes = [],
    ...dialogOptions
  }) {
    const result = await Dialog.wait({
      title,
      content: `<h2 class="modal-headline">${title}</h2>${bodyHtml}`,
      buttons: {
        ok: { label: this._mgBtn(okText, okIcon), callback: html => getValue($(html)) },
        cancel: { label: this._mgBtn(cancelText, cancelIcon), callback: () => null }
      },
      default: "ok",
      classes,
      ...dialogOptions
    });

    return result;
  }

  /* Decrement a pending counter on the actor flag (fallback if mgSpendPending is absent)
  ----------------------------------------------------------------------*/
  async _mgConsumePendingRaw(kind = "moves", amt = 1) {
    const state = await this.actor.getFlag("midnight-gambit", "state") ?? {};
    const p = { ...(state.pending ?? {}) };
    const cur = Number(p[kind] ?? 0);
    if (cur <= 0) return false; // nothing to do
    p[kind] = Math.max(0, cur - amt);
    await this.actor.setFlag("midnight-gambit", "state", { ...state, pending: p });
    return true;
  }

  /* Detect multiple moves added
  ----------------------------------------------------------------------*/
  async mgSpendPending(kind, data = {}) {
    const map = { move: "moves", attribute: "attributes", skill: "skills" };
    const key = map[kind] ?? kind;
    const state = (await this.getFlag("midnight-gambit", "state")) ?? {};
    const p = { ...(state.pending ?? {}) };
    const cur = Number(p[key] ?? 0);
    if (!cur) return false;

    p[key] = Math.max(0, cur - 1);
    await this.setFlag("midnight-gambit", "state", { ...state, pending: p });
    return true;
  }

    /* Level up function guiding players through their levels
  ----------------------------------------------------------------------*/

  async _openLevelWizard() {
    const actor = this.actor;

    const fmt = (p) => [
      p.attributes ? `${p.attributes} Attribute` : null,
      p.skills ? `${p.skills} Skill` : null,
      p.moves ? `${p.moves} Move` : null,
      p.sparkSlots ? `${p.sparkSlots} Spark Slot` : null,
      p.signaturePerk ? `Signature Perk` : null,
      p.finalHandDiscoverable ? `Final Hands discoverable` : null
    ].filter(Boolean).join(", ");

    const readPending = async () => {
      const s = await actor.getFlag("midnight-gambit","state");
      const p = s?.pending || {};
      return {
        attributes: Number(p.attributes||0),
        skills: Number(p.skills||0),
        moves: Number(p.moves||0),
        sparkSlots: Number(p.sparkSlots||0),
        signaturePerk: Number(p.signaturePerk||0),
        finalHandDiscoverable: Number(p.finalHandDiscoverable||0)
      };
    };

    // 1) Summary
    let pending = await readPending();
    if (!Object.values(pending).some(n => n>0)) {
      ui.notifications.info("No unspent level rewards.");
      return;
    }

    await Dialog.wait({
      title: "Level Up Rewards",   // plain string only
      content: `
        <p>You have gained: <strong>${fmt(pending)}</strong>.</p>
        <p>Let’s apply them now. You can close any step to finish later.</p>
      `,
      buttons: {
        ok: {
          label: `Continue <i class="fa-solid fa-arrow-right"></i>`
        }
      }
    });

    // 2) Spend Attribute Points
    while ((pending = await readPending()).attributes > 0) {
      const keys = ["tenacity","finesse","resolve","guile","instinct","presence"];
      const options = keys.map(k => `<option value="${k}">${k.toUpperCase()}</option>`).join("");
      const content = `
        <p>Spend 1 <strong>Attribute</strong> point:</p>
        <select name="attrKey">${options}</select>
      `;
      const chosen = await this._mgPrompt({
        title: "Spend Attribute",
        bodyHtml: `
          <p>Spend 1 <strong>Attribute</strong> point:</p>
          <select name="attrKey">${options}</select>
        `,
        okText: "Apply",
        okIcon: "fa-check",
        cancelText: "Later",
        cancelIcon: "fa-clock",
        getValue: (html) => html.find('select[name="attrKey"]').val()
      });
      if (!chosen) break; // user closed → leave as pending
      try { await actor.mgSpendPending("attribute", { key: chosen }); } catch (e) { ui.notifications.error(e.message); break; }
    }

    // 3) Spend Skill Points
    while ((pending = await readPending()).skills > 0) {
      const skills = Object.keys(actor.system?.skills || {}).sort();
      const options = skills.map(k => `<option value="${k}">${k}</option>`).join("");
      const content = `
        <p>Spend 1 <strong>Skill</strong> point:</p>
        <select name="skillKey">${options}</select>
      `;
      const chosen = await this._mgPrompt({
        title: "Spend Skill",
        bodyHtml: `
          <p>Spend 1 <strong>Skill</strong> point:</p>
          <select name="skillKey">${options}</select>
        `,
        okText: "Apply",
        okIcon: "fa-check",
        cancelText: "Later",
        cancelIcon: "fa-clock",
        getValue: (html) => html.find('select[name="skillKey"]').val()
      });
      if (!chosen) break;
      try { await actor.mgSpendPending("skill", { key: chosen }); } catch (e) { ui.notifications.error(e.message); break; }
    }

    // 4) Apply Spark Slots (casters only — they’re the only ones who got these pending)
    while ((pending = await readPending()).sparkSlots > 0) {
      const ok = await Dialog.wait({
        title: "Add Spark Slot?",
        content: `
          <p>Add <strong>+1 Spark Slot</strong> to your pool now?</p>
        `,
        buttons: {
          yes: { label: this._mgBtn("Add", "fa-plus"), callback: () => true },
          no:  { label: this._mgBtn("Later", "fa-clock"), callback: () => false }
        },
        default: "yes"
      });
      if (!ok) break; // leave pending if they want to do later
      try { await actor.mgSpendPending("spark"); } catch (e) { ui.notifications.error(e.message); break; }
    }

    // 5) Signature Perk / Final Hand acknowledgements (real pickers later)
    if ((pending = await readPending()).signaturePerk > 0) {
      const ok = await Dialog.wait({
        title: "Signature Perk",
        content: `
          <p>You unlocked a <strong>Signature Perk</strong>.</p>
        `,
        buttons: {
          yes: { label: this._mgBtn("Acknowledge", "fa-check-double"), callback: () => true },
          no:  { label: this._mgBtn("Later", "fa-clock"), callback: () => false }
        },
        default: "yes"
      });

      if (ok) { try { await actor.mgSpendPending("ack-signature"); } catch (e) {} }
    }

    if ((pending = await readPending()).finalHandDiscoverable > 0) {
      const ok = await Dialog.wait({
        title: "Final Hand",
        content: `
          <p><strong>Final Hands</strong> are now discoverable. Mark this as acknowledged?</p>
        `,
        buttons: {
          yes: { label: this._mgBtn("Acknowledge", "fa-check-double"), callback: () => true },
          no:  { label: this._mgBtn("Later", "fa-clock"), callback: () => false }
        },
        default: "yes"
      });
      if (ok) { try { await actor.mgSpendPending("ack-finalhand"); } catch (e) {} }
    }

    // 6) Moves (we’ll do a picker later — for now just nudge them)
    if ((pending = await readPending()).moves > 0) {
      await Dialog.wait({
        title: "Choose New Move",
        content: `
          <p>You have <strong>${pending.moves}</strong> unspent move(s). Head to your Moves area and add one; the pending counter will remain until you finalize.</p>
        `,
        buttons: {
          ok: { label: this._mgBtn("Okay", "fa-thumbs-up") }
        }
      });
    }

    // 7) Done
    pending = await readPending();
    if (Object.values(pending).some(n => n>0)) {
      ui.notifications.info("Some rewards remain unspent — you can finish later from the Settings tab banner.");
    } else {
      ui.notifications.info("Level rewards applied. Nice!");
    }

    // Soft re-render to refresh banner/buttons
    this.render(false);
  }

  /* Drag and Drop onto Character Sheet
  ==============================================================================*/
  async _onDropItemCreate(itemData) {

    // --- Guard: block Crew-tier Gambits from being dropped on Character sheets ---
    try {
      // Normalize payload (compendiums sometimes nest at system.system)
      const raw = itemData?.system?.system ? itemData.system : itemData;
      const type = raw?.type ?? itemData?.type;

      if (type === "gambit") {
        // Try to read tier directly
        let tier = String(raw?.system?.tier ?? raw?.tier ?? "").toLowerCase();

        // Fallback 1: resolve by UUID (compendiums, sidebar)
        if (!tier && itemData?.uuid) {
          const src = await fromUuid(itemData.uuid).catch(() => null);
          tier = String(src?.system?.tier ?? "").toLowerCase();
        }

        // Fallback 2: resolve by core sourceId (world copy of a compendium item)
        if (!tier && itemData?.flags?.core?.sourceId) {
          const base = await fromUuid(itemData.flags.core.sourceId).catch(() => null);
          tier = String(base?.system?.tier ?? "").toLowerCase();
        }

        if (tier === "crew") {
          ui.notifications?.warn("Crew-tier Gambits can only be added to the Crew.");
          return []; // stop the drop cleanly (Actor gets nothing)
        }
      }
    } catch (e) {
      console.warn("MG | Gambit tier guard failed (non-fatal):", e);
    }

    // --- Deck capacity check for Player Gambits (pre-create) ---
    try {
      // Normalize payload
      const raw = itemData?.system?.system ? itemData.system : itemData;
      const type = raw?.type ?? itemData?.type;

      if (type === "gambit") {
        // Read current deck + max (fallbacks keep old characters safe)
        const g = this.actor.system?.gambits ?? {};
        const deck = Array.isArray(g.deck) ? g.deck : [];
        const deckMax = this._mgGetPlayerGambitMax();

        if (deck.length >= deckMax) {
          const ok = await Dialog.confirm({
            title: "Over Deck Limit?",
            content: `
              <p>You're going over your max available Player Gambits for this level
              (<strong>${deck.length}/${deckMax}</strong>).</p>
              <p><em>Only add this if your Director approves!</em></p>
            `,
            defaultYes: false,
            yes: () => true, no: () => false
          });
          if (!ok) return []; // cancel the add
        }
      }
    } catch (e) {
      console.warn("MG | Player Gambit deck cap check failed (non-fatal):", e);
    }

    if (itemData.type === "guise") {
      console.log("✅ Dropped a guise item on actor");

      // Ensure baseAttributes snapshot exists once
      if (!this.actor.system.baseAttributes || Object.keys(this.actor.system.baseAttributes).length === 0) {
        const base = foundry.utils.deepClone(this.actor.system.attributes);
        await this.actor.update({ "system.baseAttributes": base });
      }

      // Helper: load dropped guise (uuid from compendium OR raw data)
      const loadDroppedGuise = async () => {
        if (itemData?.uuid) {
          const g = await fromUuid(itemData.uuid);
          if (!g) throw new Error("Failed to load item from UUID");
          return g;
        }

        const data = itemData.system?.system ? itemData.system : itemData;
        if (!data.name || !data.type) throw new Error("Dropped item missing required fields");
        return Item.implementation.create(data, { temporary: true });
      };

      let guise;
      try {
        console.log("🧪 Dropped itemData:", itemData);
        guise = await loadDroppedGuise();
      } catch (err) {
        console.error("Failed to retrieve dropped guise:", err);
        ui.notifications.error("Could not load the dropped Guise item.");
        return [];
      }

      if (!guise || guise.type !== "guise") {
        ui.notifications.error("Dropped item is not a valid Guise.");
        return [];
      }

      // Embed the dropped guise onto the actor
      const [embedded] = await this.actor.createEmbeddedDocuments("Item", [guise.toObject()]);

      // Primary vs Secondary rules (max 2 total)
      const primaryId = this.actor.system?.guise || null;
      const secondary = Array.isArray(this.actor.system?.secondaryGuises) ? this.actor.system.secondaryGuises.slice() : [];

      // If no primary, set this as primary
      if (!primaryId) {
        await this.actor.update({ "system.guise": embedded.id });
      } else {
        // Already has a primary; this becomes SECONDARY (if slot available)
        if (secondary.length >= 1) {
          ui.notifications.warn("You can only have 2 Guises total (1 primary + 1 secondary).");
          // Optional: delete the embedded item we just created to prevent clutter
          try { await embedded.delete(); } catch (_) {}
          return [];
        }

        secondary.push(embedded.id);
        await this.actor.update({ "system.secondaryGuises": secondary });
      }

      // ---- Spark Schools prompt logic (only when you become a caster for the first time / no schools picked) ----
      // We do NOT retro-grant leveling spark bonus here (per your rule). This is just: do you have schools configured?
      const hadSchools = Boolean(this.actor.system?.sparkSchool1) || Boolean(this.actor.system?.sparkSchool2);
      const schoolsNeededCheck = async () => {
        // Force a re-prepare so actor.system.casterType reflects best-of-both right now
        // (Foundry will also do this on re-render, but we want correct logic immediately)
        this.actor.prepareData();

        const ct = this.actor.system?.casterType ?? null;
        const isCaster = (ct === "full" || ct === "half");
        if (!isCaster) return;

        // If we already have schools, don’t prompt again.
        if (hadSchools) return;

        // Choose schools based on caster type.
        const needsTwo = (ct === "full");

        const schools = [
          { value: "veiling", label: "Veiling" },
          { value: "sundering", label: "Sundering" },
          { value: "binding", label: "Binding" },
          { value: "drift", label: "Drift" },
          { value: "threading", label: "Threading" },
          { value: "warding", label: "Warding" },
          { value: "shaping", label: "Shaping" },
          { value: "gloom", label: "Gloom" },
          { value: "ember", label: "Ember" }
        ];

        const form = document.createElement("form");

        const label1 = document.createElement("label");
        label1.textContent = "Spark School 1";
        const select1 = document.createElement("select");
        select1.name = "sparkSchool1";
        select1.innerHTML =
          `<option value="">-- Select --</option>` +
          schools.map(s => `<option value="${s.value}">${s.label}</option>`).join("");

        form.appendChild(label1);
        form.appendChild(select1);

        let select2 = null;
        if (needsTwo) {
          const label2 = document.createElement("label");
          label2.textContent = "Spark School 2";
          select2 = document.createElement("select");
          select2.name = "sparkSchool2";
          select2.innerHTML =
            `<option value="">-- Select --</option>` +
            schools.map(s => `<option value="${s.value}">${s.label}</option>`).join("");

          // Prevent duplicates
          select1.addEventListener("change", () => {
            const selected1 = select1.value;
            select2.querySelectorAll("option").forEach(opt => {
              opt.disabled = opt.value === selected1 && opt.value !== "";
            });
          });

          form.appendChild(label2);
          form.appendChild(select2);
        }

        let sparkSchool1 = "";
        let sparkSchool2 = "";

        await Dialog.wait({
          title: "Choose Spark School(s)",
          content: `${form.outerHTML}`,
          buttons: {
            ok: {
              label: this._mgBtn("Confirm", "fa-check"),
              callback: () => {
                sparkSchool1 = document.querySelector('[name="sparkSchool1"]')?.value || "";
                sparkSchool2 = needsTwo ? (document.querySelector('[name="sparkSchool2"]')?.value || "") : "";
                return true;
              }
            },
            cancel: { label: this._mgBtn("Cancel", "fa-circle-xmark"), callback: () => false }
          },
          default: "ok",
          render: (html) => {
            if (needsTwo) {
              const s1 = html[0].querySelector('[name="sparkSchool1"]');
              const s2 = html[0].querySelector('[name="sparkSchool2"]');
              s1?.addEventListener("change", () => {
                const v1 = s1.value;
                Array.from(s2.options).forEach(opt => {
                  opt.disabled = opt.value === v1 && opt.value !== "";
                });
              });
            }
          }
        });

        // Save selections (even if blank; you can enforce non-blank later if you want)
        await this.actor.update({
          "system.sparkSchool1": sparkSchool1,
          "system.sparkSchool2": sparkSchool2
        });
      };

      await schoolsNeededCheck();

      // Re-render so spark/risk recalcs (from actor.js prepareData) show immediately
      ui.notifications.info(`${guise.name} applied!`);
      await this.render(true);
      return [];
    }
        
    /* Gambit Item creation and limits
    ----------------------------------------------------------------------*/
    if (itemData.type === "gambit") {
      const [gambitItem] = await this.actor.createEmbeddedDocuments("Item", [itemData]);

      // Use level-scaled deck capacity from actor data (not hard-coded 3)
      const g = this.actor.system.gambits ?? {};
      const deck = Array.isArray(g.deck) ? g.deck : [];
      const maxDeck = this._mgGetPlayerGambitMax();

      // Don’t add duplicates; enforce capacity
      const nextDeck = deck.includes(gambitItem.id) ? deck : [...deck, gambitItem.id];

      if (nextDeck.length > maxDeck) {
        // Roll back the item we just created and warn
        await gambitItem.delete();
        ui.notifications.warn(`Your deck can hold ${maxDeck} Gambits right now.`);
        return [];
      }

      await this.actor.update({ "system.gambits.deck": nextDeck });
      return [];
    }


    /* Learned Move drop-on-actor
    ---------------------------------------------------------------------*/
    if (itemData.type === "move") {
      console.log("✅ Dropped a Move on actor");

      // 1) Hydrate move data whether from compendium UUID or raw data
      let moveDoc;
      try {
        if (itemData?.uuid) {
          // From compendium or world via UUID
          const src = await fromUuid(itemData.uuid);
          if (!src) throw new Error("Could not resolve dropped Move via UUID");
          moveDoc = src.toObject();
        } else {
          // From world item or drag payload
          const data = itemData.system?.system ? itemData.system : itemData;
          if (!data?.name || !data?.type) throw new Error("Dropped Move missing fields");
          moveDoc = data;
        }
      } catch (err) {
        console.error("Failed to read dropped Move:", err);
        ui.notifications.error("Could not read the dropped Move.");
        return [];
      }

      // Prevent NPC moves from being learned by PCs
      if (moveDoc?.system?.npcMove === true || moveDoc?.system?.npcSignature === true) {
        ui.notifications.warn("That’s an NPC-only Move. It can’t be learned by player characters.");
        return [];
      }

      // 2) De-dupe prevention: by core sourceId OR by name (case-insensitive)
      //    (protects against adding the exact same move twice)
      const existing = this.actor.items.find(i =>
        i.type === "move" && (
          (i.flags?.core?.sourceId && i.flags.core.sourceId === moveDoc.flags?.core?.sourceId) ||
          (i.name?.toLowerCase?.() === moveDoc.name?.toLowerCase?.())
        )
      );
      if (existing) {
        ui.notifications.warn(`${moveDoc.name} is already on ${this.actor.name}.`);
        return [];
      }

      // 3) Respect Signature Perk flag
      moveDoc.system = moveDoc.system || {};
      const isSignature = Boolean(moveDoc.system.isSignature);

      // If it's a Signature Perk, do NOT force learned=true.
      // If it's a normal Move drop, keep your current behavior (learned=true).
      if (!isSignature) {
        moveDoc.system.learned = true;
      } else {
        moveDoc.system.learned = false; // keeps it out of "Learned Moves"
      }

      // 4) Create on actor
      const [embedded] = await this.actor.createEmbeddedDocuments("Item", [moveDoc]);

      // 5) Feedback + refresh
      ui.notifications.info(
        isSignature
          ? `Signature Perk added: ${embedded.name}`
          : `Learned Move added: ${embedded.name}`
      );
      this.render(false);
      return [];
    }

    // Gate Gambit drops on Character sheets: disallow Crew-tier here
    try {
      const data = TextEditor.getDragEventData(event);
      if (data?.type === "Item") {
        const src = await fromUuid(data.uuid);
        if (src?.documentName === "Item") {
          const type = src.type;
          if (type === "gambit") {
            const tier = String(src.system?.tier ?? "rookie").toLowerCase();
            if (tier === "crew") {
              ui.notifications?.warn("Crew-tier Gambits can only be added to the Crew.");
              return false;
            }
          }
        }
      }
    } catch (_) {}


    return super._onDropItemCreate(itemData);
  }

  /** Preserve scroll position across re-renders + fix header paint glitches. */
  async _render(force, options = {}) {
    const bodyBefore = this.element?.[0]?.querySelector?.(".window-content");
    const scrollTop = bodyBefore?.scrollTop ?? 0;

    await super._render(force, options);

    const bodyAfter = this.element?.[0]?.querySelector?.(".window-content");
    if (bodyAfter) bodyAfter.scrollTop = scrollTop;

    // After Foundry finishes painting, nudge the header so text is always visible
    this._mgRepaintHeader();
  }

  //END DRAG AND DROP
  //---------------------------------------------------------------------------------------------------------------------------

  /* Move order helpers (class-safe)
  ---------------------------------------------------------------------*/
  async _mgGetMoveOrder() {
    const state = await this.actor.getFlag("midnight-gambit", "moveOrder");
    return Array.isArray(state) ? state : [];
  }

  async _mgSetMoveOrder(orderIds) {
    const existing = new Set(this.actor.items.filter(i => i.type === "move").map(i => i.id));
    const clean = orderIds.filter(id => existing.has(id));
    await this.actor.setFlag("midnight-gambit", "moveOrder", clean);
    return clean;
  }

  async _mgSaveMoveOrderFromDom($grid) {
    const ids = $grid.find(".move-block").map((_i, el) => el.dataset.itemId).get();
    await this._mgSetMoveOrder(ids);
  }

  async _mgApplyMoveOrderToDom($grid) {
    const order = await this._mgGetMoveOrder();
    if (!order.length) return;
    const byId = {};
    $grid.find(".move-block").each((_i, el) => { byId[el.dataset.itemId] = el; });

    for (const id of order) if (byId[id]) $grid.append(byId[id]);
    $grid.find(".move-block").each((_i, el) => {
      if (!order.includes(el.dataset.itemId)) $grid.append(el);
    });
  }

  // Bind delete + drag reorder on the Moves grid (with live preview slot)
  _mgBindMoveGrid(html) {
    const $root = html instanceof jQuery ? html : $(html);
    const $grid = $root.find(".moves-grid");
    if (!$grid.length) return;

    // Ensure each card is draggable
    $grid.find(".move-block").attr("draggable", "true");

    // A single placeholder used during drag to show the drop slot
    let dragId = null;
    let dragEl = null;
    let placeholder = document.createElement("div");
    placeholder.className = "move-block mg-drop-placeholder";
    placeholder.setAttribute("aria-hidden", "true");

    // --- DELETE handler (unchanged; keep your working delete logic) ---
    $grid.off("click.mgMovesDel").on("click.mgMovesDel", ".delete-move", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const btn  = ev.currentTarget;
      const card = btn.closest(".move-block");
      const itemId =
        card?.dataset?.itemId ||
        btn.getAttribute("data-item-id") ||
        btn.closest("[data-item-id]")?.getAttribute("data-item-id");

      if (!itemId) {
        ui.notifications?.warn?.("Could not determine which Move to delete.");
        return;
      }

      const item = this.actor.items.get(itemId);
      if (!item) {
        ui.notifications?.warn?.("That Move was not found on this character.");
        return;
      }

      const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
      const ok = await Dialog.confirm({
        title: "Remove Move?",
        content: `<p>This will remove <strong>${esc(item.name)}</strong> from this character.</p>`
      });
      if (!ok) return;

      try {
        await this.actor.deleteEmbeddedDocuments("Item", [itemId], { renderSheet: false });
        // drop from saved order flag if present
        const order = (await this.actor.getFlag("midnight-gambit", "moveOrder")) ?? [];
        if (order.includes(itemId)) {
          await this.actor.setFlag("midnight-gambit", "moveOrder", order.filter(id => id !== itemId));
        }
        // optimistic DOM removal
        card.remove();
      } catch (err) {
        console.error("MG | Failed to delete Move:", err);
        ui.notifications?.error?.("Failed to delete that Move. See console for details.");
      }
    });

    // --- DRAG logic with live preview slot ---
    function clearPreview() {
      if (placeholder?.parentNode) placeholder.parentNode.removeChild(placeholder);
      $grid.find(".move-block.drop-above, .move-block.drop-below, .move-block.dragging").removeClass("drop-above drop-below dragging");
    }

    $grid.on("dragstart.mgMoves", ".move-block", (ev) => {
      dragEl = ev.currentTarget;
      dragId = dragEl.dataset.itemId || null;

      // Size the placeholder to the dragged card (height + margin)
      const rect = dragEl.getBoundingClientRect();
      placeholder.style.height = `${rect.height}px`;

      ev.originalEvent?.dataTransfer?.setData("text/plain", dragId ?? "");
      ev.originalEvent?.dataTransfer?.setDragImage?.(dragEl, rect.width / 2, rect.height / 2);
      dragEl.classList.add("dragging");
    });

    $grid.on("dragend.mgMoves", ".move-block", () => {
      clearPreview();
      dragId = null;
      dragEl = null;
    });

    // Show preview: hovered card’s slot becomes the drop slot (take that spot)
    $grid.off("dragover.mgMoves", ".move-block").on("dragover.mgMoves", ".move-block", (ev) => {
      if (!dragId) return;
      ev.preventDefault();

      const target = ev.currentTarget;
      if (target === dragEl) return;

      // Clean any old preview styling and ensure single placeholder
      $grid.find(".move-block.drop-above, .move-block.drop-below").removeClass("drop-above drop-below");
      if (placeholder.parentNode && placeholder.parentNode !== target.parentNode) {
        placeholder.parentNode.removeChild(placeholder);
      }

      // Always claim the hovered card’s slot → insert placeholder BEFORE it
      if (placeholder.nextSibling !== target) {
        target.parentNode.insertBefore(placeholder, target);
      }
    });


    // Allow dropping into empty space in the grid → move to end
    $grid.on("dragover.mgMoves", (ev) => {
      // only if we're over the grid but not over a specific card
      if (!dragId) return;
      if (ev.target.closest(".move-block")) return; // handled by the other handler
      ev.preventDefault();

      // If there’s no placeholder yet, append to the end
      if (!placeholder.parentNode || placeholder.parentNode !== $grid[0]) {
        clearPreview();
        $grid[0].appendChild(placeholder);
      }
    });

    // Drop: move the dragged element where the placeholder sits, then persist
    $grid.on("drop.mgMoves", async (ev) => {
      if (!dragId || !dragEl) return;
      ev.preventDefault();

      // If no placeholder (edge case), do nothing
      if (!placeholder.parentNode) return;

      // Move the card to the placeholder position
      placeholder.parentNode.insertBefore(dragEl, placeholder);
      clearPreview();

      // Persist order flag
      const ids = $grid.find(".move-block").map((_i, el) => el.dataset.itemId).get();
      await this.actor.setFlag("midnight-gambit", "moveOrder", ids);
    });

    // Re-apply saved order once on render
    this._mgApplyMoveOrderToDom($grid);

    // Track Move create/delete while this sheet is open
    this._mgMoveCreateHook = async (item) => {
      if (item?.parent !== this.actor || item.type !== "move") return;
      setTimeout(async () => {
        const $grid2 = this.element.find(".moves-grid");
        if (!$grid2.length) return;
        const order = (await this.actor.getFlag("midnight-gambit", "moveOrder")) ?? [];
        if (!order.includes(item.id)) {
          const ids = $grid2.find(".move-block").map((_i, el) => el.dataset.itemId).get();
          await this.actor.setFlag("midnight-gambit", "moveOrder", ids);
        }
      }, 0);
    };
    this._mgMoveDeleteHook = async (item) => {
      if (item?.parent !== this.actor || item.type !== "move") return;
      const order = (await this.actor.getFlag("midnight-gambit", "moveOrder")) ?? [];
      if (order.includes(item.id)) {
        await this.actor.setFlag("midnight-gambit", "moveOrder", order.filter(id => id !== item.id));
      }
    };
    Hooks.on("createItem", this._mgMoveCreateHook);
    Hooks.on("deleteItem", this._mgMoveDeleteHook);
  }

  _mgRefreshGuiseVisibility(html = this.element) {
    const hasSystemGuise =
      Boolean(getProperty(this.actor, "system.guise")) ||
      Boolean(getProperty(this.actor, "system.guiseId")) ||
      Boolean(getProperty(this.actor, "system.guise.active"));

    const hasItemGuise = Array.isArray(this.actor.items)
      ? this.actor.items.some(i => i.type === "guise")
      : false;

    const hasGuise = hasSystemGuise || hasItemGuise;

    const $root = html instanceof jQuery ? html : $(html);
    $root.find("[data-requires-guise]").toggle(hasGuise);
    $root.find("[data-hides-with-guise]").toggle(!hasGuise);
  } 

  async _onDrop(event) {
    // Helper: what zone did we drop onto?
    const dropzone =
      event?.target?.closest?.("[data-dropzone]")?.dataset?.dropzone ?? null;

    try {
      const data = TextEditor.getDragEventData(event);

      if (data?.type === "Item" && data?.uuid) {
        const src = await fromUuid(data.uuid).catch(() => null);

        // ----------------------------
        // MOVES / SIGNATURE PERKS
        // ----------------------------
        if (src?.documentName === "Item" && src.type === "move") {
          // Hydrate into raw object data we can create
          let moveDoc = src.toObject();
          moveDoc.system = moveDoc.system || {};

          // De-dupe by sourceId or name
          const existing = this.actor.items.find(i =>
            i.type === "move" && (
              (i.flags?.core?.sourceId && i.flags.core.sourceId === moveDoc.flags?.core?.sourceId) ||
              (i.name?.toLowerCase?.() === moveDoc.name?.toLowerCase?.())
            )
          );
          if (existing) {
            ui.notifications?.warn(`${moveDoc.name} is already on ${this.actor.name}.`);
            return false;
          }

          // === NPC routing ===
          if (this.actor.type === "npc") {
            if (dropzone === "signature") {
              moveDoc.system.npcSignature = true;
              moveDoc.system.npcMove = false;
              moveDoc.system.isSignature = true;
              moveDoc.system.learned = false;

              const [embedded] = await this.actor.createEmbeddedDocuments("Item", [moveDoc]);
              ui.notifications?.info(`NPC Signature Perk added: ${embedded.name}`);
              this.render(false);
              return false;
            }

            if (dropzone === "moves") {
              moveDoc.system.npcMove = true;
              moveDoc.system.npcSignature = false;
              moveDoc.system.isSignature = false;
              moveDoc.system.learned = false;

              const [embedded] = await this.actor.createEmbeddedDocuments("Item", [moveDoc]);
              ui.notifications?.info(`NPC Move added: ${embedded.name}`);
              this.render(false);
              return false;
            }

            // Not dropped on a known zone: let Foundry handle it normally
            return super._onDrop?.(event) ?? false;
          }

          // === Character routing ===
          if (this.actor.type === "character") {
            // ONLY intercept signature zone drops.
            // Everything else should behave like normal Foundry drop (learned move, etc.)
            if (dropzone === "signature") {
              moveDoc.system.isSignature = true;
              moveDoc.system.learned = false;

              // Ensure NPC-only flags don't accidentally block it later
              moveDoc.system.npcMove = false;
              moveDoc.system.npcSignature = false;

              const [embedded] = await this.actor.createEmbeddedDocuments("Item", [moveDoc]);
              ui.notifications?.info(`Signature Perk added: ${embedded.name}`);
              this.render(false);
              return false;
            }

            return super._onDrop?.(event) ?? false;
          }
        }

        // ----------------------------
        // GAMBITS
        // ----------------------------
        if (src?.documentName === "Item" && src.type === "gambit") {
          const tier = String(src.system?.tier ?? "").toLowerCase();

          // Block Crew-tier on players
          if (tier === "crew") {
            ui.notifications?.warn("Crew-tier Gambits can only be added to the Crew.");
            return false;
          }

          // Deck capacity confirm (players)
          const g = this.actor.system?.gambits ?? {};
          const deck = Array.isArray(g.deck) ? g.deck : [];
          const deckMax = this._mgGetPlayerGambitMax?.() ?? 0;

          if (deckMax && deck.length >= deckMax) {
            const ok = await Dialog.confirm({
              title: "Over Deck Limit?",
              content: `
                <p>You're going over your max available Player Gambits for this level
                (<strong>${deck.length}/${deckMax}</strong>).</p>
                <p><em>Only add this if your Director approves!</em></p>
              `,
              defaultYes: false,
              yes: () => true, no: () => false
            });
            if (!ok) return false;
          }

          // Let Foundry do the actual drop handling (so it still creates the embedded item)
          return super._onDrop?.(event) ?? false;
        }
      }
    } catch (err) {
      console.warn("MG | _onDrop intercept failed (non-fatal):", err);
    }

    return super._onDrop?.(event) ?? false;
  }

  /** Ensure inline TinyMCE saves don't close/reopen the actor sheet */
  async _onSubmit(event, { updateData = null, preventClose = false } = {}) {
    event.preventDefault();
    // Always prevent close for this sheet; X / Esc still close it manually
    return super._onSubmit(event, { updateData, preventClose: true });
  }

  // Cleanup our temporary hooks when the sheet closes
  async close(options) {
    try {
      if (this._mgMoveCreateHook) Hooks.off("createItem", this._mgMoveCreateHook);
      if (this._mgMoveDeleteHook) Hooks.off("deleteItem", this._mgMoveDeleteHook);
      this._mgMoveCreateHook = null;
      this._mgMoveDeleteHook = null;
    } catch (_) {}

    try {
      if (this._mgCrewNameHook) Hooks.off("updateActor", this._mgCrewNameHook);
      this._mgCrewNameHook = null;
    } catch (_) {}

    return super.close(options);
  }
}

