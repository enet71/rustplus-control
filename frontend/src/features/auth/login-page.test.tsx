import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken } from '../../shared/session';
import { renderWithProviders } from '../../test-utils';
import { LoginPage } from './login-page';

const { verifyAccessToken } = vi.hoisted(() => ({ verifyAccessToken: vi.fn() }));

vi.mock('./auth-api', () => ({ verifyAccessToken }));

afterEach(() => {
  verifyAccessToken.mockReset();
});

describe('LoginPage', () => {
  it('shows an error and stores nothing when the submitted key is rejected', async () => {
    verifyAccessToken.mockResolvedValue(false);
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText('Access key'), 'incorrect');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findByRole('status')).textContent).toContain(
      'The access key is incorrect.',
    );
    expect(verifyAccessToken).toHaveBeenCalledWith('incorrect');
    expect(getAccessToken()).toBe('');
  });

  it('stores the key when the server accepts it', async () => {
    verifyAccessToken.mockResolvedValue(true);
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText('Access key'), 'correct');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(getAccessToken()).toBe('correct');
  });

  it('reports an unreachable server instead of failing silently', async () => {
    verifyAccessToken.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText('Access key'), 'any-key');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findByRole('status')).textContent).toContain(
      'Unable to reach the server.',
    );
  });
});
