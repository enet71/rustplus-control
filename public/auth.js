const ACCESS_TOKEN_KEY = 'rustplus-control.access-token';

function accessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY) || '';
}

function authorizationHeaders(headers = {}) {
  return { ...headers, Authorization: `Bearer ${accessToken()}` };
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, { ...options, headers: authorizationHeaders(options.headers) });
  if (response.status === 401) {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    if (!location.pathname.endsWith('/login.html')) location.replace('/login.html');
  }
  return response;
}

async function verifyAccessToken(token = accessToken()) {
  const response = await fetch('/api/auth/verify', { headers: { Authorization: `Bearer ${token}` } });
  return response.ok;
}

function signOut() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  location.replace('/login.html');
}
