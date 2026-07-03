import { PDFParse } from 'pdf-parse';
import type {
  ContentHandler,
  HandlerExtractInput,
  HandlerExtractResult,
} from './ContentHandler.js';

async function parsePdfMetadata(body: Buffer): Promise<{ pageCount: number; title?: string }> {
  const parser = new PDFParse({ data: body });

  try {
    const info = await parser.getInfo();
    const title =
      typeof info.info?.Title === 'string' && info.info.Title.trim() !== ''
        ? info.info.Title.trim()
        : undefined;

    return {
      pageCount: info.total,
      title,
    };
  } finally {
    await parser.destroy();
  }
}

export class PdfHandler implements ContentHandler {
  readonly kind = 'pdf' as const;

  supports(contentType: string): boolean {
    return contentType === 'application/pdf';
  }

  async extract(input: HandlerExtractInput): Promise<HandlerExtractResult> {
    try {
      const { pageCount, title } = await parsePdfMetadata(input.body);

      return {
        metadata: {
          pageCount,
          ...(title === undefined ? {} : { title }),
        },
        metadataStatus: 'ok',
      };
    } catch (error) {
      return {
        metadata: {
          fileSize: input.body.length,
        },
        metadataStatus: 'failed',
        metadataError: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
