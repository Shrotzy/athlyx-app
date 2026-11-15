import { Link } from 'react-router-dom';

import { useAuth } from '../lib/auth.jsx';
import { Disclaimer } from '../components/common.jsx';
import { DISCLAIMER_SHORT, PARAMS } from '@shared/constants.js';

export default function Welcome() {
  const { user } = useAuth();
  const home = user?.role === 'therapist' ? '/therapist' : '/athlete';

  return (
    <div className="stack">
      <section className="hero-mark">
        <h1 className="brand-hero">ATHLYx</h1>
        <div className="row" style={{ justifyContent: 'center' }}>
          {user ? (
            <Link className="button" to={home}>
              Go to my dashboard
            </Link>
          ) : (
            <>
              <Link className="button" to="/signup">
                Create an account
              </Link>
              <Link className="button ghost" to="/login">
                Sign in
              </Link>
            </>
          )}
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Demo accounts after <span className="tag">npm run seed</span>: athlete@athlyx.demo and
          therapist@athlyx.demo, password <span className="tag">athlyx-demo</span>.
        </p>
      </section>

      <Disclaimer>
        {DISCLAIMER_SHORT} Distance symmetry can look normal while landing mechanics do not, so neither replaces
        strength testing, psychological readiness assessment or clinical judgement.
      </Disclaimer>

      <section className="grid-2">
        <article className="card">
          <h2>How the score works</h2>
          <p>
            The Limb Symmetry Index expresses the operated leg as a percentage of the healthy leg, where 100%
            means equal performance.
          </p>
          <ul className="list-reset small muted">
            <li>Hop tests: operated distance ÷ healthy distance × 100, capped at 100%.</li>
            <li>
              Landing quality: 70% knee valgus score + 30% lateral trunk lean score, both with a{' '}
              {PARAMS.lowerIsBetterBuffer}° buffer so perfect alignment cannot divide by zero.
            </li>
            <li>
              Status: {PARAMS.targetScore}% target, {PARAMS.borderlineLow}–{PARAMS.borderlineHigh}% borderline band,
              fixed rules only — never an AI model.
            </li>
            <li>Median of valid trials, at least {PARAMS.minValidTrials} per leg.</li>
          </ul>
        </article>

        <article className="card">
          <h2>What it will not do</h2>
          <ul className="list-reset small muted">
            <li>Diagnose an injury or measure healing.</li>
            <li>Clear anyone to return to sport.</li>
            <li>Replace strength, psychological readiness or clinical assessment.</li>
            <li>Store or upload video. Only measurements and skeleton landmarks are saved.</li>
            <li>Decide exercises. Your therapist does.</li>
          </ul>
          <p className="muted small" style={{ marginTop: '0.7rem' }}>
            2D camera measurement is less accurate than lab equipment. Small differences can fall inside
            measurement noise, which is why the app compares you against your own healthy leg, uses several
            trials and reports a borderline band.
          </p>
        </article>
      </section>
    </div>
  );
}
