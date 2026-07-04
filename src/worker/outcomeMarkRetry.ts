const OUTCOME_MARK_DELAYS_MS = [100, 400, 1600];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function withOutcomeMarkRetry(
  operation: () => Promise<void>,
  onAttemptFailed: (attempt: number, error: unknown) => void,
  maxAttempts = 3,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await operation();
      return;
    } catch (error) {
      onAttemptFailed(attempt, error);

      if (attempt === maxAttempts) {
        throw error;
      }

      await sleep(OUTCOME_MARK_DELAYS_MS[attempt - 1] ?? 1600);
    }
  }
}
