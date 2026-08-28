import { clearAccessToken, getAccessToken } from './session';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed.';
}

/**
 * Sends an authenticated request and drops the stored access key when the server
 * rejects it. Navigation is intentionally left to the route guard so that the
 * transport layer stays free of routing concerns.
 */
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${getAccessToken()}`);
  const response = await fetch(path, { ...options, headers });
  if (response.status === 401) clearAccessToken();
  return response;
}

export async function api(path: string, options: RequestInit = {}): Promise<Response> {
  const response = await apiFetch(path, options);
  if (response.ok) return response;
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  throw new ApiError(response.status, body.error || 'Request failed.');
}

export async function apiJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  return (await (await api(path, options)).json()) as T;
}

export function jsonBody(body: unknown): RequestInit {
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
