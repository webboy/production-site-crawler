import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildOutputPath, type ContentKind } from './FilePathStrategy.js';

export class OutputStorage {
  constructor(private readonly outputDir: string) {}

  async save(
    kind: ContentKind,
    urlHash: string,
    contentType: string,
    body: Buffer,
  ): Promise<{ filePath: string }> {
    const filePath = buildOutputPath({
      outputDir: this.outputDir,
      kind,
      urlHash,
      contentType,
    });

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body);

    return { filePath };
  }
}
