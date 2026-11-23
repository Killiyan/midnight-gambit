/* Move the live sheet to a popout so its listeners and actor stay connected. */
export function bindSheetPopouts(windows) {
	const sheetClasses = ["MidnightGambitActorSheet", "MidnightGambitCrewSheet"];
	const keyFor = app => `sheet-${app.appId}`;
	const maxSheetWidth = 850;
	const tabGutter = 64;
	const createSheetWindow = (app, key, sheet) => {
		const width = Math.min(Math.ceil(sheet.getBoundingClientRect().width), maxSheetWidth) + tabGutter;
		const view = windows.createWindow(app.title, key, { width });
		if (!view) return null;

		view.root.classList.add("mg-sheet-popout");
		// Maximized browser windows can ignore the window resize limit.
		view.root.style.maxWidth = `calc(${maxSheetWidth}px + 4rem)`;
		// The shared HUD root lets pointer input pass through by default.
		view.root.style.pointerEvents = "auto";
		return view;
	};
	const detach = app => {
		const key = keyFor(app);
		const existing = windows.views.get(key);
		if (existing && !existing.popup.closed) return existing.popup.focus();

		const sheet = app.element?.[0];
		if (!sheet?.isConnected || app.isCompanionView) return;
		const view = createSheetWindow(app, key, sheet);
		if (!view) return;

		const placeholder = document.createComment("MG detached sheet");
		sheet.replaceWith(placeholder);
		view.root.append(sheet);
		view.onRelease = () => {
			if (view.sheetClosing) placeholder.remove();
			else placeholder.replaceWith(sheet);
		};
		view.popup.focus();
	};

	const openCopy = app => {
		const key = `sheet-copy-${app.appId}`;
		const existing = windows.views.get(key);
		if (existing && !existing.popup.closed) return existing.popup.focus();

		const sheet = app.element?.[0];
		if (!sheet?.isConnected) return;
		const view = createSheetWindow(app, key, sheet);
		if (!view) return;

		const copy = new app.constructor(app.actor, { editable: app.options.editable });
		// Foundry normally gives all sheets for one actor the same DOM ID.
		Object.defineProperty(copy, "id", { value: `${app.id}-copy-${copy.appId}` });
		view.app = copy;
		const injectHTML = copy._injectHTML;
		copy._injectHTML = function(html) {
			injectHTML.call(this, html);
			if (!view.released) view.root.append(html[0]);
			else queueMicrotask(() => void this.close({ animate: false }));
		};
		view.onRelease = () => {
			if (!view.sheetClosing && copy.rendered) void copy.close({ animate: false });
		};
		copy.render(true);
		view.popup.focus();
	};

	for (const name of sheetClasses) {
		Hooks.on(`render${name}`, app => {
			if (app.isCompanionView) return;
			const header = app.element?.[0]?.querySelector(".window-header");
			if (!header || header.dataset.mgSheetPopoutBound) return;
			header.dataset.mgSheetPopoutBound = "true";
			const isCopy = [...windows.views.values()].some(view => view.app === app);
			if (isCopy) return;
			header.addEventListener("pointerdown", event => {
				if (event.button !== 1 && event.button !== 2) return;
				if (event.target.closest(".header-button")) return;
				// Foundry starts a window drag on pointerdown regardless of button.
				event.stopImmediatePropagation();
			}, { capture: true });
			header.addEventListener("mousedown", event => {
				if (event.button !== 1 || event.target.closest(".header-button")) return;
				event.preventDefault();
			}, { capture: true });
			header.addEventListener("auxclick", event => {
				if (event.button !== 1 || event.target.closest(".header-button")) return;
				event.preventDefault();
				event.stopPropagation();
				detach(app);
			}, { capture: true });
			header.addEventListener("contextmenu", event => {
				if (event.target.closest(".header-button")) return;
				event.preventDefault();
				event.stopPropagation();
				openCopy(app);
			});
		});

		Hooks.on(`close${name}`, app => {
			const view = windows.views.get(keyFor(app)) ?? [...windows.views.values()].find(view => view.app === app);
			if (!view) return;
			view.sheetClosing = true;
			view.popup.close();
		});
	}
}
