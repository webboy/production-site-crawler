const HTTP_DATE_PATTERN = /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

function parseDeltaSeconds(value: string): number | null {
  const trimmed = value.trim();

  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const seconds = Number(trimmed);

  if (!Number.isFinite(seconds)) {
    return null;
  }

  return Math.max(0, seconds * 1_000);
}

function parseHttpDate(value: string, now: Date): number | null {
  const trimmed = value.trim();

  if (!HTTP_DATE_PATTERN.test(trimmed)) {
    const parsed = Date.parse(trimmed);

    if (Number.isNaN(parsed)) {
      return null;
    }

    return Math.max(0, parsed - now.getTime());
  }

  const parsed = Date.parse(trimmed);

  if (Number.isNaN(parsed)) {
    return null;
  }

  return Math.max(0, parsed - now.getTime());
}

export function parseRetryAfter(value: string | undefined, now: Date = new Date()): number | null {
  if (value === undefined || value.trim() === '') {
    return null;
  }

  const trimmed = value.trim();

  if (/^-\d+$/.test(trimmed)) {
    return null;
  }

  const deltaMs = parseDeltaSeconds(trimmed);

  if (deltaMs !== null) {
    return deltaMs;
  }

  return parseHttpDate(value, now);
}
