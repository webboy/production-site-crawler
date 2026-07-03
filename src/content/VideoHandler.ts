import type {
  ContentHandler,
  HandlerExtractInput,
  HandlerExtractResult,
} from './ContentHandler.js';

export class VideoHandler implements ContentHandler {
  readonly kind = 'video' as const;

  supports(contentType: string): boolean {
    return (
      contentType === 'video/mp4' ||
      contentType === 'video/webm' ||
      contentType === 'video/quicktime' ||
      contentType.startsWith('video/')
    );
  }

  async extract(input: HandlerExtractInput): Promise<HandlerExtractResult> {
    return {
      metadata: {
        fileSize: input.body.length,
        durationSeconds: null,
      },
      metadataStatus: 'partial',
      metadataError: 'Video duration extraction is not implemented in MVP',
    };
  }
}
