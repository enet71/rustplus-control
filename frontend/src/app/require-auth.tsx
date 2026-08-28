import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAccessToken } from '../shared/session';
import { ROUTES } from './routes';

/**
 * Sends visitors without a stored access key to the login page. Because the key is
 * also cleared whenever the API answers 401, an expired key redirects here on the
 * next request without the transport layer touching navigation.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAccessToken();
  if (!token) return <Navigate to={ROUTES.login} replace />;
  return <>{children}</>;
}
