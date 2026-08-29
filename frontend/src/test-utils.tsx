import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, type RenderResult } from '@testing-library/react';
import type { DashboardState } from './shared/api-types';

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false, gcTime: 0 } },
  });
}

export function withProviders(children: ReactNode, queryClient = createTestQueryClient()) {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

export function renderWithProviders(children: ReactNode): RenderResult {
  return render(withProviders(children));
}

export function dashboardState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    connected: true,
    message: 'Connected',
    deviceStates: {},
    storageStates: {},
    mapMarkers: [],
    mapNotes: [],
    teamMapMembers: [],
    deathMarkers: [],
    config: {
      activeServerId: 'server-1',
      servers: [{ id: 'server-1', name: 'Test server' }],
      devices: [],
      groups: [],
      discordConfigured: false,
    },
    ...overrides,
  };
}
