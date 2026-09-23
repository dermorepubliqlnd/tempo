import { HashRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import { TimeTrackingProvider } from "./lib/TimeTrackingContext";
import RequireAuth from "./components/RequireAuth";
import Dashboard from "./pages/Dashboard";
import MaterialsOutput from "./pages/MaterialsOutput";
import MyDashboard from "./pages/MyDashboard";
import Projects from "./pages/Projects";
import { useApprovalAuthority } from "./lib/useApprovalAuthority";
import ApprovalCenter from "./pages/ApprovalCenter";
import TimeTracking from "./pages/TimeTracking";
import Utilization from "./pages/Utilization";
import Admin from "./pages/Admin";
import SiteSettings from "./pages/SiteSettings";
import HoursOverview from "./pages/HoursOverview";
import TimeOff from "./pages/TimeOff";
import WbsPlanning from "./pages/WbsPlanning";
import AuditTrail from "./pages/AuditTrail";
import KnowledgeBase from "./pages/KnowledgeBase";
import Archive from "./pages/Archive";
import Login from "./pages/Login";
import SetPassword from "./pages/SetPassword";

// 2026-09-24 (sidebar cleanup): Extension Requests left the menu -- its
// decisions live in Approval Center. Old links/bookmarks send approvers
// there and everyone else to Projects & Tasks (a task's extension history
// is on the task itself). The page file is kept, just unrouted.
function ExtensionRequestsRedirect() {
  const has = useApprovalAuthority();
  if (has === null) return null;
  return <Navigate to={has ? "/approval-center" : "/projects"} replace />;
}

// Approval Center is only reachable by people with approval authority
// (same rule that hides its menu item).
function ApprovalCenterGate() {
  const has = useApprovalAuthority();
  if (has === null) return null;
  return has ? <ApprovalCenter /> : <Navigate to="/" replace />;
}

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
          <Route path="/knowledge-base/category/:categoryId" element={<KnowledgeBase />} />
          <Route path="/knowledge-base/article/:entryId" element={<KnowledgeBase />} />
          <Route path="/archive" element={<Archive />} />
          <Route path="/tasks" element={<Navigate to="/projects" replace />} />
          <Route path="/tasks/:taskId" element={<Navigate to="/projects" replace />} />
          <Route path="/approval-center" element={<ApprovalCenterGate />} />
          <Route path="/extension-requests" element={<ExtensionRequestsRedirect />} />
          <Route path="/time-tracking" element={<TimeTracking />} />
          <Route path="/utilization" element={<Utilization />} />
          <Route path="/hours-overview" element={<HoursOverview />} />
          <Route path="/time-off" element={<TimeOff />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/site-settings" element={<SiteSettings />} />
          <Route path="/admin/holidays" element={<Navigate to="/time-off?tab=holidays" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
