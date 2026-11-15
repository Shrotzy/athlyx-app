import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Disclaimer, ErrorBanner, Loading, StatusBadge, formatDate } from '../components/common.jsx';
import TrendChart from '../components/TrendChart.jsx';
import { api } from '../lib/api.js';
import { addDays } from '../lib/dates.js';
import { TEST_LIST, TEST_META } from '@shared/constants.js';

export default function AthleteDetail() {
  const { id } = useParams();
  const [athletes, setAthletes] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [points, setPoints] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ tests: TEST_LIST, cadenceDays: 14, nextCheckIn: addDays(14), note: '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = async () => {
    const [athleteData, assignmentData, sessionData, progressData] = await Promise.all([
      api.get('/athletes'),
      api.get(`/assignments?athleteId=${id}`),
      api.get(`/sessions?athleteId=${id}&limit=50`),
      api.get(`/sessions/progress?athleteId=${id}`),
    ]);
    setAthletes(athleteData.athletes);
    setAssignments(assignmentData.assignments);
    setSessions(sessionData.sessions);
    setPoints(progressData.points);
  };

  useEffect(() => {
    let cancelled = false;
    load()
      .then(() => {
        if (cancelled) return;
        setLoading(false);
      })
      .catch((problem) => {
        if (!cancelled) {
          setError(problem);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const athlete = athletes.find((item) => String(item.id) === String(id));
  const assignment = assignments.find((item) => item.active) || assignments[0] || null;

  useEffect(() => {
    if (assignment) {
      setForm({
        tests: assignment.tests,
        cadenceDays: assignment.cadenceDays,
        nextCheckIn: assignment.nextCheckIn || addDays(assignment.cadenceDays),
        note: assignment.note || '',
      });
    }
  }, [assignment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTest = (test) => {
    setForm((current) => ({
      ...current,
      tests: current.tests.includes(test)
        ? current.tests.filter((item) => item !== test)
        : [...current.tests, test],
    }));
  };

  const saveAssignment = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      if (assignment) {
        await api.patch(`/assignments/${assignment.id}`, form);
      } else {
        await api.post('/assignments', { athleteId: Number(id), ...form });
      }
      await load();
      setSaved(true);
    } catch (problem) {
      setError(problem);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading>Loading athlete…</Loading>;
  if (!athlete) {
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          This athlete is not linked to your account.
        </p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <span className="eyebrow">Athlete</span>
          <h1 style={{ marginBottom: '0.2rem' }}>{athlete.name}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {athlete.operatedLeg ? `${athlete.operatedLeg} leg operated` : 'operated leg not set'} ·{' '}
            {athlete.email} · linked {formatDate(athlete.linkedAt)}
          </p>
        </div>
        <div className="row">
          <Link className="button ghost small" to={`/therapist/plan/new?athleteId=${id}`}>
            Build plan
          </Link>
          <Link className="button ghost small" to="/therapist">
            All athletes
          </Link>
        </div>
      </div>

      <ErrorBanner error={error?.message} details={error?.details} />

      <section className="card stack">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Assignment and schedule</h2>
          {assignment ? <StatusBadge status={null}>{assignment.active ? 'active' : 'inactive'}</StatusBadge> : null}
        </div>
        <form className="stack" onSubmit={saveAssignment}>
          <div className="stack" style={{ gap: '0.4rem' }}>
            <span className="field-label">Tests to run</span>
            <div className="row">
              {TEST_LIST.map((test) => (
                <label className="check" key={test}>
                  <input
                    type="checkbox"
                    checked={form.tests.includes(test)}
                    onChange={() => toggleTest(test)}
                  />
                  <span>{TEST_META[test].shortLabel}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="grid-3">
            <label className="field">
              <span className="field-label">Check-in every (days)</span>
              <input
                type="number"
                min={1}
                max={90}
                value={form.cadenceDays}
                onChange={(event) =>
                  setForm((current) => ({ ...current, cadenceDays: Number(event.target.value) }))
                }
              />
            </label>
            <label className="field">
              <span className="field-label">Next check-in</span>
              <input
                type="date"
                value={form.nextCheckIn}
                onChange={(event) => setForm((current) => ({ ...current, nextCheckIn: event.target.value }))}
              />
            </label>
            <label className="field">
              <span className="field-label">Note for the athlete</span>
              <input
                value={form.note}
                onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                placeholder="Cleared for hop testing…"
              />
            </label>
          </div>
          <div className="row">
            <button className="button small" type="submit" disabled={saving || form.tests.length === 0}>
              {saving ? 'Saving…' : assignment ? 'Save assignment' : 'Create assignment'}
            </button>
            {saved && <span className="small" style={{ color: 'var(--good)' }}>Saved.</span>}
          </div>
        </form>
      </section>

      <TrendChart points={points} showStatus />

      <section className="card stack">
        <h2 style={{ margin: 0 }}>Check-ins</h2>
        {sessions.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No check-ins yet.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Single hop</th>
                <th>Crossover</th>
                <th>Landing</th>
                <th>Trend</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id}>
                  <td>{formatDate(session.capturedAt)}</td>
                  <td className="mono">{session.scores?.singleHop ?? '—'}%</td>
                  <td className="mono">{session.scores?.crossoverHop ?? '—'}%</td>
                  <td className="mono">{session.scores?.landing ?? '—'}%</td>
                  <td className="mono">{session.trendScore ?? '—'}%</td>
                  <td>
                    <StatusBadge status={session.status} />
                  </td>
                  <td>
                    <Link className="small" to={`/therapist/session/${session.id}`}>
                      Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Disclaimer />
    </div>
  );
}
