export const ROUTES = {
  dashboard: '/',
  login: '/login',
} as const;

/** Addresses served by the pre-React static UI, kept working as redirects. */
export const LEGACY_ROUTES = {
  dashboard: '/dashboard.html',
  login: '/login.html',
} as const;
