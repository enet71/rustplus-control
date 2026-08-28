import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveAccessToken } from '../../shared/session';
import { dashboardState, renderWithProviders } from '../../test-utils';
import { DashboardPage } from './dashboard-page';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Answers each API path with a canned response; unlisted paths fail the request. */
function stubApi(handlers: Record<string, () => Response>) {
  const fetchMock = vi.fn((url: string) => {
    const path = url.split('?')[0];
    const handler = handlers[path];
    if (!handler) return Promise.resolve(new Response(null, { status: 500 }));
    return Promise.resolve(handler());
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function openStream(): Response {
  return new Response(new ReadableStream(), { status: 200 });
}

describe('DashboardPage', () => {
  it('reports the failure instead of loading forever when the state request fails', async () => {
    saveAccessToken('access-key');
    stubApi({
      '/api/state': () =>
        new Response(JSON.stringify({ error: 'Rust+ is not connected.' }), { status: 503 }),
      '/api/events': openStream,
    });

    renderWithProviders(<DashboardPage />);

    expect((await screen.findByRole('alert')).textContent).toContain('Rust+ is not connected.');
    expect(screen.queryByText('Loading...')).toBeNull();
  });

  it('renders the active server and connection message once the state loads', async () => {
    saveAccessToken('access-key');
    stubApi({
      '/api/state': () => json(dashboardState({ message: 'Connected to Test server' })),
      '/api/fcm/status': () =>
        json({ registrationAvailable: false, registered: false, listening: false, message: '' }),
      '/api/pairings/pending': () => json([]),
      '/api/events': openStream,
    });

    renderWithProviders(<DashboardPage />);

    await waitFor(() => expect(screen.queryByText('Connected to Test server')).not.toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Active server').textContent).toContain('Test server');
  });

  it('offers the pairing dialog for the first pending pairing', async () => {
    saveAccessToken('access-key');
    stubApi({
      '/api/state': () => json(dashboardState()),
      '/api/fcm/status': () =>
        json({ registrationAvailable: false, registered: false, listening: false, message: '' }),
      '/api/pairings/pending': () =>
        json([{ id: 'p1', entityId: '12345', name: 'New switch', type: 'switch' }]),
      '/api/events': openStream,
    });

    renderWithProviders(<DashboardPage />);

    await waitFor(() => expect(screen.queryByText('New Rust+ device')).not.toBeNull());
    expect(screen.queryByText('Entity ID: 12345')).not.toBeNull();
  });
});
