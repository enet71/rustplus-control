import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyAccessToken } from './auth-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('verifyAccessToken', () => {
  it('reports whether the server accepts an access key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(verifyAccessToken('incorrect')).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/verify', {
      headers: { Authorization: 'Bearer incorrect' },
    });
  });

  it('accepts a key the server confirms', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    await expect(verifyAccessToken('correct')).resolves.toBe(true);
  });
});
