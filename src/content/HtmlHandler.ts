import * as cheerio from 'cheerio';
import { normalizeDiscovered } from '../url/UrlNormalizer.js';
import type { DiscoveredLink } from '../worker/types.js';
import type {
  ContentHandler,
  HandlerExtractInput,
  HandlerExtractResult,
} from './ContentHandler.js';

const LINK_SELECTORS: Array<{ selector: string; attribute: string; source: string }> = [
  { selector: 'a[href]', attribute: 'href', source: 'a.href' },
  { selector: 'img[src]', attribute: 'src', source: 'img.src' },
  { selector: 'video[src]', attribute: 'src', source: 'video.src' },
  { selector: 'source[src]', attribute: 'src', source: 'source.src' },
  { selector: 'link[href]', attribute: 'href', source: 'link.href' },
  { selector: 'object[data]', attribute: 'data', source: 'object.data' },
  { selector: 'embed[src]', attribute: 'src', source: 'embed.src' },
];

export class HtmlHandler implements ContentHandler {
  readonly kind = 'html' as const;

  supports(contentType: string): boolean {
    return contentType === 'text/html' || contentType === 'application/xhtml+xml';
  }

  async extract(input: HandlerExtractInput): Promise<HandlerExtractResult> {
    const html = input.body.toString('utf8');
    const $ = cheerio.load(html);
    const title = $('title').first().text().trim();
    const discovered: DiscoveredLink[] = [];

    for (const { selector, attribute, source } of LINK_SELECTORS) {
      $(selector).each((_index, element) => {
        const rawHref = $(element).attr(attribute);

        if (rawHref === undefined || rawHref.trim() === '') {
          return;
        }

        const normalized = normalizeDiscovered(rawHref, input.basePageUrl);

        if ('rejected' in normalized) {
          return;
        }

        const anchorText =
          source === 'a.href'
            ? $(element).text().replace(/\s+/g, ' ').trim() || undefined
            : undefined;

        discovered.push({
          url: normalized.url,
          normalizedUrl: normalized.normalizedUrl,
          host: new URL(normalized.normalizedUrl).hostname,
          depth: input.task.depth + 1,
          source,
          anchorText,
        });
      });
    }

    return {
      metadata: {
        title,
        discoveredLinkCount: discovered.length,
      },
      metadataStatus: 'ok',
      discovered,
    };
  }
}
