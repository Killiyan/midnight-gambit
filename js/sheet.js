import { evaluateRoll, mgApplyStrainAttributePenalty, mgGetStrainEffectBadge, mgGetStrainRollEffects } from "./roll-utils.js";
import { GambitDeckBuilderApplication } from "./gambit-deck-builder.js";
import { MovesLibraryApplication } from "./moves-library.js";

const MG_ACTOR_GUISE_IMAGE = "systems/midnight-gambit/assets/images/guise.jpg";
const MG_ACTOR_DEFAULT_IMAGE = "icons/svg/mystery-man.svg";

function mgGetActorSheetImage(actor) {
  const img = String(actor?.img ?? "").trim();
  if (!img || img === MG_ACTOR_DEFAULT_IMAGE || img.endsWith("/mystery-man.svg")) return MG_ACTOR_GUISE_IMAGE;
  return img;
}

function mgGetActorPlacementImage(actor, key, fallback = mgGetActorSheetImage(actor)) {
  const src = String(actor?.getFlag?.("midnight-gambit", "crops")?.[key]?.src ?? "").trim();
  return src || fallback;
}

function mgGetDifficultyModifier() {
  try {
    const value = Number(game.settings.get("midnight-gambit", "gmDifficultyModifier") ?? 0);
    if (!Number.isFinite(value)) return 0;
    return Math.max(-3, Math.min(3, Math.trunc(value)));
  } catch (_) {
    return 0;
  }
}

function mgResolvePrimaryGuise(actor) {
  const ref = actor?.system?.guiseId || actor?.system?.guise;
  if (!ref) return null;

  let guise = actor?.items?.get(ref) ?? null;
  if (!guise && typeof fromUuidSync === "function") {
    try { guise = fromUuidSync(ref); } catch (_) {}
  }

  return guise?.type === "guise" ? guise : null;
}

function mgGetPrimaryGuiseAttributeModifier(actor, key) {
  const guise = mgResolvePrimaryGuise(actor);
  const mod = Number(guise?.system?.modifiers?.[key] ?? 0);
  return Number.isFinite(mod) ? mod : 0;
}

function mgGetDeckGambitRefs(deck) {
  const refs = deck?.gambits ?? deck?.cards ?? deck?.items ?? [];
  return Array.isArray(refs) ? refs : [];
}

function mgResolveDeckGambit(actor, ref) {
  if (!ref) return null;

  if (typeof ref === "string") {
    let doc = actor?.items?.get(ref) ?? null;
    if (!doc && typeof fromUuidSync === "function") {
      try { doc = fromUuidSync(ref); } catch (_) {}
    }
    return doc;
  }

  const id = ref.id ?? ref.itemId ?? ref._id ?? null;
  const uuid = ref.uuid ?? ref.itemUuid ?? null;
  let doc = actor?.items?.get(id) ?? null;
  if (!doc && uuid && typeof fromUuidSync === "function") {
    try { doc = fromUuidSync(uuid); } catch (_) {}
  }
  return doc;
}

function mgGetDeckGpSpent(actor, deck) {
  return mgGetDeckGambitRefs(deck).reduce((total, ref) => {
    const item = mgResolveDeckGambit(actor, ref);
    const refCost = typeof ref === "object" ? Number(ref.cost ?? ref.gpCost) : NaN;
    const itemCost = Number(item?.system?.gpCost);
    const cost = Number.isFinite(itemCost) ? itemCost : (Number.isFinite(refCost) ? refCost : 0);
    return total + Math.max(0, cost);
  }, 0);
}

function mgGetDeckItemIds(actor, deck) {
  const ids = [];
  const seen = new Set();

  for (const ref of mgGetDeckGambitRefs(deck)) {
    const item = mgResolveDeckGambit(actor, ref);
    const id = item?.id ?? (typeof ref === "string" ? ref : ref?.id ?? ref?.itemId ?? ref?._id);
    if (!id || seen.has(String(id))) continue;
    seen.add(String(id));
    ids.push(String(id));
  }

  return ids;
}

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
      context.actorDisplayImg = mgGetActorPlacementImage(this.actor, "profile");

      context.sparkAttribute = this.actor.system.sparkAttribute ?? "guile";


      const deckIds = context.system.gambits.deck ?? [];
      const drawnIds = context.system.gambits.drawn ?? [];
      const discardIds = context.system.gambits.discard ?? [];

      // --- Gambit counters for UI ---
      const handCount = drawnIds.length;
      const deckCount = deckIds.length;
      const discardCount = discardIds.length;
      const poolCount = new Set([...deckIds, ...drawnIds, ...discardIds].map(String)).size;
      const deckMax = Number(context.system.gambits?.maxDeckSize ?? context.system.gambits?.maxDrawSize ?? 3);

      context.gambitCounts = {
        handCount,
        deckCount,
        discardCount,
        poolCount,
        deckMax,
        gpMax: Number(context.system.gambitPoints?.max ?? 4) || 4,
        deckSlots: Number(context.system.gambitDecks?.slots ?? 1) || 1,
        deckBuildCount: Array.isArray(context.system.gambitDecks?.decks) ? context.system.gambitDecks.decks.length : 0,
        deckAtCap: poolCount >= deckMax,
        deckRemaining: Math.max(0, deckMax - poolCount)
      };

      const deckBuildSlots = context.gambitCounts.deckSlots;
      const deckBuildGpMax = context.gambitCounts.gpMax;
      const storedDecks = Array.isArray(context.system.gambitDecks?.decks)
        ? context.system.gambitDecks.decks
        : [];
      const totalDeckCards = Math.max(deckBuildSlots, storedDecks.length);
      const equippedDeckId = String(context.system.gambitDecks?.equipped ?? "");

      context.gambitDeckDesign = String(context.system.gambits?.cardDesign ?? "midnight");
      context.gambitDeckCards = Array.from({ length: totalDeckCards }, (_, index) => {
        const deck = storedDecks[index] ?? null;
        const id = String(deck?.id ?? "");
        const gpSpent = deck ? mgGetDeckGpSpent(this.actor, deck) : 0;
        return {
          slot: index + 1,
          id,
          name: deck?.name || `Deck ${index + 1}`,
          gpSpent,
          gpMax: deckBuildGpMax,
          isEmpty: !deck,
          isEquipped: Boolean(id && id === equippedDeckId),
          isOverBudget: gpSpent > deckBuildGpMax
        };
      });


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
      const handHiddenIds = Array.isArray(context.system.gambits?.handHidden)
        ? context.system.gambits.handHidden.map(String)
        : [];
      context.gambitHandControls = context.gambitDrawn.map(card => ({
        id: card.id,
        name: card.name,
        hidden: handHiddenIds.includes(String(card.id))
      }));

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
        tenacity: ["brawl", "athletics", "endure"],
        finesse:  ["aim", "stealth", "sleight"],
        resolve:  ["will", "composure", "grit"],
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

      context.strainAttributeEffects = Object.fromEntries(
        context.attributeKeys.map((key) => [
          key,
          mgGetStrainEffectBadge(mgGetStrainRollEffects(this.actor, key), { includeGlobalLock: false })
        ])
      );
      context.strainAttributeTrees = Object.fromEntries(
        context.attributeKeys.map((key) => {
          const effects = mgGetStrainRollEffects(this.actor, key);
          return [
            key,
            {
              tree: effects.tree,
              iconClass: effects.tree === "mortal" ? "fa-kit fa-mortal-strain" : "fa-kit fa-soul-strain"
            }
          ];
        })
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
        moves: Number(p.moves || 0),
        sparkSlots: Number(p.sparkSlots || 0),
        expertise: Number(p.expertise || 0),
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
          rawMoves.map(async (m, index) => {
            const tags = parseTags(m?.tags ?? m?.tagsCsv);
            return {
              ...m,
              handId: `basic:${context.guise.id}:${index}:${m?.name ?? ""}`,
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
            handId: `signature:${g.id}`,
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
          return rawMoves.map(async (m, index) => ({
            _id: `${g.id}-${m.name ?? "move"}`,
            handId: `basic:${g.id}:${index}:${m?.name ?? ""}`,
            name: m.name ?? "Unnamed Move",
            description: m.description ?? "",
            html: await TextEditor.enrichHTML(String(m.description ?? ""), { async: true }),
            tags: parseTags(m?.tags ?? m?.tagsCsv),
            guiseSource: g.id
          }));
        })
      );

      {
        const moveHidden = new Set(
          (Array.isArray(context.system.gambits?.moveHidden) ? context.system.gambits.moveHidden : [])
            .map(String)
        );
        const moveOrder = Array.isArray(context.system.gambits?.moveOrder)
          ? context.system.gambits.moveOrder.map(String)
          : [];
        const orderMap = new Map(moveOrder.map((id, index) => [id, index]));
        const controls = [];
        const seenControls = new Set();

        const addMoveControl = ({ id, name, label, sourceOrder = 0 }) => {
          const cleanId = String(id ?? "");
          if (!cleanId || seenControls.has(cleanId)) return;
          seenControls.add(cleanId);
          controls.push({
            id: cleanId,
            name: String(name || "Unnamed Move"),
            label,
            hidden: moveHidden.has(cleanId),
            sourceOrder
          });
        };

        if (context.guise) {
          addMoveControl({
            id: `signature:${context.guise.id}`,
            name: context.guise.system?.signaturePerk || context.guise.name,
            label: "Signature Perk",
            sourceOrder: 0
          });
        }

        context.enrichedMoves.forEach((move, index) => {
          addMoveControl({
            id: move.handId,
            name: move.name,
            label: "Basic Move",
            sourceOrder: 1 + index / 100
          });
        });

        context.enrichedSecondarySignatureMoves.forEach((move, index) => {
          addMoveControl({
            id: move.handId,
            name: move.name,
            label: "Signature Perk",
            sourceOrder: 10 + index
          });
        });

        context.enrichedSecondaryBasicMoves.forEach((move, index) => {
          addMoveControl({
            id: move.handId,
            name: move.name,
            label: "Basic Move",
            sourceOrder: 30 + index / 100
          });
        });

        allMoves
          .filter(move => move.system?.isSignature === true)
          .forEach((move, index) => {
            addMoveControl({
              id: move.id,
              name: move.name,
              label: "Signature Perk",
              sourceOrder: 50 + index
            });
          });

        context.learnedMoves.forEach((move, index) => {
          addMoveControl({
            id: move.id,
            name: move.name,
            label: "Learned Move",
            sourceOrder: 100 + index
          });
        });

        context.moveHandControls = controls.sort((a, b) => {
          const aOrder = orderMap.has(a.id) ? orderMap.get(a.id) : Number.MAX_SAFE_INTEGER;
          const bOrder = orderMap.has(b.id) ? orderMap.get(b.id) : Number.MAX_SAFE_INTEGER;
          return aOrder - bOrder || a.sourceOrder - b.sourceOrder || a.name.localeCompare(b.name);
        });
      }

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

      const gambitCardDesign = this.actor.system?.gambits?.cardDesign || "midnight";
      context.gambitHandUiEnabled = this.actor.system?.gambits?.handUiEnabled !== false;
      context.gambitCardDesigns = [
        { id: "midnight", name: "Midnight", isSelected: gambitCardDesign === "midnight" },
        { id: "pearl", name: "Pearl", isSelected: gambitCardDesign === "pearl" },
        { id: "cobalt", name: "Cobalt", isSelected: gambitCardDesign === "cobalt" },
        { id: "noir", name: "Noir", isSelected: gambitCardDesign === "noir" }
      ];

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
      const crops = this.actor.getFlag("midnight-gambit", "crops") || {};
      const crop = crops.profile?.css || {};
      $img.attr("src", mgGetActorPlacementImage(this.actor, "profile"));
      const x = Number.isFinite(crop.x) ? crop.x : 50;
      const y = Number.isFinite(crop.y) ? crop.y : 50;
      const s = Number.isFinite(crop.scale) ? crop.scale : 1;

      $wrap[0].style.setProperty("--mg-crop-x", String(x));
      $wrap[0].style.setProperty("--mg-crop-y", String(y));
      $wrap[0].style.setProperty("--mg-crop-scale", String(s));
    }

    _mgGetImageCropPlacements(html) {
      const sheetSrc = mgGetActorSheetImage(this.actor);
      const actorSrc = this.actor?.img || sheetSrc;

      return [
        {
          key: "profile",
          label: "Character Sheet",
          icon: "fa-solid fa-user",
          title: "Frame Character Sheet",
          hint: "Drag to pan - Mouse wheel to zoom - Esc to cancel",
          description: "This image is placed at the top of your Character sheet next to your name, and strain.",
          src: sheetSrc,
          className: "",
          defaultsFrom: []
        },
        {
          key: "chat",
          label: "Chat Avatar",
          icon: "fa-solid fa-comment",
          title: "Frame Chat Avatar",
          hint: "Drag to pan - Mouse wheel to zoom - Esc to cancel",
          description: "This image is placed in chat every time you roll.",
          src: actorSrc,
          className: "chat-crop",
          defaultsFrom: []
        },
        {
          key: "sidebar",
          label: "Player Sidebar",
          icon: "fa-solid fa-crop-simple",
          title: "Frame Sidebar Portrait",
          hint: "Drag to pan - Mouse wheel to zoom - Esc to cancel",
          description: "This is the image at the top of your player sidebar (First tab.)",
          src: actorSrc,
          className: "sidebar-crop",
          defaultsFrom: ["profile"],
          saveSize: true
        },
        {
          key: "actorSidebar",
          label: "Actor List",
          icon: "fa-solid fa-user",
          title: "Frame Actor Tab Portrait",
          hint: "Drag to pan - Mouse wheel to zoom - Esc to cancel",
          description: "This image is placed in the Actor List Directory.",
          src: actorSrc,
          className: "actor-sidebar-crop",
          defaultsFrom: ["sidebar", "profile"],
          saveSize: true,
          fitAxis: "width"
        },
        {
          key: "crewSidebar",
          label: "Sidebar Crew Portrait",
          icon: "fa-solid fa-users",
          title: "Frame Crew Tab Portrait",
          hint: "Drag to pan - Mouse wheel to zoom - Esc to cancel",
          description: "This image is placed in your Crew Tab of the left sidebar, inside the Party Accordion.",
          src: actorSrc,
          className: "crew-sidebar-crop",
          defaultsFrom: ["profile"],
          saveSize: true,
          fitAxis: "height"
        },
        {
          key: "crewInitiative",
          label: "Sidebar Crew Initiative",
          icon: "fa-solid fa-list-ol",
          title: "Frame Crew Initiative Portrait",
          hint: "Drag to pan - Mouse wheel to zoom - Esc to cancel",
          description: "This image is placed in your Crew Tab of the left sidebar, inside the Initiative accordion.",
          src: actorSrc,
          className: "crew-initiative-crop",
          defaultsFrom: ["crewSidebar", "profile"],
          saveSize: true,
          fitAxis: "height"
        },
        {
          key: "crewSheet",
          label: "Crew Sheet",
          icon: "fa-solid fa-people-group",
          title: "Frame Crew Sheet Portrait",
          hint: "Drag to pan - Mouse wheel to zoom - Esc to cancel",
          description: "This image is placed in the Party List tab of your group's Crew Sheet.",
          src: actorSrc,
          className: "crew-sheet-crop",
          saveSize: true,
          fitAxis: "height"
        },
        {
          key: "crewSheetInitiative",
          label: "Crew Sheet Initiative",
          icon: "fa-solid fa-list-check",
          title: "Frame Crew Sheet Initiative Portrait",
          hint: "Drag to pan - Mouse wheel to zoom - Esc to cancel",
          description: "This image is placed in the Initiative tab of your group's Crew Sheet.",
          src: actorSrc,
          className: "crew-sheet-initiative-crop",
          defaultsFrom: ["actorSidebar", "sidebar", "profile"],
          saveSize: true,
          fitAxis: "width"
        },
        {
          key: "mainInitiative",
          label: "Main Initiative",
          icon: "fa-kit fa-mortal-strain",
          title: "Frame Main Initiative",
          hint: "Drag to pan - Mouse wheel to zoom - Esc to cancel",
          description: "These images are placed in the square on screen initiative. The Featured is when your character is first in the order, and Slice is when you are in any other position.",
          src: actorSrc,
          className: "main-initiative-crop",
          defaultsFrom: [],
          saveSize: false,
          cropModel: "mainInitiativeBgPan",
          cropTargets: [
            {
              key: "mainInitiativeFeatured",
              label: "Featured",
              className: "mg-crop-target-featured",
              cropModel: "mainInitiativeFeaturedBgPan"
            },
            {
              key: "mainInitiative",
              label: "Slice",
              className: "mg-crop-target-slice",
              cropModel: "mainInitiativeBgPan"
            },
          ]
        },
        {
          key: "sidebarInitiative",
          label: "Side Initiative",
          icon: "fa-kit fa-soul-strain",
          title: "Frame Sidebar Initiative",
          hint: "Drag to pan - Mouse wheel to zoom - Esc to cancel",
          description: "These images are placed in the Sidebar initiative anchored to the chat box. The Featured is when your character is first in the order, and Slice is when you are in any other position.",
          src: actorSrc,
          className: "sidebar-initiative-crop",
          defaultsFrom: [],
          saveSize: false,
          cropModel: "skewSlicePan",
          cropTargets: [
            {
              key: "sidebarInitiativeMain",
              label: "Featured",
              className: "mg-crop-target-main",
              cropModel: "skewSliceMainPan"
            },
            {
              key: "sidebarInitiative",
              label: "Slice",
              className: "mg-crop-target-stack",
              cropModel: "skewSlicePan"
            }
          ]
        }
      ];
    }

    _mgOpenImageOptions(html, startKey = "profile") {
      const placements = this._mgGetImageCropPlacements(html).filter(p => p.src);
      if (!placements.length) return;

      const savedCrops = this.actor.getFlag("midnight-gambit", "crops") || {};
      const byKey = Object.fromEntries(placements.map(p => [p.key, p]));
      const imageOverrides = Object.fromEntries(
        placements.map(p => [p.key, typeof savedCrops[p.key]?.src === "string" ? savedCrops[p.key].src : ""])
      );
      const cropTargetMarkup = placements
        .flatMap(p => p.cropTargets?.map(t => ({ placement: p, target: t })) || [])
        .map(({ target }) => `
          <div class="mg-crop-target ${target.className || ""}" data-mg-crop-target="${target.key}">
            <div class="mg-crop-target-label">${target.label || ""}</div>
            <div class="mg-crop-stage">
              <div class="mg-crop-img-plane">
                <img alt="${target.label || "placement"} preview" data-mg-crop-img="${target.key}">
              </div>
            </div>
          </div>
        `)
        .join("");
      let active = byKey[startKey] ? startKey : placements[0].key;
      let dragging = false;
      let dragTargetKey = null;
      let dragStage = null;
      let last = { cx: 0, cy: 0 };
      let values = {};
      const dirtyTargets = new Set();

      const getTargets = placement => placement.cropTargets?.length ? placement.cropTargets : [placement];

      const getInitialValues = (placement, target = placement) => {
        const crops = this.actor.getFlag("midnight-gambit", "crops") || {};
        let saved = crops[target.key]?.css;
        for (const fallback of target.defaultsFrom || placement.defaultsFrom || []) {
          if (saved) break;
          saved = crops[fallback]?.css;
        }
        saved ||= {};
        const cropModel = target.cropModel || placement.cropModel;
        if (cropModel && saved.model !== cropModel) saved = {};
        const savedWidth = placement.fitAxis === "height" ? null : saved.width;
        const savedHeight = placement.fitAxis === "width" ? null : saved.height;

        return {
          x: Number.isFinite(saved.x) ? saved.x : 50,
          y: Number.isFinite(saved.y) ? saved.y : 50,
          scale: Number.isFinite(saved.scale) ? saved.scale : 1,
          width: Number.isFinite(savedWidth) ? savedWidth : null,
          height: Number.isFinite(savedHeight) ? savedHeight : null
        };
      };

      const $ui = $(`
        <div class="mg-crop-editor mg-image-options" role="dialog" aria-modal="true">
          <div class="mg-crop-panel">
            <div class="mg-row">
              <div>
                <strong class="mg-crop-title"></strong>
                <div class="hint mg-crop-hint"></div>
              </div>
              <button type="button" class="ghost mg-cancel" aria-label="Close image options">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
            <nav class="mg-crop-tabs" aria-label="Image placement options">
              ${placements.map(p => `
                <button type="button" data-mg-crop-tab="${p.key}">
                  <i class="${p.icon}"></i>
                  <span>${p.label}</span>
                </button>
              `).join("")}
            </nav>
            <div class="mg-crop-description-row">
              <p class="mg-crop-description" data-mg-crop-description></p>
              <div class="mg-crop-image-tools" data-mg-crop-image-tools hidden>
                <button type="button" class="ghost mg-crop-select-image">
                  <i class="fa-solid fa-image"></i>
                  Select Image
                </button>
                <button type="button" class="ghost mg-crop-use-default">
                  <i class="fa-solid fa-rotate-left"></i>
                  Use Default
                </button>
              </div>
            </div>
            <div class="mg-crop-stage mg-crop-stage-single">
              <div class="mg-crop-img-plane">
                <img alt="preview" data-mg-crop-img="single">
              </div>
            </div>
            <div class="mg-crop-targets" aria-label="Image placement previews">
              ${cropTargetMarkup}
            </div>
            <div class="mg-actions">
              <button type="button" class="ghost mg-reset">Reset</button>
              <button type="button" class="primary mg-save">Save</button>
            </div>
          </div>
        </div>
      `);

      const stage = $ui.find(".mg-crop-stage")[0];
      const imgEl = $ui.find(".mg-crop-stage img")[0];
      const canBrowseFiles = () => game.user?.can?.("FILES_BROWSE") ?? game.user?.isTrusted ?? false;
      const getPlacementSrc = placement => imageOverrides[placement.key] || placement.src;
      const promoteAboveCropModal = app => {
        for (const delay of [0, 50, 150, 300]) {
          setTimeout(() => {
            const $picker = app?.element;
            $picker?.css?.({
              "z-index": 10070,
              "max-height": "80vh"
            });
            $picker?.find?.(".window-content")?.css?.({
              "max-height": "calc(80vh - 2rem)",
              "overflow": "auto"
            });
          }, delay);
        }
      };

      const getImgForTarget = key => {
        if (key === active && !byKey[active]?.cropTargets?.length) return imgEl;
        return $ui.find(`[data-mg-crop-img="${key}"]`)[0];
      };

      const apply = (key = active) => {
        const current = values[key];
        const img = getImgForTarget(key);
        if (!current || !img) return;
        img.style.setProperty("--x", String(current.x));
        img.style.setProperty("--y", String(current.y));
        img.style.setProperty("--s", String(current.scale));
        const plane = img.closest?.(".mg-crop-img-plane");
        if (plane) {
          plane.style.setProperty("--x", String(current.x));
          plane.style.setProperty("--y", String(current.y));
          plane.style.setProperty("--s", String(current.scale));
        }
      };

      const applyPlacementSize = (img, placement, current) => {
        if (!img) return;
        if (placement.fitAxis === "height") {
          img.style.width = "auto";
          img.style.height = `${Number.isFinite(current.height) ? current.height : 100}%`;
        } else if (placement.fitAxis === "width") {
          img.style.width = `${Number.isFinite(current.width) ? current.width : 100}%`;
          img.style.height = "auto";
        } else {
          img.style.width = Number.isFinite(current.width) ? `${current.width}%` : "";
          img.style.height = Number.isFinite(current.height) ? `${current.height}%` : "";
        }
      };

      const renderPlacement = key => {
        const placement = byKey[key];
        if (!placement) return;
        active = key;
        for (const target of getTargets(placement)) {
          values[target.key] ||= getInitialValues(placement, target);
        }

        $ui.removeClass(placements.map(p => p.className).filter(Boolean).join(" "));
        if (placement.className) $ui.addClass(placement.className);
        $ui.find(".mg-crop-title").text(placement.title);
        $ui.find(".mg-crop-hint").text(placement.hint);
        $ui.find("[data-mg-crop-description]").text(placement.description || "");
        const imageTools = $ui.find("[data-mg-crop-image-tools]");
        imageTools.prop("hidden", false);
        const canReset = !!imageOverrides[placement.key] || getTargets(placement).some(t => !!savedCrops[t.key]?.css);
        imageTools.find(".mg-crop-use-default").prop("disabled", !canReset);
        $ui.find("[data-mg-crop-tab]").toggleClass("is-active", false).attr("aria-selected", "false");
        $ui.find(`[data-mg-crop-tab="${key}"]`).toggleClass("is-active", true).attr("aria-selected", "true");

        $ui.toggleClass("has-multiple-crop-targets", !!placement.cropTargets?.length);
        const targetKeys = new Set(getTargets(placement).map(t => t.key));
        $ui.find("[data-mg-crop-target]").each((_, el) => {
          el.hidden = !targetKeys.has(el.dataset.mgCropTarget);
        });
        for (const target of getTargets(placement)) {
          const img = getImgForTarget(target.key);
          const current = values[target.key];
          if (img) {
            const previewSrc = getPlacementSrc(placement);
            img.src = previewSrc;
            const plane = img.closest?.(".mg-crop-img-plane");
            if (plane && placement.key === "mainInitiative") {
              plane.style.backgroundImage = `url("${previewSrc}")`;
            } else if (plane) {
              plane.style.removeProperty("background-image");
            }
          }
          applyPlacementSize(img, placement, current);
          apply(target.key);
        }
      };

      $ui.on("pointerdown", ".mg-crop-stage", ev => {
        const placement = byKey[active];
        const targetEl = ev.currentTarget.closest("[data-mg-crop-target]");
        dragTargetKey = targetEl?.dataset?.mgCropTarget || active;
        if (!getTargets(placement).some(t => t.key === dragTargetKey)) dragTargetKey = active;
        dragStage = ev.currentTarget;
        dragging = true;
        const oe = ev.originalEvent || ev;
        last = { cx: oe.clientX, cy: oe.clientY };
        ev.currentTarget.setPointerCapture?.(oe.pointerId);
      });

      $ui.on("pointermove", ".mg-crop-stage", ev => {
        if (!dragging) return;
        const current = values[dragTargetKey];
        if (!current) return;
        const oe = ev.originalEvent || ev;
        const dx = oe.clientX - last.cx;
        const dy = oe.clientY - last.cy;
        last = { cx: oe.clientX, cy: oe.clientY };

        if (active === "mainInitiative") {
          const w = Math.max(dragStage?.clientWidth || ev.currentTarget.clientWidth, 1);
          const h = Math.max(dragStage?.clientHeight || ev.currentTarget.clientHeight, 1);
          const pan = 0.45;
          current.x -= ((dx / w) * 100) * pan;
          current.y -= ((dy / h) * 100) * pan;
          dirtyTargets.add(dragTargetKey);
          apply(dragTargetKey);
          return;
        }

        const pan = active === "chat" || active === "crewSidebar" || active === "sidebarInitiative" ? 0.45 : 1;
        current.x -= ((dx / Math.max(dragStage?.clientWidth || ev.currentTarget.clientWidth, 1)) * 100) * pan;
        current.y -= ((dy / Math.max(dragStage?.clientHeight || ev.currentTarget.clientHeight, 1)) * 100) * pan;
        dirtyTargets.add(dragTargetKey);
        apply(dragTargetKey);
      });

      $ui.on("pointerup pointercancel", ".mg-crop-stage", () => {
        dragging = false;
        dragTargetKey = null;
        dragStage = null;
      });
      $ui.on("wheel", ".mg-crop-stage", ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const oe = ev.originalEvent || ev;
        oe.preventDefault?.();
        const targetEl = ev.currentTarget.closest("[data-mg-crop-target]");
        const targetKey = targetEl?.dataset?.mgCropTarget || active;
        const current = values[targetKey];
        if (!current) return;
        const step = ev.shiftKey ? 0.15 : 0.05;
        current.scale = Math.max(0.05, current.scale - (Math.sign(oe.deltaY || 0) * step));
        dirtyTargets.add(targetKey);
        apply(targetKey);
      });

      $ui.on("click", "[data-mg-crop-tab]", ev => {
        ev.preventDefault();
        renderPlacement(ev.currentTarget.dataset.mgCropTab);
      });

      $ui.on("click", ".mg-reset", ev => {
        ev.preventDefault();
        const placement = byKey[active];
        for (const target of getTargets(placement)) {
          values[target.key] = {
            x: 50,
            y: 50,
            scale: 1,
            width: placement?.fitAxis === "width" ? 100 : null,
            height: placement?.fitAxis === "height" ? 100 : null
          };
          const img = getImgForTarget(target.key);
          applyPlacementSize(img, placement, values[target.key]);
          dirtyTargets.add(target.key);
          apply(target.key);
        }
      });

      $ui.on("click", ".mg-crop-select-image", ev => {
        ev.preventDefault();
        const placement = byKey[active];
        if (!placement) return;

        const applyImage = (path) => {
          const next = String(path ?? "").trim();
          if (!next) return;
          imageOverrides[placement.key] = next;
          renderPlacement(placement.key);
        };

        const current = imageOverrides[placement.key] || placement.src;
        if (canBrowseFiles()) {
          const fp = new FilePicker({
            type: "image",
            current,
            callback: applyImage
          });
          fp.render(true);
          promoteAboveCropModal(fp);
          return;
        }

        new Dialog({
          title: `Set ${placement.label} Image`,
          content: `
            <p>You don't have file browsing permissions, but you can still set an image by URL/path.</p>
            <div class="form-group">
              <label>Image URL or Path</label>
              <input type="text" name="mgImgPath" value="${Handlebars.escapeExpression(current)}" style="width:100%;" />
            </div>
          `,
          buttons: {
            save: {
              icon: '<i class="fa-solid fa-check"></i>',
              label: "Use Image",
              callback: (dialogHtml) => applyImage(dialogHtml.find('input[name="mgImgPath"]').val())
            },
            cancel: {
              icon: '<i class="fa-solid fa-xmark"></i>',
              label: "Cancel"
            }
          },
          default: "save"
        }).render(true);
      });

      $ui.on("click", ".mg-crop-use-default", async ev => {
        ev.preventDefault();
        const placement = byKey[active];
        if (!placement) return;
        imageOverrides[placement.key] = "";
        for (const target of getTargets(placement)) {
          values[target.key] = {
            x: 50,
            y: 50,
            scale: 1,
            width: placement?.fitAxis === "width" ? 100 : null,
            height: placement?.fitAxis === "height" ? 100 : null
          };
          dirtyTargets.add(target.key);
        }
        try {
          const ns = "midnight-gambit";
          const crops = (await this.actor.getFlag(ns, "crops")) || {};
          const deleteUpdates = {
            [`flags.${ns}.crops.${placement.key}.-=src`]: null
          };
          crops[placement.key] = crops[placement.key] || {};
          delete crops[placement.key].src;
          for (const target of getTargets(placement)) {
            deleteUpdates[`flags.${ns}.crops.${target.key}.-=css`] = null;
            if (!crops[target.key]) continue;
            delete crops[target.key].css;
            if (!Object.keys(crops[target.key]).length) delete crops[target.key];
            if (savedCrops[target.key]) delete savedCrops[target.key].css;
          }
          if (crops[placement.key] && !Object.keys(crops[placement.key]).length) delete crops[placement.key];
          if (savedCrops[placement.key]) delete savedCrops[placement.key].src;
          await this.actor.setFlag(ns, "crops", crops);
          await this.actor.update(deleteUpdates);
          this._mgRefreshImagePlacement(placement.key, html);
        } catch (err) {
          console.error("MG | Failed to reset placement image:", err);
          ui.notifications?.error("Failed to reset placement image. See console.");
        }
        renderPlacement(placement.key);
      });

      $ui.on("click", ".mg-cancel", () => $ui.remove());
      $ui.on("click", ".mg-save", async () => {
        try {
          const placement = byKey[active];
          const ns = "midnight-gambit";
          const crops = (await this.actor.getFlag(ns, "crops")) || {};
          for (const target of getTargets(placement)) {
            if (placement.cropTargets?.length && !dirtyTargets.has(target.key)) continue;
            const current = values[target.key];
            const img = getImgForTarget(target.key);
            const targetStage = img?.closest?.(".mg-crop-stage") || stage;
            crops[target.key] = crops[target.key] || {};
            const css = { x: current.x, y: current.y, scale: current.scale };
            const cropModel = target.cropModel || placement.cropModel;
            if (cropModel) css.model = cropModel;
            if (placement.saveSize) {
              if (placement.fitAxis === "height") {
                css.height = (img.offsetHeight / Math.max(targetStage.clientHeight, 1)) * 100;
              } else if (placement.fitAxis === "width") {
                css.width = (img.offsetWidth / Math.max(targetStage.clientWidth, 1)) * 100;
              } else {
                css.width = (img.offsetWidth / Math.max(targetStage.clientWidth, 1)) * 100;
                css.height = (img.offsetHeight / Math.max(targetStage.clientHeight, 1)) * 100;
              }
            }
            crops[target.key].css = css;
          }
          {
            crops[placement.key] = crops[placement.key] || {};
            const overrideSrc = String(imageOverrides[placement.key] || "").trim();
            if (overrideSrc) crops[placement.key].src = overrideSrc;
            else delete crops[placement.key].src;
            if (!Object.keys(crops[placement.key]).length) delete crops[placement.key];
            savedCrops[placement.key] = savedCrops[placement.key] || {};
            if (overrideSrc) savedCrops[placement.key].src = overrideSrc;
            else delete savedCrops[placement.key].src;
          }
          await this.actor.setFlag(ns, "crops", crops);
          if (!String(imageOverrides[placement.key] || "").trim()) {
            await this.actor.update({ [`flags.${ns}.crops.${placement.key}.-=src`]: null });
          }

          this._mgRefreshImagePlacement(active, html);
	          ui.notifications?.info(`${placement.title} saved.`);
        } catch (err) {
          console.error("MG | Save image crop failed:", err);
          ui.notifications?.error("Failed to save image framing. See console.");
        }
      });

      const onKey = ev => {
        if (ev.key === "Escape") {
          $ui.remove();
          window.removeEventListener("keydown", onKey);
        }
      };
      window.addEventListener("keydown", onKey);
      $ui.on("remove", () => window.removeEventListener("keydown", onKey));

	      document.body.appendChild($ui[0]);
	      renderPlacement(active);
	    }

    _mgRefreshImagePlacement(key, html) {
      if (key === "profile") this._mgInitProfileCrop(html);
      if (key === "chat") ui.chat?.render?.(true);

      if (["sidebar", "actorSidebar", "crewSidebar", "crewInitiative", "crewSheet", "crewSheetInitiative"].includes(key)) {
        this._mgRefreshCrewSheetsForImageCrop();
        globalThis.mgRefreshLeftSidebarContent?.();
        globalThis.MGRefreshLeftSidebarContent?.();
      }

      if (key === "mainInitiative") {
        const refreshed = new Set();
        for (const bar of [game.mgInitiative, globalThis.mgInitiativeBar]) {
          if (!bar || refreshed.has(bar)) continue;
          refreshed.add(bar);
          bar.refreshActorImages?.(this.actor.id);
        }
      }

      if (key === "sidebarInitiative") game.mgInitiativeSidebar?.refreshActorImages?.(this.actor.id);
    }

    _mgRefreshCrewSheetsForImageCrop() {
      const actorUuid = this.actor?.uuid;
      if (!actorUuid) return;

      for (const app of Object.values(ui.windows ?? {})) {
        const crew = app?.actor;
        if (crew?.type !== "crew") continue;

        const members = Array.isArray(crew.system?.party?.members) ? crew.system.party.members : [];
        if (!members.includes(actorUuid)) continue;

        app.render?.(false);
      }
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

_mgOpenSidebarCropper() {
  const src = this.actor?.img;
  if (!src) return;

  const saved = this.actor.getFlag("midnight-gambit", "crops")?.sidebar?.css
    || this.actor.getFlag("midnight-gambit", "crops")?.profile?.css
    || {};
  let x = Number.isFinite(saved.x) ? saved.x : 50;
  let y = Number.isFinite(saved.y) ? saved.y : 50;
  let s = Number.isFinite(saved.scale) ? saved.scale : 1;
  const widthStyle = Number.isFinite(saved.width) ? `width:${saved.width}%;` : "";
  const heightStyle = Number.isFinite(saved.height) ? `height:${saved.height}%;` : "";

  const $ui = $(`
    <div class="mg-crop-editor sidebar-crop" role="dialog" aria-modal="true">
      <div class="mg-crop-panel">
        <div class="mg-row">
          <div><strong>Frame Sidebar Portrait</strong></div>
          <div class="hint">Drag to pan - Mouse wheel to zoom - Esc to cancel</div>
        </div>

        <div class="mg-crop-stage">
          <img src="${src}" alt="preview" style="--x:${x}; --y:${y}; --s:${s}; ${widthStyle}${heightStyle}">
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

    x -= (dx / Math.max(stage.clientWidth, 1)) * 100;
    y -= (dy / Math.max(stage.clientHeight, 1)) * 100;
    apply();
  });

  stage.addEventListener("pointerup", () => { dragging = false; });
  stage.addEventListener("pointercancel", () => { dragging = false; });

  stage.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const step = ev.shiftKey ? 0.15 : 0.05;
    const delta = Math.sign(ev.deltaY) * step;
    s = Math.max(0.05, s - delta);
    apply();
  }, { passive: false });

  $ui.on("click", ".mg-cancel", () => $ui.remove());

  $ui.on("click", ".mg-save", async () => {
    try {
      const ns = "midnight-gambit";
      const crops = (await this.actor.getFlag(ns, "crops")) || {};
      const width = (imgEl.offsetWidth / Math.max(stage.clientWidth, 1)) * 100;
      const height = (imgEl.offsetHeight / Math.max(stage.clientHeight, 1)) * 100;
      crops.sidebar = crops.sidebar || {};
      crops.sidebar.css = { x, y, scale: s, width, height };
      await this.actor.setFlag(ns, "crops", crops);
      $ui.remove();
    } catch (err) {
      console.error("MG | Save sidebar crop failed:", err);
      ui.notifications?.error("Failed to save sidebar framing. See console.");
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
    html.find(".mg-open-image-options").off("click.mgImageOptions").on("click.mgImageOptions", (ev) => {
      ev.preventDefault();
      this._mgOpenImageOptions(html);
    });

    html.find(".mg-crop-profile").off("click.mgCrop").on("click.mgCrop", (ev) => {
      ev.preventDefault();
      this._mgOpenImageOptions(html, "profile");
    });

    html.find(".mg-crop-chat").off("click.mgCropChat").on("click.mgCropChat", (ev) => {
      ev.preventDefault();
      this._mgOpenImageOptions(html, "chat");
    });

    html.find(".mg-crop-sidebar").off("click.mgCropSidebar").on("click.mgCropSidebar", (ev) => {
      ev.preventDefault();
      this._mgOpenImageOptions(html, "sidebar");
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

    this._mgBindSheetWideDrop(html);

    html.find(".mg-create-gambit-deck").off("click.mgDecks").on("click.mgDecks", async (ev) => {
      ev.preventDefault();

      const sys = this.actor.system ?? {};
      const decks = Array.isArray(sys.gambitDecks?.decks)
        ? foundry.utils.deepClone(sys.gambitDecks.decks)
        : [];
      const slots = Number(sys.gambitDecks?.slots ?? 1) || 1;

      if (decks.length >= slots) {
        ui.notifications?.warn("No empty deck slots available.");
        return;
      }

      const nextNumber = decks.length + 1;
      const id = foundry.utils.randomID?.(16) ?? `deck-${Date.now()}`;
      decks.push({
        id,
        name: `Deck ${nextNumber}`,
        gambits: []
      });

      await this.actor.update({ "system.gambitDecks.decks": decks });
    });

    html.find(".mg-edit-gambit-deck").off("click.mgDecks").on("click.mgDecks", (ev) => {
      ev.preventDefault();
      const deckId = String(ev.currentTarget.dataset.deckId ?? "");
      if (!deckId) {
        ui.notifications?.warn("Deck not found.");
        return;
      }

      new GambitDeckBuilderApplication(this.actor, deckId).render(true);
    });

    html.find(".mg-open-moves-library").off("click.mgMovesLibrary").on("click.mgMovesLibrary", (ev) => {
      ev.preventDefault();
      new MovesLibraryApplication(this.actor).render(true);
    });

    html.find(".mg-equip-gambit-deck").off("click.mgDecks").on("click.mgDecks", async (ev) => {
      ev.preventDefault();

      const deckId = String(ev.currentTarget.dataset.deckId ?? "");
      const decks = Array.isArray(this.actor.system?.gambitDecks?.decks)
        ? this.actor.system.gambitDecks.decks
        : [];
      const deck = decks.find(d => String(d?.id ?? "") === deckId);

      if (!deck) {
        ui.notifications?.warn("Deck not found.");
        return;
      }

      const handIds = mgGetDeckItemIds(this.actor, deck);

      await this.actor.update({
        "system.gambitDecks.equipped": deckId,
        "system.gambits.deck": [],
        "system.gambits.drawn": handIds,
        "system.gambits.discard": [],
        "system.gambits.handHidden": [],
        "system.gambits.locked": true
      });

      ui.notifications?.info(`${deck.name ?? "Deck"} equipped.`);
    });

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

    const refreshStrainEffectBadges = () => {
      const root = html[0];
      if (!root) return;

      root.querySelectorAll(".attribute-column[data-attr]").forEach((column) => {
        column.querySelector(":scope > .mg-strain-warning-badge")?.remove();

        const attrKey = column.dataset.attr;
        const effect = mgGetStrainEffectBadge(
          mgGetStrainRollEffects(this.actor, attrKey),
          { includeGlobalLock: false }
        );
        if (!effect) return;

        const badge = document.createElement("span");
        badge.className = `mg-strain-warning-badge ${effect.tree}`;
        badge.dataset.tooltip = effect.title;

        const icon = document.createElement("i");
        icon.className = "fa-solid fa-exclamation";
        badge.appendChild(icon);

        column.prepend(badge);
      });
    };

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

      refreshStrainEffectBadges();
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
    html.find(".draw-gambit").on("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const { deck = [], drawn = [], locked = false } = this.actor.system.gambits;

      if (locked || deck.length === 0) {
        ui.notifications.warn("Cannot draw more cards.");
        return;
      }

      const shuffled = shuffleArray(deck);

      await this.actor.update({
        "system.gambits.deck": [],
        "system.gambits.drawn": Array.from(new Set([...drawn, ...shuffled])),
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

    const mgEscapeChatHtml = (s) => String(s ?? "").replace(/[&<>"'`=\/]/g, c =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
        "`": "&#96;",
        "=": "&#61;",
        "/": "&#47;"
      }[c])
    );

    const mgMoveTagIdsFromCard = (sourceEl, item) => {
      const itemTags = Array.isArray(item?.system?.tags) ? item.system.tags : [];
      const card = sourceEl.closest(".move-block, .signature-perk");
      const domTags = Array.from(card?.querySelectorAll?.(".item-tag[data-tag-id]") ?? [])
        .map(el => el.dataset.tagId)
        .filter(Boolean);
      return Array.from(new Set([...itemTags, ...domTags].map(String)));
    };

    const mgRenderMoveChatTags = (tagIds, item) => {
      if (!Array.isArray(tagIds) || !tagIds.length) return "";

      const defs = [
        ...(CONFIG.MidnightGambit?.ITEM_TAGS ?? []),
        ...(CONFIG.MidnightGambit?.WEAPON_TAGS ?? []),
        ...(CONFIG.MidnightGambit?.ARMOR_TAGS ?? []),
        ...(CONFIG.MidnightGambit?.MISC_TAGS ?? [])
      ];
      const customTags = item?.system?.customTags ?? {};

      const tagHtml = tagIds
        .map(tagId => {
          const def = defs.find(t => String(t.id) === String(tagId));
          const label = def?.label || String(tagId);
          const desc = def?.description || customTags[tagId] || "";
          return `<span class="item-tag tag" data-tag-id="${mgEscapeChatHtml(tagId)}" title="${mgEscapeChatHtml(desc)}">${mgEscapeChatHtml(label)}</span>`;
        })
        .join(" ");

      return tagHtml ? `<strong>Tags:</strong><div class="chat-tags">${tagHtml}</div>` : "";
    };

    const mgEnrichMoveDescriptionForChat = async (text) => {
      const raw = String(text ?? "").trim();
      if (!raw) return "";
      return TextEditor.enrichHTML(raw, {
        async: true,
        secrets: this.actor.isOwner,
        documents: true,
        links: true,
        rolls: true
      });
    };

    //Making it so if you click moves in the Character sheet they post to chat!
    html.find(".post-move").off("click.mgPostMove").on("click.mgPostMove", async event => {
      event.preventDefault();
      event.stopPropagation();

      const card = event.currentTarget.closest("[data-item-id]");
      const item = this.actor.items.get(card?.dataset?.itemId);
      const name = item?.name || event.currentTarget.dataset.moveName || "Unknown Move";
      const description = item?.system?.description ?? event.currentTarget.dataset.moveDescription ?? "";
      const descHtml = await mgEnrichMoveDescriptionForChat(description);
      const tagsHtml = mgRenderMoveChatTags(mgMoveTagIdsFromCard(event.currentTarget, item), item);

      const chatContent = `
        <div class="chat-move">
          <h2><i class="fa-solid fa-hand-fist"></i> ${mgEscapeChatHtml(name)}</h2>
          ${descHtml ? `<div class="chat-move-desc">${descHtml}</div>` : ""}
          ${tagsHtml}
        </div>
      `;

      ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: chatContent
      });
    });

    //Doing the same chat posting for Signature Perks
    html.find(".signature-perk h3").off("click.mgPostSignature").on("click.mgPostSignature", async (event) => {
      const source = event.currentTarget.querySelector(".post-signature");
      if (!source) return;

      const card = source.closest("[data-item-id]");
      const item = this.actor.items.get(card?.dataset?.itemId);
      const name = item?.system?.signaturePerk || item?.name || source.dataset.perkName || "Signature";
      const description = item?.system?.signatureDescription ?? item?.system?.description ?? source.dataset.perkDescription ?? "";
      const descHtml = await mgEnrichMoveDescriptionForChat(description);
      const tagsHtml = mgRenderMoveChatTags(mgMoveTagIdsFromCard(source, item), item);

      const chatContent = `
        <div class="chat-move">
          <h2><i class="fa-solid fa-diamond"></i> Signature Perk: ${mgEscapeChatHtml(name)}</h2>
          ${descHtml ? `<div class="chat-move-desc">${descHtml}</div>` : ""}
          ${tagsHtml}
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
        "system.gambits.drawn": updatedDrawn,
        "system.gambits.handHidden": (this.actor.system.gambits.handHidden ?? []).filter(id => id !== itemId)
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
          "system.gambits.drawn": source === "deck" ? to   : from,
          ...(source === "drawn"
            ? { "system.gambits.handHidden": (this.actor.system.gambits.handHidden ?? []).filter(id => id !== itemId) }
            : {})
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

    this._mgBindHandOrderList(html, {
      listSelector: '[data-mg-order-list="gambit-hand"]',
      cardSelector: ".mg-hand-order-card",
      idAttr: "itemId",
      orderPath: "system.gambits.drawn",
      hiddenPath: "system.gambits.handHidden",
      hiddenLabel: "Hand"
    });

    this._mgBindHandOrderList(html, {
      listSelector: '[data-mg-order-list="move-hand"]',
      cardSelector: ".mg-hand-order-card",
      idAttr: "moveHandId",
      orderPath: "system.gambits.moveOrder",
      hiddenPath: "system.gambits.moveHidden",
      hiddenLabel: "Moves Hand",
      filterToCurrentOrder: false
    });

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
            <h2><i class="fa-kit fa-spark"></i> Spark has been used!</h2>
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
        "system.sto.value": 0,
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

        refreshStrainEffectBadges();
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

      // HEAL / RESTORE BUFFER
      // Plus only restores/adds Capacity. It never heals the strain track.
      // Track healing should happen through strain dots, rests, or specific healing effects.
      if (dir > 0) {
        // Capacity should never be "hard capped" for play:
        // shielding, buffs, and correction clicks can push it higher.
        // If we're already at the current derived max, auto-increase tempBonus so max grows too.
        if (cap >= max) {
          const curTemp = Number(actor.system?.strain?.tempBonus?.[type] ?? 0);

          await actor.update({
            [`system.strain.tempBonus.${type}`]: curTemp + 1
          }, { render: false });

          await recalcStrainFromGear({ resetToMax: false });

          const maxAfter = getMax();
          const capAfter = getCap();
          const nextCap = Math.min(maxAfter, capAfter + 1);

          await actor.update({
            [`system.strain.${capKey}`]: nextCap
          }, { render: false });

          patchUI();
          return;
        }

        // Otherwise, restore buffer up to current max.
        const nextCap = Math.min(max, cap + 1);

        await actor.update({
          [`system.strain.${capKey}`]: nextCap
        }, { render: false });

        patchUI();
        return;
      }
    });

    // Capacity ticker: right-click the current number/control area to set exact capacity
    html
      .off("contextmenu.mgCapacityExact")
      .on("contextmenu.mgCapacityExact", ".capacity-controls, .capacity-value, .label-box, .label-box *", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const actor = this.actor;
      if (!actor) return;

      const clicked =
        event.target.closest(".label-box") ||
        event.target.closest(".capacity-controls") ||
        event.target.closest(".capacity-value") ||
        event.currentTarget;

      // First try normal data attributes.
      let type =
        clicked.dataset?.type ||
        clicked.closest("[data-type]")?.dataset?.type;

      // If right-clicking the label badge, infer from visible label text.
      // This catches badges like "MC 3" / "SC 3" even when they are not inside .capacity-controls.
      if (!type && clicked.classList.contains("label-box")) {
        const txt = String(clicked.textContent ?? "").toLowerCase();

        if (txt.includes("mc") || txt.includes("mortal")) {
          type = "mortal";
        }

        if (txt.includes("sc") || txt.includes("soul")) {
          type = "soul";
        }
      }

      // Final fallback: look nearby for a capacity-control/value with data-type.
      if (!type) {
        const parent =
          clicked.closest(".capacity-ticker") ||
          clicked.parentElement ||
          clicked.closest(".strain-card") ||
          clicked.closest(".strain-block");

        type =
          parent?.querySelector?.(".capacity-controls[data-type], .capacity-value[data-type]")?.dataset?.type ||
          null;
      }

      if (!type) {
        console.warn("MG | Could not determine capacity type from right-click target:", clicked);
        return;
      }

      const capKey = `${type} capacity`;
      const currentCap = Number(actor.system?.strain?.[capKey] ?? 0);
      const currentMax = Number(actor.system?.strain?.maxCapacity?.[type] ?? currentCap);

      const label = type === "mortal" ? "Mortal Capacity" : "Soul Capacity";

      const val = await this._mgPrompt({
        title: `Set ${label}`,
        bodyHtml: `
          <div class="form-group">
            <label>${label}</label>
            <input type="number" name="value" value="${currentCap}" min="0" step="1" />
          </div>
          <p class="notes">
            Current max: <strong>${currentMax}</strong>. Entering a higher number will add temporary capacity.
          </p>
        `,
        okText: "Save",
        okIcon: "fa-floppy-disk",
        cancelText: "Cancel",
        cancelIcon: "fa-circle-xmark",
        getValue: (html) => html.find('input[name="value"]').val()
      });

      if (val === null) return;

      const nextCap = Math.max(0, Math.floor(Number(val)));

      if (!Number.isFinite(nextCap)) {
        ui.notifications.warn("Please enter a valid capacity number.");
        return;
      }

      const updates = {
        [`system.strain.${capKey}`]: nextCap,
        [`system.strain.manualOverride.${capKey}`]: true
      };

      // If we set capacity above the current derived max, store the overflow as tempBonus.
      // This keeps the max label honest and prevents later recalcs from shaving the number back down.
      if (nextCap > currentMax) {
        const currentTemp = Number(actor.system?.strain?.tempBonus?.[type] ?? 0);
        const extraNeeded = nextCap - currentMax;

        updates[`system.strain.tempBonus.${type}`] = currentTemp + extraNeeded;
        updates[`system.strain.maxCapacity.${type}`] = nextCap;
      }

      await actor.update(updates, { render: false });

      // Patch the visible ticker immediately
      const valEl = html.find(`.capacity-value[data-type="${type}"]`)[0];
      if (valEl) valEl.textContent = String(nextCap);

      const maxEl = html[0]?.querySelector(`.capacity-max[data-type='${type}']`);
      if (maxEl) maxEl.textContent = String(Math.max(nextCap, currentMax));

      // Soft render so anything else derived catches up without doing weird click flicker
      this.render(false);
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

    html.find(".mg-gambit-design-toggle")
      .off("click.mgGambitDesign")
      .on("click.mgGambitDesign", async (ev) => {
        ev.preventDefault();

        const clicked = ev.currentTarget;
        const design = clicked.dataset.gambitDesign;
        const allowed = ["pearl", "cobalt", "midnight", "noir"];
        if (!allowed.includes(design)) return;

        const wrap = clicked.closest(".gambit-design-toggles");
        const toggles = wrap ? Array.from(wrap.querySelectorAll(".mg-gambit-design-toggle")) : [];

        toggles.forEach(btn => {
          btn.classList.toggle("is-on", btn === clicked);
          btn.classList.toggle("is-off", btn !== clicked);
          btn.setAttribute("aria-pressed", btn === clicked ? "true" : "false");
        });

        await this.actor.update({ "system.gambits.cardDesign": design });
      });

    html.find(".mg-gambit-hand-ui-toggle")
      .off("click.mgGambitHandUi")
      .on("click.mgGambitHandUi", async (ev) => {
        ev.preventDefault();

        const clicked = ev.currentTarget;
        const enabled = clicked.getAttribute("aria-pressed") !== "true";

        clicked.classList.toggle("is-on", enabled);
        clicked.classList.toggle("is-off", !enabled);
        clicked.setAttribute("aria-pressed", enabled ? "true" : "false");
        clicked.title = enabled ? "Hide Gambit hand UI" : "Show Gambit hand UI";

        await this.actor.update({ "system.gambits.handUiEnabled": enabled });
      });

    // Attribute edit: pick the visible value, then store the base minus primary Guise modifier.
    html.find(".attribute-modifier").on("contextmenu", async (event) => {
      event.preventDefault();

      const el = event.currentTarget;
      const key = el.dataset.key;
      const currentAttr = el.getAttribute("data-current");
      const current = this._mgClampStatValue(
        currentAttr !== null && currentAttr !== ""
          ? currentAttr
          : this.actor.system?.attributes?.[key] ?? el.getAttribute("data-base")
      );

      const val = await this._mgOpenStatPicker({
        title: `Edit ${key}`,
        current
      });

      if (val === null) return;

      const next = this._mgClampStatValue(val);
      const guiseMod = mgGetPrimaryGuiseAttributeModifier(this.actor, key);
      const nextBase = this._mgClampStatValue(next - guiseMod);
      const displayedNext = this._mgClampStatValue(nextBase + guiseMod);

      await this.actor.update({ [`system.baseAttributes.${key}`]: nextBase }, { render: false });

      el.setAttribute("data-base", String(nextBase));
      el.setAttribute("data-current", String(displayedNext));
      el.textContent = this._mgFormatSigned(displayedNext);
    });

    html.find(".attribute-modifier").on("click", async (event) => {
      const attrKey = event.currentTarget.dataset.key;

      const baseAttrMod = Number(this.actor.system.attributes?.[attrKey] ?? 0);
      const tempAttrMod = Number(this.actor.system.tempAttributeBonuses?.[attrKey] ?? 0);

      const aura = this._getActiveAuraPenalty(attrKey);
      const auraAttrMod = Number(aura.value ?? 0);
      const difficultyMod = mgGetDifficultyModifier();

      // Aura should NOT change the dice pool anymore
      const finalAttrMod = baseAttrMod + tempAttrMod;

      const strainEffects = mgGetStrainRollEffects(this.actor, attrKey);
      if (strainEffects.out) {
        ui.notifications?.warn(`${attrKey.charAt(0).toUpperCase() + attrKey.slice(1)} is unavailable at ${strainEffects.track} ${strainEffects.tree} track.`);
        return;
      }

      const strainedAttrMod = mgApplyStrainAttributePenalty(finalAttrMod, strainEffects);
      const pool = 2 + Math.abs(strainedAttrMod);
      const rollType = strainedAttrMod >= 0 ? "kh2" : "kl2";
      const formula = `${pool}d6${rollType}`;

      const edge = !!this.actor.system.edgeNext;

      await evaluateRoll({
        formula,
        skillMod: auraAttrMod + difficultyMod,
        modifierParts: [auraAttrMod, difficultyMod],
        modifierBreakdown: [
          {
            key: "aura",
            label: aura.label || "Aura Modifier",
            icon: "fa-eye-evil",
            value: auraAttrMod
          },
          {
            key: "difficulty",
            label: "Difficulty",
            icon: "fa-camera-movie",
            value: difficultyMod
          }
        ],
        label: `Attr Roll: ${attrKey.charAt(0).toUpperCase() + attrKey.slice(1)}`,
        actor: this.actor,
        edge,
        auraLabel: aura.label,
        auraAttrMod,
        auraSourceActorId: aura.sourceActorId,
        auraSourceTokenId: aura.sourceTokenId,
        auraIconClass: "fa-eye-evil",
        strainEffects
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
        const difficultyMod = mgGetDifficultyModifier();

        // Aura is now a flat final modifier, not dice-pool pressure
        const finalAttrMod = baseAttrMod + tempAttrMod;
        const finalSkillMod = baseSkillMod + tempSkillMod + auraAttrMod + difficultyMod;
        const skillLabel = skillLabels[skillKey] ?? skillKey;

        const strainEffects = mgGetStrainRollEffects(this.actor, attrKey);
        if (strainEffects.out) {
          ui.notifications?.warn(`${skillLabel} is unavailable at ${strainEffects.track} ${strainEffects.tree} track.`);
          return;
        }

        const strainedAttrMod = mgApplyStrainAttributePenalty(finalAttrMod, strainEffects);
        const pool = 2 + Math.abs(strainedAttrMod);
        const rollType = strainedAttrMod >= 0 ? "kh2" : "kl2";
        const formula = `${pool}d6${rollType}`;

        const edge = !!this.actor.system.edgeNext;

        const bonusText =
          (tempSkillMod !== 0 || auraAttrMod !== 0)
            ? ` (${baseSkillMod >= 0 ? "+" : ""}${baseSkillMod} base, ${tempSkillMod >= 0 ? "+" : ""}${tempSkillMod} temp${auraAttrMod !== 0 ? `, ${auraAttrMod >= 0 ? "+" : ""}${auraAttrMod} aura` : ""})`
            : "";

        await evaluateRoll({
          formula,
          skillMod: finalSkillMod,
          modifierParts: [baseSkillMod, tempSkillMod, auraAttrMod, difficultyMod],
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
            },
            {
              key: "difficulty",
              label: "Difficulty",
              icon: "fa-camera-movie",
              value: difficultyMod
            }
          ],
          label: `Skill Roll: ${skillLabel}`,
          actor: this.actor,
          edge,
          auraLabel: aura.label,
          auraAttrMod,
          auraSourceActorId: aura.sourceActorId,
          auraSourceTokenId: aura.sourceTokenId,
          strainEffects
        });

        if (edge) {
          await this.actor.update({ "system.edgeNext": false }, { render: false });
          const btn = html.find(".mg-edge-toggle")[0];
          if (btn) btn.classList.remove("is-active");
        }
    });

    // Skill base edit: fixed -3 to +3 picker
    html.find(".skill-value").on("contextmenu", async (event) => {
      event.preventDefault();

      const el = event.currentTarget;
      const key = el.dataset.key;
      const current = this._mgClampStatValue(el.getAttribute("data-base"));

      const val = await this._mgOpenStatPicker({
        title: `Edit Skill: ${key}`,
        current
      });

      if (val === null) return;

      const next = this._mgClampStatValue(val);

      await this.actor.update({ [`system.skills.${key}`]: next }, { render: false });

      el.setAttribute("data-base", String(next));
      el.textContent = String(next);
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

    // Create a new Inventory item directly on this actor
    html.find(".mg-create-item").on("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const result = await Dialog.wait({
        title: "Create Inventory Item",
        content: `
          <form class="mg-create-item-dialog">
            <div class="form-group">
              <label>Item Name</label>
              <input type="text" name="itemName" value="New Item" autofocus />
            </div>

            <div class="form-group">
              <label>Item Type</label>
              <select name="itemType">
                <option value="misc">Misc</option>
                <option value="weapon">Weapon</option>
                <option value="armor">Armor</option>
              </select>
            </div>
          </form>
        `,
        buttons: {
          create: {
            label: this._mgBtn ? this._mgBtn("Create", "fa-plus") : "Create",
            callback: (html) => {
              const name = html.find('[name="itemName"]').val()?.trim();
              const type = html.find('[name="itemType"]').val();

              if (!name) return null;

              return {
                name,
                type
              };
            }
          },
          cancel: {
            label: this._mgBtn ? this._mgBtn("Cancel", "fa-circle-xmark") : "Cancel",
            callback: () => null
          }
        },
        default: "create"
      });

      if (!result) return;

      const baseSystem = {
        description: "",
        tags: [],
        quantity: 1,
        equipped: false
      };

      if (result.type === "weapon") {
        baseSystem.mortalStrainDamage = 0;
        baseSystem.soulStrainDamage = 0;
        baseSystem.strainDamage = 0;
      }

      if (result.type === "armor") {
        baseSystem.mortalCapacity = 0;
        baseSystem.soulCapacity = 0;
        baseSystem.remainingCapacity = {
          mortal: 0,
          soul: 0
        };
      }

      if (result.type === "misc") {
        baseSystem.mortalStrainDamage = 0;
        baseSystem.soulStrainDamage = 0;
        baseSystem.strainDamage = 0;

        baseSystem.mortalCapacity = 0;
        baseSystem.soulCapacity = 0;
        baseSystem.remainingCapacity = {
          mortal: 0,
          soul: 0
        };
      }

      const created = await this.actor.createEmbeddedDocuments("Item", [{
        name: result.name,
        type: result.type,
        system: baseSystem,
        flags: {
          "midnight-gambit": {
            inventoryCreated: true
          }
        }
      }]);

      const item = created?.[0];

      this.render(false);

      if (item?.sheet) {
        item.sheet.render(true);
      }
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

    const getInventoryItems = () => (
      typeof this.actor.items?.filter === "function"
        ? this.actor.items.filter(() => true)
        : Array.from(this.actor.items ?? [])
    );

    const getInventoryBucketCounts = () => {
      const items = getInventoryItems();

      return {
        favorites: items.filter(item => item?.system?.favorite).length,
        weapons: items.filter(item => item?.type === "weapon" && !item?.system?.favorite).length,
        armor: items.filter(item => item?.type === "armor" && !item?.system?.favorite).length,
        misc: items.filter(item => item?.type === "misc" && !item?.system?.favorite).length
      };
    };

    const setInventoryBucketHeaderCollapsed = (title, collapsed) => {
      title?.classList?.toggle("is-collapsed", collapsed);
      const icon = title?.querySelector?.(".inventory-bucket-toggle i");
      if (icon) icon.classList.toggle("rotated", !collapsed);
    };

    const syncEmptyInventoryBuckets = () => {
      const tab = html.find(".tab-inventory")[0];
      if (!tab) return;

      const counts = getInventoryBucketCounts();
      for (const [bucket, count] of Object.entries(counts)) {
        const title = tab.querySelector(`.inventory-bucket-title[data-bucket="${bucket}"]`);
        const body = title?.nextElementSibling;
        if (!body?.classList?.contains("inventory-bucket-body") || count > 0) continue;

        setInventoryBucketHeaderCollapsed(title, true);
        body.hidden = true;
        body.style.maxHeight = "0px";
        body.dataset.animating = "0";
      }
    };

    const refreshInventoryBucketCounts = () => {
      const tab = html.find(".tab-inventory")[0];
      if (!tab) return;

      const counts = getInventoryBucketCounts();

      for (const [bucket, count] of Object.entries(counts)) {
        const title = tab.querySelector(`.inventory-bucket-title[data-bucket="${bucket}"]`);
        const countEl = title?.querySelector(".inventory-bucket-count");
        if (countEl) countEl.textContent = `(${count})`;
      }

      syncEmptyInventoryBuckets();
    };

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
      if (!targetBody) {
        refreshInventoryBucketCounts();
        return;
      }

      targetBody.appendChild(card);
      refreshInventoryBucketCounts();
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
      refreshInventoryBucketCounts();

      // Optional: keep search behavior consistent if you're currently searching
      // (doesn't rerender; just re-applies existing hidden classes if you use them)
      const q = (root.querySelector(".item-search")?.value || "").trim();
      if (q.length) {
        // If your search function relies on classes, it’s already applied.
        // Leaving this blank on purpose to avoid re-triggering your animation pipeline.
      }
    });

    // Open item sheet from an inventory card
    html.find(".item-edit").on("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const itemId =
        event.currentTarget.dataset.itemId ||
        event.currentTarget.closest(".inventory-item")?.dataset?.itemId;

      if (!itemId) return;

      const item = this.actor.items.get(itemId);
      if (!item) {
        ui.notifications?.warn("Item not found.");
        return;
      }

      item.sheet?.render(true);
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
        this.render(false);
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
      const safe = (s) => String(s ?? "").replace(/[&<>"'`=\/]/g, c =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
          "`": "&#96;",
          "=": "&#61;",
          "/": "&#47;"
        }[c])
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
                  <i class="fa-kit fa-mortal-strain"></i>
                  <span class="remaining-number">${mortal}</span>
                </p>` : ""
              }
              ${soul ? `
                <p class="strain-bubble">
                  <i class="fa-kit fa-soul-strain"></i>
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
                <i class="fa-kit fa-mortal-strain"></i>
                <span class="remaining-number">${mc}</span>
              </p>
              <p class="strain-bubble">
                <i class="fa-kit fa-soul-strain"></i>
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
                  <i class="fa-kit fa-mortal-strain"></i>
                  <span class="remaining-number">${mortalSD}</span>
                </p>` : ""
              }
              ${soulSD ? `
                <p class="strain-bubble">
                  <i class="fa-kit fa-soul-strain"></i>
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
                  <i class="fa-kit fa-mortal-strain"></i>
                  <span class="remaining-number">${mc}</span>
                </p>` : ""
              }
              ${sc ? `
                <p class="strain-bubble">
                  <i class="fa-kit fa-soul-strain"></i>
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

          const bucketHasItems = (body) =>
            !!body?.querySelector?.(".inventory-card, .inventory-item");

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
              const empty = !bucketHasItems(body);
              setChevronState(title, collapsed || empty);

              body.hidden = collapsed || empty;
              body.style.maxHeight = (collapsed || empty) ? "0px" : "";
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

              if (!bucketHasItems(body)) {
                const state = readState();
                setChevronState(title, true);
                body.hidden = true;
                body.style.maxHeight = "0px";
                body.dataset.animating = "0";
                state[key] = true;
                await writeState(state);
                return;
              }

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

    // Hide Sync Tags for inventory-created items that have no base/global source.
    html.find(".sync-tags").each((_, button) => {
      const itemId = button.dataset.itemId;
      const ownedItem = this.actor.items.get(itemId);
      if (!ownedItem) return;

      const inventoryCreated = ownedItem.getFlag?.("midnight-gambit", "inventoryCreated");
      const sourceId = ownedItem.flags?.core?.sourceId;

      const hasWorldMatch = game.items.some(i =>
        i.id !== ownedItem.id &&
        i.name === ownedItem.name &&
        i.type === ownedItem.type
      );

      const hasBaseItem = Boolean(sourceId || hasWorldMatch);

      if (inventoryCreated && !hasBaseItem) {
        button.remove();
      }
    });

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
        ui.notifications.info(`${ownedItem.name} is inventory-only, so there is no base item to sync from.`);
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

    // Reset Gambits to the neutral 2.0 state: no equipped deck, no hand, no discard.
    html.find(".reset-gambit-deck").on("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      // Avoid double-fires while dialog is open
      const btn = ev.currentTarget;
      btn.disabled = true;

      try {
        const ok = await Dialog.wait({
          title: "Reset Gambits?",
          content: `
            <p>This unequips your current deck and clears your Hand and Discard.</p>
          `,
          buttons: {
            yes: { label: this._mgBtn("Reset", "fa-arrows-rotate"), callback: () => true },
            no:  { label: this._mgBtn("Cancel", "fa-circle-xmark"), callback: () => false }
          },
          default: "yes"
        });

        if (!ok) return; // user cancelled — do nothing

        await this.actor.update({
          "system.gambitDecks.equipped": "",
          "system.gambits.deck": [],
          "system.gambits.drawn": [],
          "system.gambits.discard": [],
          "system.gambits.handHidden": [],
          "system.gambits.locked": false
        });

        // Optional: notify and soft re-render
        ui.notifications.info("Gambits reset.");
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
      const { drawn = [], discard = [], handHidden = [] } = this.actor.system.gambits;
      const updatedDrawn = drawn.filter(id => id !== itemId);
      const updatedDiscard = [...discard, itemId];

      await this.actor.update({
        "system.gambits.drawn": updatedDrawn,
        "system.gambits.discard": updatedDiscard,
        "system.gambits.handHidden": handHidden.filter(id => id !== itemId)
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

    this._mgBindMoveGrid(html);

    // Change Profile Image (works for trusted + basic owners)
    html.off("click.mgProfileImg").on("click.mgProfileImg", ".mg-change-profile-image", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      if (!this.isEditable) {
        ui.notifications?.warn("You do not have permission to edit this character.");
        return;
      }

      const current = mgGetActorSheetImage(this.actor);

      // Foundry permission gates: basic players often cannot open FilePicker (especially on Forge)
      const canBrowse = game.user?.can?.("FILES_BROWSE") ?? game.user?.isTrusted ?? false;

      // Helper: apply update + live preview
      const applyImg = async (path) => {
        const cleanPath = String(path ?? "").trim();
        if (!cleanPath) return;

        try {
          const updates = { img: cleanPath };
          const proto = this.actor.prototypeToken;
          const protoSrc = proto?.texture?.src;

          if (proto && (protoSrc === current || !protoSrc || protoSrc === this.actor.img)) {
            updates["prototypeToken.texture.src"] = cleanPath;
          }

          await this.actor.update(updates);

          // Optional instant preview (safe no-op if selector doesn't exist)
          const routed = foundry.utils.getRoute(cleanPath);
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

    // Live strain updates while sheet is open, without a full sheet render.
    if (this._strainHookId) Hooks.off("updateActor", this._strainHookId);
    this._strainHookId = Hooks.on("updateActor", (actor, changes) => {
      if (actor.id !== this.actor.id) return;

      const strainChanged =
        foundry.utils.hasProperty(changes, "system.strain") ||
        foundry.utils.hasProperty(changes, "system.strain.mortal") ||
        foundry.utils.hasProperty(changes, "system.strain.soul") ||
        foundry.utils.hasProperty(changes, "system.strain.mortal capacity") ||
        foundry.utils.hasProperty(changes, "system.strain.soul capacity");

      if (!strainChanged) return;

      for (const type of ["mortal", "soul"]) {
        const trackValue = Number(actor.system?.strain?.[type] ?? 0);
        const $track = this.element.find(`.strain-track[data-strain="${type}"]`);
        $track.find(".strain-dot").each((_, node) => {
          const v = Number(node.dataset.value);
          node.classList.toggle("filled", v <= trackValue);
        });

        const capKey = `${type} capacity`;
        const capValue = Number(actor.system?.strain?.[capKey] ?? 0);
        const capEl = this.element[0]?.querySelector(`.capacity-value[data-type="${type}"]`);
        if (capEl) capEl.textContent = String(Math.max(0, capValue));
      }

      refreshStrainEffectBadges();
    });

    // Live STO updates while sheet is open
    if (this._stoHookId) Hooks.off("updateActor", this._stoHookId);
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
      tenacity: ["brawl", "athletics", "endure"],
      finesse: ["aim", "stealth", "sleight"],
      resolve: ["will", "composure", "grit"],
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
      row.caps?.drawPool,
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

  _mgClampStatValue(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(-3, Math.min(3, Math.trunc(n)));
  }

  _mgFormatSigned(n) {
    const v = Number(n) || 0;
    return v >= 0 ? `+${v}` : `${v}`;
  }

  _mgStatPickerHtml(current) {
    const choices = [-3, -2, -1, 0, 1, 2, 3];

    return `
      <div class="mg-stat-picker">
        ${choices.map(v => `
          <button
            type="button"
            class="mg-stat-choice ${v === current ? "selected" : ""}"
            data-value="${v}"
          >
            ${this._mgFormatSigned(v)}
          </button>
        `).join("")}
      </div>
    `;
  }

async _mgOpenStatPicker({ title, current }) {
  let settled = false;

  return new Promise((resolve) => {
    const dlg = new Dialog({
      title,
      content: `
        <h2 class="modal-headline">${title}</h2>
        ${this._mgStatPickerHtml(current)}
      `,
      buttons: {
        cancel: {
          label: this._mgBtn("Cancel", "fa-circle-xmark"),
          callback: () => {
            settled = true;
            resolve(null);
          }
        }
      },
      render: (html) => {
        html.closest(".app").addClass("mg-stat-picker-dialog");

        html.find(".mg-stat-choice").on("click", (ev) => {
          settled = true;
          resolve(Number(ev.currentTarget.dataset.value));
          dlg.close();
        });
      },
      close: () => {
        if (!settled) resolve(null);
      }
    });

    dlg.render(true);
  });
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
      p.moves ? `${p.moves} Learned Move` : null,
      p.sparkSlots ? `${p.sparkSlots} Spark Slot` : null,
      p.gambitPoints ? `${p.gambitPoints} Gambit Point` : null,
      p.deckSlots ? `${p.deckSlots} Deck Slot` : null,
      p.expertise ? `${p.expertise} Expertise` : null,
      p.signaturePerk ? `Signature Perk` : null,
      p.finalHandDiscoverable ? `Final Hands discoverable` : null
    ].filter(Boolean).join(", ");

    const readPending = async () => {
      const s = await actor.getFlag("midnight-gambit","state");
      const p = s?.pending || {};
      return {
        attributes: Number(p.attributes||0),
        moves: Number(p.moves||0),
        sparkSlots: Number(p.sparkSlots||0),
        expertise: Number(p.expertise||0),
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

    const levelGrants = actor._computeGrantsForLevel?.(Number(actor.system?.level) || 1) ?? {};
    const summaryRewards = {
      ...pending,
      gambitPoints: Number(levelGrants.gambitPoints || 0),
      deckSlots: Number(levelGrants.deckSlots || 0)
    };

    await Dialog.wait({
      title: "Level Up Rewards",   // plain string only
      content: `
        <p>You have gained: <strong>${fmt(summaryRewards)}</strong>.</p>
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
      const keys = ["tenacity","finesse","resolve","guile","instinct","presence"]
        .filter(k => Number(actor.system?.attributes?.[k] ?? actor.system?.baseAttributes?.[k] ?? 0) < 3);

      if (!keys.length) {
        ui.notifications.warn("All Attributes are already at the maximum of +3.");
        break;
      }

      const options = keys
        .map(k => `<option value="${k}">${k.toUpperCase()} (${this._mgFormatSigned(actor.system?.attributes?.[k] ?? actor.system?.baseAttributes?.[k] ?? 0)})</option>`)
        .join("");
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
    if ((pending = await readPending()).expertise > 0) {
      const ok = await Dialog.wait({
        title: "Expertise",
        content: `
          <p>You gained <strong>+${pending.expertise} Expertise</strong>. Expertise selection is coming in a later pass.</p>
        `,
        buttons: {
          yes: { label: this._mgBtn("Acknowledge", "fa-check-double"), callback: () => true },
          no:  { label: this._mgBtn("Later", "fa-clock"), callback: () => false }
        },
        default: "yes"
      });

      if (ok) { try { await actor.mgSpendPending("ack-expertise"); } catch (e) {} }
    }

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
      const openLibrary = await Dialog.wait({
        title: "Choose Learned Move",
        content: `
          <p>You have <strong>${pending.moves}</strong> unspent Learned Move(s). Open the Moves Library to choose one.</p>
        `,
        buttons: {
          library: { label: this._mgBtn("Open Moves Library", "fa-book-open"), callback: () => true },
          later: { label: this._mgBtn("Later", "fa-clock"), callback: () => false }
        },
        default: "library"
      });
      if (openLibrary) new MovesLibraryApplication(actor).render(true);
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

  _mgEnsureSheetDropCSS() {
    if (document.getElementById("mg-character-drop-css")) return;

    const style = document.createElement("style");
    style.id = "mg-character-drop-css";
    style.textContent = `
      .mg-character-drop-overlay {
        position: fixed;
        z-index: 999999;
        pointer-events: none;
        display: none;
        place-items: center;
        background: rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(2px);
        border: 2px dashed rgba(162, 215, 41, 0.85);
        box-shadow: inset 0 0 40px rgba(162, 215, 41, 0.18);
      }

      .mg-character-drop-overlay.is-active {
        display: grid;
      }

      .mg-character-drop-label {
        padding: 14px 22px;
        border-radius: 14px;
        background: rgba(10, 12, 16, 0.9);
        color: white;
        font-weight: 900;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        box-shadow: 0 0 24px rgba(162, 215, 41, 0.35);
      }

      .mg-character-drop-overlay.is-denied {
        border-color: rgba(255, 80, 80, 0.9);
        box-shadow: inset 0 0 40px rgba(255, 80, 80, 0.18);
      }

      .mg-character-drop-overlay.is-denied .mg-character-drop-label {
        box-shadow: 0 0 24px rgba(255, 80, 80, 0.35);
      }
    `;

    document.head.appendChild(style);
  }

  _mgCharacterAllowedDropTypes() {
    return new Set(["weapon", "armor", "misc", "gambit", "guise", "move"]);
  }

  _mgCharacterBlockedDropMessage({ documentName, type, tier } = {}) {
    if (documentName === "Actor") return "Characters can only be dropped onto Crew sheets.";

    if (type === "asset") return "Assets can only be added to Crew sheets.";

    if (type === "gambit" && String(tier ?? "").toLowerCase() === "crew") {
      return "Crew Gambits can only be added to Crew sheets.";
    }

    return null;
  }

  async _mgGetCharacterDropStatus(event) {
    let data = null;

    try {
      data = TextEditor.getDragEventData(event);
    } catch (_err) {
      return {
        known: false,
        allowed: false,
        message: null
      };
    }

    if (!data?.type) {
      return {
        known: false,
        allowed: false,
        message: null
      };
    }

    if (data.type === "Actor") {
      return {
        known: true,
        allowed: false,
        message: this._mgCharacterBlockedDropMessage({ documentName: "Actor" })
      };
    }

    if (data.type !== "Item") {
      return {
        known: true,
        allowed: false,
        message: `${data.type} cannot be added to a Character sheet.`
      };
    }

    let itemType = null;
    let tier = "";

    if (data.uuid) {
      const doc = await fromUuid(data.uuid).catch(() => null);

      if (doc?.documentName === "Item") {
        itemType = doc.type;
        tier = String(doc.system?.tier ?? "").toLowerCase();
      }
    }

    if (!itemType) {
      const raw = data.data || data;
      itemType = raw?.type ?? raw?.system?.type ?? null;
      tier = String(raw?.system?.tier ?? raw?.tier ?? "").toLowerCase();
    }

    const blockedMessage = this._mgCharacterBlockedDropMessage({
      documentName: "Item",
      type: itemType,
      tier
    });

    if (blockedMessage) {
      return {
        known: true,
        allowed: false,
        message: blockedMessage,
        type: itemType,
        tier
      };
    }

    if (!this._mgCharacterAllowedDropTypes().has(itemType)) {
      return {
        known: true,
        allowed: false,
        message: `${itemType || "That item"} cannot be added to a Character sheet.`,
        type: itemType,
        tier
      };
    }

    return {
      known: true,
      allowed: true,
      message: null,
      type: itemType,
      tier
    };
  }

  async _mgGetCharacterDragSourceStatus(event) {
    const el = event.target?.closest?.(
      "[data-uuid], [data-document-uuid], [data-document-id], [data-entry-id], [data-item-id], [data-mg-item-id], [data-mg-actor-id], .directory-item"
    );

    if (!el) {
      return {
        known: false,
        allowed: false,
        message: null
      };
    }

    const uuid =
      el.dataset.uuid ||
      el.dataset.documentUuid ||
      el.dataset.entryUuid ||
      null;

    let doc = null;

    if (uuid) {
      doc = await fromUuid(uuid).catch(() => null);
    }

    const id =
      el.dataset.documentId ||
      el.dataset.entryId ||
      el.dataset.itemId ||
      el.dataset.mgItemId ||
      el.dataset.mgActorId ||
      el.dataset.id ||
      null;

    // World sidebar fallback.
    if (!doc && id) {
      doc = game.items?.get(id) || game.actors?.get(id) || null;
    }

    // Compendium fallback.
    // Some Foundry compendium rows expose data-pack + data-document-id.
    const pack =
      el.dataset.pack ||
      el.closest?.("[data-pack]")?.dataset?.pack ||
      null;

    if (!doc && pack && id) {
      doc = await fromUuid(`Compendium.${pack}.${id}`).catch(() => null);
    }

    if (!doc) {
      return {
        known: false,
        allowed: false,
        message: null
      };
    }

    if (doc.documentName === "Actor") {
      return {
        known: true,
        allowed: false,
        message: this._mgCharacterBlockedDropMessage({ documentName: "Actor" })
      };
    }

    if (doc.documentName !== "Item") {
      return {
        known: true,
        allowed: false,
        message: `${doc.documentName} cannot be added to a Character sheet.`
      };
    }

    const itemType = doc.type;
    const tier = String(doc.system?.tier ?? "").toLowerCase();

    const blockedMessage = this._mgCharacterBlockedDropMessage({
      documentName: "Item",
      type: itemType,
      tier
    });

    if (blockedMessage) {
      return {
        known: true,
        allowed: false,
        message: blockedMessage,
        type: itemType,
        tier
      };
    }

    if (!this._mgCharacterAllowedDropTypes().has(itemType)) {
      return {
        known: true,
        allowed: false,
        message: `${itemType || "That item"} cannot be added to a Character sheet.`,
        type: itemType,
        tier
      };
    }

    return {
      known: true,
      allowed: true,
      message: null,
      type: itemType,
      tier
    };
  }

  _mgIsInternalSheetDrag(event) {
    const types = Array.from(event?.dataTransfer?.types ?? []);

    // Your internal Gambit hand drag uses this MIME.
    if (types.includes("application/x-midnightgambit-gambit")) return true;

    // Move reordering starts from inside the sheet. Do not let the sheet-wide catcher eat it.
    const path = event?.composedPath?.() ?? [];
    return path.some(el =>
      el?.classList?.contains?.("move-block") ||
      el?.classList?.contains?.("gambit-card") ||
      el?.classList?.contains?.("gambit-hand-card")
    );
  }

  _mgBindSheetWideDrop(html) {
    this._mgEnsureSheetDropCSS();

    const root = html?.[0];
    const app = root?.closest?.(".window-app");
    if (!app) return;

    if (this._mgSheetWideDropHandlers) {
      const h = this._mgSheetWideDropHandlers;

      app.removeEventListener("dragenter", h.dragenter, true);
      app.removeEventListener("dragover", h.dragover, true);
      app.removeEventListener("dragleave", h.dragleave, true);
      app.removeEventListener("drop", h.drop, true);

      document.removeEventListener("dragstart", h.documentDragStart, true);
      document.removeEventListener("dragend", h.documentDragEnd, true);
      document.removeEventListener("drop", h.documentDragEnd, true);
    }

    let overlay = document.querySelector(`#mg-character-drop-overlay-${this.actor.id}`);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = `mg-character-drop-overlay-${this.actor.id}`;
      overlay.className = "mg-character-drop-overlay";
      overlay.innerHTML = `<div class="mg-character-drop-label">Drop Here</div>`;
      document.body.appendChild(overlay);
    }

    const syncOverlayToSheet = () => {
      const rect = app.getBoundingClientRect();

      overlay.style.left = `${rect.left}px`;
      overlay.style.top = `${rect.top}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
    };

    let dragDepth = 0;

    let mgVisualStatus = {
      known: false,
      allowed: false,
      message: null
    };

    const clearState = () => {
      dragDepth = 0;

      mgVisualStatus = {
        known: false,
        allowed: false,
        message: null
      };

      overlay.classList.remove("is-active", "is-denied");

      const label = overlay.querySelector(".mg-character-drop-label");
      if (label) label.textContent = "Drop Here";
    };

    const showOverlay = (labelText = "Drop Here") => {
      syncOverlayToSheet();

      const label = overlay.querySelector(".mg-character-drop-label");
      if (label) label.textContent = labelText;

      overlay.classList.add("is-active");
      overlay.classList.remove("is-denied");
    };

    const hideOverlay = () => {
      overlay.classList.remove("is-active", "is-denied");

      const label = overlay.querySelector(".mg-character-drop-label");
      if (label) label.textContent = "Drop Here";
    };

    const refreshVisualStatusFromSource = async (event) => {
      if (this._mgIsInternalSheetDrag(event)) return;

      const status = await this._mgGetCharacterDragSourceStatus(event);
      mgVisualStatus = status;

      if (status.allowed) {
        showOverlay("Drop Here");
        return;
      }

      hideOverlay();
    };

    const documentDragStart = (event) => {
      if (this._mgIsInternalSheetDrag(event)) return;

      refreshVisualStatusFromSource(event).catch(err => {
        console.warn("MG | Could not inspect drag source:", err);
        clearState();
      });
    };

    const dragenter = async (event) => {
      if (this._mgIsInternalSheetDrag(event)) return;

      dragDepth += 1;

      // Try real Foundry payload once we are over the sheet.
      // If this says blocked, hide the overlay.
      // If it says unknown, do NOT block anything.
      const status = await this._mgGetCharacterDropStatus(event);

      if (status.known) {
        mgVisualStatus = status;
      }

      if (mgVisualStatus.allowed) {
        showOverlay("Drop Here");
      } else {
        hideOverlay();
      }
    };

    const dragover = async (event) => {
      if (this._mgIsInternalSheetDrag(event)) return;

      // Critical:
      // Always unblock the browser for external drops.
      // Validation happens on drop, not here.
      event.preventDefault();

      const status = await this._mgGetCharacterDropStatus(event);

      if (status.known) {
        mgVisualStatus = status;
      }

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = mgVisualStatus.known && !mgVisualStatus.allowed
          ? "none"
          : "copy";
      }

      if (mgVisualStatus.allowed) {
        showOverlay("Drop Here");
      } else {
        hideOverlay();
      }
    };

    const dragleave = (event) => {
      if (this._mgIsInternalSheetDrag(event)) return;

      dragDepth = Math.max(0, dragDepth - 1);

      // If the dragged source is valid, keep the sheet lit even when the cursor
      // briefly leaves the app. That satisfies the "picked up something valid"
      // behavior without using dragover as a fragile gate.
      if (dragDepth === 0 && !mgVisualStatus.allowed) {
        hideOverlay();
      }
    };

    const drop = async (event) => {
      if (this._mgIsInternalSheetDrag(event)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      try {
        const status = await this._mgGetCharacterDropStatus(event);

        if (status.known && !status.allowed) {
          hideOverlay();

          if (status.message) {
            ui.notifications?.warn(status.message);
          }

          clearState();
          return false;
        }

        // If drop data is weird/unknown, still hand it to your existing _onDrop.
        // This preserves the compendium fix instead of strangling it at the gate.
        await this._onDrop(event);
      } catch (err) {
        console.error("MG | Character sheet-wide drop failed:", err);
        ui.notifications?.error("Drop failed. See console.");
      } finally {
        clearState();
      }
    };

    const documentDragEnd = () => {
      clearState();
    };

    this._mgSheetWideDropHandlers = {
      dragenter,
      dragover,
      dragleave,
      drop,
      documentDragStart,
      documentDragEnd
    };

    app.addEventListener("dragenter", dragenter, true);
    app.addEventListener("dragover", dragover, true);
    app.addEventListener("dragleave", dragleave, true);
    app.addEventListener("drop", drop, true);

    document.addEventListener("dragstart", documentDragStart, true);
    document.addEventListener("dragend", documentDragEnd, true);
    document.addEventListener("drop", documentDragEnd, true);
  }
  /* Drag and Drop onto Character Sheet
  ==============================================================================*/
  async _onDropItemCreate(itemData) {

    const rawType = itemData?.type === "Item"
      ? (itemData?.data?.type ?? itemData?.system?.type ?? itemData?.system?.system?.type)
      : (itemData?.type ?? itemData?.data?.type ?? itemData?.system?.type);
    const allowedCharacterTypes = this._mgCharacterAllowedDropTypes();

    if (!allowedCharacterTypes.has(rawType)) {
      ui.notifications?.warn(`${rawType || "That item"} cannot be added to a Character sheet.`);
      return [];
    }

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

    let allowOverLimitGambit = false;

    // --- Deck capacity check for Player Gambits (pre-create) ---
    try {
      // Normalize payload
      const raw = itemData?.system?.system ? itemData.system : itemData;
      const type = raw?.type ?? itemData?.type;

      if (type === "gambit") {
        // Read current deck + max (fallbacks keep old characters safe)
        const g = this.actor.system?.gambits ?? {};
        const deck = Array.isArray(g.deck) ? g.deck : [];
        const drawn = Array.isArray(g.drawn) ? g.drawn : [];
        const discard = Array.isArray(g.discard) ? g.discard : [];
        const poolCount = new Set([...deck, ...drawn, ...discard].map(String)).size;
        const deckMax = this._mgGetPlayerGambitMax();

        if (poolCount >= deckMax) {
          const ok = await Dialog.confirm({
            title: "Over Gambit Limit?",
            content: `
              <p>You are adding a Gambit over your deck size
              (<strong>${poolCount}/${deckMax}</strong>).</p>
              <p><em>Only do this if your GM has approved!</em></p>
            `,
            defaultYes: false,
            yes: () => true,
            no: () => false
          });
          if (!ok) return [];
          allowOverLimitGambit = true;
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
          { value: "life", label: "Life" }
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
      const drawn = Array.isArray(g.drawn) ? g.drawn : [];
      const discard = Array.isArray(g.discard) ? g.discard : [];
      const maxDeck = this._mgGetPlayerGambitMax();

      // Don’t add duplicates; enforce capacity
      const nextDeck = deck.includes(gambitItem.id) ? deck : [...deck, gambitItem.id];
      const nextPoolCount = new Set([...nextDeck, ...drawn, ...discard].map(String)).size;

      if (nextPoolCount > maxDeck && !allowOverLimitGambit) {
        // Roll back the item we just created and warn
        await gambitItem.delete();
        ui.notifications.warn(`Your draw pool can hold ${maxDeck} Gambits right now.`);
        return [];
      }

      await this.actor.update({
        "system.gambits.deck": nextDeck,
        "system.gambits.handHidden": (g.handHidden ?? []).filter(id => id !== gambitItem.id)
      });
      return [];
    }


    /* Learned Move drop-on-actor
    ---------------------------------------------------------------------*/
    if (rawType === "move") {
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
          const candidates = [
            itemData?.data,
            itemData?.system?.system ? itemData.system : null,
            itemData
          ].filter(Boolean);

          const data = candidates.find(d => d?.name && d?.type);
          if (!data) {
            console.warn("MG | Dropped Move payload missing required fields:", itemData);
            throw new Error("Dropped Move missing fields");
          }
          moveDoc = foundry.utils.deepClone(data);
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


    // Normal inventory items: let Foundry create them, then refresh the sheet
    const created = await super._onDropItemCreate(itemData);

    // Only force refresh for regular inventory items that fall through here.
    // Guises, Gambits, and Moves return earlier and manage their own refresh.
    if (["weapon", "armor", "misc", "item"].includes(itemData.type)) {
      this.render(false);
    }

    return created;
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

  /* Sheet hand order helpers. Shared shape so Moves can plug into this list later.
  ---------------------------------------------------------------------*/
  _mgBindHandOrderList(html, {
    listSelector,
    cardSelector,
    idAttr = "itemId",
    orderPath,
    hiddenPath,
    hiddenLabel = "Hand",
    filterToCurrentOrder = true
  } = {}) {
    const $root = html instanceof jQuery ? html : $(html);
    const $list = $root.find(listSelector);
    if (!$list.length || !cardSelector || !orderPath || !hiddenPath) return;

    const HAND_ORDER_MIME = "application/x-midnightgambit-hand-order";
    const dragScope = `${this.actor.id}:${orderPath}`;
    const getId = (el) => el?.dataset?.[idAttr] || el?.getAttribute?.(`data-${idAttr.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}`);
    const readArray = (path) => {
      const value = foundry.utils.getProperty(this.actor, path);
      return Array.isArray(value) ? value.map(String) : [];
    };
    const isOwnDrag = (ev) => {
      const native = ev?.originalEvent ?? ev;
      const types = Array.from(native?.dataTransfer?.types ?? []);
      return types.includes(HAND_ORDER_MIME) && !!dragId && !!dragEl;
    };

    let dragId = null;
    let dragEl = null;
    const placeholder = document.createElement("div");
    placeholder.className = "mg-hand-order-placeholder";
    placeholder.setAttribute("aria-hidden", "true");

    const clearPreview = () => {
      placeholder.remove();
      $list.find(".mg-hand-order-placeholder").remove();
      $list.find(`${cardSelector}.mg-dragging`).removeClass("mg-dragging");
    };

    const persistOrderFromDom = async () => {
      const live = new Set(readArray(orderPath));
      const ids = $list.find(cardSelector).toArray().map(getId).filter(id => id && (!filterToCurrentOrder || !live.size || live.has(String(id))));
      for (const id of readArray(orderPath)) {
        if (!ids.includes(id)) ids.push(id);
      }
      await this.actor.update({ [orderPath]: ids }, { render: false });
    };

    $list.off(".mgHandOrder");
    clearPreview();

    $list.on("click.mgHandOrder", ".mg-hand-order-eye", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const button = ev.currentTarget;
      const card = button.closest(cardSelector);
      const id = getId(card);
      if (!id) return;

      const wasHidden = card.dataset.hidden === "true";
      const nowHidden = !wasHidden;
      card.dataset.hidden = String(nowHidden);
      card.classList.toggle("is-muted", nowHidden);
      button.title = nowHidden ? `Show in ${hiddenLabel}` : `Hide from ${hiddenLabel}`;
      button.setAttribute("aria-pressed", String(!nowHidden));
      const icon = button.querySelector("i");
      if (icon) icon.className = nowHidden ? "fa-regular fa-eye-slash" : "fa-regular fa-eye";

      try {
        const hidden = new Set(readArray(hiddenPath));
        if (nowHidden) hidden.add(String(id));
        else hidden.delete(String(id));
        await this.actor.update({ [hiddenPath]: Array.from(hidden) }, { render: false });
      } catch (err) {
        card.dataset.hidden = String(wasHidden);
        card.classList.toggle("is-muted", wasHidden);
        if (icon) icon.className = wasHidden ? "fa-regular fa-eye-slash" : "fa-regular fa-eye";
        ui.notifications?.warn(`Could not update ${hiddenLabel} visibility.`);
        console.warn("MG | Hand visibility toggle failed:", err);
      }
    });

    $list.on("dragstart.mgHandOrder", cardSelector, (ev) => {
      const native = ev.originalEvent ?? ev;
      if (native.target?.closest?.("button")) {
        native.preventDefault?.();
        return;
      }

      dragEl = ev.currentTarget;
      dragId = getId(dragEl);
      if (!dragId) return;

      const rect = dragEl.getBoundingClientRect();
      placeholder.style.height = `${rect.height}px`;
      dragEl.classList.add("mg-dragging");
      native.dataTransfer?.setData(HAND_ORDER_MIME, JSON.stringify({ scope: dragScope, id: dragId }));
      native.dataTransfer?.setData("text/plain", dragId);
      native.dataTransfer?.setDragImage?.(dragEl, rect.width - 16, rect.height / 2);
    });

    $list.on("dragover.mgHandOrder", `${cardSelector}, .mg-hand-order-placeholder`, (ev) => {
      if (!isOwnDrag(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();

      const target = ev.currentTarget;
      const refEl = target.classList.contains("mg-hand-order-placeholder") ? placeholder : target;
      if (refEl === dragEl || !refEl.parentElement) return;

      const bounds = refEl.getBoundingClientRect();
      const midY = bounds.top + bounds.height / 2;
      if ((ev.originalEvent?.clientY ?? 0) < midY) {
        refEl.parentElement.insertBefore(placeholder, refEl);
      } else {
        refEl.parentElement.insertBefore(placeholder, refEl.nextSibling);
      }
    });

    $list.on("dragover.mgHandOrder", (ev) => {
      if (!isOwnDrag(ev)) return;
      if (ev.target.closest(cardSelector)) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (placeholder.parentElement !== $list[0]) $list[0].appendChild(placeholder);
    });

    const finalize = async () => {
      if (!dragId || !dragEl) return;
      try {
        const parent = placeholder.parentElement;
        if (parent) parent.insertBefore(dragEl, placeholder);
        await persistOrderFromDom();
      } finally {
        clearPreview();
        dragId = null;
        dragEl = null;
      }
    };

    $list.on("drop.mgHandOrder", async (ev) => {
      if (!isOwnDrag(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
      await finalize();
    });

    $list.on("dragend.mgHandOrder", async () => {
      await finalize();
    });
  }

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

      try {
        // If no placeholder, treat the drop as cancelled but still clean up.
        if (!placeholder.parentNode) return;

        // Move the card to the placeholder position
        placeholder.parentNode.insertBefore(dragEl, placeholder);

        // Persist order flag
        const ids = $grid.find(".move-block").map((_i, el) => el.dataset.itemId).get();
        await this.actor.setFlag("midnight-gambit", "moveOrder", ids);
      } finally {
        clearPreview();
        dragId = null;
        dragEl = null;
      }
    });

    // Re-apply saved order once on render
    this._mgApplyMoveOrderToDom($grid);

    // Track Move create/delete while this sheet is open.
    // Important: activateListeners runs after every render, so remove old hooks first.
    if (this._mgMoveCreateHook) Hooks.off("createItem", this._mgMoveCreateHook);
    if (this._mgMoveDeleteHook) Hooks.off("deleteItem", this._mgMoveDeleteHook);

    this._mgMoveCreateHook = async (item) => {
      if (item?.parent !== this.actor || item.type !== "move") return;

      setTimeout(async () => {
        const $grid2 = this.element.find(".moves-grid");
        if (!$grid2.length) return;

        const order = (await this.actor.getFlag("midnight-gambit", "moveOrder")) ?? [];
        if (order.includes(item.id)) return;

        const ids = $grid2.find(".move-block").map((_i, el) => el.dataset.itemId).get();
        await this.actor.setFlag("midnight-gambit", "moveOrder", ids);
      }, 0);
    };

    this._mgMoveDeleteHook = async (item) => {
      if (item?.parent !== this.actor || item.type !== "move") return;

      const order = (await this.actor.getFlag("midnight-gambit", "moveOrder")) ?? [];
      if (!order.includes(item.id)) return;

      await this.actor.setFlag(
        "midnight-gambit",
        "moveOrder",
        order.filter(id => id !== item.id)
      );
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
    let data = null;

    try {
      data = TextEditor.getDragEventData(event);
    } catch (err) {
      console.warn("MG | Could not read drop data:", err);
      return false;
    }

    // ------------------------------------------------------------
    // Character sheets never accept Actor drops.
    // Crew sheets use Actor drops for party members.
    // ------------------------------------------------------------
    if (data?.type === "Actor") {
      const actor = data.uuid ? await fromUuid(data.uuid).catch(() => null) : null;

      const message = this._mgCharacterBlockedDropMessage({
        documentName: "Actor",
        type: actor?.type
      });

      ui.notifications?.warn(message);
      return false;
    }

    // ------------------------------------------------------------
    // Character sheet Item gate.
    // Resolve UUID first. Only fall back to raw payload if UUID fails.
    // ------------------------------------------------------------
    if (data?.type === "Item") {
      const src = data.uuid ? await fromUuid(data.uuid).catch(() => null) : null;

      if (src?.documentName === "Item") {
        const type = src.type;
        const tier = String(src.system?.tier ?? "").toLowerCase();

        const blockedMessage = this._mgCharacterBlockedDropMessage({
          documentName: "Item",
          type,
          tier
        });

        if (blockedMessage) {
          ui.notifications?.warn(blockedMessage);
          return false;
        }

        if (!this._mgCharacterAllowedDropTypes().has(type)) {
          ui.notifications?.warn(`${type || "That item"} cannot be added to a Character sheet.`);
          return false;
        }

        if (type === "move") {
          return this._onDropItemCreate(src.toObject());
        }

        // Important:
        // Source resolved and passed. Do NOT run the raw fallback after this.
        return super._onDrop?.(event) ?? false;
      }

      // Raw fallback only when UUID resolution did not give us an Item.
      const raw = data.data || data;
      const rawType = raw?.type ?? raw?.system?.type;
      const rawTier = String(raw?.system?.tier ?? raw?.tier ?? "").toLowerCase();

      const blockedMessage = this._mgCharacterBlockedDropMessage({
        documentName: "Item",
        type: rawType,
        tier: rawTier
      });

      if (blockedMessage) {
        ui.notifications?.warn(blockedMessage);
        return false;
      }

      if (rawType && !this._mgCharacterAllowedDropTypes().has(rawType)) {
        ui.notifications?.warn(`${rawType} cannot be added to a Character sheet.`);
        return false;
      }
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

    try {
      if (this._strainHookId) Hooks.off("updateActor", this._strainHookId);
      if (this._stoHookId) Hooks.off("updateActor", this._stoHookId);
      this._strainHookId = null;
      this._stoHookId = null;
    } catch (_) {}

    return super.close(options);
  }
}
