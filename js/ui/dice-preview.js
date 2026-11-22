import { DICE_SHAPES, planDiceRoll, rotate, stepDice, tossDie } from "./dice-tray.js";

const SIZE = 250;
const ROOT = "systems/midnight-gambit/assets/images/";
const CAMERA_LIFT = 0.24;
const D4_CAMERA_LIFT = 0.6;
const cameraLift = die => die.sides === 4 ? D4_CAMERA_LIFT : CAMERA_LIFT;
const KEPT_GLOW = "#A2D729";
const KEPT_NUMBER_GLOW = [14, 6]; // Outer halo, then brighter inner halo (px).
const KEPT_BORDER_GLOW = [18, 7]; // Outer halo, then brighter inner halo (px).
const KEPT_BORDER_PERIOD = 3800;

const ACE_GLYPH = "\uE012";
const ACE_ASPECT_RATIO = 101 / 119;

function scaleAceMark(ink, face, angle, glyphWidth, glyphHeight) {
  const origin = face([0, 0]);
  const axisLength = point => Math.hypot(...face(point).map((component, i) => component - origin[i]));
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const width = glyphWidth * axisLength([cos, sin]);
  const height = glyphHeight * axisLength([-sin, cos]);
  if (width <= 0 || height <= 0) return;
  const correction = ACE_ASPECT_RATIO / (width / height);
  ink.scale(Math.min(1, correction), Math.min(1, 1 / correction));
}

// Column, row, and clockwise quarter turns for faces 1–6 on the unfolded cube.
const D6_FILIGREE_NET = [[1, 3, 0], [2, 2, 1], [1, 2, 0], [1, 0, 0], [0, 2, -1], [1, 1, 2]];

function drawFiligree(ctx, image, faceCount, index) {
  ctx.save();
  ctx.globalAlpha = 1;
  if (faceCount === 6) {
    const [column, row, turns] = D6_FILIGREE_NET[index];
    const tile = Math.min(image.width / 3, image.height / 4);
    const x = (image.width - tile * 3) / 2 + column * tile;
    const y = (image.height - tile * 4) / 2 + row * tile;
    ctx.translate(SIZE / 2, SIZE / 2);
    ctx.rotate(turns * Math.PI / 2);
    ctx.drawImage(image, x, y, tile, tile, -SIZE / 2, -SIZE / 2, SIZE, SIZE);
  } else {
    const zoomedFace = faceCount === 4 || faceCount >= 8;
    const tile = Math.min(image.width, image.height) / (zoomedFace ? 2 : 1);
    const offset = index / (faceCount - 1);
    const x = zoomedFace ? (image.width - tile) / 2 : (image.width - tile) * offset;
    ctx.drawImage(image, x, (image.height - tile) * offset,
      tile, tile, 0, 0, SIZE, SIZE);
  }
  ctx.restore();
}

async function loadAceFont() {
  const probe = document.createElement("i");
  probe.className = "fa-kit fa-ace";
  document.body.append(probe);
  const style = getComputedStyle(probe, "::before");
  const computedFamily = style.fontFamily;
  const computedWeight = style.fontWeight;
  probe.remove();

  const kit = Array.from(document.fonts).find(face => /font awesome kit/i.test(face.family));
  const family = (kit?.family ?? computedFamily.split(",")
    .find(value => /font awesome kit/i.test(value)) ?? "Font Awesome Kit")
    .trim().replace(/^["']|["']$/g, "");
  const weight = kit?.weight.split(" ")[0] ?? computedWeight;
  const font = `${weight} 142px "${family}"`;
  const loaded = await document.fonts.load(font, ACE_GLYPH).catch(() => []);
  return loaded.length ? font : null;
}

function loadImage(path) {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = ROOT + path;
  });
}

let artwork;
async function createArtwork() {
  const [filigree, aceFont] = await Promise.all([
    loadImage("filigree-vert-blue.png"),
    loadAceFont(),
    document.fonts.load("bold 96px tiller").catch(() => [])
  ]);

  const faceSets = [...Object.entries(DICE_SHAPES),
    ["percentileTens", DICE_SHAPES[10]], ["percentileOnes", DICE_SHAPES[10]],
    ["percentileAce", DICE_SHAPES[10]]];
  return Object.fromEntries(faceSets.map(([faceSet, shape]) => [faceSet,
    shape.faces.map((_, index) => {
      const texture = document.createElement("canvas");
      texture.width = texture.height = SIZE;
      const ctx = texture.getContext("2d");
      ctx.fillStyle = "#1A2E4C";
      ctx.fillRect(0, 0, SIZE, SIZE);
      if (filigree) drawFiligree(ctx, filigree, shape.faces.length, index);
      const corners = shape.corners?.[index];
      const marks = (corners ?? [index]).map((labelIndex, corner) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = SIZE;
        const ink = canvas.getContext("2d");
        ink.fillStyle = "#ffeedb";
        const percentile = faceSet.startsWith("percentile");
        const useAce = labelIndex === shape.faces.length - 1 && aceFont &&
          (!percentile || faceSet === "percentileAce");
        const digit = (labelIndex + 1) % 10;
        const label = useAce ? ACE_GLYPH : !percentile ? String(labelIndex + 1)
          : faceSet === "percentileOnes" ? String(digit) : `${digit}0`;
        ink.font = useAce ? aceFont : "bold 96px tiller, Georgia, serif";
        ink.textAlign = "left";
        ink.textBaseline = "alphabetic";
        const {actualBoundingBoxLeft: left, actualBoundingBoxRight: right,
          actualBoundingBoxAscent: ascent, actualBoundingBoxDescent: descent} = ink.measureText(label);
        const angle = corners ? corner * 2 * Math.PI / 3 : 0;
        if (corners) {
          const [x, y] = shape.outline[corner];
          ink.translate(SIZE * (0.5 + 0.26 * x), SIZE * (0.5 + 0.26 * y + 0.07));
          ink.rotate(angle);
          ink.scale(0.42, 0.42);
        } else if (shape.faces.length === 8 || shape.faces.length === 20) {
          ink.translate(SIZE / 2, SIZE * (0.5 + shape.outline[1][1] / 6));
          ink.scale(0.72, 0.72);
        } else if (shape.faces.length === 10) {
          ink.translate(SIZE / 2, SIZE * 0.64);
          ink.scale(0.68, 0.68);
        } else {
          ink.translate(SIZE / 2, SIZE / 2);
        }
        if (useAce) scaleAceMark(ink, shape.faces[index], angle, left + right, ascent + descent);
        ink.fillText(label, (left - right) / 2, (ascent - descent) / 2);
        return {canvas, value: labelIndex + 1};
      });
      return {texture, marks};
    })
  ]));
}

function drawGroundShadow(ctx, die, fade, pixelScale) {
  const {p: [cx, cy, cz], q, scale} = die;
  const depth = Math.sqrt(1 - cameraLift(die) ** 2);
  const points = die.shape.vertices.map(point => {
    const [x, y, z] = rotate(q, point);
    const height = Math.max(0, cz + z * scale);
    return [cx + x * scale + height * 0.22, cy + y * scale * depth + height * 0.16];
  }).sort(([ax, ay], [bx, by]) => ax - bx || ay - by);
  const buildEdge = sorted => {
    const edge = [];
    for (const point of sorted) {
      while (edge.length > 1) {
        const [a, b] = edge.slice(-2);
        if ((b[0] - a[0]) * (point[1] - a[1]) > (b[1] - a[1]) * (point[0] - a[0])) break;
        edge.pop();
      }
      edge.push(point);
    }
    edge.pop();
    return edge;
  };
  const hull = [...buildEdge(points), ...buildEdge(points.reverse())];
  ctx.save();
  ctx.globalAlpha = fade * 0.46 / Math.max(1, cz / scale);
  ctx.fillStyle = "#050910";
  ctx.filter = `blur(${(scale * 0.12 + cz * 0.04) * pixelScale}px)`;
  ctx.beginPath();
  ctx.moveTo(...hull[0]);
  for (const point of hull.slice(1)) ctx.lineTo(...point);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawDie(ctx, textures, die, mark, reveal, phase, pixelScale) {
  const { p: [cx, cy, cz], q, scale, shape } = die;
  const lift = cameraLift(die);
  const depth = Math.sqrt(1 - lift ** 2);
  const view = point => {
    const [x, y, z] = rotate(q, rotate(mark, point));
    return [cx + x * scale, cy + y * scale * depth - (cz + z * scale) * lift];
  };
  const hitFaces = [];
  const trace = points => {
    ctx.beginPath();
    points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
  };
  const visible = points => {
    const [a, b, c] = points;
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
  };

  for (const corner of shape.sides) {
    const points = corner.map(view);
    if (!visible(points)) continue;
    hitFaces.push(points);
    trace(points);
    ctx.fillStyle = "#203653";
    ctx.fill();
  }

  let readableFace = -1;
  if (die.sides === 4 && die.kept && reveal > 0) {
    let bestFacing = 0;
    shape.normals.forEach((normal, index) => {
      if (index === die.value - 1) return;
      const [, y, z] = rotate(q, rotate(mark, normal));
      const facing = y * lift + z * depth;
      if (facing <= bestFacing) return;
      bestFacing = facing;
      readableFace = index;
    });
  }
  shape.faces.forEach((face, index) => {
    const points = shape.outline.map(point => view(face(point)));
    if (!visible(points)) return;
    hitFaces.push(points);
    trace(points);
    ctx.fillStyle = "#101c2d";
    ctx.fill();
    const inset = shape.outline.map(([u, v]) => view(face([u * 0.94, v * 0.94]).map(n => n * 0.997)));
    const {texture, marks} = textures[index];
    const highlighted = die.kept && reveal > 0 &&
      (die.sides === 4 ? index === readableFace : index === die.value - 1);
    const [a, b, c] = [[-1, -1], [1, -1], [-1, 1]].map(point => view(face(point)));
    ctx.save();
    trace(inset);
    ctx.clip();
    ctx.transform((b[0] - a[0]) / SIZE, (b[1] - a[1]) / SIZE,
      (c[0] - a[0]) / SIZE, (c[1] - a[1]) / SIZE, a[0], a[1]);
    ctx.drawImage(texture, 0, 0);
    for (const {canvas, value} of marks) {
      if (highlighted && value === die.value) {
        ctx.save();
        const alpha = Math.round(255 * reveal).toString(16).padStart(2, "0");
        ctx.shadowColor = KEPT_GLOW + alpha;
        for (const blur of KEPT_NUMBER_GLOW) {
          ctx.shadowBlur = blur * pixelScale;
          ctx.drawImage(canvas, 0, 0);
        }
        ctx.restore();
      } else {
        ctx.drawImage(canvas, 0, 0);
      }
    }
    ctx.restore();
    trace(inset);
    ctx.lineWidth = 2 * scale * 3 / SIZE;
    ctx.strokeStyle = "#4775ad";
    ctx.stroke();
    if (highlighted && die.sides !== 4) {
      const perimeter = inset.reduce((length, [x, y], i) => {
        const [nextX, nextY] = inset[(i + 1) % inset.length];
        return length + Math.hypot(nextX - x, nextY - y);
      }, 0);
      ctx.save();
      ctx.globalAlpha *= reveal;
      ctx.strokeStyle = KEPT_GLOW;
      ctx.lineWidth = 2 * scale * 5 / SIZE;
      ctx.lineCap = "round";
      ctx.shadowColor = KEPT_GLOW;
      ctx.setLineDash([perimeter * 0.19, perimeter * 0.81]);
      ctx.lineDashOffset = -phase * perimeter;
      for (const blur of KEPT_BORDER_GLOW) {
        ctx.shadowBlur = blur * pixelScale;
        ctx.stroke();
      }
      ctx.restore();
    }
  });
  die.hitFaces = hitFaces;
}

function containsPoint(points, x, y) {
  return points.every(([ax, ay], i) => {
    const [bx, by] = points[(i + 1) % points.length];
    return (bx - ax) * (y - ay) >= (by - ay) * (x - ax);
  });
}

function visibleSidebar(selector, width) {
  const panel = document.querySelector(selector);
  if (!panel) return null;
  const style = getComputedStyle(panel);
  if (style.visibility === "hidden" || style.display === "none") return null;
  const rect = panel.getBoundingClientRect();
  return rect.width && rect.height && rect.right > 0 && rect.left < width ? rect : null;
}

function trayEdges(width) {
  const left = visibleSidebar("#mg-ui-root [data-mg-left-sidebar]", width);
  const chat = visibleSidebar("#sidebar", width);
  const initiative = visibleSidebar("#mg-initiative-sidebar:not(.is-collapsed)", width);
  return [Math.max(0, left?.right ?? 0), Math.min(width, chat?.left ?? width, initiative?.left ?? width)];
}

let current;
export async function previewDiceRoll(rolls, keptRoll) {
  const pools = rolls.map(roll => (roll.dice ?? [])
    .filter(term => term.faces === 100 || Object.hasOwn(DICE_SHAPES, term.faces))
    .flatMap(term => term.results
      .filter(({ result }) => Number.isInteger(result) && result >= 1 && result <= term.faces)
      .flatMap(({ result, active }) => {
        const kept = roll === keptRoll && active;
        if (term.faces !== 100) return [{sides: term.faces, value: result, kept}];
        return [
          {sides: 10, value: Math.floor(result / 10) % 10 || 10, kept,
            faceSet: result === 100 ? "percentileAce" : "percentileTens"},
          {sides: 10, value: result % 10 || 10, kept, faceSet: "percentileOnes"}
        ];
      })))
    .filter(pool => pool.length);
  if (!pools.length) return;
  artwork ??= createArtwork();
  const textures = await artwork;

  current?.close();
  const [initialLeft, initialRight] = trayEdges(window.innerWidth);
  const trayWidth = initialRight - initialLeft;
  const trayHeight = window.innerHeight;
  if (trayWidth < 1 || trayHeight < 1) return;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.setAttribute("aria-hidden", "true");
  canvas.className = "mg-dice-preview";
  document.body.append(canvas);

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const {dice, frames, marks} = planDiceRoll(pools, trayWidth, trayHeight, reducedMotion);
  const started = performance.now();
  const duration = frames.length / 120 * 1000;
  const listeners = new AbortController();
  const preview = {
    close() {
      listeners.abort();
      canvas.remove();
      if (current === preview) current = null;
    }
  };
  current = preview;

  let expires = started + duration + (reducedMotion ? 3500 : 9000);
  let lastStep = 0;
  let drawOrder = [];
  let landed = false;
  let drag;
  let layout;
  const capture = {capture: true, signal: listeners.signal};
  const consume = event => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  window.addEventListener("pointerdown", event => {
    if (!landed || reducedMotion || drag || !layout || event.button !== 0 ||
      event.clientX < layout.left || event.clientX >= layout.right) return;
    const pointerX = (event.clientX - layout.origin) / layout.scale;
    const pointerY = event.clientY / layout.scale;
    const die = [...drawOrder].reverse().find(body =>
      body.hitFaces?.some(face => containsPoint(face, pointerX, pointerY)));
    if (!die) return;
    consume(event);
    const [x, y, z] = die.p;
    const height = Math.max(z, die.scale * 1.45);
    drag = {
      die, pointer: event.pointerId,
      offsetX: x - pointerX, offsetY: y - pointerY + (height - z) * cameraLift(die),
      last: event.timeStamp, vx: 0, vy: 0
    };
    die.bounds = layout.bounds;
    die.played = true;
    die.p = [x, pointerY + drag.offsetY, height];
    die.held = true;
    canvas.setPointerCapture(event.pointerId);
  }, capture);

  window.addEventListener("pointermove", event => {
    if (event.pointerId !== drag?.pointer || !layout) return;
    consume(event);
    const {die} = drag;
    const margin = die.scale * 1.7;
    const [left, right, top, bottom] = die.bounds;
    const x = Math.max(left + margin, Math.min(right - margin,
      (event.clientX - layout.origin) / layout.scale + drag.offsetX));
    const y = Math.max(top + margin, Math.min(bottom - margin, event.clientY / layout.scale + drag.offsetY));
    const seconds = Math.max(0.008, (event.timeStamp - drag.last) / 1000);
    drag.vx = (x - die.p[0]) / seconds;
    drag.vy = (y - die.p[1]) / seconds;
    drag.last = event.timeStamp;
    die.p = [x, y, die.p[2]];
  }, capture);

  const release = event => {
    if (event.pointerId !== drag?.pointer) return;
    consume(event);
    const {die, last, vx, vy} = drag;
    drag = undefined;
    die.held = false;
    const speed = Math.hypot(vx, vy);
    const flick = event.type === "pointerup" && event.timeStamp - last < 100 && speed > 100;
    const power = flick ? Math.min(1, 700 / speed) : 0;
    tossDie(die, vx * power, vy * power, flick ? 110 : 0);
    expires = performance.now() + 9000;
  };
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    window.addEventListener(type, release, capture);
  }

  window.addEventListener("keydown", event => {
    if (event.key === "Escape") preview.close();
  }, {signal: listeners.signal});

  function frame(now) {
    if (current !== preview) return;
    if (!drag && now >= expires) {
      preview.close();
      return;
    }
    const width = window.innerWidth;
    const height = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const backingWidth = Math.round(width * ratio);
    const backingHeight = Math.round(height * ratio);
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const [left, right] = trayEdges(width);
    if (right <= left || height <= 0) {
      layout = null;
      requestAnimationFrame(frame);
      return;
    }
    const scale = Math.min(1, (right - left) / trayWidth, height / trayHeight);
    const origin = left + (right - left - trayWidth * scale) / 2;
    if (layout?.left !== left || layout?.right !== right || layout?.height !== height) {
      const bounds = [(left - origin) / scale, (right - origin) / scale, 0, height / scale];
      layout = {left, right, height, origin, scale, bounds};
      for (const die of dice) {
        if (!die.played) continue;
        die.bounds = bounds;
        const margin = die.scale * 1.7;
        const [x, y, z] = die.p;
        const [minX, maxX, minY, maxY] = bounds;
        die.p = [Math.max(minX + margin, Math.min(maxX - margin, x)),
          Math.max(minY + margin, Math.min(maxY - margin, y)), z];
      }
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, 0, right - left, height);
    ctx.clip();
    ctx.translate(origin, 0);
    ctx.scale(scale, scale);

    const elapsed = Math.max(0, now - started);
    const tick = elapsed * 0.12;
    if (!landed && frames.length) {
      const index = Math.min(frames.length - 1, Math.floor(tick));
      frames[index].forEach((pose, i) => Object.assign(dice[i], pose));
    }
    if (elapsed >= duration && !landed) {
      landed = true;
      lastStep = Math.floor(tick);
      for (const die of dice) {
        die.asleep = true;
        die.v = die.w = [0, 0, 0];
      }
    }
    if (landed && !reducedMotion) {
      const target = Math.floor(tick);
      lastStep = Math.max(lastStep, target - 12);
      while (lastStep < target) {
        if (dice.some(die => !die.asleep)) stepDice(dice);
        lastStep++;
      }
    }
    const reveal = Math.min(1, Math.max(0, (elapsed - duration) / 180));
    const phase = reducedMotion ? 0 : (Math.max(0, elapsed - duration) % KEPT_BORDER_PERIOD) / KEPT_BORDER_PERIOD;
    const fade = drag ? 1 : Math.min(1, (expires - now) / 240);
    for (const die of dice) drawGroundShadow(ctx, die, fade, ratio * scale);
    drawOrder = [...dice].sort((a, b) => Number(!!a.held) - Number(!!b.held) || a.p[1] - b.p[1]);
    for (const die of drawOrder) {
      ctx.globalAlpha = fade * (die.kept ? 1 : 1 - 0.55 * reveal);
      drawDie(ctx, textures[die.faceSet ?? die.sides], die, marks[dice.indexOf(die)], reveal, phase, ratio * scale);
    }
    ctx.restore();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Rail and chat rolls use this hook. MG skill rolls supply their own kept pool.
Hooks.on("createChatMessage", (message, _options, userId) => {
  if (userId !== game.user.id || !message.isContentVisible || game.dice3d ||
    message.content?.includes("mg-roll-card")) return;
  const roll = message.rolls?.[0];
  if (!roll) return;
  previewDiceRoll([roll], roll)
    .catch(error => console.warn("Midnight Gambit dice preview failed", error));
});
