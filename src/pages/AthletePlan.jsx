import { useEffect, useState } from 'react';

import { Disclaimer, ErrorBanner, Loading, formatDate } from '../components/common.jsx';
import { api } from '../lib/api.js';

export default function AthletePlan() {
  const [plans, setPlans] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    const data = await api.get('/plans');
    setPlans(data.plans);
  };

  useEffect(() => {
    let cancelled = false;
    load()
      .catch((problem) => !cancelled && setError(problem))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (planId, item) => {
    setBusyId(item.id);
    try {
      await api.post(`/plans/${planId}/items/${item.id}/complete`, { completed: !item.completed });
      await load();
    } catch (problem) {
      setError(problem);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <Loading>Loading your plan…</Loading>;

  return (
    <div className="stack">
      <div>
        <span className="eyebrow">Exercise plan</span>
        <h1>Your plan</h1>
        <p className="muted" style={{ margin: 0 }}>
          Tick exercises off as you complete them so your therapist can see your progress before the next
          check-in.
        </p>
      </div>

      <ErrorBanner error={error?.message} details={error?.details} />

      {plans.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No plan yet. Your physical therapist writes plans; nothing here is generated automatically.
          </p>
        </div>
      ) : (
        plans.map((plan) => (
          <section key={plan.id} className="card stack">
            <div className="row between">
              <div>
                <h2 style={{ margin: 0 }}>From {plan.therapist?.name}</h2>
                <p className="muted small" style={{ margin: 0 }}>
                  {formatDate(plan.createdAt)} · {plan.items.filter((item) => item.completed).length}/
                  {plan.items.length} complete
                </p>
              </div>
            </div>

            {plan.message && <p className="notice">{plan.message}</p>}

            <ul className="list-reset">
              {plan.items.map((item) => (
                <li key={item.id}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={item.completed}
                      disabled={busyId === item.id}
                      onChange={() => toggle(plan.id, item)}
                    />
                    <span>
                      <strong>{item.name}</strong>
                      <span className="muted">
                        {item.sets ? ` — ${item.sets} sets` : ''}
                        {item.reps ? ` × ${item.reps}` : ''}
                      </span>
                      {item.instructions && <div className="muted small">{item.instructions}</div>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            <div className="safety" style={{ marginBottom: 0 }}>
              <strong>Safety.</strong> {plan.safetyNotice}
            </div>
          </section>
        ))
      )}

      <Disclaimer />
    </div>
  );
}
