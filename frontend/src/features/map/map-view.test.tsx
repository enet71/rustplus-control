import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveAccessToken } from '../../shared/session';
import { renderWithProviders } from '../../test-utils';
import { MapView } from './map-view';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderMap(response: () => Response) {
  saveAccessToken('access-key');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(response())),
  );
  return renderWithProviders(<MapView serverId="server-1" teamMapMembers={[]} mapMarkers={[]} />);
}

describe('MapView', () => {
  it('treats the server "not ready" answer as a pending map, not a failure', async () => {
    renderMap(
      () => new Response(JSON.stringify({ error: 'Map is not available yet.' }), { status: 409 }),
    );

    await waitFor(() => expect(screen.queryByText('Map is not available yet.')).not.toBeNull());
    expect(screen.queryByText('Map could not be loaded.')).toBeNull();
  });

  it('reports a genuine failure differently from a pending map', async () => {
    renderMap(() => new Response(null, { status: 500 }));

    await waitFor(() => expect(screen.queryByText('Map could not be loaded.')).not.toBeNull());
  });

  it('renders the grid and legend once the map arrives', async () => {
    renderMap(
      () =>
        new Response(
          JSON.stringify({
            width: 2000,
            height: 2000,
            oceanMargin: 250,
            mapSize: 300,
            image: 'map.png',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );

    await waitFor(() => expect(screen.queryByAltText('Rust server map')).not.toBeNull());
    // mapSize 300 / 150 => a 2x2 grid.
    expect(screen.queryByText('A1')).not.toBeNull();
    expect(screen.queryByText('B2')).not.toBeNull();
    expect(screen.queryByText('Team')).not.toBeNull();
  });
});
