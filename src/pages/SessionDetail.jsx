import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import SkeletonCanvas from '../components/SkeletonCanvas.jsx';
import {
  Disclaimer,
  ErrorBanner,
  Loading,
  Score,
  StatusBadge,
  formatDateTime,
} from '../components/common.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { DECISIONS, DECISION_LABEL, LEGS, ROLES, STATUS_LABEL, TEST_LIST, TEST_META } from '@shared/constants.js';
import { VOID_REASONS } from '@shared/validation.js';
import { decodeLandmarks } from '@shared/landmarks.js';

function MetricRows({ test, entry }) {
  if (!entry) return null;
  const operated = entry.legs?.[LEGS.OPERATED]?.metrics || {};
  const healthy = entry.legs?.[LEGS.HEALTHY]?.metrics || {};
  const cell = (value, unit) => (value == null ? '—' : `${value}${unit}`);

  if (test === 'single-leg-landing') {
    return (
      <table>
        <thead>
          <tr>
            <th>Marker (median)</th>
            <th>Operated</th>
            <th>Healthy</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Peak knee valgus</td>
            <td className="mono">{cell(operated.valgusDeg, '°')}</td>
            <td className="mono">{cell(healthy.valgusDeg, '°')}</td>
          </tr>
          <tr>
            <td>Peak lateral trunk lean</td>
            <td className="mono">{cell(operated.trunkLeanDeg, '°')}</td>
            <td className="mono">{cell(healthy.trunkLeanDeg, '°')}</td>
          </tr>
        </tbody>
      </table>
    );
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Measurement (median)</th>
          <th>Operated</th>
          <th>Healthy</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Hop distance</td>
          <td className="mono">{cell(operated.hopDistanceCm, ' cm')}</td>
          <td className="mono">{cell(healthy.hopDistanceCm, ' cm')}</td>
        </tr>
        <tr>
          <td>Landing knee flexion (supporting)</td>
          <td className="mono">{cell(operated.kneeFlexionDeg, '°')}</td>
          <td className="mono">{cell(healthy.kneeFlexionDeg, '°')}</td>
        </tr>
        <tr>
          <td>Forward trunk lean (supporting)</td>
          <td className="mono">{cell(operated.forwardTrunkLeanDeg, '°')}</td>
          <td className="mono">{cell(healthy.forwardTrunkLeanDeg, '°')}</td>
        </tr>
      </tbody>
    </table>
  );
}

export default function SessionDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isTherapist = user.role === ROLES.THERAPIST;

  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedTrialId, setSelectedTrialId] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [explanation, setExplanation] = useState(null);
  const [explainError, setExplainError] = useState(null);
  const [decision, setDecision] = useState(DECISIONS.CONFIRM);
  const [decisionNote, setDecisionNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get(`/sessions/${id}`)
      .then((data) => {
        if (cancelled) return;
        setSession(data.session);
        const withLandmarks = data.session.trials.find((trial) => trial.landmarks?.frames?.length);
        setSelectedTrialId(withLandmarks?.id ?? data.session.trials[0]?.id ?? null);
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
  }, [id]);

  const selectedTrial = useMemo(
    () => session?.trials.find((trial) => trial.id === selectedTrialId) || null,
    [session, selectedTrialId],
  );
  const selectedLandmarks = useMemo(
    () => (selectedTrial?.landmarks ? decodeLandmarks(selectedTrial.landmarks) : null),
    [selectedTrial],
  );

  const reload = async () => {
    const data = await api.get(`/sessions/${id}`);
    setSession(data.session);
    return data.session;
  };

  const addNote = async (event) => {
    event.preventDefault();
    if (!selectedTrial || !noteDraft.trim()) return;
    setBusy(true);
    try {
      const data = await api.post(`/sessions/${id}/notes`, { trialId: selectedTrial.id, note: noteDraft });
      setSession(data.session);
      setNoteDraft('');
    } catch (problem) {
      setError(problem);
    } finally {
      setBusy(false);
    }
  };

  const saveDecision = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await api.post(`/sessions/${id}/decision`, { decision, note: decisionNote });
      setSession(data.session);
      setDecisionNote('');
    } catch (problem) {
      setError(problem);
    } finally {
      setBusy(false);
    }
  };

  const explain = async () => {
    setExplainError(null);
    setBusy(true);
    try {
      const data = await api.post('/insights/explain', {
        sessionId: Number(id),
        audience: isTherapist ? 'therapist' : 'athlete',
      });
      setExplanation(data.explanation);
    } catch (problem) {
      setExplainError(problem.message);
    } finally {
      setBusy(false);
    }
  };

  const removeSession = async () => {
    if (!window.confirm('Delete this check-in and its landmark data? This cannot be undone.')) return;
    setBusy(true);
    try {
      await api.del(`/sessions/${id}`);
      navigate('/athlete/history');
    } catch (problem) {
      setError(problem);
      setBusy(false);
    }
  };

  if (loading) return <Loading>Loading check-in…</Loading>;
  if (error && !session) return <ErrorBanner error={error.message} details={error.details} />;
  if (!session) return null;

  const results = session.results || {};
  const backTo = isTherapist ? `/therapist/athlete/${session.athlete.id}` : '/athlete/history';

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <span className="eyebrow">Check-in</span>
          <h1 style={{ marginBottom: '0.25rem' }}>
            {formatDateTime(session.capturedAt)}
            {isTherapist ? ` · ${session.athlete.name}` : ''}
          </h1>
          <p className="muted" style={{ margin: 0 }}>
            {results.trialSummary
              ? `${results.trialSummary.valid} valid · ${results.trialSummary.voided} voided of ${results.trialSummary.submitted} trials`
              : ''}
            {session.cameraSetup ? ` · ${session.cameraSetup} view` : ''}
            {session.noisy ? ' · flagged noisy' : ''}
          </p>
        </div>
        <div className="row">
          <Link className="button ghost small" to={backTo}>
            Back
          </Link>
          {!isTherapist && (
            <button className="button danger small" type="button" onClick={removeSession} disabled={busy}>
              Delete
            </button>
          )}
        </div>
      </div>

      <ErrorBanner error={error?.message} details={error?.details} />

      {!isTherapist ? (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Your summary</h2>
          <p style={{ margin: 0 }}>
            These are your measured symmetry scores. Your therapist will review the full results, the movement
            markers and the replay, and will follow up with you.
          </p>
          <div className="grid-3">
            {TEST_LIST.map((test) => {
              const entry = results.tests?.[test];
              return (
                <div key={test} className="card tight">
                  <div className="muted small">{TEST_META[test].shortLabel}</div>
                  <Score value={entry?.score} label={entry?.scoredBy === 'distance' ? 'LSI' : 'quality'} />
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="card stack">
          <div className="row between">
            <h2 style={{ margin: 0 }}>Criteria status</h2>
            <StatusBadge status={results.status} />
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            Fixed rules only: {STATUS_LABEL[results.status]} — never an AI model.
          </p>
          {results.responsible?.length > 0 && (
            <ul className="list-reset small">
              {results.responsible.map((item) => (
                <li key={item.reason} style={{ color: '#fda4af' }}>
                  {item.reason}
                </li>
              ))}
            </ul>
          )}
          {results.notes?.length > 0 && (
            <ul className="list-reset small muted">
              {results.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          <p className="muted small" style={{ margin: 0 }}>
            This is one set of tests. Hop and landing results are one part of a broader assessment, and the
            clinical decision stays with you.
          </p>
        </div>
      )}

      <div className="grid-3">
        {TEST_LIST.map((test) => {
          const entry = results.tests?.[test];
          return (
            <div key={test} className="card">
              <div className="muted small">{TEST_META[test].shortLabel}</div>
              <Score value={entry?.score} label={entry?.scoredBy === 'distance' ? 'LSI' : 'quality'} />
              {entry?.markers && (
                <p className="muted small" style={{ margin: '0.35rem 0 0' }}>
                  valgus {entry.markers.valgusScore}% · trunk {entry.markers.trunkScore}%
                </p>
              )}
              {entry?.insufficient && <p className="small hud-warn">Insufficient valid trials.</p>}
            </div>
          );
        })}
      </div>

      {TEST_LIST.map((test) => {
        const entry = results.tests?.[test];
        if (!entry) return null;
        return (
          <section className="card stack" key={test}>
            <div className="row between">
              <h2 style={{ margin: 0 }}>{TEST_META[test].label}</h2>
              <span className="tag">
                {entry.legs?.[LEGS.OPERATED]?.validCount || 0} + {entry.legs?.[LEGS.HEALTHY]?.validCount || 0}{' '}
                valid trials
              </span>
            </div>
            <MetricRows test={test} entry={entry} />
            <table>
              <thead>
                <tr>
                  <th>Trial</th>
                  <th>Leg</th>
                  <th>Values</th>
                  <th>Valid</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {session.trials
                  .filter((trial) => trial.test === test)
                  .map((trial) => (
                    <tr key={trial.id}>
                      <td>#{trial.trialNo}</td>
                      <td>{trial.leg === LEGS.OPERATED ? 'operated' : 'healthy'}</td>
                      <td className="mono small">
                        {test === 'single-leg-landing'
                          ? `valgus ${trial.metrics.valgusDeg ?? '—'}°, trunk ${trial.metrics.trunkLeanDeg ?? '—'}°`
                          : `${trial.metrics.hopDistanceCm ?? '—'} cm`}
                      </td>
                      <td>
                        {trial.valid ? (
                          <span style={{ color: 'var(--good)' }}>valid</span>
                        ) : (
                          <span className="small" style={{ color: 'var(--bad)' }}>
                            {(trial.voidReasons || []).map((reason) => VOID_REASONS[reason] || reason).join(', ') ||
                              'voided'}
                          </span>
                        )}
                      </td>
                      <td>
                        {trial.landmarks?.frames?.length > 0 && (
                          <button
                            type="button"
                            className="link-button small"
                            onClick={() => setSelectedTrialId(trial.id)}
                          >
                            replay
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        );
      })}

      <section className="card stack">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Skeleton replay</h2>
          {selectedTrial && (
            <span className="tag">
              {TEST_META[selectedTrial.test]?.shortLabel} · #{selectedTrial.trialNo} ·{' '}
              {selectedTrial.leg === LEGS.OPERATED ? 'operated' : 'healthy'}
            </span>
          )}
        </div>
        <div className="grid-2">
          <div>
            <SkeletonCanvas landmarks={selectedLandmarks} />
            <p className="muted small" style={{ marginTop: '0.5rem' }}>
              Rebuilt from stored landmarks only. No video was recorded or uploaded, so the therapist can verify
              what the camera saw.
            </p>
          </div>
          <div className="stack">
            {selectedTrial ? (
              <>
                <p className="small" style={{ margin: 0 }}>
                  {selectedTrial.test === 'single-leg-landing'
                    ? `Peak valgus ${selectedTrial.metrics.valgusDeg ?? '—'}° · trunk lean ${
                        selectedTrial.metrics.trunkLeanDeg ?? '—'
                      }°`
                    : `Distance ${selectedTrial.metrics.hopDistanceCm ?? '—'} cm · knee flexion ${
                        selectedTrial.metrics.kneeFlexionDeg ?? '—'
                      }° · trunk lean ${selectedTrial.metrics.forwardTrunkLeanDeg ?? '—'}°`}
                </p>
                {isTherapist && (
                  <>
                    <form className="stack" onSubmit={addNote}>
                      <label className="field">
                        <span className="field-label">Note on this trial</span>
                        <textarea
                          value={noteDraft}
                          onChange={(event) => setNoteDraft(event.target.value)}
                          placeholder="What did you see in this trial?"
                        />
                      </label>
                      <button className="button small" type="submit" disabled={busy || !noteDraft.trim()}>
                        Save note
                      </button>
                    </form>
                    {selectedTrial.notes?.length > 0 && (
                      <ul className="list-reset small">
                        {selectedTrial.notes.map((note) => (
                          <li key={note.id}>
                            <strong>{note.therapistName}</strong> · {formatDateTime(note.createdAt)}
                            <div className="muted">{note.note}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </>
            ) : (
              <p className="muted small">Select a trial above to replay it.</p>
            )}
          </div>
        </div>
      </section>

      {isTherapist && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Decision</h2>
          {session.decision ? (
            <p className="small" style={{ margin: 0 }}>
              <strong>{DECISION_LABEL[session.decision.decision]}</strong> by {session.decision.therapistName} ·{' '}
              {formatDateTime(session.decision.createdAt)}
              {session.decision.note ? ` — ${session.decision.note}` : ''}
            </p>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>
              No decision recorded for this session yet.
            </p>
          )}
          <form className="stack" onSubmit={saveDecision}>
            <div className="row">
              <label className="field" style={{ flex: '0 0 auto' }}>
                <span className="field-label">Decision</span>
                <select value={decision} onChange={(event) => setDecision(event.target.value)}>
                  {Object.values(DECISIONS).map((value) => (
                    <option key={value} value={value}>
                      {DECISION_LABEL[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ flex: 1 }}>
                <span className="field-label">Note</span>
                <input value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} />
              </label>
            </div>
            <div className="row">
              <button className="button small" type="submit" disabled={busy}>
                Record decision
              </button>
              <Link className="button ghost small" to={`/therapist/plan/new?athleteId=${session.athlete.id}`}>
                Build an exercise plan
              </Link>
            </div>
          </form>
        </section>
      )}

      <section className="card stack">
        <h2 style={{ margin: 0 }}>Plain-language explanation (optional)</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Explains the numbers above in words. It never recalculates a score, never changes the criteria status and
          never chooses exercises.
        </p>
        {explanation && <p className="notice">{explanation}</p>}
        {explainError && <div className="error">{explainError}</div>}
        <div className="row">
          <button className="button ghost small" type="button" onClick={explain} disabled={busy}>
            {busy ? 'Working…' : 'Explain these results'}
          </button>
        </div>
      </section>

      <Disclaimer />
    </div>
  );
}
