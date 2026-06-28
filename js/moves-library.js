import {
  MOVE_SUBTYPE_LABELS,
  MOVE_SUBTYPES,
  MOVE_TYPE_LABELS,
  MOVE_TYPES,
  normalizeMoveSubtype,
  normalizeMoveType
} from "../config.js";

const MG_MOVES_PACK = "midnight-gambit.moves";
const MG_MOVE_CARD_IMAGES = {
  midnight: "systems/midnight-gambit/assets/images/Gambits-Midnight.jpg",
  pearl: "systems/midnight-gambit/assets/images/Gambits-Pearl.jpg",
  cobalt: "systems/midnight-gambit/assets/images/Gambits-Cobalt.jpg",
  noir: "systems/midnight-gambit/assets/images/Gambits-Noir.jpg"
};
const MG_MOVE_TYPE_IMAGES = {
  combat: "systems/midnight-gambit/assets/images/moves-combat.png",
  spark: "systems/midnight-gambit/assets/images/moves-spark.png",
  utility: "systems/midnight-gambit/assets/images/moves-utility.png"
};

function mgIncludesSearch(card, search) {
  if (!search) return true;
  const haystack = `${card.name} ${card.description}`.toLowerCase();
  return haystack.includes(search.toLowerCase());
}

function mgGetActorMoveLibraryKey(item) {
  return String(item?.getFlag?.("midnight-gambit", "libraryUuid") ?? "");
}

function mgNormalizeMoveName(name) {
  return String(name ?? "").trim().toLowerCase();
}

export class MovesLibraryApplication extends Application {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
    this.filters = {
      search: "",
      types: new Set(),
      subtypes: new Set(),
      learned: false,
      unassigned: false
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
      classes: ["midnight-gambit", "mg-gambit-library-app", "mg-moves-library-app"],
      template: "systems/midnight-gambit/templates/apps/moves-library.html",
      width: 1180,
      height: 760,
      resizable: true
    });
  }

  get title() {
    return "Moves Library";
  }

  async getData(options = {}) {
    const cards = await this._getLibraryCards();
    const learnedRefs = this._getLearnedRefs(cards);
    const filteredCards = cards.filter(card => this._cardPassesFilters(card, learnedRefs));
    const cardImage = this._getCardImage();
    const animateCards = Boolean(this._animateFilterResults && !this._prefersReducedMotion());

    const gridCards = filteredCards.map((card, index) => ({
      ...card,
      cardImage,
      learned: learnedRefs.has(card.uuid),
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
          learned: learnedRefs.has(selectedCard.uuid),
          descriptionHtml: await TextEditor.enrichHTML(String(selectedCard.description ?? ""), { async: true })
        }
      : null;

    return {
      actor: this.actor,
      cards: gridCards,
      selected,
      hasFocus: Boolean(selected),
      search: this.filters.search,
      learnedOnly: this.filters.learned,
      unassignedOnly: this.filters.unassigned,
      typeFilters: MOVE_TYPES.map(type => ({ ...type, checked: this.filters.types.has(type.id) })),
      subtypeFilters: MOVE_SUBTYPES.map(type => ({ ...type, checked: this.filters.subtypes.has(type.id) }))
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find("[name='search']").on("input", ev => {
      this.filters.search = String(ev.currentTarget.value ?? "");
      this._restoreSearchFocus = true;
      this._queueFilterRender(160);
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
      await this._toggleMove(uuid);
    });

    $(window).off(`keydown.mgMovesLibrary${this.appId}`).on(`keydown.mgMovesLibrary${this.appId}`, ev => {
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
    $(window).off(`keydown.mgMovesLibrary${this.appId}`);
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
    const id = `mg-moves-library-backdrop-${this.appId}`;
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
    document.getElementById(`mg-moves-library-backdrop-${this.appId}`)?.remove();
  }

  _getCardImage() {
    const design = String(this.actor?.system?.gambits?.cardDesign ?? "midnight");
    return MG_MOVE_CARD_IMAGES[design] ?? MG_MOVE_CARD_IMAGES.midnight;
  }

  _getLearnedRefs(cards = []) {
    const refs = new Set(
      (this.actor?.items ?? [])
        .filter(item => item?.type === "move" && item.system?.learned === true && item.system?.isSignature !== true)
        .map(item => mgGetActorMoveLibraryKey(item))
        .filter(Boolean)
    );

    for (const card of cards) {
      if (this._findActorMove(card)) refs.add(card.uuid);
    }

    return refs;
  }

  async _getLibraryCards() {
    if (this._libraryCards) return this._libraryCards;

    const pack = game.packs.get(MG_MOVES_PACK) ??
      game.packs.find(p => p.metadata?.system === "midnight-gambit" && p.metadata?.name === "moves");

    if (!pack) {
      ui.notifications?.warn("Could not find the Moves compendium.");
      this._libraryCards = [];
      return this._libraryCards;
    }

    const docs = await pack.getDocuments();
    this._libraryCards = docs
      .filter(item => item?.type === "move" && item.system?.isSignature !== true)
      .map(item => this._cardFromItem(item))
      .sort((a, b) => a.name.localeCompare(b.name));

    return this._libraryCards;
  }

  _cardFromItem(item) {
    const moveType = normalizeMoveType(item.system?.moveType);
    const moveSubtype = normalizeMoveSubtype(item.system?.moveSubtype);

    return {
      uuid: item.uuid,
      item,
      name: item.name,
      description: String(item.system?.description ?? ""),
      moveType,
      moveSubtype,
      typeLabel: MOVE_TYPE_LABELS[moveType] ?? "Unassigned",
      subtypeLabel: MOVE_SUBTYPE_LABELS[moveSubtype] ?? "Unassigned",
      typeIcon: MG_MOVE_TYPE_IMAGES[moveType] ?? MG_MOVE_TYPE_IMAGES.utility
    };
  }

  _cardPassesFilters(card, learnedRefs = new Set()) {
    if (!mgIncludesSearch(card, this.filters.search)) return false;
    if (this.filters.learned && !learnedRefs.has(card.uuid)) return false;
    if (this.filters.unassigned && card.moveType && card.moveSubtype) return false;
    if (this.filters.types.size && !this.filters.types.has(card.moveType)) return false;
    if (this.filters.subtypes.size && !this.filters.subtypes.has(card.moveSubtype)) return false;
    return true;
  }

  _findActorMove(card) {
    const cardName = mgNormalizeMoveName(card?.name);
    return this.actor.items.find(item =>
      item.type === "move" &&
      item.system?.learned === true &&
      item.system?.isSignature !== true &&
      (
        mgGetActorMoveLibraryKey(item) === card.uuid ||
        (!mgGetActorMoveLibraryKey(item) && mgNormalizeMoveName(item.name) === cardName)
      )
    );
  }

  async _toggleMove(uuid) {
    const card = (await this._getLibraryCards()).find(c => c.uuid === uuid);
    if (!card) return;

    const existing = this._findActorMove(card);
    if (existing) {
      await existing.delete();
      this.render(false);
      return;
    }

    await this._ensureActorMove(card);
    this.render(false);
  }

  async _ensureActorMove(card) {
    const existing = this._findActorMove(card);
    if (existing) {
      if (!mgGetActorMoveLibraryKey(existing)) {
        await existing.setFlag("midnight-gambit", "libraryUuid", card.uuid);
      }
      return existing;
    }

    const data = card.item.toObject();
    delete data._id;
    data.system ??= {};
    data.system.learned = true;
    data.system.isSignature = false;
    data.flags ??= {};
    data.flags["midnight-gambit"] ??= {};
    data.flags["midnight-gambit"].libraryUuid = card.uuid;

    const [created] = await this.actor.createEmbeddedDocuments("Item", [data]);
    return created;
  }
}
