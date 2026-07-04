import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
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
  { selector: 'object[data]', attribute: 'data', source: 'object.data' },
  { selector: 'embed[src]', attribute: 'src', source: 'embed.src' },
  { selector: 'iframe[src]', attribute: 'src', source: 'iframe.src' },
  { selector: 'video[poster]', attribute: 'poster', source: 'video.poster' },
];

const LINK_REL_ALLOWLIST = new Set([
  'stylesheet',
  'icon',
  'shortcut icon',
  'apple-touch-icon',
  'manifest',
  'preload',
  'modulepreload',
]);

export function parseSrcset(rawSrcset: string): string[] {
  const urls: string[] = [];

  for (const candidate of rawSrcset.split(',')) {
    const trimmed = candidate.trim();

    if (trimmed === '') {
      continue;
    }

    const url = trimmed.split(/\s+/)[0];

    if (url !== undefined && url !== '') {
      urls.push(url);
    }
  }

  return urls;
}

function normalizeLinkRel(rawRel: string | undefined): string[] {
  if (rawRel === undefined || rawRel.trim() === '') {
    return [];
  }

  return rawRel
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token !== '');
}

function isAllowedLinkRel(rawRel: string | undefined): boolean {
  const tokens = normalizeLinkRel(rawRel);

  if (tokens.length === 0) {
    return false;
  }

  return tokens.some((token) => LINK_REL_ALLOWLIST.has(token));
}

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

    const pushDiscovered = (
      rawHref: string,
      source: string,
      anchorText?: string,
    ): void => {
      const normalized = normalizeDiscovered(rawHref, input.basePageUrl);

      if ('rejected' in normalized) {
        return;
      }

      discovered.push({
        url: normalized.url,
        normalizedUrl: normalized.normalizedUrl,
        host: new URL(normalized.normalizedUrl).hostname,
        depth: input.task.depth + 1,
        source,
        anchorText,
      });
    };

    for (const { selector, attribute, source } of LINK_SELECTORS) {
      $(selector).each((_index, element) => {
        const rawHref = $(element).attr(attribute);

        if (rawHref === undefined || rawHref.trim() === '') {
          return;
        }

        const anchorText =
          source === 'a.href'
            ? $(element).text().replace(/\s+/g, ' ').trim() || undefined
            : undefined;

        pushDiscovered(rawHref, source, anchorText);
      });
    }

    $('link[href]').each((_index, element) => {
      const rawHref = $(element).attr('href');

      if (rawHref === undefined || rawHref.trim() === '') {
        return;
      }

      if (!isAllowedLinkRel($(element).attr('rel'))) {
        return;
      }

      pushDiscovered(rawHref, 'link.href');
    });

    const pushSrcset = (element: Element, source: string): void => {
      const rawSrcset = $(element).attr('srcset');

      if (rawSrcset === undefined || rawSrcset.trim() === '') {
        return;
      }

      for (const rawHref of parseSrcset(rawSrcset)) {
        pushDiscovered(rawHref, source);
      }
    };

    $('img[srcset]').each((_index, element) => {
      pushSrcset(element, 'img.srcset');
    });

    $('source[srcset]').each((_index, element) => {
      pushSrcset(element, 'source.srcset');
    });

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
