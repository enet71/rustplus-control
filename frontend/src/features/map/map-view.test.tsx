import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveAccessToken } from '../../shared/session';
import { renderWithProviders } from '../../test-utils';
import type { DashboardState } from '../../shared/api-types';
import { MapView } from './map-view';
import type { CustomMarkerMutations } from './use-custom-markers';

afterEach(() => {
  vi.unstubAllGlobals();
});

// Mirrors `fakeMutations` in `controls-panel.test.tsx`: a plain spy object, not a real
// `useMutation` — `MapView` receives the mutations object as a prop and never fetches
// `/api/state` itself, so there is nothing for a real mutation's `invalidateQueries` to
// refetch inside this isolated render.
function fakeCustomMarkerMutations(
  overrides: Partial<CustomMarkerMutations> = {},
): CustomMarkerMutations {
  return {
    createCustomMarker: { mutateAsync: vi.fn(), isPending: false },
    updateCustomMarker: { mutateAsync: vi.fn(), isPending: false },
    deleteCustomMarker: { mutateAsync: vi.fn(), isPending: false },
    ...overrides,
  } as unknown as CustomMarkerMutations;
}

function renderMap(
  response: () => Response,
  teamMapMembers: DashboardState['teamMapMembers'] = [],
  deathMarkers: DashboardState['deathMarkers'] = [],
  mapNotes: DashboardState['mapNotes'] = [],
  customMarkers: DashboardState['config']['customMarkers'] = [],
  customMarkerMutations: CustomMarkerMutations = fakeCustomMarkerMutations(),
) {
  saveAccessToken('access-key');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(response())),
  );
  return {
    ...renderWithProviders(
      <MapView
        serverId="server-1"
        teamMapMembers={teamMapMembers}
        mapMarkers={[]}
        mapNotes={mapNotes}
        deathMarkers={deathMarkers}
        customMarkers={customMarkers}
        customMarkerMutations={customMarkerMutations}
      />,
    ),
    mutations: customMarkerMutations,
  };
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

  it('drops the outer right/bottom grid border, keeping inner cell borders', async () => {
    renderMap(readyMapResponse);

    await waitFor(() => expect(screen.queryByText('A1')).not.toBeNull());
    expect(screen.getByText('A1').className).not.toMatch(/is-last-column|is-last-row/);
    expect(screen.getByText('B2').className).toMatch(/is-last-column/);
    expect(screen.getByText('B2').className).toMatch(/is-last-row/);
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
    const { container } = renderMap(readyMapResponse, [
      { id: '1', name: 'Awake', x: 10, y: 10, isOnline: true },
      { id: '2', name: 'Asleep', x: 20, y: 20, isOnline: false },
    ]);
    const markerLayer = () => within(container.querySelector('.map-marker-layer')!);

    await waitFor(() => expect(markerLayer().queryByText('Awake')).not.toBeNull());
    expect(markerLayer().queryByText('Asleep')).toBeNull();
  });

  it('labels monuments using the display name translated from their token', async () => {
    renderMap(() => readyMapResponse([{ token: 'trainyard_display_name', x: 50, y: 50 }]));

    await waitFor(() => expect(screen.queryByText('Train Yard')).not.toBeNull());
    expect(screen.queryByText('Monuments')).not.toBeNull();
  });

  it('shows a train tunnel entrance as an icon, not a text label', async () => {
    renderMap(() => readyMapResponse([{ token: 'train_tunnel_display_name', x: 50, y: 50 }]));

    await waitFor(() => expect(screen.queryByText('Monuments')).not.toBeNull());
    expect(screen.queryByText('Train Tunnel')).toBeNull();
  });

  it('labels the unrelated Military Tunnels monument as text, not an icon', async () => {
    renderMap(() => readyMapResponse([{ token: 'military_tunnel_1', x: 50, y: 50 }]));

    await waitFor(() => expect(screen.queryByText('Military Tunnels')).not.toBeNull());
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

  it('renders markers the player placed in-game from the team info notes', async () => {
    renderMap(
      readyMapResponse,
      [],
      [],
      [{ id: 'own:1:100:150', type: 1, x: 100, y: 150, source: 'own' }],
    );

    await waitFor(() => expect(screen.queryByTitle('Marker placed in-game')).not.toBeNull());
  });

  it('hides own and leader map-note markers independently', async () => {
    const user = userEvent.setup();
    renderMap(
      readyMapResponse,
      [],
      [],
      [
        { id: 'own:1:100:150', type: 1, x: 100, y: 150, source: 'own' },
        { id: 'leader:2:300:350', type: 2, x: 300, y: 350, source: 'leader' },
      ],
    );
    await waitFor(() => expect(screen.getAllByTitle('Marker placed in-game').length).toBe(2));

    await user.click(screen.getByRole('button', { name: 'Show markers panel' }));
    await user.click(screen.getByRole('checkbox', { name: 'My markers' }));
    expect(screen.getAllByTitle('Marker placed in-game').length).toBe(1);

    await user.click(screen.getByRole('checkbox', { name: "Leader's markers" }));
    expect(screen.queryByTitle('Marker placed in-game')).toBeNull();
  });

  it('remembers a hidden marker source in local storage across a remount', async () => {
    const user = userEvent.setup();
    const notes: DashboardState['mapNotes'] = [
      { id: 'own:1:100:150', type: 1, x: 100, y: 150, source: 'own' },
    ];
    const first = renderMap(readyMapResponse, [], [], notes);
    await waitFor(() => expect(screen.queryByTitle('Marker placed in-game')).not.toBeNull());
    await user.click(screen.getByRole('button', { name: 'Show markers panel' }));
    await user.click(screen.getByRole('checkbox', { name: 'My markers' }));
    expect(screen.queryByTitle('Marker placed in-game')).toBeNull();
    first.unmount();

    renderMap(readyMapResponse, [], [], notes);

    await waitFor(() => expect(screen.queryByText('Teammates')).not.toBeNull());
    expect(screen.queryByTitle('Marker placed in-game')).toBeNull();
  });

  it('lists every teammate in the team panel, checked by default', async () => {
    renderMap(readyMapResponse, [
      { id: '1', name: 'Awake', x: 10, y: 10, isOnline: true },
      { id: '2', name: 'Asleep', x: 20, y: 20, isOnline: false },
    ]);

    await waitFor(() => expect(screen.queryByText('Teammates')).not.toBeNull());
    expect(screen.getByRole('checkbox', { name: 'Awake' }).getAttribute('data-state')).toBe(
      'checked',
    );
    expect(screen.getByRole('checkbox', { name: 'Asleep' }).getAttribute('data-state')).toBe(
      'checked',
    );
  });

  it("hides a teammate's map marker and death markers once unchecked, keeping them in the panel", async () => {
    const user = userEvent.setup();
    renderMap(
      readyMapResponse,
      [{ id: '1', name: 'Alice', x: 10, y: 10, isOnline: true }],
      [{ id: '1:100', playerId: '1', name: 'Alice', x: 30, y: 40, deathTime: 1_700_000_000 }],
    );
    await waitFor(() => expect(screen.queryByTitle('Alice')).not.toBeNull());
    expect(screen.queryByTitle(/^Alice died here at /)).not.toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Alice' }));

    expect(screen.queryByTitle('Alice')).toBeNull();
    expect(screen.queryByTitle(/^Alice died here at /)).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Alice' }).getAttribute('data-state')).toBe(
      'unchecked',
    );
  });

  it('remembers a hidden teammate in local storage across a remount', async () => {
    const user = userEvent.setup();
    const first = renderMap(readyMapResponse, [
      { id: '1', name: 'Alice', x: 10, y: 10, isOnline: true },
    ]);
    await waitFor(() => expect(screen.queryByTitle('Alice')).not.toBeNull());
    await user.click(screen.getByRole('checkbox', { name: 'Alice' }));
    expect(screen.queryByTitle('Alice')).toBeNull();
    first.unmount();

    renderMap(readyMapResponse, [{ id: '1', name: 'Alice', x: 10, y: 10, isOnline: true }]);

    await waitFor(() => expect(screen.queryByText('Teammates')).not.toBeNull());
    expect(screen.queryByTitle('Alice')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Alice' }).getAttribute('data-state')).toBe(
      'unchecked',
    );
  });

  it('can hide and reopen the team panel', async () => {
    const user = userEvent.setup();
    renderMap(readyMapResponse, [{ id: '1', name: 'Alice', x: 10, y: 10, isOnline: true }]);
    await waitFor(() => expect(screen.queryByText('Teammates')).not.toBeNull());

    await user.click(screen.getByRole('button', { name: 'Hide team panel' }));
    expect(screen.queryByText('Teammates')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Show team panel' }));
    expect(screen.queryByText('Teammates')).not.toBeNull();
  });

  it('remembers the panel being hidden in local storage across a remount', async () => {
    const user = userEvent.setup();
    const first = renderMap(readyMapResponse, [
      { id: '1', name: 'Alice', x: 10, y: 10, isOnline: true },
    ]);
    await waitFor(() => expect(screen.queryByText('Teammates')).not.toBeNull());
    await user.click(screen.getByRole('button', { name: 'Hide team panel' }));
    first.unmount();

    renderMap(readyMapResponse, [{ id: '1', name: 'Alice', x: 10, y: 10, isOnline: true }]);

    await waitFor(() => expect(screen.queryByAltText('Rust server map')).not.toBeNull());
    expect(screen.queryByText('Teammates')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show team panel' })).not.toBeNull();
  });
});

describe('MapView custom markers', () => {
  it('places a custom marker by clicking the map, calling the create mutation with the position', async () => {
    const user = userEvent.setup();
    const { container, mutations } = renderMap(readyMapResponse);
    await waitFor(() => expect(screen.queryByAltText('Rust server map')).not.toBeNull());

    await user.click(screen.getByRole('button', { name: 'Show markers panel' }));
    await user.click(screen.getByRole('button', { name: 'Add marker' }));
    expect(screen.queryByText('Click on the map to place a marker')).not.toBeNull();

    await user.click(container.querySelector('.rust-map')!);

    expect(screen.getByRole('heading', { name: 'Add marker' })).not.toBeNull();
    await user.type(screen.getByLabelText('Name'), 'Base');
    await user.type(screen.getByLabelText('Description'), 'Main base entrance');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutations.createCustomMarker.mutateAsync).toHaveBeenCalledWith({
      name: 'Base',
      description: 'Main base entrance',
      // jsdom never lays elements out, so the clicked container rect is 0-sized —
      // the resulting world position is the geometry function's zero sentinel.
      x: 0,
      y: 0,
    });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Add marker' })).toBeNull());
  });

  it('cancelling placement mode does not create a marker', async () => {
    const user = userEvent.setup();
    const { mutations } = renderMap(readyMapResponse);
    await waitFor(() => expect(screen.queryByAltText('Rust server map')).not.toBeNull());

    await user.click(screen.getByRole('button', { name: 'Show markers panel' }));
    await user.click(screen.getByRole('button', { name: 'Add marker' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Click on the map to place a marker')).toBeNull();
    expect(screen.queryByText('No custom markers yet.')).not.toBeNull();
    expect(mutations.createCustomMarker.mutateAsync).not.toHaveBeenCalled();
  });

  it('keeps the add-marker dialog open when the create mutation fails', async () => {
    const user = userEvent.setup();
    const mutations = fakeCustomMarkerMutations({
      createCustomMarker: {
        mutateAsync: vi.fn().mockRejectedValue(new Error('failed')),
        isPending: false,
      } as unknown as CustomMarkerMutations['createCustomMarker'],
    });
    const { container } = renderMap(readyMapResponse, [], [], [], [], mutations);
    await waitFor(() => expect(screen.queryByAltText('Rust server map')).not.toBeNull());

    await user.click(screen.getByRole('button', { name: 'Show markers panel' }));
    await user.click(screen.getByRole('button', { name: 'Add marker' }));
    await user.click(container.querySelector('.rust-map')!);
    await user.type(screen.getByLabelText('Name'), 'Base');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutations.createCustomMarker.mutateAsync).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Add marker' })).not.toBeNull();
  });

  it('renders existing custom markers with their name and description', async () => {
    renderMap(
      readyMapResponse,
      [],
      [],
      [],
      [{ id: 'm1', name: 'Base', description: 'Main base entrance', x: 100, y: 200 }],
    );
    await waitFor(() => expect(screen.queryByAltText('Rust server map')).not.toBeNull());

    // testing-library normalizes whitespace, so the title's embedded newline reads as a space.
    expect(screen.getByTitle('Base Main base entrance')).not.toBeNull();
  });

  it("shows a custom marker's info in a dialog when clicked", async () => {
    const user = userEvent.setup();
    renderMap(
      readyMapResponse,
      [],
      [],
      [],
      [{ id: 'm1', name: 'Base', description: 'Main base entrance', x: 100, y: 200 }],
    );
    await waitFor(() => expect(screen.queryByAltText('Rust server map')).not.toBeNull());

    await user.click(screen.getByTitle('Base Main base entrance'));

    expect(screen.getByRole('heading', { name: 'Base' })).not.toBeNull();
    expect(screen.getByText('Main base entrance')).not.toBeNull();
  });

  it("opens the edit dialog, prefilled, from the info dialog's Edit button", async () => {
    const user = userEvent.setup();
    const { mutations } = renderMap(
      readyMapResponse,
      [],
      [],
      [],
      [{ id: 'm1', name: 'Base', description: 'Main base entrance', x: 100, y: 200 }],
    );
    await waitFor(() => expect(screen.queryByAltText('Rust server map')).not.toBeNull());

    await user.click(screen.getByTitle('Base Main base entrance'));
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.queryByRole('heading', { name: 'Base' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Edit marker' })).not.toBeNull();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Base');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutations.updateCustomMarker.mutateAsync).toHaveBeenCalledWith({
      id: 'm1',
      name: 'Base',
      description: 'Main base entrance',
    });
  });

  it('edits a custom marker from its panel row', async () => {
    const user = userEvent.setup();
    const { mutations } = renderMap(
      readyMapResponse,
      [],
      [],
      [],
      [{ id: 'm1', name: 'Base', description: 'Main base entrance', x: 100, y: 200 }],
    );
    await waitFor(() => expect(screen.queryByAltText('Rust server map')).not.toBeNull());
    await user.click(screen.getByRole('button', { name: 'Show markers panel' }));

    await user.click(screen.getByRole('button', { name: 'More actions for Base' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const nameInput = screen.getByLabelText('Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Renamed base');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutations.updateCustomMarker.mutateAsync).toHaveBeenCalledWith({
      id: 'm1',
      name: 'Renamed base',
      description: 'Main base entrance',
    });
  });

  it('deletes a custom marker from its panel row only after confirming', async () => {
    const user = userEvent.setup();
    const { mutations } = renderMap(
      readyMapResponse,
      [],
      [],
      [],
      [{ id: 'm1', name: 'Base', description: 'Main base entrance', x: 100, y: 200 }],
    );
    await waitFor(() => expect(screen.queryByAltText('Rust server map')).not.toBeNull());
    await user.click(screen.getByRole('button', { name: 'Show markers panel' }));

    await user.click(screen.getByRole('button', { name: 'More actions for Base' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(mutations.deleteCustomMarker.mutateAsync).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(mutations.deleteCustomMarker.mutateAsync).toHaveBeenCalledWith('m1');
  });
});
