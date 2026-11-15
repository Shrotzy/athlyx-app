import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { Disclaimer, ErrorBanner, Loading } from '../components/common.jsx';
import { api } from '../lib/api.js';
import { PLAN_SAFETY_NOTICE } from '@shared/constants.js';

export default function BuildPlan() {
  const [params] = useSearchParams();
  const athleteId = params.get('athleteId');
  const navigate = useNavigate();

  const [athletes, setAthletes] = useState([]);
  const [library, setLibrary] = useState([]);
  const [custom, setCustom] = useState([]);
  const [selected, setSelected] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', stage: '', instructions: '', sets: '3', reps: '10' });

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.get('/athletes'), api.get('/exercises')])
      .then(([athleteData, exerciseData]) => {
        if (cancelled) return;
        setAthletes(athleteData.athletes);
        setLibrary(exerciseData.library);
        setCustom(exerciseData.custom);
      })
      .catch((problem) => !cancelled && setError(problem))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (exercise, isCustom) => {
    setSelected((current) => {
      const exists = current.find((item) => item.key === `${isCustom ? 'c' : 'l'}-${exercise.id}`);
      if (exists) return current.filter((item) => item.key !== exists.key);
      return [
        ...current,
        {
          key: `${isCustom ? 'c' : 'l'}-${exercise.id}`,
          exerciseId: exercise.id,
          name: exercise.name,
          instructions: exercise.instructions,
          sets: '3',
          reps: '10',
        },
      ];
    });
  };

  const updateItem = (key, patch) => {
    setSelected((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  const addCustom = async (event) => {
    event.preventDefault();
    setError(null);
    try {
      const data = await api.post('/exercises', {
        name: form.name,
        stage: form.stage,
        instructions: form.instructions,
      });
      setCustom((current) => [...current, data.exercise]);
      setSelected((current) => [
        ...current,
        {
          key: `c-${data.exercise.id}`,
          exerciseId: data.exercise.id,
          name: data.exercise.name,
          instructions: data.exercise.instructions,
          sets: form.sets,
          reps: form.reps,
        },
      ]);
      setForm({ name: '', stage: '', instructions: '', sets: '3', reps: '10' });
    } catch (problem) {
      setError(problem);
    }
  };

  const send = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/plans', {
        athleteId: Number(athleteId),
        message,
        safetyNotice: PLAN_SAFETY_NOTICE,
        items: selected.map((item) => ({
          exerciseId: item.exerciseId,
          name: item.name,
          instructions: item.instructions,
          sets: item.sets,
          reps: item.reps,
        })),
      });
      navigate(`/therapist/athlete/${athleteId}`);
    } catch (problem) {
      setError(problem);
      setSaving(false);
    }
  };

  if (loading) return <Loading>Loading the exercise library…</Loading>;

  const athlete = athletes.find((item) => String(item.id) === String(athleteId));

  if (!athleteId || !athlete) {
    return (
      <div className="card stack">
        <h2>Choose an athlete</h2>
        <p className="muted">Pick the athlete this plan is for.</p>
        <div className="row">
          {athletes.map((item) => (
            <Link key={item.id} className="button ghost small" to={`/therapist/plan/new?athleteId=${item.id}`}>
              {item.name}
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <span className="eyebrow">Exercise plan</span>
          <h1 style={{ marginBottom: '0.2rem' }}>Plan for {athlete.name}</h1>
          <p className="muted" style={{ margin: 0 }}>
            Exercises are chosen by you, never by an AI model.
          </p>
        </div>
        <Link className="button ghost small" to={`/therapist/athlete/${athleteId}`}>
          Back to athlete
        </Link>
      </div>

      <ErrorBanner error={error?.message} details={error?.details} />

      <div className="grid-2">
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Library</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Demo library entries. Check the stage and dose against your own clinic protocol before sending.
          </p>
          <ul className="list-reset">
            {library.map((exercise) => {
              const key = `l-${exercise.id}`;
              return (
                <li key={key} className="stack" style={{ gap: '0.25rem' }}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={selected.some((item) => item.key === key)}
                      onChange={() => toggle(exercise, false)}
                    />
                    <span>
                      <strong>{exercise.name}</strong>
                      <span className="muted small"> — {exercise.stage}</span>
                    </span>
                  </label>
                  <span className="muted small">{exercise.source}</span>
                </li>
              );
            })}
          </ul>

          <h3>Your exercises</h3>
          {custom.length === 0 && <p className="muted small">None yet. Add one below.</p>}
          <ul className="list-reset">
            {custom.map((exercise) => {
              const key = `c-${exercise.id}`;
              return (
                <li key={key}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={selected.some((item) => item.key === key)}
                      onChange={() => toggle(exercise, true)}
                    />
                    <span>{exercise.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>

          <form className="stack" onSubmit={addCustom}>
            <h3 style={{ margin: 0 }}>New custom exercise</h3>
            <input
              placeholder="Name"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              required
            />
            <input
              placeholder="Stage (optional)"
              value={form.stage}
              onChange={(event) => setForm((current) => ({ ...current, stage: event.target.value }))}
            />
            <textarea
              placeholder="Instructions"
              value={form.instructions}
              onChange={(event) => setForm((current) => ({ ...current, instructions: event.target.value }))}
              required
            />
            <button className="button ghost small" type="submit">
              Add to my exercises
            </button>
          </form>
        </section>

        <section className="card stack">
          <h2 style={{ margin: 0 }}>The plan</h2>
          {selected.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Nothing selected yet.
            </p>
          ) : (
            <ul className="list-reset">
              {selected.map((item) => (
                <li key={item.key} className="stack" style={{ gap: '0.3rem' }}>
                  <strong>{item.name}</strong>
                  <div className="row">
                    <label className="field" style={{ flex: 1 }}>
                      <span className="field-label">Sets</span>
                      <input
                        value={item.sets}
                        onChange={(event) => updateItem(item.key, { sets: event.target.value })}
                      />
                    </label>
                    <label className="field" style={{ flex: 1 }}>
                      <span className="field-label">Reps</span>
                      <input
                        value={item.reps}
                        onChange={(event) => updateItem(item.key, { reps: event.target.value })}
                      />
                    </label>
                    <button
                      type="button"
                      className="link-button small"
                      onClick={() => setSelected((current) => current.filter((entry) => entry.key !== item.key))}
                    >
                      remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form className="stack" onSubmit={send}>
            <label className="field">
              <span className="field-label">Message to the athlete</span>
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} />
            </label>
            <div className="notice" style={{ marginBottom: 0 }}>
              <strong>Safety notice.</strong> {PLAN_SAFETY_NOTICE}
            </div>
            <button className="button" type="submit" disabled={saving || selected.length === 0}>
              {saving ? 'Sending…' : 'Send plan'}
            </button>
          </form>
        </section>
      </div>

      <Disclaimer />
    </div>
  );
}
