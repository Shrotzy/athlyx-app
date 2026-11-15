import { Link, NavLink, useNavigate } from 'react-router-dom';

import { useAuth } from '../lib/auth.jsx';
import { DISCLAIMER_SHORT, ROLES } from '@shared/constants.js';

export default function Layout({ children }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            AX
          </span>
          <span>
            ATHLYx
            <small>movement symmetry check-ins</small>
          </span>
        </Link>

        <nav className="nav">
          {!user && (
            <>
              <NavLink to="/login">Sign in</NavLink>
              <Link to="/signup" className="button small">
                Create account
              </Link>
            </>
          )}

          {user?.role === ROLES.ATHLETE && (
            <>
              <NavLink to="/athlete" end>
                My check-ins
              </NavLink>
              <NavLink to="/athlete/history">History</NavLink>
              <NavLink to="/athlete/plan">Exercise plan</NavLink>
              <NavLink to="/account">Account</NavLink>
            </>
          )}

          {user?.role === ROLES.THERAPIST && (
            <>
              <NavLink to="/therapist" end>
                Athletes
              </NavLink>
              <NavLink to="/account">Account</NavLink>
            </>
          )}

          {user && (
            <button type="button" className="link-button" onClick={handleSignOut}>
              Sign out
            </button>
          )}
        </nav>
      </header>

      <main className="page">{children}</main>

      <footer className="footnote">
        <strong>ATHLYx is a monitoring aid.</strong> {DISCLAIMER_SHORT} Video is processed in your
        browser and never uploaded; only measurements and landmark data are saved.
      </footer>
    </div>
  );
}
