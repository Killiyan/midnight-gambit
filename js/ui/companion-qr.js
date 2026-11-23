// QR Model 2, version 10-L, byte mode. The fixed version fits companion URLs
// up to 271 UTF-8 bytes and keeps the encoder independent of external services.
export function companionQrSvg(value) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > 271) return "";
  const data = [];
  const bits = [];
  const append = (number, width) => {
    for (let i = width - 1; i >= 0; i--) bits.push((number >>> i) & 1);
  };
  append(4, 4);
  append(bytes.length, 16);
  for (const byte of bytes) append(byte, 8);
  append(0, 4);
  while (bits.length % 8) bits.push(0);
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
  }
  for (let i = 0; data.length < 274; i++) data.push(i % 2 ? 17 : 236);

  // Reed–Solomon: two 68-byte and two 69-byte blocks, each with 18 check bytes.
  const multiply = (a, b) => {
    let result = 0;
    for (; b; b >>>= 1) {
      if (b & 1) result ^= a;
      a = (a << 1) ^ (a & 128 ? 285 : 0);
    }
    return result;
  };
  let polynomial = [1];
  for (let i = 0, root = 1; i < 18; i++, root = multiply(root, 2)) {
    const next = [...polynomial, 0];
    polynomial.forEach((coefficient, index) => next[index + 1] ^= multiply(coefficient, root));
    polynomial = next;
  }
  const blocks = [data.slice(0, 68), data.slice(68, 136), data.slice(136, 205), data.slice(205)];
  const checks = blocks.map(block => {
    const remainder = [...block, ...Array(18).fill(0)];
    block.forEach((_, i) => {
      const factor = remainder[i];
      polynomial.forEach((coefficient, j) => remainder[i + j] ^= multiply(coefficient, factor));
    });
    return remainder.slice(-18);
  });
  const stream = [];
  for (const group of [blocks, checks]) {
    for (let i = 0; i < group.at(-1).length; i++) {
      for (const block of group) if (i < block.length) stream.push(block[i]);
    }
  }

  const size = 57;
  const matrix = Array.from({ length: size }, () => Array(size).fill(null));
  const set = (x, y, dark) => {
    if (x >= 0 && x < size && y >= 0 && y < size) matrix[y][x] = Boolean(dark);
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [x, y] of [[3, 3], [53, 3], [3, 53]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const radius = Math.max(Math.abs(dx), Math.abs(dy));
        set(x + dx, y + dy, radius !== 2 && radius !== 4);
      }
    }
  }
  for (const [x, y] of [[28, 6], [6, 28], [28, 28], [50, 28], [28, 50], [50, 50]]) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  const format = 0x77c4; // Level L, mask 0.
  const bit = (word, i) => (word >>> i) & 1;
  for (let i = 0; i < 15; i++) {
    if (i < 6) set(8, i, bit(format, i));
    else if (i < 8) set(8, i + 1, bit(format, i));
    else if (i === 8) set(7, 8, bit(format, i));
    else set(14 - i, 8, bit(format, i));
    if (i < 8) set(size - 1 - i, 8, bit(format, i));
    else set(8, size - 15 + i, bit(format, i));
  }
  set(8, size - 8, true);
  const version = 0x0a4d3;
  for (let i = 0; i < 18; i++) {
    const x = size - 11 + i % 3;
    const y = Math.floor(i / 3);
    set(x, y, bit(version, i));
    set(y, x, bit(version, i));
  }
  let index = 0;
  let upwards = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--;
    for (let row = 0; row < size; row++) {
      const y = upwards ? size - 1 - row : row;
      for (let x = right; x >= right - 1; x--) {
        if (matrix[y][x] !== null) continue;
        set(x, y, bit(stream[index >>> 3], 7 - (index++ % 8)) ^ Number((x + y) % 2 === 0));
      }
    }
    upwards = !upwards;
  }
  const path = matrix.flatMap((row, y) => row.map((dark, x) => dark ? `M${x + 4} ${y + 4}h1v1h-1z` : "")).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 65 65" width="260" height="260" shape-rendering="crispEdges" role="img" aria-label="Companion link QR code"><rect width="65" height="65" fill="white"/><path d="${path}" fill="black"/></svg>`;
}
