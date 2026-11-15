import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { Disclaimer, ErrorBanner, Loading, StatusBadge, formatDate } from '../components/common.jsx';
import { api } from '../lib/api.js';
import { TEST_META } from '@shared/constants.js';

export default function TherapistHome() {
  const [athletes, setAthletes] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkMessage, setLinkMessage] = useState(null);

  const load = async () => {
    const data = await api.get('/athletes');
    setAthletes(data.athletes);
  };

  useEffect(() => {
    let cancelled = false;
    load()
      .catch((problem) => {
        if (!cancelled) setError(problem);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const redeem = async (event) => {
    event.preventDefault();
    setLinking(true);
    setError(null);
    setLinkMessage(null);
    try {
      const data = await api.post('/links/redeem', { code: code.trim() });
      setLinkMessage(`Linked to ${data.athlete.name}.`);
      setCode('');
      await load();
    } catch (problem) {
      setError(problem);
    } finally {
      setLinking(false);
    }
  };

  if (loading) return <Loading>Loading your athletes…</Loading>;

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <span className="eyebrow">Physical therapist</span>
          <h1>Your athletes</h1>
          <p className="muted" style={{ margin: 0 }}>
            You see an athlete's data only through an active link they control, and they can revoke it at any
            time.
          </p>
        </div>
      </div>

      <ErrorBanner error={error?.message} details={error?.details} />
      {linkMessage && <div className="notice">{linkMessage}</div>}

      <section className="card stack">
        <h2 style={{ margin: 0 }}>Link an athlete</h2>
        <form className="row" onSubmit={redeem}>
          <input
            style={{ maxWidth: 220 }}
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="Invite code"
            aria-label="Invite code"
          />
          <button className="button small" type="submit" disabled={linking || code.trim().length < 4}>
            {linking ? 'Linking…' : 'Link athlete'}
          </button>
        </form>
        <p className="muted small" style={{ margin: 0 }}>
          The athlete generates this code in their account page. Codes are single use.
        </p>
      </section>

      {athletes.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No linked athletes yet. Ask your athlete for their invite code.
          </p>
        </div>
      ) : (
        <div className="grid-2">
          {athletes.map((athlete) => {
            const delta =
              athlete.latest?.trendScore != null && athlete.previousTrend != null
                ? Math.round((athlete.latest.trendScore - athlete.previousTrend) * 10) / 10
                : null;
            return (
              <article key={athlete.id} className="card stack">
                <div className="row between">
                  <div>
                    <h2 style={{ marginBottom: '0.15rem' }}>{athlete.name}</h2>
                    <p className="muted small" style={{ margin: 0 }}>
                      {athlete.operatedLeg ? `${athlete.operatedLeg} leg operated` : 'operated leg not set'} ·{' '}
                      {athlete.sessionCount} check-in{athlete.sessionCount === 1 ? '' : 's'}
                    </p>
                  </div>
                  <StatusBadge status={athlete.latest?.status} />
                </div>

                {athlete.latest ? (
                  <div className="row between">
                    <div>
                      <div className="muted small">Latest trend score</div>
                      <div className="score">{athlete.latest.trendScore ?? '—'}%</div>
                    </div>
                    <div className="small muted" style={{ textAlign: 'right' }}>
                      {formatDate(athlete.latest.capturedAt)}
                      {delta != null && (
                        <div style={{ color: delta >= 0 ? 'var(--good)' : 'var(--bad)' }}>
                          {delta >= 0 ? '+' : ''}
                          {delta} pts since last
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="muted small" style={{ margin: 0 }}>
                    No check-ins yet.
                  </p>
                )}

                {athlete.latest?.responsible?.length > 0 && (
                  <p className="small" style={{ margin: 0, color: '#fda4af' }}>
                    {athlete.latest.responsible[0].reason}
                  </p>
                )}

                <div className="row between small muted">
                  <span>Next check-in: {athlete.nextCheckIn ? formatDate(athlete.nextCheckIn) : 'not set'}</span>
                  {athlete.planProgress && (
                    <span>
                      Plan {athlete.planProgress.done}/{athlete.planProgress.total}
                    </span>
                  )}
                </div>

                {athlete.assignment && (
                  <p className="small muted" style={{ margin: 0 }}>
                    Assigned: {athlete.assignment.tests.map((test) => TEST_META[test]?.shortLabel || test).join(', ')}
                  </p>
                )}

                <div className="row">
                  <Link className="button small" to={`/therapist/athlete/${athlete.id}`}>
                    Open athlete
                  </Link>
                  <Link className="button ghost small" to={`/therapist/plan/new?athleteId=${athlete.id}`}>
                    Build plan
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Disclaimer>
        Statuses come from fixed, transparent rules applied to measured values. They are not diagnoses and not
        return-to-sport clearance.
      </Disclaimer>
    </div>
  );
}
