import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { ErrorBanner, Field } from '../components/common.jsx';
import { useAuth } from '../lib/auth.jsx';

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await signIn(email.trim(), password);
      const fallback = user.role === 'therapist' ? '/therapist' : '/athlete';
      navigate(location.state?.from || fallback, { replace: true });
    } catch (problem) {
      setError(problem);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 460, margin: '0 auto' }} className="stack">
      <h1>Sign in</h1>
      <p className="muted">Use the account you created as an athlete or as a physical therapist.</p>
      <form className="card stack" onSubmit={submit}>
        <ErrorBanner error={error?.message} details={error?.details} />
        <Field label="Email" htmlFor="email">
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <button className="button" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted small" style={{ margin: 0 }}>
          No account yet? <Link to="/signup">Create one</Link>. Demo: athlete@athlyx.demo / athlyx-demo after
          seeding.
        </p>
      </form>
    </div>
  );
}
