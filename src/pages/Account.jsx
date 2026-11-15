import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { Disclaimer, ErrorBanner, Field, Loading, formatDate } from '../components/common.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { ROLES } from '@shared/constants.js';

export default function Account() {
  const { user, updateProfile, deleteAccount } = useAuth();
  const [form, setForm] = useState({ name: user.name, heightCm: user.heightCm ?? '', operatedLeg: user.operatedLeg ?? '' });
  const [links, setLinks] = useState(null);
  const [linkCode, setLinkCode] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadLinks = async () => {
    const data = await api.get('/links');
    setLinks(data);
  };

  useEffect(() => {
    let cancelled = false;
    loadLinks().catch((problem) => !cancelled && setError(problem));
    return () => {
      cancelled = true;
    };
  }, []);

  const saveProfile = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await updateProfile({
        name: form.name,
        heightCm: form.heightCm === '' ? null : Number(form.heightCm),
        operatedLeg: form.operatedLeg || null,
      });
      setMessage('Profile saved.');
    } catch (problem) {
      setError(problem);
    } finally {
      setBusy(false);
    }
  };

  const getCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api.get('/links/code');
      setLinkCode(data.code);
    } catch (problem) {
      setError(problem);
    } finally {
      setBusy(false);
    }
  };

  const rotateCode = async () => {
    setBusy(true);
    try {
      const data = await api.post('/links/code/rotate');
      setLinkCode(data.code);
    } catch (problem) {
      setError(problem);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (linkId) => {
    setBusy(true);
    try {
      await api.del(`/links/${linkId}`);
      await loadLinks();
      setMessage('Access revoked.');
    } catch (problem) {
      setError(problem);
    } finally {
      setBusy(false);
    }
  };

  const removeAccount = async () => {
    if (
      !window.confirm(
        'Delete your account and all data derived from it (check-ins, measurements, landmark data, notes, plans)? This cannot be undone.',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await deleteAccount();
      window.location.assign('/');
    } catch (problem) {
      setError(problem);
      setBusy(false);
    }
  };

  if (!user) return <Loading>Loading your account…</Loading>;

  return (
    <div className="stack">
      <div>
        <span className="eyebrow">{user.role === ROLES.THERAPIST ? 'Physical therapist' : 'Athlete'} account</span>
        <h1>Your account</h1>
        <p className="muted" style={{ margin: 0 }}>
          {user.email}
        </p>
      </div>

      <ErrorBanner error={error?.message} details={error?.details} />
      {message && <div className="notice">{message}</div>}

      <div className="grid-2">
        <form className="card stack" onSubmit={saveProfile}>
          <h2 style={{ margin: 0 }}>Profile</h2>
          <Field label="Name" htmlFor="name">
            <input
              id="name"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </Field>

          {user.role === ROLES.ATHLETE && (
            <>
              <Field label="Height" hint="cm — used only to display hop distance in centimetres" htmlFor="height">
                <input
                  id="height"
                  type="number"
                  min={90}
                  max={250}
                  value={form.heightCm}
                  onChange={(event) => setForm((current) => ({ ...current, heightCm: event.target.value }))}
                />
              </Field>
              <Field label="Operated leg" hint="the leg that had surgery" htmlFor="operatedLeg">
                <select
                  id="operatedLeg"
                  value={form.operatedLeg}
                  onChange={(event) => setForm((current) => ({ ...current, operatedLeg: event.target.value }))}
                >
                  <option value="">Not set</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
              </Field>
            </>
          )}

          <button className="button small" type="submit" disabled={busy}>
            Save profile
          </button>
        </form>

        <section className="card stack">
          <h2 style={{ margin: 0 }}>Access to your data</h2>
          {user.role === ROLES.ATHLETE ? (
            <>
              <p className="muted small" style={{ margin: 0 }}>
                Only you and the therapists you invite can see your measurements. Revoke access at any time.
              </p>
              {links?.therapists?.length ? (
                <ul className="list-reset">
                  {links.therapists.map((therapist) => (
                    <li key={therapist.linkId} className="row between">
                      <span>
                        <strong>{therapist.name}</strong>
                        <div className="muted small">
                          {therapist.email} · linked {formatDate(therapist.linkedAt)}
                        </div>
                      </span>
                      <button
                        type="button"
                        className="button danger small"
                        onClick={() => revoke(therapist.linkId)}
                        disabled={busy}
                      >
                        Revoke
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small" style={{ margin: 0 }}>
                  No therapist is linked yet.
                </p>
              )}

              <div className="stack" style={{ gap: '0.4rem' }}>
                <span className="field-label">Invite code</span>
                {linkCode ? (
                  <div className="row">
                    <span className="tag" style={{ fontSize: '1rem', padding: '0.4rem 0.7rem' }}>
                      {linkCode}
                    </span>
                    <button className="link-button small" type="button" onClick={rotateCode} disabled={busy}>
                      rotate
                    </button>
                  </div>
                ) : (
                  <button className="button ghost small" type="button" onClick={getCode} disabled={busy}>
                    Show my invite code
                  </button>
                )}
                <p className="muted small" style={{ margin: 0 }}>
                  Give this to your therapist. It works once, and rotating it cancels the old one.
                </p>
              </div>
            </>
          ) : (
            <>
              <p className="muted small" style={{ margin: 0 }}>
                You can see an athlete's data only through an active link they control.
              </p>
              {links?.athletes?.length ? (
                <ul className="list-reset">
                  {links.athletes.map((athlete) => (
                    <li key={athlete.id} className="row between">
                      <span>
                        <Link to={`/therapist/athlete/${athlete.id}`}>{athlete.name}</Link>
                        <div className="muted small">{athlete.email}</div>
                      </span>
                      <button
                        type="button"
                        className="button danger small"
                        onClick={() => revoke(athlete.linkId)}
                        disabled={busy}
                      >
                        Unlink
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small" style={{ margin: 0 }}>
                  No athletes linked yet.
                </p>
              )}
            </>
          )}
        </section>
      </div>

      {user.role === ROLES.ATHLETE && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Your data</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Video is never uploaded. Only measurements and compact landmark sequences are saved, and this deletes
            all of it along with your account.
          </p>
          <button className="button danger small" type="button" onClick={removeAccount} disabled={busy}>
            Delete my account and data
          </button>
        </section>
      )}

      <Disclaimer />
    </div>
  );
}
