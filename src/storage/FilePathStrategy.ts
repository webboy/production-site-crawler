import path from 'node:path';

export type ContentKind = 'html' | 'image' | 'video' | 'pdf';

export interface BuildOutputPathInput {
  outputDir: string;
  kind: ContentKind;
  urlHash: string;
  contentType: string;
}

const KIND_DIRECTORY: Record<ContentKind, string> = {
  html: 'html',
  image: 'images',
  video: 'videos',
  pdf: 'pdfs',
};

export function normalizeContentType(contentType: string): string {
  return contentType.split(';')[0]?.trim().toLowerCase() ?? contentType.toLowerCase();
}

export function extensionForContentType(kind: ContentKind, contentType: string): string {
  const normalized = normalizeContentType(contentType);

  switch (kind) {
    case 'html':
      return '.html';
    case 'pdf':
      return '.pdf';
    case 'image':
      if (normalized === 'image/jpeg') {
        return '.jpg';
      }
      if (normalized === 'image/png') {
        return '.png';
      }
      if (normalized === 'image/gif') {
        return '.gif';
      }
      if (normalized === 'image/webp') {
        return '.webp';
      }
      return '.img';
    case 'video':
      if (normalized === 'video/mp4') {
        return '.mp4';
      }
      if (normalized === 'video/webm') {
        return '.webm';
      }
      if (normalized === 'video/quicktime') {
        return '.mov';
      }
      return '.bin';
  }
}

export function buildOutputPath(input: BuildOutputPathInput): string {
  const extension = extensionForContentType(input.kind, input.contentType);
  const shardOne = input.urlHash.slice(0, 2);
  const shardTwo = input.urlHash.slice(2, 4);

  return path.join(
    input.outputDir,
    KIND_DIRECTORY[input.kind],
    shardOne,
    shardTwo,
    `${input.urlHash}${extension}`,
  );
}
