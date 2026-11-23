const params = new URLSearchParams(location.search);
const actor = params.get("actor");
const world = params.get("world");
const status = document.getElementById("status");

if (actor && world) {
  const gameUrl = new URL("../../game", location.href);
  gameUrl.searchParams.set("mgCompanion", actor);
  gameUrl.searchParams.set("mgCompanionWorld", world);
  const link = document.getElementById("continue");
  link.href = gameUrl.href;
  link.hidden = false;

  // Foundry and Forge may redirect through sign-in and drop the query string.
  const request = JSON.stringify({ actor, world, expires: Date.now() + 15 * 60 * 1000 });
  for (const storageName of ["sessionStorage", "localStorage"]) {
    try {
      window[storageName].setItem("mgCompanionRequest", request);
    } catch {
      // The direct URL also carries the request.
    }
  }
  // Give the branded launcher a painted frame before handing off to Foundry.
  const logo = document.querySelector(".mg-companion-loading img");
  try {
    await logo?.decode();
    if (document.visibilityState === "visible") {
      await new Promise(resolve => {
        const fallback = setTimeout(resolve, 150);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          clearTimeout(fallback);
          resolve();
        }));
      });
    }
  } finally {
    location.replace(gameUrl.href);
  }
} else {
  document.querySelector(".mg-companion-loading")?.remove();
  status.textContent = "Open a Companion link from your character sheet.";
}
