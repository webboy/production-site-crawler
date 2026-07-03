export function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const requestedName = name.toLowerCase();

  for (const [headerName, value] of Object.entries(headers)) {
    if (headerName.toLowerCase() === requestedName) {
      return value;
    }
  }

  return undefined;
}
