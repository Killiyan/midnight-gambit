import { MG_REACT_SKILLS } from "../attributes.js";
import { mgRollAttribute, mgRollSkill } from "./mg-ui.js";

const NS = "midnight-gambit";
const CHANNEL = `system.${NS}`;
const SKILLS = {
  tenacity: ["brawl", "endure", "athletics"],
  finesse: ["aim", "stealth", "sleight"],
  resolve: ["will", "grit", "composure"],
  guile: ["lore", "investigate", "deceive"],
  instinct: ["survey", "hunt", "nature"],
  presence: ["command", "charm", "perform"],
  react: MG_REACT_SKILLS
};
const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
}[character]));
const title = key => key.charAt(0).toUpperCase() + key.slice(1);
const checkOptions = check => check.options ?? [{ key: check.key, attribute: !!check.attribute }];
const skillKey = key => key.startsWith("react-") ? key.slice("react-".length) : key;
const optionTitle = key => key.startsWith("react-") ? `React ${title(skillKey(key))}` : title(key);
const validOption = option => {
  if (typeof option?.key !== "string") return false;
  if (option.attribute) return Object.hasOwn(SKILLS, option.key);
  if (option.key.startsWith("react-")) return MG_REACT_SKILLS.includes(skillKey(option.key));
  return Object.values(SKILLS).some(skills => skills.includes(option.key));
};
const state = () => game.settings.get(NS, "groupCheck");
const authority = () => game.users.find(u => u.active && u.isGM)?.id;
let panelInstance;
let setupPanel;
let queue = Promise.resolve();
let renderVersion = 0;
let busy = false;
let notifiedCheckId = null;
const trackerSnapshots = new Map();

// A standalone DOM panel, independent of Foundry Application and Dialog windows.
class GroupCheckPanel {
  constructor(data, { setup = false } = {}) {
    this.data = data;
    this.setup = setup;
    this.root = null;
    this.position = null;
    this.positionFlag = setup ? "groupCheckSetupPos" : "groupCheckPanelPos";
    this.onResize = () => this.setPosition();
  }

  render() {
    if (!this.root) {
      const saved = game.user.getFlag(NS, this.positionFlag);
      if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) {
        this.position = { left: saved.left, top: saved.top };
      }
      this.root = document.createElement("section");
      this.root.className = `mg-group-check${this.setup ? " is-setup" : ""}`;
      this.root.setAttribute("role", "dialog");
      this.root.setAttribute("aria-label", this.data.title || "Group Check");
      this.root.innerHTML = '<div class="mg-group-drag-handle" title="Drag to reposition"></div><div class="mg-group-body"><div class="mg-group-content"></div><div class="mg-group-footer"><button type="button" data-panel-close><i class="fa-solid fa-xmark" aria-hidden="true"></i> Close</button></div></div>';
      this.root.querySelector("[data-panel-close]").addEventListener("click", () => this.close());
      const handle = this.root.querySelector(".mg-group-drag-handle");
      let drag;
      handle.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        const rect = this.root.getBoundingClientRect();
        drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
        handle.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      handle.addEventListener("pointermove", event => {
        if (!drag) return;
        this.position = { left: drag.left + event.clientX - drag.x, top: drag.top + event.clientY - drag.y };
        this.setPosition();
      });
      const release = () => {
        if (!drag) return;
        drag = null;
        if (!this.position) return;
        const position = { left: parseFloat(this.root.style.left), top: parseFloat(this.root.style.top) };
        this.position = position;
        game.user.setFlag(NS, this.positionFlag, position)
          .catch(error => console.warn("MG Group Check: could not save panel position", error));
      };
      handle.addEventListener("pointerup", release);
      handle.addEventListener("pointercancel", release);
      handle.addEventListener("lostpointercapture", release);
      document.body.append(this.root);
      window.addEventListener("resize", this.onResize);
      this.observer = new ResizeObserver(() => this.setPosition());
      this.observer.observe(this.root);
    }
    const content = this.root.querySelector(".mg-group-content");
    content.innerHTML = this.data.content;
    const footer = this.root.querySelector(".mg-group-footer");
    footer.querySelector("[data-end]")?.remove();
    const endButton = content.querySelector("[data-end]");
    if (endButton) footer.prepend(endButton);
    Promise.resolve(this.data.render?.($(content))).catch(error => console.error("MG Group Check panel", error));
    this.setPosition();
    return this;
  }

  setPosition() {
    if (!this.root) return;
    const rect = this.root.getBoundingClientRect();
    const position = this.position ?? { left: (window.innerWidth - rect.width) / 2, top: (window.innerHeight - rect.height) / 2 };
    const left = Math.max(16, Math.min(position.left, window.innerWidth - rect.width - 16));
    const top = Math.max(16, Math.min(position.top, window.innerHeight - rect.height - 16));
    this.root.style.left = `${left}px`;
    this.root.style.top = `${top}px`;
  }

  close() {
    window.removeEventListener("resize", this.onResize);
    this.observer?.disconnect();
    this.root?.remove();
    this.root = null;
  }
}

function animateTrackerChanges(root, checkId) {
  root.querySelectorAll(".mg-group-row[data-reopen]").forEach(card => {
    const key = `${checkId}:${card.dataset.reopen}`;
    const status = card.querySelector(".mg-group-identity small");
    const result = card.querySelector(".mg-group-result");
    if (!status || !result) return;
    const previous = trackerSnapshots.get(key);
    const next = { state: card.dataset.state, status: status.cloneNode(true), result: result.cloneNode(true) };
    trackerSnapshots.set(key, next);
    if (!previous) return;
    const changedState = previous.state !== next.state;
    for (const [part, element] of [["status", status], ["result", result]]) {
      if (!changedState && previous[part].innerHTML === next[part].innerHTML) continue;
      slideTrackerValue(element, previous[part], part);
    }
  });
}

function slideTrackerValue(element, previous, part) {
      const slot = document.createElement("div");
      slot.className = `mg-group-slide-slot mg-group-slide-${part}`;
      element.replaceWith(slot);
      const outgoing = previous.cloneNode(true);
      outgoing.classList.add("is-leaving");
      outgoing.setAttribute("aria-hidden", "true");
      element.classList.add("is-entering");
      slot.append(outgoing, element);
      element.addEventListener("animationend", event => {
        if (event.target !== element) return;
        slot.replaceWith(element);
        element.classList.remove("is-entering");
      }, { once: true });
}

const TALLY_BRACKETS = [
  ["Critical Failure", "fa-crit-fail"],
  ["Failure", "fa-failure"],
  ["Complication", "fa-complication"],
  ["Flourish", "fa-flourish"],
  ["ACE!", "fa-ace"]
];

function renderTally(participants) {
  const counts = TALLY_BRACKETS.map(([label]) => participants.filter(p =>
    ["Modifying", "Kept"].includes(p.status) && String(p.bracket).toUpperCase() === label.toUpperCase()
  ).length);
  const leading = Math.max(0, ...counts);
  return `<div class="mg-group-tally" aria-label="Group result tally">${TALLY_BRACKETS.map(([label, icon], index) =>
    `<div class="mg-group-tally-item${counts[index] > 0 && counts[index] === leading ? " is-leading" : ""}" data-tally="${icon}" aria-label="${esc(label)}: ${counts[index]}" title="${esc(label)}: ${counts[index]}"><i class="fa-kit ${icon}" aria-hidden="true"></i><b class="mg-group-tally-count">${counts[index]}</b></div>`
  ).join("")}</div>`;
}

function animateTallyChanges(root, checkId) {
  root.querySelectorAll("[data-tally]").forEach(item => {
    const key = `${checkId}:tally:${item.dataset.tally}`;
    const count = item.querySelector(".mg-group-tally-count");
    const leading = item.classList.contains("is-leading");
    const previous = trackerSnapshots.get(key);
    trackerSnapshots.set(key, { count: count.cloneNode(true), leading });
    if (!previous) return;
    if (previous.count.textContent !== count.textContent) slideTrackerValue(count, previous.count, "tally");
    if (previous.leading !== leading) {
      item.classList.toggle("is-leading", previous.leading);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (item.isConnected) item.classList.toggle("is-leading", leading);
      }));
    }
  });
}

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
  const waiting = attrs.includes('data-reopen=') && attrs.includes('data-state="rolling"');
  const result = waiting ? '<span class="mg-group-waiting-dots" aria-label="Waiting for roll"></span>' : esc(total);
  return `<button type="button" class="mg-group-row" ${attrs}><img src="${esc(actor?.img)}" alt=""><span class="mg-group-identity"><strong>${esc(actor?.name)}</strong><small>${esc(status)}</small></span><b class="mg-group-result">${icon ? `<i class="${icon.startsWith("fa-kit ") ? esc(icon) : `fa-solid ${esc(icon)}`}" aria-hidden="true"></i>` : ""}${result}</b></button>`;
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
    const options = checkOptions(packet).filter(validOption).filter((option, index, all) => all.findIndex(other => other.key === option.key) === index);
    if (!participants.length || !options.length) return;
    await game.settings.set(NS, "groupCheck", { id: foundry.utils.randomID(), active: true, options, participants });
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
      const choice = checkOptions(check).find(option => option.key === (link.key ?? participant.key ?? check.key));
      if (!choice || (participant.key && participant.key !== choice.key)) return;
      if ((message.user?.id ?? message.user) !== participant.userId && !user.isGM) return;
      const doc = new DOMParser().parseFromString(message.content, "text/html");
      const card = doc.querySelector(".mg-roll-card");
      if (!card || !Number.isFinite(Number(card.dataset.total))) return;
      participant.total = Number(card.dataset.total);
      participant.bracket = card.querySelector(".mg-roll-outcome-title strong")?.textContent?.trim() ?? "";
      participant.messageId = message.id;
      participant.key = choice.key;
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
  const selectedOptions = new Map();
  const groups = Object.entries(SKILLS).map(([attribute, skills]) => {
    const choices = skills.map(key => {
      const optionKey = attribute === "react" ? `react-${key}` : key;
      return `<div class="mg-group-skill">
        <label>${title(key)}</label>
        <button type="button" data-key="${optionKey}" aria-label="Roll ${optionTitle(optionKey)}">
          <i class="fa-solid fa-dice" aria-hidden="true"></i>
        </button>
      </div>`;
    }).join("");
    return `<section class="mg-group-skill-section">
      <div class="mg-group-attribute">
        <label>${title(attribute)}</label>
        <button type="button" data-key="${attribute}" data-attribute="true" aria-label="Roll ${title(attribute)}">
          <i class="fa-solid fa-dice" aria-hidden="true"></i>
        </button>
      </div>
      <div class="mg-group-skill-grid">${choices}</div>
    </section>`;
  }).join("");

  setupPanel?.close();
  setupPanel = new GroupCheckPanel({
    title: "Group Check",
    content: `<div class="mg-group-picker">${actors.map(a => row(a, "", "", `data-actor="${a.id}" aria-pressed="${selected.has(a.id)}"`)).join("")}</div><div class="mg-group-skills">${groups}</div>`,
    
    render: html => {
      html.find("[data-actor]").on("click", event => {
        const button = event.currentTarget;
        selected.has(button.dataset.actor) ? selected.delete(button.dataset.actor) : selected.add(button.dataset.actor);
        button.setAttribute("aria-pressed", selected.has(button.dataset.actor));
      });
      html.find("[data-key]").on("click", event => {
        const button = event.currentTarget;
        const key = button.dataset.key;
        if (selectedOptions.has(key)) selectedOptions.delete(key);
        else selectedOptions.set(key, { key, attribute: button.dataset.attribute === "true" });
        button.setAttribute("aria-checked", String(selectedOptions.has(key)));
      });
      html.find("[data-key]").attr({ role: "checkbox", "aria-checked": "false" });
      html.find("[data-key]").each((_, button) => button.setAttribute("aria-label", `Offer ${optionTitle(button.dataset.key)}`));
      const start = document.createElement("button");
      start.type = "button";
      start.dataset.start = "";
      start.innerHTML = '<i class="fa-solid fa-users" aria-hidden="true"></i> Group Check';
      html[0].append(start);
      start.addEventListener("click", () => {
        if (!selected.size) return ui.notifications.warn("Select at least one character.");
        if (!selectedOptions.size) return ui.notifications.warn("Select at least one attribute or skill.");
        request("start", { actorIds: [...selected], options: [...selectedOptions.values()] });
        setupPanel?.close();
      });
    }
  }, { setup: true }).render(true);
}

async function renderCheck() {
  const version = ++renderVersion;
  const check = state();
  if (!check?.active) {
    trackerSnapshots.clear();
    await panelInstance?.close();
    panelInstance = null;
    return;
  }
  const own = check.participants.find(p => p.userId === game.user.id && !["Kept", "Skipped"].includes(p.status));
  const participant = !game.user.isGM ? own : check.participants.find(p => p.userId === game.user.id && !["Kept", "Skipped"].includes(p.status));
  if (participant?.status === "Rolling" && notifiedCheckId !== check.id) {
    notifiedCheckId = check.id;
    Promise.resolve(AudioHelper.play({
      src: "systems/midnight-gambit/assets/sounds/info.mp3",
      volume: .6,
      autoplay: true,
      loop: false
    }, false)).catch(error => console.warn("MG Group Check: prompt sound unavailable", error));
  }
  const tracker = !participant;
  const complete = check.participants.every(p => ["Kept", "Skipped"].includes(p.status));
  const actor = participant && game.actors.get(participant.actorId);
  let content;
  if (tracker) {
    content = check.participants.map(p => {
      const done = ["Kept", "Skipped"].includes(p.status);
      const icons = { "Failure": "fa-kit fa-failure", "Critical Failure": "fa-kit fa-crit-fail", "Complication": "fa-kit fa-complication", "Flourish": "fa-kit fa-flourish", "ACE!": "fa-kit fa-ace", "Ace!": "fa-kit fa-ace" };
      const icon = p.status === "Skipped" ? "fa-forward" : icons[p.bracket] ?? "fa-dice";
      return row(game.actors.get(p.actorId), p.status === "Kept" ? p.bracket : p.status, p.status === "Skipped" ? "-" : p.total ?? ".", `data-reopen="${p.actorId}" data-state="${p.status.toLowerCase()}" data-complete="${done}" title="${game.user.isGM ? "Click a finished result to reprompt" : ""}"`, icon);
    }).join("");
    content += renderTally(check.participants);
    if (game.user.isGM) content += '<button type="button" data-end>× End Check</button>';
  } else {
    const choices = participant.status === "Rolling" ? checkOptions(check) : [{ key: participant.key ?? check.key }];
    content = choices.map(option => row(actor, `+ ${optionTitle(option.key)}`, "", `data-roll="${esc(option.key)}" data-state="${participant.status.toLowerCase()}"`, "fa-dice")).join("");
    if (participant.status === "Rolling") content += '<div class="mg-group-actions"><button type="button" data-edge><i class="fa-solid fa-scythe" aria-hidden="true"></i> Edge</button><button type="button" data-skip><i class="fa-solid fa-forward" aria-hidden="true"></i> Skip</button></div>';
    else content += '<div class="mg-last-roll-body mg-group-roll-body" data-roll-content></div><button type="button" data-keep><i class="fa-solid fa-lock"></i> Keep</button>';
    if (game.user.isGM) content += '<button type="button" data-end>× End Check</button>';
  }
  const bind = async html => {
    const root = html[0];
    panelInstance.root.classList.toggle("is-awaiting-roll", participant?.status === "Rolling");
    root.classList.toggle("is-complete", complete);
    root.classList.toggle("is-pending", !complete);
    root.classList.toggle("is-tracker", tracker);
    root.dataset.state = complete ? "complete" : "pending";
    if (tracker) {
      animateTrackerChanges(root, check.id);
      animateTallyChanges(root, check.id);
    }
    else trackerSnapshots.clear();
    panelInstance?.setPosition({ height: "auto" });
    const send = (action, extra = {}) => request(action, { checkId: check.id, actorId: participant?.actorId, revision: participant?.revision, ...extra });
    panelInstance.root.querySelector("[data-end]")?.addEventListener("click", () => send("end"));
    root.querySelectorAll("[data-reopen]").forEach(button => button.addEventListener("click", () => {
      if (game.user.isGM) send("reopen", { actorId: button.dataset.reopen });
    }));
    root.querySelector("[data-skip]")?.addEventListener("click", () => send("skip"));
    root.querySelector("[data-keep]")?.addEventListener("click", () => { if (!busy) send("keep"); });
    let edge = false;
    const roll = async key => {
      if (busy || participant.status !== "Rolling") return;
      const option = checkOptions(check).find(option => option.key === key);
      if (!option) return;
      busy = true;
      root.querySelectorAll("button").forEach(b => b.disabled = true);
      try {
        const groupCheck = { checkId: check.id, actorId: actor.id, revision: participant.revision, key: option.key };
        if (option.attribute) await mgRollAttribute(actor, option.key, { edge, groupCheck });
        else await mgRollSkill(actor, skillKey(option.key), {
          edge,
          groupCheck,
          attribute: option.key.startsWith("react-") ? "react" : undefined
        });
      } catch (error) {
        console.error("MG Group Check roll", error);
        ui.notifications.error("Could not roll the group check.");
      } finally { busy = false; renderCheck(); }
    };
    root.querySelectorAll("[data-roll]").forEach(button => button.addEventListener("click", () => roll(button.dataset.roll)));
    const edgeButton = root.querySelector("[data-edge]");
    edgeButton?.setAttribute("aria-pressed", "false");
    edgeButton?.addEventListener("click", () => {
      edge = !edge;
      edgeButton.setAttribute("aria-pressed", String(edge));
    });
    if (participant?.messageId) {
      const message = game.messages.get(participant.messageId);
      const rendered = await message?.getHTML();
      if (version !== renderVersion || !rendered) return;
      const target = root.querySelector("[data-roll-content]");
      const card = rendered[0].querySelector(".mg-roll-card");
      if (target && card) {
        target.append(card);
        panelInstance?.setPosition({ height: "auto" });
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
  if (!panelInstance) panelInstance = new GroupCheckPanel({ title: "Group Check", content, render: bind }, {});
  else Object.assign(panelInstance.data, { content, render: bind });
  panelInstance.render(true);
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
