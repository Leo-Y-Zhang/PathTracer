import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng.js';
import { decodeHdr, encodeHdr, floatToRgbe, rgbeToFloat } from '../src/hdr.js';

/** Build a minimal valid .hdr byte stream from header text + scanline bytes. */
function hdrFile(resolution: string, data: number[], extraHeader = ''): Uint8Array {
  const header = `#?RADIANCE\n${extraHeader}FORMAT=32-bit_rle_rgbe\n\n${resolution}\n`;
  return new Uint8Array([...Buffer.from(header, 'ascii'), ...data]);
}

describe('RGBE pixel conversion', () => {
  it('decodes known answers: shared exponent 129 with mantissa 128 is 1.0', () => {
    expect(rgbeToFloat(128, 0, 0, 129)).toEqual([1, 0, 0]);
    expect(rgbeToFloat(128, 128, 128, 128)).toEqual([0.5, 0.5, 0.5]);
    expect(rgbeToFloat(192, 64, 128, 130)).toEqual([3, 1, 2]);
  });

  it('a zero exponent is black regardless of the mantissas', () => {
    expect(rgbeToFloat(200, 10, 99, 0)).toEqual([0, 0, 0]);
  });

  it('encodes exact powers of two without loss', () => {
    expect(floatToRgbe(1, 0, 0)).toEqual([128, 0, 0, 129]);
    expect(floatToRgbe(0.5, 0.5, 0.5)).toEqual([128, 128, 128, 128]);
    expect(rgbeToFloat(...floatToRgbe(4, 2, 1))).toEqual([4, 2, 1]);
  });

  it('encodes tiny and non-positive values as black', () => {
    expect(floatToRgbe(0, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(floatToRgbe(-1, -2, -3)).toEqual([0, 0, 0, 0]);
    expect(floatToRgbe(1e-40, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('round-trips arbitrary radiances within 1/128 of the largest component', () => {
    const rng = new Rng(11);
    for (let i = 0; i < 2000; i++) {
      const r = rng.float() * Math.pow(10, rng.range(-3, 3));
      const g = rng.float() * r;
      const b = rng.float() * r;
      const [dr, dg, db] = rgbeToFloat(...floatToRgbe(r, g, b));
      const tol = Math.max(r, g, b) / 128;
      expect(Math.abs(dr - r)).toBeLessThanOrEqual(tol);
      expect(Math.abs(dg - g)).toBeLessThanOrEqual(tol);
      expect(Math.abs(db - b)).toBeLessThanOrEqual(tol);
    }
  });
});

describe('HDR file round-trip (encoder -> decoder)', () => {
  /** Radiance test pattern with flat regions (runs) and gradients (literals). */
  function pattern(width: number, height: number): Float64Array {
    const px = new Float64Array(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 3;
        if (x < width / 2) {
          // flat half: exercises RLE run packets
          px[i] = 2;
          px[i + 1] = 0.25;
          px[i + 2] = 8;
        } else {
          // gradient half: exercises literal packets
          px[i] = 0.1 + x / width;
          px[i + 1] = 0.1 + y / height;
          px[i + 2] = 12.5 * (1 + x);
        }
      }
    }
    return px;
  }

  it('round-trips an RLE-width image within RGBE precision', () => {
    const src = pattern(32, 8);
    const decoded = decodeHdr(encodeHdr(32, 8, src));
    expect(decoded.width).toBe(32);
    expect(decoded.height).toBe(8);
    for (let i = 0; i < src.length; i += 3) {
      const tol = Math.max(src[i]!, src[i + 1]!, src[i + 2]!) / 128;
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(decoded.pixels[i + c]! - src[i + c]!)).toBeLessThanOrEqual(tol);
      }
    }
  });

  it('round-trips a narrow (flat-scanline) image exactly like the RLE path', () => {
    const src = pattern(4, 4); // width < 8: encoder writes flat RGBE pixels
    const decoded = decodeHdr(encodeHdr(4, 4, src));
    expect(decoded.width).toBe(4);
    for (let i = 0; i < src.length; i += 3) {
      const tol = Math.max(src[i]!, src[i + 1]!, src[i + 2]!) / 128;
      expect(Math.abs(decoded.pixels[i]! - src[i]!)).toBeLessThanOrEqual(tol);
    }
  });

  it('a run longer than 127 splits into multiple run packets and round-trips', () => {
    const width = 300;
    const src = new Float64Array(width * 3).fill(1); // all-1.0 single row
    const decoded = decodeHdr(encodeHdr(width, 1, src));
    for (let i = 0; i < src.length; i++) expect(decoded.pixels[i]).toBe(1);
  });

  it('encoding is deterministic (identical bytes for identical input)', () => {
    const src = pattern(16, 4);
    expect(encodeHdr(16, 4, src).equals(encodeHdr(16, 4, src))).toBe(true);
  });

  it('rejects a mismatched pixel buffer length', () => {
    expect(() => encodeHdr(4, 4, new Float64Array(5))).toThrow(/length/);
  });
});

describe('HDR decoder format handling', () => {
  it('rejects a bad signature', () => {
    expect(() => decodeHdr(new Uint8Array(Buffer.from('#?NOPE\n\n-Y 1 +X 1\n')))).toThrow(/signature/);
  });

  it('rejects an unsupported FORMAT', () => {
    const bytes = new Uint8Array(Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_xyze\n\n-Y 1 +X 1\n'));
    expect(() => decodeHdr(bytes)).toThrow(/unsupported HDR format/);
  });

  it('rejects a missing FORMAT line', () => {
    const bytes = new Uint8Array(Buffer.from('#?RADIANCE\n\n-Y 1 +X 1\n'));
    expect(() => decodeHdr(bytes)).toThrow(/missing FORMAT/);
  });

  it('rejects a non-standard orientation', () => {
    const bytes = hdrFile('+Y 2 +X 2', []);
    expect(() => decodeHdr(bytes)).toThrow(/orientation/);
  });

  it('rejects truncated scanline data', () => {
    const bytes = hdrFile('-Y 1 +X 2', [128, 0, 0, 129]); // one pixel, two expected
    expect(() => decodeHdr(bytes)).toThrow(/truncated/);
  });

  it('ignores comment lines and applies EXPOSURE on decode', () => {
    // One flat pixel of 2.0 with EXPOSURE=4: decoded radiance must be 0.5.
    const bytes = hdrFile('-Y 1 +X 1', [...floatToRgbe(2, 2, 2)], '# a comment\nEXPOSURE=4\n');
    const d = decodeHdr(bytes);
    expect(d.pixels[0]).toBe(0.5);
    expect(d.pixels[1]).toBe(0.5);
    expect(d.pixels[2]).toBe(0.5);
  });

  it('decodes the old-style repeat marker (1,1,1,count)', () => {
    // Width 3, flat path: pixel A then (1,1,1,2) repeats A twice.
    const a = floatToRgbe(1, 2, 4);
    const bytes = hdrFile('-Y 1 +X 3', [...a, 1, 1, 1, 2]);
    const d = decodeHdr(bytes);
    expect(Array.from(d.pixels)).toEqual([1, 2, 4, 1, 2, 4, 1, 2, 4]);
  });

  it('rejects a repeat marker before any pixel', () => {
    const bytes = hdrFile('-Y 1 +X 2', [1, 1, 1, 2]);
    expect(() => decodeHdr(bytes)).toThrow(/repeat marker before any pixel/);
  });

  it('decodes a new-style RLE scanline written by an external encoder shape', () => {
    // Hand-built scanline for width 8: header (2,2,0,8) then four component
    // streams. R: run of 8 zeros; G: run of 8 128s; B: literals 0..7; E: run
    // of 8 exponent-129 bytes -> row of (0, 1, x/128-ish, ...) pixels.
    const data = [2, 2, 0, 8, 136, 0, 136, 128, 8, 0, 32, 64, 96, 128, 160, 192, 224, 136, 129];
    const d = decodeHdr(hdrFile('-Y 1 +X 8', data));
    expect(d.pixels[0]).toBe(0); // R
    expect(d.pixels[1]).toBe(1); // G = 128 * 2^(129-136)
    expect(d.pixels[2]).toBe(0); // B first literal
    expect(d.pixels[3 * 3 + 2]).toBe(0.75); // B literal 96 at x=3: 96 * 2^-7
  });
});
