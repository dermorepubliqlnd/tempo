import { HashRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import { TimeTrackingProvider } from "./lib/TimeTrackingContext";
import RequireAuth from "./components/RequireAuth";
import Dashboard from "./pages/Dashboard";
import MaterialsOutput from "./pages/MaterialsOutput";
import MyDashboard from "./pages/MyDashboard";
import Projects from "./pages/Projects";
import ExtensionRequests from "./pages/ExtensionRequests";
import ApprovalCenter from "./pages/ApprovalCenter";
import TimeTracking from "./pages/TimeTracking";
import Utilization from "./pages/Utilization";
import Admin from "./pages/Admin";
import SiteSettings from "./pages/SiteSettings";
import HoursOverview from "./pages/HoursOverview";
import TimeOff from "./pages/TimeOff";
import HolidayCalendar from "./pages/HolidayCalendar";
import WbsPlanning from "./pages/WbsPlanning";
import AuditTrail from "./pages/AuditTrail";
import KnowledgeBase from "./pages/KnowledgeBase";
import Login from "./pages/Login";
import SetPassword from "./pages/SetPassword";

function RedirectToWbs() {
  const { projectId } = useParams<{ projectId: string }>();
  return <Navigate to={`/projects/${projectId}/wbs`} replace />;
}

// Real client-side routes (React Router) — each screen has its own URL,
// so the browser's native Back/Forward buttons work without any custom
// handling. Unsaved-changes prompts on forms are added per-page via the
// useUnsavedChangesGuard hook (see src/lib/useUnsavedChangesGuard.ts).
//
// Tasks now lives inside the Projects page (single combined view per
// Sandra's request); /tasks is kept as a redirect so old links/bookmarks
// still resolve.
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/set-password"
          element={
            <RequireAuth>
              <SetPassword />
            </RequireAuth>
          }
        />
        <Route
          element={
            <RequireAuth>
              <TimeTrackingProvider>
                <AppLayout />
              </TimeTrackingProvider>
            </RequireAuth>
          }
        >
          <Route path="/" element={<MyDashboard />} />
          <Route path="/team-dashboard" element={<Dashboard />} />
          <Route path="/materials-output" element={<MaterialsOutput />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:projectId" element={<Projects />} />
          <Route path="/projects/:projectId/wbs" element={<WbsPlanning />} />
          {/* 2026-09-21 (Sandra: "instead of having a separate page, can
              we all be routed to the WBS page") -- BaselineReport.tsx is
              retired as a standalone destination; the WBS page now shows
              the same content in-place for closed projects
              (ClosedProjectReportPanel). Old /baseline links/bookmarks
              redirect straight to /wbs instead of breaking. */}
          <Route path="/projects/:projectId/baseline" element={<RedirectToWbs />} />
          <Route path="/projects/:projectId/audit-trail" element={<AuditTrail />} />
          <Route path="/knowledge-base" element={<KnowledgeBase />} />
          <Route path="/tasks" element={<Navigate to="/projects" replace />} />
          <Route path="/tasks/:taskId" element={<Navigate to="/projects" replace />} />
          <Route path="/approval-center" element={<ApprovalCenter />} />
          <Route path="/extension-requests" element={<ExtensionRequests />} />
          <Route path="/time-tracking" element={<TimeTracking />} />
          <Route path="/utilization" element={<Utilization />} />
          <Route path="/hours-overview" element={<HoursOverview />} />
          <Route path="/time-off" element={<TimeOff />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/site-settings" element={<SiteSettings />} />
          <Route path="/admin/holidays" element={<HolidayCalendar />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
