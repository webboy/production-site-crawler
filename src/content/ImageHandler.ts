import { imageSize } from 'image-size';
import type {
  ContentHandler,
  HandlerExtractInput,
  HandlerExtractResult,
} from './ContentHandler.js';

export class ImageHandler implements ContentHandler {
  readonly kind = 'image' as const;

  supports(contentType: string): boolean {
    return (
      contentType === 'image/jpeg' ||
      contentType === 'image/png' ||
      contentType === 'image/gif' ||
      contentType === 'image/webp'
    );
  }

  async extract(input: HandlerExtractInput): Promise<HandlerExtractResult> {
    try {
      const dimensions = imageSize(input.body);

      return {
        metadata: {
          width: dimensions.width,
          height: dimensions.height,
          fileSize: input.body.length,
        },
        metadataStatus: 'ok',
      };
    } catch (error) {
      return {
        metadata: {
          fileSize: input.body.length,
        },
        metadataStatus: 'partial',
        metadataError: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
