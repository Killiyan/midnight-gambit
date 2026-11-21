export const CORNER_CUT = 0.28;
export const OUTLINE = [[-1 + CORNER_CUT, -1], [1 - CORNER_CUT, -1], [1, -1 + CORNER_CUT], [1, 1 - CORNER_CUT],
  [1 - CORNER_CUT, 1], [-1 + CORNER_CUT, 1], [-1, 1 - CORNER_CUT], [-1, -1 + CORNER_CUT]];

export const FACES = [
  ([u, v]) => [u, v, 1], ([u, v]) => [1, v, -u], ([u, v]) => [u, -1, v],
  ([u, v]) => [u, 1, -v], ([u, v]) => [-1, v, u], ([u, v]) => [-u, v, -1]
];
export const NORMALS = FACES.map(face => face([0, 0]));

export const CORNERS = [];
for (const x of [-1, 1]) {
  for (const y of [-1, 1]) {
    for (const z of [-1, 1]) {
      const vertices = [[x * (1 - CORNER_CUT), y, z], [x, y * (1 - CORNER_CUT), z], [x, y, z * (1 - CORNER_CUT)]];
      if (x * y * z < 0) vertices.reverse();
      CORNERS.push(vertices);
    }
  }
}

const VERTICES = CORNERS.flat();
const PLANES = [...NORMALS, ...CORNERS.map(([a]) => a.map(value => Math.sign(value) / Math.sqrt(3)))];
const OFFSETS = PLANES.map((_, i) => i < 6 ? 1 : (3 - CORNER_CUT) / Math.sqrt(3));
const STEP = 1 / 120;
const UP = [0, 0, 1];

const add = (a, b) => a.map((x, i) => x + b[i]);
const sub = ([x, y, z], [a, b, c]) => [x - a, y - b, z - c];
const mul = (a, n) => a.map(x => x * n);
const dot = ([x, y, z], [a, b, c]) => x * a + y * b + z * c;
const cross = ([x, y, z], [a, b, c]) => [y * c - z * b, z * a - x * c, x * b - y * a];
const length = a => Math.hypot(...a);
const unit = a => mul(a, 1 / length(a));
const identity = [0, 0, 0, 1];
function multiply(a, b) {
  const av = a.slice(0, 3), bv = b.slice(0, 3);
  return [...add(add(mul(bv, a[3]), mul(av, b[3])), cross(av, bv)), a[3] * b[3] - dot(av, bv)];
}

export function rotate(q, point) {
  const t = mul(cross(q, point), 2);
  return add(point, add(mul(t, q[3]), cross(q, t)));
}

function align(a, b) {
  const d = dot(a, b);
  if (d > 0.9999) return identity;
  if (d < -0.9999) {
    const axis = Math.abs(a[0]) > 0.5 ? [0, 1, 0] : [1, 0, 0];
    return [...unit(cross(a, axis)), 0];
  }
  return unit([...cross(a, b), 1 + d]);
}

function faceUp(q) {
  return NORMALS.reduce((best, n, i) => rotate(q, n)[2] > rotate(q, NORMALS[best])[2] ? i : best, 0);
}

function artworkRotation(die) {
  return align(NORMALS[die.value - 1], NORMALS[faceUp(die.q)]);
}

export function createDiceTray(pools, width, height, reducedMotion) {
  const lane = height * 0.60 / pools.length;
  const scale = Math.min(29, width * 0.19 / Math.max(...pools.map(pool => pool.length)), lane * 0.16);
  return pools.flatMap((pool, row) => pool.map((die, index) => {
    const direction = row % 2 ? -1 : 1;
    const center = height * 0.49 + (row - (pools.length - 1) / 2) * lane;
    const bounds = [width * 0.07, width * 0.93, center - lane / 2, center + lane / 2];
    const x = reducedMotion ? width / 2 + (index - (pool.length - 1) / 2) * scale * 3
      : (direction > 0 ? bounds[0] : bounds[1]) + direction * scale * (2 + index * 3.2);
    return {
      ...die, scale, bounds, row,
      p: [x, center + (Math.random() - 0.5) * scale, scale * (2.5 + Math.random())],
      v: [direction * width * (0.75 + Math.random() * 0.45), (Math.random() - 0.5) * lane * 2, 90],
      w: [(Math.random() - 0.5) * 14, direction * (9 + Math.random() * 9), (Math.random() - 0.5) * 12],
      q: unit([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, 0.5]),
      inertia: 1.6 / (scale * scale), quiet: 0, asleep: false
    };
  }));
}

function impulse(body, offset, force) {
  body.v = add(body.v, force);
  body.w = add(body.w, mul(cross(offset, force), body.inertia));
}

function velocityAt(body, offset) {
  return add(body.v, cross(body.w, offset));
}

function effectiveMass(body, offset, axis) {
  return 1 + body.inertia * dot(cross(offset, axis), cross(offset, axis));
}

function planeContact(body, offset, normal, depth) {
  const speed = dot(velocityAt(body, offset), normal);
  const bounce = speed < -85 ? 0.36 : 0;
  const force = Math.max(0, -(1 + bounce) * speed + Math.max(0, depth - 0.15) * 25)
    / effectiveMass(body, offset, normal);
  impulse(body, offset, mul(normal, force));
  const v = velocityAt(body, offset);
  const tangent = sub(v, mul(normal, dot(v, normal)));
  const slip = length(tangent);
  if (slip > 0.01) {
    const axis = mul(tangent, 1 / slip);
    impulse(body, offset, mul(axis, -Math.min(force * 0.58, slip / effectiveMass(body, offset, axis))));
  }
}

function makeHull(die) {
  return {
    die,
    points: VERTICES.map(point => mul(rotate(die.q, point), die.scale)),
    normals: PLANES.map(normal => rotate(die.q, normal))
  };
}

function contactWithTray(hull) {
  const {die, points} = hull;
  const [left, right, top, bottom] = die.bounds;
  for (const [normal, limit] of [[UP, 0], [[1, 0, 0], left], [[-1, 0, 0], -right],
    [[0, 1, 0], top], [[0, -1, 0], -bottom]]) {
    let deepest = 0;
    for (const offset of points) {
      const depth = limit - dot(add(die.p, offset), normal);
      if (depth <= 0) continue;
      planeContact(die, offset, normal, depth);
      deepest = Math.max(deepest, depth);
    }
    if (deepest > 0.15) die.p = add(die.p, mul(normal, (deepest - 0.15) * 0.7));
  }
}

function vertexContact(a, b) {
  let contact;
  const delta = sub(a.die.p, b.die.p);
  for (const offset of a.points) {
    const point = add(delta, offset);
    let depth = Infinity;
    let axis;
    for (let i = 0; i < b.normals.length; i++) {
      const distance = OFFSETS[i] * b.die.scale - dot(point, b.normals[i]);
      depth = Math.min(depth, distance);
      if (depth <= 0) break;
      if (distance === depth) axis = b.normals[i];
    }
    if (depth > (contact?.depth ?? 0)) contact = {offset, point, depth, axis};
  }
  return contact;
}

function collide(a, b) {
  if (a.die.held || b.die.held || (a.die.asleep && b.die.asleep)) return;
  if (a.die.row !== b.die.row && !a.die.played && !b.die.played) return;
  if (length(sub(a.die.p, b.die.p)) > 1.75 * (a.die.scale + b.die.scale)) return;
  const forward = vertexContact(a, b);
  const reverse = vertexContact(b, a);
  if (!forward && !reverse) return;
  const swap = (reverse?.depth ?? 0) > (forward?.depth ?? 0);
  if (swap) [a, b] = [b, a];
  const {offset, point, depth, axis} = swap ? reverse : forward;
  const correction = mul(axis, Math.max(0, depth - 0.35) * 0.16);
  a.die.p = add(a.die.p, correction);
  b.die.p = sub(b.die.p, correction);
  const speed = dot(sub(velocityAt(a.die, offset), velocityAt(b.die, point)), axis);
  const magnitude = Math.max(0, -1.35 * speed + depth * 22)
    / (effectiveMass(a.die, offset, axis) + effectiveMass(b.die, point, axis));
  if (magnitude < 0.1 || (depth < 0.8 && Math.abs(speed) < 12 && (a.die.asleep || b.die.asleep))) return;
  if (a.die.asleep) a.die.quiet = 0;
  if (b.die.asleep) b.die.quiet = 0;
  a.die.asleep = b.die.asleep = false;
  impulse(a.die, offset, mul(axis, magnitude));
  impulse(b.die, point, mul(axis, -magnitude));
}

export function stepDice(dice) {
  for (const die of dice) {
    if (die.asleep || die.held) continue;
    die.v[2] -= 1650 * STEP;
    die.p = add(die.p, mul(die.v, STEP));
    die.q = unit(add(die.q, mul(multiply([...die.w, 0], die.q), STEP / 2)));
    die.w = mul(die.w, Math.exp(-STEP * (die.p[2] < die.scale * 1.5 ? 2.6 : 0.3)));
  }

  const hulls = dice.map(makeHull);
  for (const hull of hulls) {
    if (!hull.die.asleep && !hull.die.held) contactWithTray(hull);
  }
  for (let i = 0; i < hulls.length; i++) {
    for (let j = i + 1; j < hulls.length; j++) collide(hulls[i], hulls[j]);
  }
  for (const die of dice) {
    if (die.asleep || die.held) continue;
    const normal = rotate(die.q, NORMALS[faceUp(die.q)]);
    if (die.p[2] < die.scale * 1.05 && normal[2] > 0.998 && length(die.v) < 24 && length(die.w) < 0.65) {
      if (++die.quiet >= 10) {
        die.asleep = true;
        die.v = die.w = [0, 0, 0];
      }
    } else {
      die.quiet = 0;
    }
  }
}

export function planDiceRoll(pools, width, height, reducedMotion) {
  if (!reducedMotion) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const dice = createDiceTray(pools, width, height, false);
      const simulation = dice.map(die => ({...die, v: [...die.v]}));
      const frames = [];
      for (let i = 0; i < 540 && !simulation.every(die => die.asleep); i++) {
        if (i === 335) {
          for (const die of simulation) {
            if (!die.asleep && length(die.v) < 35) {
              // Free a die that has come to rest leaning against another die.
              die.v[2] += 135;
              die.w[0] += 3;
            }
          }
        }
        stepDice(simulation);
        frames.push(simulation.map(({p, q}) => ({p, q})));
      }
      if (simulation.every(die => die.asleep)) {
        // Cube symmetries preserve the hull. Put the rolled mark on the winning
        // physical face before playback and keep it attached during interaction.
        return {dice, frames, marks: simulation.map(artworkRotation)};
      }
    }
  }
  const dice = createDiceTray(pools, width, height, true);
  for (const die of dice) {
    die.q = identity;
    die.p[2] = die.scale;
    die.asleep = true;
  }
  return {dice, frames: [], marks: dice.map(artworkRotation)};
}

export function tossDie(die, dx, dy, lift) {
  die.asleep = false;
  die.quiet = 0;
  die.v = [dx, dy, lift];
  die.w = [-dy / 36, dx / 36, lift ? (Math.random() - 0.5) * 8 : 0];
}
