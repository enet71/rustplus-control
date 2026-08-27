import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ROUTES } from '../../app/routes';
import { saveAccessToken, useAccessToken } from '../../shared/session';
import { verifyAccessToken } from './auth-api';

export function LoginPage() {
  const navigate = useNavigate();
  const storedToken = useAccessToken();
  const [token, setToken] = useState('');
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setStatus('Checking access key...');
    try {
      if (!(await verifyAccessToken(token))) {
        setStatus('The access key is incorrect.');
        return;
      }
      saveAccessToken(token);
      navigate(ROUTES.dashboard, { replace: true });
    } catch {
      setStatus('Unable to reach the server.');
    } finally {
      setSubmitting(false);
    }
  };

  if (storedToken) return <Navigate to={ROUTES.dashboard} replace />;

  return (
    <main className="login-main">
      <p className="eyebrow">RUST+ COMPANION</p>
      <h1>Electrical control</h1>
      <p className="login-copy">Enter the access key configured for this Rust+ Control server.</p>
      <form className="stacked-form" onSubmit={submit}>
        <label>
          Access key
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <button className="login-button" type="submit" disabled={submitting}>
          Sign in
        </button>
      </form>
      <p className="hint" role="status">
        {status}
      </p>
    </main>
  );
}
