import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { GAMMA, PNG_SIGNATURE, crc32, encodePng, toneMap } from '../src/png.js';

interface Chunk {
  type: string;
  data: Buffer;
  storedCrc: number;
}

function readChunks(png: Buffer): Chunk[] {
  const chunks: Chunk[] = [];
  let off = 8;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.subarray(off + 4, off + 8).toString('ascii');
    const data = png.subarray(off + 8, off + 8 + len);
    const storedCrc = png.readUInt32BE(off + 8 + len);
    chunks.push({ type, data: Buffer.from(data), storedCrc });
    off += 12 + len;
  }
  return chunks;
}

describe('crc32 (known-answer tests)', () => {
  it('matches the classic check value for "123456789"', () => {
    expect(crc32(Buffer.from('123456789', 'ascii'))).toBe(0xcbf43926);
  });

  it('matches the well-known IEND chunk CRC', () => {
    expect(crc32(Buffer.from('IEND', 'ascii'))).toBe(0xae426082);
  });

  it('empty input hashes to 0', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('encodePng', () => {
  const rgb = new Uint8Array([255, 0, 0, 0, 255, 0]); // 2x1: red, green
  const png = encodePng(2, 1, rgb);

  it('starts with the 8-byte PNG signature', () => {
    expect([...png.subarray(0, 8)]).toEqual([...PNG_SIGNATURE]);
  });

  it('IHDR declares the right dimensions, bit depth 8, colour type 2 (RGB)', () => {
    const ihdr = readChunks(png)[0]!;
    expect(ihdr.type).toBe('IHDR');
    expect(ihdr.data.length).toBe(13);
    expect(ihdr.data.readUInt32BE(0)).toBe(2); // width
    expect(ihdr.data.readUInt32BE(4)).toBe(1); // height
    expect(ihdr.data[8]).toBe(8); // bit depth
    expect(ihdr.data[9]).toBe(2); // colour type
    expect(ihdr.data[10]).toBe(0); // compression
    expect(ihdr.data[11]).toBe(0); // filter
    expect(ihdr.data[12]).toBe(0); // interlace
  });

  it('every chunk CRC validates against our own crc32 over type+data', () => {
    const chunks = readChunks(png);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    for (const c of chunks) {
      const typeAndData = Buffer.concat([Buffer.from(c.type, 'ascii'), c.data]);
      expect(crc32(typeAndData)).toBe(c.storedCrc);
    }
  });

  it('IDAT inflates to filter-byte-prefixed scanlines with the exact pixels', () => {
    const idat = readChunks(png).find((c) => c.type === 'IDAT')!;
    const raw = inflateSync(idat.data);
    expect([...raw]).toEqual([0, 255, 0, 0, 0, 255, 0]); // filter 0 + RGB RGB
  });

  it('handles non-square images (5x3 roundtrip via IHDR)', () => {
    const buf = new Uint8Array(5 * 3 * 3).fill(128);
    const out = encodePng(5, 3, buf);
    const ihdr = readChunks(out)[0]!;
    expect(ihdr.data.readUInt32BE(0)).toBe(5);
    expect(ihdr.data.readUInt32BE(4)).toBe(3);
    const raw = inflateSync(readChunks(out).find((c) => c.type === 'IDAT')!.data);
    expect(raw.length).toBe(3 * (1 + 5 * 3));
  });

  it('rejects a mismatched pixel buffer', () => {
    expect(() => encodePng(2, 2, new Uint8Array(3))).toThrow(/length/);
  });
});

describe('toneMap (gamma 2.2)', () => {
  it('uses gamma 2.2 with hand-computed anchor values', () => {
    expect(GAMMA).toBe(2.2);
    const out = toneMap(new Float64Array([0, 1, 0.5, 0.2]));
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(255);
    expect(out[2]).toBe(Math.round(255 * Math.pow(0.5, 1 / 2.2))); // 186
    expect(out[2]).toBe(186);
    expect(out[3]).toBe(Math.round(255 * Math.pow(0.2, 1 / 2.2))); // 123
  });

  it('clamps out-of-range and non-finite radiance', () => {
    const out = toneMap(new Float64Array([-0.5, 2.0, Number.NaN, Number.POSITIVE_INFINITY]));
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(255);
    expect(out[2]).toBe(0);
    expect(out[3]).toBe(255);
  });
});
