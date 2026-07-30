/**
 * Minimal dependency-free Radiance HDR (RGBE) codec, mirroring the in-tree
 * PNG codec: no outside code at all (RGBE needs no compression library).
 * Each pixel is stored as four bytes - three 8-bit mantissas sharing one
 * 8-bit exponent - giving a high-dynamic-range float image in 32 bits/pixel.
 *
 * Supported (the standard subset every tool writes): the `#?RADIANCE` /
 * `#?RGBE` signature, `FORMAT=32-bit_rle_rgbe`, an optional EXPOSURE line
 * (applied on decode), the `-Y h +X w` scanline order (top row first,
 * columns left to right), new-style RLE scanlines, flat scanlines, and the
 * old-style repeat marker. Other orientations are rejected with an error.
 */

export interface DecodedHdr {
  width: number;
  height: number;
  /** Row-major linear-radiance RGB triples, top row first. */
  pixels: Float64Array;
}

/**
 * Decode one RGBE pixel to linear RGB. The shared-exponent format stores
 * c = mantissa * 2^(e-136): exponent byte e is biased by 128 and the 8-bit
 * mantissa carries the remaining 2^-8. A zero exponent means black.
 */
export function rgbeToFloat(r: number, g: number, b: number, e: number): [number, number, number] {
  if (e === 0) return [0, 0, 0];
  const f = Math.pow(2, e - 136);
  return [r * f, g * f, b * f];
}

/**
 * Encode linear RGB as an RGBE pixel. The exponent is chosen from the
 * largest component (frexp), so the round-trip error is bounded by 1/256
 * of that component. Non-positive and denormal-small values encode as black.
 */
export function floatToRgbe(r: number, g: number, b: number): [number, number, number, number] {
  const v = Math.max(r, g, b);
  if (!(v >= 1e-32)) return [0, 0, 0, 0];
  // frexp: v = m * 2^e with m in [0.5, 1).
  let e = Math.ceil(Math.log2(v));
  if (v / Math.pow(2, e) >= 1) e++;
  if (v / Math.pow(2, e) < 0.5) e--;
  const scale = Math.pow(2, 8 - e);
  return [
    Math.min(255, Math.floor(Math.max(0, r) * scale)),
    Math.min(255, Math.floor(Math.max(0, g) * scale)),
    Math.min(255, Math.floor(Math.max(0, b) * scale)),
    e + 128,
  ];
}

/** New-style RLE applies only to this width range (per the Radiance sources). */
const MIN_RLE_WIDTH = 8;
const MAX_RLE_WIDTH = 32767;
/** Shortest byte run worth a run packet when encoding. */
const MIN_RUN = 4;

/**
 * Run-length encode one component scanline (new-style): a byte > 128 starts
 * a run of (byte - 128) copies of the next byte; a byte in 1..128 starts
 * that many literal bytes.
 */
function encodeRleComponent(data: Uint8Array, out: number[]): void {
  const n = data.length;
  let i = 0;
  while (i < n) {
    let run = 1;
    while (i + run < n && data[i + run] === data[i] && run < 127) run++;
    if (run >= MIN_RUN) {
      out.push(128 + run, data[i]!);
      i += run;
      continue;
    }
    const litStart = i;
    while (i < n && i - litStart < 128) {
      let ahead = 1;
      while (i + ahead < n && data[i + ahead] === data[i] && ahead < MIN_RUN) ahead++;
      if (ahead >= MIN_RUN) break;
      i++;
    }
    out.push(i - litStart);
    for (let j = litStart; j < i; j++) out.push(data[j]!);
  }
}

/** Decode one new-style RLE component scanline of `width` bytes. */
function decodeRleComponent(bytes: Uint8Array, pos: number, width: number): { data: Uint8Array; pos: number } {
  const data = new Uint8Array(width);
  let o = 0;
  while (o < width) {
    const code = bytes[pos++];
    if (code === undefined) throw new Error('HDR: truncated RLE scanline');
    if (code > 128) {
      const count = code - 128;
      const value = bytes[pos++];
      if (value === undefined) throw new Error('HDR: truncated RLE run');
      if (o + count > width) throw new Error('HDR: RLE run overflows scanline');
      data.fill(value, o, o + count);
      o += count;
    } else if (code > 0) {
      if (o + code > width) throw new Error('HDR: RLE literal overflows scanline');
      for (let i = 0; i < code; i++) {
        const value = bytes[pos++];
        if (value === undefined) throw new Error('HDR: truncated RLE literal');
        data[o++] = value;
      }
    } else {
      throw new Error('HDR: invalid RLE code 0');
    }
  }
  return { data, pos };
}

/**
 * Decode a Radiance .hdr / RGBE file to linear float RGB. Any EXPOSURE
 * headers are divided out, recovering the original radiance values.
 */
export function decodeHdr(bytes: Uint8Array): DecodedHdr {
  // --- header: signature, variable lines, blank line, resolution line ---
  let pos = 0;
  const readLine = (): string => {
    let end = pos;
    while (end < bytes.length && bytes[end] !== 0x0a) end++;
    if (end >= bytes.length) throw new Error('HDR: unterminated header line');
    let line = '';
    for (let i = pos; i < end; i++) line += String.fromCharCode(bytes[i]!);
    pos = end + 1;
    return line.endsWith('\r') ? line.slice(0, -1) : line;
  };

  const magic = readLine();
  if (magic !== '#?RADIANCE' && magic !== '#?RGBE') {
    throw new Error('not a Radiance HDR (bad signature)');
  }
  let formatSeen = false;
  let exposure = 1;
  for (;;) {
    const line = readLine();
    if (line === '') break;
    if (line.startsWith('#')) continue;
    if (line.startsWith('FORMAT=')) {
      const fmt = line.slice('FORMAT='.length).trim();
      if (fmt !== '32-bit_rle_rgbe') throw new Error(`unsupported HDR format "${fmt}"`);
      formatSeen = true;
    } else if (line.startsWith('EXPOSURE=')) {
      const e = Number(line.slice('EXPOSURE='.length).trim());
      if (!Number.isFinite(e) || e <= 0) throw new Error(`invalid HDR exposure "${line}"`);
      exposure *= e;
    }
    // Other variables (GAMMA, PRIMARIES, ...) are informational; ignored.
  }
  if (!formatSeen) throw new Error('HDR missing FORMAT=32-bit_rle_rgbe');

  const resolution = readLine();
  const m = /^-Y (\d+) \+X (\d+)$/.exec(resolution);
  if (!m) throw new Error(`unsupported HDR orientation "${resolution}" (only -Y h +X w)`);
  const height = Number(m[1]);
  const width = Number(m[2]);
  if (width <= 0 || height <= 0) throw new Error(`invalid HDR dimensions ${width}x${height}`);

  // --- scanlines ---
  const pixels = new Float64Array(width * height * 3);
  const invExposure = 1 / exposure;
  const rleCapable = width >= MIN_RLE_WIDTH && width <= MAX_RLE_WIDTH;
  /** Last flat pixel seen, for the old-style repeat marker (persists across rows). */
  let prev: [number, number, number, number] | null = null;
  let shift = 0;

  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(width * 4); // interleaved RGBE for this scanline
    const isNewRle =
      rleCapable &&
      bytes[pos] === 2 &&
      bytes[pos + 1] === 2 &&
      (((bytes[pos + 2] ?? 0) << 8) | (bytes[pos + 3] ?? 0)) === width;
    if (isNewRle) {
      pos += 4;
      for (let c = 0; c < 4; c++) {
        const r = decodeRleComponent(bytes, pos, width);
        pos = r.pos;
        for (let x = 0; x < width; x++) row[x * 4 + c] = r.data[x]!;
      }
    } else {
      // Flat RGBE pixels, with the old-style repeat marker (1,1,1,count):
      // repeat the previous pixel count times, shifted 8 bits per consecutive
      // marker.
      let x = 0;
      while (x < width) {
        const r = bytes[pos];
        const g = bytes[pos + 1];
        const b = bytes[pos + 2];
        const e = bytes[pos + 3];
        if (r === undefined || g === undefined || b === undefined || e === undefined) {
          throw new Error('HDR: truncated scanline data');
        }
        pos += 4;
        if (r === 1 && g === 1 && b === 1) {
          if (prev === null) throw new Error('HDR: repeat marker before any pixel');
          const count = e << shift;
          if (x + count > width) throw new Error('HDR: repeat overflows scanline');
          for (let i = 0; i < count; i++) row.set(prev, (x + i) * 4);
          x += count;
          shift += 8;
        } else {
          prev = [r, g, b, e];
          row.set(prev, x * 4);
          x++;
          shift = 0;
        }
      }
    }
    for (let x = 0; x < width; x++) {
      const [r, g, b] = rgbeToFloat(row[x * 4]!, row[x * 4 + 1]!, row[x * 4 + 2]!, row[x * 4 + 3]!);
      const i = (y * width + x) * 3;
      pixels[i] = r * invExposure;
      pixels[i + 1] = g * invExposure;
      pixels[i + 2] = b * invExposure;
    }
  }
  return { width, height, pixels };
}

/**
 * Encode linear float RGB (length = width * height * 3, top row first) as a
 * Radiance .hdr file. Widths in the RLE range get new-style RLE scanlines;
 * others are written flat. Deterministic: output depends only on the input.
 */
export function encodeHdr(width: number, height: number, pixels: Float64Array | number[]): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`invalid HDR dimensions ${width}x${height}`);
  }
  if (pixels.length !== width * height * 3) {
    throw new Error(`pixel buffer length ${pixels.length} != ${width * height * 3}`);
  }

  const header = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`;
  const out: number[] = [];
  const rle = width >= MIN_RLE_WIDTH && width <= MAX_RLE_WIDTH;
  const component = new Uint8Array(width);
  const row = new Uint8Array(width * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const [r, g, b, e] = floatToRgbe(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!);
      row[x * 4] = r;
      row[x * 4 + 1] = g;
      row[x * 4 + 2] = b;
      row[x * 4 + 3] = e;
    }
    if (rle) {
      out.push(2, 2, (width >> 8) & 0xff, width & 0xff);
      for (let c = 0; c < 4; c++) {
        for (let x = 0; x < width; x++) component[x] = row[x * 4 + c]!;
        encodeRleComponent(component, out);
      }
    } else {
      for (let i = 0; i < row.length; i++) out.push(row[i]!);
    }
  }
  return Buffer.concat([Buffer.from(header, 'ascii'), Buffer.from(out)]);
}
