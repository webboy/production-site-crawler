export type UrlRejectionReason = 'unparseable' | 'unsupported_scheme';

export interface NormalizedDiscoveredUrl {
  url: string;
  normalizedUrl: string;
}

export type NormalizeDiscoveredResult = NormalizedDiscoveredUrl | { rejected: UrlRejectionReason };

const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);

function isSupportedProtocol(protocol: string): boolean {
  return SUPPORTED_PROTOCOLS.has(protocol.toLowerCase());
}

function parseResolvedUrl(
  rawHref: string,
  basePageUrl: string,
): { url: URL } | { rejected: UrlRejectionReason } {
  try {
    const url = new URL(rawHref, basePageUrl);

    if (!isSupportedProtocol(url.protocol)) {
      return { rejected: 'unsupported_scheme' };
    }

    // Fragments are client-side only and are never sent to the fetch target.
    url.hash = '';

    return { url };
  } catch {
    return { rejected: 'unparseable' };
  }
}

export function resolve(rawHref: string, basePageUrl: string): string | null {
  const result = parseResolvedUrl(rawHref, basePageUrl);
  return 'url' in result ? result.url.href : null;
}

export function normalize(absoluteUrl: string): string | null {
  let url: URL;

  try {
    url = new URL(absoluteUrl);
  } catch {
    return null;
  }

  if (!isSupportedProtocol(url.protocol)) {
    return null;
  }

  url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';

  const pathWithoutTrailingSlash = url.pathname.replace(/\/+$/, '');
  url.pathname = pathWithoutTrailingSlash === '' ? '/' : pathWithoutTrailingSlash;

  const sortedParams = [...url.searchParams.entries()].sort(
    ([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyComparison = leftKey.localeCompare(rightKey);
      return keyComparison === 0 ? leftValue.localeCompare(rightValue) : keyComparison;
    },
  );

  url.search = '';

  for (const [key, value] of sortedParams) {
    url.searchParams.append(key, value);
  }

  return url.href;
}

export function normalizeDiscovered(
  rawHref: string,
  basePageUrl: string,
): NormalizeDiscoveredResult {
  const resolved = parseResolvedUrl(rawHref, basePageUrl);

  if ('rejected' in resolved) {
    return resolved;
  }

  const normalizedUrl = normalize(resolved.url.href);

  if (normalizedUrl === null) {
    return { rejected: 'unsupported_scheme' };
  }

  return {
    url: resolved.url.href,
    normalizedUrl,
  };
}
