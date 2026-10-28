import { LibraryApplication } from "./library-application.js";
import { MG_ITEM_LIBRARY_TYPES, mgCanReadItemShop, mgGetItemLibraryShops } from "./library-sources.js";
import { mgSanitizeInventoryItemData } from "./item-sheet.js";

function normalizeSearch(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Use the existing description as a short, plain-text card teaser.
function itemTeaser(description) {
  const content = document.createElement("div");
  content.innerHTML = String(description ?? "").replace(/<\/(?:p|div|li|h[1-6])>|<br\s*\/?>/gi, " ");
  content.querySelectorAll("script, style").forEach(element => element.remove());
  const text = (content.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.length > 160 ? text.slice(0, 160).trimEnd() + "…" : text;
}

export class ItemsLibraryApplication extends LibraryApplication {
  constructor(actor, options = {}) {
    super(actor, options);
    this.filters = { search: "", types: new Set() };
    this.shopId = "";
    this._cardsByShop = new Map();
    this._adding = false;
    this._quantity = 1;
  }

  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["midnight-gambit", "mg-gambit-library-app"],
      template: "systems/midnight-gambit/templates/apps/items-library.html",
      width: 1180,
      height: 760,
      resizable: true
    });
  }

  get title() { return "Items Library"; }

  async getData() {
    const shops = await mgGetItemLibraryShops();
    if (!shops.some(shop => shop.id === this.shopId)) this.shopId = "";
    if (shops.length === 1) this.shopId = shops[0].id;
    const shop = shops.find(entry => entry.id === this.shopId);
    let cards = [];
    let shopError = false;
    if (shop) {
      try {
        cards = await this._getLibraryCards();
      } catch (error) {
        shopError = true;
        console.warn("MG Items Library | Could not load shop", { shop: this.shopId, error });
      }
    }
    const needle = normalizeSearch(this.filters.search);
    const filtered = cards.filter(card => {
      const haystack = normalizeSearch(`${card.name} ${card.typeLabel} ${card.description} ${card.tags.join(" ")}`);
      return (!needle || haystack.includes(needle) || haystack.replace(/ /g, "").includes(needle.replace(/ /g, "")))
        && (!this.filters.types.size || this.filters.types.has(card.type));
    });
    const selected = cards.find(card => card.uuid === this.selectedUuid);
    if (!selected) this.selectedUuid = "";
    return {
      shops,
      shop,
      shopError,
      showingShops: !shop,
      canChooseShop: shops.length > 1,
      search: this.filters.search,
      cards: filtered.map((card, index) => ({
        ...card,
        focused: this.selectedUuid === card.uuid,
        animateEnter: this._animateFilterResults && !this._prefersReducedMotion(),
        enterDelay: `${Math.min(index, 15) * 50}ms`
      })),
      selected: selected ? {
        ...selected,
        hasStats: Boolean(selected.strain.length || selected.capacity.length || selected.luxCost),
        descriptionHtml: await TextEditor.enrichHTML(selected.description, { async: true, secrets: game.user?.isGM === true })
      } : null,
      hasFocus: Boolean(selected),
      suppressFocusFade: Boolean(selected && this._suppressFocusFade),
      canAdd: this.actor?.isOwner === true && ["character", "crew"].includes(this.actor.type) && (selected?.type !== "asset" || this.actor.type === "crew"),
      quantity: this._quantity,
      typeFilters: MG_ITEM_LIBRARY_TYPES.map(type => ({ ...type, checked: this.filters.types.has(type.id) }))
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find(".mg-gambit-library-window-close").on("click", () => this.close());
    html.find("[data-open-shop]").on("click", event => this._openShop(event.currentTarget.dataset.openShop));
    html.find("[data-choose-shop]").on("click", () => this._openShop(""));
    html.find("[data-shop-select]").on("change", event => this._openShop(event.currentTarget.value));
    html.find("[data-refresh-shops]").on("click", () => {
      this._cardsByShop.clear();
      this.render(false);
    });
    html.find("[name='search']").on("input", event => {
      this.filters.search = String(event.currentTarget.value ?? "");
      this._restoreSearchFocus = true;
      this._queueFilterRender(160);
    });
    html.find("[data-item-type-filter]").on("click", event => {
      const type = event.currentTarget.dataset.itemTypeFilter;
      this.filters.types.has(type) ? this.filters.types.delete(type) : this.filters.types.add(type);
      this._queueFilterRender();
    });
    html.find(".mg-gambit-library-card").on("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.currentTarget.click();
    });
    html.find(".mg-gambit-library-card").on("click", event => {
      this._captureLibraryScroll();
      this.selectedUuid = event.currentTarget.dataset.uuid;
      this._quantity = 1;
      this.render(false);
    });
    html.find(".mg-gambit-library-focus-close, .mg-gambit-library-focus-backdrop").on("click", () => this._closeFocusPreview());
    html.find("[name='itemQuantity']").on("change", event => {
      this._quantity = this._clampQuantity(event.currentTarget.value);
      event.currentTarget.value = this._quantity;
    });
    html.find("[data-add-library-item]").on("click", () => {
      this._quantity = this._clampQuantity(html.find("[name='itemQuantity']").val());
      void this._addToInventory();
    });
    $(window).off(`keydown.mgLibrary${this.appId}`).on(`keydown.mgLibrary${this.appId}`, event => {
      if (event.key === "Escape" && this.selectedUuid) this._closeFocusPreview();
    });
    if (this._restoreSearchFocus) {
      const input = html.find("[name='search']")[0];
      input?.focus();
      input?.setSelectionRange?.(input.value.length, input.value.length);
      this._restoreSearchFocus = false;
    }
    this._restoreFilterScroll(html);
    this._restoreLibraryScroll(html);
    if (this._animateFilterResults) {
      this._animateFilterResults = false;
      this._animateCardsIn(html);
    }
  }

  _openShop(id) {
    clearTimeout(this._filterRenderTimer);
    clearTimeout(this._filterFadeTimer);
    clearTimeout(this._focusCloseTimer);
    this.shopId = String(id ?? "");
    this.selectedUuid = "";
    this.filters.search = "";
    this.filters.types.clear();
    this._filterScrollTop = this._libraryScrollTop = 0;
    const stage = this.element?.find?.(".mg-gambit-library-stage")?.[0];
    if (stage) stage.scrollTop = 0;
    this._animateFilterResults = false;
    this.render(false);
  }

  _clampQuantity(value) {
    const quantity = Math.trunc(Number(value));
    return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 1;
  }

  async _getLibraryCards() {
    const shopId = this.shopId;
    const pack = game.packs.get(shopId);
    if (!pack || !mgCanReadItemShop(pack)) return [];
    if (!this._cardsByShop.has(shopId)) {
      const docs = await pack.getDocuments();
      this._cardsByShop.set(shopId, docs
        .filter(item => MG_ITEM_LIBRARY_TYPES.some(type => type.id === item.type))
        .map(item => this._cardFromItem(item))
        .sort((a, b) => a.name.localeCompare(b.name)));
    }
    return this._cardsByShop.get(shopId);
  }

  _cardFromItem(item) {
    const type = MG_ITEM_LIBRARY_TYPES.find(type => type.id === item.type);
    const system = item.system ?? {};
    const value = raw => Math.max(0, Number(raw) || 0);
    const mortalStrain = value(system.mortalStrainDamage ?? system.strainDamage);
    const soulStrain = value(system.soulStrainDamage);
    const mortalCapacity = value(system.mortalCapacity);
    const soulCapacity = value(system.soulCapacity);
    const strain = mortalStrain || soulStrain ? [
      { icon: "fa-kit fa-mortal-strain", label: "Mortal Strain", value: mortalStrain },
      { icon: "fa-kit fa-soul-strain", label: "Soul Strain", value: soulStrain }
    ] : [];
    const capacity = mortalCapacity || soulCapacity ? [
      { label: "MC", title: "Mortal Capacity", value: mortalCapacity },
      { label: "SC", title: "Soul Capacity", value: soulCapacity }
    ] : [];
    const cost = Number(system.luxCost);
    const luxCost = Number.isFinite(cost) && cost > 0 ? cost : 0;
    const tags = (Array.isArray(system.tags) ? system.tags : []).map(id =>
      system.customTags?.[id]?.label ?? system.customTags?.[id]
      ?? (item.type === "asset" ? CONFIG.MidnightGambit?.ASSET_TAGS : CONFIG.MidnightGambit?.ITEM_TAGS)?.find(tag => tag.id === id)?.label ?? String(id)
    ).map(String);
    return {
      uuid: item.uuid, item, name: item.name, type: item.type, typeLabel: type.label, icon: type.icon,
      img: item.img || "systems/midnight-gambit/assets/images/items.jpg",
      description: String(system.description ?? ""), teaser: itemTeaser(system.description), tags, strain, capacity, luxCost
    };
  }

  async _addToInventory() {
    if (this._adding || !this.actor?.isOwner || !["character", "crew"].includes(this.actor.type)) return;
    this._adding = true;
    const button = this.element?.find?.("[data-add-library-item]");
    button?.prop("disabled", true);
    try {
      const card = (await this._getLibraryCards()).find(card => card.uuid === this.selectedUuid);
      if (!card) throw new Error("This shop item is no longer available.");
      if (card.type === "asset" && this.actor.type !== "crew") throw new Error("Assets can only be added to a crew inventory.");
      const data = mgSanitizeInventoryItemData(card.item);
      delete data._id;
      delete data.folder;
      const quantity = this._clampQuantity(this._quantity);
      data.system[card.type === "asset" ? "qty" : "quantity"] = quantity;
      data.flags ??= {};
      data.flags["midnight-gambit"] ??= {};
      data.flags["midnight-gambit"].libraryUuid = card.uuid;
      await this.actor.createEmbeddedDocuments("Item", [data]);
      ui.notifications.info(`Added ${quantity} × ${card.name} to ${this.actor.name}.`);
    } catch (error) {
      console.error("MG Items Library | Could not add item", error);
      ui.notifications.error(error.message || "Could not add this item.");
    } finally {
      this._adding = false;
      button?.prop("disabled", false);
    }
  }
}

