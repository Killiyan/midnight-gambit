/* External windows share the opener's game session; only the view is duplicated. */
export class MGSidebarPopouts {
	constructor({ getRoot, render, bind, tabs, normalize }) {
		Object.assign(this, { getRoot, render, bind, tabs, normalize });
		this.views = new Map();
		this.detached = null;
		window.addEventListener("pagehide", () => this.closeAll());
	}

	get activeRoot() { return this.detached?.root ?? this.getRoot(); }

	bindGestures(root) {
		const sidebar = root?.querySelector("[data-mg-left-sidebar]");
		if (!sidebar || sidebar.dataset.mgPopoutBound) return;
		sidebar.dataset.mgPopoutBound = "true";
		sidebar.addEventListener("mousedown", event => {
			if (event.button !== 1 || !event.target.closest(".sidebar-header, [data-sidebar-tabs]")) return;
			event.preventDefault();
			event.stopPropagation();
			this.detach();
		});
		sidebar.addEventListener("auxclick", event => {
			if (event.button === 1 && event.target.closest(".sidebar-header, [data-sidebar-tabs]")) event.preventDefault();
		});
		sidebar.addEventListener("contextmenu", event => {
			const tab = event.target.closest("[data-mg-left-tab]");
			const header = event.target.closest(".sidebar-header");
			if (!tab && !header) return;
			const tabId = tab?.dataset.mgLeftTab ?? sidebar.dataset.mgLeftSidebarTab;
			if (!tabId) return;
			event.preventDefault();
			event.stopPropagation();
			this.openTab(tabId);
		});
	}

	createWindow(title, key, { width = key === "sidebar" ? 500 : 446, limitWidth = true } = {}) {
		const desktop = /Electron\//i.test(navigator.userAgent);
		const popup = desktop
			? this.createDesktopWindow(title, width)
			: window.open("", "", `popup,width=${width},height=850,resizable=yes,scrollbars=yes`);
		if (!popup) {
			ui.notifications.warn("The browser blocked the popout window. Allow popups for this Foundry address and try again.");
			return null;
		}
		const doc = popup.document;
		if (!desktop) {
			doc.title = `Midnight Gambit - ${title}`;
			const base = doc.createElement("base");
			base.href = document.baseURI;
			doc.head.appendChild(base);
			for (const style of document.querySelectorAll('link[rel="stylesheet"], style')) doc.head.appendChild(style.cloneNode(true));
			doc.documentElement.className = document.documentElement.className;
			doc.body.className = "mg-hud-enabled mg-sidebar-popout";
			const clampWidth = () => {
				if (popup.innerWidth > width) popup.resizeTo(width + popup.outerWidth - popup.innerWidth, popup.outerHeight);
			};
			if (limitWidth) popup.addEventListener("resize", clampWidth);
		}
		const root = doc.createElement("div");
		if (!desktop) root.id = "mg-ui-root";
		root.className = "mg-ui-root";
		(popup.host ?? doc.body).appendChild(root);
		const view = { popup, root, key };
		this.views.set(key, view);
		popup.addEventListener("pagehide", () => this.release(view), { once: true });
		return view;
	}

	/** The desktop shell denies window.open; use a local floating host instead. */
	createDesktopWindow(title, width) {
		const frame = document.createElement("section");
		frame.className = "mg-sidebar-desktop-window";
		frame.setAttribute("role", "dialog");
		frame.setAttribute("aria-label", `Midnight Gambit - ${title}`);
		frame.tabIndex = -1;
		frame.style.width = `${width}px`;
		frame.style.maxWidth = `${width}px`;
		frame.innerHTML = `<header class="mg-popout-titlebar"><span></span><button type="button" aria-label="Close sidebar window" title="Close and return sidebar">×</button></header><div class="mg-sidebar-popout mg-popout-content"></div>`;
		frame.querySelector(".mg-popout-titlebar span").textContent = title;
		const events = new EventTarget();
		const popup = {
			document,
			host: frame.querySelector(".mg-popout-content"),
			closed: false,
			focus: () => {
				frame.style.zIndex = String(Math.max(100, ...[...document.querySelectorAll(".window-app, .mg-sidebar-desktop-window")].map(el => Number(getComputedStyle(el).zIndex) || 0)) + 1);
				frame.focus({ preventScroll: true });
			},
			addEventListener: (...args) => events.addEventListener(...args),
			close: () => {
				if (popup.closed) return;
				popup.closed = true;
				events.dispatchEvent(new Event("pagehide"));
				frame.remove();
			}
		};
		frame.querySelector("button").addEventListener("click", () => popup.close());
		frame.addEventListener("pointerdown", () => {
			// Raise without stealing focus from text inputs and sliders.
			frame.style.zIndex = String(Math.max(100, ...[...document.querySelectorAll(".window-app, .mg-sidebar-desktop-window")].map(el => Number(getComputedStyle(el).zIndex) || 0)) + 1);
		});
		const handle = frame.querySelector(".mg-popout-titlebar");
		let drag = null;
		handle.addEventListener("pointerdown", event => {
			if (event.button !== 0 || event.target.closest("button")) return;
			event.preventDefault();
			const rect = frame.getBoundingClientRect();
			drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
			handle.setPointerCapture(event.pointerId);
		});
		handle.addEventListener("pointermove", event => {
			if (!drag) return;
			frame.style.left = `${Math.max(0, Math.min(window.innerWidth - frame.offsetWidth, event.clientX - drag.x))}px`;
			frame.style.top = `${Math.max(0, Math.min(window.innerHeight - handle.offsetHeight, event.clientY - drag.y))}px`;
		});
		for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) handle.addEventListener(type, () => { drag = null; });
		document.body.appendChild(frame);
		popup.focus();
		return popup;
	}

	detach() {
		if (this.detached && !this.detached.popup.closed) return this.detached.popup.focus();
		const sidebar = this.getRoot()?.querySelector("[data-mg-left-sidebar]");
		if (!sidebar) return;
		const view = this.createWindow("Sidebar", "sidebar");
		if (!view) return;
		view.placeholder = document.createComment("MG detached sidebar");
		sidebar.replaceWith(view.placeholder);
		view.sidebar = sidebar;
		view.root.appendChild(sidebar);
		this.detached = view;
		document.body.classList.add("mg-left-sidebar-detached");
	}

	openTab(tabId) {
		if (this.normalize(tabId) !== tabId) return;
		// Foundry's player list is a single native element and cannot be duplicated.
		if (tabId === "players") {
			ui.notifications.info("Use middle-click to detach the sidebar with the Players tab.");
			return;
		}
		const existing = this.views.get(tabId);
		if (existing && !existing.popup.closed) return existing.popup.focus();
		const tab = this.tabs().find(entry => entry.id === tabId);
		if (!tab) return;
		const view = this.createWindow(tab.label, tabId);
		if (!view) return;
		view.tabId = tabId;
		view.root.innerHTML = `<aside class="mg-left-sidebar" data-mg-left-sidebar><div class="panel" data-sidebar-panel><header class="sidebar-header"><span class="kicker">Midnight Gambit</span><h2 data-sidebar-title></h2></header><div class="sidebar-body" data-sidebar-body></div></div></aside>`;
		view.root.querySelector("[data-sidebar-title]").textContent = tab.label;
		this.refresh(view);
	}

	refresh(view) {
		if (view.popup.closed) return this.release(view);
		if (this.normalize(view.tabId) !== view.tabId) return view.popup.close();
		const body = view.root.querySelector("[data-sidebar-body]");
		// Avoid destroying an in-progress edit or drag during a background update.
		const focused = view.popup.document.activeElement;
		if ((body.contains(focused) && focused.matches("input, select, textarea, [contenteditable=true]")) || body.querySelector(".mg-dragging")) {
			if (!view.retry) view.retry = window.setTimeout(() => { view.retry = null; this.refresh(view); }, 300);
			return;
		}
		const scroll = body.scrollTop;
		body.innerHTML = this.render(view.tabId);
		const sidebar = view.root.querySelector("[data-mg-left-sidebar]");
		sidebar.dataset.mgLeftSidebarTab = view.tabId;
		for (const tab of this.tabs()) sidebar.classList.toggle(`is-${tab.id}-tab`, tab.id === view.tabId);
		this.bind(view.root, view.tabId);
		body.scrollTop = scroll;
	}

	refreshTabs(tabId = null) {
		for (const view of this.views.values()) {
			if (view.tabId && (!tabId || view.tabId === tabId)) this.refresh(view);
		}
	}

	release(view) {
		if (view.released) return;
		view.released = true;
		window.clearTimeout(view.retry);
		if (this.detached === view) {
			view.placeholder.replaceWith(view.sidebar);
			this.detached = null;
			document.body.classList.remove("mg-left-sidebar-detached");
		}
		this.views.delete(view.key);
		view.onRelease?.();
	}

	closeAll() {
		for (const view of [...this.views.values()]) {
			this.release(view);
			view.popup.close();
		}
	}
}
