import { describe, expect, it } from 'vitest';
import { BodyNormalizationError, normalizeBody } from '../../src/fetch/body.js';

describe('normalizeBody', () => {
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

  it('decodes base64 strings by default', () => {
    expect(normalizeBody(Buffer.from('hello').toString('base64'))).toEqual(Buffer.from('hello'));
  });

  it('supports utf8 string decoding', () => {
    expect(normalizeBody('hello', 'utf8')).toEqual(Buffer.from('hello'));
  });

  it('rejects invalid body values', () => {
    expect(() => normalizeBody({})).toThrow(BodyNormalizationError);
    expect(() => normalizeBody('not base64')).toThrow(BodyNormalizationError);
  });
});
