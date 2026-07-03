import { describe, expect, it } from 'vitest';
import { HandlerRegistry } from '../../src/content/HandlerRegistry.js';
import { HtmlHandler } from '../../src/content/HtmlHandler.js';
import { ImageHandler } from '../../src/content/ImageHandler.js';
import { PdfHandler } from '../../src/content/PdfHandler.js';
import { VideoHandler } from '../../src/content/VideoHandler.js';

describe('HandlerRegistry', () => {
  const registry = new HandlerRegistry([
    new HtmlHandler(),
    new ImageHandler(),
    new VideoHandler(),
    new PdfHandler(),
  ]);

  it('selects handlers by normalized Content-Type', () => {
    expect(registry.find('text/html; charset=utf-8')?.kind).toBe('html');
    expect(registry.find('image/png')?.kind).toBe('image');
    expect(registry.find('application/pdf')?.kind).toBe('pdf');
    expect(registry.find('video/mp4')?.kind).toBe('video');
    expect(registry.find('video/custom')?.kind).toBe('video');
  });

  it('returns null for unsupported content types', () => {
    expect(registry.find('application/octet-stream')).toBeNull();
    expect(registry.find('text/plain')).toBeNull();
  });
});
