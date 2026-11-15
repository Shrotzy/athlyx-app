import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from '../lib/auth.jsx';
import { Loading } from './common.jsx';

export default function Protected({ role, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading>Checking your session…</Loading>;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (role && user.role !== role) {
    return <Navigate to={user.role === 'therapist' ? '/therapist' : '/athlete'} replace />;
  }

  return children;
}
