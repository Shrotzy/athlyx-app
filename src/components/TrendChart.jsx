import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { PARAMS } from '@shared/constants.js';

export default function TrendChart({ points = [], showStatus = false }) {
  if (points.length < 2) {
    return (
      <p className="muted small">
        At least two check-ins are needed before a trend line means anything. Complete another check-in to
        see change over time.
      </p>
    );
  }

  const data = points.map((point) => ({
    date: new Date(point.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
    trend: point.trend,
    singleHop: point.singleHop,
    landing: point.landing,
    status: point.status,
  }));

  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 12 }} />
          <YAxis domain={[40, 100]} tick={{ fill: '#94a3b8', fontSize: 12 }} unit="%" />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
            labelStyle={{ color: '#e2e8f0' }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine y={PARAMS.targetScore} stroke="#5eead4" strokeDasharray="4 4" />
          <Line type="monotone" dataKey="trend" name="Trend score" stroke="#a78bfa" strokeWidth={2.5} dot />
          <Line type="monotone" dataKey="singleHop" name="Single hop" stroke="#38bdf8" dot />
          <Line type="monotone" dataKey="landing" name="Landing quality" stroke="#f472b6" dot />
        </LineChart>
      </ResponsiveContainer>
      {showStatus && (
        <p className="muted small">
          The trend line averages the test scores. It never decides the criteria status.
        </p>
      )}
    </div>
  );
}
