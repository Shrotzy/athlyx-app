import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ErrorBanner, Field } from '../components/common.jsx';
import { useAuth } from '../lib/auth.jsx';
import { ROLES } from '@shared/constants.js';

export default function SignUp() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState(ROLES.ATHLETE);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signUp({ ...form, email: form.email.trim(), role });
      navigate(role === ROLES.THERAPIST ? '/therapist' : '/athlete', { replace: true });
    } catch (problem) {
      setError(problem);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }} className="stack">
      <h1>Create an account</h1>
      <p className="muted">
        Athletes run the check-ins at home. Physical therapists assign tests, review results and send plans.
      </p>

      <form className="card stack" onSubmit={submit}>
        <ErrorBanner error={error?.message} details={error?.details} />

        <div className="pill-toggle" role="group" aria-label="Account type">
          <button
            type="button"
            aria-pressed={role === ROLES.ATHLETE}
            onClick={() => setRole(ROLES.ATHLETE)}
          >
            Athlete
          </button>
          <button
            type="button"
            aria-pressed={role === ROLES.THERAPIST}
            onClick={() => setRole(ROLES.THERAPIST)}
          >
            Physical therapist
          </button>
        </div>

        <Field label="Name" htmlFor="name">
          <input id="name" required value={form.name} onChange={update('name')} autoComplete="name" />
        </Field>
        <Field label="Email" htmlFor="email">
          <input
            id="email"
            type="email"
            required
            value={form.email}
            onChange={update('email')}
            autoComplete="email"
          />
        </Field>
        <Field label="Password" hint="at least 8 characters" htmlFor="password">
          <input
            id="password"
            type="password"
            minLength={8}
            required
            value={form.password}
            onChange={update('password')}
            autoComplete="new-password"
          />
        </Field>

        <button className="button" type="submit" disabled={busy}>
          {busy ? 'Creating account…' : `Create ${role === ROLES.THERAPIST ? 'therapist' : 'athlete'} account`}
        </button>
        <p className="muted small" style={{ margin: 0 }}>
          Already have an account? <Link to="/login">Sign in</Link>.
        </p>
      </form>
    </div>
  );
}
