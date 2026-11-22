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
const COIN_THICKNESS = 0.1;
const coinOutline = Array.from({length: 16}, (_, i) => {
  const angle = i * Math.PI / 8;
  return [Math.cos(angle), Math.sin(angle)];
});
const coinFaces = [
  ([u, v]) => [u, v, COIN_THICKNESS],
  ([u, v]) => [-u, v, -COIN_THICKNESS]
];
const coinRim = coinOutline.map(([x, y], i) => {
  const [nx, ny] = coinOutline[(i + 1) % coinOutline.length];
  return [[nx, ny, COIN_THICKNESS], [x, y, COIN_THICKNESS],
    [x, y, -COIN_THICKNESS], [nx, ny, -COIN_THICKNESS]];
});
const coinNormals = [[0, 0, 1], [0, 0, -1]];
export const DICE_SHAPES = {
  2: {
    faces: coinFaces, outline: coinOutline, sides: coinRim, vertices: coinFaces.flatMap(face => coinOutline.map(face)),
    normals: coinNormals,
    planes: [...coinNormals, ...coinOutline.map((_, i) => {
      const angle = (i + 0.5) * Math.PI / 8;
      return [Math.cos(angle), Math.sin(angle), 0];
    })],
    offsets: [COIN_THICKNESS, COIN_THICKNESS, ...coinOutline.map(() => Math.cos(Math.PI / 16))],
    restHeight: COIN_THICKNESS
  },
  6: {faces: FACES, outline: OUTLINE, sides: CORNERS, vertices: VERTICES,
    normals: NORMALS, planes: PLANES, offsets: OFFSETS, restHeight: 1}
};
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

// Each face omits the vertex directly opposite it. That vertex reads the result.
const d4Vertices = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map(v => mul(v, 0.9));
const d4Normals = d4Vertices.map(v => mul(unit(v), -1));
const d4Corners = d4Vertices.map((_, opposite) => {
  const indices = [0, 1, 2, 3].filter(index => index !== opposite);
  const [a, b, c] = indices.map(index => d4Vertices[index]);
  if (dot(cross(sub(b, a), sub(c, a)), d4Normals[opposite]) < 0) indices.reverse();
  return indices;
});
const triangleHeight = Math.sqrt(3) / 2;
const triangleOutline = [[0, -triangleHeight], [1, triangleHeight], [-1, triangleHeight]];

function triangleFace(a, b, c) {
  const base = mul(add(b, c), 0.5);
  return ([u, v]) => add(add(base, mul(sub(b, c), u / 2)), mul(sub(a, base), (1 - v / triangleHeight) / 2));
}

DICE_SHAPES[4] = {
  outline: triangleOutline,
  faces: d4Corners.map(indices => triangleFace(...indices.map(index => d4Vertices[index]))),
  corners: d4Corners, sides: [], vertices: d4Vertices,
  normals: d4Normals, planes: d4Normals, offsets: d4Normals.map(() => 0.9 / Math.sqrt(3)),
  restHeight: 0.9 / Math.sqrt(3)
};

const D8_RADIUS = 1.55;
const d8Half = [[1, 1, 1], [-1, 1, 1], [-1, -1, 1], [1, -1, 1]];
const d8Directions = [...d8Half, ...d8Half.slice().reverse().map(v => mul(v, -1))];
const d8Normals = d8Directions.map(unit);
const d8RestHeight = D8_RADIUS / Math.sqrt(3);
DICE_SHAPES[8] = {
  outline: triangleOutline,
  faces: d8Directions.map(([x, y, z]) => {
    const a = [0, 0, z * D8_RADIUS];
    const b = [x * D8_RADIUS, 0, 0];
    const c = [0, y * D8_RADIUS, 0];
    return x * y * z > 0 ? triangleFace(a, b, c) : triangleFace(a, c, b);
  }),
  sides: [],
  vertices: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
    .map(v => mul(v, D8_RADIUS)),
  normals: d8Normals,
  planes: d8Normals,
  offsets: d8Normals.map(() => d8RestHeight),
  restHeight: d8RestHeight
};
const D10_TIP = 1.48;
const D10_RING = 1.25;
const D10_STEP = Math.PI * 2 / 5;
const d10Cos = Math.cos(D10_STEP / 2);
const d10Rise = D10_TIP * (1 - d10Cos) / (1 + d10Cos);
const d10Ring = Array.from({length: 10}, (_, i) => {
  const angle = i * D10_STEP / 2;
  return [D10_RING * Math.cos(angle), D10_RING * Math.sin(angle), i % 2 ? d10Rise : -d10Rise];
});
const d10Tips = [[0, 0, D10_TIP], [0, 0, -D10_TIP]];
const d10Kites = [0, 2, 4, 6, 8, 3, 1, 9, 7, 5].map(i => {
  const tip = d10Tips[i % 2];
  const foot = d10Ring[i];
  const right = d10Ring[(i + (i % 2 ? 1 : 9)) % 10];
  const left = d10Ring[(i + (i % 2 ? 9 : 1)) % 10];
  const vertical = sub(foot, tip);
  const horizontal = mul(sub(right, left), 0.5);
  const normal = unit(cross(horizontal, vertical));
  return {
    normal,
    shoulder: 2 * dot(sub(right, tip), vertical) / dot(vertical, vertical) - 1,
    face: ([u, v]) => add(add(tip, mul(vertical, (1 + v) / 2)), mul(horizontal, u))
  };
});
const d10Normals = d10Kites.map(kite => kite.normal);
const d10RestHeight = dot(d10Normals[0], d10Tips[0]);
DICE_SHAPES[10] = {
  outline: [[0, -1], [1, d10Kites[0].shoulder], [0, 1], [-1, d10Kites[0].shoulder]],
  faces: d10Kites.map(kite => kite.face),
  sides: [],
  vertices: [...d10Tips, ...d10Ring],
  normals: d10Normals,
  planes: d10Normals,
  offsets: d10Normals.map(() => d10RestHeight),
  restHeight: d10RestHeight
};

const PHI = (1 + Math.sqrt(5)) / 2;
const cycle = ([x, y, z]) => [[x, y, z], [z, x, y], [y, z, x]];
const d12Vertices = [...d4Vertices.map(v => mul(v, 1 / 0.9)),
  ...d4Vertices.map(v => mul(v, -1 / 0.9)),
  ...[-1, 1].flatMap(a => [-1, 1].flatMap(b => cycle([0, a / PHI, b * PHI])))]
  .map(v => mul(v, 1.55 / Math.sqrt(3)));
const d12Half = [-1, 1].flatMap(sign => cycle([0, PHI, sign])).map(unit);
const d12Normals = [...d12Half, ...d12Half.slice().reverse().map(n => mul(n, -1))];
const d12RestHeight = Math.max(...d12Vertices.map(v => dot(v, d12Normals[0])));
const d12Frames = d12Normals.map(normal => {
  const center = mul(normal, d12RestHeight);
  const vertex = d12Vertices.find(v => Math.abs(dot(v, normal) - d12RestHeight) < 1e-8);
  const down = sub(center, vertex);
  const right = cross(down, normal);
  return {center, down, right};
});
DICE_SHAPES[12] = {
  outline: Array.from({length: 5}, (_, i) => {
    const angle = i * 2 * Math.PI / 5;
    return [Math.sin(angle), -Math.cos(angle)];
  }),
  faces: d12Frames.map(({center, right, down}) => ([u, v]) => add(center, add(mul(right, u), mul(down, v)))),
  sides: [],
  vertices: d12Vertices,
  normals: d12Normals,
  planes: d12Normals,
  offsets: d12Normals.map(() => d12RestHeight),
  restHeight: d12RestHeight
};

const d20Vertices = d12Normals.map(normal => mul(normal, 1.55));
const d20Half = d12Vertices.filter(v => (v.find(x => x !== 0) ?? 0) > 0).map(unit);
const d20Normals = [...d20Half, ...d20Half.slice().reverse().map(n => mul(n, -1))];
const d20RestHeight = Math.max(...d20Vertices.map(v => dot(v, d20Normals[0])));
DICE_SHAPES[20] = {
  outline: triangleOutline,
  faces: d20Normals.map(normal => {
    const [a, b, c] = d20Vertices.filter(v => Math.abs(dot(v, normal) - d20RestHeight) < 1e-8);
    return dot(cross(sub(b, a), sub(c, a)), normal) > 0
      ? triangleFace(a, b, c) : triangleFace(a, c, b);
  }),
  sides: [],
  vertices: d20Vertices,
  normals: d20Normals,
  planes: d20Normals,
  offsets: d20Normals.map(() => d20RestHeight),
  restHeight: d20RestHeight
};

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

function faceUp({q, shape}) {
  const sign = shape.corners ? -1 : 1;
  return shape.normals.reduce((best, n, i) => sign * (rotate(q, n)[2] - rotate(q, shape.normals[best])[2]) > 0 ? i : best, 0);
}

function artworkRotation(die) {
  if (die.sides === 4) {
    const from = die.value - 1;
    const to = faceUp(die);
    if (from === to) return identity;
    const axis = unit(add(d4Vertices[from], d4Vertices[to]));
    return [...axis, 0];
  }
  if (die.sides === 8) {
    const from = d8Normals[die.value - 1];
    const to = d8Normals[faceUp(die)];
    const similarity = dot(from, to);
    if (similarity > 0.9999) return identity;
    // These half-turn axes preserve the octahedron's signed coordinate axes.
    const axis = similarity < -0.9999 ? [from[1], -from[0], 0] : add(from, to);
    return [...unit(axis), 0];
  }
  const from = die.shape.normals[die.value - 1];
  const landingFace = faceUp(die);
  const to = die.shape.normals[landingFace];
  if (die.sides === 12 || die.sides === 20) {
    const {shape} = die;
    const normalRotation = align(from, to);
    const tipDirection = index => sub(shape.faces[index](shape.outline[0]),
      mul(shape.normals[index], shape.restHeight));
    const a = unit(rotate(normalRotation, tipDirection(die.value - 1)));
    const b = unit(tipDirection(landingFace));
    const halfAngle = Math.atan2(dot(to, cross(a, b)), dot(a, b)) / 2;
    return multiply([...mul(to, Math.sin(halfAngle)), Math.cos(halfAngle)], normalRotation);
  }
  if (die.sides === 10) {
    const a = Math.atan2(from[1], from[0]);
    const b = Math.atan2(to[1], to[0]);
    if (from[2] * to[2] > 0) return [0, 0, Math.sin((b - a) / 2), Math.cos((b - a) / 2)];
    return [Math.cos((a + b) / 2), Math.sin((a + b) / 2), 0, 0];
  }
  return align(from, to);
}

export function createDiceTray(pools, width, height, reducedMotion) {
  const lane = height * 0.60 / pools.length;
  const scale = Math.min(40, width * 0.19 / Math.max(...pools.map(pool => pool.length)), lane * 0.16);
  return pools.flatMap((pool, row) => pool.map((die, index) => {
    const direction = row % 2 ? -1 : 1;
    const center = height * 0.49 + (row - (pools.length - 1) / 2) * lane;
    const bounds = [width * 0.07, width * 0.93, center - lane / 2, center + lane / 2];
    const x = reducedMotion ? width / 2 + (index - (pool.length - 1) / 2) * scale * 3
      : (direction > 0 ? bounds[0] : bounds[1]) + direction * scale * (2 + index * 3.2);
    const coin = die.sides === 2;
    return {
      ...die, shape: DICE_SHAPES[die.sides ?? 6], scale, bounds, row,
      p: [x, center + (Math.random() - 0.5) * scale, scale * (2.5 + Math.random())],
      v: [direction * width * (0.75 + Math.random() * 0.45), (Math.random() - 0.5) * lane * 2, coin ? 185 : 90],
      w: [(Math.random() - 0.5) * 14, direction * ((coin ? 18 : 9) + Math.random() * 9), (Math.random() - 0.5) * 12],
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
    points: die.shape.vertices.map(point => mul(rotate(die.q, point), die.scale)),
    normals: die.shape.planes.map(normal => rotate(die.q, normal))
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
      const distance = b.die.shape.offsets[i] * b.die.scale - dot(point, b.normals[i]);
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
    const normal = rotate(die.q, die.shape.normals[faceUp(die)]);
    if (die.p[2] < die.scale * (die.shape.restHeight + 0.05) && Math.abs(normal[2]) > 0.998 && length(die.v) < 24 && length(die.w) < 0.65) {
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
        // Shape symmetries preserve the hull. Put the rolled mark on the winning
        // physical face before playback and keep it attached during interaction.
        return {dice, frames, marks: simulation.map(artworkRotation)};
      }
    }
  }
  const dice = createDiceTray(pools, width, height, true);
  for (const die of dice) {
    die.q = die.sides === 4 ? align(d4Normals[0], [0, 0, -1])
      : die.sides >= 8 ? align(die.shape.normals[0], UP) : identity;
    die.p[2] = die.scale * die.shape.restHeight;
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
