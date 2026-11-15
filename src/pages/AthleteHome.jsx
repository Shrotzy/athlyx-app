import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Disclaimer, ErrorBanner, Loading, SafetyNotice, formatDate } from '../components/common.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { clearDraft, draftOverview, loadDraft, startDraft } from '../lib/draft.js';
import { LEGS, TEST_META } from '@shared/constants.js';

function ScoreLine({ label, value }) {
  const shown = value == null ? '—' : `${value}%`;
  return (
    <li className="row between" style={{ padding: '0.35rem 0' }}>
      <span>{label}</span>
      <span className="mono">{shown}</span>
    </li>
  );
}

export default function AthleteHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [plans, setPlans] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(() => loadDraft());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([api.get('/assignments'), api.get('/sessions?limit=5'), api.get('/plans')])
      .then(([assignmentData, sessionData, planData]) => {
        if (cancelled) return;
        setAssignments(assignmentData.assignments);
        setSessions(sessionData.sessions);
        setPlans(planData.plans);
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

  const assignment = assignments.find((item) => item.active) || assignments[0] || null;
  const currentPlan = plans[0] || null;
  const draftState = draft ? draftOverview(draft) : null;

  const beginCheckIn = ({ resume } = {}) => {
    if (resume && draft) {
      navigate('/athlete/check-in');
      return;
    }
    const tests = assignment?.tests?.length ? assignment.tests : undefined;
    const next = startDraft({ assignmentId: assignment?.id ?? null, tests, operatedLeg: user?.operatedLeg });
    setDraft(next);
    navigate('/athlete/check-in');
  };

  const discard = () => {
    clearDraft();
    setDraft(null);
  };

  if (loading) return <Loading>Loading your dashboard…</Loading>;

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <span className="eyebrow">Athlete dashboard</span>
          <h1>Hello, {user.name.split(' ')[0]}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {assignment
              ? `Assigned: ${assignment.tests.map((test) => TEST_META[test]?.shortLabel || test).join(', ')}`
              : 'No test assignment yet. Your physical therapist assigns which tests to run.'}
          </p>
        </div>
        <Link className="button ghost small" to="/athlete/history">
          History and trend
        </Link>
      </div>

      <ErrorBanner error={error?.message} details={error?.details} />

      {!user.operatedLeg && (
        <div className="notice">
          <strong>Set your operated leg first.</strong> The app needs to know which leg was operated on before it
          can compare the two. <Link to="/account">Add it in your account</Link>.
        </div>
      )}

      <SafetyNotice />

      <div className="grid-2">
        <section className="card stack">
          <div className="row between">
            <h2 style={{ margin: 0 }}>This check-in</h2>
            {assignment?.nextCheckIn && <span className="tag">next {formatDate(assignment.nextCheckIn)}</span>}
          </div>

          {draft && draftState ? (
            <>
              <p className="muted small" style={{ margin: 0 }}>
                Started {formatDate(draft.startedAt)} · {draftState.rows.filter((row) => row.complete).length} of{' '}
                {draftState.rows.length} test legs complete.
              </p>
              <div className="trial-grid">
                {draftState.rows.map((row) => (
                  <div key={`${row.test}:${row.leg}`} className={`trial-pill ${row.complete ? 'done' : ''}`}>
                    <strong>{TEST_META[row.test]?.shortLabel}</strong>
                    <div className="muted small">
                      {row.leg === LEGS.OPERATED ? 'operated leg' : 'healthy leg'} · {row.validCount}/
                      {row.attempts} valid
                    </div>
                  </div>
                ))}
              </div>
              <div className="row">
                <button className="button" type="button" onClick={() => beginCheckIn({ resume: true })}>
                  Resume check-in
                </button>
                <button className="button ghost" type="button" onClick={discard}>
                  Discard draft
                </button>
              </div>
            </>
          ) : (
            <>
              <p style={{ margin: 0 }}>
                One practice trial and three scored trials on each leg, for each assigned test. The camera stays
                fixed for the whole test so the two legs are comparable.
              </p>
              <button
                className="button"
                type="button"
                onClick={() => beginCheckIn()}
                disabled={!user.operatedLeg}
              >
                Start a check-in
              </button>
              {!assignment && (
                <p className="muted small" style={{ margin: 0 }}>
                  You can still run a check-in on all three tests, but your therapist has not set a schedule yet.
                </p>
              )}
            </>
          )}
        </section>

        <section className="card stack">
          <div className="row between">
            <h2 style={{ margin: 0 }}>Current plan</h2>
            <Link className="small" to="/athlete/plan">
              Open plan
            </Link>
          </div>
          {currentPlan ? (
            <>
              <p className="muted small" style={{ margin: 0 }}>
                From {currentPlan.therapist?.name} · {formatDate(currentPlan.createdAt)} ·{' '}
                {currentPlan.items.filter((item) => item.completed).length}/{currentPlan.items.length} done
              </p>
              <ul className="list-reset small">
                {currentPlan.items.slice(0, 4).map((item) => (
                  <li key={item.id} className="row between">
                    <span>
                      {item.completed ? '✓ ' : ''}
                      {item.name}
                    </span>
                    <span className="muted">
                      {item.sets ? `${item.sets} × ` : ''}
                      {item.reps || ''}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              No exercise plan yet. Plans are written by your physical therapist, never generated automatically.
            </p>
          )}
        </section>
      </div>

      <section className="card stack">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Recent check-ins</h2>
          <Link className="small" to="/athlete/history">
            See all
          </Link>
        </div>
        {sessions.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No check-ins yet. Your first one will show up here.
          </p>
        ) : (
          <div className="stack">
            {sessions.map((session) => (
              <div key={session.id} className="card tight">
                <div className="row between">
                  <div>
                    <strong>{formatDate(session.capturedAt)}</strong>
                    <div className="muted small">
                      {session.trialSummary
                        ? `${session.trialSummary.valid} valid of ${session.trialSummary.submitted} trials`
                        : ''}
                    </div>
                  </div>
                  <Link className="small" to={`/athlete/session/${session.id}`}>
                    Open summary
                  </Link>
                </div>
                <ul className="list-reset small" style={{ marginTop: '0.4rem' }}>
                  <ScoreLine label="Single hop" value={session.scores?.singleHop} />
                  <ScoreLine label="Crossover hop" value={session.scores?.crossoverHop} />
                  <ScoreLine label="Single-leg landing" value={session.scores?.landing} />
                </ul>
              </div>
            ))}
          </div>
        )}
        <p className="muted small" style={{ margin: 0 }}>
          Your therapist will review these results. The score here is your operated leg as a percentage of your
          healthy leg.
        </p>
      </section>

      <Disclaimer />
    </div>
  );
}
