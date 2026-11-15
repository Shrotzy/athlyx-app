import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { Disclaimer, ErrorBanner, Loading, StatusBadge, formatDate } from '../components/common.jsx';
import TrendChart from '../components/TrendChart.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { ROLES } from '@shared/constants.js';

export default function History() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [points, setPoints] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const isTherapist = user.role === ROLES.THERAPIST;

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.get('/sessions?limit=50'), api.get('/sessions/progress')])
      .then(([sessionData, progressData]) => {
        if (cancelled) return;
        setSessions(sessionData.sessions);
        setPoints(progressData.points);
      })
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

  if (loading) return <Loading>Loading history…</Loading>;

  return (
    <div className="stack">
      <div>
        <span className="eyebrow">Progress</span>
        <h1>Change over time</h1>
        <p className="muted" style={{ margin: 0 }}>
          Each point is one check-in. A change is only meaningful when the camera setup was the same.
        </p>
      </div>

      <ErrorBanner error={error?.message} details={error?.details} />

      <TrendChart points={points} showStatus={isTherapist} />

      <section className="card stack">
        <h2 style={{ margin: 0 }}>Check-ins</h2>
        {sessions.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nothing recorded yet.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Single hop</th>
                <th>Landing</th>
                {isTherapist && <th>Status</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id}>
                  <td>{formatDate(session.capturedAt)}</td>
                  <td className="mono">{session.scores?.singleHop ?? '—'}%</td>
                  <td className="mono">{session.scores?.landing ?? '—'}%</td>
                  {isTherapist && (
                    <td>
                      <StatusBadge status={session.status} />
                    </td>
                  )}
                  <td>
                    <Link
                      className="small"
                      to={
                        isTherapist
                          ? `/therapist/session/${session.id}`
                          : `/athlete/session/${session.id}`
                      }
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {!isTherapist && (
        <p className="muted small">
          Your physical therapist sees the criteria status. You see the scores and a summary.
        </p>
      )}

      <Disclaimer />
    </div>
  );
}
