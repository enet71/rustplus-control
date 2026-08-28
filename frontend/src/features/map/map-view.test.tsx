import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveAccessToken } from '../../shared/session';
import { renderWithProviders } from '../../test-utils';
import type { DashboardState } from '../../shared/api-types';
import { MapView } from './map-view';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderMap(
  response: () => Response,
  teamMapMembers: DashboardState['teamMapMembers'] = [],
  deathMarkers: DashboardState['deathMarkers'] = [],
) {
  saveAccessToken('access-key');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(response())),
  );
  return renderWithProviders(
    <MapView
      serverId="server-1"
      teamMapMembers={teamMapMembers}
      mapMarkers={[]}
      deathMarkers={deathMarkers}
    />,
  );
}

function readyMapResponse(
  monuments: Array<{ token: string; x: number; y: number }> = [],
): Response {
  return new Response(
    JSON.stringify({
      width: 2000,
      height: 2000,
      oceanMargin: 250,
      mapSize: 300,
      image: 'map.png',
      monuments,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
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
    renderMap(readyMapResponse);

    await waitFor(() => expect(screen.queryByAltText('Rust server map')).not.toBeNull());
    // mapSize 300 / 150 => a 2x2 grid.
    expect(screen.queryByText('A1')).not.toBeNull();
    expect(screen.queryByText('B2')).not.toBeNull();
    expect(screen.queryByText('Team')).not.toBeNull();
  });

  it('shows sleeping (offline) teammates too, marked differently from online ones', async () => {
    renderMap(readyMapResponse, [
      { id: '1', name: 'Awake', x: 10, y: 10, isOnline: true },
      { id: '2', name: 'Asleep', x: 20, y: 20, isOnline: false },
    ]);

    await waitFor(() => expect(screen.queryByTitle('Awake')).not.toBeNull());
    expect(screen.queryByTitle('Asleep (sleeping)')).not.toBeNull();
  });

  it('labels only online teammates with their name, not sleeping ones', async () => {
    renderMap(readyMapResponse, [
      { id: '1', name: 'Awake', x: 10, y: 10, isOnline: true },
      { id: '2', name: 'Asleep', x: 20, y: 20, isOnline: false },
    ]);

    await waitFor(() => expect(screen.queryByText('Awake')).not.toBeNull());
    expect(screen.queryByText('Asleep')).toBeNull();
  });

  it('labels monuments using the display name translated from their token', async () => {
    renderMap(() => readyMapResponse([{ token: 'trainyard_display_name', x: 50, y: 50 }]));

    await waitFor(() => expect(screen.queryByText('Train Yard')).not.toBeNull());
    expect(screen.queryByText('Monuments')).not.toBeNull();
  });

  it('shows recent death markers without a name label, with the death time on hover', async () => {
    renderMap(
      readyMapResponse,
      [],
      [{ id: '1:100', playerId: '1', name: 'Alice', x: 30, y: 40, deathTime: 1_700_000_000 }],
    );

    await waitFor(() => expect(screen.queryByTitle(/^Alice died here at /)).not.toBeNull());
    expect(screen.queryByText('Alice')).toBeNull();
  });
});
