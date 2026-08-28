import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ROUTES } from '../../app/routes';
import { saveAccessToken, useAccessToken } from '../../shared/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
    <main className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col justify-center px-5 py-10">
      <p className="text-xs tracking-[0.15em] text-muted-foreground">RUST+ COMPANION</p>
      <h1 className="mt-1.5 text-3xl font-bold">Electrical control</h1>
      <p className="my-5 leading-relaxed text-muted-foreground">
        Enter the access key configured for this Rust+ Control server.
      </p>
      <form className="grid gap-4" onSubmit={submit}>
        <div className="grid gap-1.5">
          <Label htmlFor="access-key">Access key</Label>
          <Input
            id="access-key"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <Button size="lg" type="submit" disabled={submitting} className="w-full">
          Sign in
        </Button>
      </form>
      <p className="mt-3.5 min-h-[18px] text-center text-sm text-muted-foreground" role="status">
        {status}
      </p>
    </main>
  );
}
