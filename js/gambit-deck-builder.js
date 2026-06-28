import {
  GAMBIT_TIERS,
  GAMBIT_TYPES,
  GAMBIT_TYPE_LABELS,
  getGambitCostForTier,
  normalizeGambitTier,
  normalizeGambitType
} from "../config.js";

const MG_GAMBIT_PACK = "midnight-gambit.gambits";
const MG_DECK_CARD_IMAGES = {
  midnight: "systems/midnight-gambit/assets/images/Gambits-Midnight.jpg",
  pearl: "systems/midnight-gambit/assets/images/Gambits-Pearl.jpg",
  cobalt: "systems/midnight-gambit/assets/images/Gambits-Cobalt.jpg",
  noir: "systems/midnight-gambit/assets/images/Gambits-Noir.jpg"
};
const MG_GAMBIT_TIER_IMAGES = {
  rookie: "systems/midnight-gambit/assets/images/gambit-rookie.png",
  trickDeck: "systems/midnight-gambit/assets/images/gambit-trick-deck.png",
  aceInTheSleeve: "systems/midnight-gambit/assets/images/gambit-ace.png",
  allIn: "systems/midnight-gambit/assets/images/gambit-all-in.png",
  crew: "systems/midnight-gambit/assets/images/gambit-crew.png"
};

function mgGetDeckGambitRefs(deck) {
  const refs = deck?.gambits ?? deck?.cards ?? deck?.items ?? [];
  return Array.isArray(refs) ? refs : [];
}

function mgGetRefCost(actor, ref) {
  const refCost = typeof ref === "object" ? Number(ref.cost ?? ref.gpCost) : NaN;
  const itemId = typeof ref === "string" ? ref : ref?.id ?? ref?.itemId ?? ref?._id;
  const itemCost = Number(actor?.items?.get(itemId)?.system?.gpCost);
  if (Number.isFinite(itemCost)) return Math.max(0, itemCost);
  return Number.isFinite(refCost) ? Math.max(0, refCost) : 0;
}

function mgGetRefLibraryKey(actor, ref) {
  if (!ref) return "";
  if (typeof ref === "object" && ref.sourceUuid) return String(ref.sourceUuid);
  if (typeof ref === "object" && ref.uuid?.startsWith?.("Compendium.")) return String(ref.uuid);

  const itemId = typeof ref === "string" ? ref : ref?.id ?? ref?.itemId ?? ref?._id;
  const embedded = actor?.items?.get(itemId);
  return String(embedded?.getFlag?.("midnight-gambit", "libraryUuid") ?? itemId ?? "");
}

function mgGetTierIcon(tier) {
  return MG_GAMBIT_TIER_IMAGES[normalizeGambitTier(tier)] ?? MG_GAMBIT_TIER_IMAGES.rookie;
}

function mgIncludesSearch(card, search) {
  if (!search) return true;
  const haystack = `${card.name} ${card.description}`.toLowerCase();
  return haystack.includes(search.toLowerCase());
}

export class GambitDeckBuilderApplication extends Application {
  constructor(actor, deckId, options = {}) {
    super(options);
    this.actor = actor;
    this.deckId = String(deckId ?? "");
    this.filters = {
      search: "",
      tiers: new Set(),
      types: new Set(),
      costs: new Set(),
      equipped: false
    };
    this.selectedUuid = "";
    this._libraryCards = null;
    this._restoreSearchFocus = false;
    this._filterRenderTimer = null;
    this._filterFadeTimer = null;
    this._animateFilterResults = false;
    this._filterScrollTop = 0;
  }

  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["midnight-gambit", "mg-gambit-library-app"],
      template: "systems/midnight-gambit/templates/apps/gambit-deck-builder.html",
      width: 1180,
      height: 760,
      resizable: true
    });
  }

  get title() {
    const deck = this._getDeck();
    return `Gambit Library - ${deck?.name ?? "Deck"}`;
  }

  async getData(options = {}) {
    const deck = this._getDeck();
    const cards = await this._getLibraryCards();
    const deckRefs = mgGetDeckGambitRefs(deck);
    const selectedRefs = new Set(deckRefs.map(ref => mgGetRefLibraryKey(this.actor, ref)));
    const filteredCards = cards.filter(card => this._cardPassesFilters(card, selectedRefs));
    const gpMax = Number(this.actor?.system?.gambitPoints?.max ?? 4) || 4;
    const gpSpent = deckRefs.reduce((total, ref) => total + mgGetRefCost(this.actor, ref), 0);
    const gpRemaining = Math.max(0, gpMax - gpSpent);
    const cardImage = this._getCardImage();
    const animateCards = Boolean(this._animateFilterResults && !this._prefersReducedMotion());

    const gridCards = filteredCards.map((card, index) => ({
      ...card,
      cardImage,
      selected: selectedRefs.has(card.uuid),
      focused: this.selectedUuid === card.uuid,
      singleWordName: !/\s/.test(String(card.name ?? "").trim()),
      animateEnter: animateCards,
      enterDelay: `${Math.min(index, 15) * 50}ms`
    }));

    const selectedCard = this.selectedUuid
      ? cards.find(card => card.uuid === this.selectedUuid) ?? null
      : null;

    const selected = selectedCard
      ? {
          ...selectedCard,
          cardImage,
          selected: selectedRefs.has(selectedCard.uuid),
          canAfford: selectedRefs.has(selectedCard.uuid) || selectedCard.gpCost <= gpRemaining,
          descriptionHtml: await TextEditor.enrichHTML(String(selectedCard.description ?? ""), { async: true })
        }
      : null;

    return {
      actor: this.actor,
      deck,
      deckName: deck?.name ?? "Deck",
      gpMax,
      gpSpent,
      gpRemaining,
      isOverBudget: gpSpent > gpMax,
      cards: gridCards,
      selected,
      hasFocus: Boolean(selected),
      search: this.filters.search,
      equippedOnly: this.filters.equipped,
      tierFilters: GAMBIT_TIERS
        .filter(tier => tier.id !== "crew")
        .map(tier => ({ ...tier, checked: this.filters.tiers.has(tier.id) })),
      typeFilters: GAMBIT_TYPES
        .map(type => ({ ...type, checked: this.filters.types.has(type.id) })),
      costFilters: [
        { id: "1-2", label: "1-2", checked: this.filters.costs.has("1-2") },
        { id: "3", label: "3", checked: this.filters.costs.has("3") },
        { id: "4", label: "4", checked: this.filters.costs.has("4") },
        { id: "5", label: "5", checked: this.filters.costs.has("5") }
      ]
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find("[name='search']").on("input", ev => {
      this.filters.search = String(ev.currentTarget.value ?? "");
      this._restoreSearchFocus = true;
      this._queueFilterRender(160);
    });

    html.find(".mg-gambit-library-edit-deck-name").on("click", async ev => {
      ev.preventDefault();
      await this._openRenameDeckDialog();
    });

    html.find("[data-filter]").on("change", ev => {
      const group = ev.currentTarget.dataset.filter;
      const value = String(ev.currentTarget.value ?? "");
      const target = this.filters[group];
      if (!(target instanceof Set)) return;
      ev.currentTarget.checked ? target.add(value) : target.delete(value);
      this._queueFilterRender(0);
    });

    html.find("[data-filter-toggle]").on("change", ev => {
      const group = ev.currentTarget.dataset.filterToggle;
      if (!Object.prototype.hasOwnProperty.call(this.filters, group)) return;
      this.filters[group] = Boolean(ev.currentTarget.checked);
      this._queueFilterRender(0);
    });

    html.find(".mg-gambit-library-window-close").on("click", ev => {
      ev.preventDefault();
      this.close();
    });

    html.find(".mg-gambit-library-card").on("click", ev => {
      ev.preventDefault();
      this.selectedUuid = String(ev.currentTarget.dataset.uuid ?? "");
      this.render(false);
    });

    html.find(".mg-gambit-library-focus-close, .mg-gambit-library-focus-backdrop").on("click", ev => {
      ev.preventDefault();
      this.selectedUuid = "";
      this.render(false);
    });

    html.find(".mg-gambit-library-toggle-card").on("click", async ev => {
      ev.preventDefault();
      const uuid = String(ev.currentTarget.dataset.uuid ?? "");
      await this._toggleCard(uuid);
    });

    $(window).off(`keydown.mgGambitBuilder${this.appId}`).on(`keydown.mgGambitBuilder${this.appId}`, ev => {
      if (ev.key !== "Escape" || !this.selectedUuid) return;
      this.selectedUuid = "";
      this.render(false);
    });

    if (this._restoreSearchFocus) {
      const input = html.find("[name='search']")[0];
      input?.focus?.();
      const end = String(input?.value ?? "").length;
      input?.setSelectionRange?.(end, end);
      this._restoreSearchFocus = false;
    }

    this._restoreFilterScroll(html);

    if (this._animateFilterResults) {
      this._animateFilterResults = false;
      this._animateCardsIn(html);
    }
  }

  async _render(force, options = {}) {
    await super._render(force, options);
    this._ensureFocusBackdrop();
  }

  async close(options = {}) {
    this._removeFocusBackdrop();
    clearTimeout(this._filterRenderTimer);
    clearTimeout(this._filterFadeTimer);
    $(window).off(`keydown.mgGambitBuilder${this.appId}`);
    return super.close(options);
  }

  _prefersReducedMotion() {
    return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  }

  _queueFilterRender(wait = 0) {
    clearTimeout(this._filterRenderTimer);
    clearTimeout(this._filterFadeTimer);
    this._captureFilterScroll();

    this._filterRenderTimer = setTimeout(() => {
      const grid = this.element?.find?.(".mg-gambit-library-grid")?.[0];
      grid?.classList.add("is-filtering");

      const fadeDelay = this._prefersReducedMotion() ? 0 : 500;
      this._filterFadeTimer = setTimeout(() => {
        this._animateFilterResults = true;
        this.render(false);
      }, fadeDelay);
    }, wait);
  }

  _captureFilterScroll() {
    const filters = this.element?.find?.(".mg-gambit-library-filters")?.[0];
    this._filterScrollTop = Number(filters?.scrollTop ?? this._filterScrollTop ?? 0);
  }

  _restoreFilterScroll(html) {
    const filters = html.find(".mg-gambit-library-filters")[0];
    if (!filters) return;
    filters.scrollTop = this._filterScrollTop ?? 0;

    requestAnimationFrame(() => {
      filters.scrollTop = this._filterScrollTop ?? 0;
    });
  }

  _animateCardsIn(html) {
    const cards = html.find(".mg-gambit-library-card.pre-enter").toArray();
    if (!cards.length || this._prefersReducedMotion()) return;

    requestAnimationFrame(() => requestAnimationFrame(() => {
      cards.forEach(card => {
        const cleanup = () => {
          card.classList.remove("is-entering", "pre-enter");
          card.style.removeProperty("--mg-card-enter-delay");
          card.removeEventListener("animationend", cleanup);
        };

        card.addEventListener("animationend", cleanup, { once: true });
        card.classList.remove("pre-enter");
        card.classList.add("is-entering");
        setTimeout(cleanup, 1600);
      });
    }));
  }

  _ensureFocusBackdrop() {
    const id = `mg-gambit-library-backdrop-${this.appId}`;
    let backdrop = document.getElementById(id);

    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = id;
      backdrop.className = "mg-gambit-library-page-backdrop";
      backdrop.setAttribute("aria-hidden", "true");
      document.body.appendChild(backdrop);
    }

    this.element?.css?.("z-index", 10051);
  }

  _removeFocusBackdrop() {
    document.getElementById(`mg-gambit-library-backdrop-${this.appId}`)?.remove();
  }

  _getDecks() {
    return Array.isArray(this.actor?.system?.gambitDecks?.decks)
      ? foundry.utils.deepClone(this.actor.system.gambitDecks.decks)
      : [];
  }

  _getDeck() {
    return (this.actor?.system?.gambitDecks?.decks ?? [])
      .find(deck => String(deck?.id ?? "") === this.deckId) ?? null;
  }

  _getCardImage() {
    const design = String(this.actor?.system?.gambits?.cardDesign ?? "midnight");
    return MG_DECK_CARD_IMAGES[design] ?? MG_DECK_CARD_IMAGES.midnight;
  }

  _escapeHtml(value) {
    const str = String(value ?? "");
    if (window?.Handlebars?.escapeExpression) return Handlebars.escapeExpression(str);
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  _buttonLabel(label, icon) {
    return `${this._escapeHtml(label)} <i class="fa-solid ${this._escapeHtml(icon)}"></i>`;
  }

  async _openRenameDeckDialog() {
    const deck = this._getDeck();
    if (!deck) {
      ui.notifications?.warn("Deck not found.");
      return;
    }

    const content = `
      <form class="mg-form">
        <div class="form-group">
          <label>Name</label>
          <input type="text" name="name" value="${this._escapeHtml(deck.name ?? "Deck")}" />
        </div>
      </form>
    `;

    const dialogZIndex = 10070;
    Hooks.once("renderDialog", app => {
      if (!app.element?.hasClass?.("mg-gambit-deck-name-dialog")) return;
      app.element.css("z-index", dialogZIndex);
      const input = app.element.find('input[name="name"]')[0];
      input?.focus?.();
      input?.select?.();
    });

    const result = await Dialog.wait({
      title: "Edit Deck Name",
      content,
      buttons: {
        ok: {
          label: this._buttonLabel("Save", "fa-floppy-disk"),
          callback: dlgHtml => {
            const $dlg = $(dlgHtml);
            return {
              name: String($dlg.find('input[name="name"]').val() ?? "").trim()
            };
          }
        },
        cancel: {
          label: this._buttonLabel("Cancel", "fa-circle-xmark"),
          callback: () => null
        }
      },
      default: "ok"
    }, {
      classes: ["midnight-gambit", "dialog", "mg-gambit-deck-name-dialog"],
      zIndex: dialogZIndex
    });

    if (!result) return;
    await this._renameDeck(result.name);
  }

  async _renameDeck(name) {
    const nextName = String(name ?? "").trim() || "Deck";
    const decks = this._getDecks();
    const index = decks.findIndex(deck => String(deck?.id ?? "") === this.deckId);
    if (index < 0) return;
    if (String(decks[index]?.name ?? "") === nextName) return;

    decks[index].name = nextName;
    await this.actor.update({ "system.gambitDecks.decks": decks });
    this.render(false);
  }

  async _getLibraryCards() {
    if (this._libraryCards) return this._libraryCards;

    const pack = game.packs.get(MG_GAMBIT_PACK) ??
      game.packs.find(p => p.metadata?.system === "midnight-gambit" && p.metadata?.name === "gambits");

    if (!pack) {
      ui.notifications?.warn("Could not find the Gambits compendium.");
      this._libraryCards = [];
      return this._libraryCards;
    }

    const docs = await pack.getDocuments();
    this._libraryCards = docs
      .filter(item => item?.type === "gambit")
      .map(item => this._cardFromItem(item))
      .filter(card => card.tier !== "crew")
      .sort((a, b) => a.name.localeCompare(b.name));

    return this._libraryCards;
  }

  _cardFromItem(item) {
    const tier = normalizeGambitTier(item.system?.tier);
    const gambitType = normalizeGambitType(item.system?.gambitType);
    const gpCost = getGambitCostForTier(tier, item.system?.gpCost);
    const tierConfig = GAMBIT_TIERS.find(t => t.id === tier);

    return {
      uuid: item.uuid,
      item,
      name: item.name,
      description: String(item.system?.description ?? ""),
      tier,
      tierLabel: tierConfig?.label ?? "Rookie",
      tierIcon: mgGetTierIcon(tier),
      gambitType,
      typeLabel: GAMBIT_TYPE_LABELS[gambitType] ?? "Unassigned",
      gpCost
    };
  }

  _cardPassesFilters(card, selectedRefs = new Set()) {
    if (!mgIncludesSearch(card, this.filters.search)) return false;
    if (this.filters.equipped && !selectedRefs.has(card.uuid)) return false;
    if (this.filters.tiers.size && !this.filters.tiers.has(card.tier)) return false;
    if (this.filters.types.size && !this.filters.types.has(card.gambitType)) return false;
    if (this.filters.costs.size && !this._costMatches(card.gpCost)) return false;
    return true;
  }

  _costMatches(cost) {
    const value = Number(cost);
    if (this.filters.costs.has("1-2") && (value === 1 || value === 2)) return true;
    return this.filters.costs.has(String(value));
  }

  _findDeckRef(deck, card) {
    return mgGetDeckGambitRefs(deck).find(ref => {
      return mgGetRefLibraryKey(this.actor, ref) === card.uuid;
    });
  }

  async _toggleCard(uuid) {
    const card = (await this._getLibraryCards()).find(c => c.uuid === uuid);
    if (!card) return;

    const decks = this._getDecks();
    const index = decks.findIndex(deck => String(deck?.id ?? "") === this.deckId);
    if (index < 0) {
      ui.notifications?.warn("Deck not found.");
      return;
    }

    const deck = decks[index];
    deck.gambits = mgGetDeckGambitRefs(deck).slice();
    const existing = this._findDeckRef(deck, card);

    if (existing) {
      deck.gambits = deck.gambits.filter(ref => ref !== existing);
      await this.actor.update({ "system.gambitDecks.decks": decks });
      this.render(false);
      return;
    }

    const gpMax = Number(this.actor?.system?.gambitPoints?.max ?? 4) || 4;
    const gpSpent = deck.gambits.reduce((total, ref) => total + mgGetRefCost(this.actor, ref), 0);
    if (gpSpent + card.gpCost > gpMax) {
      ui.notifications?.warn(`That would exceed this deck's ${gpMax} GP limit.`);
      return;
    }

    const embedded = await this._ensureActorGambit(card);
    deck.gambits.push({
      id: embedded.id,
      uuid: embedded.uuid,
      sourceUuid: card.uuid,
      name: embedded.name,
      gpCost: card.gpCost,
      tier: card.tier,
      gambitType: card.gambitType
    });

    await this.actor.update({ "system.gambitDecks.decks": decks });
    this.render(false);
  }

  async _ensureActorGambit(card) {
    const existing = this.actor.items.find(item =>
      item.type === "gambit" &&
      item.getFlag?.("midnight-gambit", "libraryUuid") === card.uuid
    );
    if (existing) return existing;

    const data = card.item.toObject();
    delete data._id;
    data.flags ??= {};
    data.flags["midnight-gambit"] ??= {};
    data.flags["midnight-gambit"].libraryUuid = card.uuid;

    const [created] = await this.actor.createEmbeddedDocuments("Item", [data]);
    return created;
  }
}
