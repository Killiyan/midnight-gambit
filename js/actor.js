import { LEVEL_TABLE } from "../config.js";

export class MidnightGambitActor extends Actor {
  prepareData() {
    super.prepareData();
    const data = this.system;

    // === Initialize attribute and strain structures ===
    const ATTR_KEYS = ["tenacity","finesse","resolve","guile","instinct","presence"];

    // Ensure baseAttributes exists AND each key is a finite number
    data.baseAttributes ??= {};
    for (const k of ATTR_KEYS) {
      const n = Number(data.baseAttributes[k]);
      data.baseAttributes[k] = Number.isFinite(n) ? n : 0;
    }

    // Clone AFTER sanitizing
    const base = foundry.utils.deepClone(data.baseAttributes);

    data.strain ??= { mortal: 0, soul: 0 };
    data.baseStrainCapacity ??= { mortal: 0, soul: 0 };
    data.strain.manualOverride ??= {};

    const manual = data.strain.manualOverride;

    if (!manual["mortal capacity"]) {
      data.strain["mortal capacity"] = data.baseStrainCapacity?.mortal ?? 0;
    }
    if (!manual["soul capacity"]) {
      data.strain["soul capacity"] = data.baseStrainCapacity?.soul ?? 0;
    }

    // === Armor: initialize remaining capacity if missing ===
    for (const item of this.items) {
      if (item.type === "armor" || item.type === "misc") {
        const sys = item.system;
        if (!sys.remainingCapacity) {
          item.updateSource({
            "system.remainingCapacity": {
              mortal: sys.mortalCapacity ?? 0,
              soul: sys.soulCapacity ?? 0
            }
          });
        }
      }
    }

    /* Risk & Spark defaults
    ----------------------------------------------------------------------*/  
    data.baseRiskDice ??= 5;
    data.riskDiceCapacity = data.baseRiskDice;
    data.sparkUsed ??= 0;

    // --- Resolve guise whether system.guise is an embedded id OR a UUID ---
    const ref = data.guise;
    let guise = null;

    if (ref) {
      // 1) Prefer embedded Item id on the actor
      guise = this.items.get(ref);

      // 2) Fallback to UUID (older actors / compendium reference)
      if (!guise && typeof fromUuidSync === "function") {
        try { guise = fromUuidSync(ref); } catch (_) {}
      }
    }

    if (guise?.type === "guise") {
      const gSys = guise.system || {};
      const modifiers = gSys.modifiers ?? {};

      // Apply modifiers as NUMBERS (avoid string concat/NaN)
      for (const [key, mod] of Object.entries(modifiers)) {
        if (base[key] != null) {
          const m = Number(mod);
          if (Number.isFinite(m)) base[key] += m;
        }
      }

      // Apply Guise strain capacity if not manually overridden
      if (!manual["mortal capacity"]) {
        data.strain["mortal capacity"] = gSys.mortalCap ?? 0;
      }
      if (!manual["soul capacity"]) {
        data.strain["soul capacity"] = gSys.soulCap ?? 0;
      }

      // Apply other Guise fields
      data.baseStrainCapacity = {
        mortal: gSys.mortalCap ?? 0,
        soul:   gSys.soulCap   ?? 0
      };
      data.sparkBonus ??= 0;
      data.sparkSlots = (gSys.sparkSlots ?? 0) + (Number(data.sparkBonus) || 0);
      data.riskDice   = gSys.riskDice   ?? 5;
      data.casterType = gSys.casterType ?? null;
    }

    // === Crew defaults (non-destructive) ===
    if (this.type === "crew") {
      const s = this.system;

      // Currency parity with character Lux
      s.lux = Number.isFinite(Number(s.lux)) ? Number(s.lux) : 0;

      // Flavor/Bio
      s.bio ??= {};
      s.bio.lookAndFeel ??= "";
      s.bio.weakness ??= "";
      s.bio.location ??= "";
      s.bio.features ??= "";
      s.bio.tags ??= []; // array of strings for now

      // Gambits deck state (deck/hand/discard)
      s.gambits ??= {};
      s.gambits.deck ??= [];      // array of embedded Item IDs (type: gambit)
      s.gambits.drawn ??= [];
      s.gambits.discard ??= [];
      s.gambits.handSize ??= 3;   // tweak later if you like
      s.gambits.deckSize ??= 10;  // optional cap, not enforced yet

      // Nothing special needed for Assets; they are embedded Items of type "asset"
    }

    // === Clamp attributes ===
    for (const key of Object.keys(base)) {
      base[key] = Math.max(-2, Math.min(3, base[key]));
    }

    data.level ??= 1;
    // Keep level inside supported bounds
    data.level = Math.max(1, Math.min(12, Number(data.level) || 1));


    /* Level-derived caps & unlock flags
    ----------------------------------------------------------------------*/  
    const lvl = Math.max(1, Math.min(12, Number(data.level) || 1));
    const L = LEVEL_TABLE?.[lvl] ?? null;

    // Ensure structures
    data.gambits ??= {};
    data.gambits.maxDrawSize ??= 3;   // existing field in your template
    data.gambits.maxDeckSize ??= 3;   // keep as-is unless you want to scale deck size later
    data.gambits.maxEquip ??= 3;      // NEW field for "Equipped Gambits" cap (UI can read it)

    data.unlocks ??= { trickDeck:false, aceInSleeve:false, signaturePerk:false, finalHand:false, allTiers:false, dualClass:false };

    if (L?.caps) {
      // 1) Deck capacity: your table's "Gambit Draw Pool" = DECK SIZE
      if (Number.isFinite(+L.caps.drawPool)) data.gambits.maxDeckSize = +L.caps.drawPool;

      // 2) HAND SIZE (how many you can draw at once):
      //    Levels 1–5: 3   |   6–9: 4   |   10–12: 5
      data.gambits.maxDrawSize = (lvl >= 10) ? 5 : (lvl >= 6 ? 4 : 3);

      // 3) Equipped cap if you use it
      if (Number.isFinite(+L.caps.equipMax)) data.gambits.maxEquip = +L.caps.equipMax;

      // 4) Tier label passthrough
      data.tier = L.caps.tier || "rookie";
    }

    if (L?.unlocks) {
      data.unlocks = {
        trickDeck:      !!L.unlocks.trickDeck,
        aceInSleeve:    !!L.unlocks.aceInSleeve,
        signaturePerk:  !!L.unlocks.signaturePerk,
        finalHand:      !!L.unlocks.finalHand,
        allTiers:       !!L.unlocks.allTiers,
        dualClass:      !!L.unlocks.dualClass
      };
    }

    data.attributes = base;
  }

  /** Utility: get our MG flag bucket */
  _mgFlags() {
    return this.getFlag("midnight-gambit", "state") ?? {};
  }

  /* Utility: write to our MG flag bucket 
  ----------------------------------------------------------------------*/  
  async _setMgFlags(patch) {
    const curr = this._mgFlags();
    const next = foundry.utils.mergeObject(curr, patch, { inplace: false });
    await this.setFlag("midnight-gambit", "state", next);
    return next;
  }

  /* Ensure the "pending" reward counters exist and are numeric
  ----------------------------------------------------------------------*/  
  _ensurePending(base) {
    const p = { attributes:0, skills:0, moves:0, sparkSlots:0, signaturePerk:0, finalHandDiscoverable:0, ...base };
    for (const k of Object.keys(p)) {
      const n = Number(p[k]); p[k] = Number.isFinite(n) ? n : 0;
    }
    return p;
  }

  /* Compute what this level grants (already factoring spark for caster type)
  ----------------------------------------------------------------------*/  
  _computeGrantsForLevel(lvl) {
    const L = LEVEL_TABLE?.[lvl] ?? null;
    if (!L) return null;

    const g = L.grants ?? {};
    const isCaster = ["full","half"].includes(this.system.casterType ?? "none");

    return {
      attributes: Number(g.attributePoints || 0),
      skills:     Number(g.skillPoints || 0),
      moves:      Number(g.moves || 0),
      sparkSlots: isCaster ? Number(g.sparkSlots || 0) : 0,
      signaturePerk: Number(g.signaturePerk || 0),
      finalHandDiscoverable: Number(g.finalHandDiscoverable || 0)
    };
  }
  
  /* Pretty label for tier (optional helper for chat)
  ----------------------------------------------------------------------*/  
  _tierLabelForLevel(lvl) {
    const t = LEVEL_TABLE?.[lvl]?.caps?.tier ?? "";
    switch (t) {
      case "rookie-only": return "Rookie Only";
      case "rookie": return "Rookie";
      case "trick-deck-unlocked": return "Trick Deck Unlocked";
      case "trick-deck": return "Trick Deck";
      case "ace-in-the-sleeve-unlocked": return "Ace in the Sleeve Unlocked";
      case "ace": return "Ace";
      case "final-hand-unlocked": return "Final Hand Unlocked";
      case "all-tiers": return "All Tiers";
      default: return t || "—";
    }
  }

  /* Level Up this actor by +1 (capped to 12).
   * - Records a snapshot so we can undo cleanly.
   * - Adds *pending* rewards (does NOT auto-spend).
   * - Posts a chat card.
  ----------------------------------------------------------------------*/
  async mgLevelUp({ guided = false } = {}) {
    const curr = Math.max(1, Number(this.system.level || 1));
    const next = Math.min(12, curr + 1);
    if (next === curr) {
      ui.notifications.warn(`${this.name} is already at max level.`);
      return;
    }

    const L = LEVEL_TABLE?.[next];
    if (!L) {
      ui.notifications.error(`No level data for level ${next}.`);
      return;
    }

    /* Snapshot for Undo
    ----------------------------------------------------------------------*/
    const prevFlags = this._mgFlags();

    const snapshot = {
      ts: Date.now(),
      prevLevel: curr,
      prevPending: this._ensurePending(prevFlags.pending ?? {}),
      prevData: {
        baseAttributes: foundry.utils.deepClone(this.system.baseAttributes ?? {}),
        skills:         foundry.utils.deepClone(this.system.skills ?? {}),
        // sparkBonus is our additive level-up spark grant (casters only)
        sparkBonus: Number(this.system.sparkBonus ?? 0)
      }
      // In future steps, we can add: itemsCreated, choices, etc.
    };

    const history = Array.isArray(prevFlags.levelHistory) ? prevFlags.levelHistory.slice() : [];
    history.push(snapshot);

    // Keep enough snapshots to undo from max level all the way to 1
    const totalLevels = Object.keys(LEVEL_TABLE ?? {}).length || 12;
    const maxSnapshots = Math.max(totalLevels - 1, 11); // e.g., 11 snapshots for 1→12
    while (history.length > maxSnapshots) history.shift();

    // ---- Compute & add pending rewards for the new level ----
    const grants = this._computeGrantsForLevel(next) ?? {};
    const pendingPrev = this._ensurePending(prevFlags.pending ?? {});
    const pendingNext = this._ensurePending({
      attributes: pendingPrev.attributes + grants.attributes,
      skills:     pendingPrev.skills     + grants.skills,
      moves:      pendingPrev.moves      + grants.moves,
      sparkSlots: pendingPrev.sparkSlots + grants.sparkSlots,
      signaturePerk:          pendingPrev.signaturePerk + (grants.signaturePerk || 0),
      finalHandDiscoverable:  pendingPrev.finalHandDiscoverable + (grants.finalHandDiscoverable || 0)
    });

    // ---- Apply data updates ----
    await this.update({ "system.level": next });
    await this._setMgFlags({ pending: pendingNext, levelHistory: history });

    // ---- Announce in chat ----
    const tierLabel = this._tierLabelForLevel(next);
    const gainBits = [];
    if (grants.attributes) gainBits.push(`+${grants.attributes} Attribute`);
    if (grants.skills)     gainBits.push(`+${grants.skills} Skill`);
    if (grants.moves)      gainBits.push(`+${grants.moves} Move`);
    if (grants.sparkSlots) gainBits.push(`+${grants.sparkSlots} Spark Slot`);
    if (grants.signaturePerk) gainBits.push(`Signature Perk`);
    if (grants.finalHandDiscoverable) gainBits.push(`Final Hands discoverable`);

    // Safe HTML escape (polyfill for older Foundry versions)
    const esc = foundry?.utils?.escapeHTML ?? ((s) => String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;")
    );

    const gains = gainBits.length ? gainBits.join(", ") : "Progressed.";
    const content = `
      <div class="mg-levelup">
        <h2><i class="fa-solid fa-angles-up"></i> ${esc(this.name)} advanced to Level ${next}</h2>
        <p class="sub">Tier: <em>${esc(tierLabel)}</em></p>
        <ul>${gainBits.map(g => `<li>${esc(g)}</li>`).join("")}</ul>
        <p class="hint">Rewards are pending. Spend them from your sheet.</p>
      </div>
    `;

    try {
      await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor: this }),
        content
      });
    } catch (_) {}

    // (Optional) Sound sting later — we’ll wire a proper fanfare in Step 4.
    if (guided) {
      // Step 3 will open the stepper here.
    }
  }

  /* Undo the last mgLevelUp() snapshot, including sheet edits made via the wizard
  ----------------------------------------------------------------------*/
  async mgUndoLastLevel() {
    const flags = this._mgFlags();
    const history = Array.isArray(flags.levelHistory) ? flags.levelHistory.slice() : [];
    if (!history.length) {
      ui.notifications.info("No level-up to undo.");
      return;
    }

    const snap = history.pop();
    const prevPending = this._ensurePending(snap.prevPending ?? {});
    const prevLevel = Math.max(1, Number(snap.prevLevel || 1));

    // Build updates from prevData if present
    const updates = { "system.level": prevLevel };

    if (snap.prevData) {
      // Force overwrite baseAttributes + skills to previous snapshot
      updates["system.baseAttributes"] = snap.prevData.baseAttributes || {};
      updates["system.skills"] = snap.prevData.skills || {};
      updates["system.sparkBonus"] = snap.prevData.sparkBonus || 0;
    }

    await this.update(updates);
    await this._setMgFlags({ pending: prevPending, levelHistory: history });

    try {
      await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor: this }),
        content: `
          <div class="mg-levelundo">
            <p><i class="fa-solid fa-rotate-left"></i> Reverted ${this.name} to <strong>Level ${prevLevel}</strong>.
            All level-up changes (attributes, skills, spark) from the last level have been undone.</p>
          </div>
        `
      });
    } catch (_) {}
  }

  /* Spend level rewards
  ----------------------------------------------------------------------*/
  async mgSpendPending(type, payload = {}) {
    const flags = this._mgFlags();
    const pending = this._ensurePending(flags.pending ?? {});

    const dec = (k) => { if (pending[k] > 0) pending[k] -= 1; else throw new Error(`No pending ${k} to spend`); };

    switch (type) {
      case "attribute": {
        const key = String(payload.key);
        if (!this.system.baseAttributes?.hasOwnProperty(key)) throw new Error(`Bad attribute key: ${key}`);
        dec("attributes");
        const curr = Number(this.system.baseAttributes[key]) || 0;
        await this.update({ [`system.baseAttributes.${key}`]: curr + 1 });
        break;
      }
      case "skill": {
        const key = String(payload.key);
        if (!this.system.skills?.hasOwnProperty(key)) throw new Error(`Bad skill key: ${key}`);
        dec("skills");
        const curr = Number(this.system.skills[key]) || 0;
        await this.update({ [`system.skills.${key}`]: curr + 1 });
        break;
      }
      case "spark": {
        // Only casters should have gotten this pending, but double-check.
        dec("sparkSlots");
        const bonus = Number(this.system.sparkBonus) || 0;
        await this.update({ "system.sparkBonus": bonus + 1 });
        break;
      }
      case "ack-signature": {
        // For now we just consume it; Step 3.5 can open a picker later.
        dec("signaturePerk");
        break;
      }
      case "ack-finalhand": {
        dec("finalHandDiscoverable");
        break;
      }
      case "move": {
        dec("moves");
        const moveId = payload.moveId;
        const pack = game.packs.get("midnight-gambit.moves");
        const move = await pack.getDocument(moveId);
        const created = await this.createEmbeddedDocuments("Item", [move.toObject()]);
        // Track in snapshot for undo
        return created[0];
      }
      
      default:
        throw new Error(`Unknown spend type: ${type}`);
    }

    // Persist new pending counts
    await this._setMgFlags({ pending });
    return pending;
  }

  async _onCreateDescendantDocuments(embeddedName, documents, context) {
    if (embeddedName !== "Item") return;

    const guise = documents.find(doc => doc.type === "guise");
    if (!guise) return;

    console.log(`✅ Intercepted Guise creation: ${guise.name}`);

    if (!this.system.baseAttributes || Object.keys(this.system.baseAttributes).length === 0) {
      const base = foundry.utils.deepClone(this.system.attributes);
      await this.update({ "system.baseAttributes": base });
    }

    const updates = {
      "system.guise": guise.uuid,
      "system.strain['mortal capacity']": guise.system.mortalCap ?? 5,
      "system.strain['soul capacity']": guise.system.soulCap ?? 5,
      "system.sparkSlots": guise.system.sparkSlots ?? 0,
      "system.sparkUsed": 0,
      "system.riskDice": guise.system.riskDice ?? 5
    };

    console.log("Guise sparkSlots value before update:", guise.system.sparkSlots);
    console.log("Full updates object:", updates);

    await this.update(updates);
    //await this.deleteEmbeddedDocuments("Item", [guise.id]);

    context.keepId = true;
    return [];
  }
}
