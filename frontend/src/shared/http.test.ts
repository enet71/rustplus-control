import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, apiFetch } from './http';
import { getAccessToken, saveAccessToken } from './session';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('sends the saved access key with API requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    saveAccessToken('access-key');

    await apiFetch('/api/state');

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer access-key');
  });

  it('drops a rejected access key so the route guard can redirect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    saveAccessToken('stale-key');

    await apiFetch('/api/state');

    expect(getAccessToken()).toBe('');
  });

  it('keeps the access key when the request succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    saveAccessToken('good-key');

    await apiFetch('/api/state');

    expect(getAccessToken()).toBe('good-key');
  });
});

describe('api', () => {
  it('raises the server-provided message with its status', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'Device is unreachable.' }), { status: 502 }),
        ),
    );

    await expect(api('/api/devices/1')).rejects.toThrowError(
      new ApiError(502, 'Device is unreachable.'),
    );
  });

  it('falls back to a generic message when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));

    await expect(api('/api/state')).rejects.toThrowError('Request failed.');
  });
});
