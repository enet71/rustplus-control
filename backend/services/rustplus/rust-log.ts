export function errorSummary(error: unknown): string {
  const value = error as { name?: unknown; message?: unknown } | null;
  const name = value?.name || 'Error';
  const message = String(value?.message || '')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 240);
  return message ? `${name}: ${message}` : String(name);
}

export function logRust(event: string): void {
  console.log(`[rustplus] ${event}`);
}

export function isRateLimitError(responseError: unknown): boolean {
  return String((responseError as { error?: unknown } | null)?.error || '')
    .toLowerCase()
    .includes('rate_limit');
}
