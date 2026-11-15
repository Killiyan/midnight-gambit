/* Keep Foundry's ChatLog instances and their built-in message synchronization. */
import { MGInitiativeSidebar } from "../initiative/initiative-sidebar.js";

export class MGChatPopouts {
	constructor(windows) {
		this.windows = windows;
		Hooks.on("closeChatLog", app => {
			const view = windows.views.get("chat-copy");
			if (view?.app === app && !view.released) view.popup.close();
		});
	}

	bindHeader(header) {
		if (!header || header.dataset.mgChatPopoutBound) return;
		header.dataset.mgChatPopoutBound = "true";
		header.addEventListener("contextmenu", event => {
			event.preventDefault();
			event.stopPropagation();
			void this.openCopy();
		});
		header.addEventListener("mousedown", event => {
			if (event.button !== 1) return;
			event.preventDefault();
			event.stopPropagation();
			this.detach();
		});
		header.addEventListener("auxclick", event => {
			if (event.button === 1) event.preventDefault();
		});
	}

	createHost(key) {
		const view = this.windows.createWindow("Chat", key, { width: 366 + 288 });
		if (!view) return null;
		view.root.classList.add("mg-chat-window-layout");
		view.initiativeHost = view.root.ownerDocument.createElement("div");
		view.initiativeHost.className = "mg-chat-initiative-host";
		view.chatRoot = view.root.ownerDocument.createElement("div");
		view.chatRoot.className = "mg-chat-popout";
		view.root.append(view.initiativeHost, view.chatRoot);
		return view;
	}

	detach() {
		const existing = this.windows.views.get("chat-detached");
		if (existing && !existing.popup.closed) return existing.popup.focus();
		const sidebar = document.getElementById("sidebar");
		if (!sidebar) return;
		const view = this.createHost("chat-detached");
		if (!view) return;
		const placeholder = document.createComment("MG detached chat");
		sidebar.replaceWith(placeholder);
		view.chatRoot.appendChild(sidebar);
		const initiative = MGInitiativeSidebar.instance._root;
		const initiativePlaceholder = initiative ? document.createComment("MG detached sidebar initiative") : null;
		if (initiative) {
			initiative.replaceWith(initiativePlaceholder);
			view.initiativeHost.appendChild(initiative);
		}
		document.body.classList.add("mg-chat-detached");
		view.onRelease = () => {
			placeholder.replaceWith(sidebar);
			if (initiativePlaceholder) initiativePlaceholder.replaceWith(initiative);
			document.body.classList.remove("mg-chat-detached");
		};
	}

	async openCopy() {
		const existing = this.windows.views.get("chat-copy");
		if (existing && !existing.popup.closed) return existing.popup.focus();
		if (!ui.chat?.createPopout) return ui.notifications.warn("This Foundry version does not support a separate chat view.");
		// Open synchronously from the click so the browser retains user activation.
		const view = this.createHost("chat-copy");
		if (!view) return;
		try {
			const app = ui.chat.createPopout();
			view.app = app;
			view.chatRoot.classList.add("mg-chat-copy-sidebar");
			const header = view.root.ownerDocument.createElement("header");
			header.className = "mg-right-sidebar-header";
			header.innerHTML = "<h2>Chat</h2>";
			this.bindHeader(header);
			view.chatRoot.appendChild(header);
			// Mount at injection time, before ChatLog waits for its images to load.
			// Waiting for _render to finish first leaves a separate native window behind.
			const injectHTML = app._injectHTML;
			let renderFinished = false;
			app._injectHTML = function(html) {
				this._element = html;
				if (view.released) return;
				view.chatRoot.appendChild(html[0]);
				html.show();
				// Core sets RENDERED after injection and listener setup. Do not let
				// lazy images in old messages postpone the initial scroll forever.
				window.setTimeout(() => {
					if (!view.released) void this.scrollBottom({ waitImages: false });
				}, 0);
			};
			if (app.rendered && app.element?.[0]) view.chatRoot.appendChild(app.element[0]);
			const initiative = new MGInitiativeSidebar();
			view.onRelease = () => {
				void initiative.unmount();
				void app.close({ animate: false }).catch(error => console.warn("MG | Could not close chat copy.", error))
					.finally(() => { if (renderFinished) app._injectHTML = injectHTML; });
			};
			await initiative.mount({ host: view.initiativeHost });
			try {
				await app._render(true);
			} finally {
				renderFinished = true;
				if (view.released) app._injectHTML = injectHTML;
			}
			if (view.released) {
				await app.close({ animate: false });
				return;
			}
			const element = app.element?.[0];
			if (!element) throw new Error("ChatLog rendered without an element.");
			app.scrollBottom({ waitImages: false });
		} catch (error) {
			view.popup.close();
			console.error("MG | Could not open chat copy.", error);
			ui.notifications.error("Could not open a separate chat view. See the console for details.");
		}
	}
}
