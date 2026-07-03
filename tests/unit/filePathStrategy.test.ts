import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildOutputPath, extensionForContentType } from '../../src/storage/FilePathStrategy.js';

describe('FilePathStrategy', () => {
  it('maps extensions from Content-Type rather than URL', () => {
    expect(extensionForContentType('html', 'text/html; charset=utf-8')).toBe('.html');
    expect(extensionForContentType('pdf', 'application/pdf')).toBe('.pdf');
    expect(extensionForContentType('image', 'image/jpeg')).toBe('.jpg');
    expect(extensionForContentType('image', 'image/png')).toBe('.png');
    expect(extensionForContentType('image', 'image/gif')).toBe('.gif');
    expect(extensionForContentType('image', 'image/webp')).toBe('.webp');
    expect(extensionForContentType('image', 'image/avif')).toBe('.img');
    expect(extensionForContentType('video', 'video/mp4')).toBe('.mp4');
    expect(extensionForContentType('video', 'video/webm')).toBe('.webm');
    expect(extensionForContentType('video', 'video/quicktime')).toBe('.mov');
    expect(extensionForContentType('video', 'video/x-matroska')).toBe('.bin');
  });

  it('builds stable hash-sharded output paths', () => {
    const urlHash = 'abcdef1234567890';

    expect(
      buildOutputPath({
        outputDir: '/tmp/output',
        kind: 'html',
        urlHash,
        contentType: 'text/html',
      }),
    ).toBe(path.join('/tmp/output', 'html', 'ab', 'cd', `${urlHash}.html`));

    expect(
      buildOutputPath({
        outputDir: '/tmp/output',
        kind: 'image',
        urlHash,
        contentType: 'image/png',
      }),
    ).toBe(path.join('/tmp/output', 'images', 'ab', 'cd', `${urlHash}.png`));
  });
});
