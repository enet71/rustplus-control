import { Navigate, Route, Routes } from 'react-router-dom';
import { DashboardPage } from '../features/dashboard/dashboard-page';
import { LoginPage } from '../features/auth/login-page';
import { RequireAuth } from './require-auth';
import { LEGACY_ROUTES, ROUTES } from './routes';

/** Route table, kept free of the router implementation so it can be tested directly. */
export function AppRoutes() {
  return (
    <Routes>
      <Route
        path={ROUTES.dashboard}
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      <Route path={ROUTES.login} element={<LoginPage />} />
      <Route path={LEGACY_ROUTES.dashboard} element={<Navigate to={ROUTES.dashboard} replace />} />
      <Route path={LEGACY_ROUTES.login} element={<Navigate to={ROUTES.login} replace />} />
      <Route path="*" element={<Navigate to={ROUTES.dashboard} replace />} />
    </Routes>
  );
}
