// npc-sheet.js
import { evaluateRoll } from "./roll-utils.js";

export class MidnightGambitNpcSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["midnight-gambit", "sheet", "actor", "npc"],
      template: "systems/midnight-gambit/templates/actors/npc-sheet.html",
      width: 850,
      height: 950,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "general" }]
    });
  }

  async getData(options) {
    const context = await super.getData(options);
    context.actor = this.actor;
    context.system = this.actor.system ?? {};

    // Keep the same attribute ordering as the player sheet uses
    context.attributeKeys = ["tenacity", "finesse", "resolve", "guile", "instinct", "presence"];

    // NPC moves live as normal Item documents (type "move") but flagged
    const allMoves = this.actor.items.filter(i => i.type === "move");

    const isNpcSignature = (i) => i.system?.npcSignature === true || i.system?.isSignature === true;

    // --- Signatures (allow multiple) ---
    const signatureMoves = allMoves
      .filter(isNpcSignature)
      // stable order: embedded documents have a `sort` field; fallback to name
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.name).localeCompare(String(b.name)));

    context.signatureMove = signatureMoves[0] ?? null;           // “Primary” = first
    const extraSignatureMoves = signatureMoves.slice(1);         // everything else

    // --- Basic NPC Moves ---
    context.npcMoves = allMoves.filter(i =>
      i.system?.npcMove === true && !isNpcSignature(i)
    );

    // Anything else (unflagged) – currently not rendered, but kept for debugging
    context.otherMoves = allMoves.filter(i =>
      i.system?.npcMove !== true && !isNpcSignature(i)
    );

    // --- Enrich Signature + NPC Moves like the character sheet does ---
    const enrich = async (text) => {
      const raw = String(text ?? "");
      // Important: keep secrets disabled for players, enabled for GM/owners
      return TextEditor.enrichHTML(raw, {
        async: true,
        secrets: this.actor.isOwner,
        documents: true,
        links: true,
        rolls: true
      });
    };

    // Signature HTML
    context.signatureHtml = context.signatureMove
      ? await enrich(context.signatureMove.system?.description)
      : "";

    // NPC Moves HTML list in the same shape your PC template expects
    context.enrichedNpcMoves = [];
    for (const m of (context.npcMoves ?? [])) {
      context.enrichedNpcMoves.push({
        _id: m._id,
        name: m.name,
        description: m.system?.description ?? "",
        html: await enrich(m.system?.description),
        tags: Array.isArray(m.system?.tags) ? m.system.tags : []
      });
    }

    // --- Extra Signature Perks (below the primary panel) ---
    context.enrichedSignaturePerkMoves = [];
    for (const m of extraSignatureMoves) {
      context.enrichedSignaturePerkMoves.push({
        _id: m._id,
        name: m.name,
        description: m.system?.description ?? "",
        html: await enrich(m.system?.description),
        tags: Array.isArray(m.system?.tags) ? m.system.tags : []
      });
    }

    return context;
  }

  activateListeners(html) {
    super.activateListeners(html);

    // ----------------------------------------------------
    // Live refresh when embedded Items update (tags, desc, name, etc.)
    // ----------------------------------------------------
    if (!this._mgNpcUpdateItemHookId) {
      this._mgNpcUpdateItemHookId = Hooks.on("updateItem", (item, change, options, userId) => {
        // Only refresh if this item belongs to THIS NPC actor
        if (item?.parent?.id !== this.actor?.id) return;

        // Avoid thrash: render:false updates can fire in bursts
        // render(false) is cheap and keeps tab state
        this.render(false);
      });
    }    

    // ----------------------------------------------------
    // Post Moves / Signature Perk to chat (same as PC sheet)
    // ----------------------------------------------------
    html.find(".post-move").off("click.mgNpcPostMove").on("click.mgNpcPostMove", (event) => {
      event.preventDefault();
      event.stopPropagation();

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

    html.find(".post-signature").off("click.mgNpcPostSignature").on("click.mgNpcPostSignature", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const name = event.currentTarget.dataset.perkName || "Signature";
      const description = event.currentTarget.dataset.perkDescription || "";

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

    // Header pencil → open modal to edit NPC name (same behavior as character sheet)
    {
      const $root = html instanceof jQuery ? html : $(html);

      $root.off("click.mgNpcEditHeader").on("click.mgNpcEditHeader", ".mg-edit-name", async (ev) => {
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
          title: "Edit NPC Name",
          content,
          buttons: {
            ok: {
              label: "Save",
              callback: (dlgHtml) => {
                const $dlg = $(dlgHtml);
                return {
                  name: String($dlg.find('input[name="name"]').val() ?? "").trim()
                };
              }
            },
            cancel: { label: "Cancel", callback: () => null }
          },
          default: "ok"
        });

        if (!result) return;

        const updates = {};
        if (result.name && result.name !== this.actor.name) updates["name"] = result.name;

        if (Object.keys(updates).length) {
          await this.actor.update(updates);

          // Soft refresh headline text without full re-render (same as character sheet)
          const wrap = this.element.find("[data-mg-nameblock] .mg-name-view");
          if (wrap.length) wrap.text(this.actor.name);
        }
      });
    }

    // Profile crop (same behavior as PC sheet)
    this._mgInitProfileCrop(html);
    html.find(".mg-crop-profile").off("click.mgCrop").on("click.mgCrop", (ev) => {
      ev.preventDefault();
      this._mgOpenProfileCropper(html);
    });

    // ----------------------------
    // NPC sheet: Tag "see all" toggle (inventory-identical behavior)
    // ----------------------------
    {
      const $root = html instanceof jQuery ? html : $(html);

      const COLLAPSED_MAX = 44;   // match your inventory clamp
      const TRANSITION_MS = 500;

      // If you ever add per-wrap caps, keep the function; otherwise it's a constant.
      const capFor = (_wrap) => COLLAPSED_MAX;

      // Measure one wrapper and decide if it needs a toggle
      const updateOne = (wrap) => {
        if (!wrap || wrap.classList.contains("animating")) return;

        const content = wrap.querySelector(".item-tags");   // ✅ tags container
        const toggle  = wrap.querySelector(".tags-toggle"); // ✅ chevron
        if (!content || !toggle) return;

        const cap        = capFor(wrap);
        const isExpanded = wrap.classList.contains("expanded");
        const overflows  = content.scrollHeight > (cap + 1);

        wrap.classList.toggle("short", !overflows);
        toggle.hidden = !overflows;

        if (!toggle.querySelector("i")) {
          toggle.innerHTML = '<i class="fa-solid fa-angle-down"></i>';
        }

        toggle.querySelector("i")?.classList.toggle("rotated", isExpanded);

        // Clamp only when collapsed AND overflowing
        if (!isExpanded && overflows) {
          content.style.maxHeight = `${cap}px`;
        } else {
          content.style.maxHeight = "";
        }
      };

      const refreshAll = () => {
        const wraps = $root[0]?.querySelectorAll(".tags-wrap") || [];
        wraps.forEach(updateOne);
      };

      // Run once on render (deferred so scrollHeight is accurate)
      refreshAll();

      // After paint: this is the important one
      requestAnimationFrame(() => refreshAll());

      // Some Foundry sheets/layouts need a second paint (fonts/icons settle)
      requestAnimationFrame(() => requestAnimationFrame(() => refreshAll()));

      // Small failsafe for slower machines / heavy sheets
      setTimeout(() => refreshAll(), 50);

      // Click handler for chevron
      $root
        .off("click.mgNpcTagsToggle")
        .on("click.mgNpcTagsToggle", ".tags-toggle", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();

          const wrap = ev.currentTarget.closest(".tags-wrap");
          const tags = wrap?.querySelector(".item-tags");
          const icon = ev.currentTarget.querySelector("i");
          if (!wrap || !tags) return;

          const wasExpanded = wrap.classList.contains("expanded");
          const startHeight = tags.clientHeight;

          // Target height: full scroll height if expanding, clamped if collapsing
          const targetHeight = wasExpanded
            ? COLLAPSED_MAX
            : Math.max(tags.scrollHeight, startHeight);

          // Prepare animation: set current height, then animate to target
          tags.style.maxHeight = `${startHeight}px`;
          // force reflow
          // eslint-disable-next-line no-unused-expressions
          tags.offsetHeight;
          tags.style.maxHeight = `${targetHeight}px`;

          wrap.classList.add("animating");
          wrap.classList.toggle("expanded", !wasExpanded);
          if (icon) icon.classList.toggle("rotated", !wasExpanded);

          const onEnd = (e) => {
            if (e && e.target !== tags) return;

            tags.removeEventListener("transitionend", onEnd);
            wrap.classList.remove("animating");

            // When collapsed, keep the clamp; when expanded, let it auto-size
            if (wrap.classList.contains("expanded")) {
              tags.style.maxHeight = "";
            } else if (tags.scrollHeight > COLLAPSED_MAX + 1) {
              tags.style.maxHeight = `${COLLAPSED_MAX}px`;
            } else {
              tags.style.maxHeight = "";
            }

            updateOne(wrap);
          };

          tags.addEventListener("transitionend", onEnd, { once: true });

          // Failsafe in case transitionend doesn’t fire
          setTimeout(onEnd, TRANSITION_MS + 100);
        });

      // Expose refresh for other parts of the sheet if you want to call it after edits
      this._mgNpcRefreshTags = refreshAll;
    }
    
    const isOwner =
      this.actor?.testUserPermission?.(game.user, "OWNER") ||
      this.actor?.isOwner ||
      game.user.isGM;

    if (!isOwner) return;

    // Settings: "Image Settings" (FilePicker) — same behavior as character sheet
    html.off("click.mgPickAvatarNpc").on("click.mgPickAvatarNpc", ".mg-change-profile-image", async (ev) => {
      ev.preventDefault();

      const current =
        this.actor.img ||
        this.actor.prototypeToken?.texture?.src ||
        "icons/svg/mystery-man.svg";

      const picker = new FilePicker({
        type: "image",
        activeSource: "data",
        current,
        callback: async (path) => {
          const updates = { img: path };

          // If the prototype token was mirroring, mirror the new path too
          try {
            const proto = this.actor.prototypeToken;
            const was = proto?.texture?.src;
            if (proto && (was === current || !was)) {
              updates["prototypeToken.texture.src"] = path;
            }
          } catch (_) {}

          await this.actor.update(updates);

          // Soft refresh the visible portrait on the sheet
          const routed = foundry.utils.getRoute(path);
          this.element.find("img.mg-profile-img").attr("src", routed);

          ui.notifications?.info("Profile image updated.");
        }
      });

      picker.render(true);
    });

    // Settings: "Frame Chat Image"
    html.find(".mg-crop-chat")
      .off("click.mgChatCropNpc")
      .on("click.mgChatCropNpc", (ev) => {
        ev.preventDefault();
        this._mgOpenChatCropper(html);
      });

    // ----------------------------
    // Strain dots (same behavior as character sheet)
    // ----------------------------
    html.find(".strain-dot").on("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      // Kill any active input focus (prevents weirdness on mobile)
      if (document.activeElement) {
        try { document.activeElement.blur(); } catch (_) {}
      }

      const el = event.currentTarget;
      const strainType   = el.dataset.type;     // "mortal" or "soul"
      const clickedValue = Number(el.dataset.value);

      const actor = this.actor;
      if (!actor) return;

      const currentValue = foundry.utils.getProperty(actor.system.strain, strainType) ?? 0;
      const newValue = Math.max(
        0,
        clickedValue === currentValue ? clickedValue - 1 : clickedValue
      );

      // Update doc without forcing a full sheet rerender
      await actor.update({ [`system.strain.${strainType}`]: newValue });

      // Manually reflect the change in the open sheet
      const $track = html.find(`.strain-track[data-strain="${strainType}"]`);
      $track.find(".strain-dot").each((_, node) => {
        const v = Number(node.dataset.value);
        node.classList.toggle("filled", v <= newValue);
      });
    });


    // ----------------------------
    // Capacity +/- buttons (cap-tick)
    // Updates system.strain.<type> capacity + sets manualOverride flag
    // ----------------------------
    html.find(".cap-tick").on("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const btn  = event.currentTarget;
      const wrap = btn.closest(".capacity-controls");
      const type = wrap?.dataset?.type; // "mortal" or "soul"
      if (!type) return;

      const dir = Number(btn.dataset.dir) || 0; // -1 or +1
      if (!dir) return;

      const key = `${type} capacity`; // "mortal capacity" or "soul capacity"
      const current = Number(foundry.utils.getProperty(this.actor.system, `strain.${key}`)) || 0;
      const next = Math.max(0, current + dir);

      await this.actor.update({
        [`system.strain.${key}`]: next,
        [`system.strain.manualOverride.${key}`]: true
      }, { render: false });

      // Update the visible number immediately
      html.find(`.capacity-value[data-type="${type}"]`).text(String(next));
    });


    // ----------------------------
    // Attribute: right-click edit base (same behavior as PC sheet)
    // ----------------------------
    html.find(".attribute-modifier").on("contextmenu", async (event) => {
      event.preventDefault();

      const el = event.currentTarget;
      const key = el.dataset.key;

      const current = Number(el.getAttribute("data-base")) || 0;

      const val = await Dialog.prompt({
        title: `Edit ${key}`,
        content: `<label>Base ${key}: <input type="number" value="${current}" name="value" /></label>`,
        label: "Save",
        callback: (dlgHtml) => dlgHtml.find('input[name="value"]').val(),
        rejectClose: false
      }).catch(() => null);

      if (val === null) return;

      const next = Number(val);
      if (!Number.isFinite(next)) {
        ui.notifications.warn("Please enter a valid number.");
        return;
      }

      await this.actor.update({ [`system.baseAttributes.${key}`]: next }, { render: false });

      // reflect immediately without re-render
      el.setAttribute("data-base", String(next));
      el.textContent = next >= 0 ? `+${next}` : `${next}`;
    });

    // ----------------------------
    // Attribute: click roll (same dice logic as PC sheet)
    // pool = 2 + abs(mod), keep high if mod>=0 else keep low
    // ----------------------------
    html.find(".attribute-modifier").on("click", async (event) => {
      const attrKey = event.currentTarget.dataset.key;
      const mod = this.actor.system.attributes?.[attrKey] ?? 0;

      const pool = 2 + Math.abs(mod);
      const rollType = mod >= 0 ? "kh2" : "kl2";
      const formula = `${pool}d6${rollType}`;

      await evaluateRoll({
        formula,
        label: `NPC Attribute Roll: ${attrKey.toUpperCase()}`,
        actor: this.actor
      });
    });

    // ----------------------------
    // “Opposition” quick-post (optional but slick)
    // ----------------------------
    html.find(".npc-post-opp").on("click", async (event) => {
      event.preventDefault();
      const key = event.currentTarget.dataset.key;
      const mod = Number(this.actor.system.attributes?.[key] ?? 0);

      // Your convention: NPC +3 means player gets -3
      const opposed = -mod;
      const sign = opposed >= 0 ? `+${opposed}` : `${opposed}`;

      const content = `
        <div class="mg-chat-card mg-npc-opp">
          <label>Opposition</label>
          <p><strong>${key.toUpperCase()}</strong>: ${sign} to the player's roll</p>
        </div>
      `;

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content,
        type: CONST.CHAT_MESSAGE_TYPES.OTHER
      });
    });

    // ----------------------------
    // NPC Move controls
    // ----------------------------

    // Create NPC Move
    html.find(".npc-move-create").off("click.mgNpcMoveCreate").on("click.mgNpcMoveCreate", async (ev) => {
      ev.preventDefault();

      await this.actor.createEmbeddedDocuments("Item", [{
        name: "New NPC Move",
        type: "move",
        system: {
          description: "",
          npcMove: true,
          npcSignature: false
        }
      }]);

      this.render(false);
    });

    // Create Signature Perk (Multiple on NPCs)
    html.find(".npc-signature-create").off("click.mgNpcSigCreate").on("click.mgNpcSigCreate", async (ev) => {
      ev.preventDefault();

      await this.actor.createEmbeddedDocuments("Item", [{
        name: "Signature Perk",
        type: "move",
        system: {
          description: "",
          npcMove: false,
          npcSignature: true,
          isSignature: true,
          learned: false
        }
      }]);

    this.render(false);
  });

  // Edit (opens item sheet, gives you rich text for free)
  html.find(".item-edit").off("click.mgNpcItemEdit").on("click.mgNpcItemEdit", (ev) => {
    ev.preventDefault();
    const li = ev.currentTarget.closest("[data-item-id]");
    const item = this.actor.items.get(li?.dataset?.itemId);
    item?.sheet?.render(true);
  });

  // Delete
  html.find(".item-delete").off("click.mgNpcItemDelete").on("click.mgNpcItemDelete", async (ev) => {
    ev.preventDefault();
    const li = ev.currentTarget.closest("[data-item-id]");
    const itemId = li?.dataset?.itemId;
    if (!itemId) return;

    await this.actor.deleteEmbeddedDocuments("Item", [itemId]);
    this.render(false);
  });


  // NPC Aura Toggle
  html.find(".mg-aura-toggle")
    .off("click.mgAuraToggle")
    .on("click.mgAuraToggle", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const btn = ev.currentTarget;
      const next = !Boolean(this.actor.system?.aura?.enabled);

      await this.actor.update({ "system.aura.enabled": next }, { render: false });

      if (next) {
        await game.settings.set("midnight-gambit", "activeAuraActorId", this.actor.id);
      } else {
        const current = game.settings.get("midnight-gambit", "activeAuraActorId");
        if (current === this.actor.id) {
          await game.settings.set("midnight-gambit", "activeAuraActorId", "");
        }
      }

      btn.classList.toggle("is-active", next);
    });

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

    // Drag to pan
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

  _mgOpenChatCropper(html) {
    const $root = html instanceof jQuery ? html : $(html);

    // Use current actor img as the chat portrait source
    const src = this.actor?.img;
    if (!src) return;

    const flags = this.actor.getFlag("midnight-gambit", "crops") || {};
    const chat = flags.chat || {};
    const css = chat.css || {};

    let x = Number.isFinite(css.x) ? css.x : 50;
    let y = Number.isFinite(css.y) ? css.y : 50;
    let s = Number.isFinite(css.scale) ? css.scale : 1;

    const $ui = $(`
      <div class="mg-crop-editor">
        <div class="mg-crop-panel">
          <div class="mg-row" style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
            <div><strong>Frame Chat Image</strong></div>
            <div class="hint">Drag to pan • Mouse wheel to zoom</div>
          </div>
          <div class="mg-crop-stage">
            <img src="${src}">
          </div>
          <div class="mg-actions">
            <button class="ghost mg-cancel">Cancel</button>
            <button class="primary mg-save">Save</button>
          </div>
        </div>
      </div>
    `);

    const stage = $ui.find(".mg-crop-stage")[0];
    const imgEl = $ui.find("img")[0];

    const apply = () => {
      // Make preview behave like a “cropped avatar”
      imgEl.style.transformOrigin = "center center";
      imgEl.style.transform = `translate(-50%, -50%) scale(${s})`;
      imgEl.style.position = "absolute";
      imgEl.style.left = `${x}%`;
      imgEl.style.top = `${y}%`;
    };

    apply();

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    stage.style.position = "relative";
    stage.style.overflow = "hidden";

    stage.addEventListener("pointerdown", (ev) => {
      dragging = true;
      lastX = ev.clientX;
      lastY = ev.clientY;
    });

    stage.addEventListener("pointermove", (ev) => {
      if (!dragging) return;

      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;

      x -= (dx / stage.clientWidth) * 100;
      y -= (dy / stage.clientHeight) * 100;

      apply();
    });

    stage.addEventListener("pointerup", () => dragging = false);
    stage.addEventListener("pointerleave", () => dragging = false);

    stage.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      s = Math.max(0.5, Math.min(3, s - Math.sign(ev.deltaY) * 0.05));
      apply();
    }, { passive: false });

    $ui.on("click", ".mg-cancel", () => $ui.remove());

    $ui.on("click", ".mg-save", async () => {
      const crops = (await this.actor.getFlag("midnight-gambit", "crops")) || {};
      crops.chat = crops.chat || {};
      crops.chat.css = { x, y, scale: s };

      await this.actor.setFlag("midnight-gambit", "crops", crops);

      ui.notifications?.info("Chat image framing saved.");
      $ui.remove();
    });

    document.body.appendChild($ui[0]);
  }

  async _onDrop(event) {
    // Robust: find dropzone even when Foundry’s drop target is weird
    const findDropzone = (ev) => {
      // 1) composedPath (best when available)
      const path = ev?.composedPath?.() ?? [];
      for (const node of path) {
        if (node?.dataset?.dropzone) return node.dataset.dropzone;
        if (node?.closest) {
          const z = node.closest("[data-dropzone]");
          if (z?.dataset?.dropzone) return z.dataset.dropzone;
        }
      }

      // 2) elementFromPoint fallback (the "what did I really drop on?" answer)
      if (typeof document !== "undefined" && Number.isFinite(ev?.clientX) && Number.isFinite(ev?.clientY)) {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const z = el?.closest?.("[data-dropzone]");
        if (z?.dataset?.dropzone) return z.dataset.dropzone;
      }

      // 3) last-ditch fallback
      return ev?.target?.closest?.("[data-dropzone]")?.dataset?.dropzone ?? null;
    };

    const dropzone = findDropzone(event);
    console.log("MG NPC DROPZONE:", dropzone, "target:", event.target);

    // Let Foundry handle non-item drops normally
    let data;
    try {
      data = TextEditor.getDragEventData(event);
    } catch (_) {
      return super._onDrop(event);
    }
    if (data?.type !== "Item") return super._onDrop(event);

    // Resolve dropped item (compendium/world/sidebar)
    let src;
    try {
      src = data.uuid ? await fromUuid(data.uuid) : null;
    } catch (_) {
      src = null;
    }
    if (!src || src.documentName !== "Item") return super._onDrop(event);

    const dropped = src.toObject();
    if (dropped.type !== "move") return super._onDrop(event);

    // De-dupe by sourceId or name
    const existing = this.actor.items.find(i =>
      i.type === "move" && (
        (i.flags?.core?.sourceId && i.flags.core.sourceId === dropped.flags?.core?.sourceId) ||
        (i.name?.toLowerCase?.() === dropped.name?.toLowerCase?.())
      )
    );
    if (existing) {
      ui.notifications?.warn(`${dropped.name} is already on ${this.actor.name}.`);
      return false;
    }

    // Apply flags based on dropzone
    dropped.system = dropped.system || {};

    if (dropzone === "signature") {
      dropped.system.npcSignature = true;
      dropped.system.npcMove = false;        // IMPORTANT: do not treat as basic move
      dropped.system.isSignature = true;     // helpful for shared rendering/posts
      dropped.system.learned = false;

      await this.actor.createEmbeddedDocuments("Item", [dropped]);
      ui.notifications?.info(`NPC Signature Perk added: ${dropped.name}`);
      this.render(false);
      return false;
    }

    if (dropzone === "moves") {
      dropped.system.npcMove = true;
      dropped.system.npcSignature = false;
      dropped.system.isSignature = false;
      dropped.system.learned = false;

      await this.actor.createEmbeddedDocuments("Item", [dropped]);
      ui.notifications?.info(`NPC Move added: ${dropped.name}`);
      this.render(false);
      return false;
    }

    // If dropped somewhere else, let Foundry do its normal thing
    return super._onDrop(event);
  }

  async close(options = {}) {
    // Clean up our hook to avoid leaks when closing sheets
    if (this._mgNpcUpdateItemHookId) {
      Hooks.off("updateItem", this._mgNpcUpdateItemHookId);
      this._mgNpcUpdateItemHookId = null;
    }
    return super.close(options);
  }  

  async _updateObject(event, formData) {
    // Nothing fancy: Foundry will update system.npc.signatureName / signatureText directly from input names
    return super._updateObject(event, formData);
  }
}
