import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Disclaimer, ErrorBanner, SafetyNotice } from '../components/common.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { clearDraft, draftOverview, loadDraft, startDraft } from '../lib/draft.js';
import { LEGS, PARAMS, TEST_LIST, TEST_META } from '@shared/constants.js';

export default function CheckIn() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(() => loadDraft());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!draft) {
      setDraft(
        startDraft({
          assignmentId: null,
          tests: TEST_LIST,
          operatedLeg: user?.operatedLeg,
        }),
      );
    }
  }, [draft, user?.operatedLeg]);

  if (!draft) return null;

  const overview = draftOverview(draft);
  const sideTests = draft.tests.filter((test) => TEST_META[test].cameraView === 'side');
  const frontTests = draft.tests.filter((test) => TEST_META[test].cameraView === 'front');

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const onlyFront = draft.trials.every((trial) => TEST_META[trial.test]?.cameraView === 'front');
      const onlySide = draft.trials.every((trial) => TEST_META[trial.test]?.cameraView === 'side');
      const data = await api.post('/sessions', {
        assignmentId: draft.assignmentId || null,
        capturedAt: new Date().toISOString(),
        cameraSetup: onlyFront ? 'front' : onlySide ? 'side' : null,
        noisy: Boolean(draft.noisy),
        trials: draft.trials,
      });
      clearDraft();
      navigate(`/athlete/session/${data.session.id}`);
    } catch (problem) {
      setError(problem);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="stack">
      <div>
        <span className="eyebrow">Check-in</span>
        <h1>Run each test on each leg</h1>
        <p className="muted" style={{ margin: 0 }}>
          One practice trial and {PARAMS.scoredTrials} scored trials per leg. At least {PARAMS.minValidTrials}{' '}
          valid trials are needed before a leg is scored.
        </p>
      </div>

      <SafetyNotice />
      <Disclaimer />

      {error && <ErrorBanner error={error.message} details={error.details} />}

      {!user.operatedLeg && (
        <div className="notice">
          <strong>Which leg is the operated one?</strong> Set it in <Link to="/account">your account</Link> so the
          app compares in the right direction.
        </div>
      )}

      <section className="card stack">
        <h2 style={{ margin: 0 }}>Setup checklist</h2>
        <ul className="list-reset small muted">
          <li>Warm up first, use a clear non-slip surface and stop if you feel pain.</li>
          <li>
            Mark a start line on the floor{sideTests.length > 0 ? '' : ' (not needed for the landing test)'} and a
            centre line for the crossover hop.
          </li>
          <li>Prop the camera on a stable stand. Side view for the hop tests, front view for the landing test.</li>
          <li>Keep the camera in exactly the same place for both legs and every trial.</li>
          <li>Make sure your whole body, feet included, is in frame, and record at 60 fps if you can.</li>
        </ul>
      </section>

      <div className="grid-2">
        {[['side', sideTests, 'Side view'], ['front', frontTests, 'Front view']].map(([view, tests, title]) =>
          tests.length > 0 ? (
            <section className="card stack" key={view}>
              <div className="row between">
                <h2 style={{ margin: 0 }}>{title}</h2>
                <span className="tag">{view === 'side' ? 'hop tests' : 'landing test'}</span>
              </div>
              {tests.map((test) => (
                <div key={test} className="stack" style={{ gap: '0.4rem' }}>
                  <div className="row between">
                    <strong>{TEST_META[test].label}</strong>
                  </div>
                  <p className="muted small" style={{ margin: 0 }}>
                    {TEST_META[test].athleteBrief}
                  </p>
                  <div className="trial-grid">
                    {[LEGS.OPERATED, LEGS.HEALTHY].map((leg) => {
                      const row = overview.rows.find((item) => item.test === test && item.leg === leg);
                      return (
                        <div key={leg} className={`trial-pill ${row?.complete ? 'done' : ''}`}>
                          <strong>{leg === LEGS.OPERATED ? 'Operated leg' : 'Healthy leg'}</strong>
                          <div className="muted small">
                            {row?.validCount || 0} valid / {row?.attempts || 0} attempts
                            {row?.practice ? ' · practice done' : ''}
                          </div>
                          {row?.complete ? (
                            <span className="small" style={{ color: 'var(--good)' }}>
                              Complete
                            </span>
                          ) : (
                            <Link className="small" to={`/athlete/check-in/${test}/${leg}`}>
                              {row?.attempts ? 'Continue' : 'Start'}
                            </Link>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
          ) : null,
        )}
      </div>

      <section className="card stack">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Finish</h2>
          <span className="tag">
            {overview.rows.filter((row) => row.complete).length}/{overview.rows.length} legs complete
          </span>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Submitted trials are scored on the server from the measurements, and voided trials are never scored.
          Your camera video stays in this browser.
        </p>
        <div className="row">
          <button className="button" type="button" onClick={submit} disabled={!overview.complete || submitting}>
            {submitting ? 'Saving…' : 'Submit check-in'}
          </button>
          <button
            className="button ghost"
            type="button"
            onClick={() => {
              clearDraft();
              navigate('/athlete');
            }}
          >
            Discard
          </button>
        </div>
        {!overview.complete && (
          <p className="muted small" style={{ margin: 0 }}>
            Every test and leg needs at least {PARAMS.minValidTrials} valid trials before you can submit.
          </p>
        )}
      </section>
    </div>
  );
}
