import { mgRollAttribute, mgRollSkill } from "./mg-ui.js";

const NS = "midnight-gambit";
const CHANNEL = `system.${NS}`;
const SKILLS = {
  tenacity: ["brawl", "endure", "athletics"],
  finesse: ["aim", "stealth", "sleight"],
  resolve: ["will", "grit", "composure"],
  guile: ["lore", "investigate", "deceive"],
  instinct: ["survey", "hunt", "nature"],
  presence: ["command", "charm", "perform"]
};
const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
}[character]));
const title = key => key.charAt(0).toUpperCase() + key.slice(1);
const state = () => game.settings.get(NS, "groupCheck");
const authority = () => game.users.find(u => u.active && u.isGM)?.id;
let windowInstance;
let queue = Promise.resolve();
let renderVersion = 0;
let busy = false;

function onlineRoller(actor) {
  const canRoll = user => user.active && !user.isGM && actor.testUserPermission(user, "OWNER");
  return game.users.find(user => canRoll(user) && user.character?.id === actor.id)
    ?? game.users.find(canRoll);
}

function primaryCrewCharacters() {
  const crew = game.actors.get(game.settings.get(NS, "crewActorId"));
  const members = crew?.system?.party?.members;
  if (crew?.type !== "crew" || !Array.isArray(members)) return [];
  return [...new Set(members)].map(uuid => {
    const match = /^Actor\.([^.]+)$/.exec(String(uuid));
    return match ? game.actors.get(match[1]) : null;
  }).filter(actor => actor?.type === "character" && onlineRoller(actor));
}

function row(actor, status, total = "...", attrs = "", icon = "") {
  return `<button type="button" class="mg-group-row" ${attrs}><img src="${esc(actor?.img)}" alt=""><span class="mg-group-identity"><strong>${esc(actor?.name)}</strong><small>${esc(status)}</small></span><b class="mg-group-result">${icon ? `<i class="fa-solid ${esc(icon)}" aria-hidden="true"></i>` : ""}${esc(total)}</b></button>`;
}

function request(action, data = {}) {
  const packet = { type: "mgGroupCheck", action, userId: game.user.id, ...data };
  if (authority() === game.user.id) receive(packet);
  else game.socket.emit(CHANNEL, packet);
}

function receive(packet) {
  if (packet?.type !== "mgGroupCheck" || authority() !== game.user.id) return;
  queue = queue.then(() => applyAction(packet)).catch(error => {
    console.error("MG Group Check", error);
    ui.notifications.error("Could not update the group check.");
  });
}

async function applyAction(packet) {
  const user = game.users.get(packet.userId);
  if (!user) return;
  if (packet.action === "start") {
    if (!user.isGM || state()?.active) return;
    const eligible = new Map(primaryCrewCharacters().map(actor => [actor.id, actor]));
    const participants = [...new Set(packet.actorIds)].map(id => eligible.get(id)).filter(Boolean).map(actor => {
      const owner = onlineRoller(actor);
      return { actorId: actor.id, userId: owner.id, status: "Rolling", messageId: null, revision: 0 };
    });
    if (!participants.length || !Object.values(SKILLS).flat().concat(Object.keys(SKILLS)).includes(packet.key)) return;
    await game.settings.set(NS, "groupCheck", { id: foundry.utils.randomID(), active: true, key: packet.key, attribute: !!packet.attribute, participants });
    return;
  }
  const check = foundry.utils.deepClone(state());
  if (!check?.active || packet.checkId !== check.id) return;
  if (packet.action === "end") {
    if (user.isGM) await game.settings.set(NS, "groupCheck", { ...check, active: false });
    return;
  }
  const participant = check.participants.find(p => p.actorId === packet.actorId);
  if (!participant || (!user.isGM && participant.userId !== user.id)) return;
  if (packet.action === "reopen") {
    if (!user.isGM || !["Kept", "Skipped"].includes(participant.status)) return;
    participant.status = participant.messageId ? "Modifying" : "Rolling";
    if (!participant.messageId) participant.revision++;
  } else {
    if (packet.revision !== participant.revision || ["Kept", "Skipped"].includes(participant.status)) return;
    if (packet.action === "skip" && participant.status === "Rolling") participant.status = "Skipped";
    else if (packet.action === "keep" && participant.status === "Modifying") participant.status = "Kept";
    else if (packet.action === "message") {
      const message = game.messages.get(packet.messageId);
      const link = message?.getFlag(NS, "groupCheck");
      if (!link || link.checkId !== check.id || link.actorId !== participant.actorId || link.revision !== participant.revision) return;
      if ((message.user?.id ?? message.user) !== participant.userId && !user.isGM) return;
      const doc = new DOMParser().parseFromString(message.content, "text/html");
      const card = doc.querySelector(".mg-roll-card");
      if (!card || !Number.isFinite(Number(card.dataset.total))) return;
      participant.total = Number(card.dataset.total);
      participant.bracket = card.querySelector(".mg-roll-outcome-title strong")?.textContent?.trim() ?? "";
      participant.messageId = message.id;
      participant.status = "Modifying";
    } else return;
  }
  await game.settings.set(NS, "groupCheck", check);
}

export function openGroupCheck() {
  if (!game.user.isGM) return;
  if (state()?.active) return renderCheck();
  const actors = primaryCrewCharacters();
  if (!actors.length) return ui.notifications.warn("No Primary Crew characters have an online player with permission to roll them.");
  const selected = new Set(actors.filter(a => game.users.some(u => u.active && !u.isGM && u.character?.id === a.id)).map(a => a.id));
  new Dialog({
    title: "Group Check",
    content: `<div class="mg-group-picker">${actors.map(a => row(a, "", "", `data-actor="${a.id}" aria-pressed="${selected.has(a.id)}"`)).join("")}</div><div class="mg-group-skills">${Object.entries(SKILLS).map(([attr, skills]) => `<section class="mg-group-skill-section"><div class="mg-group-attribute"><label>${title(attr)}</label><button type="button" data-key="${attr}" data-attribute="true" aria-label="Roll ${title(attr)}"><i class="fa-solid fa-dice" aria-hidden="true"></i></button></div><div class="mg-group-skill-grid">${skills.map(key => `<div class="mg-group-skill"><label>${title(key)}</label><button type="button" data-key="${key}" aria-label="Roll ${title(key)}"><i class="fa-solid fa-dice" aria-hidden="true"></i></button></div>`).join("")}</div></section>`).join("")}</div>`,
    buttons: {},
    render: html => {
      html.find("[data-actor]").on("click", event => {
        const button = event.currentTarget;
        selected.has(button.dataset.actor) ? selected.delete(button.dataset.actor) : selected.add(button.dataset.actor);
        button.setAttribute("aria-pressed", selected.has(button.dataset.actor));
      });
      html.find("[data-key]").on("click", event => {
        if (!selected.size) return ui.notifications.warn("Select at least one character.");
        const button = event.currentTarget;
        request("start", { actorIds: [...selected], key: button.dataset.key, attribute: button.dataset.attribute === "true" });
        html.closest(".app").find(".header-button.close").trigger("click");
      });
    }
  }, { classes: ["mg-group-check"], width: 760, height: "auto", resizable: true }).render(true);
}

async function renderCheck() {
  const version = ++renderVersion;
  const check = state();
  if (!check?.active) {
    await windowInstance?.close();
    windowInstance = null;
    return;
  }
  const own = check.participants.find(p => p.userId === game.user.id && !["Kept", "Skipped"].includes(p.status));
  const participant = !game.user.isGM ? own : check.participants.find(p => p.userId === game.user.id && !["Kept", "Skipped"].includes(p.status));
  const tracker = !participant;
  const complete = check.participants.every(p => ["Kept", "Skipped"].includes(p.status));
  const actor = participant && game.actors.get(participant.actorId);
  let content;
  if (tracker) {
    content = check.participants.map(p => {
      const done = ["Kept", "Skipped"].includes(p.status);
      const icons = { "Failure": "fa-fire-flame", "Critical Failure": "fa-skull-crossbones", "Complication": "fa-swords", "Flourish": "fa-crown", "ACE!": "fa-star", "Ace!": "fa-star" };
      const icon = p.status === "Skipped" ? "fa-forward" : icons[p.bracket] ?? "fa-dice";
      return row(game.actors.get(p.actorId), p.status === "Kept" ? p.bracket : p.status, p.status === "Skipped" ? "-" : p.total ?? ".", `data-reopen="${p.actorId}" data-state="${p.status.toLowerCase()}" data-complete="${done}" title="${game.user.isGM ? "Click a finished result to reprompt" : ""}"`, icon);
    }).join("");
    if (game.user.isGM) content += '<button type="button" data-end>× End Check</button>';
  } else {
    content = row(actor, `+ ${title(check.key)}`, "", `data-roll data-state="${participant.status.toLowerCase()}"`, "fa-dice");
    if (participant.status === "Rolling") content += '<div class="mg-group-actions"><button type="button" data-edge><i class="fa-solid fa-scythe" aria-hidden="true"></i> Edge</button><button type="button" data-skip><i class="fa-solid fa-forward" aria-hidden="true"></i> Skip</button></div>';
    else content += '<div class="mg-last-roll-body mg-group-roll-body" data-roll-content></div><button type="button" data-keep><i class="fa-solid fa-lock"></i> Keep</button>';
    if (game.user.isGM) content += '<button type="button" data-end>× End Check</button>';
  }
  const bind = async html => {
    const root = html[0];
    root.classList.toggle("is-complete", complete);
    root.classList.toggle("is-pending", !complete);
    root.classList.toggle("is-tracker", tracker);
    root.dataset.state = complete ? "complete" : "pending";
    windowInstance?.setPosition({ height: "auto" });
    const send = (action, extra = {}) => request(action, { checkId: check.id, actorId: participant?.actorId, revision: participant?.revision, ...extra });
    root.querySelector("[data-end]")?.addEventListener("click", () => send("end"));
    root.querySelectorAll("[data-reopen]").forEach(button => button.addEventListener("click", () => {
      if (game.user.isGM) send("reopen", { actorId: button.dataset.reopen });
    }));
    root.querySelector("[data-skip]")?.addEventListener("click", () => send("skip"));
    root.querySelector("[data-keep]")?.addEventListener("click", () => { if (!busy) send("keep"); });
    const roll = async edge => {
      if (busy || participant.status !== "Rolling") return;
      busy = true;
      root.querySelectorAll("button").forEach(b => b.disabled = true);
      try {
        await (check.attribute ? mgRollAttribute : mgRollSkill)(actor, check.key, { edge, groupCheck: { checkId: check.id, actorId: actor.id, revision: participant.revision } });
      } catch (error) {
        console.error("MG Group Check roll", error);
        ui.notifications.error("Could not roll the group check.");
      } finally { busy = false; renderCheck(); }
    };
    root.querySelector("[data-roll]")?.addEventListener("click", () => roll(false));
    root.querySelector("[data-edge]")?.addEventListener("click", () => roll(true));
    if (participant?.messageId) {
      const message = game.messages.get(participant.messageId);
      const rendered = await message?.getHTML();
      if (version !== renderVersion || !rendered) return;
      const target = root.querySelector("[data-roll-content]");
      const card = rendered[0].querySelector(".mg-roll-card");
      if (target && card) {
        target.append(card);
        windowInstance?.setPosition({ height: "auto" });
        // Native listeners are attached by getHTML; retain the delegated listeners too.
        target.addEventListener("click", async event => {
          const button = event.target.closest(".mg-risk-it, .mg-risk-again, .mg-spend-sto, .mg-remove-aura");
          if (!button || button.disabled || busy) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          const selector = button.classList.contains("mg-spend-sto") ? `.mg-spend-sto.${button.classList.contains("sto-complication") ? "sto-complication" : "sto-flourish"}` : `.${["mg-risk-it", "mg-risk-again", "mg-remove-aura"].find(c => button.classList.contains(c))}`;
          root.querySelector("[data-keep]").disabled = true;
          try {
            const fresh = await message.getHTML();
            fresh.find(selector).trigger("click");
          } finally {
            if (!busy) renderCheck();
          }
        }, true);
      }
    }
  };
  if (version !== renderVersion) return;
  if (!windowInstance) windowInstance = new Dialog({ title: `Group Check · ${title(check.key)}`, content, buttons: {}, render: bind }, { classes: ["mg-group-check"], width: 420, height: "auto", resizable: true });
  else Object.assign(windowInstance.data, { content, render: bind });
  windowInstance.render(true);
}

Hooks.once("init", () => {
  game.settings.register(NS, "groupCheck", { scope: "world", config: false, type: Object, default: {}, onChange: () => renderCheck() });
});
Hooks.once("ready", () => {
  game.socket.on(CHANNEL, receive);
  document.addEventListener("click", event => {
    if (event.target.closest(".mg-group-check-launch")) openGroupCheck();
  });
  renderCheck();
});
Hooks.on("createChatMessage", (message, options, userId) => {
  const link = message.getFlag(NS, "groupCheck");
  if (!link || userId !== game.user.id) return;
  request("message", { ...link, messageId: message.id });
});

// Keep and Skip lock every earlier card in this participant's roll chain.
Hooks.on("renderChatMessage", (message, html) => {
  const link = message.getFlag(NS, "groupCheck");
  if (!link) return;
  html[0].addEventListener("click", event => {
    if (!event.target.closest(".mg-risk-it, .mg-risk-again, .mg-spend-sto, .mg-remove-aura")) return;
    const check = state();
    const p = check?.participants?.find(p => p.actorId === link.actorId);
    if (!check?.active || check.id !== link.checkId || p?.status !== "Modifying" || p.messageId !== message.id) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
});

Hooks.on("mgGroupAction", active => { busy = active; if (!active) renderCheck(); });
