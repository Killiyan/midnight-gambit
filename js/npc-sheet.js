// npc-sheet.js
import { evaluateRoll } from "./roll-utils.js";

const MG_ACTOR_GUISE_IMAGE = "systems/midnight-gambit/assets/images/guise.jpg";
const MG_ACTOR_DEFAULT_IMAGE = "icons/svg/mystery-man.svg";

function mgGetActorSheetImage(actor) {
  const img = String(actor?.img ?? "").trim();
  if (!img || img === MG_ACTOR_DEFAULT_IMAGE || img.endsWith("/mystery-man.svg")) return MG_ACTOR_GUISE_IMAGE;
  return img;
}

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
    context.actorDisplayImg = mgGetActorSheetImage(this.actor);

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
    this._mgBindNpcSheetWideDrop(html);

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
    // Post Moves / Signature Perk to chat
    // Posts NPC move/signature descriptions to chat.
    // ----------------------------------------------------
    const enrichForChat = async (text) => {
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

    const escapeChatHtml = (s) => String(s ?? "").replace(/[&<>"'`=\/]/g, c =>
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

    const moveTagIdsFromCard = (sourceEl, item) => {
      const itemTags = Array.isArray(item?.system?.tags) ? item.system.tags : [];
      const card = sourceEl.closest(".move-block, .signature-perk");
      const domTags = Array.from(card?.querySelectorAll?.(".item-tag[data-tag-id]") ?? [])
        .map(el => el.dataset.tagId)
        .filter(Boolean);
      return Array.from(new Set([...itemTags, ...domTags].map(String)));
    };

    const renderMoveChatTags = (tagIds, item) => {
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
          return `<span class="item-tag tag" data-tag-id="${escapeChatHtml(tagId)}" title="${escapeChatHtml(desc)}">${escapeChatHtml(label)}</span>`;
        })
        .join(" ");

      return tagHtml ? `<strong>Tags:</strong><div class="chat-tags">${tagHtml}</div>` : "";
    };

    html.find(".post-move").off("click.mgNpcPostMove").on("click.mgNpcPostMove", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const li = event.currentTarget.closest("[data-item-id]");
      const item = this.actor.items.get(li?.dataset?.itemId);

      const name = item?.name || event.currentTarget.dataset.moveName || "Unknown Move";
      const description = item?.system?.description ?? event.currentTarget.dataset.moveDescription ?? "";

      const descHtml = await enrichForChat(description);
      const tagsHtml = renderMoveChatTags(moveTagIdsFromCard(event.currentTarget, item), item);

      const chatContent = `
        <div class="chat-move">
          <h2><i class="fa-solid fa-hand-fist"></i> ${escapeChatHtml(name)}</h2>
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

    html.find(".signature-perk h3").off("click.mgNpcPostSignature").on("click.mgNpcPostSignature", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const source = event.currentTarget.querySelector(".post-signature");
      if (!source) return;

      const li = event.currentTarget.closest("[data-item-id]");
      const item = this.actor.items.get(li?.dataset?.itemId);

      const name = item?.name || source.dataset.perkName || "Signature";
      const description = item?.system?.description ?? source.dataset.perkDescription ?? "";

      const descHtml = await enrichForChat(description);
      const tagsHtml = renderMoveChatTags(moveTagIdsFromCard(source, item), item);

      const chatContent = `
        <div class="chat-move">
          <h2><i class="fa-solid fa-diamond"></i> Signature Perk: ${escapeChatHtml(name)}</h2>
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
    html.find(".mg-open-image-options").off("click.mgNpcImageOptions").on("click.mgNpcImageOptions", (ev) => {
      ev.preventDefault();
      this._mgOpenImageOptions(html);
    });

    html.find(".mg-crop-profile").off("click.mgCrop").on("click.mgCrop", (ev) => {
      ev.preventDefault();
      this._mgOpenImageOptions(html, "profile");
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

    // Settings: Change Profile Image
    html.off("click.mgPickAvatarNpc").on("click.mgPickAvatarNpc", ".mg-change-profile-image", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      if (!this.isEditable && !game.user.isGM) {
        ui.notifications?.warn("You do not have permission to edit this NPC.");
        return;
      }

      const current = mgGetActorSheetImage(this.actor);

      const safePreviewSrc = (path) => {
        const p = String(path ?? "").trim();
        if (/^(https?:|data:|blob:)/i.test(p)) return p;
        return foundry.utils.getRoute(p);
      };

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

          await this.actor.update(updates, { render: false });

          // Live preview without mangling external URLs
          this.element.find("img.mg-profile-img").attr("src", safePreviewSrc(cleanPath));

          ui.notifications?.info("NPC profile image updated.");
        } catch (err) {
          console.error("MG | Failed to update NPC profile image:", err);
          ui.notifications?.error("Failed to update NPC profile image.");
        }
      };

      const canBrowse = game.user?.can?.("FILES_BROWSE") ?? game.user?.isTrusted ?? game.user.isGM;

      if (canBrowse) {
        const picker = new FilePicker({
          type: "image",
          current,
          callback: applyImg
        });

        picker.render(true);
        return;
      }

      new Dialog({
        title: "Set NPC Profile Image",
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

    // Settings: "Frame Chat Image"
    html.find(".mg-crop-chat")
      .off("click.mgChatCropNpc")
      .on("click.mgChatCropNpc", (ev) => {
        ev.preventDefault();
        this._mgOpenImageOptions(html, "chat");
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
    // Matches character sheet behavior:
    // - Minus spends capacity first.
    // - If capacity is already 0, minus adds strain track damage.
    // - Plus restores capacity.
    // ----------------------------
    html.find(".cap-tick").on("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const btn = event.currentTarget;
      const wrap = btn.closest(".capacity-controls");
      const type = wrap?.dataset?.type; // "mortal" or "soul"
      if (!type) return;

      const dir = Number(btn.dataset.dir) || 0; // -1 or +1
      if (!dir) return;

      const actor = this.actor;
      if (!actor) return;

      const capKey = `${type} capacity`; // "mortal capacity" or "soul capacity"

      const currentCap = Number(foundry.utils.getProperty(actor.system, `strain.${capKey}`)) || 0;
      const currentTrack = Number(foundry.utils.getProperty(actor.system, `strain.${type}`)) || 0;

      const updates = {
        [`system.strain.manualOverride.${capKey}`]: true
      };

      // DAMAGE: reduce capacity first. If already 0, fill the strain track.
      if (dir < 0) {
        if (currentCap > 0) {
          updates[`system.strain.${capKey}`] = Math.max(0, currentCap - 1);
        } else {
          const dotCount = html.find(`.strain-track[data-strain="${type}"] .strain-dot`).length;
          const trackMax = Math.max(0, dotCount || 5);
          updates[`system.strain.${type}`] = Math.min(trackMax, currentTrack + 1);
        }
      }

      // HEAL/CORRECTION: restore capacity by 1.
      if (dir > 0) {
        updates[`system.strain.${capKey}`] = Math.max(0, currentCap + 1);
      }

      await actor.update(updates, { render: false });

      const nextCap = updates[`system.strain.${capKey}`] ?? currentCap;
      const nextTrack = updates[`system.strain.${type}`] ?? currentTrack;

      // Update the visible capacity number immediately
      html.find(`.capacity-value[data-type="${type}"]`).text(String(nextCap));

      // Update the strain dots immediately
      const $track = html.find(`.strain-track[data-strain="${type}"]`);
      $track.find(".strain-dot").each((_, node) => {
        const v = Number(node.dataset.value);
        node.classList.toggle("filled", v <= nextTrack);
      });
    });

    // ----------------------------
    // Capacity: right-click exact value
    // ----------------------------
    html.find(".capacity-controls, .capacity-value, .label-box").on("contextmenu", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const actor = this.actor;
      if (!actor) return;

      const clicked = event.currentTarget;

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

      const currentCap = Number(
        foundry.utils.getProperty(actor.system, `strain.${capKey}`)
      ) || 0;

      const currentMax = Number(
        foundry.utils.getProperty(actor.system, `strain.maxCapacity.${type}`)
      ) || currentCap;

      const label = type === "mortal" ? "Mortal Capacity" : "Soul Capacity";

      const result = await Dialog.wait({
        title: `Set ${label}`,
        content: `
          <form class="mg-form">
            <div class="form-group">
              <label>${label}</label>
              <input type="number" name="value" value="${currentCap}" min="0" step="1" />
            </div>

            <p class="notes">
              Current max: <strong>${currentMax}</strong>. Entering a higher number will add temporary capacity.
            </p>
          </form>
        `,
        buttons: {
          ok: {
            label: "Save",
            callback: (dlgHtml) => {
              return dlgHtml.find('input[name="value"]').val();
            }
          },
          cancel: {
            label: "Cancel",
            callback: () => null
          }
        },
        default: "ok"
      });

      if (result === null) return;

      const nextCap = Math.max(0, Math.floor(Number(result)));

      if (!Number.isFinite(nextCap)) {
        ui.notifications.warn("Please enter a valid capacity number.");
        return;
      }

      const updates = {
        [`system.strain.${capKey}`]: nextCap,
        [`system.strain.manualOverride.${capKey}`]: true
      };

      // If the new capacity is above the current max, store the difference as tempBonus.
      // This lets bosses go to 25+ capacity without later logic shaving them back down.
      if (nextCap > currentMax) {
        const currentTemp = Number(
          foundry.utils.getProperty(actor.system, `strain.tempBonus.${type}`)
        ) || 0;

        const extraNeeded = nextCap - currentMax;

        updates[`system.strain.tempBonus.${type}`] = currentTemp + extraNeeded;
        updates[`system.strain.maxCapacity.${type}`] = nextCap;
      }

      await actor.update(updates, { render: false });

      // Patch the visible number immediately
      html.find(`.capacity-value[data-type="${type}"]`).text(String(nextCap));

      const maxEl = html[0]?.querySelector(`.capacity-max[data-type='${type}']`);
      if (maxEl) maxEl.textContent = String(Math.max(nextCap, currentMax));

      this.render(false);
    });    

    // ----------------------------
    // Attribute: right-click edit base (same behavior as PC sheet)
    // ----------------------------
    html.find(".attribute-modifier").on("contextmenu", async (event) => {
      event.preventDefault();

      const el = event.currentTarget;
      const key = el.dataset.key;

      const current = this._mgClampStatValue(el.getAttribute("data-base"));
      const val = await this._mgOpenStatPicker({
        title: `Edit ${key}`,
        current
      });

      if (val === null) return;

      const next = this._mgClampStatValue(val);

      await this.actor.update({ [`system.baseAttributes.${key}`]: next }, { render: false });

      // reflect immediately without re-render
      el.setAttribute("data-base", String(next));
      el.textContent = this._mgFormatSigned(next);
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

  // Delete NPC Move / Signature Perk
  html.find(".item-delete").off("click.mgNpcItemDelete").on("click.mgNpcItemDelete", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    const li = ev.currentTarget.closest("[data-item-id]");
    const itemId = li?.dataset?.itemId;
    if (!itemId) return;

    const item = this.actor.items.get(itemId);
    if (!item) return;

    const confirmed = await Dialog.wait({
      title: `Delete ${item.name}?`,
      content: `
        <h2>Delete ${item.name}?</h2>
        <p>Are you sure you want to permanently delete <strong>${item.name}</strong>?</p>
      `,
      buttons: {
        yes: { label: "Delete", callback: () => true },
        no:  { label: "Cancel", callback: () => false }
      },
      default: "no"
    });

    if (!confirmed) return;

    await item.delete();
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
            aria-pressed="${v === current ? "true" : "false"}"
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
            label: "Cancel",
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

  _mgGetImageCropPlacements(html) {
    const $root = html instanceof jQuery ? html : $(html);
    const sheetSrc = $root.find("img.mg-profile-img").first().attr("src") || this.actor?.img;
    const actorSrc = this.actor?.img || sheetSrc;

    return [
      {
        key: "profile",
        label: "Character Sheet",
        icon: "fa-solid fa-user",
        title: "Frame NPC Sheet",
        hint: "Drag to pan - Mouse wheel to zoom - Esc to cancel",
        description: "This image is placed at the top of your NPC sheet.",
        src: sheetSrc,
        className: "npc",
        defaultsFrom: []
      },
      {
        key: "chat",
        label: "Chat Avatar",
        icon: "fa-solid fa-comment",
        title: "Frame Chat Avatar",
        hint: "Drag to pan - Mouse wheel to zoom - Esc to cancel",
        description: "This image is placed in chat every time this NPC rolls.",
        src: actorSrc,
        className: "chat-crop",
        defaultsFrom: []
      },
      {
        key: "actorSidebar",
        label: "Actor List",
        icon: "fa-solid fa-address-book",
        title: "Frame Actor List Portrait",
        hint: "Drag to pan - Mouse wheel to zoom - Esc to cancel",
        description: "This image is placed in the Actor List Directory.",
        src: actorSrc,
        className: "actor-sidebar-crop",
        defaultsFrom: ["profile"],
        saveSize: true,
        fitAxis: "width"
      }
    ];
  }

  _mgOpenImageOptions(html, startKey = "profile") {
    const placements = this._mgGetImageCropPlacements(html).filter(p => p.src);
    if (!placements.length) return;

    const byKey = Object.fromEntries(placements.map(p => [p.key, p]));
    let active = byKey[startKey] ? startKey : placements[0].key;
    let dragging = false;
    let last = { cx: 0, cy: 0 };
    let values = {};

    const esc = value => {
      if (window.Handlebars?.escapeExpression) return Handlebars.escapeExpression(String(value ?? ""));
      const div = document.createElement("div");
      div.textContent = String(value ?? "");
      return div.innerHTML;
    };

    const getInitialValues = placement => {
      const crops = this.actor.getFlag("midnight-gambit", "crops") || {};
      let saved = crops[placement.key]?.css;
      for (const fallback of placement.defaultsFrom || []) {
        if (saved) break;
        saved = crops[fallback]?.css;
      }
      saved ||= {};
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
                <span>${esc(p.label)}</span>
              </button>
            `).join("")}
          </nav>
          <p class="mg-crop-description" data-mg-crop-description></p>
          <div class="mg-crop-stage mg-crop-stage-single">
            <div class="mg-crop-img-plane">
              <img alt="preview" data-mg-crop-img="single">
            </div>
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

    const apply = () => {
      const current = values[active];
      if (!current || !imgEl) return;
      imgEl.style.setProperty("--x", String(current.x));
      imgEl.style.setProperty("--y", String(current.y));
      imgEl.style.setProperty("--s", String(current.scale));
    };

    const applyPlacementSize = (img, placement, current) => {
      if (!img) return;
      if (placement.fitAxis === "width") {
        img.style.width = `${Number.isFinite(current.width) ? current.width : 100}%`;
        img.style.height = "auto";
      } else if (placement.fitAxis === "height") {
        img.style.width = "auto";
        img.style.height = `${Number.isFinite(current.height) ? current.height : 100}%`;
      } else {
        img.style.width = Number.isFinite(current.width) ? `${current.width}%` : "";
        img.style.height = Number.isFinite(current.height) ? `${current.height}%` : "";
      }
    };

    const renderPlacement = key => {
      const placement = byKey[key];
      if (!placement) return;
      active = key;
      values[active] ||= getInitialValues(placement);

      $ui.removeClass(placements.map(p => p.className).filter(Boolean).join(" "));
      if (placement.className) $ui.addClass(placement.className);
      $ui.find(".mg-crop-title").text(placement.title);
      $ui.find(".mg-crop-hint").text(placement.hint);
      $ui.find("[data-mg-crop-description]").text(placement.description || "");
      $ui.find("[data-mg-crop-tab]").toggleClass("is-active", false).attr("aria-selected", "false");
      $ui.find(`[data-mg-crop-tab="${key}"]`).toggleClass("is-active", true).attr("aria-selected", "true");

      imgEl.src = placement.src;
      applyPlacementSize(imgEl, placement, values[active]);
      apply();
    };

    $ui.on("pointerdown", ".mg-crop-stage", ev => {
      dragging = true;
      const oe = ev.originalEvent || ev;
      last = { cx: oe.clientX, cy: oe.clientY };
      ev.currentTarget.setPointerCapture?.(oe.pointerId);
    });

    $ui.on("pointermove", ".mg-crop-stage", ev => {
      if (!dragging) return;
      const current = values[active];
      if (!current) return;
      const oe = ev.originalEvent || ev;
      const dx = oe.clientX - last.cx;
      const dy = oe.clientY - last.cy;
      last = { cx: oe.clientX, cy: oe.clientY };

      const pan = active === "chat" ? 0.45 : 1;
      current.x -= ((dx / Math.max(stage.clientWidth, 1)) * 100) * pan;
      current.y -= ((dy / Math.max(stage.clientHeight, 1)) * 100) * pan;
      apply();
    });

    $ui.on("pointerup pointercancel", ".mg-crop-stage", () => {
      dragging = false;
    });

    $ui.on("wheel", ".mg-crop-stage", ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const oe = ev.originalEvent || ev;
      oe.preventDefault?.();
      const current = values[active];
      if (!current) return;
      const step = ev.shiftKey ? 0.15 : 0.05;
      current.scale = Math.max(0.05, current.scale - (Math.sign(oe.deltaY || 0) * step));
      apply();
    });

    $ui.on("click", "[data-mg-crop-tab]", ev => {
      ev.preventDefault();
      renderPlacement(ev.currentTarget.dataset.mgCropTab);
    });

    $ui.on("click", ".mg-reset", ev => {
      ev.preventDefault();
      const placement = byKey[active];
      values[active] = {
        x: 50,
        y: 50,
        scale: 1,
        width: placement?.fitAxis === "width" ? 100 : null,
        height: placement?.fitAxis === "height" ? 100 : null
      };
      applyPlacementSize(imgEl, placement, values[active]);
      apply();
    });

    $ui.on("click", ".mg-cancel", () => $ui.remove());
    $ui.on("click", ".mg-save", async () => {
      try {
        const placement = byKey[active];
        const current = values[active];
        const ns = "midnight-gambit";
        const crops = (await this.actor.getFlag(ns, "crops")) || {};
        crops[active] = crops[active] || {};
        const css = { x: current.x, y: current.y, scale: current.scale };
        if (placement.saveSize) {
          if (placement.fitAxis === "width") {
            css.width = (imgEl.offsetWidth / Math.max(stage.clientWidth, 1)) * 100;
          } else if (placement.fitAxis === "height") {
            css.height = (imgEl.offsetHeight / Math.max(stage.clientHeight, 1)) * 100;
          }
        }
        crops[active].css = css;
        await this.actor.setFlag(ns, "crops", crops);

        if (active === "profile") this._mgInitProfileCrop(html);
        if (active === "chat") ui.chat?.render?.(true);
        if (active === "actorSidebar") {
          globalThis.mgRefreshLeftSidebarContent?.();
          globalThis.MGRefreshLeftSidebarContent?.();
        }

        ui.notifications?.info(`${placement.title} saved.`);
      } catch (err) {
        console.error("MG | Save NPC image crop failed:", err);
        ui.notifications?.error("Failed to save NPC image framing. See console.");
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
      <div class="mg-crop-editor npc" role="dialog" aria-modal="true">
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

  _mgEnsureNpcSheetDropCSS() {
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

  _mgNpcAllowedDropTypes() {
    return new Set(["move"]);
  }

  _mgNpcBlockedDropMessage({ documentName, type, tier } = {}) {
    if (documentName === "Actor") return "Actors cannot be dropped onto NPC sheets.";
    if (documentName === "Item" && type !== "move") return "NPC sheets only accept Moves.";
    return null;
  }

  async _mgResolveNpcDropDocumentFromElement(event) {
    const el = event.target?.closest?.(
      "[data-uuid], [data-document-uuid], [data-document-id], [data-entry-id], [data-item-id], [data-mg-item-id], [data-mg-actor-id], .directory-item"
    );
    if (!el) return null;

    const uuid = el.dataset.uuid || el.dataset.documentUuid || el.dataset.entryUuid || null;
    if (uuid) {
      const doc = await fromUuid(uuid).catch(() => null);
      if (doc) return doc;
    }

    const id =
      el.dataset.documentId ||
      el.dataset.entryId ||
      el.dataset.itemId ||
      el.dataset.mgItemId ||
      el.dataset.mgActorId ||
      el.dataset.id ||
      null;

    if (id) {
      const doc = game.items?.get(id) || game.actors?.get(id) || null;
      if (doc) return doc;
    }

    const pack = el.dataset.pack || el.closest?.("[data-pack]")?.dataset?.pack || null;
    if (pack && id) return fromUuid(`Compendium.${pack}.${id}`).catch(() => null);

    return null;
  }

  _mgNpcStatusForDocument(doc) {
    if (!doc) return { known: false, allowed: false, message: null };

    if (doc.documentName === "Actor") {
      return {
        known: true,
        allowed: false,
        message: this._mgNpcBlockedDropMessage({ documentName: "Actor" }),
        type: doc.type
      };
    }

    if (doc.documentName !== "Item") {
      return {
        known: true,
        allowed: false,
        message: `${doc.documentName} cannot be added to an NPC sheet.`
      };
    }

    const itemType = doc.type;
    const tier = String(doc.system?.tier ?? "").toLowerCase();
    const blockedMessage = this._mgNpcBlockedDropMessage({
      documentName: "Item",
      type: itemType,
      tier
    });

    if (blockedMessage) {
      return { known: true, allowed: false, message: blockedMessage, type: itemType, tier };
    }

    if (!this._mgNpcAllowedDropTypes().has(itemType)) {
      return {
        known: true,
        allowed: false,
        message: `${itemType || "That item"} cannot be added to an NPC sheet.`,
        type: itemType,
        tier
      };
    }

    return { known: true, allowed: true, message: null, type: itemType, tier };
  }

  async _mgGetNpcDropStatus(event) {
    let data = null;

    try {
      data = TextEditor.getDragEventData(event);
    } catch (_err) {
      return { known: false, allowed: false, message: null };
    }

    if (!data?.type) return { known: false, allowed: false, message: null };

    if (data.type === "Actor") {
      return {
        known: true,
        allowed: false,
        message: this._mgNpcBlockedDropMessage({ documentName: "Actor" })
      };
    }

    if (data.type !== "Item") {
      return {
        known: true,
        allowed: false,
        message: `${data.type} cannot be added to an NPC sheet.`
      };
    }

    const doc = data.uuid ? await fromUuid(data.uuid).catch(() => null) : null;
    if (doc?.documentName === "Item") return this._mgNpcStatusForDocument(doc);

    const raw = data.data || data;
    const itemType = raw?.type ?? raw?.system?.type ?? null;
    const tier = String(raw?.system?.tier ?? raw?.tier ?? "").toLowerCase();
    const blockedMessage = this._mgNpcBlockedDropMessage({
      documentName: "Item",
      type: itemType,
      tier
    });

    if (blockedMessage) {
      return { known: true, allowed: false, message: blockedMessage, type: itemType, tier };
    }

    if (!this._mgNpcAllowedDropTypes().has(itemType)) {
      return {
        known: true,
        allowed: false,
        message: `${itemType || "That item"} cannot be added to an NPC sheet.`,
        type: itemType,
        tier
      };
    }

    return { known: true, allowed: true, message: null, type: itemType, tier };
  }

  async _mgGetNpcDragSourceStatus(event) {
    const doc = await this._mgResolveNpcDropDocumentFromElement(event);
    return this._mgNpcStatusForDocument(doc);
  }

  _mgIsNpcInternalSheetDrag(event) {
    const types = Array.from(event?.dataTransfer?.types ?? []);
    if (types.includes("application/x-midnightgambit-gambit")) return true;

    const path = event?.composedPath?.() ?? [];
    return path.some(el =>
      el?.classList?.contains?.("move-block") ||
      el?.classList?.contains?.("signature-perk") ||
      el?.classList?.contains?.("gambit-card") ||
      el?.classList?.contains?.("gambit-hand-card")
    );
  }

  _mgNpcDropLabel(status) {
    if (status.type === "move") return "Drop NPC Move Here";
    return "Drop Here";
  }

  _mgBindNpcSheetWideDrop(html) {
    this._mgEnsureNpcSheetDropCSS();

    const root = html?.[0];
    const app = root?.closest?.(".window-app");
    if (!app) return;

    if (this._mgNpcSheetWideDropHandlers) {
      const h = this._mgNpcSheetWideDropHandlers;
      app.removeEventListener("dragenter", h.dragenter, true);
      app.removeEventListener("dragover", h.dragover, true);
      app.removeEventListener("dragleave", h.dragleave, true);
      app.removeEventListener("drop", h.drop, true);
      document.removeEventListener("dragstart", h.documentDragStart, true);
      document.removeEventListener("dragend", h.documentDragEnd, true);
      document.removeEventListener("drop", h.documentDragEnd, true);
    }

    let overlay = document.querySelector(`#mg-npc-drop-overlay-${this.actor.id}`);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = `mg-npc-drop-overlay-${this.actor.id}`;
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
    let visualStatus = { known: false, allowed: false, message: null };

    const clearState = () => {
      dragDepth = 0;
      visualStatus = { known: false, allowed: false, message: null };
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
      if (this._mgIsNpcInternalSheetDrag(event)) return;

      const status = await this._mgGetNpcDragSourceStatus(event);
      visualStatus = status;

      if (status.allowed) showOverlay(this._mgNpcDropLabel(status));
      else hideOverlay();
    };

    const documentDragStart = (event) => {
      if (this._mgIsNpcInternalSheetDrag(event)) return;

      refreshVisualStatusFromSource(event).catch(err => {
        console.warn("MG | Could not inspect NPC drag source:", err);
        clearState();
      });
    };

    const dragenter = async (event) => {
      if (this._mgIsNpcInternalSheetDrag(event)) return;

      dragDepth += 1;
      const status = await this._mgGetNpcDropStatus(event);
      if (status.known) visualStatus = status;

      if (visualStatus.allowed) showOverlay(this._mgNpcDropLabel(visualStatus));
      else hideOverlay();
    };

    const dragover = async (event) => {
      if (this._mgIsNpcInternalSheetDrag(event)) return;

      event.preventDefault();
      const status = await this._mgGetNpcDropStatus(event);
      if (status.known) visualStatus = status;

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = visualStatus.known && !visualStatus.allowed
          ? "none"
          : "copy";
      }

      if (visualStatus.allowed) showOverlay(this._mgNpcDropLabel(visualStatus));
      else hideOverlay();
    };

    const dragleave = (event) => {
      if (this._mgIsNpcInternalSheetDrag(event)) return;

      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0 && !visualStatus.allowed) hideOverlay();
    };

    const drop = async (event) => {
      if (this._mgIsNpcInternalSheetDrag(event)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      try {
        const status = await this._mgGetNpcDropStatus(event);

        if (status.known && !status.allowed) {
          hideOverlay();
          if (status.message) ui.notifications?.warn(status.message);
          clearState();
          return false;
        }

        await this._onDrop(event);
      } catch (err) {
        console.error("MG | NPC sheet-wide drop failed:", err);
        ui.notifications?.error("Drop failed. See console.");
      } finally {
        clearState();
      }
    };

    const documentDragEnd = () => {
      clearState();
    };

    this._mgNpcSheetWideDropHandlers = {
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

    // NPC sheets only accept Item drops of type "move".
    let data;
    try {
      data = TextEditor.getDragEventData(event);
    } catch (_) {
      ui.notifications?.warn("NPC sheets only accept Moves.");
      return false;
    }
    if (data?.type !== "Item") {
      ui.notifications?.warn("NPC sheets only accept Moves.");
      return false;
    }

    // Resolve dropped item (compendium/world/sidebar)
    let src;
    try {
      src = data.uuid ? await fromUuid(data.uuid) : null;
    } catch (_) {
      src = null;
    }
    if (!src || src.documentName !== "Item") {
      ui.notifications?.warn("Could not resolve the dropped Move.");
      return false;
    }

    const dropped = src.toObject();
    if (dropped.type !== "move") {
      ui.notifications?.warn("NPC sheets only accept Moves.");
      return false;
    }

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

    ui.notifications?.warn("Drop Moves onto the Signature Perk or NPC Moves areas.");
    return false;
  }

  async close(options = {}) {
    if (this._mgNpcSheetWideDropHandlers) {
      const h = this._mgNpcSheetWideDropHandlers;
      const app = this.element?.[0]?.closest?.(".window-app");

      app?.removeEventListener("dragenter", h.dragenter, true);
      app?.removeEventListener("dragover", h.dragover, true);
      app?.removeEventListener("dragleave", h.dragleave, true);
      app?.removeEventListener("drop", h.drop, true);
      document.removeEventListener("dragstart", h.documentDragStart, true);
      document.removeEventListener("dragend", h.documentDragEnd, true);
      document.removeEventListener("drop", h.documentDragEnd, true);
      this._mgNpcSheetWideDropHandlers = null;
    }

    document.querySelector(`#mg-npc-drop-overlay-${this.actor.id}`)?.remove();

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
