const loginButton = document.querySelector('#login');
const loginStatus = document.querySelector('#login-status');
const loginForm = document.querySelector('#login-form');
const accessTokenInput = document.querySelector('#access-token');

async function redirectIfSignedIn() {
  if (accessToken() && await verifyAccessToken()) {
    location.replace('/dashboard.html');
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const token = accessTokenInput.value;
  loginButton.disabled = true;
  loginStatus.textContent = 'Checking access key...';
  try {
    if (!await verifyAccessToken(token)) {
      loginStatus.textContent = 'The access key is incorrect.';
      return;
    }
    localStorage.setItem(ACCESS_TOKEN_KEY, token);
    location.replace('/dashboard.html');
  } catch {
    loginStatus.textContent = 'Unable to reach the server.';
  } finally {
    loginButton.disabled = false;
  }
});

redirectIfSignedIn();
