import { Link, Route, Routes } from 'react-router-dom';

import Layout from './components/Layout.jsx';
import Protected from './components/Protected.jsx';
import Welcome from './pages/Welcome.jsx';
import Login from './pages/Login.jsx';
import SignUp from './pages/SignUp.jsx';
import AthleteHome from './pages/AthleteHome.jsx';
import CheckIn from './pages/CheckIn.jsx';
import TestRunner from './pages/TestRunner.jsx';
import History from './pages/History.jsx';
import SessionDetail from './pages/SessionDetail.jsx';
import TherapistHome from './pages/TherapistHome.jsx';
import AthleteDetail from './pages/AthleteDetail.jsx';
import BuildPlan from './pages/BuildPlan.jsx';
import AthletePlan from './pages/AthletePlan.jsx';
import Account from './pages/Account.jsx';

function NotFound() {
  return (
    <div className="card stack">
      <h1>Page not found</h1>
      <p className="muted">That page does not exist. Head back to your dashboard.</p>
      <div className="row">
        <Link className="button" to="/">
          Home
        </Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Welcome />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<SignUp />} />

        <Route
          path="/athlete"
          element={
            <Protected role="athlete">
              <AthleteHome />
            </Protected>
          }
        />
        <Route
          path="/athlete/check-in"
          element={
            <Protected role="athlete">
              <CheckIn />
            </Protected>
          }
        />
        <Route
          path="/athlete/check-in/:test/:leg"
          element={
            <Protected role="athlete">
              <TestRunner />
            </Protected>
          }
        />
        <Route
          path="/athlete/history"
          element={
            <Protected role="athlete">
              <History />
            </Protected>
          }
        />
        <Route
          path="/athlete/plan"
          element={
            <Protected role="athlete">
              <AthletePlan />
            </Protected>
          }
        />
        <Route
          path="/athlete/session/:id"
          element={
            <Protected role="athlete">
              <SessionDetail />
            </Protected>
          }
        />

        <Route
          path="/therapist"
          element={
            <Protected role="therapist">
              <TherapistHome />
            </Protected>
          }
        />
        <Route
          path="/therapist/athlete/:id"
          element={
            <Protected role="therapist">
              <AthleteDetail />
            </Protected>
          }
        />
        <Route
          path="/therapist/session/:id"
          element={
            <Protected role="therapist">
              <SessionDetail />
            </Protected>
          }
        />
        <Route
          path="/therapist/plan/new"
          element={
            <Protected role="therapist">
              <BuildPlan />
            </Protected>
          }
        />

        <Route
          path="/account"
          element={
            <Protected>
              <Account />
            </Protected>
          }
        />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}
