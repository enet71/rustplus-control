import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearAccessToken, saveAccessToken } from '../shared/session';
import { createTestQueryClient } from '../test-utils';
import { AppRoutes } from './app-routes';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubApiFailure() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
}

describe('AppRoutes', () => {
  it('sends a visitor without an access key from the dashboard to the login page', async () => {
    clearAccessToken();
    stubApiFailure();

    renderAt('/');

    await waitFor(() => expect(screen.queryByLabelText('Access key')).not.toBeNull());
  });

  it('renders the login page on its own route', async () => {
    clearAccessToken();
    stubApiFailure();

    renderAt('/login');

    await waitFor(() => expect(screen.queryByLabelText('Access key')).not.toBeNull());
  });

  it('redirects the legacy login address to the login route', async () => {
    clearAccessToken();
    stubApiFailure();

    renderAt('/login.html');

    await waitFor(() => expect(screen.queryByLabelText('Access key')).not.toBeNull());
  });

  it('redirects the legacy dashboard address to the dashboard route', async () => {
    saveAccessToken('access-key');
    stubApiFailure();

    renderAt('/dashboard.html');

    // The dashboard renders (rather than the login form) and surfaces the failed load.
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull());
    expect(screen.queryByLabelText('Access key')).toBeNull();
  });

  it('keeps an authenticated visitor on the dashboard instead of the login page', async () => {
    saveAccessToken('access-key');
    stubApiFailure();

    renderAt('/login');

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull());
    expect(screen.queryByLabelText('Access key')).toBeNull();
  });
});
