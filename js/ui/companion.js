import { companionQrSvg } from "./companion-qr.js";

export function openCompanionDialog(actor) {
  const loopbackHosts = ["localhost", "127.0.0.1", "[::1]"];
  let origin = location.origin;
  if (loopbackHosts.includes(location.hostname)) {
    try {
      const lan = new URL(game.data.addresses?.local);
      if (["http:", "https:"].includes(lan.protocol) && !loopbackHosts.includes(lan.hostname)) {
        origin = lan.origin;
      }
    } catch {
      // Some hosts don't expose a LAN invitation address.
    }
  }
  const url = new URL(foundry.utils.getRoute("systems/midnight-gambit/companion.html"), origin);
  url.searchParams.set("actor", actor.id);
  url.searchParams.set("world", game.world.id);
  const link = Handlebars.escapeExpression(url.href);
  const qr = companionQrSvg(url.href);
  const loopback = loopbackHosts.includes(url.hostname);

  new Dialog({
    title: "Companion",
    content: `<p>Scan to open the Slim sheet for ${Handlebars.escapeExpression(actor.name)} on your phone.</p>
      ${loopback ? "<p>Open the game using Foundry’s Local Network invitation link to generate a scannable code.</p>" : qr ? "" : "<p>This link is too long to display as a QR code.</p>"}
      <div class="mg-companion-share">
        ${!loopback && qr ? `<div class="mg-companion-qr">${qr}</div>` : ""}
        <label class="mg-companion-link">Companion link
          <input type="url" readonly value="${link}">
        </label>
      </div>`,
    buttons: {
      copy: {
        label: "Copy Link",
        callback: async html => {
          try {
            await navigator.clipboard.writeText(url.href);
            ui.notifications.info("Companion link copied.");
          } catch {
            const input = html.find("input")[0];
            input.select();
            if (document.execCommand("copy")) ui.notifications.info("Companion link copied.");
            else ui.notifications.warn("Select and copy the Companion link manually.");
          }
        }
      },
      close: { label: "Close" }
    }
  }, { classes: ["dialog", "mg-companion-dialog"] }).render(true);
}

function getCompanionRequest() {
  const params = new URLSearchParams(location.search);
  const actor = params.get("mgCompanion");
  const world = params.get("mgCompanionWorld");
  if (actor && world) return { actor, world };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    try {
      const pending = JSON.parse(window[storageName].getItem("mgCompanionRequest") || "null");
      if (pending?.actor && pending.expires > Date.now()) return pending;
    } catch {
      // A direct game URL can still work when browser storage is disabled.
    }
  }
  return null;
}

let loadingScreen;

function dismissLoadingScreen() {
  if (!loadingScreen) return;
  const screen = loadingScreen;
  loadingScreen = null;
  const animation = screen.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: reducedMotion ? 0 : (companionLoading ? 400 : 1000),
    easing: "ease",
    fill: "forwards"
  });
  animation.finished.then(() => screen.remove(), () => screen.remove());
}

// System modules load before Foundry's init hook.
const companionLoading = Boolean(getCompanionRequest());
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
loadingScreen = document.createElement("dialog");
loadingScreen.className = companionLoading ? "mg-companion-loading" : "mg-world-loading";
loadingScreen.setAttribute("aria-label", companionLoading ? "Loading Midnight Gambit Companion" : "Loading Midnight Gambit");
const logo = document.createElement("img");
// Reserve the logo aspect ratio while the image downloads.
logo.width = 5000;
logo.height = 5000;
logo.fetchPriority = "high";
logo.src = new URL("../../assets/images/MG-Logo.png", import.meta.url).href;
logo.alt = "Midnight Gambit";

let progressFill;
let progressAnimation;
if (companionLoading) {
  loadingScreen.append(logo);
} else {
  const content = document.createElement("div");
  content.className = "mg-world-loading-content";
  const track = document.createElement("div");
  track.className = "mg-world-loading-track";
  // The bar is decorative. The dialog announces the loading state.
  track.setAttribute("aria-hidden", "true");
  progressFill = document.createElement("div");
  track.append(progressFill);
  content.append(logo, track);
  loadingScreen.append(content);
  loadingScreen.addEventListener("cancel", event => event.preventDefault());
}

document.body.append(loadingScreen);
loadingScreen.showModal();
// Hand off the initial CSS cover only after the dialog enters the top layer.
document.documentElement.classList.add("mg-loading-dialog-shown");

if (progressFill && !reducedMotion) {
  progressAnimation = progressFill.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(.9)" }], {
    duration: 9000,
    easing: "cubic-bezier(.15, .65, .35, 1)",
    fill: "forwards"
  });
}

Hooks.once("ready", async () => {
  const request = getCompanionRequest();
  if (!request && progressFill) {
    const from = getComputedStyle(progressFill).transform;
    progressAnimation?.cancel();
    await progressFill.animate([{ transform: from }, { transform: "scaleX(1)" }], {
      duration: reducedMotion ? 0 : 300,
      easing: "ease-out",
      fill: "forwards"
    }).finished.catch(() => {});
    return dismissLoadingScreen();
  }
  if (!request) return dismissLoadingScreen();
  if (request.world !== game.world.id) {
    ui.notifications.warn("This Companion link is for a different Foundry world.");
    return dismissLoadingScreen();
  }

  for (const storageName of ["sessionStorage", "localStorage"]) {
    try {
      window[storageName].removeItem("mgCompanionRequest");
    } catch {
      // The URL still identifies the Companion session.
    }
  }
  const actor = game.actors.get(request.actor);
  if (!actor?.isOwner || actor.type !== "character") {
    ui.notifications.warn("This character is unavailable to your Foundry user.");
    return dismissLoadingScreen();
  }
  const sheet = actor.sheet;
  if (!document.querySelector('meta[name="viewport"]')) {
    const viewport = document.createElement("meta");
    viewport.name = "viewport";
    viewport.content = "width=device-width, initial-scale=1";
    document.head.appendChild(viewport);
  }
  sheet.isCompanionView = true;
  document.body.classList.add("mg-companion-view");
  const url = new URL(location.href);
  url.searchParams.set("mgCompanion", request.actor);
  url.searchParams.set("mgCompanionWorld", request.world);
  history.replaceState(history.state, "", url);
  const rendered = Hooks.on("renderMidnightGambitActorSheet", app => {
    if (app !== sheet) return;
    Hooks.off("renderMidnightGambitActorSheet", rendered);
    clearTimeout(renderTimeout);
    requestAnimationFrame(() => setTimeout(dismissLoadingScreen, 1000));
  });
  // Release the splash if a render hook never fires.
  const renderTimeout = setTimeout(() => {
    Hooks.off("renderMidnightGambitActorSheet", rendered);
    dismissLoadingScreen();
  }, 10000);
  sheet.render(true);
});
