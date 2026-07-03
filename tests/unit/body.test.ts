import { describe, expect, it } from 'vitest';
import { BodyNormalizationError, normalizeBody } from '../../src/fetch/body.js';

describe('normalizeBody', () => {
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it('passes null through', () => {
    expect(normalizeBody(null)).toBeNull();
  });

  it('passes Buffer through', () => {
    const body = Buffer.from('hello');
    expect(normalizeBody(body)).toBe(body);
  });

  it('converts Uint8Array to Buffer', () => {
    expect(normalizeBody(new Uint8Array([104, 105]))).toEqual(Buffer.from('hi'));
  });

  it('decodes textual content as UTF-8 in auto mode', () => {
    const html = '<html><body>hi</body></html>';

    expect(normalizeBody(html, 'auto', 'text/html; charset=utf-8')).toEqual(
      Buffer.from(html, 'utf8'),
    );
  });

  it('decodes binary-looking base64 content in auto mode', () => {
    expect(normalizeBody(pngBytes.toString('base64'), 'auto', 'image/png')).toEqual(pngBytes);
  });

  it('falls back to UTF-8 for non-base64 strings without Content-Type in auto mode', () => {
    expect(normalizeBody('<html>', 'auto')).toEqual(Buffer.from('<html>', 'utf8'));
  });

  it('decodes valid base64 strings without Content-Type in auto mode', () => {
    expect(normalizeBody(Buffer.from('hello').toString('base64'), 'auto')).toEqual(
      Buffer.from('hello'),
    );
  });

  it('supports utf8 string decoding', () => {
    const base64Looking = Buffer.from('hello').toString('base64');

    expect(normalizeBody(base64Looking, 'utf8')).toEqual(Buffer.from(base64Looking));
  });

  it('strictly validates explicit base64 string decoding', () => {
    expect(normalizeBody(pngBytes.toString('base64'), 'base64')).toEqual(pngBytes);
    expect(() => normalizeBody('<html>', 'base64')).toThrow(BodyNormalizationError);
  });

  it('rejects invalid body values', () => {
    expect(() => normalizeBody({})).toThrow(BodyNormalizationError);
  });
});
