// Shared library transitions, scrolling, animation, and lightbox backdrop.
export class LibraryApplication extends Application {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
    this.selectedUuid = "";
    this._restoreSearchFocus = false;
    this._filterRenderTimer = null;
    this._filterFadeTimer = null;
    this._focusCloseTimer = null;
    this._animateFilterResults = false;
    this._suppressFocusFade = false;
    this._filterScrollTop = 0;
    this._libraryScrollTop = 0;
  }

  async _render(force, options = {}) {
    this._captureLibraryScroll();
    await super._render(force, options);
    this._suppressFocusFade = false;
    this._ensureFocusBackdrop();
  }

  async close(options = {}) {
    this._removeFocusBackdrop();
    clearTimeout(this._filterRenderTimer);
    clearTimeout(this._filterFadeTimer);
    clearTimeout(this._focusCloseTimer);
    $(window).off(`keydown.mgLibrary${this.appId}`);
    return super.close(options);
  }

  _prefersReducedMotion() {
    return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  }

  _queueFilterRender(wait = 0) {
    clearTimeout(this._filterRenderTimer);
    clearTimeout(this._filterFadeTimer);
    this._captureFilterScroll();
    this._captureLibraryScroll();

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

  _captureLibraryScroll({ force = false } = {}) {
    if (!force && (this.selectedUuid || this.element?.find?.(".mg-gambit-library.is-focused")?.length)) return;
    const stage = this.element?.find?.(".mg-gambit-library-stage")?.[0];
    this._libraryScrollTop = Number(stage?.scrollTop ?? this._libraryScrollTop ?? 0);
  }

  _restoreLibraryScroll(html) {
    const stage = html.find(".mg-gambit-library-stage")[0];
    if (!stage) return;
    const scrollTop = this._libraryScrollTop ?? 0;
    stage.style.setProperty("--mg-gambit-library-overlay-top", `${scrollTop}px`);
    stage.scrollTop = scrollTop;

    requestAnimationFrame(() => {
      stage.style.setProperty("--mg-gambit-library-overlay-top", `${scrollTop}px`);
      stage.scrollTop = scrollTop;
    });
  }

  _closeFocusPreview() {
    if (!this.selectedUuid) return;
    clearTimeout(this._focusCloseTimer);
    this.selectedUuid = "";

    const library = this.element?.find?.(".mg-gambit-library");
    library?.removeClass("is-focused is-focus-refresh")?.addClass("is-focus-closing");
    library?.find?.(".mg-gambit-library-card.is-focused")?.removeClass("is-focused");

    this._focusCloseTimer = setTimeout(() => {
      library?.removeClass("is-focus-closing");
      library?.find?.(".mg-gambit-library-focus-backdrop, .mg-gambit-library-focus")?.remove();
    }, this._prefersReducedMotion() ? 0 : 500);
  }

  _findLibraryCardElement(uuid) {
    const targetUuid = String(uuid ?? "");
    return this.element?.find?.(".mg-gambit-library-card").filter((_, el) => {
      return String(el.dataset?.uuid ?? "") === targetUuid;
    });
  }

  _findFocusToggleElement(uuid) {
    const targetUuid = String(uuid ?? "");
    return this.element?.find?.(".mg-gambit-library-toggle-card").filter((_, el) => {
      return String(el.dataset?.uuid ?? "") === targetUuid;
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
    const id = `mg-library-backdrop-${this.appId}`;
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
    document.getElementById(`mg-library-backdrop-${this.appId}`)?.remove();
  }

}
