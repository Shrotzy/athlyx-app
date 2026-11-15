import { DISCLAIMER_SHORT, SAFETY_NOTICE, STATUS, STATUS_LABEL } from '@shared/constants.js';

export function Disclaimer({ children }) {
  return (
    <div className="disclaimer" role="note">
      <strong>Not a diagnosis.</strong> {children || DISCLAIMER_SHORT}
    </div>
  );
}

export function SafetyNotice() {
  return (
    <div className="safety" role="note">
      <strong>Before you start.</strong> {SAFETY_NOTICE}
    </div>
  );
}

const STATUS_CLASS = {
  [STATUS.MEETS]: 'status-meets',
  [STATUS.BORDERLINE]: 'status-borderline',
  [STATUS.BELOW]: 'status-below',
  [STATUS.INSUFFICIENT]: 'status-insufficient',
};

export function StatusBadge({ status, children }) {
  if (!status) return <span className="badge">No data</span>;
  return (
    <span className={`badge ${STATUS_CLASS[status] || ''}`}>
      {children || STATUS_LABEL[status] || status}
    </span>
  );
}

export function Score({ value, label = 'score' }) {
  if (value == null || Number.isNaN(value)) return <span className="score muted">—</span>;
  return (
    <span className={`score ${value >= 90 ? 'good' : value >= 85 ? 'warn' : 'bad'}`}>
      {value}
      <small>% {label}</small>
    </span>
  );
}

export function Loading({ children = 'Loading…' }) {
  return <p className="muted">{children}</p>;
}

export function ErrorBanner({ error, details }) {
  if (!error) return null;
  return (
    <div className="error">
      <p>{error}</p>
      {details?.length > 0 && (
        <ul>
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }) {
  return (
    <label className="field" htmlFor={htmlFor}>
      <span className="field-label">
        {label}
        {hint && <em>{hint}</em>}
      </span>
      {children}
    </label>
  );
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
